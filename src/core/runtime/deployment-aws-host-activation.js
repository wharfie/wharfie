/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description, jsdoc/tag-lines, no-labels -- The pure host kernel deliberately exposes narrow injected ports and one finite labeled convergence loop whose compact form is clearer than parser-specific repetitions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import {
  AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
  createAwsSingleNodeHostActivationReceipt,
  validateAwsSingleNodeHostActivationReceipt,
  validateAwsSingleNodeHostActivationRequest,
} from './deployment-aws-host-agent-contract.js';
import { assertAwsEc2InstanceId } from './deployment-aws-runtime-identity-contract.js';
import { assertDeploymentInstanceId } from './deployment-provider-scope.js';
import { assertDeploymentIncarnationId } from './deployment-resource-binding.js';
import { validateDeploymentServiceHealthObservation } from './deployment-service-health-s3.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_KIND =
  'awsSingleNodeHostActivationFence';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_ID_DOMAIN =
  'wharfie:aws-single-node-host-activation-fence:v1';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_ID_PREFIX = 'whag1';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_KIND =
  'awsSingleNodeHostActivationState';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_DOMAIN =
  'wharfie:aws-single-node-host-activation-state:v1';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_PREFIX = 'whas1';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_INTENT_ID_DOMAIN =
  'wharfie:aws-single-node-host-activation-intent:v1';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_INTENT_ID_PREFIX = 'whai1';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_OBSERVATION_ID_DOMAIN =
  'wharfie:aws-single-node-host-activation-observation:v1';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_OBSERVATION_ID_PREFIX = 'whao1';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_MAX_BYTES = 8 * 1024;
export const AWS_SINGLE_NODE_HOST_ACTIVATION_EVIDENCE_MAX_BYTES = 24 * 1024;
export const AWS_SINGLE_NODE_HOST_ACTIVATION_OBSERVATION_MAX_BYTES =
  AWS_SINGLE_NODE_HOST_ACTIVATION_EVIDENCE_MAX_BYTES + 2 * 1024;
export const AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_MAX_BYTES = 256 * 1024;

export const AWS_SINGLE_NODE_HOST_ACTIVATION_STEP_KINDS = Object.freeze([
  'runtime-identity',
  'application-storage',
  'control-storage',
  'artifact-projection',
  'service-convergence',
  'health-publication',
]);

export const AwsSingleNodeHostActivationStateStatus = Object.freeze({
  RUNNING: 'running',
  BLOCKED: 'blocked',
  SUCCEEDED: 'succeeded',
});

export const AwsSingleNodeHostActivationStepStatus = Object.freeze({
  PENDING: 'pending',
  INTENDED: 'intended',
  SETTLED: 'settled',
});

const MAX_CONVERGENCE_CYCLES = 64;
const FENCE_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'deploymentInstanceId',
  'incarnationId',
  'nodeProviderResourceId',
  'requestId',
  'authorizedHeadGeneration',
  'recordVersion',
]);
const FENCE_DOCUMENT_KEYS = new Set(['fenceId', ...FENCE_PAYLOAD_KEYS]);
const STATE_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'request',
  'recordVersion',
  'status',
  'steps',
  'block',
  'receipt',
]);
const STATE_DOCUMENT_KEYS = new Set(['stateId', ...STATE_PAYLOAD_KEYS]);
const STEP_KEYS = new Set([
  'intentId',
  'kind',
  'status',
  'attemptGeneration',
  'evidence',
]);
const OBSERVATION_KEYS = new Set(['observationId', 'value']);
const BLOCK_KEYS = new Set(['step', 'reason']);
const RESULT_KEYS = new Set([
  'status',
  'requestId',
  'stateId',
  'recordVersion',
  'step',
  'receipt',
]);
const RESUME_INPUT_KEYS = new Set(['requestId']);
const INSPECT_INPUT_KEYS = new Set(['requestId']);
const FACTORY_OPTION_KEYS = new Set([
  'store',
  'withHostLock',
  'authorizeRequest',
  'steps',
]);
const STORE_KEYS = new Set([
  'readActivationFence',
  'compareAndSetActivationFence',
  'readActivationState',
  'compareAndSetActivationState',
]);
const STEP_OPTION_KEYS = new Set([
  'runtimeIdentity',
  'applicationStorage',
  'controlStorage',
  'artifactProjection',
  'serviceConvergence',
  'healthPublication',
]);
const READ_ONLY_ADAPTER_KEYS = new Set(['observe', 'validateEvidence']);
const EFFECT_ADAPTER_KEYS = new Set([
  'observe',
  'converge',
  'validateEvidence',
]);
const OBSERVATION_STATUSES = new Set([
  'settled',
  'ready',
  'unknown',
  'conflict',
]);
const STATE_STATUSES = new Set(
  Object.values(AwsSingleNodeHostActivationStateStatus),
);
const STEP_STATUSES = new Set(
  Object.values(AwsSingleNodeHostActivationStepStatus),
);
const STEP_OPTIONS = Object.freeze([
  Object.freeze({
    kind: 'runtime-identity',
    optionKey: 'runtimeIdentity',
    effectful: false,
  }),
  Object.freeze({
    kind: 'application-storage',
    optionKey: 'applicationStorage',
    effectful: true,
  }),
  Object.freeze({
    kind: 'control-storage',
    optionKey: 'controlStorage',
    effectful: true,
  }),
  Object.freeze({
    kind: 'artifact-projection',
    optionKey: 'artifactProjection',
    effectful: true,
  }),
  Object.freeze({
    kind: 'service-convergence',
    optionKey: 'serviceConvergence',
    effectful: true,
  }),
  Object.freeze({
    kind: 'health-publication',
    optionKey: 'healthPublication',
    effectful: true,
  }),
]);

/** Durable state or authority changed outside the exact expected transition. */
export class AwsSingleNodeHostActivationConflictError extends Error {
  /** @param {string} reason - Safe finite conflict detail. */
  constructor(reason) {
    super(
      `AWS single-node host activation conflicts with durable state (${reason}).`,
    );
    this.name = 'AwsSingleNodeHostActivationConflictError';
    this.code = 'WHARFIE_AWS_HOST_ACTIVATION_CONFLICT';
    this.reason = reason;
  }
}

/** A requested durable activation state does not exist. */
export class AwsSingleNodeHostActivationNotFoundError extends Error {
  /** @param {string} requestId - Activation request. */
  constructor(requestId) {
    super(`AWS single-node host activation was not found: ${requestId}`);
    this.name = 'AwsSingleNodeHostActivationNotFoundError';
    this.code = 'WHARFIE_AWS_HOST_ACTIVATION_NOT_FOUND';
    this.requestId = requestId;
  }
}

/** One effect failed and exact post-effect observation did not prove settlement. */
export class AwsSingleNodeHostActivationEffectError extends Error {
  /** @param {string} step - Fixed step kind. @param {unknown} cause - Original failure. */
  constructor(step, cause) {
    super(`AWS single-node host activation effect did not settle: ${step}`, {
      cause,
    });
    this.name = 'AwsSingleNodeHostActivationEffectError';
    this.code = 'WHARFIE_AWS_HOST_ACTIVATION_EFFECT_FAILED';
    this.step = step;
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObjectRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertExactKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {unknown} value @param {Set<string>} keys @param {string} path @returns {Record<string, any>} */
function assertExactObject(value, keys, path) {
  if (!isObjectRecord(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  assertExactKeys(value, keys, path);
  return value;
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/**
 * Scan validated adapter evidence without mistaking the two exact S3
 * provider identifiers in a health observation for authored credentials.
 * No generic property-name escape hatch is permitted.
 * @param {Readonly<Record<string, any>>} value - Canonical evidence.
 * @param {string} kind - Fixed step kind.
 * @param {string} path - Human-readable path.
 * @returns {void}
 */
function assertEvidenceSecretFree(value, kind, path) {
  if (kind !== 'health-publication') {
    assertManifestIsSecretFree(value, path);
    return;
  }
  const observation = validateDeploymentServiceHealthObservation(value, path);
  assertManifestIsSecretFree(
    {
      ...observation,
      object: {
        ...observation.object,
        versionId: 'opaque-provider-version-id',
        etag: 'opaque-provider-etag',
      },
    },
    path,
  );
}

/** @param {unknown} value @param {string} path @returns {number} */
function positiveSafeInteger(value, path) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${path} must be a positive safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} path @returns {number} */
function nonnegativeSafeInteger(value, path) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/** @param {Readonly<Record<string, any>>} request @param {string} kind @returns {string} */
export function getAwsSingleNodeHostActivationIntentId(request, kind) {
  const canonicalRequest = validateAwsSingleNodeHostActivationRequest(request);
  if (!AWS_SINGLE_NODE_HOST_ACTIVATION_STEP_KINDS.includes(kind)) {
    throw new TypeError(`hostActivationIntent.kind is not supported.`);
  }
  return createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_ACTIVATION_INTENT_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_INTENT_ID_PREFIX,
    value: { requestId: canonicalRequest.requestId, kind },
    valuePath: 'hostActivationIntent',
  });
}

/** @param {string} requestId @param {string} intentId @param {unknown} value @returns {string} */
function getObservationId(requestId, intentId, value) {
  return createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_ACTIVATION_OBSERVATION_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_OBSERVATION_ID_PREFIX,
    value: { requestId, intentId, value },
    valuePath: 'hostActivationObservation',
  });
}

/** @param {string} requestId @param {string} intentId @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function createObservation(requestId, intentId, value, path) {
  const canonicalValue = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_ACTIVATION_EVIDENCE_MAX_BYTES,
    `${path}.value`,
  );
  return deepFreeze(
    sortCanonicalJsonValue({
      observationId: getObservationId(requestId, intentId, canonicalValue),
      value: canonicalValue,
    }),
  );
}

/** @param {unknown} value @param {string} requestId @param {string} intentId @param {string} path @returns {Readonly<Record<string, any>>} */
function validateObservation(value, requestId, intentId, path) {
  const observation = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_ACTIVATION_OBSERVATION_MAX_BYTES,
    path,
  );
  assertExactKeys(observation, OBSERVATION_KEYS, path);
  assertDomainSeparatedSha256Id(
    observation.observationId,
    AWS_SINGLE_NODE_HOST_ACTIVATION_OBSERVATION_ID_PREFIX,
    `${path}.observationId`,
  );
  const expected = createObservation(
    requestId,
    intentId,
    observation.value,
    path,
  );
  if (observation.observationId !== expected.observationId) {
    throw new Error(`${path}.observationId does not match its exact evidence.`);
  }
  return expected;
}

/** @param {Readonly<Record<string, any>>} request @param {number} recordVersion @returns {Readonly<Record<string, any>>} */
function createFence(request, recordVersion) {
  const canonicalRequest = validateAwsSingleNodeHostActivationRequest(request);
  const payload = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_KIND,
      deploymentInstanceId: canonicalRequest.deploymentInstanceId,
      incarnationId: canonicalRequest.incarnationId,
      nodeProviderResourceId: canonicalRequest.nodeProviderResourceId,
      requestId: canonicalRequest.requestId,
      authorizedHeadGeneration: canonicalRequest.authorizedHeadGeneration,
      recordVersion: positiveSafeInteger(
        recordVersion,
        'hostActivationFence.recordVersion',
      ),
    }),
  );
  const fenceId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_ID_PREFIX,
    value: payload,
    valuePath: 'hostActivationFence',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, fenceId }));
}

/**
 * Validate one bounded content-addressed per-deployment activation fence.
 * The fence prevents an old delivered request from running after a newer
 * completed request has become current.
 * @param {unknown} value - Candidate fence.
 * @param {string} [valuePath] - Human-readable path.
 * @returns {Readonly<Record<string, any>>} - Canonical fence.
 */
export function validateAwsSingleNodeHostActivationFence(
  value,
  valuePath = 'awsSingleNodeHostActivationFence',
) {
  const document = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_MAX_BYTES,
    valuePath,
  );
  assertExactKeys(document, FENCE_DOCUMENT_KEYS, valuePath);
  if (
    document.schemaVersion !==
    AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_SCHEMA_VERSION
  ) {
    throw new TypeError(`${valuePath}.schemaVersion must be the integer 1.`);
  }
  if (document.kind !== AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_KIND) {
    throw new TypeError(
      `${valuePath}.kind must be '${AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_KIND}'.`,
    );
  }
  assertDeploymentInstanceId(
    document.deploymentInstanceId,
    `${valuePath}.deploymentInstanceId`,
  );
  assertDeploymentIncarnationId(
    document.incarnationId,
    `${valuePath}.incarnationId`,
  );
  assertAwsEc2InstanceId(
    document.nodeProviderResourceId,
    `${valuePath}.nodeProviderResourceId`,
  );
  assertDomainSeparatedSha256Id(
    document.requestId,
    AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
    `${valuePath}.requestId`,
  );
  const payload = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_KIND,
      deploymentInstanceId: document.deploymentInstanceId,
      incarnationId: document.incarnationId,
      nodeProviderResourceId: document.nodeProviderResourceId,
      requestId: document.requestId,
      authorizedHeadGeneration: positiveSafeInteger(
        document.authorizedHeadGeneration,
        `${valuePath}.authorizedHeadGeneration`,
      ),
      recordVersion: positiveSafeInteger(
        document.recordVersion,
        `${valuePath}.recordVersion`,
      ),
    }),
  );
  assertDomainSeparatedSha256Id(
    document.fenceId,
    AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_ID_PREFIX,
    `${valuePath}.fenceId`,
  );
  const expectedId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.fenceId !== expectedId) {
    throw new Error(`${valuePath}.fenceId does not match its exact fence.`);
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, fenceId: expectedId }),
  );
}

/** @param {Readonly<Record<string, any>>} fence @param {Readonly<Record<string, any>>} request @param {string} path @returns {void} */
function assertFenceMatchesRequest(fence, request, path) {
  const matches = [
    ['deploymentInstanceId', request.deploymentInstanceId],
    ['incarnationId', request.incarnationId],
    ['nodeProviderResourceId', request.nodeProviderResourceId],
    ['requestId', request.requestId],
    ['authorizedHeadGeneration', request.authorizedHeadGeneration],
  ];
  for (const [field, expected] of matches) {
    if (fence[field] !== expected) {
      throw new AwsSingleNodeHostActivationConflictError(
        `${path}-${field}-mismatch`,
      );
    }
  }
}

/** @param {Readonly<Record<string, any>>} request @returns {Readonly<Record<string, any>>[]} */
function createInitialSteps(request) {
  return STEP_OPTIONS.map(({ kind }) =>
    Object.freeze({
      intentId: getAwsSingleNodeHostActivationIntentId(request, kind),
      kind,
      status: AwsSingleNodeHostActivationStepStatus.PENDING,
      attemptGeneration: 0,
      evidence: null,
    }),
  );
}

/** @param {Record<string, any>} payload @returns {Readonly<Record<string, any>>} */
function createState(payload) {
  const canonicalPayload = deepFreeze(sortCanonicalJsonValue(payload));
  const stateId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_PREFIX,
    value: canonicalPayload,
    valuePath: 'awsSingleNodeHostActivationState',
  });
  return validateAwsSingleNodeHostActivationState({
    ...canonicalPayload,
    stateId,
  });
}

/** @param {Readonly<Record<string, any>>} request @returns {Readonly<Record<string, any>>} */
function createInitialState(request) {
  const canonicalRequest = validateAwsSingleNodeHostActivationRequest(request);
  return createState({
    schemaVersion: AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_KIND,
    request: canonicalRequest,
    recordVersion: 1,
    status: AwsSingleNodeHostActivationStateStatus.RUNNING,
    steps: createInitialSteps(canonicalRequest),
    block: null,
    receipt: null,
  });
}

/**
 * Validate one exact bounded host activation snapshot. Generic evidence is
 * structurally and cryptographically checked here; a configured kernel also
 * reruns the corresponding pure adapter validator before using it.
 * @param {unknown} value - Candidate state.
 * @param {string} [valuePath] - Human-readable path.
 * @returns {Readonly<Record<string, any>>} - Canonical state.
 */
export function validateAwsSingleNodeHostActivationState(
  value,
  valuePath = 'awsSingleNodeHostActivationState',
) {
  const document = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_MAX_BYTES,
    valuePath,
  );
  assertExactKeys(document, STATE_DOCUMENT_KEYS, valuePath);
  if (
    document.schemaVersion !==
    AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_SCHEMA_VERSION
  ) {
    throw new TypeError(`${valuePath}.schemaVersion must be the integer 1.`);
  }
  if (document.kind !== AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_KIND) {
    throw new TypeError(
      `${valuePath}.kind must be '${AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_KIND}'.`,
    );
  }
  const request = validateAwsSingleNodeHostActivationRequest(
    document.request,
    `${valuePath}.request`,
  );
  const recordVersion = positiveSafeInteger(
    document.recordVersion,
    `${valuePath}.recordVersion`,
  );
  if (!STATE_STATUSES.has(document.status)) {
    throw new TypeError(`${valuePath}.status is not supported.`);
  }
  if (
    !Array.isArray(document.steps) ||
    document.steps.length !== STEP_OPTIONS.length
  ) {
    throw new TypeError(
      `${valuePath}.steps must contain the fixed ${STEP_OPTIONS.length} activation steps.`,
    );
  }

  let sawFrontier = false;
  let frontierIndex = STEP_OPTIONS.length;
  const steps = document.steps.map((candidate, index) => {
    const path = `${valuePath}.steps[${index}]`;
    const step = assertExactObject(candidate, STEP_KEYS, path);
    const expectedKind = STEP_OPTIONS[index].kind;
    if (step.kind !== expectedKind) {
      throw new TypeError(`${path}.kind must be '${expectedKind}'.`);
    }
    const expectedIntentId = getAwsSingleNodeHostActivationIntentId(
      request,
      expectedKind,
    );
    if (step.intentId !== expectedIntentId) {
      throw new Error(`${path}.intentId does not match its exact request.`);
    }
    if (!STEP_STATUSES.has(step.status)) {
      throw new TypeError(`${path}.status is not supported.`);
    }
    const attemptGeneration = nonnegativeSafeInteger(
      step.attemptGeneration,
      `${path}.attemptGeneration`,
    );
    let evidence = null;
    if (step.status === AwsSingleNodeHostActivationStepStatus.PENDING) {
      if (step.evidence !== null) {
        throw new TypeError(`${path}.evidence must be null while pending.`);
      }
    } else if (step.status === AwsSingleNodeHostActivationStepStatus.INTENDED) {
      if (step.evidence !== null) {
        throw new TypeError(`${path}.evidence must be null while intended.`);
      }
    } else {
      evidence = validateObservation(
        step.evidence,
        request.requestId,
        expectedIntentId,
        `${path}.evidence`,
      );
      if (expectedKind === 'health-publication') {
        const healthObservation = validateDeploymentServiceHealthObservation(
          evidence.value,
          `${path}.evidence.value`,
        );
        createAwsSingleNodeHostActivationReceipt({
          request,
          serviceHealthReceipt: healthObservation.receipt,
        });
        evidence = createObservation(
          request.requestId,
          expectedIntentId,
          healthObservation,
          `${path}.evidence`,
        );
      }
      assertEvidenceSecretFree(
        evidence.value,
        expectedKind,
        `${path}.evidence.value`,
      );
    }

    if (sawFrontier) {
      if (step.status !== AwsSingleNodeHostActivationStepStatus.PENDING) {
        throw new TypeError(
          `${path}.status must be pending after the activation frontier.`,
        );
      }
    } else if (step.status !== AwsSingleNodeHostActivationStepStatus.SETTLED) {
      sawFrontier = true;
      frontierIndex = index;
    }

    return Object.freeze({
      intentId: expectedIntentId,
      kind: expectedKind,
      status: step.status,
      attemptGeneration,
      evidence,
    });
  });

  let block = null;
  if (document.block !== null) {
    const candidate = assertExactObject(
      document.block,
      BLOCK_KEYS,
      `${valuePath}.block`,
    );
    if (
      candidate.reason !== 'observation-conflict' ||
      !AWS_SINGLE_NODE_HOST_ACTIVATION_STEP_KINDS.includes(candidate.step)
    ) {
      throw new TypeError(`${valuePath}.block is not supported.`);
    }
    block = Object.freeze({
      step: candidate.step,
      reason: 'observation-conflict',
    });
  }

  const allSettled = frontierIndex === STEP_OPTIONS.length;
  let receipt = null;
  if (document.receipt !== null) {
    receipt = validateAwsSingleNodeHostActivationReceipt(
      document.receipt,
      `${valuePath}.receipt`,
    );
    if (receipt.requestId !== request.requestId) {
      throw new Error(`${valuePath}.receipt does not match its request.`);
    }
    const healthStep = steps[steps.length - 1];
    const publishedHealth =
      healthStep.status === AwsSingleNodeHostActivationStepStatus.SETTLED &&
      healthStep.evidence !== null
        ? healthStep.evidence.value.receipt
        : receipt.serviceHealthReceipt;
    const expectedReceipt = createAwsSingleNodeHostActivationReceipt({
      request,
      serviceHealthReceipt: publishedHealth,
    });
    if (receipt.receiptId !== expectedReceipt.receiptId) {
      throw new Error(`${valuePath}.receipt is not the exact request receipt.`);
    }
  }

  if (
    document.status === AwsSingleNodeHostActivationStateStatus.RUNNING &&
    (block !== null || receipt !== null)
  ) {
    throw new TypeError(
      `${valuePath} running state cannot contain a block or receipt.`,
    );
  }
  if (document.status === AwsSingleNodeHostActivationStateStatus.BLOCKED) {
    if (
      block === null ||
      receipt !== null ||
      allSettled ||
      steps[frontierIndex].status !==
        AwsSingleNodeHostActivationStepStatus.INTENDED ||
      block.step !== steps[frontierIndex].kind
    ) {
      throw new TypeError(
        `${valuePath} blocked state must bind its exact intended frontier.`,
      );
    }
  }
  if (document.status === AwsSingleNodeHostActivationStateStatus.SUCCEEDED) {
    if (!allSettled || block !== null || receipt === null) {
      throw new TypeError(
        `${valuePath} succeeded state requires every step and its exact receipt.`,
      );
    }
  } else if (receipt !== null) {
    throw new TypeError(
      `${valuePath}.receipt is only permitted in succeeded state.`,
    );
  }

  const payload = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_KIND,
      request,
      recordVersion,
      status: document.status,
      steps,
      block,
      receipt,
    }),
  );
  assertDomainSeparatedSha256Id(
    document.stateId,
    AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_PREFIX,
    `${valuePath}.stateId`,
  );
  const expectedId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.stateId !== expectedId) {
    throw new Error(`${valuePath}.stateId does not match its exact state.`);
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, stateId: expectedId }),
  );
}

/** @param {Readonly<Record<string, any>>} current @param {Record<string, any>} changes @returns {Readonly<Record<string, any>>} */
function createSuccessorState(current, changes) {
  return createState({
    schemaVersion: AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_KIND,
    request: current.request,
    recordVersion: current.recordVersion + 1,
    status: changes.status ?? current.status,
    steps: changes.steps ?? current.steps,
    block: Object.prototype.hasOwnProperty.call(changes, 'block')
      ? changes.block
      : current.block,
    receipt: Object.prototype.hasOwnProperty.call(changes, 'receipt')
      ? changes.receipt
      : current.receipt,
  });
}

/** @param {Readonly<Record<string, any>>} state @param {number} index @param {Record<string, any>} currentStep @returns {Readonly<Record<string, any>>[]} */
function replaceFrontierAndResetSuffix(state, index, currentStep) {
  return state.steps.map(
    (
      /** @type {Readonly<Record<string, any>>} */ step,
      /** @type {number} */ candidateIndex,
    ) => {
      if (candidateIndex < index) return step;
      if (candidateIndex === index) return Object.freeze(currentStep);
      return Object.freeze({
        intentId: step.intentId,
        kind: step.kind,
        status: AwsSingleNodeHostActivationStepStatus.PENDING,
        attemptGeneration: step.attemptGeneration,
        evidence: null,
      });
    },
  );
}

/** @param {Readonly<Record<string, any>>} state @param {number} index @returns {Readonly<Record<string, any>>} */
function createIntendedState(state, index) {
  const step = state.steps[index];
  const steps = replaceFrontierAndResetSuffix(state, index, {
    intentId: step.intentId,
    kind: step.kind,
    status: AwsSingleNodeHostActivationStepStatus.INTENDED,
    attemptGeneration: step.attemptGeneration,
    evidence: null,
  });
  return createSuccessorState(state, {
    status: AwsSingleNodeHostActivationStateStatus.RUNNING,
    steps,
    block: null,
    receipt: null,
  });
}

/** @param {Readonly<Record<string, any>>} state @param {number} index @returns {Readonly<Record<string, any>>} */
function createAttemptState(state, index) {
  const step = state.steps[index];
  if (step.status !== AwsSingleNodeHostActivationStepStatus.INTENDED) {
    throw new AwsSingleNodeHostActivationConflictError(
      'effect-attempt-without-intent',
    );
  }
  const steps = state.steps.map(
    (
      /** @type {Readonly<Record<string, any>>} */ candidate,
      /** @type {number} */ candidateIndex,
    ) =>
      candidateIndex === index
        ? Object.freeze({
            ...candidate,
            attemptGeneration: candidate.attemptGeneration + 1,
          })
        : candidate,
  );
  return createSuccessorState(state, { steps });
}

/** @param {Readonly<Record<string, any>>} state @param {number} index @param {Readonly<Record<string, any>>} evidence @returns {Readonly<Record<string, any>>} */
function createSettledState(state, index, evidence) {
  const step = state.steps[index];
  const steps = replaceFrontierAndResetSuffix(state, index, {
    intentId: step.intentId,
    kind: step.kind,
    status: AwsSingleNodeHostActivationStepStatus.SETTLED,
    attemptGeneration: step.attemptGeneration,
    evidence,
  });
  return createSuccessorState(state, {
    status: AwsSingleNodeHostActivationStateStatus.RUNNING,
    steps,
    block: null,
    receipt: null,
  });
}

/** @param {Readonly<Record<string, any>>} state @param {number} index @returns {Readonly<Record<string, any>>} */
function createBlockedState(state, index) {
  const step = state.steps[index];
  const steps = replaceFrontierAndResetSuffix(
    state,
    index,
    Object.freeze({
      intentId: step.intentId,
      kind: step.kind,
      status: AwsSingleNodeHostActivationStepStatus.INTENDED,
      attemptGeneration: step.attemptGeneration,
      evidence: null,
    }),
  );
  return createSuccessorState(state, {
    status: AwsSingleNodeHostActivationStateStatus.BLOCKED,
    steps,
    block: Object.freeze({
      step: step.kind,
      reason: 'observation-conflict',
    }),
    receipt: null,
  });
}

/** @param {unknown} value @param {Set<string>} keys @param {string} path @returns {Record<string, any>} */
function normalizeCallInput(value, keys, path) {
  const input = cloneBoundedJsonObject(value, 2048, path);
  assertExactKeys(input, keys, path);
  return input;
}

/** @param {unknown} value @param {Set<string>} keys @param {string} path @returns {Record<string, Function>} */
function validateFunctionPort(value, keys, path) {
  const port = assertExactObject(value, keys, path);
  /** @type {Record<string, Function>} */
  const snapshot = {};
  for (const key of keys) {
    if (typeof port[key] !== 'function') {
      throw new TypeError(`${path}.${key} must be a function.`);
    }
    snapshot[key] = port[key].bind(port);
  }
  return Object.freeze(snapshot);
}

/** @param {unknown} value @returns {{store: Record<string, Function>, withHostLock: Function, authorizeRequest: Function, adapters: ReadonlyArray<Readonly<Record<string, any>>>}} */
function validateFactoryOptions(value) {
  const options = assertExactObject(
    value,
    FACTORY_OPTION_KEYS,
    'awsSingleNodeHostActivationKernel.options',
  );
  const store = validateFunctionPort(
    options.store,
    STORE_KEYS,
    'awsSingleNodeHostActivationKernel.options.store',
  );
  if (typeof options.withHostLock !== 'function') {
    throw new TypeError(
      'awsSingleNodeHostActivationKernel.options.withHostLock must be a function.',
    );
  }
  if (typeof options.authorizeRequest !== 'function') {
    throw new TypeError(
      'awsSingleNodeHostActivationKernel.options.authorizeRequest must be a function.',
    );
  }
  const stepOptions = assertExactObject(
    options.steps,
    STEP_OPTION_KEYS,
    'awsSingleNodeHostActivationKernel.options.steps',
  );
  const adapters = STEP_OPTIONS.map((definition) => {
    const adapter = validateFunctionPort(
      stepOptions[definition.optionKey],
      definition.effectful ? EFFECT_ADAPTER_KEYS : READ_ONLY_ADAPTER_KEYS,
      `awsSingleNodeHostActivationKernel.options.steps.${definition.optionKey}`,
    );
    return Object.freeze({ ...definition, adapter });
  });
  return {
    store,
    withHostLock: options.withHostLock,
    authorizeRequest: options.authorizeRequest,
    adapters,
  };
}

/** @param {Readonly<Record<string, any>>} request @param {Readonly<Record<string, any>>} step @param {Readonly<Record<string, any>>} priorEvidence @returns {Readonly<Record<string, any>>} */
function createEffectContext(request, step, priorEvidence) {
  return deepFreeze({
    request,
    step: {
      intentId: step.intentId,
      kind: step.kind,
      attemptGeneration: step.attemptGeneration,
    },
    priorEvidence,
  });
}

/** @param {Readonly<Record<string, any>>} state @param {number} index @returns {Readonly<Record<string, any>>} */
function getPriorEvidence(state, index) {
  /** @type {Record<string, any>} */
  const evidence = {};
  for (let candidateIndex = 0; candidateIndex < index; candidateIndex += 1) {
    const step = state.steps[candidateIndex];
    if (
      step.status !== AwsSingleNodeHostActivationStepStatus.SETTLED ||
      step.evidence === null
    ) {
      throw new AwsSingleNodeHostActivationConflictError(
        'missing-prerequisite-evidence',
      );
    }
    evidence[step.kind] = step.evidence.value;
  }
  return deepFreeze(sortCanonicalJsonValue(evidence));
}

/** @param {Readonly<Record<string, any>>} request @param {Readonly<Record<string, any>>} step @param {Readonly<Record<string, any>>} priorEvidence @param {Readonly<Record<string, any>>} adapterDefinition @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function normalizeAdapterEvidence(
  request,
  step,
  priorEvidence,
  adapterDefinition,
  value,
  path,
) {
  const context = createEffectContext(request, step, priorEvidence);
  const validated = adapterDefinition.adapter.validateEvidence(value, context);
  let canonical = cloneBoundedJsonObject(
    validated,
    AWS_SINGLE_NODE_HOST_ACTIVATION_EVIDENCE_MAX_BYTES,
    path,
  );
  if (adapterDefinition.kind === 'health-publication') {
    canonical = validateDeploymentServiceHealthObservation(canonical, path);
    createAwsSingleNodeHostActivationReceipt({
      request,
      serviceHealthReceipt: canonical.receipt,
    });
  }
  assertEvidenceSecretFree(canonical, adapterDefinition.kind, path);
  return deepFreeze(sortCanonicalJsonValue(canonical));
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} request @param {Readonly<Record<string, any>>} step @param {Readonly<Record<string, any>>} priorEvidence @param {Readonly<Record<string, any>>} adapterDefinition @param {string} path @returns {Readonly<Record<string, any>>} */
function normalizeObservationResult(
  value,
  request,
  step,
  priorEvidence,
  adapterDefinition,
  path,
) {
  const result = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_ACTIVATION_OBSERVATION_MAX_BYTES,
    path,
  );
  if (!OBSERVATION_STATUSES.has(result.status)) {
    throw new TypeError(`${path}.status is not supported.`);
  }
  const keys =
    result.status === 'settled'
      ? new Set(['status', 'evidence'])
      : new Set(['status']);
  assertExactKeys(result, keys, path);
  if (result.status !== 'settled') {
    if (result.status === 'ready' && !adapterDefinition.effectful) {
      throw new TypeError(
        `${path}.status cannot be 'ready' for a read-only activation step.`,
      );
    }
    return Object.freeze({ status: result.status });
  }
  const evidence = normalizeAdapterEvidence(
    request,
    step,
    priorEvidence,
    adapterDefinition,
    result.evidence,
    `${path}.evidence`,
  );
  return Object.freeze({ status: 'settled', evidence });
}

/** @param {Readonly<Record<string, any>>} state @param {Readonly<Record<string, any>>} request @param {ReadonlyArray<Readonly<Record<string, any>>>} adapters @param {string} path @returns {Readonly<Record<string, any>>} */
function validateKernelState(state, request, adapters, path) {
  const canonical = validateAwsSingleNodeHostActivationState(state, path);
  if (!sameJson(canonical.request, request)) {
    throw new AwsSingleNodeHostActivationConflictError(
      'request-state-mismatch',
    );
  }
  /** @type {Record<string, any>} */
  const prior = {};
  for (let index = 0; index < canonical.steps.length; index += 1) {
    const step = canonical.steps[index];
    if (step.status !== AwsSingleNodeHostActivationStepStatus.SETTLED) break;
    const canonicalEvidence = normalizeAdapterEvidence(
      request,
      step,
      deepFreeze(sortCanonicalJsonValue({ ...prior })),
      adapters[index],
      step.evidence.value,
      `${path}.steps[${index}].evidence.value`,
    );
    const expectedObservation = createObservation(
      request.requestId,
      step.intentId,
      canonicalEvidence,
      `${path}.steps[${index}].evidence`,
    );
    if (
      expectedObservation.observationId !== step.evidence.observationId ||
      !sameJson(expectedObservation.value, step.evidence.value)
    ) {
      throw new AwsSingleNodeHostActivationConflictError(
        'stored-evidence-validator-mismatch',
      );
    }
    prior[step.kind] = canonicalEvidence;
  }
  if (canonical.status === AwsSingleNodeHostActivationStateStatus.SUCCEEDED) {
    const healthEvidence =
      canonical.steps[canonical.steps.length - 1].evidence.value;
    const expectedReceipt = createAwsSingleNodeHostActivationReceipt({
      request,
      serviceHealthReceipt: healthEvidence.receipt,
    });
    if (canonical.receipt.receiptId !== expectedReceipt.receiptId) {
      throw new AwsSingleNodeHostActivationConflictError(
        'terminal-receipt-mismatch',
      );
    }
  }
  return canonical;
}

/** @param {Readonly<Record<string, any>>} state @param {'succeeded'|'pending'|'blocked'} status @param {string|null} step @returns {Readonly<Record<string, any>>} */
function createResult(state, status, step) {
  const result = {
    status,
    requestId: state.request.requestId,
    stateId: state.stateId,
    recordVersion: state.recordVersion,
    step,
    receipt:
      status === 'succeeded'
        ? validateAwsSingleNodeHostActivationReceipt(state.receipt)
        : null,
  };
  assertExactKeys(result, RESULT_KEYS, 'awsSingleNodeHostActivationResult');
  return deepFreeze(sortCanonicalJsonValue(result));
}

/**
 * Create the pure durable host activation protocol. Concrete stores, locks,
 * AWS observations, filesystem operations, artifact publication, and service
 * commands remain injected. Every mutator is at-least-once convergent behind
 * a durable intent; this kernel does not claim exactly-once physical effects.
 *
 * `withHostLock` must exclude concurrent work for the supplied stable
 * deployment instance and release automatically when its callback exits or
 * its process dies. The state store is a root-owned authenticated
 * exclusive-writer security boundary; content IDs detect corruption but are
 * not MACs or signatures. Every store read must be strongly consistent. A
 * compare-and-set method may return `true` only to the one call that actually
 * changed the exact expected ID to the supplied successor; “already equals
 * next” is not success and cannot grant physical dispatch authority. The external
 * authority check and a local effect cannot be one distributed transaction:
 * adapters must therefore remain exact-convergent, and later reconciliation
 * repairs the narrow check-to-dispatch race rather than claiming physical
 * exactly-once execution.
 *
 * `authorizeRequest` must independently authenticate the request/current
 * head (and terminal receipt for replay) and return the literal boolean
 * `true`; hashes are never authorization. Observers must be side-effect-free,
 * live, and contextual. Evidence validators must be pure and deterministic.
 * Every `converge` adapter must be safe after an ambiguous prior attempt and
 * must not return while a spawned mutation is still running.
 *
 * @param {unknown} value - Exact store, host lock, and fixed step adapters.
 * @returns {Readonly<{converge: Function, resume: Function, inspect: Function}>} - Kernel API.
 */
export function createAwsSingleNodeHostActivationKernel(value) {
  const { store, withHostLock, authorizeRequest, adapters } =
    validateFactoryOptions(value);

  /**
   * Content addressing proves integrity, not controller authority. This
   * mandatory port must authenticate the request and re-prove it against the
   * trusted current authority source. It must also recognize the exact READY
   * successor when replaying an already-settled receipt.
   * @param {Readonly<Record<string, any>>} request - Exact V65 request.
   * @param {'claim'|'dispatch'|'settle'|'replay'} purpose - Authorization point.
   * @param {string|null} step - Fixed dispatch step, when applicable.
   * @param {Readonly<Record<string, any>>|null} receipt - Terminal replay receipt.
   * @returns {Promise<void>}
   */
  async function requireAuthority(request, purpose, step, receipt = null) {
    const authorized = await authorizeRequest(
      deepFreeze({ request, purpose, step, receipt }),
    );
    if (authorized !== true) {
      throw new AwsSingleNodeHostActivationConflictError(
        'request-not-authorized',
      );
    }
  }

  /** @param {string} deploymentInstanceId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readFence(deploymentInstanceId) {
    const stored = await store.readActivationFence(deploymentInstanceId);
    if (stored === null) return null;
    const fence = validateAwsSingleNodeHostActivationFence(
      stored,
      'awsSingleNodeHostActivationKernel stored fence',
    );
    if (fence.deploymentInstanceId !== deploymentInstanceId) {
      throw new AwsSingleNodeHostActivationConflictError('fence-key-mismatch');
    }
    return fence;
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<void>} */
  async function requireCurrentFence(request) {
    const fence = await readFence(request.deploymentInstanceId);
    if (fence === null) {
      throw new AwsSingleNodeHostActivationConflictError(
        'current-fence-missing',
      );
    }
    assertFenceMatchesRequest(fence, request, 'current-fence');
  }

  /** @param {string} requestId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readGenericState(requestId) {
    const stored = await store.readActivationState(requestId);
    if (stored === null) return null;
    const state = validateAwsSingleNodeHostActivationState(
      stored,
      'awsSingleNodeHostActivationKernel stored state',
    );
    if (state.request.requestId !== requestId) {
      throw new AwsSingleNodeHostActivationConflictError('state-key-mismatch');
    }
    return state;
  }

  /** @param {string} requestId @param {Readonly<Record<string, any>>} request @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readState(requestId, request) {
    const state = await readGenericState(requestId);
    return state === null
      ? null
      : validateKernelState(
          state,
          request,
          adapters,
          'awsSingleNodeHostActivationKernel stored state',
        );
  }

  /** @param {Readonly<Record<string, any>>|null} expected @param {Readonly<Record<string, any>>} next @returns {Promise<{fence: Readonly<Record<string, any>>, definite: boolean}>} */
  async function compareAndReadFence(expected, next) {
    let writeFailed = false;
    /** @type {unknown} */
    let writeError;
    /** @type {unknown} */
    let applied;
    try {
      applied = await store.compareAndSetActivationFence(
        Object.freeze({
          deploymentInstanceId: next.deploymentInstanceId,
          expectedFenceId: expected?.fenceId ?? null,
          nextFence: next,
        }),
      );
      if (typeof applied !== 'boolean') {
        throw new TypeError(
          'compareAndSetActivationFence must return a boolean.',
        );
      }
    } catch (error) {
      writeFailed = true;
      writeError = error;
    }
    let stored;
    try {
      stored = await readFence(next.deploymentInstanceId);
    } catch (error) {
      if (writeFailed) throw writeError;
      throw error;
    }
    if (stored !== null && stored.fenceId === next.fenceId) {
      return { fence: stored, definite: !writeFailed && applied === true };
    }
    if (writeFailed) throw writeError;
    throw new AwsSingleNodeHostActivationConflictError('fence-compare-and-set');
  }

  /** @param {Readonly<Record<string, any>>|null} expected @param {Readonly<Record<string, any>>} next @param {Readonly<Record<string, any>>} request @returns {Promise<{state: Readonly<Record<string, any>>, definite: boolean}>} */
  async function compareAndReadState(expected, next, request) {
    let writeFailed = false;
    /** @type {unknown} */
    let writeError;
    /** @type {unknown} */
    let applied;
    try {
      applied = await store.compareAndSetActivationState(
        Object.freeze({
          requestId: request.requestId,
          expectedStateId: expected?.stateId ?? null,
          nextState: next,
        }),
      );
      if (typeof applied !== 'boolean') {
        throw new TypeError(
          'compareAndSetActivationState must return a boolean.',
        );
      }
    } catch (error) {
      writeFailed = true;
      writeError = error;
    }
    let stored;
    try {
      stored = await readState(request.requestId, request);
    } catch (error) {
      if (writeFailed) throw writeError;
      throw error;
    }
    if (stored !== null && stored.stateId === next.stateId) {
      return { state: stored, definite: !writeFailed && applied === true };
    }
    if (writeFailed) throw writeError;
    throw new AwsSingleNodeHostActivationConflictError('state-compare-and-set');
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<Readonly<Record<string, any>>>} */
  async function claimFence(request) {
    const current = await readFence(request.deploymentInstanceId);
    if (current === null) {
      return (await compareAndReadFence(null, createFence(request, 1))).fence;
    }
    if (current.requestId === request.requestId) {
      assertFenceMatchesRequest(current, request, 'current-request');
      return current;
    }
    if (current.authorizedHeadGeneration >= request.authorizedHeadGeneration) {
      throw new AwsSingleNodeHostActivationConflictError(
        'stale-or-ambiguous-request',
      );
    }
    // The higher-generation request was just proven against the trusted
    // current authority source while this deployment lock is held. Advancing
    // the fence is the durable supersession point. The older state remains
    // inspectable, but every later old resume or dispatch is rejected.
    const next = createFence(request, current.recordVersion + 1);
    return (await compareAndReadFence(current, next)).fence;
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<Readonly<Record<string, any>>>} */
  async function loadOrCreateState(request) {
    const existing = await readState(request.requestId, request);
    if (existing !== null) return existing;
    const initial = createInitialState(request);
    return (await compareAndReadState(null, initial, request)).state;
  }

  /** @param {Readonly<Record<string, any>>} state @param {number} index @returns {Promise<ReturnType<typeof normalizeObservationResult>>} */
  async function observe(state, index) {
    const step = state.steps[index];
    const priorEvidence = getPriorEvidence(state, index);
    const context = createEffectContext(state.request, step, priorEvidence);
    return normalizeObservationResult(
      await adapters[index].adapter.observe(context),
      state.request,
      step,
      priorEvidence,
      adapters[index],
      `awsSingleNodeHostActivationKernel.${step.kind}.observation`,
    );
  }

  /** @param {Readonly<Record<string, any>>} state @returns {Promise<Readonly<Record<string, any>>>} */
  async function finish(state) {
    const healthStep = state.steps[state.steps.length - 1];
    if (
      healthStep.status !== AwsSingleNodeHostActivationStepStatus.SETTLED ||
      healthStep.evidence === null
    ) {
      throw new AwsSingleNodeHostActivationConflictError(
        'receipt-before-health-publication',
      );
    }
    await requireAuthority(state.request, 'settle', null);
    await requireCurrentFence(state.request);
    const receipt = createAwsSingleNodeHostActivationReceipt({
      request: state.request,
      serviceHealthReceipt: healthStep.evidence.value.receipt,
    });
    const successor = createSuccessorState(state, {
      status: AwsSingleNodeHostActivationStateStatus.SUCCEEDED,
      block: null,
      receipt,
    });
    return (await compareAndReadState(state, successor, state.request)).state;
  }

  /** @param {Readonly<Record<string, any>>} initial @returns {Promise<Readonly<Record<string, any>>>} */
  async function run(initial) {
    let state = initial;
    /** @type {Map<string, string>} */
    const fresh = new Map();

    convergence: for (
      let cycle = 0;
      cycle < MAX_CONVERGENCE_CYCLES;
      cycle += 1
    ) {
      if (state.status === AwsSingleNodeHostActivationStateStatus.SUCCEEDED) {
        // Terminal receipts are immutable historical settlement. Ongoing
        // liveness belongs to the resident health/reconciliation loop.
        await requireAuthority(state.request, 'replay', null, state.receipt);
        await requireCurrentFence(state.request);
        return createResult(state, 'succeeded', null);
      }

      for (let index = 0; index < state.steps.length; index += 1) {
        let step = state.steps[index];
        if (step.status === AwsSingleNodeHostActivationStepStatus.PENDING) {
          const intended = createIntendedState(state, index);
          state = (await compareAndReadState(state, intended, state.request))
            .state;
          continue convergence;
        }

        if (
          step.status === AwsSingleNodeHostActivationStepStatus.SETTLED &&
          fresh.get(step.kind) === step.evidence.observationId
        ) {
          continue;
        }

        const observed = await observe(state, index);
        step = state.steps[index];
        if (observed.status === 'settled') {
          const evidence = createObservation(
            state.request.requestId,
            step.intentId,
            observed.evidence,
            `awsSingleNodeHostActivationKernel.${step.kind}.evidence`,
          );
          if (
            step.status === AwsSingleNodeHostActivationStepStatus.SETTLED &&
            step.evidence.observationId === evidence.observationId
          ) {
            fresh.set(step.kind, evidence.observationId);
            continue;
          }
          const settled = createSettledState(state, index, evidence);
          state = (await compareAndReadState(state, settled, state.request))
            .state;
          for (
            let suffix = index + 1;
            suffix < STEP_OPTIONS.length;
            suffix += 1
          ) {
            fresh.delete(STEP_OPTIONS[suffix].kind);
          }
          fresh.set(step.kind, evidence.observationId);
          continue convergence;
        }

        if (observed.status === 'unknown') {
          return createResult(
            state,
            state.status === AwsSingleNodeHostActivationStateStatus.BLOCKED
              ? 'blocked'
              : 'pending',
            state.status === AwsSingleNodeHostActivationStateStatus.BLOCKED
              ? (state.block?.step ?? step.kind)
              : step.kind,
          );
        }

        if (observed.status === 'conflict') {
          if (
            state.status === AwsSingleNodeHostActivationStateStatus.BLOCKED &&
            state.block?.step === step.kind
          ) {
            return createResult(state, 'blocked', step.kind);
          }
          const blocked = createBlockedState(state, index);
          state = (await compareAndReadState(state, blocked, state.request))
            .state;
          return createResult(state, 'blocked', step.kind);
        }

        if (
          state.status === AwsSingleNodeHostActivationStateStatus.BLOCKED ||
          step.status === AwsSingleNodeHostActivationStepStatus.SETTLED
        ) {
          const intended = createIntendedState(state, index);
          state = (await compareAndReadState(state, intended, state.request))
            .state;
          for (let suffix = index; suffix < STEP_OPTIONS.length; suffix += 1) {
            fresh.delete(STEP_OPTIONS[suffix].kind);
          }
          continue convergence;
        }

        const attempted = createAttemptState(state, index);
        const claim = await compareAndReadState(
          state,
          attempted,
          state.request,
        );
        state = claim.state;
        if (!claim.definite) {
          // An exact readback proves durable intent, not exclusive dispatch
          // authority. Reobserve and make a fresh definite attempt claim.
          continue convergence;
        }

        const effectStep = state.steps[index];
        await requireAuthority(state.request, 'dispatch', effectStep.kind);
        await requireCurrentFence(state.request);
        const effectContext = createEffectContext(
          state.request,
          effectStep,
          getPriorEvidence(state, index),
        );
        /** @type {unknown} */
        let effectError;
        let effectFailed = false;
        try {
          // Mutation responses are deliberately ignored. Only the observer
          // can provide settlement evidence.
          await adapters[index].adapter.converge(effectContext);
        } catch (error) {
          effectFailed = true;
          effectError = error;
        }
        // Any physical mutation may have invalidated an earlier projection.
        // Re-prove the complete prerequisite prefix before another mutator or
        // the terminal receipt, even when this step settles immediately.
        fresh.clear();

        let after;
        try {
          after = await observe(state, index);
        } catch (error) {
          if (effectFailed) {
            throw new AwsSingleNodeHostActivationEffectError(
              effectStep.kind,
              new AggregateError(
                [effectError, error],
                'Effect and exact post-effect observation both failed.',
              ),
            );
          }
          throw error;
        }

        if (after.status === 'settled') {
          const evidence = createObservation(
            state.request.requestId,
            effectStep.intentId,
            after.evidence,
            `awsSingleNodeHostActivationKernel.${effectStep.kind}.evidence`,
          );
          const settled = createSettledState(state, index, evidence);
          state = (await compareAndReadState(state, settled, state.request))
            .state;
          fresh.set(effectStep.kind, evidence.observationId);
          continue convergence;
        }
        if (after.status === 'conflict') {
          const blocked = createBlockedState(state, index);
          state = (await compareAndReadState(state, blocked, state.request))
            .state;
          return createResult(state, 'blocked', effectStep.kind);
        }
        if (effectFailed) {
          throw new AwsSingleNodeHostActivationEffectError(
            effectStep.kind,
            effectError,
          );
        }
        return createResult(state, 'pending', effectStep.kind);
      }

      for (const step of state.steps) {
        if (
          step.status !== AwsSingleNodeHostActivationStepStatus.SETTLED ||
          fresh.get(step.kind) !== step.evidence.observationId
        ) {
          throw new AwsSingleNodeHostActivationConflictError(
            'receipt-without-fresh-prerequisites',
          );
        }
      }
      state = await finish(state);
      return createResult(state, 'succeeded', null);
    }
    throw new AwsSingleNodeHostActivationConflictError(
      'finite-convergence-bound-exceeded',
    );
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<Readonly<Record<string, any>>>} */
  async function runLocked(request) {
    await requireAuthority(request, 'claim', null);
    // Persist the complete immutable request before the smaller current-
    // authority fence. A crash between these writes remains resumable from
    // requestId alone; neither record permits a physical effect by itself.
    const state = await loadOrCreateState(request);
    await claimFence(request);
    return await run(state);
  }

  /**
   * Start or reenter one exact V65 activation request.
   * @param {unknown} value - Canonical activation request.
   * @returns {Promise<Readonly<Record<string, any>>>} - Finite result.
   */
  async function converge(value) {
    const request = validateAwsSingleNodeHostActivationRequest(
      value,
      'awsSingleNodeHostActivationKernel.converge.request',
    );
    return await withHostLock(
      Object.freeze({
        deploymentInstanceId: request.deploymentInstanceId,
      }),
      async () => await runLocked(request),
    );
  }

  /**
   * Resume using the complete request retained in durable state.
   * @param {unknown} value - Exact request ID.
   * @returns {Promise<Readonly<Record<string, any>>>} - Finite result.
   */
  async function resume(value) {
    const input = normalizeCallInput(
      value,
      RESUME_INPUT_KEYS,
      'awsSingleNodeHostActivationKernel.resume',
    );
    assertDomainSeparatedSha256Id(
      input.requestId,
      AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
      'awsSingleNodeHostActivationKernel.resume.requestId',
    );
    const outside = await readGenericState(input.requestId);
    if (outside === null) {
      throw new AwsSingleNodeHostActivationNotFoundError(input.requestId);
    }
    return await withHostLock(
      Object.freeze({
        deploymentInstanceId: outside.request.deploymentInstanceId,
      }),
      async () => {
        const current = await readGenericState(input.requestId);
        if (current === null) {
          throw new AwsSingleNodeHostActivationNotFoundError(input.requestId);
        }
        return await runLocked(current.request);
      },
    );
  }

  /**
   * Read one historical durable snapshot without locks, fence interpretation,
   * observations, or effects. A superseded request intentionally remains
   * inspectable here; operator tooling must compare its deployment fence
   * before presenting it as current work.
   * @param {unknown} value - Exact request ID.
   * @returns {Promise<Readonly<Record<string, any>>|null>} - State or null.
   */
  async function inspect(value) {
    const input = normalizeCallInput(
      value,
      INSPECT_INPUT_KEYS,
      'awsSingleNodeHostActivationKernel.inspect',
    );
    assertDomainSeparatedSha256Id(
      input.requestId,
      AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
      'awsSingleNodeHostActivationKernel.inspect.requestId',
    );
    const state = await readGenericState(input.requestId);
    return state === null
      ? null
      : validateKernelState(
          state,
          state.request,
          adapters,
          'awsSingleNodeHostActivationKernel inspected state',
        );
  }

  return Object.freeze({ converge, resume, inspect });
}

export default {
  AWS_SINGLE_NODE_HOST_ACTIVATION_EVIDENCE_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_KIND,
  AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_ACTIVATION_INTENT_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_ACTIVATION_INTENT_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_ACTIVATION_OBSERVATION_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_ACTIVATION_OBSERVATION_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_ACTIVATION_OBSERVATION_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_KIND,
  AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_ACTIVATION_STEP_KINDS,
  AwsSingleNodeHostActivationConflictError,
  AwsSingleNodeHostActivationEffectError,
  AwsSingleNodeHostActivationNotFoundError,
  AwsSingleNodeHostActivationStateStatus,
  AwsSingleNodeHostActivationStepStatus,
  createAwsSingleNodeHostActivationKernel,
  getAwsSingleNodeHostActivationIntentId,
  validateAwsSingleNodeHostActivationFence,
  validateAwsSingleNodeHostActivationState,
};
