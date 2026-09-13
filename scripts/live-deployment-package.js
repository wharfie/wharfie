import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
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

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_INPUT_BYTES = 256 * 1024;
export const LIVE_DEPLOYMENT_APP_ID = 'steady-file-demo';
export const LIVE_DEPLOYMENT_INPUT_BYTES =
  'Wharfie live durable acceptance input.\n';
export const LIVE_DEPLOYMENT_TIMER_DELAY_MS = 300_000;

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
  /** @returns {Error} - Safe failure with bounded structured metadata. */
  const failure = () => {
    diagnostic.durationMs = Math.round(performance.now() - started);
    return Object.assign(
      new Error(`Live deployment command failed during ${diagnostic.phase}.`),
      { diagnostic: { ...diagnostic } },
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
        reject(failure());
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
 * Copy the installed useful starter, adapting only target selection, the timer
 * duration, and physical activity evidence used by the live recovery proof.
 * @param {{installedDirectory: string, fixtureDirectory: string, nativeTarget: ReturnType<typeof getHostBuildTarget>, timerDelayMs?: number}} options - Fresh installation and native package target.
 * @returns {Promise<void>} - Ready-to-package consumer-owned starter.
 */
export async function prepareLiveDeploymentFixture(options) {
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
  await writeFile(
    path.join(options.fixtureDirectory, 'wharfie.app.js'),
    `export default ${JSON.stringify(manifest, null, 2)};\n`,
    { mode: 0o600 },
  );
}

/**
 * Build through a fresh installation of checkout tarballs and the public CLI.
 * The caller owns and cleans the complete external workspace even on failure.
 * @param {{workspace: string, provider: 'aws'|'hetzner', timerDelayMs?: number, signal?: AbortSignal, onPhase?: (event: Record<string, any>) => void}} options - Build workspace and selected provider.
 * @returns {Promise<{executable: string, appId: string, revisionId: string, artifactId: string, artifactRecord: Record<string, any>, packageReceipt: ReturnType<typeof parseApplicationPackageReceiptOutput>, packageVersion: string, nativeTarget: ReturnType<typeof getHostBuildTarget>, consumerDirectory: string}>} - Exact runnable local controller.
 */
export async function buildLiveDeploymentCandidate(options) {
  assert.ok(['aws', 'hetzner'].includes(options.provider));
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
  await mkdir(tarballs, { mode: 0o700 });
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
  const packages = [await pack(false)];
  if (options.provider === 'aws') packages.push(await pack(true));
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
  const fixture = path.join(consumerDirectory, 'app');
  await prepareLiveDeploymentFixture({
    installedDirectory: installed,
    fixtureDirectory: fixture,
    nativeTarget,
    timerDelayMs: options.timerDelayMs,
  });
  const outputDir = path.join(root, 'dist');
  const output = await run(
    'package-self-deployable-sea',
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
  return { ...candidate, packageVersion, nativeTarget, consumerDirectory };
}
