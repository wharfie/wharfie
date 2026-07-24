/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable authority contracts are clearer than repeated parser-specific expansions. */

import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from './deployment-aws-desired-resource-targets.js';
import {
  validateAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
import { validateDeploymentHead } from './deployment-head.js';
import {
  validateDeploymentPlan,
  validateDeploymentPlanContext,
} from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import {
  assertDeploymentInstanceId,
  getDeploymentInstanceId,
  validateProviderScope,
} from './deployment-provider-scope.js';
import {
  assertDeploymentIncarnationId,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';
import { validateDeploymentRevision } from './deployment-revision.js';
import { cloneJsonObject } from './json-value.js';

const INPUT_KEYS = new Set([
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
]);
const OPERATIONS = new Set(['apply', 'reconcile', 'destroy']);
const AUTHORITY_CONTEXT_ERROR =
  'AWS single-node resource observation authority does not match its exact deployment context.';
const AUTHORITY_PLAN_ERROR =
  'AWS single-node resource observation authority plan does not match the exact active operation.';
const AUTHORITY_TARGET_ERROR =
  'AWS single-node resource observation authority target does not match exactly one desired resource target.';
const AUTHORITY_FRONTIER_ERROR =
  'AWS single-node resource observation authority has an invalid action frontier.';

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

/** @returns {never} */
function contextConflict() {
  throw new Error(AUTHORITY_CONTEXT_ERROR);
}

/** @returns {never} */
function planConflict() {
  throw new Error(AUTHORITY_PLAN_ERROR);
}

/** @param {Readonly<Record<string, any>>} plan @returns {'create'|'update'|'reconcile'|'destroy'} */
function getSettledOperationKind(plan) {
  if (plan.operation === 'destroy') return 'destroy';
  if (plan.basis.settledDeploymentRevisionId === null) return 'create';
  return plan.basis.settledDeploymentRevisionId ===
    plan.deploymentRevision.deploymentRevisionId
    ? 'reconcile'
    : 'update';
}

/** @param {Readonly<Record<string, any>>} plan @param {string} operationKind @returns {boolean} */
function settledOperationMatchesBasis(plan, operationKind) {
  return plan.operation === 'destroy'
    ? operationKind === 'destroy'
    : plan.operation === 'reconcile'
      ? operationKind === 'reconcile'
      : operationKind !== 'destroy';
}

/** @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} head @param {Readonly<Record<string, any>>} providerSpec @returns {void} */
function assertSettledPlanAuthority(plan, head, providerSpec) {
  const lastOperation = head.lastOperation;
  const operationKind = getSettledOperationKind(plan);
  const isCompletedDestroy = head.phase === 'DESTROYED';
  const revisionMatches = isCompletedDestroy
    ? plan.operation === 'destroy' &&
      plan.basis.settledDeploymentRevisionId ===
        plan.deploymentRevision.deploymentRevisionId
    : plan.deploymentRevision.deploymentRevisionId ===
      head.settledDeploymentRevisionId;
  if (
    lastOperation === null ||
    !sameJson(plan.providerSpec, providerSpec) ||
    plan.planId !== lastOperation.planId ||
    !settledOperationMatchesBasis(plan, operationKind) ||
    lastOperation.kind !== operationKind ||
    (isCompletedDestroy && operationKind !== 'destroy') ||
    plan.deploymentInstanceId !== head.deploymentInstanceId ||
    plan.incarnationId !== head.incarnationId ||
    !revisionMatches ||
    !sameJson(plan.providerScope, head.providerScope) ||
    plan.basis.headGeneration >= head.generation ||
    lastOperation.intents.length !== plan.actions.length ||
    lastOperation.intents.some(
      (
        /** @type {Readonly<Record<string, any>>} */ intent,
        /** @type {number} */ index,
      ) => intent.actionId !== plan.actions[index].actionId,
    )
  ) {
    planConflict();
  }
}

/** @param {Readonly<Record<string, any>>} action @param {Map<string, Readonly<Record<string, any>>>} bindingByKey @returns {ReadonlyArray<Readonly<{bindingId: string, resourceKey: string}>>} */
function expectedDependencyBindings(action, bindingByKey) {
  return action.dependsOn
    .map((/** @type {string} */ resourceKey) => {
      const dependency = bindingByKey.get(resourceKey);
      if (dependency === undefined) planConflict();
      return {
        bindingId: dependency.bindingId,
        resourceKey,
      };
    })
    .sort(
      (
        /** @type {{resourceKey: string}} */ left,
        /** @type {{resourceKey: string}} */ right,
      ) => compareCanonicalStrings(left.resourceKey, right.resourceKey),
    );
}

/** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} target @returns {void} */
function assertActionTargetMetadata(action, target) {
  if (
    action.resourceKey !== target.resourceKey ||
    !sameJson(action.capability, target.capability) ||
    !sameJson(action.role, target.role) ||
    action.management !== target.management ||
    action.ownershipMode !== target.ownershipMode ||
    !sameJson(action.dependsOn, target.dependsOn) ||
    action.onDestroy !== target.onDestroy
  ) {
    planConflict();
  }
}

/** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} target @returns {void} */
function assertActionTarget(action, target) {
  assertActionTargetMetadata(action, target);
  if (
    action.action === 'delete'
      ? action.after !== null
      : !sameJson(action.after, target.target)
  ) {
    planConflict();
  }
}

/** @param {Readonly<Record<string, any>>} action @param {number} actionIndex @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} head @param {Map<string, Readonly<Record<string, any>>>} targetByKey @param {Map<string, Readonly<Record<string, any>>>} bindingByKey @returns {void} */
function assertCreateDependencyReceipts(
  action,
  actionIndex,
  plan,
  head,
  targetByKey,
  bindingByKey,
) {
  const activeOperation = head.activeOperation;
  if (activeOperation === null) planConflict();
  const expectedDependencies = expectedDependencyBindings(action, bindingByKey);
  for (const expectedDependency of expectedDependencies) {
    const dependencyActionIndex = plan.actions.findIndex(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.resourceKey === expectedDependency.resourceKey,
    );
    const dependencyAction = plan.actions[dependencyActionIndex];
    const dependencyIntent = activeOperation.intents[dependencyActionIndex];
    const dependencyTarget = targetByKey.get(expectedDependency.resourceKey);
    const binding = bindingByKey.get(expectedDependency.resourceKey);
    if (
      dependencyActionIndex < 0 ||
      dependencyActionIndex >= actionIndex ||
      dependencyAction === undefined ||
      dependencyAction.after === null ||
      dependencyIntent === undefined ||
      dependencyIntent.actionId !== dependencyAction.actionId ||
      dependencyIntent.status !== 'settled' ||
      dependencyTarget === undefined ||
      binding === undefined ||
      binding.bindingId !== expectedDependency.bindingId
    ) {
      planConflict();
    }
    assertActionTargetMetadata(dependencyAction, dependencyTarget);
    if (
      dependencyAction.after.providerType !==
        dependencyTarget.target.providerType ||
      !sameJson(
        dependencyAction.after.stateDigest,
        dependencyTarget.target.stateDigest,
      ) ||
      binding.resourceKey !== dependencyTarget.resourceKey ||
      !sameJson(binding.capability, dependencyTarget.capability) ||
      !sameJson(binding.role, dependencyTarget.role) ||
      binding.management !== dependencyAction.management ||
      binding.providerType !== dependencyTarget.target.providerType ||
      binding.ownershipMode !==
        (dependencyAction.management === 'external'
          ? 'external'
          : dependencyTarget.ownershipMode) ||
      binding.onDestroy !== dependencyTarget.onDestroy ||
      !sameJson(
        binding.dependencyBindings,
        expectedDependencyBindings(dependencyAction, bindingByKey),
      ) ||
      dependencyIntent.ownershipNonce !==
        (binding.management === 'managed' ? binding.ownershipNonce : null) ||
      (dependencyAction.action === 'create' &&
        (binding.management !== 'managed' ||
          binding.createdByActionId !== dependencyAction.actionId)) ||
      (dependencyAction.after.providerResourceId !== null &&
        binding.providerResourceId !==
          dependencyAction.after.providerResourceId)
    ) {
      planConflict();
    }
  }
}

/** @param {number} actionIndex @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} head @param {Map<string, Readonly<Record<string, any>>>} bindingByKey @returns {void} */
function assertDestroyPriorPurgeReceipts(
  actionIndex,
  plan,
  head,
  bindingByKey,
) {
  const activeOperation = head.activeOperation;
  if (activeOperation === null) planConflict();
  for (let index = 0; index < actionIndex; index += 1) {
    const priorAction = plan.actions[index];
    if (priorAction.after !== null) continue;
    const priorIntent = activeOperation.intents[index];
    if (
      priorIntent === undefined ||
      priorIntent.actionId !== priorAction.actionId ||
      priorIntent.status !== 'settled' ||
      bindingByKey.has(priorAction.resourceKey)
    ) {
      planConflict();
    }
  }
}

/** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>|undefined} binding @param {ReadonlyArray<Readonly<{bindingId: string, resourceKey: string}>>} dependencyBindings @returns {void} */
function assertBindingMatchesAction(action, binding, dependencyBindings) {
  const state = action.before;
  if (
    binding === undefined ||
    binding.resourceKey !== action.resourceKey ||
    !sameJson(binding.capability, action.capability) ||
    !sameJson(binding.role, action.role) ||
    binding.management !== action.management ||
    binding.ownershipMode !==
      (action.management === 'external' ? 'external' : action.ownershipMode) ||
    binding.onDestroy !== action.onDestroy ||
    !sameJson(binding.dependencyBindings, dependencyBindings) ||
    state === null ||
    binding.providerType !== state.providerType ||
    binding.providerResourceId !== state.providerResourceId
  ) {
    planConflict();
  }
}

/** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} intent @param {Readonly<Record<string, any>>|undefined} binding @param {ReadonlyArray<Readonly<{bindingId: string, resourceKey: string}>>} dependencyBindings @returns {void} */
function assertSettledCreateBinding(
  action,
  intent,
  binding,
  dependencyBindings,
) {
  const state = action.after;
  if (
    action.before !== null ||
    state === null ||
    binding === undefined ||
    binding.resourceKey !== action.resourceKey ||
    !sameJson(binding.capability, action.capability) ||
    !sameJson(binding.role, action.role) ||
    binding.management !== action.management ||
    binding.ownershipMode !==
      (action.management === 'external' ? 'external' : action.ownershipMode) ||
    binding.onDestroy !== action.onDestroy ||
    !sameJson(binding.dependencyBindings, dependencyBindings) ||
    binding.providerType !== state.providerType ||
    (state.providerResourceId !== null &&
      binding.providerResourceId !== state.providerResourceId)
  ) {
    planConflict();
  }
  if (action.management === 'managed') {
    if (
      binding.createdByActionId !== action.actionId ||
      intent.ownershipNonce !== binding.ownershipNonce
    ) {
      planConflict();
    }
  } else if (intent.ownershipNonce !== null) {
    planConflict();
  }
}

/** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} target @param {Readonly<Record<string, any>>|undefined} binding @returns {void} */
function assertSettledCreateTarget(action, target, binding) {
  assertActionTargetMetadata(action, target);
  const state = action.after;
  if (
    state === null ||
    action.before !== null ||
    binding === undefined ||
    state.providerType !== target.target.providerType ||
    !sameJson(state.stateDigest, target.target.stateDigest) ||
    binding.providerResourceId !== target.target.providerResourceId ||
    (state.providerResourceId !== null &&
      state.providerResourceId !== target.target.providerResourceId)
  ) {
    planConflict();
  }
}

/** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} intent @returns {void} */
function assertCreateIntentOwnership(action, intent) {
  if (action.management === 'managed') {
    if (intent.ownershipNonce === null) planConflict();
    validateOwnershipNonce(
      intent.ownershipNonce,
      'awsSingleNodeResourceObservationAuthority create ownershipNonce',
    );
  } else if (intent.ownershipNonce !== null) {
    planConflict();
  }
}

/** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} intent @param {Readonly<Record<string, any>>|undefined} binding @returns {void} */
function assertNoncreateIntentOwnership(action, intent, binding) {
  if (action.management === 'managed') {
    if (
      binding === undefined ||
      intent.ownershipNonce !== binding.ownershipNonce
    ) {
      planConflict();
    }
  } else if (intent.ownershipNonce !== null) {
    planConflict();
  }
}

/** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>|undefined} binding @returns {boolean} */
function isUnboundExternalVerify(action, binding) {
  return (
    binding === undefined &&
    action.management === 'external' &&
    action.action === 'verify'
  );
}

/** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} intent @param {Readonly<Record<string, any>>|undefined} binding @param {ReadonlyArray<Readonly<{bindingId: string, resourceKey: string}>>} dependencyBindings @returns {void} */
function assertSettledNoncreateBinding(
  action,
  intent,
  binding,
  dependencyBindings,
) {
  assertBindingMatchesAction(action, binding, dependencyBindings);
  const state = action.after;
  if (
    state === null ||
    binding === undefined ||
    binding.providerType !== state.providerType ||
    (state.providerResourceId !== null &&
      binding.providerResourceId !== state.providerResourceId)
  ) {
    planConflict();
  }
  assertNoncreateIntentOwnership(action, intent, binding);
}

/** @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} operation @param {string} resourceKey @returns {{actionIndex: number, action: Readonly<Record<string, any>>, intent: Readonly<Record<string, any>>}} */
function targetReceipt(plan, operation, resourceKey) {
  const matchingIndexes = plan.actions
    .map(
      (
        /** @type {Readonly<Record<string, any>>} */ action,
        /** @type {number} */ index,
      ) => (action.resourceKey === resourceKey ? index : -1),
    )
    .filter((/** @type {number} */ index) => index >= 0);
  if (matchingIndexes.length !== 1) planConflict();
  const actionIndex = matchingIndexes[0];
  const action = plan.actions[actionIndex];
  const intent = operation.intents[actionIndex];
  if (
    intent === undefined ||
    intent.actionId !== action.actionId ||
    (intent.status !== 'pending' &&
      intent.status !== 'intended' &&
      intent.status !== 'settled')
  ) {
    planConflict();
  }
  return { actionIndex, action, intent };
}

/** @param {Readonly<Record<string, any>>} target @param {Readonly<Record<string, any>>|undefined} binding @param {Map<string, Readonly<Record<string, any>>>} targetByKey @param {Map<string, Readonly<Record<string, any>>>} bindingByKey @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} operation @param {Readonly<Record<string, any>>} head @param {boolean} active @returns {{actionIndex: number, action: Readonly<Record<string, any>>, intent: Readonly<Record<string, any>>}} */
function assertTargetDurableReceipt(
  target,
  binding,
  targetByKey,
  bindingByKey,
  plan,
  operation,
  head,
  active,
) {
  const receipt = targetReceipt(plan, operation, target.resourceKey);
  const { actionIndex, action, intent } = receipt;
  if (active && action.action === 'create' && intent.status === 'settled') {
    assertSettledCreateTarget(action, target, binding);
  } else if (active) {
    assertActionTarget(action, target);
  } else {
    assertActionTargetMetadata(action, target);
  }
  if (intent.status === 'intended') return receipt;

  if (intent.status === 'pending') {
    const unboundExternalVerify = isUnboundExternalVerify(action, binding);
    if (action.action === 'create' || unboundExternalVerify) {
      if (
        binding !== undefined ||
        (action.action === 'create' && action.before !== null) ||
        (unboundExternalVerify &&
          (action.before === null || action.after === null))
      ) {
        planConflict();
      }
      assertCreateIntentOwnership(action, intent);
      if (active && actionIndex === operation.nextActionIndex) {
        assertCreateDependencyReceipts(
          action,
          actionIndex,
          plan,
          head,
          targetByKey,
          bindingByKey,
        );
      }
      return receipt;
    }
    const dependencyBindings = expectedDependencyBindings(action, bindingByKey);
    assertBindingMatchesAction(action, binding, dependencyBindings);
    assertNoncreateIntentOwnership(action, intent, binding);
    return receipt;
  }

  if (action.after === null) {
    if (
      binding !== undefined ||
      action.before === null ||
      action.before.providerResourceId === null
    ) {
      planConflict();
    }
    if (action.management === 'managed') {
      if (intent.ownershipNonce === null) planConflict();
      validateOwnershipNonce(
        intent.ownershipNonce,
        'awsSingleNodeResourceObservationAuthority delete ownershipNonce',
      );
    } else if (intent.ownershipNonce !== null) {
      planConflict();
    }
    return receipt;
  }
  const dependencyBindings = expectedDependencyBindings(action, bindingByKey);
  if (action.action === 'create') {
    assertSettledCreateBinding(action, intent, binding, dependencyBindings);
    return receipt;
  }
  assertSettledNoncreateBinding(action, intent, binding, dependencyBindings);
  return receipt;
}

/** @param {Readonly<Record<string, any>>} target @param {Readonly<Record<string, any>>|undefined} binding @param {Map<string, Readonly<Record<string, any>>>} bindingByKey @param {{actionIndex: number, action: Readonly<Record<string, any>>, intent: Readonly<Record<string, any>>}} activeReceipt @param {Readonly<Record<string, any>>} settledPlan @param {Readonly<Record<string, any>>} lastOperation @returns {void} */
function assertPredecessorReceipt(
  target,
  binding,
  bindingByKey,
  activeReceipt,
  settledPlan,
  lastOperation,
) {
  const predecessor = targetReceipt(
    settledPlan,
    lastOperation,
    target.resourceKey,
  );
  const priorAction = predecessor.action;
  const priorIntent = predecessor.intent;
  const activeAction = activeReceipt.action;
  const activeIntent = activeReceipt.intent;
  if (priorIntent.status !== 'settled') planConflict();
  assertActionTargetMetadata(priorAction, target);

  if (priorAction.after === null) {
    if (priorAction.management === 'managed') {
      if (priorIntent.ownershipNonce === null) planConflict();
      validateOwnershipNonce(
        priorIntent.ownershipNonce,
        'awsSingleNodeResourceObservationAuthority predecessor delete ownershipNonce',
      );
    } else if (priorIntent.ownershipNonce !== null) {
      planConflict();
    }
    if (activeAction.action !== 'create' || activeAction.before !== null) {
      planConflict();
    }
    return;
  }
  if (activeAction.action === 'create' || activeAction.before === null) {
    planConflict();
  }
  if (
    activeAction.before.providerResourceId === null ||
    activeAction.before.providerType !== priorAction.after.providerType ||
    (priorAction.after.providerResourceId !== null &&
      activeAction.before.providerResourceId !==
        priorAction.after.providerResourceId)
  ) {
    planConflict();
  }
  if (activeAction.management === 'managed') {
    if (
      priorIntent.ownershipNonce === null ||
      activeIntent.ownershipNonce !== priorIntent.ownershipNonce
    ) {
      planConflict();
    }
    validateOwnershipNonce(
      priorIntent.ownershipNonce,
      'awsSingleNodeResourceObservationAuthority predecessor ownershipNonce',
    );
  } else if (
    priorIntent.ownershipNonce !== null ||
    activeIntent.ownershipNonce !== null
  ) {
    planConflict();
  }

  if (activeIntent.status === 'settled' && activeAction.after === null) {
    if (binding !== undefined) planConflict();
    return;
  }
  const dependencyBindings = expectedDependencyBindings(
    priorAction,
    bindingByKey,
  );
  if (priorAction.action === 'create') {
    assertSettledCreateBinding(
      priorAction,
      priorIntent,
      binding,
      dependencyBindings,
    );
    return;
  }
  assertSettledNoncreateBinding(
    priorAction,
    priorIntent,
    binding,
    dependencyBindings,
  );
}

/** @param {Readonly<Record<string, any>>} action @param {number} actionIndex @param {Readonly<Record<string, any>>} intent @param {Readonly<Record<string, any>>} target @param {Readonly<Record<string, any>>|undefined} binding @param {Map<string, Readonly<Record<string, any>>>} targetByKey @param {Map<string, Readonly<Record<string, any>>>} bindingByKey @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} head @returns {void} */
function assertIntendedActionAuthority(
  action,
  actionIndex,
  intent,
  target,
  binding,
  targetByKey,
  bindingByKey,
  plan,
  head,
) {
  assertActionTarget(action, target);
  const dependencyBindings = expectedDependencyBindings(action, bindingByKey);
  const unboundExternalVerify = isUnboundExternalVerify(action, binding);
  if (action.action === 'create') {
    if (binding !== undefined || action.before !== null) planConflict();
  } else if (!unboundExternalVerify) {
    assertBindingMatchesAction(action, binding, dependencyBindings);
  }
  if (plan.operation === 'destroy' && binding === undefined) planConflict();

  if (action.management === 'managed') {
    if (action.action === 'create') {
      if (intent.ownershipNonce === null) planConflict();
      validateOwnershipNonce(
        intent.ownershipNonce,
        'awsSingleNodeResourceObservationAuthority current ownershipNonce',
      );
    } else if (
      binding === undefined ||
      binding.management !== 'managed' ||
      intent.ownershipNonce !== binding.ownershipNonce
    ) {
      planConflict();
    }
  } else if (intent.ownershipNonce !== null) {
    planConflict();
  }

  if (action.action === 'create' || unboundExternalVerify) {
    assertCreateDependencyReceipts(
      action,
      actionIndex,
      plan,
      head,
      targetByKey,
      bindingByKey,
    );
  }
  if (plan.operation === 'destroy') {
    assertDestroyPriorPurgeReceipts(actionIndex, plan, head, bindingByKey);
  }
}

/**
 * Validate one exact durable observation authority without performing provider
 * I/O or sampling a clock. The desired target, prior binding, and optional
 * active action are all derived from content-addressed deployment documents.
 * @param {unknown} value - Exact desired tuple, durable head, plan, and target.
 * @returns {Readonly<Record<string, any>>} - Canonical observation authority.
 */
export function createAwsSingleNodeResourceObservationAuthority(value) {
  const input = cloneJsonObject(
    value,
    'awsSingleNodeResourceObservationAuthority',
  );
  assertExactKeys(
    input,
    INPUT_KEYS,
    'awsSingleNodeResourceObservationAuthority',
  );
  if (!OPERATIONS.has(input.operation)) {
    throw new TypeError(
      'awsSingleNodeResourceObservationAuthority.operation is not supported.',
    );
  }

  const deploymentRevision = validateDeploymentRevision(
    input.deploymentRevision,
    'awsSingleNodeResourceObservationAuthority.deploymentRevision',
  );
  const profile = validateDeploymentProfile(
    input.profile,
    'awsSingleNodeResourceObservationAuthority.profile',
  );
  const providerScope = validateProviderScope(
    input.providerScope,
    'awsSingleNodeResourceObservationAuthority.providerScope',
  );
  const providerSpec = validateAwsSingleNodeProviderSpec(
    input.providerSpec,
    'awsSingleNodeResourceObservationAuthority.providerSpec',
  );
  assertDeploymentInstanceId(
    input.deploymentInstanceId,
    'awsSingleNodeResourceObservationAuthority.deploymentInstanceId',
  );
  assertDeploymentIncarnationId(
    input.incarnationId,
    'awsSingleNodeResourceObservationAuthority.incarnationId',
  );
  if (input.head === null) {
    throw new TypeError(
      'awsSingleNodeResourceObservationAuthority.head must be non-null.',
    );
  }
  const head = validateDeploymentHead(
    input.head,
    'awsSingleNodeResourceObservationAuthority.head',
  );
  const isCompletedDestroy = head.phase === 'DESTROYED';

  if (
    deploymentRevision.profileRevisionId !== profile.profileRevisionId ||
    deploymentRevision.appId !== profile.appId ||
    input.deploymentInstanceId !==
      getDeploymentInstanceId({ deploymentRevision, providerScope }) ||
    head.deploymentInstanceId !== input.deploymentInstanceId ||
    head.incarnationId !== input.incarnationId ||
    !sameJson(head.providerScope, providerScope) ||
    (isCompletedDestroy && input.operation !== 'destroy') ||
    (!isCompletedDestroy &&
      input.operation !== 'apply' &&
      head.settledDeploymentRevisionId !==
        deploymentRevision.deploymentRevisionId)
  ) {
    contextConflict();
  }

  if (
    (head.activeOperation === null) !== (input.plan === null) ||
    (head.lastOperation === null) !== (input.settledPlan === null)
  ) {
    planConflict();
  }

  const settledPlan =
    input.settledPlan === null
      ? null
      : validateDeploymentPlan(
          input.settledPlan,
          'awsSingleNodeResourceObservationAuthority.settledPlan',
        );
  if (settledPlan !== null) {
    assertSettledPlanAuthority(settledPlan, head, providerSpec);
    if (
      isCompletedDestroy &&
      !sameJson(settledPlan.deploymentRevision, deploymentRevision)
    ) {
      planConflict();
    }
    try {
      validateAwsSingleNodeProviderSpecContext(settledPlan.providerSpec, {
        profile,
        providerScope,
      });
    } catch {
      contextConflict();
    }
  }

  const plan =
    input.plan === null
      ? null
      : validateDeploymentPlanContext(input.plan, { profile });
  if (plan !== null) {
    if (!sameJson(plan.providerSpec, providerSpec)) planConflict();
    if (
      settledPlan !== null &&
      !sameJson(plan.providerSpec, settledPlan.providerSpec)
    ) {
      planConflict();
    }
  }
  if (settledPlan === null) {
    try {
      validateAwsSingleNodeProviderSpecContext(providerSpec, {
        profile,
        providerScope,
      });
    } catch {
      contextConflict();
    }
  }

  if (plan !== null && head.activeOperation !== null) {
    const activeOperation = head.activeOperation;
    const operationMatchesPlan =
      activeOperation.kind === 'destroy'
        ? plan.operation === 'destroy'
        : activeOperation.kind === 'reconcile'
          ? plan.operation === 'apply' || plan.operation === 'reconcile'
          : plan.operation === 'apply';
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
      plan.operation !== input.operation ||
      !operationMatchesPlan ||
      !sameJson(plan.deploymentRevision, deploymentRevision) ||
      !sameJson(plan.providerScope, providerScope) ||
      !sameJson(plan.providerSpec, providerSpec) ||
      plan.deploymentInstanceId !== input.deploymentInstanceId ||
      plan.incarnationId !== input.incarnationId ||
      activeOperation.planId !== plan.planId ||
      activeOperation.kind !== expectedOperationKind ||
      plan.basis.headGeneration >= head.generation ||
      plan.basis.settledDeploymentRevisionId !==
        head.settledDeploymentRevisionId ||
      head.targetDeploymentRevisionId !==
        (expectedOperationKind === 'destroy'
          ? null
          : deploymentRevision.deploymentRevisionId) ||
      activeOperation.intents.length !== plan.actions.length ||
      activeOperation.intents.some(
        (
          /** @type {Readonly<Record<string, any>>} */ intent,
          /** @type {number} */ index,
        ) => intent.actionId !== plan.actions[index].actionId,
      )
    ) {
      planConflict();
    }
  }

  /** @type {Readonly<Array<Readonly<Record<string, any>>>>} */
  let targets;
  try {
    targets = createAwsSingleNodeDesiredResourceTargetCatalog({
      deploymentRevision,
      profile,
      providerScope,
      providerSpec,
      deploymentInstanceId: input.deploymentInstanceId,
      incarnationId: input.incarnationId,
      head,
    });
  } catch {
    return contextConflict();
  }
  const matchingTargets = targets.filter((candidate) =>
    sameJson(candidate, input.target),
  );
  if (matchingTargets.length !== 1) {
    throw new Error(AUTHORITY_TARGET_ERROR);
  }
  const target = matchingTargets[0];
  const targetByKey = new Map(
    targets.map((/** @type {Readonly<Record<string, any>>} */ candidate) => [
      candidate.resourceKey,
      candidate,
    ]),
  );
  const bindingByKey = new Map(
    head.resourceBindings.map(
      (/** @type {Readonly<Record<string, any>>} */ candidate) => [
        candidate.resourceKey,
        candidate,
      ],
    ),
  );
  const binding = bindingByKey.get(target.resourceKey) ?? null;
  if (plan !== null && head.activeOperation !== null) {
    const activeReceipt = assertTargetDurableReceipt(
      target,
      binding ?? undefined,
      targetByKey,
      bindingByKey,
      plan,
      head.activeOperation,
      head,
      true,
    );
    if (settledPlan !== null && head.lastOperation !== null) {
      assertPredecessorReceipt(
        target,
        binding ?? undefined,
        bindingByKey,
        activeReceipt,
        settledPlan,
        head.lastOperation,
      );
    }
  } else if (settledPlan !== null && head.lastOperation !== null) {
    assertTargetDurableReceipt(
      target,
      binding ?? undefined,
      targetByKey,
      bindingByKey,
      settledPlan,
      head.lastOperation,
      head,
      false,
    );
  }

  let currentAction = null;
  if (plan !== null && head.activeOperation !== null) {
    const activeOperation = head.activeOperation;
    const actionIndex = activeOperation.nextActionIndex;
    if (actionIndex === plan.actions.length) {
      if (
        activeOperation.intents.some(
          (/** @type {Readonly<Record<string, any>>} */ intent) =>
            intent.status !== 'settled',
        )
      ) {
        throw new Error(AUTHORITY_FRONTIER_ERROR);
      }
    } else {
      const intent = activeOperation.intents[actionIndex];
      const action = plan.actions[actionIndex];
      if (intent.status === 'intended') {
        const actionTarget = targetByKey.get(action.resourceKey);
        if (actionTarget === undefined) planConflict();
        assertIntendedActionAuthority(
          action,
          actionIndex,
          intent,
          actionTarget,
          bindingByKey.get(action.resourceKey),
          targetByKey,
          bindingByKey,
          plan,
          head,
        );
        if (action.resourceKey === target.resourceKey) {
          currentAction = {
            actionIndex,
            action,
            ownershipNonce: intent.ownershipNonce,
          };
        }
      } else if (intent.status !== 'pending') {
        throw new Error(AUTHORITY_FRONTIER_ERROR);
      }
    }
  }

  return deepFreeze(
    sortCanonicalJsonValue({
      operation: input.operation,
      deploymentRevision,
      profile,
      providerScope,
      providerSpec,
      deploymentInstanceId: input.deploymentInstanceId,
      incarnationId: input.incarnationId,
      head,
      plan,
      settledPlan,
      target,
      binding,
      currentAction,
    }),
  );
}

export default {
  createAwsSingleNodeResourceObservationAuthority,
};
