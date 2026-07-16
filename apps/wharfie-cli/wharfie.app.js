import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import { packageLocalApp, stringifyJson } from '../../src/cli/app/local-app.js';
import { displayFailure } from '../../src/cli/output/basic.js';
import { assertSeaNodeVersionCompatible } from '../../src/core/resources/builds/lib/sea-node-version.js';

const MODULE_PATH = fileURLToPath(import.meta.url);
const MODULE_DIR = path.dirname(MODULE_PATH);

/**
 * @param {string} rootDir - rootDir
 * @returns {boolean} - Whether the directory contains the Wharfie sources required by this build app.
 */
function hasWharfieSources(rootDir) {
  return (
    fs.existsSync(path.join(rootDir, 'src', 'cli', 'entry.js')) &&
    fs.existsSync(path.join(rootDir, 'apps', 'wharfie-cli', 'wharfie.app.js'))
  );
}

/**
 * Prefer the current workspace when building from the repo, but fall back to
 * the installed package location when invoked from a normal project.
 * @param {string} [startDir] - startDir
 * @returns {string} - Wharfie source root.
 */
function resolveSourceRoot(startDir = process.cwd()) {
  const workspaceRoot = findRepoRoot(startDir);
  if (hasWharfieSources(workspaceRoot)) return workspaceRoot;

  const installedPackageRoot = findRepoRoot(MODULE_DIR);
  if (hasWharfieSources(installedPackageRoot)) return installedPackageRoot;

  throw new Error(
    `Unable to locate Wharfie package sources from ${startDir}. Expected src/cli/entry.js and apps/wharfie-cli/wharfie.app.js to exist.`,
  );
}

/**
 * Unshipped Wharfie CLI self-hosting experiment built via the standard
 * `wharfie app package` path. It is retained as design material, not as a
 * supported standalone builder: build-host dependencies are not embedded yet.
 *
 * This module plays two roles:
 *  1) A v2 app spec (default export) so `wharfie app manifest apps/wharfie-cli` works.
 *  2) A local build driver when executed directly:
 *
 *     node ./apps/wharfie-cli/wharfie.app.js
 *
 * Experimental manual smoke test (expected to expose remaining self-host gaps):
 *  1) node ./apps/wharfie-cli/wharfie.app.js
 *  2) ./dist/wharfie-cli-node<version>-<platform>-<arch> --help
 *  3) ./dist/wharfie-cli-node<version>-<platform>-<arch> app manifest ./scratch/examples/actor-systems/kitchen-sink
 *  4) ./dist/wharfie-cli-node<version>-<platform>-<arch> app run start --dir ./scratch/examples/actor-systems/kitchen-sink --event '{"who":"smoke"}'
 */

/**
 * The self-hosting prototype intentionally downloads Node.js distribution artifacts (via NodeBinary)
 * and postjects a SEA blob into the target node binary.
 *
 * Jest runs must never trigger that network/download path.
 */
function assertNotUnderJest() {
  if (process.env.JEST_WORKER_ID) {
    throw new Error('The self-hosting prototype is disabled under jest');
  }
}

/**
 * @param {string} platform - platform
 * @returns {'darwin'|'linux'|'win32'} - normalized platform
 */
function normalizePlatform(platform) {
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
function normalizeArch(arch) {
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
function findRepoRoot(startDir) {
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
 * @returns {string} - Result.
 */
function resolveBuildNodeVersion() {
  const value =
    typeof process.env.WHARFIE_SELF_NODE_VERSION === 'string'
      ? process.env.WHARFIE_SELF_NODE_VERSION.trim()
      : '';

  return value || process.versions.node;
}

/**
 * @param {string} nodeVersion - nodeVersion.
 * @returns {{ nodeVersion: string, platform: 'darwin'|'linux'|'win32', architecture: 'arm64'|'x64' }[]} - Result.
 */
function createBuildTargets(nodeVersion) {
  return [
    { nodeVersion, platform: 'darwin', architecture: 'arm64' },
    { nodeVersion, platform: 'darwin', architecture: 'x64' },
    { nodeVersion, platform: 'linux', architecture: 'arm64' },
    { nodeVersion, platform: 'linux', architecture: 'x64' },
    { nodeVersion, platform: 'win32', architecture: 'arm64' },
    { nodeVersion, platform: 'win32', architecture: 'x64' },
  ];
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
 * @param {string} platform - platform.
 * @param {string} arch - arch.
 * @returns {string} - Result.
 */
function resolveTargetFilter(platform, arch) {
  return `${normalizePlatform(platform)}-${normalizeArch(arch)}`;
}

/**
 * @returns {string} - Result.
 */
function resolveDefaultOutputDir() {
  return path.join(findRepoRoot(process.cwd()), 'dist');
}

/**
 * @param {{ platform: string, arch: string, nodeVersion: string, outputDir?: string }} options - Options; nodeVersion must exactly match the running Node.js version.
 * @returns {Promise<import('../../src/cli/app/local-app.js').PackageLocalAppResult>} - Result.
 */
export async function packageWharfieCli(options) {
  const nodeVersion = assertSeaNodeVersionCompatible(options.nodeVersion);

  return await withBuildNodeVersion(
    nodeVersion,
    async () =>
      await packageLocalApp({
        dir: MODULE_DIR,
        outputDir: options.outputDir || resolveDefaultOutputDir(),
        targetFilters: [resolveTargetFilter(options.platform, options.arch)],
      }),
  );
}

const app = {
  name: 'wharfie-cli',
  cli: {
    entrypoint: path.join(resolveSourceRoot(), 'src', 'cli', 'entry.js'),
    export: 'main',
  },
  targets: createBuildTargets(resolveBuildNodeVersion()),
  packaging: {
    signing: {
      macos: {
        certificateBase64: process.env.WHARFIE_MACOS_CERT_BASE64 || '',
        certificatePassword: process.env.WHARFIE_MACOS_CERT_PASSWORD || '',
        keychainPassword: process.env.WHARFIE_MACOS_KEYCHAIN_PASSWORD || '',
      },
    },
    // Packaged init assets are intentionally omitted until the Milestone 2
    // scaffold is defined; the v1 templates must not be embedded.
  },
};

export default app;

/**
 * @returns {boolean} -
 */
function isExecutedDirectly() {
  const selfPath = MODULE_PATH;
  const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return invokedPath === path.resolve(selfPath);
}

if (isExecutedDirectly()) {
  const cmd = new Command('wharfie-self-host-prototype')
    .description(
      'Experimentally package the unshipped Wharfie CLI self-hosting prototype',
    )
    .option(
      '--platform <platform>',
      'Target platform (darwin|linux|win32)',
      process.platform,
    )
    .option('--arch <arch>', 'Target architecture (arm64|x64)', process.arch)
    .option(
      '--node-version <nodeVersion>',
      'Exact target Node version; must match the running Node version',
      resolveBuildNodeVersion(),
    )
    .option(
      '--output-dir <dir>',
      'Directory to copy packaged artifacts into (default: <repo root>/dist)',
    )
    .option('--json', 'Output JSON (default)')
    .option('--no-pretty', 'Disable pretty JSON output')
    .action(async (opts) => {
      try {
        assertNotUnderJest();
        const result = await packageWharfieCli({
          platform: opts.platform,
          arch: opts.arch,
          nodeVersion: opts.nodeVersion,
          outputDir: opts.outputDir,
        });
        process.stdout.write(`${stringifyJson(result, opts)}\n`);
      } catch (err) {
        displayFailure(err);
        process.exitCode = 1;
      }
    });

  await cmd.parseAsync(process.argv);
}
