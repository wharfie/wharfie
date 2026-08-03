/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- Internal state-machine types are more precise than the current JSDoc parser understands. */

import {
  LocalApplicationActivationAction,
  LocalApplicationActivationDestination,
  LocalApplicationActivationOutcome,
  LocalApplicationActivationPhase,
} from '../../lib/db/tables/local-application-activation.js';
import { assertApplicationRevisionId } from '../application-revision.js';
import { assertArtifactId } from '../artifact-record.js';
import { assertLogicalId } from '../logical-id.js';
import {
  assertLocalApplicationQuiescent,
  inspectLocalApplicationQuiescence,
} from './local-application-quiescence.js';

export const LOCAL_APPLICATION_SYSTEMD_ACTIVATION_RESULT_SCHEMA_VERSION = 1;
export const LOCAL_APPLICATION_SYSTEMD_ACTIVATION_RESULT_KIND =
  'wharfie.local-application-systemd-activation-result';

export const LocalApplicationSystemdActivationRequestStatus = Object.freeze({
  FULFILLED: 'fulfilled',
  REFUSED: 'refused',
  FAILED: 'failed',
  PENDING: 'pending',
});

export const LocalApplicationSystemdActivationSettledOutcome = Object.freeze({
  ABSENT: 'absent',
  IN_FLIGHT: 'in-flight',
  TARGET_ACTIVE: 'target-active',
  SOURCE_RETAINED: 'source-retained',
  SOURCE_RESTORED: 'source-restored',
});

const CREATE_KEYS = new Set([
  'activation',
  'ledger',
  'acquireOperationLock',
  'stageRelease',
  'verifyRelease',
  'stopService',
  'proveServiceInactive',
  'selectRelease',
  'verifySelection',
  'activateRelease',
  'verifyActiveRelease',
  'verifyAbsent',
]);
const ACTIVATION_METHODS = [
  'get',
  'beginInstall',
  'replaceInstall',
  'beginChange',
  'markQuiescent',
  'markSelected',
  'markActivating',
  'beginSourceRestore',
  'abortChange',
  'completeActivation',
];
const DRIVER_METHODS = [
  'acquireOperationLock',
  'stageRelease',
  'verifyRelease',
  'stopService',
  'proveServiceInactive',
  'selectRelease',
  'verifySelection',
  'activateRelease',
  'verifyActiveRelease',
  'verifyAbsent',
];
const MAX_CONVERGENCE_STEPS = 16;

/** Raised when a requested operation disagrees with durable activation state. */
export class LocalApplicationSystemdActivationStateError extends Error {
  /**
   * @param {string} appId - Application identity.
   * @param {string} reason - Safe state mismatch.
   */
  constructor(appId, reason) {
    super(`Local systemd activation cannot continue for ${appId}: ${reason}`);
    this.name = 'LocalApplicationSystemdActivationStateError';
    this.code = 'WHARFIE_LOCAL_APPLICATION_SYSTEMD_ACTIVATION_STATE';
    this.appId = appId;
    this.reason = reason;
  }
}

/**
 * @param {unknown} value - Candidate record.
 * @param {string} label - Boundary label.
 * @returns {asserts value is Record<string, any>}
 */
function assertRecord(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object.`);
  }
}

/**
 * @param {Record<string, any>} value - Record.
 * @param {Set<string>} allowed - Exact keys.
 * @param {string[]} required - Required keys.
 * @param {string} label - Boundary label.
 * @returns {void}
 */
function assertKeys(value, allowed, required, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw new TypeError(`${label}.${key} is unsupported.`);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${label}.${key} is required.`);
    }
  }
}

/**
 * @param {unknown} value - Candidate exact release.
 * @param {string} label - Boundary label.
 * @returns {Readonly<{artifactId: string, revisionId: string}>}
 */
function normalizeRelease(value, label) {
  assertRecord(value, label);
  assertKeys(
    value,
    new Set(['artifactId', 'revisionId']),
    ['artifactId', 'revisionId'],
    label,
  );
  assertArtifactId(value.artifactId, `${label}.artifactId`);
  assertApplicationRevisionId(value.revisionId, `${label}.revisionId`);
  return Object.freeze({
    artifactId: value.artifactId,
    revisionId: value.revisionId,
  });
}

/**
 * @param {Readonly<{artifactId: string, revisionId: string}> | null} left - Release.
 * @param {Readonly<{artifactId: string, revisionId: string}> | null} right - Release.
 * @returns {boolean}
 */
function sameRelease(left, right) {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.artifactId === right.artifactId &&
      left.revisionId === right.revisionId)
  );
}

/**
 * @param {unknown} input - One public operation input.
 * @param {string} label - Boundary label.
 * @param {boolean} withTarget - Whether target is required.
 * @returns {{appId: string, target?: Readonly<{artifactId: string, revisionId: string}>}}
 */
function normalizeOperationInput(input, label, withTarget) {
  assertRecord(input, label);
  const keys = withTarget ? new Set(['appId', 'target']) : new Set(['appId']);
  assertKeys(input, keys, [...keys], label);
  assertLogicalId(input.appId, `${label}.appId`);
  return {
    appId: input.appId,
    ...(withTarget
      ? { target: normalizeRelease(input.target, `${label}.target`) }
      : {}),
  };
}

/**
 * @param {unknown} input - Candidate target operation.
 * @param {string} label - Boundary label.
 * @returns {{appId: string, target: Readonly<{artifactId: string, revisionId: string}>}}
 */
function normalizeTargetOperationInput(input, label) {
  const request = normalizeOperationInput(input, label, true);
  if (!request.target) {
    throw new TypeError(`${label}.target is required.`);
  }
  return { appId: request.appId, target: request.target };
}

/**
 * @param {string} operation - Public operation.
 * @param {string} appId - Application.
 * @param {string} requestStatus - Status of the current request.
 * @param {string} settledOutcome - Durable machine settlement.
 * @param {Readonly<Record<string, any>> | null} activation - Durable state.
 * @param {string | null} [reason] - Safe reason.
 * @param {Readonly<Record<string, any>> | null} [quiescence] - Optional refusal evidence.
 * @returns {Readonly<Record<string, any>>}
 */
function createResult(
  operation,
  appId,
  requestStatus,
  settledOutcome,
  activation,
  reason = null,
  quiescence = null,
) {
  return Object.freeze({
    schemaVersion: LOCAL_APPLICATION_SYSTEMD_ACTIVATION_RESULT_SCHEMA_VERSION,
    kind: LOCAL_APPLICATION_SYSTEMD_ACTIVATION_RESULT_KIND,
    operation,
    appId,
    requestStatus,
    settledOutcome,
    reason,
    activation,
    quiescence,
  });
}

/**
 * @param {Readonly<Record<string, any>>} activation - Exact ACTIVE state.
 * @returns {'target-active'|'source-retained'|'source-restored'} - Durable settlement.
 */
function getActiveSettledOutcome(activation) {
  const outcome = activation.lastTransition?.outcome;
  if (
    outcome !== LocalApplicationActivationOutcome.TARGET_ACTIVE &&
    outcome !== LocalApplicationActivationOutcome.SOURCE_RETAINED &&
    outcome !== LocalApplicationActivationOutcome.SOURCE_RESTORED
  ) {
    throw new LocalApplicationSystemdActivationStateError(
      activation.appId,
      'ACTIVE state has no supported durable settlement',
    );
  }
  return outcome;
}

/**
 * @param {Readonly<Record<string, any>>} activation - In-flight activation.
 * @returns {'source'|'target'}
 */
function getDestination(activation) {
  const transition = activation.transition;
  if (!transition) {
    throw new LocalApplicationSystemdActivationStateError(
      activation.appId,
      'an in-flight phase has no transition',
    );
  }
  if (sameRelease(activation.desired, transition.target)) {
    return LocalApplicationActivationDestination.TARGET;
  }
  if (transition.source && sameRelease(activation.desired, transition.source)) {
    const beforeSourceSelection =
      (activation.phase === LocalApplicationActivationPhase.QUIESCING ||
        activation.phase === LocalApplicationActivationPhase.QUIESCENT) &&
      sameRelease(activation.selected, transition.target) &&
      activation.selectionGeneration ===
        transition.sourceSelectionGeneration + 1;
    const afterSourceSelection =
      (activation.phase === LocalApplicationActivationPhase.SELECTED ||
        activation.phase === LocalApplicationActivationPhase.ACTIVATING) &&
      sameRelease(activation.selected, transition.source) &&
      activation.selectionGeneration ===
        transition.sourceSelectionGeneration + 2;
    if (!beforeSourceSelection && !afterSourceSelection) {
      throw new LocalApplicationSystemdActivationStateError(
        activation.appId,
        'source restoration lacks a completed target selection proof',
      );
    }
    return LocalApplicationActivationDestination.SOURCE;
  }
  throw new LocalApplicationSystemdActivationStateError(
    activation.appId,
    'desired release is outside its transition',
  );
}

/**
 * @param {Readonly<Record<string, any>>} activation - Activation state.
 * @returns {Readonly<Record<string, any>>}
 */
function createProjectionInput(activation) {
  if (!activation.selected) {
    throw new LocalApplicationSystemdActivationStateError(
      activation.appId,
      'selected release is missing',
    );
  }
  const previous =
    activation.phase === LocalApplicationActivationPhase.ACTIVE
      ? activation.rollbackCandidate
      : getDestination(activation) ===
          LocalApplicationActivationDestination.SOURCE
        ? activation.rollbackCandidate
        : activation.transition.source;
  return Object.freeze({
    appId: activation.appId,
    current: activation.selected,
    previous,
  });
}

/**
 * @param {Readonly<Record<string, any>>} activation - Forward change state.
 * @returns {Readonly<Record<string, any>>} - Exact retained-source projection.
 */
function createSourceProjectionInput(activation) {
  const source = activation.transition?.source;
  if (!source) {
    throw new LocalApplicationSystemdActivationStateError(
      activation.appId,
      'change transition has no source release',
    );
  }
  return Object.freeze({
    appId: activation.appId,
    current: source,
    previous: activation.rollbackCandidate,
  });
}

/**
 * @param {unknown} raw - Exact activation attempt outcome.
 * @param {string} appId - Application.
 * @returns {'healthy'|'failed'}
 */
function normalizeReleaseActivationOutcome(raw, appId) {
  assertRecord(raw, 'activateRelease result');
  assertKeys(raw, new Set(['status']), ['status'], 'activateRelease result');
  if (raw.status !== 'healthy' && raw.status !== 'failed') {
    throw new TypeError(
      `activateRelease result for ${appId} must be 'healthy' or 'failed'.`,
    );
  }
  return raw.status;
}

/**
 * Build the crash-recoverable local systemd activation coordinator. The
 * injected host driver owns physical effects; the durable activation table is
 * the sole transition authority.
 * @param {Record<string, any>} options - Activation store, ledger, lock, and narrow systemd driver.
 * @returns {Readonly<Record<string, Function>>}
 */
export function createLocalApplicationSystemdActivation(options) {
  assertRecord(options, 'local systemd activation options');
  assertKeys(
    options,
    CREATE_KEYS,
    [...CREATE_KEYS],
    'local systemd activation options',
  );
  if (!options.activation || typeof options.activation !== 'object') {
    throw new TypeError(
      'local systemd activation options.activation must be an activation store.',
    );
  }
  for (const method of ACTIVATION_METHODS) {
    if (typeof options.activation[method] !== 'function') {
      throw new TypeError(
        `local systemd activation options.activation.${method} must be a function.`,
      );
    }
  }
  if (!options.ledger || typeof options.ledger.listRuns !== 'function') {
    throw new TypeError(
      'local systemd activation options.ledger must provide listRuns.',
    );
  }
  for (const method of DRIVER_METHODS) {
    if (typeof options[method] !== 'function') {
      throw new TypeError(
        `local systemd activation options.${method} must be a function.`,
      );
    }
  }

  const activationStore = options.activation;
  const ledger = options.ledger;

  /**
   * @param {string} appId - Application.
   * @param {Readonly<{artifactId: string, revisionId: string}>} release - Release.
   * @returns {Promise<void>} - Resolves after staging and verification.
   */
  async function prepareRelease(appId, release) {
    const input = Object.freeze({ appId, release });
    await options.stageRelease(input);
    await options.verifyRelease(input);
  }

  /**
   * @param {string} appId - Application.
   * @param {Readonly<{artifactId: string, revisionId: string}>} release - Release.
   * @returns {Promise<void>} - Resolves for verified immutable bytes.
   */
  async function verifyRelease(appId, release) {
    await options.verifyRelease(Object.freeze({ appId, release }));
  }

  /**
   * @param {Readonly<Record<string, any>>} projection - Exact current/previous receipt projection.
   * @returns {Promise<void>} - Resolves after immutable bytes and projection agree.
   */
  async function verifySelectionProjection(projection) {
    await verifyRelease(projection.appId, projection.current);
    if (projection.previous) {
      await verifyRelease(projection.appId, projection.previous);
    }
    await options.verifySelection(projection);
  }

  /**
   * @param {Readonly<Record<string, any>>} current - Active state.
   * @returns {Promise<void>} - Resolves for exact physical projections.
   */
  async function verifyActive(current) {
    if (!current.selected) {
      throw new LocalApplicationSystemdActivationStateError(
        current.appId,
        'ACTIVE state has no selected release',
      );
    }
    await verifySelectionProjection(createProjectionInput(current));
    await options.verifyActiveRelease(
      Object.freeze({ appId: current.appId, release: current.selected }),
    );
  }

  /**
   * @param {string} appId - Application.
   * @param {string} [allowedNonterminalRevisionId] - One compatible queued revision for first install.
   * @returns {ReturnType<typeof inspectLocalApplicationQuiescence>} - Quiescence evidence.
   */
  async function inspectQuiescence(appId, allowedNonterminalRevisionId) {
    return await inspectLocalApplicationQuiescence({
      ledger,
      appId,
      ...(allowedNonterminalRevisionId ? { allowedNonterminalRevisionId } : {}),
    });
  }

  /**
   * @param {string} appId - Application.
   * @param {Readonly<Record<string, any>>} current - Current transition state.
   * @param {Readonly<Record<string, any>>} report - Refusal evidence.
   * @param {string} operation - Public operation.
   * @returns {Promise<Readonly<Record<string, any>>>}
   */
  async function retainSource(appId, current, report, operation) {
    const source = current.transition?.source;
    if (!source) {
      return createResult(
        operation,
        appId,
        LocalApplicationSystemdActivationRequestStatus.PENDING,
        LocalApplicationSystemdActivationSettledOutcome.IN_FLIGHT,
        current,
        report.allowedNonterminalRevisionId
          ? 'incompatible-durable-work'
          : 'durable-work',
        report,
      );
    }
    // Keep admission closed until the exact source projection is healthy.
    // QUIESCING permits the selected source to start, so every retry can
    // safely repeat these physical effects after a crash.
    await verifySelectionProjection(createSourceProjectionInput(current));
    const outcome = normalizeReleaseActivationOutcome(
      await options.activateRelease(Object.freeze({ appId, release: source })),
      appId,
    );
    if (outcome === 'failed') {
      return createResult(
        operation,
        appId,
        LocalApplicationSystemdActivationRequestStatus.PENDING,
        LocalApplicationSystemdActivationSettledOutcome.IN_FLIGHT,
        current,
        'source-reactivation-failed',
        report,
      );
    }
    await options.verifyActiveRelease(
      Object.freeze({ appId, release: source }),
    );
    const aborted = await activationStore.abortChange({
      appId,
      transitionId: current.transition.transitionId,
    });
    return createResult(
      operation,
      appId,
      operation === 'recover'
        ? LocalApplicationSystemdActivationRequestStatus.FULFILLED
        : LocalApplicationSystemdActivationRequestStatus.REFUSED,
      LocalApplicationSystemdActivationSettledOutcome.SOURCE_RETAINED,
      aborted.activation,
      'durable-work',
      report,
    );
  }

  /**
   * @param {string} appId - Application.
   * @param {string} operation - Public operation.
   * @param {string | null} expectedTransitionId - Transition being converged.
   * @returns {Promise<Readonly<Record<string, any>>>}
   */
  async function converge(appId, operation, expectedTransitionId) {
    for (let step = 0; step < MAX_CONVERGENCE_STEPS; step += 1) {
      const current = await activationStore.get({ appId });
      if (!current) {
        if (expectedTransitionId !== null) {
          throw new LocalApplicationSystemdActivationStateError(
            appId,
            'the expected durable transition disappeared',
          );
        }
        await options.verifyAbsent(Object.freeze({ appId }));
        return createResult(
          operation,
          appId,
          LocalApplicationSystemdActivationRequestStatus.FULFILLED,
          LocalApplicationSystemdActivationSettledOutcome.ABSENT,
          null,
        );
      }

      if (current.phase === LocalApplicationActivationPhase.ACTIVE) {
        if (
          expectedTransitionId !== null &&
          current.lastTransition?.transitionId !== expectedTransitionId
        ) {
          throw new LocalApplicationSystemdActivationStateError(
            appId,
            'a different durable transition became active while the operation lock was held',
          );
        }
        await verifyActive(current);
        const requestedSourceRestoration =
          expectedTransitionId !== null &&
          current.lastTransition?.transitionId === expectedTransitionId &&
          current.lastTransition.outcome ===
            LocalApplicationActivationOutcome.SOURCE_RESTORED;
        return createResult(
          operation,
          appId,
          requestedSourceRestoration
            ? operation === 'recover'
              ? LocalApplicationSystemdActivationRequestStatus.FULFILLED
              : LocalApplicationSystemdActivationRequestStatus.FAILED
            : LocalApplicationSystemdActivationRequestStatus.FULFILLED,
          getActiveSettledOutcome(current),
          current,
        );
      }

      if (
        !current.transition ||
        (expectedTransitionId !== null &&
          current.transition.transitionId !== expectedTransitionId)
      ) {
        throw new LocalApplicationSystemdActivationStateError(
          appId,
          'durable transition changed while the operation lock was held',
        );
      }
      expectedTransitionId ??= current.transition.transitionId;
      const destination = getDestination(current);
      await verifyRelease(appId, current.desired);

      if (current.phase === LocalApplicationActivationPhase.QUIESCING) {
        const isSourceRestore =
          destination === LocalApplicationActivationDestination.SOURCE;
        const isFirstInstall = current.transition.source === null;
        const requiresSourceQuiescence = !isSourceRestore && !isFirstInstall;
        if (requiresSourceQuiescence) {
          // A recovery may have been delayed arbitrarily after beginChange.
          // Re-prove the retained rollback path before stopping its source.
          await verifySelectionProjection(createSourceProjectionInput(current));
          const beforeStop = await inspectQuiescence(appId);
          if (!beforeStop.quiescent) {
            return await retainSource(appId, current, beforeStop, operation);
          }
          assertLocalApplicationQuiescent(beforeStop);
        }

        await options.stopService(Object.freeze({ appId }));
        await options.proveServiceInactive(Object.freeze({ appId }));

        if (requiresSourceQuiescence || isFirstInstall) {
          const afterStop = await inspectQuiescence(
            appId,
            isFirstInstall ? current.desired.revisionId : undefined,
          );
          if (!afterStop.quiescent) {
            return await retainSource(appId, current, afterStop, operation);
          }
          assertLocalApplicationQuiescent(afterStop);
        }

        await activationStore.markQuiescent({
          appId,
          transitionId: current.transition.transitionId,
        });
        continue;
      }

      if (current.phase === LocalApplicationActivationPhase.QUIESCENT) {
        // QUIESCENT is the durable service-start barrier. Repeat the physical
        // stop proof after crossing it so a source start that raced the final
        // QUIESCING scan cannot survive the selector mutation.
        await options.stopService(Object.freeze({ appId }));
        await options.proveServiceInactive(Object.freeze({ appId }));
        const previous =
          destination === LocalApplicationActivationDestination.SOURCE
            ? current.rollbackCandidate
            : current.transition.source;
        const projection = Object.freeze({
          appId,
          current: current.desired,
          previous,
          destination,
          action: current.transition.action,
          transitionId: current.transition.transitionId,
        });
        await options.selectRelease(projection);
        await verifySelectionProjection(
          Object.freeze({ appId, current: current.desired, previous }),
        );
        await activationStore.markSelected({
          appId,
          transitionId: current.transition.transitionId,
          destination,
        });
        continue;
      }

      if (current.phase === LocalApplicationActivationPhase.SELECTED) {
        // A crash after selector convergence must not trust an earlier
        // inactivity observation. SELECTED still closes service admission.
        await options.stopService(Object.freeze({ appId }));
        await options.proveServiceInactive(Object.freeze({ appId }));
        await verifySelectionProjection(createProjectionInput(current));
        await activationStore.markActivating({
          appId,
          transitionId: current.transition.transitionId,
        });
        continue;
      }

      if (current.phase === LocalApplicationActivationPhase.ACTIVATING) {
        await verifySelectionProjection(createProjectionInput(current));
        const outcome = normalizeReleaseActivationOutcome(
          await options.activateRelease(
            Object.freeze({ appId, release: current.desired }),
          ),
          appId,
        );
        if (outcome === 'healthy') {
          await options.verifyActiveRelease(
            Object.freeze({ appId, release: current.desired }),
          );
          await activationStore.completeActivation({
            appId,
            transitionId: current.transition.transitionId,
          });
          continue;
        }
        if (
          destination === LocalApplicationActivationDestination.TARGET &&
          current.transition.source !== null
        ) {
          await activationStore.beginSourceRestore({
            appId,
            transitionId: current.transition.transitionId,
          });
          continue;
        }
        return createResult(
          operation,
          appId,
          LocalApplicationSystemdActivationRequestStatus.PENDING,
          LocalApplicationSystemdActivationSettledOutcome.IN_FLIGHT,
          current,
          'activation-failed',
        );
      }

      throw new LocalApplicationSystemdActivationStateError(
        appId,
        `unsupported durable phase ${String(current.phase)}`,
      );
    }
    throw new LocalApplicationSystemdActivationStateError(
      appId,
      'convergence exceeded its finite phase bound',
    );
  }

  /**
   * @param {string} operation - Operation name.
   * @param {string} appId - Application.
   * @param {() => Promise<Readonly<Record<string, any>>>} work - Locked work.
   * @returns {Promise<Readonly<Record<string, any>>>}
   */
  async function withOperationLock(operation, appId, work) {
    const release = await options.acquireOperationLock(
      Object.freeze({ appId, operation }),
    );
    if (typeof release !== 'function') {
      throw new TypeError('acquireOperationLock must resolve to a function.');
    }
    try {
      return await work();
    } finally {
      await release();
    }
  }

  /**
   * @param {unknown} input - Install request.
   * @returns {Promise<Readonly<Record<string, any>>>} - Finite result.
   */
  async function install(input) {
    const request = normalizeTargetOperationInput(input, 'systemd install');
    return await withOperationLock('install', request.appId, async () => {
      const current = await activationStore.get({ appId: request.appId });
      if (!current) {
        // Immutable staged releases are allowed by this proof; selector,
        // receipt, unit, and runtime state are not.
        await options.verifyAbsent(Object.freeze({ appId: request.appId }));
      }
      await prepareRelease(request.appId, request.target);
      const replaceFailedInstall =
        current &&
        current.phase !== LocalApplicationActivationPhase.ACTIVE &&
        current.transition?.action ===
          LocalApplicationActivationAction.INSTALL &&
        !sameRelease(current.transition.target, request.target);
      const begun = replaceFailedInstall
        ? await activationStore.replaceInstall({
            appId: request.appId,
            transitionId: current.transition.transitionId,
            recordVersion: current.recordVersion,
            target: request.target,
          })
        : await activationStore.beginInstall({
            appId: request.appId,
            target: request.target,
          });
      return await converge(
        request.appId,
        'install',
        begun.activation.transition?.transitionId ?? null,
      );
    });
  }

  /**
   * @param {unknown} input - Update request.
   * @returns {Promise<Readonly<Record<string, any>>>} - Finite result.
   */
  async function update(input) {
    const request = normalizeTargetOperationInput(input, 'systemd update');
    return await withOperationLock('update', request.appId, async () => {
      await prepareRelease(request.appId, request.target);
      const current = await activationStore.get({ appId: request.appId });
      if (
        current?.transition?.action ===
          LocalApplicationActivationAction.UPDATE &&
        current.transition.source !== null &&
        sameRelease(current.transition.target, request.target)
      ) {
        return await converge(
          request.appId,
          'update',
          current.transition.transitionId,
        );
      }
      if (
        !current ||
        current.phase !== LocalApplicationActivationPhase.ACTIVE ||
        !current.selected
      ) {
        throw new LocalApplicationSystemdActivationStateError(
          request.appId,
          'update requires one exact ACTIVE source release',
        );
      }
      if (sameRelease(current.selected, request.target)) {
        await verifyActive(current);
        return await converge(request.appId, 'update', null);
      }
      await verifyActive(current);
      const begun = await activationStore.beginChange({
        appId: request.appId,
        action: LocalApplicationActivationAction.UPDATE,
        source: current.selected,
        target: request.target,
      });
      return await converge(
        request.appId,
        'update',
        begun.activation.transition.transitionId,
      );
    });
  }

  /**
   * @param {unknown} input - Rollback request.
   * @returns {Promise<Readonly<Record<string, any>>>} - Finite result.
   */
  async function rollback(input) {
    const request = normalizeOperationInput(input, 'systemd rollback', false);
    return await withOperationLock('rollback', request.appId, async () => {
      const current = await activationStore.get({ appId: request.appId });
      if (
        current?.transition?.action ===
        LocalApplicationActivationAction.ROLLBACK
      ) {
        return await converge(
          request.appId,
          'rollback',
          current.transition.transitionId,
        );
      }
      if (
        !current ||
        current.phase !== LocalApplicationActivationPhase.ACTIVE ||
        !current.selected ||
        !current.rollbackCandidate
      ) {
        throw new LocalApplicationSystemdActivationStateError(
          request.appId,
          'rollback requires one ACTIVE source release with an exact retained candidate',
        );
      }
      await verifyRelease(request.appId, current.rollbackCandidate);
      await verifyActive(current);
      const begun = await activationStore.beginChange({
        appId: request.appId,
        action: LocalApplicationActivationAction.ROLLBACK,
        source: current.selected,
        target: current.rollbackCandidate,
      });
      return await converge(
        request.appId,
        'rollback',
        begun.activation.transition.transitionId,
      );
    });
  }

  /**
   * @param {unknown} input - Recovery request.
   * @returns {Promise<Readonly<Record<string, any>>>} - Finite result.
   */
  async function recover(input) {
    const request = normalizeOperationInput(input, 'systemd recover', false);
    return await withOperationLock('recover', request.appId, async () => {
      const current = await activationStore.get({ appId: request.appId });
      return await converge(
        request.appId,
        'recover',
        current?.transition?.transitionId ?? null,
      );
    });
  }

  /**
   * @param {unknown} input - Status request.
   * @returns {Promise<Readonly<Record<string, any>>>} - Finite result.
   */
  async function status(input) {
    const request = normalizeOperationInput(input, 'systemd status', false);
    return await withOperationLock('status', request.appId, async () => {
      const current = await activationStore.get({ appId: request.appId });
      if (!current) {
        await options.verifyAbsent(Object.freeze({ appId: request.appId }));
        return createResult(
          'status',
          request.appId,
          LocalApplicationSystemdActivationRequestStatus.FULFILLED,
          LocalApplicationSystemdActivationSettledOutcome.ABSENT,
          null,
        );
      }
      if (current.phase === LocalApplicationActivationPhase.ACTIVE) {
        await verifyActive(current);
        return createResult(
          'status',
          request.appId,
          LocalApplicationSystemdActivationRequestStatus.FULFILLED,
          getActiveSettledOutcome(current),
          current,
        );
      }
      return createResult(
        'status',
        request.appId,
        LocalApplicationSystemdActivationRequestStatus.FULFILLED,
        LocalApplicationSystemdActivationSettledOutcome.IN_FLIGHT,
        current,
        'transition-in-progress',
      );
    });
  }

  return Object.freeze({ install, update, rollback, recover, status });
}

export default createLocalApplicationSystemdActivation;
