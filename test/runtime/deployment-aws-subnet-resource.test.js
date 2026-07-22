import { describe, expect, it, jest } from '@jest/globals';

import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_SUBNET_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_SUBNET_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_SUBNET_STATE_DIGEST_DOMAIN,
  AwsSingleNodeSubnetResourceConflictError,
  AwsSingleNodeSubnetResourceUnknownError,
  createAwsSingleNodeSubnetResource,
  getAwsSingleNodeSubnetStateDigest,
} from '../../src/core/runtime/deployment-aws-subnet-resource.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
import { createDeploymentPlan } from '../../src/core/runtime/deployment-plan.js';
import { AWS_SINGLE_NODE_RESOURCE_GRAPH } from '../../src/core/runtime/deployment-resource-graph.js';
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

/** @typedef {Record<string, any>} AnyRecord */

const SUBNET_IDS = Object.freeze({
  primary: 'subnet-00000000000000001',
  duplicate: 'subnet-00000000000000002',
  replacement: 'subnet-00000000000000003',
});
const VPC_IDS = Object.freeze({
  primary: 'vpc-00000000000000001',
  other: 'vpc-00000000000000002',
});
const SUBNET_CIDR = '10.42.0.0/24';
const OTHER_SUBNET_CIDR = '10.42.1.0/24';
const AVAILABILITY_ZONE_ID = 'use1-az1';

/** @param {string} value @returns {{algorithm: 'sha256', value: string}} */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

/** @param {number} byte @returns {string} */
function nonce(byte) {
  return createOwnershipNonce(Buffer.alloc(32, byte));
}

/** @param {any} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
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
      ebsKmsKeyArn:
        'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    },
  });
}

/** @param {{imageId?: string}} [options] @returns {Readonly<Record<string, any>>} */
function makeBase(options = {}) {
  const profile = validateDeploymentProfile(
    createDeploymentProfile({
      profile: { id: 'production' },
      appId: 'subnet-resource-test',
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
    revisionId: semanticId('wrv1', 'wharfie:test:subnet-revision:v1', {
      revision: 1,
    }),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'subnet resource artifact',
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
  const providerSpec = makeProviderSpec(
    profile,
    providerScope,
    options.imageId,
  );
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

/** @param {Readonly<Record<string, any>>} definition @returns {string} */
function providerResourceId(definition) {
  if (definition.resourceKey === 'network-vpc') return VPC_IDS.primary;
  if (definition.resourceKey === 'network-internet-gateway') {
    return 'igw-00000000000000001';
  }
  if (definition.resourceKey === 'network-subnet') return SUBNET_IDS.primary;
  if (definition.resourceKey === 'substrate') {
    return 'i-00000000000000001';
  }
  if (definition.role.kind === 'volume') {
    return definition.resourceKey === 'application-state'
      ? 'vol-00000000000000001'
      : 'vol-00000000000000002';
  }
  return `provider-resource-${definition.resourceKey}`;
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} definition */
function desiredState(base, definition) {
  return {
    providerType: definition.providerType,
    providerResourceId: null,
    stateDigest:
      definition.resourceKey === 'network-subnet'
        ? getAwsSingleNodeSubnetStateDigest(base.providerSpec)
        : digest(`${definition.resourceKey} desired`),
  };
}

/** @param {Readonly<Record<string, any>>} base @param {'apply'|'reconcile'|'destroy'} operation @param {{observedStateDigest?: Readonly<Record<string, any>>}} [options] */
function makePlan(base, operation, options = {}) {
  const definitions =
    operation === 'destroy'
      ? [...AWS_SINGLE_NODE_RESOURCE_GRAPH.resources].reverse()
      : AWS_SINGLE_NODE_RESOURCE_GRAPH.resources;
  const actions = definitions.map(
    (/** @type {Readonly<AnyRecord>} */ definition) => {
      const desired = desiredState(base, definition);
      const existing = {
        ...desired,
        providerResourceId: providerResourceId(definition),
        ...(definition.resourceKey === 'network-subnet' &&
        options.observedStateDigest !== undefined
          ? { stateDigest: options.observedStateDigest }
          : {}),
      };
      const contract = {
        resourceKey: definition.resourceKey,
        capability: definition.capability,
        role: definition.role,
        management: 'managed',
        ownershipMode: definition.ownershipMode,
        dependsOn: definition.dependsOn,
        onDestroy: definition.onDestroy,
      };
      if (operation === 'apply') {
        return {
          ...contract,
          action: 'create',
          destructive: false,
          reason: 'missing',
          before: null,
          after: desired,
        };
      }
      if (operation === 'reconcile') {
        return {
          ...contract,
          action: 'noop',
          destructive: false,
          reason: 'already-converged',
          before: existing,
          after: existing,
        };
      }
      const retained = definition.onDestroy === 'retain';
      return {
        ...contract,
        action: retained ? 'noop' : 'delete',
        destructive: !retained,
        reason: retained ? 'retained-data' : 'destroy-requested',
        before: existing,
        after: retained ? existing : null,
      };
    },
  );
  return createDeploymentPlan(
    {
      operation,
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpec: base.providerSpec,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      basis: {
        headGeneration: operation === 'apply' ? 0 : 1,
        settledDeploymentRevisionId:
          operation === 'apply'
            ? null
            : base.deploymentRevision.deploymentRevisionId,
        inspectionId: semanticId('win5', 'wharfie:test:subnet-inspection:v1', {
          operation,
        }),
      },
      actions,
    },
    { profile: base.profile },
  );
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} action @param {Record<string, any>} options */
function makeVpcBinding(base, action, options) {
  return createDeploymentResourceBinding({
    schemaVersion: 2,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    resourceKey: 'network-vpc',
    capability: action.capability,
    role: action.role,
    management: 'managed',
    ownershipMode: 'direct',
    onDestroy: 'purge',
    dependencyBindings: [],
    providerType: 'ec2-vpc',
    providerResourceId: options.providerResourceId ?? VPC_IDS.primary,
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce: options.ownershipNonce,
    createdByActionId: options.createdByActionId,
  });
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} vpcBinding @param {Record<string, any>} options */
function makeSubnetBinding(base, action, vpcBinding, options) {
  return createDeploymentResourceBinding({
    schemaVersion: 2,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    resourceKey: 'network-subnet',
    capability: action.capability,
    role: action.role,
    management: 'managed',
    ownershipMode: 'direct',
    onDestroy: 'purge',
    dependencyBindings: [
      { resourceKey: 'network-vpc', bindingId: vpcBinding.bindingId },
    ],
    providerType: 'ec2-subnet',
    providerResourceId: options.providerResourceId ?? SUBNET_IDS.primary,
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce: options.ownershipNonce,
    createdByActionId: options.createdByActionId,
  });
}

/** @param {{operation?: 'apply'|'reconcile'|'destroy', observedStateDigest?: Readonly<Record<string, any>>, ownershipNonceByte?: number}} [options] */
function makeFixture(options = {}) {
  const operation = options.operation ?? 'apply';
  const base = makeBase();
  const plan = makePlan(base, operation, options);
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
    throw new Error('Missing subnet or VPC action.');
  }
  const ownershipNonce = nonce(options.ownershipNonceByte ?? 74);
  const intentNonces = plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ _candidate,
      /** @type {number} */ index,
    ) => (index === actionIndex ? ownershipNonce : nonce(10 + index)),
  );
  const vpcCreatedByActionId =
    operation === 'apply'
      ? vpcAction.actionId
      : semanticId('wda3', 'wharfie:test:subnet-vpc-create-action:v1', {
          resourceKey: 'network-vpc',
        });
  const vpcBinding = makeVpcBinding(base, vpcAction, {
    ownershipNonce: intentNonces[vpcActionIndex],
    createdByActionId: vpcCreatedByActionId,
  });
  const priorBinding =
    action.action === 'create'
      ? null
      : makeSubnetBinding(base, action, vpcBinding, {
          ownershipNonce,
          createdByActionId: semanticId(
            'wda3',
            'wharfie:test:subnet-create-action:v1',
            { resourceKey: 'network-subnet' },
          ),
        });
  const resourceBindings = [
    vpcBinding,
    ...(priorBinding === null ? [] : [priorBinding]),
  ];
  const intents = plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ _candidate,
      /** @type {number} */ index,
    ) => ({
      actionId: plan.actions[index].actionId,
      status:
        index < actionIndex
          ? 'settled'
          : index === actionIndex
            ? 'intended'
            : 'pending',
      ownershipNonce: intentNonces[index],
    }),
  );
  const settledPriorBinding = /** @type {Readonly<AnyRecord>} */ (priorBinding);
  const lastOperation =
    operation === 'apply'
      ? null
      : {
          kind: 'create',
          planId: semanticId('wpl3', 'wharfie:test:subnet-last-plan:v1', {
            operation,
          }),
          intents: [
            {
              actionId: settledPriorBinding.createdByActionId,
              status: 'settled',
              ownershipNonce: settledPriorBinding.ownershipNonce,
            },
          ],
        };
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: operation === 'apply' ? 1 : 2,
    phase: operation === 'destroy' ? 'DESTROYING' : 'CONVERGING',
    settledDeploymentRevisionId:
      operation === 'apply'
        ? null
        : base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId:
      operation === 'destroy'
        ? null
        : base.deploymentRevision.deploymentRevisionId,
    resourceBindings,
    activeOperation: {
      kind:
        operation === 'apply'
          ? 'create'
          : operation === 'destroy'
            ? 'destroy'
            : 'reconcile',
      planId: plan.planId,
      status: 'running',
      nextActionIndex: actionIndex,
      intents,
    },
    lastOperation,
  });
  const context = Object.freeze({
    operation,
    plan,
    action,
    actionIndex,
    ownershipNonce,
    head,
    profile: base.profile,
    artifactStage: null,
  });
  return Object.freeze({
    base,
    plan,
    action,
    actionIndex,
    ownershipNonce,
    vpcBinding,
    priorBinding,
    head,
    context,
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} changes */
function recreateHead(fixture, changes) {
  const head = fixture.head;
  return createDeploymentHead({
    deploymentInstanceId: head.deploymentInstanceId,
    providerScope: head.providerScope,
    incarnationId: head.incarnationId,
    generation: head.generation,
    phase: head.phase,
    settledDeploymentRevisionId: head.settledDeploymentRevisionId,
    targetDeploymentRevisionId: head.targetDeploymentRevisionId,
    resourceBindings: changes.resourceBindings ?? head.resourceBindings,
    activeOperation: {
      kind: head.activeOperation.kind,
      planId: head.activeOperation.planId,
      status: head.activeOperation.status,
      nextActionIndex: head.activeOperation.nextActionIndex,
      intents: head.activeOperation.intents,
      ...(changes.activeOperation ?? {}),
    },
    lastOperation:
      head.lastOperation === null
        ? null
        : {
            kind: head.lastOperation.kind,
            planId: head.lastOperation.planId,
            intents: head.lastOperation.intents,
          },
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @returns {Record<string, string>} */
function expectedTags(fixture) {
  return {
    'wharfie:managed-by': 'wharfie',
    'wharfie:resource-kind': 'single-node-subnet',
    'wharfie:retention': 'purge',
    'wharfie:schema-version': '2',
    'wharfie:capability': 'networking',
    'wharfie:role': 'subnet',
    'wharfie:provider-scope-id': fixture.base.providerScope.providerScopeId,
    'wharfie:deployment-instance-id': fixture.base.deploymentInstanceId,
    'wharfie:incarnation-id': fixture.base.incarnationId,
    'wharfie:resource-key': 'network-subnet',
    'wharfie:created-by-action-id':
      fixture.priorBinding?.createdByActionId ?? fixture.action.actionId,
    'wharfie:ownership-nonce': fixture.ownershipNonce,
    'wharfie:state-digest': getAwsSingleNodeSubnetStateDigest(
      fixture.base.providerSpec,
    ).value,
  };
}

/** @param {Record<string, string>} tags @returns {{Key: string, Value: string}[]} */
function tagArray(tags) {
  return Object.entries(tags)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([Key, Value]) => ({ Key, Value }));
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function makeSubnet(fixture, overrides = {}) {
  return {
    AssignIpv6AddressOnCreation: false,
    AvailabilityZone: 'us-east-1a',
    AvailabilityZoneId: AVAILABILITY_ZONE_ID,
    AvailableIpAddressCount: 251,
    BlockPublicAccessStates: { InternetGatewayBlockMode: 'off' },
    CidrBlock: SUBNET_CIDR,
    DefaultForAz: false,
    Ipv6CidrBlockAssociationSet: [],
    Ipv6Native: false,
    MapPublicIpOnLaunch: false,
    OwnerId: fixture.base.providerScope.accountId,
    State: 'available',
    SubnetId: SUBNET_IDS.primary,
    Tags: tagArray(expectedTags(fixture)),
    VpcId: fixture.vpcBinding.providerResourceId,
    ...overrides,
  };
}

/** @param {Readonly<Record<string, any>>} request @returns {'exact'|'logical'|'slot'} */
function requestKind(request) {
  if (request.SubnetIds) return 'exact';
  const names = Array.isArray(request.Filters)
    ? request.Filters.map((item) => item.Name)
    : [];
  return names.includes('tag:wharfie:managed-by') ? 'logical' : 'slot';
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makeClient(fixture, options = {}) {
  const exact = options.exact ?? makeSubnet(fixture);
  const logical = options.logical ?? [exact];
  const slot = options.slot ?? [exact];
  return Object.freeze({
    createSubnet:
      options.createSubnet ??
      jest.fn(async () => ({ Subnet: { SubnetId: SUBNET_IDS.primary } })),
    describeSubnets:
      options.describeSubnets ??
      jest.fn(async (/** @type {AnyRecord} */ input) => ({
        Subnets:
          requestKind(input) === 'exact'
            ? [exact]
            : requestKind(input) === 'logical'
              ? logical
              : slot,
      })),
    deleteSubnet: options.deleteSubnet ?? jest.fn(async () => ({})),
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makePorts(fixture, options = {}) {
  const client = options.client ?? makeClient(fixture, options);
  const waitForRetry = options.waitForRetry ?? jest.fn();
  return {
    client,
    waitForRetry,
    resource: createAwsSingleNodeSubnetResource({
      client,
      providerScope: fixture.base.providerScope,
      maxAttempts: options.maxAttempts ?? 1,
      waitForRetry,
    }),
  };
}

/** @param {string} name @param {string} [message] */
function providerError(name, message = 'provider-secret-detail') {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe('AWS single-node subnet state digest', () => {
  it('is deterministic, domain separated, frozen, and sensitive only to intrinsic subnet state', () => {
    const base = makeBase();
    const first = getAwsSingleNodeSubnetStateDigest(base.providerSpec);
    const second = getAwsSingleNodeSubnetStateDigest(base.providerSpec);

    expect(first).toEqual(second);
    expect(first.algorithm).toBe('sha256');
    expect(first.value).toHaveLength(43);
    expect(Object.isFrozen(first)).toBe(true);
    expect(AWS_SINGLE_NODE_SUBNET_STATE_DIGEST_DOMAIN).toBe(
      'wharfie:aws-single-node-ec2-subnet-state:v1',
    );
    expect(first.value).toBe(
      sha256Base64Url(
        `${AWS_SINGLE_NODE_SUBNET_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
          sortCanonicalJsonValue({
            schemaVersion: 1,
            kind: 'awsSingleNodeEc2SubnetState',
            availabilityZoneId: AVAILABILITY_ZONE_ID,
            cidrBlock: SUBNET_CIDR,
            defaultForAz: false,
            assignIpv6AddressOnCreation: false,
            ipv6Native: false,
            mapPublicIpOnLaunch: false,
            internetGatewayBlockMode: 'off',
            onDestroy: 'purge',
          }),
        )}`,
      ),
    );
    expect(JSON.stringify(first)).not.toContain(VPC_IDS.primary);
  });

  it('changes with subnet/AZ inputs but rejects malformed noncanonical specs', () => {
    const base = makeBase();
    expect(() => getAwsSingleNodeSubnetStateDigest({})).toThrow(TypeError);
    const changed = JSON.parse(JSON.stringify(base.providerSpec));
    changed.capabilities.networking.subnetCidr = OTHER_SUBNET_CIDR;
    expect(() => getAwsSingleNodeSubnetStateDigest(changed)).toThrow(TypeError);

    const otherImage = makeBase({ imageId: 'ami-0fedcba9876543210' });
    expect(getAwsSingleNodeSubnetStateDigest(otherImage.providerSpec)).toEqual(
      getAwsSingleNodeSubnetStateDigest(base.providerSpec),
    );
  });
});

describe('AWS single-node subnet create and recovery', () => {
  it('submits one exact frozen create with thirteen atomic tags and no token or implicit fields', async () => {
    const fixture = makeFixture();
    const createSubnet = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ _request) => ({
        Subnet: { SubnetId: SUBNET_IDS.primary },
      }),
    );
    const client = makeClient(fixture, {
      logical: [],
      slot: [],
      createSubnet,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);

    expect(createSubnet).toHaveBeenCalledTimes(1);
    const request = createSubnet.mock.calls.at(0)?.at(0);
    if (request === undefined) throw new Error('Missing create request.');
    expect(request).toEqual({
      AvailabilityZoneId: AVAILABILITY_ZONE_ID,
      CidrBlock: SUBNET_CIDR,
      TagSpecifications: [
        {
          ResourceType: 'subnet',
          Tags: tagArray(expectedTags(fixture)),
        },
      ],
      VpcId: VPC_IDS.primary,
    });
    expect(request.TagSpecifications[0].Tags).toHaveLength(13);
    for (const key of [
      'ClientToken',
      'AvailabilityZone',
      'Ipv6CidrBlock',
      'Ipv6Native',
      'Ipv4IpamPoolId',
      'Ipv4NetmaskLength',
      'OutpostArn',
    ]) {
      expect(request).not.toHaveProperty(key);
    }
    expectDeepFrozen(request);
    expect(client.deleteSubnet).not.toHaveBeenCalled();
  });

  it('settles a candidate only after logical, exact, and CIDR-slot correlation', async () => {
    const fixture = makeFixture();
    const subnet = makeSubnet(fixture);
    let created = false;
    const describeSubnets = jest.fn(async (/** @type {AnyRecord} */ input) => ({
      Subnets:
        requestKind(input) === 'exact'
          ? created
            ? [subnet]
            : []
          : created
            ? [subnet]
            : [],
    }));
    const createSubnet = jest.fn(async () => {
      created = true;
      return { Subnet: { SubnetId: SUBNET_IDS.primary } };
    });
    const client = makeClient(fixture, { describeSubnets, createSubnet });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);
    const settlement = await resource.verifySettlement(fixture.context);

    expect(settlement).toMatchObject({
      status: 'converged',
      binding: {
        resourceKey: 'network-subnet',
        providerType: 'ec2-subnet',
        providerResourceId: SUBNET_IDS.primary,
        management: 'managed',
        ownershipMode: 'direct',
        dependencyBindings: [
          {
            resourceKey: 'network-vpc',
            bindingId: fixture.vpcBinding.bindingId,
          },
        ],
        ownershipNonce: fixture.ownershipNonce,
        createdByActionId: fixture.action.actionId,
      },
    });
    expectDeepFrozen(settlement);
  });

  it('recovers a lost response in a fresh factory without replaying create', async () => {
    const fixture = makeFixture();
    const firstClient = makeClient(fixture, {
      logical: [],
      slot: [],
      createSubnet: jest.fn(async () => {
        throw providerError('NetworkingError', 'create-secret');
      }),
    });
    const first = makePorts(fixture, { client: firstClient }).resource;
    const observed = await first
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(AwsSingleNodeSubnetResourceUnknownError);
    expect(JSON.stringify(observed)).not.toContain('create-secret');

    const recovered = makeSubnet(fixture);
    const secondClient = makeClient(fixture, {
      exact: recovered,
      logical: [recovered],
      slot: [recovered],
    });
    const second = makePorts(fixture, { client: secondClient }).resource;
    await expect(second.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(secondClient.createSubnet).not.toHaveBeenCalled();
    expect(
      secondClient.describeSubnets.mock.calls.filter(
        (/** @type {[Readonly<AnyRecord>]} */ [request]) =>
          requestKind(request) === 'exact',
      ),
    ).toHaveLength(1);
  });

  it('never replays one crossed create boundary in-process and advances only with a new nonce', async () => {
    const fixture = makeFixture();
    const advanced = makeFixture({ ownershipNonceByte: 75 });
    const createSubnet = jest.fn(async () => {
      throw providerError('NetworkingError');
    });
    const client = makeClient(fixture, {
      logical: [],
      slot: [],
      createSubnet,
    });
    const resource = createAwsSingleNodeSubnetResource({
      client,
      providerScope: fixture.base.providerScope,
      maxAttempts: 1,
      waitForRetry: jest.fn(),
    });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeSubnetResourceUnknownError);
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeSubnetResourceUnknownError);
    expect(createSubnet).toHaveBeenCalledTimes(1);

    await expect(
      resource.executeAction(advanced.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeSubnetResourceUnknownError);
    expect(createSubnet).toHaveBeenCalledTimes(2);
  });
});

describe('AWS single-node subnet discovery and evidence', () => {
  it('uses independent frozen logical-tag and exact VPC/CIDR slot requests', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, { logical: [], slot: [] });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);

    const logicalRequest = client.describeSubnets.mock.calls
      .map((/** @type {[Readonly<AnyRecord>]} */ [request]) => request)
      .find(
        (/** @type {Readonly<AnyRecord>} */ request) =>
          requestKind(request) === 'logical',
      );
    const slotRequest = client.describeSubnets.mock.calls
      .map((/** @type {[Readonly<AnyRecord>]} */ [request]) => request)
      .find(
        (/** @type {Readonly<AnyRecord>} */ request) =>
          requestKind(request) === 'slot',
      );
    expect(logicalRequest).toEqual({
      Filters: [
        {
          Name: 'tag:wharfie:managed-by',
          Values: ['wharfie'],
        },
        {
          Name: 'tag:wharfie:resource-kind',
          Values: ['single-node-subnet'],
        },
        {
          Name: 'tag:wharfie:capability',
          Values: ['networking'],
        },
        {
          Name: 'tag:wharfie:role',
          Values: ['subnet'],
        },
        {
          Name: 'tag:wharfie:provider-scope-id',
          Values: [fixture.base.providerScope.providerScopeId],
        },
        {
          Name: 'tag:wharfie:deployment-instance-id',
          Values: [fixture.base.deploymentInstanceId],
        },
        {
          Name: 'tag:wharfie:incarnation-id',
          Values: [fixture.base.incarnationId],
        },
        {
          Name: 'tag:wharfie:resource-key',
          Values: ['network-subnet'],
        },
      ],
      MaxResults: AWS_SINGLE_NODE_SUBNET_DISCOVERY_MAX_RESULTS,
    });
    expect(slotRequest).toEqual({
      Filters: [
        { Name: 'vpc-id', Values: [VPC_IDS.primary] },
        { Name: 'cidr-block', Values: [SUBNET_CIDR] },
      ],
      MaxResults: AWS_SINGLE_NODE_SUBNET_DISCOVERY_MAX_RESULTS,
    });
    expectDeepFrozen(logicalRequest);
    expectDeepFrozen(slotRequest);
  });

  it('paginates both independent searches and correlates them to one exact ID', async () => {
    const fixture = makeFixture();
    const subnet = makeSubnet(fixture);
    let logicalPage = 0;
    let slotPage = 0;
    const describeSubnets = jest.fn(async (/** @type {AnyRecord} */ input) => {
      const kind = requestKind(input);
      if (kind === 'exact') return { Subnets: [subnet] };
      if (kind === 'logical') {
        logicalPage += 1;
        return logicalPage === 1
          ? { Subnets: [], NextToken: 'logical-next' }
          : { Subnets: [subnet] };
      }
      slotPage += 1;
      return slotPage === 1
        ? { Subnets: [], NextToken: 'slot-next' }
        : { Subnets: [subnet] };
    });
    const client = makeClient(fixture, { describeSubnets });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(logicalPage).toBe(2);
    expect(slotPage).toBe(2);
    const logicalSecond = describeSubnets.mock.calls
      .map(([request]) => request)
      .find((request) => request.NextToken === 'logical-next');
    const slotSecond = describeSubnets.mock.calls
      .map(([request]) => request)
      .find((request) => request.NextToken === 'slot-next');
    expectDeepFrozen(logicalSecond);
    expectDeepFrozen(slotSecond);
  });

  it.each([
    [
      'duplicate logical owners',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        logical: [
          makeSubnet(fixture),
          makeSubnet(fixture, { SubnetId: SUBNET_IDS.duplicate }),
        ],
      }),
    ],
    [
      'duplicate slot occupants',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        slot: [
          makeSubnet(fixture),
          makeSubnet(fixture, { SubnetId: SUBNET_IDS.duplicate }),
        ],
      }),
    ],
    [
      'a different slot occupant',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        slot: [makeSubnet(fixture, { SubnetId: SUBNET_IDS.replacement })],
      }),
    ],
    [
      'a different logical replacement',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        logical: [makeSubnet(fixture, { SubnetId: SUBNET_IDS.replacement })],
      }),
    ],
  ])('blocks %s without creating', async (_name, evidence) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, evidence(fixture));
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeSubnetResourceConflictError);
    expect(client.createSubnet).not.toHaveBeenCalled();
    expect(client.deleteSubnet).not.toHaveBeenCalled();
  });

  it.each([
    ['owner', { OwnerId: '999999999999' }],
    ['parent VPC', { VpcId: VPC_IDS.other }],
    ['CIDR', { CidrBlock: OTHER_SUBNET_CIDR }],
    ['AZ ID', { AvailabilityZoneId: 'use1-az2' }],
    ['default subnet', { DefaultForAz: true }],
    ['IPv6-native flag', { Ipv6Native: true }],
    ['IPv6 assignment', { AssignIpv6AddressOnCreation: true }],
    ['public-IP mapping', { MapPublicIpOnLaunch: true }],
    [
      'IPv6 association',
      {
        Ipv6CidrBlockAssociationSet: [
          {
            AssociationId: 'subnet-cidr-assoc-00000000000000001',
            Ipv6CidrBlock: '2001:db8::/64',
            Ipv6CidrBlockState: { State: 'associated' },
          },
        ],
      },
    ],
    ['failed state', { State: 'failed' }],
    [
      'bidirectional internet block',
      {
        BlockPublicAccessStates: {
          InternetGatewayBlockMode: 'block-bidirectional',
        },
      },
    ],
    [
      'ingress internet block',
      {
        BlockPublicAccessStates: {
          InternetGatewayBlockMode: 'block-ingress',
        },
      },
    ],
  ])(
    'blocks semantically conflicting %s evidence',
    async (_name, overrides) => {
      const fixture = makeFixture();
      const conflicting = makeSubnet(fixture, overrides);
      const client = makeClient(fixture, {
        exact: conflicting,
        logical: [conflicting],
        slot: [conflicting],
      });
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'blocked',
        },
      );
      expect(client.createSubnet).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['OwnerId', { OwnerId: null }],
    ['VpcId', { VpcId: null }],
    ['CidrBlock', { CidrBlock: null }],
    ['AvailabilityZoneId', { AvailabilityZoneId: null }],
    ['DefaultForAz', { DefaultForAz: null }],
    ['Ipv6Native', { Ipv6Native: null }],
    ['AssignIpv6AddressOnCreation', { AssignIpv6AddressOnCreation: null }],
    ['MapPublicIpOnLaunch', { MapPublicIpOnLaunch: null }],
    ['Ipv6CidrBlockAssociationSet', { Ipv6CidrBlockAssociationSet: null }],
    ['State', { State: null }],
    ['BlockPublicAccessStates', { BlockPublicAccessStates: null }],
    [
      'InternetGatewayBlockMode',
      { BlockPublicAccessStates: { InternetGatewayBlockMode: 'mystery' } },
    ],
  ])(
    'maps malformed %s evidence to a fixed unknown error',
    async (_name, overrides) => {
      const fixture = makeFixture();
      const malformed = makeSubnet(fixture, {
        ...overrides,
        secret: 'malformed-subnet-secret',
      });
      const client = makeClient(fixture, {
        exact: malformed,
        logical: [malformed],
        slot: [malformed],
      });
      const { resource } = makePorts(fixture, { client });

      const observed = await resource
        .verifySettlement(fixture.context)
        .catch((/** @type {unknown} */ error) => error);
      expect(observed).toBeInstanceOf(AwsSingleNodeSubnetResourceUnknownError);
      expect(JSON.stringify(observed)).not.toContain('malformed-subnet-secret');
      expect(client.createSubnet).not.toHaveBeenCalled();
    },
  );

  it('ignores occupancy and the account-relative AZ name', async () => {
    const fixture = makeFixture();
    const subnet = makeSubnet(fixture, {
      AvailabilityZone: 'account-relative-name',
      AvailableIpAddressCount: 7,
    });
    const client = makeClient(fixture, {
      exact: subnet,
      logical: [subnet],
      slot: [subnet],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
  });

  it('treats pending state and incomplete create tags as propagation', async () => {
    const fixture = makeFixture();
    const pending = makeSubnet(fixture, { State: 'pending' });
    let client = makeClient(fixture, {
      exact: pending,
      logical: [pending],
      slot: [pending],
    });
    let resource = makePorts(fixture, { client }).resource;
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });

    const tags = expectedTags(fixture);
    delete tags['wharfie:ownership-nonce'];
    const incomplete = makeSubnet(fixture, { Tags: tagArray(tags) });
    client = makeClient(fixture, {
      exact: incomplete,
      logical: [incomplete],
      slot: [incomplete],
    });
    resource = makePorts(fixture, { client }).resource;
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
  });

  it('gives present malformed or foreign evidence precedence over one-sided visibility', async () => {
    const fixture = makeFixture();
    const foreign = makeSubnet(fixture, { OwnerId: '999999999999' });
    let client = makeClient(fixture, {
      exact: foreign,
      logical: [],
      slot: [foreign],
    });
    let resource = makePorts(fixture, { client }).resource;
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });

    const malformed = makeSubnet(fixture, { DefaultForAz: null });
    client = makeClient(fixture, {
      exact: malformed,
      logical: [],
      slot: [malformed],
    });
    resource = makePorts(fixture, { client }).resource;
    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeSubnetResourceUnknownError);
  });
});

describe('AWS single-node subnet noop and dependency authority', () => {
  it('preserves the prior receipt, nonce, provider identity, and exact VPC lineage', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    if (fixture.priorBinding === null) {
      throw new Error('Missing prior subnet binding.');
    }
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    const settlement = await resource.verifySettlement(fixture.context);

    expect(settlement).toEqual({
      status: 'converged',
      binding: fixture.priorBinding,
    });
    expect(settlement.binding.createdByActionId).toBe(
      fixture.priorBinding.createdByActionId,
    );
    expect(settlement.binding.ownershipNonce).toBe(
      fixture.priorBinding.ownershipNonce,
    );
    expect(settlement.binding.dependencyBindings).toEqual([
      {
        bindingId: fixture.vpcBinding.bindingId,
        resourceKey: 'network-vpc',
      },
    ]);
    expect(client.createSubnet).not.toHaveBeenCalled();
    expect(client.deleteSubnet).not.toHaveBeenCalled();
  });

  it('blocks incomplete or conflicting noop tags', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const incompleteTags = expectedTags(fixture);
    delete incompleteTags['wharfie:state-digest'];
    const incomplete = makeSubnet(fixture, {
      Tags: tagArray(incompleteTags),
    });
    let client = makeClient(fixture, {
      exact: incomplete,
      logical: [incomplete],
      slot: [incomplete],
    });
    let resource = makePorts(fixture, { client }).resource;
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });

    const conflictingTags = expectedTags(fixture);
    conflictingTags['wharfie:ownership-nonce'] = nonce(99);
    const conflicting = makeSubnet(fixture, {
      Tags: tagArray(conflictingTags),
    });
    client = makeClient(fixture, {
      exact: conflicting,
      logical: [conflicting],
      slot: [conflicting],
    });
    resource = makePorts(fixture, { client }).resource;
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('requires the exact settled VPC dependency binding before provider calls', async () => {
    const fixture = makeFixture();
    const missingHead = recreateHead(fixture, { resourceBindings: [] });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction({ ...fixture.context, head: missingHead }),
    ).rejects.toBeInstanceOf(AwsSingleNodeSubnetResourceConflictError);
    expect(client.describeSubnets).not.toHaveBeenCalled();
  });

  it('rejects mismatched VPC role, provider type, receipt, and intent nonce before reads', async () => {
    const fixture = makeFixture();
    const cases = [
      {
        role: { kind: 'subnet', version: 1 },
        providerType: 'ec2-vpc',
        createdByActionId: fixture.vpcBinding.createdByActionId,
        ownershipNonce: fixture.vpcBinding.ownershipNonce,
      },
      {
        role: { kind: 'vpc', version: 1 },
        providerType: 'ec2-subnet',
        createdByActionId: fixture.vpcBinding.createdByActionId,
        ownershipNonce: fixture.vpcBinding.ownershipNonce,
      },
      {
        role: { kind: 'vpc', version: 1 },
        providerType: 'ec2-vpc',
        createdByActionId: semanticId(
          'wda3',
          'wharfie:test:wrong-subnet-vpc-receipt:v1',
          { wrong: true },
        ),
        ownershipNonce: fixture.vpcBinding.ownershipNonce,
      },
    ];
    for (const candidate of cases) {
      const binding = createDeploymentResourceBinding({
        schemaVersion: 2,
        kind: 'deploymentResourceBinding',
        deploymentInstanceId: fixture.base.deploymentInstanceId,
        incarnationId: fixture.base.incarnationId,
        resourceKey: 'network-vpc',
        capability: { kind: 'networking', version: 1 },
        role: candidate.role,
        management: 'managed',
        ownershipMode: 'direct',
        onDestroy: 'purge',
        dependencyBindings: [],
        providerType: candidate.providerType,
        providerResourceId: VPC_IDS.primary,
        providerScopeId: fixture.base.providerScope.providerScopeId,
        ownershipNonce: candidate.ownershipNonce,
        createdByActionId: candidate.createdByActionId,
      });
      const head = recreateHead(fixture, { resourceBindings: [binding] });
      const client = makeClient(fixture);
      const { resource } = makePorts(fixture, { client });
      await expect(
        resource.executeAction({ ...fixture.context, head }),
      ).rejects.toBeInstanceOf(AwsSingleNodeSubnetResourceConflictError);
      expect(client.describeSubnets).not.toHaveBeenCalled();
    }

    const rawHead = JSON.parse(JSON.stringify(fixture.head));
    rawHead.resourceBindings[0].ownershipNonce = nonce(98);
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });
    await expect(
      resource.executeAction({ ...fixture.context, head: rawHead }),
    ).rejects.toBeInstanceOf(Error);
    expect(client.describeSubnets).not.toHaveBeenCalled();
  });
});

describe('AWS single-node subnet destroy', () => {
  it('requires the later VPC delete intent to remain pending before provider calls', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const head = JSON.parse(JSON.stringify(fixture.head));
    const vpcActionIndex = fixture.plan.actions.findIndex(
      (/** @type {Readonly<AnyRecord>} */ action) =>
        action.resourceKey === 'network-vpc',
    );
    head.activeOperation.intents[vpcActionIndex].status = 'settled';
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction({ ...fixture.context, head }),
    ).rejects.toBeInstanceOf(Error);
    expect(client.describeSubnets).not.toHaveBeenCalled();
    expect(client.deleteSubnet).not.toHaveBeenCalled();
  });

  it('deletes only the exact bound owned subnet with one frozen request', async () => {
    const fixture = makeFixture({
      operation: 'destroy',
      observedStateDigest: digest('observed subnet state'),
    });
    const deleteSubnet = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ _request) => ({
        ignored: true,
      }),
    );
    const client = makeClient(fixture, { deleteSubnet });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();

    expect(deleteSubnet).toHaveBeenCalledTimes(1);
    expect(deleteSubnet).toHaveBeenCalledWith({
      SubnetId: SUBNET_IDS.primary,
    });
    const request = deleteSubnet.mock.calls.at(0)?.at(0);
    if (request === undefined) throw new Error('Missing delete request.');
    expectDeepFrozen(request);
    expect(client.createSubnet).not.toHaveBeenCalled();
  });

  it('permits mutable and desired-state drift while retaining exact ownership fences', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const drifted = makeSubnet(fixture, {
      AssignIpv6AddressOnCreation: true,
      AvailabilityZoneId: 'use1-az2',
      BlockPublicAccessStates: {
        InternetGatewayBlockMode: 'block-bidirectional',
      },
      CidrBlock: OTHER_SUBNET_CIDR,
      Ipv6CidrBlockAssociationSet: [
        {
          AssociationId: 'subnet-cidr-assoc-00000000000000001',
          Ipv6CidrBlock: '2001:db8::/64',
          Ipv6CidrBlockState: { State: 'associated' },
        },
      ],
      Ipv6Native: true,
      MapPublicIpOnLaunch: true,
    });
    const client = makeClient(fixture, {
      exact: drifted,
      logical: [drifted],
      slot: [],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.deleteSubnet).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['foreign owner', { OwnerId: '999999999999' }],
    ['wrong parent VPC', { VpcId: VPC_IDS.other }],
    ['default subnet', { DefaultForAz: true }],
  ])('blocks %s even during destroy', async (_name, overrides) => {
    const fixture = makeFixture({ operation: 'destroy' });
    const conflicting = makeSubnet(fixture, overrides);
    const client = makeClient(fixture, {
      exact: conflicting,
      logical: [conflicting],
      slot: [conflicting],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeSubnetResourceConflictError);
    expect(client.deleteSubnet).not.toHaveBeenCalled();
  });

  it('blocks incomplete and conflicting ownership tags during destroy', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const incompleteTags = expectedTags(fixture);
    delete incompleteTags['wharfie:state-digest'];
    const incomplete = makeSubnet(fixture, {
      Tags: tagArray(incompleteTags),
    });
    let client = makeClient(fixture, {
      exact: incomplete,
      logical: [incomplete],
      slot: [incomplete],
    });
    let resource = makePorts(fixture, { client }).resource;
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });

    const conflictingTags = expectedTags(fixture);
    conflictingTags['wharfie:ownership-nonce'] = nonce(99);
    const conflicting = makeSubnet(fixture, {
      Tags: tagArray(conflictingTags),
    });
    client = makeClient(fixture, {
      exact: conflicting,
      logical: [conflicting],
      slot: [conflicting],
    });
    resource = makePorts(fixture, { client }).resource;
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('requires an available lifecycle before delete', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const pending = makeSubnet(fixture, { State: 'pending' });
    const client = makeClient(fixture, {
      exact: pending,
      logical: [pending],
      slot: [pending],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(client.deleteSubnet).not.toHaveBeenCalled();
  });

  it.each(['InvalidSubnetID.NotFound', 'InvalidSubnetId.NotFound'])(
    'settles complete absence only from exact %s plus empty logical and slot traversals',
    async (name) => {
      const fixture = makeFixture({ operation: 'destroy' });
      const describeSubnets = jest.fn(
        async (/** @type {AnyRecord} */ input) => {
          if (requestKind(input) === 'exact') throw providerError(name);
          return { Subnets: [] };
        },
      );
      const client = makeClient(fixture, { describeSubnets });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();
      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'converged',
          binding: null,
        },
      );
      expect(client.deleteSubnet).not.toHaveBeenCalled();
    },
  );

  it('does not accept successful exact empty arrays as authoritative absence', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, {
      describeSubnets: jest.fn(async () => ({ Subnets: [] })),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeSubnetResourceUnknownError);
    expect(client.deleteSubnet).not.toHaveBeenCalled();
  });

  it('keeps a successful delete unsettled until every independent read proves absence', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const subnet = makeSubnet(fixture);
    let deleted = false;
    const describeSubnets = jest.fn(async (/** @type {AnyRecord} */ input) => {
      if (!deleted) return { Subnets: [subnet] };
      if (requestKind(input) === 'exact') {
        throw providerError('InvalidSubnetID.NotFound');
      }
      return { Subnets: [] };
    });
    const deleteSubnet = jest.fn(async () => {
      deleted = true;
      return { secret: 'ignored-delete-response' };
    });
    const client = makeClient(fixture, { describeSubnets, deleteSubnet });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(deleteSubnet).toHaveBeenCalledTimes(1);
  });

  it.each([
    'InvalidSubnetID.NotFound',
    'InvalidSubnetId.NotFound',
    'DependencyViolation',
    'IncorrectState',
  ])('treats %s delete failure as readback-only', async (name) => {
    const fixture = makeFixture({ operation: 'destroy' });
    const deleteSubnet = jest.fn(async () => {
      throw providerError(name, 'delete-secret');
    });
    const client = makeClient(fixture, { deleteSubnet });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(deleteSubnet).toHaveBeenCalledTimes(1);
  });

  it('sanitizes unknown delete failures without trusting their response', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const deleteSubnet = jest.fn(async () => {
      throw providerError('NetworkingError', 'unknown-delete-secret');
    });
    const client = makeClient(fixture, { deleteSubnet });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(AwsSingleNodeSubnetResourceUnknownError);
    expect(JSON.stringify(observed)).not.toContain('unknown-delete-secret');
  });
});

describe('AWS single-node subnet exact absence and pagination bounds', () => {
  it.each(['InvalidSubnetID.NotFound', 'InvalidSubnetId.NotFound'])(
    'keeps create recovery retryable when exact read returns %s but broad evidence remains',
    async (name) => {
      const fixture = makeFixture();
      const subnet = makeSubnet(fixture);
      const describeSubnets = jest.fn(
        async (/** @type {AnyRecord} */ input) => {
          if (requestKind(input) === 'exact') throw providerError(name);
          return { Subnets: [subnet] };
        },
      );
      const client = makeClient(fixture, { describeSubnets });
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'not-converged',
        },
      );
      expect(client.createSubnet).not.toHaveBeenCalled();
    },
  );

  it('rejects a successful exact empty array during create recovery', async () => {
    const fixture = makeFixture();
    const subnet = makeSubnet(fixture);
    const describeSubnets = jest.fn(async (/** @type {AnyRecord} */ input) => ({
      Subnets: requestKind(input) === 'exact' ? [] : [subnet],
    }));
    const client = makeClient(fixture, { describeSubnets });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeSubnetResourceUnknownError);
    expect(client.createSubnet).not.toHaveBeenCalled();
  });

  it.each(['logical', 'slot'])(
    'rejects repeated %s discovery tokens within the hard bound',
    async (channel) => {
      const fixture = makeFixture();
      const subnet = makeSubnet(fixture);
      let calls = 0;
      const describeSubnets = jest.fn(
        async (/** @type {AnyRecord} */ input) => {
          const kind = requestKind(input);
          if (kind === 'exact') return { Subnets: [subnet] };
          if (kind === channel) {
            calls += 1;
            return { Subnets: [], NextToken: 'same' };
          }
          return { Subnets: [subnet] };
        },
      );
      const client = makeClient(fixture, { describeSubnets });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.verifySettlement(fixture.context),
      ).rejects.toBeInstanceOf(AwsSingleNodeSubnetResourceUnknownError);
      expect(calls).toBe(2);
    },
  );

  it.each(['logical', 'slot'])(
    'rejects %s continuation at the maximum page count',
    async (channel) => {
      const fixture = makeFixture();
      const subnet = makeSubnet(fixture);
      let page = 0;
      const describeSubnets = jest.fn(
        async (/** @type {AnyRecord} */ input) => {
          const kind = requestKind(input);
          if (kind === 'exact') return { Subnets: [subnet] };
          if (kind === channel) {
            page += 1;
            return { Subnets: [], NextToken: `page-${page}` };
          }
          return { Subnets: [subnet] };
        },
      );
      const client = makeClient(fixture, { describeSubnets });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.verifySettlement(fixture.context),
      ).rejects.toBeInstanceOf(AwsSingleNodeSubnetResourceUnknownError);
      expect(page).toBe(AWS_SINGLE_NODE_SUBNET_MAX_DISCOVERY_PAGES);
    },
  );

  it.each(['', 1, {}])(
    'rejects malformed discovery token %p',
    async (NextToken) => {
      const fixture = makeFixture();
      const describeSubnets = jest.fn(async () => ({
        Subnets: [],
        NextToken,
      }));
      const client = makeClient(fixture, { describeSubnets });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.verifySettlement(fixture.context),
      ).rejects.toBeInstanceOf(AwsSingleNodeSubnetResourceUnknownError);
    },
  );

  it('blocks impossible pagination on an exact-ID response', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const subnet = makeSubnet(fixture);
    const describeSubnets = jest.fn(async (/** @type {AnyRecord} */ input) =>
      requestKind(input) === 'exact'
        ? { Subnets: [subnet], NextToken: 'impossible' }
        : { Subnets: [subnet] },
    );
    const client = makeClient(fixture, { describeSubnets });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('retries transient one-sided visibility and waits only between attempts', async () => {
    const fixture = makeFixture();
    const subnet = makeSubnet(fixture);
    let logicalReads = 0;
    const describeSubnets = jest.fn(async (/** @type {AnyRecord} */ input) => {
      const kind = requestKind(input);
      if (kind === 'logical') {
        logicalReads += 1;
        return { Subnets: logicalReads === 1 ? [] : [subnet] };
      }
      return { Subnets: [subnet] };
    });
    const waitForRetry = jest.fn();
    const client = makeClient(fixture, { describeSubnets });
    const { resource } = makePorts(fixture, {
      client,
      maxAttempts: 2,
      waitForRetry,
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(waitForRetry.mock.calls).toEqual([[1]]);
  });

  it('maps provider and waiter failures to fixed non-echoing unknown state', async () => {
    const fixture = makeFixture();
    const providerClient = makeClient(fixture, {
      describeSubnets: jest.fn(async () => {
        throw providerError('NetworkingError', 'read-secret');
      }),
    });
    const providerResource = makePorts(fixture, {
      client: providerClient,
      maxAttempts: 1,
    }).resource;
    let observed = await providerResource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(AwsSingleNodeSubnetResourceUnknownError);
    expect(JSON.stringify(observed)).not.toContain('read-secret');

    const subnet = makeSubnet(fixture);
    const waitClient = makeClient(fixture, {
      exact: subnet,
      logical: [],
      slot: [subnet],
    });
    const waitResource = makePorts(fixture, {
      client: waitClient,
      maxAttempts: 2,
      waitForRetry: jest.fn(async () => {
        throw new Error('wait-secret');
      }),
    }).resource;
    observed = await waitResource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(AwsSingleNodeSubnetResourceUnknownError);
    expect(JSON.stringify(observed)).not.toContain('wait-secret');
  });

  it('exports explicit retry and discovery bounds', () => {
    expect(AWS_SINGLE_NODE_SUBNET_DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(AWS_SINGLE_NODE_SUBNET_MAX_ATTEMPTS).toBe(10);
    expect(AWS_SINGLE_NODE_SUBNET_MAX_DISCOVERY_PAGES).toBe(16);
    expect(AWS_SINGLE_NODE_SUBNET_DISCOVERY_MAX_RESULTS).toBe(100);
  });
});

describe('AWS single-node subnet controller and factory contracts', () => {
  it.each([
    [
      'extra context key',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        extra: true,
      }),
      TypeError,
    ],
    [
      'missing artifact stage',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => {
        const context = /** @type {AnyRecord} */ ({ ...fixture.context });
        delete context.artifactStage;
        return context;
      },
      TypeError,
    ],
    [
      'wrong nonce',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        ownershipNonce: nonce(99),
      }),
      AwsSingleNodeSubnetResourceConflictError,
    ],
    [
      'wrong index',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        actionIndex: 0,
      }),
      AwsSingleNodeSubnetResourceConflictError,
    ],
    [
      'blocked operation',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        head: recreateHead(fixture, {
          activeOperation: { status: 'blocked' },
        }),
      }),
      AwsSingleNodeSubnetResourceConflictError,
    ],
  ])('rejects %s before provider calls', async (_name, mutate, ErrorType) => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(mutate(fixture)),
    ).rejects.toBeInstanceOf(ErrorType);
    expect(client.describeSubnets).not.toHaveBeenCalled();
    expect(client.createSubnet).not.toHaveBeenCalled();
    expect(client.deleteSubnet).not.toHaveBeenCalled();
  });

  it('rejects stale but internally valid dependency lineage on noop', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    if (fixture.priorBinding === null) {
      throw new Error('Missing prior subnet binding.');
    }
    const staleVpc = makeVpcBinding(
      fixture.base,
      fixture.plan.actions.find(
        (/** @type {Readonly<AnyRecord>} */ action) =>
          action.resourceKey === 'network-vpc',
      ),
      {
        providerResourceId: VPC_IDS.other,
        ownershipNonce: fixture.vpcBinding.ownershipNonce,
        createdByActionId: fixture.vpcBinding.createdByActionId,
      },
    );
    const staleSubnet = makeSubnetBinding(
      fixture.base,
      fixture.action,
      staleVpc,
      {
        ownershipNonce: fixture.ownershipNonce,
        createdByActionId: fixture.priorBinding.createdByActionId,
      },
    );
    const staleHead = recreateHead(fixture, {
      resourceBindings: [staleVpc, staleSubnet],
    });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction({ ...fixture.context, head: staleHead }),
    ).rejects.toBeInstanceOf(AwsSingleNodeSubnetResourceConflictError);
    expect(client.describeSubnets).not.toHaveBeenCalled();
  });

  it('accepts and ignores a non-null controller artifact receipt', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const context = {
      ...fixture.context,
      artifactStage: Object.freeze({ opaque: 'held-by-controller' }),
    };
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(resource.executeAction(context)).resolves.toBeUndefined();
    await expect(resource.verifySettlement(context)).resolves.toEqual({
      status: 'converged',
      binding: fixture.priorBinding,
    });
  });

  it('returns only frozen ports and never closes the caller client', () => {
    const fixture = makeFixture();
    const client = { ...makeClient(fixture), close: jest.fn() };
    const resource = createAwsSingleNodeSubnetResource({
      client,
      providerScope: fixture.base.providerScope,
    });

    expect(Object.keys(resource).sort()).toEqual([
      'executeAction',
      'verifySettlement',
    ]);
    expect(Object.isFrozen(resource)).toBe(true);
    expect(client.close).not.toHaveBeenCalled();
  });

  it('rejects unsupported options, incomplete clients, bounds, and bad scope', () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    expect(() =>
      createAwsSingleNodeSubnetResource({
        client,
        providerScope: fixture.base.providerScope,
        unsupported: true,
      }),
    ).toThrow(TypeError);
    for (const method of ['createSubnet', 'describeSubnets', 'deleteSubnet']) {
      expect(() =>
        createAwsSingleNodeSubnetResource({
          client: { ...client, [method]: undefined },
          providerScope: fixture.base.providerScope,
        }),
      ).toThrow(TypeError);
    }
    for (const maxAttempts of [
      0,
      AWS_SINGLE_NODE_SUBNET_MAX_ATTEMPTS + 1,
      1.5,
    ]) {
      expect(() =>
        createAwsSingleNodeSubnetResource({
          client,
          providerScope: fixture.base.providerScope,
          maxAttempts,
        }),
      ).toThrow(TypeError);
    }
    expect(() =>
      createAwsSingleNodeSubnetResource({
        client,
        providerScope: fixture.base.providerScope,
        waitForRetry: 'not-a-function',
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeSubnetResource({ client, providerScope: {} }),
    ).toThrow(TypeError);
  });

  it('exports fixed non-echoing public errors', () => {
    const conflict = new AwsSingleNodeSubnetResourceConflictError();
    const unknown = new AwsSingleNodeSubnetResourceUnknownError();
    expect(conflict).toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeSubnetResourceConflictError',
        code: 'AWS_SINGLE_NODE_SUBNET_RESOURCE_CONFLICT',
      }),
    );
    expect(unknown).toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeSubnetResourceUnknownError',
        code: 'AWS_SINGLE_NODE_SUBNET_RESOURCE_UNKNOWN',
      }),
    );
    expect(JSON.stringify({ conflict, unknown })).not.toContain(
      'provider-secret',
    );
  });
});
