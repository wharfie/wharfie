/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import { createCanonicalJsonSha256Id, sha256Base64Url } from './content-id.js';
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

export const AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_DISCOVERY_PAGES = 16;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DISCOVERY_MAX_RESULTS = 100;
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ec2-internet-gateway-attachment-state:v1';
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN =
  'wharfie:aws-single-node-ec2-internet-gateway-attachment:v1';
export const AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX =
  'wia1';

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
  'attachInternetGateway',
  'describeInternetGateways',
  'detachInternetGateway',
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
const RESOURCE_KEY = 'network-internet-gateway-attachment';
const PROVIDER_TYPE = 'ec2-internet-gateway-attachment';
const DEPENDENCY_DEFINITIONS = Object.freeze([
  Object.freeze({
    resourceKey: 'network-vpc',
    providerType: 'ec2-vpc',
    role: Object.freeze({ kind: 'vpc', version: 1 }),
    idPattern: VPC_ID_PATTERN,
  }),
  Object.freeze({
    resourceKey: 'network-internet-gateway',
    providerType: 'ec2-internet-gateway',
    role: Object.freeze({ kind: 'internet-gateway', version: 1 }),
    idPattern: INTERNET_GATEWAY_ID_PATTERN,
  }),
]);

/** Exact controller authority or provider evidence is contradictory. */
export class AwsSingleNodeInternetGatewayAttachmentResourceConflictError extends Error {
  constructor() {
    super(
      'AWS single-node internet gateway attachment conflicts with its exact contract.',
    );
    this.name = 'AwsSingleNodeInternetGatewayAttachmentResourceConflictError';
    this.code = 'AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeInternetGatewayAttachmentResourceUnknownError extends Error {
  constructor() {
    super('AWS single-node internet gateway attachment state is unknown.');
    this.name = 'AwsSingleNodeInternetGatewayAttachmentResourceUnknownError';
    this.code = 'AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_RESOURCE_UNKNOWN';
  }
}

class ProviderResponseUnknownError extends Error {}
class InternetGatewayAttachmentEvidenceConflictError extends Error {}
class InternetGatewayAttachmentEvidenceTransientError extends Error {}

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

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameDependencyBindings(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every(
      (dependency, index) =>
        dependency.resourceKey === right[index]?.resourceKey &&
        dependency.bindingId === right[index]?.bindingId,
    )
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

/**
 * Derive the one exact desired relationship state.
 * @param {unknown} value - Exact AWS single-node provider specification.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>} - State digest.
 */
export function getAwsSingleNodeInternetGatewayAttachmentStateDigest(value) {
  validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeInternetGatewayAttachmentState providerSpec',
  );
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEc2InternetGatewayAttachmentState',
    state: 'available',
    onDestroy: 'purge',
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/** @param {string} internetGatewayId @param {string} vpcId @returns {string} */
function providerResourceId(internetGatewayId, vpcId) {
  return createCanonicalJsonSha256Id({
    domain:
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
    prefix:
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
    value: { internetGatewayId, vpcId },
    valuePath: 'awsSingleNodeInternetGatewayAttachment provider identity',
  });
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} definition @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} providerScope @returns {boolean} */
function dependencyBindingMatches(binding, definition, plan, providerScope) {
  return (
    binding.management === 'managed' &&
    binding.providerType === definition.providerType &&
    definition.idPattern.test(binding.providerResourceId) &&
    binding.deploymentInstanceId === plan.deploymentInstanceId &&
    binding.resourceKey === definition.resourceKey &&
    binding.providerScopeId === providerScope.providerScopeId &&
    binding.incarnationId === plan.incarnationId &&
    sameJson(binding.capability, { kind: 'networking', version: 1 }) &&
    sameJson(binding.role, definition.role) &&
    binding.ownershipMode === 'direct' &&
    binding.onDestroy === 'purge' &&
    binding.dependencyBindings.length === 0
  );
}

/**
 * Resolve both exact dependency receipts and prove their current-plan lineage.
 * Apply dependencies are already settled; destroy dependencies are still
 * pending later in reverse order and therefore remain intact.
 * @param {Readonly<Record<string, any>>} plan - Exact immutable action plan.
 * @param {Readonly<Record<string, any>>} head - Current durable authority.
 * @param {number} actionIndex - Current intended action index.
 * @param {Readonly<Record<string, any>>} providerScope - Fixed AWS scope.
 * @returns {Readonly<{internetGatewayBinding: Readonly<Record<string, any>>, vpcBinding: Readonly<Record<string, any>>, dependencyBindings: Readonly<Array<{resourceKey: string, bindingId: string}>>, internetGatewayId: string, vpcId: string, providerResourceId: string}>}
 */
function resolveDependencyAuthority(plan, head, actionIndex, providerScope) {
  const currentAction = plan.actions[actionIndex];
  const resolved = new Map();
  for (const definition of DEPENDENCY_DEFINITIONS) {
    const dependencyActionIndex = plan.actions.findIndex(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.resourceKey === definition.resourceKey,
    );
    const dependencyAction = plan.actions[dependencyActionIndex];
    const dependencyIntent =
      head.activeOperation.intents[dependencyActionIndex];
    const binding = head.resourceBindings.find(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.resourceKey === definition.resourceKey,
    );
    const applyAuthority =
      plan.operation !== 'destroy' &&
      dependencyActionIndex >= 0 &&
      dependencyActionIndex < actionIndex &&
      dependencyIntent?.status === 'settled' &&
      dependencyAction?.after !== null &&
      dependencyAction?.after !== undefined &&
      dependencyAction.after.providerType === definition.providerType &&
      (dependencyAction.after.providerResourceId === null ||
        dependencyAction.after.providerResourceId ===
          binding?.providerResourceId);
    const destroyAuthority =
      plan.operation === 'destroy' &&
      dependencyActionIndex > actionIndex &&
      dependencyIntent?.status === 'pending' &&
      dependencyAction?.action === 'delete' &&
      dependencyAction.before !== null &&
      dependencyAction.before.providerType === definition.providerType &&
      dependencyAction.before.providerResourceId ===
        binding?.providerResourceId;
    if (
      currentAction === undefined ||
      binding === undefined ||
      dependencyAction === undefined ||
      dependencyIntent === undefined ||
      (!applyAuthority && !destroyAuthority) ||
      dependencyIntent.actionId !== dependencyAction.actionId ||
      dependencyIntent.ownershipNonce !== binding.ownershipNonce ||
      dependencyAction.resourceKey !== definition.resourceKey ||
      !sameJson(dependencyAction.capability, {
        kind: 'networking',
        version: 1,
      }) ||
      !sameJson(dependencyAction.role, definition.role) ||
      dependencyAction.management !== 'managed' ||
      dependencyAction.ownershipMode !== 'direct' ||
      dependencyAction.onDestroy !== 'purge' ||
      dependencyAction.dependsOn.length !== 0 ||
      !dependencyBindingMatches(binding, definition, plan, providerScope) ||
      (dependencyAction.action === 'create' &&
        binding.createdByActionId !== dependencyAction.actionId)
    ) {
      throw new AwsSingleNodeInternetGatewayAttachmentResourceConflictError();
    }
    resolved.set(definition.resourceKey, binding);
  }
  const vpcBinding = resolved.get('network-vpc');
  const internetGatewayBinding = resolved.get('network-internet-gateway');
  if (vpcBinding === undefined || internetGatewayBinding === undefined) {
    throw new AwsSingleNodeInternetGatewayAttachmentResourceConflictError();
  }
  const dependencyBindings = [...resolved.values()]
    .map((binding) => ({
      resourceKey: binding.resourceKey,
      bindingId: binding.bindingId,
    }))
    .sort((left, right) =>
      compareCanonicalStrings(left.resourceKey, right.resourceKey),
    );
  const internetGatewayId = internetGatewayBinding.providerResourceId;
  const vpcId = vpcBinding.providerResourceId;
  return deepFreeze({
    internetGatewayBinding,
    vpcBinding,
    dependencyBindings,
    internetGatewayId,
    vpcId,
    providerResourceId: providerResourceId(internetGatewayId, vpcId),
  });
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} providerScope @param {string} ownershipNonce @param {Readonly<Record<string, any>>} dependencies @returns {boolean} */
function bindingMatchesAuthority(
  binding,
  action,
  plan,
  providerScope,
  ownershipNonce,
  dependencies,
) {
  return (
    binding.management === 'managed' &&
    binding.providerType === PROVIDER_TYPE &&
    binding.providerResourceId === dependencies.providerResourceId &&
    binding.deploymentInstanceId === plan.deploymentInstanceId &&
    binding.resourceKey === RESOURCE_KEY &&
    binding.providerScopeId === providerScope.providerScopeId &&
    binding.incarnationId === plan.incarnationId &&
    sameJson(binding.capability, action.capability) &&
    sameJson(binding.role, action.role) &&
    binding.ownershipMode === 'derived' &&
    binding.onDestroy === 'purge' &&
    sameDependencyBindings(
      binding.dependencyBindings,
      dependencies.dependencyBindings,
    ) &&
    binding.ownershipNonce === ownershipNonce &&
    action.before !== null &&
    action.before.providerType === PROVIDER_TYPE &&
    action.before.providerResourceId === binding.providerResourceId
  );
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, any>>} */
function validateActionContext(value, providerScope) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeInternetGatewayAttachment action context must be an object.',
    );
  }
  assertExactKeys(
    value,
    ACTION_CONTEXT_KEYS,
    'awsSingleNodeInternetGatewayAttachment context',
  );
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeInternetGatewayAttachment context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const canonicalProviderSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeInternetGatewayAttachment context.head',
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
    throw new AwsSingleNodeInternetGatewayAttachmentResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeInternetGatewayAttachmentResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  if (
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    action.resourceKey !== RESOURCE_KEY ||
    !sameJson(action.capability, { kind: 'networking', version: 1 }) ||
    !sameJson(action.role, {
      kind: 'internet-gateway-attachment',
      version: 1,
    }) ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'derived' ||
    action.onDestroy !== 'purge' ||
    !sameJson(action.dependsOn, ['network-vpc', 'network-internet-gateway'])
  ) {
    throw new AwsSingleNodeInternetGatewayAttachmentResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeInternetGatewayAttachment context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeInternetGatewayAttachmentResourceConflictError();
  }
  const dependencies = resolveDependencyAuthority(
    plan,
    head,
    value.actionIndex,
    providerScope,
  );
  const stateDigest = getAwsSingleNodeInternetGatewayAttachmentStateDigest(
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
      action.after.providerType !== PROVIDER_TYPE ||
      action.after.providerResourceId !== null ||
      !sameJson(action.after.stateDigest, stateDigest) ||
      priorBinding !== undefined
    ) {
      throw new AwsSingleNodeInternetGatewayAttachmentResourceConflictError();
    }
  } else if (action.action === 'noop') {
    if (
      plan.operation === 'destroy' ||
      action.before === null ||
      action.after === null ||
      priorBinding === undefined ||
      !bindingMatchesAuthority(
        priorBinding,
        action,
        plan,
        providerScope,
        ownershipNonce,
        dependencies,
      ) ||
      !sameJson(action.before.stateDigest, stateDigest) ||
      action.after.providerType !== PROVIDER_TYPE ||
      action.after.providerResourceId !== priorBinding.providerResourceId ||
      !sameJson(action.after.stateDigest, stateDigest)
    ) {
      throw new AwsSingleNodeInternetGatewayAttachmentResourceConflictError();
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
        dependencies,
      ) ||
      action.before.stateDigest === null
    ) {
      throw new AwsSingleNodeInternetGatewayAttachmentResourceConflictError();
    }
  } else {
    throw new AwsSingleNodeInternetGatewayAttachmentResourceConflictError();
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
    ...dependencies,
  });
}

/** @param {unknown} value @param {string} expectedOwnerId @returns {Readonly<Record<string, any>>} */
function validateInternetGateway(value, expectedOwnerId) {
  if (
    !isPlainObject(value) ||
    typeof value.InternetGatewayId !== 'string' ||
    !INTERNET_GATEWAY_ID_PATTERN.test(value.InternetGatewayId) ||
    typeof value.OwnerId !== 'string' ||
    !Array.isArray(value.Attachments)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (value.OwnerId !== expectedOwnerId) {
    throw new InternetGatewayAttachmentEvidenceConflictError();
  }
  if (value.Attachments.length > 1) {
    throw new InternetGatewayAttachmentEvidenceConflictError();
  }
  for (const attachment of value.Attachments) {
    if (
      !isPlainObject(attachment) ||
      typeof attachment.VpcId !== 'string' ||
      !VPC_ID_PATTERN.test(attachment.VpcId) ||
      typeof attachment.State !== 'string' ||
      !INTERNET_GATEWAY_ATTACHMENT_STATES.has(attachment.State)
    ) {
      throw new ProviderResponseUnknownError();
    }
  }
  return value;
}

/** @param {unknown} response @param {string} exactInternetGatewayId @param {string} expectedOwnerId @returns {Readonly<Record<string, any>>} */
function oneInternetGatewayFromResponse(
  response,
  exactInternetGatewayId,
  expectedOwnerId,
) {
  if (!isPlainObject(response) || !Array.isArray(response.InternetGateways)) {
    throw new ProviderResponseUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new InternetGatewayAttachmentEvidenceConflictError();
  }
  if (response.InternetGateways.length === 0) {
    throw new ProviderResponseUnknownError();
  }
  if (response.InternetGateways.length !== 1) {
    throw new InternetGatewayAttachmentEvidenceConflictError();
  }
  const internetGateway = validateInternetGateway(
    response.InternetGateways[0],
    expectedOwnerId,
  );
  if (internetGateway.InternetGatewayId !== exactInternetGatewayId) {
    throw new InternetGatewayAttachmentEvidenceConflictError();
  }
  return internetGateway;
}

/** @param {unknown} response @param {string} expectedOwnerId @returns {{internetGateways: Readonly<Record<string, any>>[], nextToken: string|null}} */
function discoveryPage(response, expectedOwnerId) {
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
  return {
    internetGateways: response.InternetGateways.map((internetGateway) =>
      validateInternetGateway(internetGateway, expectedOwnerId),
    ),
    nextToken,
  };
}

/** @param {Readonly<Record<string, any>>} internetGateway @param {string} expectedVpcId @returns {'present'|'absent'|'transient'} */
function exactAttachmentState(internetGateway, expectedVpcId) {
  if (internetGateway.Attachments.length === 0) return 'absent';
  const attachment = internetGateway.Attachments[0];
  if (attachment.VpcId !== expectedVpcId) {
    throw new InternetGatewayAttachmentEvidenceConflictError();
  }
  return attachment.State === 'available' ? 'present' : 'transient';
}

/** @param {Map<string, Readonly<Record<string, any>>>} matches @param {string} expectedInternetGatewayId @param {string} expectedVpcId @returns {'present'|'absent'|'transient'} */
function broadAttachmentState(
  matches,
  expectedInternetGatewayId,
  expectedVpcId,
) {
  if (matches.size === 0) return 'absent';
  if (matches.size !== 1) {
    throw new InternetGatewayAttachmentEvidenceConflictError();
  }
  const internetGateway = [...matches.values()][0];
  if (internetGateway.InternetGatewayId !== expectedInternetGatewayId) {
    throw new InternetGatewayAttachmentEvidenceConflictError();
  }
  if (internetGateway.Attachments.length === 0) return 'transient';
  const attachment = internetGateway.Attachments[0];
  if (attachment.VpcId !== expectedVpcId) {
    throw new InternetGatewayAttachmentEvidenceConflictError();
  }
  return attachment.State === 'available' ? 'present' : 'transient';
}

/** @param {unknown[]} errors @returns {Error|null} */
function strongestEvidenceError(errors) {
  if (
    errors.some(
      (error) =>
        error instanceof InternetGatewayAttachmentEvidenceConflictError,
    )
  ) {
    return new InternetGatewayAttachmentEvidenceConflictError();
  }
  if (errors.some((error) => error instanceof ProviderResponseUnknownError)) {
    return new ProviderResponseUnknownError();
  }
  if (
    errors.some(
      (error) =>
        error instanceof InternetGatewayAttachmentEvidenceTransientError,
    )
  ) {
    return new InternetGatewayAttachmentEvidenceTransientError();
  }
  return null;
}

/**
 * Bind the exact dependency-derived VPC/internet-gateway relationship. The
 * factory never owns or closes the caller's narrow EC2 client.
 * @param {unknown} options - Exact dependencies and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>} - Controller action ports.
 */
export function createAwsSingleNodeInternetGatewayAttachmentResource(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeInternetGatewayAttachment options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeInternetGatewayAttachment options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeInternetGatewayAttachment options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError(
      'awsSingleNodeInternetGatewayAttachment client must be an object.',
    );
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeInternetGatewayAttachment client.${method} is required.`,
      );
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeInternetGatewayAttachment providerScope',
  );
  const maxAttempts =
    options.maxAttempts ??
    AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeInternetGatewayAttachment maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeInternetGatewayAttachment waitForRetry must be a function.',
    );
  }

  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeInternetGatewayAttachmentResourceUnknownError();
    }
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function describeExactOnce(authority) {
    let response;
    try {
      response = await client.describeInternetGateways(
        deepFreeze({
          InternetGatewayIds: [authority.internetGatewayId],
        }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidInternetGatewayID.NotFound')) return null;
      throw new ProviderResponseUnknownError();
    }
    return oneInternetGatewayFromResponse(
      response,
      authority.internetGatewayId,
      authority.plan.providerScope.accountId,
    );
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Map<string, Readonly<Record<string, any>>>>} */
  async function discoverByVpcOnce(authority) {
    const matches = new Map();
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
                Values: [authority.vpcId],
              },
            ],
            MaxResults:
              AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DISCOVERY_MAX_RESULTS,
            ...(nextToken === null ? {} : { NextToken: nextToken }),
          }),
        );
      } catch {
        throw new ProviderResponseUnknownError();
      }
      const observed = discoveryPage(
        response,
        authority.plan.providerScope.accountId,
      );
      for (const internetGateway of observed.internetGateways) {
        if (matches.has(internetGateway.InternetGatewayId)) {
          throw new InternetGatewayAttachmentEvidenceConflictError();
        }
        matches.set(internetGateway.InternetGatewayId, internetGateway);
      }
      if (observed.nextToken === null) return matches;
      if (
        page ===
          AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_DISCOVERY_PAGES ||
        seenTokens.has(observed.nextToken)
      ) {
        throw new ProviderResponseUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    throw new ProviderResponseUnknownError();
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<'present'|'absent'>} */
  async function readLogicalState(authority) {
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
      exact = await describeExactOnce(authority);
      exactReadCompleted = true;
    } catch (error) {
      errors.push(error);
    }
    try {
      broad = await discoverByVpcOnce(authority);
    } catch (error) {
      errors.push(error);
    }
    if (exact !== null) {
      try {
        exactState = exactAttachmentState(exact, authority.vpcId);
      } catch (error) {
        errors.push(error);
      }
    }
    // Classify every successful broad read independently. Visible conflicting
    // occupancy must not be hidden by an unavailable or malformed exact read.
    if (broad !== null) {
      try {
        broadState = broadAttachmentState(
          broad,
          authority.internetGatewayId,
          authority.vpcId,
        );
      } catch (error) {
        errors.push(error);
      }
    }
    if (exactReadCompleted && exact === null) {
      // A broad view of the exact endpoint can race an eventually consistent
      // exact not-found. Two readable absent views contradict the bound
      // dependency; an unavailable broad view remains unknown.
      if (broadState === 'present' || broadState === 'transient') {
        errors.push(new InternetGatewayAttachmentEvidenceTransientError());
      } else if (broadState === 'absent') {
        errors.push(new InternetGatewayAttachmentEvidenceConflictError());
      }
    } else if (exactState !== null && broadState !== null) {
      if (
        exactState === 'transient' ||
        broadState === 'transient' ||
        exactState !== broadState
      ) {
        errors.push(new InternetGatewayAttachmentEvidenceTransientError());
      } else if (errors.length === 0) {
        return exactState;
      }
    }
    const strongest = strongestEvidenceError(errors);
    if (strongest !== null) throw strongest;
    throw new ProviderResponseUnknownError();
  }

  /** @param {unknown} value @returns {Promise<void>} */
  async function executeAction(value) {
    const authority = validateActionContext(value, providerScope);
    if (authority.action.action === 'noop') return;
    let state;
    try {
      state = await readLogicalState(authority);
    } catch (error) {
      if (error instanceof InternetGatewayAttachmentEvidenceConflictError) {
        throw new AwsSingleNodeInternetGatewayAttachmentResourceConflictError();
      }
      if (error instanceof InternetGatewayAttachmentEvidenceTransientError) {
        return;
      }
      throw new AwsSingleNodeInternetGatewayAttachmentResourceUnknownError();
    }
    if (authority.action.action === 'delete') {
      if (state === 'absent') return;
      try {
        await client.detachInternetGateway(
          deepFreeze({
            InternetGatewayId: authority.internetGatewayId,
            VpcId: authority.vpcId,
          }),
        );
      } catch (error) {
        if (
          errorNamed(error, 'Gateway.NotAttached') ||
          errorNamed(error, 'IncorrectState') ||
          errorNamed(error, 'DependencyViolation')
        ) {
          return;
        }
        throw new AwsSingleNodeInternetGatewayAttachmentResourceUnknownError();
      }
      return;
    }
    if (state === 'present') return;
    try {
      await client.attachInternetGateway(
        deepFreeze({
          InternetGatewayId: authority.internetGatewayId,
          VpcId: authority.vpcId,
        }),
      );
    } catch (error) {
      if (
        errorNamed(error, 'Resource.AlreadyAssociated') ||
        errorNamed(error, 'IncorrectState')
      ) {
        return;
      }
      throw new AwsSingleNodeInternetGatewayAttachmentResourceUnknownError();
    }
  }

  /** @param {unknown} value @returns {Promise<{status: 'converged', binding: Readonly<Record<string, any>>|null}|{status: 'not-converged'}|{status: 'blocked'}>} */
  async function verifySettlement(value) {
    const authority = validateActionContext(value, providerScope);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const state = await readLogicalState(authority);
        if (state === 'present' && authority.action.action !== 'delete') {
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
              ownershipMode: 'derived',
              onDestroy: 'purge',
              dependencyBindings: authority.dependencyBindings,
              providerType: PROVIDER_TYPE,
              providerResourceId: authority.providerResourceId,
              providerScopeId: providerScope.providerScopeId,
              ownershipNonce: authority.ownershipNonce,
              createdByActionId: authority.action.actionId,
            });
          return deepFreeze({ status: 'converged', binding });
        }
        if (state === 'absent' && authority.action.action === 'delete') {
          return deepFreeze({ status: 'converged', binding: null });
        }
      } catch (error) {
        if (error instanceof InternetGatewayAttachmentEvidenceConflictError) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          !(error instanceof ProviderResponseUnknownError) &&
          !(error instanceof InternetGatewayAttachmentEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof ProviderResponseUnknownError) {
            throw new AwsSingleNodeInternetGatewayAttachmentResourceUnknownError();
          }
          return Object.freeze({ status: 'not-converged' });
        }
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
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_STATE_DIGEST_DOMAIN,
  AwsSingleNodeInternetGatewayAttachmentResourceConflictError,
  AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
  createAwsSingleNodeInternetGatewayAttachmentResource,
  getAwsSingleNodeInternetGatewayAttachmentStateDigest,
};
