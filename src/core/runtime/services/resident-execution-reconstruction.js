import { createHash } from 'node:crypto';

import {
  AttemptStatus,
  EffectStatus,
  InvocationStatus,
  RunStatus,
  deepFreezeJson,
} from '../../lib/ledger/execution-ledger-contract.js';
import { assertLedgerOpaqueId } from '../../lib/ledger/record-key.js';
import { ExecutionLedgerReadyWorkKind } from '../../lib/ledger/ready-work.js';
import { WorkflowCursorDisposition } from '../../lib/ledger/workflow-execution-contract.js';
import { assertApplicationRevisionId } from '../application-revision.js';
import { assertCoordinatorAuthorityToken } from '../../lib/db/tables/coordinator-authority.js';
import { visitExecutionLedgerHistory } from '../execution-ledger-history-inventory.js';
import { assertLogicalId } from '../logical-id.js';

export const RESIDENT_EXECUTION_RECONSTRUCTION_SCHEMA_VERSION = 1;
export const RESIDENT_EXECUTION_RECONSTRUCTION_SAMPLE_LIMIT = 50;

export const ResidentExecutionReconstructionClassification = Object.freeze({
  MANUAL_RUNNABLE: 'manual-runnable',
  MANUAL_CLAIMED: 'manual-claimed',
  MANUAL_STARTED: 'manual-started',
  WORKFLOW_ACTIVITY_RUNNABLE: 'workflow-activity-runnable',
  WORKFLOW_ACTIVITY_CLAIMED: 'workflow-activity-claimed',
  WORKFLOW_ACTIVITY_STARTED: 'workflow-activity-started',
  WORKFLOW_TIMER_WAITING: 'workflow-timer-waiting',
  WORKFLOW_SIGNAL_WAITING: 'workflow-signal-waiting',
  SUCCESSOR_RUNNABLE: 'successor-runnable',
  SUCCESSOR_STARTED: 'successor-started',
  BLOCKED: 'blocked',
  TERMINAL: 'terminal',
});

export const ResidentExecutionReconstructionPolicy = Object.freeze({
  DISPATCHABLE_AFTER_FRESH_CLAIM: 'dispatchable-after-fresh-claim',
  RECOVER_PRE_START_CLAIM: 'recover-pre-start-claim',
  STARTED_OUTCOME_UNKNOWN: 'started-outcome-unknown',
  FRAMEWORK_TIMER_CAS: 'framework-timer-cas',
  WAIT_SIGNAL: 'wait-signal',
  BLOCKED_RECONCILIATION: 'blocked-reconciliation',
  TERMINAL: 'terminal',
  PARKED_REVISION: 'parked-revision',
  EFFECT_SUCCESSOR_OPERATOR_ONLY: 'effect-successor-operator-only',
});

const TERMINAL_RUN_STATUSES = new Set([
  RunStatus.COMPLETED,
  RunStatus.FAILED,
  RunStatus.CANCELLED,
]);
const SUPPORTED_RUN_KINDS = new Set(['manual', 'workflow', 'effect-successor']);

/** @param {AbortSignal | undefined} signal - Supervisor loss signal. */
function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw (
    signal.reason ?? new Error('Resident execution reconstruction aborted.')
  );
}

/**
 * @param {unknown} value - Candidate integer.
 * @param {string} label - Boundary label.
 * @returns {number} - Validated integer.
 */
function nonnegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/**
 * @param {unknown} value - Candidate integer.
 * @param {string} label - Boundary label.
 * @returns {number} - Validated integer.
 */
function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

/**
 * @param {unknown} value - Candidate record.
 * @param {string} label - Boundary label.
 * @returns {Record<string, any>} - Validated record.
 */
function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return /** @type {Record<string, any>} */ (value);
}

/**
 * @param {unknown} value - Candidate record array.
 * @param {string} label - Boundary label.
 * @returns {Record<string, any>[]} - Validated records.
 */
function records(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value.map((item, index) => record(item, `${label}[${index}]`));
}

/**
 * @param {Record<string, any>} projection - Run child projection.
 * @param {Record<string, any>} run - Parent run.
 * @param {string} label - Projection label.
 */
function assertProjectionScope(projection, run, label) {
  if (
    projection.runId !== run.runId ||
    projection.appId !== run.appId ||
    projection.revisionId !== run.revisionId
  ) {
    throw new TypeError(`${label} crossed its rebuilt run scope.`);
  }
}

/**
 * @param {Record<string, any>[]} attempts - Rebuilt attempt projections.
 * @param {Record<string, any>} invocation - Current invocation.
 * @param {string} runId - Durable run identity.
 * @returns {Record<string, any>} - Sole current physical attempt.
 */
function currentAttempt(attempts, invocation, runId) {
  const matches = attempts.filter(
    (attempt) =>
      attempt.invocationId === invocation.invocationId &&
      attempt.generation === invocation.generation,
  );
  if (matches.length !== 1) {
    throw new TypeError(
      `Resident reconstruction could not identify the current attempt: ${runId}`,
    );
  }
  return matches[0];
}

/**
 * @param {Record<string, any>} view - Fully rebuilt ledger view.
 * @param {string} appId - Captured application scope.
 * @returns {{run: Record<string, any>, kind: 'manual'|'workflow'|'effect-successor', invocations: Record<string, any>[], attempts: Record<string, any>[], effects: Record<string, any>[], timers: Record<string, any>[], signalWaits: Record<string, any>[]}} - Strict common reconstruction view.
 */
function validateCommonView(view, appId) {
  const value = record(view, 'resident reconstruction view');
  const run = record(value.run, 'resident reconstruction run');
  const runId = assertLedgerOpaqueId(
    run.runId,
    'resident reconstruction runId',
  );
  if (run.appId !== appId) {
    throw new TypeError(
      'Resident reconstruction rebuilt a run outside its application scope.',
    );
  }
  assertApplicationRevisionId(
    run.revisionId,
    'resident reconstruction run revisionId',
  );
  const kind = /** @type {'manual'|'workflow'|'effect-successor'} */ (
    run.trigger?.kind
  );
  if (!SUPPORTED_RUN_KINDS.has(kind)) {
    throw new TypeError(
      `Resident reconstruction does not recognize the run kind: ${runId}`,
    );
  }
  if (
    run.status !== RunStatus.RUNNING &&
    run.status !== RunStatus.BLOCKED &&
    !TERMINAL_RUN_STATUSES.has(run.status)
  ) {
    throw new TypeError(
      `Resident reconstruction does not recognize the run status: ${runId}`,
    );
  }
  positiveSafeInteger(run.version, 'resident reconstruction run version');
  positiveSafeInteger(
    run.lastSequence,
    'resident reconstruction run lastSequence',
  );

  const invocations = records(value.invocations, 'reconstructed invocations');
  const attempts = records(value.attempts, 'reconstructed attempts');
  const effects = records(value.effects, 'reconstructed effects');
  const timers = records(value.timers, 'reconstructed timers');
  const signalWaits = records(value.signalWaits, 'reconstructed signal waits');
  const signalDeliveries = records(
    value.signalDeliveries,
    'reconstructed signal deliveries',
  );
  records(value.events, 'reconstructed events');
  record(value.head, 'resident reconstruction run head');
  /** @type {Array<[string, Record<string, any>[]]>} */
  const scopedProjections = [
    ['invocation', invocations],
    ['attempt', attempts],
    ['effect', effects],
    ['timer', timers],
    ['signal wait', signalWaits],
  ];
  for (const [label, projections] of scopedProjections) {
    for (const projection of projections) {
      assertProjectionScope(projection, run, `Reconstructed ${label}`);
    }
  }
  for (const delivery of signalDeliveries) {
    if (delivery.runId !== run.runId || delivery.appId !== run.appId) {
      throw new TypeError(
        'Reconstructed signal delivery crossed its rebuilt run scope.',
      );
    }
  }
  return {
    run,
    kind,
    invocations,
    attempts,
    effects,
    timers,
    signalWaits,
  };
}

/**
 * @param {Record<string, any>} directory - Verified history directory item.
 * @param {Record<string, any>} view - Rebuilt run view.
 * @param {string} appId - Captured application scope.
 */
function assertDirectoryMatchesView(directory, view, appId) {
  const row = record(directory, 'resident reconstruction directory item');
  const run = record(view.run, 'resident reconstruction run');
  assertLedgerOpaqueId(row.runId, 'resident reconstruction directory runId');
  assertApplicationRevisionId(
    row.revisionId,
    'resident reconstruction directory revisionId',
  );
  if (
    row.appId !== appId ||
    row.runId !== run.runId ||
    row.revisionId !== run.revisionId ||
    row.kind !== run.trigger?.kind ||
    row.status !== run.status ||
    row.version !== run.version ||
    row.lastSequence !== run.lastSequence
  ) {
    throw new TypeError(
      'Resident reconstruction directory disagrees with its rebuilt run.',
    );
  }
}

/**
 * Classify a fully rebuilt run without executing or recovering any work.
 * Revision compatibility affects active/waiting policy: old executable work
 * is parked, while terminal and blocked states retain their inert policies.
 * @param {Record<string, any>} view - Fully rebuilt ledger view.
 * @param {{appId: string, currentRevisionId: string}} options - Captured executable scope.
 * @returns {Readonly<{classification: string, policy: string, revisionCompatible: boolean, expectedReadyWorkKind?: 'ACTIVITY'|'RECOVERY'|'TIMER'}>} - Source-free reconstruction decision.
 */
export function classifyResidentExecutionView(view, options) {
  const appId = options?.appId;
  const currentRevisionId = options?.currentRevisionId;
  assertLogicalId(appId, 'resident reconstruction appId');
  assertApplicationRevisionId(
    currentRevisionId,
    'resident reconstruction currentRevisionId',
  );
  const { run, kind, invocations, attempts, effects, timers, signalWaits } =
    validateCommonView(view, appId);
  const revisionCompatible = run.revisionId === currentRevisionId;
  /** @type {string} */
  let classification;
  /** @type {'ACTIVITY'|'RECOVERY'|'TIMER' | undefined} */
  let expectedReadyWorkKind;

  if (TERMINAL_RUN_STATUSES.has(run.status)) {
    classification = ResidentExecutionReconstructionClassification.TERMINAL;
  } else if (run.status === RunStatus.BLOCKED) {
    classification = ResidentExecutionReconstructionClassification.BLOCKED;
  } else if (kind === 'manual') {
    if (invocations.length !== 1) {
      throw new TypeError(
        `Resident reconstruction requires one manual invocation: ${run.runId}`,
      );
    }
    const invocation = invocations[0];
    nonnegativeSafeInteger(
      invocation.generation,
      'resident reconstruction invocation generation',
    );
    if (invocation.status === InvocationStatus.RUNNABLE) {
      const active = attempts.filter(
        (attempt) =>
          attempt.invocationId === invocation.invocationId &&
          attempt.generation === invocation.generation &&
          [AttemptStatus.CLAIMED, AttemptStatus.STARTED].includes(
            attempt.status,
          ),
      );
      if (active.length !== 0) {
        throw new TypeError(
          `Runnable manual work retains an active attempt: ${run.runId}`,
        );
      }
      classification =
        ResidentExecutionReconstructionClassification.MANUAL_RUNNABLE;
      expectedReadyWorkKind = ExecutionLedgerReadyWorkKind.ACTIVITY;
    } else if (invocation.status === InvocationStatus.RUNNING) {
      const attempt = currentAttempt(attempts, invocation, run.runId);
      if (attempt.status === AttemptStatus.CLAIMED) {
        classification =
          ResidentExecutionReconstructionClassification.MANUAL_CLAIMED;
      } else if (attempt.status === AttemptStatus.STARTED) {
        classification =
          ResidentExecutionReconstructionClassification.MANUAL_STARTED;
      } else {
        throw new TypeError(
          `Running manual work has no recoverable attempt: ${run.runId}`,
        );
      }
      expectedReadyWorkKind = ExecutionLedgerReadyWorkKind.RECOVERY;
    } else {
      throw new TypeError(
        `Running manual work has an invalid invocation state: ${run.runId}`,
      );
    }
  } else if (kind === 'workflow') {
    const cursor = record(
      view.workflowCursor,
      'resident reconstruction workflow cursor',
    );
    assertProjectionScope(cursor, run, 'Reconstructed workflow cursor');
    if (
      cursor.disposition === WorkflowCursorDisposition.ACTIVITY_RUNNABLE ||
      cursor.disposition === WorkflowCursorDisposition.ACTIVITY_RUNNING
    ) {
      const matching = invocations.filter(
        (invocation) => invocation.invocationId === cursor.invocationId,
      );
      if (matching.length !== 1) {
        throw new TypeError(
          `Resident reconstruction could not identify the workflow invocation: ${run.runId}`,
        );
      }
      const invocation = matching[0];
      nonnegativeSafeInteger(
        invocation.generation,
        'resident reconstruction workflow generation',
      );
      if (
        cursor.disposition === WorkflowCursorDisposition.ACTIVITY_RUNNABLE &&
        invocation.status === InvocationStatus.RUNNABLE
      ) {
        const active = attempts.filter(
          (attempt) =>
            attempt.invocationId === invocation.invocationId &&
            attempt.generation === invocation.generation &&
            [AttemptStatus.CLAIMED, AttemptStatus.STARTED].includes(
              attempt.status,
            ),
        );
        if (active.length !== 0) {
          throw new TypeError(
            `Runnable workflow work retains an active attempt: ${run.runId}`,
          );
        }
        classification =
          ResidentExecutionReconstructionClassification.WORKFLOW_ACTIVITY_RUNNABLE;
        expectedReadyWorkKind = ExecutionLedgerReadyWorkKind.ACTIVITY;
      } else if (
        cursor.disposition === WorkflowCursorDisposition.ACTIVITY_RUNNING &&
        invocation.status === InvocationStatus.RUNNING
      ) {
        const attempt = currentAttempt(attempts, invocation, run.runId);
        if (attempt.status === AttemptStatus.CLAIMED) {
          classification =
            ResidentExecutionReconstructionClassification.WORKFLOW_ACTIVITY_CLAIMED;
        } else if (attempt.status === AttemptStatus.STARTED) {
          classification =
            ResidentExecutionReconstructionClassification.WORKFLOW_ACTIVITY_STARTED;
        } else {
          throw new TypeError(
            `Running workflow work has no recoverable attempt: ${run.runId}`,
          );
        }
        expectedReadyWorkKind = ExecutionLedgerReadyWorkKind.RECOVERY;
      } else {
        throw new TypeError(
          `Workflow cursor and invocation disagree: ${run.runId}`,
        );
      }
    } else if (cursor.disposition === WorkflowCursorDisposition.TIMER_WAITING) {
      const matching = timers.filter(
        (timer) => timer.timerId === cursor.timerId,
      );
      if (matching.length !== 1 || matching[0].status !== 'WAITING') {
        throw new TypeError(
          `Resident reconstruction could not identify the waiting timer: ${run.runId}`,
        );
      }
      nonnegativeSafeInteger(
        matching[0].dueAt,
        'resident reconstruction timer dueAt',
      );
      classification =
        ResidentExecutionReconstructionClassification.WORKFLOW_TIMER_WAITING;
      expectedReadyWorkKind = ExecutionLedgerReadyWorkKind.TIMER;
    } else if (
      cursor.disposition === WorkflowCursorDisposition.SIGNAL_WAITING
    ) {
      const matching = signalWaits.filter(
        (wait) => wait.signalWaitId === cursor.signalWaitId,
      );
      if (matching.length !== 1 || matching[0].status !== 'WAITING') {
        throw new TypeError(
          `Resident reconstruction could not identify the signal wait: ${run.runId}`,
        );
      }
      classification =
        ResidentExecutionReconstructionClassification.WORKFLOW_SIGNAL_WAITING;
    } else {
      throw new TypeError(
        `Running workflow has an invalid cursor disposition: ${run.runId}`,
      );
    }
  } else {
    if (invocations.length !== 1) {
      throw new TypeError(
        `Resident reconstruction requires one successor invocation: ${run.runId}`,
      );
    }
    const invocation = invocations[0];
    if (invocation.status === InvocationStatus.RUNNABLE) {
      const activeAttempts = attempts.filter(
        (attempt) =>
          attempt.invocationId === invocation.invocationId &&
          [AttemptStatus.CLAIMED, AttemptStatus.STARTED].includes(
            attempt.status,
          ),
      );
      const activeEffects = effects.filter(
        (effect) =>
          effect.invocationId === invocation.invocationId &&
          [EffectStatus.PENDING, EffectStatus.STARTED].includes(effect.status),
      );
      if (activeAttempts.length !== 0 || activeEffects.length !== 0) {
        throw new TypeError(
          `Runnable effect successor retains begun work: ${run.runId}`,
        );
      }
      classification =
        ResidentExecutionReconstructionClassification.SUCCESSOR_RUNNABLE;
    } else if (invocation.status === InvocationStatus.RUNNING) {
      const attempt = currentAttempt(attempts, invocation, run.runId);
      const startedEffects = effects.filter(
        (effect) =>
          effect.invocationId === invocation.invocationId &&
          effect.status === EffectStatus.STARTED,
      );
      if (
        attempt.status !== AttemptStatus.STARTED ||
        startedEffects.length !== 1
      ) {
        throw new TypeError(
          `Running effect successor lacks one begun effect: ${run.runId}`,
        );
      }
      classification =
        ResidentExecutionReconstructionClassification.SUCCESSOR_STARTED;
    } else {
      throw new TypeError(
        `Running effect successor has an invalid state: ${run.runId}`,
      );
    }
  }

  let policy;
  if (
    classification === ResidentExecutionReconstructionClassification.TERMINAL
  ) {
    policy = ResidentExecutionReconstructionPolicy.TERMINAL;
  } else if (
    classification === ResidentExecutionReconstructionClassification.BLOCKED
  ) {
    policy = ResidentExecutionReconstructionPolicy.BLOCKED_RECONCILIATION;
  } else if (kind === 'effect-successor') {
    policy =
      ResidentExecutionReconstructionPolicy.EFFECT_SUCCESSOR_OPERATOR_ONLY;
  } else if (!revisionCompatible) {
    policy = ResidentExecutionReconstructionPolicy.PARKED_REVISION;
  } else if (
    classification ===
      ResidentExecutionReconstructionClassification.MANUAL_RUNNABLE ||
    classification ===
      ResidentExecutionReconstructionClassification.WORKFLOW_ACTIVITY_RUNNABLE
  ) {
    policy =
      ResidentExecutionReconstructionPolicy.DISPATCHABLE_AFTER_FRESH_CLAIM;
  } else if (
    classification ===
      ResidentExecutionReconstructionClassification.MANUAL_CLAIMED ||
    classification ===
      ResidentExecutionReconstructionClassification.WORKFLOW_ACTIVITY_CLAIMED
  ) {
    policy = ResidentExecutionReconstructionPolicy.RECOVER_PRE_START_CLAIM;
  } else if (
    classification ===
      ResidentExecutionReconstructionClassification.MANUAL_STARTED ||
    classification ===
      ResidentExecutionReconstructionClassification.WORKFLOW_ACTIVITY_STARTED
  ) {
    policy = ResidentExecutionReconstructionPolicy.STARTED_OUTCOME_UNKNOWN;
  } else if (
    classification ===
    ResidentExecutionReconstructionClassification.WORKFLOW_TIMER_WAITING
  ) {
    policy = ResidentExecutionReconstructionPolicy.FRAMEWORK_TIMER_CAS;
  } else {
    policy = ResidentExecutionReconstructionPolicy.WAIT_SIGNAL;
  }

  return Object.freeze({
    classification,
    policy,
    revisionCompatible,
    ...(expectedReadyWorkKind === undefined ? {} : { expectedReadyWorkKind }),
  });
}

/**
 * @param {import('node:crypto').Hash} hash - Incremental inventory hash.
 * @param {Readonly<Record<string, any>>} entry - Stable fingerprint fields.
 * @returns {void} - Updates the fingerprint.
 */
function updateInventoryFingerprint(hash, entry) {
  hash.update(JSON.stringify(entry));
  hash.update('\n');
}

/**
 * @param {Record<string, any>} directory - Directory snapshot.
 * @param {ReturnType<typeof classifyResidentExecutionView>} decision - Classification.
 * @returns {Readonly<Record<string, any>>} - Stable redacted fingerprint fields.
 */
function fingerprintEntry(directory, decision) {
  return {
    runId: directory.runId,
    appId: directory.appId,
    revisionId: directory.revisionId,
    kind: directory.kind,
    status: directory.status,
    version: directory.version,
    lastSequence: directory.lastSequence,
    classification: decision.classification,
    policy: decision.policy,
    revisionCompatible: decision.revisionCompatible,
    ...(decision.expectedReadyWorkKind === undefined
      ? {}
      : { expectedReadyWorkKind: decision.expectedReadyWorkKind }),
  };
}

/**
 * @param {Readonly<Record<string, any>>} expected - Inventory fingerprint.
 * @param {Record<string, any>} result - Ready-work repair outcome.
 * @returns {void} - Returns when repair and inventory agree.
 */
function assertRepairResult(expected, result) {
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    typeof result.applied !== 'boolean' ||
    result.runId !== expected.runId
  ) {
    throw new TypeError(
      'Resident reconstruction received an invalid ready-work repair result.',
    );
  }
  if (expected.expectedReadyWorkKind === undefined) {
    if (Object.prototype.hasOwnProperty.call(result, 'expected')) {
      throw new TypeError(
        'Resident reconstruction observed new ready work during convergence.',
      );
    }
    return;
  }
  if (
    result.expected?.appId !== expected.appId ||
    result.expected.revisionId !== expected.revisionId ||
    result.expected.runId !== expected.runId ||
    result.expected.kind !== expected.expectedReadyWorkKind ||
    result.expected.runVersion !== expected.version ||
    result.expected.lastSequence !== expected.lastSequence
  ) {
    throw new TypeError(
      'Resident reconstruction ready-work repair disagrees with the inventory.',
    );
  }
}

/**
 * @param {string[]} values - Complete counter vocabulary.
 * @returns {Record<string, number>} - Zero-initialized counters.
 */
function zeroCounts(values) {
  return Object.fromEntries(values.map((value) => [value, 0]));
}

/**
 * Rebuild every durable run twice under one replacement authority. The first
 * pass validates the complete inventory before any write. The second
 * pass must fingerprint identically while each manual/workflow locator is
 * converged with its event fold. No activity source, timer, signal, effect, or
 * successor executor is reachable from this module; ordinary worker claims
 * remain the only later dispatch authority.
 * @param {{ledger: Pick<import('../../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, 'listRuns'|'rebuildRun'|'repairReadyWork'|'getCoordinatorAuthority'|'assertCurrentCoordinatorAuthority'>, appId: string, currentRevisionId: string, coordinatorAuthority: unknown, signal?: AbortSignal, observedAt?: number}} options - Exact authority-bound reconstruction scope.
 * @returns {Promise<Readonly<Record<string, any>>>} - Frozen bounded redacted report.
 */
export async function reconstructResidentExecutionHistory(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Resident execution reconstruction requires options.');
  }
  const allowedOptions = new Set([
    'ledger',
    'appId',
    'currentRevisionId',
    'coordinatorAuthority',
    'signal',
    'observedAt',
  ]);
  if (Object.keys(options).some((key) => !allowedOptions.has(key))) {
    throw new TypeError(
      'Resident execution reconstruction options contain unsupported fields.',
    );
  }
  const appId = options.appId;
  const currentRevisionId = options.currentRevisionId;
  const ledger = options.ledger;
  const signal = options.signal;
  const coordinatorAuthority = options.coordinatorAuthority;
  const requestedObservedAt = options.observedAt;
  assertLogicalId(appId, 'resident reconstruction appId');
  assertApplicationRevisionId(
    currentRevisionId,
    'resident reconstruction currentRevisionId',
  );
  const observedAt =
    requestedObservedAt === undefined
      ? Date.now()
      : nonnegativeSafeInteger(
          requestedObservedAt,
          'resident reconstruction observedAt',
        );
  if (
    typeof ledger?.listRuns !== 'function' ||
    typeof ledger?.rebuildRun !== 'function' ||
    typeof ledger?.repairReadyWork !== 'function' ||
    typeof ledger?.getCoordinatorAuthority !== 'function' ||
    typeof ledger?.assertCurrentCoordinatorAuthority !== 'function'
  ) {
    throw new TypeError(
      'Resident execution reconstruction requires an authority-bound execution ledger.',
    );
  }
  const expectedAuthority = assertCoordinatorAuthorityToken(
    coordinatorAuthority,
    'resident reconstruction coordinatorAuthority',
  );
  const boundAuthority = assertCoordinatorAuthorityToken(
    ledger.getCoordinatorAuthority(),
    'resident reconstruction bound coordinatorAuthority',
  );
  if (
    expectedAuthority.appId !== appId ||
    JSON.stringify(expectedAuthority) !== JSON.stringify(boundAuthority)
  ) {
    throw new TypeError(
      'Resident reconstruction requires the exact session authority-bound ledger.',
    );
  }

  throwIfAborted(signal);
  const firstHash = createHash('sha256');
  const first = await visitExecutionLedgerHistory({
    ledger,
    appId,
    signal,
    visit: ({ directory, view }) => {
      assertDirectoryMatchesView(directory, view, appId);
      const decision = classifyResidentExecutionView(view, {
        appId,
        currentRevisionId,
      });
      updateInventoryFingerprint(
        firstHash,
        fingerprintEntry(directory, decision),
      );
    },
  });
  throwIfAborted(signal);

  const classificationCounts = zeroCounts(
    Object.values(ResidentExecutionReconstructionClassification),
  );
  const policyCounts = zeroCounts(
    Object.values(ResidentExecutionReconstructionPolicy),
  );
  /** @type {Readonly<Record<string, any>>[]} */
  const samples = [];
  let repairChecks = 0;
  let repairsApplied = 0;
  const secondHash = createHash('sha256');
  const second = await visitExecutionLedgerHistory({
    ledger,
    appId,
    signal,
    visit: async ({ directory, view }) => {
      assertDirectoryMatchesView(directory, view, appId);
      const decision = classifyResidentExecutionView(view, {
        appId,
        currentRevisionId,
      });
      const fingerprint = fingerprintEntry(directory, decision);
      updateInventoryFingerprint(secondHash, fingerprint);
      classificationCounts[decision.classification] += 1;
      policyCounts[decision.policy] += 1;
      if (samples.length < RESIDENT_EXECUTION_RECONSTRUCTION_SAMPLE_LIMIT) {
        samples.push(fingerprint);
      }

      if (directory.kind === 'manual' || directory.kind === 'workflow') {
        throwIfAborted(signal);
        const repair = await ledger.repairReadyWork({
          appId,
          revisionId: directory.revisionId,
          runId: directory.runId,
        });
        throwIfAborted(signal);
        assertRepairResult(fingerprint, repair);
        repairChecks += 1;
        if (repair.applied) repairsApplied += 1;
        if (decision.expectedReadyWorkKind === undefined) {
          const retained = await ledger.rebuildRun(directory.runId);
          throwIfAborted(signal);
          if (!retained) {
            throw new TypeError(
              'Resident reconstruction lost a run after ready-work repair.',
            );
          }
          assertDirectoryMatchesView(directory, retained, appId);
          const retainedDecision = classifyResidentExecutionView(retained, {
            appId,
            currentRevisionId,
          });
          if (
            JSON.stringify(fingerprintEntry(directory, retainedDecision)) !==
            JSON.stringify(fingerprint)
          ) {
            throw new Error(
              'Resident execution history changed during ready-work repair.',
            );
          }
        }
      }
    },
  });
  throwIfAborted(signal);

  const firstDigest = firstHash.digest('base64url');
  const secondDigest = secondHash.digest('base64url');
  if (
    first.visitedRuns !== second.visitedRuns ||
    firstDigest !== secondDigest
  ) {
    throw new Error(
      'Resident execution history changed during reconstruction; startup remains closed.',
    );
  }

  await ledger.assertCurrentCoordinatorAuthority();
  throwIfAborted(signal);
  return deepFreezeJson({
    schemaVersion: RESIDENT_EXECUTION_RECONSTRUCTION_SCHEMA_VERSION,
    appId,
    currentRevisionId,
    observedAt,
    inventoryDigest: `sha256:${secondDigest}`,
    inspectedRuns: second.visitedRuns,
    readyWork: {
      checks: repairChecks,
      applied: repairsApplied,
      unchanged: repairChecks - repairsApplied,
    },
    classificationCounts,
    policyCounts,
    samples,
    samplesTruncated:
      second.visitedRuns > RESIDENT_EXECUTION_RECONSTRUCTION_SAMPLE_LIMIT,
  });
}
