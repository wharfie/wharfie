/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description, jsdoc/tag-lines -- The controller uses intentionally broad provider and store ports. */

import {
  createDeploymentHead,
  validateDeploymentHead,
} from './deployment-head.js';
import { compareCanonicalStrings } from './canonical-order.js';
import { validateAwsSingleNodeProviderSpecContext } from './deployment-aws-provider-spec.js';
import {
  validateDeploymentArtifactStageIntentContext,
  validateDeploymentArtifactStageReceiptContext,
} from './deployment-artifact-stage.js';
import { validateDeploymentInspectionContext } from './deployment-inspection.js';
import {
  validateDeploymentPlan,
  validateDeploymentPlanContext,
} from './deployment-plan.js';
import {
  assertDeploymentInstanceId,
  getDeploymentInstanceId,
  validateProviderScope,
} from './deployment-provider-scope.js';
import {
  createDeploymentIncarnationId as createRandomDeploymentIncarnationId,
  assertDeploymentIncarnationId,
  createOwnershipNonce as createRandomOwnershipNonce,
  validateDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';
import { getAwsSingleNodeResourceDefinition } from './deployment-resource-graph.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateDeploymentRevision } from './deployment-revision.js';

const PLAN_REQUEST_KEYS = new Set([
  'operation',
  'deploymentRevision',
  'profile',
]);
const CONVERGE_REQUEST_KEYS = new Set(['plan', 'profile']);
const RESUME_REQUEST_KEYS = new Set(['deploymentInstanceId']);
const SETTLEMENT_KEYS = new Set(['status', 'binding']);
const STATUS_ONLY_SETTLEMENT_KEYS = new Set(['status']);
const ARTIFACT_STAGE_KEYS = new Set(['intent', 'receipt']);

/** A durable compare-and-set lost to a different controller transition. */
export class DeploymentControllerConflictError extends Error {
  /** @param {string} message @param {{cause?: unknown}} [options] */
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'DeploymentControllerConflictError';
    this.code = 'DEPLOYMENT_CONTROLLER_CONFLICT';
  }
}

/** A submitted plan no longer names the exact fresh provider observation. */
export class StaleDeploymentPlanError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'StaleDeploymentPlanError';
    this.code = 'STALE_DEPLOYMENT_PLAN';
  }
}

/** Provider evidence cannot yet prove an action settled. */
export class AmbiguousDeploymentActionError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'AmbiguousDeploymentActionError';
    this.code = 'AMBIGUOUS_DEPLOYMENT_ACTION';
  }
}

/** Durable ownership evidence is missing or does not identify the plan target. */
export class DeploymentOwnershipError extends Error {
  /** @param {string} message @param {{cause?: unknown}} [options] */
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'DeploymentOwnershipError';
    this.code = 'DEPLOYMENT_OWNERSHIP_CONFLICT';
  }
}

/** @param {unknown} value @param {Set<string>} keys @param {string} path @returns {Record<string, any>} */
function exactObject(value, keys, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const object = /** @type {Record<string, any>} */ (value);
  for (const key of Object.keys(object)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
  return object;
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Fence the generic durable binding schema to the finite AWS single-node
 * physical-resource contract before a controller trusts the head as mutation
 * authority. A partial graph is valid while reconcile recreates an
 * authoritatively absent resource, but every binding that does exist must be
 * one exact graph role with its complete dependency-key lineage.
 * @param {Readonly<Record<string, any>>} head - Canonical durable head.
 * @returns {void}
 */
function assertAwsSingleNodeHeadResourceGraph(head) {
  for (const binding of head.resourceBindings) {
    const resource = getAwsSingleNodeResourceDefinition(binding.resourceKey);
    const dependencyKeys = binding.dependencyBindings.map(
      (/** @type {Readonly<Record<string, any>>} */ dependency) =>
        dependency.resourceKey,
    );
    const expectedDependencyKeys =
      resource === null
        ? []
        : [...resource.dependsOn].sort(compareCanonicalStrings);
    if (
      resource === null ||
      binding.resourceKey !== resource.resourceKey ||
      !sameJson(binding.role, resource.role) ||
      !sameJson(binding.capability, resource.capability) ||
      binding.providerType !== resource.providerType ||
      binding.ownershipMode !== resource.ownershipMode ||
      binding.onDestroy !== resource.onDestroy ||
      !sameJson(dependencyKeys, expectedDependencyKeys)
    ) {
      throw new DeploymentOwnershipError(
        `Durable binding '${binding.resourceKey}' does not match the exact AWS single-node resource graph.`,
      );
    }
  }
}

/** @param {Record<string, any>} value @returns {Record<string, any>} */
function withoutDerivedOperationId(value) {
  return {
    kind: value.kind,
    planId: value.planId,
    status: value.status,
    nextActionIndex: value.nextActionIndex,
    intents: value.intents,
  };
}

/** @param {Record<string, any>} head @param {Record<string, any>} changes @returns {Readonly<Record<string, any>>} */
function nextHead(head, changes) {
  return createDeploymentHead({
    deploymentInstanceId: head.deploymentInstanceId,
    providerScope: head.providerScope,
    incarnationId: head.incarnationId,
    generation: head.generation + 1,
    phase: head.phase,
    settledDeploymentRevisionId: head.settledDeploymentRevisionId,
    targetDeploymentRevisionId: head.targetDeploymentRevisionId,
    resourceBindings: head.resourceBindings,
    activeOperation:
      head.activeOperation === null
        ? null
        : withoutDerivedOperationId(head.activeOperation),
    lastOperation: head.lastOperation,
    ...changes,
  });
}

/**
 * Create the crash-resumable, provider-neutral deployment controller.
 * Provider calls receive immutable validated documents plus the current head;
 * credentials remain private to the provider implementation.
 *
 * @param {{store: Record<string, Function>, provider: Record<string, Function>, artifactStager: Record<string, Function>, now: () => number, createOwnershipNonce?: () => string|Promise<string>, createDeploymentIncarnationId?: () => string|Promise<string>}} dependencies - Bounded controller ports and explicit inspection clock.
 * @returns {Readonly<{plan: (input: unknown) => Promise<Readonly<Record<string, any>>>, converge: (input: unknown) => Promise<Readonly<Record<string, any>>>, resume: (input: unknown) => Promise<Readonly<Record<string, any>>>}>} - Controller API.
 */
export function createDeploymentController(dependencies) {
  if (
    dependencies === null ||
    typeof dependencies !== 'object' ||
    Array.isArray(dependencies)
  ) {
    throw new TypeError('deploymentController dependencies must be an object.');
  }
  const { store, provider, artifactStager, now } = dependencies;
  const nonceFactory =
    dependencies.createOwnershipNonce || createRandomOwnershipNonce;
  const incarnationFactory =
    dependencies.createDeploymentIncarnationId ||
    createRandomDeploymentIncarnationId;
  /** @type {[string, Record<string, Function>, string[]][]} */
  const ports = [
    [
      'deploymentController.store',
      store,
      [
        'readHead',
        'compareAndSetHead',
        'putPlanIfAbsent',
        'readPlan',
        'putProfileIfAbsent',
        'readProfile',
      ],
    ],
    [
      'deploymentController.provider',
      provider,
      [
        'resolveScope',
        'resolveProviderSpec',
        'validateProviderSpec',
        'inspect',
        'createPlan',
        'executeAction',
        'verifySettlement',
      ],
    ],
    [
      'deploymentController.artifactStager',
      artifactStager,
      ['stageRunningArtifact', 'validateStagedArtifact'],
    ],
  ];
  for (const [path, owner, methods] of ports) {
    if (owner === null || typeof owner !== 'object') {
      throw new TypeError(`${path} must be an object.`);
    }
    for (const method of methods) {
      if (typeof owner[method] !== 'function') {
        throw new TypeError(`${path}.${method} must be a function.`);
      }
    }
  }
  if (typeof nonceFactory !== 'function') {
    throw new TypeError(
      'deploymentController.createOwnershipNonce must be a function.',
    );
  }
  if (typeof incarnationFactory !== 'function') {
    throw new TypeError(
      'deploymentController.createDeploymentIncarnationId must be a function.',
    );
  }
  if (typeof now !== 'function') {
    throw new TypeError('deploymentController.now must be a function.');
  }

  /** @returns {number} */
  function sampleInspectionNow() {
    const sampledNow = now();
    if (!Number.isSafeInteger(sampledNow) || sampledNow < 0) {
      throw new TypeError(
        'deploymentController.now must return nonnegative epoch milliseconds.',
      );
    }
    return sampledNow;
  }

  /** @param {string} deploymentInstanceId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readHead(deploymentInstanceId) {
    const value = await store.readHead(deploymentInstanceId);
    if (value === null) return null;
    const head = validateDeploymentHead(value, 'deploymentController head');
    if (head.deploymentInstanceId !== deploymentInstanceId) {
      throw new Error(
        'deploymentController store returned a head for another deployment instance.',
      );
    }
    assertAwsSingleNodeHeadResourceGraph(head);
    return head;
  }

  /**
   * Perform a durable transition. Ambiguous writes are read back. An exact
   * already-written successor is safe to accept; every other successor is a
   * typed conflict.
   * @param {Readonly<Record<string, any>>|null} expectedHead - Observed predecessor.
   * @param {Readonly<Record<string, any>>} successor - Exact successor.
   * @returns {Promise<{head: Readonly<Record<string, any>>, applied: boolean}>} - Transition result.
   */
  async function compareAndSet(expectedHead, successor) {
    /** @type {unknown} */
    let result;
    /** @type {unknown} */
    let writeError;
    try {
      result = await store.compareAndSetHead({
        expectedHeadId: expectedHead?.headId || null,
        nextHead: successor,
      });
    } catch (error) {
      writeError = error;
    }
    if (writeError === undefined && result !== true && result !== false) {
      throw new TypeError(
        'deploymentController.store.compareAndSetHead must return a boolean.',
      );
    }
    if (result === true) return { head: successor, applied: true };

    const observed = await readHead(successor.deploymentInstanceId);
    if (observed !== null && observed.headId === successor.headId) {
      return { head: observed, applied: false };
    }
    throw new DeploymentControllerConflictError(
      'Deployment head changed to a different operation or progress frontier.',
      writeError === undefined ? {} : { cause: writeError },
    );
  }

  /** @param {Record<string, any>} request @param {Readonly<Record<string, any>>|null} head @returns {void} */
  function assertLifecycleRequest(request, head) {
    if (head === null) {
      if (request.operation !== 'apply') {
        throw new Error('Only apply can begin an absent deployment.');
      }
      return;
    }
    if (head.activeOperation !== null) {
      throw new DeploymentControllerConflictError(
        'A deployment operation is already active.',
      );
    }
    if (!sameJson(head.providerScope, request.providerScope)) {
      throw new DeploymentOwnershipError(
        'The durable head belongs to another provider scope.',
      );
    }
    if (head.phase === 'DESTROYED') {
      if (
        request.operation !== 'apply' ||
        request.incarnationId === head.incarnationId
      ) {
        throw new Error(
          'A destroyed deployment can only be applied with a fresh incarnation.',
        );
      }
      if (head.resourceBindings.length > 0) {
        throw new DeploymentOwnershipError(
          'Reapply after destroy is refused while retained resource bindings exist; explicit retained-state adoption is not supported.',
        );
      }
      return;
    }
    if (head.phase !== 'READY') {
      throw new DeploymentControllerConflictError(
        `Cannot plan from deployment phase '${head.phase}'.`,
      );
    }
    if (request.incarnationId !== head.incarnationId) {
      throw new DeploymentOwnershipError(
        'The requested incarnation does not match the durable head.',
      );
    }
    if (
      request.operation === 'destroy' &&
      request.deploymentRevision.deploymentRevisionId !==
        head.settledDeploymentRevisionId
    ) {
      throw new Error(
        'Destroy must name the exact settled deployment revision.',
      );
    }
    if (
      request.operation === 'reconcile' &&
      request.deploymentRevision.deploymentRevisionId !==
        head.settledDeploymentRevisionId
    ) {
      throw new Error(
        'Reconcile must name the exact settled deployment revision.',
      );
    }
  }

  /** @param {unknown} value @param {string} path @returns {Record<string, any>} */
  function validatePlanRequest(value, path) {
    const input = exactObject(value, PLAN_REQUEST_KEYS, path);
    if (!['apply', 'reconcile', 'destroy'].includes(input.operation)) {
      throw new TypeError(`${path}.operation is not supported.`);
    }
    const deploymentRevision = validateDeploymentRevision(
      input.deploymentRevision,
      `${path}.deploymentRevision`,
    );
    const profile = validateDeploymentProfile(input.profile, `${path}.profile`);
    return {
      operation: input.operation,
      deploymentRevision,
      profile,
    };
  }

  /** @param {Record<string, any>} request @returns {Promise<Readonly<Record<string, any>>>} */
  async function resolveScope(request) {
    const providerScope = validateProviderScope(
      await provider.resolveScope(
        Object.freeze({
          operation: request.operation,
          deploymentRevision: request.deploymentRevision,
          profile: request.profile,
        }),
      ),
      'deploymentController resolved provider scope',
    );
    if (
      providerScope.provider !== request.profile.provider.kind ||
      providerScope.region !== request.profile.provider.scope.region
    ) {
      throw new DeploymentOwnershipError(
        'Resolved provider scope does not match the exact deployment profile.',
      );
    }
    return providerScope;
  }

  /** @param {Record<string, any>} request @param {Readonly<Record<string, any>>} expected @returns {Promise<void>} */
  async function assertFreshProviderScope(request, expected) {
    const resolved = await resolveScope(request);
    if (!sameJson(resolved, expected)) {
      throw new DeploymentOwnershipError(
        'Ambient provider credentials resolved to a different provider scope.',
      );
    }
  }

  /** @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} profile @returns {Promise<void>} */
  async function assertPlanProviderScope(plan, profile) {
    validateAwsSingleNodeProviderSpecContext(plan.providerSpec, {
      profile,
      providerScope: plan.providerScope,
    });
    await assertFreshProviderScope(
      {
        operation: plan.operation,
        deploymentRevision: plan.deploymentRevision,
        profile,
      },
      plan.providerScope,
    );
  }

  /**
   * Resolve mutable provider prerequisites only for a new incarnation. A
   * resident deployment keeps using the exact provider specification stored
   * by its last settled plan, including for update, reconcile, and destroy.
   * @param {Record<string, any>} request - Exact desired deployment tuple.
   * @param {Readonly<Record<string, any>>|null} head - Durable predecessor.
   * @returns {Promise<Readonly<Record<string, any>>>} - Pinned provider spec.
   */
  async function selectProviderSpec(request, head) {
    if (head !== null && head.phase === 'READY') {
      const priorValue = await store.readPlan(head.lastOperation.planId);
      if (priorValue === null) {
        throw new Error(
          'The last settled deployment plan is missing from durable storage.',
        );
      }
      const priorPlan = validateDeploymentPlan(
        priorValue,
        'last settled deployment plan',
      );
      const expectedOperationKind =
        priorPlan.operation === 'destroy'
          ? 'destroy'
          : priorPlan.basis.settledDeploymentRevisionId === null
            ? 'create'
            : priorPlan.basis.settledDeploymentRevisionId ===
                priorPlan.deploymentRevision.deploymentRevisionId
              ? 'reconcile'
              : 'update';
      const operationMatchesBasis =
        priorPlan.operation === 'destroy'
          ? expectedOperationKind === 'destroy'
          : priorPlan.operation === 'reconcile'
            ? expectedOperationKind === 'reconcile'
            : expectedOperationKind !== 'destroy';
      if (
        priorPlan.planId !== head.lastOperation.planId ||
        !operationMatchesBasis ||
        head.lastOperation.kind !== expectedOperationKind ||
        priorPlan.deploymentInstanceId !== head.deploymentInstanceId ||
        priorPlan.incarnationId !== head.incarnationId ||
        priorPlan.deploymentRevision.deploymentRevisionId !==
          head.settledDeploymentRevisionId ||
        !sameJson(priorPlan.providerScope, head.providerScope) ||
        priorPlan.basis.headGeneration >= head.generation ||
        head.lastOperation.intents.length !== priorPlan.actions.length ||
        head.lastOperation.intents.some(
          (
            /** @type {Readonly<Record<string, any>>} */ intent,
            /** @type {number} */ index,
          ) => intent.actionId !== priorPlan.actions[index].actionId,
        )
      ) {
        throw new DeploymentControllerConflictError(
          'The last settled plan does not match the exact durable deployment head.',
        );
      }
      try {
        return validateAwsSingleNodeProviderSpecContext(
          priorPlan.providerSpec,
          {
            profile: request.profile,
            providerScope: request.providerScope,
          },
        );
      } catch (error) {
        throw new DeploymentOwnershipError(
          'Changing the provider profile or target within a deployment incarnation is not supported; destroy and apply a fresh incarnation.',
          { cause: error },
        );
      }
    }

    return validateAwsSingleNodeProviderSpecContext(
      await provider.resolveProviderSpec(
        Object.freeze({
          operation: request.operation,
          deploymentRevision: request.deploymentRevision,
          providerScope: request.providerScope,
          deploymentInstanceId: request.deploymentInstanceId,
          incarnationId: request.incarnationId,
          profile: request.profile,
          head,
        }),
      ),
      { profile: request.profile, providerScope: request.providerScope },
    );
  }

  /**
   * Ask the provider driver to validate an exact pinned specification without
   * selecting newer prerequisites. The returned evidence must reproduce the
   * complete submitted document exactly.
   * @param {Record<string, any>} request - Exact desired deployment tuple.
   * @param {Readonly<Record<string, any>>|null} head - Durable predecessor.
   * @returns {Promise<void>} - Returns after exact provider validation.
   */
  async function assertProviderSpecValid(request, head) {
    const validated = validateAwsSingleNodeProviderSpecContext(
      await provider.validateProviderSpec(providerContext(request, head)),
      {
        profile: request.profile,
        providerScope: request.providerScope,
      },
    );
    if (!sameJson(validated, request.providerSpec)) {
      throw new StaleDeploymentPlanError(
        'Provider validation did not reproduce the exact pinned provider specification.',
      );
    }
  }

  /** @param {Record<string, any>} request @param {Readonly<Record<string, any>>|null} head @returns {Record<string, any>} */
  function providerContext(request, head) {
    return Object.freeze({
      operation: request.operation,
      deploymentRevision: request.deploymentRevision,
      providerScope: request.providerScope,
      deploymentInstanceId: request.deploymentInstanceId,
      incarnationId: request.incarnationId,
      profile: request.profile,
      providerSpec: request.providerSpec,
      head,
    });
  }

  /**
   * Independently validate the stager's exact intent/receipt bundle against
   * the immutable plan authority. The controller never trusts the stager to
   * perform these cross-document checks on its behalf.
   * @param {unknown} value - Candidate stage bundle.
   * @param {Readonly<Record<string, any>>} plan - Exact accepted plan.
   * @param {Readonly<Record<string, any>>} profile - Exact plan profile.
   * @param {string} path - Human-readable boundary path.
   * @returns {Readonly<{intent: Readonly<Record<string, any>>, receipt: Readonly<Record<string, any>>}>} - Canonical stage evidence.
   */
  function validateArtifactStage(value, plan, profile, path) {
    const bundle = exactObject(value, ARTIFACT_STAGE_KEYS, path);
    const intent = validateDeploymentArtifactStageIntentContext(
      bundle.intent,
      {
        deploymentRevision: plan.deploymentRevision,
        profile,
        providerScope: plan.providerScope,
      },
      `${path}.intent`,
    );
    const receipt = validateDeploymentArtifactStageReceiptContext(
      bundle.receipt,
      { intent },
      `${path}.receipt`,
    );
    return Object.freeze({ intent, receipt });
  }

  /** @param {'stageRunningArtifact'|'validateStagedArtifact'} method @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} profile @returns {Promise<Readonly<{intent: Readonly<Record<string, any>>, receipt: Readonly<Record<string, any>>}>|null>} */
  async function resolveArtifactStage(method, plan, profile) {
    if (plan.operation === 'destroy') return null;
    return validateArtifactStage(
      await artifactStager[method](
        Object.freeze({
          deploymentRevision: plan.deploymentRevision,
          profile,
          providerScope: plan.providerScope,
        }),
      ),
      plan,
      profile,
      `deploymentController.artifactStager.${method} result`,
    );
  }

  /** @param {Readonly<Record<string, any>>} inspection @param {Record<string, any>} request @param {Readonly<Record<string, any>>|null} head @returns {void} */
  function assertInspectionAuthority(inspection, request, head) {
    const expectedIncarnation = head?.incarnationId || null;
    if (
      !sameJson(inspection.deploymentRevision, request.deploymentRevision) ||
      !sameJson(inspection.providerScope, request.providerScope) ||
      inspection.providerSpecId !== request.providerSpec.providerSpecId ||
      inspection.deploymentInstanceId !== request.deploymentInstanceId ||
      inspection.incarnationId !== expectedIncarnation ||
      inspection.headGeneration !== (head?.generation || 0)
    ) {
      throw new StaleDeploymentPlanError(
        'Provider inspection does not match the exact desired tuple and durable head.',
      );
    }
    if (head === null && inspection.status !== 'absent') {
      throw new StaleDeploymentPlanError(
        'An absent durable head requires absent provider evidence.',
      );
    }
    if (head?.phase === 'DESTROYED' && inspection.status !== 'destroyed') {
      throw new StaleDeploymentPlanError(
        'A destroyed durable head requires destroyed provider evidence.',
      );
    }
    if (inspection.status === 'unknown' || inspection.status === 'conflict') {
      throw new DeploymentOwnershipError(
        `Provider inspection status '${inspection.status}' cannot authorize mutation.`,
      );
    }
  }

  /** @param {Readonly<Record<string, any>>} plan @param {Record<string, any>} request @param {Readonly<Record<string, any>>} inspection @param {Readonly<Record<string, any>>|null} head @returns {void} */
  function assertPlanAuthority(plan, request, inspection, head) {
    if (
      plan.operation !== request.operation ||
      !sameJson(plan.deploymentRevision, request.deploymentRevision) ||
      !sameJson(plan.providerScope, request.providerScope) ||
      !sameJson(plan.providerSpec, request.providerSpec) ||
      plan.deploymentInstanceId !== request.deploymentInstanceId ||
      plan.incarnationId !== request.incarnationId ||
      plan.basis.headGeneration !== (head?.generation || 0) ||
      plan.basis.settledDeploymentRevisionId !==
        (head?.settledDeploymentRevisionId || null) ||
      plan.basis.inspectionId !== inspection.inspectionId
    ) {
      throw new StaleDeploymentPlanError(
        'Provider plan does not bind the exact fresh inspection and durable head.',
      );
    }
  }

  /**
   * Correlate every action with fresh provider evidence. The provider driver
   * chooses the action, but cannot turn a durable binding alone into mutation
   * authority when current ownership or physical identity is unverified.
   * @param {Readonly<Record<string, any>>} plan - Fresh provider plan.
   * @param {Readonly<Record<string, any>>} inspection - Fresh provider evidence.
   * @param {Readonly<Record<string, any>>|null} head - Exact durable predecessor.
   * @returns {void}
   */
  function assertPlanInspectionEvidence(plan, inspection, head) {
    const resources = new Map(
      inspection.resources.map(
        (/** @type {Readonly<Record<string, any>>} */ resource) => [
          resource.resourceKey,
          resource,
        ],
      ),
    );
    const bindings = new Map(
      (head?.resourceBindings || []).map(
        (/** @type {Readonly<Record<string, any>>} */ binding) => [
          binding.resourceKey,
          binding,
        ],
      ),
    );
    for (const action of plan.actions) {
      const resource = resources.get(action.resourceKey);
      const binding = bindings.get(action.resourceKey);
      if (resource !== undefined) {
        assertResourceMatchesAction(action, resource);
      }
      if (action.action === 'create') {
        if (
          binding !== undefined ||
          (resource !== undefined &&
            (resource.presence !== 'absent' ||
              resource.presenceEvidence !== 'authoritative-not-found'))
        ) {
          throw new DeploymentOwnershipError(
            `Create for '${action.resourceKey}' conflicts with existing provider evidence.`,
          );
        }
        continue;
      }
      if (head === null || binding === undefined || resource === undefined) {
        throw new DeploymentOwnershipError(
          `Action '${action.resourceKey}' lacks exact durable and provider evidence.`,
        );
      }
      assertBindingMatchesAction(action, binding, head);
      if (action.action === 'delete' && resource.presence === 'absent') {
        if (resource.presenceEvidence !== 'authoritative-not-found') {
          throw new DeploymentOwnershipError(
            `Delete for '${action.resourceKey}' lacks authoritative absence evidence.`,
          );
        }
        continue;
      }
      if (
        resource.presence !== 'present' ||
        resource.ownership !==
          (binding.management === 'managed' ? 'verified' : 'external') ||
        resource.providerIdentity === null ||
        resource.providerIdentity.providerType !== binding.providerType ||
        resource.providerIdentity.providerResourceId !==
          binding.providerResourceId ||
        resource.bindingId !== binding.bindingId ||
        !sameJson(resource.dependencyBindings, binding.dependencyBindings) ||
        resource.observedDigest === null ||
        !sameJson(resource.observedDigest, action.before.stateDigest)
      ) {
        throw new DeploymentOwnershipError(
          `Action '${action.resourceKey}' is not authorized by exact fresh provider ownership and state evidence.`,
        );
      }
    }
  }

  /** @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} profile @param {Readonly<Record<string, any>>} head @param {Readonly<Record<string, any>>|undefined} [pendingBinding] @returns {Promise<Readonly<Record<string, any>>>} */
  async function inspectCurrentOperation(
    plan,
    profile,
    head,
    pendingBinding = undefined,
  ) {
    await assertPlanProviderScope(plan, profile);
    const request = {
      operation: plan.operation,
      deploymentRevision: plan.deploymentRevision,
      providerScope: plan.providerScope,
      deploymentInstanceId: plan.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      profile,
      providerSpec: plan.providerSpec,
    };
    const observed = await provider.inspect(
      Object.freeze({ ...providerContext(request, head), plan }),
    );
    const inspection = validateDeploymentInspectionContext(observed, {
      profile,
      providerSpec: plan.providerSpec,
      head,
      pendingBinding,
      now: sampleInspectionNow(),
    });
    assertInspectionAuthority(inspection, request, head);
    return inspection;
  }

  /** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} inspection @param {Readonly<Record<string, any>>} head @param {Readonly<Record<string, any>>} plan @returns {boolean} */
  function assertActionExecutionEvidence(action, inspection, head, plan) {
    const resource = inspection.resources.find(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.resourceKey === action.resourceKey,
    );
    const binding = head.resourceBindings.find(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.resourceKey === action.resourceKey,
    );
    if (resource !== undefined) {
      assertResourceMatchesAction(action, resource);
    }
    if (action.action === 'create') {
      if (
        binding !== undefined ||
        resource === undefined ||
        resource.presence !== 'absent' ||
        resource.presenceEvidence !== 'authoritative-not-found' ||
        resource.desiredDigest === null ||
        !sameJson(resource.desiredDigest, action.after.stateDigest)
      ) {
        throw new DeploymentOwnershipError(
          `Create for '${action.resourceKey}' lacks fresh authoritative absence and desired-state evidence.`,
        );
      }
      assertCreateDependencyEvidence(action, inspection, head, plan);
      return true;
    }
    assertBindingMatchesAction(action, binding, head);
    if (plan.operation === 'destroy') {
      assertPriorDeleteAbsenceEvidence(action, inspection, head, plan);
    }
    if (
      action.action === 'delete' &&
      resource !== undefined &&
      resource.presence === 'absent' &&
      resource.presenceEvidence === 'authoritative-not-found'
    ) {
      return false;
    }
    if (
      resource === undefined ||
      resource.presence !== 'present' ||
      resource.ownership !==
        (binding.management === 'managed' ? 'verified' : 'external') ||
      resource.providerIdentity === null ||
      resource.providerIdentity.providerType !== binding.providerType ||
      resource.providerIdentity.providerResourceId !==
        binding.providerResourceId ||
      resource.bindingId !== binding.bindingId ||
      !sameJson(resource.dependencyBindings, binding.dependencyBindings) ||
      resource.observedDigest === null ||
      !sameJson(resource.observedDigest, action.before.stateDigest)
    ) {
      throw new DeploymentOwnershipError(
        `Action '${action.resourceKey}' lacks fresh exact provider ownership and state evidence.`,
      );
    }
    return true;
  }

  /** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} inspection @param {Readonly<Record<string, any>>|null} binding @param {Readonly<Record<string, any>>} head @param {Readonly<Record<string, any>>} plan @returns {void} */
  function assertActionSettlementEvidence(
    action,
    inspection,
    binding,
    head,
    plan,
  ) {
    const resource = inspection.resources.find(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.resourceKey === action.resourceKey,
    );
    if (resource !== undefined) {
      assertResourceMatchesAction(action, resource);
    }
    if (plan.operation === 'destroy') {
      assertPriorDeleteAbsenceEvidence(action, inspection, head, plan);
    }
    if (action.after === null) {
      if (
        binding !== null ||
        resource === undefined ||
        resource.presence !== 'absent' ||
        resource.presenceEvidence !== 'authoritative-not-found'
      ) {
        throw new DeploymentOwnershipError(
          `Settlement for '${action.resourceKey}' lacks fresh authoritative absence evidence.`,
        );
      }
      return;
    }
    if (
      binding === null ||
      resource === undefined ||
      resource.presence !== 'present' ||
      resource.ownership !==
        (binding.management === 'managed' ? 'verified' : 'external') ||
      resource.providerIdentity === null ||
      resource.providerIdentity.providerType !== binding.providerType ||
      resource.providerIdentity.providerResourceId !==
        binding.providerResourceId ||
      resource.bindingId !== binding.bindingId ||
      !sameJson(resource.dependencyBindings, binding.dependencyBindings) ||
      resource.desiredDigest === null ||
      resource.observedDigest === null ||
      !sameJson(resource.desiredDigest, action.after.stateDigest) ||
      !sameJson(resource.observedDigest, action.after.stateDigest)
    ) {
      throw new DeploymentOwnershipError(
        `Settlement for '${action.resourceKey}' lacks fresh exact ownership and desired-state evidence.`,
      );
    }
    if (action.action === 'create') {
      assertCreateDependencyEvidence(action, inspection, head, plan);
    }
  }

  /** @param {Record<string, any>} request @param {Readonly<Record<string, any>>|null} head @returns {Promise<Readonly<Record<string, any>>>} */
  async function createFreshPlan(request, head) {
    await assertFreshProviderScope(request, request.providerScope);
    validateAwsSingleNodeProviderSpecContext(request.providerSpec, {
      profile: request.profile,
      providerScope: request.providerScope,
    });
    const context = providerContext(request, head);
    const observed = await provider.inspect(context);
    const inspection = validateDeploymentInspectionContext(observed, {
      profile: request.profile,
      providerSpec: request.providerSpec,
      head,
      now: sampleInspectionNow(),
    });
    assertInspectionAuthority(inspection, request, head);
    const plan = validateDeploymentPlanContext(
      await provider.createPlan(Object.freeze({ ...context, inspection })),
      { profile: request.profile },
    );
    assertPlanAuthority(plan, request, inspection, head);
    assertPlanInspectionEvidence(plan, inspection, head);
    return plan;
  }

  /** @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>|null} head @returns {'create'|'update'|'reconcile'|'destroy'} */
  function operationKind(plan, head) {
    if (plan.operation === 'destroy') return 'destroy';
    if (head === null || head.phase === 'DESTROYED') return 'create';
    return head.settledDeploymentRevisionId ===
      plan.deploymentRevision.deploymentRevisionId
      ? 'reconcile'
      : 'update';
  }

  /** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} resource @returns {void} */
  function assertResourceMatchesAction(action, resource) {
    if (
      resource.resourceKey !== action.resourceKey ||
      !sameJson(resource.capability, action.capability) ||
      !sameJson(resource.role, action.role) ||
      resource.management !== action.management ||
      resource.ownershipMode !== action.ownershipMode ||
      resource.onDestroy !== action.onDestroy ||
      !sameJson(resource.dependsOn, action.dependsOn)
    ) {
      throw new DeploymentOwnershipError(
        `Provider evidence for '${action.resourceKey}' does not match the exact action role.`,
      );
    }
  }

  /** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} head @returns {ReadonlyArray<{resourceKey: string, bindingId: string}>} */
  function expectedDependencyBindings(action, head) {
    return action.dependsOn
      .map((/** @type {string} */ resourceKey) => {
        const dependency = head.resourceBindings.find(
          (/** @type {Readonly<Record<string, any>>} */ binding) =>
            binding.resourceKey === resourceKey,
        );
        if (dependency === undefined) {
          throw new DeploymentOwnershipError(
            `Action '${action.resourceKey}' lacks dependency binding '${resourceKey}'.`,
          );
        }
        return { bindingId: dependency.bindingId, resourceKey };
      })
      .sort(
        (
          /** @type {{resourceKey: string}} */ left,
          /** @type {{resourceKey: string}} */ right,
        ) => compareCanonicalStrings(left.resourceKey, right.resourceKey),
      );
  }

  /**
   * A durable dependency binding proves lineage, not continued physical
   * existence. Before executing or publishing a dependent create, require the
   * same fresh inspection to prove every dependency still exists under its
   * exact current binding, action state, and fixed graph role.
   * @param {Readonly<Record<string, any>>} action - Dependent create action.
   * @param {Readonly<Record<string, any>>} inspection - Fresh provider evidence.
   * @param {Readonly<Record<string, any>>} head - Exact durable authority.
   * @param {Readonly<Record<string, any>>} plan - Exact action and state authority.
   * @returns {void}
   */
  function assertCreateDependencyEvidence(action, inspection, head, plan) {
    const expectedDependencies = expectedDependencyBindings(action, head);
    const actionIndex = plan.actions.findIndex(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.actionId === action.actionId,
    );
    for (const expectedDependency of expectedDependencies) {
      const definition = getAwsSingleNodeResourceDefinition(
        expectedDependency.resourceKey,
      );
      const dependencyActionIndex = plan.actions.findIndex(
        (/** @type {Readonly<Record<string, any>>} */ candidate) =>
          candidate.resourceKey === expectedDependency.resourceKey,
      );
      const dependencyAction = plan.actions[dependencyActionIndex];
      const dependencyIntent =
        head.activeOperation?.intents[dependencyActionIndex];
      const binding = head.resourceBindings.find(
        (/** @type {Readonly<Record<string, any>>} */ candidate) =>
          candidate.resourceKey === expectedDependency.resourceKey,
      );
      const resource = inspection.resources.find(
        (/** @type {Readonly<Record<string, any>>} */ candidate) =>
          candidate.resourceKey === expectedDependency.resourceKey,
      );
      if (
        definition === null ||
        actionIndex < 0 ||
        dependencyActionIndex < 0 ||
        dependencyActionIndex >= actionIndex ||
        dependencyAction === undefined ||
        dependencyAction.after === null ||
        dependencyIntent === undefined ||
        dependencyIntent.actionId !== dependencyAction.actionId ||
        dependencyIntent.status !== 'settled' ||
        dependencyAction.resourceKey !== definition.resourceKey ||
        !sameJson(dependencyAction.capability, definition.capability) ||
        !sameJson(dependencyAction.role, definition.role) ||
        dependencyAction.ownershipMode !== definition.ownershipMode ||
        dependencyAction.onDestroy !== definition.onDestroy ||
        !sameJson(dependencyAction.dependsOn, definition.dependsOn) ||
        dependencyAction.after.providerType !== definition.providerType ||
        binding === undefined ||
        binding.bindingId !== expectedDependency.bindingId ||
        binding.resourceKey !== definition.resourceKey ||
        !sameJson(binding.capability, definition.capability) ||
        !sameJson(binding.role, definition.role) ||
        binding.management !== dependencyAction.management ||
        binding.providerType !== definition.providerType ||
        binding.ownershipMode !== definition.ownershipMode ||
        binding.onDestroy !== definition.onDestroy ||
        dependencyIntent.ownershipNonce !==
          (binding.management === 'managed' ? binding.ownershipNonce : null) ||
        (dependencyAction.action === 'create' &&
          (binding.management !== 'managed' ||
            binding.createdByActionId !== dependencyAction.actionId)) ||
        (dependencyAction.after.providerResourceId !== null &&
          binding.providerResourceId !==
            dependencyAction.after.providerResourceId) ||
        resource === undefined ||
        resource.resourceKey !== definition.resourceKey ||
        !sameJson(resource.capability, definition.capability) ||
        !sameJson(resource.role, definition.role) ||
        resource.management !== dependencyAction.management ||
        resource.ownershipMode !== definition.ownershipMode ||
        resource.onDestroy !== definition.onDestroy ||
        !sameJson(resource.dependsOn, definition.dependsOn) ||
        resource.presence !== 'present' ||
        resource.presenceEvidence !== 'exact-read' ||
        resource.ownership !==
          (binding.management === 'managed' ? 'verified' : 'external') ||
        resource.bindingId !== binding.bindingId ||
        !sameJson(resource.dependencyBindings, binding.dependencyBindings) ||
        resource.providerIdentity === null ||
        resource.providerIdentity.providerType !== binding.providerType ||
        resource.providerIdentity.providerResourceId !==
          binding.providerResourceId ||
        resource.desiredDigest === null ||
        resource.observedDigest === null ||
        !sameJson(resource.desiredDigest, dependencyAction.after.stateDigest) ||
        !sameJson(resource.observedDigest, dependencyAction.after.stateDigest)
      ) {
        throw new DeploymentOwnershipError(
          `Create for '${action.resourceKey}' lacks fresh exact dependency evidence for '${expectedDependency.resourceKey}'.`,
        );
      }
    }
  }

  /**
   * Delete order is the reverse dependency order. Once an earlier purge has
   * settled, every later destroy step must freshly re-prove that the removed
   * resource remains authoritatively absent and unbound.
   * @param {Readonly<Record<string, any>>} action - Current destroy action.
   * @param {Readonly<Record<string, any>>} inspection - Fresh provider evidence.
   * @param {Readonly<Record<string, any>>} head - Exact durable authority.
   * @param {Readonly<Record<string, any>>} plan - Exact destroy plan authority.
   * @returns {void}
   */
  function assertPriorDeleteAbsenceEvidence(action, inspection, head, plan) {
    const actionIndex = plan.actions.findIndex(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.actionId === action.actionId,
    );
    if (actionIndex < 0) {
      throw new DeploymentOwnershipError(
        `Destroy action '${action.resourceKey}' is not present in its persisted plan.`,
      );
    }
    for (let index = 0; index < actionIndex; index += 1) {
      const priorAction = plan.actions[index];
      if (priorAction.after !== null) continue;
      const priorIntent = head.activeOperation?.intents[index];
      const priorBinding = head.resourceBindings.find(
        (/** @type {Readonly<Record<string, any>>} */ candidate) =>
          candidate.resourceKey === priorAction.resourceKey,
      );
      const priorResource = inspection.resources.find(
        (/** @type {Readonly<Record<string, any>>} */ candidate) =>
          candidate.resourceKey === priorAction.resourceKey,
      );
      if (priorResource !== undefined) {
        assertResourceMatchesAction(priorAction, priorResource);
      }
      if (
        priorIntent === undefined ||
        priorIntent.actionId !== priorAction.actionId ||
        priorIntent.status !== 'settled' ||
        priorBinding !== undefined ||
        priorResource === undefined ||
        priorResource.presence !== 'absent' ||
        priorResource.presenceEvidence !== 'authoritative-not-found'
      ) {
        throw new DeploymentOwnershipError(
          `Destroy action '${action.resourceKey}' cannot proceed because prior purge '${priorAction.resourceKey}' is not authoritatively absent and unbound.`,
        );
      }
    }
  }

  /** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>|undefined} binding @param {Readonly<Record<string, any>>|null} head @returns {void} */
  function assertBindingMatchesAction(action, binding, head) {
    if (!binding || head === null) {
      throw new DeploymentOwnershipError(
        `No durable binding exists for '${action.resourceKey}'.`,
      );
    }
    const state = action.action === 'create' ? action.after : action.before;
    if (
      binding.resourceKey !== action.resourceKey ||
      !sameJson(binding.capability, action.capability) ||
      !sameJson(binding.role, action.role) ||
      binding.management !== action.management ||
      binding.ownershipMode !==
        (action.management === 'external'
          ? 'external'
          : action.ownershipMode) ||
      binding.onDestroy !== action.onDestroy ||
      !sameJson(
        binding.dependencyBindings,
        expectedDependencyBindings(action, head),
      ) ||
      state === null ||
      binding.providerType !== state.providerType ||
      binding.providerResourceId !== state.providerResourceId
    ) {
      throw new DeploymentOwnershipError(
        `Durable binding for '${action.resourceKey}' does not match the exact plan target.`,
      );
    }
  }

  /** @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>|null} head @returns {Promise<Readonly<Record<string, any>>[]>} */
  async function createIntents(plan, head) {
    const bindings = new Map(
      (head?.resourceBindings || []).map(
        (/** @type {Readonly<Record<string, any>>} */ binding) => [
          binding.resourceKey,
          binding,
        ],
      ),
    );
    const seenNonces = new Set();
    /** @type {Record<string, any>[]} */
    const intents = [];
    for (const action of plan.actions) {
      const binding = bindings.get(action.resourceKey);
      /** @type {string|null} */
      let ownershipNonce = null;
      if (plan.operation === 'destroy') {
        assertBindingMatchesAction(action, binding, head);
      }
      if (action.management === 'managed') {
        if (action.action === 'create') {
          if (binding !== undefined) {
            throw new DeploymentOwnershipError(
              `Create refuses an existing binding for '${action.resourceKey}'.`,
            );
          }
          ownershipNonce = validateOwnershipNonce(
            await nonceFactory(),
            `ownership nonce for '${action.resourceKey}'`,
          );
        } else {
          assertBindingMatchesAction(action, binding, head);
          ownershipNonce = binding.ownershipNonce;
        }
        if (seenNonces.has(ownershipNonce)) {
          throw new DeploymentOwnershipError(
            'Managed actions must not share an ownership nonce.',
          );
        }
        seenNonces.add(ownershipNonce);
      }
      intents.push(
        Object.freeze({
          actionId: action.actionId,
          status: 'pending',
          ownershipNonce,
        }),
      );
    }
    return intents;
  }

  /** @param {Readonly<Record<string, any>>} plan @param {Record<string, any>} profile @returns {Promise<void>} */
  async function persistPlan(plan, profile) {
    await store.putProfileIfAbsent(profile);
    const storedProfileValue = await store.readProfile(
      profile.profileRevisionId,
    );
    if (storedProfileValue === null) {
      throw new Error('Deployment profile store did not retain the profile.');
    }
    const storedProfile = validateDeploymentProfile(
      storedProfileValue,
      'persisted deployment profile',
    );
    if (!sameJson(storedProfile, profile)) {
      throw new DeploymentControllerConflictError(
        'Profile identity resolved to different persisted content.',
      );
    }
    await store.putPlanIfAbsent(plan);
    const storedValue = await store.readPlan(plan.planId);
    if (storedValue === null) {
      throw new Error('Deployment plan store did not retain the plan.');
    }
    const stored = validateDeploymentPlanContext(storedValue, { profile });
    if (!sameJson(stored, plan)) {
      throw new DeploymentControllerConflictError(
        'Plan identity resolved to different persisted content.',
      );
    }
  }

  /** @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>|null} head @param {Readonly<Record<string, any>>[]} intents @returns {Readonly<Record<string, any>>} */
  function createInitialHead(plan, head, intents) {
    const kind = operationKind(plan, head);
    const startsNewIncarnation = head === null || head.phase === 'DESTROYED';
    return createDeploymentHead({
      deploymentInstanceId: plan.deploymentInstanceId,
      providerScope: plan.providerScope,
      incarnationId: plan.incarnationId,
      generation: (head?.generation || 0) + 1,
      phase: kind === 'destroy' ? 'DESTROYING' : 'CONVERGING',
      settledDeploymentRevisionId: startsNewIncarnation
        ? null
        : head.settledDeploymentRevisionId,
      targetDeploymentRevisionId:
        kind === 'destroy'
          ? null
          : plan.deploymentRevision.deploymentRevisionId,
      resourceBindings: startsNewIncarnation ? [] : head.resourceBindings,
      activeOperation: {
        kind,
        planId: plan.planId,
        status: 'running',
        nextActionIndex: 0,
        intents,
      },
      lastOperation: startsNewIncarnation ? null : head.lastOperation,
    });
  }

  /** @param {unknown} value @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} intent @param {Readonly<Record<string, any>>} head @returns {{status: 'converged', binding: Readonly<Record<string, any>>|null}|{status: 'not-converged'}|{status: 'blocked'}} */
  function validateSettlement(value, action, intent, head) {
    const settlementStatus =
      value !== null && typeof value === 'object'
        ? /** @type {Record<string, any>} */ (value).status
        : undefined;
    const candidate = exactObject(
      value,
      settlementStatus === 'converged'
        ? SETTLEMENT_KEYS
        : STATUS_ONLY_SETTLEMENT_KEYS,
      'provider settlement',
    );
    if (
      candidate.status === 'not-converged' ||
      candidate.status === 'blocked'
    ) {
      return { status: candidate.status };
    }
    if (candidate.status !== 'converged') {
      throw new TypeError('provider settlement.status is not supported.');
    }
    if (action.after === null) {
      if (candidate.binding !== null) {
        throw new DeploymentOwnershipError(
          `Settlement for '${action.resourceKey}' must prove absence.`,
        );
      }
      return { status: 'converged', binding: null };
    }
    if (candidate.binding === null) {
      throw new DeploymentOwnershipError(
        `Settlement for '${action.resourceKey}' must return an exact binding.`,
      );
    }
    const binding = validateDeploymentResourceBinding(
      candidate.binding,
      `settlement binding for '${action.resourceKey}'`,
    );
    if (
      binding.deploymentInstanceId !== head.deploymentInstanceId ||
      binding.incarnationId !== head.incarnationId ||
      binding.providerScopeId !== head.providerScope.providerScopeId ||
      binding.resourceKey !== action.resourceKey ||
      !sameJson(binding.capability, action.capability) ||
      !sameJson(binding.role, action.role) ||
      binding.management !== action.management ||
      binding.ownershipMode !==
        (action.management === 'external'
          ? 'external'
          : action.ownershipMode) ||
      binding.onDestroy !== action.onDestroy ||
      !sameJson(
        binding.dependencyBindings,
        expectedDependencyBindings(action, head),
      ) ||
      binding.providerType !== action.after.providerType ||
      (action.after.providerResourceId !== null &&
        binding.providerResourceId !== action.after.providerResourceId)
    ) {
      throw new DeploymentOwnershipError(
        `Settlement binding for '${action.resourceKey}' does not match the exact action.`,
      );
    }
    if (binding.management === 'managed') {
      if (binding.ownershipNonce !== intent.ownershipNonce) {
        throw new DeploymentOwnershipError(
          `Settlement binding for '${action.resourceKey}' has the wrong ownership nonce.`,
        );
      }
      const prior = head.resourceBindings.find(
        (/** @type {Readonly<Record<string, any>>} */ item) =>
          item.resourceKey === action.resourceKey,
      );
      if (
        action.action === 'create' &&
        binding.createdByActionId !== action.actionId
      ) {
        throw new DeploymentOwnershipError(
          `Created binding for '${action.resourceKey}' has the wrong action identity.`,
        );
      }
      if (
        action.action !== 'create' &&
        prior?.management === 'managed' &&
        (binding.providerResourceId !== prior.providerResourceId ||
          binding.createdByActionId !== prior.createdByActionId)
      ) {
        throw new DeploymentOwnershipError(
          `Settlement for '${action.resourceKey}' changed its immutable provider identity or creation receipt.`,
        );
      }
    }
    return { status: 'converged', binding };
  }

  /** @param {Readonly<Record<string, any>>} plan @param {Record<string, any>} profile @param {Readonly<Record<string, any>>} head @param {number} actionIndex @param {Readonly<Record<string, any>>|null} artifactStage @returns {Readonly<Record<string, any>>} */
  function actionContext(plan, profile, head, actionIndex, artifactStage) {
    return Object.freeze({
      operation: plan.operation,
      plan,
      action: plan.actions[actionIndex],
      actionIndex,
      ownershipNonce: head.activeOperation.intents[actionIndex].ownershipNonce,
      head,
      profile,
      artifactStage,
    });
  }

  /** @param {Readonly<Record<string, any>>} head @param {Readonly<Record<string, any>>} action @param {number} actionIndex @param {Readonly<Record<string, any>>|null} binding @returns {Readonly<Record<string, any>>} */
  function createActionSettledHead(head, action, actionIndex, binding) {
    const operation = head.activeOperation;
    const intents = operation.intents.map(
      (
        /** @type {Readonly<Record<string, any>>} */ intent,
        /** @type {number} */ index,
      ) => ({
        actionId: intent.actionId,
        status: index === actionIndex ? 'settled' : intent.status,
        ownershipNonce: intent.ownershipNonce,
      }),
    );
    const resourceBindings = head.resourceBindings.filter(
      (/** @type {Readonly<Record<string, any>>} */ item) =>
        item.resourceKey !== action.resourceKey,
    );
    if (binding !== null) resourceBindings.push(binding);
    return nextHead(head, {
      resourceBindings,
      activeOperation: {
        kind: operation.kind,
        planId: operation.planId,
        status: 'running',
        nextActionIndex: actionIndex + 1,
        intents,
      },
    });
  }

  /** @param {Readonly<Record<string, any>>} head @returns {Readonly<Record<string, any>>} */
  function createBlockedHead(head) {
    return nextHead(head, {
      activeOperation: {
        ...withoutDerivedOperationId(head.activeOperation),
        status: 'blocked',
      },
    });
  }

  /** @param {Readonly<Record<string, any>>} head @returns {Readonly<Record<string, any>>} */
  function createRunningHead(head) {
    return nextHead(head, {
      activeOperation: {
        ...withoutDerivedOperationId(head.activeOperation),
        status: 'running',
      },
    });
  }

  /** @param {Readonly<Record<string, any>>} inspection @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} head @returns {void} */
  function assertFinalInspection(inspection, plan, head) {
    const expectedStatus =
      head.activeOperation.kind === 'destroy' ? 'destroyed' : 'converged';
    if (
      inspection.status !== expectedStatus ||
      inspection.headGeneration !== head.generation ||
      inspection.incarnationId !== head.incarnationId ||
      inspection.deploymentInstanceId !== head.deploymentInstanceId ||
      inspection.providerSpecId !== plan.providerSpec.providerSpecId ||
      !sameJson(inspection.deploymentRevision, plan.deploymentRevision) ||
      !sameJson(inspection.providerScope, head.providerScope)
    ) {
      throw new AmbiguousDeploymentActionError(
        `Final inspection cannot prove deployment status '${expectedStatus}'.`,
      );
    }
    if (expectedStatus === 'converged') {
      const resident = inspection.resources.find(
        (/** @type {Readonly<Record<string, any>>} */ resource) =>
          resource.resourceKey === 'substrate' &&
          resource.capability.kind === 'resident-node' &&
          resource.role.kind === 'node',
      );
      if (
        resident?.service?.healthReceipt?.receipt.deploymentOperationId !==
        head.activeOperation.operationId
      ) {
        throw new AmbiguousDeploymentActionError(
          'Final healthy service receipt does not authorize the active deployment operation.',
        );
      }
    }
    const bindingByResource = new Map(
      head.resourceBindings.map(
        (/** @type {Readonly<Record<string, any>>} */ binding) => [
          binding.resourceKey,
          binding,
        ],
      ),
    );
    const actionByResource = new Map(
      plan.actions.map(
        (/** @type {Readonly<Record<string, any>>} */ action) => [
          action.resourceKey,
          action,
        ],
      ),
    );
    for (const resource of inspection.resources) {
      const action = actionByResource.get(resource.resourceKey);
      if (action === undefined) {
        throw new DeploymentOwnershipError(
          `Final inspection contains unplanned resource '${resource.resourceKey}'.`,
        );
      }
      assertResourceMatchesAction(action, resource);
      const binding = bindingByResource.get(resource.resourceKey);
      if (action.after === null) {
        if (
          resource.presence !== 'absent' ||
          resource.presenceEvidence !== 'authoritative-not-found'
        ) {
          throw new DeploymentOwnershipError(
            `Deleted resource '${resource.resourceKey}' lacks authoritative final absence evidence.`,
          );
        }
        if (binding !== undefined) {
          throw new DeploymentOwnershipError(
            `Deleted resource '${resource.resourceKey}' still has a durable binding.`,
          );
        }
      } else {
        if (
          resource.presence !== 'present' ||
          !binding ||
          resource.ownership !==
            (binding.management === 'managed' ? 'verified' : 'external') ||
          resource.providerIdentity === null ||
          binding.providerType !== resource.providerIdentity.providerType ||
          binding.providerResourceId !==
            resource.providerIdentity.providerResourceId ||
          resource.bindingId !== binding.bindingId ||
          !sameJson(resource.role, binding.role) ||
          resource.onDestroy !== binding.onDestroy ||
          !sameJson(resource.dependencyBindings, binding.dependencyBindings) ||
          resource.desiredDigest === null ||
          resource.observedDigest === null ||
          !sameJson(resource.desiredDigest, action.after.stateDigest) ||
          !sameJson(resource.observedDigest, action.after.stateDigest) ||
          (action.after.providerResourceId !== null &&
            binding.providerResourceId !== action.after.providerResourceId)
        ) {
          throw new DeploymentOwnershipError(
            `Final inspection for '${resource.resourceKey}' does not match its exact plan target and durable binding.`,
          );
        }
      }
    }
    const inspectedResourceKeys = new Set(
      inspection.resources.map(
        (/** @type {Readonly<Record<string, any>>} */ resource) =>
          resource.resourceKey,
      ),
    );
    if (
      plan.actions.some(
        (/** @type {Readonly<Record<string, any>>} */ action) =>
          !inspectedResourceKeys.has(action.resourceKey),
      ) ||
      head.resourceBindings.some(
        (/** @type {Readonly<Record<string, any>>} */ binding) =>
          !inspectedResourceKeys.has(binding.resourceKey),
      )
    ) {
      throw new DeploymentOwnershipError(
        'A plan target or durable binding is absent from the final provider inspection.',
      );
    }
  }

  /** @param {Readonly<Record<string, any>>} plan @param {Record<string, any>} profile @param {Readonly<Record<string, any>>} head @returns {Promise<Readonly<Record<string, any>>>} */
  async function finalize(plan, profile, head) {
    await assertPlanProviderScope(plan, profile);
    try {
      const observed = await provider.inspect(
        Object.freeze({
          ...providerContext(
            {
              operation: plan.operation,
              deploymentRevision: plan.deploymentRevision,
              providerScope: plan.providerScope,
              deploymentInstanceId: plan.deploymentInstanceId,
              incarnationId: plan.incarnationId,
              profile,
              providerSpec: plan.providerSpec,
            },
            head,
          ),
          plan,
        }),
      );
      const inspection = validateDeploymentInspectionContext(observed, {
        profile,
        providerSpec: plan.providerSpec,
        head,
        now: sampleInspectionNow(),
      });
      assertFinalInspection(inspection, plan, head);
    } catch {
      await assertPlanProviderScope(plan, profile);
      return (await compareAndSet(head, createBlockedHead(head))).head;
    }
    const operation = head.activeOperation;
    const destroy = operation.kind === 'destroy';
    const successor = nextHead(head, {
      phase: destroy ? 'DESTROYED' : 'READY',
      settledDeploymentRevisionId: destroy
        ? null
        : plan.deploymentRevision.deploymentRevisionId,
      targetDeploymentRevisionId: destroy
        ? null
        : plan.deploymentRevision.deploymentRevisionId,
      activeOperation: null,
      lastOperation: {
        kind: operation.kind,
        planId: operation.planId,
        intents: operation.intents,
      },
    });
    return (await compareAndSet(head, successor)).head;
  }

  /** @param {Readonly<Record<string, any>>} plan @param {Record<string, any>} profile @param {Readonly<Record<string, any>>} initialHead @param {Readonly<Record<string, any>>|null} artifactStage @returns {Promise<Readonly<Record<string, any>>>} */
  async function runOperation(plan, profile, initialHead, artifactStage) {
    let head = initialHead;
    await assertPlanProviderScope(plan, profile);
    if (head.activeOperation.status === 'blocked') {
      const running = createRunningHead(head);
      const transition = await compareAndSet(head, running);
      if (!transition.applied) {
        throw new DeploymentControllerConflictError(
          'Another controller already resumed the blocked operation.',
        );
      }
      head = transition.head;
    }
    while (head.activeOperation.nextActionIndex < plan.actions.length) {
      await assertPlanProviderScope(plan, profile);
      const actionIndex = head.activeOperation.nextActionIndex;
      const action = plan.actions[actionIndex];
      const intent = head.activeOperation.intents[actionIndex];
      if (intent.actionId !== action.actionId) {
        throw new DeploymentControllerConflictError(
          'Durable action frontier does not match the persisted plan.',
        );
      }
      /** @type {{status: 'converged', binding: Readonly<Record<string, any>>|null}|{status: 'not-converged'}|{status: 'blocked'}} */
      let settlement;
      if (intent.status === 'pending') {
        const intended = nextHead(head, {
          activeOperation: {
            ...withoutDerivedOperationId(head.activeOperation),
            intents: head.activeOperation.intents.map(
              (
                /** @type {Readonly<Record<string, any>>} */ candidate,
                /** @type {number} */ index,
              ) => ({
                actionId: candidate.actionId,
                status: index === actionIndex ? 'intended' : candidate.status,
                ownershipNonce: candidate.ownershipNonce,
              }),
            ),
          },
        });
        const transition = await compareAndSet(head, intended);
        if (!transition.applied) {
          throw new DeploymentControllerConflictError(
            'Another controller already claimed this action intent.',
          );
        }
        head = transition.head;
        const executionInspection = await inspectCurrentOperation(
          plan,
          profile,
          head,
        );
        let shouldExecute;
        try {
          shouldExecute = assertActionExecutionEvidence(
            action,
            executionInspection,
            head,
            plan,
          );
        } catch {
          return (await compareAndSet(head, createBlockedHead(head))).head;
        }
        if (shouldExecute) {
          await provider.executeAction(
            actionContext(plan, profile, head, actionIndex, artifactStage),
          );
        }
        settlement = validateSettlement(
          await provider.verifySettlement(
            actionContext(plan, profile, head, actionIndex, artifactStage),
          ),
          action,
          head.activeOperation.intents[actionIndex],
          head,
        );
      } else if (intent.status === 'intended') {
        settlement = validateSettlement(
          await provider.verifySettlement(
            actionContext(plan, profile, head, actionIndex, artifactStage),
          ),
          action,
          intent,
          head,
        );
        if (settlement.status === 'not-converged') {
          const executionInspection = await inspectCurrentOperation(
            plan,
            profile,
            head,
          );
          let shouldExecute;
          try {
            shouldExecute = assertActionExecutionEvidence(
              action,
              executionInspection,
              head,
              plan,
            );
          } catch {
            return (await compareAndSet(head, createBlockedHead(head))).head;
          }
          if (shouldExecute) {
            await provider.executeAction(
              actionContext(plan, profile, head, actionIndex, artifactStage),
            );
          }
          settlement = validateSettlement(
            await provider.verifySettlement(
              actionContext(plan, profile, head, actionIndex, artifactStage),
            ),
            action,
            intent,
            head,
          );
        }
      } else {
        throw new DeploymentControllerConflictError(
          'Durable action frontier contains an invalid current intent.',
        );
      }

      if (settlement.status === 'blocked') {
        await assertPlanProviderScope(plan, profile);
        return (await compareAndSet(head, createBlockedHead(head))).head;
      }
      if (settlement.status !== 'converged') {
        throw new AmbiguousDeploymentActionError(
          `Action '${action.actionId}' has not converged; its intent remains durable.`,
        );
      }
      const settlementInspection = await inspectCurrentOperation(
        plan,
        profile,
        head,
        action.action === 'create' && settlement.binding !== null
          ? settlement.binding
          : undefined,
      );
      try {
        assertActionSettlementEvidence(
          action,
          settlementInspection,
          settlement.binding,
          head,
          plan,
        );
      } catch {
        return (await compareAndSet(head, createBlockedHead(head))).head;
      }
      const settled = createActionSettledHead(
        head,
        action,
        actionIndex,
        settlement.binding,
      );
      head = (await compareAndSet(head, settled)).head;
    }
    return await finalize(plan, profile, head);
  }

  /** @param {Readonly<Record<string, any>>} head @param {Readonly<Record<string, any>>} plan @returns {void} */
  function assertActivePlan(head, plan) {
    const operation = head.activeOperation;
    const expectedKind =
      plan.operation === 'destroy'
        ? 'destroy'
        : head.settledDeploymentRevisionId === null
          ? 'create'
          : head.settledDeploymentRevisionId ===
              plan.deploymentRevision.deploymentRevisionId
            ? 'reconcile'
            : 'update';
    if (
      operation === null ||
      operation.planId !== plan.planId ||
      operation.kind !== expectedKind ||
      plan.deploymentInstanceId !== head.deploymentInstanceId ||
      plan.incarnationId !== head.incarnationId ||
      !sameJson(plan.providerScope, head.providerScope) ||
      plan.basis.headGeneration >= head.generation ||
      plan.basis.settledDeploymentRevisionId !==
        head.settledDeploymentRevisionId ||
      head.targetDeploymentRevisionId !==
        (expectedKind === 'destroy'
          ? null
          : plan.deploymentRevision.deploymentRevisionId) ||
      operation.intents.length !== plan.actions.length ||
      operation.intents.some(
        (
          /** @type {Readonly<Record<string, any>>} */ intent,
          /** @type {number} */ index,
        ) => intent.actionId !== plan.actions[index].actionId,
      )
    ) {
      throw new DeploymentControllerConflictError(
        'Persisted plan does not match the exact active operation.',
      );
    }
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function plan(value) {
    const input = validatePlanRequest(value, 'deploymentController.plan');
    const providerScope = await resolveScope(input);
    const deploymentInstanceId = getDeploymentInstanceId({
      deploymentRevision: input.deploymentRevision,
      providerScope,
    });
    const head = await readHead(deploymentInstanceId);
    const incarnationId =
      head === null || head.phase === 'DESTROYED'
        ? await incarnationFactory()
        : head.incarnationId;
    assertDeploymentIncarnationId(
      incarnationId,
      'deploymentController planned incarnationId',
    );
    if (head?.phase === 'DESTROYED' && incarnationId === head.incarnationId) {
      throw new Error(
        'Deployment incarnation factory must return a fresh identity after destroy.',
      );
    }
    const request = {
      ...input,
      providerScope,
      deploymentInstanceId,
      incarnationId,
    };
    assertLifecycleRequest(request, head);
    const providerSpec = await selectProviderSpec(request, head);
    return await createFreshPlan({ ...request, providerSpec }, head);
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function converge(value) {
    const input = exactObject(
      value,
      CONVERGE_REQUEST_KEYS,
      'deploymentController.converge',
    );
    const profile = validateDeploymentProfile(
      input.profile,
      'deploymentController.converge.profile',
    );
    const submittedPlan = validateDeploymentPlanContext(input.plan, {
      profile,
    });
    let head = await readHead(submittedPlan.deploymentInstanceId);
    if (
      head !== null &&
      head.activeOperation?.planId === submittedPlan.planId
    ) {
      const storedValue = await store.readPlan(submittedPlan.planId);
      if (storedValue === null) {
        throw new Error(
          'Active deployment plan is missing from durable storage.',
        );
      }
      const storedPlan = validateDeploymentPlanContext(storedValue, {
        profile,
      });
      if (!sameJson(storedPlan, submittedPlan)) {
        throw new DeploymentControllerConflictError(
          'Submitted plan differs from the exact durable active plan.',
        );
      }
      assertActivePlan(head, storedPlan);
      throw new DeploymentControllerConflictError(
        'The deployment plan is already active; recover it through resume so one successor explicitly claims the stopped coordinator.',
      );
    }
    const request = {
      operation: submittedPlan.operation,
      deploymentRevision: submittedPlan.deploymentRevision,
      providerScope: submittedPlan.providerScope,
      deploymentInstanceId: submittedPlan.deploymentInstanceId,
      incarnationId: submittedPlan.incarnationId,
      profile,
      providerSpec: submittedPlan.providerSpec,
    };
    assertLifecycleRequest(request, head);

    if (head !== null && head.phase === 'READY') {
      const settledProviderSpec = await selectProviderSpec(request, head);
      if (!sameJson(settledProviderSpec, submittedPlan.providerSpec)) {
        throw new StaleDeploymentPlanError(
          'Submitted deployment plan does not use the last settled provider specification.',
        );
      }
    } else {
      // A new incarnation has no prior accepted plan lineage. Validate the
      // submitted fixed provider receipt without selecting newer defaults.
      await assertProviderSpecValid(request, head);
    }

    // Reject an already-stale preview before the potentially large upload.
    // Stage intent/receipt records deliberately precede controller plan,
    // profile, and head state, then a second head read and provider plan close
    // the upload window before controller-state acceptance.
    const preflightPlan = await createFreshPlan(request, head);
    if (!sameJson(preflightPlan, submittedPlan)) {
      throw new StaleDeploymentPlanError(
        'Submitted deployment plan no longer matches the fresh provider plan.',
      );
    }
    const artifactStage = await resolveArtifactStage(
      'stageRunningArtifact',
      submittedPlan,
      profile,
    );
    const headAfterStaging = await readHead(submittedPlan.deploymentInstanceId);
    if (!sameJson(headAfterStaging, head)) {
      throw new StaleDeploymentPlanError(
        'Durable deployment head changed during artifact staging.',
      );
    }
    if (head !== null && head.phase === 'READY') {
      const settledProviderSpec = await selectProviderSpec(request, head);
      if (!sameJson(settledProviderSpec, submittedPlan.providerSpec)) {
        throw new StaleDeploymentPlanError(
          'Submitted deployment plan no longer uses the last settled provider specification.',
        );
      }
    } else {
      await assertProviderSpecValid(request, head);
    }
    const acceptancePlan = await createFreshPlan(request, head);
    if (!sameJson(acceptancePlan, submittedPlan)) {
      throw new StaleDeploymentPlanError(
        'Submitted deployment plan changed while its artifact was staged.',
      );
    }
    const intents = await createIntents(submittedPlan, head);
    await persistPlan(submittedPlan, profile);
    await assertPlanProviderScope(submittedPlan, profile);
    const initial = createInitialHead(submittedPlan, head, intents);
    const transition = await compareAndSet(head, initial);
    head = transition.head;
    return await runOperation(submittedPlan, profile, head, artifactStage);
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function resume(value) {
    const input = exactObject(
      value,
      RESUME_REQUEST_KEYS,
      'deploymentController.resume',
    );
    assertDeploymentInstanceId(
      input.deploymentInstanceId,
      'deploymentController.resume.deploymentInstanceId',
    );
    let head = await readHead(input.deploymentInstanceId);
    if (head === null) {
      throw new Error('Cannot resume a deployment without a durable head.');
    }
    if (head.activeOperation === null) return head;
    const storedValue = await store.readPlan(head.activeOperation.planId);
    if (storedValue === null) {
      throw new Error(
        'Active deployment plan is missing from durable storage.',
      );
    }
    const structuralPlan = validateDeploymentPlan(
      storedValue,
      'persisted active deployment plan',
    );
    const profileValue = await store.readProfile(
      structuralPlan.deploymentRevision.profileRevisionId,
    );
    if (profileValue === null) {
      throw new Error(
        'Active deployment profile is missing from durable storage.',
      );
    }
    const profile = validateDeploymentProfile(
      profileValue,
      'persisted active deployment profile',
    );
    const storedPlan = validateDeploymentPlanContext(structuralPlan, {
      profile,
    });
    assertActivePlan(head, storedPlan);
    await assertFreshProviderScope(
      {
        operation: storedPlan.operation,
        deploymentRevision: storedPlan.deploymentRevision,
        profile,
      },
      storedPlan.providerScope,
    );
    const artifactStage = await resolveArtifactStage(
      'validateStagedArtifact',
      storedPlan,
      profile,
    );
    if (head.activeOperation.status === 'running') {
      const claimable = createBlockedHead(head);
      const transition = await compareAndSet(head, claimable);
      if (!transition.applied) {
        throw new DeploymentControllerConflictError(
          'Another coordinator already claimed recovery of the active deployment operation.',
        );
      }
      head = transition.head;
    }
    return await runOperation(storedPlan, profile, head, artifactStage);
  }

  return Object.freeze({ plan, converge, resume });
}

export default { createDeploymentController };
