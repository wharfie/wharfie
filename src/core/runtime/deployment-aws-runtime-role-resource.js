/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import { validateAwsSingleNodeProviderSpecContext } from './deployment-aws-provider-spec.js';
import {
  AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
  AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  assertAwsIamRoleId,
  getAwsSingleNodeRuntimeRoleName,
  getAwsSingleNodeRuntimeRoleStateDigest,
  getAwsSingleNodeRuntimeRoleTrustPolicy,
} from './deployment-aws-runtime-identity-contract.js';
import {
  AWS_IAM_EVIDENCE_MAX_READ_PAGES,
  AWS_IAM_EVIDENCE_READ_MAX_ITEMS,
  AwsIamEvidenceConflictError,
  AwsIamEvidenceTransientError,
  AwsIamEvidenceUnknownError,
  decodeAwsIamAttachedPolicies,
  decodeAwsIamPolicyNames,
  decodeAwsIamTags,
  isAwsIamErrorNamed,
  readAwsIamListPages,
  validateAwsIamTags,
} from './deployment-aws-iam-evidence.js';
import {
  AWS_SINGLE_NODE_RUNTIME_ROLE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_ATTEMPTS,
  decodeAwsSingleNodeRuntimeRoleEvidence,
  decodeAwsSingleNodeRuntimeRoleResponse,
  getAwsSingleNodeRuntimeRoleOwnershipTags,
} from './deployment-aws-runtime-role-evidence.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  createDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';

export {
  AWS_SINGLE_NODE_RUNTIME_ROLE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_ATTEMPTS,
};
export const AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_READ_PAGES =
  AWS_IAM_EVIDENCE_MAX_READ_PAGES;
export const AWS_SINGLE_NODE_RUNTIME_ROLE_READ_MAX_ITEMS =
  AWS_IAM_EVIDENCE_READ_MAX_ITEMS;

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
  'createRole',
  'getRole',
  'deleteRole',
  'listRoleTags',
  'listRolePolicies',
  'listAttachedRolePolicies',
  'listInstanceProfilesForRole',
]);

/** Exact controller authority or present provider evidence is contradictory. */
export class AwsSingleNodeRuntimeRoleResourceConflictError extends Error {
  constructor() {
    super('AWS single-node runtime role conflicts with its exact contract.');
    this.name = 'AwsSingleNodeRuntimeRoleResourceConflictError';
    this.code = 'AWS_SINGLE_NODE_RUNTIME_ROLE_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeRuntimeRoleResourceUnknownError extends Error {
  constructor() {
    super('AWS single-node runtime role state is unknown.');
    this.name = 'AwsSingleNodeRuntimeRoleResourceUnknownError';
    this.code = 'AWS_SINGLE_NODE_RUNTIME_ROLE_RESOURCE_UNKNOWN';
  }
}

class RuntimeRoleDeleteBlockedError extends Error {}

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

/** @param {number} attempt @returns {Promise<void>} */
async function defaultWaitForRetry(attempt) {
  const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>} */
function requiredTags(authority) {
  return getAwsSingleNodeRuntimeRoleOwnershipTags({
    capabilityKind: authority.action.capability.kind,
    roleKind: authority.action.role.kind,
    providerScopeId: authority.plan.providerScope.providerScopeId,
    deploymentInstanceId: authority.plan.deploymentInstanceId,
    incarnationId: authority.plan.incarnationId,
    resourceKey: authority.action.resourceKey,
    createdByActionId:
      authority.priorBinding?.createdByActionId ?? authority.action.actionId,
    ownershipNonce: authority.ownershipNonce,
    stateDigest: authority.stateDigest,
  });
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<import('@aws-sdk/client-iam').CreateRoleCommandInput>} */
function createRoleRequest(authority) {
  return deepFreeze({
    RoleName: authority.roleName,
    Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
    AssumeRolePolicyDocument: JSON.stringify(
      getAwsSingleNodeRuntimeRoleTrustPolicy(),
    ),
    Description: AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
    MaxSessionDuration: AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
    Tags: requiredTags(authority),
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
  let validRoleId = true;
  try {
    assertAwsIamRoleId(binding.providerResourceId);
  } catch {
    validRoleId = false;
  }
  return (
    validRoleId &&
    binding.management === 'managed' &&
    binding.providerType === 'iam-role' &&
    binding.deploymentInstanceId === plan.deploymentInstanceId &&
    binding.resourceKey === 'runtime-role' &&
    binding.providerScopeId === providerScope.providerScopeId &&
    binding.incarnationId === plan.incarnationId &&
    sameJson(binding.capability, action.capability) &&
    sameJson(binding.role, action.role) &&
    binding.ownershipMode === 'direct' &&
    binding.onDestroy === 'purge' &&
    binding.dependencyBindings.length === 0 &&
    binding.ownershipNonce === ownershipNonce &&
    action.before !== null &&
    action.before.providerType === 'iam-role' &&
    action.before.providerResourceId === binding.providerResourceId
  );
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, any>>} */
function validateActionContext(value, providerScope) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeRuntimeRole action context must be an object.',
    );
  }
  assertExactKeys(
    value,
    ACTION_CONTEXT_KEYS,
    'awsSingleNodeRuntimeRole context',
  );
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeRuntimeRole context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const canonicalProviderSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeRuntimeRole context.head',
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
    throw new AwsSingleNodeRuntimeRoleResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeRuntimeRoleResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  if (
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    action.resourceKey !== 'runtime-role' ||
    !sameJson(action.capability, { kind: 'runtime-identity', version: 1 }) ||
    !sameJson(action.role, { kind: 'role', version: 1 }) ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'direct' ||
    action.onDestroy !== 'purge' ||
    action.dependsOn.length !== 0
  ) {
    throw new AwsSingleNodeRuntimeRoleResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeRuntimeRole context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeRuntimeRoleResourceConflictError();
  }
  const nameAuthority = deepFreeze({
    providerScopeId: plan.providerScope.providerScopeId,
    deploymentInstanceId: plan.deploymentInstanceId,
    incarnationId: plan.incarnationId,
  });
  const stateDigest = getAwsSingleNodeRuntimeRoleStateDigest(nameAuthority);
  const roleName = getAwsSingleNodeRuntimeRoleName(nameAuthority);
  const priorBinding = head.resourceBindings.find(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.resourceKey === action.resourceKey,
  );
  if (action.action === 'create') {
    if (
      plan.operation === 'destroy' ||
      action.before !== null ||
      action.after === null ||
      action.after.providerType !== 'iam-role' ||
      action.after.providerResourceId !== null ||
      !sameJson(action.after.stateDigest, stateDigest) ||
      priorBinding !== undefined
    ) {
      throw new AwsSingleNodeRuntimeRoleResourceConflictError();
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
      action.after.providerType !== 'iam-role' ||
      action.after.providerResourceId !== priorBinding.providerResourceId ||
      !sameJson(action.after.stateDigest, stateDigest)
    ) {
      throw new AwsSingleNodeRuntimeRoleResourceConflictError();
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
      throw new AwsSingleNodeRuntimeRoleResourceConflictError();
    }
  } else {
    throw new AwsSingleNodeRuntimeRoleResourceConflictError();
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
    roleName,
    priorBinding: priorBinding ?? null,
  });
}

/** @param {Readonly<Record<string, any>>} role @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function validateRoleEvidence(role, authority) {
  if (
    role.PermissionsBoundary !== undefined &&
    role.PermissionsBoundary !== null
  ) {
    throw new AwsIamEvidenceConflictError();
  }
  const evidence = decodeAwsSingleNodeRuntimeRoleEvidence(role, {
    providerScope: authority.plan.providerScope,
    roleName: authority.roleName,
    providerResourceId: authority.priorBinding?.providerResourceId ?? null,
  });
  if (!sameJson(evidence.observedDigest, authority.stateDigest)) {
    throw new AwsIamEvidenceConflictError();
  }
  return evidence;
}

/** @param {Readonly<Record<string, any>>} client @param {string} method @param {string} itemKey @param {Readonly<Record<string, any>>} baseRequest @param {(items: unknown[]) => readonly unknown[]} decodeItems @returns {Promise<unknown[]>} */
async function readIamList(client, method, itemKey, baseRequest, decodeItems) {
  return readAwsIamListPages({
    readPage: async (/** @type {Readonly<Record<string, any>>} */ request) => {
      try {
        return await client[method](request);
      } catch (error) {
        if (isAwsIamErrorNamed(error, 'NoSuchEntity')) {
          throw new AwsIamEvidenceTransientError();
        }
        throw new AwsIamEvidenceUnknownError();
      }
    },
    decodeItems,
    itemKey,
    baseRequest,
    maxPages: AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_READ_PAGES,
    maxItems: AWS_SINGLE_NODE_RUNTIME_ROLE_READ_MAX_ITEMS,
  });
}

/**
 * Bind one exact directly owned IAM role to the fixed AWS single-node graph.
 * The factory never owns or closes the caller's narrow IAM/EC2 client.
 * @param {unknown} options - Exact dependencies and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>} - Controller action ports.
 */
export function createAwsSingleNodeRuntimeRoleResource(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('awsSingleNodeRuntimeRole options must be an object.');
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeRuntimeRole options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeRuntimeRole options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError('awsSingleNodeRuntimeRole client must be an object.');
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeRuntimeRole client.${method} is required.`,
      );
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeRuntimeRole providerScope',
  );
  const maxAttempts =
    options.maxAttempts ?? AWS_SINGLE_NODE_RUNTIME_ROLE_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeRuntimeRole maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeRuntimeRole waitForRetry must be a function.',
    );
  }
  /** @type {Set<string>} */
  const claimedCreateAttempts = new Set();

  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeRuntimeRoleResourceUnknownError();
    }
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readRole(authority) {
    let response;
    try {
      response = await client.getRole(
        deepFreeze({ RoleName: authority.roleName }),
      );
    } catch (error) {
      if (isAwsIamErrorNamed(error, 'NoSuchEntity')) return null;
      throw new AwsIamEvidenceUnknownError();
    }
    const role = decodeAwsSingleNodeRuntimeRoleResponse(
      response,
      authority.roleName,
    );
    const roleEvidence = validateRoleEvidence(role, authority);
    const expectedTags = requiredTags(authority);
    const seenTagKeys = new Set();

    const tags = await readIamList(
      client,
      'listRoleTags',
      'Tags',
      deepFreeze({ RoleName: authority.roleName }),
      (items) => {
        const decoded = decodeAwsIamTags(items);
        for (const tag of decoded) {
          if (seenTagKeys.has(tag.Key)) {
            throw new AwsIamEvidenceConflictError();
          }
          seenTagKeys.add(tag.Key);
          const expected = expectedTags.find(
            (candidate) => candidate.Key === tag.Key,
          );
          if (expected === undefined || expected.Value !== tag.Value) {
            throw new AwsIamEvidenceConflictError();
          }
        }
        return decoded;
      },
    );
    validateAwsIamTags(tags, expectedTags, {
      allowIncomplete: authority.action.action !== 'noop',
    });

    const inlinePolicies = decodeAwsIamPolicyNames(
      await readIamList(
        client,
        'listRolePolicies',
        'PolicyNames',
        deepFreeze({ RoleName: authority.roleName }),
        (items) => {
          const decoded = decodeAwsIamPolicyNames(items);
          if (decoded.length !== 0) {
            if (authority.action.action === 'delete') {
              throw new RuntimeRoleDeleteBlockedError();
            }
            if (
              decoded.some(
                (name) => name !== AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
              )
            ) {
              throw new AwsIamEvidenceConflictError();
            }
          }
          return [...decoded];
        },
      ),
    );
    const attachedPolicies = await readIamList(
      client,
      'listAttachedRolePolicies',
      'AttachedPolicies',
      deepFreeze({ RoleName: authority.roleName }),
      (items) => {
        const decoded = decodeAwsIamAttachedPolicies(items);
        if (decoded.length !== 0) {
          if (authority.action.action === 'delete') {
            throw new RuntimeRoleDeleteBlockedError();
          }
          throw new AwsIamEvidenceConflictError();
        }
        return [...decoded];
      },
    );
    decodeAwsIamAttachedPolicies(attachedPolicies);

    if (authority.action.action === 'delete') {
      await readIamList(
        client,
        'listInstanceProfilesForRole',
        'InstanceProfiles',
        deepFreeze({ RoleName: authority.roleName }),
        (items) => {
          if (items.length !== 0) throw new RuntimeRoleDeleteBlockedError();
          return items;
        },
      );
      if (inlinePolicies.length !== 0 || attachedPolicies.length !== 0) {
        throw new RuntimeRoleDeleteBlockedError();
      }
    } else if (
      (inlinePolicies.length === 1 &&
        inlinePolicies[0] !== AWS_SINGLE_NODE_RUNTIME_POLICY_NAME) ||
      inlinePolicies.length > 1 ||
      attachedPolicies.length !== 0
    ) {
      throw new AwsIamEvidenceConflictError();
    }
    return roleEvidence;
  }

  /** @param {unknown} value @returns {Promise<void>} */
  async function executeAction(value) {
    const authority = validateActionContext(value, providerScope);
    if (authority.action.action === 'noop') return;
    let role;
    try {
      role = await readRole(authority);
    } catch (error) {
      if (error instanceof AwsIamEvidenceConflictError) {
        throw new AwsSingleNodeRuntimeRoleResourceConflictError();
      }
      if (
        authority.action.action === 'create' &&
        error instanceof AwsIamEvidenceTransientError
      ) {
        return;
      }
      if (
        authority.action.action === 'delete' &&
        (error instanceof RuntimeRoleDeleteBlockedError ||
          error instanceof AwsIamEvidenceTransientError)
      ) {
        return;
      }
      throw new AwsSingleNodeRuntimeRoleResourceUnknownError();
    }
    if (authority.action.action === 'delete') {
      if (role === null) return;
      try {
        await client.deleteRole(deepFreeze({ RoleName: authority.roleName }));
      } catch (error) {
        if (isAwsIamErrorNamed(error, 'NoSuchEntity')) return;
        if (
          isAwsIamErrorNamed(error, 'DeleteConflict') ||
          isAwsIamErrorNamed(error, 'ConcurrentModification')
        ) {
          return;
        }
        // DeleteRole is deterministic and safely replayable. Recover an
        // ambiguous response through exact ownership readback so a lost
        // success does not turn an already-absent role into an unknown action.
        try {
          await readRole(authority);
        } catch (readError) {
          if (
            readError instanceof AwsIamEvidenceConflictError ||
            readError instanceof AwsIamEvidenceTransientError ||
            readError instanceof RuntimeRoleDeleteBlockedError
          ) {
            return;
          }
          throw new AwsSingleNodeRuntimeRoleResourceUnknownError();
        }
        return;
      }
      return;
    }
    if (role !== null) return;

    const createAttemptKey = `${authority.action.actionId}\0${authority.ownershipNonce}`;
    if (claimedCreateAttempts.has(createAttemptKey)) {
      throw new AwsSingleNodeRuntimeRoleResourceUnknownError();
    }
    claimedCreateAttempts.add(createAttemptKey);

    let createFailed = false;
    try {
      await client.createRole(createRoleRequest(authority));
    } catch {
      createFailed = true;
    }

    // CreateRole has no idempotency token. Whether the response was returned,
    // lost, or classified as EntityAlreadyExists, only exact named readback and
    // the atomic ownership tags may prove that this durable intent took effect.
    try {
      const recovered = await readRole(authority);
      if (recovered !== null) return;
    } catch (error) {
      if (error instanceof AwsIamEvidenceConflictError) {
        throw new AwsSingleNodeRuntimeRoleResourceConflictError();
      }
      if (error instanceof AwsIamEvidenceTransientError) return;
      throw new AwsSingleNodeRuntimeRoleResourceUnknownError();
    }
    if (createFailed) {
      throw new AwsSingleNodeRuntimeRoleResourceUnknownError();
    }
  }

  /** @param {unknown} value @returns {Promise<{status: 'converged', binding: Readonly<Record<string, any>>|null}|{status: 'not-converged'}|{status: 'blocked'}>} */
  async function verifySettlement(value) {
    const authority = validateActionContext(value, providerScope);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const role = await readRole(authority);
        if (role !== null) {
          if (authority.action.action === 'delete') {
            return Object.freeze({ status: 'not-converged' });
          }
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
              providerType: 'iam-role',
              providerResourceId: role.providerResourceId,
              providerScopeId: providerScope.providerScopeId,
              ownershipNonce: authority.ownershipNonce,
              createdByActionId: authority.action.actionId,
            });
          return deepFreeze({ status: 'converged', binding });
        }
        if (authority.action.action === 'delete') {
          return deepFreeze({ status: 'converged', binding: null });
        }
        if (authority.action.action === 'noop') {
          return Object.freeze({ status: 'blocked' });
        }
      } catch (error) {
        if (
          error instanceof AwsIamEvidenceConflictError ||
          error instanceof RuntimeRoleDeleteBlockedError
        ) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          !(error instanceof AwsIamEvidenceUnknownError) &&
          !(error instanceof AwsIamEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof AwsIamEvidenceUnknownError) {
            throw new AwsSingleNodeRuntimeRoleResourceUnknownError();
          }
          return Object.freeze({ status: 'not-converged' });
        }
        await wait(attempt);
        continue;
      }
      if (attempt < maxAttempts) await wait(attempt);
    }
    return Object.freeze({ status: 'not-converged' });
  }

  return Object.freeze({ executeAction, verifySettlement });
}

export default {
  AWS_SINGLE_NODE_RUNTIME_ROLE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_READ_PAGES,
  AWS_SINGLE_NODE_RUNTIME_ROLE_READ_MAX_ITEMS,
  AwsSingleNodeRuntimeRoleResourceConflictError,
  AwsSingleNodeRuntimeRoleResourceUnknownError,
  createAwsSingleNodeRuntimeRoleResource,
};
