import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CONFIG_PATH = '/etc/wharfie-systemd-proof.json';
const STATUS_TIMEOUT_MS = 120_000;
const STATUS_POLL_INTERVAL_MS = 250;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const SUPERVISOR_SETTLE_RESERVE_MS = 1_000;
const SUPERVISOR_PID_PREFIX = 'WHARFIE_PROCESS_GROUP_PID=';
const DESIRED_CONVERGENCE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'appId',
  'unit',
  'desired',
  'disposition',
  'basis',
]);
const DESIRED_RELEASE_KEYS = new Set(['artifactId', 'revisionId']);
const AUTHORITY_KEYS = new Set([
  'schemaVersion',
  'appId',
  'coordinatorId',
  'authorityId',
  'epoch',
  'status',
  'recordVersion',
  'acquisitionRequestId',
  'acquiredAt',
  'heartbeatAt',
  'releasedAt',
  'updatedAt',
  'lastRequestId',
]);
const READINESS_KEYS = new Set([
  'run_id',
  'sort_key',
  'schema_version',
  'record_kind',
  'app_id',
  'destination_kind',
  'destination_version',
  'binding_id',
  'provider',
  'store_id',
  'table_name',
  'namespace',
  'authority_schema_version',
  'coordinator_id',
  'authority_id',
  'epoch',
  'status',
  'destination_authority_digest',
  'record_digest',
]);

/** @typedef {{result: {status: number, stdout: string, stderr: string}, parsed?: Record<string, any>}} CommandObservation */
/** @typedef {{status: Record<string, any>, workflow: Record<string, any>, coordinatorInspection: Record<string, any>, readinessEvidence: Record<string, any>}} BootEvidence */

/**
 * @param {number} duration - Milliseconds to block.
 * @returns {void} - Returns after the duration.
 */
function sleep(duration) {
  const word = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(word, 0, 0, duration);
}

/** @returns {number} - Monotonic milliseconds since an arbitrary origin. */
function monotonicMilliseconds() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

/**
 * Run inside a short-lived Node wrapper so the synchronous caller can retain a
 * strict backstop while the wrapper owns and reaps a detached process group.
 * This function must remain self-contained because its source is passed to the
 * installed root boot observer with `node --eval`.
 * @returns {Promise<void>} - Emits one JSON result to stdout.
 */
async function processGroupSupervisorMain() {
  const { spawn } = await import('node:child_process');
  const { readFileSync, writeFileSync } = await import('node:fs');
  /** @type {Record<string, any>} */
  const input = JSON.parse(readFileSync(0, 'utf8'));
  /** @type {Buffer[]} */
  const stdout = [];
  /** @type {Buffer[]} */
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  /** @type {Record<string, any> | undefined} */
  let failure;
  let timedOut = false;
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let child;

  /**
   * @param {unknown} error - Process failure.
   * @returns {Record<string, any>} - Serializable error fields.
   */
  const serializeError = (error) => ({
    message: error instanceof Error ? error.message : String(error),
    code:
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : undefined,
    errno:
      error && typeof error === 'object' && 'errno' in error
        ? error.errno
        : undefined,
    syscall:
      error && typeof error === 'object' && 'syscall' in error
        ? String(error.syscall)
        : undefined,
    path:
      error && typeof error === 'object' && 'path' in error
        ? String(error.path)
        : undefined,
    spawnargs:
      error && typeof error === 'object' && 'spawnargs' in error
        ? error.spawnargs
        : undefined,
  });
  /**
   * @param {Record<string, any>} value - Supervisor result.
   * @returns {void} - Writes the result protocol.
   */
  const emit = (value) => {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  };
  const hardKillGroup = () => {
    if (!child?.pid) return;
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'ESRCH'
      ) {
        failure ??= serializeError(error);
      }
    }
  };
  /**
   * @param {Buffer | string} chunk - Child output.
   * @param {Buffer[]} target - Retained output chunks.
   * @param {'stdout' | 'stderr'} streamName - Output channel.
   */
  const collect = (chunk, target, streamName) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const used = streamName === 'stdout' ? stdoutBytes : stderrBytes;
    const remaining = Math.max(0, input.maxOutputBytes - used);
    if (remaining > 0) target.push(bytes.subarray(0, remaining));
    if (streamName === 'stdout') {
      stdoutBytes += Math.min(bytes.byteLength, remaining);
    } else {
      stderrBytes += Math.min(bytes.byteLength, remaining);
    }
    if (bytes.byteLength > remaining && !failure) {
      failure = {
        message: `spawnSync ${input.command} ENOBUFS`,
        code: 'ENOBUFS',
        errno: 'ENOBUFS',
        syscall: `spawnSync ${input.command}`,
        path: input.command,
        spawnargs: input.args,
      };
      hardKillGroup();
    }
  };

  try {
    child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    emit({
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
      error: serializeError(error),
    });
    return;
  }
  const runningChild = child;
  if (runningChild.pid) {
    writeFileSync(2, `WHARFIE_PROCESS_GROUP_PID=${runningChild.pid}\n`);
  }
  runningChild.stdout?.on('data', (chunk) => collect(chunk, stdout, 'stdout'));
  runningChild.stderr?.on('data', (chunk) => collect(chunk, stderr, 'stderr'));
  /** @type {{status: number | null, signal: NodeJS.Signals | null}} */
  const outcome = await new Promise((resolve) => {
    let settled = false;
    /**
     * @param {{status: number | null, signal: NodeJS.Signals | null}} value - Exit result.
     * @returns {void} - Resolves the wrapper once.
     */
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      failure ??= {
        message: `spawnSync ${input.command} ETIMEDOUT`,
        code: 'ETIMEDOUT',
        errno: 'ETIMEDOUT',
        syscall: `spawnSync ${input.command}`,
        path: input.command,
        spawnargs: input.args,
      };
      hardKillGroup();
    }, input.timeoutMs);
    runningChild.once('error', (error) => {
      failure ??= serializeError(error);
      if (!runningChild.pid) settle({ status: null, signal: null });
    });
    runningChild.once('close', (status, signal) => settle({ status, signal }));
  });
  if (timedOut) hardKillGroup();
  emit({
    ...outcome,
    stdout: Buffer.concat(stdout, stdoutBytes).toString('base64'),
    stderr: Buffer.concat(stderr, stderrBytes).toString('base64'),
    error: failure,
  });
}

const PROCESS_GROUP_SUPERVISOR_SOURCE = `await (${processGroupSupervisorMain.toString()})();`;

/**
 * @param {Record<string, any> | undefined} value - Serialized child error.
 * @returns {Error | undefined} - Spawn-compatible error.
 */
function reviveSupervisorError(value) {
  if (!value) return undefined;
  const error = new Error(String(value.message || 'process supervisor failed'));
  for (const key of ['code', 'errno', 'syscall', 'path', 'spawnargs']) {
    if (value[key] !== undefined) {
      Object.defineProperty(error, key, {
        configurable: true,
        enumerable: true,
        value: value[key],
      });
    }
  }
  return error;
}

/**
 * Best-effort backstop cleanup when the supervisor itself exceeds its bound.
 * @param {string} diagnostics - Wrapper-only stderr containing the reported group leader.
 * @returns {void} - Returns after issuing a hard group kill.
 */
function hardKillReportedProcessGroup(diagnostics) {
  const match = diagnostics.match(
    new RegExp(`^${SUPERVISOR_PID_PREFIX}(\\d+)$`, 'm'),
  );
  if (!match) return;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid < 1) return;
  try {
    if (process.platform === 'win32') process.kill(pid, 'SIGKILL');
    else process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'ESRCH'
    ) {
      throw error;
    }
  }
}

/**
 * Synchronously supervise one exact command in its own process group.
 * @param {string} command - Absolute executable path.
 * @param {string[]} args - Exact argv.
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs: number}} options - Process policy.
 * @returns {{status: number | null, stdout: string, stderr: string, error?: Error}} - Spawn-compatible result.
 */
function spawnProcessGroupSync(command, args, options) {
  const targetTimeoutMs = Math.max(
    1,
    options.timeoutMs -
      Math.min(
        SUPERVISOR_SETTLE_RESERVE_MS,
        Math.max(1, Math.floor(options.timeoutMs / 5)),
      ),
  );
  const wrapper = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', PROCESS_GROUP_SUPERVISOR_SOURCE],
    {
      encoding: 'utf8',
      env: { LANG: 'C.UTF-8', PATH: '/usr/bin:/bin' },
      input: JSON.stringify({
        command,
        args,
        cwd: options.cwd,
        env: options.env ?? process.env,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        timeoutMs: targetTimeoutMs,
      }),
      killSignal: 'SIGKILL',
      maxBuffer: MAX_OUTPUT_BYTES * 3 + 64 * 1024,
      timeout: options.timeoutMs,
    },
  );
  if (wrapper.error || wrapper.status !== 0) {
    hardKillReportedProcessGroup(String(wrapper.stderr || ''));
    const wrapperTimedOut =
      /** @type {NodeJS.ErrnoException | undefined} */ (wrapper.error)?.code ===
      'ETIMEDOUT';
    return {
      status: null,
      stdout: '',
      stderr: String(wrapper.stderr || ''),
      error:
        (wrapperTimedOut
          ? reviveSupervisorError({
              code: 'ETIMEDOUT',
              errno: 'ETIMEDOUT',
              syscall: `spawnSync ${command}`,
              path: command,
              spawnargs: args,
              message: `spawnSync ${command} ETIMEDOUT`,
            })
          : wrapper.error) ??
        reviveSupervisorError({
          code: 'EPROTO',
          message: `process supervisor exited with status ${wrapper.status}`,
        }),
    };
  }
  let value;
  try {
    value = JSON.parse(String(wrapper.stdout || '').trim());
  } catch (error) {
    hardKillReportedProcessGroup(String(wrapper.stderr || ''));
    return {
      status: null,
      stdout: '',
      stderr: String(wrapper.stderr || ''),
      error: reviveSupervisorError({
        code: 'EPROTO',
        message: `process supervisor emitted invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      }),
    };
  }
  return {
    status: Number.isInteger(value.status) ? value.status : null,
    stdout: Buffer.from(String(value.stdout || ''), 'base64').toString('utf8'),
    stderr: Buffer.from(String(value.stderr || ''), 'base64').toString('utf8'),
    error: reviveSupervisorError(value.error),
  };
}

/**
 * @param {unknown} value - Candidate reader deadline.
 * @returns {number} - Validated timeout below the systemd unit's 150-second start deadline.
 */
function validateStatusTimeout(value) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > STATUS_TIMEOUT_MS
  ) {
    throw new TypeError(
      `Boot status timeoutMs must be an integer from 1 through ${STATUS_TIMEOUT_MS}.`,
    );
  }
  return Number(value);
}

/**
 * Run one exact command without a shell.
 * @param {string} command - Absolute executable path.
 * @param {string[]} args - Exact argv.
 * @param {{allowFailure?: boolean, timeoutMs?: number}} [options] - Failure and hard deadline policy.
 * @returns {{status: number, stdout: string, stderr: string}} - Process result.
 */
export function runBootCheckCommand(command, args, options = {}) {
  const timeoutMs = validateStatusTimeout(
    options.timeoutMs ?? STATUS_TIMEOUT_MS,
  );
  const result = spawnProcessGroupSync(command, args, { timeoutMs });
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
export function validateBootConfig(value) {
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
    'previousAuthority',
    'previousReadiness',
    'installedPackageRoot',
  ];
  assert.deepEqual(Object.keys(config).sort(), [...keys].sort());
  assert.equal(config.schemaVersion, 2);
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
    'installedPackageRoot',
  ]) {
    assert.equal(
      path.isAbsolute(config[name]),
      true,
      `${name} must be absolute`,
    );
    assert.equal(path.normalize(config[name]), config[name]);
    assert.doesNotMatch(config[name], /[\0\r\n]/);
  }
  assert.equal(config.xdgDataHome, path.join(config.home, '.local', 'share'));
  assert.ok(hasExactKeys(config.previousAuthority, AUTHORITY_KEYS));
  assert.equal(config.previousAuthority.schemaVersion, 1);
  assert.equal(config.previousAuthority.status, 'ACTIVE');
  assert.equal(config.previousAuthority.appId, config.appId);
  assert.equal(config.previousAuthority.releasedAt, null);
  assert.ok(hasExactKeys(config.previousReadiness, READINESS_KEYS));
  assert.equal(config.previousReadiness.status, 'ADOPTED');
  assert.equal(config.previousReadiness.app_id, config.appId);
  assert.equal(config.previousReadiness.provider, 'lmdb');
  assert.equal(config.previousReadiness.namespace, config.appId);
  for (const [field, expected] of Object.entries({
    authority_schema_version: config.previousAuthority.schemaVersion,
    coordinator_id: config.previousAuthority.coordinatorId,
    authority_id: config.previousAuthority.authorityId,
    epoch: config.previousAuthority.epoch,
  })) {
    assert.equal(config.previousReadiness[field], expected);
  }
  // The installed production validators revalidate both complete records,
  // including all content digests, before opening either native volume.
  return Object.freeze({ ...config });
}

/**
 * Return active login sessions for the proof UID before any unprivileged
 * status process is launched. A lingering user manager is not a login session.
 * @param {number} uid - Proof user ID.
 * @param {number} [timeoutMs] - Remaining shared observation budget.
 * @returns {string[]} - Matching loginctl rows.
 */
function readUserSessions(uid, timeoutMs = STATUS_TIMEOUT_MS) {
  const result = runBootCheckCommand(
    '/usr/bin/loginctl',
    ['list-sessions', '--no-legend', '--no-pager'],
    { timeoutMs },
  );
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.split(/\s+/)[1] === String(uid));
}

/**
 * Run a fixed read-only command as the proof UID without PAM or a login
 * session. Neither this wrapper nor setpriv starts a missing user manager.
 * @param {Readonly<Record<string, any>>} config - Boot configuration.
 * @param {string[]} args - Exact executable path and command arguments.
 * @param {typeof runBootCheckCommand} [execute] - Command runner for focused argv tests.
 * @param {number} [timeoutMs] - Remaining shared observation budget.
 * @returns {CommandObservation} - One observation, including nonzero status JSON.
 */
export function runBootReadOnlyCommand(
  config,
  args,
  execute = runBootCheckCommand,
  timeoutMs = STATUS_TIMEOUT_MS,
) {
  const boundedTimeoutMs = validateStatusTimeout(timeoutMs);
  const result = execute(
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
      ...args,
    ],
    { allowFailure: true, timeoutMs: boundedTimeoutMs },
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
 * @param {number} [timeoutMs] - Remaining shared observation budget.
 * @returns {{result: ReturnType<typeof runBootCheckCommand>, parsed?: Record<string, any>}} - Status observation.
 */
function readPackagedStatus(config, timeoutMs = STATUS_TIMEOUT_MS) {
  return runBootReadOnlyCommand(
    config,
    [config.artifactPath, 'wharfie', 'service', 'status', '--json'],
    runBootCheckCommand,
    timeoutMs,
  );
}

/**
 * @param {unknown} value - Candidate object.
 * @param {Set<string>} keys - Required exact keys.
 * @returns {value is Record<string, any>} - Whether every and only required key is present.
 */
function hasExactKeys(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

/**
 * Require the booted installed release's exact status-V3 authorization.
 * @param {unknown} value - Candidate packaged status.
 * @param {Readonly<Record<string, any>>} config - Boot proof configuration.
 * @returns {value is Record<string, any>} - Whether the desired-convergence proof is exact.
 */
function hasBootDesiredConvergence(value, config) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const status = /** @type {Record<string, any>} */ (value);
  const proof = status.desiredConvergence;
  if (!hasExactKeys(proof, DESIRED_CONVERGENCE_KEYS)) return false;
  if (!hasExactKeys(proof.desired, DESIRED_RELEASE_KEYS)) return false;
  const unit = path.basename(config.unitPath);
  return (
    status.schemaVersion === 3 &&
    status.kind === 'wharfie.service.status' &&
    status.appId === config.appId &&
    status.unit === unit &&
    proof.schemaVersion === 1 &&
    proof.kind === 'wharfie.service.desired-convergence' &&
    proof.appId === config.appId &&
    proof.unit === unit &&
    proof.desired.artifactId === config.artifactId &&
    proof.desired.revisionId === config.revisionId &&
    proof.disposition === 'authorized' &&
    proof.basis === 'durable-active'
  );
}

/**
 * @param {Readonly<Record<string, any>>} config - Boot configuration.
 * @param {number} [timeoutMs] - Remaining shared observation budget.
 * @returns {{result: ReturnType<typeof runBootCheckCommand>, parsed?: Record<string, any>}} - Workflow observation.
 */
function inspectPackagedRun(config, timeoutMs = STATUS_TIMEOUT_MS) {
  return runBootReadOnlyCommand(
    config,
    [
      config.artifactPath,
      'wharfie',
      'inspect',
      '--run-id',
      config.runId,
      '--json',
    ],
    runBootCheckCommand,
    timeoutMs,
  );
}

/**
 * This function is deliberately self-contained: the root-owned observer sends
 * its fixed source to Node under setpriv, not a writable helper or a shell.
 * All DB access therefore occurs as the proof UID using installed modules.
 * Reads across volumes are not atomic; exact final control rechecks reject a
 * restart or handoff during the separate destination observation.
 * @param {Readonly<Record<string, any>>} config - Validated boot configuration.
 * @param {{openReadOnlyDB?: (options: {path: string, readOnly: true}) => import('../../src/core/lib/db/base.js').DBClient}} [ports] - Read-only adapter test port.
 * @returns {Promise<Readonly<Record<string, any>>>} - Verified native evidence.
 */
export async function readBootNativeEvidence(config, ports = {}) {
  /** @type {typeof import('node:assert/strict')} */
  const assert = (await import('node:assert/strict')).default;
  const { lstatSync, realpathSync } = await import('node:fs');
  const { default: path } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const installedModule = async (/** @type {string} */ relativePath) =>
    await import(
      pathToFileURL(path.join(config.installedPackageRoot, relativePath)).href
    );
  const [
    adapter,
    lifecycleModule,
    readinessModule,
    authorityModule,
    applicationModule,
    barrierModule,
    storageModule,
    dbConfig,
  ] = await Promise.all([
    installedModule('src/core/lib/db/adapters/lmdb.js'),
    installedModule('src/core/lib/db/tables/ledger-service-lifecycle.js'),
    installedModule('src/core/lib/db/tables/application-state-readiness.js'),
    installedModule('src/core/lib/db/tables/coordinator-authority.js'),
    installedModule('src/core/lib/db/tables/application-state.js'),
    installedModule('src/core/lib/db/tables/application-state-authority.js'),
    installedModule('src/core/runtime/local-app-storage.js'),
    installedModule('src/core/lib/config/db.js'),
  ]);
  const expectedToken = authorityModule.createCoordinatorAuthorityToken(
    config.previousAuthority,
  );
  assert.equal(config.previousAuthority.status, 'ACTIVE');
  assert.equal(expectedToken.appId, config.appId);
  const expectedReadiness =
    readinessModule.validateApplicationStateReadinessRecord(
      config.previousReadiness,
    );
  assert.equal(expectedReadiness.status, 'ADOPTED');
  assert.deepEqual(
    readinessModule.applicationStateReadinessAuthority(expectedReadiness),
    expectedToken,
  );
  assert.deepEqual(
    readinessModule.applicationStateReadinessDestination(expectedReadiness),
    {
      kind: 'application-state',
      version: 2,
      bindingId: 'primary',
      configuration: {
        provider: 'lmdb',
        storeId: expectedReadiness.store_id,
        tableName: dbConfig.APPLICATION_STATE_TABLE_NAME,
        namespace: config.appId,
      },
    },
  );
  const stateRoot = path.join(
    config.home,
    '.local',
    'share',
    'wharfie-nodejs',
    'applications',
    config.appId,
    'state',
  );
  const controlPath = path.join(stateRoot, 'control');
  const applicationStatePath = path.join(stateRoot, 'application-state');
  const tableName = storageModule.LOCAL_APP_EXECUTION_LEDGER_TABLE;
  const serviceId = lifecycleModule.createLedgerServiceId({
    appId: config.appId,
  });
  const volumes = [controlPath, applicationStatePath].map((storePath) => {
    const root = path.join(storePath, 'lmdb');
    const rootStat = lstatSync(root);
    assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink());
    const files = ['data.mdb', 'lock.mdb'].map((file) => {
      const stat = lstatSync(path.join(root, file), { bigint: true });
      assert.ok(stat.isFile() && !stat.isSymbolicLink());
      return stat;
    });
    return { root: realpathSync(root), files };
  });
  assert.notEqual(volumes[0].root, volumes[1].root);
  for (let index = 0; index < 2; index += 1) {
    const left = volumes[0].files[index];
    const right = volumes[1].files[index];
    assert.ok(left.dev !== right.dev || left.ino !== right.ino);
  }
  const openReadOnly = ports.openReadOnlyDB ?? adapter.default;
  const controlDB = openReadOnly({ path: controlPath, readOnly: true });
  try {
    const lifecycleStore = lifecycleModule.createLedgerServiceLifecycle({
      db: controlDB,
      tableName,
    });
    const ownershipStore = lifecycleModule.createLedgerServiceOwnership({
      db: controlDB,
      tableName,
    });
    const readinessStore = readinessModule.createApplicationStateReadinessStore(
      { db: controlDB, tableName },
    );
    const authorityStore = authorityModule.createCoordinatorAuthority({
      db: controlDB,
      tableName,
    });
    const lifecycle = await lifecycleStore.get({ serviceId });
    assert.ok(lifecycle);
    assert.equal(lifecycle.status, 'STOPPED');
    assert.equal(lifecycle.appId, config.appId);
    assert.equal(lifecycle.artifactId, config.artifactId);
    assert.equal(lifecycle.revisionId, config.revisionId);
    assert.ok(lifecycle.generation > config.minimumGeneration);
    assert.notEqual(lifecycle.sessionId, expectedToken.coordinatorId);
    const ownership = await ownershipStore.getOwnership({ serviceId });
    assert.equal(ownership, null);
    const readiness = await readinessStore.get({ appId: config.appId });
    const authority = await authorityStore.get({ appId: config.appId });
    assert.deepEqual(readiness, config.previousReadiness);
    assert.deepEqual(authority, config.previousAuthority);

    const applicationDB = openReadOnly({
      path: applicationStatePath,
      readOnly: true,
    });
    let storeIdentity;
    let destinationAuthority;
    try {
      const applicationTable = applicationModule.createApplicationStateTable({
        db: applicationDB,
        tableName: expectedReadiness.table_name,
      });
      storeIdentity = await applicationTable.assertStoreIdentity(
        expectedReadiness.store_id,
      );
      destinationAuthority = await applicationTable.readCoordinatorAuthority({
        storeId: expectedReadiness.store_id,
        namespace: config.appId,
      });
      assert.deepEqual(
        destinationAuthority,
        barrierModule.createApplicationStateCoordinatorAuthorityRecord({
          storeId: expectedReadiness.store_id,
          namespace: config.appId,
          authority: expectedToken,
        }),
      );
      assert.equal(
        destinationAuthority.record_digest,
        expectedReadiness.destination_authority_digest,
      );
    } finally {
      await applicationDB.close();
    }
    assert.deepEqual(
      await readinessStore.get({ appId: config.appId }),
      readiness,
    );
    assert.deepEqual(
      await authorityStore.get({ appId: config.appId }),
      authority,
    );
    assert.deepEqual(await lifecycleStore.get({ serviceId }), lifecycle);
    assert.deepEqual(
      await ownershipStore.getOwnership({ serviceId }),
      ownership,
    );
    return Object.freeze({
      lifecycle,
      ownership,
      readiness,
      authority,
      storeIdentity,
      destinationAuthority,
    });
  } finally {
    await controlDB.close();
  }
}

/**
 * @param {Readonly<Record<string, any>>} config - Boot configuration.
 * @param {typeof runBootCheckCommand} [execute] - Command runner for focused argv tests.
 * @param {number} [timeoutMs] - Remaining shared observation budget.
 * @returns {CommandObservation} - Read-only installed native observation.
 */
export function readBootNativeObservation(
  config,
  execute = runBootCheckCommand,
  timeoutMs = STATUS_TIMEOUT_MS,
) {
  return runBootReadOnlyCommand(
    config,
    [
      '/usr/local/bin/node',
      '--input-type=module',
      '--eval',
      `const evidence = await (${readBootNativeEvidence.toString()})(JSON.parse(process.argv[1])); process.stdout.write(JSON.stringify(evidence));`,
      JSON.stringify(config),
    ],
    execute,
    timeoutMs,
  );
}

/**
 * @param {Record<string, any>} status - Public service status, even on a nonzero exit.
 * @param {Readonly<Record<string, any>>} config - Boot configuration.
 * @returns {void} - Rejects healthy, stale, live-owner, or unverified observations.
 */
function assertBlockedStatus(status, config) {
  assert.ok(hasBootDesiredConvergence(status, config));
  assert.ok(
    ['starting', 'stopped', 'failed', 'degraded'].includes(status.health),
  );
  assert.equal(status.installation?.activeArtifactId, config.artifactId);
  assert.equal(status.installation?.activeRevisionId, config.revisionId);
  assert.equal(status.persistence?.linger, true);
  assert.equal(status.persistence?.unitEnabled, true);
  assert.equal(status.persistence?.bootEnabled, true);
  assert.equal(status.integrity?.status, 'verified');
  assert.equal(status.systemd?.fragmentPath, config.unitPath);
  assert.equal(status.systemd?.dropInPaths, '');
  assert.equal(status.systemd?.mainPid, 0);
  assert.equal(status.runtime?.status, 'STOPPED');
  assert.equal(status.runtime?.artifactId, config.artifactId);
  assert.equal(status.runtime?.revisionId, config.revisionId);
  assert.ok(Number.isSafeInteger(status.runtime?.generation));
  assert.ok(status.runtime.generation > config.minimumGeneration);
  assert.equal(status.runtime?.session, 'absent');
  assert.equal(status.runtime?.currentOwner, false);
  assert.equal(status.runtime?.processId, undefined);
  assert.equal(status.runtime?.ownerKind, undefined);
  assert.equal(status.runtime?.ownerGeneration, undefined);
}

/**
 * @param {Readonly<Record<string, any>>} config - Boot configuration.
 * @param {BootEvidence} evidence - Independently observed documents.
 * @returns {void} - Throws unless a fresh failed attempt preserved old authority and work.
 */
export function assertBlockedBootEvidence(config, evidence) {
  const { status, workflow, coordinatorInspection, readinessEvidence } =
    evidence;
  assertBlockedStatus(status, config);
  assert.deepEqual(coordinatorInspection, {
    schemaVersion: 1,
    kind: 'wharfie.coordinator-authority.inspection',
    authority: 'none',
    authoritative: false,
    integrity: { verified: true },
    scope: { appId: config.appId },
    observedAuthority: config.previousAuthority,
  });
  assert.deepEqual(readinessEvidence.authority, config.previousAuthority);
  assert.deepEqual(readinessEvidence.readiness, config.previousReadiness);
  assert.equal(readinessEvidence.ownership, null);
  const lifecycle = readinessEvidence.lifecycle;
  assert.equal(lifecycle.status, 'STOPPED');
  assert.equal(lifecycle.appId, config.appId);
  assert.equal(lifecycle.artifactId, config.artifactId);
  assert.equal(lifecycle.revisionId, config.revisionId);
  assert.equal(lifecycle.generation, status.runtime.generation);
  assert.notEqual(lifecycle.sessionId, config.previousAuthority.coordinatorId);
  assert.equal(
    readinessEvidence.storeIdentity.store_id,
    config.previousReadiness.store_id,
  );
  const barrier = readinessEvidence.destinationAuthority;
  for (const [field, expected] of Object.entries({
    store_id: config.previousReadiness.store_id,
    namespace: config.appId,
    authority_schema_version: config.previousAuthority.schemaVersion,
    coordinator_id: config.previousAuthority.coordinatorId,
    authority_id: config.previousAuthority.authorityId,
    epoch: config.previousAuthority.epoch,
    record_digest: config.previousReadiness.destination_authority_digest,
  })) {
    assert.equal(barrier[field], expected);
  }
  const timer = workflow?.timers?.[0];
  assert.equal(workflow?.run?.runId, config.runId);
  assert.equal(workflow?.run?.status, 'RUNNING');
  assert.equal(workflow?.workflowCursor?.disposition, 'TIMER_WAITING');
  assert.equal(workflow?.workflowCursor?.timerId, config.timer.timerId);
  assert.equal(workflow?.timers?.length, 1);
  assert.equal(timer?.status, 'WAITING');
  assert.equal(timer?.timerId, config.timer.timerId);
  assert.equal(timer?.scheduledAt, config.timer.scheduledAt);
  assert.equal(timer?.dueAt, config.timer.dueAt);
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

/**
 * Observe an automatic startup attempt, never initiate or recover one. A fresh
 * STOPPED lifecycle and no live current owner prove failure closed; the old
 * ACTIVE snapshot is not declared stale because of elapsed time or reboot.
 * @param {Readonly<Record<string, any>>} input - Root-owned configuration.
 * @param {{readBootId?: (timeoutMs: number) => string, readSessions?: (uid: number, timeoutMs: number) => string[], readStatus?: (config: Readonly<Record<string, any>>, timeoutMs: number) => CommandObservation, inspectRun?: (config: Readonly<Record<string, any>>, timeoutMs: number) => CommandObservation, inspectCoordinator?: (config: Readonly<Record<string, any>>, timeoutMs: number) => CommandObservation, readNative?: (config: Readonly<Record<string, any>>, timeoutMs: number) => CommandObservation, monotonicNow?: () => number, wallClockNow?: () => number, sleep?: (duration: number) => void, timeoutMs?: number}} [ports] - Read-only observation ports. Extra timeout arguments preserve compatibility with readers that ignore them.
 * @returns {Readonly<Record<string, any>>} - Receipt requiring explicit operator recovery.
 */
export function observeBlockedBoot(input, ports = {}) {
  const timeoutMs = validateStatusTimeout(ports.timeoutMs ?? STATUS_TIMEOUT_MS);
  const monotonicNow = ports.monotonicNow ?? monotonicMilliseconds;
  const wallClockNow = ports.wallClockNow ?? Date.now;
  const readMonotonicNow = () => {
    const observedAt = monotonicNow();
    if (!Number.isSafeInteger(observedAt)) {
      throw new TypeError(
        'Boot status monotonic clock must return a safe integer.',
      );
    }
    return observedAt;
  };
  const startedAt = readMonotonicNow();
  const deadline = startedAt + timeoutMs;
  if (!Number.isSafeInteger(deadline)) {
    throw new TypeError('Boot status deadline exceeds the safe integer range.');
  }
  /** @type {Record<string, any>} */
  let last = {};
  const deadlineError = () => {
    const error = new Error(
      `Packaged service did not prove a fail-closed startup attempt before login within its shared ${timeoutMs}ms monotonic operation deadline: ${JSON.stringify(last)}`,
    );
    error.name = 'BootStatusDeadlineExceeded';
    return error;
  };
  const remainingBudget = () => {
    const remainingMs = deadline - readMonotonicNow();
    if (remainingMs < 1) throw deadlineError();
    return Math.min(timeoutMs, remainingMs);
  };
  /**
   * @template T
   * @param {(timeoutMs: number) => T} reader - One synchronous observation.
   * @returns {T} - Observation completed before the shared deadline.
   */
  const readWithinDeadline = (reader) => {
    const observed = reader(remainingBudget());
    remainingBudget();
    return observed;
  };
  const config = validateBootConfig(input);
  remainingBudget();
  const bootIdReader =
    ports.readBootId ??
    (() => readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim());
  const bootId = readWithinDeadline((budget) => bootIdReader(budget));
  assert.match(
    bootId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  assert.notEqual(bootId, config.previousBootId, 'VM boot ID did not change.');
  const sessions = ports.readSessions ?? readUserSessions;
  const sessionsBeforeCheck = readWithinDeadline((budget) =>
    sessions(config.uid, budget),
  );
  assert.deepEqual(
    sessionsBeforeCheck,
    [],
    'Proof user had a login session before the boot check.',
  );
  const pause = ports.sleep ?? sleep;
  const statusReader = ports.readStatus ?? readPackagedStatus;
  const workflowReader = ports.inspectRun ?? inspectPackagedRun;
  const coordinatorReader =
    ports.inspectCoordinator ??
    ((config, timeoutMs) =>
      runBootReadOnlyCommand(
        config,
        [config.artifactPath, 'wharfie', 'coordinator', 'inspect', '--json'],
        runBootCheckCommand,
        timeoutMs,
      ));
  const nativeReader =
    ports.readNative ??
    ((config, timeoutMs) =>
      readBootNativeObservation(config, runBootCheckCommand, timeoutMs));
  while (true) {
    remainingBudget();
    /** @type {BootEvidence} */
    let evidence;
    let statusExitCode;
    try {
      const initialStatus = readWithinDeadline((budget) =>
        statusReader(config, budget),
      );
      last = { initialStatus };
      assert.ok(
        initialStatus.parsed,
        'Service status returned no JSON document.',
      );
      assertBlockedStatus(initialStatus.parsed, config);
      const workflow = readWithinDeadline((budget) =>
        workflowReader(config, budget),
      );
      last.workflow = workflow;
      assert.equal(workflow.result.status, 0);
      assert.ok(workflow.parsed);
      const coordinator = readWithinDeadline((budget) =>
        coordinatorReader(config, budget),
      );
      last.coordinator = coordinator;
      assert.equal(coordinator.result.status, 0);
      assert.ok(coordinator.parsed);
      const native = readWithinDeadline((budget) =>
        nativeReader(config, budget),
      );
      last.native = native;
      assert.equal(native.result.status, 0);
      assert.ok(native.parsed);
      const finalStatus = readWithinDeadline((budget) =>
        statusReader(config, budget),
      );
      last.finalStatus = finalStatus;
      assert.ok(finalStatus.parsed);
      assert.deepEqual(
        finalStatus.parsed.runtime,
        initialStatus.parsed.runtime,
        'Resident lifecycle changed during boot observation.',
      );
      evidence = {
        status: finalStatus.parsed,
        workflow: workflow.parsed,
        coordinatorInspection: coordinator.parsed,
        readinessEvidence: native.parsed,
      };
      assertBlockedBootEvidence(config, evidence);
      statusExitCode = finalStatus.result.status;
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'BootStatusDeadlineExceeded'
      ) {
        throw error;
      }
      last.reason = error instanceof Error ? error.message : String(error);
      pause(Math.min(STATUS_POLL_INTERVAL_MS, remainingBudget()));
      continue;
    }
    // A login is a fatal loss of the pre-login proof, not a transient startup
    // failure that can be retried until that user logs out again.
    const sessionsAfterCheck = readWithinDeadline((budget) =>
      sessions(config.uid, budget),
    );
    assert.deepEqual(
      sessionsAfterCheck,
      [],
      'Proof user logged in during the boot check.',
    );
    if (readMonotonicNow() >= deadline) throw deadlineError();
    const observedAt = wallClockNow();
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
      throw new TypeError(
        'Boot receipt wall clock must return a nonnegative safe integer.',
      );
    }
    return Object.freeze({
      schemaVersion: 2,
      kind: 'wharfie.systemd-proof.boot-receipt',
      commit: config.commit,
      observedAt,
      bootId,
      previousBootId: config.previousBootId,
      sessionsBeforeCheck,
      sessionsAfterCheck,
      automaticStart: false,
      automaticStartAttempt: true,
      recoveryRequired: 'explicit-coordinator-takeover',
      statusExitCode,
      ...evidence,
    });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const config = validateBootConfig(
    JSON.parse(readFileSync(CONFIG_PATH, 'utf8')),
  );
  const receipt = observeBlockedBoot(config);
  writeReceipt(config.receiptPath, receipt);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}
