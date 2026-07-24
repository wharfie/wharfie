import { describe, expect, it, jest } from '@jest/globals';

import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import { getAwsSingleNodeDefaultIpv4RouteProviderResourceId } from '../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource.js';
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
import {
  getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId,
  getAwsSingleNodeSubnetRouteTableAssociationStateDigest,
} from '../../src/core/runtime/deployment-aws-subnet-route-table-association-resource.js';
import {
  AwsSingleNodeSubnetRouteTableAssociationResourceObserverAuthorityError,
  createAwsSingleNodeSubnetRouteTableAssociationResourceObserver,
} from '../../src/core/runtime/deployment-aws-subnet-route-table-association-resource-observer.js';
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
import { getAwsSingleNodeVolumeAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-volume-attachment-resource.js';

/** @typedef {Record<string, any>} AnyRecord */

const IDS = Object.freeze({
  association: 'rtbassoc-00000000000000001',
  otherAssociation: 'rtbassoc-00000000000000002',
  routeTable: 'rtb-00000000000000001',
  otherRouteTable: 'rtb-00000000000000002',
  subnet: 'subnet-00000000000000001',
  otherSubnet: 'subnet-00000000000000002',
  vpc: 'vpc-00000000000000001',
  otherVpc: 'vpc-00000000000000002',
  internetGateway: 'igw-00000000000000001',
  application: 'vol-00000000000000001',
  control: 'vol-00000000000000002',
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
    appId: 'subnet-route-table-association-resource-observer-test',
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
      'wharfie:test:subnet-route-table-association-observer-revision:v1',
      { appId: profile.appId },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'subnet route-table association observer artifact',
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
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 71)),
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
          'wharfie:test:subnet-route-table-association-observer-inspection:v1',
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
function prefixProviderResourceId(base, resourceKey) {
  if (resourceKey === 'artifact') {
    return getAwsSingleNodeManagedArtifactObjectLocation({
      providerScope: base.providerScope,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
    }).arn;
  }
  if (resourceKey === 'application-state') return IDS.application;
  if (resourceKey === 'control-state') return IDS.control;
  if (resourceKey === 'network-vpc') return IDS.vpc;
  if (resourceKey === 'network-internet-gateway') {
    return IDS.internetGateway;
  }
  if (resourceKey === 'network-internet-gateway-attachment') {
    return getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
      IDS.internetGateway,
      IDS.vpc,
    );
  }
  if (resourceKey === 'network-subnet') return IDS.subnet;
  if (resourceKey === 'network-route-table') return IDS.routeTable;
  if (resourceKey === 'network-default-ipv4-route') {
    return getAwsSingleNodeDefaultIpv4RouteProviderResourceId(
      base.providerSpec.capabilities.networking.egressCidr,
      IDS.internetGateway,
      IDS.routeTable,
    );
  }
  if (resourceKey === 'network-subnet-route-table-association') {
    return getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId(
      IDS.routeTable,
      IDS.subnet,
    );
  }
  if (resourceKey === 'network-security-group') return IDS.securityGroup;
  if (resourceKey === 'runtime-role') return IDS.runtimeRole;
  if (resourceKey === 'runtime-role-policy') {
    return getAwsSingleNodeRuntimePolicyProviderResourceId({
      runtimeRoleId: IDS.runtimeRole,
    });
  }
  if (resourceKey === 'runtime-identity') return IDS.runtimeIdentity;
  if (resourceKey === 'runtime-identity-role-association') {
    return getAwsSingleNodeRuntimeAssociationProviderResourceId({
      runtimeRoleId: IDS.runtimeRole,
      instanceProfileId: IDS.runtimeIdentity,
    });
  }
  if (resourceKey === 'substrate') return IDS.substrate;
  if (
    resourceKey === 'application-state-attachment' ||
    resourceKey === 'control-state-attachment'
  ) {
    const volumeKey =
      resourceKey === 'application-state-attachment'
        ? 'application-state'
        : 'control-state';
    return getAwsSingleNodeVolumeAttachmentProviderResourceId(
      base.providerSpec,
      volumeKey,
      IDS.substrate,
      volumeKey === 'application-state' ? IDS.application : IDS.control,
    );
  }
  throw new Error(`Unsupported prefix binding '${resourceKey}'.`);
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>} plan
 * @param {ReadonlyArray<Readonly<AnyRecord>>} intents
 * @param {number} frontier
 */
function makePrefixBindings(base, plan, intents, frontier) {
  const bindingByKey = new Map();
  for (let index = 0; index < frontier; index += 1) {
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
      dependencyBindings: action.dependsOn.map(
        (/** @type {string} */ resourceKey) => ({
          resourceKey,
          bindingId: bindingByKey.get(resourceKey).bindingId,
        }),
      ),
      providerType: action.after.providerType,
      providerResourceId: prefixProviderResourceId(base, action.resourceKey),
      providerScopeId: base.providerScope.providerScopeId,
      ownershipNonce: intents[index].ownershipNonce,
      createdByActionId: action.actionId,
    });
    bindingByKey.set(action.resourceKey, binding);
  }
  return [...bindingByKey.values()];
}

/**
 * @param {'bound'|'current-create'|'unbound'|'early-unbound'} [mode]
 * @returns {Readonly<AnyRecord>}
 */
function makeAuthorityFixture(mode = 'bound') {
  const base = makeBase();
  const plan = makeCreatePlan(base);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'network-subnet-route-table-association',
  );
  const action = plan.actions[actionIndex];
  if (action === undefined) {
    throw new Error('Missing subnet route-table association action.');
  }
  const frontier =
    mode === 'early-unbound'
      ? 0
      : mode === 'bound'
        ? actionIndex + 1
        : actionIndex;
  const frontierStatus =
    mode === 'current-create' || mode === 'early-unbound'
      ? 'intended'
      : 'pending';
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
            ? frontierStatus
            : 'pending',
      ownershipNonce:
        candidate.management === 'managed' ? nonce(100 + index) : null,
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
      (frontierStatus === 'intended' && frontier < plan.actions.length ? 1 : 0),
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
  const target = targetFor(
    makeTargets(base, head),
    'network-subnet-route-table-association',
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
    action,
    actionIndex,
    head,
    target,
    authority,
  });
}

/** @returns {Readonly<AnyRecord>} */
function makeCurrentDeleteAuthorityFixture() {
  const base = makeBase();
  const settledPlan = makeCreatePlan(base);
  const settledIntents = settledPlan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ action,
      /** @type {number} */ index,
    ) => ({
      actionId: action.actionId,
      status: 'settled',
      ownershipNonce:
        action.management === 'managed' ? nonce(100 + index) : null,
    }),
  );
  const allBindings = makePrefixBindings(
    base,
    settledPlan,
    settledIntents,
    settledPlan.actions.length,
  );
  const readyGeneration = 1 + settledPlan.actions.length * 2;
  const readyHead = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: readyGeneration,
    phase: 'READY',
    settledDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    resourceBindings: allBindings,
    activeOperation: null,
    lastOperation: {
      kind: 'create',
      planId: settledPlan.planId,
      intents: settledIntents,
    },
  });
  const destroyTargets = [...makeTargets(base, readyHead)].reverse();
  const destroyPlan = createDeploymentPlan(
    {
      operation: 'destroy',
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpec: base.providerSpec,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      basis: {
        headGeneration: readyGeneration,
        settledDeploymentRevisionId:
          base.deploymentRevision.deploymentRevisionId,
        inspectionId: semanticId(
          'win6',
          'wharfie:test:subnet-route-table-association-observer-destroy-inspection:v1',
          { readyGeneration },
        ),
      },
      actions: destroyTargets.map((target) => {
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
          before: target.target,
          after: retained ? target.target : null,
        };
      }),
    },
    { profile: base.profile },
  );
  const actionIndex = destroyPlan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'network-subnet-route-table-association',
  );
  const action = destroyPlan.actions[actionIndex];
  if (action === undefined) {
    throw new Error('Missing destroy association action.');
  }
  const bindingByKey = new Map(
    allBindings.map((binding) => [binding.resourceKey, binding]),
  );
  const intents = destroyPlan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ candidate,
      /** @type {number} */ index,
    ) => ({
      actionId: candidate.actionId,
      status:
        index < actionIndex
          ? 'settled'
          : index === actionIndex
            ? 'intended'
            : 'pending',
      ownershipNonce:
        candidate.management === 'managed'
          ? bindingByKey.get(candidate.resourceKey).ownershipNonce
          : null,
    }),
  );
  const deletedKeys = new Set(
    destroyPlan.actions
      .slice(0, actionIndex)
      .filter(
        (/** @type {Readonly<AnyRecord>} */ candidate) =>
          candidate.after === null,
      )
      .map(
        (/** @type {Readonly<AnyRecord>} */ candidate) => candidate.resourceKey,
      ),
  );
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: readyGeneration + actionIndex * 2 + 1,
    phase: 'DESTROYING',
    settledDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: null,
    resourceBindings: allBindings.filter(
      (binding) => !deletedKeys.has(binding.resourceKey),
    ),
    activeOperation: {
      kind: 'destroy',
      planId: destroyPlan.planId,
      status: 'running',
      nextActionIndex: actionIndex,
      intents,
    },
    lastOperation: {
      kind: 'create',
      planId: settledPlan.planId,
      intents: settledIntents,
    },
  });
  const target = targetFor(
    makeTargets(base, head),
    'network-subnet-route-table-association',
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
    plan: destroyPlan,
    settledPlan,
    target,
  });
  return Object.freeze({
    mode: 'current-delete',
    base,
    plan: destroyPlan,
    action,
    actionIndex,
    head,
    target,
    authority,
  });
}

/** @param {Record<string, any>} [overrides] */
function association(overrides = {}) {
  return {
    Main: false,
    RouteTableAssociationId: IDS.association,
    RouteTableId: IDS.routeTable,
    SubnetId: IDS.subnet,
    AssociationState: { State: 'associated' },
    ...overrides,
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [overrides] */
function subnet(fixture, overrides = {}) {
  return {
    SubnetId: IDS.subnet,
    OwnerId: fixture.base.providerScope.accountId,
    VpcId: IDS.vpc,
    State: 'available',
    ...overrides,
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [overrides] */
function routeTable(fixture, overrides = {}) {
  return {
    RouteTableId: IDS.routeTable,
    OwnerId: fixture.base.providerScope.accountId,
    VpcId: IDS.vpc,
    Associations: [association()],
    ...overrides,
  };
}

/**
 * @param {Readonly<AnyRecord>} fixture
 * @param {{subnet?: (request: Readonly<AnyRecord>) => unknown|Promise<unknown>, exact?: (request: Readonly<AnyRecord>) => unknown|Promise<unknown>, discovery?: (request: Readonly<AnyRecord>) => unknown|Promise<unknown>}} [handlers]
 */
function scriptedClient(fixture, handlers = {}) {
  return {
    describeSubnets: jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) =>
        handlers.subnet === undefined
          ? { Subnets: [subnet(fixture)] }
          : handlers.subnet(request),
    ),
    describeRouteTables: jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) =>
        Object.hasOwn(request, 'RouteTableIds')
          ? handlers.exact === undefined
            ? { RouteTables: [routeTable(fixture)] }
            : handlers.exact(request)
          : handlers.discovery === undefined
            ? { RouteTables: [routeTable(fixture)] }
            : handlers.discovery(request),
    ),
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} client @param {{maxAttempts?: number, waitForRetry?: (attempt: number) => Promise<void>}} [options] */
function observerFor(fixture, client, options = {}) {
  return createAwsSingleNodeSubnetRouteTableAssociationResourceObserver({
    client,
    providerScope: fixture.base.providerScope,
    maxAttempts: options.maxAttempts ?? 1,
    waitForRetry: options.waitForRetry ?? (async () => {}),
  });
}

/**
 * @param {'present'|'absent'|'unknown'} presence
 * @param {'verified'|'missing'|'conflict'|'unknown'} ownership
 * @param {Readonly<AnyRecord>|null} providerIdentity
 * @param {Readonly<AnyRecord>|null} observedDigest
 */
function expectedObservation(
  presence,
  ownership,
  providerIdentity,
  observedDigest,
) {
  return {
    resourceKey: 'network-subnet-route-table-association',
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

function expectedProviderIdentity() {
  return {
    providerType: 'ec2-subnet-route-table-association',
    providerResourceId:
      getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId(
        IDS.routeTable,
        IDS.subnet,
      ),
  };
}

describe('AWS subnet route-table association resource observer', () => {
  it('constructs without I/O and accepts only the exact read ports', () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient(fixture, {
      subnet: () => {
        throw new Error('constructor performed I/O');
      },
    });
    const observer = observerFor(fixture, client);

    expect(Object.keys(observer)).toEqual(['observe']);
    expect(Object.isFrozen(observer)).toBe(true);
    expect(client.describeSubnets).not.toHaveBeenCalled();
    expect(client.describeRouteTables).not.toHaveBeenCalled();
    expect(() =>
      createAwsSingleNodeSubnetRouteTableAssociationResourceObserver({
        client: {
          describeRouteTables: async () => ({}),
          describeSubnets: async () => ({}),
          associateRouteTable: async () => ({}),
        },
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(/associateRouteTable is not supported/);
  });

  it('re-proves exact dependency lineage before provider I/O', async () => {
    const fixture = makeAuthorityFixture();
    const forged = clone(fixture.authority);
    forged.binding.dependencyBindings[0].bindingId = semanticId(
      'wdb2',
      'wharfie:test:wrong-association-dependency:v1',
      {},
    );
    const client = scriptedClient(fixture);

    await expect(
      observerFor(fixture, client).observe(forged),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeSubnetRouteTableAssociationResourceObserverAuthorityError,
    );
    expect(client.describeSubnets).not.toHaveBeenCalled();
    expect(client.describeRouteTables).not.toHaveBeenCalled();
  });

  it('keeps a legitimate early unbound target unknown without I/O', async () => {
    const fixture = makeAuthorityFixture('early-unbound');
    const client = scriptedClient(fixture);

    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(client.describeSubnets).not.toHaveBeenCalled();
    expect(client.describeRouteTables).not.toHaveBeenCalled();
  });

  it.each(['bound', 'current-create'])(
    'verifies %s presence only through matching exact and slot views',
    async (mode) => {
      const fixture = makeAuthorityFixture(
        /** @type {'bound'|'current-create'} */ (mode),
      );
      const client = scriptedClient(fixture, {
        subnet: (request) => {
          expect(request).toEqual({ SubnetIds: [IDS.subnet] });
          expectDeepFrozen(request);
          return { Subnets: [subnet(fixture)] };
        },
        exact: (request) => {
          expect(request).toEqual({ RouteTableIds: [IDS.routeTable] });
          expectDeepFrozen(request);
          return { RouteTables: [routeTable(fixture)] };
        },
        discovery: (request) => {
          expect(request).toEqual({
            Filters: [
              {
                Name: 'association.subnet-id',
                Values: [IDS.subnet],
              },
            ],
            MaxResults: 100,
          });
          expectDeepFrozen(request);
          return { RouteTables: [routeTable(fixture)] };
        },
      });

      const observation = await observerFor(fixture, client).observe(
        fixture.authority,
      );

      expect(observation).toEqual(
        expectedObservation(
          'present',
          'verified',
          expectedProviderIdentity(),
          getAwsSingleNodeSubnetRouteTableAssociationStateDigest(
            fixture.base.providerSpec,
          ),
        ),
      );
      expectDeepFrozen(observation);
      expect(JSON.stringify(observation)).not.toContain(IDS.association);
    },
  );

  it('reports a correct unbound slot as collision without adoption', async () => {
    const fixture = makeAuthorityFixture('unbound');
    const observation = await observerFor(
      fixture,
      scriptedClient(fixture),
    ).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'conflict',
        expectedProviderIdentity(),
        null,
      ),
    );
  });

  it('proves unbound absence only after every bounded endpoint and slot view is clean', async () => {
    const fixture = makeAuthorityFixture('unbound');
    const client = scriptedClient(fixture, {
      exact: () => ({
        RouteTables: [routeTable(fixture, { Associations: [] })],
      }),
      discovery: () => ({ RouteTables: [] }),
    });
    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
    }).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('absent', 'missing', null, null),
    );
    expect(client.describeSubnets).toHaveBeenCalledTimes(2);
    expect(client.describeRouteTables).toHaveBeenCalledTimes(4);
  });

  it('keeps clean current-create emptiness unknown without replay advice', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const observation = await observerFor(
      fixture,
      scriptedClient(fixture, {
        exact: () => ({
          RouteTables: [routeTable(fixture, { Associations: [] })],
        }),
        discovery: () => ({ RouteTables: [] }),
      }),
      { maxAttempts: 2 },
    ).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(observation.execution).toBe('none');
  });

  it('reports current-delete absence after typed parent loss and a clean slot history', async () => {
    const fixture = makeCurrentDeleteAuthorityFixture();
    const client = scriptedClient(fixture, {
      subnet: () => {
        throw Object.assign(new Error('subnet not found'), {
          name: 'InvalidSubnetID.NotFound',
        });
      },
      exact: () => {
        throw Object.assign(new Error('route table not found'), {
          name: 'InvalidRouteTableID.NotFound',
        });
      },
      discovery: () => ({ RouteTables: [] }),
    });
    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
    }).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('absent', 'missing', null, null),
    );
    expect(client.describeSubnets).toHaveBeenCalledTimes(2);
    expect(client.describeRouteTables).toHaveBeenCalledTimes(4);
  });

  it('keeps current-create typed parent loss unknown without replay advice', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const observation = await observerFor(
      fixture,
      scriptedClient(fixture, {
        subnet: () => {
          throw Object.assign(new Error('subnet not found'), {
            name: 'InvalidSubnetID.NotFound',
          });
        },
        exact: () => {
          throw Object.assign(new Error('route table not found'), {
            name: 'InvalidRouteTableID.NotFound',
          });
        },
        discovery: () => ({ RouteTables: [] }),
      }),
      { maxAttempts: 2 },
    ).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(observation.execution).toBe('none');
  });

  it.each([
    [
      'malformed exact parent response',
      {
        exact: async () => ({ RouteTables: [] }),
      },
    ],
    [
      'unclassified provider error',
      {
        subnet: async () => {
          throw new Error('provider-secret');
        },
      },
    ],
  ])('keeps current-delete %s unknown', async (_label, handlers) => {
    const fixture = makeCurrentDeleteAuthorityFixture();
    const observation = await observerFor(
      fixture,
      scriptedClient(fixture, {
        ...handlers,
        discovery: () => ({ RouteTables: [] }),
      }),
      { maxAttempts: 2 },
    ).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
  });

  it('reports stable dual-view absence under a durable binding', async () => {
    const fixture = makeAuthorityFixture();
    const observation = await observerFor(
      fixture,
      scriptedClient(fixture, {
        exact: () => ({
          RouteTables: [routeTable(fixture, { Associations: [] })],
        }),
        discovery: () => ({ RouteTables: [] }),
      }),
      { maxAttempts: 2 },
    ).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('absent', 'missing', null, null),
    );
  });

  it.each([
    [
      'exact-only visibility',
      {
        exact: (/** @type {Readonly<AnyRecord>} */ fixture) => ({
          RouteTables: [routeTable(fixture)],
        }),
        discovery: () => ({ RouteTables: [] }),
      },
    ],
    [
      'slot-only visibility',
      {
        exact: (/** @type {Readonly<AnyRecord>} */ fixture) => ({
          RouteTables: [routeTable(fixture, { Associations: [] })],
        }),
        discovery: (/** @type {Readonly<AnyRecord>} */ fixture) => ({
          RouteTables: [routeTable(fixture)],
        }),
      },
    ],
    [
      'differing provider association IDs',
      {
        exact: (/** @type {Readonly<AnyRecord>} */ fixture) => ({
          RouteTables: [routeTable(fixture)],
        }),
        discovery: (/** @type {Readonly<AnyRecord>} */ fixture) => ({
          RouteTables: [
            routeTable(fixture, {
              Associations: [
                association({
                  RouteTableAssociationId: IDS.otherAssociation,
                }),
              ],
            }),
          ],
        }),
      },
    ],
  ])('keeps %s unknown', async (_label, views) => {
    const fixture = makeAuthorityFixture();
    const observation = await observerFor(
      fixture,
      scriptedClient(fixture, {
        exact: () => views.exact(fixture),
        discovery: () => views.discovery(fixture),
      }),
      { maxAttempts: 2 },
    ).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
  });

  it('reports a foreign route-table occupying the exact subnet slot as conflict', async () => {
    const fixture = makeAuthorityFixture();
    const observation = await observerFor(
      fixture,
      scriptedClient(fixture, {
        exact: () => ({
          RouteTables: [routeTable(fixture, { Associations: [] })],
        }),
        discovery: () => ({
          RouteTables: [
            routeTable(fixture, {
              RouteTableId: IDS.otherRouteTable,
              Associations: [
                association({
                  RouteTableAssociationId: IDS.otherAssociation,
                  RouteTableId: IDS.otherRouteTable,
                }),
              ],
            }),
          ],
        }),
      }),
    ).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'conflict',
        expectedProviderIdentity(),
        null,
      ),
    );
  });

  it('does not let an unreadable exact parent hide a foreign subnet-slot collision', async () => {
    const fixture = makeAuthorityFixture();
    const observation = await observerFor(
      fixture,
      scriptedClient(fixture, {
        exact: () => ({ RouteTables: null }),
        discovery: () => ({
          RouteTables: [
            routeTable(fixture, {
              RouteTableId: IDS.otherRouteTable,
              Associations: [
                association({
                  RouteTableAssociationId: IDS.otherAssociation,
                  RouteTableId: IDS.otherRouteTable,
                }),
              ],
            }),
          ],
        }),
      }),
    ).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'conflict',
        expectedProviderIdentity(),
        null,
      ),
    );
  });

  it.each([
    [
      'another subnet with the target slot empty',
      [
        association({
          RouteTableAssociationId: IDS.otherAssociation,
          SubnetId: IDS.otherSubnet,
        }),
      ],
      [],
    ],
    [
      'a gateway association beside the exact target',
      [
        association(),
        association({
          GatewayId: IDS.internetGateway,
          RouteTableAssociationId: IDS.otherAssociation,
          SubnetId: undefined,
        }),
      ],
      [
        association(),
        association({
          GatewayId: IDS.internetGateway,
          RouteTableAssociationId: IDS.otherAssociation,
          SubnetId: undefined,
        }),
      ],
    ],
  ])(
    'reports intended-table occupancy by %s as conflict',
    async (_label, exactAssociations, discoveryAssociations) => {
      const fixture = makeAuthorityFixture();
      const observation = await observerFor(
        fixture,
        scriptedClient(fixture, {
          exact: () => ({
            RouteTables: [
              routeTable(fixture, { Associations: exactAssociations }),
            ],
          }),
          discovery: () => ({
            RouteTables:
              discoveryAssociations.length === 0
                ? []
                : [
                    routeTable(fixture, {
                      Associations: discoveryAssociations,
                    }),
                  ],
          }),
        }),
      ).observe(fixture.authority);

      expect(observation).toEqual(
        expectedObservation(
          'present',
          'conflict',
          expectedProviderIdentity(),
          null,
        ),
      );
    },
  );

  it('lets current delete observe the exact target through degraded subnet health and unrelated topology', async () => {
    const fixture = makeCurrentDeleteAuthorityFixture();
    const associations = [
      association(),
      association({
        RouteTableAssociationId: IDS.otherAssociation,
        SubnetId: IDS.otherSubnet,
      }),
    ];
    const observation = await observerFor(
      fixture,
      scriptedClient(fixture, {
        subnet: () => ({
          Subnets: [subnet(fixture, { State: 'failed-insufficient-capacity' })],
        }),
        exact: () => ({
          RouteTables: [routeTable(fixture, { Associations: associations })],
        }),
        discovery: () => ({
          RouteTables: [routeTable(fixture, { Associations: associations })],
        }),
      }),
    ).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'verified',
        expectedProviderIdentity(),
        getAwsSingleNodeSubnetRouteTableAssociationStateDigest(
          fixture.base.providerSpec,
        ),
      ),
    );
  });

  it('preserves a first-page foreign slot conflict over a later-page failure', async () => {
    const fixture = makeAuthorityFixture();
    const discovery = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => {
        if (!Object.hasOwn(request, 'NextToken')) {
          return {
            RouteTables: [
              routeTable(fixture, {
                RouteTableId: IDS.otherRouteTable,
                Associations: [
                  association({
                    RouteTableAssociationId: IDS.otherAssociation,
                    RouteTableId: IDS.otherRouteTable,
                  }),
                ],
              }),
            ],
            NextToken: 'page-2',
          };
        }
        throw new Error('later-page-secret');
      },
    );
    const observation = await observerFor(
      fixture,
      scriptedClient(fixture, {
        exact: () => ({
          RouteTables: [routeTable(fixture, { Associations: [] })],
        }),
        discovery,
      }),
    ).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'conflict',
        expectedProviderIdentity(),
        null,
      ),
    );
    expect(discovery).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'subnet owner',
      {
        subnet: (/** @type {Readonly<AnyRecord>} */ fixture) => ({
          Subnets: [subnet(fixture, { OwnerId: '999999999999' })],
        }),
      },
    ],
    [
      'route-table VPC',
      {
        exact: (/** @type {Readonly<AnyRecord>} */ fixture) => ({
          RouteTables: [routeTable(fixture, { VpcId: IDS.otherVpc })],
        }),
      },
    ],
    [
      'slot account',
      {
        discovery: (/** @type {Readonly<AnyRecord>} */ fixture) => ({
          RouteTables: [routeTable(fixture, { OwnerId: '999999999999' })],
        }),
      },
    ],
  ])('reports contradictory %s lineage as conflict', async (_label, views) => {
    const fixture = makeAuthorityFixture();
    const typedViews =
      /** @type {{subnet?: (fixture: Readonly<AnyRecord>) => unknown, exact?: (fixture: Readonly<AnyRecord>) => unknown, discovery?: (fixture: Readonly<AnyRecord>) => unknown}} */ (
        views
      );
    const subnetView = typedViews.subnet;
    const exactView = typedViews.exact;
    const discoveryView = typedViews.discovery;
    const observation = await observerFor(
      fixture,
      scriptedClient(fixture, {
        ...(subnetView === undefined
          ? {}
          : { subnet: () => subnetView(fixture) }),
        ...(exactView === undefined ? {} : { exact: () => exactView(fixture) }),
        ...(discoveryView === undefined
          ? {}
          : { discovery: () => discoveryView(fixture) }),
      }),
    ).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'conflict',
        expectedProviderIdentity(),
        null,
      ),
    );
  });

  it('keeps a missing association ID or malformed response unknown', async () => {
    const fixture = makeAuthorityFixture();
    const missingId = {
      ...association(),
      RouteTableAssociationId: undefined,
    };
    const missing = await observerFor(
      fixture,
      scriptedClient(fixture, {
        exact: () => ({
          RouteTables: [routeTable(fixture, { Associations: [missingId] })],
        }),
      }),
    ).observe(fixture.authority);
    const malformed = await observerFor(
      fixture,
      scriptedClient(fixture, {
        discovery: () => ({ RouteTables: null }),
      }),
    ).observe(fixture.authority);

    expect(missing).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(malformed).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
  });

  it('retries transitional state but reports terminal association state as conflict', async () => {
    const fixture = makeAuthorityFixture();
    const pending = await observerFor(
      fixture,
      scriptedClient(fixture, {
        exact: () => ({
          RouteTables: [
            routeTable(fixture, {
              Associations: [
                association({
                  AssociationState: { State: 'associating' },
                }),
              ],
            }),
          ],
        }),
        discovery: () => ({
          RouteTables: [
            routeTable(fixture, {
              Associations: [
                association({
                  AssociationState: { State: 'associating' },
                }),
              ],
            }),
          ],
        }),
      }),
      { maxAttempts: 2 },
    ).observe(fixture.authority);
    const failed = await observerFor(
      fixture,
      scriptedClient(fixture, {
        exact: () => ({
          RouteTables: [
            routeTable(fixture, {
              Associations: [
                association({
                  AssociationState: { State: 'failed' },
                }),
              ],
            }),
          ],
        }),
        discovery: () => ({
          RouteTables: [
            routeTable(fixture, {
              Associations: [
                association({
                  AssociationState: { State: 'failed' },
                }),
              ],
            }),
          ],
        }),
      }),
    ).observe(fixture.authority);

    expect(pending).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(failed).toEqual(
      expectedObservation(
        'present',
        'conflict',
        expectedProviderIdentity(),
        null,
      ),
    );
  });

  it('completes bounded pagination and rejects a repeated token as unknown', async () => {
    const fixture = makeAuthorityFixture();
    let page = 0;
    const paged = await observerFor(
      fixture,
      scriptedClient(fixture, {
        discovery: (request) => {
          page += 1;
          if (page === 1) {
            expect(request).not.toHaveProperty('NextToken');
            return { RouteTables: [], NextToken: 'page-2' };
          }
          expect(request.NextToken).toBe('page-2');
          return { RouteTables: [routeTable(fixture)] };
        },
      }),
    ).observe(fixture.authority);
    const repeated = await observerFor(
      fixture,
      scriptedClient(fixture, {
        discovery: () => ({
          RouteTables: [],
          NextToken: 'same-token',
        }),
      }),
    ).observe(fixture.authority);

    expect(paged).toEqual(
      expectedObservation(
        'present',
        'verified',
        expectedProviderIdentity(),
        getAwsSingleNodeSubnetRouteTableAssociationStateDigest(
          fixture.base.providerSpec,
        ),
      ),
    );
    expect(repeated).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
  });

  it('contains provider and wait failures as unknown evidence', async () => {
    const fixture = makeAuthorityFixture();
    const providerFailure = await observerFor(
      fixture,
      scriptedClient(fixture, {
        exact: () => {
          throw Object.assign(new Error('provider-secret'), {
            name: 'RequestLimitExceeded',
          });
        },
      }),
    ).observe(fixture.authority);
    const waitForRetry = jest.fn(async (/** @type {number} */ _attempt) => {
      throw new Error('timer-secret');
    });
    const waitFailure = await observerFor(
      fixture,
      scriptedClient(fixture, {
        exact: () => ({
          RouteTables: [routeTable(fixture, { Associations: [] })],
        }),
        discovery: () => ({ RouteTables: [] }),
      }),
      { maxAttempts: 2, waitForRetry },
    ).observe(fixture.authority);

    expect(providerFailure).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(waitFailure).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(waitForRetry).toHaveBeenCalledWith(1);
  });
});
