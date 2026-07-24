/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable observer contracts are clearer than repeated parser-specific expansions. */

import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import {
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_DISCOVERY_PAGES,
  AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError,
  AwsSingleNodeInternetGatewayAttachmentEvidenceTransientError,
  AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError,
  createAwsSingleNodeInternetGatewayAttachmentStateDigest,
  decodeAwsSingleNodeBroadInternetGatewayAttachmentState,
  decodeAwsSingleNodeExactInternetGatewayAttachmentResponse,
  decodeAwsSingleNodeExactInternetGatewayAttachmentState,
  decodeAwsSingleNodeInternetGatewayAttachmentDiscoveryPage,
  getAwsSingleNodeInternetGatewayAttachmentProviderResourceId,
  getAwsSingleNodeInternetGatewayAttachmentStrongestEvidenceError,
  validateAwsSingleNodeInternetGatewayAttachmentInternetGatewayId,
  validateAwsSingleNodeInternetGatewayAttachmentVpcId,
} from './deployment-aws-internet-gateway-attachment-evidence.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import { validateAwsSingleNodeResourceObservation } from './deployment-aws-resource-observation.js';
import { validateProviderScope } from './deployment-provider-scope.js';

export {
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_ATTEMPTS,
};

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const CLIENT_KEYS = new Set(['describeInternetGateways']);
const AUTHORITY_KEYS = new Set([
  'operation',
  'deploymentRevision',
  'profile',
  'providerScope',
  'providerSpec',
  'deploymentInstanceId',
  'incarnationId',
  'head',
  'plan',
  'settledPlan',
  'target',
  'binding',
  'currentAction',
]);
const RESOURCE_KEY = 'network-internet-gateway-attachment';
const PROVIDER_TYPE = 'ec2-internet-gateway-attachment';
const VPC_RESOURCE_KEY = 'network-vpc';
const VPC_PROVIDER_TYPE = 'ec2-vpc';
const INTERNET_GATEWAY_RESOURCE_KEY = 'network-internet-gateway';
const INTERNET_GATEWAY_PROVIDER_TYPE = 'ec2-internet-gateway';
const AUTHORITY_ERROR =
  'AWS single-node internet-gateway-attachment observation authority does not match the exact managed relationship contract.';

/** Exact durable authority cannot select this derived relationship read mode. */
export class AwsSingleNodeInternetGatewayAttachmentResourceObserverAuthorityError extends Error {
  constructor() {
    super(AUTHORITY_ERROR);
    this.name =
      'AwsSingleNodeInternetGatewayAttachmentResourceObserverAuthorityError';
    this.code =
      'AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_RESOURCE_OBSERVER_AUTHORITY';
  }
}

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

/** @param {unknown} error @param {string} name @returns {boolean} */
function errorNamed(error, name) {
  return (
    error !== null &&
    typeof error === 'object' &&
    /** @type {Record<string, any>} */ (error).name === name
  );
}

/** @param {number} attempt @returns {Promise<void>} */
async function defaultWaitForRetry(attempt) {
  const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/** @param {unknown} authority @returns {Readonly<Record<string, any>>} */
function revalidateAuthority(authority) {
  if (!isPlainObject(authority)) {
    throw new TypeError(
      'awsSingleNodeInternetGatewayAttachmentResourceObserver context must be an object.',
    );
  }
  assertExactKeys(
    authority,
    AUTHORITY_KEYS,
    'awsSingleNodeInternetGatewayAttachmentResourceObserver context',
  );
  const canonical = createAwsSingleNodeResourceObservationAuthority({
    operation: authority.operation,
    deploymentRevision: authority.deploymentRevision,
    profile: authority.profile,
    providerScope: authority.providerScope,
    providerSpec: authority.providerSpec,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
    head: authority.head,
    plan: authority.plan,
    settledPlan: authority.settledPlan,
    target: authority.target,
  });
  if (
    !sameJson(authority.binding, canonical.binding) ||
    !sameJson(authority.currentAction, canonical.currentAction)
  ) {
    throw new AwsSingleNodeInternetGatewayAttachmentResourceObserverAuthorityError();
  }
  return canonical;
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} authority @param {string} resourceKey @param {string} providerType @param {string} roleKind @returns {string} */
function assertEndpointBinding(
  binding,
  authority,
  resourceKey,
  providerType,
  roleKind,
) {
  if (
    binding.resourceKey !== resourceKey ||
    binding.capability.kind !== 'networking' ||
    binding.capability.version !== 1 ||
    binding.role.kind !== roleKind ||
    binding.role.version !== 1 ||
    binding.management !== 'managed' ||
    binding.ownershipMode !== 'direct' ||
    binding.onDestroy !== 'purge' ||
    binding.dependencyBindings.length !== 0 ||
    binding.providerType !== providerType ||
    binding.providerScopeId !== authority.providerScope.providerScopeId ||
    binding.deploymentInstanceId !== authority.deploymentInstanceId ||
    binding.incarnationId !== authority.incarnationId
  ) {
    throw new AwsSingleNodeInternetGatewayAttachmentResourceObserverAuthorityError();
  }
  try {
    return resourceKey === VPC_RESOURCE_KEY
      ? validateAwsSingleNodeInternetGatewayAttachmentVpcId(
          binding.providerResourceId,
        )
      : validateAwsSingleNodeInternetGatewayAttachmentInternetGatewayId(
          binding.providerResourceId,
        );
  } catch {
    throw new AwsSingleNodeInternetGatewayAttachmentResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {{internetGatewayId: string|null, vpcId: string|null, providerResourceId: string|null}} */
function assertRelationshipAuthority(authority) {
  const target = authority.target;
  if (
    target.resourceKey !== RESOURCE_KEY ||
    target.capability.kind !== 'networking' ||
    target.capability.version !== 1 ||
    target.role.kind !== 'internet-gateway-attachment' ||
    target.role.version !== 1 ||
    target.management !== 'managed' ||
    target.ownershipMode !== 'derived' ||
    target.onDestroy !== 'purge' ||
    !sameJson(target.dependsOn, [
      VPC_RESOURCE_KEY,
      INTERNET_GATEWAY_RESOURCE_KEY,
    ]) ||
    target.target.providerType !== PROVIDER_TYPE
  ) {
    throw new AwsSingleNodeInternetGatewayAttachmentResourceObserverAuthorityError();
  }
  const endpointBindings = new Map();
  for (const resourceKey of [VPC_RESOURCE_KEY, INTERNET_GATEWAY_RESOURCE_KEY]) {
    const matches = authority.head.resourceBindings.filter(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.resourceKey === resourceKey,
    );
    if (matches.length > 1) {
      throw new AwsSingleNodeInternetGatewayAttachmentResourceObserverAuthorityError();
    }
    if (matches.length === 1) endpointBindings.set(resourceKey, matches[0]);
  }
  const binding = authority.binding;
  const currentAction = authority.currentAction?.action ?? null;
  if (
    (binding !== null && currentAction?.action === 'create') ||
    (binding === null &&
      currentAction !== null &&
      currentAction.action !== 'create')
  ) {
    throw new AwsSingleNodeInternetGatewayAttachmentResourceObserverAuthorityError();
  }
  if (endpointBindings.size !== 2) {
    if (binding !== null || currentAction?.action === 'create') {
      throw new AwsSingleNodeInternetGatewayAttachmentResourceObserverAuthorityError();
    }
    return {
      internetGatewayId: null,
      vpcId: null,
      providerResourceId: null,
    };
  }
  const vpcBinding = endpointBindings.get(VPC_RESOURCE_KEY);
  const internetGatewayBinding = endpointBindings.get(
    INTERNET_GATEWAY_RESOURCE_KEY,
  );
  const vpcId = assertEndpointBinding(
    vpcBinding,
    authority,
    VPC_RESOURCE_KEY,
    VPC_PROVIDER_TYPE,
    'vpc',
  );
  const internetGatewayId = assertEndpointBinding(
    internetGatewayBinding,
    authority,
    INTERNET_GATEWAY_RESOURCE_KEY,
    INTERNET_GATEWAY_PROVIDER_TYPE,
    'internet-gateway',
  );
  const providerResourceId =
    getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
      internetGatewayId,
      vpcId,
    );
  if (binding !== null) {
    const dependencyBindings = [
      {
        resourceKey: VPC_RESOURCE_KEY,
        bindingId: vpcBinding.bindingId,
      },
      {
        resourceKey: INTERNET_GATEWAY_RESOURCE_KEY,
        bindingId: internetGatewayBinding.bindingId,
      },
    ].sort((left, right) =>
      compareCanonicalStrings(left.resourceKey, right.resourceKey),
    );
    if (
      binding.resourceKey !== RESOURCE_KEY ||
      binding.capability.kind !== 'networking' ||
      binding.capability.version !== 1 ||
      binding.role.kind !== 'internet-gateway-attachment' ||
      binding.role.version !== 1 ||
      binding.management !== 'managed' ||
      binding.ownershipMode !== 'derived' ||
      binding.onDestroy !== 'purge' ||
      binding.providerType !== PROVIDER_TYPE ||
      binding.providerResourceId !== providerResourceId ||
      binding.providerScopeId !== authority.providerScope.providerScopeId ||
      binding.deploymentInstanceId !== authority.deploymentInstanceId ||
      binding.incarnationId !== authority.incarnationId ||
      !sameJson(binding.dependencyBindings, dependencyBindings)
    ) {
      throw new AwsSingleNodeInternetGatewayAttachmentResourceObserverAuthorityError();
    }
  }
  return { internetGatewayId, vpcId, providerResourceId };
}

/** @returns {Readonly<Record<string, any>>} */
function absentObservation() {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: RESOURCE_KEY,
    presence: 'absent',
    ownership: 'missing',
    providerIdentity: null,
    observedDigest: null,
    health: 'absent',
    execution: 'none',
  });
}

/** @returns {Readonly<Record<string, any>>} */
function unknownObservation() {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: RESOURCE_KEY,
    presence: 'unknown',
    ownership: 'unknown',
    providerIdentity: null,
    observedDigest: null,
    health: 'unknown',
    execution: 'none',
  });
}

/** @param {string} providerResourceId @returns {Readonly<Record<string, any>>} */
function verifiedObservation(providerResourceId) {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: RESOURCE_KEY,
    presence: 'present',
    ownership: 'verified',
    providerIdentity: {
      providerType: PROVIDER_TYPE,
      providerResourceId,
    },
    observedDigest: createAwsSingleNodeInternetGatewayAttachmentStateDigest({
      state: 'available',
      onDestroy: 'purge',
    }),
    health: 'not-applicable',
    execution: 'none',
  });
}

/** @param {string} providerResourceId @returns {Readonly<Record<string, any>>} */
function conflictObservation(providerResourceId) {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: RESOURCE_KEY,
    presence: 'present',
    ownership: 'conflict',
    providerIdentity: {
      providerType: PROVIDER_TYPE,
      providerResourceId,
    },
    observedDigest: null,
    health: 'not-applicable',
    execution: 'none',
  });
}

/**
 * Bind a read-only internet-gateway-attachment observer to one credential
 * scope. The caller owns the narrow DescribeInternetGateways port.
 * @param {unknown} options - Exact read dependency, scope, and retry policy.
 * @returns {Readonly<{observe: (context: unknown) => Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsSingleNodeInternetGatewayAttachmentResourceObserver(
  options,
) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeInternetGatewayAttachmentResourceObserver options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeInternetGatewayAttachmentResourceObserver options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeInternetGatewayAttachmentResourceObserver options',
  );
  if (!isPlainObject(options.client)) {
    throw new TypeError(
      'awsSingleNodeInternetGatewayAttachmentResourceObserver client must be an object.',
    );
  }
  assertExactKeys(
    options.client,
    CLIENT_KEYS,
    'awsSingleNodeInternetGatewayAttachmentResourceObserver client',
  );
  if (typeof options.client.describeInternetGateways !== 'function') {
    throw new TypeError(
      'awsSingleNodeInternetGatewayAttachmentResourceObserver client.describeInternetGateways is required.',
    );
  }
  const client = Object.freeze({
    describeInternetGateways: options.client.describeInternetGateways,
  });
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeInternetGatewayAttachmentResourceObserver providerScope',
  );
  const maxAttempts = Object.hasOwn(options, 'maxAttempts')
    ? options.maxAttempts
    : AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeInternetGatewayAttachmentResourceObserver maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = Object.hasOwn(options, 'waitForRetry')
    ? options.waitForRetry
    : defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeInternetGatewayAttachmentResourceObserver waitForRetry must be a function.',
    );
  }

  /** @param {number} attempt @returns {Promise<boolean>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
      return true;
    } catch {
      return false;
    }
  }

  /** @param {string} internetGatewayId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readExact(internetGatewayId) {
    let response;
    try {
      response = await client.describeInternetGateways(
        deepFreeze({ InternetGatewayIds: [internetGatewayId] }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidInternetGatewayID.NotFound')) return null;
      throw new AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError();
    }
    return decodeAwsSingleNodeExactInternetGatewayAttachmentResponse(
      response,
      internetGatewayId,
    );
  }

  /** @param {string} internetGatewayId @param {string} vpcId @returns {Promise<Readonly<Record<string, any>>[]>} */
  async function readBroad(internetGatewayId, vpcId) {
    const records = new Map();
    const seenTokens = new Set();
    let nextToken = null;
    for (
      let page = 1;
      page <= AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_DISCOVERY_PAGES;
      page += 1
    ) {
      let response;
      try {
        response = await client.describeInternetGateways(
          deepFreeze({
            Filters: [
              {
                Name: 'attachment.vpc-id',
                Values: [vpcId],
              },
            ],
            MaxResults:
              AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DISCOVERY_MAX_RESULTS,
            ...(nextToken === null ? {} : { NextToken: nextToken }),
          }),
        );
      } catch {
        throw new AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError();
      }
      const observed =
        decodeAwsSingleNodeInternetGatewayAttachmentDiscoveryPage(response);
      for (const record of observed.records) {
        // Preserve a conclusive occupied-slot contradiction even if a later
        // pagination request fails.
        decodeAwsSingleNodeBroadInternetGatewayAttachmentState(
          [record],
          internetGatewayId,
          providerScope.accountId,
          vpcId,
        );
        if (records.has(record.internetGatewayId)) {
          throw new AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError();
        }
        records.set(record.internetGatewayId, record);
      }
      if (observed.nextToken === null) return [...records.values()];
      if (
        page ===
          AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_DISCOVERY_PAGES ||
        seenTokens.has(observed.nextToken)
      ) {
        throw new AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError();
  }

  /** @param {string} internetGatewayId @param {string} vpcId @returns {Promise<'present'|'absent'>} */
  async function readLogicalState(internetGatewayId, vpcId) {
    let exact = null;
    let broad = null;
    let exactReadCompleted = false;
    /** @type {'present'|'absent'|'transient'|null} */
    let exactState = null;
    /** @type {'present'|'absent'|'transient'|null} */
    let broadState = null;
    /** @type {unknown[]} */
    const errors = [];
    try {
      exact = await readExact(internetGatewayId);
      exactReadCompleted = true;
    } catch (error) {
      errors.push(error);
    }
    try {
      broad = await readBroad(internetGatewayId, vpcId);
    } catch (error) {
      errors.push(error);
    }
    if (exact !== null) {
      try {
        exactState = decodeAwsSingleNodeExactInternetGatewayAttachmentState(
          exact,
          providerScope.accountId,
          vpcId,
        );
      } catch (error) {
        errors.push(error);
      }
    }
    if (broad !== null) {
      try {
        broadState = decodeAwsSingleNodeBroadInternetGatewayAttachmentState(
          broad,
          internetGatewayId,
          providerScope.accountId,
          vpcId,
        );
      } catch (error) {
        errors.push(error);
      }
    }
    if (exactReadCompleted && exact === null) {
      if (broadState === 'present' || broadState === 'transient') {
        errors.push(
          new AwsSingleNodeInternetGatewayAttachmentEvidenceTransientError(),
        );
      } else if (broadState === 'absent') {
        errors.push(
          new AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError(),
        );
      }
    } else if (exactState !== null && broadState !== null) {
      if (
        exactState === 'transient' ||
        broadState === 'transient' ||
        exactState !== broadState
      ) {
        errors.push(
          new AwsSingleNodeInternetGatewayAttachmentEvidenceTransientError(),
        );
      } else if (errors.length === 0) {
        return exactState;
      }
    }
    const strongest =
      getAwsSingleNodeInternetGatewayAttachmentStrongestEvidenceError(errors);
    if (strongest !== null) throw strongest;
    throw new AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError();
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function observe(value) {
    const authority = revalidateAuthority(value);
    if (!sameJson(authority.providerScope, providerScope)) {
      throw new AwsSingleNodeInternetGatewayAttachmentResourceObserverAuthorityError();
    }
    const relationship = assertRelationshipAuthority(authority);
    if (
      relationship.internetGatewayId === null ||
      relationship.vpcId === null ||
      relationship.providerResourceId === null
    ) {
      return unknownObservation();
    }
    const binding = authority.binding;
    const currentAction = authority.currentAction;
    const isCurrentCreate =
      binding === null && currentAction?.action.action === 'create';
    let allAttemptsCleanAbsent = true;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const state = await readLogicalState(
          relationship.internetGatewayId,
          relationship.vpcId,
        );
        if (state === 'present') {
          return binding !== null || isCurrentCreate
            ? verifiedObservation(relationship.providerResourceId)
            : conflictObservation(relationship.providerResourceId);
        }
        if (
          !isCurrentCreate &&
          attempt === maxAttempts &&
          allAttemptsCleanAbsent
        ) {
          return absentObservation();
        }
      } catch (error) {
        if (
          error instanceof
          AwsSingleNodeInternetGatewayAttachmentEvidenceConflictError
        ) {
          return conflictObservation(relationship.providerResourceId);
        }
        if (
          !(
            error instanceof
            AwsSingleNodeInternetGatewayAttachmentEvidenceUnknownError
          ) &&
          !(
            error instanceof
            AwsSingleNodeInternetGatewayAttachmentEvidenceTransientError
          )
        ) {
          throw error;
        }
        allAttemptsCleanAbsent = false;
      }
      if (attempt < maxAttempts) {
        if (!(await wait(attempt))) {
          allAttemptsCleanAbsent = false;
          return unknownObservation();
        }
      }
    }
    return unknownObservation();
  }

  return Object.freeze({ observe });
}

export default {
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_ATTEMPTS,
  AwsSingleNodeInternetGatewayAttachmentResourceObserverAuthorityError,
  createAwsSingleNodeInternetGatewayAttachmentResourceObserver,
};
