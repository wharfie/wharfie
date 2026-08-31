import { assertApplicationRevisionId } from './application-revision.js';
import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import { visitExecutionLedgerHistory } from './execution-ledger-history-inventory.js';
import {
  APPLICATION_STATE_ADAPTER_DESCRIPTOR,
  APPLICATION_STATE_CAPABILITY,
  APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
  APPLICATION_STATE_VERIFIER_DESCRIPTOR,
  normalizeApplicationStateDestination,
} from './effects/application-state.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import {
  EffectStatus,
  EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
  EXECUTION_LEDGER_SCHEMA_VERSION,
  MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA,
  MANAGED_EFFECT_RECONCILIATION_EVIDENCE_PAYLOAD_SCHEMA,
  MANAGED_EFFECT_REQUEST_PAYLOAD_SCHEMA,
  assertExactKeys,
  assertNonnegativeSafeInteger,
  assertPositiveSafeInteger,
  assertSnapshotKeys,
  createManagedEffectDestinationId,
  deepFreezeJson,
  hasSameCanonicalJson,
  normalizeEffectAdapterDescriptor,
  normalizeEffectVerifierDescriptor,
  normalizePayloadReference,
  normalizeReplayProperties,
} from '../lib/ledger/execution-ledger-contract.js';
import { normalizeManagedEffectSuccessorAuthorization } from '../lib/ledger/managed-effect-successor-contract.js';
import { assertLedgerOpaqueId } from '../lib/ledger/record-key.js';

export const APPLICATION_STATE_HISTORY_CHECKPOINT_SCHEMA_VERSION = 1;
export const APPLICATION_STATE_HISTORY_CHECKPOINT_KIND =
  'applicationStateHistoryCheckpoint';
export const APPLICATION_STATE_HISTORY_DIGEST_DOMAIN =
  'wharfie:application-state:history-checkpoint:v1';
export const APPLICATION_STATE_HISTORY_DIGEST_PREFIX = 'wash1';

const EFFECT_ENTRY_KIND = 'applicationStateEffect';
const SUCCESSOR_ENTRY_KIND = 'applicationStateEffectSuccessor';
const UNSETTLED_EFFECT_STATUSES = new Set([
  EffectStatus.PENDING,
  EffectStatus.STARTED,
  EffectStatus.UNCERTAIN,
]);
const EFFECT_REQUIRED_FIELDS = Object.freeze([
  'schemaVersion',
  'runId',
  'invocationId',
  'effectId',
  'appId',
  'revisionId',
  'activityId',
  'destinationEffectId',
  'adapter',
  'destination',
  'verifier',
  'requestRef',
  'requestedReplayProperties',
  'substantiatedReplayProperties',
  'requestedBy',
  'status',
  'version',
  'lastSequence',
  'createdAt',
  'updatedAt',
]);
const EFFECT_OPTIONAL_FIELDS = Object.freeze([
  'startedBy',
  'terminal',
  'outcomeRef',
  'cancellation',
  'uncertainty',
  'reconciliation',
]);

/**
 * Require one nonnegative safe integer count.
 * @param {unknown} value - Candidate count.
 * @param {string} label - Human-readable boundary label.
 * @returns {number} - Validated count.
 */
function nonnegativeCount(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/**
 * Clone one effect attempt binding retained in a verified projection.
 * @param {unknown} value - Candidate binding.
 * @param {string} label - Human-readable boundary label.
 * @param {boolean} includesProtocolSequence - Whether request sequence is required.
 * @returns {Readonly<Record<string, any>>} - Strict immutable binding.
 */
function normalizeAttemptBinding(value, label, includesProtocolSequence) {
  const binding = cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    label,
  );
  assertExactKeys(
    binding,
    [
      'attemptId',
      'generation',
      'coordinatorEpoch',
      'fencingToken',
      ...(includesProtocolSequence ? ['protocolSequence'] : []),
    ],
    label,
  );
  return Object.freeze({
    attemptId: assertLedgerOpaqueId(binding.attemptId, `${label}.attemptId`),
    generation: assertPositiveSafeInteger(
      binding.generation,
      `${label}.generation`,
    ),
    coordinatorEpoch: assertNonnegativeSafeInteger(
      binding.coordinatorEpoch,
      `${label}.coordinatorEpoch`,
    ),
    fencingToken: assertLedgerOpaqueId(
      binding.fencingToken,
      `${label}.fencingToken`,
    ),
    ...(includesProtocolSequence
      ? {
          protocolSequence: assertPositiveSafeInteger(
            binding.protocolSequence,
            `${label}.protocolSequence`,
          ),
        }
      : {}),
  });
}

/**
 * Require the exact built-in adapter/verifier/replay contract.
 * @param {Record<string, any>} effect - Independently cloned effect.
 * @param {string} appId - Requested application scope.
 * @returns {ReturnType<typeof normalizeApplicationStateDestination>} - Exact destination.
 */
function normalizeBuiltinEffectContract(effect, appId) {
  const adapter = normalizeEffectAdapterDescriptor(
    effect.adapter,
    'application-state history effect.adapter',
  );
  const verifier = normalizeEffectVerifierDescriptor(
    effect.verifier,
    'application-state history effect.verifier',
  );
  const requestedReplayProperties = normalizeReplayProperties(
    effect.requestedReplayProperties,
    'application-state history effect.requestedReplayProperties',
  );
  const substantiatedReplayProperties = normalizeReplayProperties(
    effect.substantiatedReplayProperties,
    'application-state history effect.substantiatedReplayProperties',
  );
  const destination = normalizeApplicationStateDestination(effect.destination);
  if (
    !hasSameCanonicalJson(adapter, APPLICATION_STATE_ADAPTER_DESCRIPTOR) ||
    !hasSameCanonicalJson(verifier, APPLICATION_STATE_VERIFIER_DESCRIPTOR) ||
    !hasSameCanonicalJson(
      requestedReplayProperties,
      APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
    ) ||
    !hasSameCanonicalJson(
      substantiatedReplayProperties,
      APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
    ) ||
    destination.configuration.namespace !== appId
  ) {
    throw new TypeError(
      'Application-state history encountered a noncanonical built-in application-state effect contract.',
    );
  }
  return destination;
}

/**
 * Validate the lifecycle fields which decide whether an effect is settled.
 * @param {Record<string, any>} effect - Independently cloned effect.
 * @returns {void}
 */
function validateEffectLifecycle(effect) {
  /**
   * @param {string} field - Optional lifecycle field.
   * @returns {boolean} - Whether it is present.
   */
  const has = (field) => Object.prototype.hasOwnProperty.call(effect, field);
  const hasStartedBy = has('startedBy');
  const hasTerminal = has('terminal');
  const hasOutcomeRef = has('outcomeRef');
  const hasCancellation = has('cancellation');
  const hasUncertainty = has('uncertainty');
  const hasReconciliation = has('reconciliation');
  if (
    !Object.values(EffectStatus).includes(effect.status) ||
    (effect.status === EffectStatus.PENDING &&
      (hasStartedBy ||
        hasTerminal ||
        hasOutcomeRef ||
        hasCancellation ||
        hasUncertainty ||
        hasReconciliation)) ||
    (effect.status === EffectStatus.STARTED &&
      (!hasStartedBy ||
        hasTerminal ||
        hasOutcomeRef ||
        hasCancellation ||
        hasUncertainty ||
        hasReconciliation)) ||
    ([EffectStatus.COMPLETED, EffectStatus.FAILED].includes(effect.status) &&
      (!hasStartedBy ||
        !hasTerminal ||
        !hasOutcomeRef ||
        hasCancellation ||
        hasUncertainty)) ||
    (effect.status === EffectStatus.CANCELLED &&
      (hasStartedBy ||
        hasTerminal ||
        hasOutcomeRef ||
        !hasCancellation ||
        hasUncertainty ||
        hasReconciliation)) ||
    (effect.status === EffectStatus.UNCERTAIN &&
      (!hasStartedBy ||
        hasTerminal ||
        hasOutcomeRef ||
        hasCancellation ||
        !hasUncertainty ||
        hasReconciliation)) ||
    (effect.status === EffectStatus.NOT_APPLIED &&
      (!hasStartedBy ||
        hasTerminal ||
        hasOutcomeRef ||
        hasCancellation ||
        hasUncertainty ||
        !hasReconciliation))
  ) {
    throw new TypeError(
      'Application-state history effect has invalid lifecycle fields.',
    );
  }

  if (hasStartedBy) {
    effect.startedBy = normalizeAttemptBinding(
      effect.startedBy,
      'application-state history effect.startedBy',
      false,
    );
  }
  if (hasTerminal) {
    const terminal = cloneBoundedJsonObject(
      effect.terminal,
      EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
      'application-state history effect.terminal',
    );
    assertExactKeys(
      terminal,
      ['ok'],
      'application-state history effect.terminal',
    );
    if (
      typeof terminal.ok !== 'boolean' ||
      (effect.status === EffectStatus.COMPLETED) !== terminal.ok
    ) {
      throw new TypeError(
        'Application-state history effect terminal does not match its status.',
      );
    }
    effect.terminal = Object.freeze({ ok: terminal.ok });
  }
  if (hasOutcomeRef) {
    effect.outcomeRef = normalizePayloadReference(
      effect.outcomeRef,
      MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA,
      'application-state history effect.outcomeRef',
    );
  }
  if (hasReconciliation) {
    const reconciliation = cloneBoundedJsonObject(
      effect.reconciliation,
      EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
      'application-state history effect.reconciliation',
    );
    assertExactKeys(
      reconciliation,
      [
        'reconciliationId',
        'invocationId',
        'attemptId',
        'effectId',
        'generation',
        'coordinatorEpoch',
        'fencingToken',
        'uncertaintyEventId',
        'uncertaintySequence',
        'verifier',
        'evidenceRef',
        'resolutionStatus',
        'reason',
      ],
      'application-state history effect.reconciliation',
    );
    for (const field of [
      'reconciliationId',
      'invocationId',
      'attemptId',
      'effectId',
      'fencingToken',
      'uncertaintyEventId',
    ]) {
      assertLedgerOpaqueId(
        reconciliation[field],
        `application-state history effect.reconciliation.${field}`,
      );
    }
    assertPositiveSafeInteger(
      reconciliation.generation,
      'application-state history effect.reconciliation.generation',
    );
    assertNonnegativeSafeInteger(
      reconciliation.coordinatorEpoch,
      'application-state history effect.reconciliation.coordinatorEpoch',
    );
    assertPositiveSafeInteger(
      reconciliation.uncertaintySequence,
      'application-state history effect.reconciliation.uncertaintySequence',
    );
    normalizeEffectVerifierDescriptor(
      reconciliation.verifier,
      'application-state history effect.reconciliation.verifier',
    );
    const evidenceRef = normalizePayloadReference(
      reconciliation.evidenceRef,
      effect.status === EffectStatus.NOT_APPLIED
        ? MANAGED_EFFECT_RECONCILIATION_EVIDENCE_PAYLOAD_SCHEMA
        : MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA,
      'application-state history effect.reconciliation.evidenceRef',
    );
    if (
      reconciliation.invocationId !== effect.invocationId ||
      reconciliation.effectId !== effect.effectId ||
      reconciliation.attemptId !== effect.requestedBy.attemptId ||
      reconciliation.resolutionStatus !== effect.status ||
      (effect.status !== EffectStatus.NOT_APPLIED &&
        !hasSameCanonicalJson(evidenceRef, effect.outcomeRef))
    ) {
      throw new TypeError(
        'Application-state history effect reconciliation does not match its effect.',
      );
    }
    effect.reconciliation = deepFreezeJson({
      ...reconciliation,
      evidenceRef,
    });
  }
}

/**
 * Whether a retained contract claims any part of the built-in contract.
 * Partial claims fail validation instead of disappearing from the digest.
 * @param {Record<string, any> | undefined} contract - Candidate contract fields.
 * @returns {boolean} - Whether this contract must be included.
 */
function mentionsBuiltinApplicationState(contract) {
  return (
    contract?.adapter?.id === APPLICATION_STATE_ADAPTER_DESCRIPTOR.id ||
    contract?.destination?.kind === APPLICATION_STATE_CAPABILITY ||
    contract?.verifier?.kind === APPLICATION_STATE_VERIFIER_DESCRIPTOR.kind
  );
}

/**
 * Build one exact history entry from a verified built-in projection.
 * @param {unknown} candidate - Candidate rebuilt effect.
 * @param {Record<string, any>} run - Rebuilt parent run.
 * @param {string} appId - Requested application scope.
 * @returns {Readonly<Record<string, any>> | null} - Included entry or unrelated effect.
 */
function projectApplicationStateEffect(candidate, run, appId) {
  const effect = cloneBoundedJsonObject(
    candidate,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'application-state history effect',
  );
  if (!mentionsBuiltinApplicationState(effect)) return null;
  assertSnapshotKeys(
    effect,
    [...EFFECT_REQUIRED_FIELDS],
    [...EFFECT_OPTIONAL_FIELDS],
    'application-state history effect',
  );
  if (effect.schemaVersion !== EXECUTION_LEDGER_SCHEMA_VERSION) {
    throw new TypeError(
      'Application-state history effect uses an unsupported ledger schema.',
    );
  }
  const runId = assertLedgerOpaqueId(
    effect.runId,
    'application-state history effect.runId',
  );
  const invocationId = assertLedgerOpaqueId(
    effect.invocationId,
    'application-state history effect.invocationId',
  );
  const effectId = assertLedgerOpaqueId(
    effect.effectId,
    'application-state history effect.effectId',
  );
  assertLogicalId(effect.appId, 'application-state history effect.appId');
  assertApplicationRevisionId(
    effect.revisionId,
    'application-state history effect.revisionId',
  );
  assertLogicalId(
    effect.activityId,
    'application-state history effect.activityId',
  );
  const destinationEffectId = assertLedgerOpaqueId(
    effect.destinationEffectId,
    'application-state history effect.destinationEffectId',
  );
  if (
    runId !== run.runId ||
    effect.appId !== appId ||
    effect.revisionId !== run.revisionId ||
    destinationEffectId !==
      createManagedEffectDestinationId({
        appId,
        runId,
        invocationId,
        effectId,
      })
  ) {
    throw new TypeError(
      'Application-state history effect crossed its rebuilt run scope or identity.',
    );
  }
  normalizeBuiltinEffectContract(effect, appId);
  effect.requestRef = normalizePayloadReference(
    effect.requestRef,
    MANAGED_EFFECT_REQUEST_PAYLOAD_SCHEMA,
    'application-state history effect.requestRef',
  );
  effect.requestedBy = normalizeAttemptBinding(
    effect.requestedBy,
    'application-state history effect.requestedBy',
    true,
  );
  assertPositiveSafeInteger(
    effect.version,
    'application-state history effect.version',
  );
  assertPositiveSafeInteger(
    effect.lastSequence,
    'application-state history effect.lastSequence',
  );
  for (const field of ['createdAt', 'updatedAt']) {
    if (!Number.isFinite(effect[field]) || effect[field] < 0) {
      throw new TypeError(
        `application-state history effect.${field} must be a nonnegative finite number.`,
      );
    }
  }
  validateEffectLifecycle(effect);
  return deepFreezeJson({ kind: EFFECT_ENTRY_KIND, effect });
}

/**
 * Include an authorization-only application-state successor target.
 * @param {Record<string, any>} run - Rebuilt parent run.
 * @param {string} appId - Requested application scope.
 * @returns {Readonly<Record<string, any>> | null} - Included trigger or no successor.
 */
function projectApplicationStateSuccessor(run, appId) {
  if (run.trigger?.kind !== 'effect-successor') return null;
  const candidate = cloneBoundedJsonObject(
    run.trigger,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'application-state history successor',
  );
  if (!mentionsBuiltinApplicationState(candidate.contract)) return null;
  const authorization = normalizeManagedEffectSuccessorAuthorization(candidate);
  const destination = normalizeApplicationStateDestination(
    authorization.contract.destination,
  );
  if (
    !hasSameCanonicalJson(
      authorization.contract.adapter,
      APPLICATION_STATE_ADAPTER_DESCRIPTOR,
    ) ||
    !hasSameCanonicalJson(
      authorization.contract.verifier,
      APPLICATION_STATE_VERIFIER_DESCRIPTOR,
    ) ||
    !hasSameCanonicalJson(
      authorization.contract.substantiatedReplayProperties,
      APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
    ) ||
    destination.configuration.namespace !== appId ||
    authorization.target.runId !== run.runId ||
    authorization.target.revisionId !== run.revisionId
  ) {
    throw new TypeError(
      'Application-state history successor does not match the built-in application-state target.',
    );
  }
  return deepFreezeJson({
    kind: SUCCESSOR_ENTRY_KIND,
    authorization,
  });
}

/**
 * Create a deterministic collection order independent of ledger pagination.
 * @param {Readonly<Record<string, any>>[]} entries - Exact history entries.
 * @returns {Readonly<Record<string, any>>[]} - Canonically ordered entries.
 */
function orderHistoryEntries(entries) {
  return entries
    .map((entry) => ({
      entry,
      canonical: JSON.stringify(sortCanonicalJsonValue(entry)),
    }))
    .sort((left, right) =>
      compareCanonicalStrings(left.canonical, right.canonical),
    )
    .map(({ entry }) => entry);
}

/**
 * Validate one compact application-state history checkpoint summary.
 * The digest attests the hidden exact projection produced by inventory; this
 * boundary validates its strict envelope but cannot recreate omitted entries.
 * @param {unknown} value - Candidate summary.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {Readonly<{schemaVersion: 1, kind: 'applicationStateHistoryCheckpoint', appId: string, historyDigest: string, visitedRuns: number, applicationStateEffects: number, unsettledEffects: number}>} - Strict immutable summary.
 */
export function validateApplicationStateHistoryCheckpoint(
  value,
  label = 'application-state history checkpoint',
) {
  const summary = cloneBoundedJsonObject(value, 16 * 1024, label);
  assertExactKeys(
    summary,
    [
      'schemaVersion',
      'kind',
      'appId',
      'historyDigest',
      'visitedRuns',
      'applicationStateEffects',
      'unsettledEffects',
    ],
    label,
  );
  if (
    summary.schemaVersion !==
      APPLICATION_STATE_HISTORY_CHECKPOINT_SCHEMA_VERSION ||
    summary.kind !== APPLICATION_STATE_HISTORY_CHECKPOINT_KIND
  ) {
    throw new TypeError(
      `${label} must be ${APPLICATION_STATE_HISTORY_CHECKPOINT_KIND}@${APPLICATION_STATE_HISTORY_CHECKPOINT_SCHEMA_VERSION}.`,
    );
  }
  assertLogicalId(summary.appId, `${label}.appId`);
  assertDomainSeparatedSha256Id(
    summary.historyDigest,
    APPLICATION_STATE_HISTORY_DIGEST_PREFIX,
    `${label}.historyDigest`,
  );
  const visitedRuns = nonnegativeCount(
    summary.visitedRuns,
    `${label}.visitedRuns`,
  );
  const applicationStateEffects = nonnegativeCount(
    summary.applicationStateEffects,
    `${label}.applicationStateEffects`,
  );
  const unsettledEffects = nonnegativeCount(
    summary.unsettledEffects,
    `${label}.unsettledEffects`,
  );
  if (unsettledEffects > applicationStateEffects) {
    throw new TypeError(
      `${label}.unsettledEffects cannot exceed applicationStateEffects.`,
    );
  }
  return Object.freeze({
    schemaVersion: APPLICATION_STATE_HISTORY_CHECKPOINT_SCHEMA_VERSION,
    kind: APPLICATION_STATE_HISTORY_CHECKPOINT_KIND,
    appId: summary.appId,
    historyDigest: summary.historyDigest,
    visitedRuns,
    applicationStateEffects,
    unsettledEffects,
  });
}

/**
 * Require a validated checkpoint with no effect that could still write.
 * @param {unknown} value - Candidate history checkpoint.
 * @returns {ReturnType<typeof validateApplicationStateHistoryCheckpoint>} - Settled immutable checkpoint.
 */
export function assertSettledApplicationStateHistory(value) {
  const summary = validateApplicationStateHistoryCheckpoint(value);
  if (summary.unsettledEffects !== 0) {
    throw new Error(
      `Application-state history contains ${summary.unsettledEffects} unsettled effect(s).`,
    );
  }
  return summary;
}

/**
 * Inventory every verified run and bind all built-in application-state effect
 * projections plus authorization-only successor targets into one digest.
 * @param {{ledger: Pick<import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, 'listRuns'|'rebuildRun'>, appId: string, signal?: AbortSignal}} options - Complete verified history scope.
 * @returns {Promise<ReturnType<typeof validateApplicationStateHistoryCheckpoint>>} - Immutable strict checkpoint summary.
 */
export async function inventoryApplicationStateHistory(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Application-state history inventory requires options.',
    );
  }
  const allowedOptions = new Set(['ledger', 'appId', 'signal']);
  if (Object.keys(options).some((key) => !allowedOptions.has(key))) {
    throw new TypeError(
      'Application-state history inventory options contain unsupported fields.',
    );
  }
  const appId = options.appId;
  assertLogicalId(appId, 'application-state history appId');
  /** @type {Readonly<Record<string, any>>[]} */
  const entries = [];
  const effectIdentities = new Set();
  let applicationStateEffects = 0;
  let unsettledEffects = 0;

  const inventory = await visitExecutionLedgerHistory({
    ledger: options.ledger,
    appId,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    visit: ({ view }) => {
      if (!Array.isArray(view.effects)) {
        throw new TypeError(
          'Application-state history could not rebuild an exact effects array.',
        );
      }
      for (const candidate of view.effects) {
        const entry = projectApplicationStateEffect(candidate, view.run, appId);
        if (!entry) continue;
        const effect = entry.effect;
        const identity = JSON.stringify([
          effect.runId,
          effect.invocationId,
          effect.effectId,
        ]);
        if (effectIdentities.has(identity)) {
          throw new TypeError(
            'Application-state history repeated an effect identity.',
          );
        }
        effectIdentities.add(identity);
        entries.push(entry);
        applicationStateEffects += 1;
        if (UNSETTLED_EFFECT_STATUSES.has(effect.status)) {
          unsettledEffects += 1;
        }
      }
      const successor = projectApplicationStateSuccessor(view.run, appId);
      if (successor) entries.push(successor);
    },
  });

  const orderedEntries = orderHistoryEntries(entries);
  const historyDigest = createCanonicalJsonSha256Id({
    domain: APPLICATION_STATE_HISTORY_DIGEST_DOMAIN,
    prefix: APPLICATION_STATE_HISTORY_DIGEST_PREFIX,
    value: {
      schemaVersion: APPLICATION_STATE_HISTORY_CHECKPOINT_SCHEMA_VERSION,
      kind: 'applicationStateHistory',
      appId,
      visitedRuns: inventory.visitedRuns,
      applicationStateEffects,
      unsettledEffects,
      entries: orderedEntries,
    },
    valuePath: 'application-state history projection',
  });
  return validateApplicationStateHistoryCheckpoint({
    schemaVersion: APPLICATION_STATE_HISTORY_CHECKPOINT_SCHEMA_VERSION,
    kind: APPLICATION_STATE_HISTORY_CHECKPOINT_KIND,
    appId,
    historyDigest,
    visitedRuns: inventory.visitedRuns,
    applicationStateEffects,
    unsettledEffects,
  });
}

export default {
  APPLICATION_STATE_HISTORY_CHECKPOINT_KIND,
  APPLICATION_STATE_HISTORY_CHECKPOINT_SCHEMA_VERSION,
  APPLICATION_STATE_HISTORY_DIGEST_DOMAIN,
  APPLICATION_STATE_HISTORY_DIGEST_PREFIX,
  assertSettledApplicationStateHistory,
  inventoryApplicationStateHistory,
  validateApplicationStateHistoryCheckpoint,
};
