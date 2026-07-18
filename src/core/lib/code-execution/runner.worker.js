import { parentPort, isMainThread } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { createHmac, timingSafeEqual } from 'node:crypto';

if (process.setSourceMapsEnabled) process.setSourceMapsEnabled(true);

// Global guards – shared across any accidental re-evaluations of this script

/**
 * @typedef WorkerInitializationState
 * @property {boolean} handlerInstalled - Whether the message handler exists.
 * @property {boolean} bundleLoaded - Whether this worker loaded its bundle.
 */

/**
 * @typedef {typeof globalThis & {__wharfieWorkerInit?: WorkerInitializationState} & Record<symbol, unknown>} WorkerGlobal
 */

const runtimeGlobal = /** @type {WorkerGlobal} */ (globalThis);

/**
 * Keep initialization state across accidental re-evaluation without widening
 * the process-wide global type for every module.
 * @returns {WorkerInitializationState} - Shared worker initialization state.
 */
function getWorkerInitializationState() {
  if (!runtimeGlobal.__wharfieWorkerInit) {
    runtimeGlobal.__wharfieWorkerInit = {
      handlerInstalled: false,
      bundleLoaded: false,
    };
  }
  return runtimeGlobal.__wharfieWorkerInit;
}

const workerInitialization = getWorkerInitializationState();

// Capture the transport-critical intrinsics before bundle code can mutate
// globals or built-in prototypes in this shared isolate. Remaining dynamic
// convenience globals can at most let component code deny service to itself;
// the host still revalidates every evidence transition.
const applyIntrinsic = Reflect.apply;
const arrayIsArrayIntrinsic = Array.isArray;
const arraySortIntrinsic = Array.prototype.sort;
const objectKeysIntrinsic = Object.keys;
const jsonStringifyIntrinsic = JSON.stringify;
const structuredCloneIntrinsic = globalThis.structuredClone;
const bufferIntrinsic = Buffer;
const bufferFromIntrinsic = Buffer.from;
const mapGetIntrinsic = Map.prototype.get;
const mapHasIntrinsic = Map.prototype.has;
const mapSetIntrinsic = Map.prototype.set;
const mapDeleteIntrinsic = Map.prototype.delete;
const mapForEachIntrinsic = Map.prototype.forEach;
const PromiseIntrinsic = Promise;
const promiseResolveIntrinsic = Promise.resolve;
const promiseRejectIntrinsic = Promise.reject;
const promiseThenIntrinsic = Promise.prototype.then;
const hmacProbe = createHmac('sha256', 'wharfie-intrinsic-probe');
const hmacUpdateIntrinsic = hmacProbe.update;
const hmacDigestIntrinsic = hmacProbe.digest;
applyIntrinsic(hmacDigestIntrinsic, hmacProbe, []);

/**
 * @typedef ActivityAttemptHostTransport
 * @property {(message: Record<string, any>) => void} send - Send one authenticated runner-to-host message.
 * @property {(event: string, listener: (value: unknown) => void) => void} on - Listen through the authenticated host-to-runner boundary.
 */

/**
 * Serialize one host control message before authenticating it. Control messages
 * contain strict JSON protocol frames and bounded transport fields; sorting
 * object keys prevents insertion-order differences across structured cloning
 * from changing the authenticator. Its critical intrinsics are captured before
 * bundle evaluation so app code cannot alter verification semantics.
 * @param {any} value - JSON control value.
 * @returns {string} - Canonical JSON text.
 */
function stringifyCanonicalHostControl(value) {
  if (arrayIsArrayIntrinsic(value)) {
    let output = '[';
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) output += ',';
      output += stringifyCanonicalHostControl(value[index]);
    }
    return `${output}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = applyIntrinsic(objectKeysIntrinsic, Object, [value]);
    applyIntrinsic(arraySortIntrinsic, keys, []);
    let output = '{';
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (index > 0) output += ',';
      output += `${applyIntrinsic(jsonStringifyIntrinsic, JSON, [key])}:${stringifyCanonicalHostControl(value[key])}`;
    }
    return `${output}}`;
  }
  return /** @type {string} */ (
    applyIntrinsic(jsonStringifyIntrinsic, JSON, [value])
  );
}

/**
 * @param {string} secret - Per-attempt secret captured before bundle code.
 * @param {Record<string, any>} message - Unsigned host control message.
 * @returns {string} - Domain-separated message authenticator.
 */
function authenticateHostControl(secret, message) {
  const hmac = createHmac('sha256', secret);
  applyIntrinsic(hmacUpdateIntrinsic, hmac, [
    'wharfie-activity-host-control-v1\0',
  ]);
  applyIntrinsic(hmacUpdateIntrinsic, hmac, [
    stringifyCanonicalHostControl(message),
  ]);
  return /** @type {string} */ (
    applyIntrinsic(hmacDigestIntrinsic, hmac, ['base64url'])
  );
}

/**
 * @param {unknown} left - Candidate authenticator.
 * @param {string} right - Expected authenticator.
 * @returns {boolean} - Constant-time equality for canonical signatures.
 */
function hasSameAuthenticator(left, right) {
  if (typeof left !== 'string') return false;
  const received = applyIntrinsic(bufferFromIntrinsic, bufferIntrinsic, [
    left,
    'utf8',
  ]);
  const expected = applyIntrinsic(bufferFromIntrinsic, bufferIntrinsic, [
    right,
    'utf8',
  ]);
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

/**
 * Capture the MessagePort capabilities before evaluating a bundle. Bundled
 * code shares this Node isolate, so it can discover active handles and mutate
 * prototypes; it must not be able to observe the per-attempt authenticator or
 * impersonate runner lifecycle messages.
 * @param {unknown} value - Candidate transferred MessagePort.
 * @param {number} id - Fixed host transport session ID.
 * @param {string} auth - Opaque host-generated runner authenticator.
 * @returns {ActivityAttemptHostTransport} - Closure-backed private transport.
 */
function createActivityAttemptHostTransport(value, id, auth) {
  const port = /** @type {import('node:worker_threads').MessagePort} */ (value);
  if (
    !value ||
    typeof value !== 'object' ||
    typeof port.postMessage !== 'function' ||
    typeof port.on !== 'function' ||
    typeof auth !== 'string' ||
    auth.length === 0
  ) {
    throw new TypeError(
      'Activity attempt requires an authenticated private transport port.',
    );
  }
  // These native methods are bound while this runner is still trusted. Never
  // retain the raw port in a session after bundle evaluation.
  const postMessage = port.postMessage.bind(port);
  const on = port.on.bind(port);
  let nextHostControlSequence = 1;
  return Object.freeze({
    send(message) {
      postMessage({ ...message, id, transportAuth: auth });
    },
    on(event, listener) {
      if (event !== 'message') {
        on(event, listener);
        return;
      }
      on(event, (value) => {
        if (
          !value ||
          typeof value !== 'object' ||
          arrayIsArrayIntrinsic(value)
        ) {
          return;
        }
        /** @type {Record<string, any>} */
        let control;
        try {
          // A discovered MessagePort can emit a local event without structured
          // cloning. Snapshot once so stateful getters/proxies cannot present a
          // signed view during verification and a forged view during dispatch.
          control = /** @type {Record<string, any>} */ (
            applyIntrinsic(structuredCloneIntrinsic, globalThis, [value])
          );
        } catch {
          return;
        }
        if (
          control.id !== id ||
          control.controlSequence !== nextHostControlSequence
        ) {
          return;
        }
        const unsigned = /** @type {Record<string, any>} */ (
          applyIntrinsic(structuredCloneIntrinsic, globalThis, [control])
        );
        const transportAuth = unsigned.transportAuth;
        delete unsigned.transportAuth;
        if (
          !hasSameAuthenticator(
            transportAuth,
            authenticateHostControl(auth, unsigned),
          )
        ) {
          return;
        }
        nextHostControlSequence += 1;
        listener(control);
      });
    },
  });
}

/**
 * @typedef ActivityAttemptRunnerSession
 * @property {number} id - Host transport session ID.
 * @property {((request: Record<string, any>) => any) | null} entrypoint - Fixed private bundle wrapper once loaded.
 * @property {ActivityAttemptHostTransport} transport - Closure-backed authenticated host transport.
 * @property {AbortController} controller - Runner-owned cancellation boundary.
 * @property {boolean} started - Whether the host start frame was accepted.
 * @property {boolean} preCancelled - Whether the host cancelled before the start frame was physically sent.
 * @property {boolean} cancelled - Whether the host sent its one cancellation frame.
 * @property {boolean} finished - Whether the wrapper settled.
 * @property {boolean} componentTerminal - Whether a terminal component frame was emitted.
 * @property {Map<number, {resolve: () => void, reject: (error: Error) => void, effectId?: string}>} componentAcks - Component frame delivery acknowledgements.
 * @property {Map<string, {request: Record<string, any>, claimed: boolean, settled: boolean, promise: Promise<unknown>, resolve: (value: unknown) => void, reject: (error: Error) => void}>} effectResults - Correlated host effect results.
 * @property {Promise<never> | null} forceTermination - Pending host termination request.
 */

/** @type {Map<number, ActivityAttemptRunnerSession>} */
const activityAttemptSessions = new Map();
const activityAttemptSessionGet = mapGetIntrinsic;
const activityAttemptSessionHas = mapHasIntrinsic;
const activityAttemptSessionSet = mapSetIntrinsic;

/**
 * @param {Map<any, any>} map - Private runner map.
 * @param {any} key - Lookup key.
 * @returns {any} - Stored value.
 */
function getPrivateMapValue(map, key) {
  return applyIntrinsic(mapGetIntrinsic, map, [key]);
}

/**
 * @param {Map<any, any>} map - Private runner map.
 * @param {any} key - Candidate key.
 * @returns {boolean} - Whether the key exists.
 */
function hasPrivateMapValue(map, key) {
  return applyIntrinsic(mapHasIntrinsic, map, [key]);
}

/**
 * @param {Map<any, any>} map - Private runner map.
 * @param {any} key - Storage key.
 * @param {any} value - Storage value.
 * @returns {void}
 */
function setPrivateMapValue(map, key, value) {
  applyIntrinsic(mapSetIntrinsic, map, [key, value]);
}

/**
 * @param {Map<any, any>} map - Private runner map.
 * @param {any} key - Deletion key.
 * @returns {void}
 */
function deletePrivateMapValue(map, key) {
  applyIntrinsic(mapDeleteIntrinsic, map, [key]);
}

/**
 * @param {unknown} error - Rejection reason.
 * @returns {Promise<never>} - Rejected pristine promise.
 */
function rejectPrivatePromise(error) {
  return applyIntrinsic(promiseRejectIntrinsic, PromiseIntrinsic, [error]);
}

/**
 * Use the pre-bundle Map intrinsic so bundle code cannot discover a session by
 * monkeypatching Map.prototype.get during a later host control transition.
 * @param {number} id - Host transport session ID.
 * @returns {ActivityAttemptRunnerSession | undefined} - Existing session.
 */
function getActivityAttemptSession(id) {
  return /** @type {ActivityAttemptRunnerSession | undefined} */ (
    applyIntrinsic(activityAttemptSessionGet, activityAttemptSessions, [id])
  );
}

/**
 * @param {number} id - Host transport session ID.
 * @returns {boolean} - Whether the session already exists.
 */
function hasActivityAttemptSession(id) {
  return applyIntrinsic(activityAttemptSessionHas, activityAttemptSessions, [
    id,
  ]);
}

/**
 * @param {number} id - Host transport session ID.
 * @param {ActivityAttemptRunnerSession} session - New session.
 * @returns {void}
 */
function setActivityAttemptSession(id, session) {
  applyIntrinsic(activityAttemptSessionSet, activityAttemptSessions, [
    id,
    session,
  ]);
}

/**
 * @param {unknown} error - Local error.
 * @returns {string} - Safe transport diagnostic.
 */
function toTransportError(error) {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

/**
 * Reject every unresolved host effect when its one-shot runner closes.
 * @param {ActivityAttemptRunnerSession} session - Closing runner session.
 * @param {Error} error - Stable local failure.
 * @returns {void}
 */
function rejectPendingActivityAttemptEffects(session, error) {
  applyIntrinsic(mapForEachIntrinsic, session.effectResults, [
    (pending) => {
      if (pending.settled) return;
      pending.settled = true;
      pending.reject(error);
    },
  ]);
}

/**
 * Register an effect-result promise before the corresponding component frame
 * leaves the runner. A fast host may return the result before application code
 * reaches transport.handleEffect, so the retained promise is the correlation
 * authority rather than message timing.
 * @param {ActivityAttemptRunnerSession} session - Active runner session.
 * @param {Record<string, any>} request - Candidate effect-request frame.
 * @returns {void}
 */
function registerActivityAttemptEffect(session, request) {
  if (
    typeof request.effectId !== 'string' ||
    request.effectId.length === 0 ||
    hasPrivateMapValue(session.effectResults, request.effectId)
  ) {
    throw new Error('Activity attempt emitted an invalid effect identity.');
  }
  /** @type {(value: unknown) => void} */
  let resolve = () => {};
  /** @type {(error: Error) => void} */
  let reject = () => {};
  const promise = new PromiseIntrinsic((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  // The component-frame acknowledgement may fail before runNodeActivityAttempt
  // asks for the result. Keep a future rejection observed without changing the
  // promise returned to the actual effect caller.
  applyIntrinsic(promiseThenIntrinsic, promise, [undefined, () => {}]);
  setPrivateMapValue(session.effectResults, request.effectId, {
    request,
    claimed: false,
    settled: false,
    promise,
    resolve,
    reject,
  });
}

/**
 * @param {ActivityAttemptRunnerSession} session - Active runner session.
 * @param {Record<string, any>} request - Exact already-delivered request.
 * @returns {Promise<unknown>} - Correlated host effect result.
 */
function requestActivityAttemptEffect(session, request) {
  if (session.finished || session.componentTerminal) {
    return rejectPrivatePromise(
      new Error('Activity attempt cannot request an effect after terminal.'),
    );
  }
  const pending = getPrivateMapValue(session.effectResults, request?.effectId);
  if (!pending || pending.request !== request || pending.claimed) {
    return rejectPrivatePromise(
      new Error('Activity attempt requested an uncorrelated host effect.'),
    );
  }
  pending.claimed = true;
  return pending.promise;
}

/**
 * @param {ActivityAttemptRunnerSession} session - Active runner session.
 * @param {unknown} frame - Candidate component frame.
 * @returns {Promise<void>} - Resolves only after the host accepted this exact sequence.
 */
function deliverActivityAttemptComponentFrame(session, frame) {
  if (session.finished || session.componentTerminal) {
    return rejectPrivatePromise(
      new Error(
        'Activity attempt cannot emit a component frame after terminal.',
      ),
    );
  }
  if (
    frame === null ||
    typeof frame !== 'object' ||
    arrayIsArrayIntrinsic(frame)
  ) {
    return rejectPrivatePromise(
      new TypeError('Activity attempt emitted a malformed component frame.'),
    );
  }
  const component = /** @type {Record<string, any>} */ (frame);
  if (!Number.isSafeInteger(component.sequence) || component.sequence < 1) {
    return rejectPrivatePromise(
      new TypeError('Activity attempt emitted a malformed component frame.'),
    );
  }
  const sequence = component.sequence;
  if (hasPrivateMapValue(session.componentAcks, sequence)) {
    return rejectPrivatePromise(
      new Error(
        `Activity attempt emitted duplicate component sequence ${sequence}.`,
      ),
    );
  }
  if (
    component.type === 'completed' ||
    component.type === 'failed' ||
    component.type === 'cancelled' ||
    component.type === 'deadline-exceeded' ||
    component.type === 'protocol-failed'
  ) {
    session.componentTerminal = true;
  }

  if (component.type === 'effect-request') {
    try {
      registerActivityAttemptEffect(session, component);
    } catch (error) {
      return rejectPrivatePromise(
        error instanceof Error
          ? error
          : new Error('Could not register activity effect request.'),
      );
    }
  }

  return new PromiseIntrinsic((resolve, reject) => {
    setPrivateMapValue(session.componentAcks, sequence, {
      resolve,
      reject,
      ...(component.type === 'effect-request'
        ? { effectId: component.effectId }
        : {}),
    });
    try {
      session.transport.send({
        kind: 'activity-attempt-component-frame',
        frame: component,
      });
    } catch (cause) {
      deletePrivateMapValue(session.componentAcks, sequence);
      const pendingEffect = getPrivateMapValue(
        session.effectResults,
        component.effectId,
      );
      if (pendingEffect && !pendingEffect.settled) {
        pendingEffect.settled = true;
        pendingEffect.reject(
          new Error('Could not deliver activity effect request.'),
        );
      }
      reject(
        cause instanceof Error
          ? cause
          : new Error('Could not deliver activity component frame.'),
      );
    }
  });
}

/**
 * @param {ActivityAttemptRunnerSession} session - Active runner session.
 * @returns {Promise<never>} - Never resolves: the host must terminate this one-shot worker.
 */
function requestActivityAttemptForceTermination(session) {
  if (session.forceTermination) return session.forceTermination;
  session.forceTermination = new PromiseIntrinsic((_resolve, reject) => {
    try {
      session.transport.send({
        kind: 'activity-attempt-force-terminate',
      });
    } catch (cause) {
      reject(
        cause instanceof Error
          ? cause
          : new Error('Could not request activity worker termination.'),
      );
    }
  });
  return session.forceTermination;
}

/**
 * @param {ActivityAttemptRunnerSession} session - Active runner session.
 * @param {Record<string, any>} reasonDetails - Structured cancellation reason.
 * @returns {void}
 */
function abortActivityAttemptWithReason(session, reasonDetails) {
  const reason = new Error(
    String(reasonDetails.message || 'Activity cancelled.'),
  );
  reason.name = String(reasonDetails.name || 'ActivityCancellationError');
  Object.assign(reason, {
    code: reasonDetails.code,
    details: reasonDetails.details,
  });
  if (!session.controller.signal.aborted) session.controller.abort(reason);
}

/**
 * @param {ActivityAttemptRunnerSession} session - Active runner session.
 * @param {Record<string, any>} cancel - Host cancellation frame.
 * @returns {void}
 */
function abortActivityAttempt(session, cancel) {
  if (session.cancelled) {
    throw new Error('Activity attempt received duplicate cancellation.');
  }
  if (
    cancel === null ||
    typeof cancel !== 'object' ||
    Array.isArray(cancel) ||
    cancel.type !== 'cancel' ||
    cancel.attemptId === undefined ||
    cancel.reason === null ||
    typeof cancel.reason !== 'object' ||
    Array.isArray(cancel.reason)
  ) {
    throw new TypeError(
      'Activity attempt received an invalid cancellation frame.',
    );
  }
  session.cancelled = true;
  abortActivityAttemptWithReason(session, cancel.reason);
}

/**
 * @param {Record<string, any>} msg - Pre-start cancellation control message.
 * @returns {void}
 */
function receiveActivityAttemptPreCancellation(msg) {
  const session = getActivityAttemptSession(msg?.id);
  if (!session || session.started || session.preCancelled || session.finished) {
    return;
  }
  const reason = msg.reason;
  if (reason === null || typeof reason !== 'object' || Array.isArray(reason)) {
    session.finished = true;
    session.transport.send({
      kind: 'activity-attempt-failed',
      error: 'Activity attempt received an invalid pre-start cancellation.',
    });
    return;
  }
  session.preCancelled = true;
  abortActivityAttemptWithReason(
    session,
    /** @type {Record<string, any>} */ (reason),
  );
}

/**
 * @param {Record<string, any>} msg - Open message.
 * @returns {Promise<void>} - Completion after readiness/failure is sent.
 */
async function openActivityAttempt(msg) {
  const id = msg?.id;
  if (!Number.isSafeInteger(id) || id < 1 || hasActivityAttemptSession(id)) {
    return;
  }
  const transportPort = msg?.transportPort;
  /** @type {ActivityAttemptHostTransport | null} */
  let transport = null;
  try {
    const {
      codeString,
      entryFile,
      tmpRoot,
      pkgFile,
      env,
      entrypointSymbol,
      transportAuth,
    } = msg;
    transport = createActivityAttemptHostTransport(
      transportPort,
      id,
      transportAuth,
    );
    if (typeof entrypointSymbol !== 'string' || entrypointSymbol.length === 0) {
      throw new TypeError(
        'Activity attempt requires a private entrypoint symbol.',
      );
    }
    /** @type {ActivityAttemptRunnerSession} */
    const session = {
      id,
      entrypoint: null,
      transport,
      controller: new AbortController(),
      started: false,
      preCancelled: false,
      cancelled: false,
      finished: false,
      componentTerminal: false,
      componentAcks: new Map(),
      effectResults: new Map(),
      forceTermination: null,
    };
    // Store the session and bind the port before untrusted bundle evaluation.
    // The only retained route back to the host is the closure-backed transport
    // that adds the host-generated authenticator after every message payload.
    setActivityAttemptSession(id, session);
    transport.on('message', (control) => {
      if (!control || typeof control !== 'object') return;
      const controlMessage = /** @type {Record<string, any>} */ (control);
      if (controlMessage.kind === 'activity-attempt-pre-cancel') {
        receiveActivityAttemptPreCancellation(controlMessage);
      } else if (controlMessage.kind === 'activity-attempt-host-frame') {
        receiveActivityAttemptHostFrame(controlMessage);
      } else if (controlMessage.kind === 'activity-attempt-component-ack') {
        receiveActivityAttemptComponentAck(controlMessage);
      } else if (controlMessage.kind === 'activity-attempt-effect-rejected') {
        receiveActivityAttemptEffectRejection(controlMessage);
      }
    });
    transport.on('messageerror', () => {
      if (session.finished) return;
      session.finished = true;
      rejectPendingActivityAttemptEffects(
        session,
        new Error(
          'The private Activity Protocol port could not decode a host message.',
        ),
      );
      try {
        session.transport.send({
          kind: 'activity-attempt-failed',
          error:
            'The private Activity Protocol port could not decode a host message.',
        });
      } catch {}
    });
    runBundleOnce({ codeString, entryFile, tmpRoot, pkgFile, env });
    const entrypoint = runtimeGlobal[Symbol.for(entrypointSymbol)];
    if (typeof entrypoint !== 'function') {
      throw new TypeError(
        `Global Activity Protocol entrypoint ${entrypointSymbol} is not a function`,
      );
    }
    session.entrypoint = /** @type {(request: Record<string, any>) => any} */ (
      entrypoint
    );
    session.transport.send({ kind: 'activity-attempt-ready' });
  } catch (error) {
    if (transport) {
      transport.send({
        kind: 'activity-attempt-failed',
        error: toTransportError(error),
      });
    }
  }
}

/**
 * @param {Record<string, any>} msg - Host frame message.
 * @returns {void}
 */
function receiveActivityAttemptHostFrame(msg) {
  const id = msg?.id;
  const session = getActivityAttemptSession(id);
  if (!session || session.finished) return;
  const frame = msg.frame;

  try {
    if (frame?.type === 'start') {
      if (session.started) {
        throw new Error('Activity attempt received duplicate start frame.');
      }
      if (!session.entrypoint) {
        throw new Error('Activity attempt wrapper was not ready at start.');
      }
      session.started = true;
      const execution = applyIntrinsic(
        promiseResolveIntrinsic,
        PromiseIntrinsic,
        [
          session.entrypoint({
            startFrame: frame,
            transport: {
              onComponentFrame: (/** @type {unknown} */ componentFrame) =>
                deliverActivityAttemptComponentFrame(session, componentFrame),
              handleEffect: (/** @type {Record<string, any>} */ request) =>
                requestActivityAttemptEffect(session, request),
              signal: session.controller.signal,
              forceTerminate: () =>
                requestActivityAttemptForceTermination(session),
            },
          }),
        ],
      );
      applyIntrinsic(promiseThenIntrinsic, execution, [
        () => {
          if (session.finished) return;
          session.finished = true;
          rejectPendingActivityAttemptEffects(
            session,
            new Error('Activity attempt closed with an unresolved effect.'),
          );
          session.transport.send({
            kind: 'activity-attempt-finished',
          });
        },
        (error) => {
          if (session.finished) return;
          session.finished = true;
          rejectPendingActivityAttemptEffects(
            session,
            new Error('Activity attempt failed with an unresolved effect.'),
          );
          session.transport.send({
            kind: 'activity-attempt-failed',
            error: toTransportError(error),
          });
        },
      ]);
      return;
    }
    if (frame?.type === 'cancel') {
      if (!session.started) {
        throw new Error('Activity attempt received cancellation before start.');
      }
      abortActivityAttempt(session, frame);
      return;
    }
    if (frame?.type === 'effect-result') {
      if (!session.started) {
        throw new Error(
          'Activity attempt received an effect result before start.',
        );
      }
      const pending = getPrivateMapValue(session.effectResults, frame.effectId);
      if (
        !pending ||
        pending.settled ||
        frame.attemptId !== pending.request.attemptId
      ) {
        throw new Error(
          'Activity attempt received an uncorrelated effect result.',
        );
      }
      pending.settled = true;
      pending.resolve(frame);
      return;
    }
    throw new TypeError('Activity attempt received an unsupported host frame.');
  } catch (error) {
    session.finished = true;
    rejectPendingActivityAttemptEffects(
      session,
      new Error('Activity attempt received an invalid host control frame.'),
    );
    session.transport.send({
      kind: 'activity-attempt-failed',
      error: toTransportError(error),
    });
  }
}

/**
 * @param {Record<string, any>} msg - Host-side effect-handler rejection.
 * @returns {void}
 */
function receiveActivityAttemptEffectRejection(msg) {
  const session = getActivityAttemptSession(msg?.id);
  if (!session || session.finished) return;
  const pending = getPrivateMapValue(session.effectResults, msg.effectId);
  if (!pending || pending.settled) {
    session.finished = true;
    rejectPendingActivityAttemptEffects(
      session,
      new Error('Activity attempt received an uncorrelated effect failure.'),
    );
    session.transport.send({
      kind: 'activity-attempt-failed',
      error: 'Activity attempt received an uncorrelated effect failure.',
    });
    return;
  }
  pending.settled = true;
  pending.reject(
    new Error(
      typeof msg.error === 'string'
        ? msg.error
        : 'The host managed-effect handler failed.',
    ),
  );
}

/**
 * @param {Record<string, any>} msg - Host component acknowledgement.
 * @returns {void}
 */
function receiveActivityAttemptComponentAck(msg) {
  const session = getActivityAttemptSession(msg?.id);
  if (!session) return;
  const sequence = msg.sequence;
  const pending = getPrivateMapValue(session.componentAcks, sequence);
  if (!pending) return;
  deletePrivateMapValue(session.componentAcks, sequence);
  if (msg.ok === true) {
    pending.resolve();
  } else {
    if (pending.effectId) {
      const effect = getPrivateMapValue(
        session.effectResults,
        pending.effectId,
      );
      if (effect && !effect.settled) {
        effect.settled = true;
        effect.reject(
          new Error('The host rejected the activity effect request.'),
        );
      }
    }
    pending.reject(
      new Error(
        typeof msg.error === 'string'
          ? msg.error
          : 'The host rejected an activity component frame.',
      ),
    );
  }
}

// Run the esbuild bundle exactly ONCE per codeString
/**
 * @typedef RunBundleOptions
 * @property {string} codeString - codeString.
 * @property {string} pkgFile - pkgFile.
 * @property {string} entryFile - entryFile.
 * @property {string} tmpRoot - tmpRoot.
 * @property {Object<string,string>} env - env.
 */
/**
 * @param {RunBundleOptions} options - options.
 */
function runBundleOnce({ codeString, pkgFile, entryFile, tmpRoot, env }) {
  // Use codeString as the key – if it’s the same bundle, don’t re-run it
  if (workerInitialization.bundleLoaded) return;

  const sandboxRequire = createRequire(pkgFile);

  const sandboxProcess = Object.create(process);
  Object.defineProperty(sandboxProcess, 'env', {
    value: { ...process.env, ...(env || {}) },
    writable: false,
    enumerable: true,
    configurable: false,
  });
  sandboxProcess.exit = (c = 0) => {
    throw new Error(`process.exit(${c}) called in sandbox`);
  };
  sandboxProcess.abort = () => {
    throw new Error('process.abort() called in sandbox');
  };
  sandboxProcess.kill = () => {
    throw new Error('process.kill() called in sandbox');
  };
  sandboxProcess.cwd = () => tmpRoot;

  // Wrap codeString as a CommonJS module and execute it once. The bundle must
  // register its private Activity Protocol wrapper symbol.
  // eslint-disable-next-line no-new-func
  const bundleFn = new Function(
    'require',
    // 'module',
    // 'exports',
    '__filename',
    '__dirname',
    'process',
    `"use strict";\n${codeString}\n`,
  );

  bundleFn(sandboxRequire, entryFile, tmpRoot, sandboxProcess);

  workerInitialization.bundleLoaded = true;
}

if (!isMainThread && !workerInitialization.handlerInstalled && parentPort) {
  workerInitialization.handlerInstalled = true;
  parentPort.on('message', async (msg) => {
    const { kind } = msg || {};

    if (kind === 'activity-attempt-open') {
      await openActivityAttempt(msg);
    }
  });
}

export default () => {};
