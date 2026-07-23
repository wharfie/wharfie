/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import { validateAwsSingleNodeProviderSpecContext } from './deployment-aws-provider-spec.js';
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
import {
  AWS_SINGLE_NODE_VPC_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VPC_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_VPC_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VPC_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_VPC_STATE_DIGEST_DOMAIN,
  decodeAwsSingleNodeExactVpcResponse,
  decodeAwsSingleNodeVpcAttributeResponse,
  decodeAwsSingleNodeVpcDiscoveryPage,
  decodeAwsSingleNodeVpcIdentity,
  decodeAwsSingleNodeVpcRecordState,
  getAwsSingleNodeVpcStateDigest,
} from './deployment-aws-vpc-evidence.js';

export {
  AWS_SINGLE_NODE_VPC_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VPC_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_VPC_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VPC_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_VPC_STATE_DIGEST_DOMAIN,
  getAwsSingleNodeVpcStateDigest,
};

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

/** @param {Readonly<Record<string, any>>} vpc @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} recovery @returns {void} */
function validateVpcOwnershipEvidence(vpc, authority, recovery) {
  const identity = decodeAwsSingleNodeVpcIdentity(vpc);
  if (identity.ownerId !== authority.plan.providerScope.accountId) {
    throw new VpcEvidenceConflictError();
  }
  recovery.validateTags(
    vpc.Tags,
    recovery.requiredTags(authority),
    authority.action.action === 'create',
  );
  if (identity.state === 'pending') throw new VpcEvidenceTransientError();
  if (identity.state !== 'available') throw new VpcEvidenceConflictError();
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
  const state = decodeAwsSingleNodeVpcRecordState(
    vpc,
    authority.action.action === 'create',
  );
  if (
    state.cidrBlock !== expectedCidr ||
    state.instanceTenancy !== 'default' ||
    state.isDefault ||
    state.ipv6 ||
    state.internetGatewayBlockMode !== 'off'
  ) {
    throw new VpcEvidenceConflictError();
  }
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
    return decodeAwsSingleNodeExactVpcResponse(response, vpcId);
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<{records: Readonly<Record<string, any>>[], nextToken: string|null}>} */
  async function readDiscoveryPage(request) {
    let response;
    try {
      response = await client.describeVpcs(request);
    } catch {
      throw new ProviderResponseUnknownError();
    }
    return decodeAwsSingleNodeVpcDiscoveryPage(response);
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

  /** @param {string} vpcId @param {'enableDnsSupport'|'enableDnsHostnames'} attribute @param {boolean} expected @returns {Promise<void>} */
  async function readAttribute(vpcId, attribute, expected) {
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
    const observed = decodeAwsSingleNodeVpcAttributeResponse(
      response,
      vpcId,
      attribute,
    );
    if (observed !== expected) throw new VpcEvidenceConflictError();
  }

  /** @param {string} vpcId @returns {Promise<void>} */
  async function validateVpcAttributes(vpcId) {
    await readAttribute(vpcId, 'enableDnsSupport', true);
    await readAttribute(vpcId, 'enableDnsHostnames', false);
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
