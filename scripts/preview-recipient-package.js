import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { PREVIEW_TARGET } from './build-preview-release.js';
import {
  assertLiveDeploymentPackageVersions,
  createLiveDeploymentBuildEnvironment,
  runLiveDeploymentProcess,
  verifyLiveDeploymentPackageOutput,
} from './live-deployment-package.js';

export const PREVIEW_RECIPIENT_INPUT = 'Wharfie preview recipient input.\n';

/**
 * Prepare explicit private build paths without inheriting author credentials.
 * @param {string} root - Newly owned environment directory.
 * @returns {Promise<NodeJS.ProcessEnv>} - Credential-free subprocess environment.
 */
export async function createPreviewRecipientEnvironment(root) {
  const environment = createLiveDeploymentBuildEnvironment(root);
  for (const name of ['home', 'tmp', 'cache', 'config', 'data', 'state']) {
    await mkdir(path.join(root, name), { recursive: true, mode: 0o700 });
  }
  for (const name of ['empty.npmrc', 'empty-global.npmrc']) {
    await writeFile(path.join(root, name), '', { mode: 0o600, flag: 'wx' });
  }
  return environment;
}

/**
 * Check the useful CLI result against recipient-independent input bytes.
 * @param {unknown} output - Parsed authored result.
 * @param {string} inputPath - Input on the selected machine.
 * @returns {void} - Throws if the installed starter does not retain its behavior.
 */
export function assertPreviewRecipientOutput(output, inputPath) {
  const fingerprint = {
    bytes: Buffer.byteLength(PREVIEW_RECIPIENT_INPUT),
    sha256: createHash('sha256').update(PREVIEW_RECIPIENT_INPUT).digest('hex'),
    readStable: true,
  };
  assert.deepEqual(output, {
    path: inputPath,
    stable: true,
    baseline: fingerprint,
    current: fingerprint,
  });
}

/**
 * Exercise the verified downloaded standalone with Node absent from PATH.
 * @param {{candidate: import('./publish-preview-release.js').PreviewReleaseCandidate, workspace: string, signal?: AbortSignal}} options - Verified bytes and private runtime directory.
 * @returns {Promise<Record<string, any>>} - Bounded standalone identity proof.
 */
export async function verifyPreviewRecipientStandalone(options) {
  const artifact = options.candidate.manifest.artifacts.find(
    (/** @type {Record<string, any>} */ entry) =>
      entry.kind === 'standalone-cli',
  );
  assert.ok(artifact);
  await mkdir(options.workspace, { mode: 0o700 });
  const executable = path.join(options.workspace, 'wharfie');
  await copyFile(
    path.join(options.candidate.artifactDir, artifact.fileName),
    executable,
  );
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(executable)) hash.update(chunk);
  assert.equal((await stat(executable)).size, artifact.size);
  assert.equal(hash.digest('hex'), artifact.sha256);
  await chmod(executable, 0o700);
  const environment = await createPreviewRecipientEnvironment(
    path.join(options.workspace, 'environment'),
  );
  environment.PATH = path.join(options.workspace, 'empty-path');
  await mkdir(environment.PATH, { mode: 0o700 });
  const run = async (/** @type {string[]} */ args) =>
    await runLiveDeploymentProcess({
      file: executable,
      args,
      cwd: options.workspace,
      env: environment,
      signal: options.signal,
      timeoutMs: 60_000,
      phase: 'recipient-standalone',
    });
  const version = await run(['--version']);
  assert.equal(version.stdout.trim(), options.candidate.manifest.version);
  const help = await run(['--help']);
  assert.match(help.stdout, /CLI tool for Wharfie/u);
  return {
    artifactId: artifact.artifactId,
    revisionId: artifact.revisionId,
    sha256: artifact.sha256,
    version: version.stdout.trim(),
    nodeAbsentFromPath: true,
  };
}

/**
 * Install only the verified core and AWS release tarballs, copy the installed
 * starter, and build through its public CLI. The caller retires this complete
 * builder before a recipient process runs the copied application handoff.
 * @param {{candidate: import('./publish-preview-release.js').PreviewReleaseCandidate, workspace: string, handoff: string, signal?: AbortSignal, onPhase?: (phase: string) => void}} options - Verified release and new private directories.
 * @returns {Promise<{artifactRecord: Record<string, any>, executable: string, recordPath: string, receipt: Record<string, any>}>} - Independently checked application handoff.
 */
export async function buildPreviewRecipientApplication(options) {
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  assert.equal(process.versions.node, PREVIEW_TARGET.nodeVersion);
  const { candidate } = options;
  await mkdir(options.workspace, { mode: 0o700 });
  const env = await createPreviewRecipientEnvironment(
    path.join(options.workspace, 'environment'),
  );
  const consumer = path.join(options.workspace, 'consumer');
  await mkdir(consumer, { mode: 0o700 });
  await writeFile(
    path.join(consumer, 'package.json'),
    JSON.stringify({
      name: 'wharfie-preview-recipient',
      version: '0.0.0',
      private: true,
      type: 'module',
    }) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  const run = async (
    /** @type {string} */ phase,
    /** @type {string[]} */ args,
    /** @type {number} */ timeoutMs,
  ) => {
    options.onPhase?.(phase);
    return await runLiveDeploymentProcess({
      file: process.execPath,
      args,
      cwd: consumer,
      env,
      timeoutMs,
      signal: options.signal,
      phase,
    });
  };
  const npm = await realpath(path.join(path.dirname(process.execPath), 'npm'));
  const packages = ['npm-package', 'npm-companion-package'].map((kind) => {
    const artifact = candidate.manifest.artifacts.find(
      (/** @type {Record<string, any>} */ entry) => entry.kind === kind,
    );
    assert.ok(artifact);
    return path.join(candidate.artifactDir, artifact.fileName);
  });
  const installed = await run(
    'recipient-install',
    [npm, 'install', '--no-audit', '--no-fund', ...packages],
    600_000,
  );
  const coreRoot = path.join(consumer, 'node_modules/@wharfie/wharfie');
  const awsRoot = path.join(consumer, 'node_modules/@wharfie/aws');
  const json = async (/** @type {string} */ file) =>
    JSON.parse(await readFile(file, 'utf8'));
  assertLiveDeploymentPackageVersions(
    await json(path.join(coreRoot, 'package.json')),
    await json(path.join(awsRoot, 'package.json')),
    'aws',
    candidate.manifest.version,
  );
  const app = path.join(consumer, 'app');
  await cp(path.join(coreRoot, 'examples/steady-file'), app, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const inputPath = path.join(consumer, 'input.txt');
  await writeFile(inputPath, PREVIEW_RECIPIENT_INPUT, {
    mode: 0o600,
    flag: 'wx',
  });
  const ordinary = await run(
    'recipient-authored-cli',
    [path.join(app, 'local.js'), inputPath],
    60_000,
  );
  assertPreviewRecipientOutput(JSON.parse(ordinary.stdout), inputPath);
  const outputDir = path.join(consumer, 'dist');
  const packaged = await run(
    'recipient-package',
    [
      path.join(coreRoot, 'bin/wharfie'),
      'app',
      'package',
      app,
      '--self-deployable',
      '--target',
      'node24.13.1-linux-x64-glibc',
      '--output-dir',
      outputDir,
      '--json',
      '--no-pretty',
    ],
    1_800_000,
  );
  const checked = await verifyLiveDeploymentPackageOutput(packaged.stdout, {
    outputDir,
    packageVersion: candidate.manifest.version,
    nativeTarget: PREVIEW_TARGET,
  });
  await mkdir(options.handoff, { mode: 0o700 });
  const executable = path.join(options.handoff, 'app');
  const recordPath = path.join(options.handoff, 'artifact-record.json');
  await copyFile(checked.executable, executable);
  await chmod(executable, 0o700);
  await writeFile(recordPath, JSON.stringify(checked.artifactRecord) + '\n', {
    mode: 0o600,
    flag: 'wx',
  });
  return {
    executable,
    recordPath,
    artifactRecord: checked.artifactRecord,
    receipt: {
      packageVersion: candidate.manifest.version,
      sourceCommit: candidate.manifest.source.commit,
      appId: checked.appId,
      revisionId: checked.revisionId,
      artifactId: checked.artifactId,
      target: PREVIEW_TARGET,
      artifactBytes: checked.artifactRecord.size,
      installDurationMs: installed.durationMs,
      packageDurationMs: packaged.durationMs,
      ordinaryCliVerified: true,
      matchingAwsCompanionInstalled: true,
    },
  };
}
