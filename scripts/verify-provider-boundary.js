import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import { inject } from 'postject';

import {
  AWS_PROVIDER_EMBEDDING_POLICY,
  withEmbeddedAwsProvider,
} from '../src/core/lib/esbuild.js';
import {
  AWS_PROVIDER_CONTRACT_VERSION,
  AWS_PROVIDER_PACKAGE_VERSION,
} from '../src/core/runtime/aws-provider-module.js';
import { verifyRelocatedProviderFreeSea } from './verify-provider-free-sea.js';
import {
  createPackageTarball,
  NPM_COMMAND,
  readJson,
  REPO_ROOT,
  runCommand,
} from './package-verification.js';

const MISSING_PROVIDER_MESSAGE = `AWS deployment support is not installed. Install '@wharfie/aws@${AWS_PROVIDER_PACKAGE_VERSION}' next to '@wharfie/wharfie@${AWS_PROVIDER_PACKAGE_VERSION}' and retry.`;
const NOT_EMBEDDED_PROVIDER_MESSAGE = `AWS deployment support was not embedded. Install matching '@wharfie/aws@${AWS_PROVIDER_PACKAGE_VERSION}' beside '@wharfie/wharfie@${AWS_PROVIDER_PACKAGE_VERSION}' in the builder, rebuild the application, and retry.`;
const EMBEDDED_AUTHORITY_MESSAGE =
  'Embedded revision metadata is only available inside a packaged SEA artifact.';
const DEPENDENCY_PACKAGE_BUDGET = 170;
const INSTALLED_LOGICAL_BYTE_BUDGET = 85 * 1024 * 1024;
const CANONICAL_NPM_REGISTRY = 'https://registry.npmjs.org';
const DEPLOYMENT_INSTANCE_ID = `wdi1_${'A'.repeat(43)}`;
const PACKAGED_DEPLOYMENT_ID = 'provider-boundary';
const ENTRYPOINTS = Object.freeze({
  source: 'src/cli/entry.js',
  packaged: 'src/core/resources/builds/actor-system-cli/index.js',
});
const GENERATED_ENTRY_FIXTURE = `
import runtimeOperatorCli from './operator.js';
const ledgerServiceCmd = {};
async function runPackagedApp() {}
(async () => {
  await runPackagedApp({
    runtimeModules: {
      operatorCli: runtimeOperatorCli,
      'ledger-service': ledgerServiceCmd,
    },
  });
})();
`;

/**
 * @param {string} directory - Directory to measure.
 * @returns {number} - Logical bytes for regular files below the directory.
 */
function logicalFileBytes(directory) {
  let bytes = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      bytes += logicalFileBytes(entryPath);
    } else if (entry.isFile()) {
      bytes += statSync(entryPath).size;
    }
  }
  return bytes;
}

/**
 * @param {string} directory - Installed consumer directory.
 * @param {NodeJS.ProcessEnv} env - Isolated environment.
 * @returns {number} - Installed production dependency package directories.
 */
function dependencyPackageCount(directory, env) {
  const listed = runCommand(
    NPM_COMMAND,
    ['ls', '--omit=dev', '--all', '--parseable'],
    {
      cwd: directory,
      env,
      capture: true,
      timeoutMs: 120_000,
      killSignal: 'SIGKILL',
    },
  ).stdout;
  return Math.max(0, listed.split(/\r?\n/u).filter(Boolean).length - 1);
}

/**
 * @param {string} label - Receipt label.
 * @param {string} expectedMessage - Exact combined child output.
 * @param {string} command - Executable path.
 * @param {string[]} args - Command arguments.
 * @param {{cwd: string, env: NodeJS.ProcessEnv}} options - Child options.
 * @returns {void}
 */
function assertExactFailure(label, expectedMessage, command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  assert.equal(result.status, 1, `${label} must fail with status 1`);
  assert.equal(output, expectedMessage, `${label} failure drifted`);
}

/**
 * @returns {Promise<Record<string, number>>} - Input counts by provider-free graph.
 */
async function verifyProviderFreeGraphs() {
  /** @type {Record<string, number>} */
  const inputCounts = {};
  for (const [label, entrypoint] of Object.entries(ENTRYPOINTS)) {
    const result = await build({
      absWorkingDir: REPO_ROOT,
      entryPoints: [entrypoint],
      bundle: true,
      platform: 'node',
      format: 'esm',
      metafile: true,
      write: false,
      logLevel: 'silent',
      loader: { '.worker.js': 'text' },
      external: ['esbuild', 'node-gyp/bin/node-gyp.js', 'lmdb'],
    });
    const inputs = Object.keys(result.metafile.inputs);
    const providerInputs = inputs.filter((input) =>
      /[/\\]node_modules[/\\](?:@aws-sdk|@smithy)[/\\]/u.test(input),
    );
    assert.deepEqual(
      providerInputs,
      [],
      `${label} application graph absorbed provider SDK files`,
    );
    inputCounts[label] = inputs.length;
  }
  return inputCounts;
}

/**
 * @param {string} directory - Destination owned by the core package temp root.
 * @returns {{manifest: Record<string, any>, tarballPath: string}} - Provider tarball.
 */
function createAwsProviderTarball(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const result = runCommand(
    NPM_COMMAND,
    [
      'pack',
      '--workspace',
      '@wharfie/aws',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      directory,
    ],
    {
      cwd: REPO_ROOT,
      capture: true,
      timeoutMs: 120_000,
      killSignal: 'SIGKILL',
      env: {
        ...process.env,
        npm_config_cache: path.join(directory, 'npm-cache'),
        npm_config_ignore_scripts: 'true',
        npm_config_registry: CANONICAL_NPM_REGISTRY,
      },
    },
  );
  const manifests = JSON.parse(result.stdout);
  assert.ok(Array.isArray(manifests) && manifests.length === 1);
  const manifest =
    /** @type {{name: string, version: string, filename: string, files: {path: string}[]}} */ manifests[0];
  assert.equal(manifest.name, '@wharfie/aws');
  assert.equal(manifest.version, AWS_PROVIDER_PACKAGE_VERSION);
  const packedFilePaths = [];
  for (const file of manifest.files) packedFilePaths.push(file.path);
  assert.deepEqual(packedFilePaths.sort(), [
    'LICENSE',
    'README.md',
    'package.json',
    'src/index.js',
  ]);
  const tarballPath = path.join(directory, manifest.filename);
  assert.ok(existsSync(tarballPath), 'missing AWS companion tarball');
  return { manifest, tarballPath };
}

/**
 * Prove the same narrow generated-entry transform omits or embeds the provider
 * solely according to peer resolution beside the installed core package.
 * @param {string} installedCoreRoot - Provider-free installed core root.
 * @returns {Promise<void>}
 */
async function verifyGeneratedEntryBoundary(installedCoreRoot) {
  const embedded = await withEmbeddedAwsProvider(
    {
      stdin: { contents: GENERATED_ENTRY_FIXTURE, resolveDir: REPO_ROOT },
    },
    {
      embeddingPolicy: AWS_PROVIDER_EMBEDDING_POLICY.EMBED_IF_AVAILABLE,
    },
  );
  const embeddedContents = embedded.stdin?.contents;
  if (typeof embeddedContents !== 'string') {
    throw new TypeError('embedded provider entry must be a string');
  }
  assert.match(embeddedContents, /wharfieEmbeddedAwsProvider/u);
  assert.match(embeddedContents, /registerWharfieEmbeddedAwsProvider/u);
  assert.match(embeddedContents, /\.catch\(\(error\)/u);
  const embeddedAgain = await withEmbeddedAwsProvider(embedded, {
    embeddingPolicy: AWS_PROVIDER_EMBEDDING_POLICY.EMBED_IF_AVAILABLE,
  });
  const embeddedAgainContents = embeddedAgain.stdin?.contents;
  if (typeof embeddedAgainContents !== 'string') {
    throw new TypeError('idempotent provider entry must be a string');
  }
  assert.equal(
    embeddedAgainContents,
    embeddedContents,
    'provider entry preparation must be idempotent',
  );

  const installedWrapper = await import(
    `${pathToFileURL(path.join(installedCoreRoot, 'src/core/lib/esbuild.js')).href}?provider-free`
  );
  const providerFree = await installedWrapper.withEmbeddedAwsProvider({
    stdin: {
      contents: GENERATED_ENTRY_FIXTURE,
      resolveDir: path.dirname(installedCoreRoot),
    },
  });
  assert.doesNotMatch(
    providerFree.stdin.contents,
    /wharfieEmbeddedAwsProvider/u,
  );
  assert.match(
    providerFree.stdin.contents,
    /sealWharfieAwsProviderUnavailable\(\)/u,
  );
  assert.match(providerFree.stdin.contents, /\.catch\(\(error\)/u);
  const providerFreeAgain =
    await installedWrapper.withEmbeddedAwsProvider(providerFree);
  assert.equal(
    providerFreeAgain.stdin.contents,
    providerFree.stdin.contents,
    'provider-free entry preparation must be idempotent',
  );
}

/**
 * Resolve the installed version-matched companion through installed core, run
 * the generated-entry transform, relocate the resulting SEA, and prove its
 * embedded bindings load without node_modules.
 * @param {string} root - Owned temporary root.
 * @param {string} installedCoreRoot - Installed core package root.
 * @param {string} providerConsumerDirectory - Installed consumer hidden before SEA execution.
 * @returns {Promise<number>} - Relocated SEA byte size.
 */
async function verifyRelocatedProviderSea(
  root,
  installedCoreRoot,
  providerConsumerDirectory,
) {
  const seaRoot = path.join(root, 'provider-sea');
  const relocatedRoot = path.join(root, 'provider-sea-relocated');
  mkdirSync(seaRoot, { recursive: true, mode: 0o700 });
  mkdirSync(relocatedRoot, { recursive: true, mode: 0o700 });
  const loaderEntrypoint = path.join(
    installedCoreRoot,
    'src/core/runtime/aws-provider-module.js',
  );
  const operatorEntrypoint = path.join(seaRoot, 'operator.js');
  writeFileSync(operatorEntrypoint, 'export default null;\n');
  const bundlePath = path.join(seaRoot, 'provider-entry.cjs');
  const blobPath = path.join(seaRoot, 'provider.blob');
  const configPath = path.join(seaRoot, 'sea-config.json');
  const injectedPath = path.join(
    seaRoot,
    process.platform === 'win32' ? 'provider-sea.exe' : 'provider-sea',
  );
  const relocatedPath = path.join(relocatedRoot, path.basename(injectedPath));
  const source = [
    'import runtimeOperatorCli from ' +
      JSON.stringify(operatorEntrypoint) +
      ';',
    'import { AWS_PROVIDER_CONTRACT_VERSION, AWS_PROVIDER_PACKAGE_VERSION, loadAwsProviderBindings } from ' +
      JSON.stringify(loaderEntrypoint) +
      ';',
    'const ledgerServiceCmd = {};',
    'async function runPackagedApp() {',
    '  const loaded = await loadAwsProviderBindings();',
    '  process.stdout.write(JSON.stringify({',
    '    providerEmbedded: true,',
    '    version: AWS_PROVIDER_PACKAGE_VERSION,',
    '    contract: AWS_PROVIDER_CONTRACT_VERSION,',
    '    stsClient: typeof loaded.clientSTS.STSClient,',
    '  }));',
    '}',
    '(async () => {',
    '  await runPackagedApp({',
    '    runtimeModules: {',
    '      operatorCli: runtimeOperatorCli,',
    "      'ledger-service': ledgerServiceCmd,",
    '    },',
    '  });',
    '})();',
    '',
  ].join('\n');
  const installedWrapper = await import(
    pathToFileURL(path.join(installedCoreRoot, 'src/core/lib/esbuild.js'))
      .href + '?provider-sea'
  );
  const prepared = await installedWrapper.withEmbeddedAwsProvider(
    {
      stdin: { contents: source, resolveDir: seaRoot, sourcefile: 'index.js' },
    },
    { embeddingPolicy: 'embed-if-available' },
  );
  assert.match(prepared.stdin.contents, /registerWharfieEmbeddedAwsProvider/u);
  assert.doesNotMatch(
    prepared.stdin.contents,
    /sealWharfieAwsProviderUnavailable/u,
  );
  await build({
    ...prepared,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    target: 'node' + process.versions.node,
    logLevel: 'silent',
  });
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
  copyFileSync(injectedPath, relocatedPath);
  chmodSync(relocatedPath, 0o700);
  renameSync(
    providerConsumerDirectory,
    path.join(root, 'provider-consumer-hidden'),
  );
  assert.equal(
    existsSync(providerConsumerDirectory),
    false,
    'relocated SEA source install must be unavailable',
  );
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
    },
    timeout: 60_000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    providerEmbedded: true,
    version: AWS_PROVIDER_PACKAGE_VERSION,
    contract: AWS_PROVIDER_CONTRACT_VERSION,
    stsClient: 'function',
  });
  return statSync(relocatedPath).size;
}

const graphInputCounts = await verifyProviderFreeGraphs();
const packaged = createPackageTarball();

try {
  const providerPackage = createAwsProviderTarball(
    path.join(packaged.directory, 'provider-package'),
  );
  const consumerDirectory = path.join(packaged.directory, 'clean-consumer');
  const providerConsumerDirectory = path.join(
    packaged.directory,
    'provider-consumer',
  );
  const runtimeDirectory = path.join(packaged.directory, 'runtime-state');
  /** @type {NodeJS.ProcessEnv} */
  const runtimeEnvironment = {
    ...process.env,
    HOME: path.join(runtimeDirectory, 'home'),
    XDG_CACHE_HOME: path.join(runtimeDirectory, 'cache'),
    XDG_CONFIG_HOME: path.join(runtimeDirectory, 'config'),
    XDG_DATA_HOME: path.join(runtimeDirectory, 'data'),
    XDG_STATE_HOME: path.join(runtimeDirectory, 'state'),
    npm_config_cache: path.join(packaged.directory, 'npm-cache'),
    npm_config_ignore_scripts: 'true',
    npm_config_registry: CANONICAL_NPM_REGISTRY,
  };
  delete runtimeEnvironment.CONFIG_DIR;

  for (const [directory, name] of [
    [consumerDirectory, 'wharfie-provider-boundary-receipt'],
    [providerConsumerDirectory, 'wharfie-provider-enabled-receipt'],
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(
      path.join(directory, 'package.json'),
      `${JSON.stringify(
        { name, version: '0.0.0', private: true, type: 'module' },
        null,
        2,
      )}\n`,
    );
  }

  runCommand(
    NPM_COMMAND,
    [
      'install',
      '--ignore-scripts',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      `--registry=${CANONICAL_NPM_REGISTRY}`,
      packaged.tarballPath,
    ],
    {
      cwd: consumerDirectory,
      env: runtimeEnvironment,
      timeoutMs: 240_000,
      killSignal: 'SIGKILL',
    },
  );
  const nodeModules = path.join(consumerDirectory, 'node_modules');
  assert.equal(existsSync(path.join(nodeModules, '@aws-sdk')), false);
  assert.equal(existsSync(path.join(nodeModules, '@smithy')), false);
  const dependencyPackages = dependencyPackageCount(
    consumerDirectory,
    runtimeEnvironment,
  );
  assert.ok(dependencyPackages <= DEPENDENCY_PACKAGE_BUDGET);
  const installedLogicalBytes = logicalFileBytes(nodeModules);
  assert.ok(
    installedLogicalBytes <= INSTALLED_LOGICAL_BYTE_BUDGET,
    'canonical core logical bytes ' +
      installedLogicalBytes +
      ' exceed ' +
      INSTALLED_LOGICAL_BYTE_BUDGET,
  );

  const installedRoot = path.join(nodeModules, '@wharfie', 'wharfie');
  assertExactFailure(
    'source CLI',
    MISSING_PROVIDER_MESSAGE,
    process.execPath,
    [
      path.join(installedRoot, 'bin', 'wharfie'),
      'deployment',
      'inspect',
      DEPLOYMENT_INSTANCE_ID,
      '--region',
      'us-east-1',
    ],
    { cwd: consumerDirectory, env: runtimeEnvironment },
  );
  assert.equal(existsSync(runtimeDirectory), false);

  const packagedEntrypoint = pathToFileURL(
    path.join(
      installedRoot,
      'src/core/resources/builds/actor-system-cli/index.js',
    ),
  ).href;
  /**
   * @param {'aws'|'hetzner'} provider - Explicit packaged provider.
   * @param {string[]} placement - Provider-specific placement arguments.
   * @returns {string} - Isolated packaged command probe.
   */
  const createPackagedProbe = (provider, placement) =>
    [
      `import entrypoint from ${JSON.stringify(packagedEntrypoint)};`,
      'try {',
      `  await entrypoint(${JSON.stringify([
        'node',
        'wharfie',
        'deployment',
        'preview',
        '--deployment',
        PACKAGED_DEPLOYMENT_ID,
        '--provider',
        provider,
        ...placement,
        '--allow-ssh-from',
        '198.51.100.9/32',
      ])});`,
      '} catch (error) {',
      '  console.error(error instanceof Error ? error.message : String(error));',
      '  process.exitCode = 1;',
      '}',
    ].join('\n');
  assertExactFailure(
    'packaged AWS command',
    MISSING_PROVIDER_MESSAGE,
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      createPackagedProbe('aws', ['--region', 'us-east-1']),
    ],
    { cwd: consumerDirectory, env: runtimeEnvironment },
  );
  assert.equal(existsSync(runtimeDirectory), false);
  assertExactFailure(
    'packaged Hetzner command',
    EMBEDDED_AUTHORITY_MESSAGE,
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      createPackagedProbe('hetzner', ['--location', 'ash']),
    ],
    { cwd: consumerDirectory, env: runtimeEnvironment },
  );
  assert.equal(existsSync(runtimeDirectory), false);
  await verifyGeneratedEntryBoundary(installedRoot);
  const relocatedProviderFreeSeaBytes = await verifyRelocatedProviderFreeSea({
    coreConsumerDirectory: consumerDirectory,
    installedCoreRoot: installedRoot,
    expectedProviderMessage: NOT_EMBEDDED_PROVIDER_MESSAGE,
    root: packaged.directory,
  });

  const providerEnvironment = {
    ...runtimeEnvironment,
    npm_config_cache: path.join(packaged.directory, 'provider-npm-cache'),
  };
  runCommand(
    NPM_COMMAND,
    [
      'install',
      '--ignore-scripts',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      `--registry=${CANONICAL_NPM_REGISTRY}`,
      packaged.tarballPath,
      providerPackage.tarballPath,
    ],
    {
      cwd: providerConsumerDirectory,
      env: providerEnvironment,
      timeoutMs: 240_000,
      killSignal: 'SIGKILL',
    },
  );
  const providerNodeModules = path.join(
    providerConsumerDirectory,
    'node_modules',
  );
  const installedProviderRoot = path.join(
    providerNodeModules,
    '@wharfie',
    'aws',
  );
  const installedProviderCoreRoot = path.join(
    providerNodeModules,
    '@wharfie',
    'wharfie',
  );
  const coreMetadata = readJson(
    path.join(installedProviderCoreRoot, 'package.json'),
  );
  const providerMetadata = readJson(
    path.join(installedProviderRoot, 'package.json'),
  );
  assert.equal(
    coreMetadata.peerDependencies['@wharfie/aws'],
    coreMetadata.version,
  );
  assert.equal(
    providerMetadata.peerDependencies['@wharfie/wharfie'],
    providerMetadata.version,
  );
  assert.equal(providerMetadata.private, false);
  assert.equal(providerMetadata.publishConfig.access, 'public');
  assert.equal(providerMetadata.engines.node, coreMetadata.engines.node);
  assert.ok(
    Object.values(providerMetadata.dependencies).every(
      (specifier) =>
        typeof specifier === 'string' &&
        /^\d+\.\d+\.\d+/u.test(specifier) &&
        !/[<>=~^*xX| ]/u.test(specifier),
    ),
    'AWS companion dependency specs must be exact versions',
  );
  assert.ok(existsSync(path.join(installedProviderRoot, 'LICENSE')));
  assert.ok(existsSync(path.join(installedProviderRoot, 'README.md')));

  const installedProviderBuildWrapper = await import(
    pathToFileURL(
      path.join(installedProviderCoreRoot, 'src/core/lib/esbuild.js'),
    ).href + '?provider-enabled'
  );
  const installedProviderEntry =
    await installedProviderBuildWrapper.withEmbeddedAwsProvider(
      {
        stdin: {
          contents: GENERATED_ENTRY_FIXTURE,
          resolveDir: providerConsumerDirectory,
        },
      },
      { embeddingPolicy: 'embed-if-available' },
    );
  assert.match(
    installedProviderEntry.stdin.contents,
    /registerWharfieEmbeddedAwsProvider/u,
  );
  assert.doesNotMatch(
    installedProviderEntry.stdin.contents,
    /sealWharfieAwsProviderUnavailable/u,
  );

  const providerLoader = pathToFileURL(
    path.join(
      installedProviderCoreRoot,
      'src/core/runtime/aws-provider-module.js',
    ),
  ).href;
  const providerProbe = [
    `import * as provider from '@wharfie/aws';`,
    `import * as boundary from ${JSON.stringify(providerLoader)};`,
    'const validated = boundary.validateAwsProviderModule(provider);',
    'const loaded = await boundary.loadAwsProviderBindings();',
    "if (validated !== loaded) throw new Error('provider identity drifted');",
    'process.stdout.write(JSON.stringify({',
    '  version: provider.WHARFIE_AWS_PROVIDER_PACKAGE_VERSION,',
    '  contract: provider.WHARFIE_AWS_PROVIDER_CONTRACT_VERSION,',
    '  stsClient: typeof loaded.clientSTS.STSClient,',
    '}));',
  ].join('\n');
  const providerResult = runCommand(
    process.execPath,
    ['--input-type=module', '--eval', providerProbe],
    {
      cwd: providerConsumerDirectory,
      env: providerEnvironment,
      capture: true,
    },
  );
  assert.deepEqual(JSON.parse(providerResult.stdout), {
    version: AWS_PROVIDER_PACKAGE_VERSION,
    contract: AWS_PROVIDER_CONTRACT_VERSION,
    stsClient: 'function',
  });
  const providerDependencyPackages = dependencyPackageCount(
    providerConsumerDirectory,
    providerEnvironment,
  );
  const providerInstalledLogicalBytes = logicalFileBytes(providerNodeModules);
  const relocatedProviderSeaBytes = await verifyRelocatedProviderSea(
    packaged.directory,
    installedProviderCoreRoot,
    providerConsumerDirectory,
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        providerBoundary: 'ok',
        dependencyPackages,
        dependencyPackageBudget: DEPENDENCY_PACKAGE_BUDGET,
        installedLogicalBytes,
        installedLogicalByteBudget: INSTALLED_LOGICAL_BYTE_BUDGET,
        providerDependencyPackages,
        providerInstalledLogicalBytes,
        removedDependencyPackages:
          providerDependencyPackages - dependencyPackages,
        removedInstalledLogicalBytes:
          providerInstalledLogicalBytes - installedLogicalBytes,
        companionTarball: providerPackage.manifest.filename,
        companionVersion: providerPackage.manifest.version,
        graphInputCounts,
        providerSdkGraphInputs: 0,
        relocatedProviderFreeSeaBytes,
        relocatedProviderSeaBytes,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  packaged.cleanup();
}
