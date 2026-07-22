import { describe, expect, it } from '@jest/globals';

import { createDeploymentController } from '../../src/core/runtime/deployment-controller.js';
import { createAwsSingleNodeProviderSpecResolver } from '../../src/core/runtime/deployment-aws-provider-spec-resolver.js';
import { compareCanonicalStrings } from '../../src/core/runtime/canonical-order.js';
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
  DEPLOYMENT_OPERATION_ID_PREFIX,
  createDeploymentHead,
  validateDeploymentHead,
} from '../../src/core/runtime/deployment-head.js';
import { createDeploymentInspection } from '../../src/core/runtime/deployment-inspection.js';
import {
  AWS_SINGLE_NODE_RESOURCE_GRAPH,
  getAwsSingleNodeResourceApplyOrder,
  getAwsSingleNodeResourceDestroyOrder,
} from '../../src/core/runtime/deployment-resource-graph.js';
import {
  createDeploymentServiceHealthReceipt,
  getDeploymentServiceHealthObjectLocation,
} from '../../src/core/runtime/deployment-service-health.js';
import { validateDeploymentServiceHealthObservation } from '../../src/core/runtime/deployment-service-health-s3.js';
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
  DEPLOYMENT_ACTION_ID_PREFIX,
  createDeploymentIncarnationId,
  createDeploymentResourceBinding,
  createOwnershipNonce,
} from '../../src/core/runtime/deployment-resource-binding.js';
import { validateDeploymentRevision } from '../../src/core/runtime/deployment-revision.js';
import { createLedgerServiceId } from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';

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

const HEALTH_NOW = 1_700_000_000_000;
const RUNTIME_ROLE_ID = 'AROA1234567890EXAMPLE';

const RESOURCE_BY_KEY = new Map(
  AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.map(
    (/** @type {Readonly<Record<string, any>>} */ resource) => [
      resource.resourceKey,
      resource,
    ],
  ),
);
const RESOURCES = Object.freeze(
  getAwsSingleNodeResourceApplyOrder().map((resourceKey) => {
    const resource = RESOURCE_BY_KEY.get(resourceKey);
    if (resource === undefined) {
      throw new Error(`Missing test resource graph entry '${resourceKey}'.`);
    }
    return resource;
  }),
);

/** @param {string} resourceKey @returns {string} */
function providerResourceId(resourceKey) {
  if (resourceKey === 'substrate') return 'i-0123456789abcdef0';
  if (resourceKey === 'runtime-role') return RUNTIME_ROLE_ID;
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
    placement: { availabilityZoneId: 'use1-az1' },
    storage: {
      ebsKmsKeyArn:
        'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    },
    bootstrapDigest: digest('fixed bootstrap'),
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
  const orderedResourceKeys =
    operation === 'destroy'
      ? getAwsSingleNodeResourceDestroyOrder()
      : getAwsSingleNodeResourceApplyOrder();
  const actions = orderedResourceKeys.map((resourceKey, index) => {
    const resource = RESOURCE_BY_KEY.get(resourceKey);
    if (resource === undefined) {
      throw new Error(`Missing test resource graph entry '${resourceKey}'.`);
    }
    const observation = inspection.resources.find(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.resourceKey === resourceKey,
    );
    const create =
      operation === 'apply' ||
      (operation === 'reconcile' && observation?.presence === 'absent');
    const state = {
      providerType: resource.providerType,
      providerResourceId: create ? null : providerResourceId(resourceKey),
      stateDigest: digest(resource.resourceKey),
    };
    const graphFields = {
      resourceKey,
      capability: resource.capability,
      role: resource.role,
      management: 'managed',
      ownershipMode: resource.ownershipMode,
      dependsOn: resource.dependsOn,
      onDestroy: resource.onDestroy,
    };
    if (create) {
      return {
        ...graphFields,
        action: 'create',
        destructive: false,
        reason:
          index === 0 && variant === 'changed'
            ? 'deployment-change'
            : 'missing',
        before: null,
        after: state,
      };
    }
    if (operation === 'reconcile') {
      return {
        ...graphFields,
        action: 'noop',
        destructive: false,
        reason:
          index === 0 && variant === 'changed'
            ? 'deployment-change'
            : 'already-converged',
        before: state,
        after: state,
      };
    }
    const retained = resource.onDestroy === 'retain';
    return {
      ...graphFields,
      action: retained ? 'noop' : 'delete',
      destructive: !retained,
      reason: retained ? 'retained-data' : 'destroy-requested',
      before: state,
      after: retained ? state : null,
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
 * @param {Readonly<Record<string, any>>[]} [resourceBindings]
 * @param {Readonly<Record<string, any>>[]|null} [dependencyBindingsOverride]
 */
function makeBinding(
  base,
  action,
  ownershipNonce,
  resourceId = providerResourceId(action.resourceKey),
  createdByActionId = action.actionId,
  resourceBindings = [],
  dependencyBindingsOverride = null,
) {
  const dependencyBindings =
    dependencyBindingsOverride ||
    action.dependsOn
      .map((/** @type {string} */ resourceKey) => {
        const dependency = resourceBindings.find(
          (/** @type {Readonly<Record<string, any>>} */ binding) =>
            binding.resourceKey === resourceKey,
        );
        if (dependency === undefined) {
          throw new Error(
            `Test binding '${action.resourceKey}' lacks dependency '${resourceKey}'.`,
          );
        }
        return { resourceKey, bindingId: dependency.bindingId };
      })
      .sort(
        (
          /** @type {{resourceKey: string}} */ left,
          /** @type {{resourceKey: string}} */ right,
        ) => compareCanonicalStrings(left.resourceKey, right.resourceKey),
      );
  return createDeploymentResourceBinding({
    schemaVersion: 2,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    resourceKey: action.resourceKey,
    capability: action.capability,
    role: action.role,
    management: 'managed',
    ownershipMode: action.ownershipMode,
    onDestroy: action.onDestroy,
    dependencyBindings,
    providerType: action.before?.providerType || action.after?.providerType,
    providerResourceId: resourceId,
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce,
    createdByActionId,
  });
}

/**
 * @param {Readonly<Record<string, any>>} base
 * @param {Readonly<Record<string, any>>} head
 * @param {Readonly<Record<string, any>>} nodeBinding
 * @param {Record<string, any>} [overrides]
 */
function makeHealthObservation(base, head, nodeBinding, overrides = {}) {
  const operation =
    head.activeOperation !== null && head.activeOperation.kind !== 'destroy'
      ? head.activeOperation
      : head.lastOperation !== null && head.lastOperation.kind !== 'destroy'
        ? head.lastOperation
        : null;
  if (operation === null) {
    throw new Error('test health observation requires live release authority');
  }
  const runtimeRoleBinding = head.resourceBindings.find(
    (/** @type {Readonly<Record<string, any>>} */ binding) =>
      binding.resourceKey === 'runtime-role',
  );
  if (runtimeRoleBinding === undefined) {
    throw new Error('test health observation requires runtime role authority');
  }
  const receipt = createDeploymentServiceHealthReceipt({
    providerScopeId: base.providerScope.providerScopeId,
    providerSpecId: base.providerSpec.providerSpecId,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: head.incarnationId,
    deploymentOperationId: operation.operationId,
    authorizedHeadId: head.headId,
    authorizedHeadGeneration: head.generation,
    nodeBindingId: nodeBinding.bindingId,
    nodeProviderResourceId: nodeBinding.providerResourceId,
    runtimeRoleBindingId: runtimeRoleBinding.bindingId,
    runtimeRoleId: runtimeRoleBinding.providerResourceId,
    deploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    appId: base.deploymentRevision.appId,
    artifactId: base.deploymentRevision.artifactId,
    revisionId: base.deploymentRevision.revisionId,
    serviceId: createLedgerServiceId({
      appId: base.deploymentRevision.appId,
    }),
    sessionId: `wss_${Buffer.alloc(32, 13).toString('base64url')}`,
    lifecycleGeneration: 1,
    ownerGeneration: 1,
    activationRecordVersion: 1,
    activationSelectionGeneration: 1,
    processId: 4321,
    sequence: 1,
    health: 'healthy',
    ...overrides,
  });
  const location = getDeploymentServiceHealthObjectLocation(
    base.providerScope,
    receipt,
  );
  return validateDeploymentServiceHealthObservation({
    receipt,
    object: {
      bucketName: location.bucketName,
      key: location.key,
      versionId: 'controller-health-version-1',
      etag: '"controller-health-etag-1"',
      lastModifiedAt: HEALTH_NOW,
    },
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
 * @param {Record<string, any>|null} [healthReceiptOverrides]
 * @param {string|null} [reappearedResourceKey]
 * @param {string|null} [finalDigestOverrideResourceKey]
 */
function makeLiveInspection(
  base,
  head,
  physical,
  inspectionEvidence = null,
  inspectionStateDriftResourceKey = null,
  healthReceiptOverrides = {},
  reappearedResourceKey = null,
  finalDigestOverrideResourceKey = null,
) {
  const durableResourceKeys = new Set(
    head.resourceBindings.map(
      (/** @type {Readonly<Record<string, any>>} */ binding) =>
        binding.resourceKey,
    ),
  );
  const pendingBindings = [...physical.values()].filter(
    (/** @type {Readonly<Record<string, any>>} */ binding) =>
      !durableResourceKeys.has(binding.resourceKey),
  );
  if (pendingBindings.length > 1) {
    throw new Error(
      'A controller inspection may expose only one pending binding.',
    );
  }
  const pendingBinding = pendingBindings[0];
  const destroying =
    head.activeOperation?.kind === 'destroy' || head.phase === 'DESTROYED';
  const allPresent = RESOURCES.every(({ resourceKey }) =>
    physical.has(resourceKey),
  );
  const destroyed =
    destroying &&
    RESOURCES.every(({ resourceKey, onDestroy }) =>
      onDestroy === 'retain'
        ? physical.has(resourceKey)
        : !physical.has(resourceKey),
    );
  const finalReadinessEligible =
    head.phase === 'READY' ||
    (head.activeOperation !== null &&
      head.activeOperation.intents.every(
        (
          /** @type {Readonly<Record<string, any>>} */ { status: intentStatus },
        ) => intentStatus === 'settled',
      ));
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
              : destroying
                ? 'in-flight'
                : allPresent && finalReadinessEligible
                  ? 'converged'
                  : 'in-flight';
  const durableNodeBinding = head.resourceBindings.find(
    (/** @type {Readonly<Record<string, any>>} */ binding) =>
      binding.resourceKey === 'substrate',
  );
  const claimsHealthy = status === 'converged';
  const healthReceipt =
    claimsHealthy &&
    durableNodeBinding !== undefined &&
    healthReceiptOverrides !== null
      ? makeHealthObservation(
          base,
          head,
          durableNodeBinding,
          healthReceiptOverrides,
        )
      : null;
  const evidenceResourceKey = physical.has('substrate')
    ? 'substrate'
    : RESOURCES.find(({ resourceKey }) => physical.has(resourceKey))
        ?.resourceKey;
  const resources = RESOURCES.map((resource) => {
    const binding = physical.get(resource.resourceKey);
    const reappeared = resource.resourceKey === reappearedResourceKey;
    const present = binding !== undefined || reappeared;
    const hasExactBinding = binding !== undefined && !reappeared;
    const finalDigestOverride =
      resource.resourceKey === finalDigestOverrideResourceKey;
    return {
      resourceKey: resource.resourceKey,
      capability: resource.capability,
      role: resource.role,
      management: 'managed',
      ownershipMode: resource.ownershipMode,
      dependsOn: resource.dependsOn,
      onDestroy: resource.onDestroy,
      bindingId:
        hasExactBinding &&
        !(
          resource.resourceKey === evidenceResourceKey &&
          inspectionEvidence !== null
        )
          ? binding.bindingId
          : null,
      dependencyBindings:
        hasExactBinding &&
        !(
          resource.resourceKey === evidenceResourceKey &&
          inspectionEvidence !== null
        )
          ? binding.dependencyBindings
          : null,
      presence: present ? 'present' : 'absent',
      presenceEvidence: present ? 'exact-read' : 'authoritative-not-found',
      ownership:
        present &&
        resource.resourceKey === evidenceResourceKey &&
        inspectionEvidence !== null
          ? inspectionEvidence
          : hasExactBinding
            ? 'verified'
            : 'missing',
      providerIdentity: present
        ? {
            providerType: binding?.providerType || resource.providerType,
            providerResourceId:
              binding?.providerResourceId ||
              providerResourceId(resource.resourceKey),
          }
        : null,
      desiredDigest: digest(
        finalDigestOverride
          ? `${resource.resourceKey}-wrong-final-target`
          : resource.resourceKey,
      ),
      observedDigest: present
        ? digest(
            finalDigestOverride
              ? `${resource.resourceKey}-wrong-final-target`
              : resource.resourceKey === inspectionStateDriftResourceKey
                ? `${resource.resourceKey}-drifted`
                : resource.resourceKey,
          )
        : null,
      health: present
        ? resource.resourceKey === 'substrate'
          ? claimsHealthy
            ? 'healthy'
            : 'starting'
          : 'not-applicable'
        : 'absent',
      service:
        present && resource.resourceKey === 'substrate'
          ? {
              health: claimsHealthy ? 'healthy' : 'starting',
              artifactId: base.deploymentRevision.artifactId,
              revisionId: base.deploymentRevision.revisionId,
              healthReceipt,
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
    {
      profile: base.profile,
      providerSpec: base.providerSpec,
      head,
      pendingBinding,
      now: HEALTH_NOW,
    },
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
    /** @param {Readonly<Record<string, any>>} value */
    replaceHeadForTest(value) {
      head = validateDeploymentHead(clone(value));
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
  /** @type {{actionId: string, resourceKey: string|null}|null} */
  let driftAfterEffect = null;
  /** @type {{actionId: string, resourceKey: string}|null} */
  let removePhysicalAfterEffect = null;
  /** @type {string|null} */
  let wrongDependencySettlementActionId = null;
  /** @type {string|null} */
  let inspectionStateDriftResourceKey = null;
  /** @type {string|null} */
  let reappearedResourceKey = null;
  /** @type {{actionId: string, resourceKey: string}|null} */
  let reappearAfterEffect = null;
  /** @type {string|null} */
  let finalDigestOverrideResourceKey = null;
  /** @type {Record<string, any>|null} */
  let healthReceiptOverrides = {};
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
    /** @param {Record<string, any>} _context */
    async resolveProviderSpec(_context) {
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
            healthReceiptOverrides,
            reappearedResourceKey,
            finalDigestOverrideResourceKey,
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
        physical.set(
          action.resourceKey,
          makeBinding(
            base,
            action,
            nonce,
            undefined,
            undefined,
            context.head.resourceBindings,
          ),
        );
      }
      if (crashAfterEffectActionId === action.actionId) {
        crashAfterEffectActionId = null;
        throw new Error('injected crash after physical effect');
      }
      const drift = driftAfterEffect;
      if (drift !== null && drift.actionId === action.actionId) {
        inspectionStateDriftResourceKey =
          drift.resourceKey ?? action.resourceKey;
        driftAfterEffect = null;
      }
      const removal = removePhysicalAfterEffect;
      if (removal !== null && removal.actionId === action.actionId) {
        physical.delete(removal.resourceKey);
        removePhysicalAfterEffect = null;
      }
      const reappearance = reappearAfterEffect;
      if (reappearance !== null && reappearance.actionId === action.actionId) {
        reappearedResourceKey = reappearance.resourceKey;
        reappearAfterEffect = null;
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
      if (
        binding !== undefined &&
        wrongDependencySettlementActionId === action.actionId
      ) {
        wrongDependencySettlementActionId = null;
        const dependencies = clone(binding.dependencyBindings);
        const wrongBinding = context.head.resourceBindings.find(
          (/** @type {Readonly<Record<string, any>>} */ candidate) =>
            candidate.bindingId !== dependencies[0]?.bindingId,
        );
        if (dependencies.length === 0 || wrongBinding === undefined) {
          throw new Error(
            'test wrong dependency settlement requires a dependency and alternate binding',
          );
        }
        dependencies[0].bindingId = wrongBinding.bindingId;
        const corrupted = /** @type {Record<string, any>} */ (clone(binding));
        delete corrupted.bindingId;
        corrupted.dependencyBindings = dependencies;
        return {
          status: 'converged',
          binding: createDeploymentResourceBinding(corrupted),
        };
      }
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
    /** @param {Record<string, any>|null} value */
    setHealthReceiptOverrides(value) {
      healthReceiptOverrides = value;
    },
    /** @param {string} actionId */
    crashAfterPhysicalEffect(actionId) {
      crashAfterEffectActionId = actionId;
    },
    /** @param {string} actionId @param {string|null} [resourceKey] */
    driftAfterPhysicalEffect(actionId, resourceKey = null) {
      driftAfterEffect = { actionId, resourceKey };
    },
    /** @param {string} actionId @param {string} resourceKey */
    removePhysicalDependencyAfterEffect(actionId, resourceKey) {
      removePhysicalAfterEffect = { actionId, resourceKey };
    },
    /** @param {string|null} resourceKey */
    setReappearedResource(resourceKey) {
      reappearedResourceKey = resourceKey;
    },
    /** @param {string} actionId @param {string} resourceKey */
    reappearAfterPhysicalEffect(actionId, resourceKey) {
      reappearAfterEffect = { actionId, resourceKey };
    },
    /** @param {string|null} resourceKey */
    setFinalDigestOverride(resourceKey) {
      finalDigestOverrideResourceKey = resourceKey;
    },
    /** @param {string} actionId */
    returnWrongDependencySettlement(actionId) {
      wrongDependencySettlementActionId = actionId;
    },
  };
}

/** @param {'missing'|'wrong'|null} corruption */
function makeReadyState(corruption = null) {
  const base = makeContext();
  const applyPlan = makePlan(base, makeAbsentInspection(base), 'apply');
  /** @type {Readonly<Record<string, any>>[]} */
  const bindings = [];
  for (let index = 0; index < applyPlan.actions.length; index += 1) {
    const action = applyPlan.actions[index];
    bindings.push(
      makeBinding(
        base,
        action,
        createOwnershipNonce(Buffer.alloc(32, index + 1)),
        undefined,
        undefined,
        bindings,
      ),
    );
  }
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
        resourceKey !== 'control-state-attachment',
    );
  } else if (corruption === 'wrong') {
    const targetAction = applyPlan.actions.find(
      (/** @type {Readonly<Record<string, any>>} */ action) =>
        action.resourceKey === 'control-state-attachment',
    );
    if (targetAction === undefined) {
      throw new Error('Missing control-state attachment test action.');
    }
    durableBindings = bindings.map(
      (/** @type {Readonly<Record<string, any>>} */ binding) =>
        binding.resourceKey === 'control-state-attachment'
          ? makeBinding(
              base,
              targetAction,
              binding.ownershipNonce,
              'wrong-provider-resource-control-state-attachment',
              binding.createdByActionId,
              bindings,
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
 * @param {Readonly<Record<string, any>>[]} resourceBindings
 */
function replaceReadyBindings(ready, resourceBindings) {
  return createDeploymentHead({
    deploymentInstanceId: ready.head.deploymentInstanceId,
    providerScope: ready.head.providerScope,
    incarnationId: ready.head.incarnationId,
    generation: ready.head.generation,
    phase: 'READY',
    settledDeploymentRevisionId: ready.head.settledDeploymentRevisionId,
    targetDeploymentRevisionId: ready.head.targetDeploymentRevisionId,
    resourceBindings,
    activeOperation: null,
    lastOperation: {
      kind: ready.head.lastOperation.kind,
      planId: ready.head.lastOperation.planId,
      intents: ready.head.lastOperation.intents.map(
        (/** @type {Readonly<Record<string, any>>} */ intent) => ({
          actionId: intent.actionId,
          status: intent.status,
          ownershipNonce: intent.ownershipNonce,
        }),
      ),
    },
  });
}

/**
 * @param {Readonly<Record<string, any>>} head
 * @param {Readonly<Record<string, any>>[]} resourceBindings
 */
function replaceActiveBindings(head, resourceBindings) {
  if (head.activeOperation === null) {
    throw new Error('Test head must contain an active operation.');
  }
  const copyOperation = (
    /** @type {Readonly<Record<string, any>>} */ operation,
  ) => ({
    kind: operation.kind,
    planId: operation.planId,
    status: operation.status,
    nextActionIndex: operation.nextActionIndex,
    intents: operation.intents.map(
      (/** @type {Readonly<Record<string, any>>} */ intent) => ({
        actionId: intent.actionId,
        status: intent.status,
        ownershipNonce: intent.ownershipNonce,
      }),
    ),
  });
  return createDeploymentHead({
    deploymentInstanceId: head.deploymentInstanceId,
    providerScope: head.providerScope,
    incarnationId: head.incarnationId,
    generation: head.generation,
    phase: head.phase,
    settledDeploymentRevisionId: head.settledDeploymentRevisionId,
    targetDeploymentRevisionId: head.targetDeploymentRevisionId,
    resourceBindings,
    activeOperation: copyOperation(head.activeOperation),
    lastOperation:
      head.lastOperation === null
        ? null
        : {
            kind: head.lastOperation.kind,
            planId: head.lastOperation.planId,
            intents: head.lastOperation.intents.map(
              (/** @type {Readonly<Record<string, any>>} */ intent) => ({
                actionId: intent.actionId,
                status: intent.status,
                ownershipNonce: intent.ownershipNonce,
              }),
            ),
          },
  });
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

/** @param {{head?: Readonly<Record<string, any>>|null, plans?: Readonly<Record<string, any>>[], physical?: Map<string, Readonly<Record<string, any>>>}} [options] */
function makeHarness(options = {}) {
  const base = makeContext();
  /** @type {string[]} */
  const events = [];
  const physical = options.physical || new Map();
  const store = makeStore(options.head || null, options.plans || [], events);
  const provider = makeProvider(base, store, physical, events);
  const artifactStager = makeArtifactStager(base, events);
  let currentNow = HEALTH_NOW;
  const controller = createDeploymentController({
    store: store.api,
    provider: provider.api,
    artifactStager: artifactStager.api,
    now: () => currentNow,
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
    /** @param {number} value */
    setNow(value) {
      currentNow = value;
    },
  };
}

/** @param {ReturnType<typeof makeHarness>} harness @param {'apply'|'reconcile'|'destroy'} operation */
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
      now: () => HEALTH_NOW,
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
  it('pins exact provider reads before acceptance and never rediscovers them during recovery or READY lineage', async () => {
    const harness = makeHarness();
    const parameterName = AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64;
    const imageId = harness.base.providerSpec.machineImage.imageId;
    /** @type {Record<string, any>[]} */
    const parameterRequests = [];
    /** @type {Record<string, any>[]} */
    const imageRequests = [];
    /** @type {Record<string, any>[]} */
    const availabilityZoneRequests = [];
    /** @type {Record<string, any>[]} */
    const offeringRequests = [];
    /** @type {Record<string, any>[]} */
    const kmsKeyRequests = [];
    const client = {
      /** @param {Record<string, any>} request */
      async getParameter(request) {
        parameterRequests.push(clone(request));
        harness.events.push(`provider-spec:ssm:${request.Name}`);
        const versioned = request.Name === `${parameterName}:42`;
        return {
          Parameter: {
            Name: parameterName,
            Type: 'String',
            Value: imageId,
            Version: 42,
            LastModifiedDate: new Date('2026-01-01T00:00:00.000Z'),
            ARN: `arn:aws:ssm:us-east-1::parameter${parameterName}`,
            DataType: 'text',
            ...(versioned ? { Selector: ':42' } : {}),
          },
        };
      },
      /** @param {Record<string, any>} request */
      async describeImages(request) {
        imageRequests.push(clone(request));
        harness.events.push(`provider-spec:ec2:${request.ImageIds[0]}`);
        return {
          Images: [
            {
              ImageId: imageId,
              OwnerId: harness.base.providerSpec.machineImage.ownerAccountId,
              ImageOwnerAlias: 'amazon',
              Public: true,
              Architecture: 'x86_64',
              ImageType: 'machine',
              RootDeviceType: 'ebs',
              VirtualizationType: 'hvm',
              EnaSupport: true,
              State: 'available',
              PlatformDetails: 'Linux/UNIX',
              PublicSsmParameterName: parameterName.slice(1),
              ImageAllowed: true,
              DeprecationTime: '2027-01-01T00:00:00Z',
            },
          ],
        };
      },
      /** @param {Record<string, any>} request */
      async describeAvailabilityZones(request) {
        availabilityZoneRequests.push(clone(request));
        const availabilityZoneId =
          harness.base.providerSpec.placement.availabilityZoneId;
        harness.events.push(`provider-spec:az:${availabilityZoneId}`);
        return {
          AvailabilityZones: [
            {
              ZoneId: availabilityZoneId,
              ZoneName: 'us-east-1a',
              RegionName: 'us-east-1',
              ZoneType: 'availability-zone',
              State: 'available',
              OptInStatus: 'opt-in-not-required',
            },
          ],
        };
      },
      /** @param {Record<string, any>} request */
      async describeInstanceTypeOfferings(request) {
        offeringRequests.push(clone(request));
        const availabilityZoneId =
          harness.base.providerSpec.placement.availabilityZoneId;
        harness.events.push(`provider-spec:offering:${availabilityZoneId}`);
        return {
          InstanceTypeOfferings: [
            {
              InstanceType: harness.base.providerSpec.node.instanceType,
              LocationType: 'availability-zone-id',
              Location: availabilityZoneId,
            },
          ],
        };
      },
      /** @param {Record<string, any>} request */
      async getEbsDefaultKmsKeyId(request) {
        kmsKeyRequests.push(clone(request));
        harness.events.push('provider-spec:kms');
        return {
          KmsKeyId: harness.base.providerSpec.storage.ebsKmsKeyArn,
        };
      },
    };
    const resolver = createAwsSingleNodeProviderSpecResolver({
      client,
      providerScope: harness.base.providerScope,
      bootstrapDigest: digest('fixed bootstrap'),
      now: () => HEALTH_NOW,
      maxAttempts: 1,
      waitForRetry: async () => {},
    });
    harness.provider.api.resolveProviderSpec = resolver.resolveProviderSpec;
    harness.provider.api.validateProviderSpec = resolver.validateProviderSpec;

    const plan = await planWith(harness, 'apply');

    expect(plan.providerSpec).toEqual(harness.base.providerSpec);
    expect(parameterRequests).toEqual([
      { Name: parameterName, WithDecryption: false },
    ]);
    expect(imageRequests).toEqual([
      {
        ImageIds: [imageId],
        Owners: ['amazon'],
        IncludeDeprecated: true,
        IncludeDisabled: true,
      },
    ]);
    expect(availabilityZoneRequests).toHaveLength(1);
    expect(availabilityZoneRequests[0].ZoneIds).toBeUndefined();
    expect(offeringRequests).toHaveLength(1);
    expect(
      offeringRequests[0].Filters.find(
        (/** @type {any} */ filter) => filter.Name === 'location',
      ),
    ).toBeUndefined();
    expect(kmsKeyRequests).toEqual([{}]);

    harness.events.length = 0;
    harness.provider.crashAfterPhysicalEffect(plan.actions[0].actionId);
    await expect(
      harness.controller.converge({
        plan,
        profile: harness.base.profile,
      }),
    ).rejects.toThrow('injected crash after physical effect');

    const exactName = `${parameterName}:42`;
    expect(
      harness.events.filter(
        (event) =>
          event === 'artifact-stage' || event.startsWith('provider-spec:'),
      ),
    ).toEqual([
      `provider-spec:ssm:${exactName}`,
      `provider-spec:az:${harness.base.providerSpec.placement.availabilityZoneId}`,
      `provider-spec:offering:${harness.base.providerSpec.placement.availabilityZoneId}`,
      'provider-spec:kms',
      `provider-spec:ec2:${imageId}`,
      'artifact-stage',
      `provider-spec:ssm:${exactName}`,
      `provider-spec:az:${harness.base.providerSpec.placement.availabilityZoneId}`,
      `provider-spec:offering:${harness.base.providerSpec.placement.availabilityZoneId}`,
      'provider-spec:kms',
      `provider-spec:ec2:${imageId}`,
    ]);
    expect(parameterRequests).toEqual([
      { Name: parameterName, WithDecryption: false },
      { Name: exactName, WithDecryption: false },
      { Name: exactName, WithDecryption: false },
    ]);
    expect(imageRequests).toHaveLength(3);
    expect(availabilityZoneRequests).toHaveLength(3);
    expect(offeringRequests).toHaveLength(3);
    expect(kmsKeyRequests).toHaveLength(3);

    const acceptedReadCounts = {
      parameters: parameterRequests.length,
      images: imageRequests.length,
      availabilityZones: availabilityZoneRequests.length,
      offerings: offeringRequests.length,
      kmsKeys: kmsKeyRequests.length,
    };
    harness.events.length = 0;
    await expect(
      harness.controller.resume({
        deploymentInstanceId: harness.base.deploymentInstanceId,
      }),
    ).resolves.toMatchObject({ phase: 'READY' });

    const reconcilePlan = await planWith(harness, 'reconcile');
    await expect(
      harness.controller.converge({
        plan: reconcilePlan,
        profile: harness.base.profile,
      }),
    ).resolves.toMatchObject({ phase: 'READY' });

    expect(parameterRequests).toHaveLength(acceptedReadCounts.parameters);
    expect(imageRequests).toHaveLength(acceptedReadCounts.images);
    expect(availabilityZoneRequests).toHaveLength(
      acceptedReadCounts.availabilityZones,
    );
    expect(offeringRequests).toHaveLength(acceptedReadCounts.offerings);
    expect(kmsKeyRequests).toHaveLength(acceptedReadCounts.kmsKeys);
    expect(
      harness.events.filter((event) => event.startsWith('provider-spec:')),
    ).toEqual([]);
  });

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

  it('blocks READY when final provider state agrees on a digest outside the exact plan target', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    const wrongResourceKey = 'network-vpc';
    harness.store.setAfterCas((_previous, next) => {
      if (
        next.activeOperation?.nextActionIndex === plan.actions.length &&
        next.activeOperation.intents.every(
          (/** @type {Readonly<Record<string, any>>} */ { status }) =>
            status === 'settled',
        )
      ) {
        harness.provider.setFinalDigestOverride(wrongResourceKey);
      }
    });

    const head = await harness.controller.converge({
      plan,
      profile: harness.base.profile,
    });

    expect(head).toMatchObject({
      phase: 'CONVERGING',
      activeOperation: {
        nextActionIndex: plan.actions.length,
        status: 'blocked',
      },
    });
    expect(
      head.activeOperation.intents.every(
        (/** @type {Readonly<Record<string, any>>} */ { status }) =>
          status === 'settled',
      ),
    ).toBe(true);
  });

  it.each([
    ['missing proof', null],
    ['another node', { nodeProviderResourceId: 'i-0fedcba9876543210' }],
    ['another runtime role', { runtimeRoleId: 'AROA0987654321EXAMPLE' }],
    [
      'another incarnation',
      { incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 88)) },
    ],
    [
      'another operation',
      {
        deploymentOperationId: semanticId(
          DEPLOYMENT_OPERATION_ID_PREFIX,
          'wharfie:test:foreign-health-operation:v2',
          { operation: 1 },
        ),
      },
    ],
    [
      'a future head generation',
      { authorizedHeadGeneration: Number.MAX_SAFE_INTEGER },
    ],
    [
      'another release',
      {
        artifactId: createSha256Id({
          prefix: 'waf1',
          payload: 'foreign controller artifact',
        }),
      },
    ],
  ])(
    'does not finalize with service health proof for %s',
    async (_description, healthReceiptOverrides) => {
      const harness = makeHarness();
      const plan = await planWith(harness, 'apply');
      harness.provider.setHealthReceiptOverrides(healthReceiptOverrides);

      const head = await harness.controller.converge({
        plan,
        profile: harness.base.profile,
      });

      expect(head).toMatchObject({
        phase: 'CONVERGING',
        activeOperation: {
          nextActionIndex: plan.actions.length,
          status: 'blocked',
        },
      });
      expect(
        harness.store.head?.activeOperation?.intents.every(
          (/** @type {Readonly<Record<string, any>>} */ intent) =>
            intent.status === 'settled',
        ),
      ).toBe(true);
    },
  );

  it.each([
    ['stale', HEALTH_NOW + 65_001],
    ['too far in the future', HEALTH_NOW - 5_001],
  ])(
    'does not finalize with structurally valid but %s service health evidence',
    async (_description, now) => {
      const harness = makeHarness();
      const plan = await planWith(harness, 'apply');
      harness.setNow(now);

      const head = await harness.controller.converge({
        plan,
        profile: harness.base.profile,
      });

      expect(head).toMatchObject({
        phase: 'CONVERGING',
        activeOperation: {
          nextActionIndex: plan.actions.length,
          status: 'blocked',
        },
      });
    },
  );

  it('does not finalize reconcile with a fresh receipt from the prior settled operation', async () => {
    const ready = makeReadyState();
    const harness = makeHarness({
      head: ready.head,
      plans: [ready.applyPlan],
      physical: ready.physical,
    });
    const plan = await planWith(harness, 'reconcile');
    harness.provider.setHealthReceiptOverrides({
      deploymentOperationId: ready.head.lastOperation.operationId,
    });

    const head = await harness.controller.converge({
      plan,
      profile: harness.base.profile,
    });

    expect(head).toMatchObject({
      phase: 'CONVERGING',
      activeOperation: {
        kind: 'reconcile',
        nextActionIndex: plan.actions.length,
        status: 'blocked',
      },
    });
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

  it('blocks a dependent create when a settled dependency disappears before execution', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    const dependencyResourceKey = 'network-vpc';
    const dependentResourceKey = 'network-internet-gateway-attachment';
    const actionIndex = plan.actions.findIndex(
      (/** @type {Readonly<Record<string, any>>} */ action) =>
        action.resourceKey === dependentResourceKey,
    );
    if (actionIndex < 0) throw new Error('Missing dependent create action.');
    const action = plan.actions[actionIndex];
    let removed = false;
    harness.store.setAfterCas((_previous, next) => {
      if (
        !removed &&
        next.activeOperation?.nextActionIndex === actionIndex &&
        next.activeOperation.intents[actionIndex]?.status === 'pending'
      ) {
        harness.physical.delete(dependencyResourceKey);
        removed = true;
      }
    });

    const head = await harness.controller.converge({
      plan,
      profile: harness.base.profile,
    });

    expect(removed).toBe(true);
    expect(head).toMatchObject({
      phase: 'CONVERGING',
      activeOperation: {
        nextActionIndex: actionIndex,
        status: 'blocked',
      },
    });
    expect(head.activeOperation.intents[actionIndex].status).toBe('intended');
    expect(
      head.resourceBindings.some(
        (/** @type {Readonly<Record<string, any>>} */ binding) =>
          binding.resourceKey === dependencyResourceKey,
      ),
    ).toBe(true);
    expect(harness.physical.has(dependencyResourceKey)).toBe(false);
    expect(harness.physical.has(dependentResourceKey)).toBe(false);
    expect(harness.provider.executeCount.get(action.actionId) || 0).toBe(0);
  });

  it('blocks a dependent create when durable dependency creation lineage is replaced after settlement', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    const dependencyResourceKey = 'network-vpc';
    const dependentResourceKey = 'network-internet-gateway-attachment';
    const actionIndex = plan.actions.findIndex(
      (/** @type {Readonly<Record<string, any>>} */ action) =>
        action.resourceKey === dependentResourceKey,
    );
    if (actionIndex < 0) throw new Error('Missing dependent create action.');
    const action = plan.actions[actionIndex];
    let replaced = false;
    harness.store.setAfterCas((_previous, next) => {
      if (
        !replaced &&
        next.activeOperation?.nextActionIndex === actionIndex &&
        next.activeOperation.intents[actionIndex]?.status === 'pending'
      ) {
        const dependency = next.resourceBindings.find(
          (/** @type {Readonly<Record<string, any>>} */ binding) =>
            binding.resourceKey === dependencyResourceKey,
        );
        if (dependency === undefined) {
          throw new Error('Missing settled dependency binding.');
        }
        const replacementInput = /** @type {Record<string, any>} */ (
          clone(dependency)
        );
        delete replacementInput.bindingId;
        replacementInput.ownershipNonce = createOwnershipNonce(
          Buffer.alloc(32, 99),
        );
        replacementInput.createdByActionId = semanticId(
          DEPLOYMENT_ACTION_ID_PREFIX,
          'wharfie:test:foreign-create-lineage:v3',
          { resourceKey: dependencyResourceKey },
        );
        const replacement = createDeploymentResourceBinding(replacementInput);
        harness.physical.set(dependencyResourceKey, replacement);
        harness.store.replaceHeadForTest(
          replaceActiveBindings(
            next,
            next.resourceBindings.map(
              (/** @type {Readonly<Record<string, any>>} */ binding) =>
                binding.resourceKey === dependencyResourceKey
                  ? replacement
                  : binding,
            ),
          ),
        );
        replaced = true;
        throw new Error('injected crash after dependency lineage replacement');
      }
    });

    await expect(
      harness.controller.converge({
        plan,
        profile: harness.base.profile,
      }),
    ).rejects.toThrow(/progress frontier|lineage replacement/i);
    harness.store.setAfterCas(null);

    const head = await harness.controller.resume({
      deploymentInstanceId: harness.base.deploymentInstanceId,
    });

    expect(replaced).toBe(true);
    expect(head).toMatchObject({
      phase: 'CONVERGING',
      activeOperation: {
        nextActionIndex: actionIndex,
        status: 'blocked',
      },
    });
    expect(head.activeOperation.intents[actionIndex].status).toBe('intended');
    expect(harness.provider.executeCount.get(action.actionId) || 0).toBe(0);
  });

  it.each(['disappears', 'drifts'])(
    'does not publish a dependent binding when its dependency %s at settlement',
    async (dependencyChange) => {
      const harness = makeHarness();
      const plan = await planWith(harness, 'apply');
      const dependencyResourceKey = 'network-vpc';
      const dependentResourceKey = 'network-internet-gateway-attachment';
      const actionIndex = plan.actions.findIndex(
        (/** @type {Readonly<Record<string, any>>} */ action) =>
          action.resourceKey === dependentResourceKey,
      );
      if (actionIndex < 0) throw new Error('Missing dependent create action.');
      const action = plan.actions[actionIndex];
      if (dependencyChange === 'disappears') {
        harness.provider.removePhysicalDependencyAfterEffect(
          action.actionId,
          dependencyResourceKey,
        );
      } else {
        harness.provider.driftAfterPhysicalEffect(
          action.actionId,
          dependencyResourceKey,
        );
      }

      const head = await harness.controller.converge({
        plan,
        profile: harness.base.profile,
      });

      expect(head).toMatchObject({
        phase: 'CONVERGING',
        activeOperation: {
          nextActionIndex: actionIndex,
          status: 'blocked',
        },
      });
      expect(head.activeOperation.intents[actionIndex].status).toBe('intended');
      expect(harness.provider.executeCount.get(action.actionId)).toBe(1);
      expect(harness.physical.has(dependencyResourceKey)).toBe(
        dependencyChange === 'drifts',
      );
      expect(harness.physical.has(dependentResourceKey)).toBe(true);
      expect(
        head.resourceBindings.some(
          (/** @type {Readonly<Record<string, any>>} */ binding) =>
            binding.resourceKey === dependentResourceKey,
        ),
      ).toBe(false);
      for (const laterAction of plan.actions.slice(actionIndex + 1)) {
        expect(
          harness.provider.executeCount.get(laterAction.actionId) || 0,
        ).toBe(0);
      }
    },
  );

  it('recreates one missing leaf resource during reconcile with exact dependency lineage', async () => {
    const missingResourceKey = 'control-state-attachment';
    const ready = makeReadyState('missing');
    ready.physical.delete(missingResourceKey);
    const harness = makeHarness({
      head: ready.head,
      plans: [ready.applyPlan],
      physical: ready.physical,
    });
    const plan = await planWith(harness, 'reconcile');
    const action = plan.actions.find(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.resourceKey === missingResourceKey,
    );

    expect(action).toMatchObject({
      action: 'create',
      ownershipMode: 'derived',
      onDestroy: 'purge',
    });
    expect(
      plan.actions
        .filter(
          (/** @type {Readonly<Record<string, any>>} */ candidate) =>
            candidate.resourceKey !== missingResourceKey,
        )
        .every(
          (/** @type {Readonly<Record<string, any>>} */ candidate) =>
            candidate.action === 'noop',
        ),
    ).toBe(true);
    for (const dependencyResourceKey of action.dependsOn) {
      const historicalBinding = ready.head.resourceBindings.find(
        (/** @type {Readonly<Record<string, any>>} */ candidate) =>
          candidate.resourceKey === dependencyResourceKey,
      );
      const historicalAction = ready.applyPlan.actions.find(
        (/** @type {Readonly<Record<string, any>>} */ candidate) =>
          candidate.resourceKey === dependencyResourceKey,
      );
      const currentNoop = plan.actions.find(
        (/** @type {Readonly<Record<string, any>>} */ candidate) =>
          candidate.resourceKey === dependencyResourceKey,
      );
      expect(historicalBinding?.createdByActionId).toBe(
        historicalAction?.actionId,
      );
      expect(historicalBinding?.createdByActionId).not.toBe(
        currentNoop?.actionId,
      );
    }

    const head = await harness.controller.converge({
      plan,
      profile: harness.base.profile,
    });
    const binding = head.resourceBindings.find(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.resourceKey === missingResourceKey,
    );
    const expectedDependencyBindings = action.dependsOn
      .map((/** @type {string} */ resourceKey) => {
        const dependency = head.resourceBindings.find(
          (/** @type {Readonly<Record<string, any>>} */ candidate) =>
            candidate.resourceKey === resourceKey,
        );
        return { resourceKey, bindingId: dependency?.bindingId };
      })
      .sort(
        (
          /** @type {{resourceKey: string}} */ left,
          /** @type {{resourceKey: string}} */ right,
        ) => compareCanonicalStrings(left.resourceKey, right.resourceKey),
      );

    expect(head.phase).toBe('READY');
    expect(binding).toMatchObject({
      role: action.role,
      ownershipMode: action.ownershipMode,
      onDestroy: action.onDestroy,
      createdByActionId: action.actionId,
    });
    expect(binding?.dependencyBindings).toEqual(expectedDependencyBindings);
    expect(harness.provider.executeCount.get(action.actionId)).toBe(1);
  });

  it('rejects a created binding that settles against the wrong dependency binding', async () => {
    const harness = makeHarness();
    const plan = await planWith(harness, 'apply');
    const actionIndex = plan.actions.findIndex(
      (/** @type {Readonly<Record<string, any>>} */ action) =>
        action.resourceKey === 'network-internet-gateway-attachment',
    );
    const action = plan.actions[actionIndex];
    harness.provider.returnWrongDependencySettlement(action.actionId);

    await expect(
      harness.controller.converge({
        plan,
        profile: harness.base.profile,
      }),
    ).rejects.toThrow(/does not match the exact action/i);

    expect(harness.store.head).toMatchObject({
      phase: 'CONVERGING',
      activeOperation: {
        nextActionIndex: actionIndex,
        status: 'running',
      },
    });
    expect(
      harness.store.head?.activeOperation?.intents[actionIndex].status,
    ).toBe('intended');
    expect(harness.provider.executeCount.get(action.actionId)).toBe(1);
    for (const laterAction of plan.actions.slice(actionIndex + 1)) {
      expect(harness.provider.executeCount.get(laterAction.actionId) || 0).toBe(
        0,
      );
    }

    await expect(
      harness.controller.resume({
        deploymentInstanceId: harness.base.deploymentInstanceId,
      }),
    ).resolves.toMatchObject({ phase: 'READY' });
    expect(harness.provider.executeCount.get(action.actionId)).toBe(1);
  });
});

describe('deployment controller fencing', () => {
  it('rejects an extra valid generic durable binding before staging, effects, or a starting CAS', async () => {
    const ready = makeReadyState();
    const reconcilePlan = makePlan(
      ready.base,
      makeLiveInspection(ready.base, ready.head, ready.physical),
      'reconcile',
    );
    const extraBinding = createDeploymentResourceBinding({
      schemaVersion: 2,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: ready.base.deploymentInstanceId,
      incarnationId: ready.base.incarnationId,
      resourceKey: 'unplanned-transit-gateway',
      capability: { kind: 'networking', version: 1 },
      role: { kind: 'transit-gateway', version: 1 },
      management: 'managed',
      ownershipMode: 'direct',
      onDestroy: 'purge',
      dependencyBindings: [],
      providerType: 'ec2-transit-gateway',
      providerResourceId: 'tgw-unplanned',
      providerScopeId: ready.base.providerScope.providerScopeId,
      ownershipNonce: createOwnershipNonce(Buffer.alloc(32, 97)),
      createdByActionId: semanticId(
        DEPLOYMENT_ACTION_ID_PREFIX,
        'wharfie:test:unplanned-deployment-action:v3',
        { resourceKey: 'unplanned-transit-gateway' },
      ),
    });
    const head = replaceReadyBindings(ready, [
      ...ready.head.resourceBindings,
      extraBinding,
    ]);
    const harness = makeHarness({
      head,
      plans: [ready.applyPlan],
      physical: ready.physical,
    });

    await expect(
      harness.controller.converge({
        plan: reconcilePlan,
        profile: ready.base.profile,
      }),
    ).rejects.toThrow(/exact AWS single-node resource graph/i);

    expect(harness.store.head?.headId).toBe(head.headId);
    expect(harness.store.stats).toEqual({
      puts: 0,
      casAttempts: 0,
      casSuccesses: 0,
    });
    expect(harness.artifactStager.stageCount).toBe(0);
    expect(harness.provider.executeCount.size).toBe(0);
  });

  it('rejects a mismatched fixed-role durable binding before staging, effects, or a starting CAS', async () => {
    const ready = makeReadyState();
    const reconcilePlan = makePlan(
      ready.base,
      makeLiveInspection(ready.base, ready.head, ready.physical),
      'reconcile',
    );
    const originalBinding = ready.head.resourceBindings.find(
      (/** @type {Readonly<Record<string, any>>} */ binding) =>
        binding.resourceKey === 'control-state-attachment',
    );
    if (originalBinding === undefined) {
      throw new Error('Missing control-state attachment test binding.');
    }
    const mismatchedPayload = /** @type {Record<string, any>} */ (
      clone(originalBinding)
    );
    delete mismatchedPayload.bindingId;
    mismatchedPayload.role = { kind: 'wrong-attachment', version: 1 };
    const mismatchedBinding =
      createDeploymentResourceBinding(mismatchedPayload);
    const head = replaceReadyBindings(
      ready,
      ready.head.resourceBindings.map(
        (/** @type {Readonly<Record<string, any>>} */ binding) =>
          binding.resourceKey === mismatchedBinding.resourceKey
            ? mismatchedBinding
            : binding,
      ),
    );
    const harness = makeHarness({
      head,
      plans: [ready.applyPlan],
      physical: ready.physical,
    });

    await expect(
      harness.controller.converge({
        plan: reconcilePlan,
        profile: ready.base.profile,
      }),
    ).rejects.toThrow(/exact AWS single-node resource graph/i);

    expect(harness.store.head?.headId).toBe(head.headId);
    expect(harness.store.stats).toEqual({
      puts: 0,
      casAttempts: 0,
      casSuccesses: 0,
    });
    expect(harness.artifactStager.stageCount).toBe(0);
    expect(harness.provider.executeCount.size).toBe(0);
  });

  it('rejects an existing reconcile inspection with a missing resource role', async () => {
    const ready = makeReadyState();
    const harness = makeHarness({
      head: ready.head,
      plans: [ready.applyPlan],
      physical: ready.physical,
    });
    const inspect = harness.provider.api.inspect;
    harness.provider.api.inspect = async (context) => {
      const inspection = /** @type {Record<string, any>} */ (
        clone(await inspect(context))
      );
      const resource = inspection.resources.find(
        (/** @type {Record<string, any>} */ candidate) =>
          candidate.resourceKey === 'network-vpc',
      );
      delete resource.role;
      return inspection;
    };

    await expect(planWith(harness, 'reconcile')).rejects.toThrow(
      /role is required/i,
    );

    expect(harness.store.head?.headId).toBe(ready.head.headId);
    expect(harness.store.stats).toEqual({
      puts: 0,
      casAttempts: 0,
      casSuccesses: 0,
    });
    expect(harness.provider.executeCount.size).toBe(0);
  });

  it('refuses a valid alternate provider spec that bypasses READY planning', async () => {
    const ready = makeReadyState();
    const store = makeStore(ready.head, [ready.applyPlan]);
    const provider = makeProvider(ready.base, store, ready.physical);
    const controller = createDeploymentController({
      store: store.api,
      provider: provider.api,
      artifactStager: makeArtifactStager(ready.base).api,
      now: () => HEALTH_NOW,
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
          DEPLOYMENT_ACTION_ID_PREFIX,
          'wharfie:test:foreign-deployment-action:v3',
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
        now: () => HEALTH_NOW,
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
      },
    });
    expect(harness.store.head?.activeOperation?.intents[0].status).toBe(
      'settled',
    );
    expect(
      harness.store.head?.activeOperation?.intents
        .slice(1)
        .every(
          (/** @type {Readonly<Record<string, any>>} */ intent) =>
            intent.status === 'pending',
        ),
    ).toBe(true);
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
        now: () => HEALTH_NOW,
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
        now: () => HEALTH_NOW,
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

  it('settles an already absent delete without repeating the provider effect', async () => {
    const ready = makeReadyState();
    ready.physical.delete('control-state-attachment');
    const harness = makeHarness({
      head: ready.head,
      plans: [ready.applyPlan],
      physical: ready.physical,
    });
    const plan = await planWith(harness, 'destroy');
    const action = plan.actions[0];

    expect(action).toMatchObject({
      resourceKey: 'control-state-attachment',
      action: 'delete',
      onDestroy: 'purge',
    });

    const head = await harness.controller.converge({
      plan,
      profile: harness.base.profile,
    });

    expect(head.phase).toBe('DESTROYED');
    expect(harness.provider.executeCount.get(action.actionId) || 0).toBe(0);
    expect(
      harness.provider.verifyContexts.some(
        (context) => context.action.actionId === action.actionId,
      ),
    ).toBe(true);
    expect(
      head.resourceBindings.map(
        (/** @type {Readonly<Record<string, any>>} */ binding) =>
          binding.resourceKey,
      ),
    ).toEqual(['application-state', 'control-state']);
  });

  it.each([
    ['before the later effect', 'execution'],
    ['after the later effect and before settlement', 'settlement'],
  ])(
    'blocks destroy when a settled purge reappears %s',
    async (_description, reappearancePoint) => {
      const ready = makeReadyState();
      const harness = makeHarness({
        head: ready.head,
        plans: [ready.applyPlan],
        physical: ready.physical,
      });
      const plan = await planWith(harness, 'destroy');
      const priorResourceKey = 'control-state-attachment';
      const currentResourceKey = 'substrate';
      const actionIndex = plan.actions.findIndex(
        (/** @type {Readonly<Record<string, any>>} */ action) =>
          action.resourceKey === currentResourceKey,
      );
      if (actionIndex < 0) throw new Error('Missing later destroy action.');
      const action = plan.actions[actionIndex];
      if (reappearancePoint === 'execution') {
        harness.store.setAfterCas((_previous, next) => {
          if (
            next.activeOperation?.nextActionIndex === actionIndex &&
            next.activeOperation.intents[actionIndex]?.status === 'pending'
          ) {
            harness.provider.setReappearedResource(priorResourceKey);
          }
        });
      } else {
        harness.provider.reappearAfterPhysicalEffect(
          action.actionId,
          priorResourceKey,
        );
      }

      const head = await harness.controller.converge({
        plan,
        profile: harness.base.profile,
      });

      expect(head).toMatchObject({
        phase: 'DESTROYING',
        activeOperation: {
          nextActionIndex: actionIndex,
          status: 'blocked',
        },
      });
      expect(head.activeOperation.intents[actionIndex].status).toBe('intended');
      expect(
        head.resourceBindings.some(
          (/** @type {Readonly<Record<string, any>>} */ binding) =>
            binding.resourceKey === priorResourceKey,
        ),
      ).toBe(false);
      expect(harness.provider.executeCount.get(action.actionId) || 0).toBe(
        reappearancePoint === 'settlement' ? 1 : 0,
      );
      expect(harness.physical.has(currentResourceKey)).toBe(
        reappearancePoint === 'execution',
      );
    },
  );

  it('blocks DESTROYED when a retained resource final digest misses its exact plan target', async () => {
    const ready = makeReadyState();
    const harness = makeHarness({
      head: ready.head,
      plans: [ready.applyPlan],
      physical: ready.physical,
    });
    const plan = await planWith(harness, 'destroy');
    const retainedResourceKey = 'control-state';
    harness.store.setAfterCas((_previous, next) => {
      if (
        next.activeOperation?.nextActionIndex === plan.actions.length &&
        next.activeOperation.intents.every(
          (/** @type {Readonly<Record<string, any>>} */ { status }) =>
            status === 'settled',
        )
      ) {
        harness.provider.setFinalDigestOverride(retainedResourceKey);
      }
    });

    const head = await harness.controller.converge({
      plan,
      profile: harness.base.profile,
    });

    expect(head).toMatchObject({
      phase: 'DESTROYING',
      activeOperation: {
        nextActionIndex: plan.actions.length,
        status: 'blocked',
      },
    });
    expect(
      head.activeOperation.intents.every(
        (/** @type {Readonly<Record<string, any>>} */ { status }) =>
          status === 'settled',
      ),
    ).toBe(true);
  });

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
      now: () => HEALTH_NOW,
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
