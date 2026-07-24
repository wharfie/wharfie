import { describe, expect, it, jest } from '@jest/globals';

import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { createAwsSingleNodeResourceObservationAuthority } from '../../src/core/runtime/deployment-aws-resource-observation-authority.js';
import {
  createAwsSingleNodeSubnetEvidenceKernel,
  createAwsSingleNodeSubnetStateDigest,
  getAwsSingleNodeSubnetStateDigest,
} from '../../src/core/runtime/deployment-aws-subnet-evidence.js';
import {
  AwsSingleNodeSubnetResourceObserverAuthorityError,
  createAwsSingleNodeSubnetResourceObserver,
} from '../../src/core/runtime/deployment-aws-subnet-resource-observer.js';
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

const SUBNET_ID = 'subnet-00000000000000001';
const OTHER_SUBNET_ID = 'subnet-00000000000000002';
const VPC_ID = 'vpc-00000000000000001';
const OTHER_VPC_ID = 'vpc-00000000000000002';
const AVAILABILITY_ZONE_ID = 'use1-az1';
const SUBNET_CIDR = '10.42.0.0/24';

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
    appId: 'subnet-resource-observer-test',
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
      'wharfie:test:subnet-resource-observer-revision:v1',
      { appId: profile.appId },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'subnet resource observer artifact',
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
    placement: { availabilityZoneId: AVAILABILITY_ZONE_ID },
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
          'wharfie:test:subnet-resource-observer-inspection:v1',
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

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>} action
 * @param {Readonly<AnyRecord>} intent
 * @param {string} providerResourceId
 * @param {ReadonlyArray<Readonly<AnyRecord>>} dependencyBindings
 */
function makeBinding(
  base,
  action,
  intent,
  providerResourceId,
  dependencyBindings,
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
    dependencyBindings,
    providerType: action.after.providerType,
    providerResourceId,
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce: intent.ownershipNonce,
    createdByActionId: action.actionId,
  });
}

/**
 * @param {'bound'|'current-create'|'unbound'|'early-unbound'} mode
 * @returns {Readonly<AnyRecord>}
 */
function makeAuthorityFixture(mode) {
  const base = makeBase();
  const plan = makeCreatePlan(base);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'network-subnet',
  );
  const vpcActionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'network-vpc',
  );
  const action = plan.actions[actionIndex];
  const vpcAction = plan.actions[vpcActionIndex];
  if (action === undefined || vpcAction === undefined) {
    throw new Error('Missing fixture subnet or VPC action.');
  }
  const frontier =
    mode === 'bound'
      ? actionIndex + 1
      : mode === 'early-unbound'
        ? vpcActionIndex
        : actionIndex;
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
      ownershipNonce:
        candidate.management === 'managed' ? nonce(80 + index) : null,
    }),
  );
  const resourceBindings = [];
  let vpcBinding = null;
  if (vpcActionIndex < frontier) {
    vpcBinding = makeBinding(
      base,
      vpcAction,
      intents[vpcActionIndex],
      VPC_ID,
      [],
    );
    resourceBindings.push(vpcBinding);
  }
  if (mode === 'bound') {
    if (vpcBinding === null) throw new Error('Missing fixture VPC binding.');
    resourceBindings.push(
      makeBinding(base, action, intents[actionIndex], SUBNET_ID, [
        { resourceKey: 'network-vpc', bindingId: vpcBinding.bindingId },
      ]),
    );
  }
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
  const target = targetFor(makeTargets(base, head), 'network-subnet');
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
    vpcActionIndex,
    intents,
    head,
    target,
    authority,
  });
}

const tagEvidence = createAwsSingleNodeSubnetEvidenceKernel({
  readDiscoveryPage: async () => ({ records: [], nextToken: null }),
  readExact: async () => null,
});

/** @param {Readonly<AnyRecord>} fixture */
function fixtureLocator(fixture) {
  return {
    capabilityKind: 'networking',
    roleKind: 'subnet',
    providerScopeId: fixture.base.providerScope.providerScopeId,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
    resourceKey: 'network-subnet',
  };
}

/** @param {Readonly<AnyRecord>} fixture */
function fixtureOwnershipTags(fixture) {
  const binding = fixture.authority.binding;
  const currentAction = fixture.authority.currentAction;
  return tagEvidence.ownershipTags({
    ...fixtureLocator(fixture),
    createdByActionId:
      binding?.createdByActionId ??
      currentAction?.action.actionId ??
      fixture.action.actionId,
    ownershipNonce:
      binding?.ownershipNonce ??
      currentAction?.ownershipNonce ??
      fixture.intents[fixture.actionIndex].ownershipNonce,
    stateDigestValue: fixture.action.after.stateDigest.value,
  });
}

/** @param {Readonly<Record<string, string>>} tags */
function tagArray(tags) {
  return Object.entries(tags)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([Key, Value]) => ({ Key, Value }));
}

/** @param {Readonly<AnyRecord>} fixture @param {Partial<AnyRecord>} [overrides] */
function subnet(fixture, overrides = {}) {
  return {
    SubnetId: SUBNET_ID,
    OwnerId: fixture.base.providerScope.accountId,
    VpcId: VPC_ID,
    State: 'available',
    CidrBlock: SUBNET_CIDR,
    AvailabilityZoneId: AVAILABILITY_ZONE_ID,
    DefaultForAz: false,
    Ipv6Native: false,
    AssignIpv6AddressOnCreation: false,
    MapPublicIpOnLaunch: false,
    Ipv6CidrBlockAssociationSet: [],
    BlockPublicAccessStates: { InternetGatewayBlockMode: 'off' },
    Tags: tagArray(fixtureOwnershipTags(fixture)),
    ...overrides,
  };
}

/** @param {(request: AnyRecord) => any} handler */
function scriptedClient(handler) {
  return {
    describeSubnets: jest.fn(async (/** @type {AnyRecord} */ request) =>
      handler(request),
    ),
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} client @param {{maxAttempts?: number, waitForRetry?: (...args: any[]) => any}} [options] */
function observerFor(fixture, client, options = {}) {
  return createAwsSingleNodeSubnetResourceObserver({
    client,
    providerScope: fixture.base.providerScope,
    maxAttempts: options.maxAttempts ?? 1,
    waitForRetry: options.waitForRetry ?? jest.fn(async () => {}),
  });
}

/** @param {AnyRecord} request */
function isExact(request) {
  return Array.isArray(request.SubnetIds);
}

/** @param {AnyRecord} request */
function isLocator(request) {
  return (
    Array.isArray(request.Filters) &&
    request.Filters.some((filter) => filter.Name.startsWith('tag:'))
  );
}

/** @param {AnyRecord} request */
function isNatural(request) {
  return (
    Array.isArray(request.Filters) &&
    request.Filters.some((filter) => filter.Name === 'vpc-id')
  );
}

/** @param {'absent'|'present'|'unknown'} presence @param {'missing'|'verified'|'conflict'|'unknown'} ownership @param {AnyRecord|null} providerIdentity @param {AnyRecord|null} observedDigest */
function expectedObservation(
  presence,
  ownership,
  providerIdentity,
  observedDigest,
) {
  return {
    execution: 'none',
    health:
      presence === 'present'
        ? 'not-applicable'
        : presence === 'absent'
          ? 'absent'
          : 'unknown',
    observedDigest,
    ownership,
    presence,
    providerIdentity,
    resourceKey: 'network-subnet',
  };
}

describe('AWS single-node subnet observer factory and authority', () => {
  it('constructs without I/O and exposes only the frozen read port', () => {
    const fixture = makeAuthorityFixture('bound');
    const client = scriptedClient(() => {
      throw new Error('must not read while constructing');
    });
    const observer = observerFor(fixture, client);
    expect(Object.keys(observer)).toEqual(['observe']);
    expectDeepFrozen(observer);
    expect(client.describeSubnets).not.toHaveBeenCalled();
    expect(() =>
      createAwsSingleNodeSubnetResourceObserver({
        client: {
          describeSubnets: jest.fn(),
          createSubnet: jest.fn(),
        },
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(TypeError);
  });

  it('re-proves derived authority and constructor scope before provider I/O', async () => {
    const fixture = makeAuthorityFixture('bound');
    const client = scriptedClient(() => ({ Subnets: [subnet(fixture)] }));
    const observer = observerFor(fixture, client);
    const forged = {
      ...fixture.authority,
      binding: {
        ...fixture.authority.binding,
        providerResourceId: OTHER_SUBNET_ID,
      },
    };
    await expect(observer.observe(forged)).rejects.toThrow(
      AwsSingleNodeSubnetResourceObserverAuthorityError,
    );
    const wrongScope = createAwsProviderScope({
      partition: 'aws',
      accountId: '999999999999',
      region: 'us-east-1',
    });
    const wrongObserver = createAwsSingleNodeSubnetResourceObserver({
      client,
      providerScope: wrongScope,
      maxAttempts: 1,
    });
    await expect(wrongObserver.observe(fixture.authority)).rejects.toThrow(
      AwsSingleNodeSubnetResourceObserverAuthorityError,
    );
    expect(client.describeSubnets).not.toHaveBeenCalled();
  });
});

describe('AWS single-node subnet bound observation', () => {
  it('reads exact ID only and returns deeply frozen verified actual state', async () => {
    const fixture = makeAuthorityFixture('bound');
    const client = scriptedClient((request) => {
      expect(request).toEqual({ SubnetIds: [SUBNET_ID] });
      expectDeepFrozen(request);
      return { Subnets: [subnet(fixture)] };
    });
    const observed = await observerFor(fixture, client).observe(
      fixture.authority,
    );
    expect(observed).toEqual(
      expectedObservation(
        'present',
        'verified',
        {
          providerType: 'ec2-subnet',
          providerResourceId: SUBNET_ID,
        },
        getAwsSingleNodeSubnetStateDigest(fixture.base.providerSpec),
      ),
    );
    expectDeepFrozen(observed);
    expect(client.describeSubnets).toHaveBeenCalledTimes(1);
  });

  it('hashes readable scalar and stable associated-IPv6 drift as verified state', async () => {
    const fixture = makeAuthorityFixture('bound');
    const scalarDrift = subnet(fixture, {
      MapPublicIpOnLaunch: true,
      BlockPublicAccessStates: {
        InternetGatewayBlockMode: 'block-ingress',
      },
    });
    const scalarClient = scriptedClient(() => ({ Subnets: [scalarDrift] }));
    const scalarObserved = await observerFor(fixture, scalarClient).observe(
      fixture.authority,
    );
    expect(scalarObserved).toEqual(
      expectedObservation(
        'present',
        'verified',
        {
          providerType: 'ec2-subnet',
          providerResourceId: SUBNET_ID,
        },
        createAwsSingleNodeSubnetStateDigest({
          cidrBlock: SUBNET_CIDR,
          availabilityZoneId: AVAILABILITY_ZONE_ID,
          defaultForAz: false,
          ipv6Native: false,
          assignIpv6AddressOnCreation: false,
          mapPublicIpOnLaunch: true,
          internetGatewayBlockMode: 'block-ingress',
          onDestroy: 'purge',
        }),
      ),
    );

    const ipv6Client = scriptedClient(() => ({
      Subnets: [
        subnet(fixture, {
          Ipv6CidrBlockAssociationSet: [
            {
              AssociationId: 'subnet-cidr-assoc-00000000000000001',
              Ipv6CidrBlock: '2001:db8:1::/64',
              Ipv6CidrBlockState: { State: 'associated' },
            },
          ],
        }),
      ],
    }));
    const ipv6Observed = await observerFor(fixture, ipv6Client).observe(
      fixture.authority,
    );
    expect(ipv6Observed.presence).toBe('present');
    expect(ipv6Observed.ownership).toBe('verified');
    expect(ipv6Observed.execution).toBe('none');
    expect(ipv6Observed.observedDigest).not.toEqual(
      getAwsSingleNodeSubnetStateDigest(fixture.base.providerSpec),
    );
    expectDeepFrozen(ipv6Observed);
  });

  it('separates immutable owner, VPC, and receipt conflicts from unknown physical state', async () => {
    const fixture = makeAuthorityFixture('bound');
    for (const override of [
      { OwnerId: '999999999999' },
      { VpcId: OTHER_VPC_ID },
      {
        Tags: tagArray({
          ...fixtureOwnershipTags(fixture),
          'wharfie:ownership-nonce': nonce(250),
        }),
      },
    ]) {
      const client = scriptedClient(() => ({
        Subnets: [subnet(fixture, override)],
      }));
      await expect(
        observerFor(fixture, client).observe(fixture.authority),
      ).resolves.toEqual(
        expectedObservation(
          'present',
          'conflict',
          {
            providerType: 'ec2-subnet',
            providerResourceId: SUBNET_ID,
          },
          null,
        ),
      );
    }

    for (const override of [
      { CidrBlock: '10.42.0.1/24' },
      { OwnerId: 'not-an-account' },
    ]) {
      const malformedClient = scriptedClient(() => ({
        Subnets: [subnet(fixture, override)],
      }));
      await expect(
        observerFor(fixture, malformedClient).observe(fixture.authority),
      ).resolves.toEqual(expectedObservation('unknown', 'unknown', null, null));
    }
  });

  it('keeps typed NotFound and successful empty exact responses unknown without replacement search', async () => {
    const fixture = makeAuthorityFixture('bound');
    for (const name of [
      'InvalidSubnetID.NotFound',
      'InvalidSubnetId.NotFound',
    ]) {
      const client = scriptedClient(() => {
        const error = new Error('missing');
        error.name = name;
        throw error;
      });
      const observed = await observerFor(fixture, client, {
        maxAttempts: 2,
      }).observe(fixture.authority);
      expect(observed).toEqual(
        expectedObservation('unknown', 'unknown', null, null),
      );
      expect(client.describeSubnets).toHaveBeenCalledTimes(2);
      expect(
        client.describeSubnets.mock.calls.every(([request]) =>
          isExact(request),
        ),
      ).toBe(true);
    }
    const emptyClient = scriptedClient(() => ({ Subnets: [] }));
    await expect(
      observerFor(fixture, emptyClient).observe(fixture.authority),
    ).resolves.toEqual(expectedObservation('unknown', 'unknown', null, null));
    expect(emptyClient.describeSubnets).toHaveBeenCalledTimes(1);
  });
});

describe('AWS single-node subnet current-create observation', () => {
  it('requires locator, broad collision-slot, and exact-ID corroboration and never advises replay', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const candidate = subnet(fixture);
    const client = scriptedClient((request) => {
      if (isLocator(request) || isNatural(request)) {
        return { Subnets: [candidate] };
      }
      if (isExact(request)) return { Subnets: [candidate] };
      throw new Error('unexpected request');
    });
    const observed = await observerFor(fixture, client).observe(
      fixture.authority,
    );
    expect(observed).toEqual(
      expectedObservation(
        'present',
        'verified',
        {
          providerType: 'ec2-subnet',
          providerResourceId: SUBNET_ID,
        },
        getAwsSingleNodeSubnetStateDigest(fixture.base.providerSpec),
      ),
    );
    expect(observed.execution).toBe('none');
    const naturalRequest = client.describeSubnets.mock.calls
      .map(([request]) => request)
      .find(isNatural);
    expect(naturalRequest).toEqual({
      Filters: [
        { Name: 'vpc-id', Values: [VPC_ID] },
        { Name: 'cidr-block', Values: [SUBNET_CIDR] },
      ],
      MaxResults: 100,
    });
    expect(client.describeSubnets).toHaveBeenCalledTimes(3);
  });

  it('keeps clean empty and one-sided visibility unknown with execution none', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const cleanClient = scriptedClient(() => ({ Subnets: [] }));
    const clean = await observerFor(fixture, cleanClient, {
      maxAttempts: 2,
    }).observe(fixture.authority);
    expect(clean).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(clean.execution).toBe('none');
    expect(cleanClient.describeSubnets).toHaveBeenCalledTimes(4);

    const candidate = subnet(fixture);
    const oneSidedClient = scriptedClient((request) => ({
      Subnets: isLocator(request) ? [candidate] : [],
    }));
    await expect(
      observerFor(fixture, oneSidedClient).observe(fixture.authority),
    ).resolves.toEqual(expectedObservation('unknown', 'unknown', null, null));
  });

  it('requires the complete current receipt on the natural view too', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const complete = subnet(fixture);
    const incompleteNatural = subnet(fixture, {
      Tags: tagArray(tagEvidence.locatorTags(fixtureLocator(fixture))),
    });
    const client = scriptedClient((request) => {
      if (isLocator(request) || isExact(request)) {
        return { Subnets: [complete] };
      }
      if (isNatural(request)) return { Subnets: [incompleteNatural] };
      throw new Error('unexpected request');
    });
    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(expectedObservation('unknown', 'unknown', null, null));
  });

  it('reports crossed locator and natural identities as conflict without adoption', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const client = scriptedClient((request) => {
      if (isLocator(request)) return { Subnets: [subnet(fixture)] };
      if (isNatural(request)) {
        return {
          Subnets: [subnet(fixture, { SubnetId: OTHER_SUBNET_ID })],
        };
      }
      throw new Error('must not exact-read crossed candidates');
    });
    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation(
        'present',
        'conflict',
        {
          providerType: 'ec2-subnet',
          providerResourceId: SUBNET_ID,
        },
        null,
      ),
    );
  });
});

describe('AWS single-node subnet unbound observation', () => {
  it('proves absence only after every attempt has clean locator and natural traversals', async () => {
    const fixture = makeAuthorityFixture('unbound');
    const client = scriptedClient(() => ({ Subnets: [] }));
    const observed = await observerFor(fixture, client, {
      maxAttempts: 2,
    }).observe(fixture.authority);
    expect(observed).toEqual(
      expectedObservation('absent', 'missing', null, null),
    );
    expect(client.describeSubnets).toHaveBeenCalledTimes(4);
    expect(
      client.describeSubnets.mock.calls.filter(([request]) =>
        isLocator(request),
      ),
    ).toHaveLength(2);
    expect(
      client.describeSubnets.mock.calls.filter(([request]) =>
        isNatural(request),
      ),
    ).toHaveLength(2);
  });

  it('never promotes a prior uncertain attempt followed by clean views to absence', async () => {
    const fixture = makeAuthorityFixture('unbound');
    let calls = 0;
    const client = scriptedClient(() => {
      calls += 1;
      if (calls === 1) throw new Error('uncertain first locator read');
      return { Subnets: [] };
    });
    await expect(
      observerFor(fixture, client, { maxAttempts: 2 }).observe(
        fixture.authority,
      ),
    ).resolves.toEqual(expectedObservation('unknown', 'unknown', null, null));
  });

  it('lets either independently corroborated collision view dominate failure of the other', async () => {
    const fixture = makeAuthorityFixture('unbound');
    const locatorCandidate = subnet(fixture);
    const naturalFailureClient = scriptedClient((request) => {
      if (isLocator(request) || isExact(request)) {
        return { Subnets: [locatorCandidate] };
      }
      if (isNatural(request)) throw new Error('natural view unavailable');
      throw new Error('unexpected request');
    });
    await expect(
      observerFor(fixture, naturalFailureClient).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation(
        'present',
        'conflict',
        {
          providerType: 'ec2-subnet',
          providerResourceId: SUBNET_ID,
        },
        null,
      ),
    );

    const naturalCandidate = subnet(fixture, { Tags: [] });
    const locatorFailureClient = scriptedClient((request) => {
      if (isLocator(request)) throw new Error('locator view unavailable');
      if (isNatural(request) || isExact(request)) {
        return { Subnets: [naturalCandidate] };
      }
      throw new Error('unexpected request');
    });
    await expect(
      observerFor(fixture, locatorFailureClient).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation(
        'present',
        'conflict',
        {
          providerType: 'ec2-subnet',
          providerResourceId: SUBNET_ID,
        },
        null,
      ),
    );
  });

  it('reports an exact-corroborated untagged natural-slot occupant as collision', async () => {
    const fixture = makeAuthorityFixture('unbound');
    const occupant = subnet(fixture, { Tags: [] });
    const client = scriptedClient((request) => {
      if (isLocator(request)) return { Subnets: [] };
      if (isNatural(request) || isExact(request)) {
        return { Subnets: [occupant] };
      }
      throw new Error('unexpected request');
    });
    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation(
        'present',
        'conflict',
        {
          providerType: 'ec2-subnet',
          providerResourceId: SUBNET_ID,
        },
        null,
      ),
    );
  });

  it('reports multiple valid candidates as a deterministic collision', async () => {
    const fixture = makeAuthorityFixture('unbound');
    const client = scriptedClient((request) => {
      if (isLocator(request)) {
        return {
          Subnets: [
            subnet(fixture, { SubnetId: OTHER_SUBNET_ID }),
            subnet(fixture),
          ],
        };
      }
      throw new Error('must stop after plural locator evidence');
    });
    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation(
        'present',
        'conflict',
        {
          providerType: 'ec2-subnet',
          providerResourceId: SUBNET_ID,
        },
        null,
      ),
    );
  });

  it('reports crossed logical and natural occupants as collision, never replacement evidence', async () => {
    const fixture = makeAuthorityFixture('unbound');
    const client = scriptedClient((request) => {
      if (isLocator(request)) return { Subnets: [subnet(fixture)] };
      if (isNatural(request)) {
        return {
          Subnets: [subnet(fixture, { SubnetId: OTHER_SUBNET_ID })],
        };
      }
      throw new Error('must not exact-read crossed occupants');
    });
    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation(
        'present',
        'conflict',
        {
          providerType: 'ec2-subnet',
          providerResourceId: SUBNET_ID,
        },
        null,
      ),
    );
  });

  it('lets exact natural occupancy dominate stale locator receipt tags', async () => {
    const fixture = makeAuthorityFixture('unbound');
    const staleLocator = subnet(fixture, {
      Tags: tagArray({
        ...tagEvidence.locatorTags(fixtureLocator(fixture)),
        'wharfie:created-by-action-id': fixture.action.actionId,
        'wharfie:ownership-nonce': nonce(251),
        'wharfie:state-digest': fixture.action.after.stateDigest.value,
      }),
    });
    const untaggedNatural = subnet(fixture, { Tags: [] });
    const client = scriptedClient((request) => {
      if (isLocator(request)) return { Subnets: [staleLocator] };
      if (isNatural(request) || isExact(request)) {
        return { Subnets: [untaggedNatural] };
      }
      throw new Error('unexpected request');
    });
    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation(
        'present',
        'conflict',
        {
          providerType: 'ec2-subnet',
          providerResourceId: SUBNET_ID,
        },
        null,
      ),
    );
  });

  it('uses an early locator collision but cannot infer absence without VPC authority', async () => {
    const fixture = makeAuthorityFixture('early-unbound');
    const candidate = subnet(fixture, {
      Tags: tagArray(tagEvidence.locatorTags(fixtureLocator(fixture))),
    });
    const collisionClient = scriptedClient((request) => {
      expect(isNatural(request)).toBe(false);
      if (isLocator(request) || isExact(request)) {
        return { Subnets: [candidate] };
      }
      throw new Error('unexpected request');
    });
    await expect(
      observerFor(fixture, collisionClient).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation(
        'present',
        'conflict',
        {
          providerType: 'ec2-subnet',
          providerResourceId: SUBNET_ID,
        },
        null,
      ),
    );

    const emptyClient = scriptedClient((request) => {
      expect(isNatural(request)).toBe(false);
      return { Subnets: [] };
    });
    await expect(
      observerFor(fixture, emptyClient).observe(fixture.authority),
    ).resolves.toEqual(expectedObservation('unknown', 'unknown', null, null));
  });

  it('fails closed on malformed natural pagination and waiter failure', async () => {
    const fixture = makeAuthorityFixture('unbound');
    const malformedClient = scriptedClient((request) => {
      if (isLocator(request)) return { Subnets: [] };
      return { Subnets: [], NextToken: '' };
    });
    await expect(
      observerFor(fixture, malformedClient).observe(fixture.authority),
    ).resolves.toEqual(expectedObservation('unknown', 'unknown', null, null));

    const retryClient = scriptedClient(() => {
      throw new Error('retryable provider failure');
    });
    await expect(
      observerFor(fixture, retryClient, {
        maxAttempts: 2,
        waitForRetry: jest.fn(async () => {
          throw new Error('wait failed');
        }),
      }).observe(fixture.authority),
    ).resolves.toEqual(expectedObservation('unknown', 'unknown', null, null));
  });
});
