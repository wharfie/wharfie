import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants, createReadStream } from 'node:fs';
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseApplicationPackageReceiptOutput } from '../src/cli/app/package-command-receipt.js';
import { getBuildTargetId } from '../src/core/runtime/build-target.js';
import { getHostBuildTarget } from '../src/core/runtime/host-build-target.js';
import { assertPackageContents, REPO_ROOT } from './package-verification.js';
import { verifyPreviewRecipientCandidate } from './preview-recipient-download.js';

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_INPUT_BYTES = 256 * 1024;
const PACKAGED_ACTIVATION_FAILURES = new Map([
  [
    'Remote artifact upload did not complete exactly.',
    'artifact-upload-failed',
  ],
  [
    'Remote service convergence did not complete successfully.',
    'service-convergence-failed',
  ],
]);
export const LIVE_DEPLOYMENT_ACTIVATION_FAULT_CODES = Object.freeze([
  ...PACKAGED_ACTIVATION_FAILURES.values(),
]);
export const LIVE_DEPLOYMENT_APP_ID = 'steady-file-demo';
export const LIVE_DEPLOYMENT_INPUT_BYTES =
  'Wharfie live durable acceptance input.\n';
// Both fault boundaries must fit even when SSH and packaged recovery are slow.
export const LIVE_DEPLOYMENT_TIMER_DELAY_MS = 900_000;
export const LIVE_DEPLOYMENT_NEXT_TIMER_DELAY_MS = 1000;

/**
 * @typedef {{workspace: string, provider: 'aws'|'hetzner', artifactDir?: string, expectedCommit?: string, timerDelayMs?: number, signal?: AbortSignal, onPhase?: (event: Record<string, any>) => void}} LiveDeploymentBuildOptions
 * @typedef {{name: string, version: string, fileName: string, sha256: string, integrity: string, npmShasum: string, size: number}} LiveDeploymentSourcePackage
 * @typedef {{kind: 'verified-release-assets', version: string, tag: string, sourceCommit: string, packages: LiveDeploymentSourcePackage[]}} LiveDeploymentPackageSource
 * @typedef {{executable: string, appId: string, revisionId: string, artifactId: string, artifactRecord: Record<string, any>, packageReceipt: ReturnType<typeof parseApplicationPackageReceiptOutput>, packageVersion: string, nativeTarget: ReturnType<typeof getHostBuildTarget>, consumerDirectory: string, packageSource?: LiveDeploymentPackageSource}} LiveDeploymentCandidate
 */

/**
 * Require the complete pinned release selector before creating build state.
 * @param {{artifactDir?: string, expectedCommit?: string}} options - Optional release input.
 * @returns {void} - Throws on incomplete or ambiguous release authority.
 */
function assertLiveDeploymentReleaseSelection(options) {
  assert.equal(
    options.artifactDir !== undefined,
    options.expectedCommit !== undefined,
    'Release artifacts require both artifactDir and expectedCommit.',
  );
  if (options.artifactDir !== undefined) {
    assert.ok(
      typeof options.artifactDir === 'string' &&
        path.isAbsolute(options.artifactDir),
      'Release artifactDir must be an absolute directory.',
    );
    assert.ok(
      typeof options.expectedCommit === 'string' &&
        /^[a-f0-9]{40}$/u.test(options.expectedCommit),
      'Release expectedCommit must be a full lowercase Git commit ID.',
    );
  }
}

/**
 * Authenticate a complete release, then isolate the selected package bytes from
 * later changes to its download directory before the installer can read them.
 * @param {{artifactDir: string, expectedCommit: string, provider: 'aws'|'hetzner', directory: string}} options - Exact release and new private tarball directory.
 * @param {{copyFile?: typeof copyFile}} [dependencies] - File-copy boundary for race verification.
 * @returns {Promise<{packages: string[], packageSource: LiveDeploymentPackageSource}>} - Owned tarballs and their verified release identities.
 */
export async function stageLiveDeploymentReleasePackages(
  options,
  dependencies = {},
) {
  assertLiveDeploymentReleaseSelection(options);
  assert.ok(['aws', 'hetzner'].includes(options.provider));
  assert.ok(path.isAbsolute(options.directory));
  const candidate = await verifyPreviewRecipientCandidate(options.artifactDir, {
    expectedCommit: options.expectedCommit,
  });
  await mkdir(options.directory, { mode: 0o700 });
  await chmod(options.directory, 0o700);
  const kinds = ['npm-package'];
  if (options.provider === 'aws') kinds.push('npm-companion-package');
  const packages = [];
  /** @type {LiveDeploymentSourcePackage[]} */
  const sourcePackages = [];
  for (const kind of kinds) {
    const artifact = candidate.manifest.artifacts.find(
      (/** @type {Record<string, any>} */ entry) => entry.kind === kind,
    );
    assert.ok(artifact);
    const destination = path.join(options.directory, artifact.fileName);
    await (dependencies.copyFile ?? copyFile)(
      path.join(candidate.artifactDir, artifact.fileName),
      destination,
      fsConstants.COPYFILE_EXCL,
    );
    await chmod(destination, 0o600);
    const stats = await lstat(destination);
    assert.ok(stats.isFile() && !stats.isSymbolicLink());
    assert.equal(stats.size, artifact.size);
    const sha256 = createHash('sha256');
    const sha512 = createHash('sha512');
    const sha1 = createHash('sha1');
    let size = 0;
    for await (const chunk of createReadStream(destination)) {
      size += chunk.length;
      assert.ok(size <= artifact.size);
      sha256.update(chunk);
      sha512.update(chunk);
      sha1.update(chunk);
    }
    assert.equal(size, artifact.size);
    assert.equal(sha256.digest('hex'), artifact.sha256);
    assert.equal(`sha512-${sha512.digest('base64')}`, artifact.integrity);
    assert.equal(sha1.digest('hex'), artifact.npmShasum);
    packages.push(destination);
    sourcePackages.push({
      name: artifact.package,
      version: artifact.version,
      fileName: artifact.fileName,
      sha256: artifact.sha256,
      integrity: artifact.integrity,
      npmShasum: artifact.npmShasum,
      size: artifact.size,
    });
  }
  return {
    packages,
    packageSource: {
      kind: 'verified-release-assets',
      version: candidate.manifest.version,
      tag: candidate.manifest.tag,
      sourceCommit: candidate.manifest.source.commit,
      packages: sourcePackages,
    },
  };
}

/**
 * Run an acceptance subprocess with bounded output, a hard deadline, and one
 * process group that can also reap npm and builder descendants. Raw output is
 * available only on success; failure metadata never includes argv or logs.
 * @param {{file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, signal?: AbortSignal, phase?: string, stdin?: string}} options - Exact command boundary.
 * @returns {Promise<{stdout: string, stderr: string, status: number, signal: null, durationMs: number}>} - Successful bounded output.
 */
export async function runLiveDeploymentProcess(options) {
  assert.ok(path.isAbsolute(options.file));
  assert.ok(path.isAbsolute(options.cwd));
  assert.ok(
    options.env &&
      typeof options.env === 'object' &&
      !Array.isArray(options.env),
    'Live deployment subprocess requires an explicit environment.',
  );
  assert.ok(
    Number.isSafeInteger(options.timeoutMs) &&
      options.timeoutMs > 0 &&
      options.timeoutMs <= 2_147_483_647,
  );
  assert.ok(['darwin', 'linux'].includes(process.platform));
  assert.ok(
    options.stdin === undefined ||
      (typeof options.stdin === 'string' &&
        Buffer.byteLength(options.stdin) <= MAX_INPUT_BYTES),
    'Live deployment subprocess input exceeds its bound.',
  );
  const started = performance.now();
  const diagnostic = {
    phase: options.phase || 'subprocess',
    command: path.basename(options.file),
    durationMs: 0,
    status: /** @type {number|null} */ (null),
    signal: /** @type {string|null} */ (null),
    timedOut: false,
    aborted: false,
    outputLimitExceeded: false,
    spawnError: false,
    stdinError: false,
  };
  /**
   * @param {string} [activationFaultCode] - Exact allowlisted packaged failure.
   * @returns {Error} - Safe failure with bounded structured metadata.
   */
  const failure = (activationFaultCode) => {
    diagnostic.durationMs = Math.round(performance.now() - started);
    return Object.assign(
      new Error(`Live deployment command failed during ${diagnostic.phase}.`),
      {
        diagnostic: {
          ...diagnostic,
          ...(activationFaultCode === undefined ? {} : { activationFaultCode }),
        },
      },
    );
  };
  if (options.signal?.aborted) {
    diagnostic.aborted = true;
    throw failure();
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(options.file, options.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: true,
      stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    assert.ok(child.stdout && child.stderr);
    /** @type {Buffer[]} */
    const stdout = [];
    /** @type {Buffer[]} */
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    /** Stop the whole owned process group, including inherited pipe holders. */
    const killGroup = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    };
    /** Stop interrupted work before the caller begins provider cleanup. */
    const abort = () => {
      diagnostic.aborted = true;
      killGroup();
    };
    const timer = setTimeout(() => {
      diagnostic.timedOut = true;
      killGroup();
    }, options.timeoutMs);
    timer.unref();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    /**
     * @param {Buffer} chunk - Process output.
     * @param {boolean} isStdout - Select stdout or stderr.
     */
    const collect = (chunk, isStdout) => {
      const used = isStdout ? stdoutBytes : stderrBytes;
      const remaining = MAX_OUTPUT_BYTES - used;
      const bytes = chunk.subarray(0, remaining);
      if (isStdout) {
        stdout.push(bytes);
        stdoutBytes += bytes.length;
      } else {
        stderr.push(bytes);
        stderrBytes += bytes.length;
      }
      if (chunk.length > remaining) {
        diagnostic.outputLimitExceeded = true;
        killGroup();
      }
    };
    child.stdout.on('data', (chunk) => collect(chunk, true));
    child.stderr.on('data', (chunk) => collect(chunk, false));
    child.once('error', () => {
      diagnostic.spawnError = true;
      killGroup();
    });
    child.stdin?.once('error', () => {
      diagnostic.stdinError = true;
      killGroup();
    });
    child.stdin?.end(options.stdin);
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      diagnostic.status = status;
      diagnostic.signal = signal;
      diagnostic.durationMs = Math.round(performance.now() - started);
      if (
        status !== 0 ||
        diagnostic.timedOut ||
        diagnostic.aborted ||
        diagnostic.outputLimitExceeded ||
        diagnostic.spawnError ||
        diagnostic.stdinError
      ) {
        killGroup();
        // The packaged deployment CLI prints only error.message. Recognize
        // complete fixed messages; never retain logs or infer an inner timeout.
        const activationFaultCode =
          ['apply', 'fresh-controller'].includes(diagnostic.phase) &&
          typeof status === 'number' &&
          status !== 0 &&
          signal === null &&
          !diagnostic.timedOut &&
          !diagnostic.aborted &&
          !diagnostic.outputLimitExceeded &&
          !diagnostic.spawnError &&
          !diagnostic.stdinError
            ? PACKAGED_ACTIVATION_FAILURES.get(
                Buffer.concat(stderr, stderrBytes).toString('utf8').trim(),
              )
            : undefined;
        reject(failure(activationFaultCode));
        return;
      }
      killGroup();
      resolve({
        stdout: Buffer.concat(stdout, stdoutBytes).toString('utf8'),
        stderr: Buffer.concat(stderr, stderrBytes).toString('utf8'),
        status,
        signal: null,
        durationMs: diagnostic.durationMs,
      });
    });
  });
}

/**
 * Isolate package caches, configuration, and temporary files. Ambient cloud,
 * npm, SSH, Node injection, proxy, and user credential settings are excluded.
 * @param {string} directory - Private build-owned environment directory.
 * @returns {NodeJS.ProcessEnv} - Explicit credential-free build environment.
 */
export function createLiveDeploymentBuildEnvironment(directory) {
  assert.ok(path.isAbsolute(directory));
  return {
    PATH: `${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: path.join(directory, 'home'),
    TMPDIR: path.join(directory, 'tmp'),
    XDG_CACHE_HOME: path.join(directory, 'cache'),
    XDG_CONFIG_HOME: path.join(directory, 'config'),
    XDG_DATA_HOME: path.join(directory, 'data'),
    XDG_STATE_HOME: path.join(directory, 'state'),
    npm_config_cache: path.join(directory, 'npm-cache'),
    npm_config_userconfig: path.join(directory, 'empty.npmrc'),
    npm_config_globalconfig: path.join(directory, 'empty-global.npmrc'),
    npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_update_notifier: 'false',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    CI: '1',
    NO_COLOR: '1',
    TZ: 'UTC',
  };
}

/**
 * Require exact installed provider companionship before building a controller.
 * @param {{name?: string, version?: string, peerDependencies?: Record<string, string>}} core - Installed core metadata.
 * @param {{name?: string, version?: string, peerDependencies?: Record<string, string>}|null} companion - Installed companion, if any.
 * @param {'aws'|'hetzner'} provider - Selected live provider.
 * @param {string} expectedVersion - Packed checkout version.
 * @returns {void} - Throws before packaging mismatched packages.
 */
export function assertLiveDeploymentPackageVersions(
  core,
  companion,
  provider,
  expectedVersion,
) {
  assert.equal(core.name, '@wharfie/wharfie');
  assert.equal(core.version, expectedVersion);
  assert.equal(core.peerDependencies?.['@wharfie/aws'], expectedVersion);
  if (provider === 'aws') {
    assert.equal(companion?.name, '@wharfie/aws');
    assert.equal(companion?.version, expectedVersion);
    assert.equal(
      companion?.peerDependencies?.['@wharfie/wharfie'],
      expectedVersion,
    );
  } else {
    assert.equal(provider, 'hetzner');
    assert.equal(companion, null);
  }
}

/**
 * Check public receipt identities against published sidecar and streamed SEA
 * bytes. The packaged deployment commands independently authenticate their
 * embedded Linux payload; this local handoff does not replace that authority.
 * @param {string} stdout - Complete public package JSON response.
 * @param {{outputDir: string, packageVersion: string, nativeTarget: ReturnType<typeof getHostBuildTarget>}} expected - Trusted local build selection.
 * @returns {Promise<{executable: string, appId: string, revisionId: string, artifactId: string, artifactRecord: Record<string, any>, packageReceipt: ReturnType<typeof parseApplicationPackageReceiptOutput>}>} - Checked controller handoff.
 */
export async function verifyLiveDeploymentPackageOutput(stdout, expected) {
  const receipt = parseApplicationPackageReceiptOutput(stdout);
  assert.equal(receipt.appId, LIVE_DEPLOYMENT_APP_ID);
  assert.equal(receipt.outputDir, await realpath(expected.outputDir));
  assert.equal(receipt.artifactCount, 1);
  const artifact = receipt.artifacts[0];
  assert.equal(
    getBuildTargetId(artifact.target),
    getBuildTargetId(expected.nativeTarget),
  );
  const executableStat = await lstat(artifact.path);
  assert.ok(executableStat.isFile());
  assert.ok((executableStat.mode & 0o111) !== 0);
  assert.equal(await realpath(artifact.path), artifact.path);
  const recordStat = await lstat(artifact.recordPath);
  assert.ok(recordStat.isFile() && recordStat.size <= 1024 * 1024);
  const record = JSON.parse(await readFile(artifact.recordPath, 'utf8'));
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.kind, 'artifactRecord');
  assert.equal(record.appId, receipt.appId);
  assert.equal(record.revisionId, receipt.revisionId);
  assert.equal(record.artifactId, artifact.artifactId);
  assert.equal(record.size, artifact.size);
  assert.deepEqual(record.byteDigest, { ...artifact.byteDigest });
  assert.deepEqual(record.target, { ...artifact.target });
  assert.equal(record.targetId, getBuildTargetId(artifact.target));
  assert.deepEqual(record.format, { kind: 'node-sea', version: 1 });
  assert.equal(record.provenance?.builder?.name, '@wharfie/wharfie');
  assert.equal(record.provenance?.builder?.version, expected.packageVersion);
  assert.equal(
    record.provenance?.node?.version,
    expected.nativeTarget.nodeVersion,
  );
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(artifact.path)) {
    hash.update(chunk);
    size += chunk.length;
  }
  assert.equal(size, artifact.size);
  assert.equal(hash.digest('base64url'), artifact.byteDigest.value);
  return {
    executable: artifact.path,
    appId: receipt.appId,
    revisionId: receipt.revisionId,
    artifactId: artifact.artifactId,
    artifactRecord: record,
    packageReceipt: receipt,
  };
}

/**
 * Copy the installed useful starter with acceptance timing and physical activity
 * evidence. Revision B adds an ordinary CLI result field; durable input, activity
 * behavior, and output stay compatible so history can be checked across updates.
 * @param {{installedDirectory: string, fixtureDirectory: string, nativeTarget: ReturnType<typeof getHostBuildTarget>, timerDelayMs?: number, revision?: 'A'|'B'}} options - Fresh installation and native package target.
 * @returns {Promise<void>} - Ready-to-package consumer-owned starter.
 */
export async function prepareLiveDeploymentFixture(options) {
  const revision = options.revision ?? 'A';
  assert.ok(['A', 'B'].includes(revision), 'Unknown live acceptance revision.');
  const timerDelayMs = options.timerDelayMs ?? LIVE_DEPLOYMENT_TIMER_DELAY_MS;
  assert.ok(
    Number.isSafeInteger(timerDelayMs) &&
      timerDelayMs > 0 &&
      timerDelayMs <= 2_147_483_647,
    'Live acceptance timer must have a bounded positive duration.',
  );
  assert.ok(path.isAbsolute(options.installedDirectory));
  assert.ok(path.isAbsolute(options.fixtureDirectory));
  const starterDirectory = path.join(
    options.installedDirectory,
    'examples/steady-file',
  );
  const { default: starter } = await import(
    pathToFileURL(path.join(starterDirectory, 'wharfie.app.js')).href
  );
  const manifest = JSON.parse(JSON.stringify(starter));
  assert.equal(manifest.app.id, LIVE_DEPLOYMENT_APP_ID);
  assert.equal(manifest.cli.durable.workflow, 'verify-stable');
  const steps = /** @type {Record<string, any>[]} */ (
    manifest.workflows['verify-stable'].steps
  );
  assert.deepEqual(
    steps.map((step) => ({ id: step.id, kind: step.kind })),
    [
      { id: 'baseline', kind: 'activity' },
      { id: 'stability-window', kind: 'timer' },
      { id: 'comparison', kind: 'activity' },
    ],
  );
  manifest.targets = [options.nativeTarget];
  steps[1].delayMs = timerDelayMs;
  for (const activity of ['capture', 'verify']) {
    assert.deepEqual(manifest.activities[activity].entrypoint, {
      kind: 'node',
      path: './activities.js',
      export: activity,
    });
    manifest.activities[activity].entrypoint.path =
      './acceptance-activities.js';
  }
  const wrapperSource = await readFile(
    new URL('./live-deployment-fixture-activities.js', import.meta.url),
    'utf8',
  );
  const activityImport = "'../examples/steady-file/activities.js'";
  assert.equal(wrapperSource.split(activityImport).length, 2);
  await cp(starterDirectory, options.fixtureDirectory, { recursive: true });
  await writeFile(
    path.join(options.fixtureDirectory, 'acceptance-activities.js'),
    wrapperSource.replace(activityImport, "'./activities.js'"),
    { mode: 0o600, flag: 'wx' },
  );
  if (revision === 'B') {
    const cliPath = path.join(options.fixtureDirectory, 'cli.js');
    const cliSource = await readFile(cliPath, 'utf8');
    const ordinaryResult = 'JSON.stringify(result, null, 2)';
    assert.equal(
      cliSource.split(ordinaryResult).length,
      2,
      'Installed starter must have one known ordinary result boundary.',
    );
    await writeFile(
      cliPath,
      cliSource.replace(
        ordinaryResult,
        "JSON.stringify({ ...result, acceptanceRevision: 'B' }, null, 2)",
      ),
      { mode: 0o600 },
    );
  }
  await writeFile(
    path.join(options.fixtureDirectory, 'wharfie.app.js'),
    `export default ${JSON.stringify(manifest, null, 2)};\n`,
    { mode: 0o600 },
  );
}

/**
 * Build the existing revision A through a fresh installation and public CLI.
 * The caller owns and cleans the complete external workspace even on failure.
 * @param {LiveDeploymentBuildOptions} options - Build workspace and selected provider.
 * @returns {Promise<LiveDeploymentCandidate>} - Exact runnable local controller.
 */
export async function buildLiveDeploymentCandidate(options) {
  const build = await createLiveDeploymentCandidateBuilder(options);
  return await build('A');
}

/**
 * Package both visibly distinguishable revisions from one fresh installation of
 * the exact core and provider tarballs. Every artifact is independently checked;
 * the caller owns copying retained controllers and cleaning this workspace.
 * @param {LiveDeploymentBuildOptions & {nextTimerDelayMs?: number}} options - Build workspace, provider, and B's shorter completion timer.
 * @returns {Promise<{primary: LiveDeploymentCandidate, next: LiveDeploymentCandidate}>} - A and B controllers from the same installed candidate.
 */
export async function buildLiveDeploymentCandidates(options) {
  const build = await createLiveDeploymentCandidateBuilder(options);
  const primary = await build('A');
  const next = await build(
    'B',
    options.nextTimerDelayMs ?? LIVE_DEPLOYMENT_NEXT_TIMER_DELAY_MS,
  );
  assert.equal(primary.appId, next.appId);
  assert.notEqual(primary.revisionId, next.revisionId);
  assert.notEqual(primary.artifactId, next.artifactId);
  return { primary, next };
}

/**
 * Install one credential-free consumer and retain its build boundary for each
 * requested revision. Sequential packaging bounds simultaneous builder memory.
 * @param {LiveDeploymentBuildOptions} options - Build workspace and selected provider.
 * @returns {Promise<(revision: 'A'|'B', timerDelayMs?: number) => Promise<LiveDeploymentCandidate>>} - Build one revision through the installed public CLI.
 */
async function createLiveDeploymentCandidateBuilder(options) {
  assert.ok(['aws', 'hetzner'].includes(options.provider));
  assertLiveDeploymentReleaseSelection(options);
  const workspace = await realpath(options.workspace);
  const repository = await realpath(REPO_ROOT);
  const relative = path.relative(repository, workspace);
  assert.ok(
    relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    'Live package workspace must be outside the checkout.',
  );
  const nativeTarget = getHostBuildTarget();
  assert.ok(['darwin', 'linux'].includes(nativeTarget.platform));
  const root = path.join(workspace, 'package');
  await mkdir(root, { mode: 0o700 });
  const environmentDirectory = path.join(root, 'environment');
  const environment =
    createLiveDeploymentBuildEnvironment(environmentDirectory);
  for (const name of ['home', 'tmp', 'cache', 'config', 'data', 'state']) {
    await mkdir(path.join(environmentDirectory, name), {
      recursive: true,
      mode: 0o700,
    });
  }
  for (const name of ['empty.npmrc', 'empty-global.npmrc']) {
    await writeFile(path.join(environmentDirectory, name), '', {
      mode: 0o600,
      flag: 'wx',
    });
  }
  const tarballs = path.join(root, 'tarballs');
  const consumerDirectory = path.join(root, 'consumer');
  await mkdir(consumerDirectory, { mode: 0o700 });
  const npm = await realpath(path.join(path.dirname(process.execPath), 'npm'));
  const coreMetadata = JSON.parse(
    await readFile(path.join(repository, 'package.json'), 'utf8'),
  );
  const packageVersion = coreMetadata.version;
  /**
   * @param {string} phase - Fixed diagnostic phase.
   * @param {string[]} args - Exact Node arguments.
   * @param {string} cwd - Owned working directory.
   * @param {number} timeoutMs - Hard process deadline.
   * @returns {Promise<string>} - Bounded successful output.
   */
  const run = async (phase, args, cwd, timeoutMs) => {
    options.onPhase?.({ phase, state: 'started' });
    const result = await runLiveDeploymentProcess({
      file: process.execPath,
      args,
      cwd,
      env: environment,
      timeoutMs,
      signal: options.signal,
      phase,
    });
    options.onPhase?.({
      phase,
      state: 'completed',
      durationMs: result.durationMs,
      status: result.status,
      signal: result.signal,
    });
    return result.stdout;
  };
  /**
   * @param {boolean} aws - Pack companion instead of core.
   * @returns {Promise<string>} - Verified local tarball path.
   */
  const pack = async (aws) => {
    const output = await run(
      aws ? 'package-aws-tarball' : 'package-core-tarball',
      [
        npm,
        'pack',
        ...(aws ? ['--workspace', '@wharfie/aws'] : ['--workspaces=false']),
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        tarballs,
      ],
      repository,
      120_000,
    );
    const manifests = JSON.parse(output);
    assert.ok(Array.isArray(manifests) && manifests.length === 1);
    const manifest = manifests[0];
    assert.equal(manifest.name, aws ? '@wharfie/aws' : '@wharfie/wharfie');
    assert.equal(manifest.version, packageVersion);
    if (!aws) assertPackageContents(manifest);
    assert.equal(path.basename(manifest.filename), manifest.filename);
    const tarball = path.join(tarballs, manifest.filename);
    assert.ok((await lstat(tarball)).isFile());
    return tarball;
  };
  /** @type {string[]} */
  let packages;
  /** @type {LiveDeploymentPackageSource|undefined} */
  let packageSource;
  if (options.artifactDir !== undefined) {
    options.onPhase?.({
      phase: 'package-verify-release-assets',
      state: 'started',
    });
    const staged = await stageLiveDeploymentReleasePackages({
      artifactDir: options.artifactDir,
      expectedCommit: /** @type {string} */ (options.expectedCommit),
      provider: options.provider,
      directory: tarballs,
    });
    packages = staged.packages;
    packageSource = staged.packageSource;
    assert.equal(packageSource.version, packageVersion);
    options.onPhase?.({
      phase: 'package-verify-release-assets',
      state: 'completed',
    });
  } else {
    await mkdir(tarballs, { mode: 0o700 });
    packages = [await pack(false)];
    if (options.provider === 'aws') packages.push(await pack(true));
  }
  await writeFile(
    path.join(consumerDirectory, 'package.json'),
    `${JSON.stringify({
      name: 'wharfie-live-deployment-consumer',
      version: '0.0.0',
      private: true,
      type: 'module',
    })}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  await run(
    'package-fresh-install',
    [
      npm,
      'install',
      '--ignore-scripts',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      ...packages,
    ],
    consumerDirectory,
    600_000,
  );
  const installed = path.join(
    consumerDirectory,
    'node_modules/@wharfie/wharfie',
  );
  const installedCore = JSON.parse(
    await readFile(path.join(installed, 'package.json'), 'utf8'),
  );
  let installedAws = null;
  try {
    installedAws = JSON.parse(
      await readFile(
        path.join(consumerDirectory, 'node_modules/@wharfie/aws/package.json'),
        'utf8',
      ),
    );
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
      throw error;
    }
  }
  assertLiveDeploymentPackageVersions(
    installedCore,
    installedAws,
    options.provider,
    packageVersion,
  );
  return async (revision, timerDelayMs = options.timerDelayMs) => {
    const suffix = revision === 'A' ? '' : '-next';
    const fixture = path.join(consumerDirectory, `app${suffix}`);
    await prepareLiveDeploymentFixture({
      installedDirectory: installed,
      fixtureDirectory: fixture,
      nativeTarget,
      timerDelayMs,
      revision,
    });
    const outputDir = path.join(root, `dist${suffix}`);
    const output = await run(
      `package-self-deployable-sea${suffix}`,
      [
        path.join(installed, 'bin/wharfie'),
        'app',
        'package',
        fixture,
        '--output-dir',
        outputDir,
        '--self-deployable',
        '--target',
        `${nativeTarget.platform}/${nativeTarget.architecture}${nativeTarget.libc ? `/${nativeTarget.libc}` : ''}`,
        '--json',
        '--no-pretty',
      ],
      consumerDirectory,
      1_800_000,
    );
    const candidate = await verifyLiveDeploymentPackageOutput(output, {
      outputDir,
      packageVersion,
      nativeTarget,
    });
    return {
      ...candidate,
      packageVersion,
      nativeTarget,
      consumerDirectory,
      ...(packageSource ? { packageSource } : {}),
    };
  };
}
