import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
  validateActivityProtocolHostFrame,
} from '../../runtime/activity-protocol.js';
import { createCanonicalJsonSha256Id } from '../../runtime/content-id.js';
import {
  EXECUTION_PAYLOAD_MAX_BYTES,
  validateExecutionPayloadReference,
  verifyExecutionPayloadReference,
} from '../../runtime/execution-payload.js';
import {
  cloneBoundedJsonObject,
  cloneBoundedJsonValue,
} from '../../runtime/json-value.js';
import { assertLogicalId } from '../../runtime/logical-id.js';
import {
  MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES,
  assertLedgerOpaqueId,
} from './record-key.js';

export const EXECUTION_LEDGER_SCHEMA_VERSION = 8;
export const EXECUTION_LEDGER_MAX_OPAQUE_ID_BYTES =
  MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES;
export const EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES = 64 * 1024;
export const EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES =
  EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES * 4;
// Referenced payloads are intentionally much larger than table records, but
// still bounded before they enter a durable local process. Keep the ledger
// alias for its public API while the payload reference is the single source
// of truth for the limit.
export const EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES =
  EXECUTION_PAYLOAD_MAX_BYTES;
// Bound transcript replay independently of its byte cap. Without this, a
// caller can make validation work scale with a large number of tiny frames.
export const EXECUTION_LEDGER_MAX_EVIDENCE_FRAMES = 512;
// Recovery must settle the complete unresolved effect set in one transaction.
// Keep that set below every supported adapter's portable transaction ceiling.
export const EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS = 16;

export const RunStatus = Object.freeze({
  RUNNING: 'RUNNING',
  BLOCKED: 'BLOCKED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

export const InvocationStatus = Object.freeze({
  RUNNABLE: 'RUNNABLE',
  RUNNING: 'RUNNING',
  UNCERTAIN: 'UNCERTAIN',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

export const AttemptStatus = Object.freeze({
  CLAIMED: 'CLAIMED',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  ABANDONED: 'ABANDONED',
});

export const EffectStatus = Object.freeze({
  PENDING: 'PENDING',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  UNCERTAIN: 'UNCERTAIN',
  NOT_APPLIED: 'NOT_APPLIED',
});

export const MANAGED_EFFECT_REQUEST_PAYLOAD_SCHEMA =
  'wharfie.execution.managed-effect-request.v1';
export const MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA =
  'wharfie.execution.managed-effect-outcome.v2';
export const MANAGED_EFFECT_RECONCILIATION_EVIDENCE_PAYLOAD_SCHEMA =
  'wharfie.execution.managed-effect-reconciliation-evidence.v1';
const EFFECT_REPLAY_PROPERTIES = Object.freeze([
  'pure',
  'idempotent',
  'transactional',
  'unsafe',
]);
const EFFECT_REPLAY_PROPERTY_ORDER = new Map(
  EFFECT_REPLAY_PROPERTIES.map((property, index) => [property, index]),
);

/** Error raised when a caller reuses an immutable run identity for new work. */
export class ExecutionLedgerRunConflictError extends Error {
  /** @param {string} runId - Durable run identity. */
  constructor(runId) {
    super(`Execution ledger run conflicts with existing work: ${runId}`);
    this.name = 'ExecutionLedgerRunConflictError';
    this.runId = runId;
  }
}

/** Error raised when a requested durable run does not exist. */
export class ExecutionLedgerNotFoundError extends Error {
  /** @param {string} runId - Durable run identity. */
  constructor(runId) {
    super(`Execution ledger run was not found: ${runId}`);
    this.name = 'ExecutionLedgerNotFoundError';
    this.runId = runId;
  }
}

/** Error raised when an optimistic version or fencing precondition is stale. */
export class ExecutionLedgerConflictError extends Error {
  /**
   * @param {string} runId - Durable run identity.
   * @param {string} [reason] - Safe conflict reason.
   */
  constructor(runId, reason) {
    super(
      `Execution ledger changed concurrently: ${runId}${
        reason ? ` (${reason})` : ''
      }`,
    );
    this.name = 'ExecutionLedgerConflictError';
    this.runId = runId;
  }
}

/** Error raised when one transition ID is reused with different contents. */
export class ExecutionLedgerTransitionConflictError extends Error {
  /**
   * @param {string} runId - Durable run identity.
   * @param {string} transitionId - Reused transition identity.
   */
  constructor(runId, transitionId) {
    super(
      `Execution ledger transition conflicts with existing receipt: ${runId}#${transitionId}`,
    );
    this.name = 'ExecutionLedgerTransitionConflictError';
    this.runId = runId;
    this.transitionId = transitionId;
  }
}

/** Error raised when append-only evidence and mutable projections disagree. */
export class ExecutionLedgerProjectionError extends Error {
  /**
   * @param {string} runId - Durable run identity.
   * @param {string} reason - Safe structural failure.
   */
  constructor(runId, reason) {
    super(`Execution ledger projection is invalid: ${runId} (${reason})`);
    this.name = 'ExecutionLedgerProjectionError';
    this.runId = runId;
    this.reason = reason;
  }
}

/**
 * @param {unknown} value - Candidate opaque ledger identity.
 * @param {string} label - Human-readable boundary label.
 * @returns {string} - Validated identity.
 */
export function assertOpaqueId(value, label) {
  return assertLedgerOpaqueId(value, label);
}

/**
 * @param {unknown} value - Candidate nonnegative safe integer.
 * @param {string} label - Human-readable boundary label.
 * @returns {number} - Validated number.
 */
export function assertNonnegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/**
 * @param {unknown} value - Candidate positive safe integer.
 * @param {string} label - Human-readable boundary label.
 * @returns {number} - Validated number.
 */
export function assertPositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

/**
 * @param {Record<string, any>} value - Candidate object.
 * @param {string[]} keys - Exact allowed object keys.
 * @param {string} label - Human-readable boundary label.
 * @returns {void}
 */
export function assertExactKeys(value, keys, label) {
  const allowed = new Set(keys);
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new TypeError(`${label} must contain exactly ${keys.join(', ')}.`);
  }
}

/**
 * Assert a snapshot has every required field, no unknown fields, and only
 * explicitly declared optional fields.
 * @param {Record<string, any>} value - Candidate snapshot.
 * @param {string[]} required - Fields that must be present.
 * @param {string[]} optional - Fields that may be present.
 * @param {string} label - Human-readable boundary label.
 * @returns {void}
 */
export function assertSnapshotKeys(value, required, optional, label) {
  assertExactKeys(
    value,
    [
      ...required,
      ...optional.filter((key) =>
        Object.prototype.hasOwnProperty.call(value, key),
      ),
    ],
    label,
  );
}

/**
 * @param {unknown} value - Candidate JSON payload.
 * @param {string} label - Human-readable boundary label.
 * @param {number} maxBytes - Maximum encoded JSON bytes.
 * @returns {any} - Strict independently cloned JSON value.
 */
function cloneBoundedJson(value, label, maxBytes) {
  return cloneBoundedJsonValue(value, maxBytes, label);
}

/**
 * @param {unknown} value - Candidate compact durable JSON payload.
 * @param {string} label - Human-readable boundary label.
 * @returns {any} - Strict independently cloned JSON value.
 */
export function cloneInlinePayload(value, label) {
  return cloneBoundedJson(
    value,
    label,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
  );
}

/**
 * @param {unknown} value - Candidate append-only event payload.
 * @param {string} label - Human-readable boundary label.
 * @returns {any} - Strict independently cloned event payload.
 */
export function cloneEventPayload(value, label) {
  return cloneBoundedJson(
    value,
    label,
    EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES,
  );
}

/**
 * @param {unknown} value - Candidate content-addressed JSON payload.
 * @param {string} label - Human-readable boundary label.
 * @returns {any} - Strict independently cloned referenced payload.
 */
export function cloneReferencedPayload(value, label) {
  return cloneBoundedJson(
    value,
    label,
    EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
  );
}

/**
 * @param {unknown} value - Candidate content-addressed JSON object.
 * @param {string} label - Human-readable boundary label.
 * @returns {Record<string, any>} - Strict independently cloned referenced payload object.
 */
export function cloneReferencedPayloadObject(value, label) {
  return cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
    label,
  );
}

/**
 * @param {unknown} value - Candidate immutable payload reference.
 * @param {string} expectedPayloadSchema - Required semantic payload schema.
 * @param {string} label - Human-readable boundary label.
 * @returns {Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>} - Validated immutable reference.
 */
export function normalizePayloadReference(value, expectedPayloadSchema, label) {
  const reference = validateExecutionPayloadReference(value, label);
  if (reference.payloadSchema !== expectedPayloadSchema) {
    throw new TypeError(
      `${label}.payloadSchema must be '${expectedPayloadSchema}'.`,
    );
  }
  return reference;
}

/**
 * @param {unknown} value - Candidate canonical replay-property set.
 * @param {string} label - Human-readable boundary label.
 * @returns {string[]} - Strict canonical replay-property set.
 */
export function normalizeReplayProperties(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty array.`);
  }
  let previous = -1;
  const result = value.map((property, index) => {
    if (
      typeof property !== 'string' ||
      !EFFECT_REPLAY_PROPERTY_ORDER.has(property)
    ) {
      throw new TypeError(`${label}[${index}] is not supported.`);
    }
    const order = /** @type {number} */ (
      EFFECT_REPLAY_PROPERTY_ORDER.get(property)
    );
    if (order <= previous) {
      throw new TypeError(`${label} must be unique and canonically ordered.`);
    }
    previous = order;
    return property;
  });
  if (result.includes('unsafe') && result.length !== 1) {
    throw new TypeError(`${label} cannot combine unsafe with safe properties.`);
  }
  return result;
}

/**
 * @param {unknown} value - Candidate versioned adapter descriptor.
 * @param {string} label - Human-readable boundary label.
 * @returns {{id: string, version: number}} - Strict adapter descriptor.
 */
export function normalizeEffectAdapterDescriptor(value, label) {
  const descriptor = cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    label,
  );
  assertExactKeys(descriptor, ['id', 'version'], label);
  assertLogicalId(descriptor.id, `${label}.id`);
  return {
    id: descriptor.id,
    version: assertPositiveSafeInteger(descriptor.version, `${label}.version`),
  };
}

/**
 * Bind one logical effect to the exact durable destination selected by its
 * trusted host. A logical binding name alone is not durable authority: the
 * complete immutable configuration snapshot must survive retries so the same
 * adapter version cannot silently point at a different store, table, or
 * namespace. This common JSON codec cannot infer whether a value is a secret;
 * the finite host catalog must validate its kind-specific configuration and
 * keep credentials outside this descriptor before public dispatch is enabled.
 * @param {unknown} value - Candidate versioned destination binding.
 * @param {string} label - Human-readable boundary label.
 * @returns {{kind: string, version: number, bindingId: string, configuration: Record<string, any>}} - Strict destination descriptor.
 */
export function normalizeEffectDestinationDescriptor(value, label) {
  const descriptor = cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    label,
  );
  assertExactKeys(
    descriptor,
    ['kind', 'version', 'bindingId', 'configuration'],
    label,
  );
  assertLogicalId(descriptor.kind, `${label}.kind`);
  assertLogicalId(descriptor.bindingId, `${label}.bindingId`);
  return {
    kind: descriptor.kind,
    version: assertPositiveSafeInteger(descriptor.version, `${label}.version`),
    bindingId: descriptor.bindingId,
    configuration: cloneBoundedJsonObject(
      descriptor.configuration,
      EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
      `${label}.configuration`,
    ),
  };
}

/**
 * @param {unknown} value - Candidate versioned evidence-verifier descriptor.
 * @param {string} label - Human-readable boundary label.
 * @returns {{kind: string, version: number}} - Strict verifier descriptor.
 */
export function normalizeEffectVerifierDescriptor(value, label) {
  const descriptor = cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    label,
  );
  assertExactKeys(descriptor, ['kind', 'version'], label);
  assertLogicalId(descriptor.kind, `${label}.kind`);
  return {
    kind: descriptor.kind,
    version: assertPositiveSafeInteger(descriptor.version, `${label}.version`),
  };
}

/**
 * @param {{kind: string, version: number}} descriptor - Verifier identity.
 * @returns {string} - Exact registry key.
 */
export function effectVerifierKey(descriptor) {
  return JSON.stringify([descriptor.kind, descriptor.version]);
}

/**
 * Persist only the stable logical request fields. Protocol attemptId and
 * sequence belong to one physical delivery and must be allowed to differ when
 * a future authorized retry asks for the same logical effect.
 * @param {unknown} value - Candidate logical managed-effect request.
 * @param {string} label - Human-readable boundary label.
 * @returns {{capability: string, operation: string, input: any, requestedReplayProperties: string[]}} - Strict request.
 */
export function normalizeManagedEffectRequest(value, label) {
  const request = cloneReferencedPayloadObject(value, label);
  assertExactKeys(
    request,
    ['capability', 'operation', 'input', 'requestedReplayProperties'],
    label,
  );
  assertLogicalId(request.capability, `${label}.capability`);
  assertLogicalId(request.operation, `${label}.operation`);
  return {
    capability: request.capability,
    operation: request.operation,
    input: cloneReferencedPayload(request.input, `${label}.input`),
    requestedReplayProperties: normalizeReplayProperties(
      request.requestedReplayProperties,
      `${label}.requestedReplayProperties`,
    ),
  };
}

/**
 * @param {unknown} value - Candidate logical effect outcome and destination evidence.
 * @param {string} label - Human-readable boundary label.
 * @returns {{destinationEffectId: string, adapter: {id: string, version: number}, destination: {kind: string, version: number, bindingId: string, configuration: Record<string, any>}, verifier: {kind: string, version: number}, ok: boolean, substantiatedReplayProperties: string[], result?: any, error?: Record<string, any>, evidence: Record<string, any>}} - Strict outcome evidence.
 */
export function normalizeManagedEffectOutcome(value, label) {
  const outcome = cloneReferencedPayloadObject(value, label);
  const common = [
    'destinationEffectId',
    'adapter',
    'destination',
    'verifier',
    'ok',
    'substantiatedReplayProperties',
    'evidence',
  ];
  assertExactKeys(
    outcome,
    [...common, outcome.ok === true ? 'result' : 'error'],
    label,
  );
  if (outcome.ok !== true && outcome.ok !== false) {
    throw new TypeError(`${label}.ok must be a boolean.`);
  }
  const adapter = normalizeEffectAdapterDescriptor(
    outcome.adapter,
    `${label}.adapter`,
  );
  const destination = normalizeEffectDestinationDescriptor(
    outcome.destination,
    `${label}.destination`,
  );
  const verifier = normalizeEffectVerifierDescriptor(
    outcome.verifier,
    `${label}.verifier`,
  );
  const substantiatedReplayProperties = normalizeReplayProperties(
    outcome.substantiatedReplayProperties,
    `${label}.substantiatedReplayProperties`,
  );
  const protocolFrame = validateActivityProtocolHostFrame(
    {
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type: 'effect-result',
      attemptId: 'persisted-effect-outcome-validation',
      effectId: 'persisted-effect-outcome-validation',
      ok: outcome.ok,
      ...(outcome.ok === true
        ? { result: outcome.result }
        : { error: outcome.error }),
      substantiatedReplayProperties,
      evidence: outcome.evidence,
    },
    label,
  );
  return {
    destinationEffectId: assertOpaqueId(
      outcome.destinationEffectId,
      `${label}.destinationEffectId`,
    ),
    adapter,
    destination,
    verifier,
    ok: outcome.ok,
    substantiatedReplayProperties,
    ...(outcome.ok === true
      ? {
          result: cloneReferencedPayload(
            protocolFrame.result,
            `${label}.result`,
          ),
        }
      : {
          error: cloneReferencedPayloadObject(
            protocolFrame.error,
            `${label}.error`,
          ),
        }),
    evidence: cloneReferencedPayloadObject(
      protocolFrame.evidence,
      `${label}.evidence`,
    ),
  };
}

/**
 * Rehash and decode exact provider bytes inside the ledger before using a
 * payload. A provider only supplies one read result; the ledger itself binds
 * that result to the immutable reference, avoiding a verify/read TOCTOU gap.
 * @param {unknown} value - Exact bytes returned by the payload provider.
 * @param {Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>} expectedReference - Reference requested by the ledger.
 * @param {string} expectedPayloadSchema - Required semantic payload schema.
 * @param {string} label - Human-readable boundary label.
 * @returns {{reference: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>, value: any}} - Exact verified reference and decoded value.
 */
export function verifyPayloadBytes(
  value,
  expectedReference,
  expectedPayloadSchema,
  label,
) {
  const verified = verifyExecutionPayloadReference(
    expectedReference,
    value,
    label,
  );
  const reference = normalizePayloadReference(
    verified.reference,
    expectedPayloadSchema,
    `${label}.reference`,
  );
  if (!hasSameCanonicalJson(reference, expectedReference)) {
    throw new TypeError(`${label} changed its immutable reference.`);
  }
  return { reference, value: verified.value };
}

/**
 * @param {unknown} left - First JSON value.
 * @param {unknown} right - Second JSON value.
 * @returns {boolean} - Whether both values have identical canonical JSON.
 */
export function hasSameCanonicalJson(left, right) {
  return (
    JSON.stringify(sortCanonical(left)) === JSON.stringify(sortCanonical(right))
  );
}

/**
 * @param {any} value - Already-valid JSON value.
 * @returns {any} - Canonically ordered independent clone.
 */
function sortCanonical(value) {
  if (Array.isArray(value)) return value.map((entry) => sortCanonical(entry));
  if (value === null || typeof value !== 'object') return value;
  const sorted = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortCanonical(value[key]);
  }
  return sorted;
}

/**
 * Derive the identity that adapters must carry to their destination. Raw
 * effect IDs are only invocation-scoped, so they are never sufficient as a
 * provider idempotency or transactional key on their own.
 * @param {{appId: string, runId: string, invocationId: string, effectId: string}} input - Stable logical effect identity.
 * @returns {string} - Globally scoped content-bound destination identity.
 */
export function createManagedEffectDestinationId(input) {
  assertLogicalId(input.appId, 'managed effect appId');
  const runId = assertOpaqueId(input.runId, 'managed effect runId');
  const invocationId = assertOpaqueId(
    input.invocationId,
    'managed effect invocationId',
  );
  const effectId = assertOpaqueId(input.effectId, 'managed effect effectId');
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:execution-ledger-destination-effect:v8',
    prefix: 'wfx',
    value: {
      schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      appId: input.appId,
      runId,
      invocationId,
      effectId,
    },
    valuePath: 'managed effect destination identity',
  });
}

/**
 * @param {unknown} value - Candidate verifier registrations.
 * @returns {Map<string, {descriptor: {kind: string, version: number}, verify: (input: Record<string, any>) => boolean}>} - Exact verifier registry.
 */
export function normalizeEffectEvidenceVerifiers(value) {
  if (value === undefined) return new Map();
  if (!Array.isArray(value)) {
    throw new TypeError(
      'createExecutionLedger.effectEvidenceVerifiers must be an array.',
    );
  }
  const registry = new Map();
  value.forEach((candidate, index) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      throw new TypeError(
        `createExecutionLedger.effectEvidenceVerifiers[${index}] must be an object.`,
      );
    }
    const registration = /** @type {Record<string, any>} */ (candidate);
    const keys = Object.keys(registration);
    if (
      keys.length !== 3 ||
      !keys.includes('kind') ||
      !keys.includes('version') ||
      !keys.includes('verify') ||
      typeof registration.verify !== 'function'
    ) {
      throw new TypeError(
        `createExecutionLedger.effectEvidenceVerifiers[${index}] requires exactly kind, version, and verify.`,
      );
    }
    const descriptor = normalizeEffectVerifierDescriptor(
      { kind: registration.kind, version: registration.version },
      `createExecutionLedger.effectEvidenceVerifiers[${index}]`,
    );
    const key = effectVerifierKey(descriptor);
    if (registry.has(key)) {
      throw new TypeError(
        `createExecutionLedger.effectEvidenceVerifiers[${index}] duplicates ${descriptor.kind}@${descriptor.version}.`,
      );
    }
    registry.set(key, {
      descriptor,
      verify: registration.verify,
    });
  });
  return registry;
}

/**
 * Recursively freeze one independently cloned JSON value before handing it to
 * extension code. Verifiers are trusted for semantics, but a verifier bug
 * must not be able to mutate the fold or the outcome that will be persisted.
 * @param {any} value - Independently cloned JSON value.
 * @returns {any} - Recursively frozen JSON value.
 */
export function deepFreezeJson(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
}

/**
 * Require a registered deterministic verifier to substantiate the exact
 * immutable destination outcome. Verifiers are deliberately synchronous:
 * rebuild must not depend on current network state or mutable credentials.
 * @param {Map<string, {descriptor: {kind: string, version: number}, verify: (input: Record<string, any>) => boolean}>} registry - Versioned verifier registry.
 * @param {Record<string, any>} effect - Strict effect projection.
 * @param {ReturnType<typeof normalizeManagedEffectRequest>} request - Rehashed logical request.
 * @param {ReturnType<typeof normalizeManagedEffectOutcome>} outcome - Rehashed outcome evidence.
 * @param {string} label - Human-readable boundary label.
 * @returns {void}
 */
export function verifyManagedEffectOutcome(
  registry,
  effect,
  request,
  outcome,
  label,
) {
  if (
    outcome.destinationEffectId !== effect.destinationEffectId ||
    !hasSameCanonicalJson(outcome.adapter, effect.adapter) ||
    !hasSameCanonicalJson(outcome.destination, effect.destination) ||
    !hasSameCanonicalJson(outcome.verifier, effect.verifier) ||
    !hasSameCanonicalJson(
      outcome.substantiatedReplayProperties,
      effect.substantiatedReplayProperties,
    )
  ) {
    throw new TypeError(
      `${label} does not match its persisted effect contract.`,
    );
  }
  const registration = registry.get(effectVerifierKey(effect.verifier));
  if (!registration) {
    throw new TypeError(
      `${label} requires unavailable verifier ${effect.verifier.kind}@${effect.verifier.version}.`,
    );
  }
  const verifierInput = deepFreezeJson(
    cloneReferencedPayloadObject(
      {
        effect: {
          runId: effect.runId,
          invocationId: effect.invocationId,
          effectId: effect.effectId,
          destinationEffectId: effect.destinationEffectId,
          adapter: effect.adapter,
          destination: effect.destination,
          verifier: effect.verifier,
          requestedReplayProperties: effect.requestedReplayProperties,
          substantiatedReplayProperties: effect.substantiatedReplayProperties,
        },
        request,
        outcome,
      },
      `${label} verifier input`,
    ),
  );
  const verified = registration.verify(verifierInput);
  if (
    verified !== true ||
    (verified && typeof verified === 'object' && 'then' in verified)
  ) {
    throw new TypeError(`${label} was not substantiated by its verifier.`);
  }
}

/**
 * Require a registered deterministic verifier to substantiate typed negative
 * evidence for an uncertain destination effect. The verifier descriptor is
 * independent from the effect's positive outcome verifier because proving a
 * permanent negative disposition is a distinct destination capability.
 * @param {Map<string, {descriptor: {kind: string, version: number}, verify: (input: Record<string, any>) => boolean}>} registry - Versioned verifier registry.
 * @param {Record<string, any>} effect - Strict effect projection.
 * @param {ReturnType<typeof normalizeManagedEffectRequest>} request - Rehashed logical request.
 * @param {{kind: string, version: number}} verifier - Negative evidence verifier descriptor.
 * @param {Record<string, any>} evidence - Rehashed immutable negative evidence.
 * @param {string} label - Human-readable boundary label.
 * @returns {void}
 */
export function verifyManagedEffectReconciliationEvidence(
  registry,
  effect,
  request,
  verifier,
  evidence,
  label,
) {
  const descriptor = normalizeEffectVerifierDescriptor(
    verifier,
    `${label} verifier`,
  );
  const registration = registry.get(effectVerifierKey(descriptor));
  if (!registration) {
    throw new TypeError(
      `${label} requires unavailable verifier ${descriptor.kind}@${descriptor.version}.`,
    );
  }
  const verifierInput = deepFreezeJson(
    cloneReferencedPayloadObject(
      {
        effect: {
          runId: effect.runId,
          invocationId: effect.invocationId,
          effectId: effect.effectId,
          destinationEffectId: effect.destinationEffectId,
          adapter: effect.adapter,
          destination: effect.destination,
          verifier: effect.verifier,
          requestedReplayProperties: effect.requestedReplayProperties,
          substantiatedReplayProperties: effect.substantiatedReplayProperties,
        },
        request,
        evidence,
      },
      `${label} verifier input`,
    ),
  );
  const verified = registration.verify(verifierInput);
  if (
    verified !== true ||
    (verified && typeof verified === 'object' && 'then' in verified)
  ) {
    throw new TypeError(`${label} was not substantiated by its verifier.`);
  }
}
