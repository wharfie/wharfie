import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

const { Command } = require('commander');

/**
 * Build a SEA (Single Executable Application) of the Wharfie CLI itself.
 *
 * Manual smoke (after building on your platform):
 *   ./dist/wharfie-<platform>-<arch> --help
 *   ./dist/wharfie-<platform>-<arch> app manifest --help
 *
 * Windows:
 *   .\dist\wharfie-win32-x64.exe --help
 *   .\dist\wharfie-win32-x64.exe app manifest --help
 *
 * Notes:
 * - This command is intentionally disabled under Jest/test runs to avoid network
 *   downloads (Node binaries) during unit tests.
 */

/**
 * @returns {boolean}
 */
function isTestEnv() {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
}

/**
 * @param {string} value
 * @returns {'darwin'|'linux'|'win32'}
 */
function normalizePlatform(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();

  if (v === 'darwin' || v === 'linux' || v === 'win32') return v;

  // Friendly aliases (CLI ergonomics)
  if (v === 'mac' || v === 'macos' || v === 'osx') return 'darwin';
  if (v === 'windows' || v === 'win') return 'win32';

  throw new Error(
    `Unsupported platform: ${value}. Expected one of: darwin, linux, win32`,
  );
}

/**
 * @param {string} value
 * @returns {'x64'|'arm64'}
 */
function normalizeArch(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();

  if (v === 'x64' || v === 'arm64') return v;

  // Friendly aliases (CLI ergonomics)
  if (v === 'amd64') return 'x64';
  if (v === 'aarch64') return 'arm64';

  throw new Error(`Unsupported arch: ${value}. Expected one of: x64, arm64`);
}

/**
 * @param {{ platform?: string, arch?: string }} options
 * @returns {Promise<void>}
 */
async function buildSelf(options) {
  if (isTestEnv()) {
    console.error(
      'wharfie build-self is disabled while running under tests (Jest).',
    );
    process.exitCode = 1;
    return;
  }

  const repoRoot = path.resolve(import.meta.dirname, '../..');

  const targetPlatform = normalizePlatform(
    options.platform ?? process.platform,
  );
  const targetArch = normalizeArch(options.arch ?? process.arch);

  if (targetPlatform === 'darwin' && process.platform !== 'darwin') {
    throw new Error(
      'Cannot build a darwin SEA from a non-darwin host. Run this on macOS.',
    );
  }

  const distDir = path.join(repoRoot, 'dist');
  fs.mkdirSync(distDir, { recursive: true });

  const outputBase = `wharfie-${targetPlatform}-${targetArch}`;
  const outputPath = path.join(
    distDir,
    targetPlatform === 'win32' ? `${outputBase}.exe` : outputBase,
  );

  console.log(
    `Building Wharfie SEA executable for ${targetPlatform}/${targetArch} (node ${process.versions.node})...`,
  );

  const [{ default: NodeBinary }, { default: SeaBuild }] = await Promise.all([
    import('../../lambdas/lib/actor/resources/builds/node-binary.js'),
    import('../../lambdas/lib/actor/resources/builds/sea-build.js'),
  ]);

  const nodeMajor = process.versions.node.split('.')[0];
  const nodeBinary = new NodeBinary({
    name: `wharfie-self-node-${targetPlatform}-${targetArch}-${process.versions.node}`,
    properties: {
      version: nodeMajor,
      exactVersion: `v${process.versions.node}`,
      platform: targetPlatform,
      architecture: targetArch,
    },
  });

  const entryCode = [
    "import sourceMapSupport from 'source-map-support';",
    'sourceMapSupport.install();',
    "require('./bin/wharfie');",
  ].join('\n');

  const seaBuild = new SeaBuild({
    name: outputBase,
    dependsOn: [nodeBinary],
    properties: {
      entryCode,
      resolveDir: () => repoRoot,
      nodeBinaryPath: () => nodeBinary.get('binaryPath'),
      nodeVersion: () => nodeBinary.get('exactVersion').slice(1),
      platform: targetPlatform,
      architecture: targetArch,
    },
  });

  await nodeBinary.reconcile();
  await seaBuild.reconcile();

  const builtBinaryPath = seaBuild.get('binaryPath');
  if (!builtBinaryPath || typeof builtBinaryPath !== 'string') {
    throw new Error('SeaBuild did not produce a binaryPath.');
  }

  fs.copyFileSync(builtBinaryPath, outputPath);
  if (targetPlatform !== 'win32') {
    fs.chmodSync(outputPath, 0o755);
  }

  if (process.platform === 'darwin' && targetPlatform === 'darwin') {
    const { default: MacOSBinarySignature } =
      await import('../../lambdas/lib/actor/resources/builds/macos-binary-signature.js');

    const signer = new MacOSBinarySignature({
      name: `wharfie-self-sign-${targetPlatform}-${targetArch}-${process.versions.node}`,
      properties: {
        binaryPath: outputPath,
      },
    });

    // NOTE: spctl assessment rejects standalone executables (it is primarily meant for
    // app bundles). The underlying codesign verification is what we care about here.
    // We temporarily set CI=1 so MacOSBinarySignature skips spctl locally.
    const prevCI = process.env.CI;
    if (!process.env.CI) process.env.CI = '1';
    try {
      await signer.reconcile();
    } finally {
      if (prevCI === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = prevCI;
      }
    }
  }

  console.log(`Built: ${outputPath}`);
}

/**
 * @param {import('commander').Command} cmd
 * @returns {import('commander').Command}
 */
function configureBuildCommand(cmd) {
  return cmd
    .description('Build a SEA single-executable of the Wharfie CLI itself')
    .option('--platform <platform>', 'Target platform (darwin|linux|win32)')
    .option('--arch <arch>', 'Target architecture (x64|arm64)')
    .action(async (options) => {
      try {
        await buildSelf(options);
      } catch (err) {
        console.error(err);
        process.exitCode = 1;
      }
    });
}

const buildSelfCommand = configureBuildCommand(new Command('build-self'));

export const selfCommand = new Command('self')
  .description('Self-referential Wharfie commands')
  .action(() => {
    selfCommand.help();
  });

selfCommand.addCommand(configureBuildCommand(new Command('build')));

export default buildSelfCommand;
