import { describe, expect, it, jest } from '@jest/globals';

import { compareCanonicalStrings } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import { createAwsSingleNodeDefaultIpv4RouteStateDigest } from '../../src/core/runtime/deployment-aws-default-ipv4-route-evidence.js';
import {
  getAwsSingleNodeDefaultIpv4RouteProviderResourceId,
  getAwsSingleNodeDefaultIpv4RouteStateDigest,
} from '../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js';
import {
  AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError,
  createAwsSingleNodeDefaultIpv4RouteResourceObserver,
} from '../../src/core/runtime/deployment-aws-default-ipv4-route-resource-observer.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import { createAwsSingleNodeInternetGatewayEvidenceKernel } from '../../src/core/runtime/deployment-aws-internet-gateway-evidence.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { createAwsSingleNodeResourceObservationAuthority } from '../../src/core/runtime/deployment-aws-resource-observation-authority.js';
import { createAwsSingleNodeRouteTableEvidenceKernel } from '../../src/core/runtime/deployment-aws-route-table-evidence.js';
import {
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
} from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import { getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId } from '../../src/core/runtime/deployment-aws-subnet-route-table-association-resource.js';
import { getAwsSingleNodeVolumeAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-volume-attachment-resource.js';
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
  association: 'rtbassoc-00000000000000001',
  securityGroup: 'sg-00000000000000001',
  runtimeRole: 'AROA1234567890EXAMPLE',
  runtimeIdentity: 'AIPA1234567890EXAMPLE',
  substrate: 'i-00000000000000001',
});

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
    appId: 'default-ipv4-route-resource-observer-test',
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
      'wharfie:test:default-ipv4-route-resource-observer-revision:v1',
      { appId: profile.appId },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'default IPv4 route observer artifact',
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
          'wharfie:test:default-ipv4-route-resource-observer-inspection:v1',
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
 */
function makeBindings(base, plan, intents, limit = plan.actions.length) {
  const bindingByKey = new Map();
  const bindings = [];
  for (let index = 0; index < limit; index += 1) {
    const action = plan.actions[index];
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
      ownershipNonce: intents[index].ownershipNonce,
      createdByActionId: action.actionId,
    });
    bindingByKey.set(action.resourceKey, binding);
    bindings.push(binding);
  }
  return bindings;
}

/**
 * @param {'bound'|'current-create'} mode
 * @returns {Readonly<AnyRecord>}
 */
function makeApplyFixture(mode) {
  const base = makeBase();
  const plan = makeCreatePlan(base);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'network-default-ipv4-route',
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
          : index === frontier
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
    resourceBindings: makeBindings(base, plan, intents, frontier),
    activeOperation: {
      kind: 'create',
      planId: plan.planId,
      status: 'running',
      nextActionIndex: frontier,
      intents,
    },
    lastOperation: null,
  });
  const target = targetFor(
    makeTargets(base, head),
    'network-default-ipv4-route',
  );
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
    base,
    plan,
    head,
    target,
    authority,
    actionIndex,
  });
}

/** @returns {Readonly<AnyRecord>} */
function makeDeleteFixture() {
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
          'wharfie:test:default-route-delete-inspection:v1',
          { headId: readyHead.headId },
        ),
      },
      actions: getAwsSingleNodeResourceDestroyOrder().map((resourceKey) => {
        const target = targetByKey.get(resourceKey);
        const binding = bindingByKey.get(resourceKey);
        if (target === undefined || binding === undefined) {
          throw new Error(`Missing destroy fixture '${resourceKey}'.`);
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
      action.resourceKey === 'network-default-ipv4-route',
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
  const target = targetFor(
    makeTargets(base, head),
    'network-default-ipv4-route',
  );
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
    base,
    plan,
    settledPlan,
    head,
    target,
    authority,
    actionIndex,
  });
}

const routeTableTagEvidence = createAwsSingleNodeRouteTableEvidenceKernel({
  readDiscoveryPage: async () => ({ records: [], nextToken: null }),
  readExact: async () => null,
});
const internetGatewayTagEvidence =
  createAwsSingleNodeInternetGatewayEvidenceKernel({
    readDiscoveryPage: async () => ({ records: [], nextToken: null }),
    readExact: async () => null,
  });

/** @param {Readonly<AnyRecord>} fixture @param {string} resourceKey */
function bindingFor(fixture, resourceKey) {
  const binding = fixture.head.resourceBindings.find(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === resourceKey,
  );
  if (binding === undefined) {
    throw new Error(`Missing fixture binding '${resourceKey}'.`);
  }
  return binding;
}

/** @param {Readonly<AnyRecord>} fixture @param {string} resourceKey */
function settledActionFor(fixture, resourceKey) {
  const plan = fixture.settledPlan ?? fixture.plan;
  const action = plan.actions.find(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === resourceKey,
  );
  if (action === undefined) {
    throw new Error(`Missing fixture action '${resourceKey}'.`);
  }
  return action;
}

/** @param {Readonly<AnyRecord>} fixture @param {string} resourceKey */
function parentLocator(fixture, resourceKey) {
  const binding = bindingFor(fixture, resourceKey);
  return {
    capabilityKind: binding.capability.kind,
    roleKind: binding.role.kind,
    providerScopeId: fixture.base.providerScope.providerScopeId,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
    resourceKey,
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {'network-route-table'|'network-internet-gateway'} resourceKey */
function parentTags(fixture, resourceKey) {
  const binding = bindingFor(fixture, resourceKey);
  const action = settledActionFor(fixture, resourceKey);
  const kernel =
    resourceKey === 'network-route-table'
      ? routeTableTagEvidence
      : internetGatewayTagEvidence;
  return kernel.ownershipTags({
    ...parentLocator(fixture, resourceKey),
    createdByActionId: binding.createdByActionId,
    ownershipNonce: binding.ownershipNonce,
    stateDigestValue: action.after.stateDigest.value,
  });
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [changes] */
function routeTable(fixture, changes = {}) {
  return {
    RouteTableId: IDS.routeTable,
    OwnerId: fixture.base.providerScope.accountId,
    VpcId: IDS.vpc,
    Routes: [
      {
        DestinationCidrBlock:
          fixture.base.providerSpec.capabilities.networking.vpcCidr,
        GatewayId: 'local',
        Origin: 'CreateRouteTable',
        State: 'active',
      },
      {
        DestinationCidrBlock: '0.0.0.0/0',
        GatewayId: IDS.internetGateway,
        Origin: 'CreateRoute',
        State: 'active',
      },
    ],
    Associations: [],
    PropagatingVgws: [],
    Tags: routeTableTagEvidence.sortedTags(
      parentTags(fixture, 'network-route-table'),
    ),
    ...changes,
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [changes] */
function internetGateway(fixture, changes = {}) {
  return {
    InternetGatewayId: IDS.internetGateway,
    OwnerId: fixture.base.providerScope.accountId,
    Attachments: [{ VpcId: IDS.vpc, State: 'available' }],
    Tags: internetGatewayTagEvidence.sortedTags(
      parentTags(fixture, 'network-internet-gateway'),
    ),
    ...changes,
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [options] */
function clientFor(fixture, options = {}) {
  return {
    describeInternetGateways:
      options.describeInternetGateways ??
      jest.fn(async () => ({
        InternetGateways: [internetGateway(fixture)],
      })),
    describeRouteTables:
      options.describeRouteTables ??
      jest.fn(async (/** @type {Readonly<AnyRecord>} */ request) => {
        if (request.RouteTableIds !== undefined) {
          return { RouteTables: [routeTable(fixture)] };
        }
        return { RouteTables: [] };
      }),
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} client @param {Record<string, any>} [options] */
function observerFor(fixture, client, options = {}) {
  return createAwsSingleNodeDefaultIpv4RouteResourceObserver({
    client,
    providerScope: fixture.base.providerScope,
    maxAttempts: options.maxAttempts ?? 1,
    waitForRetry: options.waitForRetry ?? (async () => {}),
  });
}

/** @param {string} resourceKey @param {string} providerResourceId */
function identity(resourceKey, providerResourceId) {
  return {
    providerType:
      resourceKey === 'network-default-ipv4-route'
        ? 'ec2-ipv4-route'
        : resourceKey,
    providerResourceId,
  };
}

/** @param {Readonly<AnyRecord>} fixture */
function expectedProviderResourceId(fixture) {
  return getAwsSingleNodeDefaultIpv4RouteProviderResourceId(
    fixture.base.providerSpec.capabilities.networking.egressCidr,
    IDS.internetGateway,
    IDS.routeTable,
  );
}

/** @param {string} presence @param {string} ownership @param {Readonly<AnyRecord>|null} providerIdentity @param {Readonly<AnyRecord>|null} observedDigest */
function expectedObservation(
  presence,
  ownership,
  providerIdentity,
  observedDigest,
) {
  return {
    resourceKey: 'network-default-ipv4-route',
    presence,
    ownership,
    providerIdentity,
    observedDigest,
    health:
      presence === 'present'
        ? 'not-applicable'
        : presence === 'absent'
          ? 'absent'
          : 'unknown',
    execution: 'none',
  };
}

describe('AWS single-node default IPv4 route resource observer', () => {
  it('constructs without I/O and accepts only the exact read port', () => {
    const fixture = makeApplyFixture('current-create');
    const client = clientFor(fixture);
    const observer = observerFor(fixture, client);

    expect(Object.keys(observer)).toEqual(['observe']);
    expect(Object.isFrozen(observer)).toBe(true);
    expect(client.describeRouteTables).not.toHaveBeenCalled();
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
    expect(() =>
      createAwsSingleNodeDefaultIpv4RouteResourceObserver({
        client: {
          describeRouteTables: async () => ({}),
          describeInternetGateways: async () => ({}),
          createRoute: async () => ({}),
        },
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(/createRoute is not supported/);
  });

  it('re-proves exact derived and transitive dependency lineage before I/O', async () => {
    const fixture = makeApplyFixture('bound');
    const forged = clone(fixture.authority);
    forged.binding.dependencyBindings[0].bindingId = semanticId(
      'wdb2',
      'wharfie:test:wrong-default-route-dependency:v1',
      {},
    );
    const client = clientFor(fixture);

    await expect(
      observerFor(fixture, client).observe(forged),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError,
    );
    expect(client.describeRouteTables).not.toHaveBeenCalled();
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
  });

  it('verifies a bound active route through both exact owned endpoints', async () => {
    const fixture = makeApplyFixture('bound');
    const client = clientFor(fixture);
    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'verified',
        identity(
          'network-default-ipv4-route',
          expectedProviderResourceId(fixture),
        ),
        getAwsSingleNodeDefaultIpv4RouteStateDigest(fixture.base.providerSpec),
      ),
    );
    expectDeepFrozen(observation);
    expect(client.describeRouteTables).toHaveBeenCalledWith({
      RouteTableIds: [IDS.routeTable],
    });
    expect(client.describeInternetGateways).toHaveBeenCalledWith({
      InternetGatewayIds: [IDS.internetGateway],
    });
    expectDeepFrozen(client.describeRouteTables.mock.calls[0][0]);
    expectDeepFrozen(client.describeInternetGateways.mock.calls[0][0]);
  });

  it('returns bound readable blackhole state as verified physical drift', async () => {
    const fixture = makeApplyFixture('bound');
    const record = routeTable(fixture);
    record.Routes[1].State = 'blackhole';
    const observation = await observerFor(
      fixture,
      clientFor(fixture, {
        describeRouteTables: jest.fn(async () => ({
          RouteTables: [record],
        })),
      }),
    ).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'verified',
        identity(
          'network-default-ipv4-route',
          expectedProviderResourceId(fixture),
        ),
        createAwsSingleNodeDefaultIpv4RouteStateDigest({
          destinationCidrBlock: '0.0.0.0/0',
          targetKind: 'internet-gateway',
          origin: 'CreateRoute',
          state: 'blackhole',
          onDestroy: 'purge',
        }),
      ),
    );
  });

  it('verifies current create only when both exact endpoints show active state', async () => {
    const fixture = makeApplyFixture('current-create');
    const observation = await observerFor(fixture, clientFor(fixture)).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'verified',
        identity(
          'network-default-ipv4-route',
          expectedProviderResourceId(fixture),
        ),
        getAwsSingleNodeDefaultIpv4RouteStateDigest(fixture.base.providerSpec),
      ),
    );
  });

  it('keeps current-create blackhole and clean empty history unknown without replay advice', async () => {
    const fixture = makeApplyFixture('current-create');
    const blackhole = routeTable(fixture);
    blackhole.Routes[1].State = 'blackhole';
    const blackholeObservation = await observerFor(
      fixture,
      clientFor(fixture, {
        describeRouteTables: jest.fn(async () => ({
          RouteTables: [blackhole],
        })),
      }),
    ).observe(fixture.authority);
    expect(blackholeObservation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );

    const empty = routeTable(fixture);
    empty.Routes = [empty.Routes[0]];
    const waitForRetry = jest.fn(async () => {});
    const emptyObservation = await observerFor(
      fixture,
      clientFor(fixture, {
        describeRouteTables: jest.fn(async () => ({
          RouteTables: [clone(empty)],
        })),
      }),
      { maxAttempts: 3, waitForRetry },
    ).observe(fixture.authority);
    expect(emptyObservation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(emptyObservation.execution).toBe('none');
    expect(waitForRetry.mock.calls).toEqual([[1], [2]]);
  });

  it('requires every bounded bound-absence attempt and waiter to remain clean', async () => {
    const fixture = makeApplyFixture('bound');
    const empty = routeTable(fixture);
    empty.Routes = [empty.Routes[0]];
    const cleanClient = clientFor(fixture, {
      describeRouteTables: jest.fn(async () => ({
        RouteTables: [clone(empty)],
      })),
    });
    const clean = await observerFor(fixture, cleanClient, {
      maxAttempts: 3,
    }).observe(fixture.authority);
    expect(clean).toEqual(expectedObservation('absent', 'missing', null, null));
    expect(cleanClient.describeRouteTables).toHaveBeenCalledTimes(3);

    let call = 0;
    const dirtyClient = clientFor(fixture, {
      describeRouteTables: jest.fn(async () => {
        call += 1;
        if (call === 1) throw new Error('ambiguous read');
        return { RouteTables: [clone(empty)] };
      }),
    });
    const dirty = await observerFor(fixture, dirtyClient, {
      maxAttempts: 3,
    }).observe(fixture.authority);
    expect(dirty).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
  });

  it('corroborates exact parent NotFound with complete locator absence', async () => {
    const fixture = makeApplyFixture('bound');
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => {
        if (request.RouteTableIds !== undefined) {
          throw Object.assign(new Error('not found'), {
            name: 'InvalidRouteTableID.NotFound',
          });
        }
        expect(request).toEqual({
          Filters: routeTableTagEvidence.discoveryFilters(
            parentLocator(fixture, 'network-route-table'),
          ),
          MaxResults: 100,
        });
        return { RouteTables: [] };
      },
    );
    const observation = await observerFor(
      fixture,
      clientFor(fixture, { describeRouteTables }),
      { maxAttempts: 2 },
    ).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('absent', 'missing', null, null),
    );
    expect(describeRouteTables).toHaveBeenCalledTimes(4);
  });

  it.each([
    [
      'wrong route target',
      () => {
        const fixture = makeApplyFixture('bound');
        const record = routeTable(fixture);
        record.Routes[1].GatewayId = 'igw-00000000000000002';
        return {
          fixture,
          client: clientFor(fixture, {
            describeRouteTables: jest.fn(async () => ({
              RouteTables: [record],
            })),
          }),
        };
      },
    ],
    [
      'foreign gateway VPC',
      () => {
        const fixture = makeApplyFixture('bound');
        return {
          fixture,
          client: clientFor(fixture, {
            describeInternetGateways: jest.fn(async () => ({
              InternetGateways: [
                internetGateway(fixture, {
                  Attachments: [
                    {
                      VpcId: 'vpc-00000000000000002',
                      State: 'available',
                    },
                  ],
                }),
              ],
            })),
          }),
        };
      },
    ],
    [
      'wrong route-table ownership tag',
      () => {
        const fixture = makeApplyFixture('bound');
        const record = routeTable(fixture);
        record.Tags = clone(record.Tags);
        record.Tags[0].Value = 'foreign';
        return {
          fixture,
          client: clientFor(fixture, {
            describeRouteTables: jest.fn(async () => ({
              RouteTables: [record],
            })),
          }),
        };
      },
    ],
  ])('reports %s as ownership conflict', async (_label, makeCase) => {
    const { fixture, client } = makeCase();
    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );
    expect(observation).toEqual(
      expectedObservation(
        'present',
        'conflict',
        identity(
          'network-default-ipv4-route',
          expectedProviderResourceId(fixture),
        ),
        null,
      ),
    );
  });

  it('never adopts a matching unbound slot outside its current create', async () => {
    const fixture = makeApplyFixture('current-create');
    const forged = clone(fixture.authority);
    forged.currentAction = null;
    const client = clientFor(fixture);

    await expect(
      observerFor(fixture, client).observe(forged),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError,
    );
    expect(client.describeRouteTables).not.toHaveBeenCalled();
  });

  it('observes current delete from the exact route slot without reading gateway state', async () => {
    const fixture = makeDeleteFixture();
    const describeInternetGateways = jest.fn(async () => {
      throw new Error('delete observer must not read gateway');
    });
    const client = clientFor(fixture, { describeInternetGateways });
    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'verified',
        identity(
          'network-default-ipv4-route',
          expectedProviderResourceId(fixture),
        ),
        getAwsSingleNodeDefaultIpv4RouteStateDigest(fixture.base.providerSpec),
      ),
    );
    expect(describeInternetGateways).not.toHaveBeenCalled();
    expect(client.describeRouteTables).toHaveBeenCalledTimes(1);
  });

  it('observes current-delete blackhole drift and clean absence without gateway reads', async () => {
    const fixture = makeDeleteFixture();
    const describeInternetGateways = jest.fn(async () => {
      throw new Error('delete observer must not read gateway');
    });
    const blackhole = routeTable(fixture);
    blackhole.Routes[1].State = 'blackhole';
    const blackholeObservation = await observerFor(
      fixture,
      clientFor(fixture, {
        describeInternetGateways,
        describeRouteTables: jest.fn(async () => ({
          RouteTables: [blackhole],
        })),
      }),
    ).observe(fixture.authority);
    expect(blackholeObservation).toEqual(
      expectedObservation(
        'present',
        'verified',
        identity(
          'network-default-ipv4-route',
          expectedProviderResourceId(fixture),
        ),
        createAwsSingleNodeDefaultIpv4RouteStateDigest({
          destinationCidrBlock: '0.0.0.0/0',
          targetKind: 'internet-gateway',
          origin: 'CreateRoute',
          state: 'blackhole',
          onDestroy: 'purge',
        }),
      ),
    );

    const empty = routeTable(fixture);
    empty.Routes = [empty.Routes[0]];
    const emptyObservation = await observerFor(
      fixture,
      clientFor(fixture, {
        describeInternetGateways,
        describeRouteTables: jest.fn(async () => ({
          RouteTables: [empty],
        })),
      }),
      { maxAttempts: 2 },
    ).observe(fixture.authority);
    expect(emptyObservation).toEqual(
      expectedObservation('absent', 'missing', null, null),
    );
    expect(describeInternetGateways).not.toHaveBeenCalled();
  });

  it.each([
    [
      'conflicting gateway',
      (/** @type {Readonly<AnyRecord>} */ fixture) => ({
        InternetGateways: [
          internetGateway(fixture, {
            Attachments: [
              {
                VpcId: 'vpc-00000000000000002',
                State: 'available',
              },
            ],
          }),
        ],
      }),
      'conflict',
    ],
    ['malformed gateway', () => ({ InternetGateways: [] }), 'unknown'],
  ])(
    'does not turn route-slot absence plus %s into clean absence',
    async (_label, gatewayResponse, expectedKind) => {
      const fixture = makeApplyFixture('bound');
      const empty = routeTable(fixture);
      empty.Routes = [empty.Routes[0]];
      const observation = await observerFor(
        fixture,
        clientFor(fixture, {
          describeRouteTables: jest.fn(async () => ({
            RouteTables: [empty],
          })),
          describeInternetGateways: jest.fn(async () =>
            gatewayResponse(fixture),
          ),
        }),
        { maxAttempts: 2 },
      ).observe(fixture.authority);

      expect(observation).toEqual(
        expectedKind === 'conflict'
          ? expectedObservation(
              'present',
              'conflict',
              identity(
                'network-default-ipv4-route',
                expectedProviderResourceId(fixture),
              ),
              null,
            )
          : expectedObservation('unknown', 'unknown', null, null),
      );
    },
  );

  it('maps malformed and one-sided endpoint evidence to bounded unknown', async () => {
    const fixture = makeApplyFixture('bound');
    const client = clientFor(fixture, {
      describeInternetGateways: jest.fn(async () => ({
        InternetGateways: [],
      })),
    });
    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
    }).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(client.describeInternetGateways).toHaveBeenCalledTimes(2);
    expect(client.describeRouteTables).toHaveBeenCalledTimes(2);
  });
});
