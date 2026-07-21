import { describe, expect, it, jest } from '@jest/globals';

import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
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
  AWS_SINGLE_NODE_VPC_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VPC_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_VPC_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VPC_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_VPC_STATE_DIGEST_DOMAIN,
  AwsSingleNodeVpcResourceConflictError,
  AwsSingleNodeVpcResourceUnknownError,
  createAwsSingleNodeVpcResource,
  getAwsSingleNodeVpcStateDigest,
} from '../../src/core/runtime/deployment-aws-vpc-resource.js';
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

const VPC_IDS = Object.freeze({
  primary: 'vpc-00000000000000001',
  duplicate: 'vpc-00000000000000002',
  replacement: 'vpc-00000000000000003',
});
const CIDR_ASSOCIATION_ID = 'vpc-cidr-assoc-00000000000000001';

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

/** @param {Readonly<Record<string, any>>} profile @param {Readonly<Record<string, any>>} providerScope */
function makeProviderSpec(profile, providerScope) {
  return createAwsSingleNodeProviderSpec({
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
    },
    placement: { availabilityZoneId: 'use1-az1' },
    storage: {
      ebsKmsKeyArn:
        'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    },
    bootstrapDigest: digest('vpc test bootstrap'),
    runtimeIdentityPolicyDigest: digest('vpc test runtime identity policy'),
  });
}

/** @returns {Readonly<Record<string, any>>} */
function makeBase() {
  const profile = validateDeploymentProfile(
    createDeploymentProfile({
      profile: { id: 'production' },
      appId: 'vpc-resource-test',
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
    revisionId: semanticId('wrv1', 'wharfie:test:vpc-revision:v1', {
      revision: 1,
    }),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'vpc resource artifact',
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

/** @param {Readonly<Record<string, any>>} definition @returns {string} */
function providerResourceId(definition) {
  if (definition.resourceKey === 'network-vpc') return VPC_IDS.primary;
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
      definition.resourceKey === 'network-vpc'
        ? getAwsSingleNodeVpcStateDigest(base.providerSpec)
        : digest(`${definition.resourceKey} desired`),
  };
}

/** @param {Readonly<Record<string, any>>} base @param {'apply'|'reconcile'|'destroy'} operation @param {{observedVpcStateDigest?: Readonly<Record<string, any>>}} [options] */
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
        ...(definition.resourceKey === 'network-vpc' &&
        options.observedVpcStateDigest !== undefined
          ? { stateDigest: options.observedVpcStateDigest }
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
        inspectionId: semanticId('win5', 'wharfie:test:vpc-inspection:v1', {
          operation,
        }),
      },
      actions,
    },
    { profile: base.profile },
  );
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} action @param {Record<string, any>} [overrides] */
function makeBinding(base, action, overrides = {}) {
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
    dependencyBindings: [],
    providerType: action.before?.providerType ?? action.after.providerType,
    providerResourceId:
      overrides.providerResourceId ??
      action.before?.providerResourceId ??
      VPC_IDS.primary,
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce: overrides.ownershipNonce ?? nonce(71),
    createdByActionId:
      overrides.createdByActionId ??
      semanticId('wda3', 'wharfie:test:vpc-create-action:v1', {
        resourceKey: action.resourceKey,
      }),
  });
}

/** @param {{operation?: 'apply'|'reconcile'|'destroy', observedVpcStateDigest?: Readonly<Record<string, any>>, ownershipNonceByte?: number}} [options] */
function makeFixture(options = {}) {
  const operation = options.operation ?? 'apply';
  const base = makeBase();
  const plan = makePlan(base, operation, options);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'network-vpc',
  );
  const action = plan.actions[actionIndex];
  if (action === undefined) throw new Error('Missing network-vpc action.');
  const ownershipNonce = nonce(options.ownershipNonceByte ?? 71);
  const priorBinding =
    action.action === 'create'
      ? null
      : makeBinding(base, action, { ownershipNonce });
  const resourceBindings = priorBinding === null ? [] : [priorBinding];
  /** @type {AnyRecord|null} */
  let lastOperation = null;
  if (operation !== 'apply') {
    if (priorBinding === null) throw new Error('Missing existing VPC binding.');
    lastOperation = {
      kind: 'create',
      planId: semanticId('wpl3', 'wharfie:test:vpc-last-plan:v1', {
        operation,
      }),
      intents: [
        {
          actionId: priorBinding.createdByActionId,
          status: 'settled',
          ownershipNonce: priorBinding.ownershipNonce,
        },
      ],
    };
  }
  const intents = plan.actions.map(
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
        index === actionIndex ? ownershipNonce : nonce(10 + index),
    }),
  );
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
    resourceBindings: head.resourceBindings,
    activeOperation: {
      kind: head.activeOperation.kind,
      planId: head.activeOperation.planId,
      status: head.activeOperation.status,
      nextActionIndex: head.activeOperation.nextActionIndex,
      intents: head.activeOperation.intents,
      ...changes,
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
    'wharfie:resource-kind': 'single-node-vpc',
    'wharfie:retention': 'purge',
    'wharfie:schema-version': '2',
    'wharfie:capability': 'networking',
    'wharfie:role': 'vpc',
    'wharfie:provider-scope-id': fixture.base.providerScope.providerScopeId,
    'wharfie:deployment-instance-id': fixture.base.deploymentInstanceId,
    'wharfie:incarnation-id': fixture.base.incarnationId,
    'wharfie:resource-key': 'network-vpc',
    'wharfie:created-by-action-id':
      fixture.priorBinding?.createdByActionId ?? fixture.action.actionId,
    'wharfie:ownership-nonce': fixture.ownershipNonce,
    'wharfie:state-digest': getAwsSingleNodeVpcStateDigest(
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
function makeVpc(fixture, overrides = {}) {
  const cidr = fixture.base.providerSpec.capabilities.networking.vpcCidr;
  return {
    VpcId: VPC_IDS.primary,
    OwnerId: fixture.base.providerScope.accountId,
    State: 'available',
    CidrBlock: cidr,
    CidrBlockAssociationSet: [
      {
        AssociationId: CIDR_ASSOCIATION_ID,
        CidrBlock: cidr,
        CidrBlockState: { State: 'associated' },
      },
    ],
    DhcpOptionsId: 'dopt-00000000000000001',
    Ipv6CidrBlockAssociationSet: [],
    InstanceTenancy: 'default',
    IsDefault: false,
    BlockPublicAccessStates: { InternetGatewayBlockMode: 'off' },
    Tags: tagArray(expectedTags(fixture)),
    ...overrides,
  };
}

/** @param {boolean} support @param {boolean} hostnames @returns {(input: AnyRecord) => Promise<AnyRecord>} */
function attributeReader(support = true, hostnames = false) {
  return async (input) =>
    input.Attribute === 'enableDnsSupport'
      ? { VpcId: input.VpcId, EnableDnsSupport: { Value: support } }
      : { VpcId: input.VpcId, EnableDnsHostnames: { Value: hostnames } };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makeClient(fixture, options = {}) {
  const matches = options.matches ?? [makeVpc(fixture)];
  const exact = options.exact ?? matches;
  return Object.freeze({
    createVpc:
      options.createVpc ??
      jest.fn(async () => ({ Vpc: { VpcId: VPC_IDS.primary } })),
    describeVpcs:
      options.describeVpcs ??
      jest.fn(async (/** @type {AnyRecord} */ input) => ({
        Vpcs: input.VpcIds
          ? exact.filter((/** @type {AnyRecord} */ vpc) =>
              input.VpcIds.includes(vpc.VpcId),
            )
          : matches,
      })),
    describeVpcAttribute:
      options.describeVpcAttribute ?? jest.fn(attributeReader()),
    deleteVpc: options.deleteVpc ?? jest.fn(async () => ({})),
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makePorts(fixture, options = {}) {
  const client = options.client ?? makeClient(fixture, options);
  const waitForRetry = options.waitForRetry ?? jest.fn();
  return {
    client,
    waitForRetry,
    resource: createAwsSingleNodeVpcResource({
      client,
      providerScope: fixture.base.providerScope,
      maxAttempts: options.maxAttempts ?? 1,
      waitForRetry,
    }),
  };
}

describe('AWS single-node VPC state digest', () => {
  it('is deterministic, domain separated, frozen, and binds the fixed VPC contract', () => {
    const base = makeBase();
    const first = getAwsSingleNodeVpcStateDigest(base.providerSpec);
    const second = getAwsSingleNodeVpcStateDigest(base.providerSpec);

    expect(first).toEqual(second);
    expect(first.algorithm).toBe('sha256');
    expect(first.value).toHaveLength(43);
    expect(Object.isFrozen(first)).toBe(true);
    expect(AWS_SINGLE_NODE_VPC_STATE_DIGEST_DOMAIN).toBe(
      'wharfie:aws-single-node-ec2-vpc-state:v1',
    );
    expect(first.value).toBe(
      sha256Base64Url(
        `${AWS_SINGLE_NODE_VPC_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
          sortCanonicalJsonValue({
            schemaVersion: 1,
            kind: 'awsSingleNodeEc2VpcState',
            cidrBlock: '10.42.0.0/16',
            instanceTenancy: 'default',
            isDefault: false,
            ipv6: false,
            enableDnsSupport: true,
            enableDnsHostnames: false,
            internetGatewayBlockMode: 'off',
            onDestroy: 'purge',
          }),
        )}`,
      ),
    );
    expect(first).not.toEqual(digest('10.42.0.0/16'));
  });

  it('rejects malformed or noncanonical provider specifications', () => {
    expect(() => getAwsSingleNodeVpcStateDigest({})).toThrow(TypeError);
    const base = makeBase();
    const changed = JSON.parse(JSON.stringify(base.providerSpec));
    changed.capabilities.networking.vpcCidr = '10.99.0.0/16';
    expect(() => getAwsSingleNodeVpcStateDigest(changed)).toThrow(TypeError);
  });
});

describe('AWS single-node VPC create and response-loss recovery', () => {
  it('submits one exact deeply frozen CreateVpc request with atomic ownership tags', async () => {
    const fixture = makeFixture();
    const createVpc = jest.fn(async (/** @type {AnyRecord} */ _input) => ({
      Vpc: { VpcId: VPC_IDS.primary },
    }));
    const describeVpcs = jest.fn(async () => ({ Vpcs: [] }));
    const client = makeClient(fixture, {
      matches: [],
      exact: [],
      createVpc,
      describeVpcs,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);

    expect(createVpc).toHaveBeenCalledTimes(1);
    const request = createVpc.mock.calls[0][0];
    expect(request).toEqual({
      AmazonProvidedIpv6CidrBlock: false,
      CidrBlock: '10.42.0.0/16',
      InstanceTenancy: 'default',
      TagSpecifications: [
        {
          ResourceType: 'vpc',
          Tags: tagArray(expectedTags(fixture)),
        },
      ],
    });
    expect(request).not.toHaveProperty('ClientToken');
    expectDeepFrozen(request);
    expect(client.deleteVpc).not.toHaveBeenCalled();
  });

  it('settles only from exact readback and creates the exact binding', async () => {
    const fixture = makeFixture();
    const vpc = makeVpc(fixture);
    const client = makeClient(fixture, { matches: [], exact: [] });
    const { resource } = makePorts(fixture, { client });
    await resource.executeAction(fixture.context);
    client.describeVpcs.mockImplementation(
      async (/** @type {AnyRecord} */ input) => ({
        Vpcs: input.VpcIds ? [vpc] : [vpc],
      }),
    );

    const settlement = await resource.verifySettlement(fixture.context);

    expect(settlement).toMatchObject({
      status: 'converged',
      binding: {
        resourceKey: 'network-vpc',
        providerType: 'ec2-vpc',
        providerResourceId: VPC_IDS.primary,
        management: 'managed',
        ownershipMode: 'direct',
        onDestroy: 'purge',
        dependencyBindings: [],
        ownershipNonce: fixture.ownershipNonce,
        createdByActionId: fixture.action.actionId,
      },
    });
    expectDeepFrozen(settlement);
    expect(client.describeVpcAttribute).toHaveBeenCalledTimes(2);
  });

  it('recovers a lost CreateVpc response by bounded tag discovery in a fresh factory', async () => {
    const fixture = makeFixture();
    const providerError = new Error('secret request detail');
    const firstClient = makeClient(fixture, {
      matches: [],
      exact: [],
      createVpc: jest.fn(async () => {
        throw providerError;
      }),
    });
    const first = makePorts(fixture, { client: firstClient }).resource;
    await expect(first.executeAction(fixture.context)).rejects.toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeVpcResourceUnknownError',
        message: 'AWS single-node VPC resource state is unknown.',
      }),
    );

    const recoveredVpc = makeVpc(fixture);
    const secondClient = makeClient(fixture, { matches: [recoveredVpc] });
    const second = makePorts(fixture, { client: secondClient }).resource;
    const settlement = await second.verifySettlement(fixture.context);

    expect(settlement.status).toBe('converged');
    expect(settlement.binding.providerResourceId).toBe(VPC_IDS.primary);
    expect(secondClient.createVpc).not.toHaveBeenCalled();
    expect(secondClient.describeVpcs).toHaveBeenCalledTimes(1);
    const discovery = secondClient.describeVpcs.mock.calls[0][0];
    expect(discovery).not.toHaveProperty('VpcIds');
    expect(discovery).toMatchObject({
      MaxResults: AWS_SINGLE_NODE_VPC_DISCOVERY_MAX_RESULTS,
      Filters: expect.arrayContaining([
        {
          Name: 'tag:wharfie:resource-key',
          Values: ['network-vpc'],
        },
        {
          Name: 'tag:wharfie:incarnation-id',
          Values: [fixture.base.incarnationId],
        },
      ]),
    });
    expectDeepFrozen(discovery);
    expect(JSON.stringify(settlement)).not.toContain('secret request detail');
  });

  it('never replays an ambiguous CreateVpc attempt in the same factory', async () => {
    const fixture = makeFixture();
    const createVpc = jest.fn(async () => {
      throw new Error('ambiguous-create-secret');
    });
    const client = makeClient(fixture, {
      matches: [],
      exact: [],
      createVpc,
    });
    const { resource } = makePorts(fixture, { client });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const observed = await resource
        .executeAction(fixture.context)
        .catch((/** @type {unknown} */ error) => error);
      expect(observed).toBeInstanceOf(AwsSingleNodeVpcResourceUnknownError);
      expect(JSON.stringify(observed)).not.toContain('ambiguous-create-secret');
    }
    expect(createVpc).toHaveBeenCalledTimes(1);
    expect(client.deleteVpc).not.toHaveBeenCalled();
  });

  it('authorizes a new attempted effect when durable ownership advances to a new nonce', async () => {
    const firstFixture = makeFixture({ ownershipNonceByte: 71 });
    const secondFixture = makeFixture({ ownershipNonceByte: 72 });
    expect(firstFixture.action.actionId).toBe(secondFixture.action.actionId);
    const createVpc = jest.fn(async (/** @type {AnyRecord} */ _request) => {
      throw new Error('ambiguous-create');
    });
    const client = makeClient(firstFixture, {
      matches: [],
      exact: [],
      createVpc,
    });
    const { resource } = makePorts(firstFixture, { client });

    await expect(
      resource.executeAction(firstFixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVpcResourceUnknownError);
    await expect(
      resource.executeAction(secondFixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVpcResourceUnknownError);

    expect(createVpc).toHaveBeenCalledTimes(2);
    const observedNonces = createVpc.mock.calls.map(
      ([request]) =>
        request.TagSpecifications[0].Tags.find(
          (/** @type {AnyRecord} */ tag) =>
            tag.Key === 'wharfie:ownership-nonce',
        ).Value,
    );
    expect(observedNonces).toEqual([
      firstFixture.ownershipNonce,
      secondFixture.ownershipNonce,
    ]);
  });

  it('preflights an exact discovered effect and never repeats CreateVpc', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);

    expect(client.createVpc).not.toHaveBeenCalled();
    expect(client.deleteVpc).not.toHaveBeenCalled();
  });

  it('blocks duplicate create evidence without hidden destructive compaction', async () => {
    const fixture = makeFixture();
    const duplicate = makeVpc(fixture, {
      VpcId: VPC_IDS.duplicate,
      CidrBlockAssociationSet: [
        {
          AssociationId: 'vpc-cidr-assoc-00000000000000002',
          CidrBlock: '10.42.0.0/16',
          CidrBlockState: { State: 'associated' },
        },
      ],
    });
    const client = makeClient(fixture, {
      matches: [makeVpc(fixture), duplicate],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVpcResourceConflictError);
    expect(client.describeVpcs).toHaveBeenCalledTimes(2);
    expect(client.describeVpcAttribute).not.toHaveBeenCalled();
    expect(client.createVpc).not.toHaveBeenCalled();
    expect(client.deleteVpc).not.toHaveBeenCalled();
  });

  it('does not adopt or repair incomplete create tags', async () => {
    const fixture = makeFixture();
    const tags = expectedTags(fixture);
    delete tags['wharfie:ownership-nonce'];
    const client = makeClient(fixture, {
      matches: [makeVpc(fixture, { Tags: tagArray(tags) })],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(client.createVpc).not.toHaveBeenCalled();
    expect(client.deleteVpc).not.toHaveBeenCalled();
  });
});

describe('AWS single-node VPC exact evidence', () => {
  it.each([
    ['owner', { OwnerId: '999999999999' }],
    ['CIDR', { CidrBlock: '10.99.0.0/16' }],
    ['tenancy', { InstanceTenancy: 'dedicated' }],
    ['default flag', { IsDefault: true }],
    [
      'IPv6 association',
      {
        Ipv6CidrBlockAssociationSet: [
          {
            AssociationId: 'vpc-cidr-assoc-00000000000000009',
            Ipv6CidrBlock: '2600:1f18::/56',
            Ipv6CidrBlockState: { State: 'associated' },
          },
        ],
      },
    ],
    ['state', { State: 'failed' }],
  ])('blocks contradictory %s evidence', async (_name, override) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      matches: [makeVpc(fixture, override)],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('accepts omitted optional IPv6 association evidence', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      matches: [
        makeVpc(fixture, {
          Ipv6CidrBlockAssociationSet: undefined,
        }),
      ],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).resolves.toMatchObject({ status: 'converged' });
  });

  it('accepts explicit effective public-access mode off', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      matches: [
        makeVpc(fixture, {
          BlockPublicAccessStates: { InternetGatewayBlockMode: 'off' },
        }),
      ],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).resolves.toMatchObject({ status: 'converged' });
  });

  it.each(['block-ingress', 'block-bidirectional'])(
    'blocks effective public-access mode %s',
    async (mode) => {
      const fixture = makeFixture();
      const client = makeClient(fixture, {
        matches: [
          makeVpc(fixture, {
            BlockPublicAccessStates: { InternetGatewayBlockMode: mode },
          }),
        ],
      });
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'blocked',
        },
      );
    },
  );

  it.each([
    ['null IPv6 associations', { Ipv6CidrBlockAssociationSet: null }],
    ['malformed IPv6 association item', { Ipv6CidrBlockAssociationSet: [{}] }],
    ['malformed IPv6 associations', { Ipv6CidrBlockAssociationSet: {} }],
    ['malformed DHCP options ID', { DhcpOptionsId: 'provider-secret-dhcp' }],
    ['malformed tags', { Tags: 'provider-secret-tags' }],
    ['missing public-access state', { BlockPublicAccessStates: undefined }],
    ['null public-access state', { BlockPublicAccessStates: null }],
    ['malformed public-access state', { BlockPublicAccessStates: {} }],
    [
      'unknown public-access mode',
      {
        BlockPublicAccessStates: {
          InternetGatewayBlockMode: 'provider-secret-mode',
        },
      },
    ],
  ])('maps %s to fixed unknown state', async (_name, override) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      matches: [makeVpc(fixture, override)],
    });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(AwsSingleNodeVpcResourceUnknownError);
    expect(JSON.stringify(observed)).not.toContain('provider-secret');
  });

  it('maps a malformed non-null CIDR status message to unknown state', async () => {
    const fixture = makeFixture();
    const cidr = fixture.base.providerSpec.capabilities.networking.vpcCidr;
    const client = makeClient(fixture, {
      matches: [
        makeVpc(fixture, {
          CidrBlockAssociationSet: [
            {
              AssociationId: CIDR_ASSOCIATION_ID,
              CidrBlock: cidr,
              CidrBlockState: {
                State: 'associating',
                StatusMessage: 42,
              },
            },
          ],
        }),
      ],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVpcResourceUnknownError);
  });

  it('blocks wrong reserved tags and unknown Wharfie tags but permits unrelated tags', async () => {
    const fixture = makeFixture();
    const wrong = expectedTags(fixture);
    wrong['wharfie:state-digest'] = digest('wrong').value;
    let client = makeClient(fixture, {
      matches: [makeVpc(fixture, { Tags: tagArray(wrong) })],
    });
    let resource = makePorts(fixture, { client }).resource;
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });

    client = makeClient(fixture, {
      matches: [
        makeVpc(fixture, {
          Tags: [
            ...tagArray(expectedTags(fixture)),
            { Key: 'wharfie:unexpected', Value: 'owned?' },
          ],
        }),
      ],
    });
    resource = makePorts(fixture, { client }).resource;
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });

    client = makeClient(fixture, {
      matches: [
        makeVpc(fixture, {
          Tags: [
            ...tagArray(expectedTags(fixture)),
            { Key: 'operator-note', Value: 'safe' },
          ],
        }),
      ],
    });
    resource = makePorts(fixture, { client }).resource;
    await expect(
      resource.verifySettlement(fixture.context),
    ).resolves.toMatchObject({
      status: 'converged',
    });
  });

  it.each([
    ['DNS support', false, false],
    ['DNS hostnames', true, true],
  ])('blocks wrong %s', async (_name, support, hostnames) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      describeVpcAttribute: jest.fn(attributeReader(support, hostnames)),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('distinguishes malformed attribute identity from a valid wrong VPC identity', async () => {
    const fixture = makeFixture();
    let client = makeClient(fixture, {
      describeVpcAttribute: jest.fn(async () => ({
        VpcId: 'provider-secret-invalid',
        EnableDnsSupport: { Value: true },
      })),
    });
    let resource = makePorts(fixture, { client }).resource;
    const malformed = await resource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(malformed).toBeInstanceOf(AwsSingleNodeVpcResourceUnknownError);
    expect(JSON.stringify(malformed)).not.toContain('provider-secret-invalid');

    client = makeClient(fixture, {
      describeVpcAttribute: jest.fn(async () => ({
        VpcId: VPC_IDS.duplicate,
        EnableDnsSupport: { Value: true },
      })),
    });
    resource = makePorts(fixture, { client }).resource;
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('maps malformed provider envelopes to a fixed non-echoing unknown error', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      describeVpcs: jest.fn(async () => ({
        Vpcs: 'provider-secret-malformed',
      })),
    });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(AwsSingleNodeVpcResourceUnknownError);
    expect(JSON.stringify(observed)).not.toContain('provider-secret-malformed');
  });
});

describe('AWS single-node VPC eventual consistency and pagination', () => {
  it.each([
    [
      'missing primary IPv4 associations',
      { CidrBlockAssociationSet: undefined },
    ],
    ['empty primary IPv4 associations', { CidrBlockAssociationSet: [] }],
    ['missing tags', { Tags: undefined }],
    ['null tags', { Tags: null }],
    ['empty tags', { Tags: [] }],
  ])('retries create-time %s', async (_name, override) => {
    const fixture = makeFixture();
    const propagating = makeVpc(fixture, override);
    const available = makeVpc(fixture);
    let discoveryCount = 0;
    const describeVpcs = jest.fn(async () => {
      discoveryCount += 1;
      return { Vpcs: [discoveryCount === 1 ? propagating : available] };
    });
    const client = makeClient(fixture, { describeVpcs });
    const waitForRetry = jest.fn();
    const { resource } = makePorts(fixture, {
      client,
      maxAttempts: 2,
      waitForRetry,
    });

    await expect(
      resource.verifySettlement(fixture.context),
    ).resolves.toMatchObject({ status: 'converged' });
    expect(waitForRetry).toHaveBeenCalledWith(1);
  });

  it('does not settle a remembered create candidate visible only by exact ID', async () => {
    const fixture = makeFixture();
    const vpc = makeVpc(fixture);
    const client = makeClient(fixture, { matches: [], exact: [] });
    const { resource } = makePorts(fixture, { client });
    await resource.executeAction(fixture.context);
    client.describeVpcs.mockImplementation(
      async (/** @type {AnyRecord} */ input) => ({
        Vpcs: input.VpcIds ? [vpc] : [],
      }),
    );

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(client.describeVpcAttribute).not.toHaveBeenCalled();
  });

  it('retries pending VPC state and converges from a later authoritative read', async () => {
    const fixture = makeFixture();
    const pending = makeVpc(fixture, { State: 'pending' });
    const available = makeVpc(fixture);
    let discoveryCount = 0;
    const describeVpcs = jest.fn(async (/** @type {AnyRecord} */ input) => {
      if (input.VpcIds) return { Vpcs: [available] };
      discoveryCount += 1;
      return { Vpcs: [discoveryCount === 1 ? pending : available] };
    });
    const client = makeClient(fixture, { describeVpcs });
    const waitForRetry = jest.fn();
    const { resource } = makePorts(fixture, {
      client,
      maxAttempts: 2,
      waitForRetry,
    });

    await expect(
      resource.verifySettlement(fixture.context),
    ).resolves.toMatchObject({
      status: 'converged',
    });
    expect(waitForRetry).toHaveBeenCalledWith(1);
  });

  it('returns not-converged after bounded pending evidence', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      matches: [makeVpc(fixture, { State: 'pending' })],
    });
    const waitForRetry = jest.fn();
    const { resource } = makePorts(fixture, {
      client,
      maxAttempts: 2,
      waitForRetry,
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(waitForRetry).toHaveBeenCalledTimes(1);
  });

  it('follows bounded discovery pages and rejects repeated tokens', async () => {
    const fixture = makeFixture();
    const vpc = makeVpc(fixture);
    let page = 0;
    const describeVpcs = jest.fn(async (/** @type {AnyRecord} */ _input) => {
      page += 1;
      return page === 1 ? { Vpcs: [], NextToken: 'next' } : { Vpcs: [vpc] };
    });
    let client = makeClient(fixture, {
      describeVpcs,
    });
    let resource = makePorts(fixture, { client }).resource;
    await expect(
      resource.verifySettlement(fixture.context),
    ).resolves.toMatchObject({
      status: 'converged',
    });
    expect(client.describeVpcs.mock.calls[1][0]).toMatchObject({
      NextToken: 'next',
      MaxResults: AWS_SINGLE_NODE_VPC_DISCOVERY_MAX_RESULTS,
    });
    expectDeepFrozen(client.describeVpcs.mock.calls[1][0]);

    client = makeClient(fixture, {
      describeVpcs: jest.fn(async () => ({
        Vpcs: [],
        NextToken: 'same',
      })),
    });
    resource = makePorts(fixture, { client }).resource;
    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVpcResourceUnknownError);
  });

  it('rejects malformed discovery tokens and exact-ID pagination', async () => {
    const fixture = makeFixture();
    for (const NextToken of ['', 1, {}]) {
      const client = makeClient(fixture, {
        describeVpcs: jest.fn(async () => ({ Vpcs: [], NextToken })),
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.verifySettlement(fixture.context),
      ).rejects.toBeInstanceOf(AwsSingleNodeVpcResourceUnknownError);
    }

    const reconcileFixture = makeFixture({ operation: 'reconcile' });
    const vpc = makeVpc(reconcileFixture);
    const client = makeClient(reconcileFixture, {
      describeVpcs: jest.fn(async (/** @type {AnyRecord} */ input) =>
        input.VpcIds
          ? { Vpcs: [vpc], NextToken: 'impossible' }
          : { Vpcs: [vpc] },
      ),
    });
    const { resource } = makePorts(reconcileFixture, { client });

    await expect(
      resource.verifySettlement(reconcileFixture.context),
    ).resolves.toEqual({ status: 'blocked' });
  });

  it('maps a retry waiter failure to fixed unknown state', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, { matches: [] });
    const { resource } = makePorts(fixture, {
      client,
      maxAttempts: 2,
      waitForRetry: jest.fn(async () => {
        throw new Error('wait-secret');
      }),
    });

    const observed = await resource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(AwsSingleNodeVpcResourceUnknownError);
    expect(JSON.stringify(observed)).not.toContain('wait-secret');
  });

  it('exports the explicit discovery and retry bounds', () => {
    expect(AWS_SINGLE_NODE_VPC_DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(AWS_SINGLE_NODE_VPC_MAX_ATTEMPTS).toBe(10);
    expect(AWS_SINGLE_NODE_VPC_MAX_DISCOVERY_PAGES).toBe(16);
    expect(AWS_SINGLE_NODE_VPC_DISCOVERY_MAX_RESULTS).toBe(100);
  });
});

describe('AWS single-node VPC noop and late visibility', () => {
  it('reads the exact bound VPC and preserves its creation receipt', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);
    const settlement = await resource.verifySettlement(fixture.context);

    expect(settlement).toEqual({
      status: 'converged',
      binding: fixture.priorBinding,
    });
    expect(client.createVpc).not.toHaveBeenCalled();
    expect(client.deleteVpc).not.toHaveBeenCalled();
  });

  it('blocks a late-visible duplicate on noop and never deletes it', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const duplicate = makeVpc(fixture, {
      VpcId: VPC_IDS.duplicate,
      CidrBlockAssociationSet: [
        {
          AssociationId: 'vpc-cidr-assoc-00000000000000002',
          CidrBlock: '10.42.0.0/16',
          CidrBlockState: { State: 'associated' },
        },
      ],
    });
    const describeVpcs = jest.fn(async (/** @type {AnyRecord} */ input) => {
      if (input.VpcIds) throw new Error('exact read must not run');
      return { Vpcs: [makeVpc(fixture), duplicate] };
    });
    const client = makeClient(fixture, { describeVpcs });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(describeVpcs).toHaveBeenCalledTimes(1);
    expect(client.describeVpcAttribute).not.toHaveBeenCalled();
    expect(client.deleteVpc).not.toHaveBeenCalled();
    expect(client.createVpc).not.toHaveBeenCalled();
  });

  it('keeps discovery-only bound visibility unresolved after exact NotFound', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const notFound = Object.assign(new Error('exact-not-found'), {
      name: 'InvalidVpcID.NotFound',
    });
    const describeVpcs = jest.fn(async (/** @type {AnyRecord} */ input) => {
      if (input.VpcIds) throw notFound;
      return { Vpcs: [makeVpc(fixture)] };
    });
    const client = makeClient(fixture, { describeVpcs });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(client.describeVpcAttribute).not.toHaveBeenCalled();
  });

  it('blocks contradictory discovered ownership before one-sided visibility can hide it', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const notFound = Object.assign(new Error('exact-not-found'), {
      name: 'InvalidVpcID.NotFound',
    });
    const describeVpcs = jest.fn(async (/** @type {AnyRecord} */ input) => {
      if (input.VpcIds) throw notFound;
      return { Vpcs: [makeVpc(fixture, { OwnerId: '999999999999' })] };
    });
    const client = makeClient(fixture, { describeVpcs });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.describeVpcAttribute).not.toHaveBeenCalled();
  });

  it('validates discovery and exact-ID records independently', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const client = makeClient(fixture, {
      matches: [makeVpc(fixture)],
      exact: [makeVpc(fixture, { OwnerId: '999999999999' })],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.describeVpcAttribute).not.toHaveBeenCalled();
  });

  it('blocks missing immutable tags after a binding exists', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const tags = expectedTags(fixture);
    delete tags['wharfie:ownership-nonce'];
    const client = makeClient(fixture, {
      matches: [makeVpc(fixture, { Tags: tagArray(tags) })],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it.each([undefined, null])(
    'treats bound missing Tags evidence (%p) as a conflict',
    async (tags) => {
      const fixture = makeFixture({ operation: 'reconcile' });
      const client = makeClient(fixture, {
        matches: [makeVpc(fixture, { Tags: tags })],
      });
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'blocked',
        },
      );
      expect(client.describeVpcAttribute).not.toHaveBeenCalled();
      expect(client.deleteVpc).not.toHaveBeenCalled();
    },
  );
});

describe('AWS single-node VPC destroy', () => {
  it('deletes only the exact bound sole logical match with a frozen request', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);

    expect(client.deleteVpc).toHaveBeenCalledTimes(1);
    expect(client.deleteVpc).toHaveBeenCalledWith({
      VpcId: VPC_IDS.primary,
    });
    expectDeepFrozen(client.deleteVpc.mock.calls[0][0]);
    expect(client.createVpc).not.toHaveBeenCalled();
  });

  it('purges an exactly bound owned VPC despite observed configuration drift', async () => {
    const fixture = makeFixture({
      operation: 'destroy',
      observedVpcStateDigest: digest('fresh-observed-drift'),
    });
    const drifted = makeVpc(fixture, {
      CidrBlock: '10.99.0.0/16',
      CidrBlockAssociationSet: 'drifted-provider-shape',
      DhcpOptionsId: 'drifted-dhcp-options',
      InstanceTenancy: 'dedicated',
      IsDefault: false,
      Ipv6CidrBlockAssociationSet: [{}],
      BlockPublicAccessStates: {
        InternetGatewayBlockMode: 'block-bidirectional',
      },
    });
    const client = makeClient(fixture, {
      matches: [drifted],
      exact: [drifted],
      describeVpcAttribute: jest.fn(async () => {
        throw new Error('mutable attributes must not be read');
      }),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.deleteVpc).toHaveBeenCalledWith({ VpcId: VPC_IDS.primary });
    expect(client.describeVpcAttribute).not.toHaveBeenCalled();
  });

  it('settles repeatable exact absence and ignores InvalidVpcID.NotFound', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const notFound = Object.assign(new Error('not-found-secret'), {
      name: 'InvalidVpcID.NotFound',
    });
    const describeVpcs = jest.fn(async (/** @type {AnyRecord} */ input) => {
      if (input.VpcIds) throw notFound;
      return { Vpcs: [] };
    });
    const client = makeClient(fixture, { describeVpcs, matches: [] });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(client.deleteVpc).not.toHaveBeenCalled();
  });

  it('treats an exact DescribeVpcs empty list as malformed unknown evidence', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const describeVpcs = jest.fn(async () => ({ Vpcs: [] }));
    const client = makeClient(fixture, { describeVpcs, matches: [] });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVpcResourceUnknownError);
    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVpcResourceUnknownError);
    expect(client.deleteVpc).not.toHaveBeenCalled();
  });

  it('blocks duplicate destroy evidence and never deletes unbound identities', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const duplicate = makeVpc(fixture, {
      VpcId: VPC_IDS.duplicate,
      CidrBlockAssociationSet: [
        {
          AssociationId: 'vpc-cidr-assoc-00000000000000002',
          CidrBlock: '10.42.0.0/16',
          CidrBlockState: { State: 'associated' },
        },
      ],
    });
    const describeVpcs = jest.fn(async (/** @type {AnyRecord} */ input) => {
      if (input.VpcIds) throw new Error('exact read must not run');
      return { Vpcs: [makeVpc(fixture), duplicate] };
    });
    const client = makeClient(fixture, { describeVpcs });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVpcResourceConflictError);
    expect(describeVpcs).toHaveBeenCalledTimes(2);
    expect(client.describeVpcAttribute).not.toHaveBeenCalled();
    expect(client.deleteVpc).not.toHaveBeenCalled();
  });

  it.each([undefined, null])(
    'blocks bound destroy with missing Tags evidence (%p)',
    async (tags) => {
      const fixture = makeFixture({ operation: 'destroy' });
      const client = makeClient(fixture, {
        matches: [makeVpc(fixture, { Tags: tags })],
      });
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'blocked',
        },
      );
      await expect(
        resource.executeAction(fixture.context),
      ).rejects.toBeInstanceOf(AwsSingleNodeVpcResourceConflictError);
      expect(client.describeVpcAttribute).not.toHaveBeenCalled();
      expect(client.deleteVpc).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a different owner account', { OwnerId: '999999999999' }],
    ['a default VPC identity', { IsDefault: true }],
    ['an impossible lifecycle state', { State: 'deleted' }],
  ])('blocks bound destroy with %s', async (_name, override) => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, {
      matches: [makeVpc(fixture, override)],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVpcResourceConflictError);
    expect(client.describeVpcAttribute).not.toHaveBeenCalled();
    expect(client.deleteVpc).not.toHaveBeenCalled();
  });

  it('blocks a sole unbound replacement and never deletes it', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const replacement = makeVpc(fixture, {
      VpcId: VPC_IDS.replacement,
      CidrBlockAssociationSet: [
        {
          AssociationId: 'vpc-cidr-assoc-00000000000000003',
          CidrBlock: '10.42.0.0/16',
          CidrBlockState: { State: 'associated' },
        },
      ],
    });
    const client = makeClient(fixture, {
      matches: [replacement],
      exact: [],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVpcResourceConflictError);
    expect(client.deleteVpc).not.toHaveBeenCalled();
  });

  it('blocks contradictory exact ownership even when logical discovery is empty', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const describeVpcs = jest.fn(async (/** @type {AnyRecord} */ input) => ({
      Vpcs: input.VpcIds ? [makeVpc(fixture, { OwnerId: '999999999999' })] : [],
    }));
    const client = makeClient(fixture, { describeVpcs });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVpcResourceConflictError);
    expect(client.deleteVpc).not.toHaveBeenCalled();
  });

  it.each(['DependencyViolation', 'IncorrectState'])(
    'keeps recoverable %s delete failures retryable',
    async (name) => {
      const fixture = makeFixture({ operation: 'destroy' });
      const providerError = Object.assign(new Error('delete-secret'), { name });
      const client = makeClient(fixture, {
        deleteVpc: jest.fn(async () => {
          throw providerError;
        }),
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();
      const settlement = await resource.verifySettlement(fixture.context);
      expect(settlement).toEqual({ status: 'not-converged' });
      expect(JSON.stringify(settlement)).not.toContain('delete-secret');
      expect(client.deleteVpc).toHaveBeenCalledTimes(1);
    },
  );

  it('maps unknown delete failures to a fixed non-echoing error', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, {
      deleteVpc: jest.fn(async () => {
        throw new Error('unknown-delete-secret');
      }),
    });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(AwsSingleNodeVpcResourceUnknownError);
    expect(JSON.stringify(observed)).not.toContain('unknown-delete-secret');
  });
});

describe('AWS single-node VPC controller authority and factory boundary', () => {
  it.each([
    [
      'extra key',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        extra: true,
      }),
      TypeError,
    ],
    [
      'missing artifact stage key',
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
      AwsSingleNodeVpcResourceConflictError,
    ],
    [
      'wrong index',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        actionIndex: 0,
      }),
      AwsSingleNodeVpcResourceConflictError,
    ],
    [
      'blocked operation',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        head: recreateHead(fixture, { status: 'blocked' }),
      }),
      AwsSingleNodeVpcResourceConflictError,
    ],
  ])(
    'rejects %s before any provider call',
    async (_name, mutate, ErrorType) => {
      const fixture = makeFixture();
      const client = makeClient(fixture, { matches: [] });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(mutate(fixture)),
      ).rejects.toBeInstanceOf(ErrorType);
      expect(client.createVpc).not.toHaveBeenCalled();
      expect(client.describeVpcs).not.toHaveBeenCalled();
      expect(client.describeVpcAttribute).not.toHaveBeenCalled();
      expect(client.deleteVpc).not.toHaveBeenCalled();
    },
  );

  it('accepts and ignores a non-null controller artifact receipt', async () => {
    const fixture = makeFixture();
    const context = {
      ...fixture.context,
      artifactStage: Object.freeze({ opaque: 'held-by-controller' }),
    };
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(resource.executeAction(context)).resolves.toBeUndefined();
    await expect(resource.verifySettlement(context)).resolves.toMatchObject({
      status: 'converged',
    });
    expect(client.createVpc).not.toHaveBeenCalled();
    expect(client.deleteVpc).not.toHaveBeenCalled();
  });

  it('returns only frozen controller ports and never closes the caller client', () => {
    const fixture = makeFixture();
    const client = {
      ...makeClient(fixture),
      close: jest.fn(),
    };
    const resource = createAwsSingleNodeVpcResource({
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

  it('rejects unsupported options, missing methods, invalid retry bounds, and bad scope', () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    expect(() =>
      createAwsSingleNodeVpcResource({
        client,
        providerScope: fixture.base.providerScope,
        unsupported: true,
      }),
    ).toThrow(TypeError);
    for (const method of [
      'createVpc',
      'describeVpcs',
      'describeVpcAttribute',
      'deleteVpc',
    ]) {
      expect(() =>
        createAwsSingleNodeVpcResource({
          client: { ...client, [method]: undefined },
          providerScope: fixture.base.providerScope,
        }),
      ).toThrow(TypeError);
    }
    for (const maxAttempts of [0, AWS_SINGLE_NODE_VPC_MAX_ATTEMPTS + 1, 1.5]) {
      expect(() =>
        createAwsSingleNodeVpcResource({
          client,
          providerScope: fixture.base.providerScope,
          maxAttempts,
        }),
      ).toThrow(TypeError);
    }
    expect(() =>
      createAwsSingleNodeVpcResource({
        client,
        providerScope: fixture.base.providerScope,
        waitForRetry: 'not-a-function',
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeVpcResource({ client, providerScope: {} }),
    ).toThrow(TypeError);
  });

  it('rejects malformed create result IDs without echoing provider data', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      matches: [],
      exact: [],
      createVpc: jest.fn(async () => ({
        Vpc: { VpcId: 'provider-secret-invalid' },
      })),
    });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(AwsSingleNodeVpcResourceUnknownError);
    expect(JSON.stringify(observed)).not.toContain('provider-secret-invalid');
  });
});
