import { createCanonicalJsonSha256Id } from '../../runtime/content-id.js';
import { cloneJsonObject } from '../../runtime/json-value.js';
import { assertLogicalId } from '../../runtime/logical-id.js';
import { assertApplicationRevisionId } from '../../runtime/application-revision.js';
import {
  createManagedEffectDestinationId,
  normalizeEffectAdapterDescriptor,
  normalizeEffectDestinationDescriptor,
  normalizeEffectVerifierDescriptor,
  normalizeManagedEffectRequest,
  normalizeReplayProperties,
} from './execution-ledger-contract.js';
import { assertLedgerOpaqueId } from './record-key.js';

export const MANAGED_EFFECT_SUCCESSOR_INTENT = 'retry';
export const MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID = 'wharfie-effect-successor';
export const MANAGED_EFFECT_SUCCESSOR_POLICY = Object.freeze({
  kind: 'application-state-put-if-absent-not-applied-retry',
  version: 1,
});
const INITIAL_ADAPTER = Object.freeze({
  id: 'application-state-put-if-absent',
  version: 2,
});
const INITIAL_VERIFIER = Object.freeze({
  kind: 'application-state-put-if-absent-receipt',
  version: 2,
});
const INITIAL_RECONCILIATION_VERIFIER = Object.freeze({
  kind: 'application-state-put-if-absent-not-applied',
  version: 2,
});
const INITIAL_REPLAY_PROPERTIES = Object.freeze([
  'idempotent',
  'transactional',
]);

/**
 * @param {unknown} left - JSON value.
 * @param {unknown} right - JSON value.
 * @returns {boolean} - Canonical equality.
 */
function sameJson(left, right) {
  const digest = (/** @type {unknown} */ value) =>
    createCanonicalJsonSha256Id({
      domain: 'wharfie:managed-effect-successor-comparison:v1',
      prefix: 'wsx',
      value,
      valuePath: 'managed effect successor comparison',
    });
  return digest(left) === digest(right);
}

/**
 * @param {unknown} value - Candidate positive integer.
 * @param {string} label - Human-readable value path.
 * @returns {number} - Validated integer.
 */
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

/**
 * @param {unknown} value - Candidate exact successor policy descriptor.
 * @returns {{kind: string, version: number}} - Canonical supported policy.
 */
export function normalizeManagedEffectSuccessorPolicy(value) {
  const policy = cloneJsonObject(value, 'managed effect successor policy');
  if (
    Object.keys(policy).length !== 2 ||
    policy.kind !== MANAGED_EFFECT_SUCCESSOR_POLICY.kind ||
    policy.version !== MANAGED_EFFECT_SUCCESSOR_POLICY.version
  ) {
    throw new TypeError(
      `managed effect successor policy must be ${MANAGED_EFFECT_SUCCESSOR_POLICY.kind}@${MANAGED_EFFECT_SUCCESSOR_POLICY.version}.`,
    );
  }
  return { ...MANAGED_EFFECT_SUCCESSOR_POLICY };
}

/**
 * Prove the only fresh-identity retry supported by the initial finite policy.
 * Generic replay labels never call this policy into existence: every adapter,
 * destination, verifier, reconciliation verifier, operation, and property is
 * pinned explicitly.
 * @param {{effect: Record<string, any>, request: Record<string, any>}} input - Verified source delivery.
 * @returns {void}
 */
export function assertInitialManagedEffectSuccessorRetryEligible(input) {
  const effect = cloneJsonObject(
    input.effect,
    'managed effect successor source effect',
  );
  const request = normalizeManagedEffectRequest(
    input.request,
    'managed effect successor source request',
  );
  if (
    !sameJson(effect.adapter, INITIAL_ADAPTER) ||
    effect.destination?.kind !== 'application-state' ||
    effect.destination?.version !== 2 ||
    effect.destination?.bindingId !== 'primary' ||
    !sameJson(effect.verifier, INITIAL_VERIFIER) ||
    !sameJson(
      effect.reconciliation?.verifier,
      INITIAL_RECONCILIATION_VERIFIER,
    ) ||
    !sameJson(
      effect.substantiatedReplayProperties,
      INITIAL_REPLAY_PROPERTIES,
    ) ||
    request.capability !== 'application-state' ||
    request.operation !== 'put-if-absent' ||
    !sameJson(request.requestedReplayProperties, INITIAL_REPLAY_PROPERTIES)
  ) {
    throw new Error(
      'The reconciled effect is not eligible for the application-state not-applied retry policy.',
    );
  }
}

/**
 * @param {unknown} value - Candidate immutable source lineage.
 * @returns {Record<string, any>} - Canonical source lineage.
 */
export function normalizeManagedEffectSuccessorSource(value) {
  const source = cloneJsonObject(value, 'managed effect successor source');
  const keys = [
    'runId',
    'invocationId',
    'attemptId',
    'effectId',
    'uncertaintyEventId',
    'uncertaintySequence',
    'reconciliationEventId',
    'reconciliationSequence',
    'reconciliationId',
    'disposition',
  ];
  if (
    Object.keys(source).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(source, key))
  ) {
    throw new TypeError(
      `managed effect successor source must contain exactly ${keys.join(', ')}.`,
    );
  }
  const disposition = source.disposition;
  if (disposition !== 'NOT_APPLIED') {
    throw new TypeError(
      'managed effect successor source disposition must be NOT_APPLIED for the initial retry policy.',
    );
  }
  return {
    runId: assertLedgerOpaqueId(source.runId, 'successor source runId'),
    invocationId: assertLedgerOpaqueId(
      source.invocationId,
      'successor source invocationId',
    ),
    attemptId: assertLedgerOpaqueId(
      source.attemptId,
      'successor source attemptId',
    ),
    effectId: assertLedgerOpaqueId(
      source.effectId,
      'successor source effectId',
    ),
    uncertaintyEventId: assertLedgerOpaqueId(
      source.uncertaintyEventId,
      'successor source uncertaintyEventId',
    ),
    uncertaintySequence: positiveInteger(
      source.uncertaintySequence,
      'successor source uncertaintySequence',
    ),
    reconciliationEventId: assertLedgerOpaqueId(
      source.reconciliationEventId,
      'successor source reconciliationEventId',
    ),
    reconciliationSequence: positiveInteger(
      source.reconciliationSequence,
      'successor source reconciliationSequence',
    ),
    reconciliationId: assertLedgerOpaqueId(
      source.reconciliationId,
      'successor source reconciliationId',
    ),
    disposition,
  };
}

/**
 * @param {unknown} value - Candidate immutable successor target.
 * @returns {Record<string, any>} - Canonical target identity.
 */
export function normalizeManagedEffectSuccessorTarget(value) {
  const target = cloneJsonObject(value, 'managed effect successor target');
  const keys = [
    'runId',
    'invocationId',
    'effectId',
    'destinationEffectId',
    'revisionId',
    'requestDigest',
  ];
  if (
    Object.keys(target).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(target, key))
  ) {
    throw new TypeError(
      `managed effect successor target must contain exactly ${keys.join(', ')}.`,
    );
  }
  assertApplicationRevisionId(target.revisionId, 'successor target revisionId');
  return {
    runId: assertLedgerOpaqueId(target.runId, 'successor target runId'),
    invocationId: assertLedgerOpaqueId(
      target.invocationId,
      'successor target invocationId',
    ),
    effectId: assertLedgerOpaqueId(
      target.effectId,
      'successor target effectId',
    ),
    destinationEffectId: assertLedgerOpaqueId(
      target.destinationEffectId,
      'successor target destinationEffectId',
    ),
    revisionId: target.revisionId,
    requestDigest: assertLedgerOpaqueId(
      target.requestDigest,
      'successor target requestDigest',
    ),
  };
}

/**
 * @param {unknown} value - Candidate pinned successor effect contract.
 * @returns {Record<string, any>} - Canonical effect contract.
 */
export function normalizeManagedEffectSuccessorContract(value) {
  const contract = cloneJsonObject(value, 'managed effect successor contract');
  const keys = [
    'adapter',
    'destination',
    'verifier',
    'substantiatedReplayProperties',
  ];
  if (
    Object.keys(contract).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(contract, key))
  ) {
    throw new TypeError(
      `managed effect successor contract must contain exactly ${keys.join(', ')}.`,
    );
  }
  return {
    adapter: normalizeEffectAdapterDescriptor(
      contract.adapter,
      'managed effect successor contract.adapter',
    ),
    destination: normalizeEffectDestinationDescriptor(
      contract.destination,
      'managed effect successor contract.destination',
    ),
    verifier: normalizeEffectVerifierDescriptor(
      contract.verifier,
      'managed effect successor contract.verifier',
    ),
    substantiatedReplayProperties: normalizeReplayProperties(
      contract.substantiatedReplayProperties,
      'managed effect successor contract.substantiatedReplayProperties',
    ),
  };
}

/**
 * @param {unknown} value - Candidate immutable authorization/trigger.
 * @returns {Record<string, any>} - Canonical authorization.
 */
export function normalizeManagedEffectSuccessorAuthorization(value) {
  const authorization = cloneJsonObject(
    value,
    'managed effect successor authorization',
  );
  const keys = [
    'kind',
    'intent',
    'successorId',
    'slotId',
    'policy',
    'reason',
    'source',
    'contract',
    'target',
  ];
  if (
    Object.keys(authorization).length !== keys.length ||
    keys.some(
      (key) => !Object.prototype.hasOwnProperty.call(authorization, key),
    ) ||
    authorization.kind !== 'effect-successor' ||
    authorization.intent !== MANAGED_EFFECT_SUCCESSOR_INTENT
  ) {
    throw new TypeError(
      `managed effect successor authorization must be the exact ${MANAGED_EFFECT_SUCCESSOR_INTENT} shape.`,
    );
  }
  const normalized = {
    kind: 'effect-successor',
    intent: MANAGED_EFFECT_SUCCESSOR_INTENT,
    successorId: assertLedgerOpaqueId(authorization.successorId, 'successorId'),
    slotId: assertLedgerOpaqueId(authorization.slotId, 'successor slotId'),
    policy: normalizeManagedEffectSuccessorPolicy(authorization.policy),
    reason: cloneJsonObject(
      authorization.reason,
      'managed effect successor reason',
    ),
    source: normalizeManagedEffectSuccessorSource(authorization.source),
    contract: normalizeManagedEffectSuccessorContract(authorization.contract),
    target: normalizeManagedEffectSuccessorTarget(authorization.target),
  };
  const sourceIdentities = new Set([
    normalized.source.runId,
    normalized.source.invocationId,
    normalized.source.effectId,
  ]);
  const targetIdentities = [
    normalized.target.runId,
    normalized.target.invocationId,
    normalized.target.effectId,
    normalized.target.destinationEffectId,
  ];
  if (
    new Set(targetIdentities).size !== targetIdentities.length ||
    targetIdentities.some((identity) => sourceIdentities.has(identity))
  ) {
    throw new TypeError(
      'managed effect successor target identities must be fresh and mutually distinct.',
    );
  }
  return normalized;
}

/**
 * @param {Record<string, any>} request - Verified logical managed-effect request.
 * @returns {string} - Content-bound private request digest.
 */
export function createManagedEffectSuccessorRequestDigest(request) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:managed-effect-successor-request:v1',
    prefix: 'wsq',
    value: cloneJsonObject(request, 'managed effect successor request'),
    valuePath: 'managed effect successor request',
  });
}

/**
 * @param {{appId: string, revisionId: string, successorId: string, reason: Record<string, any>, source: Record<string, any>, contract: Record<string, any>, request: Record<string, any>}} options - Verified successor inputs.
 * @returns {Record<string, any>} - Complete deterministic authorization.
 */
export function createManagedEffectSuccessorAuthorization(options) {
  assertLogicalId(options.appId, 'managed effect successor appId');
  assertApplicationRevisionId(
    options.revisionId,
    'managed effect successor revisionId',
  );
  const revisionId = options.revisionId;
  const successorId = assertLedgerOpaqueId(options.successorId, 'successorId');
  const source = normalizeManagedEffectSuccessorSource(options.source);
  const contract = normalizeManagedEffectSuccessorContract(options.contract);
  const policy = { ...MANAGED_EFFECT_SUCCESSOR_POLICY };
  const slotId = createCanonicalJsonSha256Id({
    domain: 'wharfie:managed-effect-successor-slot:v1',
    prefix: 'wss',
    value: {
      appId: options.appId,
      intent: MANAGED_EFFECT_SUCCESSOR_INTENT,
      policy,
      source: {
        runId: source.runId,
        effectId: source.effectId,
        reconciliationEventId: source.reconciliationEventId,
      },
    },
    valuePath: 'managed effect successor slot',
  });
  const requestDigest = createManagedEffectSuccessorRequestDigest(
    options.request,
  );
  const runId = createCanonicalJsonSha256Id({
    domain: 'wharfie:managed-effect-successor-run:v1',
    prefix: 'wsr',
    value: { appId: options.appId, successorId, slotId, requestDigest },
    valuePath: 'managed effect successor run',
  });
  const invocationId = createCanonicalJsonSha256Id({
    domain: 'wharfie:managed-effect-successor-invocation:v1',
    prefix: 'wsi',
    value: { runId, successorId },
    valuePath: 'managed effect successor invocation',
  });
  const effectId = createCanonicalJsonSha256Id({
    domain: 'wharfie:managed-effect-successor-effect:v1',
    prefix: 'wse',
    value: { runId, invocationId, successorId, requestDigest },
    valuePath: 'managed effect successor effect',
  });
  const destinationEffectId = createManagedEffectDestinationId({
    appId: options.appId,
    runId,
    invocationId,
    effectId,
  });
  return normalizeManagedEffectSuccessorAuthorization({
    kind: 'effect-successor',
    intent: MANAGED_EFFECT_SUCCESSOR_INTENT,
    successorId,
    slotId,
    policy,
    reason: cloneJsonObject(options.reason, 'managed effect successor reason'),
    source,
    contract,
    target: {
      runId,
      invocationId,
      effectId,
      destinationEffectId,
      revisionId,
      requestDigest,
    },
  });
}

/**
 * Re-derive every policy, slot, target, and destination identity from the
 * immutable semantic inputs and require an exact retained authorization. This
 * is the fold-time corruption boundary; normalization alone only proves that
 * an authorization has a well-formed shape.
 * @param {{appId: string, revisionId: string, request: Record<string, any>, authorization: Record<string, any>}} options - Folded semantic inputs.
 * @returns {Record<string, any>} - Canonical exact authorization.
 */
export function assertManagedEffectSuccessorAuthorizationDerived(options) {
  const authorization = normalizeManagedEffectSuccessorAuthorization(
    options.authorization,
  );
  const expected = createManagedEffectSuccessorAuthorization({
    appId: options.appId,
    revisionId: options.revisionId,
    successorId: authorization.successorId,
    reason: authorization.reason,
    source: authorization.source,
    contract: authorization.contract,
    request: options.request,
  });
  if (!sameJson(authorization, expected)) {
    throw new TypeError(
      'managed effect successor authorization is not derived from its retained semantic inputs.',
    );
  }
  return authorization;
}

export default {
  MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID,
  MANAGED_EFFECT_SUCCESSOR_INTENT,
  MANAGED_EFFECT_SUCCESSOR_POLICY,
  assertInitialManagedEffectSuccessorRetryEligible,
  assertManagedEffectSuccessorAuthorizationDerived,
  createManagedEffectSuccessorAuthorization,
  createManagedEffectSuccessorRequestDigest,
  normalizeManagedEffectSuccessorAuthorization,
  normalizeManagedEffectSuccessorContract,
  normalizeManagedEffectSuccessorPolicy,
  normalizeManagedEffectSuccessorSource,
  normalizeManagedEffectSuccessorTarget,
};
