import { assertApplicationRevisionId } from '../application-revision.js';
import { assertArtifactId } from '../artifact-record.js';
import { assertLogicalId } from '../logical-id.js';
import {
  LedgerServiceLifecycleStatus,
  LedgerServiceOwnerKind,
  LedgerServiceOwnershipConflictError,
  assertLedgerServiceOwnerKind,
  assertLedgerServiceSessionId,
  createLedgerServiceId,
  createLedgerServiceSessionId,
} from '../../lib/db/tables/ledger-service-lifecycle.js';
import {
  LocalServiceSessionActiveError,
  LocalServiceSessionEndpointError,
  acquireLocalServiceSession,
  getLocalServiceSessionPrincipalId,
  getLocalServiceSessionScopeId,
  probeLocalServiceSession,
} from '../local-service-session.js';

/**
 * Local process state around the durable lifecycle record. These values are
 * deliberately not coordinator epochs or lease states: only the lifecycle
 * store is durable and the held local session is only same-principal local
 * exclusion.
 */
export const LedgerServiceRuntimeStatus = Object.freeze({
  NEW: 'NEW',
  STARTING: 'STARTING',
  READY: 'READY',
  STOPPING: 'STOPPING',
  STOPPED: 'STOPPED',
  FAILED: 'FAILED',
});

/** @typedef {'NEW'|'STARTING'|'READY'|'STOPPING'|'STOPPED'|'FAILED'} LedgerServiceRuntimeStatusValue */
/** @typedef {Readonly<Record<string, any>>} LedgerServiceLifecycleSnapshot */
/** @typedef {{serviceId: string, sessionId: string, sessionRoot: string, endpoint: string, ownerCommandEndpoint: string, release: () => Promise<void>}} LocalServiceSession */
/** @typedef {LocalServiceSession & {commandSession: LocalServiceSession, ownership: Readonly<Record<string, any>>, scopeId: string, principalId: string}} LocalLedgerServiceOwner */
/** @typedef {{start: Function, markReady: Function, markStopping: Function, markStopped: Function}} LedgerServiceLifecycleStore */
/** @typedef {{getOwnership: Function, claimOwnership: Function, releaseOwnership: Function}} LedgerServiceOwnershipStore */

/** Raised when one in-memory service object is used out of lifecycle order. */
export class LedgerServiceRuntimeStateError extends Error {
  /** @param {string} message - Safe state diagnostic. */
  constructor(message) {
    super(message);
    this.name = 'LedgerServiceRuntimeStateError';
  }
}

/**
 * Assert that the lifecycle store has the narrow interface this runtime owns.
 * @param {unknown} value - Candidate lifecycle store.
 * @returns {void} - Returns after the lifecycle interface is validated.
 */
function assertLifecycleStore(value) {
  const candidate = /** @type {any} */ (value);
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.start !== 'function' ||
    typeof candidate.markReady !== 'function' ||
    typeof candidate.markStopping !== 'function' ||
    typeof candidate.markStopped !== 'function'
  ) {
    throw new TypeError(
      'createLedgerService requires a lifecycle store with start and lifecycle transition methods.',
    );
  }
}

/**
 * Assert that the durable ownership store supports the exact local fencing
 * operations used by this runtime.
 * @param {unknown} value - Candidate ownership store.
 * @returns {void} - Returns after the ownership interface is validated.
 */
function assertOwnershipStore(value) {
  const candidate = /** @type {any} */ (value);
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.getOwnership !== 'function' ||
    typeof candidate.claimOwnership !== 'function' ||
    typeof candidate.releaseOwnership !== 'function'
  ) {
    throw new TypeError(
      'ledger-service local ownership requires getOwnership, claimOwnership, and releaseOwnership.',
    );
  }
}

/**
 * @param {Readonly<Record<string, any>> | null | undefined} value - Durable ownership snapshot.
 * @param {{serviceId: string, scopeId: string, principalId: string, sessionId: string, ownerKind: 'resident'|'manual'}} candidate - Candidate identity.
 * @returns {boolean} - Whether the snapshot proves this exact candidate won.
 */
function isCurrentOwnershipCandidate(value, candidate) {
  return Boolean(
    value &&
    value.serviceId === candidate.serviceId &&
    value.scopeId === candidate.scopeId &&
    value.principalId === candidate.principalId &&
    value.sessionId === candidate.sessionId &&
    value.ownerKind === candidate.ownerKind,
  );
}

/**
 * Fail closed unless an existing durable owner is demonstrably absent in this
 * exact local scope and OS principal. Endpoints are derived locally from the
 * persisted typed identity; no pathname is stored or trusted in the record.
 * @param {{ownership: Readonly<Record<string, any>> | null, serviceId: string, scopeId: string, principalId: string, sessionRoot?: string, probeSession: (input: {serviceId: string, sessionId: string, sessionRoot?: string}) => Promise<{endpoint: string, status: 'active'|'absent'|'unknown'}>}} options - Existing ownership observation.
 * @returns {Promise<void>} - Resolves only when no owner exists or it is conclusively absent.
 */
async function assertObservedOwnershipAbsent(options) {
  const current = options.ownership;
  if (!current) return;
  if (
    current.scopeId !== options.scopeId ||
    current.principalId !== options.principalId
  ) {
    throw new LedgerServiceOwnershipConflictError(
      options.serviceId,
      'ownership belongs to another local scope or operating-system principal',
    );
  }
  const probe = await options.probeSession({
    serviceId: options.serviceId,
    sessionId: current.sessionId,
    ...(typeof options.sessionRoot === 'string'
      ? { sessionRoot: options.sessionRoot }
      : {}),
  });
  if (probe.status === 'active') {
    throw new LocalServiceSessionActiveError(
      options.serviceId,
      current.sessionId,
      probe.endpoint,
    );
  }
  if (probe.status !== 'absent') {
    throw new LocalServiceSessionEndpointError(
      'Could not prove the recorded local ledger-service owner is absent.',
      probe.endpoint,
    );
  }
}

/**
 * Acquire the locally exclusive ownership fence for one application. A fresh
 * unique socket is bound before its typed session is conditionally published,
 * so no successor ever reuses or unlinks an old pathname. The persisted owner
 * record is valid only for one local control volume and operating-system
 * principal; it is not a distributed lease or host-failover protocol.
 * @param {{appId: string, ownership: LedgerServiceOwnershipStore, ownerKind?: 'resident'|'manual', sessionRoot?: string, sessionId?: string, now?: () => number, acquireSession?: (input: {serviceId: string, sessionId: string, sessionRoot?: string}) => Promise<LocalServiceSession>, probeSession?: (input: {serviceId: string, sessionId: string, sessionRoot?: string}) => Promise<{endpoint: string, status: 'active'|'absent'|'unknown'}>}} options - Local ownership dependencies.
 * @returns {Promise<LocalServiceSession & {commandSession: LocalServiceSession, ownership: Readonly<Record<string, any>>, scopeId: string, principalId: string}>} - Held local ownership fence.
 */
export async function acquireLocalLedgerServiceSession(options) {
  assertLogicalId(options?.appId, 'appId');
  assertOwnershipStore(options?.ownership);
  const ownerKind = options?.ownerKind || LedgerServiceOwnerKind.MANUAL;
  assertLedgerServiceOwnerKind(ownerKind, 'ownerKind');
  const acquireSession = options?.acquireSession || acquireLocalServiceSession;
  const probeSession = options?.probeSession || probeLocalServiceSession;
  if (typeof acquireSession !== 'function') {
    throw new TypeError('acquireSession must be a function.');
  }
  if (typeof probeSession !== 'function') {
    throw new TypeError('probeSession must be a function.');
  }
  if (options?.now !== undefined && typeof options.now !== 'function') {
    throw new TypeError('now must be a function when provided.');
  }

  const serviceId = createLedgerServiceId({ appId: options.appId });
  const sessionId = options?.sessionId || createLedgerServiceSessionId();
  assertLedgerServiceSessionId(sessionId, 'sessionId');
  const scopeId = getLocalServiceSessionScopeId({
    ...(typeof options?.sessionRoot === 'string'
      ? { sessionRoot: options.sessionRoot }
      : {}),
  });
  const principalId = getLocalServiceSessionPrincipalId();
  const now = options?.now || (() => Date.now());
  const candidate = {
    serviceId,
    scopeId,
    principalId,
    sessionId,
    ownerKind,
  };
  const prior = await options.ownership.getOwnership({ serviceId });
  await assertObservedOwnershipAbsent({
    ownership: prior,
    serviceId,
    scopeId,
    principalId,
    ...(typeof options?.sessionRoot === 'string'
      ? { sessionRoot: options.sessionRoot }
      : {}),
    probeSession,
  });

  const localSession = await acquireSession({
    serviceId,
    sessionId,
    ...(typeof options?.sessionRoot === 'string'
      ? { sessionRoot: options.sessionRoot }
      : {}),
  });
  /** @type {Readonly<Record<string, any>> | undefined} */
  let ownershipSnapshot;
  try {
    try {
      const claimed = await options.ownership.claimOwnership({
        serviceId,
        appId: options.appId,
        scopeId,
        principalId,
        sessionId,
        ownerKind,
        expected: prior,
        claimedAt: now(),
      });
      ownershipSnapshot = claimed.ownership;
    } catch (claimError) {
      // A write may have committed even when its caller lost the response.
      // Read back before closing our already-bound unique endpoint; retain it
      // only if the durable owner names this exact candidate.
      const observedAfterError = await options.ownership.getOwnership({
        serviceId,
      });
      if (!isCurrentOwnershipCandidate(observedAfterError, candidate)) {
        throw claimError;
      }
      ownershipSnapshot = observedAfterError;
    }
    if (!isCurrentOwnershipCandidate(ownershipSnapshot, candidate)) {
      throw new LedgerServiceOwnershipConflictError(
        serviceId,
        'claim did not return the local candidate ownership',
      );
    }
    const currentOwnership = /** @type {Readonly<Record<string, any>>} */ (
      ownershipSnapshot
    );

    /** @type {Promise<void> | undefined} */
    let releasePromise;
    const release = () => {
      if (!releasePromise) {
        releasePromise = (async () => {
          /** @type {unknown} */
          let releaseOwnershipError;
          try {
            await options.ownership.releaseOwnership({
              serviceId,
              scopeId,
              principalId,
              sessionId,
              generation: currentOwnership.generation,
            });
          } catch (error) {
            releaseOwnershipError = error;
          }
          /** @type {unknown} */
          let releaseSessionError;
          try {
            await localSession.release();
          } catch (error) {
            releaseSessionError = error;
          }
          if (releaseOwnershipError && releaseSessionError) {
            throw new AggregateError(
              [releaseOwnershipError, releaseSessionError],
              'Could not release durable local ownership or its session endpoint.',
            );
          }
          if (releaseOwnershipError) throw releaseOwnershipError;
          if (releaseSessionError) throw releaseSessionError;
        })();
      }
      return releasePromise;
    };
    return Object.freeze({
      ...localSession,
      // Preserve the unforgeable in-memory acquisition capability for the
      // companion owner-command endpoint. The spread wrapper is deliberately
      // not itself accepted as a socket-owning session.
      commandSession: localSession,
      ownership: currentOwnership,
      scopeId,
      principalId,
      release,
    });
  } catch (error) {
    try {
      await localSession.release();
    } catch (releaseError) {
      throw new AggregateError(
        [error, releaseError],
        'Could not claim durable local ownership or release its candidate endpoint.',
      );
    }
    throw error;
  }
}

/**
 * Construct the first narrow resident service. It conditionally acquires
 * same-principal local ownership before writing `STARTING`, persists `READY`,
 * and releases only after a graceful `STOPPING`/`STOPPED` sequence. There is
 * intentionally no scheduler, run claim, queue poller, lease, heartbeat, or
 * coordinator epoch in this first lifecycle vertical.
 * @param {{appId: string, revisionId: string, artifactId?: string, lifecycle: LedgerServiceLifecycleStore, ownership: LedgerServiceOwnershipStore, sessionRoot?: string, sessionId?: string, now?: () => number, acquireSession?: (input: {serviceId: string, sessionId: string, sessionRoot?: string}) => Promise<LocalServiceSession>, probeSession?: (input: {serviceId: string, sessionId: string, sessionRoot?: string}) => Promise<{endpoint: string, status: 'active'|'absent'|'unknown'}>}} options - Service dependencies.
 * @returns {{start: (options?: {deferReady?: boolean}) => Promise<LedgerServiceLifecycleSnapshot>, markReady: () => Promise<LedgerServiceLifecycleSnapshot>, beginStopping: () => Promise<LedgerServiceLifecycleSnapshot | null>, stop: () => Promise<LedgerServiceLifecycleSnapshot | null>, getLifecycle: () => LedgerServiceLifecycleSnapshot | null, getRuntimeStatus: () => LedgerServiceRuntimeStatusValue, getServiceId: () => string, getLocalOwner: () => LocalLedgerServiceOwner | null, ownsLocalSession: () => boolean}} - Resident service handle.
 */
export function createLedgerService(options) {
  assertLogicalId(options?.appId, 'appId');
  assertApplicationRevisionId(options?.revisionId, 'revisionId');
  if (options?.artifactId !== undefined) {
    assertArtifactId(options.artifactId, 'artifactId');
  }
  assertLifecycleStore(options?.lifecycle);
  assertOwnershipStore(options?.ownership);
  if (options?.now !== undefined && typeof options.now !== 'function') {
    throw new TypeError('now must be a function when provided.');
  }

  const appId = options.appId;
  const revisionId = options.revisionId;
  const artifactId = options.artifactId;
  const lifecycle = options.lifecycle;
  const ownership = options.ownership;
  const sessionRoot = options.sessionRoot;
  const sessionId = options.sessionId || createLedgerServiceSessionId();
  assertLedgerServiceSessionId(sessionId, 'sessionId');
  const now = options.now || (() => Date.now());
  const serviceId = createLedgerServiceId({ appId });

  /** @type {LocalLedgerServiceOwner | undefined} */
  let localSession;
  /** @type {LedgerServiceLifecycleSnapshot | null} */
  let lifecycleSnapshot = null;
  /** @type {LedgerServiceRuntimeStatusValue} */
  let runtimeStatus = LedgerServiceRuntimeStatus.NEW;
  /** @type {Promise<LedgerServiceLifecycleSnapshot> | undefined} */
  let startPromise;
  /** @type {Promise<LedgerServiceLifecycleSnapshot> | undefined} */
  let markReadyPromise;
  /** @type {Promise<LedgerServiceLifecycleSnapshot | null> | undefined} */
  let beginStoppingPromise;
  let stoppingRequested = false;
  /** @type {Promise<LedgerServiceLifecycleSnapshot | null> | undefined} */
  let stopPromise;

  /**
   * Release held local ownership exactly once.
   * @returns {Promise<void>} - Resolves after the session is released.
   */
  async function releaseLocalSession() {
    const current = localSession;
    localSession = undefined;
    if (current) await current.release();
  }

  /**
   * Acquire ownership and record STARTING. Ordinary callers also record READY;
   * a composed runtime may defer READY until its command endpoint is bound.
   * @param {{deferReady?: boolean}} [startOptions] - Optional readiness split.
   * @returns {Promise<LedgerServiceLifecycleSnapshot>} - Durable STARTING or READY record.
   */
  async function start(startOptions = {}) {
    if (
      !startOptions ||
      typeof startOptions !== 'object' ||
      Array.isArray(startOptions) ||
      Object.keys(startOptions).some((key) => key !== 'deferReady') ||
      (startOptions.deferReady !== undefined &&
        typeof startOptions.deferReady !== 'boolean')
    ) {
      throw new TypeError(
        'Ledger service start options support only boolean deferReady.',
      );
    }
    const deferReady = startOptions.deferReady === true;
    if (runtimeStatus === LedgerServiceRuntimeStatus.READY) {
      if (!lifecycleSnapshot) {
        throw new LedgerServiceRuntimeStateError(
          'Ledger service is READY without a lifecycle snapshot.',
        );
      }
      return lifecycleSnapshot;
    }
    if (
      stoppingRequested ||
      (runtimeStatus !== LedgerServiceRuntimeStatus.NEW &&
        runtimeStatus !== LedgerServiceRuntimeStatus.STARTING)
    ) {
      throw new LedgerServiceRuntimeStateError(
        `Ledger service cannot start from ${runtimeStatus}.`,
      );
    }
    if (
      !startPromise &&
      (runtimeStatus !== LedgerServiceRuntimeStatus.NEW ||
        stopPromise !== undefined)
    ) {
      throw new LedgerServiceRuntimeStateError(
        `Ledger service cannot start from ${runtimeStatus}.`,
      );
    }

    if (!startPromise) {
      runtimeStatus = LedgerServiceRuntimeStatus.STARTING;
      startPromise = (async () => {
        try {
          localSession = await acquireLocalLedgerServiceSession({
            appId,
            ownership,
            ownerKind: LedgerServiceOwnerKind.RESIDENT,
            sessionId,
            now,
            ...(typeof sessionRoot === 'string' ? { sessionRoot } : {}),
            ...(typeof options.acquireSession === 'function'
              ? { acquireSession: options.acquireSession }
              : {}),
            ...(typeof options.probeSession === 'function'
              ? { probeSession: options.probeSession }
              : {}),
          });
          const starting = await lifecycle.start({
            serviceId,
            appId,
            revisionId,
            ...(artifactId === undefined ? {} : { artifactId }),
            sessionId,
            observedAt: now(),
          });
          lifecycleSnapshot = /** @type {LedgerServiceLifecycleSnapshot} */ (
            starting.lifecycle
          );
          return lifecycleSnapshot;
        } catch (error) {
          runtimeStatus = LedgerServiceRuntimeStatus.FAILED;
          try {
            await releaseLocalSession();
          } catch (releaseError) {
            throw new AggregateError(
              [error, releaseError],
              'Ledger service startup failed and its local ownership session could not be released.',
            );
          }
          throw error;
        }
      })();
    }
    const startingSnapshot = await startPromise;
    if (deferReady) return startingSnapshot;
    try {
      return await markReady();
    } catch (error) {
      runtimeStatus = LedgerServiceRuntimeStatus.FAILED;
      try {
        await releaseLocalSession();
      } catch (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          'Ledger service readiness failed and its local ownership session could not be released.',
        );
      }
      throw error;
    }
  }

  /**
   * Publish READY only after the composed runtime has bound every endpoint it
   * promises while ready. A concurrent shutdown wins without fabricating a
   * transient READY record.
   * @returns {Promise<LedgerServiceLifecycleSnapshot>} - Current durable lifecycle.
   */
  async function markReady() {
    if (stoppingRequested && lifecycleSnapshot) return lifecycleSnapshot;
    if (markReadyPromise) return await markReadyPromise;
    const pending = (async () => {
      if (!startPromise) {
        throw new LedgerServiceRuntimeStateError(
          'Ledger service cannot become READY before STARTING.',
        );
      }
      await startPromise;
      if (stoppingRequested) {
        return /** @type {LedgerServiceLifecycleSnapshot} */ (
          lifecycleSnapshot
        );
      }
      if (!localSession || !lifecycleSnapshot) {
        throw new LedgerServiceRuntimeStateError(
          'Ledger service cannot become READY without its local owner and STARTING record.',
        );
      }
      if (lifecycleSnapshot.status === LedgerServiceLifecycleStatus.READY) {
        runtimeStatus = LedgerServiceRuntimeStatus.READY;
        return lifecycleSnapshot;
      }
      if (
        lifecycleSnapshot.status === LedgerServiceLifecycleStatus.STOPPING ||
        lifecycleSnapshot.status === LedgerServiceLifecycleStatus.STOPPED
      ) {
        return lifecycleSnapshot;
      }
      try {
        const ready = await lifecycle.markReady({
          serviceId,
          sessionId,
          generation: lifecycleSnapshot.generation,
          observedAt: now(),
        });
        lifecycleSnapshot = /** @type {LedgerServiceLifecycleSnapshot} */ (
          ready.lifecycle
        );
        runtimeStatus = LedgerServiceRuntimeStatus.READY;
        return lifecycleSnapshot;
      } catch (error) {
        runtimeStatus = LedgerServiceRuntimeStatus.FAILED;
        throw error;
      }
    })();
    markReadyPromise = pending;
    return await pending;
  }

  /**
   * Publish STOPPING while retaining this exact local owner generation. The
   * worker may then drain or cooperatively cancel its active attempt before a
   * later `stop()` publishes STOPPED and releases ownership.
   * @returns {Promise<LedgerServiceLifecycleSnapshot | null>} - Durable STOPPING snapshot when the service started.
   */
  async function beginStopping() {
    if (beginStoppingPromise) return await beginStoppingPromise;
    stoppingRequested = true;
    const readinessInFlight = markReadyPromise;
    const pending = (async () => {
      if (startPromise) await startPromise;
      if (readinessInFlight) {
        try {
          await readinessInFlight;
        } catch {
          // A failed READY write does not waive the best-effort durable
          // STARTING -> STOPPING cleanup under the still-held owner.
        }
      }
      if (!localSession) return lifecycleSnapshot;
      if (!lifecycleSnapshot) {
        runtimeStatus = LedgerServiceRuntimeStatus.FAILED;
        throw new LedgerServiceRuntimeStateError(
          'Ledger service owns a local session without a lifecycle snapshot.',
        );
      }
      if (lifecycleSnapshot.status === LedgerServiceLifecycleStatus.STOPPED) {
        runtimeStatus = LedgerServiceRuntimeStatus.STOPPED;
        return lifecycleSnapshot;
      }
      runtimeStatus = LedgerServiceRuntimeStatus.STOPPING;
      if (lifecycleSnapshot.status !== LedgerServiceLifecycleStatus.STOPPING) {
        try {
          const stopping = await lifecycle.markStopping({
            serviceId,
            sessionId,
            generation: lifecycleSnapshot.generation,
            observedAt: now(),
          });
          lifecycleSnapshot = /** @type {LedgerServiceLifecycleSnapshot} */ (
            stopping.lifecycle
          );
        } catch (error) {
          runtimeStatus = LedgerServiceRuntimeStatus.FAILED;
          throw error;
        }
      }
      return lifecycleSnapshot;
    })();
    beginStoppingPromise = pending;
    return await pending;
  }

  /**
   * Persist graceful drain/stop before relinquishing local ownership. An
   * unavailable lifecycle write never fabricates a STOPPED record; releasing
   * the session still lets a later process write a new STARTING generation.
   * @returns {Promise<LedgerServiceLifecycleSnapshot | null>} - Last durable lifecycle snapshot.
   */
  async function stop() {
    if (stopPromise) return await stopPromise;
    const pending = (async () => {
      if (startPromise) {
        try {
          await startPromise;
        } catch {
          return lifecycleSnapshot;
        }
      }
      if (!localSession) {
        if (runtimeStatus === LedgerServiceRuntimeStatus.NEW) {
          runtimeStatus = LedgerServiceRuntimeStatus.STOPPED;
          return lifecycleSnapshot;
        }
        return lifecycleSnapshot;
      }
      if (!lifecycleSnapshot) {
        runtimeStatus = LedgerServiceRuntimeStatus.FAILED;
        try {
          await releaseLocalSession();
        } catch {
          // The original invariant failure is the useful diagnostic here.
        }
        throw new LedgerServiceRuntimeStateError(
          'Ledger service owns a local session without a lifecycle snapshot.',
        );
      }

      /** @type {LedgerServiceLifecycleSnapshot} */
      let currentSnapshot = lifecycleSnapshot;
      /** @type {LedgerServiceLifecycleSnapshot | undefined} */
      let result;
      /** @type {unknown} */
      let transitionError;
      try {
        currentSnapshot = /** @type {LedgerServiceLifecycleSnapshot} */ (
          await beginStopping()
        );
        if (currentSnapshot.status !== LedgerServiceLifecycleStatus.STOPPED) {
          const stopped = await lifecycle.markStopped({
            serviceId,
            sessionId,
            generation: currentSnapshot.generation,
            observedAt: now(),
          });
          currentSnapshot = /** @type {LedgerServiceLifecycleSnapshot} */ (
            stopped.lifecycle
          );
          lifecycleSnapshot = currentSnapshot;
        }
        runtimeStatus = LedgerServiceRuntimeStatus.STOPPED;
        result = currentSnapshot;
      } catch (error) {
        transitionError = error;
        runtimeStatus = LedgerServiceRuntimeStatus.FAILED;
      }
      /** @type {unknown} */
      let releaseError;
      try {
        await releaseLocalSession();
      } catch (error) {
        releaseError = error;
      }
      if (transitionError && releaseError) {
        throw new AggregateError(
          [transitionError, releaseError],
          'Ledger service shutdown and local ownership release both failed.',
        );
      }
      if (transitionError) throw transitionError;
      if (releaseError) throw releaseError;
      return /** @type {LedgerServiceLifecycleSnapshot} */ (result);
    })();
    stopPromise = pending;
    return await pending;
  }

  return {
    start,
    markReady,
    beginStopping,
    stop,
    getLifecycle: () => lifecycleSnapshot,
    getRuntimeStatus: () => runtimeStatus,
    getServiceId: () => serviceId,
    getLocalOwner: () => localSession || null,
    ownsLocalSession: () => Boolean(localSession),
  };
}

export default createLedgerService;
