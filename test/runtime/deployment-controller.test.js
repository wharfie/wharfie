import { describe, expect, it } from '@jest/globals';

import { createDeploymentController } from '../../src/core/runtime/deployment-controller.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  createDeploymentArtifactStageIntent,
  createDeploymentArtifactStageReceipt,
} from '../../src/core/runtime/deployment-artifact-stage.js';
import {
  createDeploymentHead,
  validateDeploymentHead,
} from '../../src/core/runtime/deployment-head.js';
import { createDeploymentInspection } from '../../src/core/runtime/deployment-inspection.js';
import {
  createDeploymentPlan,
  validateDeploymentPlan,
} from '../../src/core/runtime/deployment-plan.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
  validateDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import {
  createAwsProviderScope,
  getDeploymentInstanceId,
  validateProviderScope,
} from '../../src/core/runtime/deployment-provider-scope.js';
import {
  createDeploymentIncarnationId,
  createDeploymentResourceBinding,
  createOwnershipNonce,
} from '../../src/core/runtime/deployment-resource-binding.js';
import { validateDeploymentRevision } from '../../src/core/runtime/deployment-revision.js';

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {string} value @returns {{algorithm: 'sha256', value: string}} */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

const RESOURCES = Object.freeze([
  {
    resourceKey: 'substrate',
    capability: 'resident-node',
    providerType: 'ec2-instance',
    retained: false,
  },
  {
    resourceKey: 'application-state',
    capability: 'application-state',
    providerType: 'ebs-volume',
    retained: true,
  },
  {
    resourceKey: 'control-state',
    capability: 'control-state',
    providerType: 'ebs-volume',
    retained: true,
  },
  {
    resourceKey: 'artifact',
    capability: 'artifact-storage',
    providerType: 's3-object',
    retained: false,
  },
  {
    resourceKey: 'runtime-identity',
    capability: 'runtime-identity',
    providerType: 'instance-profile',
    retained: false,
  },
  {
    resourceKey: 'network',
    capability: 'networking',
    providerType: 'vpc',
    retained: false,
  },
]);

/** @param {string} resourceKey @returns {string} */
function providerResourceId(resourceKey) {
  return `provider-resource-${resourceKey}`;
}

/** @param {Readonly<Record<string, any>>} profile @param {Readonly<Record<string, any>>} providerScope @param {string} [imageId] */
function makeProviderSpec(
  profile,
  providerScope,
  imageId = 'ami-0123456789abcdef0',
) {
  return createAwsSingleNodeProviderSpec({
    profile,
    providerScope,
    machineImage: {
      sourceParameter: {
        name: AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64,
        version: 42,
      },
      imageId,
      ownerAccountId: '137112412989',
      architecture: 'x86_64',
      imageType: 'machine',
      rootDeviceType: 'ebs',
      virtualizationType: 'hvm',
      enaSupport: true,
    },
    bootstrapDigest: digest('fixed bootstrap'),
    runtimeIdentityPolicyDigest: digest('fixed runtime identity policy'),
  });
}

/** @returns {Readonly<Record<string, any>>} */
function makeContext() {
  const profile = validateDeploymentProfile(
    createDeploymentProfile({
      profile: { id: 'production' },
      appId: 'controller-demo',
      target: {
        nodeVersion: '24.13.1',
        platform: 'linux',
        architecture: 'x64',
        libc: 'glibc',
      },
      mode: { kind: 'single-node-systemd-user', version: 1 },
      provider: createAwsSingleNodeProvider('us-east-1'),
    }),
  );
  const revisionPayload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'production' },
    appId: profile.appId,
    revisionId: semanticId('wrv1', 'wharfie:test:revision:v1', { revision: 1 }),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'controller artifact',
    }),
    profileRevisionId: profile.profileRevisionId,
  };
  const deploymentRevision = validateDeploymentRevision({
    ...revisionPayload,
    deploymentRevisionId: semanticId(
      'wdr1',
      'wharfie:deployment-revision:v1',
      revisionPayload,
    ),
  });
  const providerScope = validateProviderScope(
    createAwsProviderScope({
      partition: 'aws',
      accountId: '123456789012',
      region: 'us-east-1',
    }),
  );
  const providerSpec = makeProviderSpec(profile, providerScope);
  return Object.freeze({
    profile,
    deploymentRevision,
    providerScope,
    providerSpec,
    deploymentInstanceId: getDeploymentInstanceId({
      deploymentRevision,
      providerScope,
    }),
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 7)),
  });
}

/** @param {Readonly<Record<string, any>>} base @param {number} [nonceByte] @param {string} [versionId] */
function makeArtifactStageBundle(
  base,
  nonceByte = 41,
  versionId = 'controller-stage-version-1',
) {
  const byteDigest = digest('controller artifact');
  const artifact = {
    artifactId: base.deploymentRevision.artifactId,
    byteDigest,
    size: Buffer.byteLength('controller artifact'),
    appId: base.deploymentRevision.appId,
    revisionId: base.deploymentRevision.revisionId,
    target: base.profile.target,
  };
  const intent = createDeploymentArtifactStageIntent({
    providerScope: base.providerScope,
    artifact,
    ownershipNonce: createOwnershipNonce(Buffer.alloc(32, nonceByte)),
  });
  const receipt = createDeploymentArtifactStageReceipt({
    intent,
    object: {
      bucketName: intent.object.bucketName,
      key: intent.object.key,
      versionId,
      contentLength: artifact.size,
      checksum: byteDigest,
      serverSideEncryption: 'AES256',
      storageClass: 'STANDARD',
    },
  });
  return Object.freeze({ intent, receipt });
}

/**
 * @param {Readonly<Record<string, any>>} base
 * @param {Readonly<Record<string, any>>} inspection
 * @param {'apply'|'reconcile'|'destroy'} operation
 * @param {string} [variant]
 */
function makePlan(base, inspection, operation, variant = 'original') {
  const actions = RESOURCES.map((resource, index) => {
    const resourceKey =
      index === 0 && variant === 'changed'
        ? 'replacement-substrate'
        : resource.resourceKey;
    const state = {
      providerType: resource.providerType,
      providerResourceId:
        operation === 'apply' ? null : providerResourceId(resource.resourceKey),
      stateDigest: digest(resource.resourceKey),
    };
    if (operation === 'apply') {
      return {
        resourceKey,
        capability: { kind: resource.capability, version: 1 },
        management: 'managed',
        action: 'create',
        destructive: false,
        reason: 'missing',
        before: null,
        after: state,
      };
    }
    if (operation === 'reconcile') {
      return {
        resourceKey,
        capability: { kind: resource.capability, version: 1 },
        management: 'managed',
        action: 'noop',
        destructive: false,
        reason: 'already-converged',
        before: state,
        after: state,
      };
    }
    return {
      resourceKey,
      capability: { kind: resource.capability, version: 1 },
      management: 'managed',
      action: resource.retained ? 'noop' : 'delete',
      destructive: !resource.retained,
      reason: resource.retained ? 'retained-data' : 'destroy-requested',
      before: state,
      after: resource.retained ? state : null,
    };
  });
  return createDeploymentPlan(
    {
      operation,
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpec: base.providerSpec,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      basis: {
        headGeneration: inspection.headGeneration,
        settledDeploymentRevisionId:
          inspection.headGeneration === 0
            ? null
            : base.deploymentRevision.deploymentRevisionId,
        inspectionId: inspection.inspectionId,
      },
      actions,
    },
    { profile: base.profile },
  );
}

/**
 * @param {Readonly<Record<string, any>>} base
 * @param {Readonly<Record<string, any>>} action
 * @param {string} ownershipNonce
 * @param {string} [resourceId]
 * @param {string} [createdByActionId]
 */
function makeBinding(
  base,
  action,
  ownershipNonce,
  resourceId = providerResourceId(action.resourceKey),
  createdByActionId = action.actionId,
) {
  return createDeploymentResourceBinding({
    schemaVersion: 1,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    resourceKey: action.resourceKey,
    capability: action.capability,
    management: 'managed',
    providerType: action.before?.providerType || action.after?.providerType,
    providerResourceId: resourceId,
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce,
    createdByActionId,
  });
}

/** @param {Readonly<Record<string, any>>} base */
function makeAbsentInspection(base) {
  return createDeploymentInspection(
    {
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpecId: base.providerSpec.providerSpecId,
      deploymentInstanceId: base.deploymentInstanceId,
      controlState: {
        status: 'absent',
        evidence: 'authoritative-not-found',
      },
      incarnationId: null,
      headGeneration: 0,
      status: 'absent',
      resources: [],
    },
    { profile: base.profile, providerSpec: base.providerSpec },
  );
}

/**
 * @param {Readonly<Record<string, any>>} base
 * @param {Readonly<Record<string, any>>} head
 * @param {Map<string, Readonly<Record<string, any>>>} physical
 * @param {'conflict'|'missing'|'unknown'|null} [inspectionEvidence]
 * @param {string|null} [inspectionStateDriftResourceKey]
 */
function makeLiveInspection(
  base,
  head,
  physical,
  inspectionEvidence = null,
  inspectionStateDriftResourceKey = null,
) {
  const destroying = head.activeOperation?.kind === 'destroy';
  const allPresent = RESOURCES.every(({ resourceKey }) =>
    physical.has(resourceKey),
  );
  const destroyed =
    destroying &&
    RESOURCES.every(({ resourceKey, retained }) =>
      retained ? physical.has(resourceKey) : !physical.has(resourceKey),
    );
  const status =
    inspectionEvidence === 'conflict'
      ? 'conflict'
      : inspectionEvidence === 'missing'
        ? 'drifted'
        : inspectionEvidence === 'unknown'
          ? 'unknown'
          : inspectionStateDriftResourceKey !== null
            ? 'drifted'
            : destroyed
              ? 'destroyed'
              : allPresent
                ? 'converged'
                : 'in-flight';
  const resources = RESOURCES.map((resource) => {
    const binding = physical.get(resource.resourceKey);
    const present = binding !== undefined;
    return {
      resourceKey: resource.resourceKey,
      capability: { kind: resource.capability, version: 1 },
      management: 'managed',
      presence: present ? 'present' : 'absent',
      ownership:
        present &&
        resource.resourceKey === 'substrate' &&
        inspectionEvidence !== null
          ? inspectionEvidence
          : present
            ? 'verified'
            : 'missing',
      providerIdentity: present
        ? {
            providerType: binding.providerType,
            providerResourceId: binding.providerResourceId,
          }
        : null,
      desiredDigest: digest(resource.resourceKey),
      observedDigest: present
        ? digest(
            resource.resourceKey === inspectionStateDriftResourceKey
              ? `${resource.resourceKey}-drifted`
              : resource.resourceKey,
          )
        : null,
      health: present
        ? resource.capability === 'resident-node'
          ? 'healthy'
          : 'not-applicable'
        : 'absent',
      service:
        present && resource.capability === 'resident-node'
          ? {
              health: 'healthy',
              artifactId: base.deploymentRevision.artifactId,
              revisionId: base.deploymentRevision.revisionId,
            }
          : null,
    };
  });
  return createDeploymentInspection(
    {
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpecId: base.providerSpec.providerSpecId,
      deploymentInstanceId: base.deploymentInstanceId,
      controlState: {
        status: 'present',
        evidence: 'provider-head-read',
      },
      incarnationId: head.incarnationId,
      headGeneration: head.generation,
      status,
      resources,
    },
    { profile: base.profile, providerSpec: base.providerSpec },
  );
}

/** @param {Readonly<Record<string, any>>|null} [initialHead] @param {Readonly<Record<string, any>>[]} [initialPlans] @param {string[]} [events] */
function makeStore(initialHead = null, initialPlans = [], events = []) {
  let head =
    initialHead === null ? null : validateDeploymentHead(clone(initialHead));
  /** @type {Map<string, Readonly<Record<string, any>>>} */
  const plans = new Map(
    initialPlans.map((plan) => {
      const canonical = validateDeploymentPlan(clone(plan));
      return [canonical.planId, canonical];
    }),
  );
  /** @type {Map<string, Readonly<Record<string, any>>>} */
  const profiles = new Map();
  /** @type {null|((previous: Readonly<Record<string, any>>|null, next: Readonly<Record<string, any>>) => void|Promise<void>)} */
  let afterCas = null;
  const stats = { puts: 0, casAttempts: 0, casSuccesses: 0 };
  const api = {
    async readHead() {
      return head === null ? null : clone(head);
    },
    /** @param {{expectedHeadId: string|null, nextHead: unknown}} input */
    async compareAndSetHead({ expectedHeadId, nextHead }) {
      events.push('head-cas');
      stats.casAttempts += 1;
      if ((head?.headId || null) !== expectedHeadId) return false;
      const previous = head;
      head = validateDeploymentHead(clone(nextHead));
      stats.casSuccesses += 1;
      if (afterCas !== null) await afterCas(previous, head);
      return true;
    },
    /** @param {unknown} plan */
    async putPlanIfAbsent(plan) {
      events.push('plan-put');
      stats.puts += 1;
      const canonical = validateDeploymentPlan(clone(plan));
      if (!plans.has(canonical.planId)) plans.set(canonical.planId, canonical);
    },
    /** @param {string} planId */
    async readPlan(planId) {
      const plan = plans.get(planId);
      return plan === undefined ? null : clone(plan);
    },
    /** @param {unknown} profile */
    async putProfileIfAbsent(profile) {
      events.push('profile-put');
      stats.puts += 1;
      const canonical = validateDeploymentProfile(clone(profile));
      if (!profiles.has(canonical.profileRevisionId)) {
        profiles.set(canonical.profileRevisionId, canonical);
      }
    },
    /** @param {string} profileRevisionId */
    async readProfile(profileRevisionId) {
      const profile = profiles.get(profileRevisionId);
      return profile === undefined ? null : clone(profile);
    },
  };
  return {
    api,
    stats,
    get head() {
      return head;
    },
    /** @param {null|((previous: Readonly<Record<string, any>>|null, next: Readonly<Record<string, any>>) => void|Promise<void>)} hook */
    setAfterCas(hook) {
      afterCas = hook;
    },
  };
}

/** @param {Readonly<Record<string, any>>} base @param {string[]} [events] */
function makeArtifactStager(base, events = []) {
  const bundle = makeArtifactStageBundle(base);
  /** @type {unknown} */
  let stageResult = bundle;
  /** @type {unknown} */
  let validationResult = bundle;
  let stageCount = 0;
  let validationCount = 0;
  /** @type {null|(() => void|Promise<void>)} */
  let afterStage = null;
  /** @type {Record<string, any>[]} */
  const stageContexts = [];
  /** @type {Record<string, any>[]} */
  const validationContexts = [];
  const api = {
    /** @param {Record<string, any>} context */
    async stageRunningArtifact(context) {
      events.push('artifact-stage');
      stageCount += 1;
      stageContexts.push(context);
      if (afterStage) await afterStage();
      return stageResult;
    },
    /** @param {Record<string, any>} context */
    async validateStagedArtifact(context) {
      events.push('artifact-validate');
      validationCount += 1;
      validationContexts.push(context);
      return validationResult;
    },
  };
  return {
    api,
    bundle,
    stageContexts,
    validationContexts,
    get stageCount() {
      return stageCount;
    },
    get validationCount() {
      return validationCount;
    },
    /** @param {unknown} value */
    setStageResult(value) {
      stageResult = value;
    },
    /** @param {null|(() => void|Promise<void>)} hook */
    setAfterStage(hook) {
      afterStage = hook;
    },
    /** @param {unknown} value */
    setValidationResult(value) {
      validationResult = value;
    },
  };
}

/**
 * @param {Readonly<Record<string, any>>} base
 * @param {ReturnType<typeof makeStore>} store
 * @param {Map<string, Readonly<Record<string, any>>>} physical
 * @param {string[]} [events]
 */
function makeProvider(base, store, physical, events = []) {
  /** @type {'original'|'changed'} */
  let variant = 'original';
  /** @type {string|null} */
  let crashAfterEffectActionId = null;
  /** @type {Readonly<Record<string, any>>} */
  let resolvedScope = base.providerScope;
  /** @type {'conflict'|'missing'|'unknown'|null} */
  let inspectionEvidence = null;
  /** @type {string|null} */
  let driftAfterEffectActionId = null;
  /** @type {string|null} */
  let inspectionStateDriftResourceKey = null;
  /** @type {Map<string, number>} */
  const executeCount = new Map();
  /** @type {Record<string, any>[]} */
  const executeContexts = [];
  /** @type {Record<string, any>[]} */
  const verifyContexts = [];
  let providerSpecResolutionCount = 0;
  let providerSpecValidationCount = 0;
  /** @type {Readonly<Record<string, any>>|null} */
  let validatedProviderSpecOverride = null;
  const api = {
    async resolveScope() {
      return clone(resolvedScope);
    },
    async resolveProviderSpec() {
      providerSpecResolutionCount += 1;
      return clone(base.providerSpec);
    },
    /** @param {Record<string, any>} context */
    async validateProviderSpec(context) {
      providerSpecValidationCount += 1;
      return clone(validatedProviderSpecOverride || context.providerSpec);
    },
    /** @param {Record<string, any>} context */
    async inspect(context) {
      const contextualBase = Object.freeze({
        ...base,
        providerSpec: context.providerSpec,
      });
      return store.head === null
        ? makeAbsentInspection(contextualBase)
        : makeLiveInspection(
            contextualBase,
            store.head,
            physical,
            inspectionEvidence,
            inspectionStateDriftResourceKey,
          );
    },
    /** @param {Record<string, any>} context */
    async createPlan(context) {
      const operation =
        context.operation ||
        context.plan?.operation ||
        (store.head?.phase === 'READY' ? 'destroy' : 'apply');
      return makePlan(
        Object.freeze({ ...base, providerSpec: context.providerSpec }),
        context.inspection,
        operation,
        variant,
      );
    },
    /** @param {Record<string, any>} context */
    async executeAction(context) {
      events.push('action-execute');
      executeContexts.push(context);
      const { action } = context;
      executeCount.set(
        action.actionId,
        (executeCount.get(action.actionId) || 0) + 1,
      );
      if (action.action === 'delete') {
        physical.delete(action.resourceKey);
      } else if (
        action.action === 'create' &&
        !physical.has(action.resourceKey)
      ) {
        const nonce = context.ownershipNonce || context.intent?.ownershipNonce;
        physical.set(action.resourceKey, makeBinding(base, action, nonce));
      }
      if (crashAfterEffectActionId === action.actionId) {
        crashAfterEffectActionId = null;
        throw new Error('injected crash after physical effect');
      }
      if (driftAfterEffectActionId === action.actionId) {
        driftAfterEffectActionId = null;
        inspectionStateDriftResourceKey = action.resourceKey;
      }
    },
    /** @param {Record<string, any>} context */
    async verifySettlement(context) {
      events.push('action-verify');
      verifyContexts.push(context);
      const { action } = context;
      if (action.action === 'delete') {
        return physical.has(action.resourceKey)
          ? { status: 'not-converged' }
          : { status: 'converged', binding: null };
      }
      const binding = physical.get(action.resourceKey);
      return binding === undefined
        ? { status: 'not-converged' }
        : { status: 'converged', binding: clone(binding) };
    },
  };
  return {
    api,
    executeCount,
    executeContexts,
    verifyContexts,
    get providerSpecResolutionCount() {
      return providerSpecResolutionCount;
    },
    get providerSpecValidationCount() {
      return providerSpecValidationCount;
    },
    /** @param {'original'|'changed'} value */
    setVariant(value) {
      variant = value;
    },
    /** @param {Readonly<Record<string, any>>} value */
    setResolvedScope(value) {
      resolvedScope = value;
    },
    /** @param {Readonly<Record<string, any>>|null} value */
    setValidatedProviderSpec(value) {
      validatedProviderSpecOverride = value;
    },
    /** @param {'conflict'|'missing'|'unknown'|null} value */
    setInspectionEvidence(value) {
      inspectionEvidence = value;
    },
    /** @param {string} actionId */
    crashAfterPhysicalEffect(actionId) {
      crashAfterEffectActionId = actionId;
    },
    /** @param {string} actionId */
    driftAfterPhysicalEffect(actionId) {
      driftAfterEffectActionId = actionId;
    },
  };
}

/** @param {'missing'|'wrong'|null} corruption */
function makeReadyState(corruption = null) {
  const base = makeContext();
  const applyPlan = makePlan(base, makeAbsentInspection(base), 'apply');
  const bindings = applyPlan.actions.map(
    (
      /** @type {Readonly<Record<string, any>>} */ action,
      /** @type {number} */ index,
    ) =>
      makeBinding(
        base,
        action,
        createOwnershipNonce(Buffer.alloc(32, index + 1)),
      ),
  );
  const physical = new Map(
    bindings.map((/** @type {Readonly<Record<string, any>>} */ binding) => [
      binding.resourceKey,
      binding,
    ]),
  );
  let durableBindings = bindings;
  if (corruption === 'missing') {
    durableBindings = bindings.filter(
      (/** @type {Readonly<Record<string, any>>} */ { resourceKey }) =>
        resourceKey !== 'substrate',
    );
  } else if (corruption === 'wrong') {
    durableBindings = bindings.map(
      (/** @type {Readonly<Record<string, any>>} */ binding) =>
        binding.resourceKey === 'substrate'
          ? makeBinding(
              base,
              applyPlan.actions[0],
              binding.ownershipNonce,
              'wrong-provider-resource-substrate',
              binding.createdByActionId,
            )
          : binding,
    );
  }
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 7,
    phase: 'READY',
    settledDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    resourceBindings: durableBindings,
    activeOperation: null,
    lastOperation: {
      kind: 'create',
      planId: applyPlan.planId,
      intents: applyPlan.actions.map(
        (
          /** @type {Readonly<Record<string, any>>} */ action,
          /** @type {number} */ index,
        ) => ({
          actionId: action.actionId,
          status: 'settled',
          ownershipNonce: bindings[index].ownershipNonce,
        }),
      ),
    },
  });
  return { base, physical, head, applyPlan };
}

/**
 * @param {ReturnType<typeof makeReadyState>} ready
 * @param {Readonly<Record<string, any>>} plan
 * @param {'create'|'update'|'reconcile'} operationKind
 * @param {string[]} [actionIds]
 */
function replaceReadySettledPlan(
  ready,
  plan,
  operationKind,
  actionIds = plan.actions.map(
    (/** @type {Readonly<Record<string, any>>} */ action) => action.actionId,
  ),
) {
  return createDeploymentHead({
    deploymentInstanceId: ready.head.deploymentInstanceId,
    providerScope: ready.head.providerScope,
    incarnationId: ready.head.incarnationId,
    generation: ready.head.generation,
    phase: 'READY',
    settledDeploymentRevisionId: ready.head.settledDeploymentRevisionId,
    targetDeploymentRevisionId: ready.head.targetDeploymentRevisionId,
    resourceBindings: ready.head.resourceBindings,
    activeOperation: null,
    lastOperation: {
      kind: operationKind,
      planId: plan.planId,
      intents: actionIds.map((actionId, index) => ({
        actionId,
        status: 'settled',
        ownershipNonce: ready.head.lastOperation.intents[index].ownershipNonce,
      })),
    },
  });
}

/** @param {{head?: Readonly<Record<string, any>>|null, physical?: Map<string, Readonly<Record<string, any>>>}} [options] */
function makeHarness(options = {}) {
  const base = makeContext();
  /** @type {string[]} */
  const events = [];
  const physical = options.physical || new Map();
  const store = makeStore(options.head || null, [], events);
  const provider = makeProvider(base, store, physical, events);
  const artifactStager = makeArtifactStager(base, events);
  const controller = createDeploymentController({
    store: store.api,
    provider: provider.api,
    artifactStager: artifactStager.api,
    createOwnershipNonce: (() => {
      let index = 20;
      return () => createOwnershipNonce(Buffer.alloc(32, index++));
    })(),
    createDeploymentIncarnationId: () => base.incarnationId,
  });
  return {
    base,
    physical,
    store,
    provider,
    artifactStager,
    events,
    controller,
  };
}

/** @param {ReturnType<typeof makeHarness>} harness @param {'apply'|'destroy'} operation */
async function planWith(harness, operation) {
  return harness.controller.plan({
    operation,
    deploymentRevision: harness.base.deploymentRevision,
    profile: harness.base.profile,
  });
}

describe('deployment controller artifact staging', () => {
  it('stages before controller persistence and passes one exact bundle to every action call', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    const submittedSnapshot = clone(plan);

    await expect(
      harness.controller.converge({ plan, profile: harness.base.profile }),
    ).resolves.toMatchObject({ phase: 'READY' });

    expect(harness.artifactStager.stageCount).toBe(1);
    expect(harness.artifactStager.validationCount).toBe(0);
    expect(harness.artifactStager.stageContexts[0]).toEqual({
      deploymentRevision: plan.deploymentRevision,
      profile: harness.base.profile,
      providerScope: plan.providerScope,
    });
    expect(Object.isFrozen(harness.artifactStager.stageContexts[0])).toBe(true);
    const stageIndex = harness.events.indexOf('artifact-stage');
    expect(stageIndex).toBeGreaterThanOrEqual(0);
    expect(stageIndex).toBeLessThan(harness.events.indexOf('profile-put'));
    expect(stageIndex).toBeLessThan(harness.events.indexOf('plan-put'));
    expect(stageIndex).toBeLessThan(harness.events.indexOf('head-cas'));
    expect(plan).toEqual(submittedSnapshot);

    const actionContexts = [
      ...harness.provider.executeContexts,
      ...harness.provider.verifyContexts,
    ];
    expect(actionContexts.length).toBeGreaterThan(0);
    const artifactStage = actionContexts[0].artifactStage;
    expect(artifactStage).toEqual(harness.artifactStager.bundle);
    expect(Object.isFrozen(artifactStage)).toBe(true);
    expect(Object.isFrozen(artifactStage.intent)).toBe(true);
    expect(Object.isFrozen(artifactStage.receipt)).toBe(true);
    expect(
      actionContexts.every(
        (context) => context.artifactStage === artifactStage,
      ),
    ).toBe(true);
  });

  it.each(['malformed bundle', 'mismatched receipt'])(
    'refuses %s before plan, head, or action mutation',
    async (corruption) => {
      const harness = makeHarness();
      const plan = await planWith(harness, 'apply');
      if (corruption === 'malformed bundle') {
        harness.artifactStager.setStageResult({
          ...harness.artifactStager.bundle,
          unsupported: true,
        });
      } else {
        const other = makeArtifactStageBundle(
          harness.base,
          42,
          'controller-stage-version-2',
        );
        harness.artifactStager.setStageResult({
          intent: harness.artifactStager.bundle.intent,
          receipt: other.receipt,
        });
      }

      await expect(
        harness.controller.converge({ plan, profile: harness.base.profile }),
      ).rejects.toThrow();

      expect(harness.artifactStager.stageCount).toBe(1);
      expect(harness.store.stats).toEqual({
        puts: 0,
        casAttempts: 0,
        casSuccesses: 0,
      });
      expect(harness.store.head).toBeNull();
      expect(harness.provider.executeContexts).toHaveLength(0);
      expect(harness.provider.verifyContexts).toHaveLength(0);
      expect(harness.events).not.toContain('profile-put');
      expect(harness.events).not.toContain('plan-put');
      expect(harness.events).not.toContain('head-cas');
    },
  );

  it('regenerates the provider plan after staging before accepting controller state', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    harness.artifactStager.setAfterStage(() => {
      harness.provider.setVariant('changed');
    });

    await expect(
      harness.controller.converge({ plan, profile: harness.base.profile }),
    ).rejects.toThrow(/changed while its artifact was staged/i);

    expect(harness.artifactStager.stageCount).toBe(1);
    expect(harness.store.stats).toEqual({
      puts: 0,
      casAttempts: 0,
      casSuccesses: 0,
    });
    expect(harness.store.head).toBeNull();
    expect(harness.provider.executeContexts).toHaveLength(0);
    expect(harness.provider.verifyContexts).toHaveLength(0);
    expect(harness.events).not.toContain('profile-put');
    expect(harness.events).not.toContain('plan-put');
    expect(harness.events).not.toContain('head-cas');
  });

  it('validates staged evidence before any recovery CAS', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    harness.store.setAfterCas((_previous, next) => {
      if (next.activeOperation?.intents[0].status === 'intended') {
        throw new Error('injected crash after intent');
      }
    });
    await expect(
      harness.controller.converge({ plan, profile: harness.base.profile }),
    ).rejects.toThrow();
    harness.store.setAfterCas(null);
    harness.artifactStager.setValidationResult({
      ...harness.artifactStager.bundle,
      unsupported: true,
    });
    const statsBeforeResume = { ...harness.store.stats };
    const headBeforeResume = harness.store.head;
    const executionCountBeforeResume = harness.provider.executeContexts.length;
    harness.events.length = 0;

    await expect(
      harness.controller.resume({
        deploymentInstanceId: harness.base.deploymentInstanceId,
      }),
    ).rejects.toThrow();

    expect(harness.events).toEqual(['artifact-validate']);
    expect(harness.artifactStager.validationCount).toBe(1);
    expect(harness.store.stats).toEqual(statsBeforeResume);
    expect(harness.store.head?.headId).toBe(headBeforeResume?.headId);
    expect(harness.provider.executeContexts).toHaveLength(
      executionCountBeforeResume,
    );
  });

  it('does not restage a plan that is already active', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    harness.provider.crashAfterPhysicalEffect(plan.actions[0].actionId);

    await expect(
      harness.controller.converge({ plan, profile: harness.base.profile }),
    ).rejects.toThrow('injected crash after physical effect');
    expect(harness.artifactStager.stageCount).toBe(1);

    await expect(
      harness.controller.converge({ plan, profile: harness.base.profile }),
    ).rejects.toThrow(/already active|recover it through resume/i);
    expect(harness.artifactStager.stageCount).toBe(1);
    expect(harness.artifactStager.validationCount).toBe(0);
  });

  it('bypasses staging and validation for destroy and passes null to every action call', async () => {
    const ready = makeReadyState();
    /** @type {string[]} */
    const events = [];
    const store = makeStore(ready.head, [ready.applyPlan], events);
    const provider = makeProvider(ready.base, store, ready.physical, events);
    const artifactStager = makeArtifactStager(ready.base, events);
    const controller = createDeploymentController({
      store: store.api,
      provider: provider.api,
      artifactStager: artifactStager.api,
      createOwnershipNonce: () => createOwnershipNonce(Buffer.alloc(32, 30)),
      createDeploymentIncarnationId: () => ready.base.incarnationId,
    });
    const plan = await controller.plan({
      operation: 'destroy',
      deploymentRevision: ready.base.deploymentRevision,
      profile: ready.base.profile,
    });
    provider.crashAfterPhysicalEffect(plan.actions[0].actionId);

    await expect(
      controller.converge({ plan, profile: ready.base.profile }),
    ).rejects.toThrow('injected crash after physical effect');
    await expect(
      controller.resume({
        deploymentInstanceId: ready.base.deploymentInstanceId,
      }),
    ).resolves.toMatchObject({ phase: 'DESTROYED' });

    expect(artifactStager.stageCount).toBe(0);
    expect(artifactStager.validationCount).toBe(0);
    expect(events).not.toContain('artifact-stage');
    expect(events).not.toContain('artifact-validate');
    const actionContexts = [
      ...provider.executeContexts,
      ...provider.verifyContexts,
    ];
    expect(actionContexts.length).toBeGreaterThan(0);
    expect(
      actionContexts.every((context) => context.artifactStage === null),
    ).toBe(true);
  });
});

describe('deployment controller crash recovery', () => {
  it('resumes after the durable intent CAS and executes each logical action once', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    expect(harness.provider.providerSpecResolutionCount).toBe(1);
    let injected = false;
    harness.store.setAfterCas((_previous, next) => {
      if (!injected && next.activeOperation?.intents[0].status === 'intended') {
        injected = true;
        throw new Error('injected crash after intent');
      }
    });

    await expect(
      harness.controller.converge({ plan, profile: harness.base.profile }),
    ).rejects.toThrow(
      /claimed this action intent|injected crash after intent/i,
    );
    expect(harness.store.head?.activeOperation?.intents[0].status).toBe(
      'intended',
    );
    expect(
      harness.provider.executeCount.get(plan.actions[0].actionId) || 0,
    ).toBe(0);

    harness.store.setAfterCas(null);
    harness.events.length = 0;
    const head = await harness.controller.resume({
      deploymentInstanceId: harness.base.deploymentInstanceId,
    });

    expect(head.phase).toBe('READY');
    expect(harness.provider.providerSpecResolutionCount).toBe(1);
    expect(harness.provider.providerSpecValidationCount).toBe(2);
    expect(harness.artifactStager.stageCount).toBe(1);
    expect(harness.artifactStager.validationCount).toBe(1);
    expect(harness.events[0]).toBe('artifact-validate');
    expect(harness.events.indexOf('artifact-validate')).toBeLessThan(
      harness.events.indexOf('head-cas'),
    );
    expect(harness.artifactStager.validationContexts[0]).toEqual({
      deploymentRevision: plan.deploymentRevision,
      profile: harness.base.profile,
      providerScope: plan.providerScope,
    });
    expect(Object.isFrozen(harness.artifactStager.validationContexts[0])).toBe(
      true,
    );
    const actionContexts = [
      ...harness.provider.executeContexts,
      ...harness.provider.verifyContexts,
    ];
    const resumedArtifactStage = actionContexts[0].artifactStage;
    expect(resumedArtifactStage).toEqual(harness.artifactStager.bundle);
    expect(
      actionContexts.every(
        (context) => context.artifactStage === resumedArtifactStage,
      ),
    ).toBe(true);
    for (const action of plan.actions) {
      expect(harness.provider.executeCount.get(action.actionId)).toBe(1);
    }
  });

  it('verifies an intended action after a physical-effect crash without executing it twice', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    harness.provider.crashAfterPhysicalEffect(plan.actions[0].actionId);

    await expect(
      harness.controller.converge({ plan, profile: harness.base.profile }),
    ).rejects.toThrow('injected crash after physical effect');
    expect(harness.store.head?.activeOperation?.intents[0].status).toBe(
      'intended',
    );
    expect(harness.physical.has(plan.actions[0].resourceKey)).toBe(true);

    const head = await harness.controller.resume({
      deploymentInstanceId: harness.base.deploymentInstanceId,
    });

    expect(head.phase).toBe('READY');
    expect(harness.provider.executeCount.get(plan.actions[0].actionId)).toBe(1);
  });

  it('requires resume for an active plan and fences recovery when ambient scope drifts', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    harness.store.setAfterCas((_previous, next) => {
      if (next.activeOperation?.intents[0].status === 'intended') {
        throw new Error('injected crash after intent');
      }
    });

    await expect(
      harness.controller.converge({ plan, profile: harness.base.profile }),
    ).rejects.toThrow(
      /claimed this action intent|injected crash after intent/i,
    );
    harness.store.setAfterCas(null);
    expect(harness.store.head?.activeOperation?.intents[0].status).toBe(
      'intended',
    );

    harness.provider.setResolvedScope(
      createAwsProviderScope({
        partition: 'aws',
        accountId: '210987654321',
        region: 'us-east-1',
      }),
    );
    await expect(
      harness.controller.converge({ plan, profile: harness.base.profile }),
    ).rejects.toThrow(/already active|recover it through resume/i);
    await expect(
      harness.controller.resume({
        deploymentInstanceId: harness.base.deploymentInstanceId,
      }),
    ).rejects.toThrow(/different provider scope/i);

    expect(harness.provider.executeCount.size).toBe(0);
    expect(harness.store.head?.activeOperation?.intents[0].status).toBe(
      'intended',
    );
  });

  it('allows one of two concurrent resume callers to recover an intended action', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    harness.store.setAfterCas((_previous, next) => {
      if (next.activeOperation?.intents[0].status === 'intended') {
        throw new Error('injected crash after intent');
      }
    });

    await expect(
      harness.controller.converge({ plan, profile: harness.base.profile }),
    ).rejects.toThrow(
      /claimed this action intent|injected crash after intent/i,
    );
    harness.store.setAfterCas(null);

    const results = await Promise.allSettled([
      harness.controller.resume({
        deploymentInstanceId: harness.base.deploymentInstanceId,
      }),
      harness.controller.resume({
        deploymentInstanceId: harness.base.deploymentInstanceId,
      }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    expect(harness.store.head?.phase).toBe('READY');
    for (const action of plan.actions) {
      expect(harness.provider.executeCount.get(action.actionId)).toBe(1);
    }
  });

  it('keeps an all-settled operation visibly blocked when final inspection is ambiguous', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    harness.store.setAfterCas((_previous, next) => {
      if (
        next.activeOperation?.nextActionIndex === plan.actions.length &&
        next.activeOperation.intents.every(
          (/** @type {Readonly<Record<string, any>>} */ { status }) =>
            status === 'settled',
        )
      ) {
        harness.provider.setInspectionEvidence('unknown');
      }
    });

    const head = await harness.controller.converge({
      plan,
      profile: harness.base.profile,
    });

    expect(head).toMatchObject({
      phase: 'CONVERGING',
      activeOperation: {
        status: 'blocked',
        nextActionIndex: plan.actions.length,
      },
    });
    expect(
      head.activeOperation.intents.every(
        (/** @type {Readonly<Record<string, any>>} */ { status }) =>
          status === 'settled',
      ),
    ).toBe(true);
    for (const action of plan.actions) {
      expect(harness.provider.executeCount.get(action.actionId)).toBe(1);
    }
  });

  it('does not settle an action without fresh matching provider state evidence', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    harness.provider.driftAfterPhysicalEffect(plan.actions[0].actionId);

    const head = await harness.controller.converge({
      plan,
      profile: harness.base.profile,
    });

    expect(head).toMatchObject({
      phase: 'CONVERGING',
      activeOperation: {
        status: 'blocked',
        nextActionIndex: 0,
      },
    });
    expect(head.activeOperation.intents[0].status).toBe('intended');
    expect(harness.provider.executeCount.get(plan.actions[0].actionId)).toBe(1);
    for (const action of plan.actions.slice(1)) {
      expect(harness.provider.executeCount.get(action.actionId) || 0).toBe(0);
    }
  });
});

describe('deployment controller fencing', () => {
  it('refuses a valid alternate provider spec that bypasses READY planning', async () => {
    const ready = makeReadyState();
    const store = makeStore(ready.head, [ready.applyPlan]);
    const provider = makeProvider(ready.base, store, ready.physical);
    const controller = createDeploymentController({
      store: store.api,
      provider: provider.api,
      artifactStager: makeArtifactStager(ready.base).api,
      createOwnershipNonce: () => createOwnershipNonce(Buffer.alloc(32, 30)),
      createDeploymentIncarnationId: () => ready.base.incarnationId,
    });
    const alternateBase = Object.freeze({
      ...ready.base,
      providerSpec: makeProviderSpec(
        ready.base.profile,
        ready.base.providerScope,
        'ami-fedcba98765432100',
      ),
    });
    const forgedInspection = makeLiveInspection(
      alternateBase,
      ready.head,
      ready.physical,
    );
    const forgedPlan = makePlan(alternateBase, forgedInspection, 'destroy');

    await expect(
      controller.converge({ plan: forgedPlan, profile: ready.base.profile }),
    ).rejects.toThrow(/last settled provider specification/i);

    expect(store.head?.headId).toBe(ready.head.headId);
    expect(store.stats).toEqual({ puts: 0, casAttempts: 0, casSuccesses: 0 });
    expect(provider.providerSpecResolutionCount).toBe(0);
    expect(provider.providerSpecValidationCount).toBe(0);
    expect(provider.executeCount.size).toBe(0);
  });

  it('rejects mismatched settled-plan kind, generation, intents, and operation basis', async () => {
    for (const corruption of ['kind', 'generation', 'intent', 'operation']) {
      const ready = makeReadyState();
      let storedPlan = ready.applyPlan;
      let settledKind = 'create';
      /** @type {string[]|undefined} */
      let actionIds;

      if (corruption === 'kind') {
        settledKind = 'update';
      } else if (corruption === 'generation') {
        storedPlan = createDeploymentPlan(
          {
            operation: ready.applyPlan.operation,
            deploymentRevision: ready.applyPlan.deploymentRevision,
            providerScope: ready.applyPlan.providerScope,
            providerSpec: ready.applyPlan.providerSpec,
            deploymentInstanceId: ready.applyPlan.deploymentInstanceId,
            incarnationId: ready.applyPlan.incarnationId,
            basis: {
              ...ready.applyPlan.basis,
              headGeneration: ready.head.generation,
            },
            actions: /** @type {Record<string, any>[]} */ (
              clone(ready.applyPlan.actions)
            ).map((action) => {
              delete action.actionId;
              return action;
            }),
          },
          { profile: ready.base.profile },
        );
      } else if (corruption === 'intent') {
        const corruptedActionIds = ready.applyPlan.actions.map(
          (/** @type {Readonly<Record<string, any>>} */ action) =>
            action.actionId,
        );
        corruptedActionIds[0] = semanticId(
          'wda2',
          'wharfie:test:foreign-deployment-action:v2',
          { action: 1 },
        );
        actionIds = corruptedActionIds;
      } else {
        const reconcileInspection = makeLiveInspection(
          ready.base,
          ready.head,
          ready.physical,
        );
        const reconcilePlan = makePlan(
          ready.base,
          reconcileInspection,
          'reconcile',
        );
        storedPlan = createDeploymentPlan(
          {
            operation: 'reconcile',
            deploymentRevision: reconcilePlan.deploymentRevision,
            providerScope: reconcilePlan.providerScope,
            providerSpec: reconcilePlan.providerSpec,
            deploymentInstanceId: reconcilePlan.deploymentInstanceId,
            incarnationId: reconcilePlan.incarnationId,
            basis: {
              ...reconcilePlan.basis,
              headGeneration: ready.head.generation - 1,
              settledDeploymentRevisionId: null,
            },
            actions: /** @type {Record<string, any>[]} */ (
              clone(reconcilePlan.actions)
            ).map((action) => {
              delete action.actionId;
              return action;
            }),
          },
          { profile: ready.base.profile },
        );
      }

      const head = replaceReadySettledPlan(
        ready,
        storedPlan,
        /** @type {'create'|'update'|'reconcile'} */ (settledKind),
        actionIds,
      );
      const store = makeStore(head, [storedPlan]);
      const provider = makeProvider(ready.base, store, ready.physical);
      const controller = createDeploymentController({
        store: store.api,
        provider: provider.api,
        artifactStager: makeArtifactStager(ready.base).api,
        createOwnershipNonce: () => createOwnershipNonce(Buffer.alloc(32, 30)),
        createDeploymentIncarnationId: () => ready.base.incarnationId,
      });

      await expect(
        controller.plan({
          operation: 'destroy',
          deploymentRevision: ready.base.deploymentRevision,
          profile: ready.base.profile,
        }),
      ).rejects.toThrow(/last settled plan does not match/i);
      expect(store.stats.casSuccesses).toBe(0);
      expect(provider.providerSpecResolutionCount).toBe(0);
      expect(provider.executeCount.size).toBe(0);
    }
  });

  it('requires provider validation of a submitted new-incarnation spec', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    harness.provider.setValidatedProviderSpec(
      makeProviderSpec(
        harness.base.profile,
        harness.base.providerScope,
        'ami-fedcba98765432100',
      ),
    );

    await expect(
      harness.controller.converge({ plan, profile: harness.base.profile }),
    ).rejects.toThrow(/did not reproduce the exact pinned provider/i);

    expect(harness.provider.providerSpecResolutionCount).toBe(1);
    expect(harness.provider.providerSpecValidationCount).toBe(1);
    expect(harness.store.stats).toEqual({
      puts: 0,
      casAttempts: 0,
      casSuccesses: 0,
    });
    expect(harness.provider.executeCount.size).toBe(0);
  });

  it('rejects a stale preview before persisting a plan, changing a head, or causing effects', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    harness.provider.setVariant('changed');

    await expect(
      harness.controller.converge({ plan, profile: harness.base.profile }),
    ).rejects.toThrow();

    expect(harness.store.stats).toEqual({
      puts: 0,
      casAttempts: 0,
      casSuccesses: 0,
    });
    expect(harness.provider.executeCount.size).toBe(0);
    expect(harness.store.head).toBeNull();
  });

  it('re-resolves ambient credentials before mutation and refuses scope drift', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    harness.provider.setResolvedScope(
      createAwsProviderScope({
        partition: 'aws',
        accountId: '210987654321',
        region: 'us-east-1',
      }),
    );

    await expect(
      harness.controller.converge({ plan, profile: harness.base.profile }),
    ).rejects.toThrow(/different provider scope/i);

    expect(harness.store.stats).toEqual({
      puts: 0,
      casAttempts: 0,
      casSuccesses: 0,
    });
    expect(harness.provider.executeCount.size).toBe(0);
    expect(harness.store.head).toBeNull();
  });

  it('fences scope drift between actions before the next physical effect', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    harness.store.setAfterCas((_previous, next) => {
      if (
        next.activeOperation?.nextActionIndex === 1 &&
        next.activeOperation.intents[0].status === 'settled'
      ) {
        harness.provider.setResolvedScope(
          createAwsProviderScope({
            partition: 'aws',
            accountId: '210987654321',
            region: 'us-east-1',
          }),
        );
      }
    });

    await expect(
      harness.controller.converge({ plan, profile: harness.base.profile }),
    ).rejects.toThrow(/different provider scope/i);

    expect(harness.provider.executeCount.get(plan.actions[0].actionId)).toBe(1);
    for (const action of plan.actions.slice(1)) {
      expect(harness.provider.executeCount.get(action.actionId) || 0).toBe(0);
    }
    expect(harness.store.head).toMatchObject({
      phase: 'CONVERGING',
      activeOperation: {
        status: 'running',
        nextActionIndex: 1,
        intents: [
          { status: 'settled' },
          { status: 'pending' },
          { status: 'pending' },
          { status: 'pending' },
          { status: 'pending' },
          { status: 'pending' },
        ],
      },
    });
  });

  it('re-inspects ownership between actions before the next physical effect', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    harness.store.setAfterCas((_previous, next) => {
      if (
        next.activeOperation?.nextActionIndex === 1 &&
        next.activeOperation.intents[0].status === 'settled'
      ) {
        harness.provider.setInspectionEvidence('unknown');
      }
    });

    await expect(
      harness.controller.converge({ plan, profile: harness.base.profile }),
    ).rejects.toThrow(/cannot authorize mutation/i);

    expect(harness.provider.executeCount.get(plan.actions[0].actionId)).toBe(1);
    for (const action of plan.actions.slice(1)) {
      expect(harness.provider.executeCount.get(action.actionId) || 0).toBe(0);
    }
    expect(harness.store.head).toMatchObject({
      phase: 'CONVERGING',
      activeOperation: {
        status: 'running',
        nextActionIndex: 1,
      },
    });
  });

  it('allows only one coordinator through a CAS race', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');

    const results = await Promise.allSettled([
      harness.controller.converge({ plan, profile: harness.base.profile }),
      harness.controller.converge({ plan, profile: harness.base.profile }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(harness.store.head?.phase).toBe('READY');
    for (const action of plan.actions) {
      expect(harness.provider.executeCount.get(action.actionId)).toBe(1);
    }
  });
});

describe('deployment controller destroy ownership', () => {
  it.each(
    /** @type {Array<'conflict'|'missing'|'unknown'>} */ ([
      'conflict',
      'missing',
      'unknown',
    ]),
  )(
    'refuses a fresh destroy when current provider ownership is %s',
    async (evidence) => {
      const ready = makeReadyState();
      const store = makeStore(ready.head, [ready.applyPlan]);
      const provider = makeProvider(ready.base, store, ready.physical);
      const controller = createDeploymentController({
        store: store.api,
        provider: provider.api,
        artifactStager: makeArtifactStager(ready.base).api,
        createOwnershipNonce: () => createOwnershipNonce(Buffer.alloc(32, 30)),
        createDeploymentIncarnationId: () => ready.base.incarnationId,
      });
      const plan = await controller.plan({
        operation: 'destroy',
        deploymentRevision: ready.base.deploymentRevision,
        profile: ready.base.profile,
      });
      expect(provider.providerSpecResolutionCount).toBe(0);
      expect(provider.providerSpecValidationCount).toBe(0);
      provider.setInspectionEvidence(evidence);

      await expect(
        controller.converge({ plan, profile: ready.base.profile }),
      ).rejects.toThrow(/authorize mutation|ownership|provider evidence/i);

      expect(store.head?.headId).toBe(ready.head.headId);
      expect(store.stats).toEqual({
        puts: 0,
        casAttempts: 0,
        casSuccesses: 0,
      });
      expect(provider.executeCount.size).toBe(0);
    },
  );

  it.each(/** @type {Array<'missing'|'wrong'>} */ (['missing', 'wrong']))(
    'refuses a destroy with a %s durable binding',
    async (corruption) => {
      const ready = makeReadyState(corruption);
      const store = makeStore(ready.head, [ready.applyPlan]);
      const provider = makeProvider(ready.base, store, ready.physical);
      const controller = createDeploymentController({
        store: store.api,
        provider: provider.api,
        artifactStager: makeArtifactStager(ready.base).api,
        createOwnershipNonce: () => createOwnershipNonce(Buffer.alloc(32, 30)),
        createDeploymentIncarnationId: () => ready.base.incarnationId,
      });
      await expect(
        controller.plan({
          operation: 'destroy',
          deploymentRevision: ready.base.deploymentRevision,
          profile: ready.base.profile,
        }),
      ).rejects.toThrow(
        /binding|ownership|receipt|provider resource|provider evidence/i,
      );

      expect(store.head?.headId).toBe(ready.head.headId);
      expect(store.stats.casSuccesses).toBe(0);
      expect(provider.executeCount.size).toBe(0);
    },
  );

  it('refuses a fresh apply while a destroyed tombstone retains resource bindings', async () => {
    const ready = makeReadyState();
    const store = makeStore(ready.head, [ready.applyPlan]);
    const provider = makeProvider(ready.base, store, ready.physical);
    const freshIncarnationId = createDeploymentIncarnationId(
      Buffer.alloc(32, 91),
    );
    const controller = createDeploymentController({
      store: store.api,
      provider: provider.api,
      artifactStager: makeArtifactStager(ready.base).api,
      createOwnershipNonce: () => createOwnershipNonce(Buffer.alloc(32, 30)),
      createDeploymentIncarnationId: () => freshIncarnationId,
    });
    const destroyPlan = await controller.plan({
      operation: 'destroy',
      deploymentRevision: ready.base.deploymentRevision,
      profile: ready.base.profile,
    });
    const destroyed = await controller.converge({
      plan: destroyPlan,
      profile: ready.base.profile,
    });
    const executionCounts = new Map(provider.executeCount);

    expect(destroyed.phase).toBe('DESTROYED');
    expect(
      destroyed.resourceBindings
        .map(
          (/** @type {Readonly<Record<string, any>>} */ { resourceKey }) =>
            resourceKey,
        )
        .sort(),
    ).toEqual(['application-state', 'control-state']);
    await expect(
      controller.plan({
        operation: 'apply',
        deploymentRevision: ready.base.deploymentRevision,
        profile: ready.base.profile,
      }),
    ).rejects.toThrow(/retained resource bindings|adoption is not supported/i);

    expect(provider.executeCount).toEqual(executionCounts);
    expect(store.head?.headId).toBe(destroyed.headId);
  });
});
