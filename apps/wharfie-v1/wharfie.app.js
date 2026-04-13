import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import NodeBinary from '../../src/core/resources/builds/node-binary.js';
import SeaBuild from '../../src/core/resources/builds/sea-build.js';
import MacOSBinarySignature from '../../src/core/resources/builds/macos-binary-signature.js';

import {
  TEMPLATES_ASSET_BASE,
  TEMPLATES_ASSET_MANIFEST_KEY,
} from '../../src/cli/assets/extract-templates.js';

import {
  displayFailure,
  displayInfo,
  displaySuccess,
} from '../../src/cli/output/basic.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} rootDir - rootDir
 * @returns {boolean} - Whether the directory contains the Wharfie sources required by this build app.
 */
function hasWharfieSources(rootDir) {
  return (
    fs.existsSync(path.join(rootDir, 'src', 'cli', 'entry.js')) &&
    fs.existsSync(
      path.join(rootDir, 'src', 'cli', 'project', 'project_structure_examples'),
    )
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
    `Unable to locate Wharfie package sources from ${startDir}. Expected src/cli/entry.js and init templates to exist.`,
  );
}

/**
 * Wharfie v1 CLI (today's `bin/wharfie`) built as a v2-style SEA artifact via SeaBuild.
 *
 * This module plays two roles:
 *  1) A v2 app spec (default export) so `wharfie app manifest apps/wharfie-v1` works.
 *  2) A build driver when executed directly:
 *
 *     npm run build:wharfie-v1
 *
 * Manual smoke test:
 *  1) npm run build:wharfie-v1
 *  2) ./dist/wharfie-v1-${process.platform}-${process.arch} --help
 *  3) ./dist/wharfie-v1-${process.platform}-${process.arch} app manifest --help
 */
export default {
  name: 'wharfie-v1',
  // Default "release-like" targets (can be expanded later).
  targets: [
    { nodeVersion: '24', platform: 'darwin', architecture: 'arm64' },
    { nodeVersion: '24', platform: 'darwin', architecture: 'x64' },
    { nodeVersion: '24', platform: 'linux', architecture: 'x64' },
    { nodeVersion: '24', platform: 'win32', architecture: 'x64' },
  ],
};

/**
 * build:wharfie-v1 intentionally downloads Node.js distribution artifacts (via NodeBinary)
 * and postjects a SEA blob into the target node binary.
 *
 * Jest runs must never trigger that network/download path.
 */
function assertNotUnderJest() {
  if (process.env.JEST_WORKER_ID) {
    throw new Error('build:wharfie-v1 is disabled under jest');
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
 * Recursively list files under a directory, returning POSIX-style relative paths.
 * @param {string} rootDir -
 * @returns {string[]} - Relative file paths with forward slashes.
 */
function collectTemplateFiles(rootDir) {
  /** @type {string[]} */
  const out = [];

  /**
   * @param {string} absDir -
   * @param {string} relDir -
   */
  function walk(absDir, relDir) {
    const entries = fs.readdirSync(absDir, { withFileTypes: true });

    for (const ent of entries) {
      const absPath = path.join(absDir, ent.name);
      const relPath = relDir ? `${relDir}/${ent.name}` : ent.name;

      if (ent.isDirectory()) {
        walk(absPath, relPath);
      } else if (ent.isFile()) {
        out.push(relPath);
      }
    }
  }

  walk(rootDir, '');
  return out;
}

/**
 * Build a SEA asset map for the init templates (plus a manifest).
 * @param {string} repoRoot -
 * @param {string} distDir -
 * @returns {Record<string, string>} -
 */
function buildTemplateAssets(repoRoot, distDir) {
  const templatesDir = path.join(
    repoRoot,
    'src',
    'cli',
    'project',
    'project_structure_examples',
  );

  if (!fs.existsSync(templatesDir)) {
    throw new Error(`Templates directory not found: ${templatesDir}`);
  }

  const relFiles = collectTemplateFiles(templatesDir);
  const manifest = {
    baseKey: TEMPLATES_ASSET_BASE,
    files: relFiles,
  };

  const manifestPath = path.join(distDir, 'wharfie-v1-templates.manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  /** @type {Record<string, string>} */
  const assets = {
    [TEMPLATES_ASSET_MANIFEST_KEY]: manifestPath,
  };

  for (const rel of relFiles) {
    const key = `${TEMPLATES_ASSET_BASE}/${rel}`;
    assets[key] = path.join(templatesDir, ...rel.split('/'));
  }

  return assets;
}

/**
 * Build a SEA single-executable for the Wharfie v1 CLI.
 * @param {{ platform: string, arch: string, nodeVersion: string }} options - options
 * @returns {Promise<string>} - Path to the built artifact in ./dist
 */
async function buildWharfieV1(options) {
  const workspaceRoot = findRepoRoot(process.cwd());
  const sourceRoot = resolveSourceRoot(process.cwd());
  const distDir = path.join(workspaceRoot, 'dist');
  fs.mkdirSync(distDir, { recursive: true });

  const templateAssets = buildTemplateAssets(sourceRoot, distDir);

  const normalizedPlatform = normalizePlatform(options.platform);
  const normalizedArch = normalizeArch(options.arch);

  const outName = `wharfie-v1-${normalizedPlatform}-${normalizedArch}${
    normalizedPlatform === 'win32' ? '.exe' : ''
  }`;
  const outPath = path.join(distDir, outName);

  displayInfo(
    `Building Wharfie v1 SEA executable for ${normalizedPlatform}/${normalizedArch} (node ${options.nodeVersion})...`,
  );

  const nodeBinary = new NodeBinary({
    name: `wharfie-v1-node-${normalizedPlatform}-${normalizedArch}`,
    properties: {
      version: options.nodeVersion,
      platform: normalizedPlatform,
      architecture: normalizedArch,
    },
  });

  // NOTE: Keep entryCode minimal and ESM-only to keep esbuild bundling predictable.
  // This runs the same commander program as `bin/wharfie`.
  const seaBuild = new SeaBuild({
    name: `wharfie-v1-${normalizedPlatform}-${normalizedArch}`,
    properties: {
      entryCode: () =>
        `
          import { main } from './src/cli/entry.js';

          main(process.argv).catch((err) => {
            // eslint-disable-next-line no-console
            console.error(err);
            process.exitCode = 1;
          });
        `,
      resolveDir: () => sourceRoot,
      nodeBinaryPath: () => nodeBinary.get('binaryPath'),
      nodeVersion: () => nodeBinary.get('exactVersion').slice(1),
      platform: normalizedPlatform,
      architecture: normalizedArch,
      assets: () => templateAssets,
    },
  });

  // NodeBinary must be reconciled first (SeaBuild waits on stable dependsOn but does not reconcile it).
  await nodeBinary.reconcile();
  await seaBuild.reconcile();

  fs.copyFileSync(seaBuild.get('binaryPath'), outPath);

  if (normalizedPlatform !== 'win32') {
    fs.chmodSync(outPath, 0o755);
  }

  if (normalizedPlatform === 'darwin' && process.platform === 'darwin') {
    const signature = new MacOSBinarySignature({
      name: `${outName}-signature`,
      properties: {
        binaryPath: () => outPath,
      },
    });
    await signature.reconcile();
  }

  displaySuccess(`Built: ${outPath}`);
  return outPath;
}

/**
 * @returns {boolean} -
 */
function isExecutedDirectly() {
  const selfPath = fileURLToPath(import.meta.url);
  const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return invokedPath === path.resolve(selfPath);
}

if (isExecutedDirectly()) {
  const cmd = new Command('build:wharfie-v1')
    .description(
      'Build Wharfie v1 CLI as a single executable (SEA via SeaBuild)',
    )
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
    .action(async (opts) => {
      try {
        assertNotUnderJest();
        await buildWharfieV1({
          platform: opts.platform,
          arch: opts.arch,
          nodeVersion: opts.nodeVersion,
        });
      } catch (err) {
        displayFailure(err);
        process.exitCode = 1;
      }
    });

  await cmd.parseAsync(process.argv);
}
