/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable provider planning contracts are clearer than repeated parser-specific expansions. */

import { createAwsSingleNodeDesiredResourceTargetCatalog } from './deployment-aws-desired-resource-targets.js';
import { validateAwsSingleNodeProviderSpec } from './deployment-aws-provider-spec.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentInspection } from './deployment-inspection.js';
import { createDeploymentPlan } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import {
  assertDeploymentInstanceId,
  validateProviderScope,
} from './deployment-provider-scope.js';
import { getAwsSingleNodeResourceDestroyOrder } from './deployment-resource-graph.js';
import { assertDeploymentIncarnationId } from './deployment-resource-binding.js';
import { validateDeploymentRevision } from './deployment-revision.js';
import { cloneJsonObject } from './json-value.js';

export const AWS_SINGLE_NODE_DEPLOYMENT_PLAN_UNSUPPORTED =
  'AWS_SINGLE_NODE_DEPLOYMENT_PLAN_UNSUPPORTED';

const INPUT_KEYS = new Set([
  'operation',
  'deploymentRevision',
  'profile',
  'providerScope',
  'providerSpec',
  'deploymentInstanceId',
  'incarnationId',
  'head',
  'inspection',
]);
const OPERATIONS = new Set(['apply', 'reconcile', 'destroy']);
const DESTROY_REQUIRES_DESIRED_STATE = new Set([
  'artifact',
  'application-state-attachment',
  'control-state-attachment',
]);

/** A fresh inspection cannot authorize one complete AWS single-node plan. */
export class AwsSingleNodeDeploymentPlanUnsupportedError extends Error {
  constructor() {
    super('AWS single-node deployment plan is unsupported.');
    this.name = 'AwsSingleNodeDeploymentPlanUnsupportedError';
    this.code = AWS_SINGLE_NODE_DEPLOYMENT_PLAN_UNSUPPORTED;
  }
}

/** @returns {never} */
function unsupported() {
  throw new AwsSingleNodeDeploymentPlanUnsupportedError();
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertAllKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** @param {Readonly<Record<string, any>>} target @returns {Record<string, any>} */
function actionFields(target) {
  return {
    resourceKey: target.resourceKey,
    capability: target.capability,
    role: target.role,
    management: target.management,
    ownershipMode: target.ownershipMode,
    dependsOn: target.dependsOn,
    onDestroy: target.onDestroy,
  };
}

/** @param {Readonly<Record<string, any>>} target @param {Readonly<Record<string, any>>} resource @returns {void} */
function assertResourceRole(target, resource) {
  if (
    resource.resourceKey !== target.resourceKey ||
    !sameJson(resource.capability, target.capability) ||
    !sameJson(resource.role, target.role) ||
    resource.management !== target.management ||
    resource.ownershipMode !== target.ownershipMode ||
    !sameJson(resource.dependsOn, target.dependsOn) ||
    resource.onDestroy !== target.onDestroy ||
    !sameJson(resource.desiredDigest, target.target.stateDigest)
  ) {
    unsupported();
  }
}

/** @param {Readonly<Record<string, any>>} resource @returns {boolean} */
function isAuthoritativelyAbsent(resource) {
  return (
    resource.presence === 'absent' &&
    resource.presenceEvidence === 'authoritative-not-found' &&
    resource.ownership === 'missing' &&
    resource.providerIdentity === null &&
    resource.bindingId === null &&
    resource.dependencyBindings === null &&
    resource.observedDigest === null
  );
}

/** @param {Readonly<Record<string, any>>} target @param {Readonly<Record<string, any>>} resource @param {Readonly<Record<string, any>>} binding @returns {void} */
function assertExactlyOwnedPresent(target, resource, binding) {
  const expectedOwnership =
    binding.management === 'managed' ? 'verified' : 'external';
  if (
    resource.presence !== 'present' ||
    resource.presenceEvidence !== 'exact-read' ||
    resource.ownership !== expectedOwnership ||
    resource.providerIdentity === null ||
    resource.providerIdentity.providerType !== binding.providerType ||
    resource.providerIdentity.providerResourceId !==
      binding.providerResourceId ||
    binding.providerType !== target.target.providerType ||
    binding.providerResourceId !== target.target.providerResourceId ||
    resource.bindingId !== binding.bindingId ||
    !sameJson(resource.dependencyBindings, binding.dependencyBindings) ||
    resource.observedDigest === null
  ) {
    unsupported();
  }
}

/** @param {Readonly<Record<string, any>>} target @param {Readonly<Record<string, any>>} resource @returns {Record<string, any>} */
function observedState(target, resource) {
  if (resource.providerIdentity === null || resource.observedDigest === null) {
    return unsupported();
  }
  return {
    providerType: target.target.providerType,
    providerResourceId: resource.providerIdentity.providerResourceId,
    stateDigest: resource.observedDigest,
  };
}

/** @param {Readonly<Record<string, any>>} target @param {string} action @param {string} reason @param {Record<string, any>|null} before @param {Record<string, any>|null} after @returns {Record<string, any>} */
function deploymentAction(target, action, reason, before, after) {
  return {
    ...actionFields(target),
    action,
    destructive: action === 'delete',
    reason,
    before,
    after,
  };
}

/**
 * @param {readonly Readonly<Record<string, any>>[]} targets - Canonical desired targets.
 * @param {Readonly<Record<string, any>>} inspection - Exact fresh provider evidence.
 * @param {Readonly<Record<string, any>>|null} head - Exact durable predecessor.
 * @param {Readonly<Record<string, any>>} deploymentRevision - Exact desired deployment revision.
 * @returns {Record<string, any>[]} - Complete apply-ordered actions.
 */
function createApplyActions(targets, inspection, head, deploymentRevision) {
  if (head === null) {
    return targets.map((target) =>
      deploymentAction(target, 'create', 'missing', null, target.target),
    );
  }

  const resources = new Map(
    inspection.resources.map(
      (/** @type {Readonly<Record<string, any>>} */ resource) => [
        resource.resourceKey,
        resource,
      ],
    ),
  );
  const bindings = new Map(
    head.resourceBindings.map(
      (/** @type {Readonly<Record<string, any>>} */ binding) => [
        binding.resourceKey,
        binding,
      ],
    ),
  );
  const deploymentChanged =
    head.settledDeploymentRevisionId !==
    deploymentRevision.deploymentRevisionId;

  return targets.map((target) => {
    const resource = resources.get(target.resourceKey);
    const binding = bindings.get(target.resourceKey);
    if (resource === undefined) unsupported();
    assertResourceRole(target, resource);

    if (binding === undefined) {
      if (!isAuthoritativelyAbsent(resource)) unsupported();
      return deploymentAction(target, 'create', 'missing', null, target.target);
    }

    if (isAuthoritativelyAbsent(resource)) {
      if (target.resourceKey !== 'artifact') unsupported();
      return deploymentAction(
        target,
        'update',
        deploymentChanged ? 'deployment-change' : 'drift',
        target.target,
        target.target,
      );
    }

    assertExactlyOwnedPresent(target, resource, binding);
    const before = observedState(target, resource);
    if (sameJson(resource.observedDigest, target.target.stateDigest)) {
      return deploymentAction(
        target,
        'noop',
        'already-converged',
        target.target,
        target.target,
      );
    }
    if (target.resourceKey !== 'artifact') unsupported();
    return deploymentAction(
      target,
      'update',
      deploymentChanged ? 'deployment-change' : 'drift',
      before,
      target.target,
    );
  });
}

/**
 * @param {readonly Readonly<Record<string, any>>[]} targets - Canonical desired targets.
 * @param {Readonly<Record<string, any>>} inspection - Exact fresh provider evidence.
 * @param {Readonly<Record<string, any>>} head - Exact durable predecessor.
 * @returns {Record<string, any>[]} - Complete reverse-ordered destroy actions.
 */
function createDestroyActions(targets, inspection, head) {
  const targetByKey = new Map(
    targets.map((target) => [target.resourceKey, target]),
  );
  const resourceByKey = new Map(
    inspection.resources.map(
      (/** @type {Readonly<Record<string, any>>} */ resource) => [
        resource.resourceKey,
        resource,
      ],
    ),
  );
  const bindingByKey = new Map(
    head.resourceBindings.map(
      (/** @type {Readonly<Record<string, any>>} */ binding) => [
        binding.resourceKey,
        binding,
      ],
    ),
  );
  if (
    bindingByKey.size !== targets.length ||
    targets.some((target) => !bindingByKey.has(target.resourceKey))
  ) {
    unsupported();
  }

  return getAwsSingleNodeResourceDestroyOrder().map((resourceKey) => {
    const target = targetByKey.get(resourceKey);
    const resource = resourceByKey.get(resourceKey);
    const binding = bindingByKey.get(resourceKey);
    if (
      target === undefined ||
      resource === undefined ||
      binding === undefined
    ) {
      return unsupported();
    }
    assertResourceRole(target, resource);

    if (target.onDestroy === 'retain') {
      assertExactlyOwnedPresent(target, resource, binding);
      if (!sameJson(resource.observedDigest, target.target.stateDigest)) {
        unsupported();
      }
      return deploymentAction(
        target,
        'noop',
        'retained-data',
        target.target,
        target.target,
      );
    }

    if (isAuthoritativelyAbsent(resource)) {
      return deploymentAction(
        target,
        'delete',
        'destroy-requested',
        target.target,
        null,
      );
    }

    assertExactlyOwnedPresent(target, resource, binding);
    if (
      DESTROY_REQUIRES_DESIRED_STATE.has(resourceKey) &&
      !sameJson(resource.observedDigest, target.target.stateDigest)
    ) {
      unsupported();
    }
    return deploymentAction(
      target,
      'delete',
      'destroy-requested',
      observedState(target, resource),
      null,
    );
  });
}

/**
 * Derive one complete deterministic AWS single-node plan from exact durable
 * authority and an already freshness-validated InspectionV5 document. This
 * function performs no provider I/O and samples no clock.
 * @param {unknown} value - Exact desired tuple, durable head, and inspection.
 * @returns {Readonly<Record<string, any>>} - Canonical DeploymentPlanV3.
 */
export function createAwsSingleNodeDeploymentPlan(value) {
  const input = cloneJsonObject(value, 'awsSingleNodeDeploymentPlan');
  assertAllKeys(input, INPUT_KEYS, 'awsSingleNodeDeploymentPlan');
  if (!OPERATIONS.has(input.operation)) {
    throw new TypeError(
      'awsSingleNodeDeploymentPlan.operation is not supported.',
    );
  }

  const deploymentRevision = validateDeploymentRevision(
    input.deploymentRevision,
    'awsSingleNodeDeploymentPlan.deploymentRevision',
  );
  const profile = validateDeploymentProfile(
    input.profile,
    'awsSingleNodeDeploymentPlan.profile',
  );
  const providerScope = validateProviderScope(
    input.providerScope,
    'awsSingleNodeDeploymentPlan.providerScope',
  );
  const providerSpec = validateAwsSingleNodeProviderSpec(
    input.providerSpec,
    'awsSingleNodeDeploymentPlan.providerSpec',
  );
  assertDeploymentInstanceId(
    input.deploymentInstanceId,
    'awsSingleNodeDeploymentPlan.deploymentInstanceId',
  );
  assertDeploymentIncarnationId(
    input.incarnationId,
    'awsSingleNodeDeploymentPlan.incarnationId',
  );
  const head =
    input.head === null
      ? null
      : validateDeploymentHead(input.head, 'awsSingleNodeDeploymentPlan.head');
  const inspection = validateDeploymentInspection(
    input.inspection,
    'awsSingleNodeDeploymentPlan.inspection',
  );

  if (
    (head === null && input.operation !== 'apply') ||
    (head !== null && head.phase !== 'READY') ||
    (head !== null &&
      input.operation !== 'apply' &&
      head.settledDeploymentRevisionId !==
        deploymentRevision.deploymentRevisionId)
  ) {
    unsupported();
  }

  const expectedInspectionIncarnation =
    head === null ? null : input.incarnationId;
  const expectedControlState =
    head === null
      ? { status: 'absent', evidence: 'authoritative-not-found' }
      : { status: 'present', evidence: 'provider-head-read' };
  if (
    !sameJson(inspection.deploymentRevision, deploymentRevision) ||
    !sameJson(inspection.providerScope, providerScope) ||
    inspection.providerSpecId !== providerSpec.providerSpecId ||
    inspection.deploymentInstanceId !== input.deploymentInstanceId ||
    inspection.incarnationId !== expectedInspectionIncarnation ||
    inspection.headGeneration !== (head?.generation ?? 0) ||
    inspection.controlState.status !== expectedControlState.status ||
    inspection.controlState.evidence !== expectedControlState.evidence ||
    inspection.status === 'unknown' ||
    inspection.status === 'conflict' ||
    (inspection.status === 'destroyed' && input.operation !== 'destroy') ||
    (head === null && inspection.status !== 'absent') ||
    (head === null && inspection.resources.length !== 0) ||
    (head !== null &&
      (head.deploymentInstanceId !== input.deploymentInstanceId ||
        head.incarnationId !== input.incarnationId ||
        !sameJson(head.providerScope, providerScope)))
  ) {
    unsupported();
  }

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
    return unsupported();
  }

  if (
    head !== null &&
    (inspection.resources.length !== targets.length ||
      inspection.resources.some(
        (
          /** @type {Readonly<Record<string, any>>} */ resource,
          /** @type {number} */ index,
        ) => resource.resourceKey !== targets[index].resourceKey,
      ))
  ) {
    unsupported();
  }

  let actions;
  if (input.operation === 'destroy') {
    if (head === null) unsupported();
    actions = createDestroyActions(targets, inspection, head);
  } else {
    actions = createApplyActions(targets, inspection, head, deploymentRevision);
  }
  return createDeploymentPlan(
    {
      operation: input.operation,
      deploymentRevision,
      providerScope,
      providerSpec,
      deploymentInstanceId: input.deploymentInstanceId,
      incarnationId: input.incarnationId,
      basis: {
        headGeneration: head?.generation ?? 0,
        settledDeploymentRevisionId: head?.settledDeploymentRevisionId ?? null,
        inspectionId: inspection.inspectionId,
      },
      actions,
    },
    { profile },
  );
}

export default {
  AWS_SINGLE_NODE_DEPLOYMENT_PLAN_UNSUPPORTED,
  AwsSingleNodeDeploymentPlanUnsupportedError,
  createAwsSingleNodeDeploymentPlan,
};
