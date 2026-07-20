import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = '/etc/wharfie-systemd-proof.json';
const STATUS_TIMEOUT_MS = 120_000;
const STATUS_POLL_INTERVAL_MS = 250;
const MAX_OUTPUT_BYTES = 1024 * 1024;

/**
 * @param {number} duration - Milliseconds to block.
 * @returns {void} - Returns after the duration.
 */
function sleep(duration) {
  const word = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(word, 0, 0, duration);
}

/**
 * Run one exact command without a shell.
 * @param {string} command - Absolute executable path.
 * @param {string[]} args - Exact argv.
 * @param {{allowFailure?: boolean}} [options] - Failure policy.
 * @returns {{status: number, stdout: string, stderr: string}} - Process result.
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: 30_000,
  });
  if (result.error && options.allowFailure !== true) throw result.error;
  const status = result.status ?? 1;
  const output = {
    status,
    stdout: String(result.stdout || ''),
    stderr: [String(result.stderr || ''), result.error?.message || '']
      .filter(Boolean)
      .join('\n'),
  };
  if (status !== 0 && options.allowFailure !== true) {
    throw new Error(
      `${command} failed with exit ${status}: ${output.stderr.trim()}`,
    );
  }
  return output;
}

/**
 * Validate the root-owned boot-check configuration.
 * @param {unknown} value - Parsed JSON.
 * @returns {Readonly<Record<string, any>>} - Exact configuration.
 */
function validateConfig(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  const config = /** @type {Record<string, any>} */ (value);
  const keys = [
    'schemaVersion',
    'kind',
    'commit',
    'user',
    'uid',
    'gid',
    'home',
    'artifactPath',
    'releasePath',
    'unitPath',
    'xdgDataHome',
    'appId',
    'artifactId',
    'revisionId',
    'runId',
    'timer',
    'previousBootId',
    'minimumGeneration',
    'receiptPath',
  ];
  assert.deepEqual(Object.keys(config).sort(), [...keys].sort());
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.kind, 'wharfie.systemd-proof.boot-config');
  assert.match(config.commit, /^[0-9a-f]{40}$/);
  assert.match(config.user, /^[a-z_][a-z0-9_-]*[$]?$/i);
  assert.ok(Number.isSafeInteger(config.uid) && config.uid > 0);
  assert.ok(Number.isSafeInteger(config.gid) && config.gid > 0);
  assert.match(config.appId, /^[a-z][a-z0-9-]*$/);
  assert.match(config.artifactId, /^waf1_[A-Za-z0-9_-]{43}$/);
  assert.match(config.revisionId, /^wrv1_[A-Za-z0-9_-]{43}$/);
  assert.match(config.runId, /^wfr_[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(config.timer).sort(), [
    'dueAt',
    'scheduledAt',
    'timerId',
  ]);
  assert.match(config.timer.timerId, /^wft_[A-Za-z0-9_-]{43}$/);
  assert.ok(Number.isSafeInteger(config.timer.scheduledAt));
  assert.ok(Number.isSafeInteger(config.timer.dueAt));
  assert.ok(config.timer.dueAt > config.timer.scheduledAt);
  assert.match(
    config.previousBootId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  assert.ok(
    Number.isSafeInteger(config.minimumGeneration) &&
      config.minimumGeneration > 0,
  );
  for (const name of [
    'home',
    'artifactPath',
    'releasePath',
    'unitPath',
    'xdgDataHome',
    'receiptPath',
  ]) {
    assert.equal(
      path.isAbsolute(config[name]),
      true,
      `${name} must be absolute`,
    );
    assert.equal(path.normalize(config[name]), config[name]);
  }
  return Object.freeze({ ...config });
}

/**
 * Return active login sessions for the proof UID before any unprivileged
 * status process is launched. A lingering user manager is not a login session.
 * @param {number} uid - Proof user ID.
 * @returns {string[]} - Matching loginctl rows.
 */
function readUserSessions(uid) {
  const result = run('/usr/bin/loginctl', [
    'list-sessions',
    '--no-legend',
    '--no-pager',
  ]);
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.split(/\s+/)[1] === String(uid));
}

/**
 * Run packaged status as the installed non-root UID without PAM or a login
 * session. `setpriv` cannot start a missing user manager, so success proves the
 * linger-started manager and enabled unit were already resident.
 * @param {Readonly<Record<string, any>>} config - Boot configuration.
 * @param {string[]} args - Packaged command arguments.
 * @returns {{result: ReturnType<typeof run>, parsed?: Record<string, any>}} - One observation.
 */
function runPackaged(config, args) {
  const result = run(
    '/usr/bin/setpriv',
    [
      `--reuid=${config.uid}`,
      `--regid=${config.gid}`,
      '--init-groups',
      '/usr/bin/env',
      '-i',
      `HOME=${config.home}`,
      `USER=${config.user}`,
      `LOGNAME=${config.user}`,
      `XDG_DATA_HOME=${config.xdgDataHome}`,
      `XDG_RUNTIME_DIR=/run/user/${config.uid}`,
      `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${config.uid}/bus`,
      'LANG=C.UTF-8',
      'PATH=/usr/bin:/bin',
      config.artifactPath,
      ...args,
    ],
    { allowFailure: true },
  );
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    parsed = undefined;
  }
  return { result, parsed };
}

/**
 * @param {Readonly<Record<string, any>>} config - Boot configuration.
 * @returns {{result: ReturnType<typeof run>, parsed?: Record<string, any>}} - Status observation.
 */
function readPackagedStatus(config) {
  return runPackaged(config, ['wharfie', 'service', 'status', '--json']);
}

/**
 * @param {Readonly<Record<string, any>>} config - Boot configuration.
 * @returns {{result: ReturnType<typeof run>, parsed?: Record<string, any>}} - Workflow observation.
 */
function inspectPackagedRun(config) {
  return runPackaged(config, [
    'wharfie',
    'inspect',
    '--run-id',
    config.runId,
    '--json',
  ]);
}

/**
 * Persist one root-owned boot receipt atomically.
 * @param {string} receiptPath - Destination.
 * @param {Record<string, any>} receipt - Exact receipt.
 * @returns {void} - Returns after file and directory synchronization.
 */
function writeReceipt(receiptPath, receipt) {
  const parent = path.dirname(receiptPath);
  mkdirSync(parent, { recursive: true, mode: 0o755 });
  const temporary = `${receiptPath}.${process.pid}.tmp`;
  const handle = openSync(temporary, 'wx', 0o644);
  try {
    writeFileSync(handle, `${JSON.stringify(receipt, null, 2)}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(temporary, receiptPath);
  const directory = openSync(parent, 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

const config = validateConfig(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')));
const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
assert.notEqual(bootId, config.previousBootId, 'VM boot ID did not change.');
const sessionsBeforeCheck = readUserSessions(config.uid);
assert.deepEqual(
  sessionsBeforeCheck,
  [],
  'Proof user had a login session before the boot check.',
);

const deadline = Date.now() + STATUS_TIMEOUT_MS;
let observation;
let workflowObservation;
let executablePath;
let receipt;
while (Date.now() < deadline) {
  observation = readPackagedStatus(config);
  const status = observation.parsed;
  if (
    observation.result.status === 0 &&
    status?.schemaVersion === 2 &&
    status.kind === 'wharfie.service.status' &&
    status.appId === config.appId &&
    status.health === 'healthy' &&
    status.installation?.activeArtifactId === config.artifactId &&
    status.installation?.activeRevisionId === config.revisionId &&
    status.persistence?.bootEnabled === true &&
    status.systemd?.fragmentPath === config.unitPath &&
    status.systemd?.dropInPaths === '' &&
    status.runtime?.generation > config.minimumGeneration &&
    status.systemd?.mainPid > 0 &&
    status.runtime?.processId === status.systemd.mainPid
  ) {
    try {
      executablePath = readlinkSync(`/proc/${status.systemd.mainPid}/exe`);
    } catch {
      executablePath = undefined;
    }
    workflowObservation = inspectPackagedRun(config);
    const workflow = workflowObservation.parsed;
    const timer = workflow?.timers?.[0];
    if (
      executablePath !== config.releasePath ||
      workflowObservation.result.status !== 0 ||
      workflow?.run?.runId !== config.runId ||
      workflow?.run?.status !== 'RUNNING' ||
      workflow?.workflowCursor?.disposition !== 'TIMER_WAITING' ||
      workflow?.workflowCursor?.timerId !== config.timer.timerId ||
      workflow?.timers?.length !== 1 ||
      timer?.status !== 'WAITING' ||
      timer?.timerId !== config.timer.timerId ||
      timer?.scheduledAt !== config.timer.scheduledAt ||
      timer?.dueAt !== config.timer.dueAt
    ) {
      sleep(STATUS_POLL_INTERVAL_MS);
      continue;
    }
    receipt = {
      schemaVersion: 1,
      kind: 'wharfie.systemd-proof.boot-receipt',
      observedAt: Date.now(),
      bootId,
      previousBootId: config.previousBootId,
      sessionsBeforeCheck,
      automaticStart: true,
      executablePath,
      status,
      workflow,
    };
    break;
  }
  sleep(STATUS_POLL_INTERVAL_MS);
}

if (!receipt) {
  throw new Error(
    `Packaged service did not become healthy before login: ${JSON.stringify({
      exitCode: observation?.result.status,
      stderr: observation?.result.stderr.trim().slice(0, 1024),
      status: observation?.parsed,
      workflowExitCode: workflowObservation?.result.status,
      workflowStderr: workflowObservation?.result.stderr.trim().slice(0, 1024),
      workflow: workflowObservation?.parsed,
      executablePath,
    })}`,
  );
}
writeReceipt(config.receiptPath, receipt);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
