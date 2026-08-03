/* eslint-disable jsdoc/require-param, jsdoc/require-returns -- Internal exact-schema helpers keep their types compact. */

import {
  createApplicationStateBusinessKey,
  createApplicationStateBusinessRecord,
  createApplicationStateNotAppliedResolutionRecord,
  createApplicationStateReceiptRecord,
  validateApplicationStateNotAppliedResolutionRecord,
} from '../../lib/db/tables/application-state.js';
import { APPLICATION_STATE_TABLE_NAME } from '../../lib/config/db.js';
import { createManagedEffectDestinationId } from '../../lib/ledger/execution-ledger-contract.js';
import { assertLedgerOpaqueId } from '../../lib/ledger/record-key.js';
import { validateActivityProtocolComponentFrame } from '../activity-protocol.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../content-id.js';
import { cloneBoundedJsonObject, cloneJsonObject } from '../json-value.js';
import { assertLogicalId } from '../logical-id.js';

export const APPLICATION_STATE_CAPABILITY = 'application-state';
export const APPLICATION_STATE_PUT_IF_ABSENT_OPERATION = 'put-if-absent';
export const APPLICATION_STATE_BINDING_ID = 'primary';
export const APPLICATION_STATE_MAX_INPUT_BYTES = 256 * 1024;
export const APPLICATION_STATE_MAX_KEY_BYTES = 512;

export const APPLICATION_STATE_ADAPTER_DESCRIPTOR = Object.freeze({
  id: 'application-state-put-if-absent',
  version: 2,
});
export const APPLICATION_STATE_VERIFIER_DESCRIPTOR = Object.freeze({
  kind: 'application-state-put-if-absent-receipt',
  version: 2,
});
export const APPLICATION_STATE_RECONCILIATION_VERIFIER_DESCRIPTOR =
  Object.freeze({
    kind: 'application-state-put-if-absent-not-applied',
    version: 2,
  });
export const APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES = Object.freeze([
  'idempotent',
  'transactional',
]);

const EVIDENCE_KIND = 'application-state-put-if-absent-receipt';
const EVIDENCE_VERSION = 2;
const NOT_APPLIED_EVIDENCE_KIND =
  APPLICATION_STATE_RECONCILIATION_VERIFIER_DESCRIPTOR.kind;
const NOT_APPLIED_DISPOSITION = 'not-applied';

/** @param {Record<string, any>} value - Candidate exact object. @param {string[]} expected - Exact keys. @param {string} label - Boundary label. */
function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (
    actual.length !== canonical.length ||
    actual.some((key, index) => key !== canonical[index])
  ) {
    throw new TypeError(
      `${label} must contain exactly ${expected.join(', ')}.`,
    );
  }
}

/** @param {any} value - JSON value. @returns {any} - Recursively frozen value. */
function deepFreezeJson(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
}

/** @param {unknown} left - Strict JSON. @param {unknown} right - Strict JSON. @returns {boolean} - Canonical equality. */
function hasSameCanonicalJson(left, right) {
  const digest = (/** @type {unknown} */ value) =>
    createCanonicalJsonSha256Id({
      domain: 'wharfie:application-state:comparison:v2',
      prefix: 'wax',
      value,
      valuePath: 'application-state comparison',
    });
  return digest(left) === digest(right);
}

/**
 * Validate the only public logical request supported by the first catalog.
 * Validation runs before the ledger marks an effect STARTED.
 * @param {unknown} value - Candidate Activity Protocol effect request.
 * @param {string} [label] - Boundary label.
 * @returns {Readonly<{frame: Readonly<Record<string, any>>, input: Readonly<{key: string, value: any}>}>} - Strict request.
 */
export function normalizeApplicationStatePutIfAbsentRequest(
  value,
  label = 'application-state effect request',
) {
  const frame = validateActivityProtocolComponentFrame(value, label);
  if (
    frame.type !== 'effect-request' ||
    frame.capability !== APPLICATION_STATE_CAPABILITY ||
    frame.operation !== APPLICATION_STATE_PUT_IF_ABSENT_OPERATION
  ) {
    throw new TypeError(
      `${label} must request application-state/put-if-absent.`,
    );
  }
  if (
    frame.requestedReplayProperties.length !==
      APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES.length ||
    frame.requestedReplayProperties.some(
      (/** @type {string} */ property, /** @type {number} */ index) =>
        property !== APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES[index],
    )
  ) {
    throw new TypeError(
      `${label}.requestedReplayProperties must be exactly idempotent, transactional.`,
    );
  }
  const input = cloneBoundedJsonObject(
    frame.input,
    APPLICATION_STATE_MAX_INPUT_BYTES,
    `${label}.input`,
  );
  assertExactKeys(input, ['key', 'value'], `${label}.input`);
  if (
    typeof input.key !== 'string' ||
    input.key.length === 0 ||
    Buffer.byteLength(input.key, 'utf8') > APPLICATION_STATE_MAX_KEY_BYTES
  ) {
    throw new TypeError(
      `${label}.input.key must be a non-empty string no larger than ${APPLICATION_STATE_MAX_KEY_BYTES} UTF-8 bytes.`,
    );
  }
  return deepFreezeJson({ frame, input });
}

/**
 * Validate the credential-free host-owned destination retained in the ledger.
 * @param {unknown} value - Candidate destination.
 * @returns {Readonly<{kind: 'application-state', version: 2, bindingId: 'primary', configuration: {provider: 'lmdb'|'vanilla', storeId: string, tableName: 'wharfie-application-state-v2', namespace: string}}>} - Exact destination.
 */
export function normalizeApplicationStateDestination(value) {
  const destination = cloneJsonObject(value, 'application-state destination');
  assertExactKeys(
    destination,
    ['kind', 'version', 'bindingId', 'configuration'],
    'application-state destination',
  );
  const configuration = cloneJsonObject(
    destination.configuration,
    'application-state destination.configuration',
  );
  assertExactKeys(
    configuration,
    ['provider', 'storeId', 'tableName', 'namespace'],
    'application-state destination.configuration',
  );
  if (
    destination.kind !== APPLICATION_STATE_CAPABILITY ||
    destination.version !== 2 ||
    destination.bindingId !== APPLICATION_STATE_BINDING_ID ||
    (configuration.provider !== 'lmdb' &&
      configuration.provider !== 'vanilla') ||
    configuration.tableName !== APPLICATION_STATE_TABLE_NAME
  ) {
    throw new TypeError('application-state destination is not supported.');
  }
  assertDomainSeparatedSha256Id(
    configuration.storeId,
    'was',
    'application-state destination storeId',
  );
  assertLogicalId(
    configuration.namespace,
    'application-state destination namespace',
  );
  return deepFreezeJson({
    kind: APPLICATION_STATE_CAPABILITY,
    version: 2,
    bindingId: APPLICATION_STATE_BINDING_ID,
    configuration,
  });
}

/** @param {unknown} value - Candidate stable effect identity. @returns {Readonly<{runId: string, invocationId: string, effectId: string}>} - Verifier-visible identity. */
function normalizeContractIdentity(value) {
  const identity = cloneJsonObject(value, 'application-state effect identity');
  assertExactKeys(
    identity,
    ['runId', 'invocationId', 'effectId'],
    'application-state effect identity',
  );
  for (const key of ['runId', 'invocationId', 'effectId']) {
    if (!Object.prototype.hasOwnProperty.call(identity, key)) {
      throw new TypeError(
        `application-state effect identity.${key} is required.`,
      );
    }
  }
  return Object.freeze({
    runId: assertLedgerOpaqueId(identity.runId, 'application-state runId'),
    invocationId: assertLedgerOpaqueId(
      identity.invocationId,
      'application-state invocationId',
    ),
    effectId: assertLedgerOpaqueId(
      identity.effectId,
      'application-state effectId',
    ),
  });
}

/**
 * Bind the receipt to every immutable logical and physical destination input.
 * @param {{destinationEffectId: string, identity: {runId: string, invocationId: string, effectId: string}, destination: Record<string, any>, request: Record<string, any>}} options - Exact contract.
 * @returns {string} - Canonical wac digest.
 */
export function createApplicationStateEffectContractDigest(options) {
  const destinationEffectId = assertLedgerOpaqueId(
    options.destinationEffectId,
    'application-state destinationEffectId',
  );
  const identity = normalizeContractIdentity(options.identity);
  const destination = normalizeApplicationStateDestination(options.destination);
  const request = normalizeApplicationStatePutIfAbsentRequest(
    options.request,
  ).frame;
  if (request.effectId !== identity.effectId) {
    throw new TypeError(
      'Application-state request effectId must match its logical effect identity.',
    );
  }
  const expectedDestinationEffectId = createManagedEffectDestinationId({
    appId: destination.configuration.namespace,
    runId: identity.runId,
    invocationId: identity.invocationId,
    effectId: identity.effectId,
  });
  if (destinationEffectId !== expectedDestinationEffectId) {
    throw new TypeError(
      'Application-state destinationEffectId does not match its app and logical effect identity.',
    );
  }
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:application-state:effect-contract:v2',
    prefix: 'wac',
    value: {
      schemaVersion: 2,
      destinationEffectId,
      identity,
      adapter: APPLICATION_STATE_ADAPTER_DESCRIPTOR,
      destination,
      verifier: APPLICATION_STATE_VERIFIER_DESCRIPTOR,
      request: {
        capability: request.capability,
        operation: request.operation,
        input: request.input,
        requestedReplayProperties: request.requestedReplayProperties,
      },
      substantiatedReplayProperties:
        APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
    },
    valuePath: 'application-state effect contract',
  });
}

/** @param {Readonly<Record<string, any>>} receipt - Verified physical receipt. @returns {Readonly<Record<string, any>>} - Ledger outcome. */
export function createApplicationStateOutcomeFromReceipt(receipt) {
  return deepFreezeJson({
    ok: true,
    result: { inserted: receipt.inserted },
    evidence: {
      kind: EVIDENCE_KIND,
      version: EVIDENCE_VERSION,
      destinationEffectId: receipt.destination_effect_id,
      contractDigest: receipt.contract_digest,
      receiptDigest: receipt.receipt_digest,
      businessRecordDigest: receipt.business_record_digest,
      disposition: receipt.outcome_code,
    },
  });
}

/** @param {Readonly<Record<string, any>>} resolution - Verified physical resolution. @returns {Readonly<Record<string, any>>} - Ledger reconciliation evidence. */
export function createApplicationStateNotAppliedEvidence(resolution) {
  const verified =
    validateApplicationStateNotAppliedResolutionRecord(resolution);
  return deepFreezeJson({
    kind: NOT_APPLIED_EVIDENCE_KIND,
    version: EVIDENCE_VERSION,
    destinationEffectId: verified.destination_effect_id,
    contractDigest: verified.contract_digest,
    resolutionDigest: verified.resolution_digest,
    businessObservation: verified.business_observation,
    disposition: NOT_APPLIED_DISPOSITION,
  });
}

/**
 * Pure synchronous verifier installed for every ledger open, including
 * read-only inspection. It proves self-consistency with the trusted adapter
 * contract; physical receipt lookup belongs to catalog recovery.
 * @param {Record<string, any>} input - Frozen ledger verifier input.
 * @returns {boolean} - Whether exact evidence substantiates the outcome.
 */
export function verifyApplicationStatePutIfAbsentOutcome(input) {
  try {
    const effect = cloneJsonObject(input.effect, 'verifier effect');
    const outcome = cloneJsonObject(input.outcome, 'verifier outcome');
    const normalizedRequest = normalizeApplicationStatePutIfAbsentRequest({
      protocol: 'wharfie.activity',
      protocolVersion: 1,
      type: 'effect-request',
      attemptId: 'application-state-verifier',
      sequence: 1,
      effectId: effect.effectId,
      capability: input.request?.capability,
      operation: input.request?.operation,
      input: input.request?.input,
      requestedReplayProperties: input.request?.requestedReplayProperties,
    });
    const destination = normalizeApplicationStateDestination(
      effect.destination,
    );
    if (
      !hasSameCanonicalJson(
        effect.adapter,
        APPLICATION_STATE_ADAPTER_DESCRIPTOR,
      ) ||
      !hasSameCanonicalJson(
        effect.verifier,
        APPLICATION_STATE_VERIFIER_DESCRIPTOR,
      ) ||
      !hasSameCanonicalJson(
        effect.substantiatedReplayProperties,
        APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
      ) ||
      outcome.ok !== true
    ) {
      return false;
    }
    assertExactKeys(outcome.result, ['inserted'], 'verifier outcome.result');
    if (typeof outcome.result.inserted !== 'boolean') return false;
    const evidence = cloneJsonObject(
      outcome.evidence,
      'verifier outcome.evidence',
    );
    assertExactKeys(
      evidence,
      [
        'kind',
        'version',
        'destinationEffectId',
        'contractDigest',
        'receiptDigest',
        'businessRecordDigest',
        'disposition',
      ],
      'verifier outcome.evidence',
    );
    if (
      evidence.kind !== EVIDENCE_KIND ||
      evidence.version !== EVIDENCE_VERSION ||
      evidence.destinationEffectId !== effect.destinationEffectId ||
      evidence.disposition !==
        (outcome.result.inserted ? 'inserted' : 'already-present')
    ) {
      return false;
    }
    for (const [value, prefix, label] of [
      [evidence.contractDigest, 'wac', 'contractDigest'],
      [evidence.receiptDigest, 'wap', 'receiptDigest'],
      [evidence.businessRecordDigest, 'war', 'businessRecordDigest'],
    ]) {
      assertDomainSeparatedSha256Id(value, prefix, label);
    }
    const contractDigest = createApplicationStateEffectContractDigest({
      destinationEffectId: effect.destinationEffectId,
      identity: {
        runId: effect.runId,
        invocationId: effect.invocationId,
        effectId: effect.effectId,
      },
      destination,
      request: normalizedRequest.frame,
    });
    if (evidence.contractDigest !== contractDigest) return false;

    const businessKey = createApplicationStateBusinessKey(
      destination.configuration.namespace,
      normalizedRequest.input.key,
    );
    if (outcome.result.inserted) {
      const expectedBusiness = createApplicationStateBusinessRecord({
        storeId: destination.configuration.storeId,
        namespace: destination.configuration.namespace,
        key: normalizedRequest.input.key,
        value: normalizedRequest.input.value,
        destinationEffectId: effect.destinationEffectId,
        contractDigest,
      });
      if (evidence.businessRecordDigest !== expectedBusiness.record_digest) {
        return false;
      }
    }
    const expectedReceipt = createApplicationStateReceiptRecord({
      destinationEffectId: effect.destinationEffectId,
      contractDigest,
      businessRecord: {
        resource_id: businessKey.resourceId,
        sort_key: businessKey.sortKey,
        store_id: destination.configuration.storeId,
        record_digest: evidence.businessRecordDigest,
      },
      inserted: outcome.result.inserted,
    });
    return evidence.receiptDigest === expectedReceipt.receipt_digest;
  } catch {
    return false;
  }
}

/**
 * Pure synchronous verifier for one permanent destination-side not-applied
 * resolution. It binds the evidence to the same immutable effect, request,
 * and physical destination contract used by normal execution.
 * @param {Record<string, any>} input - Frozen reconciliation verifier input.
 * @returns {boolean} - Whether exact evidence substantiates not-applied.
 */
export function verifyApplicationStatePutIfAbsentNotAppliedEvidence(input) {
  try {
    const effect = cloneJsonObject(input.effect, 'reconciliation effect');
    const evidence = cloneJsonObject(input.evidence, 'reconciliation evidence');
    const normalizedRequest = normalizeApplicationStatePutIfAbsentRequest({
      protocol: 'wharfie.activity',
      protocolVersion: 1,
      type: 'effect-request',
      attemptId: 'application-state-reconciliation-verifier',
      sequence: 1,
      effectId: effect.effectId,
      capability: input.request?.capability,
      operation: input.request?.operation,
      input: input.request?.input,
      requestedReplayProperties: input.request?.requestedReplayProperties,
    });
    const destination = normalizeApplicationStateDestination(
      effect.destination,
    );
    if (
      !hasSameCanonicalJson(
        effect.adapter,
        APPLICATION_STATE_ADAPTER_DESCRIPTOR,
      ) ||
      !hasSameCanonicalJson(
        effect.verifier,
        APPLICATION_STATE_VERIFIER_DESCRIPTOR,
      ) ||
      !hasSameCanonicalJson(
        effect.substantiatedReplayProperties,
        APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
      )
    ) {
      return false;
    }
    assertExactKeys(
      evidence,
      [
        'kind',
        'version',
        'destinationEffectId',
        'contractDigest',
        'resolutionDigest',
        'businessObservation',
        'disposition',
      ],
      'reconciliation evidence',
    );
    if (
      evidence.kind !== NOT_APPLIED_EVIDENCE_KIND ||
      evidence.version !== EVIDENCE_VERSION ||
      evidence.destinationEffectId !== effect.destinationEffectId ||
      evidence.disposition !== NOT_APPLIED_DISPOSITION
    ) {
      return false;
    }
    assertDomainSeparatedSha256Id(
      evidence.contractDigest,
      'wac',
      'reconciliation contractDigest',
    );
    assertDomainSeparatedSha256Id(
      evidence.resolutionDigest,
      'waf',
      'reconciliation resolutionDigest',
    );
    const contractDigest = createApplicationStateEffectContractDigest({
      destinationEffectId: effect.destinationEffectId,
      identity: {
        runId: effect.runId,
        invocationId: effect.invocationId,
        effectId: effect.effectId,
      },
      destination,
      request: normalizedRequest.frame,
    });
    if (evidence.contractDigest !== contractDigest) return false;
    const expectedResolution = createApplicationStateNotAppliedResolutionRecord(
      {
        storeId: destination.configuration.storeId,
        destinationEffectId: effect.destinationEffectId,
        contractDigest,
        businessKey: createApplicationStateBusinessKey(
          destination.configuration.namespace,
          normalizedRequest.input.key,
        ),
        businessObservation: evidence.businessObservation,
      },
    );
    return evidence.resolutionDigest === expectedResolution.resolution_digest;
  } catch {
    return false;
  }
}

export const APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS = Object.freeze([
  Object.freeze({
    kind: APPLICATION_STATE_VERIFIER_DESCRIPTOR.kind,
    version: APPLICATION_STATE_VERIFIER_DESCRIPTOR.version,
    verify: verifyApplicationStatePutIfAbsentOutcome,
  }),
  Object.freeze({
    kind: APPLICATION_STATE_RECONCILIATION_VERIFIER_DESCRIPTOR.kind,
    version: APPLICATION_STATE_RECONCILIATION_VERIFIER_DESCRIPTOR.version,
    verify: verifyApplicationStatePutIfAbsentNotAppliedEvidence,
  }),
]);

export default {
  APPLICATION_STATE_ADAPTER_DESCRIPTOR,
  APPLICATION_STATE_BINDING_ID,
  APPLICATION_STATE_CAPABILITY,
  APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS,
  APPLICATION_STATE_MAX_INPUT_BYTES,
  APPLICATION_STATE_MAX_KEY_BYTES,
  APPLICATION_STATE_PUT_IF_ABSENT_OPERATION,
  APPLICATION_STATE_RECONCILIATION_VERIFIER_DESCRIPTOR,
  APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
  APPLICATION_STATE_VERIFIER_DESCRIPTOR,
  createApplicationStateEffectContractDigest,
  createApplicationStateNotAppliedEvidence,
  createApplicationStateOutcomeFromReceipt,
  normalizeApplicationStateDestination,
  normalizeApplicationStatePutIfAbsentRequest,
  verifyApplicationStatePutIfAbsentOutcome,
  verifyApplicationStatePutIfAbsentNotAppliedEvidence,
};
