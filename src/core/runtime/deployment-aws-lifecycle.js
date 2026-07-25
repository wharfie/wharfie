/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- This boundary composes several exact JSON document families. */

import {
  validateDeploymentArtifactStageIntentContext,
  validateDeploymentArtifactStageReceiptContext,
} from './deployment-artifact-stage.js';
import { runAwsSingleNodeDeploymentOperation } from './deployment-aws-operation-runner.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentInspection } from './deployment-inspection.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import {
  createRunningDeploymentRevision,
  validateDeploymentRevision,
} from './deployment-revision.js';
import { assertDeploymentInstanceId } from './deployment-provider-scope.js';
import { assertLogicalId } from './logical-id.js';

const RUNNING_REQUEST_KEYS = Object.freeze([
  'deployment',
  'profile',
  'controlPolicy',
]);
const PREPARED_REQUEST_KEYS = Object.freeze(['prepared', 'controlPolicy']);
const PREPARED_RUNNING_KEYS = Object.freeze(['plan', 'profile']);
const PREPARED_STAGED_KEYS = Object.freeze([
  'plan',
  'profile',
  'artifactStage',
]);
const ARTIFACT_STAGE_KEYS = Object.freeze(['intent', 'receipt']);
const DEPLOYMENT_KEYS = Object.freeze(['id']);
const INSPECT_REQUEST_KEYS = Object.freeze([
  'deploymentInstanceId',
  'region',
  'controlPolicy',
]);
const RECONCILE_REQUEST_KEYS = Object.freeze([
  'deploymentInstanceId',
  'region',
  'controlPolicy',
  'confirmCoordinatorStopped',
]);
const INSPECTION_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'deploymentInstanceId',
  'status',
  'head',
  'activePlan',
  'lastOperationPlan',
  'profile',
  'providerSpec',
  'inspection',
]);
const CONTROL_POLICIES = new Set([
  'require-active',
  'reconcile-existing',
  'bootstrap',
]);
const INSPECTION_STATUSES = new Set([
  'absent',
  'converged',
  'drifted',
  'in-flight',
  'degraded',
  'conflict',
  'unknown',
  'destroyed',
]);
const AWS_REGION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

const INVALID_REQUEST = 'AWS deployment lifecycle request is invalid.';
const INVALID_PREPARED_PLAN =
  'AWS deployment lifecycle prepared plan is invalid.';
const INVALID_OPERATION_RESULT =
  'AWS deployment lifecycle operation result is invalid.';
const ACTIVE_OPERATION =
  'AWS deployment has an active operation; confirm the former coordinator is stopped before recovery.';
const RECONCILE_UNAVAILABLE =
  'AWS deployment must be READY before a new reconcile operation.';
const DESTROY_UNAVAILABLE =
  'AWS deployment must be READY and inactive before destroy.';
const DESTROY_PROOF_UNAVAILABLE =
  'AWS deployment destruction is not proven by current provider evidence.';
const RUNNING_REVISION_MISMATCH =
  'Running SEA does not match the exact settled deployment revision.';
const RUNNING_ACTIVE_REVISION_MISMATCH =
  'Running SEA does not match the exact active deployment revision.';
const OPERATION_INCOMPLETE =
  'AWS deployment operation remains active; inspect and recover it before treating the command as successful.';

/** A valid controller result still names an unfinished durable operation. */
export class AwsDeploymentOperationIncompleteError extends Error {
  constructor() {
    super(OPERATION_INCOMPLETE);
    this.name = 'AwsDeploymentOperationIncompleteError';
    this.code = 'AWS_DEPLOYMENT_OPERATION_INCOMPLETE';
  }
}

/**
 * @param {unknown} value - Candidate plain object.
 * @returns {value is Record<string, any>} - Whether the value is plain.
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Snapshot an exact own enumerable data-property surface without invoking
 * accessors.
 * @param {unknown} value - Candidate object.
 * @param {Readonly<string[]>} keys - Exact ordered key surface.
 * @param {string} message - Stable public error.
 * @returns {Readonly<Record<string, any>>} - Stable shallow snapshot.
 */
function snapshotExactObject(value, keys, message) {
  if (!isPlainObject(value)) throw new TypeError(message);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some(
      (key) =>
        typeof key !== 'string' || !keys.includes(/** @type {string} */ (key)),
    )
  ) {
    throw new TypeError(message);
  }
  /** @type {Record<string, any>} */
  const snapshot = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(message);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * @param {unknown} value - Candidate explicit control policy.
 * @returns {'require-active'|'reconcile-existing'|'bootstrap'} - Canonical policy.
 */
function validateControlPolicy(value) {
  if (typeof value !== 'string' || !CONTROL_POLICIES.has(value)) {
    throw new TypeError(INVALID_REQUEST);
  }
  return /** @type {'require-active'|'reconcile-existing'|'bootstrap'} */ (
    value
  );
}

/** @param {unknown} value @returns {string} */
function validateRegion(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 63 ||
    value.trim() !== value ||
    !AWS_REGION_PATTERN.test(value)
  ) {
    throw new TypeError(INVALID_REQUEST);
  }
  return value;
}

/** @param {unknown} value @returns {string} */
function validateDeploymentInstanceId(value) {
  try {
    assertDeploymentInstanceId(
      value,
      'awsDeploymentLifecycle deploymentInstanceId',
    );
  } catch {
    throw new TypeError(INVALID_REQUEST);
  }
  return /** @type {string} */ (value);
}

/**
 * @param {unknown} value - Exact human deployment object.
 * @returns {Readonly<{id: string}>} - Canonical deployment.
 */
function validateDeployment(value) {
  const deployment = snapshotExactObject(
    value,
    DEPLOYMENT_KEYS,
    INVALID_REQUEST,
  );
  try {
    assertLogicalId(deployment.id, 'awsDeploymentLifecycle deployment.id');
  } catch {
    throw new TypeError(INVALID_REQUEST);
  }
  return Object.freeze({ id: deployment.id });
}

/**
 * @param {unknown} value - Running-artifact lifecycle request.
 * @returns {Readonly<Record<string, any>>} - Canonical request.
 */
function admitRunningRequest(value) {
  const request = snapshotExactObject(
    value,
    RUNNING_REQUEST_KEYS,
    INVALID_REQUEST,
  );
  let profile;
  try {
    profile = validateDeploymentProfile(
      request.profile,
      'awsDeploymentLifecycle profile',
    );
  } catch {
    throw new TypeError(INVALID_REQUEST);
  }
  return Object.freeze({
    deployment: validateDeployment(request.deployment),
    profile,
    controlPolicy: validateControlPolicy(request.controlPolicy),
  });
}

/**
 * @param {unknown} value - Deployment locator request.
 * @param {boolean} withConfirmation - Whether confirmation is required.
 * @returns {Readonly<Record<string, any>>} - Canonical request.
 */
function admitLocatedRequest(value, withConfirmation) {
  const request = snapshotExactObject(
    value,
    withConfirmation ? RECONCILE_REQUEST_KEYS : INSPECT_REQUEST_KEYS,
    INVALID_REQUEST,
  );
  if (
    withConfirmation &&
    typeof request.confirmCoordinatorStopped !== 'boolean'
  ) {
    throw new TypeError(INVALID_REQUEST);
  }
  return Object.freeze({
    deploymentInstanceId: validateDeploymentInstanceId(
      request.deploymentInstanceId,
    ),
    region: validateRegion(request.region),
    controlPolicy: validateControlPolicy(request.controlPolicy),
    ...(withConfirmation
      ? { confirmCoordinatorStopped: request.confirmCoordinatorStopped }
      : {}),
  });
}

/**
 * @param {unknown} value - Candidate artifact-stage bundle.
 * @param {Readonly<Record<string, any>>} plan - Exact plan context.
 * @param {Readonly<Record<string, any>>} profile - Exact profile.
 * @param {string} path - Validation path.
 * @returns {Readonly<Record<string, any>>} - Canonical bundle.
 */
function validateArtifactStage(value, plan, profile, path) {
  const stage = snapshotExactObject(
    value,
    ARTIFACT_STAGE_KEYS,
    INVALID_PREPARED_PLAN,
  );
  const intent = validateDeploymentArtifactStageIntentContext(
    stage.intent,
    Object.freeze({
      deploymentRevision: plan.deploymentRevision,
      profile,
      providerScope: plan.providerScope,
    }),
    `${path}.intent`,
  );
  const receipt = validateDeploymentArtifactStageReceiptContext(
    stage.receipt,
    Object.freeze({ intent }),
    `${path}.receipt`,
  );
  return Object.freeze({ intent, receipt });
}

/**
 * @param {unknown} value - Candidate plan result.
 * @param {'apply'|'reconcile'|'destroy'} operation - Required operation.
 * @param {Readonly<Record<string, any>>} deploymentRevision - Exact revision.
 * @param {Readonly<Record<string, any>>} profile - Exact profile.
 * @param {string|undefined} deploymentInstanceId - Optional required instance.
 * @returns {Readonly<Record<string, any>>} - Canonical plan.
 */
function validatePlanResult(
  value,
  operation,
  deploymentRevision,
  profile,
  deploymentInstanceId,
) {
  let plan;
  try {
    plan = validateDeploymentPlanContext(value, { profile });
  } catch {
    throw new TypeError(INVALID_OPERATION_RESULT);
  }
  if (
    plan.operation !== operation ||
    !sameJson(plan.deploymentRevision, deploymentRevision) ||
    (deploymentInstanceId !== undefined &&
      plan.deploymentInstanceId !== deploymentInstanceId)
  ) {
    throw new TypeError(INVALID_OPERATION_RESULT);
  }
  return plan;
}

/**
 * @param {Readonly<Record<string, any>>} plan - Exact operation plan.
 * @returns {'create'|'update'|'reconcile'|'destroy'|null} - Durable operation kind, or null for an impossible plan basis.
 */
function getExpectedOperationKind(plan) {
  const settledRevisionId = plan.basis.settledDeploymentRevisionId;
  const targetRevisionId = plan.deploymentRevision.deploymentRevisionId;
  if (plan.operation === 'destroy') {
    return settledRevisionId === targetRevisionId ? 'destroy' : null;
  }
  if (settledRevisionId === null) return 'create';
  return settledRevisionId === targetRevisionId ? 'reconcile' : 'update';
}

/**
 * @param {Readonly<Record<string, any>>} plan - Exact operation plan.
 * @param {string|null} expectedKind - Derived durable operation kind.
 * @returns {boolean} - Whether the public plan operation can produce the kind.
 */
function operationKindMatchesPlan(plan, expectedKind) {
  if (expectedKind === null) return false;
  if (expectedKind === 'destroy') return plan.operation === 'destroy';
  if (expectedKind === 'reconcile') {
    return plan.operation === 'apply' || plan.operation === 'reconcile';
  }
  return plan.operation === 'apply';
}

/**
 * @param {Readonly<Record<string, any>>|null} operation - Head operation.
 * @param {Readonly<Record<string, any>>} plan - Exact plan.
 * @param {string|null} expectedKind - Derived durable operation kind.
 * @returns {boolean} - Whether operation identity and action order match.
 */
function operationMatchesPlan(operation, plan, expectedKind) {
  return (
    operation !== null &&
    operationKindMatchesPlan(plan, expectedKind) &&
    operation.kind === expectedKind &&
    operation.planId === plan.planId &&
    operation.intents.length === plan.actions.length &&
    operation.intents.every(
      (
        /** @type {Readonly<Record<string, any>>} */ intent,
        /** @type {number} */ index,
      ) => intent.actionId === plan.actions[index].actionId,
    )
  );
}

/**
 * @param {Readonly<Record<string, any>>} plan - Exact active plan.
 * @param {Readonly<Record<string, any>>} head - Exact active head.
 * @returns {boolean} - Whether the plan fully authorizes the active head.
 */
function activePlanMatchesHead(plan, head) {
  const expectedKind = getExpectedOperationKind(plan);
  return (
    operationMatchesPlan(head.activeOperation, plan, expectedKind) &&
    head.deploymentInstanceId === plan.deploymentInstanceId &&
    head.incarnationId === plan.incarnationId &&
    sameJson(head.providerScope, plan.providerScope) &&
    head.phase === (expectedKind === 'destroy' ? 'DESTROYING' : 'CONVERGING') &&
    plan.basis.headGeneration < head.generation &&
    plan.basis.settledDeploymentRevisionId ===
      head.settledDeploymentRevisionId &&
    head.targetDeploymentRevisionId ===
      (expectedKind === 'destroy'
        ? null
        : plan.deploymentRevision.deploymentRevisionId)
  );
}

/**
 * @param {Readonly<Record<string, any>>} plan - Exact settled plan.
 * @param {Readonly<Record<string, any>>} head - Head retaining its settlement.
 * @returns {boolean} - Whether the plan fully authorizes the last operation.
 */
function settledPlanMatchesHead(plan, head) {
  const expectedKind = getExpectedOperationKind(plan);
  const revisionMatches =
    head.phase === 'DESTROYED'
      ? expectedKind === 'destroy'
      : plan.deploymentRevision.deploymentRevisionId ===
        head.settledDeploymentRevisionId;
  return (
    operationMatchesPlan(head.lastOperation, plan, expectedKind) &&
    head.deploymentInstanceId === plan.deploymentInstanceId &&
    head.incarnationId === plan.incarnationId &&
    sameJson(head.providerScope, plan.providerScope) &&
    revisionMatches &&
    plan.basis.headGeneration < head.generation
  );
}

/**
 * @param {unknown} value - Candidate controller head.
 * @param {Readonly<Record<string, any>>} plan - Exact operation plan.
 * @returns {Readonly<Record<string, any>>} - Canonical correlated terminal head.
 */
export function validateAwsDeploymentOperationResult(value, plan) {
  let head;
  try {
    head = validateDeploymentHead(value, 'awsDeploymentLifecycle result head');
  } catch {
    throw new TypeError(INVALID_OPERATION_RESULT);
  }
  const active = head.activeOperation !== null;
  if (active) {
    if (!activePlanMatchesHead(plan, head)) {
      throw new TypeError(INVALID_OPERATION_RESULT);
    }
    throw new AwsDeploymentOperationIncompleteError();
  }
  const expectedKind = getExpectedOperationKind(plan);
  if (
    !settledPlanMatchesHead(plan, head) ||
    head.phase !== (expectedKind === 'destroy' ? 'DESTROYED' : 'READY') ||
    head.targetDeploymentRevisionId !==
      (expectedKind === 'destroy'
        ? null
        : plan.deploymentRevision.deploymentRevisionId)
  ) {
    throw new TypeError(INVALID_OPERATION_RESULT);
  }
  return head;
}

/**
 * Validate the controller's public inspection envelope and every nested durable
 * identity needed by later lifecycle decisions.
 * @param {unknown} value - Candidate inspection envelope.
 * @param {string} deploymentInstanceId - Exact requested instance.
 * @returns {Readonly<Record<string, any>>} - Canonical envelope.
 */
function validateInspectionResult(value, deploymentInstanceId) {
  const result = snapshotExactObject(
    value,
    INSPECTION_KEYS,
    INVALID_OPERATION_RESULT,
  );
  if (
    result.schemaVersion !== 1 ||
    result.kind !== 'deploymentControllerInspection' ||
    result.deploymentInstanceId !== deploymentInstanceId ||
    !INSPECTION_STATUSES.has(result.status)
  ) {
    throw new TypeError(INVALID_OPERATION_RESULT);
  }

  if (result.status === 'absent') {
    if (
      result.head !== null ||
      result.activePlan !== null ||
      result.lastOperationPlan !== null ||
      result.profile !== null ||
      result.providerSpec !== null ||
      result.inspection !== null
    ) {
      throw new TypeError(INVALID_OPERATION_RESULT);
    }
    return Object.freeze({
      schemaVersion: 1,
      kind: 'deploymentControllerInspection',
      deploymentInstanceId,
      status: 'absent',
      head: null,
      activePlan: null,
      lastOperationPlan: null,
      profile: null,
      providerSpec: null,
      inspection: null,
    });
  }

  let head;
  let profile;
  try {
    head = validateDeploymentHead(
      result.head,
      'awsDeploymentLifecycle inspection.head',
    );
    profile = validateDeploymentProfile(
      result.profile,
      'awsDeploymentLifecycle inspection.profile',
    );
  } catch {
    throw new TypeError(INVALID_OPERATION_RESULT);
  }
  if (head.deploymentInstanceId !== deploymentInstanceId) {
    throw new TypeError(INVALID_OPERATION_RESULT);
  }

  let activePlan = null;
  let lastOperationPlan = null;
  try {
    if (result.activePlan !== null) {
      activePlan = validateDeploymentPlanContext(result.activePlan, {
        profile,
      });
    }
    if (result.lastOperationPlan !== null) {
      lastOperationPlan = validateDeploymentPlanContext(
        result.lastOperationPlan,
        { profile },
      );
    }
  } catch {
    throw new TypeError(INVALID_OPERATION_RESULT);
  }
  if (
    (head.activeOperation === null) !== (activePlan === null) ||
    (head.lastOperation === null) !== (lastOperationPlan === null) ||
    (activePlan !== null && !activePlanMatchesHead(activePlan, head)) ||
    (lastOperationPlan !== null &&
      !settledPlanMatchesHead(lastOperationPlan, head))
  ) {
    throw new TypeError(INVALID_OPERATION_RESULT);
  }
  const authorityPlan = activePlan || lastOperationPlan;
  if (
    authorityPlan === null ||
    !sameJson(result.providerSpec, authorityPlan.providerSpec) ||
    !sameJson(head.providerScope, authorityPlan.providerScope) ||
    (activePlan !== null &&
      lastOperationPlan !== null &&
      !sameJson(activePlan.providerSpec, lastOperationPlan.providerSpec))
  ) {
    throw new TypeError(INVALID_OPERATION_RESULT);
  }

  let inspection;
  try {
    inspection = validateDeploymentInspection(
      result.inspection,
      'awsDeploymentLifecycle inspection.inspection',
    );
  } catch {
    throw new TypeError(INVALID_OPERATION_RESULT);
  }
  if (
    result.status !== inspection.status ||
    inspection.deploymentInstanceId !== deploymentInstanceId ||
    inspection.headGeneration !== head.generation ||
    inspection.incarnationId !== head.incarnationId ||
    inspection.providerSpecId !== authorityPlan.providerSpec.providerSpecId ||
    !sameJson(
      inspection.deploymentRevision,
      authorityPlan.deploymentRevision,
    ) ||
    !sameJson(inspection.providerScope, authorityPlan.providerScope)
  ) {
    throw new TypeError(INVALID_OPERATION_RESULT);
  }

  return Object.freeze({
    schemaVersion: 1,
    kind: 'deploymentControllerInspection',
    deploymentInstanceId,
    status: inspection.status,
    head,
    activePlan,
    lastOperationPlan,
    profile,
    providerSpec: authorityPlan.providerSpec,
    inspection,
  });
}

/**
 * @param {unknown} value - Prepared apply request.
 * @param {boolean} staged - Whether exact stage evidence is required.
 * @returns {Readonly<Record<string, any>>} - Canonical request.
 */
function admitPreparedRequest(value, staged) {
  const request = snapshotExactObject(
    value,
    PREPARED_REQUEST_KEYS,
    INVALID_REQUEST,
  );
  const prepared = snapshotExactObject(
    request.prepared,
    staged ? PREPARED_STAGED_KEYS : PREPARED_RUNNING_KEYS,
    INVALID_PREPARED_PLAN,
  );
  let profile;
  let plan;
  try {
    profile = validateDeploymentProfile(
      prepared.profile,
      'awsDeploymentLifecycle prepared.profile',
    );
    plan = validateDeploymentPlanContext(prepared.plan, { profile });
  } catch {
    throw new TypeError(INVALID_PREPARED_PLAN);
  }
  if (plan.operation !== 'apply') {
    throw new TypeError(INVALID_PREPARED_PLAN);
  }
  const canonicalPrepared = staged
    ? Object.freeze({
        plan,
        profile,
        artifactStage: validateArtifactStage(
          prepared.artifactStage,
          plan,
          profile,
          'awsDeploymentLifecycle prepared.artifactStage',
        ),
      })
    : Object.freeze({ plan, profile });
  return Object.freeze({
    prepared: canonicalPrepared,
    controlPolicy: validateControlPolicy(request.controlPolicy),
  });
}

/**
 * Invoke the closed one-shot runner with a frozen exact request.
 * @param {string} region - Exact AWS region.
 * @param {'require-active'|'reconcile-existing'|'bootstrap'} controlPolicy - Explicit control policy.
 * @param {'inspect'|'plan'|'validate-staged-artifact'|'converge'|'converge-pre-staged'|'resume'} operation - Finite runner operation.
 * @param {Readonly<Record<string, any>>} input - Exact JSON input.
 * @returns {Promise<any>} - Raw result for caller validation.
 */
function run(region, controlPolicy, operation, input) {
  return runAwsSingleNodeDeploymentOperation(
    Object.freeze({ region, controlPolicy, operation, input }),
  );
}

/**
 * @param {Readonly<Record<string, any>>} request - Canonical running request.
 * @returns {Promise<Readonly<{plan: Readonly<Record<string, any>>, profile: Readonly<Record<string, any>>}>>} - Exact prepared plan.
 */
async function prepareRunning(request) {
  const deploymentRevision = validateDeploymentRevision(
    await createRunningDeploymentRevision({
      deployment: request.deployment,
      profile: request.profile,
    }),
    'awsDeploymentLifecycle running deployment revision',
  );
  const plan = validatePlanResult(
    await run(
      request.profile.provider.scope.region,
      request.controlPolicy,
      'plan',
      Object.freeze({
        operation: 'apply',
        deploymentRevision,
        profile: request.profile,
      }),
    ),
    'apply',
    deploymentRevision,
    request.profile,
    undefined,
  );
  return Object.freeze({ plan, profile: request.profile });
}

/**
 * Create an apply plan for the exact SEA executing this command. Planning does
 * not stage bytes; later ordinary convergence re-observes them.
 * @param {unknown} value - Exact deployment, profile, and control policy.
 * @returns {Promise<Readonly<{plan: Readonly<Record<string, any>>, profile: Readonly<Record<string, any>>}>>} - Portable running-SEA plan.
 */
export async function prepareAwsRunningSeaPlan(value) {
  return await prepareRunning(admitRunningRequest(value));
}

/**
 * Plan and converge the exact SEA executing this command.
 * @param {unknown} value - Exact deployment, profile, and control policy.
 * @returns {Promise<Readonly<Record<string, any>>>} - Correlated deployment head.
 */
export async function applyAwsRunningSea(value) {
  const request = admitRunningRequest(value);
  const prepared = await prepareRunning(request);
  const result = await run(
    request.profile.provider.scope.region,
    request.controlPolicy,
    'converge',
    prepared,
  );
  return validateAwsDeploymentOperationResult(result, prepared.plan);
}

/**
 * Converge one previously prepared running-SEA apply plan. Ordinary converge
 * must re-observe the process executable before accepting it.
 * @param {unknown} value - Exact prepared plan and control policy.
 * @returns {Promise<Readonly<Record<string, any>>>} - Correlated deployment head.
 */
export async function applyAwsPreparedRunningSeaPlan(value) {
  const request = admitPreparedRequest(value, false);
  const result = await run(
    request.prepared.profile.provider.scope.region,
    request.controlPolicy,
    'converge',
    request.prepared,
  );
  return validateAwsDeploymentOperationResult(result, request.prepared.plan);
}

/**
 * Converge one previously prepared selected-SEA apply plan without consulting
 * the executable running this command.
 * @param {unknown} value - Exact staged plan and control policy.
 * @returns {Promise<Readonly<Record<string, any>>>} - Correlated deployment head.
 */
export async function applyAwsPreparedStagedPlan(value) {
  const request = admitPreparedRequest(value, true);
  const result = await run(
    request.prepared.profile.provider.scope.region,
    request.controlPolicy,
    'converge-pre-staged',
    request.prepared,
  );
  return validateAwsDeploymentOperationResult(result, request.prepared.plan);
}

/**
 * @param {Readonly<Record<string, any>>} request - Canonical locator.
 * @returns {Promise<Readonly<Record<string, any>>>} - Canonical inspection.
 */
async function inspectLocated(request) {
  const result = await run(
    request.region,
    request.controlPolicy,
    'inspect',
    Object.freeze({
      deploymentInstanceId: request.deploymentInstanceId,
    }),
  );
  return validateInspectionResult(result, request.deploymentInstanceId);
}

/**
 * Inspect one exact deployment without artifact observation or staging.
 * @param {unknown} value - Exact deployment instance, region, and control policy.
 * @returns {Promise<Readonly<Record<string, any>>>} - Controller inspection envelope.
 */
export async function inspectAwsDeployment(value) {
  return await inspectLocated(admitLocatedRequest(value, false));
}

/**
 * Recover an active operation when explicitly confirmed, or begin a new exact
 * reconcile from the durable settled revision.
 * @param {Readonly<Record<string, any>>} request - Canonical reconcile request.
 * @param {'running'|'staged'} mode - Artifact authority mode.
 * @returns {Promise<Readonly<Record<string, any>>>} - Correlated deployment head.
 */
async function reconcileLocated(request, mode) {
  const observed = await inspectLocated(request);
  if (observed.status === 'absent') throw new Error(RECONCILE_UNAVAILABLE);
  if (observed.activePlan !== null) {
    if (!request.confirmCoordinatorStopped) throw new Error(ACTIVE_OPERATION);
    if (mode === 'running' && observed.activePlan.operation !== 'destroy') {
      const runningRevision = validateDeploymentRevision(
        await createRunningDeploymentRevision({
          deployment: observed.activePlan.deploymentRevision.deployment,
          profile: observed.profile,
        }),
        'awsDeploymentLifecycle running active recovery revision',
      );
      if (!sameJson(runningRevision, observed.activePlan.deploymentRevision)) {
        throw new Error(RUNNING_ACTIVE_REVISION_MISMATCH);
      }
    }
    const resumed = await run(
      request.region,
      request.controlPolicy,
      'resume',
      Object.freeze({
        deploymentInstanceId: request.deploymentInstanceId,
        expectedPlanId: observed.activePlan.planId,
      }),
    );
    return validateAwsDeploymentOperationResult(resumed, observed.activePlan);
  }
  if (
    observed.head === null ||
    observed.head.phase !== 'READY' ||
    observed.lastOperationPlan === null ||
    observed.profile === null
  ) {
    throw new Error(RECONCILE_UNAVAILABLE);
  }

  const settledRevision = observed.lastOperationPlan.deploymentRevision;
  let deploymentRevision = settledRevision;
  if (mode === 'running') {
    deploymentRevision = validateDeploymentRevision(
      await createRunningDeploymentRevision({
        deployment: settledRevision.deployment,
        profile: observed.profile,
      }),
      'awsDeploymentLifecycle running reconcile revision',
    );
    if (!sameJson(deploymentRevision, settledRevision)) {
      throw new Error(RUNNING_REVISION_MISMATCH);
    }
  }

  const plan = validatePlanResult(
    await run(
      request.region,
      request.controlPolicy,
      'plan',
      Object.freeze({
        operation: 'reconcile',
        deploymentRevision,
        profile: observed.profile,
      }),
    ),
    'reconcile',
    deploymentRevision,
    observed.profile,
    request.deploymentInstanceId,
  );

  if (mode === 'running') {
    const result = await run(
      request.region,
      request.controlPolicy,
      'converge',
      Object.freeze({ plan, profile: observed.profile }),
    );
    return validateAwsDeploymentOperationResult(result, plan);
  }

  const artifactStage = validateArtifactStage(
    await run(
      request.region,
      request.controlPolicy,
      'validate-staged-artifact',
      Object.freeze({
        deploymentRevision,
        profile: observed.profile,
        providerScope: plan.providerScope,
      }),
    ),
    plan,
    observed.profile,
    'awsDeploymentLifecycle durable artifactStage',
  );
  const result = await run(
    request.region,
    request.controlPolicy,
    'converge-pre-staged',
    Object.freeze({ plan, profile: observed.profile, artifactStage }),
  );
  return validateAwsDeploymentOperationResult(result, plan);
}

/**
 * Reconcile using the exact running SEA. An active operation is recovered only
 * after explicit stopped-coordinator confirmation.
 * @param {unknown} value - Exact locator, control policy, and confirmation.
 * @returns {Promise<Readonly<Record<string, any>>>} - Correlated deployment head.
 */
export async function reconcileAwsRunningSeaDeployment(value) {
  return await reconcileLocated(admitLocatedRequest(value, true), 'running');
}

/**
 * Reconcile from durable staged artifact evidence without reading this
 * process's executable.
 * @param {unknown} value - Exact locator, control policy, and confirmation.
 * @returns {Promise<Readonly<Record<string, any>>>} - Correlated deployment head.
 */
export async function reconcileAwsStagedDeployment(value) {
  return await reconcileLocated(admitLocatedRequest(value, true), 'staged');
}

/**
 * Destroy from exact settled durable authority. Absent and provider-proven
 * already-destroyed deployments are stable read-only results; no destroy path
 * observes or stages executable bytes.
 * @param {unknown} value - Exact deployment instance, region, and control policy.
 * @returns {Promise<Readonly<Record<string, any>>>} - Absent inspection or deployment head.
 */
export async function destroyAwsDeployment(value) {
  const request = admitLocatedRequest(value, false);
  const observed = await inspectLocated(request);
  if (observed.status === 'absent') return observed;
  if (observed.head?.phase === 'DESTROYED') {
    if (observed.status !== 'destroyed') {
      throw new Error(DESTROY_PROOF_UNAVAILABLE);
    }
    return observed.head;
  }
  if (
    observed.head === null ||
    observed.head.phase !== 'READY' ||
    observed.activePlan !== null ||
    observed.lastOperationPlan === null ||
    observed.profile === null
  ) {
    throw new Error(DESTROY_UNAVAILABLE);
  }

  const deploymentRevision = observed.lastOperationPlan.deploymentRevision;
  const plan = validatePlanResult(
    await run(
      request.region,
      request.controlPolicy,
      'plan',
      Object.freeze({
        operation: 'destroy',
        deploymentRevision,
        profile: observed.profile,
      }),
    ),
    'destroy',
    deploymentRevision,
    observed.profile,
    request.deploymentInstanceId,
  );
  const result = await run(
    request.region,
    request.controlPolicy,
    'converge-pre-staged',
    Object.freeze({
      plan,
      profile: observed.profile,
      artifactStage: null,
    }),
  );
  return validateAwsDeploymentOperationResult(result, plan);
}

export default {
  applyAwsPreparedRunningSeaPlan,
  applyAwsPreparedStagedPlan,
  applyAwsRunningSea,
  destroyAwsDeployment,
  inspectAwsDeployment,
  prepareAwsRunningSeaPlan,
  reconcileAwsRunningSeaDeployment,
  reconcileAwsStagedDeployment,
  validateAwsDeploymentOperationResult,
};
