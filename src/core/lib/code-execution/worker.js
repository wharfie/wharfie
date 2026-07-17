import { join } from 'node:path';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { MessageChannel, Worker } from 'node:worker_threads';
import { x } from 'tar';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buffer as streamToBuffer } from 'node:stream/consumers';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  DEFAULT_ACTIVITY_CANCELLATION_GRACE_MS,
  DEFAULT_ACTIVITY_HOST_OPERATION_TIMEOUT_MS,
  serializeActivityAttemptError,
} from '../../runtime/activity-attempt.js';
import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
  ActivityProtocolTranscriptValidator,
} from '../../runtime/activity-protocol.js';

// esbuild inlines this file as text (configure: loader { '.worker.js': 'text' })
// In normal Node/Jest execution, this import resolves to the module default export (a function),
// NOT the source text. We fall back to reading the file from disk when needed.
// @ts-ignore
// eslint-disable-next-line import/default
import workerSource from './runner.worker.js';

import paths from '../paths.js';
const VM_PATH = join(paths.temp, 'vms');
const require = createRequire(import.meta.url);

// --- bundle-isolated workers + response routing ---
let nextId = 1;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_ACTIVITY_WORKER_READY_TIMEOUT_MS = 5_000;

/**
 * @typedef PendingExecution
 * @property {(value: any) => void} resolve - Resolve the execution.
 * @property {(error: any) => void} reject - Reject the execution.
 */

/**
 * @typedef WorkerState
 * @property {string} key - Stable bundle key.
 * @property {string} activityKey - Stable activity name/source key.
 * @property {string} name - Activity name.
 * @property {Sandbox} sandbox - Private filesystem root owned by this worker.
 * @property {Worker} worker - Worker instance.
 * @property {Map<number, PendingExecution>} pending - Executions awaiting responses.
 * @property {Map<number, PendingActivityAttempt>} activityAttempts - Framed Activity Protocol attempts awaiting completion.
 * @property {Map<number, PendingActivityAttempt>} closingActivityAttempts - Terminal attempts kept until their dedicated worker exits.
 * @property {Set<string>} rpcSessionIds - RPC sessions owned by this worker.
 * @property {number} activeExecutions - Number of active runInSandbox calls.
 * @property {boolean} destroyRequested - Whether to terminate once idle.
 * @property {boolean} terminating - Whether termination has started.
 * @property {boolean} exited - Whether the worker has exited.
 * @property {Promise<void> | null} terminationPromise - Active termination.
 */

/**
 * @typedef PendingActivityAttempt
 * @property {(value: any) => void} resolve - Resolve verified host-collected evidence.
 * @property {(error: any) => void} reject - Reject transport/evidence failure.
 * @property {Readonly<Record<string, any>>} start - Host-accepted start frame.
 * @property {ActivityProtocolTranscriptValidator} transcript - Host-owned transcript validator.
 * @property {Readonly<Record<string, any>>[]} frames - Host-accepted ordered frames.
 * @property {Readonly<Record<string, any>> | null} terminal - Host-accepted terminal.
 * @property {boolean} ready - Whether the runner loaded the private wrapper.
 * @property {boolean} startSent - Whether the host start frame was sent.
 * @property {boolean} finished - Whether the runner reported normal wrapper completion.
 * @property {boolean} cancelRequested - Whether the host has accepted a cancellation request.
 * @property {Readonly<Record<string, any>> | null} pendingCancel - Host-accepted cancellation held until the start frame is physically sent.
 * @property {import('node:worker_threads').MessagePort} port - Private host/runner Activity Protocol port, never exposed to bundle code.
 * @property {string} transportAuth - Opaque per-attempt authenticator required on runner lifecycle messages.
 * @property {number} readyTimeoutMs - Maximum time to load the private wrapper and report readiness.
 * @property {ReturnType<typeof setTimeout> | null} readyTimer - Runner readiness watchdog.
 * @property {number} cancellationGraceMs - Bounded cooperative-cancellation grace.
 * @property {ReturnType<typeof setTimeout> | null} cancellationTimer - Cooperative-cancellation watchdog.
 * @property {ReturnType<typeof setTimeout> | null} deadlineTimer - Host deadline watchdog.
 * @property {ReturnType<typeof setTimeout> | null} terminalTimer - Post-terminal close watchdog.
 * @property {(() => void) | null} removeAbortListener - External abort cleanup.
 */

/** @type {Map<string, WorkerState>} */
const workers = new Map();

/**
 * Active RPC sessions, keyed by `sessionId`.
 *
 * Each session maps a resource name (db/queue/objectStorage/etc) to an in-process client instance.
 * @type {Map<string, { resources: Record<string, any> }>}
 */
const rpcSessions = new Map();

/**
 * @param {string} name - Activity name.
 * @param {string} codeString - Bundled activity source.
 * @returns {string} - Stable activity name/source key.
 */
function getActivityKey(name, codeString) {
  return createHash('sha256')
    .update('wharfie-activity-v1\0')
    .update(String(name))
    .update('\0')
    .update(String(codeString))
    .digest('hex');
}

/**
 * @param {Buffer | Uint8Array | null | undefined} externalsTar - External bundle bytes.
 * @returns {string} - Stable external bundle content digest.
 */
function getExternalBundleDigest(externalsTar) {
  const bytes = externalsTar ? Buffer.from(externalsTar) : Buffer.alloc(0);
  return createHash('sha256')
    .update('wharfie-externals-v1\0')
    .update(bytes)
    .digest('hex');
}

/**
 * @param {string} activityKey - Stable activity name/source key.
 * @param {string} externalBundleDigest - External bundle content digest.
 * @returns {string} - Stable worker/sandbox key.
 */
function getBundleKey(activityKey, externalBundleDigest) {
  return createHash('sha256')
    .update('wharfie-sandbox-v1\0')
    .update(activityKey)
    .update('\0')
    .update(externalBundleDigest)
    .digest('hex');
}

/**
 * Derive a one-shot sandbox key for an Activity Protocol attempt. The stable
 * bundle key remains the content identity; the random isolation ID makes a
 * force-terminable worker and filesystem root belong to this physical attempt
 * alone, never to a concurrent legacy execution of the same bundle.
 * @param {string} bundleKey - Stable content-addressed bundle key.
 * @param {string} isolationId - Fresh physical-attempt isolation ID.
 * @returns {string} - One-shot worker/sandbox key.
 */
function getActivityAttemptSandboxKey(bundleKey, isolationId) {
  return createHash('sha256')
    .update('wharfie-activity-attempt-sandbox-v1\0')
    .update(bundleKey)
    .update('\0')
    .update(isolationId)
    .digest('hex');
}

/**
 * @returns {string} - Result.
 */
function getWorkerSourceText() {
  if (typeof workerSource === 'string') return workerSource;

  // Node/Jest path: load the worker source code from disk.
  const p = findRunnerWorkerPath();
  return readFileSync(p, 'utf8');
}

/**
 * @param {any} v - v.
 * @returns {boolean} - Result.
 */
function isNodeReadable(v) {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof v.pipe === 'function' &&
    typeof v.on === 'function'
  );
}

/**
 * Locate runner.worker.js on disk for non-bundled execution (e.g. Node/Jest).
 *
 * Resolve relative to this module so installed-package callers can change
 * `process.cwd()` without breaking sandbox startup.
 * @returns {string} - Result.
 */
function findRunnerWorkerPath() {
  return require.resolve('./runner.worker.js');
}

/**
 * Make a value safe to structured-clone across the worker boundary.
 *
 * Notes:
 * - Buffers are cloneable
 * - Node Readable streams are NOT cloneable; we materialize them into a Buffer and tag them
 * so the worker can rehydrate a Readable.
 * @param {any} value - value.
 * @returns {Promise<any>} - Result.
 */
async function makeCloneable(value) {
  if (value === null || value === undefined) return value;

  // primitives
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;

  // Buffer / ArrayBuffer / typed arrays are cloneable
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) return value;

  // If it is directly a Readable, materialize
  if (isNodeReadable(value)) {
    const buf = await streamToBuffer(value);
    return { __wharfie_type: 'readable', data: buf };
  }

  // Common S3 shape: { Body: stream }
  if (value && typeof value === 'object' && 'Body' in value) {
    const body = value.Body;

    // AWS SDK v3 adds these mixins
    if (body && typeof body.transformToString === 'function') {
      // Prefer string when possible (smaller + common usage).
      const s = await body.transformToString('utf8');
      return { ...value, Body: s };
    }
    if (body && typeof body.transformToByteArray === 'function') {
      const arr = await body.transformToByteArray();
      return {
        ...value,
        Body: { __wharfie_type: 'readable', data: Buffer.from(arr) },
      };
    }
    if (isNodeReadable(body)) {
      const buf = await streamToBuffer(body);
      return { ...value, Body: { __wharfie_type: 'readable', data: buf } };
    }
  }

  // Best-effort: rely on structured clone, which will throw if unsupported.
  return value;
}

/**
 * @param {Worker} w - w.
 * @param {any} msg - msg.
 * @returns {Promise<void>} - Result.
 */
async function handleRpcMessage(w, msg) {
  const id = msg?.id;
  const sessionId = msg?.sessionId;
  const resourceName = msg?.resource;
  const methodName = msg?.method;
  const args = Array.isArray(msg?.args) ? msg.args : [];

  const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

  if (!sessionId || typeof sessionId !== 'string') {
    w.postMessage({
      kind: 'rpc_response',
      id,
      ok: false,
      error: 'RPC error: missing sessionId',
    });
    return;
  }

  const session = rpcSessions.get(sessionId);
  if (!session) {
    w.postMessage({
      kind: 'rpc_response',
      id,
      ok: false,
      error: `RPC error: unknown sessionId ${sessionId}`,
    });
    return;
  }

  if (!resourceName || typeof resourceName !== 'string') {
    w.postMessage({
      kind: 'rpc_response',
      id,
      ok: false,
      error: 'RPC error: missing resource name',
    });
    return;
  }

  const resource = session.resources?.[resourceName];
  if (!resource) {
    w.postMessage({
      kind: 'rpc_response',
      id,
      ok: false,
      error: `RPC error: unknown resource '${resourceName}'`,
    });
    return;
  }

  if (
    !methodName ||
    typeof methodName !== 'string' ||
    forbidden.has(methodName)
  ) {
    w.postMessage({
      kind: 'rpc_response',
      id,
      ok: false,
      error: `RPC error: invalid method '${String(methodName)}'`,
    });
    return;
  }

  const fn = resource?.[methodName];
  if (typeof fn !== 'function') {
    w.postMessage({
      kind: 'rpc_response',
      id,
      ok: false,
      error: `RPC error: '${resourceName}.${methodName}' is not a function`,
    });
    return;
  }

  try {
    const result = fn.apply(resource, args);
    const awaited =
      result && typeof result.then === 'function' ? await result : result;

    const cloneable = await makeCloneable(awaited);

    w.postMessage({
      kind: 'rpc_response',
      id,
      ok: true,
      value: cloneable,
    });
  } catch (err) {
    w.postMessage({
      kind: 'rpc_response',
      id,
      ok: false,
      // @ts-ignore
      error: err && err.stack ? err.stack : String(err),
    });
  }
}

/**
 * @param {WorkerState} state - Worker state.
 * @param {Error} error - Rejection error.
 * @returns {void}
 */
function rejectPendingExecutions(state, error) {
  for (const { reject } of state.pending.values()) {
    reject(error);
  }
  state.pending.clear();
}

/**
 * Stop timers/listeners owned by one framed attempt. This is intentionally
 * idempotent because normal finish, a worker exit, and forced termination can
 * converge on the same attempt.
 * @param {PendingActivityAttempt} attempt - Pending framed attempt.
 * @returns {void}
 */
function cleanupPendingActivityAttempt(attempt) {
  if (attempt.readyTimer) {
    clearTimeout(attempt.readyTimer);
    attempt.readyTimer = null;
  }
  if (attempt.cancellationTimer) {
    clearTimeout(attempt.cancellationTimer);
    attempt.cancellationTimer = null;
  }
  if (attempt.deadlineTimer) {
    clearTimeout(attempt.deadlineTimer);
    attempt.deadlineTimer = null;
  }
  if (attempt.terminalTimer) {
    clearTimeout(attempt.terminalTimer);
    attempt.terminalTimer = null;
  }
  if (attempt.removeAbortListener) {
    try {
      attempt.removeAbortListener();
    } catch {}
    attempt.removeAbortListener = null;
  }
}

/**
 * @param {PendingActivityAttempt} attempt - Pending framed attempt.
 * @returns {void}
 */
function closeActivityAttemptPort(attempt) {
  try {
    attempt.port.close();
  } catch {}
}

/**
 * The host has already accepted a terminal frame, so cancellation/deadline
 * watchdogs are no longer relevant. Keep a short close watchdog instead: a
 * terminal without a runner completion cannot safely be reported as a fully
 * closed physical attempt.
 * @param {PendingActivityAttempt} attempt - Pending framed attempt.
 * @returns {void}
 */
function stopActivityAttemptInterruptionWatchdogs(attempt) {
  if (attempt.cancellationTimer) {
    clearTimeout(attempt.cancellationTimer);
    attempt.cancellationTimer = null;
  }
  if (attempt.deadlineTimer) {
    clearTimeout(attempt.deadlineTimer);
    attempt.deadlineTimer = null;
  }
  if (attempt.removeAbortListener) {
    try {
      attempt.removeAbortListener();
    } catch {}
    attempt.removeAbortListener = null;
  }
}

/**
 * @param {WorkerState} state - Worker state.
 * @param {Error} error - Rejection error.
 * @returns {void}
 */
function rejectPendingActivityAttempts(state, error) {
  for (const attempt of state.activityAttempts.values()) {
    cleanupPendingActivityAttempt(attempt);
    closeActivityAttemptPort(attempt);
    attempt.reject(error);
  }
  state.activityAttempts.clear();
}

/**
 * @param {WorkerState} state - Worker state.
 * @param {Error} error - Rejection error.
 * @returns {void}
 */
function rejectClosingActivityAttempts(state, error) {
  for (const attempt of state.closingActivityAttempts.values()) {
    cleanupPendingActivityAttempt(attempt);
    closeActivityAttemptPort(attempt);
    attempt.reject(error);
  }
  state.closingActivityAttempts.clear();
}

/**
 * @param {WorkerState} state - Worker state.
 * @returns {void}
 */
function clearWorkerRpcSessions(state) {
  for (const sessionId of state.rpcSessionIds) {
    rpcSessions.delete(sessionId);
  }
  state.rpcSessionIds.clear();
}

/**
 * @param {WorkerState} state - Worker state.
 * @returns {void}
 */
function removeWorkerState(state) {
  if (workers.get(state.key) === state) {
    workers.delete(state.key);
  }
}

/**
 * Stop a sandbox from being acquired by a new invocation before its worker is
 * terminated or its filesystem root is removed.
 * @param {Sandbox} sandbox - Sandbox to detach.
 * @returns {void}
 */
function detachSandbox(sandbox) {
  if (sandboxes.get(sandbox.key) === sandbox) {
    sandboxes.delete(sandbox.key);
  }
}

/**
 * Remove one private sandbox root. Cleanup is idempotent so worker exit and an
 * explicit destroy can safely converge on the same operation.
 * @param {Sandbox} sandbox - Sandbox to clean.
 * @returns {Promise<void>}
 */
async function cleanupSandbox(sandbox) {
  if (!sandbox.cleanupPromise) {
    sandbox.cleanupPromise = rm(sandbox.root, {
      force: true,
      recursive: true,
      maxRetries: 3,
      retryDelay: 10,
    });
  }
  await sandbox.cleanupPromise;
}

/**
 * Detach and remove the filesystem root owned by a worker.
 * @param {WorkerState} state - Worker state.
 * @returns {Promise<void>}
 */
async function cleanupWorkerSandbox(state) {
  detachSandbox(state.sandbox);
  await cleanupSandbox(state.sandbox);
}

/**
 * Run worker cleanup from an event callback without creating an unhandled
 * rejection.
 * @param {WorkerState} state - Worker state.
 * @returns {void}
 */
function cleanupWorkerSandboxInBackground(state) {
  cleanupWorkerSandbox(state).catch((error) => {
    console.error('[worker:cleanup]', error);
  });
}

/**
 * @param {WorkerState} state - Worker state.
 * @param {{ force?: boolean }} [options] - Termination options.
 * @returns {Promise<void>}
 */
async function terminateWorkerState(state, options = {}) {
  if (state.terminationPromise) {
    await state.terminationPromise;
    return;
  }

  state.destroyRequested = true;
  if (state.activeExecutions > 0 && options.force !== true) {
    return;
  }

  state.terminating = true;
  removeWorkerState(state);
  clearWorkerRpcSessions(state);
  detachSandbox(state.sandbox);

  if (state.pending.size > 0 || state.activityAttempts.size > 0) {
    rejectPendingExecutions(state, new Error('Sandbox worker was terminated.'));
    rejectPendingActivityAttempts(
      state,
      new Error('Sandbox activity attempt worker was terminated.'),
    );
  }

  if (state.exited) {
    await cleanupSandbox(state.sandbox);
    return;
  }

  state.terminationPromise = (async () => {
    try {
      await state.worker.terminate();
    } finally {
      await cleanupSandbox(state.sandbox);
    }
  })();
  await state.terminationPromise;
}

/**
 * @param {string} message - Safe diagnostic message.
 * @param {unknown} [cause] - Local failure cause.
 * @returns {Error} - Error classified as invalid activity-attempt evidence.
 */
function createActivityAttemptEvidenceError(message, cause) {
  const error = /** @type {Error & {code?: string, cause?: unknown}} */ (
    new Error(message)
  );
  if (cause !== undefined) error.cause = cause;
  error.code = 'activity-attempt-evidence-invalid';
  return error;
}

/**
 * @param {WorkerState} state - Worker state.
 * @param {number} id - Transport session ID.
 * @param {Error} error - Attempt failure.
 * @param {boolean} [forceTerminate] - Whether to immediately terminate this dedicated worker.
 * @returns {void}
 */
function failActivityAttempt(state, id, error, forceTerminate = true) {
  const attempt = state.activityAttempts.get(id);
  if (!attempt) return;
  state.activityAttempts.delete(id);
  cleanupPendingActivityAttempt(attempt);
  closeActivityAttemptPort(attempt);
  attempt.reject(error);
  if (forceTerminate) {
    terminateWorkerState(state, { force: true }).catch(() => {});
  }
}

/**
 * Terminate a completed attempt's dedicated worker before publishing its
 * evidence. The closing map remains live during termination so any late frame
 * is rejected instead of being silently ignored after a terminal.
 * @param {WorkerState} state - Worker state.
 * @param {number} id - Transport session ID.
 * @param {PendingActivityAttempt} attempt - Terminal attempt.
 * @returns {void}
 */
function closeVerifiedActivityAttempt(state, id, attempt) {
  state.activityAttempts.delete(id);
  state.closingActivityAttempts.set(id, attempt);
  cleanupPendingActivityAttempt(attempt);
  const evidence = {
    status: attempt.terminal?.type,
    start: attempt.start,
    terminal: attempt.terminal,
    frames: [...attempt.frames],
    transcript: attempt.transcript.snapshot(),
  };
  terminateWorkerState(state, { force: true }).then(
    () => {
      if (state.closingActivityAttempts.get(id) !== attempt) return;
      state.closingActivityAttempts.delete(id);
      closeActivityAttemptPort(attempt);
      attempt.resolve(evidence);
    },
    (cause) => {
      if (state.closingActivityAttempts.get(id) !== attempt) return;
      state.closingActivityAttempts.delete(id);
      closeActivityAttemptPort(attempt);
      const error = new Error(
        'Could not close the verified activity attempt worker.',
      );
      /** @type {Error & {cause?: unknown}} */ (error).cause = cause;
      attempt.reject(error);
    },
  );
}

/**
 * A bundle must load its fixed private wrapper and report readiness within a
 * finite bound. Without this watchdog, a top-level loop or blocked module
 * initialization could leave an otherwise unbounded attempt pending forever.
 * @param {WorkerState} state - Worker state.
 * @param {number} id - Transport session ID.
 * @param {PendingActivityAttempt} attempt - Pending attempt.
 * @returns {void}
 */
function armActivityAttemptReadyWatchdog(state, id, attempt) {
  if (attempt.ready || attempt.readyTimer) return;
  attempt.readyTimer = setTimeout(() => {
    attempt.readyTimer = null;
    if (state.activityAttempts.get(id) !== attempt || attempt.ready) return;
    failActivityAttempt(
      state,
      id,
      new Error(
        `The activity runner did not become ready within ${attempt.readyTimeoutMs}ms.`,
      ),
    );
  }, attempt.readyTimeoutMs);
}

/**
 * @param {WorkerState} state - Worker state.
 * @param {number} id - Transport session ID.
 * @param {PendingActivityAttempt} attempt - Pending attempt.
 * @returns {void}
 */
function armActivityAttemptDeadlineWatchdog(state, id, attempt) {
  if (
    attempt.terminal ||
    attempt.cancelRequested ||
    attempt.deadlineTimer ||
    !Object.prototype.hasOwnProperty.call(attempt.start, 'deadlineUnixMs')
  ) {
    return;
  }

  const remaining = attempt.start.deadlineUnixMs - Date.now();
  const delay = Math.max(0, Math.min(remaining, MAX_TIMER_DELAY_MS));
  attempt.deadlineTimer = setTimeout(() => {
    attempt.deadlineTimer = null;
    if (
      state.activityAttempts.get(id) !== attempt ||
      attempt.terminal ||
      attempt.cancelRequested
    ) {
      return;
    }
    if (Date.now() < attempt.start.deadlineUnixMs) {
      armActivityAttemptDeadlineWatchdog(state, id, attempt);
      return;
    }
    armActivityAttemptForcedTermination(
      state,
      id,
      attempt,
      'The activity attempt exceeded its host deadline without a verified terminal frame.',
    );
  }, delay);
}

/**
 * Bound the time an unresponsive worker can continue after cancellation or a
 * deadline. Every protocol attempt owns a one-shot worker, so this is a true
 * per-attempt termination boundary rather than collateral termination of a
 * shared sandbox.
 * @param {WorkerState} state - Worker state.
 * @param {number} id - Transport session ID.
 * @param {PendingActivityAttempt} attempt - Pending attempt.
 * @param {string} message - Safe transport diagnostic.
 * @returns {void}
 */
function armActivityAttemptForcedTermination(state, id, attempt, message) {
  if (attempt.terminal || attempt.cancellationTimer) return;
  attempt.cancellationTimer = setTimeout(() => {
    attempt.cancellationTimer = null;
    if (state.activityAttempts.get(id) !== attempt || attempt.terminal) return;
    failActivityAttempt(state, id, new Error(message));
  }, attempt.cancellationGraceMs);
}

/**
 * A terminal component frame is evidence, but the runner must also close the
 * wrapper before the host releases the one-shot worker. This catches a bundle
 * that sends a terminal and then emits a late frame or hangs forever.
 * @param {WorkerState} state - Worker state.
 * @param {number} id - Transport session ID.
 * @param {PendingActivityAttempt} attempt - Pending attempt.
 * @returns {void}
 */
function armActivityAttemptTerminalWatchdog(state, id, attempt) {
  if (attempt.terminalTimer || !attempt.terminal) return;
  attempt.terminalTimer = setTimeout(() => {
    attempt.terminalTimer = null;
    if (
      state.activityAttempts.get(id) !== attempt ||
      !attempt.terminal ||
      attempt.finished
    ) {
      return;
    }
    failActivityAttempt(
      state,
      id,
      new Error(
        'The activity worker delivered a terminal frame but did not close its framed attempt.',
      ),
    );
  }, DEFAULT_ACTIVITY_HOST_OPERATION_TIMEOUT_MS);
}

/**
 * @param {WorkerState} state - Worker state.
 * @param {number} id - Transport session ID.
 * @param {Record<string, any>} reason - Strict structured cancellation reason.
 * @returns {void}
 */
function requestActivityAttemptCancellation(state, id, reason) {
  const attempt = state.activityAttempts.get(id);
  if (!attempt || attempt.terminal || attempt.cancelRequested) return;
  if (
    Object.prototype.hasOwnProperty.call(attempt.start, 'deadlineUnixMs') &&
    Date.now() >= attempt.start.deadlineUnixMs
  ) {
    // The deadline is an absolute admission fence. A cancellation accepted
    // before it owns its grace; a new cancellation at/after it does not alter
    // the deadline-owned outcome.
    return;
  }

  try {
    const cancel = attempt.transcript.acceptHostFrame({
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type: 'cancel',
      attemptId: attempt.start.attemptId,
      reason,
    });
    attempt.frames.push(cancel);
    attempt.cancelRequested = true;
    if (!attempt.startSent) {
      attempt.pendingCancel = cancel;
      armActivityAttemptForcedTermination(
        state,
        id,
        attempt,
        'The activity attempt did not become ready before bounded cancellation grace elapsed.',
      );
      return;
    }
    attempt.port.postMessage({
      kind: 'activity-attempt-host-frame',
      id,
      frame: cancel,
    });
    armActivityAttemptForcedTermination(
      state,
      id,
      attempt,
      'The activity attempt did not produce a verified terminal frame after cancellation.',
    );
  } catch (cause) {
    failActivityAttempt(
      state,
      id,
      createActivityAttemptEvidenceError(
        'The activity host could not deliver its cancellation frame.',
        cause,
      ),
    );
  }
}

/**
 * Send the already validated start frame once the runner reports that its
 * fixed private wrapper is loaded.
 * @param {WorkerState} state - Worker state.
 * @param {number} id - Transport session ID.
 * @param {PendingActivityAttempt} attempt - Pending attempt.
 * @returns {void}
 */
function sendActivityAttemptStart(state, id, attempt) {
  if (attempt.startSent) {
    failActivityAttempt(
      state,
      id,
      createActivityAttemptEvidenceError(
        'The activity runner reported readiness more than once.',
      ),
    );
    return;
  }
  try {
    if (attempt.pendingCancel) {
      attempt.port.postMessage({
        kind: 'activity-attempt-pre-cancel',
        id,
        reason: attempt.pendingCancel.reason,
      });
    }
    attempt.startSent = true;
    attempt.port.postMessage({
      kind: 'activity-attempt-host-frame',
      id,
      frame: attempt.start,
    });
    if (attempt.pendingCancel) {
      const cancel = attempt.pendingCancel;
      attempt.pendingCancel = null;
      attempt.port.postMessage({
        kind: 'activity-attempt-host-frame',
        id,
        frame: cancel,
      });
    }
  } catch (cause) {
    const error = new Error('Could not start activity attempt.');
    /** @type {Error & {cause?: unknown}} */ (error).cause = cause;
    failActivityAttempt(state, id, error);
  }
}

/**
 * Authenticate a message arriving on one attempt's private MessagePort before
 * it can affect any host state. The bundled code shares a Node isolate with
 * the runner and may discover the port, but it never receives this opaque
 * capability: the runner captures it before evaluating the bundle and adds it
 * only to its own lifecycle messages.
 * @param {WorkerState} state - Worker state.
 * @param {number} id - Expected transport session ID.
 * @param {PendingActivityAttempt} attempt - Exact attempt that owns the port.
 * @param {unknown} value - Candidate runner message.
 * @returns {void}
 */
function handleAuthenticatedActivityAttemptPortMessage(
  state,
  id,
  attempt,
  value,
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const msg = /** @type {Record<string, any>} */ (value);
  if (msg.transportAuth !== attempt.transportAuth) return;
  if (msg.id !== id) {
    const error = createActivityAttemptEvidenceError(
      'The authenticated activity runner sent a message for the wrong attempt.',
    );
    if (state.activityAttempts.get(id) === attempt) {
      failActivityAttempt(state, id, error);
    } else if (state.closingActivityAttempts.get(id) === attempt) {
      state.closingActivityAttempts.delete(id);
      cleanupPendingActivityAttempt(attempt);
      closeActivityAttemptPort(attempt);
      attempt.reject(error);
    }
    return;
  }
  handleActivityAttemptMessage(state, msg);
}

/**
 * @param {WorkerState} state - Worker state.
 * @param {Record<string, any>} msg - Candidate worker message.
 * @returns {boolean} - Whether this was an Activity Protocol transport message.
 */
function handleActivityAttemptMessage(state, msg) {
  const recognizedKinds = new Set([
    'activity-attempt-ready',
    'activity-attempt-component-frame',
    'activity-attempt-finished',
    'activity-attempt-failed',
    'activity-attempt-force-terminate',
  ]);
  if (!recognizedKinds.has(msg.kind)) return false;

  const id = msg.id;
  if (!Number.isSafeInteger(id) || id < 1) return true;
  const closingAttempt = state.closingActivityAttempts.get(id);
  if (closingAttempt) {
    state.closingActivityAttempts.delete(id);
    cleanupPendingActivityAttempt(closingAttempt);
    closeActivityAttemptPort(closingAttempt);
    closingAttempt.reject(
      createActivityAttemptEvidenceError(
        'The activity runner emitted a late framed message after its terminal frame.',
      ),
    );
    return true;
  }
  const attempt = state.activityAttempts.get(id);
  if (!attempt) return true;

  if (msg.kind === 'activity-attempt-ready') {
    if (attempt.ready || attempt.finished) {
      failActivityAttempt(
        state,
        id,
        createActivityAttemptEvidenceError(
          'The activity runner sent an invalid readiness transition.',
        ),
      );
      return true;
    }
    attempt.ready = true;
    if (attempt.readyTimer) {
      clearTimeout(attempt.readyTimer);
      attempt.readyTimer = null;
    }
    sendActivityAttemptStart(state, id, attempt);
    return true;
  }

  if (msg.kind === 'activity-attempt-component-frame') {
    if (!attempt.ready || !attempt.startSent || attempt.finished) {
      failActivityAttempt(
        state,
        id,
        createActivityAttemptEvidenceError(
          'The activity runner emitted a component frame outside an active attempt.',
        ),
      );
      return true;
    }
    if (attempt.terminal) {
      failActivityAttempt(
        state,
        id,
        createActivityAttemptEvidenceError(
          'The activity runner emitted a component frame after its terminal frame.',
        ),
      );
      return true;
    }
    try {
      const hasDeadline = Object.prototype.hasOwnProperty.call(
        attempt.start,
        'deadlineUnixMs',
      );
      const deadlinePassed =
        hasDeadline && Date.now() >= attempt.start.deadlineUnixMs;
      const componentType = msg.frame?.type;
      if (componentType === 'deadline-exceeded' && !deadlinePassed) {
        throw new Error(
          'The activity runner emitted deadline-exceeded before the host deadline.',
        );
      }
      if (attempt.cancelRequested) {
        // A cancellation accepted before the deadline owns its bounded grace.
        // The adapter may log cleanup, then only cancel or report a local
        // protocol failure; it cannot replace the host interruption with a
        // successful, failed, or deadline terminal.
        if (
          componentType === 'completed' ||
          componentType === 'failed' ||
          componentType === 'deadline-exceeded'
        ) {
          throw new Error(
            'The activity runner emitted an incompatible terminal after host cancellation.',
          );
        }
      } else if (deadlinePassed && componentType !== 'deadline-exceeded') {
        throw new Error(
          'The activity runner emitted a component frame after the host deadline.',
        );
      }
      if (msg.frame?.type === 'effect-request') {
        throw new TypeError(
          'Activity Protocol effects are unavailable on this worker transport.',
        );
      }
      const frame = attempt.transcript.acceptComponentFrame(msg.frame);
      attempt.frames.push(frame);
      if (
        frame.type === 'completed' ||
        frame.type === 'failed' ||
        frame.type === 'cancelled' ||
        frame.type === 'deadline-exceeded' ||
        frame.type === 'protocol-failed'
      ) {
        attempt.terminal = frame;
        stopActivityAttemptInterruptionWatchdogs(attempt);
        armActivityAttemptTerminalWatchdog(state, id, attempt);
      }
      attempt.port.postMessage({
        kind: 'activity-attempt-component-ack',
        id,
        sequence: frame.sequence,
        ok: true,
      });
    } catch (cause) {
      failActivityAttempt(
        state,
        id,
        createActivityAttemptEvidenceError(
          'The activity runner emitted an invalid component frame.',
          cause,
        ),
      );
    }
    return true;
  }

  if (msg.kind === 'activity-attempt-finished') {
    if (
      !attempt.ready ||
      !attempt.startSent ||
      attempt.finished ||
      !attempt.terminal
    ) {
      failActivityAttempt(
        state,
        id,
        createActivityAttemptEvidenceError(
          'The activity runner finished without one verified terminal frame.',
        ),
      );
      return true;
    }
    attempt.finished = true;
    closeVerifiedActivityAttempt(state, id, attempt);
    return true;
  }

  if (msg.kind === 'activity-attempt-force-terminate') {
    failActivityAttempt(
      state,
      id,
      new Error(
        'The activity worker requested forced termination after bounded cancellation grace.',
      ),
    );
    return true;
  }

  failActivityAttempt(
    state,
    id,
    new Error(
      typeof msg.error === 'string'
        ? `The activity runner failed: ${msg.error}`
        : 'The activity runner failed before producing verifiable evidence.',
    ),
  );
  return true;
}

/**
 * @param {string} name - name.
 * @param {string} codeString - Bundled activity source.
 * @param {Sandbox} sandbox - Prepared private sandbox.
 * @returns {WorkerState | null} - Worker state, or null when the sandbox was invalidated.
 */
function ensureWorker(name, codeString, sandbox) {
  const activityKey = getActivityKey(name, codeString);
  const key = sandbox.key;
  if (sandboxes.get(key) !== sandbox) return null;

  const existing = workers.get(key);
  if (existing && !existing.terminating && !existing.exited) {
    return existing.sandbox === sandbox ? existing : null;
  }

  const src = getWorkerSourceText();
  const workerUrl = new URL(
    `data:text/javascript;base64,${Buffer.from(src, 'utf8').toString('base64')}`,
  );

  // @ts-ignore
  const w = new Worker(workerUrl, {
    stdout: true,
    stderr: true,
  });
  /** @type {WorkerState} */
  const state = {
    key,
    activityKey,
    name,
    sandbox,
    worker: w,
    pending: new Map(),
    activityAttempts: new Map(),
    closingActivityAttempts: new Map(),
    rpcSessionIds: new Set(),
    activeExecutions: 0,
    destroyRequested: false,
    terminating: false,
    exited: false,
    terminationPromise: null,
  };
  workers.set(key, state);

  // forward stdio once
  w.stdout.setEncoding('utf8');
  w.stderr.setEncoding('utf8');
  w.stdout.on('data', (c) => process.stdout.write(`[worker:${name}] ${c}`));
  w.stderr.on('data', (c) => process.stderr.write(`[worker:${name}] ${c}`));

  w.on('message', (msg) => {
    // fatal diagnostics from worker (uncaught/unhandled)
    if (msg && msg.type === 'fatal') {
      console.error('[worker:fatal]', msg.error);
      return;
    }

    // Worker -> host RPC requests
    if (msg && msg.kind === 'rpc') {
      handleRpcMessage(w, msg);
      return;
    }

    // Normal exec response path
    const p = msg && state.pending.get(msg.id);
    if (!p) return;
    state.pending.delete(msg.id);

    if (msg.ok) {
      p.resolve(msg);
    } else {
      p.reject(new Error(msg.error));
    }
  });

  w.on('error', (err) => {
    rejectPendingExecutions(state, err);
    rejectPendingActivityAttempts(state, err);
    rejectClosingActivityAttempts(state, err);
    clearWorkerRpcSessions(state);
    removeWorkerState(state);
    detachSandbox(state.sandbox);
    cleanupWorkerSandboxInBackground(state);
  });

  w.on('exit', (code) => {
    state.exited = true;
    if (state.pending.size > 0) {
      rejectPendingExecutions(
        state,
        new Error(`Worker exited with code ${code} before responding.`),
      );
    }
    if (state.activityAttempts.size > 0) {
      rejectPendingActivityAttempts(
        state,
        new Error(
          `Activity attempt worker exited with code ${code} before completing its framed transcript.`,
        ),
      );
    }
    if (!state.terminating && state.closingActivityAttempts.size > 0) {
      rejectClosingActivityAttempts(
        state,
        new Error(
          `Activity attempt worker exited with code ${code} while closing its framed transcript.`,
        ),
      );
    }
    clearWorkerRpcSessions(state);
    removeWorkerState(state);
    detachSandbox(state.sandbox);
    cleanupWorkerSandboxInBackground(state);
  });

  return state;
}

// --- per-bundle sandbox cache: avoids recreating/extracting per call ---
/**
 * Every cached root is fresh for this process. The deterministic bundle key is
 * only a lookup key and a mkdtemp prefix; it is never used as a reusable path.
 */

/**
 * @typedef Sandbox
 * @property {string} key - Stable in-process lookup key.
 * @property {string} root - root.
 * @property {string} nodeModules - nodeModules.
 * @property {string} pkgFile - pkgFile.
 * @property {string} entryFile - entryFile.
 * @property {string} codeString - codeString.
 * @property {Promise<void> | null} cleanupPromise - Active root cleanup.
 */

/**
 * @type {Map<string,Sandbox>}
 */
const sandboxes = new Map();
/** @type {Map<string, Promise<Sandbox>>} */
const sandboxPreparations = new Map();
let sandboxCacheGeneration = 0;
/** @type {Promise<void> | null} */
let sandboxClearPromise = null;

class SandboxPreparationInvalidatedError extends Error {}

/**
 * Assert that a filesystem path is a private, non-symbolic-link directory.
 * @param {string} directory - Directory to validate.
 * @param {string} label - Human-readable path label.
 * @returns {Promise<import('node:fs').Stats>} - Directory identity.
 */
async function assertPrivateDirectory(directory, label) {
  const stats = await lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a non-symbolic-link directory.`);
  }
  if ((stats.mode & 0o777) !== 0o700) {
    throw new Error(`${label} must have mode 0700.`);
  }
  return stats;
}

/**
 * Create and validate the process-independent parent for fresh VM roots.
 * @returns {Promise<import('node:fs').Stats>} - Validated parent identity.
 */
async function ensurePrivateVmParent() {
  await mkdir(VM_PATH, { recursive: true, mode: 0o700 });
  const before = await lstat(VM_PATH);
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new Error('Wharfie VM parent must be a non-symbolic-link directory.');
  }
  await chmod(VM_PATH, 0o700);
  const after = await assertPrivateDirectory(VM_PATH, 'Wharfie VM parent');
  if (before.dev !== after.dev || before.ino !== after.ino) {
    throw new Error('Wharfie VM parent changed while it was being validated.');
  }
  return after;
}

/**
 * Create a never-before-used private root beneath the validated VM parent.
 * @param {string} key - Stable bundle key used only as a readable prefix.
 * @returns {Promise<string>} - Fresh private root.
 */
async function createFreshSandboxRoot(key) {
  const parent = await ensurePrivateVmParent();
  const root = await mkdtemp(join(VM_PATH, `${key}-`));
  try {
    await chmod(root, 0o700);
    await assertPrivateDirectory(root, 'Wharfie sandbox root');
    const currentParent = await assertPrivateDirectory(
      VM_PATH,
      'Wharfie VM parent',
    );
    if (parent.dev !== currentParent.dev || parent.ino !== currentParent.ino) {
      throw new Error(
        'Wharfie VM parent changed while a sandbox root was being created.',
      );
    }
    return root;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Reject every extracted path that is not a regular file or directory. The
 * walk uses lstat and never follows a symbolic link.
 * @param {string} root - Fresh extraction root.
 * @returns {Promise<void>}
 */
async function assertRegularSandboxTree(root) {
  await assertPrivateDirectory(root, 'Wharfie sandbox root');

  /** @param {string} directory - Directory to inspect. */
  async function visit(directory) {
    const names = await readdir(directory);
    names.sort();
    for (const name of names) {
      const entryPath = join(directory, name);
      const stats = await lstat(entryPath);
      if (stats.isSymbolicLink()) {
        throw new Error(
          `External archive produced symbolic link '${entryPath}'.`,
        );
      }
      if (stats.isDirectory()) {
        await visit(entryPath);
      } else if (!stats.isFile()) {
        throw new Error(
          `External archive produced unsupported special path '${entryPath}'.`,
        );
      }
    }
  }

  await visit(root);
}

/**
 * @param {string} name - name.
 * @param {string} codeString - codeString.
 * @param {Buffer | null} externalsTar - Materialized external bundle bytes.
 * @param {string} externalBundleDigest - External bundle content digest.
 * @param {{ isolationId?: string }} [options] - Optional one-shot physical-attempt isolation.
 * @returns {Promise<Sandbox>} - Result.
 */
async function ensureSandboxForName(
  name,
  codeString,
  externalsTar,
  externalBundleDigest,
  options = {},
) {
  if (sandboxClearPromise) {
    await sandboxClearPromise;
  }

  const activityKey = getActivityKey(name, codeString);
  const bundleKey = getBundleKey(activityKey, externalBundleDigest);
  const key = options.isolationId
    ? getActivityAttemptSandboxKey(bundleKey, options.isolationId)
    : bundleKey;
  const cached = sandboxes.get(key);
  if (cached) return cached;

  const existingPreparation = sandboxPreparations.get(key);
  if (existingPreparation) return await existingPreparation;

  const generation = sandboxCacheGeneration;
  const preparation = (async () => {
    const root = await createFreshSandboxRoot(key);
    const nodeModules = join(root, 'node_modules');
    const pkgFile = join(root, 'package.json');
    const entryFile = join(root, 'entry.js');
    /** @type {Sandbox} */
    const sandbox = {
      key,
      root,
      nodeModules,
      pkgFile,
      entryFile,
      codeString,
      cleanupPromise: null,
    };

    try {
      await mkdir(nodeModules, { mode: 0o700 });

      if (externalsTar && externalsTar.length > 0) {
        let unsupportedEntryType = null;
        const src = Readable.from([externalsTar]);
        const extractor = x({
          C: root,
          preserveOwner: false,
          preservePaths: false,
          strict: true,
          filter: (_entryPath, entry) => {
            const entryType = 'type' in entry ? String(entry.type) : 'unknown';
            if (!['Directory', 'File', 'OldFile'].includes(entryType)) {
              unsupportedEntryType ||= entryType;
              return false;
            }
            return true;
          },
        });
        await pipeline(src, extractor);
        if (unsupportedEntryType) {
          throw new Error(
            `External archive contains unsupported entry type '${unsupportedEntryType}'.`,
          );
        }
      }

      // An archive may contain a root directory record with wider mode bits.
      await chmod(root, 0o700);
      await assertRegularSandboxTree(root);

      // The archive cannot choose the manifest used as createRequire's base.
      await writeFile(
        pkgFile,
        JSON.stringify(
          { name: `wharfie-sandbox-${key.slice(0, 16)}`, private: true },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      await chmod(pkgFile, 0o600);

      if (generation !== sandboxCacheGeneration) {
        throw new SandboxPreparationInvalidatedError(
          'Sandbox preparation was invalidated by a cache clear.',
        );
      }

      sandboxes.set(key, sandbox);
      return sandbox;
    } catch (error) {
      detachSandbox(sandbox);
      await cleanupSandbox(sandbox);
      throw error;
    }
  })();

  sandboxPreparations.set(key, preparation);
  try {
    return await preparation;
  } finally {
    if (sandboxPreparations.get(key) === preparation) {
      sandboxPreparations.delete(key);
    }
  }
}

/**
 * Materialize an external bundle once so its bytes can be hashed and extracted
 * without consuming an iterable twice.
 * @param {Buffer | Uint8Array | Iterable<any> | AsyncIterable<any> | undefined} externalsTar - External bundle input.
 * @returns {Promise<Buffer | null>} - Materialized bundle bytes.
 */
async function materializeExternalBundle(externalsTar) {
  if (externalsTar === undefined || externalsTar === null) return null;
  if (Buffer.isBuffer(externalsTar) || externalsTar instanceof Uint8Array) {
    return Buffer.from(externalsTar);
  }

  const iterable = /** @type {any} */ (externalsTar);
  const isIterable =
    typeof iterable === 'object' &&
    (typeof iterable[Symbol.iterator] === 'function' ||
      typeof iterable[Symbol.asyncIterator] === 'function');
  if (!isIterable) {
    throw new TypeError(
      'externalsTar must be a Buffer, Uint8Array, or byte iterable.',
    );
  }

  return await streamToBuffer(Readable.from(iterable));
}

/**
 * @typedef ResourceRPCOptions
 * @property {Record<string, any>} resources - resources.
 * @property {number} [contextIndex] - Which arg is treated as the invocation context (default: 1)
 * @property {string} [sessionId] - Optional session id (default: random UUID)
 * @property {string[]} [resourceNames] - Explicit list of resources to expose (default: Object.keys(resources))
 */

/**
 * @typedef VMSandboxOptions
 * @property {Buffer | Uint8Array | Iterable<any> | AsyncIterable<any>} [externalsTar] - externalsTar.
 * @property {string} [externalBundleDigest] - Expected external bundle content digest.
 * @property {Object<string,string>} [env] - env.
 * @property {ResourceRPCOptions} [rpc] - Optional RPC wiring for `context.resources.*`
 * @property {string} [entrypointSymbol] - Private global symbol registry key to invoke while retaining the activity cache identity.
 */

/**
 * @param {string} name - name.
 * @param {string} codeString - codeString.
 * @param {any[] | any} params - params.
 * @param {VMSandboxOptions} options - options.
 * @returns {Promise<any>} - Result.
 */
async function runInSandbox(
  name,
  codeString,
  params,
  {
    externalsTar,
    externalBundleDigest: expectedDigest,
    env = {},
    rpc,
    entrypointSymbol,
  } = {},
) {
  if (
    entrypointSymbol !== undefined &&
    (typeof entrypointSymbol !== 'string' || entrypointSymbol.length === 0)
  ) {
    throw new TypeError(
      'entrypointSymbol must be a nonempty string when provided.',
    );
  }
  const materializedExternals = await materializeExternalBundle(externalsTar);
  const externalBundleDigest = getExternalBundleDigest(materializedExternals);
  if (expectedDigest !== undefined && expectedDigest !== externalBundleDigest) {
    throw new Error(
      'External bundle digest does not match externalsTar bytes.',
    );
  }

  // Prepare once per live worker. Teardown can invalidate a preparation after
  // this invocation starts, so retry until the worker and sandbox are bound to
  // the same currently cached instance.
  /** @type {Sandbox} */
  let sb;
  /** @type {WorkerState} */
  let state;
  for (;;) {
    try {
      sb = await ensureSandboxForName(
        name,
        codeString,
        materializedExternals,
        externalBundleDigest,
      );
    } catch (error) {
      if (error instanceof SandboxPreparationInvalidatedError) continue;
      throw error;
    }

    try {
      const candidate = ensureWorker(name, codeString, sb);
      if (!candidate) continue;
      state = candidate;
      state.activeExecutions += 1;
      break;
    } catch (error) {
      detachSandbox(sb);
      await cleanupSandbox(sb);
      throw error;
    }
  }

  /** @type {any[]} */
  const __ENTRY_ARGS__ = Array.isArray(params) ? [...params] : [params];

  // Optional resource RPC session for `context.resources`
  let cleanupRpc = null;
  const id = nextId++;

  try {
    if (rpc && rpc.resources && Object.keys(rpc.resources).length > 0) {
      const sessionId = rpc.sessionId || randomUUID();
      const rawContextIndex =
        typeof rpc.contextIndex === 'number' ? rpc.contextIndex : -1;
      const contextIndex =
        Number.isInteger(rawContextIndex) && rawContextIndex >= 0
          ? rawContextIndex
          : 1;

      rpcSessions.set(sessionId, { resources: rpc.resources });
      state.rpcSessionIds.add(sessionId);
      cleanupRpc = () => {
        rpcSessions.delete(sessionId);
        state.rpcSessionIds.delete(sessionId);
      };

      while (__ENTRY_ARGS__.length <= contextIndex) __ENTRY_ARGS__.push({});
      const ctx = __ENTRY_ARGS__[contextIndex];
      const safeCtx = ctx && typeof ctx === 'object' ? ctx : {};
      const existingResources =
        safeCtx.resources && typeof safeCtx.resources === 'object'
          ? safeCtx.resources
          : {};

      const resourceNames = Array.isArray(rpc.resourceNames)
        ? rpc.resourceNames
        : Object.keys(rpc.resources);

      __ENTRY_ARGS__[contextIndex] = {
        ...safeCtx,
        resources: {
          ...existingResources,
          __wharfie_rpc: true,
          __wharfie_rpc_sessionId: sessionId,
          __wharfie_rpc_resources: resourceNames,
        },
      };
    }

    const msg = await new Promise((resolve, reject) => {
      state.pending.set(id, { resolve, reject });
      state.worker.postMessage({
        id,
        kind: 'exec',
        codeString: sb.codeString,
        entryFile: sb.entryFile,
        tmpRoot: sb.root,
        pkgFile: sb.pkgFile,
        env,
        __ENTRY_ARGS__,
        functionName: entrypointSymbol || name,
      });
    });

    if (!msg || !msg.ok) {
      throw new Error(msg && msg.error ? msg.error : 'Unknown worker error');
    }

    return msg.value;
  } finally {
    state.pending.delete(id);
    if (cleanupRpc) cleanupRpc();
    state.activeExecutions -= 1;
    if (state.destroyRequested && state.activeExecutions === 0) {
      await terminateWorkerState(state);
    }
  }
}

/**
 * @typedef ActivityAttemptSandboxOptions
 * @property {Buffer | Uint8Array | Iterable<any> | AsyncIterable<any>} [externalsTar] - Frozen external bundle bytes.
 * @property {string} [externalBundleDigest] - Expected external-bundle content digest.
 * @property {Object<string,string>} [env] - Fixed sandbox environment additions.
 * @property {string} entrypointSymbol - Fixed private protocol wrapper symbol.
 * @property {AbortSignal} [signal] - Optional host cancellation signal.
 * @property {number} [readyTimeoutMs] - Maximum private-wrapper startup time.
 * @property {number} [cancellationGraceMs] - Cooperative cancellation grace before worker termination.
 */

/**
 * @param {unknown} value - Candidate cancellation grace duration.
 * @returns {number} - Valid nonnegative finite grace duration.
 */
function validateActivityAttemptCancellationGrace(value) {
  const grace =
    value === undefined ? DEFAULT_ACTIVITY_CANCELLATION_GRACE_MS : value;
  if (
    typeof grace !== 'number' ||
    !Number.isSafeInteger(grace) ||
    grace < 0 ||
    grace > MAX_TIMER_DELAY_MS
  ) {
    throw new TypeError(
      `cancellationGraceMs must be a nonnegative safe integer no greater than ${MAX_TIMER_DELAY_MS}.`,
    );
  }
  return grace;
}

/**
 * @param {unknown} value - Candidate wrapper-ready timeout duration.
 * @returns {number} - Valid positive finite ready timeout.
 */
function validateActivityAttemptReadyTimeout(value) {
  const timeout =
    value === undefined ? DEFAULT_ACTIVITY_WORKER_READY_TIMEOUT_MS : value;
  if (
    typeof timeout !== 'number' ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > MAX_TIMER_DELAY_MS
  ) {
    throw new TypeError(
      `readyTimeoutMs must be a positive safe integer no greater than ${MAX_TIMER_DELAY_MS}.`,
    );
  }
  return timeout;
}

/**
 * Run exactly one private activity wrapper on a one-shot worker using framed
 * Activity Protocol messages. The host, not the bundle, owns the start frame,
 * transcript validator, cancellation watchdog, and returned evidence.
 * @param {string} name - Declared activity logical ID.
 * @param {string} codeString - Exact bundled activity source.
 * @param {unknown} startFrame - Candidate host-owned Activity Protocol start frame.
 * @param {ActivityAttemptSandboxOptions} options - Framed attempt options.
 * @returns {Promise<Record<string, any>>} - Host-collected raw evidence for final revalidation.
 */
async function runActivityAttemptInSandbox(
  name,
  codeString,
  startFrame,
  {
    externalsTar,
    externalBundleDigest: expectedDigest,
    env = {},
    entrypointSymbol,
    signal,
    readyTimeoutMs,
    cancellationGraceMs,
  } = /** @type {ActivityAttemptSandboxOptions} */ ({}),
) {
  if (typeof entrypointSymbol !== 'string' || entrypointSymbol.length === 0) {
    throw new TypeError(
      'Activity Protocol worker transport requires a nonempty entrypointSymbol.',
    );
  }
  if (
    signal !== undefined &&
    (!signal ||
      typeof signal !== 'object' ||
      typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function')
  ) {
    throw new TypeError(
      'signal must be an AbortSignal with addEventListener and removeEventListener when provided.',
    );
  }

  const grace = validateActivityAttemptCancellationGrace(cancellationGraceMs);
  const readyTimeout = validateActivityAttemptReadyTimeout(readyTimeoutMs);
  const transcript = new ActivityProtocolTranscriptValidator();
  const start = transcript.acceptHostFrame(startFrame);
  if (start.type !== 'start') {
    throw new TypeError(
      'Activity Protocol worker transport requires a start frame.',
    );
  }
  if (start.activityId !== name) {
    throw new TypeError(
      `Activity Protocol start selects '${start.activityId}', not '${name}'.`,
    );
  }

  const materializedExternals = await materializeExternalBundle(externalsTar);
  const externalBundleDigest = getExternalBundleDigest(materializedExternals);
  if (expectedDigest !== undefined && expectedDigest !== externalBundleDigest) {
    throw new Error(
      'External bundle digest does not match externalsTar bytes.',
    );
  }

  // A physical attempt gets an isolated sandbox/worker even for identical
  // bundle bytes. This makes host-enforced Worker.terminate() precisely scoped.
  const isolationId = randomUUID();
  /** @type {Sandbox} */
  let sb;
  /** @type {WorkerState} */
  let state;
  for (;;) {
    try {
      sb = await ensureSandboxForName(
        name,
        codeString,
        materializedExternals,
        externalBundleDigest,
        { isolationId },
      );
    } catch (error) {
      if (error instanceof SandboxPreparationInvalidatedError) continue;
      throw error;
    }

    try {
      const candidate = ensureWorker(name, codeString, sb);
      if (!candidate) continue;
      state = candidate;
      state.activeExecutions += 1;
      break;
    } catch (error) {
      detachSandbox(sb);
      await cleanupSandbox(sb);
      throw error;
    }
  }

  const id = nextId++;
  const { port1, port2 } = new MessageChannel();
  const transportAuth = randomUUID();
  /** @type {PendingActivityAttempt | null} */
  let attempt = null;
  try {
    return await new Promise((resolve, reject) => {
      attempt = {
        resolve,
        reject,
        start,
        transcript,
        frames: [start],
        terminal: null,
        ready: false,
        startSent: false,
        finished: false,
        cancelRequested: false,
        pendingCancel: null,
        port: port1,
        transportAuth,
        readyTimeoutMs: readyTimeout,
        readyTimer: null,
        cancellationGraceMs: grace,
        cancellationTimer: null,
        deadlineTimer: null,
        terminalTimer: null,
        removeAbortListener: null,
      };
      const pendingAttempt = attempt;
      state.activityAttempts.set(id, pendingAttempt);
      port1.on('message', (/** @type {unknown} */ msg) => {
        handleAuthenticatedActivityAttemptPortMessage(
          state,
          id,
          pendingAttempt,
          msg,
        );
      });
      port1.on('messageerror', () => {
        failActivityAttempt(
          state,
          id,
          new Error(
            'The private Activity Protocol port could not decode a message.',
          ),
        );
      });
      armActivityAttemptReadyWatchdog(state, id, pendingAttempt);
      armActivityAttemptDeadlineWatchdog(state, id, attempt);

      if (signal) {
        const onAbort = () => {
          requestActivityAttemptCancellation(
            state,
            id,
            serializeActivityAttemptError(signal.reason, 'cancel-requested'),
          );
        };
        signal.addEventListener('abort', onAbort, { once: true });
        attempt.removeAbortListener = () =>
          signal.removeEventListener('abort', onAbort);
        if (signal.aborted) onAbort();
      }

      try {
        state.worker.postMessage(
          {
            kind: 'activity-attempt-open',
            id,
            codeString: sb.codeString,
            entryFile: sb.entryFile,
            tmpRoot: sb.root,
            pkgFile: sb.pkgFile,
            env,
            entrypointSymbol,
            transportPort: port2,
            transportAuth,
          },
          [port2],
        );
      } catch (cause) {
        try {
          port2.close();
        } catch {}
        const error = new Error(
          'Could not open framed activity attempt worker transport.',
        );
        /** @type {Error & {cause?: unknown}} */ (error).cause = cause;
        failActivityAttempt(state, id, error);
      }
    });
  } finally {
    const pending = state.activityAttempts.get(id);
    if (pending) {
      state.activityAttempts.delete(id);
      cleanupPendingActivityAttempt(pending);
      closeActivityAttemptPort(pending);
    }
    state.activeExecutions -= 1;
    await terminateWorkerState(state, { force: true });
  }
}

/**
 * Terminate all workers, or only workers for one activity/bundle.
 * @param {string} [name] - Optional activity name.
 * @param {string} [codeString] - Optional exact bundle source.
 * @param {string} [externalBundleDigest] - Optional exact external bundle digest.
 * @returns {Promise<void>}
 */
async function destroyWorker(name, codeString, externalBundleDigest) {
  let states;
  if (
    typeof name === 'string' &&
    typeof codeString === 'string' &&
    typeof externalBundleDigest === 'string'
  ) {
    const state = workers.get(
      getBundleKey(getActivityKey(name, codeString), externalBundleDigest),
    );
    states = state ? [state] : [];
  } else if (typeof name === 'string' && typeof codeString === 'string') {
    const activityKey = getActivityKey(name, codeString);
    states = [...workers.values()].filter(
      (state) => state.activityKey === activityKey,
    );
  } else if (typeof name === 'string') {
    states = [...workers.values()].filter((state) => state.name === name);
  } else {
    states = [...workers.values()];
  }

  const force = typeof name !== 'string';
  await Promise.all(
    states.map((state) => terminateWorkerState(state, { force })),
  );
}

/**
 * Invalidate every cached/preparing sandbox, terminate its worker, and wait
 * until every filesystem root from the old generation is gone.
 * @returns {Promise<void>}
 */
async function clearSandboxCache() {
  if (sandboxClearPromise) {
    await sandboxClearPromise;
    return;
  }

  const operation = (async () => {
    sandboxCacheGeneration += 1;
    const cachedSandboxes = [...sandboxes.values()];
    const preparations = [...sandboxPreparations.values()];
    sandboxes.clear();
    sandboxPreparations.clear();

    await destroyWorker();
    const preparedResults = await Promise.allSettled(preparations);
    for (const result of preparedResults) {
      if (result.status === 'fulfilled') {
        cachedSandboxes.push(result.value);
      }
    }

    await Promise.all(
      [...new Set(cachedSandboxes)].map((sandbox) => cleanupSandbox(sandbox)),
    );
  })();

  sandboxClearPromise = operation;
  try {
    await operation;
  } finally {
    if (sandboxClearPromise === operation) {
      sandboxClearPromise = null;
    }
  }
}

export default {
  runInSandbox,
  runActivityAttemptInSandbox,
  getExternalBundleDigest,
  _destroyWorker: destroyWorker,
  _clearSandboxCache: clearSandboxCache,
};
