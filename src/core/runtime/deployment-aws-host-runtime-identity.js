/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- This narrow internal adapter keeps its complete port types inline. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { validateAwsSingleNodeHostActivationRequest } from './deployment-aws-host-agent-contract.js';
import { getAwsSingleNodeHostActivationIntentId } from './deployment-aws-host-activation.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND =
  'awsSingleNodeHostRuntimeIdentityEvidence';
export const AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_MAX_BYTES =
  8 * 1024;
export const AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_DEFAULT_ATTEMPT_TIMEOUT_MILLISECONDS = 10_000;
export const AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_MAX_ATTEMPT_TIMEOUT_MILLISECONDS = 60_000;

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'attemptTimeoutMilliseconds',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const CLIENT_KEYS = new Set(['getCallerIdentity']);
const CONTEXT_KEYS = new Set(['request', 'step', 'priorEvidence']);
const STEP_KEYS = new Set(['intentId', 'kind', 'attemptGeneration']);
const EVIDENCE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'requestId',
  'accountId',
  'userId',
  'arn',
]);
const RUNTIME_IDENTITY_STEP = 'runtime-identity';

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertExactKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertSupportedKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertRequiredKeys(value, keys, path) {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
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

/** @param {number} attempt @returns {Promise<void>} */
async function defaultWaitForRetry(attempt) {
  const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/** @param {unknown} value @returns {Readonly<{Account: string, UserId: string, Arn: string}>|null} */
function decodeCallerIdentity(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    /** @type {Record<string, string>} */
    const identity = {};
    for (const key of ['Account', 'UserId', 'Arn']) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, 'value') ||
        typeof descriptor.value !== 'string'
      ) {
        return null;
      }
      identity[key] = descriptor.value;
    }
    return Object.freeze(
      /** @type {{Account: string, UserId: string, Arn: string}} */ (identity),
    );
  } catch {
    // Provider proxies and accessors are not allowed to escape raw failures.
    return null;
  }
}

/** @param {Readonly<Record<string, any>>} request @returns {Readonly<Record<string, string>>} */
function expectedIdentity(request) {
  const accountId = request.providerScope.accountId;
  const sessionName = request.nodeProviderResourceId;
  return Object.freeze({
    accountId,
    userId: `${request.runtimeRoleId}:${sessionName}`,
    arn: `arn:${request.providerScope.partition}:sts::${accountId}:assumed-role/${request.runtimeRoleName}/${sessionName}`,
  });
}

/**
 * Revalidate the exact context supplied by the V66 runtime-identity step.
 * This is configuration/authority validation and therefore rejects before
 * provider I/O rather than turning a malformed caller into provider conflict.
 * @param {unknown} value - Candidate activation adapter context.
 * @param {Readonly<Record<string, any>>|null} [boundProviderScope] - Optional factory-bound scope.
 * @returns {Readonly<{request: Readonly<Record<string, any>>, expected: Readonly<Record<string, string>>}>}
 */
function validateContext(value, boundProviderScope = null) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeHostRuntimeIdentity context must be an object.',
    );
  }
  assertExactKeys(
    value,
    CONTEXT_KEYS,
    'awsSingleNodeHostRuntimeIdentity context',
  );
  const request = validateAwsSingleNodeHostActivationRequest(
    value.request,
    'awsSingleNodeHostRuntimeIdentity context.request',
  );
  if (
    boundProviderScope !== null &&
    !sameJson(request.providerScope, boundProviderScope)
  ) {
    throw new Error(
      'awsSingleNodeHostRuntimeIdentity context provider scope does not match the bound scope.',
    );
  }
  if (!isPlainObject(value.step)) {
    throw new TypeError(
      'awsSingleNodeHostRuntimeIdentity context.step must be an object.',
    );
  }
  assertExactKeys(
    value.step,
    STEP_KEYS,
    'awsSingleNodeHostRuntimeIdentity context.step',
  );
  if (value.step.kind !== RUNTIME_IDENTITY_STEP) {
    throw new TypeError(
      `awsSingleNodeHostRuntimeIdentity context.step.kind must be '${RUNTIME_IDENTITY_STEP}'.`,
    );
  }
  const expectedIntentId = getAwsSingleNodeHostActivationIntentId(
    request,
    RUNTIME_IDENTITY_STEP,
  );
  if (value.step.intentId !== expectedIntentId) {
    throw new Error(
      'awsSingleNodeHostRuntimeIdentity context.step.intentId does not match its exact request.',
    );
  }
  if (value.step.attemptGeneration !== 0) {
    throw new TypeError(
      'awsSingleNodeHostRuntimeIdentity context.step.attemptGeneration must be zero for the read-only identity step.',
    );
  }
  if (!isPlainObject(value.priorEvidence)) {
    throw new TypeError(
      'awsSingleNodeHostRuntimeIdentity context.priorEvidence must be an object.',
    );
  }
  assertExactKeys(
    value.priorEvidence,
    new Set(),
    'awsSingleNodeHostRuntimeIdentity context.priorEvidence',
  );
  return Object.freeze({ request, expected: expectedIdentity(request) });
}

/** @param {Readonly<Record<string, any>>} request @param {Readonly<Record<string, string>>} expected @returns {Readonly<Record<string, any>>} */
function createEvidence(request, expected) {
  return deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion:
        AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
      requestId: request.requestId,
      accountId: expected.accountId,
      userId: expected.userId,
      arn: expected.arn,
    }),
  );
}

/**
 * Validate and request-bind one settled live STS identity projection.
 * @param {unknown} value - Candidate durable evidence.
 * @param {unknown} context - Exact V66 runtime-identity adapter context.
 * @param {string} [valuePath] - Human-readable evidence path.
 * @returns {Readonly<Record<string, any>>} - Canonical frozen evidence.
 */
export function validateAwsSingleNodeHostRuntimeIdentityEvidence(
  value,
  context,
  valuePath = 'awsSingleNodeHostRuntimeIdentityEvidence',
) {
  const validated = validateContext(context);
  const evidence = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_MAX_BYTES,
    valuePath,
  );
  assertExactKeys(evidence, EVIDENCE_KEYS, valuePath);
  if (
    evidence.schemaVersion !==
    AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION
  ) {
    throw new TypeError(`${valuePath}.schemaVersion must be the integer 1.`);
  }
  if (evidence.kind !== AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND) {
    throw new TypeError(
      `${valuePath}.kind must be '${AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND}'.`,
    );
  }
  const expected = createEvidence(validated.request, validated.expected);
  for (const key of ['requestId', 'accountId', 'userId', 'arn']) {
    if (evidence[key] !== expected[key]) {
      throw new Error(`${valuePath}.${key} does not match the exact request.`);
    }
  }
  assertManifestIsSecretFree(expected, valuePath);
  return expected;
}

/**
 * Create the read-only live STS adapter for the first V66 activation stage.
 * It accepts only credentials for the exact EC2 instance-profile role session
 * pinned by the activation request. Provider failures and malformed envelopes
 * are bounded uncertainty; only a final well-formed different identity is a
 * durable conflict.
 * The narrow client receives `({}, {abortSignal})` and must pass that signal
 * to its underlying transport; the local race also bounds lock residence when
 * a faulty client ignores cancellation.
 * @param {unknown} value - Exact narrow client, bound scope, and retry policy.
 * @returns {Readonly<{observe: Function, validateEvidence: Function}>}
 */
export function createAwsSingleNodeHostRuntimeIdentityAdapter(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeHostRuntimeIdentity options must be an object.',
    );
  }
  assertSupportedKeys(
    value,
    FACTORY_KEYS,
    'awsSingleNodeHostRuntimeIdentity options',
  );
  assertRequiredKeys(
    value,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeHostRuntimeIdentity options',
  );
  if (!isPlainObject(value.client)) {
    throw new TypeError(
      'awsSingleNodeHostRuntimeIdentity options.client must be an object.',
    );
  }
  assertExactKeys(
    value.client,
    CLIENT_KEYS,
    'awsSingleNodeHostRuntimeIdentity options.client',
  );
  const getCallerIdentityDescriptor = Object.getOwnPropertyDescriptor(
    value.client,
    'getCallerIdentity',
  );
  if (
    getCallerIdentityDescriptor === undefined ||
    !Object.hasOwn(getCallerIdentityDescriptor, 'value') ||
    typeof getCallerIdentityDescriptor.value !== 'function'
  ) {
    throw new TypeError(
      'awsSingleNodeHostRuntimeIdentity options.client.getCallerIdentity must be an own data-property function.',
    );
  }
  const getCallerIdentity = getCallerIdentityDescriptor.value;
  const client = Object.freeze({
    getCallerIdentity: getCallerIdentity.bind(value.client),
  });
  const providerScope = validateProviderScope(
    value.providerScope,
    'awsSingleNodeHostRuntimeIdentity options.providerScope',
  );
  const maxAttempts = Object.hasOwn(value, 'maxAttempts')
    ? value.maxAttempts
    : AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeHostRuntimeIdentity options.maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_MAX_ATTEMPTS}.`,
    );
  }
  const attemptTimeoutMilliseconds = Object.hasOwn(
    value,
    'attemptTimeoutMilliseconds',
  )
    ? value.attemptTimeoutMilliseconds
    : AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_DEFAULT_ATTEMPT_TIMEOUT_MILLISECONDS;
  if (
    !Number.isSafeInteger(attemptTimeoutMilliseconds) ||
    attemptTimeoutMilliseconds < 1 ||
    attemptTimeoutMilliseconds >
      AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_MAX_ATTEMPT_TIMEOUT_MILLISECONDS
  ) {
    throw new TypeError(
      `awsSingleNodeHostRuntimeIdentity options.attemptTimeoutMilliseconds must be an integer from 1 through ${AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_MAX_ATTEMPT_TIMEOUT_MILLISECONDS}.`,
    );
  }
  const waitForRetry = Object.hasOwn(value, 'waitForRetry')
    ? value.waitForRetry
    : defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeHostRuntimeIdentity options.waitForRetry must be a function.',
    );
  }

  /** @returns {Promise<Readonly<{status: 'response', value: unknown}>|Readonly<{status: 'unknown'}>>} */
  async function readCallerIdentity() {
    const controller = new AbortController();
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let timeoutId;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        resolve(Object.freeze({ status: 'unknown' }));
      }, attemptTimeoutMilliseconds);
    });
    const call = Promise.resolve()
      .then(() =>
        client.getCallerIdentity(
          Object.freeze({}),
          Object.freeze({ abortSignal: controller.signal }),
        ),
      )
      .then(
        (response) => Object.freeze({ status: 'response', value: response }),
        () => Object.freeze({ status: 'unknown' }),
      );
    const outcome = await Promise.race([call, timeout]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    return /** @type {Readonly<{status: 'response', value: unknown}>|Readonly<{status: 'unknown'}>} */ (
      outcome
    );
  }

  /** @param {unknown} value @param {unknown} context @returns {Readonly<Record<string, any>>} */
  function validateEvidence(value, context) {
    validateContext(context, providerScope);
    return validateAwsSingleNodeHostRuntimeIdentityEvidence(value, context);
  }

  /** @param {unknown} context @returns {Promise<Readonly<Record<string, any>>>} */
  async function observe(context) {
    const validated = validateContext(context, providerScope);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const outcome = await readCallerIdentity();
      if (outcome.status === 'response') {
        const identity = decodeCallerIdentity(outcome.value);
        if (identity !== null) {
          if (
            identity.Account === validated.expected.accountId &&
            identity.UserId === validated.expected.userId &&
            identity.Arn === validated.expected.arn
          ) {
            return deepFreeze({
              status: 'settled',
              evidence: createEvidence(validated.request, validated.expected),
            });
          }
          if (attempt === maxAttempts) {
            return Object.freeze({ status: 'conflict' });
          }
        } else if (attempt === maxAttempts) {
          return Object.freeze({ status: 'unknown' });
        }
      } else if (attempt === maxAttempts) {
        return Object.freeze({ status: 'unknown' });
      }
      try {
        await waitForRetry(attempt);
      } catch {
        return Object.freeze({ status: 'unknown' });
      }
    }
    return Object.freeze({ status: 'unknown' });
  }

  return Object.freeze({ observe, validateEvidence });
}

export default {
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_DEFAULT_ATTEMPT_TIMEOUT_MILLISECONDS,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_MAX_ATTEMPT_TIMEOUT_MILLISECONDS,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_MAX_ATTEMPTS,
  createAwsSingleNodeHostRuntimeIdentityAdapter,
  validateAwsSingleNodeHostRuntimeIdentityEvidence,
};
