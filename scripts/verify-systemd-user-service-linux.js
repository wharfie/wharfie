import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const APP_ID = 'systemd-service-proof';
const WORKFLOW_ID = 'reboot-chain';
const SIGNAL_ID = 'resume-after-reboot';
const UNIT_NAME = `wharfie-${APP_ID}.service`;
const BOOT_CHECK_UNIT = 'wharfie-systemd-proof-boot-check.service';
const PROOF_ROOT =
  process.env.WHARFIE_SYSTEMD_PROOF_ROOT || '/var/tmp/wharfie-systemd-proof';
const PREPARE_PATH = path.join(PROOF_ROOT, 'prepare.json');
const FINAL_PATH = path.join(PROOF_ROOT, 'final.json');
const MARKER_PATH = path.join(PROOF_ROOT, 'activity-entries.jsonl');
const BOOT_RECEIPT_PATH = '/var/lib/wharfie-systemd-proof/boot-receipt.json';
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const STATUS_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 250;

/**
 * @typedef CommandResult
 * @property {number} status - Exit status.
 * @property {string} stdout - Standard output.
 * @property {string} stderr - Standard error.
 */

/**
 * Run one exact command without a shell.
 * @param {string} command - Executable path.
 * @param {string[]} args - Exact argv.
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, allowFailure?: boolean, timeoutMs?: number}} [options] - Process options.
 * @returns {CommandResult} - Completed result.
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: options.timeoutMs || 180_000,
  });
  if (result.error) throw result.error;
  const output = {
    status: result.status ?? 1,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
  if (output.status !== 0 && options.allowFailure !== true) {
    const detail = output.stderr.trim() || output.stdout.trim();
    throw new Error(
      `${command} failed with exit ${output.status}: ${detail.slice(0, 4096)}`,
    );
  }
  return output;
}

/**
 * Parse the last nonempty stdout line as JSON.
 * @param {CommandResult} result - Successful command result.
 * @param {string} label - Boundary label.
 * @returns {Record<string, any>} - Parsed object.
 */
function parseJsonResult(result, label) {
  assert.equal(result.status, 0, `${label} exited unsuccessfully`);
  const text = result.stdout.trim();
  assert.ok(text, `${label} emitted no JSON`);
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} emitted invalid JSON: ${text.slice(0, 1024)}`, {
      cause: error,
    });
  }
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value;
}

/**
 * Persist one JSON receipt atomically with file and parent synchronization.
 * @param {string} filePath - Destination.
 * @param {Record<string, any>} value - Receipt.
 * @returns {void} - Returns after durable publication.
 */
function writeJsonAtomic(filePath, value) {
  const parent = path.dirname(filePath);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  const handle = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(temporary, filePath);
  const directory = openSync(parent, 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

/**
 * @param {number} duration - Milliseconds.
 * @returns {Promise<void>} - Resolves after the delay.
 */
function wait(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

/**
 * Poll one async observation until its predicate matches.
 * @param {() => Promise<any> | any} observe - Observation callback.
 * @param {(value: any) => boolean} matches - Success predicate.
 * @param {string} label - Timeout label.
 * @param {number} [timeoutMs] - Bound.
 * @returns {Promise<any>} - Matching observation.
 */
async function waitFor(observe, matches, label, timeoutMs = STATUS_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last;
  let error;
  while (Date.now() < deadline) {
    try {
      last = await observe();
      error = undefined;
      if (matches(last)) return last;
    } catch (caught) {
      error = caught;
    }
    await wait(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for ${label}: ${JSON.stringify({
      last,
      error: error instanceof Error ? error.message : error,
    })}`,
  );
}

/**
 * Build an environment that exposes required OS commands but no Node binary
 * or caller-provided Wharfie path redirection to the packaged artifact.
 * @returns {NodeJS.ProcessEnv} - Sanitized packaged environment.
 */
function packagedEnvironment() {
  const environment = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      !name.startsWith('WHARFIE_') &&
      name !== 'XDG_CONFIG_HOME' &&
      name !== 'XDG_DATA_HOME' &&
      name !== 'NODE_OPTIONS'
    ) {
      environment[name] = value;
    }
  }
  return {
    ...environment,
    HOME: homedir(),
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME || process.env.USER,
    XDG_DATA_HOME: path.join(homedir(), '.local', 'share'),
    LANG: 'C.UTF-8',
    PATH: '/usr/bin:/bin',
    TMPDIR: '/tmp',
  };
}

/**
 * Execute one packaged Wharfie command.
 * @param {string} artifactPath - SEA path.
 * @param {string[]} args - Arguments after the executable.
 * @param {{allowFailure?: boolean}} [options] - Failure policy.
 * @returns {CommandResult} - Process result.
 */
function runArtifact(artifactPath, args, options = {}) {
  return run(artifactPath, args, {
    cwd: PROOF_ROOT,
    env: packagedEnvironment(),
    allowFailure: options.allowFailure,
  });
}

/**
 * Execute one packaged command and parse its JSON object.
 * @param {string} artifactPath - SEA path.
 * @param {string[]} args - Arguments.
 * @param {string} label - Boundary label.
 * @returns {Record<string, any>} - Parsed result.
 */
function runArtifactJson(artifactPath, args, label) {
  return parseJsonResult(runArtifact(artifactPath, args), label);
}

/**
 * @param {string} artifactPath - SEA path.
 * @returns {Record<string, any>} - Packaged service status.
 */
function readServiceStatus(artifactPath) {
  return runArtifactJson(
    artifactPath,
    ['wharfie', 'service', 'status', '--json'],
    'service status',
  );
}

/**
 * @param {string} artifactPath - SEA path.
 * @param {string} runId - Durable run ID.
 * @returns {Record<string, any>} - Redacted run view.
 */
function inspectRun(artifactPath, runId) {
  return runArtifactJson(
    artifactPath,
    ['wharfie', 'inspect', '--run-id', runId, '--json'],
    'workflow inspection',
  );
}

/**
 * Read synchronized physical activity entries.
 * @returns {Record<string, any>[]} - Marker rows.
 */
function readMarkers() {
  if (!existsSync(MARKER_PATH)) return [];
  return readFileSync(MARKER_PATH, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * @returns {string} - Current Linux boot ID.
 */
function readBootId() {
  return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
}

/**
 * Build the current-target proof SEA from the committed fixture.
 * @param {string} repoRoot - Extracted repository root.
 * @returns {{artifactPath: string, artifact: Record<string, any>, revision: Record<string, any>}} - Package result.
 */
function packageProofArtifact(repoRoot) {
  const fixture = path.join(
    repoRoot,
    'test',
    'fixtures',
    'apps',
    'systemd-service',
  );
  const outputDirectory = path.join(PROOF_ROOT, 'dist');
  const target = `linux/${process.arch}/glibc`;
  const result = parseJsonResult(
    run(
      process.execPath,
      [
        path.join(repoRoot, 'bin', 'wharfie'),
        'app',
        'package',
        fixture,
        '--output-dir',
        outputDirectory,
        '--target',
        target,
        '--no-pretty',
      ],
      { cwd: repoRoot, env: process.env, timeoutMs: 600_000 },
    ),
    'proof artifact package',
  );
  assert.equal(result.artifacts?.length, 1);
  const artifact = result.artifacts[0];
  assert.equal(artifact.target?.platform, 'linux');
  assert.equal(artifact.target?.architecture, process.arch);
  assert.equal(artifact.target?.nodeVersion, process.versions.node);
  assert.equal(artifact.target?.libc, 'glibc');
  assert.equal(existsSync(artifact.path), true);
  assert.equal((statSync(artifact.path).mode & 0o111) !== 0, true);
  return { artifactPath: artifact.path, artifact, revision: result.revision };
}

/**
 * Run sudo with exact argv.
 * @param {string[]} args - Command and arguments after sudo.
 * @returns {CommandResult} - Result.
 */
function sudo(args) {
  return run('/usr/bin/sudo', ['--non-interactive', ...args], {
    timeoutMs: 180_000,
  });
}

/**
 * Install the root boot observer that proves automatic service readiness
 * before the proof user's first post-reboot login.
 * @param {string} repoRoot - Extracted repository root.
 * @param {string} artifactPath - Proof SEA.
 * @param {Record<string, any>} serviceStatus - Last pre-reboot status.
 * @param {string} bootId - Pre-reboot kernel identity.
 * @returns {Record<string, any>} - Published boot configuration.
 */
function installBootObserver(repoRoot, artifactPath, serviceStatus, bootId) {
  const uid = process.getuid?.();
  assert.ok(Number.isSafeInteger(uid) && Number(uid) > 0);
  assert.ok(Number.isSafeInteger(serviceStatus.runtime?.generation));
  const config = {
    schemaVersion: 1,
    kind: 'wharfie.systemd-proof.boot-config',
    user: process.env.USER,
    uid,
    home: homedir(),
    artifactPath,
    xdgDataHome: path.join(homedir(), '.local', 'share'),
    appId: APP_ID,
    previousBootId: bootId,
    minimumGeneration: serviceStatus.runtime.generation,
    receiptPath: BOOT_RECEIPT_PATH,
  };
  const configSource = path.join(PROOF_ROOT, 'boot-config.json');
  const unitSource = path.join(PROOF_ROOT, BOOT_CHECK_UNIT);
  writeJsonAtomic(configSource, config);
  writeFileSync(
    unitSource,
    [
      '[Unit]',
      'Description=Wharfie systemd user-service boot proof',
      'After=network-online.target systemd-user-sessions.service',
      'Wants=network-online.target',
      'Before=ssh.service ssh.socket',
      '',
      '[Service]',
      'Type=oneshot',
      'ExecStart=/usr/local/bin/node /usr/local/libexec/wharfie-systemd-proof-boot-check.js',
      'TimeoutStartSec=150s',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  sudo([
    '/usr/bin/install',
    '-D',
    '-o',
    'root',
    '-g',
    'root',
    '-m',
    '0755',
    path.join(repoRoot, 'test', 'systemd', 'boot-check.js'),
    '/usr/local/libexec/wharfie-systemd-proof-boot-check.js',
  ]);
  sudo([
    '/usr/bin/install',
    '-D',
    '-o',
    'root',
    '-g',
    'root',
    '-m',
    '0644',
    configSource,
    '/etc/wharfie-systemd-proof.json',
  ]);
  sudo([
    '/usr/bin/install',
    '-D',
    '-o',
    'root',
    '-g',
    'root',
    '-m',
    '0644',
    unitSource,
    `/etc/systemd/system/${BOOT_CHECK_UNIT}`,
  ]);
  sudo(['/usr/bin/systemctl', 'daemon-reload']);
  sudo(['/usr/bin/systemctl', 'enable', BOOT_CHECK_UNIT]);
  run('/usr/bin/sync', []);
  return config;
}

/**
 * Remove the one-shot boot observer before a retained debug VM can reboot.
 * @returns {void} - Returns after systemd reload.
 */
function removeBootObserver() {
  sudo(['/usr/bin/systemctl', 'disable', BOOT_CHECK_UNIT]);
  for (const target of [
    `/etc/systemd/system/${BOOT_CHECK_UNIT}`,
    '/etc/wharfie-systemd-proof.json',
    '/usr/local/libexec/wharfie-systemd-proof-boot-check.js',
  ]) {
    sudo(['/usr/bin/rm', '--force', target]);
  }
  sudo(['/usr/bin/systemctl', 'daemon-reload']);
}

/**
 * Assert the finite service status agreement used throughout the proof.
 * @param {Record<string, any>} status - Packaged status.
 * @returns {void} - Returns for healthy PID-bound boot persistence.
 */
function assertHealthy(status) {
  assert.equal(status.schemaVersion, 1);
  assert.equal(status.kind, 'wharfie.service.status');
  assert.equal(status.appId, APP_ID);
  assert.equal(status.health, 'healthy');
  assert.equal(status.persistence?.linger, true);
  assert.equal(status.persistence?.unitEnabled, true);
  assert.equal(status.persistence?.bootEnabled, true);
  assert.ok(status.systemd?.mainPid > 0);
  assert.equal(status.runtime?.processId, status.systemd.mainPid);
  assert.equal(status.runtime?.status, 'READY');
  assert.equal(status.runtime?.session, 'active');
  assert.equal(status.runtime?.currentOwner, true);
  assert.equal(status.integrity?.status, 'verified');
}

/**
 * Prepare durable work, prove systemd crash replacement, and publish the
 * independent boot observer before the host restarts the VM.
 * @param {string} repoRoot - Extracted committed repository.
 * @returns {Promise<Record<string, any>>} - Preparation receipt.
 */
async function prepare(repoRoot) {
  assert.equal(process.platform, 'linux');
  assert.ok((process.getuid?.() || 0) > 0, 'proof must run as non-root');
  assert.equal(process.versions.node, '24.13.1');
  rmSync(PROOF_ROOT, { recursive: true, force: true });
  mkdirSync(PROOF_ROOT, { recursive: true, mode: 0o700 });

  const nodeProbe = run('/usr/bin/env', ['node', '--version'], {
    env: packagedEnvironment(),
    allowFailure: true,
  });
  assert.notEqual(
    nodeProbe.status,
    0,
    'packaged PATH unexpectedly exposes Node',
  );

  const packaged = packageProofArtifact(repoRoot);
  const absent = readServiceStatus(packaged.artifactPath);
  assert.equal(absent.health, 'absent');
  const install = runArtifactJson(
    packaged.artifactPath,
    ['wharfie', 'service', 'install', '--json'],
    'service install',
  );
  assert.equal(install.action, 'install');
  assert.equal(install.outcome, 'installed');
  assert.equal(install.health, 'healthy');
  const installed = readServiceStatus(packaged.artifactPath);
  assertHealthy(installed);

  const idempotencyKey = 'systemd-real-reboot-proof';
  const started = runArtifactJson(
    packaged.artifactPath,
    [
      'wharfie',
      'start',
      '--workflow',
      WORKFLOW_ID,
      '--idempotency-key',
      idempotencyKey,
      '--input',
      JSON.stringify({ markerPath: MARKER_PATH, stepIndex: 0 }),
      '--json',
    ],
    'workflow start',
  );
  assert.equal(started.workflow, WORKFLOW_ID);
  assert.match(started.run_id, /^wfr_[A-Za-z0-9_-]{43}$/);
  const runId = started.run_id;
  const timerWaiting = await waitFor(
    () => inspectRun(packaged.artifactPath, runId),
    (view) => view.workflowCursor?.disposition === 'TIMER_WAITING',
    'durable timer wait before reboot',
  );
  assert.equal(timerWaiting.run?.status, 'RUNNING');
  assert.equal(timerWaiting.timers?.length, 1);
  assert.equal(timerWaiting.timers[0].status, 'WAITING');
  assert.deepEqual(
    readMarkers().map((entry) => entry.stepIndex),
    [0],
  );

  const beforeCrash = readServiceStatus(packaged.artifactPath);
  assertHealthy(beforeCrash);
  process.kill(beforeCrash.systemd.mainPid, 'SIGKILL');
  const afterCrash = await waitFor(
    () => readServiceStatus(packaged.artifactPath),
    (status) =>
      status.health === 'healthy' &&
      status.systemd?.mainPid > 0 &&
      status.systemd.mainPid !== beforeCrash.systemd.mainPid &&
      status.runtime?.generation > beforeCrash.runtime.generation,
    'systemd crash replacement',
  );
  assertHealthy(afterCrash);
  const afterCrashRun = inspectRun(packaged.artifactPath, runId);
  assert.ok(
    ['TIMER_WAITING', 'SIGNAL_WAITING'].includes(
      afterCrashRun.workflowCursor?.disposition,
    ),
  );
  assert.deepEqual(
    readMarkers().map((entry) => entry.stepIndex),
    [0],
  );

  const bootId = readBootId();
  const bootConfig = installBootObserver(
    repoRoot,
    packaged.artifactPath,
    afterCrash,
    bootId,
  );
  const receipt = {
    schemaVersion: 1,
    kind: 'wharfie.systemd-proof.prepare',
    commit: process.env.WHARFIE_SYSTEMD_PROOF_COMMIT || null,
    preparedAt: Date.now(),
    appId: APP_ID,
    artifactPath: packaged.artifactPath,
    artifactId: packaged.artifact.artifactId,
    revisionId: packaged.artifact.revisionId,
    runId,
    idempotencyKey,
    bootId,
    timer: timerWaiting.timers[0],
    crashReplacement: {
      before: {
        processId: beforeCrash.systemd.mainPid,
        generation: beforeCrash.runtime.generation,
      },
      after: {
        processId: afterCrash.systemd.mainPid,
        generation: afterCrash.runtime.generation,
      },
    },
    bootConfig,
    markerEntries: readMarkers(),
  };
  writeJsonAtomic(PREPARE_PATH, receipt);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  return receipt;
}

/**
 * Verify pre-login automatic boot, resume the durable workflow, exercise
 * graceful lifecycle operations, and prove uninstall preserves state.
 * @returns {Promise<Record<string, any>>} - Final proof receipt.
 */
async function verify() {
  const prepared = JSON.parse(readFileSync(PREPARE_PATH, 'utf8'));
  assert.equal(prepared.kind, 'wharfie.systemd-proof.prepare');
  const bootReceipt = JSON.parse(readFileSync(BOOT_RECEIPT_PATH, 'utf8'));
  assert.equal(bootReceipt.kind, 'wharfie.systemd-proof.boot-receipt');
  assert.notEqual(bootReceipt.bootId, prepared.bootId);
  assert.equal(bootReceipt.previousBootId, prepared.bootId);
  assert.deepEqual(bootReceipt.sessionsBeforeCheck, []);
  assert.equal(bootReceipt.automaticStart, true);
  assertHealthy(bootReceipt.status);
  assert.ok(
    bootReceipt.status.runtime.generation >
      prepared.crashReplacement.after.generation,
  );
  assert.notEqual(
    bootReceipt.status.systemd.mainPid,
    prepared.crashReplacement.after.processId,
  );
  assert.equal(readBootId(), bootReceipt.bootId);

  const artifactPath = prepared.artifactPath;
  const bootStatus = readServiceStatus(artifactPath);
  assertHealthy(bootStatus);
  assert.equal(bootStatus.systemd.mainPid, bootReceipt.status.systemd.mainPid);
  const signalWaiting = await waitFor(
    () => inspectRun(artifactPath, prepared.runId),
    (view) => view.workflowCursor?.disposition === 'SIGNAL_WAITING',
    'persisted timer fire and signal wait after reboot',
  );
  assert.equal(signalWaiting.run?.status, 'RUNNING');
  assert.equal(signalWaiting.timers?.[0]?.status, 'FIRED');
  assert.equal(signalWaiting.signalWaits?.[0]?.status, 'WAITING');
  assert.equal(signalWaiting.signalWaits?.[0]?.signalId, SIGNAL_ID);
  const firstMarkers = readMarkers();
  assert.deepEqual(
    firstMarkers.map((entry) => entry.stepIndex),
    [0],
  );
  assert.equal(firstMarkers[0].bootId, prepared.bootId);

  const deliveryId = 'systemd-real-reboot-delivery';
  const signal = runArtifactJson(
    artifactPath,
    [
      'wharfie',
      'signal',
      '--run-id',
      prepared.runId,
      '--signal',
      SIGNAL_ID,
      '--delivery-id',
      deliveryId,
      '--payload',
      JSON.stringify({ markerPath: MARKER_PATH, stepIndex: 1 }),
      '--json',
    ],
    'post-reboot signal',
  );
  assert.equal(signal.outcome, 'accepted');
  assert.equal(signal.reused, false);
  const completed = await waitFor(
    () => inspectRun(artifactPath, prepared.runId),
    (view) =>
      view.run?.status === 'COMPLETED' &&
      view.workflowCursor?.disposition === 'COMPLETED',
    'post-reboot workflow completion',
  );
  assert.equal(completed.timers?.[0]?.status, 'FIRED');
  assert.equal(completed.signalWaits?.[0]?.status, 'CONSUMED');
  const completedMarkers = readMarkers();
  assert.deepEqual(
    completedMarkers.map((entry) => entry.stepIndex),
    [0, 1],
  );
  assert.equal(completedMarkers[0].bootId, prepared.bootId);
  assert.equal(completedMarkers[1].bootId, bootReceipt.bootId);

  const beforeRestart = readServiceStatus(artifactPath);
  assertHealthy(beforeRestart);
  const restart = runArtifactJson(
    artifactPath,
    ['wharfie', 'service', 'restart', '--json'],
    'service restart',
  );
  assert.equal(restart.action, 'restart');
  assert.equal(restart.outcome, 'restarted');
  const afterRestart = readServiceStatus(artifactPath);
  assertHealthy(afterRestart);
  assert.notEqual(afterRestart.systemd.mainPid, beforeRestart.systemd.mainPid);
  assert.ok(afterRestart.runtime.generation > beforeRestart.runtime.generation);

  const stop = runArtifactJson(
    artifactPath,
    ['wharfie', 'service', 'stop', '--json'],
    'service stop',
  );
  assert.equal(stop.action, 'stop');
  assert.equal(stop.outcome, 'stopped');
  const stopped = readServiceStatus(artifactPath);
  assert.equal(stopped.health, 'stopped');
  assert.equal(stopped.systemd?.activeState, 'inactive');

  const start = runArtifactJson(
    artifactPath,
    ['wharfie', 'service', 'start', '--json'],
    'service start',
  );
  assert.equal(start.action, 'start');
  assert.equal(start.outcome, 'started');
  const afterStart = readServiceStatus(artifactPath);
  assertHealthy(afterStart);
  assert.ok(afterStart.runtime.generation > afterRestart.runtime.generation);

  const beforeUninstall = inspectRun(artifactPath, prepared.runId);
  const uninstall = runArtifactJson(
    artifactPath,
    ['wharfie', 'service', 'uninstall', '--json'],
    'service uninstall',
  );
  assert.equal(uninstall.action, 'uninstall');
  assert.equal(uninstall.outcome, 'uninstalled');
  assert.equal(uninstall.health, 'absent');
  assert.equal(existsSync(uninstall.preserved?.state), true);
  assert.equal(existsSync(uninstall.preserved?.releases), true);
  assert.equal(
    existsSync(path.join(path.dirname(uninstall.preserved.state), 'current')),
    false,
  );
  assert.equal(
    existsSync(path.join(homedir(), '.config', 'systemd', 'user', UNIT_NAME)),
    false,
  );
  const absent = readServiceStatus(artifactPath);
  assert.equal(absent.health, 'absent');
  assert.equal(absent.installation?.state, 'uninstalled');
  const afterUninstall = inspectRun(artifactPath, prepared.runId);
  assert.equal(afterUninstall.run?.status, 'COMPLETED');
  assert.equal(afterUninstall.workflowCursor?.disposition, 'COMPLETED');
  assert.deepEqual(afterUninstall.events, beforeUninstall.events);
  assert.deepEqual(readMarkers(), completedMarkers);

  removeBootObserver();
  const receipt = {
    schemaVersion: 1,
    kind: 'wharfie.systemd-proof.complete',
    commit: prepared.commit,
    completedAt: Date.now(),
    appId: APP_ID,
    artifactId: prepared.artifactId,
    revisionId: prepared.revisionId,
    runId: prepared.runId,
    boot: {
      before: prepared.bootId,
      after: bootReceipt.bootId,
      sessionsBeforeCheck: bootReceipt.sessionsBeforeCheck,
      automaticStart: bootReceipt.automaticStart,
      processId: bootReceipt.status.systemd.mainPid,
      generation: bootReceipt.status.runtime.generation,
    },
    crashReplacement: prepared.crashReplacement,
    gracefulRestart: {
      beforeProcessId: beforeRestart.systemd.mainPid,
      afterProcessId: afterRestart.systemd.mainPid,
      beforeGeneration: beforeRestart.runtime.generation,
      afterGeneration: afterRestart.runtime.generation,
    },
    stopStart: {
      stoppedHealth: stopped.health,
      processId: afterStart.systemd.mainPid,
      generation: afterStart.runtime.generation,
    },
    workflow: {
      status: afterUninstall.run.status,
      disposition: afterUninstall.workflowCursor.disposition,
      timerStatus: afterUninstall.timers[0].status,
      signalStatus: afterUninstall.signalWaits[0].status,
      markerEntries: completedMarkers,
    },
    uninstall: {
      status: absent.installation.state,
      preserved: uninstall.preserved,
      inspectableAfterUninstall: true,
    },
  };
  writeJsonAtomic(FINAL_PATH, receipt);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  return receipt;
}

const phase = process.argv[2];
const repoRoot = path.resolve(process.argv[3] || process.cwd());
if (phase === 'prepare') {
  await prepare(repoRoot);
} else if (phase === 'verify') {
  await verify();
} else {
  throw new Error(
    'Usage: verify-systemd-user-service-linux.js <prepare|verify> [repo-root]',
  );
}
