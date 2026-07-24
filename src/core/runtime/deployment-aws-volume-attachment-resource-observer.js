/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable observer contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from './deployment-aws-desired-resource-targets.js';
import { createAwsSingleNodeDestroyedResourceLocator } from './deployment-aws-destroyed-resource-locator.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import { validateAwsSingleNodeResourceObservation } from './deployment-aws-resource-observation.js';
import {
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_MAX_ATTEMPTS,
  AwsSingleNodeVolumeAttachmentEvidenceConflictError,
  AwsSingleNodeVolumeAttachmentEvidenceTransientError,
  AwsSingleNodeVolumeAttachmentEvidenceUnknownError,
  decodeAwsSingleNodeVolumeAttachmentInstanceResponse,
  decodeAwsSingleNodeVolumeAttachmentVolumeResponse,
  getAwsSingleNodeVolumeAttachmentObservedStateDigest,
  getAwsSingleNodeVolumeAttachmentProviderResourceId,
  getAwsSingleNodeVolumeAttachmentStateDigest,
  getAwsSingleNodeVolumeAttachmentStrongestEvidenceError,
  reconcileAwsSingleNodeVolumeAttachmentViews,
  validateAwsSingleNodeVolumeAttachmentInstanceId,
  validateAwsSingleNodeVolumeAttachmentVolumeId,
} from './deployment-aws-volume-attachment-evidence.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import { getAwsSingleNodeResourceDefinition } from './deployment-resource-graph.js';

export {
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_MAX_ATTEMPTS,
};

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const CLIENT_KEYS = new Set(['describeInstances', 'describeVolumes']);
const AUTHORITY_REQUIRED_KEYS = new Set([
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
const AUTHORITY_KEYS = new Set([
  ...AUTHORITY_REQUIRED_KEYS,
  'destroyedResourceLocator',
]);
const PROVIDER_TYPE = 'ebs-volume-attachment';
const SUBSTRATE_RESOURCE_KEY = 'substrate';
/** @type {Readonly<Record<string, Readonly<{capabilityKind: string, resourceKey: string, volumeResourceKey: string}>>>} */
const RESOURCE_CONTRACTS = Object.freeze({
  'application-state-attachment': Object.freeze({
    capabilityKind: 'application-state',
    resourceKey: 'application-state-attachment',
    volumeResourceKey: 'application-state',
  }),
  'control-state-attachment': Object.freeze({
    capabilityKind: 'control-state',
    resourceKey: 'control-state-attachment',
    volumeResourceKey: 'control-state',
  }),
});
const AUTHORITY_ERROR =
  'AWS single-node volume attachment observation authority does not match the exact derived relationship.';

/** Exact durable authority cannot select this retained attachment read mode. */
export class AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError extends Error {
  constructor() {
    super(AUTHORITY_ERROR);
    this.name = 'AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError';
    this.code = 'AWS_SINGLE_NODE_VOLUME_ATTACHMENT_RESOURCE_OBSERVER_AUTHORITY';
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

/** @param {unknown} error @returns {boolean} */
function instanceNotFound(error) {
  return (
    errorNamed(error, 'InvalidInstanceID.NotFound') ||
    errorNamed(error, 'InvalidInstanceId.NotFound')
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
      'awsSingleNodeVolumeAttachmentResourceObserver context must be an object.',
    );
  }
  assertSupportedKeys(
    authority,
    AUTHORITY_KEYS,
    'awsSingleNodeVolumeAttachmentResourceObserver context',
  );
  assertRequiredKeys(
    authority,
    AUTHORITY_REQUIRED_KEYS,
    'awsSingleNodeVolumeAttachmentResourceObserver context',
  );
  let canonical;
  try {
    canonical = createAwsSingleNodeResourceObservationAuthority({
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
  } catch {
    throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
  }
  const expectedDestroyedResourceLocator =
    createAwsSingleNodeDestroyedResourceLocator(canonical);
  const destroyedResourceLocator = Object.hasOwn(
    authority,
    'destroyedResourceLocator',
  )
    ? authority.destroyedResourceLocator
    : null;
  if (
    !sameJson(authority.binding, canonical.binding) ||
    !sameJson(authority.currentAction, canonical.currentAction) ||
    !sameJson(destroyedResourceLocator, expectedDestroyedResourceLocator)
  ) {
    throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
  }
  return expectedDestroyedResourceLocator === null
    ? canonical
    : deepFreeze({
        ...canonical,
        destroyedResourceLocator: expectedDestroyedResourceLocator,
      });
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} definition @param {Map<string, Readonly<Record<string, any>>>} bindingByKey @returns {void} */
function assertBindingContract(binding, authority, definition, bindingByKey) {
  const expectedDependencies = definition.dependsOn
    .map((/** @type {string} */ resourceKey) => {
      const dependency = bindingByKey.get(resourceKey);
      if (dependency === undefined) {
        throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
      }
      return { resourceKey, bindingId: dependency.bindingId };
    })
    .sort(
      (
        /** @type {{resourceKey: string}} */ left,
        /** @type {{resourceKey: string}} */ right,
      ) =>
        left.resourceKey < right.resourceKey
          ? -1
          : left.resourceKey > right.resourceKey
            ? 1
            : 0,
    );
  if (
    binding.resourceKey !== definition.resourceKey ||
    !sameJson(binding.capability, definition.capability) ||
    !sameJson(binding.role, definition.role) ||
    binding.management !== 'managed' ||
    binding.ownershipMode !== definition.ownershipMode ||
    binding.onDestroy !== definition.onDestroy ||
    binding.providerType !== definition.providerType ||
    binding.providerScopeId !== authority.providerScope.providerScopeId ||
    binding.deploymentInstanceId !== authority.deploymentInstanceId ||
    binding.incarnationId !== authority.incarnationId ||
    !sameJson(binding.dependencyBindings, expectedDependencies)
  ) {
    throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
  }
}

/** @param {readonly string[]} rootKeys @returns {ReadonlyArray<Readonly<Record<string, any>>>} */
function dependencyClosureDefinitions(rootKeys) {
  const visited = new Set();
  /** @type {Readonly<Record<string, any>>[]} */
  const definitions = [];
  /** @param {string} resourceKey @returns {void} */
  function visit(resourceKey) {
    if (visited.has(resourceKey)) return;
    const definition = getAwsSingleNodeResourceDefinition(resourceKey);
    if (definition === null) {
      throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
    }
    for (const dependencyKey of definition.dependsOn) visit(dependencyKey);
    visited.add(resourceKey);
    definitions.push(definition);
  }
  for (const rootKey of rootKeys) visit(rootKey);
  return Object.freeze(definitions);
}

/** @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} operation @param {string} resourceKey @returns {Readonly<{action: Readonly<Record<string, any>>, actionIndex: number, intent: Readonly<Record<string, any>>}>} */
function planReceipt(plan, operation, resourceKey) {
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<Record<string, any>>} */ action) =>
      action.resourceKey === resourceKey,
  );
  const action = plan.actions[actionIndex];
  const intent = operation.intents[actionIndex];
  if (
    actionIndex < 0 ||
    action === undefined ||
    intent === undefined ||
    intent.actionId !== action.actionId
  ) {
    throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
  }
  return Object.freeze({ action, actionIndex, intent });
}

/** @param {Readonly<{action: Readonly<Record<string, any>>, actionIndex: number, intent: Readonly<Record<string, any>>}>} receipt @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} target @returns {void} */
function assertSettledPresentReceipt(receipt, binding, target) {
  const { action, intent } = receipt;
  const after = action.after;
  if (
    intent.status !== 'settled' ||
    action.resourceKey !== target.resourceKey ||
    !sameJson(action.capability, target.capability) ||
    !sameJson(action.role, target.role) ||
    action.management !== 'managed' ||
    action.management !== target.management ||
    action.ownershipMode !== target.ownershipMode ||
    !sameJson(action.dependsOn, target.dependsOn) ||
    action.onDestroy !== target.onDestroy ||
    action.action === 'delete' ||
    after === null ||
    after.providerType !== target.target.providerType ||
    (after.providerResourceId !== null &&
      after.providerResourceId !== binding.providerResourceId) ||
    !sameJson(after.stateDigest, target.target.stateDigest) ||
    intent.ownershipNonce !== binding.ownershipNonce ||
    (action.action === 'create' &&
      (action.before !== null || binding.createdByActionId !== action.actionId))
  ) {
    throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @param {Map<string, Readonly<Record<string, any>>>} bindingByKey @param {readonly string[]} rootKeys @returns {void} */
function assertDependencyPlanReceipts(authority, bindingByKey, rootKeys) {
  let targets;
  try {
    targets = createAwsSingleNodeDesiredResourceTargetCatalog({
      deploymentRevision: authority.deploymentRevision,
      profile: authority.profile,
      providerScope: authority.providerScope,
      providerSpec: authority.providerSpec,
      deploymentInstanceId: authority.deploymentInstanceId,
      incarnationId: authority.incarnationId,
      head: authority.head,
    });
  } catch {
    throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
  }
  const targetByKey = new Map(
    targets.map((/** @type {Readonly<Record<string, any>>} */ target) => [
      target.resourceKey,
      target,
    ]),
  );
  const definitions = dependencyClosureDefinitions(rootKeys);
  for (const definition of definitions) {
    const binding = bindingByKey.get(definition.resourceKey);
    const target = targetByKey.get(definition.resourceKey);
    if (binding === undefined || target === undefined) {
      throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
    }

    let activeReceipt = null;
    if (authority.plan !== null && authority.head.activeOperation !== null) {
      activeReceipt = planReceipt(
        authority.plan,
        authority.head.activeOperation,
        definition.resourceKey,
      );
      if (activeReceipt.intent.status === 'settled') {
        assertSettledPresentReceipt(activeReceipt, binding, target);
        continue;
      }
    }
    if (
      authority.settledPlan === null ||
      authority.head.lastOperation === null
    ) {
      throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
    }
    const settledReceipt = planReceipt(
      authority.settledPlan,
      authority.head.lastOperation,
      definition.resourceKey,
    );
    assertSettledPresentReceipt(settledReceipt, binding, target);
  }

  if (
    authority.currentAction === null ||
    authority.plan === null ||
    authority.head.activeOperation === null
  ) {
    return;
  }
  const currentAction = authority.currentAction.action;
  const currentIndex = authority.currentAction.actionIndex;
  for (const definition of definitions) {
    const receipt = planReceipt(
      authority.plan,
      authority.head.activeOperation,
      definition.resourceKey,
    );
    const valid =
      currentAction.action === 'delete'
        ? receipt.actionIndex > currentIndex &&
          receipt.intent.status === 'pending'
        : receipt.actionIndex < currentIndex &&
          receipt.intent.status === 'settled';
    if (!valid) {
      throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
    }
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>|null} */
function assertRelationshipAuthority(authority) {
  const contract = RESOURCE_CONTRACTS[authority.target.resourceKey];
  if (contract === undefined) {
    throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
  }
  const target = authority.target;
  const expectedDigest = getAwsSingleNodeVolumeAttachmentStateDigest(
    authority.providerSpec,
    contract.capabilityKind,
  );
  if (
    target.resourceKey !== contract.resourceKey ||
    target.capability.kind !== contract.capabilityKind ||
    target.capability.version !== 1 ||
    target.role.kind !== 'attachment' ||
    target.role.version !== 1 ||
    target.management !== 'managed' ||
    target.ownershipMode !== 'derived' ||
    target.onDestroy !== 'purge' ||
    !sameJson(target.dependsOn, [
      contract.volumeResourceKey,
      SUBSTRATE_RESOURCE_KEY,
    ]) ||
    target.target.providerType !== PROVIDER_TYPE ||
    !sameJson(target.target.stateDigest, expectedDigest)
  ) {
    throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
  }

  const bindingByKey = new Map(
    authority.head.resourceBindings.map(
      (/** @type {Readonly<Record<string, any>>} */ binding) => [
        binding.resourceKey,
        binding,
      ],
    ),
  );
  const volumeBinding = bindingByKey.get(contract.volumeResourceKey) ?? null;
  const instanceBinding = bindingByKey.get(SUBSTRATE_RESOURCE_KEY) ?? null;
  const configuration =
    contract.capabilityKind === 'application-state'
      ? authority.providerSpec.capabilities.applicationState
      : authority.providerSpec.capabilities.controlState;
  if (volumeBinding === null || instanceBinding === null) {
    if (authority.binding !== null || authority.currentAction !== null) {
      throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
    }
    const destroyedResourceLocator = authority.destroyedResourceLocator;
    if (
      destroyedResourceLocator === undefined ||
      destroyedResourceLocator.resourceKey !== contract.resourceKey ||
      destroyedResourceLocator.providerState?.providerType !== PROVIDER_TYPE
    ) {
      return null;
    }
    const dependencyByKey = new Map(
      destroyedResourceLocator.dependencies.map(
        (/** @type {Readonly<Record<string, any>>} */ dependency) => [
          dependency.resourceKey,
          dependency.providerIdentity,
        ],
      ),
    );
    const volumeIdentity = dependencyByKey.get(contract.volumeResourceKey);
    const instanceIdentity = dependencyByKey.get(SUBSTRATE_RESOURCE_KEY);
    let volumeId;
    let instanceId;
    try {
      if (
        dependencyByKey.size !== 2 ||
        volumeIdentity?.providerType !== 'ebs-volume' ||
        instanceIdentity?.providerType !== 'ec2-instance'
      ) {
        throw new Error();
      }
      volumeId = validateAwsSingleNodeVolumeAttachmentVolumeId(
        volumeIdentity.providerResourceId,
      );
      instanceId = validateAwsSingleNodeVolumeAttachmentInstanceId(
        instanceIdentity.providerResourceId,
      );
    } catch {
      throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
    }
    const providerResourceId =
      getAwsSingleNodeVolumeAttachmentProviderResourceId(
        authority.providerSpec,
        contract.capabilityKind,
        instanceId,
        volumeId,
      );
    if (
      destroyedResourceLocator.providerState.providerResourceId !==
        providerResourceId ||
      (volumeBinding !== null &&
        volumeBinding.providerResourceId !== volumeId) ||
      (instanceBinding !== null &&
        instanceBinding.providerResourceId !== instanceId)
    ) {
      throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
    }
    return deepFreeze({
      availabilityZoneId: authority.providerSpec.placement.availabilityZoneId,
      capabilityKind: contract.capabilityKind,
      configuration,
      destroyed: true,
      expectedDigest,
      instanceId,
      providerResourceId,
      resourceKey: contract.resourceKey,
      volumeId,
    });
  }
  const volumeDefinition = getAwsSingleNodeResourceDefinition(
    contract.volumeResourceKey,
  );
  const instanceDefinition = getAwsSingleNodeResourceDefinition(
    SUBSTRATE_RESOURCE_KEY,
  );
  const attachmentDefinition = getAwsSingleNodeResourceDefinition(
    contract.resourceKey,
  );
  if (
    volumeDefinition === null ||
    instanceDefinition === null ||
    attachmentDefinition === null
  ) {
    throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
  }
  assertBindingContract(
    volumeBinding,
    authority,
    volumeDefinition,
    bindingByKey,
  );
  assertBindingContract(
    instanceBinding,
    authority,
    instanceDefinition,
    bindingByKey,
  );
  assertDependencyPlanReceipts(authority, bindingByKey, [
    contract.volumeResourceKey,
    SUBSTRATE_RESOURCE_KEY,
  ]);
  let instanceId;
  let volumeId;
  try {
    instanceId = validateAwsSingleNodeVolumeAttachmentInstanceId(
      instanceBinding.providerResourceId,
    );
    volumeId = validateAwsSingleNodeVolumeAttachmentVolumeId(
      volumeBinding.providerResourceId,
    );
  } catch {
    throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
  }
  const providerResourceId = getAwsSingleNodeVolumeAttachmentProviderResourceId(
    authority.providerSpec,
    contract.capabilityKind,
    instanceId,
    volumeId,
  );
  if (authority.binding !== null) {
    assertBindingContract(
      authority.binding,
      authority,
      attachmentDefinition,
      bindingByKey,
    );
    if (authority.binding.providerResourceId !== providerResourceId) {
      throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
    }
  }
  const currentAction = authority.currentAction?.action ?? null;
  if (
    (authority.binding !== null && currentAction?.action === 'create') ||
    (authority.binding === null &&
      currentAction !== null &&
      currentAction.action !== 'create') ||
    target.target.providerResourceId !==
      (authority.binding?.providerResourceId ?? null)
  ) {
    throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
  }
  return deepFreeze({
    availabilityZoneId: authority.providerSpec.placement.availabilityZoneId,
    capabilityKind: contract.capabilityKind,
    configuration,
    destroyed: false,
    expectedDigest,
    instanceId,
    providerResourceId,
    resourceKey: contract.resourceKey,
    volumeId,
  });
}

/** @param {string} resourceKey @returns {Readonly<Record<string, any>>} */
function absentObservation(resourceKey) {
  return validateAwsSingleNodeResourceObservation({
    resourceKey,
    presence: 'absent',
    ownership: 'missing',
    providerIdentity: null,
    observedDigest: null,
    health: 'absent',
    execution: 'none',
  });
}

/** @param {string} resourceKey @returns {Readonly<Record<string, any>>} */
function unknownObservation(resourceKey) {
  return validateAwsSingleNodeResourceObservation({
    resourceKey,
    presence: 'unknown',
    ownership: 'unknown',
    providerIdentity: null,
    observedDigest: null,
    health: 'unknown',
    execution: 'none',
  });
}

/** @param {string} resourceKey @param {string} providerResourceId @param {Readonly<Record<string, any>>} observedDigest @returns {Readonly<Record<string, any>>} */
function verifiedObservation(resourceKey, providerResourceId, observedDigest) {
  return validateAwsSingleNodeResourceObservation({
    resourceKey,
    presence: 'present',
    ownership: 'verified',
    providerIdentity: { providerType: PROVIDER_TYPE, providerResourceId },
    observedDigest,
    health: 'not-applicable',
    execution: 'none',
  });
}

/** @param {string} resourceKey @param {string} providerResourceId @returns {Readonly<Record<string, any>>} */
function conflictObservation(resourceKey, providerResourceId) {
  return validateAwsSingleNodeResourceObservation({
    resourceKey,
    presence: 'present',
    ownership: 'conflict',
    providerIdentity: { providerType: PROVIDER_TYPE, providerResourceId },
    observedDigest: null,
    health: 'not-applicable',
    execution: 'none',
  });
}

/**
 * Bind a strict read-only observer for both dependency-derived retained EBS
 * relationships. The caller owns the exact DescribeInstances and
 * DescribeVolumes ports; this observer has no attach, retention, or detach
 * authority.
 * @param {unknown} options - Exact read dependencies, scope, and retry policy.
 * @returns {Readonly<{observe: (context: unknown) => Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsSingleNodeVolumeAttachmentResourceObserver(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeVolumeAttachmentResourceObserver options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeVolumeAttachmentResourceObserver options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeVolumeAttachmentResourceObserver options',
  );
  if (!isPlainObject(options.client)) {
    throw new TypeError(
      'awsSingleNodeVolumeAttachmentResourceObserver client must be an object.',
    );
  }
  assertExactKeys(
    options.client,
    CLIENT_KEYS,
    'awsSingleNodeVolumeAttachmentResourceObserver client',
  );
  for (const method of CLIENT_KEYS) {
    if (typeof options.client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeVolumeAttachmentResourceObserver client.${method} must be a function.`,
      );
    }
  }
  const client = Object.freeze({
    describeInstances: options.client.describeInstances,
    describeVolumes: options.client.describeVolumes,
  });
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeVolumeAttachmentResourceObserver providerScope',
  );
  const maxAttempts = Object.hasOwn(options, 'maxAttempts')
    ? options.maxAttempts
    : AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 2 ||
    maxAttempts > AWS_SINGLE_NODE_VOLUME_ATTACHMENT_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeVolumeAttachmentResourceObserver maxAttempts must be an integer from 2 through ${AWS_SINGLE_NODE_VOLUME_ATTACHMENT_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = Object.hasOwn(options, 'waitForRetry')
    ? options.waitForRetry
    : defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeVolumeAttachmentResourceObserver waitForRetry must be a function.',
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

  /** @param {Readonly<Record<string, any>>} relationship @returns {Readonly<Record<string, any>>} */
  function evidenceOptions(relationship) {
    return deepFreeze({
      providerScope,
      availabilityZoneId: relationship.availabilityZoneId,
      instanceId: relationship.instanceId,
      volumeId: relationship.volumeId,
      deviceName: relationship.configuration.deviceName,
    });
  }

  /** @param {Readonly<Record<string, any>>} relationship @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function describeInstanceOnce(relationship) {
    let response;
    try {
      response = await client.describeInstances(
        deepFreeze({ InstanceIds: [relationship.instanceId] }),
      );
    } catch (error) {
      if (instanceNotFound(error)) return null;
      throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
    }
    return decodeAwsSingleNodeVolumeAttachmentInstanceResponse(
      response,
      evidenceOptions(relationship),
    );
  }

  /** @param {Readonly<Record<string, any>>} relationship @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function describeVolumeOnce(relationship) {
    let response;
    try {
      response = await client.describeVolumes(
        deepFreeze({ VolumeIds: [relationship.volumeId] }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidVolume.NotFound')) return null;
      throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
    }
    return decodeAwsSingleNodeVolumeAttachmentVolumeResponse(
      response,
      evidenceOptions(relationship),
    );
  }

  /** @param {Readonly<Record<string, any>>} relationship @param {boolean} currentDelete @returns {Promise<Readonly<Record<string, any>>>} */
  async function readLogicalState(relationship, currentDelete) {
    const [instanceResult, volumeResult] = await Promise.allSettled([
      describeInstanceOnce(relationship),
      describeVolumeOnce(relationship),
    ]);
    const errors = [];
    if (instanceResult.status === 'rejected') {
      errors.push(instanceResult.reason);
    }
    if (volumeResult.status === 'rejected') {
      errors.push(volumeResult.reason);
    }
    const strongest =
      getAwsSingleNodeVolumeAttachmentStrongestEvidenceError(errors);
    if (strongest !== null) throw strongest;
    if (
      instanceResult.status !== 'fulfilled' ||
      volumeResult.status !== 'fulfilled'
    ) {
      throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
    }
    if (
      !currentDelete &&
      (instanceResult.value === null || volumeResult.value === null)
    ) {
      throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
    }
    return reconcileAwsSingleNodeVolumeAttachmentViews({
      action: currentDelete ? 'delete' : 'create',
      instanceView: instanceResult.value,
      volumeView: volumeResult.value,
    });
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function observe(value) {
    const authority = revalidateAuthority(value);
    if (!sameJson(authority.providerScope, providerScope)) {
      throw new AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError();
    }
    const relationship = assertRelationshipAuthority(authority);
    const resourceKey = authority.target.resourceKey;
    if (relationship === null) return unknownObservation(resourceKey);
    const isCurrentCreate =
      authority.binding === null &&
      authority.currentAction?.action.action === 'create';
    const isCurrentDelete =
      authority.binding !== null &&
      authority.currentAction?.action.action === 'delete';
    const isCompletedDestroy = relationship?.destroyed === true;
    let allAttemptsCleanAbsent = true;
    let endpointAbsenceSignature = null;
    let endpointAbsenceObservations = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const logical = await readLogicalState(
          relationship,
          isCurrentDelete || isCompletedDestroy,
        );
        if (logical.state === 'endpoint-absent') {
          allAttemptsCleanAbsent = false;
          if (logical.signature === endpointAbsenceSignature) {
            endpointAbsenceObservations += 1;
          } else {
            endpointAbsenceSignature = logical.signature;
            endpointAbsenceObservations = 1;
          }
          if (endpointAbsenceObservations === maxAttempts) {
            return absentObservation(resourceKey);
          }
        } else {
          endpointAbsenceSignature = null;
          endpointAbsenceObservations = 0;
          if (logical.state === 'absent') {
            if (isCurrentDelete) return absentObservation(resourceKey);
            if (
              !isCurrentCreate &&
              attempt === maxAttempts &&
              allAttemptsCleanAbsent
            ) {
              return absentObservation(resourceKey);
            }
          } else {
            allAttemptsCleanAbsent = false;
            if (
              logical.state !== 'attached' &&
              logical.state !== 'needs-retention'
            ) {
              throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
            }
            if (authority.binding === null && !isCurrentCreate) {
              return conflictObservation(
                resourceKey,
                relationship.providerResourceId,
              );
            }
            const observedDigest =
              getAwsSingleNodeVolumeAttachmentObservedStateDigest(
                authority.providerSpec,
                relationship.capabilityKind,
                logical,
              );
            return verifiedObservation(
              resourceKey,
              relationship.providerResourceId,
              observedDigest,
            );
          }
        }
      } catch (error) {
        allAttemptsCleanAbsent = false;
        endpointAbsenceSignature = null;
        endpointAbsenceObservations = 0;
        if (
          error instanceof AwsSingleNodeVolumeAttachmentEvidenceConflictError
        ) {
          return conflictObservation(
            resourceKey,
            relationship.providerResourceId,
          );
        }
        if (
          !(
            error instanceof AwsSingleNodeVolumeAttachmentEvidenceUnknownError
          ) &&
          !(
            error instanceof AwsSingleNodeVolumeAttachmentEvidenceTransientError
          )
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          return unknownObservation(resourceKey);
        }
      }
      if (attempt < maxAttempts && !(await wait(attempt))) {
        return unknownObservation(resourceKey);
      }
    }
    return unknownObservation(resourceKey);
  }

  return Object.freeze({ observe });
}

export default {
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_MAX_ATTEMPTS,
  AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError,
  createAwsSingleNodeVolumeAttachmentResourceObserver,
};
