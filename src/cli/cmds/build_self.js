import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { Command } from 'commander';

import { dirPathFromImportMetaUrl } from '../../core/lib/import-meta-path.js';
import { packageLocalApp } from '../app/local-app.js';
import {
  displayFailure,
  displayInfo,
  displaySuccess,
} from '../output/basic.js';

const MODULE_DIR = dirPathFromImportMetaUrl(import.meta.url);

/**
 * @param {string} rootDir - rootDir
 * @returns {boolean} - Whether this directory contains the shipped Wharfie sources required by build-self.
 */
export function hasBuildSources(rootDir) {
  return (
    fs.existsSync(path.join(rootDir, 'src', 'cli', 'entry.js')) &&
    fs.existsSync(
      path.join(rootDir, 'src', 'cli', 'project', 'project_structure_examples'),
    ) &&
    fs.existsSync(path.join(rootDir, 'apps', 'wharfie-cli', 'wharfie.app.js'))
  );
}

/**
 * Resolve the Wharfie source tree used by build-self.
 *
 * Prefer the current workspace when running from the repo (or a copied package
 * tree), but fall back to the installed package location when the current
 * working directory is just an arbitrary project with its own package.json.
 *
 * @param {string} [startDir] - Directory to inspect first.
 * @returns {string} - Wharfie source root.
 */
export function resolveBuildSourceRoot(startDir = process.cwd()) {
  const workspaceRoot = findRepoRoot(startDir);
  if (hasBuildSources(workspaceRoot)) return workspaceRoot;

  const installedPackageRoot = findRepoRoot(MODULE_DIR);
  if (hasBuildSources(installedPackageRoot)) return installedPackageRoot;

  throw new Error(
    `Unable to locate Wharfie build sources from ${startDir}. Expected apps/wharfie-cli/wharfie.app.js, src/cli/entry.js, and init templates to exist.`,
  );
}

/**
 * build-self intentionally downloads Node.js distribution artifacts (via NodeBinary)
 * and postjects a SEA blob into the target node binary.
 *
 * Jest runs must never trigger that network/download path.
 */
export function assertNotUnderJest() {
  if (process.env.JEST_WORKER_ID) {
    throw new Error('wharfie build-self is disabled under jest');
  }
}

/**
 * @param {string} platform - platform
 * @returns {'darwin'|'linux'|'win32'} - normalized platform
 */
export function normalizePlatform(platform) {
  const p = String(platform).toLowerCase();
  if (p === 'mac' || p === 'macos' || p === 'osx') return 'darwin';
  if (p === 'windows' || p === 'win') return 'win32';
  if (p === 'linux') return 'linux';
  if (p === 'darwin' || p === 'win32') return /** @type {any} */ (p);
  throw new Error(`Unsupported platform: ${platform}`);
}

/**
 * @param {string} arch - arch
 * @returns {'arm64'|'x64'} - normalized arch
 */
export function normalizeArch(arch) {
  const a = String(arch).toLowerCase();
  if (a === 'amd64') return 'x64';
  if (a === 'arm64' || a === 'x64') return /** @type {any} */ (a);
  throw new Error(`Unsupported arch: ${arch}`);
}

/**
 * Find the repo root (directory containing package.json) without relying on import.meta.
 * @param {string} startDir - startDir
 * @returns {string} - repo root
 */
export function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);

  while (true) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) return dir;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return path.resolve(startDir);
}

/**
 * @param {string} startDir - startDir.
 * @returns {string} - Result.
 */
function resolveSelfAppDir(startDir) {
  return path.join(resolveBuildSourceRoot(startDir), 'apps', 'wharfie-cli');
}

/**
 * @param {string} nodeVersion - nodeVersion.
 * @param {() => Promise<any>} handler - handler.
 * @returns {Promise<any>} - Result.
 */
async function withBuildNodeVersion(nodeVersion, handler) {
  const previousValue = process.env.WHARFIE_SELF_NODE_VERSION;
  process.env.WHARFIE_SELF_NODE_VERSION = nodeVersion;

  try {
    return await handler();
  } finally {
    if (previousValue === undefined) {
      delete process.env.WHARFIE_SELF_NODE_VERSION;
    } else {
      process.env.WHARFIE_SELF_NODE_VERSION = previousValue;
    }
  }
}

/**
 * @param {'darwin'|'linux'|'win32'} platform - platform.
 * @param {'arm64'|'x64'} arch - arch.
 * @returns {string} - Result.
 */
function getLegacyArtifactPath(platform, arch) {
  const workspaceRoot = findRepoRoot(process.cwd());
  const distDir = path.join(workspaceRoot, 'dist');
  const extension = platform === 'win32' ? '.exe' : '';

  return path.join(distDir, `wharfie-${platform}-${arch}${extension}`);
}

/**
 * Build a SEA single-executable for Wharfie CLI.
 *
 * Smoke test (manual):
 *   1) node ./bin/wharfie build-self
 *   2) ./dist/wharfie-$(node -p "process.platform")-$(node -p "process.arch") --help
 *   3) ./dist/wharfie-$(node -p "process.platform")-$(node -p "process.arch") app manifest ./scratch/examples/actor-systems/kitchen-sink
 *   4) ./dist/wharfie-$(node -p "process.platform")-$(node -p "process.arch") app run start --dir ./scratch/examples/actor-systems/kitchen-sink --event '{"who":"smoke"}'
 */

/**
 * @param {{ platform: string, arch: string, nodeVersion: string }} options - Build options.
 * @returns {Promise<void>}
 */
export async function buildSelf({ platform, arch, nodeVersion }) {
  const normalizedPlatform = normalizePlatform(platform);
  const normalizedArch = normalizeArch(arch);
  const selfAppDir = resolveSelfAppDir(process.cwd());
  const workspaceRoot = findRepoRoot(process.cwd());
  const distDir = path.join(workspaceRoot, 'dist');
  await fsp.mkdir(distDir, { recursive: true });

  displayInfo(
    `Building Wharfie SEA executable for ${normalizedPlatform}/${normalizedArch} (node ${nodeVersion})...`,
  );

  const result = await withBuildNodeVersion(
    nodeVersion,
    async () =>
      await packageLocalApp({
        dir: selfAppDir,
        outputDir: distDir,
        targetFilters: [`${normalizedPlatform}-${normalizedArch}`],
      }),
  );

  if (result.artifacts.length !== 1) {
    throw new Error(
      `Expected build-self to produce exactly one artifact, received ${result.artifacts.length}.`,
    );
  }

  const builtArtifact = result.artifacts[0];
  const legacyArtifactPath = getLegacyArtifactPath(
    normalizedPlatform,
    normalizedArch,
  );

  if (path.resolve(builtArtifact.path) !== path.resolve(legacyArtifactPath)) {
    await fsp.rm(legacyArtifactPath, { force: true });
    await fsp.rename(builtArtifact.path, legacyArtifactPath);
  }

  if (normalizedPlatform !== 'win32') {
    await fsp.chmod(legacyArtifactPath, 0o755);
  }

  displaySuccess(`Built: ${legacyArtifactPath}`);
}

const buildSelfCommand = new Command('build-self')
  .description('Build Wharfie CLI as a single executable (SEA)')
  .option(
    '--platform <platform>',
    'Target platform (darwin|linux|win32)',
    process.platform,
  )
  .option('--arch <arch>', 'Target architecture (arm64|x64)', process.arch)
  .option(
    '--node-version <nodeVersion>',
    'Node version prefix to embed (default: current node)',
    process.versions.node,
  )
  .action(async (options) => {
    try {
      assertNotUnderJest();
      await buildSelf({
        platform: options.platform,
        arch: options.arch,
        nodeVersion: options.nodeVersion,
      });
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    }
  });

export default buildSelfCommand;
