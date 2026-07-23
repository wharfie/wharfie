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
import { getAwsSingleNodeManagedArtifactObjectLocation } from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import {
  createAwsSingleNodeVpcStateDigest,
  getAwsSingleNodeVpcStateDigest,
} from '../../src/core/runtime/deployment-aws-vpc-evidence.js';
import {
  AwsSingleNodeVpcResourceObserverAuthorityError,
  createAwsSingleNodeVpcResourceObserver,
} from '../../src/core/runtime/deployment-aws-vpc-resource-observer.js';
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

const VPC_ID = 'vpc-00000000000000001';
const OTHER_VPC_ID = 'vpc-00000000000000002';
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
    appId: 'vpc-resource-observer-test',
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
      'wharfie:test:vpc-resource-observer-revision:v1',
      { appId: profile.appId },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'vpc resource observer artifact',
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
          'wharfie:test:vpc-resource-observer-inspection:v1',
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
function providerResourceId(base, action) {
  if (action.resourceKey === 'artifact') {
    return getAwsSingleNodeManagedArtifactObjectLocation({
      providerScope: base.providerScope,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
    }).arn;
  }
  if (action.resourceKey === 'application-state') {
    return 'vol-00000000000000001';
  }
  if (action.resourceKey === 'control-state') {
    return 'vol-00000000000000002';
  }
  if (action.resourceKey === 'network-vpc') return VPC_ID;
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
          providerResourceId: providerResourceId(base, action),
          providerScopeId: base.providerScope.providerScopeId,
          ownershipNonce: intents[index].ownershipNonce,
          createdByActionId: action.actionId,
        }),
    );
}

/** @param {'bound'|'current-create'|'unbound'} mode */
function makeAuthorityFixture(mode) {
  const base = makeBase();
  const plan = makeCreatePlan(base);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'network-vpc',
  );
  const action = plan.actions[actionIndex];
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
      ownershipNonce:
        candidate.management === 'managed' ? nonce(80 + index) : null,
    }),
  );
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
    resourceBindings: makePrefixBindings(base, plan, intents, frontier),
    activeOperation: {
      kind: 'create',
      planId: plan.planId,
      status: 'running',
      nextActionIndex: frontier,
      intents,
    },
    lastOperation: null,
  });
  const target = targetFor(makeTargets(base, head), 'network-vpc');
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
    base,
    plan,
    action,
    actionIndex,
    intents,
    head,
    target,
    authority,
    mode,
  });
}

/** @param {Readonly<AnyRecord>} fixture */
function locatorTags(fixture) {
  return {
    'wharfie:managed-by': 'wharfie',
    'wharfie:resource-kind': 'single-node-vpc',
    'wharfie:retention': 'purge',
    'wharfie:schema-version': '2',
    'wharfie:capability': 'networking',
    'wharfie:role': 'vpc',
    'wharfie:provider-scope-id': fixture.base.providerScope.providerScopeId,
    'wharfie:deployment-instance-id': fixture.base.deploymentInstanceId,
    'wharfie:incarnation-id': fixture.base.incarnationId,
    'wharfie:resource-key': 'network-vpc',
  };
}

/** @param {Readonly<AnyRecord>} fixture */
function ownershipTags(fixture) {
  const binding = fixture.authority.binding;
  const currentAction = fixture.authority.currentAction;
  return {
    ...locatorTags(fixture),
    'wharfie:created-by-action-id':
      binding?.createdByActionId ??
      currentAction?.action.actionId ??
      fixture.action.actionId,
    'wharfie:ownership-nonce':
      binding?.ownershipNonce ??
      currentAction?.ownershipNonce ??
      fixture.intents[fixture.actionIndex].ownershipNonce,
    'wharfie:state-digest': fixture.action.after.stateDigest.value,
  };
}

/** @param {Readonly<Record<string, string>>} tags */
function tagArray(tags) {
  return Object.entries(tags)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([Key, Value]) => ({ Key, Value }));
}

/** @param {Readonly<AnyRecord>} fixture @param {Partial<AnyRecord>} [overrides] */
function makeVpc(fixture, overrides = {}) {
  const cidrBlock = overrides.CidrBlock ?? '10.42.0.0/16';
  return {
    VpcId: VPC_ID,
    OwnerId: fixture.base.providerScope.accountId,
    State: 'available',
    CidrBlock: cidrBlock,
    CidrBlockAssociationSet: [
      {
        AssociationId: 'vpc-cidr-assoc-00000000000000001',
        CidrBlock: cidrBlock,
        CidrBlockState: { State: 'associated' },
      },
    ],
    Ipv6CidrBlockAssociationSet: [],
    InstanceTenancy: 'default',
    IsDefault: false,
    DhcpOptionsId: 'dopt-00000000000000001',
    BlockPublicAccessStates: { InternetGatewayBlockMode: 'off' },
    Tags: tagArray(ownershipTags(fixture)),
    ...overrides,
  };
}

/**
 * @param {string} vpcId
 * @param {boolean} support
 * @param {boolean} hostnames
 */
function attributeReader(vpcId = VPC_ID, support = true, hostnames = false) {
  return jest.fn(async (/** @type {AnyRecord} */ input) => {
    if (input.Attribute === 'enableDnsSupport') {
      return { VpcId: vpcId, EnableDnsSupport: { Value: support } };
    }
    if (input.Attribute === 'enableDnsHostnames') {
      return { VpcId: vpcId, EnableDnsHostnames: { Value: hostnames } };
    }
    throw new Error('unexpected attribute');
  });
}

/** @param {(...args: any[]) => any} describeVpcs @param {(...args: any[]) => any} [describeVpcAttribute] */
function makeClient(describeVpcs, describeVpcAttribute = attributeReader()) {
  return { describeVpcs, describeVpcAttribute };
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} client @param {number} [maxAttempts] @param {(...args: any[]) => any} [waitForRetry] */
function makeObserver(
  fixture,
  client,
  maxAttempts = 1,
  waitForRetry = jest.fn(async () => {}),
) {
  return createAwsSingleNodeVpcResourceObserver({
    client,
    providerScope: fixture.base.providerScope,
    maxAttempts,
    waitForRetry,
  });
}

/** @param {string} presence @param {string} ownership @param {AnyRecord|null} providerIdentity @param {AnyRecord|null} observedDigest */
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
    resourceKey: 'network-vpc',
  };
}

describe('AWS single-node VPC resource observer factory and authority', () => {
  it('returns only one deeply frozen read port and requires the exact narrow client', () => {
    const fixture = makeAuthorityFixture('unbound');
    const client = makeClient(jest.fn(async () => ({ Vpcs: [] })));
    const observer = makeObserver(fixture, client);

    expect(Object.keys(observer)).toEqual(['observe']);
    expectDeepFrozen(observer);
    expect(() =>
      createAwsSingleNodeVpcResourceObserver({
        client: { ...client, deleteVpc: jest.fn() },
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeVpcResourceObserver({
        client: { describeVpcs: jest.fn() },
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeVpcResourceObserver({
        client,
        providerScope: fixture.base.providerScope,
        maxAttempts: null,
      }),
    ).toThrow(TypeError);
  });

  it('re-proves derived binding authority and scope before provider I/O', async () => {
    const fixture = makeAuthorityFixture('bound');
    const describeVpcs = jest.fn();
    const describeVpcAttribute = jest.fn();
    const forged = clone(fixture.authority);
    forged.binding.ownershipNonce = nonce(250);
    const observer = makeObserver(
      fixture,
      makeClient(describeVpcs, describeVpcAttribute),
    );

    await expect(observer.observe(forged)).rejects.toBeInstanceOf(
      AwsSingleNodeVpcResourceObserverAuthorityError,
    );
    expect(describeVpcs).not.toHaveBeenCalled();
    expect(describeVpcAttribute).not.toHaveBeenCalled();

    const wrongScope = createAwsProviderScope({
      partition: 'aws',
      accountId: '999999999999',
      region: 'us-east-1',
    });
    const wrongScopeObserver = createAwsSingleNodeVpcResourceObserver({
      client: makeClient(describeVpcs, describeVpcAttribute),
      providerScope: wrongScope,
      maxAttempts: 1,
    });
    await expect(
      wrongScopeObserver.observe(fixture.authority),
    ).rejects.toBeInstanceOf(AwsSingleNodeVpcResourceObserverAuthorityError);
    expect(describeVpcs).not.toHaveBeenCalled();
  });

  it('rejects a settled VPC create receipt without its durable binding before provider I/O', async () => {
    const fixture = makeAuthorityFixture('bound');
    const describeVpcs = jest.fn();
    const describeVpcAttribute = jest.fn();
    const missingBinding = /** @type {AnyRecord} */ (clone(fixture.authority));
    missingBinding.head.resourceBindings =
      missingBinding.head.resourceBindings.filter(
        (/** @type {Readonly<AnyRecord>} */ binding) =>
          binding.resourceKey !== 'network-vpc',
      );
    delete missingBinding.head.headId;
    delete missingBinding.head.schemaVersion;
    delete missingBinding.head.kind;
    missingBinding.head = createDeploymentHead(missingBinding.head);
    missingBinding.target = targetFor(
      makeTargets(fixture.base, missingBinding.head),
      'network-vpc',
    );
    const observer = makeObserver(
      fixture,
      makeClient(describeVpcs, describeVpcAttribute),
    );

    await expect(observer.observe(missingBinding)).rejects.toThrow(
      'AWS single-node resource observation authority plan does not match the exact active operation.',
    );
    expect(describeVpcs).not.toHaveBeenCalled();
    expect(describeVpcAttribute).not.toHaveBeenCalled();
  });
});

describe('AWS single-node VPC bound observation', () => {
  it('reads only the exact binding, validates two attributes, and returns frozen verified state', async () => {
    const fixture = makeAuthorityFixture('bound');
    const vpc = makeVpc(fixture);
    const describeVpcs = jest.fn(async (input) => {
      expectDeepFrozen(input);
      expect(input).toEqual({ VpcIds: [VPC_ID] });
      return { Vpcs: [vpc] };
    });
    const describeVpcAttribute = attributeReader();
    const result = await makeObserver(
      fixture,
      makeClient(describeVpcs, describeVpcAttribute),
    ).observe(fixture.authority);

    expect(result).toEqual(
      expectedObservation(
        'present',
        'verified',
        { providerType: 'ec2-vpc', providerResourceId: VPC_ID },
        getAwsSingleNodeVpcStateDigest(fixture.base.providerSpec),
      ),
    );
    expect(Object.keys(result)).toEqual(OBSERVATION_KEYS);
    expectDeepFrozen(result);
    expect(describeVpcAttribute).toHaveBeenCalledTimes(2);
    expect(describeVpcAttribute.mock.calls.map(([input]) => input)).toEqual([
      { Attribute: 'enableDnsSupport', VpcId: VPC_ID },
      { Attribute: 'enableDnsHostnames', VpcId: VPC_ID },
    ]);
    for (const [input] of describeVpcAttribute.mock.calls) {
      expectDeepFrozen(input);
    }
  });

  it('hashes readable CIDR, tenancy, default, IPv6, DNS, and block-mode drift as verified actual state', async () => {
    const fixture = makeAuthorityFixture('bound');
    const cidrBlock = '10.99.0.0/16';
    const vpc = makeVpc(fixture, {
      CidrBlock: cidrBlock,
      CidrBlockAssociationSet: [
        {
          AssociationId: 'vpc-cidr-assoc-00000000000000002',
          CidrBlock: cidrBlock,
          CidrBlockState: { State: 'associated' },
        },
      ],
      InstanceTenancy: 'dedicated',
      IsDefault: true,
      Ipv6CidrBlockAssociationSet: [
        {
          AssociationId: 'vpc-cidr-assoc-00000000000000003',
          Ipv6CidrBlock: '2600:1f18::/56',
          Ipv6CidrBlockState: { State: 'associated' },
        },
      ],
      BlockPublicAccessStates: {
        InternetGatewayBlockMode: 'block-ingress',
      },
    });
    const result = await makeObserver(
      fixture,
      makeClient(
        jest.fn(async () => ({ Vpcs: [vpc] })),
        attributeReader(VPC_ID, false, true),
      ),
    ).observe(fixture.authority);

    expect(result).toEqual(
      expectedObservation(
        'present',
        'verified',
        { providerType: 'ec2-vpc', providerResourceId: VPC_ID },
        createAwsSingleNodeVpcStateDigest({
          cidrBlock,
          instanceTenancy: 'dedicated',
          isDefault: true,
          ipv6: true,
          enableDnsSupport: false,
          enableDnsHostnames: true,
          internetGatewayBlockMode: 'block-ingress',
          onDestroy: 'purge',
        }),
      ),
    );
  });

  it('keeps the full provider VPC tenancy enum readable as verified drift', async () => {
    const fixture = makeAuthorityFixture('bound');
    const result = await makeObserver(
      fixture,
      makeClient(
        jest.fn(async () => ({
          Vpcs: [makeVpc(fixture, { InstanceTenancy: 'host' })],
        })),
      ),
    ).observe(fixture.authority);

    expect(result).toEqual(
      expectedObservation(
        'present',
        'verified',
        { providerType: 'ec2-vpc', providerResourceId: VPC_ID },
        createAwsSingleNodeVpcStateDigest({
          cidrBlock: fixture.base.providerSpec.capabilities.networking.vpcCidr,
          instanceTenancy: 'host',
          isDefault: false,
          ipv6: false,
          enableDnsSupport: true,
          enableDnsHostnames: false,
          internetGatewayBlockMode: 'off',
          onDestroy: 'purge',
        }),
      ),
    );
  });

  it.each([
    [
      'malformed IPv6 CIDR',
      {
        Ipv6CidrBlock: 'not-a-cidr',
        Ipv6CidrBlockState: { State: 'associated' },
      },
    ],
    [
      'propagating IPv6 association',
      {
        Ipv6CidrBlock: '2600:1f18::/56',
        Ipv6CidrBlockState: { State: 'associating' },
      },
    ],
    [
      'failed IPv6 status',
      {
        Ipv6CidrBlock: '2600:1f18::/56',
        Ipv6CidrBlockState: {
          State: 'associated',
          StatusMessage: 'association failed',
        },
      },
    ],
  ])('keeps %s evidence unknown', async (_label, ipv6Evidence) => {
    const fixture = makeAuthorityFixture('bound');
    const vpc = makeVpc(fixture, {
      Ipv6CidrBlockAssociationSet: [
        {
          AssociationId: 'vpc-cidr-assoc-00000000000000003',
          ...ipv6Evidence,
        },
      ],
    });
    const describeVpcAttribute = attributeReader();
    const result = await makeObserver(
      fixture,
      makeClient(
        jest.fn(async () => ({ Vpcs: [vpc] })),
        describeVpcAttribute,
      ),
    ).observe(fixture.authority);

    expect(result).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(describeVpcAttribute).not.toHaveBeenCalled();
  });

  it.each([
    ['owner', { OwnerId: '999999999999' }],
    [
      'immutable receipt tag',
      {
        Tags: tagArray({
          ...ownershipTags(makeAuthorityFixture('bound')),
          'wharfie:ownership-nonce': nonce(240),
        }),
      },
    ],
  ])(
    'returns ownership conflict for contradictory %s evidence',
    async (_label, overrides) => {
      const fixture = makeAuthorityFixture('bound');
      const vpc = makeVpc(fixture, overrides);
      const describeVpcAttribute = attributeReader();
      const result = await makeObserver(
        fixture,
        makeClient(
          jest.fn(async () => ({ Vpcs: [vpc] })),
          describeVpcAttribute,
        ),
      ).observe(fixture.authority);

      expect(result).toEqual(
        expectedObservation(
          'present',
          'conflict',
          { providerType: 'ec2-vpc', providerResourceId: VPC_ID },
          null,
        ),
      );
      expect(describeVpcAttribute).not.toHaveBeenCalled();
    },
  );

  it('keeps physical contradictions unknown rather than reporting ownership conflict', async () => {
    const fixture = makeAuthorityFixture('bound');
    const vpc = makeVpc(fixture, {
      CidrBlockAssociationSet: [
        {
          AssociationId: 'vpc-cidr-assoc-00000000000000002',
          CidrBlock: '10.99.0.0/16',
          CidrBlockState: { State: 'associated' },
        },
      ],
    });
    const describeVpcAttribute = attributeReader();
    const result = await makeObserver(
      fixture,
      makeClient(
        jest.fn(async () => ({ Vpcs: [vpc] })),
        describeVpcAttribute,
      ),
    ).observe(fixture.authority);

    expect(result).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(describeVpcAttribute).not.toHaveBeenCalled();
  });

  it('keeps malformed or contradictory auxiliary attribute evidence unknown', async () => {
    const fixture = makeAuthorityFixture('bound');
    const describeVpcAttribute = attributeReader(OTHER_VPC_ID);
    const result = await makeObserver(
      fixture,
      makeClient(
        jest.fn(async () => ({ Vpcs: [makeVpc(fixture)] })),
        describeVpcAttribute,
      ),
    ).observe(fixture.authority);

    expect(result).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
  });

  it('keeps repeated typed exact absence unknown and never searches or reads attributes', async () => {
    const fixture = makeAuthorityFixture('bound');
    const describeVpcs = jest.fn(async () => {
      throw Object.assign(new Error('not found'), {
        name: 'InvalidVpcID.NotFound',
      });
    });
    const describeVpcAttribute = jest.fn();
    const waitForRetry = jest.fn(async (/** @type {number} */ _attempt) => {});
    const result = await makeObserver(
      fixture,
      makeClient(describeVpcs, describeVpcAttribute),
      2,
      waitForRetry,
    ).observe(fixture.authority);

    expect(result).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(describeVpcs).toHaveBeenCalledTimes(2);
    expect(describeVpcAttribute).not.toHaveBeenCalled();
    expect(waitForRetry).toHaveBeenCalledWith(1);
  });
});

describe('AWS single-node VPC create and unbound discovery observation', () => {
  it('verifies one exact current-create candidate but never gives clean-empty replay advice', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const candidate = makeVpc(fixture);
    const observer = makeObserver(
      fixture,
      makeClient(jest.fn(async () => ({ Vpcs: [candidate] }))),
    );

    await expect(observer.observe(fixture.authority)).resolves.toEqual(
      expectedObservation(
        'present',
        'verified',
        { providerType: 'ec2-vpc', providerResourceId: VPC_ID },
        getAwsSingleNodeVpcStateDigest(fixture.base.providerSpec),
      ),
    );

    const emptyFixture = makeAuthorityFixture('current-create');
    const empty = await makeObserver(
      emptyFixture,
      makeClient(jest.fn(async () => ({ Vpcs: [] }))),
    ).observe(emptyFixture.authority);
    expect(empty).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(empty.execution).toBe('none');
  });

  it('returns current-create conflict for a contradictory receipt and unknown for propagation', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const wrong = ownershipTags(fixture);
    wrong['wharfie:state-digest'] =
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const conflict = await makeObserver(
      fixture,
      makeClient(
        jest.fn(async () => ({
          Vpcs: [makeVpc(fixture, { Tags: tagArray(wrong) })],
        })),
      ),
    ).observe(fixture.authority);
    expect(conflict).toEqual(
      expectedObservation(
        'present',
        'conflict',
        { providerType: 'ec2-vpc', providerResourceId: VPC_ID },
        null,
      ),
    );

    const propagating = ownershipTags(fixture);
    delete propagating['wharfie:ownership-nonce'];
    const unknown = await makeObserver(
      fixture,
      makeClient(
        jest.fn(async () => ({
          Vpcs: [makeVpc(fixture, { Tags: tagArray(propagating) })],
        })),
      ),
    ).observe(fixture.authority);
    expect(unknown).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
  });

  it('returns absent only after every unbound locator scan is clean and complete', async () => {
    const fixture = makeAuthorityFixture('unbound');
    const describeVpcs = jest.fn(async (/** @type {AnyRecord} */ _input) => ({
      Vpcs: [],
    }));
    const waitForRetry = jest.fn(async (/** @type {number} */ _attempt) => {});
    const result = await makeObserver(
      fixture,
      makeClient(describeVpcs),
      2,
      waitForRetry,
    ).observe(fixture.authority);

    expect(result).toEqual(
      expectedObservation('absent', 'missing', null, null),
    );
    expect(describeVpcs).toHaveBeenCalledTimes(2);
    expect(waitForRetry).toHaveBeenCalledWith(1);
    for (const [request] of describeVpcs.mock.calls) {
      expectDeepFrozen(request);
      expect(request.MaxResults).toBe(100);
      expect(request.Filters).toHaveLength(8);
    }
  });

  it('never adopts an unbound locator collision or performs auxiliary reads', async () => {
    const fixture = makeAuthorityFixture('unbound');
    const vpc = makeVpc(fixture, { Tags: tagArray(locatorTags(fixture)) });
    const describeVpcAttribute = jest.fn();
    const result = await makeObserver(
      fixture,
      makeClient(
        jest.fn(async () => ({ Vpcs: [vpc] })),
        describeVpcAttribute,
      ),
    ).observe(fixture.authority);

    expect(result).toEqual(
      expectedObservation(
        'present',
        'conflict',
        { providerType: 'ec2-vpc', providerResourceId: VPC_ID },
        null,
      ),
    );
    expect(describeVpcAttribute).not.toHaveBeenCalled();
  });

  it('does not promote a prior uncertain read followed by empty evidence to absence', async () => {
    const fixture = makeAuthorityFixture('unbound');
    let call = 0;
    const describeVpcs = jest.fn(async () => {
      call += 1;
      if (call === 1) throw new Error('access denied with provider detail');
      return { Vpcs: [] };
    });
    const result = await makeObserver(
      fixture,
      makeClient(describeVpcs),
      2,
    ).observe(fixture.authority);

    expect(result).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
  });

  it('fails closed on duplicate candidates, malformed pagination, and waiter failure', async () => {
    const fixture = makeAuthorityFixture('unbound');
    const duplicate = await makeObserver(
      fixture,
      makeClient(
        jest.fn(async () => ({
          Vpcs: [makeVpc(fixture), makeVpc(fixture, { VpcId: OTHER_VPC_ID })],
        })),
      ),
    ).observe(fixture.authority);
    expect(duplicate).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );

    const malformed = await makeObserver(
      fixture,
      makeClient(jest.fn(async () => ({ Vpcs: [], NextToken: '' }))),
    ).observe(fixture.authority);
    expect(malformed).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );

    const waiterResult = await makeObserver(
      fixture,
      makeClient(jest.fn(async () => ({ Vpcs: [] }))),
      2,
      jest.fn(async () => {
        throw new Error('waiter detail');
      }),
    ).observe(fixture.authority);
    expect(waiterResult).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
  });
});
