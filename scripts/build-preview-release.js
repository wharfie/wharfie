/* eslint-disable jsdoc/require-jsdoc */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants as fsConstants,
  createReadStream,
  existsSync,
  promises as fsp,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import {
  createPackageTarball,
  NPM_COMMAND,
  readJson,
  REPO_ROOT,
  runCommand,
} from './package-verification.js';

export const PREVIEW_TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});
const CANONICAL_NPM_REGISTRY = 'https://registry.npmjs.org';
const FORBIDDEN_RELEASE_LIFECYCLE_SCRIPTS = Object.freeze([
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'prepare',
  'postpack',
  'publish',
  'postpublish',
]);

/**
 * @typedef AwsCompanionTarball
 * @property {string} directory - Owned packaging directory.
 * @property {Record<string, any>} manifest - npm pack manifest.
 * @property {string} tarballPath - Exact companion tarball.
 * @property {() => Promise<void>} cleanup - Owned cleanup operation.
 */

/**
 * @typedef PreviewReleaseOptions
 * @property {boolean} [check] - Validate the release contract without building a SEA.
 * @property {string} [tag] - Exact version tag.
 * @property {string} [outputDir] - New output directory.
 */

/**
 * @param {any} value - JSON value.
 * @returns {any} Canonically ordered JSON value.
 */
function sortJson(value) {
  if (Array.isArray(value)) return value.map((item) => sortJson(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}

/**
 * @param {any} value - Release manifest.
 * @returns {string} Canonical JSON text.
 */
export function stringifyPreviewReleaseManifest(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

/**
 * @param {Array<{fileName: string, sha256: string}>} entries - File digests.
 * @returns {string} sha256sum-compatible text.
 */
export function formatSha256Sums(entries) {
  return `${[...entries]
    .sort((left, right) => left.fileName.localeCompare(right.fileName))
    .map((entry) => `${entry.sha256}  ${entry.fileName}`)
    .join('\n')}\n`;
}

/**
 * @param {string[]} argv - Command arguments.
 * @returns {PreviewReleaseOptions} Parsed options.
 */
export function parsePreviewReleaseArgs(argv) {
  /** @type {PreviewReleaseOptions} */
  const options = { check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') {
      options.check = true;
      continue;
    }
    if (argument === '--tag' || argument === '--output-dir') {
      const value = argv[index + 1];
      if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${argument} requires a value.`);
      }
      options[argument === '--tag' ? 'tag' : 'outputDir'] = value;
      index += 1;
      continue;
    }
    throw new TypeError(`Unknown preview release option: ${argument}`);
  }
  return options;
}

/**
 * @param {Record<string, any>} packageMetadata - npm package metadata.
 * @param {Record<string, any>} appManifest - Self-host app manifest.
 * @returns {{version: string, tag: string}} Exact release identity.
 */
export function assertPreviewReleaseMetadata(packageMetadata, appManifest) {
  assert.equal(packageMetadata.name, '@wharfie/wharfie');
  assert.match(packageMetadata.version, /^\d+\.\d+\.\d+$/u);
  assert.equal(packageMetadata.private, false);
  assert.equal(packageMetadata.license, 'Apache-2.0');
  assert.deepEqual(packageMetadata.repository, {
    type: 'git',
    url: 'git+https://github.com/wharfie/wharfie.git',
  });
  assert.equal(packageMetadata.engines?.node, '>=24.13.1 <25');
  assert.equal(
    packageMetadata.devEngines?.runtime?.version,
    PREVIEW_TARGET.nodeVersion,
  );
  assert.equal(packageMetadata.packageManager, 'npm@11.12.0');
  assert.deepEqual(packageMetadata.publishConfig, {
    access: 'public',
    tag: 'preview-candidate',
    provenance: true,
  });
  assert.equal(
    packageMetadata.peerDependencies?.['@wharfie/aws'],
    packageMetadata.version,
  );
  assert.deepEqual(packageMetadata.peerDependenciesMeta?.['@wharfie/aws'], {
    optional: true,
  });
  assertNoReleaseLifecycleScripts(packageMetadata, '@wharfie/wharfie');
  assert.equal(appManifest?.app?.id, 'wharfie');
  assert.deepEqual(appManifest?.cli?.entrypoint, {
    kind: 'node',
    path: './src/cli/entry.js',
    export: 'main',
  });
  assert.deepEqual(appManifest?.targets, [PREVIEW_TARGET]);
  return Object.freeze({
    version: packageMetadata.version,
    tag: `v${packageMetadata.version}`,
  });
}

/**
 * @param {string | undefined} tag - Candidate tag.
 * @param {string} version - Package version.
 * @returns {string} Validated tag.
 */
export function assertPreviewReleaseTag(tag, version) {
  const expected = `v${version}`;
  if (tag !== expected) {
    throw new TypeError(
      `Preview release tag must be exactly ${expected}; received ${String(tag)}.`,
    );
  }
  return expected;
}

/**
 * @param {string} filePath - File to hash.
 * @param {string} fileName - Release-relative name.
 * @param {Record<string, any>} [extra] - Artifact metadata.
 * @returns {Promise<{fileName: string, size: number, sha256: string} & Record<string, any>>} Artifact description.
 */
async function describeFile(filePath, fileName, extra = {}) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  const stats = await fsp.stat(filePath);
  return {
    ...extra,
    fileName,
    size: stats.size,
    sha256: hash.digest('hex'),
  };
}

async function loadReleaseContract() {
  const packageMetadata = readJson(path.join(REPO_ROOT, 'package.json'));
  const appModule = await import(
    `${pathToFileURL(path.join(REPO_ROOT, 'wharfie.app.js')).href}?preview-contract=${Date.now()}`
  );
  return {
    packageMetadata,
    appManifest: appModule.default,
    release: assertPreviewReleaseMetadata(packageMetadata, appModule.default),
  };
}

/**
 * Reject package-controlled code execution in clean release handoffs.
 * @param {Record<string, any>} metadata - Package metadata.
 * @param {string} label - Diagnostic label.
 * @returns {void}
 */
function assertNoReleaseLifecycleScripts(metadata, label) {
  for (const scriptName of FORBIDDEN_RELEASE_LIFECYCLE_SCRIPTS) {
    assert.equal(
      metadata.scripts?.[scriptName],
      undefined,
      `${label} must not define the ${scriptName} lifecycle script.`,
    );
  }
}

/**
 * @param {{manifest: Record<string, any>}} packaged - Packed package.
 * @param {string} version - Expected package version.
 * @returns {void}
 */
function assertPackedRelease(packaged, version) {
  assert.equal(packaged.manifest.name, '@wharfie/wharfie');
  assert.equal(packaged.manifest.version, version);
  assert.equal(typeof packaged.manifest.integrity, 'string');
  assert.match(packaged.manifest.integrity, /^sha512-/u);
  assert.equal(typeof packaged.manifest.shasum, 'string');
  assert.match(packaged.manifest.shasum, /^[a-f0-9]{40}$/u);
}

/**
 * Pack the required AWS workspace for GitHub-release handoff only.
 * @param {string} version - Exact core release version.
 * @returns {Promise<AwsCompanionTarball>} Exact companion package.
 */
export async function createAwsCompanionTarball(version) {
  const packageRoot = path.join(REPO_ROOT, 'packages', 'aws');
  const metadataPath = path.join(packageRoot, 'package.json');
  assert.equal(
    existsSync(metadataPath),
    true,
    'The preview release requires the integrated @wharfie/aws workspace.',
  );

  const metadata = readJson(metadataPath);
  assert.equal(metadata.name, '@wharfie/aws');
  assert.equal(metadata.version, version);
  assert.equal(metadata.private, false);
  assert.equal(metadata.license, 'Apache-2.0');
  assert.deepEqual(metadata.repository, {
    type: 'git',
    url: 'git+https://github.com/wharfie/wharfie.git',
    directory: 'packages/aws',
  });
  assert.equal(metadata.peerDependencies?.['@wharfie/wharfie'], version);
  assert.deepEqual(metadata.peerDependenciesMeta?.['@wharfie/wharfie'], {
    optional: true,
  });
  assert.deepEqual(metadata.publishConfig, { access: 'public' });
  assert.equal(metadata.engines?.node, '>=24.13.1 <25');
  assertNoReleaseLifecycleScripts(metadata, '@wharfie/aws');

  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-aws-companion-'),
  );
  try {
    const { stdout } = runCommand(
      NPM_COMMAND,
      ['pack', '--json', '--ignore-scripts', '--pack-destination', directory],
      {
        cwd: packageRoot,
        capture: true,
        timeoutMs: 120_000,
        killSignal: 'SIGKILL',
        env: {
          ...process.env,
          npm_config_cache: path.join(directory, 'npm-cache'),
        },
      },
    );
    const results = JSON.parse(stdout);
    assert.equal(Array.isArray(results), true);
    assert.equal(results.length, 1);
    const manifest = results[0];
    assert.equal(manifest.name, '@wharfie/aws');
    assert.equal(manifest.version, version);
    assert.match(manifest.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u);
    assert.match(manifest.shasum, /^[a-f0-9]{40}$/u);
    const packedFiles = new Set(
      /** @type {Array<{path?: string}>} */ (manifest.files || []).map(
        (entry) => entry.path,
      ),
    );
    for (const requiredFile of [
      'LICENSE',
      'README.md',
      'package.json',
      'src/index.js',
    ]) {
      assert.equal(
        packedFiles.has(requiredFile),
        true,
        `@wharfie/aws tarball is missing ${requiredFile}`,
      );
    }
    const tarballPath = path.join(directory, manifest.filename);
    assert.equal(existsSync(tarballPath), true);
    return {
      directory,
      manifest,
      tarballPath,
      cleanup: async () =>
        await fsp.rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await fsp.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/**
 * @param {{tarballPath: string, manifest: Record<string, any>}} packaged - Packed package.
 * @param {string} version - Expected installed CLI version.
 * @param {string} workspace - Owned verification workspace.
 * @returns {Promise<{consumerRoot: string, installedRoot: string, lockPath: string, selfPackageModule: Record<string, any>}>} Clean installed package.
 */
async function installAndVerifyPackedWharfie(packaged, version, workspace) {
  const consumerRoot = path.join(workspace, 'consumer');
  const consumerCache = path.join(workspace, 'npm-cache');
  await fsp.mkdir(consumerRoot, { recursive: true });
  await fsp.writeFile(
    path.join(consumerRoot, 'package.json'),
    `${JSON.stringify({ name: 'wharfie-preview-release-builder', private: true })}\n`,
    { flag: 'wx' },
  );
  runCommand(
    NPM_COMMAND,
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      `--registry=${CANONICAL_NPM_REGISTRY}`,
      packaged.tarballPath,
    ],
    {
      cwd: consumerRoot,
      timeoutMs: 240_000,
      killSignal: 'SIGKILL',
      env: {
        ...process.env,
        npm_config_cache: consumerCache,
        npm_config_registry: CANONICAL_NPM_REGISTRY,
      },
    },
  );

  const installedRoot = path.join(
    consumerRoot,
    'node_modules',
    '@wharfie',
    'wharfie',
  );
  const lockPath = path.join(consumerRoot, 'package-lock.json');
  const installedBin = path.join(installedRoot, 'bin', 'wharfie');
  assert.match(
    runCliSmoke(process.execPath, [installedBin, '--help'], process.env),
    /CLI tool for Wharfie/u,
  );
  assert.equal(
    runCliSmoke(
      process.execPath,
      [installedBin, '--version'],
      process.env,
    ).trim(),
    version,
  );

  const selfPackageModule = await import(
    pathToFileURL(
      path.join(
        installedRoot,
        'src',
        'cli',
        'app',
        'installed-wharfie-self-package.js',
      ),
    ).href
  );
  await selfPackageModule.validateInstalledWharfieSelfHost(
    installedRoot,
    lockPath,
    {
      version,
      integrity: packaged.manifest.integrity,
      tarballPath: packaged.tarballPath,
    },
  );
  return { consumerRoot, installedRoot, lockPath, selfPackageModule };
}

/** @returns {Promise<{version: string, tag: string, tarball: string, companionTarball: string}>} Dry-run result. */
export async function verifyPreviewRelease() {
  const contract = await loadReleaseContract();
  const packaged = createPackageTarball();
  /** @type {AwsCompanionTarball | null} */
  let companion = null;
  const workspace = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-preview-release-check-'),
  );
  try {
    assertPackedRelease(packaged, contract.release.version);
    companion = await createAwsCompanionTarball(contract.release.version);
    await installAndVerifyPackedWharfie(
      packaged,
      contract.release.version,
      workspace,
    );
    return {
      version: contract.release.version,
      tag: contract.release.tag,
      tarball: packaged.manifest.filename,
      companionTarball: companion.manifest.filename,
    };
  } finally {
    packaged.cleanup();
    await companion?.cleanup();
    await fsp.rm(workspace, { recursive: true, force: true });
  }
}

function resolveSourceCommit() {
  const actionCommit = process.env.GITHUB_SHA;
  if (
    typeof actionCommit === 'string' &&
    /^[a-f0-9]{40}$/u.test(actionCommit)
  ) {
    return actionCommit;
  }
  const { stdout } = runCommand('git', ['rev-parse', 'HEAD'], {
    cwd: REPO_ROOT,
    capture: true,
  });
  const commit = stdout.trim();
  assert.match(commit, /^[a-f0-9]{40}$/u);
  return commit;
}

/**
 * @param {string} outputDir - Requested output.
 * @returns {Promise<string>} Resolved absent output.
 */
async function assertOutputAbsent(outputDir) {
  const resolved = path.resolve(outputDir);
  if (resolved === REPO_ROOT) {
    throw new TypeError(
      'Preview release output cannot be the repository root.',
    );
  }
  if (existsSync(resolved)) {
    throw new Error(`Preview release output already exists: ${resolved}`);
  }
  await fsp.mkdir(path.dirname(resolved), { recursive: true });
  return resolved;
}

/**
 * @param {string} command - Executable.
 * @param {string[]} args - Arguments.
 * @param {NodeJS.ProcessEnv} environment - Isolated environment.
 * @param {string} [cwd] - Isolated working directory.
 * @returns {string} Combined output.
 */
function runCliSmoke(command, args, environment, cwd) {
  const result = runCommand(command, args, {
    capture: true,
    env: environment,
    timeoutMs: 60_000,
    killSignal: 'SIGKILL',
    ...(typeof cwd === 'string' ? { cwd } : {}),
  });
  return `${result.stdout}${result.stderr}`;
}

/**
 * Prove the downloadable release CLI was sealed without AWS capability.
 * @param {string} artifactPath - Relocated release executable.
 * @param {NodeJS.ProcessEnv} environment - Source-hidden runtime environment.
 * @param {string} cwd - Source-hidden working directory.
 * @param {string} version - Exact core/companion version.
 * @param {string} stateRoot - Probe home/config root that must remain absent.
 * @returns {void}
 */
function assertProviderFreeReleaseCli(
  artifactPath,
  environment,
  cwd,
  version,
  stateRoot,
) {
  const result = spawnSync(
    artifactPath,
    [
      'deployment',
      'inspect',
      `wdi1_${'A'.repeat(43)}`,
      '--region',
      'us-east-1',
    ],
    {
      cwd,
      encoding: 'utf8',
      env: environment,
      killSignal: 'SIGKILL',
      timeout: 60_000,
    },
  );
  if (result.error) throw result.error;
  const expected = `AWS deployment support was not embedded. Install matching '@wharfie/aws@${version}' beside '@wharfie/wharfie@${version}' in the builder, rebuild the application, and retry.`;
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  assert.equal(result.status, 1, 'AWS release probe must fail with status 1.');
  assert.equal(
    output,
    expected,
    'The standalone release CLI did not expose the sealed provider-free error.',
  );
  assert.equal(
    existsSync(stateRoot),
    false,
    'The AWS release probe created deployment state before provider gating.',
  );
}

/**
 * @param {PreviewReleaseOptions} [options] - Release build options.
 * @returns {Promise<{outputDir: string, version: string, tag: string, artifacts: Record<string, any>[]}>} Built artifact set.
 */
export async function buildPreviewRelease(options = {}) {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('Preview SEA release builds require Linux x64.');
  }

  const contract = await loadReleaseContract();
  assert.equal(
    process.versions.node,
    PREVIEW_TARGET.nodeVersion,
    `Preview SEA release builds require Node ${PREVIEW_TARGET.nodeVersion}.`,
  );
  const tag = assertPreviewReleaseTag(options.tag, contract.release.version);
  const outputDir = await assertOutputAbsent(
    options.outputDir || path.join(REPO_ROOT, 'dist', 'preview-release'),
  );
  const sourceCommit = resolveSourceCommit();
  const workspace = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-preview-release-'),
  );
  const stageRoot = await fsp.mkdtemp(
    path.join(path.dirname(outputDir), '.wharfie-preview-release-'),
  );
  const releaseStage = path.join(stageRoot, 'payload');
  const packageOutput = path.join(workspace, 'package-output');
  const isolatedHome = path.join(workspace, 'isolated-home');
  const emptyPath = path.join(workspace, 'empty-path');
  const packaged = createPackageTarball();
  /** @type {AwsCompanionTarball | null} */
  let companion = null;

  try {
    assertPackedRelease(packaged, contract.release.version);
    companion = await createAwsCompanionTarball(contract.release.version);
    await Promise.all(
      [releaseStage, isolatedHome, emptyPath].map((directory) =>
        fsp.mkdir(directory, { recursive: true }),
      ),
    );
    const installed = await installAndVerifyPackedWharfie(
      packaged,
      contract.release.version,
      workspace,
    );
    const packagedApplication =
      await installed.selfPackageModule.packageInstalledWharfieCli({
        dir: installed.installedRoot,
        dependencyLockPath: installed.lockPath,
        expectedRelease: {
          version: contract.release.version,
          integrity: packaged.manifest.integrity,
          tarballPath: packaged.tarballPath,
        },
        outputDir: packageOutput,
        targetFilters: ['node24.13.1-linux-x64-glibc'],
      });
    assert.equal(packagedApplication.artifacts.length, 1);
    const [artifact] = packagedApplication.artifacts;
    assert.deepEqual(artifact.target, PREVIEW_TARGET);

    const binaryName = `wharfie-${tag}-linux-x64`;
    const recordName = `${binaryName}.artifact.json`;
    const tarballName = packaged.manifest.filename;
    const companionName = companion.manifest.filename;
    const binaryPath = path.join(releaseStage, binaryName);
    const recordPath = path.join(releaseStage, recordName);
    const tarballPath = path.join(releaseStage, tarballName);
    const companionPath = path.join(releaseStage, companionName);
    const copyOperations = [
      fsp.copyFile(artifact.path, binaryPath, fsConstants.COPYFILE_EXCL),
      fsp.copyFile(artifact.recordPath, recordPath, fsConstants.COPYFILE_EXCL),
      fsp.copyFile(
        packaged.tarballPath,
        tarballPath,
        fsConstants.COPYFILE_EXCL,
      ),
    ];
    copyOperations.push(
      fsp.copyFile(
        companion.tarballPath,
        companionPath,
        fsConstants.COPYFILE_EXCL,
      ),
    );
    await Promise.all(copyOperations);
    await fsp.chmod(binaryPath, 0o755);

    const hiddenConsumerRoot = path.join(workspace, 'consumer-hidden');
    await fsp.rename(installed.consumerRoot, hiddenConsumerRoot);
    assert.equal(
      existsSync(installed.consumerRoot),
      false,
      'The clean installed consumer must be unavailable before SEA smoke tests.',
    );

    const isolatedEnvironment = {
      HOME: isolatedHome,
      PATH: emptyPath,
      TMPDIR: path.join(workspace, 'runtime-tmp'),
      XDG_CACHE_HOME: path.join(isolatedHome, '.cache'),
      XDG_CONFIG_HOME: path.join(isolatedHome, '.config'),
      XDG_DATA_HOME: path.join(isolatedHome, '.local', 'share'),
    };
    await fsp.mkdir(isolatedEnvironment.TMPDIR, { recursive: true });
    assert.match(
      runCliSmoke(binaryPath, ['--help'], isolatedEnvironment, isolatedHome),
      /CLI tool for Wharfie/u,
    );
    assert.equal(
      runCliSmoke(
        binaryPath,
        ['--version'],
        isolatedEnvironment,
        isolatedHome,
      ).trim(),
      contract.release.version,
    );
    const providerProbeHome = path.join(workspace, 'provider-probe-home');
    assertProviderFreeReleaseCli(
      binaryPath,
      {
        ...isolatedEnvironment,
        HOME: providerProbeHome,
        XDG_CACHE_HOME: path.join(providerProbeHome, '.cache'),
        XDG_CONFIG_HOME: path.join(providerProbeHome, '.config'),
        XDG_DATA_HOME: path.join(providerProbeHome, '.local', 'share'),
      },
      isolatedHome,
      contract.release.version,
      providerProbeHome,
    );

    const artifactDescriptions = [
      describeFile(tarballPath, tarballName, {
        kind: 'npm-package',
        package: '@wharfie/wharfie',
        version: contract.release.version,
        integrity: packaged.manifest.integrity,
        npmShasum: packaged.manifest.shasum,
        publication: 'npm-preview',
      }),
      describeFile(binaryPath, binaryName, {
        kind: 'standalone-cli',
        target: PREVIEW_TARGET,
        artifactId: artifact.artifactId,
        revisionId: artifact.revisionId,
      }),
      describeFile(recordPath, recordName, {
        kind: 'artifact-record',
        artifactId: artifact.artifactId,
      }),
    ];
    artifactDescriptions.push(
      describeFile(companionPath, companionName, {
        kind: 'npm-companion-package',
        package: '@wharfie/aws',
        version: contract.release.version,
        integrity: companion.manifest.integrity,
        npmShasum: companion.manifest.shasum,
        publication: 'github-release-only',
      }),
    );
    const artifacts = await Promise.all(artifactDescriptions);
    const releaseManifest = {
      schemaVersion: 1,
      kind: 'wharfie.preview-release',
      package: '@wharfie/wharfie',
      version: contract.release.version,
      tag,
      source: {
        repository: 'https://github.com/wharfie/wharfie',
        commit: sourceCommit,
      },
      artifacts,
    };
    const manifestName = 'preview-release.json';
    const manifestPath = path.join(releaseStage, manifestName);
    await fsp.writeFile(
      manifestPath,
      stringifyPreviewReleaseManifest(releaseManifest),
      { flag: 'wx' },
    );
    const manifestDescription = await describeFile(manifestPath, manifestName, {
      kind: 'release-manifest',
    });
    await fsp.writeFile(
      path.join(releaseStage, 'SHA256SUMS'),
      formatSha256Sums([...artifacts, manifestDescription]),
      { flag: 'wx' },
    );

    await fsp.rename(releaseStage, outputDir);
    return { outputDir, version: contract.release.version, tag, artifacts };
  } finally {
    packaged.cleanup();
    await companion?.cleanup();
    await Promise.allSettled([
      fsp.rm(workspace, { recursive: true, force: true }),
      fsp.rm(stageRoot, { recursive: true, force: true }),
    ]);
  }
}

/** @param {string[]} [argv] - Command arguments. @returns {Promise<void>} */
export async function main(argv = process.argv.slice(2)) {
  const options = parsePreviewReleaseArgs(argv);
  if (options.check) {
    const result = await verifyPreviewRelease();
    process.stdout.write(
      `Verified preview release contract for ${result.tag} (${result.tarball}; ${result.companionTarball}).\n`,
    );
    return;
  }
  const result = await buildPreviewRelease(options);
  process.stdout.write(
    `Built ${result.tag} release assets in ${result.outputDir}.\n`,
  );
}

const isDirect =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  await main();
}
