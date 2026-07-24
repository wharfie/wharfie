/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- TypeScript assertion signatures and compact internal helpers are not understood cleanly by the current JSDoc lint parser. */

import { validateSha256Digest } from './application-revision.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import {
  assertDeploymentInstanceId,
  getDeploymentInstanceId,
  validateProviderScope,
} from './deployment-provider-scope.js';
import {
  DEPLOYMENT_ACTION_ID_PREFIX,
  DEPLOYMENT_CAPABILITIES,
  assertDeploymentIncarnationId,
  validateDeploymentResourceRole,
  validateProviderResourceId as validateExactProviderResourceId,
} from './deployment-resource-binding.js';
import {
  AWS_SINGLE_NODE_RESOURCE_GRAPH_MAX_RESOURCES,
  getAwsSingleNodeResourceApplyOrder,
  getAwsSingleNodeResourceDefinition,
  getAwsSingleNodeResourceDestroyOrder,
} from './deployment-resource-graph.js';
import {
  DEPLOYMENT_CAPABILITY_IDS,
  validateDeploymentProfile,
} from './deployment-profile.js';
import {
  DEPLOYMENT_REVISION_ID_PREFIX,
  validateDeploymentRevision,
} from './deployment-revision.js';
import {
  validateAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
import { cloneJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const DEPLOYMENT_PLAN_SCHEMA_VERSION = 3;
export const DEPLOYMENT_PLAN_KIND = 'deploymentPlan';
export const DEPLOYMENT_PLAN_ID_DOMAIN = 'wharfie:deployment-plan:v3';
export const DEPLOYMENT_PLAN_ID_PREFIX = 'wpl3';
export const DEPLOYMENT_ACTION_ID_DOMAIN = 'wharfie:deployment-action:v3';
export const DEPLOYMENT_INSPECTION_ID_PREFIX = 'win6';

export const DEPLOYMENT_PLAN_OPERATIONS = Object.freeze([
  'apply',
  'reconcile',
  'destroy',
]);
export const DEPLOYMENT_PLAN_ACTIONS = Object.freeze([
  'verify',
  'create',
  'update',
  'delete',
  'noop',
]);
export const DEPLOYMENT_PLAN_REASONS = Object.freeze([
  'missing',
  'drift',
  'deployment-change',
  'destroy-requested',
  'external-verification',
  'already-converged',
  'retained-data',
]);

const PLAN_INPUT_KEYS = new Set([
  'operation',
  'deploymentRevision',
  'providerScope',
  'providerSpec',
  'deploymentInstanceId',
  'incarnationId',
  'basis',
  'actions',
]);
const PLAN_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  ...PLAN_INPUT_KEYS,
  'summary',
]);
const PLAN_DOCUMENT_KEYS = new Set(['planId', ...PLAN_PAYLOAD_KEYS]);
const BASIS_KEYS = new Set([
  'headGeneration',
  'settledDeploymentRevisionId',
  'inspectionId',
]);
const ACTION_INPUT_KEYS = new Set([
  'resourceKey',
  'capability',
  'role',
  'management',
  'ownershipMode',
  'dependsOn',
  'onDestroy',
  'action',
  'destructive',
  'reason',
  'before',
  'after',
]);
const ACTION_DOCUMENT_KEYS = new Set(['actionId', ...ACTION_INPUT_KEYS]);
const CAPABILITY_KEYS = new Set(['kind', 'version']);
const STATE_KEYS = new Set([
  'providerType',
  'providerResourceId',
  'stateDigest',
]);
const SUMMARY_KEYS = new Set([
  'create',
  'update',
  'delete',
  'verify',
  'noop',
  'destructive',
]);
const MAX_PLAN_ACTIONS = AWS_SINGLE_NODE_RESOURCE_GRAPH_MAX_RESOURCES;

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @param {boolean} [required] @returns {void} */
function assertKeys(value, keys, path, required = true) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
  if (!required) return;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
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

/** @param {unknown} value @param {string} path @returns {string|null} */
function validateProviderResourceId(value, path) {
  if (value === null) return null;
  return validateExactProviderResourceId(value, path);
}

/** @param {unknown} value @param {string} path @returns {{kind: string, version: 1}} */
function validateCapability(value, path) {
  const capability = cloneJsonObject(value, path);
  assertKeys(capability, CAPABILITY_KEYS, path);
  if (!DEPLOYMENT_CAPABILITIES.includes(capability.kind)) {
    throw new TypeError(`${path}.kind is not a supported capability.`);
  }
  if (capability.version !== 1) {
    throw new TypeError(`${path}.version must be the integer 1.`);
  }
  return { kind: capability.kind, version: 1 };
}

/** @param {unknown} value @param {string} path @returns {Record<string, any>|null} */
function validateResourceState(value, path) {
  if (value === null) return null;
  const state = cloneJsonObject(value, path);
  assertKeys(state, STATE_KEYS, path);
  assertLogicalId(state.providerType, `${path}.providerType`);
  return {
    providerType: state.providerType,
    providerResourceId: validateProviderResourceId(
      state.providerResourceId,
      `${path}.providerResourceId`,
    ),
    stateDigest:
      state.stateDigest === null
        ? null
        : validateSha256Digest(state.stateDigest, `${path}.stateDigest`),
  };
}

/** @param {unknown} value @param {string} path @returns {Record<string, any>} */
function validateBasis(value, path) {
  const basis = cloneJsonObject(value, path);
  assertKeys(basis, BASIS_KEYS, path);
  if (!Number.isSafeInteger(basis.headGeneration) || basis.headGeneration < 0) {
    throw new TypeError(
      `${path}.headGeneration must be a nonnegative safe integer.`,
    );
  }
  if (basis.settledDeploymentRevisionId !== null) {
    assertDomainSeparatedSha256Id(
      basis.settledDeploymentRevisionId,
      DEPLOYMENT_REVISION_ID_PREFIX,
      `${path}.settledDeploymentRevisionId`,
    );
  }
  assertDomainSeparatedSha256Id(
    basis.inspectionId,
    DEPLOYMENT_INSPECTION_ID_PREFIX,
    `${path}.inspectionId`,
  );
  return {
    headGeneration: basis.headGeneration,
    settledDeploymentRevisionId: basis.settledDeploymentRevisionId,
    inspectionId: basis.inspectionId,
  };
}

/**
 * @param {unknown} value - Candidate action without derived identity.
 * @param {string} operation - Plan operation.
 * @param {string} path - Human-readable value path.
 * @returns {Record<string, any>} - Canonical action fields.
 */
function validateActionInput(value, operation, path) {
  const action = cloneJsonObject(value, path);
  assertKeys(action, ACTION_INPUT_KEYS, path);
  assertLogicalId(action.resourceKey, `${path}.resourceKey`);
  const capability = validateCapability(
    action.capability,
    `${path}.capability`,
  );
  const role = validateDeploymentResourceRole(action.role, `${path}.role`);
  const resourceDefinition = getAwsSingleNodeResourceDefinition(
    action.resourceKey,
  );
  if (resourceDefinition === null) {
    throw new TypeError(
      `${path}.resourceKey is not supported by the AWS single-node resource graph.`,
    );
  }
  if (action.management !== 'managed' && action.management !== 'external') {
    throw new TypeError(`${path}.management must be 'managed' or 'external'.`);
  }
  if (action.ownershipMode !== 'direct' && action.ownershipMode !== 'derived') {
    throw new TypeError(`${path}.ownershipMode must be 'direct' or 'derived'.`);
  }
  if (!Array.isArray(action.dependsOn)) {
    throw new TypeError(`${path}.dependsOn must be an array.`);
  }
  const dependencyKeys = new Set();
  const dependsOn = action.dependsOn.map((dependency, index) => {
    assertLogicalId(dependency, `${path}.dependsOn[${index}]`);
    if (dependencyKeys.has(dependency)) {
      throw new Error(`${path}.dependsOn must contain unique resource keys.`);
    }
    dependencyKeys.add(dependency);
    return dependency;
  });
  if (action.onDestroy !== 'retain' && action.onDestroy !== 'purge') {
    throw new TypeError(`${path}.onDestroy must be 'retain' or 'purge'.`);
  }
  if (
    capability.kind !== resourceDefinition.capability.kind ||
    capability.version !== resourceDefinition.capability.version ||
    role.kind !== resourceDefinition.role.kind ||
    role.version !== resourceDefinition.role.version ||
    action.ownershipMode !== resourceDefinition.ownershipMode ||
    action.onDestroy !== resourceDefinition.onDestroy ||
    dependsOn.length !== resourceDefinition.dependsOn.length ||
    dependsOn.some(
      (dependency, index) => dependency !== resourceDefinition.dependsOn[index],
    )
  ) {
    throw new Error(
      `${path} does not match the exact AWS single-node resource graph role.`,
    );
  }
  if (!DEPLOYMENT_PLAN_ACTIONS.includes(action.action)) {
    throw new TypeError(`${path}.action is not supported.`);
  }
  if (!DEPLOYMENT_PLAN_REASONS.includes(action.reason)) {
    throw new TypeError(`${path}.reason is not supported.`);
  }
  const destructive = action.action === 'delete';
  if (action.destructive !== destructive) {
    throw new TypeError(
      `${path}.destructive must exactly describe the selected action.`,
    );
  }
  if (
    action.management === 'external' &&
    action.action !== 'verify' &&
    action.action !== 'noop'
  ) {
    throw new Error(`${path} cannot mutate an external resource.`);
  }
  /** @type {Record<string, Set<string>>} */
  const allowedByOperation = {
    apply: new Set(['verify', 'create', 'update', 'noop']),
    reconcile: new Set(['verify', 'create', 'update', 'noop']),
    destroy: new Set(['verify', 'delete', 'noop']),
  };
  if (!allowedByOperation[operation]?.has(action.action)) {
    throw new Error(
      `${path}.action '${action.action}' is not allowed during ${operation}.`,
    );
  }
  if (operation === 'destroy' && action.management === 'managed') {
    if (
      action.onDestroy === 'retain' &&
      (action.action !== 'noop' || action.reason !== 'retained-data')
    ) {
      throw new Error(
        `${path} managed retained resources require noop with reason 'retained-data' during destroy.`,
      );
    }
    if (
      action.onDestroy === 'purge' &&
      (action.action !== 'delete' || action.reason !== 'destroy-requested')
    ) {
      throw new Error(
        `${path} managed purge resources require delete with reason 'destroy-requested' during destroy.`,
      );
    }
  }
  const before = validateResourceState(action.before, `${path}.before`);
  const after = validateResourceState(action.after, `${path}.after`);
  if (
    (before !== null &&
      before.providerType !== resourceDefinition.providerType) ||
    (after !== null && after.providerType !== resourceDefinition.providerType)
  ) {
    throw new Error(
      `${path} provider type does not match resource graph role '${role.kind}'.`,
    );
  }
  if (action.action === 'create' && before !== null) {
    throw new Error(`${path}.before must be null for create.`);
  }
  if (action.action === 'delete' && after !== null) {
    throw new Error(`${path}.after must be null for delete.`);
  }
  if (
    action.action !== 'create' &&
    (before === null || before.providerResourceId === null)
  ) {
    throw new Error(
      `${path}.before must identify the exact existing provider resource.`,
    );
  }
  if (action.action !== 'delete' && after === null) {
    throw new Error(`${path}.after is required unless deleting.`);
  }
  if (action.action !== 'create' && action.action !== 'delete') {
    if (
      before === null ||
      after === null ||
      after.providerResourceId === null ||
      after.providerResourceId !== before.providerResourceId
    ) {
      throw new Error(
        `${path} must preserve the exact provider resource identity; replacement is not supported.`,
      );
    }
  }
  if (
    action.action === 'noop' &&
    (before === null || JSON.stringify(before) !== JSON.stringify(after))
  ) {
    throw new Error(`${path} noop requires identical before and after state.`);
  }
  return {
    resourceKey: action.resourceKey,
    capability,
    role,
    management: action.management,
    ownershipMode: action.ownershipMode,
    dependsOn,
    onDestroy: action.onDestroy,
    action: action.action,
    destructive,
    reason: action.reason,
    before,
    after,
  };
}

/** @param {Record<string, any>[]} actions @returns {Record<string, any>} */
function createSummary(actions) {
  const summary = {
    create: 0,
    update: 0,
    delete: 0,
    verify: 0,
    noop: 0,
    destructive: false,
  };
  for (const action of actions) {
    if (action.action === 'create') summary.create += 1;
    else if (action.action === 'update') summary.update += 1;
    else if (action.action === 'delete') summary.delete += 1;
    else if (action.action === 'verify') summary.verify += 1;
    else if (action.action === 'noop') summary.noop += 1;
    else
      throw new TypeError('Cannot summarize an unsupported deployment action.');
    summary.destructive ||= action.destructive;
  }
  return summary;
}

/**
 * Prove the complete plan is for the exact immutable profile and resolved
 * credential scope, and that every managed finite capability is represented.
 * @param {Readonly<Record<string, any>>} deploymentRevision - Exact desired tuple.
 * @param {Readonly<Record<string, any>>} providerScope - Resolved provider scope.
 * @param {Readonly<Record<string, any>>} providerSpec - Exact resolved provider choices.
 * @param {Readonly<Record<string, any>>} profile - Exact profile revision.
 * @param {Readonly<Record<string, any>>[]} actions - Canonical plan actions.
 * @param {string} path - Human-readable path.
 * @returns {void}
 */
function assertPlanContext(
  deploymentRevision,
  providerScope,
  providerSpec,
  profile,
  actions,
  path,
) {
  validateAwsSingleNodeProviderSpecContext(providerSpec, {
    profile,
    providerScope,
  });
  if (
    deploymentRevision.profileRevisionId !== profile.profileRevisionId ||
    deploymentRevision.appId !== profile.appId
  ) {
    throw new Error(
      `${path} profile does not match the exact deployment revision.`,
    );
  }
  if (
    profile.provider.kind !== providerScope.provider ||
    profile.provider.scope.region !== providerScope.region
  ) {
    throw new Error(
      `${path} provider scope does not match the exact profile provider and region.`,
    );
  }
  const capabilityEntries = Object.entries(DEPLOYMENT_CAPABILITY_IDS);
  const configurationKeyByCapability = new Map(
    capabilityEntries.map(([key, capability]) => [capability, key]),
  );
  const covered = new Set();
  for (const action of actions) {
    const configurationKey = configurationKeyByCapability.get(
      action.capability.kind,
    );
    const configuration =
      configurationKey === undefined
        ? undefined
        : profile.provider.configuration[configurationKey];
    if (!configuration || configuration.management === 'none') {
      throw new Error(
        `${path} action '${action.resourceKey}' is not authorized by the profile capability mapping.`,
      );
    }
    if (action.management !== configuration.management) {
      throw new Error(
        `${path} action '${action.resourceKey}' management does not match its profile capability.`,
      );
    }
    covered.add(action.capability.kind);
  }
  for (const [configurationKey, capability] of capabilityEntries) {
    const configuration = profile.provider.configuration[configurationKey];
    if (configuration.management !== 'none' && !covered.has(capability)) {
      throw new Error(
        `${path} does not cover required capability '${capability}'.`,
      );
    }
  }
}

/**
 * @param {Record<string, any>} input - Canonical plan fields.
 * @param {string} path - Human-readable value path.
 * @param {{profile?: unknown}} [context] - Optional exact profile context.
 * @returns {Record<string, any>} - Plan payload.
 */
function createPlanPayload(input, path, context = {}) {
  if (!DEPLOYMENT_PLAN_OPERATIONS.includes(input.operation)) {
    throw new TypeError(`${path}.operation is not supported.`);
  }
  const deploymentRevision = validateDeploymentRevision(
    input.deploymentRevision,
    `${path}.deploymentRevision`,
  );
  const providerScope = validateProviderScope(
    input.providerScope,
    `${path}.providerScope`,
  );
  const providerSpec = validateAwsSingleNodeProviderSpec(
    input.providerSpec,
    `${path}.providerSpec`,
  );
  if (providerSpec.providerScopeId !== providerScope.providerScopeId) {
    throw new Error(
      `${path}.providerSpec does not match the exact provider scope.`,
    );
  }
  if (providerSpec.profileRevisionId !== deploymentRevision.profileRevisionId) {
    throw new Error(
      `${path}.providerSpec does not match the exact deployment profile revision.`,
    );
  }
  assertDeploymentInstanceId(
    input.deploymentInstanceId,
    `${path}.deploymentInstanceId`,
  );
  const expectedInstanceId = getDeploymentInstanceId({
    deploymentRevision,
    providerScope,
  });
  if (input.deploymentInstanceId !== expectedInstanceId) {
    throw new Error(
      `${path}.deploymentInstanceId does not match the deployment and provider scope.`,
    );
  }
  assertDeploymentIncarnationId(input.incarnationId, `${path}.incarnationId`);
  const basis = validateBasis(input.basis, `${path}.basis`);
  if (
    !Array.isArray(input.actions) ||
    input.actions.length === 0 ||
    input.actions.length > MAX_PLAN_ACTIONS
  ) {
    throw new TypeError(
      `${path}.actions must contain between 1 and ${MAX_PLAN_ACTIONS} actions.`,
    );
  }
  const expectedResourceOrder =
    input.operation === 'destroy'
      ? getAwsSingleNodeResourceDestroyOrder()
      : getAwsSingleNodeResourceApplyOrder();
  if (input.actions.length !== expectedResourceOrder.length) {
    throw new Error(
      `${path}.actions must cover the complete AWS single-node resource graph.`,
    );
  }
  const seenResourceKeys = new Set();
  const actions = input.actions.map((candidate, index) => {
    const actionPath = `${path}.actions[${index}]`;
    const hasId =
      candidate &&
      typeof candidate === 'object' &&
      Object.prototype.hasOwnProperty.call(candidate, 'actionId');
    const candidateObject = cloneJsonObject(candidate, actionPath);
    if (hasId) {
      assertKeys(candidateObject, ACTION_DOCUMENT_KEYS, actionPath);
      delete candidateObject.actionId;
    }
    const action = validateActionInput(
      candidateObject,
      input.operation,
      actionPath,
    );
    if (seenResourceKeys.has(action.resourceKey)) {
      throw new Error(
        `${path}.actions must name each resourceKey at most once.`,
      );
    }
    if (action.resourceKey !== expectedResourceOrder[index]) {
      throw new Error(
        `${path}.actions must follow the exact ${input.operation === 'destroy' ? 'reverse destroy' : 'topological apply'} resource graph order.`,
      );
    }
    seenResourceKeys.add(action.resourceKey);
    const actionId = createCanonicalJsonSha256Id({
      domain: DEPLOYMENT_ACTION_ID_DOMAIN,
      prefix: DEPLOYMENT_ACTION_ID_PREFIX,
      value: {
        operation: input.operation,
        deploymentRevisionId: deploymentRevision.deploymentRevisionId,
        deploymentInstanceId: input.deploymentInstanceId,
        incarnationId: input.incarnationId,
        providerSpecId: providerSpec.providerSpecId,
        action,
      },
      valuePath: actionPath,
    });
    if (hasId && candidate.actionId !== actionId) {
      throw new Error(
        `${actionPath}.actionId does not match its exact action.`,
      );
    }
    return { ...action, actionId };
  });
  if (context.profile !== undefined) {
    const profile = validateDeploymentProfile(
      context.profile,
      `${path} context.profile`,
    );
    assertPlanContext(
      deploymentRevision,
      providerScope,
      providerSpec,
      profile,
      actions,
      path,
    );
  }
  const payload = {
    schemaVersion: DEPLOYMENT_PLAN_SCHEMA_VERSION,
    kind: DEPLOYMENT_PLAN_KIND,
    operation: input.operation,
    deploymentRevision,
    providerScope,
    providerSpec,
    deploymentInstanceId: input.deploymentInstanceId,
    incarnationId: input.incarnationId,
    basis,
    actions,
    summary: createSummary(actions),
  };
  assertManifestIsSecretFree(payload, path);
  return payload;
}

/**
 * Create a deterministic provider plan with no timestamps or credentials.
 * @param {unknown} value - Candidate plan fields without derived IDs/summary.
 * @param {{profile?: unknown}} [context] - Exact immutable profile context.
 * @returns {Readonly<Record<string, any>>} - Canonical plan.
 */
export function createDeploymentPlan(value, context = {}) {
  if (!Object.prototype.hasOwnProperty.call(context, 'profile')) {
    throw new TypeError(
      'deploymentPlan context.profile is required to bind capabilities and provider scope.',
    );
  }
  const input = cloneJsonObject(value, 'deploymentPlan');
  assertKeys(input, PLAN_INPUT_KEYS, 'deploymentPlan');
  const payload = deepFreeze(
    sortCanonicalJsonValue(createPlanPayload(input, 'deploymentPlan', context)),
  );
  const planId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_PLAN_ID_DOMAIN,
    prefix: DEPLOYMENT_PLAN_ID_PREFIX,
    value: payload,
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, planId }));
}

/**
 * Validate and recompute a serialized plan document. This proves structural
 * integrity only; mutation authority requires regeneration from a fresh
 * provider inspection and the exact durable head.
 * @param {unknown} value - Candidate plan.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Canonical plan.
 */
export function validateDeploymentPlan(value, valuePath = 'deploymentPlan') {
  const document = cloneJsonObject(value, valuePath);
  assertKeys(document, PLAN_DOCUMENT_KEYS, valuePath);
  if (document.schemaVersion !== DEPLOYMENT_PLAN_SCHEMA_VERSION) {
    throw new TypeError(`${valuePath}.schemaVersion must be the integer 3.`);
  }
  if (document.kind !== DEPLOYMENT_PLAN_KIND) {
    throw new TypeError(`${valuePath}.kind must be '${DEPLOYMENT_PLAN_KIND}'.`);
  }
  assertDomainSeparatedSha256Id(
    document.planId,
    DEPLOYMENT_PLAN_ID_PREFIX,
    `${valuePath}.planId`,
  );
  const payload = deepFreeze(
    sortCanonicalJsonValue(
      createPlanPayload(
        {
          operation: document.operation,
          deploymentRevision: document.deploymentRevision,
          providerScope: document.providerScope,
          providerSpec: document.providerSpec,
          deploymentInstanceId: document.deploymentInstanceId,
          incarnationId: document.incarnationId,
          basis: document.basis,
          actions: document.actions,
        },
        valuePath,
      ),
    ),
  );
  const expectedSummary = createSummary(payload.actions);
  const summary = cloneJsonObject(document.summary, `${valuePath}.summary`);
  assertKeys(summary, SUMMARY_KEYS, `${valuePath}.summary`);
  if (
    JSON.stringify(sortCanonicalJsonValue(summary)) !==
    JSON.stringify(sortCanonicalJsonValue(expectedSummary))
  ) {
    throw new Error(`${valuePath}.summary does not match its exact actions.`);
  }
  const expectedId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_PLAN_ID_DOMAIN,
    prefix: DEPLOYMENT_PLAN_ID_PREFIX,
    value: payload,
  });
  if (document.planId !== expectedId) {
    throw new Error(`${valuePath}.planId does not match its exact plan.`);
  }
  return deepFreeze(sortCanonicalJsonValue({ ...payload, planId: expectedId }));
}

/**
 * Re-resolve the full profile and prove a serialized plan covers only its
 * finite capabilities in the same AWS region. This remains a structural
 * context check, not mutation authority. The controller must regenerate the
 * plan from a fresh inspection and compare it with the submitted plan before
 * any effect. Destroy additionally requires exact durable ownership bindings.
 * @param {unknown} value - Candidate plan.
 * @param {{profile: unknown}} context - Exact immutable profile.
 * @returns {Readonly<Record<string, any>>} - Fully cross-checked plan.
 */
export function validateDeploymentPlanContext(value, context) {
  const plan = validateDeploymentPlan(value);
  const profile = validateDeploymentProfile(
    context?.profile,
    'deploymentPlan context.profile',
  );
  assertPlanContext(
    plan.deploymentRevision,
    plan.providerScope,
    plan.providerSpec,
    profile,
    plan.actions,
    'deploymentPlan',
  );
  return plan;
}

/** @param {unknown} value @param {string} [valuePath] @returns {asserts value is string} */
export function assertDeploymentPlanId(value, valuePath = 'planId') {
  assertDomainSeparatedSha256Id(value, DEPLOYMENT_PLAN_ID_PREFIX, valuePath);
}

export default {
  DEPLOYMENT_ACTION_ID_DOMAIN,
  DEPLOYMENT_INSPECTION_ID_PREFIX,
  DEPLOYMENT_PLAN_ACTIONS,
  DEPLOYMENT_PLAN_ID_DOMAIN,
  DEPLOYMENT_PLAN_ID_PREFIX,
  DEPLOYMENT_PLAN_KIND,
  DEPLOYMENT_PLAN_OPERATIONS,
  DEPLOYMENT_PLAN_REASONS,
  DEPLOYMENT_PLAN_SCHEMA_VERSION,
  assertDeploymentPlanId,
  createDeploymentPlan,
  validateDeploymentPlan,
  validateDeploymentPlanContext,
};
