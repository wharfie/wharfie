import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { fileURLToPath } from 'node:url';

import { sortCanonicalJsonValue } from '../src/core/runtime/canonical-order.js';
import {
  STEADY_FILE_PREVIEW_HANDOFF_FILES,
  validateSteadyFilePreviewHandoff,
} from './steady-file-preview-handoff.js';

const APP_ID = 'steady-file-demo';
const WORKFLOW_ID = 'verify-stable';
const UNIT_NAME = `wharfie-${APP_ID}.service`;
const TARGET_ROOT = '/home/wharfie/preview';
const TARGET_HANDOFF_ROOT = `${TARGET_ROOT}/handoff`;
const TARGET_INPUT_PATH = `${TARGET_ROOT}/artifact.tar`;
const SOURCE_ARTIFACT_PATH = `${TARGET_HANDOFF_ROOT}/source/app`;
const TARGET_ARTIFACT_PATH = `${TARGET_HANDOFF_ROOT}/target/app`;
const TARGET_APPLICATIONS_ROOT =
  '/home/wharfie/.local/share/wharfie-nodejs/applications';
const PACKAGED_PATH =
  '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const STATUS_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 250;

/**
 * @typedef RemoteResult
 * @property {number} status - Exit status.
 * @property {string} stdout - Standard output.
 * @property {string} stderr - Standard error.
 */

/**
 * Create the sole target transport. Every target effect is one exact
 * `limactl shell` argv; no shell parser is admitted.
 * @param {string} instance - Exact Lima instance.
 * @param {{spawn?: (command: string, args: string[], options: Record<string, any>) => {error?: Error, status?: number | null, stdout?: string | Buffer, stderr?: string | Buffer}, command?: string, environment?: NodeJS.ProcessEnv}} [options] - Testable host adapter.
 * @returns {Readonly<{run: (command: string, args?: string[], options?: {allowFailure?: boolean, input?: string | Buffer, timeoutMs?: number}) => RemoteResult}>} - Exact remote port.
 */
export function createSteadyFilePreviewRemote(instance, options = {}) {
  if (
    typeof instance !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(instance)
  ) {
    throw new TypeError('steady-file target instance must be a safe name.');
  }
  const spawn = options.spawn || spawnSync;
  const command = options.command || 'limactl';
  const environment = options.environment || process.env;
  return Object.freeze({
    run(remoteCommand, args = [], runOptions = {}) {
      if (
        typeof remoteCommand !== 'string' ||
        !remoteCommand.startsWith('/') ||
        !Array.isArray(args) ||
        args.some((value) => typeof value !== 'string')
      ) {
        throw new TypeError(
          'steady-file target commands require an absolute executable and string argv.',
        );
      }
      if (
        ['/bin/sh', '/bin/bash', '/usr/bin/sh', '/usr/bin/bash'].includes(
          remoteCommand,
        )
      ) {
        throw new Error('steady-file target commands may not invoke a shell.');
      }
      const result = spawn(
        command,
        ['shell', '--tty=false', instance, remoteCommand, ...args],
        {
          encoding: 'utf8',
          env: environment,
          input: runOptions.input,
          maxBuffer: MAX_OUTPUT_BYTES,
          timeout: runOptions.timeoutMs || 180_000,
          windowsHide: true,
        },
      );
      if (result.error) throw result.error;
      const output = {
        status: result.status ?? 1,
        stdout: String(result.stdout || ''),
        stderr: String(result.stderr || ''),
      };
      if (output.status !== 0 && runOptions.allowFailure !== true) {
        const detail = output.stderr.trim() || output.stdout.trim();
        throw new Error(
          `${remoteCommand} failed with exit ${output.status}: ${detail.slice(0, 4096)}`,
        );
      }
      return output;
    },
  });
}

/**
 * @param {RemoteResult} result - Completed command.
 * @param {string} label - Stable assertion label.
 * @returns {Record<string, any>} - Exact JSON object.
 */
function parseJson(result, label) {
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
  const trimmed = result.stdout.trim();
  assert.ok(trimmed, `${label} returned no JSON`);
  let value;
  try {
    value = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON.`, { cause: error });
  }
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value;
}

/**
 * @param {string} text - Complete stdout or stderr text.
 * @param {string} label - Stable assertion label.
 * @returns {Record<string, any>} - Final-line JSON object.
 */
function parseFinalJsonText(text, label) {
  const finalLine = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  assert.ok(finalLine, `${label} returned no JSON`);
  let value;
  try {
    value = JSON.parse(finalLine);
  } catch (error) {
    throw new Error(`${label} returned invalid final-line JSON.`, {
      cause: error,
    });
  }
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value;
}

/**
 * @param {RemoteResult} result - Completed command.
 * @param {string} label - Stable assertion label.
 * @returns {Record<string, any>} - Final-line JSON object.
 */
function parseFinalJson(result, label) {
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
  return parseFinalJsonText(result.stdout, label);
}

/**
 * @param {string} filePath - Local receipt path.
 * @param {unknown} value - JSON value.
 * @returns {void}
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
 * @param {string} filePath - Local file.
 * @returns {string} - Hex SHA-256.
 */
function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * @param {Readonly<{run: Function}>} remote - Target port.
 * @param {string} artifactPath - Target SEA.
 * @param {string[]} args - App/operator argv.
 * @param {{allowFailure?: boolean, timeoutMs?: number}} [options] - Process options.
 * @returns {RemoteResult} - Target command result.
 */
function runArtifact(remote, artifactPath, args, options = {}) {
  return remote.run(
    '/usr/bin/env',
    [`PATH=${PACKAGED_PATH}`, artifactPath, ...args],
    options,
  );
}

/**
 * @param {Readonly<{run: Function}>} remote - Target port.
 * @param {string} artifactPath - Target SEA.
 * @param {string[]} args - App/operator argv.
 * @param {string} label - Assertion label.
 * @returns {Record<string, any>} - JSON result.
 */
function runArtifactJson(remote, artifactPath, args, label) {
  return parseFinalJson(runArtifact(remote, artifactPath, args), label);
}

/**
 * Exercise the public retry contract when destructive purge starts but does
 * not converge on its first attempt.
 * @param {Readonly<{run: Function}>} remote - Target port.
 * @param {string} artifactPath - Target SEA.
 * @returns {Readonly<{receipt: Record<string, any>, recovery: null | Readonly<Record<string, any>>}>} - Purge result and bounded recovery evidence.
 */
export function purgeSteadyFilePreviewApplication(remote, artifactPath) {
  const args = [
    'wharfie',
    'service',
    'purge',
    '--confirm-data-loss',
    APP_ID,
    '--json',
  ];
  const first = runArtifact(remote, artifactPath, args, {
    allowFailure: true,
  });
  if (first.status === 0) {
    return Object.freeze({
      receipt: parseFinalJson(first, 'steady-file application-data purge'),
      recovery: null,
    });
  }
  const failure = parseFinalJsonText(
    first.stderr.trim() || first.stdout,
    'steady-file application-data purge failure',
  );
  assert.deepEqual(failure, {
    schemaVersion: 1,
    kind: 'wharfie.service.error',
    action: 'purge',
    code: 'systemd-user-service-purge-incomplete',
    message: 'Systemd user-service purge was interrupted and is safe to retry.',
    remediation:
      'Retry service purge with the same --confirm-data-loss application ID.',
  });
  const retry = runArtifact(remote, artifactPath, args, {
    allowFailure: true,
  });
  if (retry.status !== 0) {
    const retryFailure = parseFinalJsonText(
      retry.stderr.trim() || retry.stdout,
      'steady-file application-data purge retry failure',
    );
    assert.deepEqual(retryFailure, failure);
    const tree = remote.run(
      '/usr/bin/find',
      [
        TARGET_APPLICATIONS_ROOT,
        '-xdev',
        '-printf',
        '%y %m %U:%G %D:%i %s %p\\n',
      ],
      { allowFailure: true },
    );
    throw new Error(
      [
        'Steady-file application-data purge did not converge after its exact public retry.',
        `failure=${JSON.stringify(retryFailure)}`,
        `diagnosticStatus=${tree.status}`,
        `diagnostic=${(tree.stdout || tree.stderr).trim().slice(0, 64 * 1024)}`,
      ].join('\n'),
    );
  }
  const receipt = parseFinalJson(
    retry,
    'steady-file application-data purge retry',
  );
  return Object.freeze({
    receipt,
    recovery: Object.freeze({
      required: true,
      firstFailure: failure,
      attemptCount: 2,
    }),
  });
}

/**
 * @param {Readonly<{run: Function}>} remote - Target port.
 * @param {string} artifactPath - Target SEA.
 * @returns {Record<string, any>} - Service status.
 */
function readServiceStatus(remote, artifactPath) {
  return runArtifactJson(
    remote,
    artifactPath,
    ['wharfie', 'service', 'status', '--json'],
    'steady-file service status',
  );
}

/**
 * @param {Readonly<{run: Function}>} remote - Target port.
 * @param {string} artifactPath - Target SEA.
 * @param {string} runId - Durable run ID.
 * @returns {Record<string, any>} - Redacted run view.
 */
function inspectRun(remote, artifactPath, runId) {
  return runArtifactJson(
    remote,
    artifactPath,
    ['wharfie', 'inspect', '--run-id', runId, '--json'],
    'steady-file run inspection',
  );
}

/**
 * @param {Readonly<{run: Function}>} remote - Target port.
 * @param {string} artifactPath - Target SEA.
 * @returns {Record<string, any>} - App run page.
 */
function listRuns(remote, artifactPath) {
  return runArtifactJson(
    remote,
    artifactPath,
    ['wharfie', 'list', '--limit', '10', '--json'],
    'steady-file run history',
  );
}

/**
 * @param {Readonly<{run: Function}>} remote - Target port.
 * @param {string} artifactPath - Target SEA.
 * @param {string} runId - Durable run ID.
 * @returns {Record<string, any>} - Verified logical output.
 */
function readOutput(remote, artifactPath, runId) {
  return runArtifactJson(
    remote,
    artifactPath,
    [
      'wharfie',
      'output',
      '--run-id',
      runId,
      '--confirm-sensitive-output',
      '--json',
    ],
    'steady-file logical output',
  );
}

/**
 * @param {number} duration - Milliseconds.
 * @returns {Promise<void>}
 */
function wait(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

/**
 * @template T
 * @param {() => T} observe - Observation.
 * @param {(value: T) => boolean} matches - Completion predicate.
 * @param {string} label - Timeout label.
 * @param {{now?: () => number, wait?: (duration: number) => Promise<void>}} [options] - Testable clock.
 * @returns {Promise<T>} - Matching observation.
 */
async function waitFor(observe, matches, label, options = {}) {
  const now = options.now || Date.now;
  const pause = options.wait || wait;
  const deadline = now() + STATUS_TIMEOUT_MS;
  let last;
  while (now() < deadline) {
    last = observe();
    if (matches(last)) return last;
    await pause(POLL_INTERVAL_MS);
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
}

/**
 * @param {Record<string, any>} value - Candidate ordinary result.
 * @param {string} inputPath - Exact target input.
 * @param {Record<string, any>} expected - Path-independent builder result.
 * @returns {void}
 */
export function assertStableDecision(value, inputPath, expected) {
  assert.equal(value.path, inputPath);
  const normalized = { ...value };
  delete normalized.path;
  assert.equal(
    JSON.stringify(sortCanonicalJsonValue(normalized)),
    JSON.stringify(sortCanonicalJsonValue(expected)),
  );
}

/**
 * @param {Record<string, any>} page - History page.
 * @param {string} runId - Expected run.
 * @param {string} revisionId - Expected revision.
 * @param {string} status - Expected state.
 * @returns {Record<string, any>} - Matching row.
 */
function assertHistory(page, runId, revisionId, status) {
  assert.equal(page.schemaVersion, 1);
  assert.equal(page.kind, 'wharfie.execution-ledger.run-page');
  assert.equal(page.authority, 'none');
  assert.equal(page.authoritative, false);
  assert.deepEqual(page.integrity, { verified: true });
  assert.deepEqual(page.scope, { appId: APP_ID });
  assert.equal(page.nextCursor, null);
  assert.ok(Array.isArray(page.items));
  const row = page.items.find((item) => item.runId === runId);
  assert.ok(row, `history omitted ${runId}`);
  assert.equal(row.revisionId, revisionId);
  assert.equal(row.kind, 'workflow');
  assert.equal(row.status, status);
  return row;
}

/**
 * @param {Record<string, any>} view - Redacted run view.
 * @param {number} observedAt - Controller observation time.
 * @param {number} minimumRemainingMs - Required timer margin.
 * @returns {Readonly<Record<string, any>>} - Bounded unfinished evidence.
 */
function assertUnfinishedDurableWindow(view, observedAt, minimumRemainingMs) {
  assert.equal(view.run?.status, 'RUNNING');
  assert.equal(view.workflowCursor?.disposition, 'TIMER_WAITING');
  assert.equal(view.workflowCursor?.stepId, 'stability-window');
  assert.equal(view.workflowCursor?.stepIndex, 1);
  assert.equal(view.timers?.length, 1);
  const timer = view.timers[0];
  assert.equal(timer.status, 'WAITING');
  assert.equal(timer.stepId, 'stability-window');
  assert.equal(timer.stepIndex, 1);
  assert.equal(view.workflowCursor.timerId, timer.timerId);
  assert.equal(timer.dueAt - timer.scheduledAt, 60_000);
  const remainingMs = timer.dueAt - observedAt;
  assert.ok(
    remainingMs >= minimumRemainingMs,
    `steady-file durable timer has only ${remainingMs} ms remaining`,
  );
  return Object.freeze({
    observedAt,
    timerId: timer.timerId,
    scheduledAt: timer.scheduledAt,
    dueAt: timer.dueAt,
    remainingMs,
    view,
  });
}

/**
 * @param {Record<string, any>} output - Logical output.
 * @param {string} runId - Expected run.
 * @param {string} revisionId - Expected revision.
 * @param {string} inputPath - Exact target input.
 * @param {Record<string, any>} expected - Path-independent result.
 * @returns {void}
 */
function assertCompletedOutput(output, runId, revisionId, inputPath, expected) {
  assert.equal(output.schemaVersion, 1);
  assert.equal(output.kind, 'wharfie.execution-ledger.run-output');
  assert.equal(output.authority, 'none');
  assert.equal(output.authoritative, false);
  assert.equal(output.disclosure, 'application-sensitive-unredacted');
  assert.deepEqual(output.integrity, { verified: true });
  assert.deepEqual(output.scope, { appId: APP_ID, revisionId, runId });
  assert.equal(output.snapshot?.runKind, 'workflow');
  assert.equal(output.snapshot?.status, 'COMPLETED');
  assert.deepEqual(
    output.outputs?.map(
      (/** @type {Record<string, any>} */ entry) => entry.stepId,
    ),
    ['baseline', 'stability-window', 'comparison'],
  );
  assertStableDecision(output.outputs.at(-1)?.value, inputPath, expected);
  assert.equal(output.terminal?.type, 'completed');
  assertStableDecision(output.terminal?.result, inputPath, expected);
}

/**
 * @param {Readonly<{run: Function}>} remote - Target port.
 * @param {string} targetPath - Remote file.
 * @returns {string} - Hex SHA-256.
 */
function remoteSha256(remote, targetPath) {
  const result = remote.run('/usr/bin/sha256sum', ['--', targetPath]);
  const match = /^([0-9a-f]{64}) {2}/.exec(result.stdout);
  assert.ok(match, `invalid sha256sum output for ${targetPath}`);
  return match[1];
}

/**
 * @param {Readonly<{run: Function}>} remote - Target port.
 * @param {string} targetPath - Remote path.
 * @returns {boolean} - Whether lstat-style path presence is reported.
 */
function remoteExists(remote, targetPath) {
  return (
    remote.run('/usr/bin/test', ['-e', targetPath], {
      allowFailure: true,
    }).status === 0
  );
}

/**
 * @param {Readonly<{run: Function}>} remote - Target port.
 * @param {string} targetPath - Remote path.
 * @returns {boolean} - Whether neither an entry nor symlink exists.
 */
function remotePathAbsent(remote, targetPath) {
  return (
    remoteExists(remote, targetPath) === false &&
    remote.run('/usr/bin/test', ['-L', targetPath], {
      allowFailure: true,
    }).status !== 0
  );
}

/**
 * @param {Readonly<{run: Function}>} remote - Target port.
 * @returns {Readonly<Record<string, any>>} - Node-free target identity.
 */
function inspectTarget(remote) {
  const uidOutput = remote.run('/usr/bin/id', ['-u']).stdout.trim();
  assert.match(uidOutput, /^[1-9][0-9]*$/);
  const uid = Number(uidOutput);
  const passwd = remote
    .run('/usr/bin/getent', ['passwd', uidOutput])
    .stdout.trim();
  const fields = passwd.split(':');
  assert.equal(fields.length, 7);
  assert.equal(fields[0], 'wharfie');
  assert.equal(fields[2], uidOutput);
  assert.match(fields[3], /^[1-9][0-9]*$/);
  const gid = Number(fields[3]);
  const home = fields[5];
  assert.equal(home, '/home/wharfie');
  const machineId = remote
    .run('/usr/bin/cat', ['/etc/machine-id'])
    .stdout.trim();
  assert.match(machineId, /^[0-9a-f]{32}$/);
  const node = remote.run(
    '/usr/bin/env',
    [`PATH=${PACKAGED_PATH}`, 'node', '--version'],
    {
      allowFailure: true,
    },
  );
  const npm = remote.run(
    '/usr/bin/env',
    [`PATH=${PACKAGED_PATH}`, 'npm', '--version'],
    {
      allowFailure: true,
    },
  );
  assert.notEqual(node.status, 0, 'clean target unexpectedly exposes Node');
  assert.notEqual(npm.status, 0, 'clean target unexpectedly exposes npm');
  const linger = remote
    .run('/usr/bin/loginctl', [
      'show-user',
      uidOutput,
      '--property=Linger',
      '--value',
    ])
    .stdout.trim();
  assert.equal(linger, 'yes');
  remote.run('/usr/bin/systemctl', ['--user', 'show-environment']);
  return Object.freeze({
    uid,
    gid,
    home,
    machineId,
    nodeAbsent: true,
    npmAbsent: true,
    linger: true,
  });
}

/**
 * @param {Record<string, any>} reference - Candidate release reference.
 * @param {Record<string, any>} expected - Handoff artifact.
 * @param {string} label - Assertion label.
 * @returns {void}
 */
function assertReleaseReference(reference, expected, label) {
  assert.deepEqual(
    reference,
    {
      artifactId: expected.artifactId,
      revisionId: expected.revisionId,
    },
    label,
  );
}

/**
 * @param {Readonly<{run: Function}>} remote - Target port.
 * @param {Record<string, any>} targetIdentity - Target identity.
 * @param {Record<string, any>} status - Service status.
 * @param {Record<string, any>} current - Selected artifact.
 * @param {Record<string, any> | null} rollback - Rollback artifact.
 * @returns {Readonly<Record<string, any>>} - Bounded healthy evidence.
 */
function assertHealthy(remote, targetIdentity, status, current, rollback) {
  const unitPath = path.posix.join(
    targetIdentity.home,
    '.config',
    'systemd',
    'user',
    UNIT_NAME,
  );
  const releasesRoot = path.posix.join(
    targetIdentity.home,
    '.local',
    'share',
    'wharfie-nodejs',
    'applications',
    APP_ID,
    'releases',
  );
  assert.equal(status.schemaVersion, 3);
  assert.equal(status.kind, 'wharfie.service.status');
  assert.equal(status.appId, APP_ID);
  assert.equal(status.unit, UNIT_NAME);
  assert.equal(status.health, 'healthy');
  assert.equal(status.persistence?.linger, true);
  assert.equal(status.persistence?.unitEnabled, true);
  assert.equal(status.persistence?.bootEnabled, true);
  assert.equal(status.systemd?.fragmentPath, unitPath);
  assert.equal(status.systemd?.dropInPaths, '');
  assert.ok(status.systemd?.mainPid > 0);
  assert.equal(status.runtime?.processId, status.systemd.mainPid);
  assert.equal(status.runtime?.status, 'READY');
  assert.equal(status.runtime?.session, 'active');
  assert.equal(status.runtime?.currentOwner, true);
  assert.equal(status.integrity?.status, 'verified');
  assert.equal(status.installation?.activeArtifactId, current.artifactId);
  assert.equal(status.installation?.activeRevisionId, current.revisionId);
  assert.equal(
    status.installation?.previousArtifactId || null,
    rollback?.artifactId || null,
  );
  assert.equal(
    status.installation?.previousRevisionId || null,
    rollback?.revisionId || null,
  );
  assertReleaseReference(status.activation?.selected, current, 'selected');
  if (rollback) {
    assertReleaseReference(status.activation?.rollback, rollback, 'rollback');
  } else {
    assert.equal(status.activation?.rollback, null);
  }
  assert.equal(status.activation?.phase, 'ACTIVE');
  assert.equal(status.desiredConvergence?.disposition, 'authorized');
  assertReleaseReference(
    status.desiredConvergence?.desired,
    current,
    'desired artifact',
  );
  const releasePath = path.posix.join(releasesRoot, current.artifactId, 'app');
  assert.equal(remoteSha256(remote, releasePath), current.sha256);
  assert.equal(
    remote
      .run('/usr/bin/readlink', [`/proc/${status.systemd.mainPid}/exe`])
      .stdout.trim(),
    releasePath,
  );
  return Object.freeze({
    artifactId: current.artifactId,
    revisionId: current.revisionId,
    processId: status.systemd.mainPid,
    generation: status.runtime.generation,
    releasePath,
    releaseSha256: current.sha256,
  });
}

/**
 * @param {Record<string, any>} receipt - Lifecycle receipt.
 * @param {'update'|'rollback'} action - Action.
 * @param {Record<string, any>} current - Selected artifact.
 * @param {Record<string, any>} rollback - Rollback artifact.
 * @returns {void}
 */
function assertActivationReceipt(receipt, action, current, rollback) {
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.kind, 'wharfie.service.result');
  assert.equal(receipt.action, action);
  assert.equal(receipt.requestStatus, 'fulfilled');
  assert.equal(receipt.outcome, 'target-active');
  assert.equal(receipt.health, 'healthy');
  assert.equal(receipt.activeArtifactId, current.artifactId);
  assert.equal(receipt.activeRevisionId, current.revisionId);
  assert.equal(receipt.rollbackArtifactId, rollback.artifactId);
  assert.equal(receipt.rollbackRevisionId, rollback.revisionId);
}

/**
 * @param {Readonly<{run: Function}>} remote - Target port.
 * @param {Record<string, any>} targetIdentity - Target identity.
 * @returns {Readonly<Record<string, any>>} - Independent systemd absence.
 */
function readIndependentSystemdAbsence(remote, targetIdentity) {
  const properties = [
    'LoadState',
    'UnitFileState',
    'ActiveState',
    'SubState',
    'MainPID',
    'FragmentPath',
    'DropInPaths',
    'NeedDaemonReload',
  ];
  const args = ['--user', 'show', UNIT_NAME, '--no-pager'];
  for (const property of properties) args.push(`--property=${property}`);
  const show = remote.run('/usr/bin/systemctl', args);
  /** @type {Record<string, string>} */
  const observed = {};
  for (const line of show.stdout.trim().split('\n').filter(Boolean)) {
    const separator = line.indexOf('=');
    assert.ok(separator > 0);
    const key = line.slice(0, separator);
    assert.ok(properties.includes(key));
    assert.equal(Object.hasOwn(observed, key), false);
    observed[key] = line.slice(separator + 1);
  }
  assert.deepEqual(Object.keys(observed).sort(), [...properties].sort());
  assert.equal(observed.MainPID, '0');
  assert.equal(observed.LoadState, 'not-found');
  assert.equal(observed.ActiveState, 'inactive');
  assert.equal(observed.SubState, 'dead');
  assert.equal(observed.FragmentPath, '');
  assert.equal(observed.DropInPaths, '');
  assert.equal(observed.NeedDaemonReload, 'no');
  assert.ok(['', 'disabled', 'not-found'].includes(observed.UnitFileState));
  const active = remote.run(
    '/usr/bin/systemctl',
    ['--user', 'is-active', UNIT_NAME],
    {
      allowFailure: true,
    },
  );
  const enabled = remote.run(
    '/usr/bin/systemctl',
    ['--user', 'is-enabled', UNIT_NAME],
    {
      allowFailure: true,
    },
  );
  assert.notEqual(active.status, 0);
  assert.notEqual(enabled.status, 0);
  const unitPath = path.posix.join(
    targetIdentity.home,
    '.config',
    'systemd',
    'user',
    UNIT_NAME,
  );
  const wantsPath = path.posix.join(
    path.posix.dirname(unitPath),
    'default.target.wants',
    UNIT_NAME,
  );
  assert.equal(remotePathAbsent(remote, unitPath), true);
  assert.equal(remotePathAbsent(remote, wantsPath), true);
  return Object.freeze({
    show: observed,
    isActive: { status: active.status, output: active.stdout.trim() },
    isEnabled: { status: enabled.status, output: enabled.stdout.trim() },
  });
}

/**
 * @param {string} handoffRoot - Local handoff root.
 * @param {Readonly<{run: Function}>} remote - Target port.
 * @returns {Record<string, any>} - Validated local/remote handoff.
 */
function verifyTargetHandoff(handoffRoot, remote) {
  const { handoff, files } = validateSteadyFilePreviewHandoff(handoffRoot);
  const observedTree = remote
    .run('/usr/bin/find', [
      TARGET_HANDOFF_ROOT,
      '-mindepth',
      '1',
      '-printf',
      '%P\t%y\n',
    ])
    .stdout.trim()
    .split('\n')
    .filter(Boolean)
    .sort();
  assert.deepEqual(observedTree, [
    'SHA256SUMS\tf',
    'handoff.json\tf',
    'source\td',
    'source/app\tf',
    'source/artifact-record.json\tf',
    'target\td',
    'target/app\tf',
    'target/artifact-record.json\tf',
  ]);
  for (const relativePath of STEADY_FILE_PREVIEW_HANDOFF_FILES) {
    const targetPath = path.posix.join(TARGET_HANDOFF_ROOT, relativePath);
    assert.equal(remoteSha256(remote, targetPath), files[relativePath].sha256);
  }
  return handoff;
}

/**
 * Prepare useful unfinished durable work on the clean target and exit.
 * @param {{remote: Readonly<{run: Function}>, handoffRoot: string, receiptPath: string, commit: string, now?: () => number, wait?: (duration: number) => Promise<void>}} options - Prepare inputs.
 * @returns {Promise<Record<string, any>>} - Prepare receipt.
 */
export async function prepareSteadyFilePreviewTarget(options) {
  assert.match(options.commit, /^[0-9a-f]{40}$/);
  const handoff = verifyTargetHandoff(options.handoffRoot, options.remote);
  assert.equal(handoff.commit, options.commit);
  const targetIdentity = inspectTarget(options.remote);
  assert.notEqual(targetIdentity.machineId, handoff.builder.machineId);
  assert.equal(
    remoteSha256(options.remote, TARGET_INPUT_PATH),
    handoff.ordinary.input.sha256,
  );
  const inputStat = options.remote
    .run('/usr/bin/stat', ['--format=%s:%a:%u:%g', '--', TARGET_INPUT_PATH])
    .stdout.trim();
  assert.equal(
    inputStat,
    `${handoff.ordinary.input.bytes}:600:${targetIdentity.uid}:${targetIdentity.gid}`,
  );
  const sourceOrdinary = parseJson(
    runArtifact(options.remote, SOURCE_ARTIFACT_PATH, [TARGET_INPUT_PATH]),
    'source packaged ordinary CLI',
  );
  const targetOrdinary = parseJson(
    runArtifact(options.remote, TARGET_ARTIFACT_PATH, [TARGET_INPUT_PATH]),
    'target packaged ordinary CLI',
  );
  assertStableDecision(
    sourceOrdinary,
    TARGET_INPUT_PATH,
    handoff.ordinary.expected,
  );
  assertStableDecision(
    targetOrdinary,
    TARGET_INPUT_PATH,
    handoff.ordinary.expected,
  );
  assert.deepEqual(targetOrdinary, sourceOrdinary);

  const absentBeforeStart = readServiceStatus(
    options.remote,
    SOURCE_ARTIFACT_PATH,
  );
  assert.equal(absentBeforeStart.appId, APP_ID);
  assert.equal(absentBeforeStart.unit, UNIT_NAME);
  assert.equal(absentBeforeStart.health, 'absent');
  const started = runArtifactJson(
    options.remote,
    SOURCE_ARTIFACT_PATH,
    ['wharfie', 'start', '--json', '--', TARGET_INPUT_PATH],
    'default durable steady-file start',
  );
  assert.equal(started.schemaVersion, 1);
  assert.equal(started.kind, 'wharfie.execution-ledger.workflow-start');
  assert.equal(started.appId, APP_ID);
  assert.equal(started.revisionId, handoff.artifacts.source.revisionId);
  assert.equal(started.workflowId, WORKFLOW_ID);
  assert.equal(started.reused, false);
  assert.equal(started.runStatus, 'RUNNING');
  assert.equal(started.cursor?.disposition, 'ACTIVITY_RUNNABLE');
  assert.match(started.runId, /^wfr_[A-Za-z0-9_-]{43}$/);

  const pending = inspectRun(
    options.remote,
    SOURCE_ARTIFACT_PATH,
    started.runId,
  );
  assert.equal(pending.run?.status, 'RUNNING');
  const pendingHistory = listRuns(options.remote, SOURCE_ARTIFACT_PATH);
  assertHistory(
    pendingHistory,
    started.runId,
    handoff.artifacts.source.revisionId,
    'RUNNING',
  );
  const appRoot = path.posix.join(
    targetIdentity.home,
    '.local',
    'share',
    'wharfie-nodejs',
    'applications',
    APP_ID,
  );
  /** @type {Record<string, string>} */
  const privateStartStorage = {};
  for (const [label, directory] of Object.entries({
    dataRoot: path.posix.join(
      targetIdentity.home,
      '.local',
      'share',
      'wharfie-nodejs',
    ),
    applicationsRoot: path.posix.dirname(appRoot),
    appRoot,
    stateRoot: path.posix.join(appRoot, 'state'),
    controlPath: path.posix.join(appRoot, 'state', 'control'),
    lmdbRoot: path.posix.join(appRoot, 'state', 'control', 'lmdb'),
    payloadPath: path.posix.join(
      appRoot,
      'state',
      'control',
      'execution-payloads',
    ),
  })) {
    const mode = options.remote
      .run('/usr/bin/stat', ['--format=%a', '--', directory])
      .stdout.trim();
    assert.equal(mode, '700', `${label} is not private`);
    privateStartStorage[label] = mode;
  }
  const absentAfterStart = readServiceStatus(
    options.remote,
    SOURCE_ARTIFACT_PATH,
  );
  assert.equal(absentAfterStart.health, 'absent');
  const install = runArtifactJson(
    options.remote,
    SOURCE_ARTIFACT_PATH,
    ['wharfie', 'service', 'install', '--json'],
    'steady-file service install',
  );
  assert.equal(install.action, 'install');
  assert.equal(install.requestStatus, 'fulfilled');
  assert.equal(install.outcome, 'target-active');
  assert.equal(install.health, 'healthy');
  assert.equal(install.activeArtifactId, handoff.artifacts.source.artifactId);
  const installed = assertHealthy(
    options.remote,
    targetIdentity,
    readServiceStatus(options.remote, SOURCE_ARTIFACT_PATH),
    handoff.artifacts.source,
    null,
  );
  const now = options.now || Date.now;
  const unfinishedView = await waitFor(
    () => inspectRun(options.remote, SOURCE_ARTIFACT_PATH, started.runId),
    (view) =>
      view.run?.status === 'RUNNING' &&
      view.workflowCursor?.disposition === 'TIMER_WAITING' &&
      view.timers?.length === 1 &&
      view.timers[0].status === 'WAITING' &&
      view.timers[0].dueAt - now() >= 30_000,
    'unfinished steady-file durable window',
    { now, wait: options.wait },
  );
  const unfinished = assertUnfinishedDurableWindow(
    unfinishedView,
    now(),
    30_000,
  );
  const unfinishedHistory = listRuns(options.remote, SOURCE_ARTIFACT_PATH);
  assertHistory(
    unfinishedHistory,
    started.runId,
    handoff.artifacts.source.revisionId,
    'RUNNING',
  );
  const receipt = {
    schemaVersion: 1,
    kind: 'wharfie.steady-file-preview.target-prepare',
    commit: options.commit,
    preparedAt: now(),
    controllerProcessId: process.pid,
    target: targetIdentity,
    handoff: {
      sha256: sha256File(path.join(options.handoffRoot, 'handoff.json')),
      builderMachineId: handoff.builder.machineId,
    },
    input: {
      path: TARGET_INPUT_PATH,
      bytes: handoff.ordinary.input.bytes,
      sha256: handoff.ordinary.input.sha256,
    },
    ordinary: { source: sourceOrdinary, target: targetOrdinary },
    start: started,
    pending,
    pendingHistory,
    unfinished,
    unfinishedHistory,
    service: {
      beforeStart: absentBeforeStart,
      afterStart: absentAfterStart,
      privateStartStorage,
      install,
      installed,
    },
  };
  writeJsonAtomic(options.receiptPath, receipt);
  return receipt;
}

/**
 * Complete and evolve the target from a distinct host controller process.
 * @param {{remote: Readonly<{run: Function}>, handoffRoot: string, preparePath: string, receiptPath: string, commit: string, now?: () => number, wait?: (duration: number) => Promise<void>}} options - Verify inputs.
 * @returns {Promise<Record<string, any>>} - Final receipt.
 */
export async function verifySteadyFilePreviewTarget(options) {
  assert.match(options.commit, /^[0-9a-f]{40}$/);
  const prepared = JSON.parse(readFileSync(options.preparePath, 'utf8'));
  assert.equal(prepared.kind, 'wharfie.steady-file-preview.target-prepare');
  assert.equal(prepared.commit, options.commit);
  assert.notEqual(prepared.controllerProcessId, process.pid);
  const runId = prepared.start.runId;
  assert.match(runId, /^wfr_[A-Za-z0-9_-]{43}$/);
  const now = options.now || Date.now;
  const unfinishedAfterPrepareExit = assertUnfinishedDurableWindow(
    inspectRun(options.remote, SOURCE_ARTIFACT_PATH, runId),
    now(),
    1,
  );
  assert.equal(unfinishedAfterPrepareExit.timerId, prepared.unfinished.timerId);
  assert.equal(unfinishedAfterPrepareExit.dueAt, prepared.unfinished.dueAt);
  const unfinishedHistoryAfterPrepareExit = listRuns(
    options.remote,
    SOURCE_ARTIFACT_PATH,
  );
  assertHistory(
    unfinishedHistoryAfterPrepareExit,
    runId,
    prepared.start.revisionId,
    'RUNNING',
  );

  const handoff = verifyTargetHandoff(options.handoffRoot, options.remote);
  assert.equal(handoff.commit, options.commit);
  const targetIdentity = inspectTarget(options.remote);
  assert.equal(targetIdentity.machineId, prepared.target.machineId);
  assert.notEqual(targetIdentity.machineId, handoff.builder.machineId);
  assert.equal(
    remoteSha256(options.remote, TARGET_INPUT_PATH),
    handoff.ordinary.input.sha256,
  );
  const source = handoff.artifacts.source;
  const target = handoff.artifacts.target;
  assert.equal(prepared.start.revisionId, source.revisionId);
  const installed = assertHealthy(
    options.remote,
    targetIdentity,
    readServiceStatus(options.remote, SOURCE_ARTIFACT_PATH),
    source,
    null,
  );
  assert.equal(installed.processId, prepared.service.installed.processId);
  assert.equal(installed.generation, prepared.service.installed.generation);

  const completed = await waitFor(
    () => inspectRun(options.remote, SOURCE_ARTIFACT_PATH, runId),
    (view) =>
      view.run?.status === 'COMPLETED' &&
      view.workflowCursor?.disposition === 'COMPLETED',
    'steady-file workflow completion',
    { now, wait: options.wait },
  );
  assert.equal(completed.timers?.length, 1);
  assert.equal(completed.timers[0].status, 'FIRED');
  assert.equal(completed.timers[0].timerId, unfinishedAfterPrepareExit.timerId);
  const comparisonInvocation = completed.invocations?.find(
    (/** @type {Record<string, any>} */ invocation) =>
      invocation.workflow?.stepId === 'comparison',
  );
  assert.ok(comparisonInvocation);
  const comparisonAttempt = completed.attempts?.find(
    (/** @type {Record<string, any>} */ attempt) =>
      attempt.invocationId === comparisonInvocation.invocationId &&
      attempt.status === 'COMPLETED',
  );
  assert.ok(comparisonAttempt);
  assert.ok(
    comparisonAttempt.startedAt >= unfinishedAfterPrepareExit.observedAt,
  );
  const history = listRuns(options.remote, SOURCE_ARTIFACT_PATH);
  const historyItem = assertHistory(
    history,
    runId,
    source.revisionId,
    'COMPLETED',
  );
  const output = readOutput(options.remote, SOURCE_ARTIFACT_PATH, runId);
  assertCompletedOutput(
    output,
    runId,
    source.revisionId,
    TARGET_INPUT_PATH,
    handoff.ordinary.expected,
  );

  const update = runArtifactJson(
    options.remote,
    TARGET_ARTIFACT_PATH,
    ['wharfie', 'service', 'update', '--json'],
    'steady-file service update',
  );
  assertActivationReceipt(update, 'update', target, source);
  const targetActive = assertHealthy(
    options.remote,
    targetIdentity,
    readServiceStatus(options.remote, TARGET_ARTIFACT_PATH),
    target,
    source,
  );
  assert.deepEqual(
    inspectRun(options.remote, TARGET_ARTIFACT_PATH, runId),
    completed,
  );
  assert.deepEqual(listRuns(options.remote, TARGET_ARTIFACT_PATH), history);
  assert.deepEqual(
    readOutput(options.remote, TARGET_ARTIFACT_PATH, runId),
    output,
  );

  const rollback = runArtifactJson(
    options.remote,
    TARGET_ARTIFACT_PATH,
    ['wharfie', 'service', 'rollback', '--json'],
    'steady-file service rollback',
  );
  assertActivationReceipt(rollback, 'rollback', source, target);
  const sourceRestored = assertHealthy(
    options.remote,
    targetIdentity,
    readServiceStatus(options.remote, SOURCE_ARTIFACT_PATH),
    source,
    target,
  );
  assert.deepEqual(
    inspectRun(options.remote, SOURCE_ARTIFACT_PATH, runId),
    completed,
  );
  assert.deepEqual(listRuns(options.remote, SOURCE_ARTIFACT_PATH), history);
  assert.deepEqual(
    readOutput(options.remote, SOURCE_ARTIFACT_PATH, runId),
    output,
  );

  const uninstall = runArtifactJson(
    options.remote,
    SOURCE_ARTIFACT_PATH,
    ['wharfie', 'service', 'uninstall', '--json'],
    'steady-file service uninstall',
  );
  assert.equal(uninstall.action, 'uninstall');
  assert.equal(uninstall.outcome, 'uninstalled');
  assert.equal(uninstall.health, 'absent');
  assert.equal(remoteExists(options.remote, uninstall.preserved?.state), true);
  assert.equal(
    remoteExists(options.remote, uninstall.preserved?.releases),
    true,
  );
  const absentStatus = readServiceStatus(options.remote, SOURCE_ARTIFACT_PATH);
  assert.equal(absentStatus.health, 'absent');
  assert.equal(absentStatus.installation?.state, 'uninstalled');
  const systemd = readIndependentSystemdAbsence(options.remote, targetIdentity);
  const inspectAfterUninstall = inspectRun(
    options.remote,
    SOURCE_ARTIFACT_PATH,
    runId,
  );
  const historyAfterUninstall = listRuns(options.remote, SOURCE_ARTIFACT_PATH);
  const outputAfterUninstall = readOutput(
    options.remote,
    SOURCE_ARTIFACT_PATH,
    runId,
  );
  assert.deepEqual(inspectAfterUninstall, completed);
  assert.deepEqual(historyAfterUninstall, history);
  assert.deepEqual(outputAfterUninstall, output);

  const prune = runArtifactJson(
    options.remote,
    SOURCE_ARTIFACT_PATH,
    ['wharfie', 'service', 'prune', '--json'],
    'steady-file release prune',
  );
  assert.equal(prune.kind, 'wharfie.service.release-prune');
  assert.equal(prune.installationState, 'uninstalled');
  assert.equal(prune.scannedReleaseCount, 2);
  assert.equal(prune.retainedReleaseCount, 2);
  assert.equal(prune.removedCount, 0);
  const purgeResult = purgeSteadyFilePreviewApplication(
    options.remote,
    SOURCE_ARTIFACT_PATH,
  );
  const purge = purgeResult.receipt;
  assert.equal(purge.action, 'purge');
  assert.ok(['purged', 'already-purged'].includes(purge.outcome));
  const appRoot = path.posix.join(
    targetIdentity.home,
    '.local',
    'share',
    'wharfie-nodejs',
    'applications',
    APP_ID,
  );
  assert.equal(remotePathAbsent(options.remote, appRoot), true);
  assert.equal(
    remoteSha256(options.remote, SOURCE_ARTIFACT_PATH),
    source.sha256,
  );
  assert.equal(
    remoteSha256(options.remote, TARGET_ARTIFACT_PATH),
    target.sha256,
  );

  const receipt = {
    schemaVersion: 1,
    kind: 'wharfie.steady-file-preview.target-complete',
    commit: options.commit,
    completedAt: now(),
    controllerProcessId: process.pid,
    target: targetIdentity,
    processBoundary: {
      prepareControllerProcessId: prepared.controllerProcessId,
      verifyControllerProcessId: process.pid,
      distinct: true,
      unfinishedAtPrepare: prepared.unfinished,
      unfinishedObservedAfterPrepareExit: unfinishedAfterPrepareExit,
    },
    handoff: prepared.handoff,
    input: prepared.input,
    ordinary: prepared.ordinary,
    start: prepared.start,
    service: {
      install: prepared.service.install,
      installed,
      update: { receipt: update, active: targetActive },
      rollback: { receipt: rollback, active: sourceRestored },
      uninstall: {
        receipt: uninstall,
        status: absentStatus,
        systemd,
        stateRetainedUntilPurge: true,
      },
      prune,
      purge: {
        receipt: purge,
        recovery: purgeResult.recovery,
        applicationRootAbsent: true,
        externalArtifactsPreserved: true,
      },
    },
    run: {
      runId,
      unfinishedHistoryAtPrepare: prepared.unfinishedHistory,
      unfinishedHistoryAfterPrepareExit,
      completed,
      history,
      historyItem,
      output,
      readsPreservedAcrossUpdate: true,
      readsPreservedAcrossRollback: true,
      readsPreservedAfterUninstall: true,
    },
  };
  writeJsonAtomic(options.receiptPath, receipt);
  return receipt;
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const phase = process.argv[2];
  const instance = process.argv[3];
  const handoffRoot = path.resolve(process.argv[4] || '');
  const commit = process.argv[5];
  const remote = createSteadyFilePreviewRemote(instance);
  if (phase === 'prepare') {
    const receiptPath = path.resolve(process.argv[6] || '');
    const receipt = await prepareSteadyFilePreviewTarget({
      remote,
      handoffRoot,
      receiptPath,
      commit,
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return;
  }
  if (phase === 'verify') {
    const preparePath = path.resolve(process.argv[6] || '');
    const receiptPath = path.resolve(process.argv[7] || '');
    const receipt = await verifySteadyFilePreviewTarget({
      remote,
      handoffRoot,
      preparePath,
      receiptPath,
      commit,
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return;
  }
  throw new Error(
    'Usage: verify-steady-file-preview-target.js <prepare|verify> <instance> <handoff-root> <commit> <receipt...>',
  );
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));
if (isMain) await main();
