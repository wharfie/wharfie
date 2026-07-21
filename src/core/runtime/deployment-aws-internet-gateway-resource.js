/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { sha256Base64Url } from './content-id.js';
import {
  validateAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  createDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';
import {
  AwsTaggedEc2RecoveryConflictError as InternetGatewayEvidenceConflictError,
  AwsTaggedEc2RecoveryTransientError as InternetGatewayEvidenceTransientError,
  AwsTaggedEc2RecoveryUnknownError as ProviderResponseUnknownError,
  createAwsTaggedEc2RecoveryKernel,
} from './deployment-aws-tagged-ec2-recovery.js';

export const AWS_SINGLE_NODE_INTERNET_GATEWAY_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_DISCOVERY_PAGES = 16;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_DISCOVERY_MAX_RESULTS = 100;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ec2-internet-gateway-state:v1';

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const ACTION_CONTEXT_KEYS = new Set([
  'operation',
  'plan',
  'action',
  'actionIndex',
  'ownershipNonce',
  'head',
  'profile',
  'artifactStage',
]);
const REQUIRED_CLIENT_METHODS = Object.freeze([
  'createInternetGateway',
  'describeInternetGateways',
  'deleteInternetGateway',
]);
const INTERNET_GATEWAY_ID_PATTERN = /^igw-[0-9a-f]{8,32}$/;
const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,32}$/;
const INTERNET_GATEWAY_ATTACHMENT_STATES = new Set([
  'available',
  'attaching',
  'attached',
  'detaching',
  'detached',
]);
const MAX_INTERNET_GATEWAY_TAGS = 50;

const BASE_RESERVED_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'single-node-internet-gateway',
  'wharfie:retention': 'purge',
  'wharfie:schema-version': '2',
});

/** Exact controller authority or present provider evidence is contradictory. */
export class AwsSingleNodeInternetGatewayResourceConflictError extends Error {
  constructor() {
    super(
      'AWS single-node internet gateway resource conflicts with its exact contract.',
    );
    this.name = 'AwsSingleNodeInternetGatewayResourceConflictError';
    this.code = 'AWS_SINGLE_NODE_INTERNET_GATEWAY_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeInternetGatewayResourceUnknownError extends Error {
  constructor() {
    super('AWS single-node internet gateway resource state is unknown.');
    this.name = 'AwsSingleNodeInternetGatewayResourceUnknownError';
    this.code = 'AWS_SINGLE_NODE_INTERNET_GATEWAY_RESOURCE_UNKNOWN';
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
  return JSON.stringify(left) === JSON.stringify(right);
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

/**
 * Derive the exact provider-observable internet-gateway state. Attachment is
 * deliberately excluded because the graph owns it as a later derived effect.
 * @param {unknown} value - Exact AWS single-node provider specification.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>} - State digest.
 */
export function getAwsSingleNodeInternetGatewayStateDigest(value) {
  validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeInternetGatewayState providerSpec',
  );
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEc2InternetGatewayState',
    onDestroy: 'purge',
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_INTERNET_GATEWAY_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {Readonly<import('@aws-sdk/client-ec2').CreateInternetGatewayCommandInput>} */
function createInternetGatewayRequest(authority, recovery) {
  return deepFreeze({
    TagSpecifications: [
      {
        ResourceType: 'internet-gateway',
        Tags: recovery.sortedTags(recovery.requiredTags(authority)),
      },
    ],
  });
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} providerScope @param {string} ownershipNonce @returns {boolean} */
function bindingMatchesAuthority(
  binding,
  action,
  plan,
  providerScope,
  ownershipNonce,
) {
  return (
    binding.management === 'managed' &&
    binding.providerType === 'ec2-internet-gateway' &&
    INTERNET_GATEWAY_ID_PATTERN.test(binding.providerResourceId) &&
    binding.deploymentInstanceId === plan.deploymentInstanceId &&
    binding.resourceKey === 'network-internet-gateway' &&
    binding.providerScopeId === providerScope.providerScopeId &&
    binding.incarnationId === plan.incarnationId &&
    sameJson(binding.capability, action.capability) &&
    sameJson(binding.role, action.role) &&
    binding.ownershipMode === 'direct' &&
    binding.onDestroy === 'purge' &&
    binding.dependencyBindings.length === 0 &&
    binding.ownershipNonce === ownershipNonce &&
    action.before !== null &&
    action.before.providerType === 'ec2-internet-gateway' &&
    action.before.providerResourceId === binding.providerResourceId
  );
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, any>>} */
function validateActionContext(value, providerScope) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeInternetGateway action context must be an object.',
    );
  }
  assertExactKeys(
    value,
    ACTION_CONTEXT_KEYS,
    'awsSingleNodeInternetGateway context',
  );
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeInternetGateway context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const canonicalProviderSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeInternetGateway context.head',
  );
  const expectedOperationKind =
    plan.operation === 'destroy'
      ? 'destroy'
      : head.settledDeploymentRevisionId === null
        ? 'create'
        : head.settledDeploymentRevisionId ===
            plan.deploymentRevision.deploymentRevisionId
          ? 'reconcile'
          : 'update';
  if (
    value.operation !== plan.operation ||
    plan.providerScope.providerScopeId !== providerScope.providerScopeId ||
    canonicalProviderSpec.providerSpecId !== plan.providerSpec.providerSpecId ||
    head.deploymentInstanceId !== plan.deploymentInstanceId ||
    head.incarnationId !== plan.incarnationId ||
    head.providerScope.providerScopeId !== providerScope.providerScopeId ||
    head.activeOperation === null ||
    head.activeOperation.planId !== plan.planId ||
    head.activeOperation.status !== 'running' ||
    head.activeOperation.kind !== expectedOperationKind ||
    plan.basis.headGeneration >= head.generation ||
    plan.basis.settledDeploymentRevisionId !==
      head.settledDeploymentRevisionId ||
    head.targetDeploymentRevisionId !==
      (expectedOperationKind === 'destroy'
        ? null
        : plan.deploymentRevision.deploymentRevisionId) ||
    head.activeOperation.intents.length !== plan.actions.length ||
    head.activeOperation.intents.some(
      (
        /** @type {Readonly<Record<string, any>>} */ candidate,
        /** @type {number} */ index,
      ) => candidate.actionId !== plan.actions[index].actionId,
    )
  ) {
    throw new AwsSingleNodeInternetGatewayResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeInternetGatewayResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  if (
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    action.resourceKey !== 'network-internet-gateway' ||
    !sameJson(action.capability, { kind: 'networking', version: 1 }) ||
    !sameJson(action.role, { kind: 'internet-gateway', version: 1 }) ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'direct' ||
    action.onDestroy !== 'purge' ||
    action.dependsOn.length !== 0
  ) {
    throw new AwsSingleNodeInternetGatewayResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeInternetGateway context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeInternetGatewayResourceConflictError();
  }
  const stateDigest = getAwsSingleNodeInternetGatewayStateDigest(
    canonicalProviderSpec,
  );
  const priorBinding = head.resourceBindings.find(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.resourceKey === action.resourceKey,
  );
  if (action.action === 'create') {
    if (
      plan.operation === 'destroy' ||
      action.before !== null ||
      action.after === null ||
      action.after.providerType !== 'ec2-internet-gateway' ||
      action.after.providerResourceId !== null ||
      !sameJson(action.after.stateDigest, stateDigest) ||
      priorBinding !== undefined
    ) {
      throw new AwsSingleNodeInternetGatewayResourceConflictError();
    }
  } else if (action.action === 'noop') {
    if (
      action.after === null ||
      priorBinding === undefined ||
      !bindingMatchesAuthority(
        priorBinding,
        action,
        plan,
        providerScope,
        ownershipNonce,
      ) ||
      !sameJson(action.before.stateDigest, stateDigest) ||
      action.after.providerType !== 'ec2-internet-gateway' ||
      action.after.providerResourceId !== priorBinding.providerResourceId ||
      !sameJson(action.after.stateDigest, stateDigest)
    ) {
      throw new AwsSingleNodeInternetGatewayResourceConflictError();
    }
  } else if (action.action === 'delete') {
    if (
      plan.operation !== 'destroy' ||
      action.after !== null ||
      priorBinding === undefined ||
      !bindingMatchesAuthority(
        priorBinding,
        action,
        plan,
        providerScope,
        ownershipNonce,
      ) ||
      action.before.stateDigest === null
    ) {
      throw new AwsSingleNodeInternetGatewayResourceConflictError();
    }
  } else {
    throw new AwsSingleNodeInternetGatewayResourceConflictError();
  }
  return deepFreeze({
    operation: plan.operation,
    plan,
    action,
    actionIndex: value.actionIndex,
    ownershipNonce,
    head,
    profile,
    providerSpec: canonicalProviderSpec,
    stateDigest,
    priorBinding: priorBinding ?? null,
  });
}

/** @param {unknown} value @returns {string|null} */
function candidateInternetGatewayId(value) {
  if (!isPlainObject(value) || !isPlainObject(value.InternetGateway)) {
    return null;
  }
  const internetGatewayId = value.InternetGateway.InternetGatewayId;
  return typeof internetGatewayId === 'string' &&
    INTERNET_GATEWAY_ID_PATTERN.test(internetGatewayId)
    ? internetGatewayId
    : null;
}

/** @param {unknown} response @param {string} exactInternetGatewayId @returns {Readonly<Record<string, any>>} */
function oneInternetGatewayFromResponse(response, exactInternetGatewayId) {
  if (!isPlainObject(response) || !Array.isArray(response.InternetGateways)) {
    throw new ProviderResponseUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new InternetGatewayEvidenceConflictError();
  }
  if (response.InternetGateways.length === 0) {
    throw new ProviderResponseUnknownError();
  }
  if (response.InternetGateways.length !== 1) {
    throw new InternetGatewayEvidenceConflictError();
  }
  const internetGateway = response.InternetGateways[0];
  if (
    !isPlainObject(internetGateway) ||
    typeof internetGateway.InternetGatewayId !== 'string' ||
    !INTERNET_GATEWAY_ID_PATTERN.test(internetGateway.InternetGatewayId)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (internetGateway.InternetGatewayId !== exactInternetGatewayId) {
    throw new InternetGatewayEvidenceConflictError();
  }
  return internetGateway;
}

/** @param {unknown} response @returns {{internetGateways: Readonly<Record<string, any>>[], nextToken: string|null}} */
function discoveryPage(response) {
  if (!isPlainObject(response) || !Array.isArray(response.InternetGateways)) {
    throw new ProviderResponseUnknownError();
  }
  let nextToken = null;
  if (response.NextToken !== undefined && response.NextToken !== null) {
    if (
      typeof response.NextToken !== 'string' ||
      response.NextToken.length === 0
    ) {
      throw new ProviderResponseUnknownError();
    }
    nextToken = response.NextToken;
  }
  const internetGateways = [];
  for (const internetGateway of response.InternetGateways) {
    if (
      !isPlainObject(internetGateway) ||
      typeof internetGateway.InternetGatewayId !== 'string' ||
      !INTERNET_GATEWAY_ID_PATTERN.test(internetGateway.InternetGatewayId)
    ) {
      throw new ProviderResponseUnknownError();
    }
    internetGateways.push(internetGateway);
  }
  return { internetGateways, nextToken };
}

/** @param {Readonly<Record<string, any>>} internetGateway @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {void} */
function validateInternetGatewayOwnershipEvidence(
  internetGateway,
  authority,
  recovery,
) {
  if (
    typeof internetGateway.InternetGatewayId !== 'string' ||
    !INTERNET_GATEWAY_ID_PATTERN.test(internetGateway.InternetGatewayId) ||
    typeof internetGateway.OwnerId !== 'string'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (internetGateway.OwnerId !== authority.plan.providerScope.accountId) {
    throw new InternetGatewayEvidenceConflictError();
  }
  recovery.validateTags(
    internetGateway.Tags,
    recovery.requiredTags(authority),
    authority.action.action === 'create',
  );
}

/** @param {unknown} value @returns {boolean} */
function validateDetachedForDelete(value) {
  if (!Array.isArray(value)) throw new ProviderResponseUnknownError();
  for (const attachment of value) {
    if (
      !isPlainObject(attachment) ||
      typeof attachment.State !== 'string' ||
      !INTERNET_GATEWAY_ATTACHMENT_STATES.has(attachment.State) ||
      typeof attachment.VpcId !== 'string' ||
      !VPC_ID_PATTERN.test(attachment.VpcId)
    ) {
      throw new ProviderResponseUnknownError();
    }
  }
  return value.length === 0;
}

/**
 * Bind one exact directly owned internet gateway to the fixed AWS single-node
 * graph. The factory never owns or closes the caller's narrow EC2 client.
 * @param {unknown} options - Exact dependencies and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>} - Controller action ports.
 */
export function createAwsSingleNodeInternetGatewayResource(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeInternetGateway options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeInternetGateway options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeInternetGateway options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError(
      'awsSingleNodeInternetGateway client must be an object.',
    );
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeInternetGateway client.${method} is required.`,
      );
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeInternetGateway providerScope',
  );
  const maxAttempts =
    options.maxAttempts ??
    AWS_SINGLE_NODE_INTERNET_GATEWAY_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeInternetGateway maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeInternetGateway waitForRetry must be a function.',
    );
  }
  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeInternetGatewayResourceUnknownError();
    }
  }

  /** @param {string} internetGatewayId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function describeExactOnce(internetGatewayId) {
    let response;
    try {
      response = await client.describeInternetGateways(
        deepFreeze({ InternetGatewayIds: [internetGatewayId] }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidInternetGatewayID.NotFound')) return null;
      throw new ProviderResponseUnknownError();
    }
    return oneInternetGatewayFromResponse(response, internetGatewayId);
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<{records: Readonly<Record<string, any>>[], nextToken: string|null}>} */
  async function readDiscoveryPage(request) {
    let response;
    try {
      response = await client.describeInternetGateways(request);
    } catch {
      throw new ProviderResponseUnknownError();
    }
    const observed = discoveryPage(response);
    return {
      records: observed.internetGateways,
      nextToken: observed.nextToken,
    };
  }

  const recovery = createAwsTaggedEc2RecoveryKernel({
    baseTags: BASE_RESERVED_TAGS,
    discoveryMaxResults: AWS_SINGLE_NODE_INTERNET_GATEWAY_DISCOVERY_MAX_RESULTS,
    idKey: 'InternetGatewayId',
    idPattern: INTERNET_GATEWAY_ID_PATTERN,
    maxDiscoveryPages: AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_DISCOVERY_PAGES,
    maxTags: MAX_INTERNET_GATEWAY_TAGS,
    readDiscoveryPage,
    readExact: describeExactOnce,
  });

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>[]>} */
  async function readLogicalMatches(authority) {
    const { discovered, exact } = await recovery.readIdentityEvidence(
      authority,
      { useDiscoveredId: true },
    );
    if (authority.action.action === 'delete') {
      if (discovered !== null) {
        validateInternetGatewayOwnershipEvidence(
          discovered,
          authority,
          recovery,
        );
      }
      if (exact !== null) {
        validateInternetGatewayOwnershipEvidence(exact, authority, recovery);
      }
      const discoveredDetached =
        discovered === null
          ? null
          : validateDetachedForDelete(discovered.Attachments);
      const exactDetached =
        exact === null ? null : validateDetachedForDelete(exact.Attachments);
      if (discovered === null && exact === null) return [];
      if (discovered === null || exact === null) {
        throw new InternetGatewayEvidenceTransientError();
      }
      if (!discoveredDetached || !exactDetached) {
        throw new InternetGatewayEvidenceTransientError();
      }
    } else {
      if (discovered !== null) {
        validateInternetGatewayOwnershipEvidence(
          discovered,
          authority,
          recovery,
        );
      }
      if (exact !== null) {
        validateInternetGatewayOwnershipEvidence(exact, authority, recovery);
      }
      if (discovered === null && exact === null) return [];
      if (discovered === null || exact === null) {
        throw new InternetGatewayEvidenceTransientError();
      }
    }
    return [exact];
  }

  /** @param {unknown} value @returns {Promise<void>} */
  async function executeAction(value) {
    const authority = validateActionContext(value, providerScope);
    if (authority.action.action === 'noop') return;
    let matches;
    try {
      matches = await readLogicalMatches(authority);
    } catch (error) {
      if (error instanceof InternetGatewayEvidenceConflictError) {
        throw new AwsSingleNodeInternetGatewayResourceConflictError();
      }
      if (
        authority.action.action === 'delete' &&
        error instanceof InternetGatewayEvidenceTransientError
      ) {
        return;
      }
      throw new AwsSingleNodeInternetGatewayResourceUnknownError();
    }
    if (authority.action.action === 'delete') {
      if (matches.length === 0) return;
      const internetGatewayId = authority.priorBinding.providerResourceId;
      try {
        await client.deleteInternetGateway(
          deepFreeze({ InternetGatewayId: internetGatewayId }),
        );
      } catch (error) {
        if (errorNamed(error, 'InvalidInternetGatewayID.NotFound')) return;
        if (
          errorNamed(error, 'DependencyViolation') ||
          errorNamed(error, 'IncorrectState')
        ) {
          return;
        }
        throw new AwsSingleNodeInternetGatewayResourceUnknownError();
      }
      return;
    }
    if (matches.length === 1) return;
    if (!recovery.claimCreateAttempt(authority)) {
      throw new AwsSingleNodeInternetGatewayResourceUnknownError();
    }
    let response;
    try {
      response = await client.createInternetGateway(
        createInternetGatewayRequest(authority, recovery),
      );
    } catch {
      throw new AwsSingleNodeInternetGatewayResourceUnknownError();
    }
    const internetGatewayId = candidateInternetGatewayId(response);
    if (internetGatewayId === null) {
      throw new AwsSingleNodeInternetGatewayResourceUnknownError();
    }
    try {
      recovery.rememberCandidate(authority, internetGatewayId);
    } catch (error) {
      if (error instanceof InternetGatewayEvidenceConflictError) {
        throw new AwsSingleNodeInternetGatewayResourceConflictError();
      }
      throw new AwsSingleNodeInternetGatewayResourceUnknownError();
    }
  }

  /** @param {unknown} value @returns {Promise<{status: 'converged', binding: Readonly<Record<string, any>>|null}|{status: 'not-converged'}|{status: 'blocked'}>} */
  async function verifySettlement(value) {
    const authority = validateActionContext(value, providerScope);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const matches = await readLogicalMatches(authority);
        if (matches.length === 1) {
          if (authority.action.action === 'delete') {
            return Object.freeze({ status: 'not-converged' });
          }
          const internetGateway = matches[0];
          const binding =
            authority.priorBinding ??
            createDeploymentResourceBinding({
              schemaVersion: 2,
              kind: 'deploymentResourceBinding',
              deploymentInstanceId: authority.plan.deploymentInstanceId,
              incarnationId: authority.plan.incarnationId,
              resourceKey: authority.action.resourceKey,
              capability: authority.action.capability,
              role: authority.action.role,
              management: 'managed',
              ownershipMode: authority.action.ownershipMode,
              onDestroy: authority.action.onDestroy,
              dependencyBindings: [],
              providerType: 'ec2-internet-gateway',
              providerResourceId: internetGateway.InternetGatewayId,
              providerScopeId: providerScope.providerScopeId,
              ownershipNonce: authority.ownershipNonce,
              createdByActionId: authority.action.actionId,
            });
          recovery.clearCandidate(authority);
          return deepFreeze({ status: 'converged', binding });
        }
        if (authority.action.action === 'delete') {
          recovery.clearCandidate(authority);
          return deepFreeze({ status: 'converged', binding: null });
        }
      } catch (error) {
        if (error instanceof InternetGatewayEvidenceConflictError) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          !(error instanceof ProviderResponseUnknownError) &&
          !(error instanceof InternetGatewayEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof ProviderResponseUnknownError) {
            throw new AwsSingleNodeInternetGatewayResourceUnknownError();
          }
          return Object.freeze({ status: 'not-converged' });
        }
        await wait(attempt);
        continue;
      }
      if (attempt < maxAttempts) await wait(attempt);
    }
    return authority.action.action === 'noop'
      ? Object.freeze({ status: 'blocked' })
      : Object.freeze({ status: 'not-converged' });
  }

  return Object.freeze({ executeAction, verifySettlement });
}

export default {
  AWS_SINGLE_NODE_INTERNET_GATEWAY_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_STATE_DIGEST_DOMAIN,
  AwsSingleNodeInternetGatewayResourceConflictError,
  AwsSingleNodeInternetGatewayResourceUnknownError,
  createAwsSingleNodeInternetGatewayResource,
  getAwsSingleNodeInternetGatewayStateDigest,
};
