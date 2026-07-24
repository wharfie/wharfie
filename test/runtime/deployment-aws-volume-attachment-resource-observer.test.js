import { describe, expect, it, jest } from '@jest/globals';

import { compareCanonicalStrings } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import { getAwsSingleNodeDefaultIpv4RouteProviderResourceId } from '../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import { createAwsSingleNodeDestroyedResourceLocator } from '../../src/core/runtime/deployment-aws-destroyed-resource-locator.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-evidence.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { createAwsSingleNodeResourceObservationAuthority } from '../../src/core/runtime/deployment-aws-resource-observation-authority.js';
import {
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
} from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import { getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId } from '../../src/core/runtime/deployment-aws-subnet-route-table-association-resource.js';
import {
  getAwsSingleNodeVolumeAttachmentObservedStateDigest,
  getAwsSingleNodeVolumeAttachmentProviderResourceId,
  getAwsSingleNodeVolumeAttachmentStateDigest,
  reconcileAwsSingleNodeVolumeAttachmentViews,
} from '../../src/core/runtime/deployment-aws-volume-attachment-evidence.js';
import {
  AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError,
  createAwsSingleNodeVolumeAttachmentResourceObserver,
} from '../../src/core/runtime/deployment-aws-volume-attachment-resource-observer.js';
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
import { getAwsSingleNodeResourceDestroyOrder } from '../../src/core/runtime/deployment-resource-graph.js';
import { validateDeploymentRevision } from '../../src/core/runtime/deployment-revision.js';

/** @typedef {Record<string, any>} AnyRecord */

const IDS = Object.freeze({
  applicationVolume: 'vol-00000000000000001',
  controlVolume: 'vol-00000000000000002',
  vpc: 'vpc-00000000000000001',
  internetGateway: 'igw-00000000000000001',
  subnet: 'subnet-00000000000000001',
  routeTable: 'rtb-00000000000000001',
  securityGroup: 'sg-00000000000000001',
  runtimeRole: 'AROA1234567890EXAMPLE',
  runtimeIdentity: 'AIPA1234567890EXAMPLE',
  substrate: 'i-00000000000000001',
});
const CASES = Object.freeze([
  Object.freeze({
    capabilityKind: 'application-state',
    deviceName: '/dev/sdf',
    resourceKey: 'application-state-attachment',
    volumeId: IDS.applicationVolume,
  }),
  Object.freeze({
    capabilityKind: 'control-state',
    deviceName: '/dev/sdg',
    resourceKey: 'control-state-attachment',
    volumeId: IDS.controlVolume,
  }),
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

/** @param {unknown} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @returns {Readonly<AnyRecord>} */
function makeBase() {
  const accountId = '123456789012';
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'volume-attachment-resource-observer-test',
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
      'wharfie:test:volume-attachment-resource-observer-revision:v1',
      { appId: profile.appId },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'volume attachment observer artifact',
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
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 77)),
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
          'win6',
          'wharfie:test:volume-attachment-resource-observer-inspection:v1',
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

/** @param {Readonly<AnyRecord>} base @param {string} resourceKey */
function providerResourceId(base, resourceKey) {
  switch (resourceKey) {
    case 'artifact':
      return getAwsSingleNodeManagedArtifactObjectLocation({
        providerScope: base.providerScope,
        deploymentInstanceId: base.deploymentInstanceId,
        incarnationId: base.incarnationId,
      }).arn;
    case 'application-state':
      return IDS.applicationVolume;
    case 'control-state':
      return IDS.controlVolume;
    case 'network-vpc':
      return IDS.vpc;
    case 'network-internet-gateway':
      return IDS.internetGateway;
    case 'network-internet-gateway-attachment':
      return getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
        IDS.internetGateway,
        IDS.vpc,
      );
    case 'network-subnet':
      return IDS.subnet;
    case 'network-route-table':
      return IDS.routeTable;
    case 'network-default-ipv4-route':
      return getAwsSingleNodeDefaultIpv4RouteProviderResourceId(
        base.providerSpec.capabilities.networking.egressCidr,
        IDS.internetGateway,
        IDS.routeTable,
      );
    case 'network-subnet-route-table-association':
      return getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId(
        IDS.routeTable,
        IDS.subnet,
      );
    case 'network-security-group':
      return IDS.securityGroup;
    case 'runtime-role':
      return IDS.runtimeRole;
    case 'runtime-role-policy':
      return getAwsSingleNodeRuntimePolicyProviderResourceId({
        runtimeRoleId: IDS.runtimeRole,
      });
    case 'runtime-identity':
      return IDS.runtimeIdentity;
    case 'runtime-identity-role-association':
      return getAwsSingleNodeRuntimeAssociationProviderResourceId({
        runtimeRoleId: IDS.runtimeRole,
        instanceProfileId: IDS.runtimeIdentity,
      });
    case 'substrate':
      return IDS.substrate;
    case 'application-state-attachment':
      return getAwsSingleNodeVolumeAttachmentProviderResourceId(
        base.providerSpec,
        'application-state',
        IDS.substrate,
        IDS.applicationVolume,
      );
    case 'control-state-attachment':
      return getAwsSingleNodeVolumeAttachmentProviderResourceId(
        base.providerSpec,
        'control-state',
        IDS.substrate,
        IDS.controlVolume,
      );
    default:
      throw new Error(`Unsupported fixture resource '${resourceKey}'.`);
  }
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>} plan
 * @param {ReadonlyArray<Readonly<AnyRecord>>} intents
 * @param {number} [limit]
 * @param {Readonly<Record<string, string>>} [createdByActionResourceKeys]
 */
function makeBindings(
  base,
  plan,
  intents,
  limit = plan.actions.length,
  createdByActionResourceKeys = {},
) {
  const bindingByKey = new Map();
  const bindings = [];
  for (let index = 0; index < limit; index += 1) {
    const action = plan.actions[index];
    const createdByResourceKey =
      createdByActionResourceKeys[action.resourceKey] ?? action.resourceKey;
    const createdByAction = plan.actions.find(
      (/** @type {Readonly<AnyRecord>} */ candidate) =>
        candidate.resourceKey === createdByResourceKey,
    );
    if (createdByAction === undefined) {
      throw new Error(
        `Missing created-by action fixture '${createdByResourceKey}'.`,
      );
    }
    const createdByActionIndex = plan.actions.indexOf(createdByAction);
    const binding = createDeploymentResourceBinding({
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
      dependencyBindings: action.dependsOn
        .map((/** @type {string} */ resourceKey) => ({
          resourceKey,
          bindingId: bindingByKey.get(resourceKey).bindingId,
        }))
        .sort(
          (
            /** @type {{resourceKey: string}} */ left,
            /** @type {{resourceKey: string}} */ right,
          ) => compareCanonicalStrings(left.resourceKey, right.resourceKey),
        ),
      providerType: action.after.providerType,
      providerResourceId: providerResourceId(base, action.resourceKey),
      providerScopeId: base.providerScope.providerScopeId,
      ownershipNonce: intents[createdByActionIndex].ownershipNonce,
      createdByActionId: createdByAction.actionId,
    });
    bindingByKey.set(action.resourceKey, binding);
    bindings.push(binding);
  }
  return bindings;
}

/**
 * @param {'bound'|'current-create'|'unbound'} mode
 * @param {string} resourceKey
 * @param {Readonly<Record<string, string>>} [createdByActionResourceKeys]
 * @returns {Readonly<AnyRecord>}
 */
function makeApplyFixture(mode, resourceKey, createdByActionResourceKeys = {}) {
  const base = makeBase();
  const plan = makeCreatePlan(base);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === resourceKey,
  );
  const frontier = mode === 'bound' ? actionIndex + 1 : actionIndex;
  const intents = plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ action,
      /** @type {number} */ index,
    ) => ({
      actionId: action.actionId,
      status:
        index < frontier
          ? 'settled'
          : index === frontier && mode === 'current-create'
            ? 'intended'
            : 'pending',
      ownershipNonce: nonce(100 + index),
    }),
  );
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 2 + frontier * 2,
    phase: 'CONVERGING',
    settledDeploymentRevisionId: null,
    targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    resourceBindings: makeBindings(
      base,
      plan,
      intents,
      frontier,
      createdByActionResourceKeys,
    ),
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
  return Object.freeze({
    mode,
    resourceKey,
    base,
    plan,
    head,
    target,
    authority,
    actionIndex,
  });
}

/** @param {string} resourceKey @returns {Readonly<AnyRecord>} */
function makeDeleteFixture(resourceKey) {
  const base = makeBase();
  const settledPlan = makeCreatePlan(base);
  const settledIntents = settledPlan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ action,
      /** @type {number} */ index,
    ) => ({
      actionId: action.actionId,
      status: 'settled',
      ownershipNonce: nonce(100 + index),
    }),
  );
  const settledBindings = makeBindings(base, settledPlan, settledIntents);
  const readyHead = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 2 + settledPlan.actions.length * 2,
    phase: 'READY',
    settledDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    resourceBindings: settledBindings,
    activeOperation: null,
    lastOperation: {
      kind: 'create',
      planId: settledPlan.planId,
      intents: settledIntents,
    },
  });
  const bindingByKey = new Map(
    settledBindings.map((binding) => [binding.resourceKey, binding]),
  );
  const targetByKey = new Map(
    makeTargets(base, readyHead).map((target) => [target.resourceKey, target]),
  );
  const plan = createDeploymentPlan(
    {
      operation: 'destroy',
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpec: base.providerSpec,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      basis: {
        headGeneration: readyHead.generation,
        settledDeploymentRevisionId:
          base.deploymentRevision.deploymentRevisionId,
        inspectionId: semanticId(
          'win6',
          'wharfie:test:volume-attachment-delete-inspection:v1',
          { headId: readyHead.headId, resourceKey },
        ),
      },
      actions: getAwsSingleNodeResourceDestroyOrder().map((key) => {
        const target = targetByKey.get(key);
        const binding = bindingByKey.get(key);
        if (target === undefined || binding === undefined) {
          throw new Error(`Missing destroy fixture '${key}'.`);
        }
        const before = {
          providerType: target.target.providerType,
          providerResourceId: binding.providerResourceId,
          stateDigest: target.target.stateDigest,
        };
        const retained = target.onDestroy === 'retain';
        return {
          resourceKey: target.resourceKey,
          capability: target.capability,
          role: target.role,
          management: target.management,
          ownershipMode: target.ownershipMode,
          dependsOn: target.dependsOn,
          onDestroy: target.onDestroy,
          action: retained ? 'noop' : 'delete',
          destructive: !retained,
          reason: retained ? 'retained-data' : 'destroy-requested',
          before,
          after: retained ? before : null,
        };
      }),
    },
    { profile: base.profile },
  );
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === resourceKey,
  );
  const intents = plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ action,
      /** @type {number} */ index,
    ) => ({
      actionId: action.actionId,
      status:
        index < actionIndex
          ? 'settled'
          : index === actionIndex
            ? 'intended'
            : 'pending',
      ownershipNonce:
        bindingByKey.get(action.resourceKey)?.ownershipNonce ?? null,
    }),
  );
  const deletedKeys = new Set(
    plan.actions
      .slice(0, actionIndex)
      .filter(
        (/** @type {Readonly<AnyRecord>} */ action) =>
          action.action === 'delete',
      )
      .map((/** @type {Readonly<AnyRecord>} */ action) => action.resourceKey),
  );
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: readyHead.generation + 2 + actionIndex * 2,
    phase: 'DESTROYING',
    settledDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: null,
    resourceBindings: settledBindings.filter(
      (binding) => !deletedKeys.has(binding.resourceKey),
    ),
    activeOperation: {
      kind: 'destroy',
      planId: plan.planId,
      status: 'running',
      nextActionIndex: actionIndex,
      intents,
    },
    lastOperation: readyHead.lastOperation,
  });
  const target = targetFor(makeTargets(base, head), resourceKey);
  const authority = createAwsSingleNodeResourceObservationAuthority({
    operation: 'destroy',
    deploymentRevision: base.deploymentRevision,
    profile: base.profile,
    providerScope: base.providerScope,
    providerSpec: base.providerSpec,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    head,
    plan,
    settledPlan,
    target,
  });
  return Object.freeze({
    mode: 'current-delete',
    resourceKey,
    base,
    plan,
    settledPlan,
    head,
    target,
    authority,
    actionIndex,
  });
}

/** @param {string} resourceKey @returns {Readonly<AnyRecord>} */
function makeDestroyedFixture(resourceKey) {
  const active = makeDeleteFixture(resourceKey);
  const createActionIndexByKey = new Map(
    active.settledPlan.actions.map(
      (
        /** @type {Readonly<AnyRecord>} */ action,
        /** @type {number} */ index,
      ) => [action.resourceKey, index],
    ),
  );
  const intents = active.plan.actions.map(
    (/** @type {Readonly<AnyRecord>} */ action) => {
      const createActionIndex = createActionIndexByKey.get(action.resourceKey);
      if (createActionIndex === undefined) {
        throw new Error(`Missing create receipt '${action.resourceKey}'.`);
      }
      return {
        actionId: action.actionId,
        status: 'settled',
        ownershipNonce: nonce(100 + createActionIndex),
      };
    },
  );
  const head = createDeploymentHead({
    deploymentInstanceId: active.base.deploymentInstanceId,
    providerScope: active.base.providerScope,
    incarnationId: active.base.incarnationId,
    generation: active.head.generation + active.plan.actions.length * 2 + 1,
    phase: 'DESTROYED',
    settledDeploymentRevisionId: null,
    targetDeploymentRevisionId: null,
    resourceBindings: active.head.resourceBindings.filter(
      (/** @type {Readonly<AnyRecord>} */ binding) =>
        binding.onDestroy === 'retain',
    ),
    activeOperation: null,
    lastOperation: {
      kind: 'destroy',
      planId: active.plan.planId,
      intents,
    },
  });
  const target = targetFor(makeTargets(active.base, head), resourceKey);
  const canonicalAuthority = createAwsSingleNodeResourceObservationAuthority({
    operation: 'destroy',
    deploymentRevision: active.base.deploymentRevision,
    profile: active.base.profile,
    providerScope: active.base.providerScope,
    providerSpec: active.base.providerSpec,
    deploymentInstanceId: active.base.deploymentInstanceId,
    incarnationId: active.base.incarnationId,
    head,
    plan: null,
    settledPlan: active.plan,
    target,
  });
  const destroyedResourceLocator =
    createAwsSingleNodeDestroyedResourceLocator(canonicalAuthority);
  if (destroyedResourceLocator === null) {
    throw new Error(`Missing destroyed locator '${resourceKey}'.`);
  }
  return Object.freeze({
    ...active,
    mode: 'destroyed',
    head,
    target,
    authority: Object.freeze({
      ...canonicalAuthority,
      destroyedResourceLocator,
    }),
    destroyedResourceLocator,
  });
}

/** @param {Readonly<AnyRecord>} fixture */
function fixtureCase(fixture) {
  const result = CASES.find(
    (candidate) => candidate.resourceKey === fixture.resourceKey,
  );
  if (result === undefined) throw new Error('Missing attachment case.');
  return result;
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [mappingOverrides] @param {Record<string, any>} [instanceOverrides] */
function instanceResponse(
  fixture,
  mappingOverrides = {},
  instanceOverrides = {},
) {
  const testCase = fixtureCase(fixture);
  return {
    Reservations: [
      {
        OwnerId: fixture.base.providerScope.accountId,
        Instances: [
          {
            InstanceId: IDS.substrate,
            Placement: {
              AvailabilityZoneId:
                fixture.base.providerSpec.placement.availabilityZoneId,
            },
            State: { Name: 'running', Code: 16 },
            BlockDeviceMappings: [
              {
                DeviceName: testCase.deviceName,
                Ebs: {
                  VolumeId: testCase.volumeId,
                  Status: 'attached',
                  DeleteOnTermination: false,
                  EbsCardIndex: 0,
                  ...mappingOverrides,
                },
              },
            ],
            ...instanceOverrides,
          },
        ],
      },
    ],
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [attachmentOverrides] @param {Record<string, any>} [volumeOverrides] */
function volumeResponse(
  fixture,
  attachmentOverrides = {},
  volumeOverrides = {},
) {
  const testCase = fixtureCase(fixture);
  return {
    Volumes: [
      {
        VolumeId: testCase.volumeId,
        AvailabilityZoneId:
          fixture.base.providerSpec.placement.availabilityZoneId,
        State: 'in-use',
        MultiAttachEnabled: false,
        Attachments: [
          {
            VolumeId: testCase.volumeId,
            InstanceId: IDS.substrate,
            Device: testCase.deviceName,
            State: 'attached',
            DeleteOnTermination: false,
            EbsCardIndex: 0,
            ...attachmentOverrides,
          },
        ],
        ...volumeOverrides,
      },
    ],
  };
}

/** @param {Readonly<AnyRecord>} fixture */
function absentInstanceResponse(fixture) {
  return instanceResponse(fixture, {}, { BlockDeviceMappings: [] });
}

/** @param {Readonly<AnyRecord>} fixture */
function absentVolumeResponse(fixture) {
  return volumeResponse(fixture, {}, { State: 'available', Attachments: [] });
}

/** @param {string} name */
function providerError(name) {
  return Object.assign(new Error('provider-secret'), { name });
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [overrides] */
function makeClient(fixture, overrides = {}) {
  return {
    describeInstances:
      overrides.describeInstances ??
      jest.fn(async () => instanceResponse(fixture)),
    describeVolumes:
      overrides.describeVolumes ?? jest.fn(async () => volumeResponse(fixture)),
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} client @param {Record<string, any>} [overrides] */
function makeObserver(fixture, client, overrides = {}) {
  return createAwsSingleNodeVolumeAttachmentResourceObserver({
    client,
    providerScope: fixture.base.providerScope,
    maxAttempts: overrides.maxAttempts ?? 2,
    waitForRetry: overrides.waitForRetry ?? jest.fn(async () => {}),
  });
}

describe('AWS single-node retained volume attachment observer', () => {
  it.each(CASES)(
    'verifies exact dual-view $resourceKey evidence with frozen exact reads',
    async (testCase) => {
      const fixture = makeApplyFixture('bound', testCase.resourceKey);
      const client = makeClient(fixture);
      const observer = makeObserver(fixture, client);
      const observation = await observer.observe(fixture.authority);
      expect(observation).toEqual({
        resourceKey: testCase.resourceKey,
        presence: 'present',
        ownership: 'verified',
        providerIdentity: {
          providerType: 'ebs-volume-attachment',
          providerResourceId:
            getAwsSingleNodeVolumeAttachmentProviderResourceId(
              fixture.base.providerSpec,
              testCase.capabilityKind,
              IDS.substrate,
              testCase.volumeId,
            ),
        },
        observedDigest: getAwsSingleNodeVolumeAttachmentStateDigest(
          fixture.base.providerSpec,
          testCase.capabilityKind,
        ),
        health: 'not-applicable',
        execution: 'none',
      });
      expect(client.describeInstances).toHaveBeenCalledWith({
        InstanceIds: [IDS.substrate],
      });
      expect(client.describeVolumes).toHaveBeenCalledWith({
        VolumeIds: [testCase.volumeId],
      });
      expectDeepFrozen(client.describeInstances.mock.calls[0][0]);
      expectDeepFrozen(client.describeVolumes.mock.calls[0][0]);
      expectDeepFrozen(observation);
    },
  );

  it('accepts exact current-create presence but never advises replay', async () => {
    const fixture = makeApplyFixture(
      'current-create',
      'application-state-attachment',
    );
    const observation = await makeObserver(
      fixture,
      makeClient(fixture),
    ).observe(fixture.authority);
    expect(observation.presence).toBe('present');
    expect(observation.ownership).toBe('verified');
    expect(observation.execution).toBe('none');
  });

  it('reports an unbound exact relationship as a collision', async () => {
    const fixture = makeApplyFixture('unbound', 'application-state-attachment');
    const observation = await makeObserver(
      fixture,
      makeClient(fixture),
    ).observe(fixture.authority);
    expect(observation).toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      observedDigest: null,
      execution: 'none',
    });
  });

  it('requires a clean bounded window for ordinary unbound absence', async () => {
    const fixture = makeApplyFixture('unbound', 'application-state-attachment');
    const waitForRetry = jest.fn(async () => {});
    const client = makeClient(fixture, {
      describeInstances: jest.fn(async () => absentInstanceResponse(fixture)),
      describeVolumes: jest.fn(async () => absentVolumeResponse(fixture)),
    });
    const observation = await makeObserver(fixture, client, {
      waitForRetry,
    }).observe(fixture.authority);
    expect(observation).toEqual({
      resourceKey: fixture.resourceKey,
      presence: 'absent',
      ownership: 'missing',
      providerIdentity: null,
      observedDigest: null,
      health: 'absent',
      execution: 'none',
    });
    expect(client.describeInstances).toHaveBeenCalledTimes(2);
    expect(client.describeVolumes).toHaveBeenCalledTimes(2);
    expect(waitForRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps current-create clean absence unknown without replay authority', async () => {
    const fixture = makeApplyFixture(
      'current-create',
      'application-state-attachment',
    );
    const client = makeClient(fixture, {
      describeInstances: jest.fn(async () => absentInstanceResponse(fixture)),
      describeVolumes: jest.fn(async () => absentVolumeResponse(fixture)),
    });
    const observation = await makeObserver(fixture, client).observe(
      fixture.authority,
    );
    expect(observation).toMatchObject({
      presence: 'unknown',
      ownership: 'unknown',
      execution: 'none',
    });
  });

  it('reports readable retention drift with an actual unequal digest', async () => {
    const fixture = makeApplyFixture('bound', 'application-state-attachment');
    const client = makeClient(fixture, {
      describeInstances: jest.fn(async () =>
        instanceResponse(fixture, { DeleteOnTermination: true }),
      ),
    });
    const observation = await makeObserver(fixture, client).observe(
      fixture.authority,
    );
    const instanceView = {
      state: 'running',
      attachment: {
        deviceName: '/dev/sdf',
        volumeId: IDS.applicationVolume,
        state: 'attached',
        deleteOnTermination: true,
        ebsCardIndex: 0,
        intendedVolume: true,
      },
    };
    const volumeView = {
      state: 'in-use',
      attachment: {
        state: 'attached',
        deleteOnTermination: false,
        ebsCardIndex: 0,
      },
    };
    const logical = reconcileAwsSingleNodeVolumeAttachmentViews({
      action: 'noop',
      instanceView,
      volumeView,
    });
    expect(observation.ownership).toBe('verified');
    expect(observation.observedDigest).toEqual(
      getAwsSingleNodeVolumeAttachmentObservedStateDigest(
        fixture.base.providerSpec,
        'application-state',
        logical,
      ),
    );
    expect(observation.observedDigest).not.toEqual(
      getAwsSingleNodeVolumeAttachmentStateDigest(
        fixture.base.providerSpec,
        'application-state',
      ),
    );
  });

  it('settles ordinary exact current-delete absence immediately', async () => {
    const fixture = makeDeleteFixture('application-state-attachment');
    const client = makeClient(fixture, {
      describeInstances: jest.fn(async () => absentInstanceResponse(fixture)),
      describeVolumes: jest.fn(async () => absentVolumeResponse(fixture)),
    });
    const observation = await makeObserver(fixture, client).observe(
      fixture.authority,
    );
    expect(observation.presence).toBe('absent');
    expect(client.describeInstances).toHaveBeenCalledTimes(1);
    expect(client.describeVolumes).toHaveBeenCalledTimes(1);
  });

  it('proves completed-destroy attachment absence from a stable missing instance and fresh available volume', async () => {
    const fixture = makeDestroyedFixture('application-state-attachment');
    const waitForRetry = jest.fn(async () => {});
    const client = makeClient(fixture, {
      describeInstances: jest.fn(async () => {
        throw providerError('InvalidInstanceID.NotFound');
      }),
      describeVolumes: jest.fn(async () => absentVolumeResponse(fixture)),
    });

    await expect(
      makeObserver(fixture, client, { waitForRetry }).observe(
        fixture.authority,
      ),
    ).resolves.toMatchObject({
      presence: 'absent',
      ownership: 'missing',
      providerIdentity: null,
    });
    expect(client.describeInstances).toHaveBeenCalledTimes(2);
    expect(client.describeVolumes).toHaveBeenCalledTimes(2);
    expect(waitForRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps completed-destroy attachment evidence unknown while an in-use retained volume still carries it', async () => {
    const fixture = makeDestroyedFixture('application-state-attachment');
    const client = makeClient(fixture, {
      describeInstances: jest.fn(async () => {
        throw providerError('InvalidInstanceID.NotFound');
      }),
      describeVolumes: jest.fn(async () => volumeResponse(fixture)),
    });

    await expect(
      makeObserver(fixture, client).observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'unknown',
      ownership: 'unknown',
      providerIdentity: null,
    });
    expect(client.describeInstances).toHaveBeenCalledTimes(2);
    expect(client.describeVolumes).toHaveBeenCalledTimes(2);
  });

  it('rejects a tampered completed-destroy attachment locator before provider I/O', async () => {
    const fixture = makeDestroyedFixture('application-state-attachment');
    const client = makeClient(fixture);
    const forged = clone(fixture.authority);
    forged.destroyedResourceLocator.dependencies[0].providerIdentity.providerResourceId =
      'vol-00000000000000009';

    await expect(
      makeObserver(fixture, client).observe(forged),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError,
    );
    expect(client.describeInstances).not.toHaveBeenCalled();
    expect(client.describeVolumes).not.toHaveBeenCalled();
  });

  it('requires the same typed endpoint-absence signature for every delete attempt', async () => {
    const fixture = makeDeleteFixture('application-state-attachment');
    const waitForRetry = jest.fn(async () => {});
    const client = makeClient(fixture, {
      describeInstances: jest.fn(async () => {
        throw providerError('InvalidInstanceID.NotFound');
      }),
      describeVolumes: jest.fn(async () => {
        throw providerError('InvalidVolume.NotFound');
      }),
    });
    const observation = await makeObserver(fixture, client, {
      maxAttempts: 3,
      waitForRetry,
    }).observe(fixture.authority);
    expect(observation.presence).toBe('absent');
    expect(client.describeInstances).toHaveBeenCalledTimes(3);
    expect(client.describeVolumes).toHaveBeenCalledTimes(3);
    expect(waitForRetry).toHaveBeenCalledTimes(2);
  });

  it('never settles alternating typed endpoint-absence signatures', async () => {
    const fixture = makeDeleteFixture('application-state-attachment');
    let attempt = 0;
    const client = makeClient(fixture, {
      describeInstances: jest.fn(async () => {
        attempt += 1;
        if (attempt % 2 === 1) {
          throw providerError('InvalidInstanceID.NotFound');
        }
        return absentInstanceResponse(fixture);
      }),
      describeVolumes: jest.fn(async () =>
        attempt % 2 === 1
          ? absentVolumeResponse(fixture)
          : Promise.reject(providerError('InvalidVolume.NotFound')),
      ),
    });
    const observation = await makeObserver(fixture, client, {
      maxAttempts: 3,
    }).observe(fixture.authority);
    expect(observation.presence).toBe('unknown');
    expect(client.describeInstances).toHaveBeenCalledTimes(3);
    expect(client.describeVolumes).toHaveBeenCalledTimes(3);
  });

  it('does not reinterpret successful empty exact responses as endpoint absence', async () => {
    const fixture = makeDeleteFixture('application-state-attachment');
    const client = makeClient(fixture, {
      describeInstances: jest.fn(async () => ({ Reservations: [] })),
      describeVolumes: jest.fn(async () => ({ Volumes: [] })),
    });
    const observation = await makeObserver(fixture, client).observe(
      fixture.authority,
    );
    expect(observation.presence).toBe('unknown');
  });

  it('keeps one-sided propagation unknown and maps exact slot contradictions to conflict', async () => {
    const fixture = makeApplyFixture('bound', 'application-state-attachment');
    const transientClient = makeClient(fixture, {
      describeVolumes: jest.fn(async () => absentVolumeResponse(fixture)),
    });
    const transient = await makeObserver(fixture, transientClient).observe(
      fixture.authority,
    );
    expect(transient.presence).toBe('unknown');

    const conflictClient = makeClient(fixture, {
      describeInstances: jest.fn(async () =>
        instanceResponse(fixture, { EbsCardIndex: 1 }),
      ),
    });
    const conflict = await makeObserver(fixture, conflictClient).observe(
      fixture.authority,
    );
    expect(conflict).toMatchObject({
      presence: 'present',
      ownership: 'conflict',
    });
  });

  it('rejects forged transitive dependency create provenance before provider I/O', async () => {
    const fixture = makeApplyFixture('bound', 'application-state-attachment', {
      artifact: 'application-state',
    });
    const client = makeClient(fixture);
    const observer = makeObserver(fixture, client);
    await expect(observer.observe(fixture.authority)).rejects.toBeInstanceOf(
      AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError,
    );
    expect(client.describeInstances).not.toHaveBeenCalled();
    expect(client.describeVolumes).not.toHaveBeenCalled();
  });

  it('exposes only a frozen observe port and rejects forged authority before provider I/O', async () => {
    const fixture = makeApplyFixture('bound', 'application-state-attachment');
    const client = makeClient(fixture);
    const observer = makeObserver(fixture, client);
    expect(Object.keys(observer)).toEqual(['observe']);
    expect(Object.isFrozen(observer)).toBe(true);
    expect(() =>
      createAwsSingleNodeVolumeAttachmentResourceObserver({
        client: {
          ...client,
          detachVolume: jest.fn(),
        },
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeVolumeAttachmentResourceObserver({
        client,
        providerScope: fixture.base.providerScope,
        maxAttempts: 1,
      }),
    ).toThrow('maxAttempts must be an integer from 2 through 10');

    const forged = clone(fixture.authority);
    forged.binding.providerResourceId =
      getAwsSingleNodeVolumeAttachmentProviderResourceId(
        fixture.base.providerSpec,
        'control-state',
        IDS.substrate,
        IDS.controlVolume,
      );
    await expect(observer.observe(forged)).rejects.toBeInstanceOf(
      AwsSingleNodeVolumeAttachmentResourceObserverAuthorityError,
    );
    expect(client.describeInstances).not.toHaveBeenCalled();
    expect(client.describeVolumes).not.toHaveBeenCalled();
  });
});
