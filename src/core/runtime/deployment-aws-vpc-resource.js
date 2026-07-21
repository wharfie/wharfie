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
  AwsTaggedEc2RecoveryConflictError as VpcEvidenceConflictError,
  AwsTaggedEc2RecoveryTransientError as VpcEvidenceTransientError,
  AwsTaggedEc2RecoveryUnknownError as ProviderResponseUnknownError,
  createAwsTaggedEc2RecoveryKernel,
} from './deployment-aws-tagged-ec2-recovery.js';

export const AWS_SINGLE_NODE_VPC_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_VPC_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_VPC_MAX_DISCOVERY_PAGES = 16;
export const AWS_SINGLE_NODE_VPC_DISCOVERY_MAX_RESULTS = 100;
export const AWS_SINGLE_NODE_VPC_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ec2-vpc-state:v1';

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
  'createVpc',
  'describeVpcs',
  'describeVpcAttribute',
  'deleteVpc',
]);
const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,32}$/;
const VPC_CIDR_ASSOCIATION_ID_PATTERN = /^vpc-cidr-assoc-[0-9a-f]{8,32}$/;
const DHCP_OPTIONS_ID_PATTERN = /^dopt-[0-9a-f]{8,32}$/;
const MAX_VPC_TAGS = 50;

const BASE_RESERVED_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'single-node-vpc',
  'wharfie:retention': 'purge',
  'wharfie:schema-version': '2',
});

/** Exact controller authority or present provider evidence is contradictory. */
export class AwsSingleNodeVpcResourceConflictError extends Error {
  constructor() {
    super('AWS single-node VPC resource conflicts with its exact contract.');
    this.name = 'AwsSingleNodeVpcResourceConflictError';
    this.code = 'AWS_SINGLE_NODE_VPC_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeVpcResourceUnknownError extends Error {
  constructor() {
    super('AWS single-node VPC resource state is unknown.');
    this.name = 'AwsSingleNodeVpcResourceUnknownError';
    this.code = 'AWS_SINGLE_NODE_VPC_RESOURCE_UNKNOWN';
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
 * Derive the exact provider-observable VPC state. Relationship resources are
 * intentionally excluded; each is a later independently recoverable graph
 * effect.
 * @param {unknown} value - Exact AWS single-node provider specification.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>} - State digest.
 */
export function getAwsSingleNodeVpcStateDigest(value) {
  const providerSpec = validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeVpcState providerSpec',
  );
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEc2VpcState',
    cidrBlock: providerSpec.capabilities.networking.vpcCidr,
    instanceTenancy: 'default',
    isDefault: false,
    ipv6: false,
    enableDnsSupport: true,
    enableDnsHostnames: false,
    internetGatewayBlockMode: 'off',
    onDestroy: 'purge',
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_VPC_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {Readonly<import('@aws-sdk/client-ec2').CreateVpcCommandInput>} */
function createVpcRequest(authority, recovery) {
  return deepFreeze({
    AmazonProvidedIpv6CidrBlock: false,
    CidrBlock: authority.providerSpec.capabilities.networking.vpcCidr,
    InstanceTenancy: 'default',
    TagSpecifications: [
      {
        ResourceType: 'vpc',
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
    binding.providerType === 'ec2-vpc' &&
    VPC_ID_PATTERN.test(binding.providerResourceId) &&
    binding.deploymentInstanceId === plan.deploymentInstanceId &&
    binding.resourceKey === 'network-vpc' &&
    binding.providerScopeId === providerScope.providerScopeId &&
    binding.incarnationId === plan.incarnationId &&
    sameJson(binding.capability, action.capability) &&
    sameJson(binding.role, action.role) &&
    binding.ownershipMode === 'direct' &&
    binding.onDestroy === 'purge' &&
    binding.dependencyBindings.length === 0 &&
    binding.ownershipNonce === ownershipNonce &&
    action.before !== null &&
    action.before.providerType === 'ec2-vpc' &&
    action.before.providerResourceId === binding.providerResourceId
  );
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, any>>} */
function validateActionContext(value, providerScope) {
  if (!isPlainObject(value)) {
    throw new TypeError('awsSingleNodeVpc action context must be an object.');
  }
  assertExactKeys(value, ACTION_CONTEXT_KEYS, 'awsSingleNodeVpc context');
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeVpc context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const canonicalProviderSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeVpc context.head',
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
    throw new AwsSingleNodeVpcResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeVpcResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  if (
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    action.resourceKey !== 'network-vpc' ||
    !sameJson(action.capability, { kind: 'networking', version: 1 }) ||
    !sameJson(action.role, { kind: 'vpc', version: 1 }) ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'direct' ||
    action.onDestroy !== 'purge' ||
    action.dependsOn.length !== 0
  ) {
    throw new AwsSingleNodeVpcResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeVpc context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeVpcResourceConflictError();
  }
  const stateDigest = getAwsSingleNodeVpcStateDigest(canonicalProviderSpec);
  const priorBinding = head.resourceBindings.find(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.resourceKey === action.resourceKey,
  );
  if (action.action === 'create') {
    if (
      plan.operation === 'destroy' ||
      action.before !== null ||
      action.after === null ||
      action.after.providerType !== 'ec2-vpc' ||
      action.after.providerResourceId !== null ||
      !sameJson(action.after.stateDigest, stateDigest) ||
      priorBinding !== undefined
    ) {
      throw new AwsSingleNodeVpcResourceConflictError();
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
      action.after.providerType !== 'ec2-vpc' ||
      action.after.providerResourceId !== priorBinding.providerResourceId ||
      !sameJson(action.after.stateDigest, stateDigest)
    ) {
      throw new AwsSingleNodeVpcResourceConflictError();
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
      throw new AwsSingleNodeVpcResourceConflictError();
    }
  } else {
    throw new AwsSingleNodeVpcResourceConflictError();
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
function candidateVpcId(value) {
  if (!isPlainObject(value) || !isPlainObject(value.Vpc)) return null;
  return typeof value.Vpc.VpcId === 'string' &&
    VPC_ID_PATTERN.test(value.Vpc.VpcId)
    ? value.Vpc.VpcId
    : null;
}

/** @param {unknown} response @param {string} exactVpcId @returns {Readonly<Record<string, any>>|null} */
function oneVpcFromResponse(response, exactVpcId) {
  if (!isPlainObject(response) || !Array.isArray(response.Vpcs)) {
    throw new ProviderResponseUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new VpcEvidenceConflictError();
  }
  if (response.Vpcs.length === 0) throw new ProviderResponseUnknownError();
  if (response.Vpcs.length !== 1) throw new VpcEvidenceConflictError();
  const vpc = response.Vpcs[0];
  if (
    !isPlainObject(vpc) ||
    typeof vpc.VpcId !== 'string' ||
    !VPC_ID_PATTERN.test(vpc.VpcId)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (vpc.VpcId !== exactVpcId) throw new VpcEvidenceConflictError();
  return vpc;
}

/** @param {unknown} response @returns {{vpcs: Readonly<Record<string, any>>[], nextToken: string|null}} */
function discoveryPage(response) {
  if (!isPlainObject(response) || !Array.isArray(response.Vpcs)) {
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
  const vpcs = [];
  for (const vpc of response.Vpcs) {
    if (
      !isPlainObject(vpc) ||
      typeof vpc.VpcId !== 'string' ||
      !VPC_ID_PATTERN.test(vpc.VpcId)
    ) {
      throw new ProviderResponseUnknownError();
    }
    vpcs.push(vpc);
  }
  return { vpcs, nextToken };
}

/** @param {unknown} value @param {string} expectedState @param {boolean} allowPropagation @returns {void} */
function validateCidrAssociations(value, expectedState, allowPropagation) {
  if (!Array.isArray(value)) {
    if (allowPropagation && (value === undefined || value === null)) {
      throw new VpcEvidenceTransientError();
    }
    throw new ProviderResponseUnknownError();
  }
  if (value.length === 0 && allowPropagation) {
    throw new VpcEvidenceTransientError();
  }
  if (value.length !== 1) throw new VpcEvidenceConflictError();
  const association = value[0];
  if (
    !isPlainObject(association) ||
    typeof association.AssociationId !== 'string' ||
    !VPC_CIDR_ASSOCIATION_ID_PATTERN.test(association.AssociationId) ||
    typeof association.CidrBlock !== 'string' ||
    !isPlainObject(association.CidrBlockState) ||
    typeof association.CidrBlockState.State !== 'string'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    association.CidrBlockState.StatusMessage !== undefined &&
    association.CidrBlockState.StatusMessage !== null &&
    typeof association.CidrBlockState.StatusMessage !== 'string'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (association.CidrBlock !== expectedState) {
    throw new VpcEvidenceConflictError();
  }
  if (association.CidrBlockState.State === 'associating') {
    throw new VpcEvidenceTransientError();
  }
  if (
    association.CidrBlockState.State !== 'associated' ||
    (association.CidrBlockState.StatusMessage !== undefined &&
      association.CidrBlockState.StatusMessage !== null)
  ) {
    throw new VpcEvidenceConflictError();
  }
}

/** @param {unknown} value @returns {void} */
function validateIpv6Associations(value) {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new ProviderResponseUnknownError();
  if (value.length === 0) return;
  for (const association of value) {
    if (
      !isPlainObject(association) ||
      typeof association.AssociationId !== 'string' ||
      !VPC_CIDR_ASSOCIATION_ID_PATTERN.test(association.AssociationId) ||
      typeof association.Ipv6CidrBlock !== 'string' ||
      association.Ipv6CidrBlock.length === 0 ||
      !isPlainObject(association.Ipv6CidrBlockState) ||
      typeof association.Ipv6CidrBlockState.State !== 'string' ||
      (association.Ipv6CidrBlockState.StatusMessage !== undefined &&
        association.Ipv6CidrBlockState.StatusMessage !== null &&
        typeof association.Ipv6CidrBlockState.StatusMessage !== 'string')
    ) {
      throw new ProviderResponseUnknownError();
    }
  }
  throw new VpcEvidenceConflictError();
}

/** @param {unknown} value @returns {void} */
function validateBlockPublicAccessStates(value) {
  if (
    !isPlainObject(value) ||
    typeof value.InternetGatewayBlockMode !== 'string'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (value.InternetGatewayBlockMode === 'off') return;
  if (
    value.InternetGatewayBlockMode === 'block-ingress' ||
    value.InternetGatewayBlockMode === 'block-bidirectional'
  ) {
    throw new VpcEvidenceConflictError();
  }
  throw new ProviderResponseUnknownError();
}

/** @param {Readonly<Record<string, any>>} vpc @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {void} */
function validateVpcOwnershipEvidence(vpc, authority, recovery) {
  if (
    typeof vpc.VpcId !== 'string' ||
    !VPC_ID_PATTERN.test(vpc.VpcId) ||
    typeof vpc.OwnerId !== 'string' ||
    typeof vpc.State !== 'string'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (vpc.OwnerId !== authority.plan.providerScope.accountId) {
    throw new VpcEvidenceConflictError();
  }
  recovery.validateTags(
    vpc.Tags,
    recovery.requiredTags(authority),
    authority.action.action === 'create',
  );
  if (vpc.State === 'pending') throw new VpcEvidenceTransientError();
  if (vpc.State !== 'available') throw new VpcEvidenceConflictError();
}

/** @param {Readonly<Record<string, any>>} vpc @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {void} */
function validateVpcDeletionEvidence(vpc, authority, recovery) {
  validateVpcOwnershipEvidence(vpc, authority, recovery);
  if (typeof vpc.IsDefault !== 'boolean') {
    throw new ProviderResponseUnknownError();
  }
  if (vpc.IsDefault) throw new VpcEvidenceConflictError();
}

/** @param {Readonly<Record<string, any>>} vpc @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {void} */
function validateVpcBaseEvidence(vpc, authority, recovery) {
  const expectedCidr = authority.providerSpec.capabilities.networking.vpcCidr;
  validateVpcOwnershipEvidence(vpc, authority, recovery);
  if (
    typeof vpc.CidrBlock !== 'string' ||
    typeof vpc.InstanceTenancy !== 'string' ||
    typeof vpc.IsDefault !== 'boolean' ||
    typeof vpc.DhcpOptionsId !== 'string' ||
    !DHCP_OPTIONS_ID_PATTERN.test(vpc.DhcpOptionsId)
  ) {
    throw new ProviderResponseUnknownError();
  }
  validateIpv6Associations(vpc.Ipv6CidrBlockAssociationSet);
  validateBlockPublicAccessStates(vpc.BlockPublicAccessStates);
  if (
    vpc.CidrBlock !== expectedCidr ||
    vpc.InstanceTenancy !== 'default' ||
    vpc.IsDefault
  ) {
    throw new VpcEvidenceConflictError();
  }
  validateCidrAssociations(
    vpc.CidrBlockAssociationSet,
    expectedCidr,
    authority.action.action === 'create',
  );
}

/**
 * A create plan is non-destructive. Discovery may prove exactly one matching
 * effect, but it must never compact multiple VPCs behind that plan. A match
 * that becomes visible only after a binding was published is therefore
 * surfaced by later noop/destroy discovery as a conflict; EC2 offers neither
 * a CreateVpc client token nor a linearizable tag query that can eliminate
 * that late-visibility window.
 */

/**
 * Bind one exact directly owned VPC to the fixed AWS single-node graph.
 * The factory never owns or closes the caller's narrow EC2 client.
 * @param {unknown} options - Exact dependencies and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>} - Controller action ports.
 */
export function createAwsSingleNodeVpcResource(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('awsSingleNodeVpc options must be an object.');
  }
  assertSupportedKeys(options, FACTORY_KEYS, 'awsSingleNodeVpc options');
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeVpc options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError('awsSingleNodeVpc client must be an object.');
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(`awsSingleNodeVpc client.${method} is required.`);
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeVpc providerScope',
  );
  const maxAttempts =
    options.maxAttempts ?? AWS_SINGLE_NODE_VPC_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_VPC_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeVpc maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_VPC_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError('awsSingleNodeVpc waitForRetry must be a function.');
  }
  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeVpcResourceUnknownError();
    }
  }

  /** @param {string} vpcId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function describeExactOnce(vpcId) {
    let response;
    try {
      response = await client.describeVpcs(deepFreeze({ VpcIds: [vpcId] }));
    } catch (error) {
      if (errorNamed(error, 'InvalidVpcID.NotFound')) return null;
      throw new ProviderResponseUnknownError();
    }
    return oneVpcFromResponse(response, vpcId);
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<{records: Readonly<Record<string, any>>[], nextToken: string|null}>} */
  async function readDiscoveryPage(request) {
    let response;
    try {
      response = await client.describeVpcs(request);
    } catch {
      throw new ProviderResponseUnknownError();
    }
    const observed = discoveryPage(response);
    return { records: observed.vpcs, nextToken: observed.nextToken };
  }

  const recovery = createAwsTaggedEc2RecoveryKernel({
    baseTags: BASE_RESERVED_TAGS,
    discoveryMaxResults: AWS_SINGLE_NODE_VPC_DISCOVERY_MAX_RESULTS,
    idKey: 'VpcId',
    idPattern: VPC_ID_PATTERN,
    maxDiscoveryPages: AWS_SINGLE_NODE_VPC_MAX_DISCOVERY_PAGES,
    maxTags: MAX_VPC_TAGS,
    readDiscoveryPage,
    readExact: describeExactOnce,
  });

  /** @param {unknown} response @param {string} vpcId @param {'enableDnsSupport'|'enableDnsHostnames'} attribute @param {'EnableDnsSupport'|'EnableDnsHostnames'} responseKey @param {boolean} expected @returns {void} */
  function validateAttributeResponse(
    response,
    vpcId,
    attribute,
    responseKey,
    expected,
  ) {
    if (!isPlainObject(response)) {
      throw new ProviderResponseUnknownError();
    }
    if (
      typeof response.VpcId !== 'string' ||
      !VPC_ID_PATTERN.test(response.VpcId) ||
      !isPlainObject(response[responseKey]) ||
      typeof response[responseKey].Value !== 'boolean'
    ) {
      throw new ProviderResponseUnknownError();
    }
    if (response.VpcId !== vpcId) throw new VpcEvidenceConflictError();
    const otherKey =
      attribute === 'enableDnsSupport'
        ? 'EnableDnsHostnames'
        : 'EnableDnsSupport';
    if (
      response[responseKey].Value !== expected ||
      (response[otherKey] !== undefined && response[otherKey] !== null)
    ) {
      throw new VpcEvidenceConflictError();
    }
  }

  /** @param {string} vpcId @param {'enableDnsSupport'|'enableDnsHostnames'} attribute @param {'EnableDnsSupport'|'EnableDnsHostnames'} responseKey @param {boolean} expected @returns {Promise<void>} */
  async function readAttribute(vpcId, attribute, responseKey, expected) {
    let response;
    try {
      response = await client.describeVpcAttribute(
        deepFreeze({ Attribute: attribute, VpcId: vpcId }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidVpcID.NotFound')) {
        throw new VpcEvidenceTransientError();
      }
      throw new ProviderResponseUnknownError();
    }
    validateAttributeResponse(
      response,
      vpcId,
      attribute,
      responseKey,
      expected,
    );
  }

  /** @param {string} vpcId @returns {Promise<void>} */
  async function validateVpcAttributes(vpcId) {
    await readAttribute(vpcId, 'enableDnsSupport', 'EnableDnsSupport', true);
    await readAttribute(
      vpcId,
      'enableDnsHostnames',
      'EnableDnsHostnames',
      false,
    );
  }

  /** @param {Readonly<Record<string, any>>} vpc @param {Readonly<Record<string, any>>} authority @returns {Promise<void>} */
  async function validateVpcEvidence(vpc, authority) {
    validateVpcBaseEvidence(vpc, authority, recovery);
    await validateVpcAttributes(vpc.VpcId);
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>[]>} */
  async function readLogicalMatches(authority) {
    const { discovered, exact, exactId } = await recovery.readIdentityEvidence(
      authority,
      {
        useDiscoveredId: false,
      },
    );
    if (exactId === null) {
      if (discovered === null) return [];
      await validateVpcEvidence(discovered, authority);
      return [discovered];
    }
    if (authority.action.action === 'delete') {
      if (discovered !== null) {
        validateVpcDeletionEvidence(discovered, authority, recovery);
      }
      if (exact !== null) {
        validateVpcDeletionEvidence(exact, authority, recovery);
      }
    } else {
      if (discovered !== null) {
        validateVpcBaseEvidence(discovered, authority, recovery);
      }
      if (exact !== null) validateVpcBaseEvidence(exact, authority, recovery);
    }
    if (discovered === null && exact === null) return [];
    if (discovered === null || exact === null) {
      throw new VpcEvidenceTransientError();
    }
    if (authority.action.action !== 'delete') {
      await validateVpcAttributes(exactId);
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
      if (error instanceof VpcEvidenceConflictError) {
        throw new AwsSingleNodeVpcResourceConflictError();
      }
      throw new AwsSingleNodeVpcResourceUnknownError();
    }
    if (authority.action.action === 'delete') {
      if (matches.length === 0) return;
      const vpcId = authority.priorBinding.providerResourceId;
      try {
        await client.deleteVpc(deepFreeze({ VpcId: vpcId }));
      } catch (error) {
        if (errorNamed(error, 'InvalidVpcID.NotFound')) return;
        if (
          errorNamed(error, 'DependencyViolation') ||
          errorNamed(error, 'IncorrectState')
        ) {
          return;
        }
        throw new AwsSingleNodeVpcResourceUnknownError();
      }
      return;
    }
    if (matches.length === 1) return;
    if (!recovery.claimCreateAttempt(authority)) {
      throw new AwsSingleNodeVpcResourceUnknownError();
    }
    let response;
    try {
      response = await client.createVpc(createVpcRequest(authority, recovery));
    } catch {
      throw new AwsSingleNodeVpcResourceUnknownError();
    }
    const vpcId = candidateVpcId(response);
    if (vpcId === null) throw new AwsSingleNodeVpcResourceUnknownError();
    try {
      recovery.rememberCandidate(authority, vpcId);
    } catch (error) {
      if (error instanceof VpcEvidenceConflictError) {
        throw new AwsSingleNodeVpcResourceConflictError();
      }
      throw new AwsSingleNodeVpcResourceUnknownError();
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
          const vpc = matches[0];
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
              providerType: 'ec2-vpc',
              providerResourceId: vpc.VpcId,
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
        if (error instanceof VpcEvidenceConflictError) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          !(error instanceof ProviderResponseUnknownError) &&
          !(error instanceof VpcEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof ProviderResponseUnknownError) {
            throw new AwsSingleNodeVpcResourceUnknownError();
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
  AWS_SINGLE_NODE_VPC_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VPC_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_VPC_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VPC_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_VPC_STATE_DIGEST_DOMAIN,
  AwsSingleNodeVpcResourceConflictError,
  AwsSingleNodeVpcResourceUnknownError,
  createAwsSingleNodeVpcResource,
  getAwsSingleNodeVpcStateDigest,
};
