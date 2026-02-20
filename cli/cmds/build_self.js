import fs from 'node:fs';
import path from 'node:path';

import { Command } from 'commander';

import NodeBinary from '../../lambdas/lib/actor/resources/builds/node-binary.js';
import SeaBuild from '../../lambdas/lib/actor/resources/builds/sea-build.js';
import MacOSBinarySignature from '../../lambdas/lib/actor/resources/builds/macos-binary-signature.js';

import {
  displayFailure,
  displayInfo,
  displaySuccess,
} from '../output/basic.js';

/**
 * build-self intentionally downloads Node.js distribution artifacts (via NodeBinary)
 * and postjects a SEA blob into the target node binary.
 *
 * Jest runs must never trigger that network/download path.
 */
function assertNotUnderJest() {
  if (process.env.JEST_WORKER_ID) {
    throw new Error('wharfie build-self is disabled under jest');
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
 * Build a SEA single-executable for Wharfie CLI.
 *
 * Smoke test (manual):
 *   1) node ./bin/wharfie build-self
 *   2) ./dist/wharfie-$(node -p "process.platform")-$(node -p "process.arch") --help
 *   3) ./dist/wharfie-$(node -p "process.platform")-$(node -p "process.arch") app manifest --help
 */
async function buildSelf({ platform, arch, nodeVersion }) {
  const repoRoot = findRepoRoot(process.cwd());
  const distDir = path.join(repoRoot, 'dist');
  fs.mkdirSync(distDir, { recursive: true });

  const normalizedPlatform = normalizePlatform(platform);
  const normalizedArch = normalizeArch(arch);

  const outName = `wharfie-${normalizedPlatform}-${normalizedArch}${
    normalizedPlatform === 'win32' ? '.exe' : ''
  }`;
  const outPath = path.join(distDir, outName);

  displayInfo(
    `Building Wharfie SEA executable for ${normalizedPlatform}/${normalizedArch} (node ${nodeVersion})...`,
  );

  const nodeBinary = new NodeBinary({
    name: `wharfie-self-node-${normalizedPlatform}-${normalizedArch}`,
    properties: {
      version: nodeVersion,
      platform: normalizedPlatform,
      architecture: normalizedArch,
    },
  });

  // NOTE: We keep entryCode minimal and ESM-only to keep esbuild bundling predictable.
  const seaBuild = new SeaBuild({
    name: `wharfie-self-${normalizedPlatform}-${normalizedArch}`,
    properties: {
      entryCode: () =>
        `
          import { main } from './cli/entry.js';

          main(process.argv).catch((err) => {
            // eslint-disable-next-line no-console
            console.error(err);
            process.exitCode = 1;
          });
        `,
      resolveDir: () => repoRoot,
      nodeBinaryPath: () => nodeBinary.get('binaryPath'),
      nodeVersion: () => nodeBinary.get('exactVersion').slice(1),
      platform: normalizedPlatform,
      architecture: normalizedArch,
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
