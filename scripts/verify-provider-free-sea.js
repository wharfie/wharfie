import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import { inject } from 'postject';

import { runCommand } from './package-verification.js';

/**
 * Turn one bundled CommonJS entry into a real platform SEA.
 * @param {object} options - SEA inputs.
 * @param {string} options.bundlePath - Bundled JavaScript entry.
 * @param {string} options.seaRoot - Owned build directory.
 * @returns {Promise<string>} - Injected executable path.
 */
async function injectSea({ bundlePath, seaRoot }) {
  const blobPath = path.join(seaRoot, 'provider-free.blob');
  const configPath = path.join(seaRoot, 'sea-config.json');
  const injectedPath = path.join(
    seaRoot,
    process.platform === 'win32'
      ? 'provider-free-sea.exe'
      : 'provider-free-sea',
  );
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        main: bundlePath,
        output: blobPath,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
        execArgv: [],
        execArgvExtension: 'cli',
      },
      null,
      2,
    )}\n`,
  );
  runCommand(
    process.execPath,
    ['--no-warnings', '--experimental-sea-config', configPath],
    { cwd: seaRoot },
  );
  copyFileSync(process.execPath, injectedPath);
  chmodSync(injectedPath, 0o700);
  if (process.platform === 'darwin') {
    const removal = spawnSync(
      'codesign',
      ['--remove-signature', injectedPath],
      {
        encoding: 'utf8',
      },
    );
    if (
      removal.status !== 0 &&
      !String(removal.stderr || '').includes('code object is not signed at all')
    ) {
      throw new Error(`codesign signature removal failed: ${removal.stderr}`);
    }
  }
  await inject(injectedPath, 'NODE_SEA_BLOB', readFileSync(blobPath), {
    sentinelFuse: Buffer.from(
      'Tk9ERV9TRUFfRlVTRV9mY2U2ODBhYjJjYzQ2N2I2ZTA3MmI4YjVkZjE5OTZiMg==',
      'base64',
    ).toString(),
    ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
  });
  if (process.platform === 'darwin') {
    runCommand('codesign', ['--sign', '-', '--force', injectedPath], {
      cwd: seaRoot,
    });
  }
  return injectedPath;
}

/**
 * Prove a provider-free generated SEA is sealed against a companion appearing
 * later beside the relocated executable and fails before runtime preparation.
 * @param {object} options - Proof inputs.
 * @param {string} options.coreConsumerDirectory - Clean core-only consumer.
 * @param {string} options.installedCoreRoot - Installed core package root.
 * @param {string} options.expectedProviderMessage - Exact public diagnostic.
 * @param {string} options.root - Parent-owned temporary root.
 * @returns {Promise<number>} - Relocated executable bytes.
 */
export async function verifyRelocatedProviderFreeSea(options) {
  const seaRoot = path.join(options.root, 'provider-free-sea');
  const relocatedRoot = path.join(options.root, 'provider-free-sea-relocated');
  mkdirSync(seaRoot, { recursive: true, mode: 0o700 });
  mkdirSync(relocatedRoot, { recursive: true, mode: 0o700 });
  const mutationMarker = path.join(relocatedRoot, 'runtime-prepared');
  const fakeImportMarker = path.join(relocatedRoot, 'fake-provider-imported');
  const fakeProbeMarker = path.join(relocatedRoot, 'fake-provider-probe');
  const operatorPath = path.join(seaRoot, 'operator.js');
  const bundlePath = path.join(seaRoot, 'provider-free-entry.cjs');
  writeFileSync(
    operatorPath,
    "export default async function operatorCli() { throw new Error('operator dispatch must not run'); }\n",
  );

  const packagedEntryPath = path.join(
    options.installedCoreRoot,
    'src/core/resources/builds/packaged-app-entry.js',
  );
  const source = `
import runtimeOperatorCli from ${JSON.stringify(operatorPath)};
import { writeFileSync } from 'node:fs';
import { runPackagedApp } from ${JSON.stringify(packagedEntryPath)};
const ledgerServiceCmd = {};
(async () => {
  await runPackagedApp({
    argv: [
      'node',
      'provider-free-sea',
      'wharfie',
      'deployment',
      'inspect',
      'wdi1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '--region',
      'us-east-1',
    ],
    prepareRuntime: async () => writeFileSync(${JSON.stringify(mutationMarker)}, 'prepared'),
    runtimeModules: {
      operatorCli: runtimeOperatorCli,
      'ledger-service': ledgerServiceCmd,
    },
  });
})();
`;
  const installedWrapper = await import(
    `${pathToFileURL(path.join(options.installedCoreRoot, 'src/core/lib/esbuild.js')).href}?provider-free-sea`
  );
  const prepared = await installedWrapper.withEmbeddedAwsProvider({
    stdin: { contents: source, resolveDir: seaRoot, sourcefile: 'index.js' },
  });
  assert.match(
    prepared.stdin.contents,
    /sealWharfieAwsProviderUnavailable\(\)/u,
  );
  assert.doesNotMatch(prepared.stdin.contents, /wharfieEmbeddedAwsProvider/u);
  await build({
    ...prepared,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    target: `node${process.versions.node}`,
    logLevel: 'silent',
  });
  const injectedPath = await injectSea({ bundlePath, seaRoot });
  const relocatedPath = path.join(relocatedRoot, path.basename(injectedPath));
  copyFileSync(injectedPath, relocatedPath);
  chmodSync(relocatedPath, 0o700);

  const fakeProviderRoot = path.join(
    relocatedRoot,
    'node_modules',
    '@wharfie',
    'aws',
  );
  mkdirSync(fakeProviderRoot, { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(fakeProviderRoot, 'package.json'),
    `${JSON.stringify({
      name: '@wharfie/aws',
      version: '0.0.15',
      type: 'module',
      exports: './index.js',
    })}\n`,
  );
  writeFileSync(
    path.join(fakeProviderRoot, 'index.js'),
    [
      "import { writeFileSync } from 'node:fs';",
      'if (process.env.WHARFIE_FAKE_PROVIDER_MARKER) {',
      "  writeFileSync(process.env.WHARFIE_FAKE_PROVIDER_MARKER, 'imported');",
      '}',
      "throw new Error('fake external provider must never load');",
      '',
    ].join('\n'),
  );

  const probe = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', "await import('@wharfie/aws')"],
    {
      cwd: relocatedRoot,
      encoding: 'utf8',
      env: { WHARFIE_FAKE_PROVIDER_MARKER: fakeProbeMarker },
    },
  );
  assert.notEqual(probe.status, 0, 'fake provider probe must throw');
  assert.equal(
    existsSync(fakeProbeMarker),
    true,
    'fake provider must be discoverable beside the relocated SEA',
  );

  renameSync(
    options.coreConsumerDirectory,
    path.join(options.root, 'core-consumer-hidden'),
  );
  assert.equal(existsSync(options.coreConsumerDirectory), false);
  const result = spawnSync(relocatedPath, [], {
    cwd: relocatedRoot,
    encoding: 'utf8',
    env: {
      PATH: '',
      HOME: path.join(relocatedRoot, 'home'),
      XDG_CACHE_HOME: path.join(relocatedRoot, 'cache'),
      XDG_CONFIG_HOME: path.join(relocatedRoot, 'config'),
      XDG_DATA_HOME: path.join(relocatedRoot, 'data'),
      XDG_STATE_HOME: path.join(relocatedRoot, 'state'),
      WHARFIE_FAKE_PROVIDER_MARKER: fakeImportMarker,
    },
    timeout: 60_000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), options.expectedProviderMessage);
  assert.equal(existsSync(fakeImportMarker), false);
  assert.equal(existsSync(mutationMarker), false);
  return statSync(relocatedPath).size;
}

export default verifyRelocatedProviderFreeSea;
