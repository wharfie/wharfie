/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- This boundary composes opaque ownership ports whose useful contracts are more precise in prose. */

import {
  validateDeploymentArtifactStageIntentContext,
  validateDeploymentArtifactStageReceiptContext,
} from '../../core/runtime/deployment-artifact-stage.js';
import { openAwsSingleNodeDeploymentInvocation } from '../../core/runtime/deployment-aws-invocation.js';
import { validateDeploymentPlanContext } from '../../core/runtime/deployment-plan.js';
import { validateDeploymentProfile } from '../../core/runtime/deployment-profile.js';
import { validateProviderScope } from '../../core/runtime/deployment-provider-scope.js';
import { assertLogicalId } from '../../core/runtime/logical-id.js';

import {
  claimSelectedSeaArtifactSource,
  createSelectedSeaDeploymentRevision,
  discardSelectedSeaArtifact,
  packageSelectedSeaArtifact,
} from './selected-sea-artifact.js';

const REQUEST_KEYS = new Set([
  'packageRequest',
  'deployment',
  'profile',
  'controlPolicy',
]);
const DEPLOYMENT_KEYS = new Set(['id']);
const STAGE_KEYS = new Set(['intent', 'receipt']);
const INVOCATION_PROPERTIES = Object.freeze([
  'providerScope',
  'requireControl',
  'reconcileControl',
  'bootstrapControl',
  'plan',
  'stageClaimedArtifact',
  'convergePreStaged',
  'close',
]);
const INVOCATION_METHODS = Object.freeze(INVOCATION_PROPERTIES.slice(1));
/** @type {Readonly<Record<string, 'requireControl'|'reconcileControl'|'bootstrapControl'>>} */
const CONTROL_METHOD_BY_POLICY = Object.freeze({
  'require-active': 'requireControl',
  'reconcile-existing': 'reconcileControl',
  bootstrap: 'bootstrapControl',
});
const INVALID_REQUEST = 'AWS selected SEA deployment request is invalid.';
const INVALID_INVOCATION = 'AWS selected SEA deployment invocation is invalid.';
const INVALID_PLAN = 'AWS selected SEA deployment plan is invalid.';
const INVALID_STAGE = 'AWS selected SEA artifact stage is invalid.';
const OPERATION_AND_CLEANUP_FAILED =
  'AWS selected SEA deployment and cleanup both failed.';
const CLEANUP_FAILED = 'AWS selected SEA deployment cleanup failed.';

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
 * Snapshot an exact enumerable own-data object without invoking accessors.
 * @param {unknown} value - Candidate object.
 * @param {Set<string>} keys - Exact key surface.
 * @param {string} message - Fixed boundary error.
 * @returns {Readonly<Record<string, any>>} - Stable shallow snapshot.
 */
function snapshotExactObject(value, keys, message) {
  if (!isPlainObject(value)) throw new TypeError(message);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
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

/**
 * Validate all serializable admission data before packaging crosses an await.
 * The package request itself remains opaque here and is handed immediately to
 * the V61 minting boundary, which owns its exact descriptor snapshot.
 * @param {unknown} value - Public orchestration request.
 * @returns {Readonly<Record<string, any>>} - Stable admitted request.
 */
function admitRequest(value) {
  const request = snapshotExactObject(value, REQUEST_KEYS, INVALID_REQUEST);
  const deploymentInput = snapshotExactObject(
    request.deployment,
    DEPLOYMENT_KEYS,
    INVALID_REQUEST,
  );
  try {
    assertLogicalId(deploymentInput.id, 'awsSourceDeployment deployment.id');
  } catch {
    throw new TypeError(INVALID_REQUEST);
  }

  let profile;
  try {
    profile = validateDeploymentProfile(
      request.profile,
      'awsSourceDeployment profile',
    );
  } catch {
    throw new TypeError(INVALID_REQUEST);
  }
  const controlMethod =
    typeof request.controlPolicy === 'string' &&
    Object.hasOwn(CONTROL_METHOD_BY_POLICY, request.controlPolicy)
      ? CONTROL_METHOD_BY_POLICY[request.controlPolicy]
      : undefined;
  if (controlMethod === undefined) throw new TypeError(INVALID_REQUEST);

  return Object.freeze({
    packageRequest: request.packageRequest,
    deployment: Object.freeze({ id: deploymentInput.id }),
    profile,
    controlMethod,
  });
}

/**
 * Read one required own data property without invoking a getter.
 * @param {unknown} owner - Candidate invocation.
 * @param {string} property - Required property.
 * @param {string} [message] - Fixed boundary error.
 * @returns {any} - Captured property value.
 */
function captureInvocationProperty(
  owner,
  property,
  message = INVALID_INVOCATION,
) {
  if (owner === null || typeof owner !== 'object') {
    throw new TypeError(message);
  }
  const descriptor = Object.getOwnPropertyDescriptor(owner, property);
  if (
    !descriptor ||
    !descriptor.enumerable ||
    !Object.hasOwn(descriptor, 'value')
  ) {
    throw new TypeError(message);
  }
  return descriptor.value;
}

/**
 * Capture a frozen invocation's exact methods before the first operation.
 * Additional public methods are intentionally irrelevant to this narrower
 * orchestration boundary.
 * @param {unknown} value - Opened invocation.
 * @returns {{owner: object, providerScope: Readonly<Record<string, any>>, methods: Readonly<Record<string, Function>>}} - Stable invocation projection.
 */
function captureInvocation(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Object.isFrozen(value)
  ) {
    throw new TypeError(INVALID_INVOCATION);
  }
  const providerScope = validateProviderScope(
    captureInvocationProperty(value, 'providerScope'),
    'awsSourceDeployment invocation.providerScope',
  );
  /** @type {Record<string, Function>} */
  const methods = {};
  for (const method of INVOCATION_METHODS) {
    const candidate = captureInvocationProperty(value, method);
    if (typeof candidate !== 'function') {
      throw new TypeError(INVALID_INVOCATION);
    }
    methods[method] = candidate;
  }
  return {
    owner: value,
    providerScope,
    methods: Object.freeze(methods),
  };
}

/**
 * Capture close first so a later invalid invocation-property failure can
 * still release the already-opened owner.
 * @param {unknown} value - Opened invocation.
 * @returns {Function} - Stable close method.
 */
function captureInvocationClose(value) {
  const close = captureInvocationProperty(value, 'close');
  if (typeof close !== 'function') throw new TypeError(INVALID_INVOCATION);
  return close;
}

/**
 * Capture the selected boundary's held-source cleanup before attempting the
 * synchronous transfer into an invocation. A normal return from the transfer
 * port accepts ownership; a synchronous throw leaves cleanup here.
 * @param {unknown} value - Exact V61 claimed-source bundle.
 * @returns {{owner: object, close: Function}} - Retained fallback cleanup.
 */
function captureClaimedSourceClose(value) {
  const source = captureInvocationProperty(value, 'source', INVALID_STAGE);
  if (source === null || typeof source !== 'object') {
    throw new TypeError(INVALID_STAGE);
  }
  const close = captureInvocationProperty(source, 'close', INVALID_STAGE);
  if (typeof close !== 'function') throw new TypeError(INVALID_STAGE);
  return { owner: source, close };
}

/**
 * @param {unknown} left - First canonical JSON value.
 * @param {unknown} right - Second canonical JSON value.
 * @returns {boolean} - Whether their exact JSON encodings match.
 */
function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Validate that the controller planned the exact admitted apply authority.
 * @param {unknown} value - Candidate controller plan.
 * @param {Readonly<Record<string, any>>} deploymentRevision - Bound revision.
 * @param {Readonly<Record<string, any>>} profile - Admitted profile.
 * @param {Readonly<Record<string, any>>} providerScope - Invocation scope.
 * @returns {Readonly<Record<string, any>>} - Canonical exact plan.
 */
function validateApplyPlan(value, deploymentRevision, profile, providerScope) {
  const plan = validateDeploymentPlanContext(value, Object.freeze({ profile }));
  if (
    plan.operation !== 'apply' ||
    !sameJson(plan.deploymentRevision, deploymentRevision) ||
    !sameJson(plan.providerScope, providerScope)
  ) {
    throw new Error(INVALID_PLAN);
  }
  return plan;
}

/**
 * Validate and detach the durable result before exposing it as a plan result.
 * @param {unknown} value - Candidate stage bundle.
 * @param {Readonly<Record<string, any>>} deploymentRevision - Bound revision.
 * @param {Readonly<Record<string, any>>} profile - Admitted profile.
 * @param {Readonly<Record<string, any>>} providerScope - Exact plan scope.
 * @returns {Readonly<{intent: Readonly<Record<string, any>>, receipt: Readonly<Record<string, any>>}>} - Canonical stage.
 */
function validateArtifactStage(
  value,
  deploymentRevision,
  profile,
  providerScope,
) {
  const stage = snapshotExactObject(value, STAGE_KEYS, INVALID_STAGE);
  const intent = validateDeploymentArtifactStageIntentContext(
    stage.intent,
    Object.freeze({ deploymentRevision, profile, providerScope }),
    'awsSourceDeployment artifactStage.intent',
  );
  const receipt = validateDeploymentArtifactStageReceiptContext(
    stage.receipt,
    Object.freeze({ intent }),
    'awsSourceDeployment artifactStage.receipt',
  );
  return Object.freeze({ intent, receipt });
}

/**
 * Throw one primary result with every later cleanup failure in occurrence
 * order. Boolean state, rather than truthiness, preserves thrown undefined,
 * null, and other non-Error values.
 * @param {boolean} operationFailed - Whether a primary value was thrown.
 * @param {unknown} operationError - Exact primary thrown value.
 * @param {unknown[]} cleanupErrors - Ordered cleanup thrown values.
 * @returns {void}
 */
function throwFailures(operationFailed, operationError, cleanupErrors) {
  if (operationFailed) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [operationError, ...cleanupErrors],
        OPERATION_AND_CLEANUP_FAILED,
      );
    }
    throw operationError;
  }
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, CLEANUP_FAILED);
  }
}

/**
 * Run after the package request has already been synchronously admitted by
 * the selected-SEA boundary.
 * @param {unknown} packaging - In-flight authority mint.
 * @param {Readonly<Record<string, any>>} request - Admitted request.
 * @param {boolean} shouldApply - Whether to converge the prepared result.
 * @returns {Promise<any>} - Prepared bundle or convergence result.
 */
async function runPackagedDeployment(packaging, request, shouldApply) {
  /** @type {unknown} */
  let authority;
  let authorityOwned = false;
  /** @type {object|undefined} */
  let invocationOwner;
  /** @type {Function|undefined} */
  let invocationClose;
  /** @type {object|undefined} */
  let claimedSourceOwner;
  /** @type {Function|undefined} */
  let claimedSourceClose;
  let claimedSourceOwned = false;
  /** @type {unknown} */
  let operationError;
  let operationFailed = false;
  /** @type {unknown} */
  let result;

  try {
    authority = await packaging;
    authorityOwned = true;
    const deploymentRevision = createSelectedSeaDeploymentRevision(
      authority,
      Object.freeze({
        deployment: request.deployment,
        profile: request.profile,
      }),
    );

    const opening = openAwsSingleNodeDeploymentInvocation(
      Object.freeze({ region: request.profile.provider.scope.region }),
    );
    invocationOwner = await opening;
    invocationClose = captureInvocationClose(invocationOwner);
    const invocation = captureInvocation(invocationOwner);

    await Reflect.apply(
      invocation.methods[request.controlMethod],
      invocation.owner,
      [],
    );
    const proposedPlan = await Reflect.apply(
      invocation.methods.plan,
      invocation.owner,
      [
        Object.freeze({
          operation: 'apply',
          deploymentRevision,
          profile: request.profile,
        }),
      ],
    );
    const plan = validateApplyPlan(
      proposedPlan,
      deploymentRevision,
      request.profile,
      invocation.providerScope,
    );

    const claim = claimSelectedSeaArtifactSource(
      authority,
      Object.freeze({
        deploymentRevision,
        profile: request.profile,
        providerScope: plan.providerScope,
      }),
    );
    authorityOwned = false;
    const claimedSource = captureClaimedSourceClose(claim);
    claimedSourceOwner = claimedSource.owner;
    claimedSourceClose = claimedSource.close;
    claimedSourceOwned = true;
    // There must be no await between the atomic claim and entry into staging.
    const staging = Reflect.apply(
      invocation.methods.stageClaimedArtifact,
      invocation.owner,
      [claim],
    );
    claimedSourceOwned = false;
    const artifactStage = validateArtifactStage(
      await staging,
      deploymentRevision,
      request.profile,
      plan.providerScope,
    );
    const prepared = Object.freeze({
      plan,
      profile: request.profile,
      artifactStage,
    });
    result = shouldApply
      ? await Reflect.apply(
          invocation.methods.convergePreStaged,
          invocation.owner,
          [prepared],
        )
      : prepared;
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  /** @type {unknown[]} */
  const cleanupErrors = [];
  if (claimedSourceOwned && claimedSourceClose && claimedSourceOwner) {
    try {
      await Reflect.apply(claimedSourceClose, claimedSourceOwner, []);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (authorityOwned) {
    try {
      await discardSelectedSeaArtifact(authority);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (invocationClose && invocationOwner) {
    try {
      await Reflect.apply(invocationClose, invocationOwner, []);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  throwFailures(operationFailed, operationError, cleanupErrors);
  return result;
}

/**
 * Package, bind, plan, and durably stage one selected SEA before returning a
 * portable plan result. No local artifact authority escapes this call.
 * @param {unknown} value - Exact package, deployment, profile, and control.
 * @returns {Promise<Readonly<{plan: Readonly<Record<string, any>>, profile: Readonly<Record<string, any>>, artifactStage: Readonly<Record<string, any>>}>>} - Prepared result after cleanup.
 */
export function prepareAwsSelectedSeaPlan(value) {
  let request;
  try {
    request = admitRequest(value);
  } catch (error) {
    return Promise.reject(error);
  }

  let packaging;
  try {
    // This call is deliberately made before returning or awaiting so V61
    // snapshots the package request in the caller's current synchronous turn.
    packaging = packageSelectedSeaArtifact(request.packageRequest);
  } catch (error) {
    return Promise.reject(error);
  }
  return runPackagedDeployment(packaging, request, false);
}

/**
 * Prepare and directly converge one selected SEA using the same invocation,
 * plan, and exact durable stage. The artifact is never staged twice.
 * @param {unknown} value - Exact package, deployment, profile, and control.
 * @returns {Promise<any>} - Exact pre-staged convergence result after cleanup.
 */
export function applyAwsSelectedSea(value) {
  let request;
  try {
    request = admitRequest(value);
  } catch (error) {
    return Promise.reject(error);
  }

  let packaging;
  try {
    packaging = packageSelectedSeaArtifact(request.packageRequest);
  } catch (error) {
    return Promise.reject(error);
  }
  return runPackagedDeployment(packaging, request, true);
}

export default {
  applyAwsSelectedSea,
  prepareAwsSelectedSeaPlan,
};
