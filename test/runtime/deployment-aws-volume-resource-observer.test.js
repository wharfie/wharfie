import { describe, expect, it } from '@jest/globals';

import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { createAwsSingleNodeResourceObservationAuthority } from '../../src/core/runtime/deployment-aws-resource-observation-authority.js';
import { getAwsSingleNodeManagedArtifactObjectLocation } from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import {
  AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES,
  createAwsSingleNodeVolumeResourceObserver,
} from '../../src/core/runtime/deployment-aws-volume-resource-observer.js';
import {
  AWS_SINGLE_NODE_VOLUME_STATE_DIGEST_DOMAIN,
  getAwsSingleNodeVolumeStateDigest,
} from '../../src/core/runtime/deployment-aws-volume-resource.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
import { createDeploymentPlan } from '../../src/core/runtime/deployment-plan.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import {
  createAwsProviderScope,
  getDeploymentInstanceId,
} from '../../src/core/runtime/deployment-provider-scope.js';
import {
  createDeploymentIncarnationId,
  createDeploymentResourceBinding,
  createOwnershipNonce,
} from '../../src/core/runtime/deployment-resource-binding.js';
import { validateDeploymentRevision } from '../../src/core/runtime/deployment-revision.js';

/** @typedef {Record<string, any>} AnyRecord */

const IDS = Object.freeze({
  application: 'vol-00000000000000001',
  control: 'vol-00000000000000002',
  other: 'vol-00000000000000003',
});
const CREATE_TIME = new Date('2026-07-23T12:00:00.000Z');
const OBSERVATION_KEYS = Object.freeze([
  'execution',
  'health',
  'observedDigest',
  'ownership',
  'presence',
  'providerIdentity',
  'resourceKey',
]);

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

/** @param {number} byte @returns {string} */
function nonce(byte) {
  return createOwnershipNonce(Buffer.alloc(32, byte));
}

/** @param {string} label @returns {{algorithm: 'sha256', value: string}} */
function digest(label) {
  return { algorithm: 'sha256', value: sha256Base64Url(label) };
}

/** @param {unknown} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/**
 * @param {{accountId?: string, incarnationByte?: number, revision?: number}} [options]
 * @returns {Readonly<AnyRecord>}
 */
function makeBase(options = {}) {
  const accountId = options.accountId ?? '123456789012';
  const revision = options.revision ?? 1;
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'volume-resource-observer-test',
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider('us-east-1'),
  });
  const revisionPayload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'production' },
    appId: profile.appId,
    revisionId: semanticId(
      'wrv1',
      'wharfie:test:volume-resource-observer-revision:v1',
      { appId: profile.appId, revision },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: `volume resource observer artifact ${revision}`,
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
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId,
    region: 'us-east-1',
  });
  const providerSpec = createAwsSingleNodeProviderSpec({
    profile,
    providerScope,
    machineImage: {
      sourceParameter: {
        name: AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64,
        version: 42,
      },
      imageId: 'ami-0123456789abcdef0',
      ownerAccountId: '137112412989',
      architecture: 'x86_64',
      imageType: 'machine',
      rootDeviceType: 'ebs',
      virtualizationType: 'hvm',
      enaSupport: true,
      rootDeviceName: '/dev/xvda',
      rootBlockDevice: {
        snapshotId: 'snap-0123456789abcdef0',
        volumeType: 'gp3',
        volumeSizeGiB: 8,
        encrypted: false,
        deleteOnTermination: true,
      },
    },
    placement: { availabilityZoneId: 'use1-az1' },
    storage: {
      ebsKmsKeyArn: `arn:aws:kms:us-east-1:${accountId}:key/11111111-2222-3333-4444-555555555555`,
    },
  });
  return Object.freeze({
    profile,
    deploymentRevision,
    providerScope,
    providerSpec,
    deploymentInstanceId: getDeploymentInstanceId({
      deploymentRevision,
      providerScope,
    }),
    incarnationId: createDeploymentIncarnationId(
      Buffer.alloc(32, options.incarnationByte ?? 77),
    ),
  });
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>|null} head */
function makeTargets(base, head) {
  return createAwsSingleNodeDesiredResourceTargetCatalog({
    deploymentRevision: base.deploymentRevision,
    profile: base.profile,
    providerScope: base.providerScope,
    providerSpec: base.providerSpec,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    head,
  });
}

/** @param {ReadonlyArray<Readonly<AnyRecord>>} targets @param {string} resourceKey */
function targetFor(targets, resourceKey) {
  const target = targets.find(
    (candidate) => candidate.resourceKey === resourceKey,
  );
  if (target === undefined) {
    throw new Error(`Missing fixture target '${resourceKey}'.`);
  }
  return target;
}

/** @param {Readonly<AnyRecord>} base */
function makeCreatePlan(base) {
  const targets = makeTargets(base, null);
  return createDeploymentPlan(
    {
      operation: 'apply',
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpec: base.providerSpec,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      basis: {
        headGeneration: 0,
        settledDeploymentRevisionId: null,
        inspectionId: semanticId(
          'win5',
          'wharfie:test:volume-resource-observer-inspection:v1',
          {
            deploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
          },
        ),
      },
      actions: targets.map((target) => ({
        resourceKey: target.resourceKey,
        capability: target.capability,
        role: target.role,
        management: target.management,
        ownershipMode: target.ownershipMode,
        dependsOn: target.dependsOn,
        onDestroy: target.onDestroy,
        action: 'create',
        destructive: false,
        reason: 'missing',
        before: null,
        after: target.target,
      })),
    },
    { profile: base.profile },
  );
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>} action */
function prefixProviderResourceId(base, action) {
  if (action.resourceKey === 'artifact') {
    return getAwsSingleNodeManagedArtifactObjectLocation({
      providerScope: base.providerScope,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
    }).arn;
  }
  if (action.resourceKey === 'application-state') return IDS.application;
  if (action.resourceKey === 'control-state') return IDS.control;
  throw new Error(`Unsupported prefix binding '${action.resourceKey}'.`);
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>} plan
 * @param {ReadonlyArray<Readonly<AnyRecord>>} intents
 * @param {number} frontier
 */
function makePrefixBindings(base, plan, intents, frontier) {
  return plan.actions
    .slice(0, frontier)
    .map(
      (
        /** @type {Readonly<AnyRecord>} */ action,
        /** @type {number} */ index,
      ) =>
        createDeploymentResourceBinding({
          schemaVersion: 2,
          kind: 'deploymentResourceBinding',
          deploymentInstanceId: base.deploymentInstanceId,
          incarnationId: base.incarnationId,
          resourceKey: action.resourceKey,
          capability: action.capability,
          role: action.role,
          management: action.management,
          ownershipMode: action.ownershipMode,
          onDestroy: action.onDestroy,
          dependencyBindings: [],
          providerType: action.after.providerType,
          providerResourceId: prefixProviderResourceId(base, action),
          providerScopeId: base.providerScope.providerScopeId,
          ownershipNonce: intents[index].ownershipNonce,
          createdByActionId: action.actionId,
        }),
    );
}

/**
 * @param {{mode?: 'bound'|'current-create'|'unbound', resourceKey?: 'application-state'|'control-state'|'artifact', base?: Readonly<AnyRecord>}} [options]
 */
function makeAuthorityFixture(options = {}) {
  const mode = options.mode ?? 'bound';
  const resourceKey = options.resourceKey ?? 'application-state';
  const base = options.base ?? makeBase();
  const plan = makeCreatePlan(base);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === resourceKey,
  );
  const action = plan.actions[actionIndex];
  if (action === undefined) {
    throw new Error(`Missing fixture action '${resourceKey}'.`);
  }
  const frontier = mode === 'bound' ? actionIndex + 1 : actionIndex;
  const currentStatus = mode === 'current-create' ? 'intended' : 'pending';
  const intents = plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ candidate,
      /** @type {number} */ index,
    ) => ({
      actionId: candidate.actionId,
      status:
        index < frontier
          ? 'settled'
          : index === frontier
            ? currentStatus
            : 'pending',
      ownershipNonce: nonce(100 + index),
    }),
  );
  const resourceBindings = makePrefixBindings(base, plan, intents, frontier);
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation:
      1 +
      frontier * 2 +
      (currentStatus === 'intended' && frontier < plan.actions.length ? 1 : 0),
    phase: 'CONVERGING',
    settledDeploymentRevisionId: null,
    targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    resourceBindings,
    activeOperation: {
      kind: 'create',
      planId: plan.planId,
      status: 'running',
      nextActionIndex: frontier,
      intents,
    },
    lastOperation: null,
  });
  const target = targetFor(makeTargets(base, head), resourceKey);
  const authority = createAwsSingleNodeResourceObservationAuthority({
    operation: 'apply',
    deploymentRevision: base.deploymentRevision,
    profile: base.profile,
    providerScope: base.providerScope,
    providerSpec: base.providerSpec,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    head,
    plan,
    settledPlan: null,
    target,
  });
  const binding = authority.binding;
  const currentAction = authority.currentAction;
  if (mode === 'bound' && binding === null) {
    throw new Error('Bound fixture requires a derived binding.');
  }
  if (mode === 'current-create' && currentAction === null) {
    throw new Error(
      'Current-create fixture requires derived action authority.',
    );
  }
  if (mode === 'unbound' && (binding !== null || currentAction !== null)) {
    throw new Error('Unbound fixture must expose no binding or action.');
  }
  return Object.freeze({
    mode,
    resourceKey,
    base,
    plan,
    action,
    actionIndex,
    head,
    target,
    authority,
  });
}

/**
 * @param {Readonly<AnyRecord>} plan
 * @param {Readonly<AnyRecord>} profile
 * @param {ReadonlyArray<Readonly<AnyRecord>>} actions
 */
function recreatePlanWithActions(plan, profile, actions) {
  return createDeploymentPlan(
    {
      operation: plan.operation,
      deploymentRevision: plan.deploymentRevision,
      providerScope: plan.providerScope,
      providerSpec: plan.providerSpec,
      deploymentInstanceId: plan.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      basis: plan.basis,
      actions: actions.map((action) => {
        const { actionId: _actionId, ...input } = action;
        return input;
      }),
    },
    { profile },
  );
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>} action
 * @param {string} ownershipNonce
 * @param {string} [createdByActionId]
 * @param {string} [providerResourceId]
 */
function makeVolumeBinding(
  base,
  action,
  ownershipNonce,
  createdByActionId = action.actionId,
  providerResourceId = IDS.application,
) {
  return createDeploymentResourceBinding({
    schemaVersion: 2,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    resourceKey: action.resourceKey,
    capability: action.capability,
    role: action.role,
    management: action.management,
    ownershipMode: action.ownershipMode,
    onDestroy: action.onDestroy,
    dependencyBindings: [],
    providerType: action.after.providerType,
    providerResourceId,
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce,
    createdByActionId,
  });
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>} settledStateDigest
 */
function makeSettledVolumeState(base, settledStateDigest) {
  const canonicalPlan = makeCreatePlan(base);
  const actionIndex = canonicalPlan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'application-state',
  );
  const actions = canonicalPlan.actions.map(
    (/** @type {Readonly<AnyRecord>} */ action, /** @type {number} */ index) =>
      index === actionIndex
        ? {
            ...action,
            after: {
              ...action.after,
              stateDigest: settledStateDigest,
            },
          }
        : action,
  );
  const plan = recreatePlanWithActions(canonicalPlan, base.profile, actions);
  const intents = plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ action,
      /** @type {number} */ index,
    ) => ({
      actionId: action.actionId,
      status: 'settled',
      ownershipNonce:
        action.management === 'managed' ? nonce(150 + index) : null,
    }),
  );
  const action = plan.actions[actionIndex];
  const binding = makeVolumeBinding(
    base,
    action,
    intents[actionIndex].ownershipNonce,
  );
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: plan.actions.length * 2 + 2,
    phase: 'READY',
    settledDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    resourceBindings: [binding],
    activeOperation: null,
    lastOperation: {
      kind: 'create',
      planId: plan.planId,
      intents,
    },
  });
  return { plan, intents, action, actionIndex, binding, head };
}

/**
 * @param {{status?: 'ready'|'pending'|'intended'|'settled'}} [options]
 */
function makeHistoricalBoundFixture(options = {}) {
  const status = options.status ?? 'ready';
  const settledBase = makeBase({ revision: 1 });
  const base = status === 'ready' ? makeBase({ revision: 2 }) : settledBase;
  const settledStateDigest = digest(
    `durable settled volume state for ${status}`,
  );
  const settled = makeSettledVolumeState(settledBase, settledStateDigest);
  /** @type {Readonly<AnyRecord>|null} */
  let plan = null;
  let head = settled.head;
  let action = settled.action;
  let actionIndex = settled.actionIndex;
  /** @type {Readonly<AnyRecord>|null} */
  let activeBeforeDigest = null;
  /** @type {Readonly<AnyRecord>|null} */
  let activeAfterDigest = null;

  if (status !== 'ready') {
    const targets = makeTargets(base, settled.head);
    activeBeforeDigest = digest(`active observed drift for ${status}`);
    activeAfterDigest = targetFor(targets, 'application-state').target
      .stateDigest;
    const actions = targets.map((/** @type {Readonly<AnyRecord>} */ target) => {
      if (target.resourceKey === 'application-state') {
        return {
          resourceKey: target.resourceKey,
          capability: target.capability,
          role: target.role,
          management: target.management,
          ownershipMode: target.ownershipMode,
          dependsOn: target.dependsOn,
          onDestroy: target.onDestroy,
          action: 'update',
          destructive: false,
          reason: 'deployment-change',
          before: {
            providerType: target.target.providerType,
            providerResourceId: settled.binding.providerResourceId,
            stateDigest: activeBeforeDigest,
          },
          after: target.target,
        };
      }
      return {
        resourceKey: target.resourceKey,
        capability: target.capability,
        role: target.role,
        management: target.management,
        ownershipMode: target.ownershipMode,
        dependsOn: target.dependsOn,
        onDestroy: target.onDestroy,
        action: 'create',
        destructive: false,
        reason: 'missing',
        before: null,
        after: target.target,
      };
    });
    plan = createDeploymentPlan(
      {
        operation: 'apply',
        deploymentRevision: base.deploymentRevision,
        providerScope: base.providerScope,
        providerSpec: base.providerSpec,
        deploymentInstanceId: base.deploymentInstanceId,
        incarnationId: base.incarnationId,
        basis: {
          headGeneration: settled.head.generation,
          settledDeploymentRevisionId:
            base.deploymentRevision.deploymentRevisionId,
          inspectionId: semanticId(
            'win5',
            'wharfie:test:volume-resource-observer-resident-inspection:v1',
            { status },
          ),
        },
        actions,
      },
      { profile: base.profile },
    );
    actionIndex = plan.actions.findIndex(
      (/** @type {Readonly<AnyRecord>} */ candidate) =>
        candidate.resourceKey === 'application-state',
    );
    action = plan.actions[actionIndex];
    const frontier = status === 'settled' ? actionIndex + 1 : actionIndex;
    const intents = plan.actions.map(
      (
        /** @type {Readonly<AnyRecord>} */ candidate,
        /** @type {number} */ index,
      ) => ({
        actionId: candidate.actionId,
        status:
          index < frontier
            ? 'settled'
            : index === frontier && status === 'intended'
              ? 'intended'
              : 'pending',
        ownershipNonce:
          candidate.resourceKey === 'application-state'
            ? settled.binding.ownershipNonce
            : candidate.management === 'managed'
              ? nonce(200 + index)
              : null,
      }),
    );
    head = createDeploymentHead({
      deploymentInstanceId: base.deploymentInstanceId,
      providerScope: base.providerScope,
      incarnationId: base.incarnationId,
      generation:
        settled.head.generation +
        1 +
        frontier * 2 +
        (status === 'intended' ? 1 : 0),
      phase: 'CONVERGING',
      settledDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
      targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
      resourceBindings: [settled.binding],
      activeOperation: {
        kind: 'reconcile',
        planId: plan.planId,
        status: 'running',
        nextActionIndex: frontier,
        intents,
      },
      lastOperation: settled.head.lastOperation,
    });
  }

  const target = targetFor(makeTargets(base, head), 'application-state');
  const authority = createAwsSingleNodeResourceObservationAuthority({
    operation: 'apply',
    deploymentRevision: base.deploymentRevision,
    profile: base.profile,
    providerScope: base.providerScope,
    providerSpec: base.providerSpec,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    head,
    plan,
    settledPlan: settled.plan,
    target,
  });
  return Object.freeze({
    mode: 'bound',
    resourceKey: 'application-state',
    base,
    plan,
    action,
    actionIndex,
    head,
    target,
    authority,
    settledStateDigest,
    activeBeforeDigest,
    activeAfterDigest,
  });
}

/**
 * @param {Readonly<AnyRecord>} fixture
 * @param {Readonly<AnyRecord>} replacementBinding
 */
function replacePartialCreateBinding(fixture, replacementBinding) {
  const {
    headId: _headId,
    schemaVersion: _schemaVersion,
    kind: _kind,
    ...headInput
  } = fixture.head;
  const head = createDeploymentHead({
    ...headInput,
    resourceBindings: fixture.head.resourceBindings.map(
      (/** @type {Readonly<AnyRecord>} */ candidate) =>
        candidate.resourceKey === fixture.resourceKey
          ? replacementBinding
          : candidate,
    ),
  });
  const target = targetFor(
    makeTargets(fixture.base, head),
    fixture.resourceKey,
  );
  const authority = /** @type {AnyRecord} */ (clone(fixture.authority));
  authority.head = head;
  authority.target = target;
  authority.binding = replacementBinding;
  return Object.freeze({
    ...fixture,
    head,
    target,
    authority,
  });
}

function makeMismatchedPartialCreateReceiptFixture() {
  const fixture = makeAuthorityFixture({ mode: 'bound' });
  const binding = fixture.authority.binding;
  return replacePartialCreateBinding(
    fixture,
    makeVolumeBinding(
      fixture.base,
      fixture.action,
      binding.ownershipNonce,
      semanticId(
        'wda3',
        'wharfie:test:volume-resource-observer-mismatched-receipt:v1',
        {},
      ),
    ),
  );
}

function makeNoncanonicalBoundVolumeIdFixture() {
  const fixture = makeAuthorityFixture({ mode: 'bound' });
  const binding = fixture.authority.binding;
  const forgedBinding = makeVolumeBinding(
    fixture.base,
    fixture.action,
    binding.ownershipNonce,
    binding.createdByActionId,
    'printable-but-not-an-ebs-volume-id',
  );
  const {
    headId: _headId,
    schemaVersion: _schemaVersion,
    kind: _kind,
    ...headInput
  } = fixture.head;
  const head = createDeploymentHead({
    ...headInput,
    resourceBindings: fixture.head.resourceBindings.map(
      (/** @type {Readonly<AnyRecord>} */ candidate) =>
        candidate.resourceKey === fixture.resourceKey
          ? forgedBinding
          : candidate,
    ),
  });
  const authority = /** @type {AnyRecord} */ (clone(fixture.authority));
  authority.head = head;
  authority.binding = forgedBinding;
  return Object.freeze({ ...fixture, head, authority });
}

/** @param {Readonly<AnyRecord>} fixture */
function receipt(fixture) {
  if (fixture.authority.binding !== null) {
    return {
      actionId: fixture.authority.binding.createdByActionId,
      ownershipNonce: fixture.authority.binding.ownershipNonce,
    };
  }
  if (fixture.authority.currentAction !== null) {
    return {
      actionId: fixture.authority.currentAction.action.actionId,
      ownershipNonce: fixture.authority.currentAction.ownershipNonce,
    };
  }
  return {
    actionId: fixture.action.actionId,
    ownershipNonce:
      fixture.head.activeOperation.intents[fixture.actionIndex].ownershipNonce,
  };
}

/**
 * @param {Readonly<AnyRecord>} fixture
 * @param {string} [stateDigestValue]
 * @returns {Record<string, string>}
 */
function expectedTags(
  fixture,
  stateDigestValue = fixture.target.target.stateDigest.value,
) {
  const exactReceipt = receipt(fixture);
  return {
    'wharfie:managed-by': 'wharfie',
    'wharfie:resource-kind': 'single-node-state-volume',
    'wharfie:retention': 'retain',
    'wharfie:schema-version': '2',
    'wharfie:capability': fixture.target.capability.kind,
    'wharfie:role': fixture.target.role.kind,
    'wharfie:provider-scope-id': fixture.base.providerScope.providerScopeId,
    'wharfie:deployment-instance-id': fixture.base.deploymentInstanceId,
    'wharfie:incarnation-id': fixture.base.incarnationId,
    'wharfie:resource-key': fixture.resourceKey,
    'wharfie:created-by-action-id': exactReceipt.actionId,
    'wharfie:ownership-nonce': exactReceipt.ownershipNonce,
    'wharfie:state-digest': stateDigestValue,
  };
}

/** @param {Record<string, string>} tags */
function tagArray(tags) {
  return Object.entries(tags)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([Key, Value]) => ({ Key, Value }));
}

/** @param {Readonly<AnyRecord>} fixture @param {AnyRecord} [overrides] */
function makeVolume(fixture, overrides = {}) {
  const configuration =
    fixture.resourceKey === 'application-state'
      ? fixture.base.providerSpec.capabilities.applicationState
      : fixture.base.providerSpec.capabilities.controlState;
  const volumeId =
    fixture.authority.binding?.providerResourceId ??
    (fixture.resourceKey === 'application-state'
      ? IDS.application
      : IDS.control);
  return {
    VolumeId: volumeId,
    AvailabilityZoneId: fixture.base.providerSpec.placement.availabilityZoneId,
    AvailabilityZone: 'us-east-1a',
    VolumeType: configuration.volumeType,
    Size: configuration.sizeGiB,
    Iops: configuration.iops,
    Throughput: configuration.throughputMiBps,
    MultiAttachEnabled: configuration.multiAttach,
    Encrypted: configuration.encrypted,
    KmsKeyId: fixture.base.providerSpec.storage.ebsKmsKeyArn,
    SnapshotId: '',
    State: 'available',
    CreateTime: new Date(CREATE_TIME),
    Attachments: [],
    Tags: tagArray(expectedTags(fixture)),
    FastRestored: false,
    SseType: 'sse-kms',
    ...overrides,
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} volume */
function observedDigest(fixture, volume) {
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEbsVolumeState',
    availabilityZoneId: volume.AvailabilityZoneId,
    kmsKeyArn: volume.KmsKeyId,
    volumeType: volume.VolumeType,
    sizeGiB: volume.Size,
    iops: volume.Iops,
    throughputMiBps: volume.Throughput,
    multiAttach: volume.MultiAttachEnabled,
    encrypted: volume.Encrypted,
    onDestroy: fixture.target.onDestroy,
  });
  return {
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_VOLUME_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  };
}

/** @param {Readonly<AnyRecord>} fixture */
function stableDiscoveryFilters(fixture) {
  const tags = expectedTags(fixture);
  return [
    'wharfie:managed-by',
    'wharfie:resource-kind',
    'wharfie:capability',
    'wharfie:role',
    'wharfie:provider-scope-id',
    'wharfie:deployment-instance-id',
    'wharfie:incarnation-id',
    'wharfie:resource-key',
  ].map((key) => ({ Name: `tag:${key}`, Values: [tags[key]] }));
}

/**
 * @param {ReadonlyArray<unknown|((request: Readonly<AnyRecord>, index: number) => unknown|Promise<unknown>)>} steps
 */
function scriptedDescribeVolumes(steps) {
  /** @type {Readonly<AnyRecord>[]} */
  const calls = [];
  let index = 0;
  const client = Object.freeze({
    async describeVolumes(/** @type {Readonly<AnyRecord>} */ request) {
      calls.push(request);
      const step = steps[index];
      index += 1;
      if (step === undefined) {
        throw new Error(`Unexpected DescribeVolumes call ${index}.`);
      }
      if (typeof step === 'function') return step(request, index - 1);
      if (step instanceof Error) throw step;
      return step;
    },
  });
  return { client, calls };
}

/** @param {string} name */
function namedError(name) {
  const error = new Error('provider detail must not escape');
  error.name = name;
  return error;
}

/** @param {string} resourceKey @param {'none'|'replay-safe-create'} [execution] */
function unknownObservation(resourceKey, execution = 'none') {
  return {
    resourceKey,
    presence: 'unknown',
    ownership: 'unknown',
    providerIdentity: null,
    observedDigest: null,
    health: 'unknown',
    execution,
  };
}

/** @param {string} resourceKey */
function absentObservation(resourceKey) {
  return {
    resourceKey,
    presence: 'absent',
    ownership: 'missing',
    providerIdentity: null,
    observedDigest: null,
    health: 'absent',
    execution: 'none',
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} volume @param {'verified'|'conflict'} ownership */
function presentObservation(fixture, volume, ownership) {
  return {
    resourceKey: fixture.resourceKey,
    presence: 'present',
    ownership,
    providerIdentity: {
      providerType: 'ebs-volume',
      providerResourceId: volume.VolumeId,
    },
    observedDigest:
      ownership === 'verified' ? observedDigest(fixture, volume) : null,
    health: 'not-applicable',
    execution: 'none',
  };
}

/**
 * @param {Readonly<AnyRecord>} fixture
 * @param {ReadonlyArray<unknown|((request: Readonly<AnyRecord>, index: number) => unknown|Promise<unknown>)>} steps
 * @param {{maxAttempts?: number, waitForRetry?: (attempt: number) => unknown|Promise<unknown>}} [options]
 */
function makeObserverHarness(fixture, steps, options = {}) {
  const scripted = scriptedDescribeVolumes(steps);
  /** @type {number[]} */
  const waits = [];
  const waitForRetry =
    options.waitForRetry ??
    (async (attempt) => {
      waits.push(attempt);
    });
  const observer = createAwsSingleNodeVolumeResourceObserver({
    client: scripted.client,
    providerScope: fixture.base.providerScope,
    maxAttempts: options.maxAttempts ?? 1,
    waitForRetry,
  });
  return { observer, calls: scripted.calls, waits };
}

describe('AWS single-node retained-volume resource observer', () => {
  it('accepts only its exact narrow factory dependencies and returns one frozen observe port', () => {
    const fixture = makeAuthorityFixture();
    const scripted = scriptedDescribeVolumes([]);
    const observer = createAwsSingleNodeVolumeResourceObserver({
      client: scripted.client,
      providerScope: fixture.base.providerScope,
      maxAttempts: 3,
      waitForRetry: async () => {},
    });

    expect(Object.keys(observer)).toEqual(['observe']);
    expect(typeof observer.observe).toBe('function');
    expectDeepFrozen(observer);

    for (const [label, options] of [
      ['null options', null],
      ['array options', []],
      ['missing dependencies', {}],
      ['missing provider scope', { client: scripted.client }],
      ['missing client', { providerScope: fixture.base.providerScope }],
      [
        'extra factory key',
        {
          client: scripted.client,
          providerScope: fixture.base.providerScope,
          credentials: 'secret',
        },
      ],
      [
        'missing client method',
        {
          client: Object.freeze({}),
          providerScope: fixture.base.providerScope,
        },
      ],
      [
        'extra client method',
        {
          client: Object.freeze({
            describeVolumes: async () => ({ Volumes: [] }),
            createVolume: async () => ({}),
          }),
          providerScope: fixture.base.providerScope,
        },
      ],
      [
        'zero attempts',
        {
          client: scripted.client,
          providerScope: fixture.base.providerScope,
          maxAttempts: 0,
        },
      ],
      [
        'too many attempts',
        {
          client: scripted.client,
          providerScope: fixture.base.providerScope,
          maxAttempts: 11,
        },
      ],
      [
        'non-numeric attempts',
        {
          client: scripted.client,
          providerScope: fixture.base.providerScope,
          maxAttempts: '3',
        },
      ],
      [
        'null retry waiter',
        {
          client: scripted.client,
          providerScope: fixture.base.providerScope,
          waitForRetry: null,
        },
      ],
    ]) {
      let accepted = true;
      try {
        createAwsSingleNodeVolumeResourceObserver(options);
      } catch {
        accepted = false;
      }
      expect({ label, accepted }).toEqual({ label, accepted: false });
    }
    expect(scripted.calls).toHaveLength(0);
  });

  it.each(['application-state', 'control-state'])(
    'observes the bound %s volume by exact ID with deterministic frozen verified evidence',
    async (resourceKey) => {
      const canonicalResourceKey =
        /** @type {'application-state'|'control-state'} */ (resourceKey);
      const fixture = makeAuthorityFixture({
        mode: 'bound',
        resourceKey: canonicalResourceKey,
      });
      const volume = makeVolume(fixture);
      const harness = makeObserverHarness(fixture, [
        { Volumes: [volume] },
        { Volumes: [volume] },
      ]);

      const first = await harness.observer.observe(fixture.authority);
      const second = await harness.observer.observe(clone(fixture.authority));

      expect(first).toEqual(presentObservation(fixture, volume, 'verified'));
      expect(second).toEqual(first);
      expect(Object.keys(first).sort()).toEqual([...OBSERVATION_KEYS].sort());
      expect(first.observedDigest).toEqual(
        getAwsSingleNodeVolumeStateDigest(
          fixture.base.providerSpec,
          fixture.target.capability.kind,
        ),
      );
      expectDeepFrozen(first);
      expect(harness.calls).toEqual([
        { VolumeIds: [volume.VolumeId] },
        { VolumeIds: [volume.VolumeId] },
      ]);
      for (const request of harness.calls) expectDeepFrozen(request);
    },
  );

  it('uses the READY settled-plan create digest instead of a prospective target digest', async () => {
    const fixture = makeHistoricalBoundFixture({ status: 'ready' });
    const historicalTags = expectedTags(
      fixture,
      fixture.settledStateDigest.value,
    );
    const prospectiveTags = expectedTags(fixture);
    const historical = makeVolume(fixture, {
      Tags: tagArray(historicalTags),
    });
    const prospective = makeVolume(fixture, {
      Tags: tagArray(prospectiveTags),
    });
    const harness = makeObserverHarness(fixture, [
      { Volumes: [historical] },
      { Volumes: [prospective] },
    ]);

    expect(fixture.settledStateDigest).not.toEqual(
      fixture.target.target.stateDigest,
    );
    await expect(harness.observer.observe(fixture.authority)).resolves.toEqual(
      presentObservation(fixture, historical, 'verified'),
    );
    await expect(harness.observer.observe(fixture.authority)).resolves.toEqual(
      presentObservation(fixture, prospective, 'conflict'),
    );
  });

  it.each(['pending', 'intended', 'settled'])(
    'uses resident settled-plan creation history for an active %s volume action',
    async (status) => {
      const canonicalStatus = /** @type {'pending'|'intended'|'settled'} */ (
        status
      );
      const fixture = makeHistoricalBoundFixture({ status: canonicalStatus });
      if (
        fixture.activeBeforeDigest === null ||
        fixture.activeAfterDigest === null
      ) {
        throw new Error('Active historical fixture requires both digests.');
      }
      const historical = makeVolume(fixture, {
        Tags: tagArray(expectedTags(fixture, fixture.settledStateDigest.value)),
      });
      const activeBefore = makeVolume(fixture, {
        Tags: tagArray(expectedTags(fixture, fixture.activeBeforeDigest.value)),
      });
      const activeAfter = makeVolume(fixture, {
        Tags: tagArray(expectedTags(fixture, fixture.activeAfterDigest.value)),
      });
      const harness = makeObserverHarness(fixture, [
        { Volumes: [historical] },
        { Volumes: [activeBefore] },
        { Volumes: [activeAfter] },
      ]);

      await expect(
        harness.observer.observe(fixture.authority),
      ).resolves.toEqual(presentObservation(fixture, historical, 'verified'));
      await expect(
        harness.observer.observe(fixture.authority),
      ).resolves.toEqual(presentObservation(fixture, activeBefore, 'conflict'));
      await expect(
        harness.observer.observe(fixture.authority),
      ).resolves.toEqual(presentObservation(fixture, activeAfter, 'conflict'));
    },
  );

  it('rejects a partial-create binding whose creation receipt does not match its settled action before I/O', async () => {
    const fixture = makeMismatchedPartialCreateReceiptFixture();
    const harness = makeObserverHarness(fixture, []);

    await expect(harness.observer.observe(fixture.authority)).rejects.toThrow();
    expect(harness.calls).toHaveLength(0);
  });

  it('rejects a generic bound provider ID that is not a canonical EBS volume ID before I/O', async () => {
    const fixture = makeNoncanonicalBoundVolumeIdFixture();
    const harness = makeObserverHarness(fixture, []);

    await expect(harness.observer.observe(fixture.authority)).rejects.toThrow();
    expect(harness.calls).toHaveLength(0);
  });

  it('reports bound readable configuration drift through the actual provider digest', async () => {
    const fixture = makeAuthorityFixture({ mode: 'bound' });
    const volume = makeVolume(fixture, {
      Size: fixture.base.providerSpec.capabilities.applicationState.sizeGiB + 1,
    });
    const harness = makeObserverHarness(fixture, [{ Volumes: [volume] }]);

    const observed = await harness.observer.observe(fixture.authority);

    expect(observed).toEqual(presentObservation(fixture, volume, 'verified'));
    expect(observed.observedDigest).not.toEqual(
      fixture.target.target.stateDigest,
    );
  });

  it.each([undefined, 'none'])(
    'reports readable unencrypted drift with provider SSE value %p',
    async (sseType) => {
      const fixture = makeAuthorityFixture({ mode: 'bound' });
      const volume = makeVolume(fixture, {
        Encrypted: false,
        KmsKeyId: null,
        SseType: sseType,
      });
      const harness = makeObserverHarness(fixture, [{ Volumes: [volume] }]);

      const observed = await harness.observer.observe(fixture.authority);

      expect(observed).toEqual(presentObservation(fixture, volume, 'verified'));
      expect(observed.observedDigest).not.toEqual(
        fixture.target.target.stateDigest,
      );
    },
  );

  it('keeps contradictory bound ownership tags distinct from readable state drift', async () => {
    const fixture = makeAuthorityFixture({ mode: 'bound' });
    const tags = expectedTags(fixture);
    tags['wharfie:ownership-nonce'] = nonce(240);
    const volume = makeVolume(fixture, { Tags: tagArray(tags) });
    const harness = makeObserverHarness(fixture, [{ Volumes: [volume] }]);

    await expect(harness.observer.observe(fixture.authority)).resolves.toEqual(
      presentObservation(fixture, volume, 'conflict'),
    );
  });

  it('retries typed exact-ID not-found without converting it into absence', async () => {
    const fixture = makeAuthorityFixture({ mode: 'bound' });
    const harness = makeObserverHarness(
      fixture,
      [
        namedError('InvalidVolume.NotFound'),
        namedError('InvalidVolume.NotFound'),
        namedError('InvalidVolume.NotFound'),
      ],
      { maxAttempts: 3 },
    );

    await expect(harness.observer.observe(fixture.authority)).resolves.toEqual(
      unknownObservation(fixture.resourceKey),
    );
    expect(harness.calls).toHaveLength(3);
    expect(harness.waits).toEqual([1, 2]);
    for (const request of harness.calls) {
      expect(request).toEqual({ VolumeIds: [IDS.application] });
      expectDeepFrozen(request);
    }
  });

  it('normalizes provider access failure to fixed unknown evidence', async () => {
    const fixture = makeAuthorityFixture({ mode: 'bound' });
    const harness = makeObserverHarness(
      fixture,
      [
        namedError('UnauthorizedOperation'),
        namedError('UnauthorizedOperation'),
        namedError('UnauthorizedOperation'),
      ],
      { maxAttempts: 3 },
    );

    await expect(harness.observer.observe(fixture.authority)).resolves.toEqual(
      unknownObservation(fixture.resourceKey),
    );
  });

  it.each([
    ['empty response with a pagination token', { Volumes: [], NextToken: 'x' }],
    [
      'multiple exact-ID results',
      {
        Volumes: [{ VolumeId: IDS.application }, { VolumeId: IDS.other }],
      },
    ],
    [
      'a result for a different volume ID',
      { Volumes: [{ VolumeId: IDS.other }] },
    ],
  ])(
    'normalizes bound %s to unknown rather than fabricating presence or conflict',
    async (_label, response) => {
      const fixture = makeAuthorityFixture({ mode: 'bound' });
      const harness = makeObserverHarness(fixture, [response]);

      await expect(
        harness.observer.observe(fixture.authority),
      ).resolves.toEqual(unknownObservation(fixture.resourceKey));
    },
  );

  it.each([
    ['invalid availability-zone ID', { AvailabilityZoneId: 'us-east-1a' }],
    ['unsupported volume type', { VolumeType: 'future-volume' }],
    ['malformed KMS ARN', { KmsKeyId: 'not-a-kms-arn' }],
    ['null size', { Size: null }],
    ['fractional IOPS', { Iops: 3000.5 }],
    ['string throughput', { Throughput: '125' }],
    ['null multi-attach flag', { MultiAttachEnabled: null }],
    ['null encryption flag', { Encrypted: null }],
    ['encrypted volume without a KMS key', { KmsKeyId: null }],
  ])(
    'normalizes bound provider state with %s to unknown rather than readable drift',
    async (_label, overrides) => {
      const fixture = makeAuthorityFixture({ mode: 'bound' });
      const volume = makeVolume(fixture, overrides);
      const harness = makeObserverHarness(fixture, [{ Volumes: [volume] }]);

      await expect(
        harness.observer.observe(fixture.authority),
      ).resolves.toEqual(unknownObservation(fixture.resourceKey));
    },
  );

  it.each([
    ['unencrypted state with a KMS key', { Encrypted: false, SseType: 'none' }],
    [
      'encrypted state with unencrypted SSE metadata',
      { Encrypted: true, SseType: 'none' },
    ],
    [
      'unencrypted state with encrypted SSE metadata',
      { Encrypted: false, KmsKeyId: null, SseType: 'sse-kms' },
    ],
  ])(
    'reports well-formed contradictory %s as present ownership conflict',
    async (_label, overrides) => {
      const fixture = makeAuthorityFixture({ mode: 'bound' });
      const volume = makeVolume(fixture, overrides);
      const harness = makeObserverHarness(fixture, [{ Volumes: [volume] }]);

      await expect(
        harness.observer.observe(fixture.authority),
      ).resolves.toEqual(presentObservation(fixture, volume, 'conflict'));
    },
  );

  it('discovers the exact current intended create receipt through stable locator tags', async () => {
    const fixture = makeAuthorityFixture({ mode: 'current-create' });
    const volume = makeVolume(fixture);
    const harness = makeObserverHarness(fixture, [{ Volumes: [volume] }]);

    const observed = await harness.observer.observe(fixture.authority);

    expect(fixture.authority.currentAction).toEqual({
      actionIndex: fixture.actionIndex,
      action: fixture.action,
      ownershipNonce:
        fixture.head.activeOperation.intents[fixture.actionIndex]
          .ownershipNonce,
    });
    expect(observed).toEqual(presentObservation(fixture, volume, 'verified'));
    expect(harness.calls).toEqual([
      {
        Filters: stableDiscoveryFilters(fixture),
        MaxResults: 500,
      },
    ]);
    expectDeepFrozen(harness.calls[0]);
  });

  it.each([
    ['bound', 'available'],
    ['bound', 'in-use'],
    ['current-create', 'available'],
    ['current-create', 'in-use'],
  ])(
    'accepts %s volume lifecycle state %s as readable verified evidence',
    async (mode, state) => {
      const canonicalMode = /** @type {'bound'|'current-create'} */ (mode);
      const fixture = makeAuthorityFixture({ mode: canonicalMode });
      const volume = makeVolume(fixture, { State: state });
      const harness = makeObserverHarness(fixture, [{ Volumes: [volume] }]);

      await expect(
        harness.observer.observe(fixture.authority),
      ).resolves.toEqual(presentObservation(fixture, volume, 'verified'));
    },
  );

  it.each(
    ['bound', 'current-create'].flatMap((mode) =>
      ['creating', 'deleting', 'deleted', 'error', 'future-state', null].map(
        (state) => [mode, state],
      ),
    ),
  )(
    'keeps %s volume lifecycle state %p unknown without execution authority',
    async (mode, state) => {
      const canonicalMode = /** @type {'bound'|'current-create'} */ (mode);
      const fixture = makeAuthorityFixture({ mode: canonicalMode });
      const volume = makeVolume(fixture, { State: state });
      const harness = makeObserverHarness(fixture, [{ Volumes: [volume] }]);

      await expect(
        harness.observer.observe(fixture.authority),
      ).resolves.toEqual(unknownObservation(fixture.resourceKey));
    },
  );

  it('returns replay-safe create authority only after bounded empty current-create discovery', async () => {
    const fixture = makeAuthorityFixture({ mode: 'current-create' });
    const harness = makeObserverHarness(
      fixture,
      [{ Volumes: [] }, { Volumes: [] }, { Volumes: [] }],
      { maxAttempts: 3 },
    );

    await expect(harness.observer.observe(fixture.authority)).resolves.toEqual(
      unknownObservation(fixture.resourceKey, 'replay-safe-create'),
    );
    expect(harness.calls).toHaveLength(3);
    expect(harness.waits).toEqual([1, 2]);
  });

  it.each([
    [
      'creating evidence',
      (/** @type {Readonly<AnyRecord>} */ fixture) => ({
        Volumes: [makeVolume(fixture, { State: 'creating' })],
      }),
    ],
    [
      'incomplete ownership tags',
      (/** @type {Readonly<AnyRecord>} */ fixture) => {
        const tags = expectedTags(fixture);
        delete tags['wharfie:ownership-nonce'];
        return {
          Volumes: [makeVolume(fixture, { Tags: tagArray(tags) })],
        };
      },
    ],
    ['provider access failure', () => namedError('UnauthorizedOperation')],
  ])(
    'does not grant replay-safe create after %s followed by an empty attempt',
    async (_label, firstResponse) => {
      const fixture = makeAuthorityFixture({ mode: 'current-create' });
      const harness = makeObserverHarness(
        fixture,
        [firstResponse(fixture), { Volumes: [] }],
        { maxAttempts: 2 },
      );

      await expect(
        harness.observer.observe(fixture.authority),
      ).resolves.toEqual(unknownObservation(fixture.resourceKey));
      expect(harness.calls).toHaveLength(2);
      expect(harness.waits).toEqual([1]);
    },
  );

  it.each([
    [
      'still creating',
      (/** @type {Readonly<AnyRecord>} */ fixture) =>
        makeVolume(fixture, { State: 'creating' }),
    ],
    [
      'incomplete ownership tags',
      (/** @type {Readonly<AnyRecord>} */ fixture) => {
        const tags = expectedTags(fixture);
        delete tags['wharfie:ownership-nonce'];
        return makeVolume(fixture, { Tags: tagArray(tags) });
      },
    ],
  ])(
    'never turns exhausted %s propagation into absence or replay authority',
    async (_label, makeEvidence) => {
      const fixture = makeAuthorityFixture({ mode: 'current-create' });
      const volume = makeEvidence(fixture);
      const harness = makeObserverHarness(
        fixture,
        [{ Volumes: [volume] }, { Volumes: [volume] }],
        { maxAttempts: 2 },
      );

      await expect(
        harness.observer.observe(fixture.authority),
      ).resolves.toEqual(unknownObservation(fixture.resourceKey));
      expect(harness.waits).toEqual([1]);
    },
  );

  it('returns conflict for one current-create candidate with contradictory ownership', async () => {
    const fixture = makeAuthorityFixture({ mode: 'current-create' });
    const tags = expectedTags(fixture);
    tags['wharfie:created-by-action-id'] = semanticId(
      'wda3',
      'wharfie:test:volume-resource-observer-conflicting-action:v1',
      {},
    );
    const volume = makeVolume(fixture, { Tags: tagArray(tags) });
    const harness = makeObserverHarness(fixture, [{ Volumes: [volume] }]);

    await expect(harness.observer.observe(fixture.authority)).resolves.toEqual(
      presentObservation(fixture, volume, 'conflict'),
    );
  });

  it('declares unbound absence only after every page and bounded attempt is empty', async () => {
    const fixture = makeAuthorityFixture({ mode: 'unbound' });
    const harness = makeObserverHarness(
      fixture,
      [
        { Volumes: [], NextToken: 'attempt-1-page-2' },
        { Volumes: [] },
        { Volumes: [], NextToken: 'attempt-2-page-2' },
        { Volumes: [] },
      ],
      { maxAttempts: 2 },
    );

    await expect(harness.observer.observe(fixture.authority)).resolves.toEqual(
      absentObservation(fixture.resourceKey),
    );
    expect(harness.waits).toEqual([1]);
    expect(harness.calls).toEqual([
      {
        Filters: stableDiscoveryFilters(fixture),
        MaxResults: 500,
      },
      {
        Filters: stableDiscoveryFilters(fixture),
        MaxResults: 500,
        NextToken: 'attempt-1-page-2',
      },
      {
        Filters: stableDiscoveryFilters(fixture),
        MaxResults: 500,
      },
      {
        Filters: stableDiscoveryFilters(fixture),
        MaxResults: 500,
        NextToken: 'attempt-2-page-2',
      },
    ]);
  });

  it.each([
    [
      'creating evidence',
      (/** @type {Readonly<AnyRecord>} */ claimed) => ({
        Volumes: [makeVolume(claimed, { State: 'creating' })],
      }),
    ],
    ['provider access failure', () => namedError('UnauthorizedOperation')],
    ['a malformed provider response', () => null],
  ])(
    'does not declare unbound absence after %s followed by an empty attempt',
    async (_label, firstResponse) => {
      const unbound = makeAuthorityFixture({ mode: 'unbound' });
      const claimed = makeAuthorityFixture({ mode: 'current-create' });
      const harness = makeObserverHarness(
        unbound,
        [firstResponse(claimed), { Volumes: [] }],
        { maxAttempts: 2 },
      );

      await expect(
        harness.observer.observe(unbound.authority),
      ).resolves.toEqual(unknownObservation(unbound.resourceKey));
      expect(harness.calls).toHaveLength(2);
      expect(harness.waits).toEqual([1]);
    },
  );

  it.each([
    ['absent tags', () => undefined],
    [
      'a missing locator tag',
      (/** @type {Readonly<AnyRecord>} */ fixture) => {
        const tags = expectedTags(fixture);
        delete tags['wharfie:resource-key'];
        return tagArray(tags);
      },
    ],
    [
      'a malformed locator tag',
      (/** @type {Readonly<AnyRecord>} */ fixture) => [
        ...tagArray(expectedTags(fixture)).filter(
          (tag) => tag.Key !== 'wharfie:resource-key',
        ),
        { Key: 'wharfie:resource-key', Value: null },
      ],
    ],
  ])(
    'keeps one unbound collision candidate with %s unknown',
    async (_label, tagsFor) => {
      const unbound = makeAuthorityFixture({ mode: 'unbound' });
      const claimed = makeAuthorityFixture({ mode: 'current-create' });
      const candidate = makeVolume(claimed, {
        Tags: tagsFor(unbound),
      });
      const harness = makeObserverHarness(unbound, [{ Volumes: [candidate] }]);

      await expect(
        harness.observer.observe(unbound.authority),
      ).resolves.toEqual(unknownObservation(unbound.resourceKey));
    },
  );

  it.each([
    [
      'a contradictory locator value',
      (/** @type {Readonly<AnyRecord>} */ fixture) => {
        const tags = expectedTags(fixture);
        tags['wharfie:resource-key'] = 'control-state';
        return tagArray(tags);
      },
    ],
    [
      'a duplicate locator tag',
      (/** @type {Readonly<AnyRecord>} */ fixture) => [
        ...tagArray(expectedTags(fixture)),
        {
          Key: 'wharfie:resource-key',
          Value: fixture.resourceKey,
        },
      ],
    ],
    [
      'an exact locator plus arbitrary receipt and non-Wharfie tags',
      (/** @type {Readonly<AnyRecord>} */ fixture) => {
        const tags = expectedTags(fixture);
        tags['wharfie:created-by-action-id'] = 'arbitrary-action';
        tags['wharfie:ownership-nonce'] = 'arbitrary-nonce';
        tags['wharfie:state-digest'] = 'arbitrary-state';
        return [
          ...tagArray(tags),
          { Key: 'owner-note', Value: 'not interpreted by Wharfie' },
        ];
      },
    ],
  ])(
    'reports one unbound collision candidate with %s only as conflict',
    async (_label, tagsFor) => {
      const unbound = makeAuthorityFixture({ mode: 'unbound' });
      const claimed = makeAuthorityFixture({ mode: 'current-create' });
      const candidate = makeVolume(claimed, {
        Tags: tagsFor(unbound),
      });
      const harness = makeObserverHarness(unbound, [{ Volumes: [candidate] }]);

      await expect(
        harness.observer.observe(unbound.authority),
      ).resolves.toEqual(presentObservation(unbound, candidate, 'conflict'));
    },
  );

  it('refuses adoption of one unbound candidate and keeps multiple candidates unknown', async () => {
    const unbound = makeAuthorityFixture({ mode: 'unbound' });
    const claimed = makeAuthorityFixture({ mode: 'current-create' });
    const candidate = makeVolume(claimed);
    const unique = makeObserverHarness(unbound, [{ Volumes: [candidate] }]);
    const multiple = makeObserverHarness(unbound, [
      {
        Volumes: [candidate, { ...candidate, VolumeId: IDS.other }],
      },
    ]);

    await expect(unique.observer.observe(unbound.authority)).resolves.toEqual(
      presentObservation(unbound, candidate, 'conflict'),
    );
    await expect(multiple.observer.observe(unbound.authority)).resolves.toEqual(
      unknownObservation(unbound.resourceKey),
    );
  });

  it('accepts one unique candidate only after complete pagination', async () => {
    const fixture = makeAuthorityFixture({ mode: 'current-create' });
    const volume = makeVolume(fixture);
    const harness = makeObserverHarness(fixture, [
      { Volumes: [], NextToken: 'page-2' },
      { Volumes: [volume] },
    ]);

    await expect(harness.observer.observe(fixture.authority)).resolves.toEqual(
      presentObservation(fixture, volume, 'verified'),
    );
    expect(harness.calls[1]).toEqual({
      Filters: stableDiscoveryFilters(fixture),
      MaxResults: 500,
      NextToken: 'page-2',
    });
    expectDeepFrozen(harness.calls[1]);
  });

  it('normalizes duplicate IDs across discovery pages to unknown', async () => {
    const fixture = makeAuthorityFixture({ mode: 'current-create' });
    const volume = makeVolume(fixture);
    const harness = makeObserverHarness(fixture, [
      { Volumes: [volume], NextToken: 'page-2' },
      { Volumes: [volume] },
    ]);

    await expect(harness.observer.observe(fixture.authority)).resolves.toEqual(
      unknownObservation(fixture.resourceKey),
    );
  });

  it('normalizes repeated pagination tokens to unknown', async () => {
    const fixture = makeAuthorityFixture({ mode: 'unbound' });
    const harness = makeObserverHarness(fixture, [
      { Volumes: [], NextToken: 'repeat' },
      { Volumes: [], NextToken: 'repeat' },
    ]);

    await expect(harness.observer.observe(fixture.authority)).resolves.toEqual(
      unknownObservation(fixture.resourceKey),
    );
  });

  it('enforces the bounded discovery-page limit', async () => {
    const fixture = makeAuthorityFixture({ mode: 'unbound' });
    const steps = Array.from(
      { length: AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES },
      (_value, index) => ({
        Volumes: [],
        NextToken: `page-${index + 2}`,
      }),
    );
    const harness = makeObserverHarness(fixture, steps);

    await expect(harness.observer.observe(fixture.authority)).resolves.toEqual(
      unknownObservation(fixture.resourceKey),
    );
    expect(harness.calls).toHaveLength(
      AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES,
    );
  });

  it.each([
    null,
    {},
    { Volumes: null },
    { Volumes: 'not-an-array' },
    { Volumes: [{}] },
    { Volumes: [], NextToken: '' },
  ])(
    'normalizes malformed provider envelope %# to unknown',
    async (response) => {
      const fixture = makeAuthorityFixture({ mode: 'unbound' });
      const harness = makeObserverHarness(fixture, [response]);

      await expect(
        harness.observer.observe(fixture.authority),
      ).resolves.toEqual(unknownObservation(fixture.resourceKey));
    },
  );

  it('rejects scope, routed target, and noncanonical authority before provider I/O', async () => {
    const fixture = makeAuthorityFixture({ mode: 'bound' });
    const otherScope = makeAuthorityFixture({
      mode: 'bound',
      base: makeBase({ accountId: '210987654321' }),
    });
    const wrongTarget = makeAuthorityFixture({
      mode: 'current-create',
      resourceKey: 'artifact',
    });
    const harness = makeObserverHarness(fixture, []);
    const extra = { ...clone(fixture.authority), credentials: 'secret' };
    const tamperedTarget = clone(fixture.authority);
    tamperedTarget.target.target.stateDigest = digest('tampered target');

    for (const authority of [
      otherScope.authority,
      wrongTarget.authority,
      extra,
      tamperedTarget,
    ]) {
      await expect(harness.observer.observe(authority)).rejects.toThrow();
    }
    expect(harness.calls).toHaveLength(0);
  });

  it('rejects forged bound-create and unbound-noncreate combinations before provider I/O', async () => {
    const bound = makeAuthorityFixture({ mode: 'bound' });
    const current = makeAuthorityFixture({ mode: 'current-create' });
    const unbound = makeAuthorityFixture({ mode: 'unbound' });
    const harness = makeObserverHarness(bound, []);

    const boundCreate = /** @type {AnyRecord} */ (clone(bound.authority));
    boundCreate.currentAction = clone(current.authority.currentAction);

    const unboundNoncreate = /** @type {AnyRecord} */ (
      clone(unbound.authority)
    );
    const forgedAction = /** @type {AnyRecord} */ (
      clone(current.authority.currentAction)
    );
    forgedAction.action.action = 'noop';
    forgedAction.action.reason = 'already-converged';
    forgedAction.action.before = clone(forgedAction.action.after);
    unboundNoncreate.currentAction = forgedAction;

    for (const authority of [boundCreate, unboundNoncreate]) {
      await expect(harness.observer.observe(authority)).rejects.toThrow();
    }
    expect(harness.calls).toHaveLength(0);
  });

  it('turns retry-wait failure into unknown without granting replay authority', async () => {
    const fixture = makeAuthorityFixture({ mode: 'current-create' });
    const harness = makeObserverHarness(fixture, [{ Volumes: [] }], {
      maxAttempts: 2,
      waitForRetry: async () => {
        throw new Error('wait detail must not escape');
      },
    });

    await expect(harness.observer.observe(fixture.authority)).resolves.toEqual(
      unknownObservation(fixture.resourceKey),
    );
    expect(harness.calls).toHaveLength(1);
  });
});
