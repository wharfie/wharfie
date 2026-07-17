import { parentPort, isMainThread } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

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

/**
 * Pending RPC calls made by resource proxies.
 * @type {Map<number, { resolve: (v: any) => void, reject: (e: any) => void }>}
 */
const rpcPending = new Map();
let nextRpcId = 1;

/**
 * @param {any} v - v.
 * @returns {any} - Result.
 */
function reviveCloneable(v) {
  if (!v) return v;

  if (Array.isArray(v)) return v.map(reviveCloneable);

  if (v && typeof v === 'object') {
    // Our host-side convention for materialized Node Readable streams.
    if (v.__wharfie_type === 'readable' && v.data) {
      return Readable.from(v.data);
    }

    // Common S3-ish shape: { Body: { __wharfie_type: 'readable', data: ... } }
    if (v.Body && v.Body.__wharfie_type === 'readable' && v.Body.data) {
      return { ...v, Body: Readable.from(v.Body.data) };
    }
  }

  return v;
}

/**
 * @param {string} sessionId - sessionId.
 * @param {string} resource - resource.
 * @param {string} method - method.
 * @param {any[]} args - args.
 * @returns {Promise<any>} - Result.
 */
function rpcCall(sessionId, resource, method, args) {
  const port = parentPort;
  if (!port) {
    throw new Error('RPC unavailable: parentPort is not defined');
  }

  const id = nextRpcId++;

  return new Promise((resolve, reject) => {
    rpcPending.set(id, { resolve, reject });
    port.postMessage({
      kind: 'rpc',
      id,
      sessionId,
      resource,
      method,
      args,
    });
  });
}

/**
 * @param {string} sessionId - sessionId.
 * @param {string} resourceName - resourceName.
 * @returns {any} - Result.
 */
function createRpcProxy(sessionId, resourceName) {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        // Prevent await/Promise detection from treating this as a thenable.
        if (prop === 'then') return undefined;

        // Debug/inspection helpers
        if (prop === '__wharfie_isRpcProxy') return true;
        if (prop === 'toJSON') return () => `[rpc:${resourceName}]`;

        // Only string method names are supported over the wire.
        if (typeof prop !== 'string') return undefined;

        /** @type {(...args: any[]) => Promise<any>} */
        const fn = async (...args) => {
          const res = await rpcCall(sessionId, resourceName, prop, args);
          return reviveCloneable(res);
        };
        return fn;
      },
    },
  );
}

/**
 * @param {any} ctx - ctx.
 * @returns {any} - Result.
 */
function hydrateContextResources(ctx) {
  if (!ctx || typeof ctx !== 'object') return ctx;

  const res = ctx.resources;
  if (!res || typeof res !== 'object') return ctx;

  if (res.__wharfie_rpc !== true) return ctx;

  const sessionId = res.__wharfie_rpc_sessionId;
  const names = res.__wharfie_rpc_resources;

  if (!sessionId || typeof sessionId !== 'string') return ctx;
  if (!Array.isArray(names)) return ctx;

  // Preserve any serializable resources the host included, but strip RPC markers.
  /** @type {Record<string, any>} */
  const extras = { ...res };
  delete extras.__wharfie_rpc;
  delete extras.__wharfie_rpc_sessionId;
  delete extras.__wharfie_rpc_resources;

  /** @type {Record<string, any>} */
  const proxied = { ...extras };

  for (const name of names) {
    if (typeof name !== 'string' || !name) continue;
    proxied[name] = createRpcProxy(sessionId, name);
  }

  return { ...ctx, resources: proxied };
}

/**
 *
 */
async function drainOneTick() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

/**
 * @typedef ActivityAttemptHostTransport
 * @property {(message: Record<string, any>) => void} send - Send one authenticated runner-to-host message.
 * @property {(event: string, listener: (value: unknown) => void) => void} on - Listen with the pristine private-port listener.
 */

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
  return Object.freeze({
    send(message) {
      postMessage({ ...message, id, transportAuth: auth });
    },
    on(event, listener) {
      on(event, listener);
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
 * @property {Map<number, {resolve: () => void, reject: (error: Error) => void}>} componentAcks - Component frame delivery acknowledgements.
 * @property {Promise<never> | null} forceTermination - Pending host termination request.
 */

/** @type {Map<number, ActivityAttemptRunnerSession>} */
const activityAttemptSessions = new Map();
const applyIntrinsic = Reflect.apply;
const activityAttemptSessionGet = Map.prototype.get;
const activityAttemptSessionHas = Map.prototype.has;
const activityAttemptSessionSet = Map.prototype.set;

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
 * @param {ActivityAttemptRunnerSession} session - Active runner session.
 * @param {unknown} frame - Candidate component frame.
 * @returns {Promise<void>} - Resolves only after the host accepted this exact sequence.
 */
function deliverActivityAttemptComponentFrame(session, frame) {
  if (session.finished || session.componentTerminal) {
    return Promise.reject(
      new Error(
        'Activity attempt cannot emit a component frame after terminal.',
      ),
    );
  }
  if (frame === null || typeof frame !== 'object' || Array.isArray(frame)) {
    return Promise.reject(
      new TypeError('Activity attempt emitted a malformed component frame.'),
    );
  }
  const component = /** @type {Record<string, any>} */ (frame);
  if (!Number.isSafeInteger(component.sequence) || component.sequence < 1) {
    return Promise.reject(
      new TypeError('Activity attempt emitted a malformed component frame.'),
    );
  }
  const sequence = component.sequence;
  if (session.componentAcks.has(sequence)) {
    return Promise.reject(
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

  return new Promise((resolve, reject) => {
    session.componentAcks.set(sequence, { resolve, reject });
    try {
      session.transport.send({
        kind: 'activity-attempt-component-frame',
        frame: component,
      });
    } catch (cause) {
      session.componentAcks.delete(sequence);
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
  session.forceTermination = new Promise((_resolve, reject) => {
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
      }
    });
    transport.on('messageerror', () => {
      if (session.finished) return;
      session.finished = true;
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
      Promise.resolve(
        session.entrypoint({
          startFrame: frame,
          transport: {
            onComponentFrame: (/** @type {unknown} */ componentFrame) =>
              deliverActivityAttemptComponentFrame(session, componentFrame),
            signal: session.controller.signal,
            forceTerminate: () =>
              requestActivityAttemptForceTermination(session),
          },
        }),
      ).then(
        () => {
          if (session.finished) return;
          session.finished = true;
          session.transport.send({
            kind: 'activity-attempt-finished',
          });
        },
        (error) => {
          if (session.finished) return;
          session.finished = true;
          session.transport.send({
            kind: 'activity-attempt-failed',
            error: toTransportError(error),
          });
        },
      );
      return;
    }
    if (frame?.type === 'cancel') {
      if (!session.started) {
        throw new Error('Activity attempt received cancellation before start.');
      }
      abortActivityAttempt(session, frame);
      return;
    }
    throw new TypeError('Activity attempt received an unsupported host frame.');
  } catch (error) {
    session.finished = true;
    session.transport.send({
      kind: 'activity-attempt-failed',
      error: toTransportError(error),
    });
  }
}

/**
 * @param {Record<string, any>} msg - Host component acknowledgement.
 * @returns {void}
 */
function receiveActivityAttemptComponentAck(msg) {
  const session = getActivityAttemptSession(msg?.id);
  if (!session) return;
  const sequence = msg.sequence;
  const pending = session.componentAcks.get(sequence);
  if (!pending) return;
  session.componentAcks.delete(sequence);
  if (msg.ok === true) {
    pending.resolve();
  } else {
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

  // Wrap codeString as a CommonJS module and execute it once.
  // This bundle is responsible for doing require(callerFile)
  // and registering global[Symbol.for(functionName)].
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

    // Host -> worker RPC response
    if (kind === 'rpc_response') {
      const p = rpcPending.get(msg.id);
      if (!p) return;
      rpcPending.delete(msg.id);

      if (msg.ok) {
        p.resolve(msg.value);
      } else {
        p.reject(new Error(msg.error));
      }
      return;
    }

    if (kind === 'activity-attempt-open') {
      await openActivityAttempt(msg);
      return;
    }

    if (kind !== 'exec') return;

    const {
      id,
      codeString,
      entryFile,
      tmpRoot,
      pkgFile,
      env,
      __ENTRY_ARGS__,
      functionName,
    } = msg;

    try {
      runBundleOnce({
        codeString,
        pkgFile,
        entryFile,
        tmpRoot,
        env,
      });

      const sym = Symbol.for(functionName);
      const fn = runtimeGlobal[sym];
      if (typeof fn !== 'function') {
        throw new TypeError(
          `Global entrypoint ${functionName} is not a function`,
        );
      }

      const args = Array.isArray(__ENTRY_ARGS__)
        ? [...__ENTRY_ARGS__]
        : [__ENTRY_ARGS__];

      // Convention: args[1] is the "context" object.
      if (args.length > 1) {
        args[1] = hydrateContextResources(args[1]);
      }

      const result = fn(...args);
      const awaitedResult =
        result && typeof result.then === 'function' ? await result : result;

      await drainOneTick();

      parentPort &&
        parentPort.postMessage({ id, ok: true, value: awaitedResult });
    } catch (err) {
      parentPort &&
        parentPort.postMessage({
          id,
          ok: false,
          error: err instanceof Error ? err.stack || err.message : String(err),
        });
    }
  });
}

export default () => {};
