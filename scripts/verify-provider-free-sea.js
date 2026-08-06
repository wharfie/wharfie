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

import { AWS_PROVIDER_PACKAGE_VERSION } from '../src/core/runtime/aws-provider-module.js';
import { runCommand } from './package-verification.js';

const HETZNER_AUTHORITY_SENTINEL =
  'Provider-free SEA reached embedded deployment authority.';

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
 * later beside the relocated executable. Its current AWS route fails before
 * embedded authority or provider I/O while its Hetzner route remains admitted.
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
  const fakeAwsImportMarker = path.join(
    relocatedRoot,
    'fake-provider-imported-aws',
  );
  const fakeHetznerImportMarker = path.join(
    relocatedRoot,
    'fake-provider-imported-hetzner',
  );
  const fakeProbeMarker = path.join(relocatedRoot, 'fake-provider-probe');
  const operatorPath = path.join(seaRoot, 'operator.js');
  const bundlePath = path.join(seaRoot, 'provider-free-entry.cjs');
  const deploymentCommandPath = path.join(
    options.installedCoreRoot,
    'src/core/resources/builds/actor-system-cli/control_cmds/deployment.js',
  );
  writeFileSync(
    operatorPath,
    [
      `import { createPackagedDeploymentCommand } from ${JSON.stringify(deploymentCommandPath)};`,
      'export default async function operatorCli(argv) {',
      '  const command = createPackagedDeploymentCommand({',
      '    readRevisionRuntimePair: async () => {',
      `      throw new Error(${JSON.stringify(HETZNER_AUTHORITY_SENTINEL)});`,
      '    },',
      '  });',
      "  if (argv[2] !== 'deployment') throw new Error('deployment namespace was not preserved');",
      '  await command.parseAsync([argv[0], argv[1], ...argv.slice(3)]);',
      '}',
      '',
    ].join('\n'),
  );

  const packagedEntryPath = path.join(
    options.installedCoreRoot,
    'src/core/resources/builds/packaged-app-entry.js',
  );
  const source = `
import runtimeOperatorCli from ${JSON.stringify(operatorPath)};
import { runPackagedApp } from ${JSON.stringify(packagedEntryPath)};
const ledgerServiceCmd = {};
(async () => {
  const provider = process.env.WHARFIE_PROVIDER_PROBE === 'hetzner'
    ? 'hetzner'
    : 'aws';
  const placement = provider === 'aws'
    ? ['--region', 'us-east-1']
    : ['--location', 'ash'];
  await runPackagedApp({
    argv: [
      'node',
      'provider-free-sea',
      'wharfie',
      'deployment',
      'preview',
      '--deployment',
      'provider-boundary',
      '--provider',
      provider,
      ...placement,
      '--allow-ssh-from',
      '198.51.100.9/32',
    ],
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
      version: AWS_PROVIDER_PACKAGE_VERSION,
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
  const commonEnvironment = {
    PATH: '',
    HOME: path.join(relocatedRoot, 'home'),
    XDG_CACHE_HOME: path.join(relocatedRoot, 'cache'),
    XDG_CONFIG_HOME: path.join(relocatedRoot, 'config'),
    XDG_DATA_HOME: path.join(relocatedRoot, 'data'),
    XDG_STATE_HOME: path.join(relocatedRoot, 'state'),
  };
  const awsResult = spawnSync(relocatedPath, [], {
    cwd: relocatedRoot,
    encoding: 'utf8',
    env: {
      ...commonEnvironment,
      WHARFIE_PROVIDER_PROBE: 'aws',
      WHARFIE_FAKE_PROVIDER_MARKER: fakeAwsImportMarker,
    },
    timeout: 60_000,
  });
  if (awsResult.error) throw awsResult.error;
  assert.equal(awsResult.status, 1);
  assert.equal(awsResult.stdout, '');
  assert.equal(awsResult.stderr.trim(), options.expectedProviderMessage);
  assert.equal(existsSync(fakeAwsImportMarker), false);

  const hetznerResult = spawnSync(relocatedPath, [], {
    cwd: relocatedRoot,
    encoding: 'utf8',
    env: {
      ...commonEnvironment,
      WHARFIE_PROVIDER_PROBE: 'hetzner',
      WHARFIE_FAKE_PROVIDER_MARKER: fakeHetznerImportMarker,
    },
    timeout: 60_000,
  });
  if (hetznerResult.error) throw hetznerResult.error;
  assert.equal(hetznerResult.status, 1);
  assert.equal(hetznerResult.stdout, '');
  assert.equal(hetznerResult.stderr.trim(), HETZNER_AUTHORITY_SENTINEL);
  assert.equal(existsSync(fakeHetznerImportMarker), false);
  return statSync(relocatedPath).size;
}

export default verifyRelocatedProviderFreeSea;
