import { describe, expect, it, jest } from '@jest/globals';

import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { createAwsSingleNodeResourceObservationAuthority } from '../../src/core/runtime/deployment-aws-resource-observation-authority.js';
import {
  createAwsSingleNodeRouteTableEvidenceKernel,
  createAwsSingleNodeRouteTableStateDigest,
  getAwsSingleNodeRouteTableStateDigest,
} from '../../src/core/runtime/deployment-aws-route-table-evidence.js';
import {
  AwsSingleNodeRouteTableResourceObserverAuthorityError,
  createAwsSingleNodeRouteTableResourceObserver,
} from '../../src/core/runtime/deployment-aws-route-table-resource-observer.js';
import { getAwsSingleNodeManagedArtifactObjectLocation } from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
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
  routeTable: 'rtb-00000000000000001',
  otherRouteTable: 'rtb-00000000000000002',
  vpc: 'vpc-00000000000000001',
  internetGateway: 'igw-00000000000000001',
  subnet: 'subnet-00000000000000001',
  association: 'rtbassoc-00000000000000001',
  application: 'vol-00000000000000001',
  control: 'vol-00000000000000002',
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
    appId: 'route-table-resource-observer-test',
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
      'wharfie:test:route-table-resource-observer-revision:v1',
      { appId: profile.appId },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'route table observer artifact',
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
          'win5',
          'wharfie:test:route-table-resource-observer-inspection:v1',
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
      action.resourceKey === 'network-route-table',
  );
  const action = plan.actions[actionIndex];
  if (action === undefined) throw new Error('Missing route-table action.');
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
  const target = targetFor(makeTargets(base, head), 'network-route-table');
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

const tagEvidence = createAwsSingleNodeRouteTableEvidenceKernel({
  readDiscoveryPage: async () => ({ records: [], nextToken: null }),
  readExact: async () => null,
});

/** @param {Readonly<AnyRecord>} fixture */
function fixtureLocator(fixture) {
  return {
    capabilityKind: fixture.target.capability.kind,
    roleKind: fixture.target.role.kind,
    providerScopeId: fixture.base.providerScope.providerScopeId,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
    resourceKey: fixture.target.resourceKey,
  };
}

/** @param {Readonly<AnyRecord>} fixture */
function fixtureOwnershipTags(fixture) {
  if (fixture.authority.binding !== null) {
    return tagEvidence.ownershipTags({
      ...fixtureLocator(fixture),
      createdByActionId: fixture.authority.binding.createdByActionId,
      ownershipNonce: fixture.authority.binding.ownershipNonce,
      stateDigestValue: fixture.action.after.stateDigest.value,
    });
  }
  const currentAction = fixture.authority.currentAction;
  if (currentAction === null) {
    throw new Error('Fixture has no ownership receipt.');
  }
  return tagEvidence.ownershipTags({
    ...fixtureLocator(fixture),
    createdByActionId: currentAction.action.actionId,
    ownershipNonce: currentAction.ownershipNonce,
    stateDigestValue: currentAction.action.after.stateDigest.value,
  });
}

/**
 * @param {Readonly<AnyRecord>} fixture
 * @param {{id?: string, ownerId?: string, vpcId?: string, tags?: Readonly<Record<string, string>>, tagList?: unknown, routes?: unknown, associations?: unknown, propagations?: unknown}} [options]
 */
function routeTable(fixture, options = {}) {
  const defaultTags =
    fixture.mode === 'bound' || fixture.mode === 'current-create'
      ? fixtureOwnershipTags(fixture)
      : tagEvidence.locatorTags(fixtureLocator(fixture));
  return {
    RouteTableId: options.id ?? IDS.routeTable,
    OwnerId: options.ownerId ?? fixture.base.providerScope.accountId,
    VpcId: options.vpcId ?? IDS.vpc,
    Routes: options.routes ?? [
      {
        DestinationCidrBlock:
          fixture.base.providerSpec.capabilities.networking.vpcCidr,
        GatewayId: 'local',
        Origin: 'CreateRouteTable',
        State: 'active',
      },
    ],
    Associations: options.associations ?? [],
    PropagatingVgws: options.propagations ?? [],
    Tags:
      options.tagList ?? tagEvidence.sortedTags(options.tags ?? defaultTags),
  };
}

/** @param {(request: Readonly<AnyRecord>, callIndex: number) => unknown|Promise<unknown>} handler */
function scriptedClient(handler) {
  let callIndex = 0;
  return {
    describeRouteTables: jest.fn(async (request) => {
      callIndex += 1;
      return handler(/** @type {Readonly<AnyRecord>} */ (request), callIndex);
    }),
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} client @param {{maxAttempts?: number, waitForRetry?: (attempt: number) => Promise<void>}} [options] */
function observerFor(fixture, client, options = {}) {
  return createAwsSingleNodeRouteTableResourceObserver({
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
 * @param {'none'|'replay-safe-create'} [execution]
 */
function expectedObservation(
  presence,
  ownership,
  providerIdentity,
  observedDigest,
  execution = 'none',
) {
  return {
    resourceKey: 'network-route-table',
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
    execution,
  };
}

describe('AWS single-node route-table resource observer', () => {
  it('constructs without I/O and accepts only the exact read port', () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient(() => {
      throw new Error('constructor performed I/O');
    });
    const observer = observerFor(fixture, client);

    expect(Object.keys(observer)).toEqual(['observe']);
    expect(Object.isFrozen(observer)).toBe(true);
    expect(client.describeRouteTables).not.toHaveBeenCalled();
    expect(() =>
      createAwsSingleNodeRouteTableResourceObserver({
        client: {
          describeRouteTables: async () => ({}),
          createRouteTable: async () => ({}),
        },
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(/createRouteTable is not supported/);
  });

  it('re-proves authority and exact VPC dependency lineage before I/O', async () => {
    const fixture = makeAuthorityFixture();
    const forged = clone(fixture.authority);
    forged.binding.dependencyBindings[0].bindingId = semanticId(
      'wdb2',
      'wharfie:test:wrong-route-vpc-binding:v1',
      {},
    );
    const client = scriptedClient(() => ({ RouteTables: [] }));

    await expect(
      observerFor(fixture, client).observe(forged),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeRouteTableResourceObserverAuthorityError,
    );
    expect(client.describeRouteTables).not.toHaveBeenCalled();
  });

  it('verifies a bound route table by exact ID only and freezes I/O', async () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient((request) => {
      expect(request).toEqual({ RouteTableIds: [IDS.routeTable] });
      expectDeepFrozen(request);
      return { RouteTables: [routeTable(fixture)] };
    });

    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'verified',
        {
          providerType: 'ec2-route-table',
          providerResourceId: IDS.routeTable,
        },
        getAwsSingleNodeRouteTableStateDigest(fixture.base.providerSpec),
      ),
    );
    expectDeepFrozen(observation);
    expect(client.describeRouteTables).toHaveBeenCalledTimes(1);
  });

  it('hashes readable base drift while excluding supported child state', async () => {
    const fixture = makeAuthorityFixture();
    const virtualGatewayId = 'vgw-00000000000000001';
    const record = routeTable(fixture, {
      propagations: [{ GatewayId: virtualGatewayId }],
      routes: [
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
          State: 'blackhole',
        },
      ],
      associations: [
        {
          Main: false,
          RouteTableAssociationId: IDS.association,
          RouteTableId: IDS.routeTable,
          SubnetId: IDS.subnet,
          AssociationState: { State: 'disassociating' },
        },
      ],
    });
    const observation = await observerFor(
      fixture,
      scriptedClient(() => ({ RouteTables: [record] })),
    ).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'verified',
        {
          providerType: 'ec2-route-table',
          providerResourceId: IDS.routeTable,
        },
        createAwsSingleNodeRouteTableStateDigest({
          localIpv4Route: {
            destinationCidrBlock:
              fixture.base.providerSpec.capabilities.networking.vpcCidr,
            gatewayId: 'local',
            origin: 'CreateRouteTable',
            state: 'active',
          },
          main: false,
          propagatingVirtualGateways: [virtualGatewayId],
          onDestroy: 'purge',
        }),
      ),
    );
  });

  it.each([
    ['owner', { ownerId: '999999999999' }],
    ['VPC', { vpcId: 'vpc-00000000000000002' }],
  ])(
    'reports contradictory bound %s ownership as conflict',
    async (_label, options) => {
      const fixture = makeAuthorityFixture();
      const observation = await observerFor(
        fixture,
        scriptedClient(() => ({
          RouteTables: [routeTable(fixture, options)],
        })),
      ).observe(fixture.authority);

      expect(observation).toEqual(
        expectedObservation(
          'present',
          'conflict',
          {
            providerType: 'ec2-route-table',
            providerResourceId: IDS.routeTable,
          },
          null,
        ),
      );
    },
  );

  it('keeps bound exact absence unknown without locator discovery', async () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient(() => {
      throw Object.assign(new Error('not found'), {
        name: 'InvalidRouteTableID.NotFound',
      });
    });
    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
    }).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(client.describeRouteTables).toHaveBeenCalledTimes(2);
    for (const [request] of client.describeRouteTables.mock.calls) {
      expect(request).toEqual({ RouteTableIds: [IDS.routeTable] });
    }
  });

  it('reports a contradictory bound exact identity as conflict', async () => {
    const fixture = makeAuthorityFixture();
    const observation = await observerFor(
      fixture,
      scriptedClient(() => ({
        RouteTables: [
          routeTable(fixture, {
            id: IDS.otherRouteTable,
          }),
        ],
      })),
    ).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'conflict',
        {
          providerType: 'ec2-route-table',
          providerResourceId: IDS.routeTable,
        },
        null,
      ),
    );
  });

  it('returns unbound locator evidence as collision without adopting it', async () => {
    const fixture = makeAuthorityFixture('unbound');
    const candidate = routeTable(fixture);
    const client = scriptedClient((request) => {
      expect(request).not.toHaveProperty('RouteTableIds');
      expect(request).toEqual({
        Filters: tagEvidence.discoveryFilters(fixtureLocator(fixture)),
        MaxResults: 100,
      });
      return { RouteTables: [candidate] };
    });

    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'conflict',
        {
          providerType: 'ec2-route-table',
          providerResourceId: IDS.routeTable,
        },
        null,
      ),
    );
    expect(client.describeRouteTables).toHaveBeenCalledTimes(1);
  });

  it('reports multiple current-create locator identities as conflict', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const client = scriptedClient(() => ({
      RouteTables: [
        routeTable(fixture),
        routeTable(fixture, { id: IDS.otherRouteTable }),
      ],
    }));

    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'conflict',
        {
          providerType: 'ec2-route-table',
          providerResourceId: IDS.routeTable,
        },
        null,
      ),
    );
    expect(client.describeRouteTables).toHaveBeenCalledTimes(1);
  });

  it.each(['unbound', 'early-unbound'])(
    'returns bounded clean locator absence for %s authority',
    async (mode) => {
      const fixture = makeAuthorityFixture(
        /** @type {'unbound'|'early-unbound'} */ (mode),
      );
      const observation = await observerFor(
        fixture,
        scriptedClient(() => ({ RouteTables: [] })),
      ).observe(fixture.authority);

      expect(observation).toEqual(
        expectedObservation('absent', 'missing', null, null),
      );
    },
  );

  it('verifies current create only through complete locator plus exact evidence', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const record = routeTable(fixture);
    const client = scriptedClient((request, callIndex) => {
      if (callIndex === 1) {
        expect(request).toHaveProperty('Filters');
        return { RouteTables: [clone(record)] };
      }
      expect(request).toEqual({ RouteTableIds: [IDS.routeTable] });
      return { RouteTables: [clone(record)] };
    });

    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'verified',
        {
          providerType: 'ec2-route-table',
          providerResourceId: IDS.routeTable,
        },
        getAwsSingleNodeRouteTableStateDigest(fixture.base.providerSpec),
      ),
    );
    expect(client.describeRouteTables).toHaveBeenCalledTimes(2);
  });

  it('reports a locator/exact current-create identity contradiction as conflict', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const candidate = routeTable(fixture);
    const client = scriptedClient((_request, callIndex) => ({
      RouteTables: [
        callIndex === 1
          ? candidate
          : routeTable(fixture, { id: IDS.otherRouteTable }),
      ],
    }));

    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'conflict',
        {
          providerType: 'ec2-route-table',
          providerResourceId: IDS.routeTable,
        },
        null,
      ),
    );
  });

  it('returns current-create ownership conflict without exact adoption', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const tags = { ...fixtureOwnershipTags(fixture) };
    tags['wharfie:ownership-nonce'] = nonce(250);
    const client = scriptedClient(() => ({
      RouteTables: [routeTable(fixture, { tags })],
    }));

    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'conflict',
        {
          providerType: 'ec2-route-table',
          providerResourceId: IDS.routeTable,
        },
        null,
      ),
    );
    expect(client.describeRouteTables).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'default-route child',
      {
        routes: [
          {
            DestinationCidrBlock: '10.42.0.0/16',
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
      },
    ],
    [
      'subnet-association child',
      {
        associations: [
          {
            Main: false,
            RouteTableAssociationId: IDS.association,
            RouteTableId: IDS.routeTable,
            SubnetId: IDS.subnet,
            AssociationState: { State: 'associated' },
          },
        ],
      },
    ],
    [
      'virtual-gateway propagation',
      { propagations: [{ GatewayId: 'vgw-00000000000000001' }] },
    ],
    [
      'intrinsic local-route drift',
      {
        routes: [
          {
            DestinationCidrBlock: '10.99.0.0/16',
            GatewayId: 'local',
            Origin: 'CreateRouteTable',
            State: 'active',
          },
        ],
      },
    ],
  ])(
    'reports conclusive current-create %s as conflict',
    async (_label, options) => {
      const fixture = makeAuthorityFixture('current-create');
      const record = routeTable(fixture, options);
      const observation = await observerFor(
        fixture,
        scriptedClient(() => ({ RouteTables: [clone(record)] })),
      ).observe(fixture.authority);

      expect(observation).toEqual(
        expectedObservation(
          'present',
          'conflict',
          {
            providerType: 'ec2-route-table',
            providerResourceId: IDS.routeTable,
          },
          null,
        ),
      );
      expect(observation.execution).toBe('none');
    },
  );

  it('recommends replay only after every bounded locator read is clean empty', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const waitForRetry = jest.fn(async () => {});
    const client = scriptedClient(() => ({ RouteTables: [] }));
    const observation = await observerFor(fixture, client, {
      maxAttempts: 3,
      waitForRetry,
    }).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation(
        'unknown',
        'unknown',
        null,
        null,
        'replay-safe-create',
      ),
    );
    expect(client.describeRouteTables).toHaveBeenCalledTimes(3);
    expect(waitForRetry.mock.calls).toEqual([[1], [2]]);
  });

  it.each(['read-error', 'partial-candidate', 'failed-wait'])(
    'suppresses replay after a %s',
    async (scenario) => {
      const fixture = makeAuthorityFixture('current-create');
      const candidate = routeTable(fixture);
      const waitForRetry = jest.fn(async () => {
        if (scenario === 'failed-wait') throw new Error('wait failed');
      });
      const client = scriptedClient((request, callIndex) => {
        if (scenario === 'read-error' && callIndex === 1) {
          throw new Error('ambiguous provider failure');
        }
        if (scenario === 'partial-candidate' && callIndex === 1) {
          return { RouteTables: [candidate] };
        }
        if (scenario === 'partial-candidate' && callIndex === 2) {
          expect(request).toEqual({ RouteTableIds: [IDS.routeTable] });
          throw Object.assign(new Error('not found'), {
            name: 'InvalidRouteTableID.NotFound',
          });
        }
        return { RouteTables: [] };
      });
      const observation = await observerFor(fixture, client, {
        maxAttempts: 2,
        waitForRetry,
      }).observe(fixture.authority);

      expect(observation).toEqual(
        expectedObservation('unknown', 'unknown', null, null),
      );
      expect(observation.execution).toBe('none');
    },
  );

  it('keeps partial creation tags and malformed discovery envelopes unknown', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const partialTags = { ...fixtureOwnershipTags(fixture) };
    delete partialTags['wharfie:ownership-nonce'];
    const partial = await observerFor(
      fixture,
      scriptedClient(() => ({
        RouteTables: [routeTable(fixture, { tags: partialTags })],
      })),
    ).observe(fixture.authority);
    expect(partial).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );

    const malformed = await observerFor(
      fixture,
      scriptedClient(() => ({ RouteTables: null })),
    ).observe(fixture.authority);
    expect(malformed).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
  });
});
