import { describe, expect, it, jest } from '@jest/globals';

import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_INTERNET_GATEWAY_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_STATE_DIGEST_DOMAIN,
  AwsSingleNodeInternetGatewayResourceConflictError,
  AwsSingleNodeInternetGatewayResourceUnknownError,
  createAwsSingleNodeInternetGatewayResource,
  getAwsSingleNodeInternetGatewayStateDigest,
} from '../../src/core/runtime/deployment-aws-internet-gateway-resource.js';
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

const INTERNET_GATEWAY_IDS = Object.freeze({
  primary: 'igw-00000000000000001',
  duplicate: 'igw-00000000000000002',
  replacement: 'igw-00000000000000003',
});
const VPC_ID = 'vpc-00000000000000001';

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
    bootstrapDigest: digest('internet gateway test bootstrap'),
    runtimeIdentityPolicyDigest: digest(
      'internet gateway test runtime identity policy',
    ),
  });
}

/** @returns {Readonly<Record<string, any>>} */
function makeBase() {
  const profile = validateDeploymentProfile(
    createDeploymentProfile({
      profile: { id: 'production' },
      appId: 'internet-gateway-resource-test',
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
    revisionId: semanticId(
      'wrv1',
      'wharfie:test:internet-gateway-revision:v1',
      { revision: 1 },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'internet gateway resource artifact',
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
  if (definition.resourceKey === 'network-vpc') return VPC_ID;
  if (definition.resourceKey === 'network-internet-gateway') {
    return INTERNET_GATEWAY_IDS.primary;
  }
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
      definition.resourceKey === 'network-internet-gateway'
        ? getAwsSingleNodeInternetGatewayStateDigest(base.providerSpec)
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
        ...(definition.resourceKey === 'network-internet-gateway' &&
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
        inspectionId: semanticId(
          'win4',
          'wharfie:test:internet-gateway-inspection:v1',
          { operation },
        ),
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
      INTERNET_GATEWAY_IDS.primary,
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce: overrides.ownershipNonce ?? nonce(72),
    createdByActionId:
      overrides.createdByActionId ??
      semanticId('wda3', 'wharfie:test:internet-gateway-create-action:v1', {
        resourceKey: action.resourceKey,
      }),
  });
}

/** @param {{operation?: 'apply'|'reconcile'|'destroy', observedStateDigest?: Readonly<Record<string, any>>, ownershipNonceByte?: number}} [options] */
function makeFixture(options = {}) {
  const operation = options.operation ?? 'apply';
  const base = makeBase();
  const plan = makePlan(base, operation, options);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'network-internet-gateway',
  );
  const action = plan.actions[actionIndex];
  if (action === undefined) {
    throw new Error('Missing network-internet-gateway action.');
  }
  const ownershipNonce = nonce(options.ownershipNonceByte ?? 72);
  const priorBinding =
    action.action === 'create'
      ? null
      : makeBinding(base, action, { ownershipNonce });
  const resourceBindings = priorBinding === null ? [] : [priorBinding];
  /** @type {AnyRecord|null} */
  let lastOperation = null;
  if (operation !== 'apply') {
    if (priorBinding === null) {
      throw new Error('Missing existing internet gateway binding.');
    }
    lastOperation = {
      kind: 'create',
      planId: semanticId('wpl3', 'wharfie:test:internet-gateway-last-plan:v1', {
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
    'wharfie:resource-kind': 'single-node-internet-gateway',
    'wharfie:retention': 'purge',
    'wharfie:schema-version': '2',
    'wharfie:capability': 'networking',
    'wharfie:role': 'internet-gateway',
    'wharfie:provider-scope-id': fixture.base.providerScope.providerScopeId,
    'wharfie:deployment-instance-id': fixture.base.deploymentInstanceId,
    'wharfie:incarnation-id': fixture.base.incarnationId,
    'wharfie:resource-key': 'network-internet-gateway',
    'wharfie:created-by-action-id':
      fixture.priorBinding?.createdByActionId ?? fixture.action.actionId,
    'wharfie:ownership-nonce': fixture.ownershipNonce,
    'wharfie:state-digest': getAwsSingleNodeInternetGatewayStateDigest(
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
function makeInternetGateway(fixture, overrides = {}) {
  return {
    Attachments: [],
    InternetGatewayId: INTERNET_GATEWAY_IDS.primary,
    OwnerId: fixture.base.providerScope.accountId,
    Tags: tagArray(expectedTags(fixture)),
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makeClient(fixture, options = {}) {
  const matches = options.matches ?? [makeInternetGateway(fixture)];
  const exact = options.exact ?? matches;
  return Object.freeze({
    createInternetGateway:
      options.createInternetGateway ??
      jest.fn(async () => ({
        InternetGateway: {
          InternetGatewayId: INTERNET_GATEWAY_IDS.primary,
        },
      })),
    describeInternetGateways:
      options.describeInternetGateways ??
      jest.fn(async (/** @type {AnyRecord} */ input) => ({
        InternetGateways: input.InternetGatewayIds
          ? exact.filter((/** @type {AnyRecord} */ internetGateway) =>
              input.InternetGatewayIds.includes(
                internetGateway.InternetGatewayId,
              ),
            )
          : matches,
      })),
    deleteInternetGateway:
      options.deleteInternetGateway ?? jest.fn(async () => ({})),
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makePorts(fixture, options = {}) {
  const client = options.client ?? makeClient(fixture, options);
  const waitForRetry = options.waitForRetry ?? jest.fn();
  return {
    client,
    waitForRetry,
    resource: createAwsSingleNodeInternetGatewayResource({
      client,
      providerScope: fixture.base.providerScope,
      maxAttempts: options.maxAttempts ?? 1,
      waitForRetry,
    }),
  };
}

describe('AWS single-node internet gateway state digest', () => {
  it('is deterministic, domain separated, frozen, and excludes attachment state', () => {
    const base = makeBase();
    const first = getAwsSingleNodeInternetGatewayStateDigest(base.providerSpec);
    const second = getAwsSingleNodeInternetGatewayStateDigest(
      base.providerSpec,
    );

    expect(first).toEqual(second);
    expect(first.algorithm).toBe('sha256');
    expect(first.value).toHaveLength(43);
    expect(Object.isFrozen(first)).toBe(true);
    expect(AWS_SINGLE_NODE_INTERNET_GATEWAY_STATE_DIGEST_DOMAIN).toBe(
      'wharfie:aws-single-node-ec2-internet-gateway-state:v1',
    );
    expect(first.value).toBe(
      sha256Base64Url(
        `${AWS_SINGLE_NODE_INTERNET_GATEWAY_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
          sortCanonicalJsonValue({
            schemaVersion: 1,
            kind: 'awsSingleNodeEc2InternetGatewayState',
            onDestroy: 'purge',
          }),
        )}`,
      ),
    );
    expect(JSON.stringify(first)).not.toContain('attachment');
    expect(JSON.stringify(first)).not.toContain(VPC_ID);
  });

  it('rejects malformed and noncanonical provider specifications', () => {
    expect(() => getAwsSingleNodeInternetGatewayStateDigest({})).toThrow(
      TypeError,
    );
    const base = makeBase();
    const changed = JSON.parse(JSON.stringify(base.providerSpec));
    changed.capabilities.networking.vpcCidr = '10.99.0.0/16';
    expect(() => getAwsSingleNodeInternetGatewayStateDigest(changed)).toThrow(
      TypeError,
    );
  });
});

describe('AWS single-node internet gateway create and recovery', () => {
  it('submits one exact frozen create request with atomic ownership tags', async () => {
    const fixture = makeFixture();
    const createInternetGateway = jest.fn(
      async (/** @type {AnyRecord} */ _input) => ({
        InternetGateway: {
          InternetGatewayId: INTERNET_GATEWAY_IDS.primary,
        },
      }),
    );
    const client = makeClient(fixture, {
      matches: [],
      exact: [],
      createInternetGateway,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);

    expect(createInternetGateway).toHaveBeenCalledTimes(1);
    const request = createInternetGateway.mock.calls[0][0];
    expect(request).toEqual({
      TagSpecifications: [
        {
          ResourceType: 'internet-gateway',
          Tags: tagArray(expectedTags(fixture)),
        },
      ],
    });
    expect(request).not.toHaveProperty('ClientToken');
    expectDeepFrozen(request);
    expect(client.deleteInternetGateway).not.toHaveBeenCalled();
  });

  it('settles a candidate only after matching broad and exact readback', async () => {
    const fixture = makeFixture();
    const internetGateway = makeInternetGateway(fixture, {
      Attachments: [{ State: 'available', VpcId: VPC_ID }],
    });
    const client = makeClient(fixture, { matches: [], exact: [] });
    const { resource } = makePorts(fixture, { client });
    await resource.executeAction(fixture.context);
    client.describeInternetGateways.mockImplementation(
      async (/** @type {AnyRecord} */ _input) => ({
        InternetGateways: [internetGateway],
      }),
    );

    const settlement = await resource.verifySettlement(fixture.context);

    expect(settlement).toMatchObject({
      status: 'converged',
      binding: {
        resourceKey: 'network-internet-gateway',
        providerType: 'ec2-internet-gateway',
        providerResourceId: INTERNET_GATEWAY_IDS.primary,
        management: 'managed',
        ownershipMode: 'direct',
        onDestroy: 'purge',
        dependencyBindings: [],
        ownershipNonce: fixture.ownershipNonce,
        createdByActionId: fixture.action.actionId,
      },
    });
    expect(client.describeInternetGateways).toHaveBeenCalledTimes(3);
    expect(client.describeInternetGateways.mock.calls[2][0]).toEqual({
      InternetGatewayIds: [INTERNET_GATEWAY_IDS.primary],
    });
    expectDeepFrozen(settlement);
  });

  it('recovers a lost response in a fresh factory with corroborated discovery', async () => {
    const fixture = makeFixture();
    const firstClient = makeClient(fixture, {
      matches: [],
      exact: [],
      createInternetGateway: jest.fn(async () => {
        throw new Error('secret ambiguous response');
      }),
    });
    const first = makePorts(fixture, { client: firstClient }).resource;
    await expect(first.executeAction(fixture.context)).rejects.toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeInternetGatewayResourceUnknownError',
        message: 'AWS single-node internet gateway resource state is unknown.',
      }),
    );

    const recovered = makeInternetGateway(fixture);
    const secondClient = makeClient(fixture, {
      matches: [recovered],
      exact: [recovered],
    });
    const second = makePorts(fixture, { client: secondClient }).resource;
    const settlement = await second.verifySettlement(fixture.context);

    expect(settlement.status).toBe('converged');
    expect(settlement.binding.providerResourceId).toBe(
      INTERNET_GATEWAY_IDS.primary,
    );
    expect(secondClient.createInternetGateway).not.toHaveBeenCalled();
    expect(secondClient.describeInternetGateways).toHaveBeenCalledTimes(2);
    const discovery = secondClient.describeInternetGateways.mock.calls[0][0];
    expect(discovery).toMatchObject({
      MaxResults: AWS_SINGLE_NODE_INTERNET_GATEWAY_DISCOVERY_MAX_RESULTS,
      Filters: expect.arrayContaining([
        {
          Name: 'tag:wharfie:resource-key',
          Values: ['network-internet-gateway'],
        },
        {
          Name: 'tag:wharfie:incarnation-id',
          Values: [fixture.base.incarnationId],
        },
      ]),
    });
    expect(discovery.Filters).toHaveLength(8);
    expect(discovery.Filters).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Name: 'tag:wharfie:ownership-nonce',
        }),
      ]),
    );
    expectDeepFrozen(discovery);
    expect(JSON.stringify(settlement)).not.toContain(
      'secret ambiguous response',
    );
  });

  it('never replays a throwing or malformed create attempt in one factory', async () => {
    const fixture = makeFixture();
    const throwingCreate = jest.fn(async () => {
      throw new Error('ambiguous-create-secret');
    });
    const throwingClient = makeClient(fixture, {
      matches: [],
      exact: [],
      createInternetGateway: throwingCreate,
    });
    const throwingResource = makePorts(fixture, {
      client: throwingClient,
    }).resource;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        throwingResource.executeAction(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeInternetGatewayResourceUnknownError,
      );
    }
    expect(throwingCreate).toHaveBeenCalledTimes(1);

    const malformedCreate = jest.fn(async () => ({ InternetGateway: {} }));
    const malformedClient = makeClient(fixture, {
      matches: [],
      exact: [],
      createInternetGateway: malformedCreate,
    });
    const malformedResource = makePorts(fixture, {
      client: malformedClient,
    }).resource;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        malformedResource.executeAction(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeInternetGatewayResourceUnknownError,
      );
    }
    expect(malformedCreate).toHaveBeenCalledTimes(1);
  });

  it('authorizes a new attempted effect when durable ownership advances to a new nonce', async () => {
    const firstFixture = makeFixture({ ownershipNonceByte: 72 });
    const secondFixture = makeFixture({ ownershipNonceByte: 73 });
    expect(firstFixture.action.actionId).toBe(secondFixture.action.actionId);
    const createInternetGateway = jest.fn(
      async (/** @type {AnyRecord} */ _request) => {
        throw new Error('ambiguous-create');
      },
    );
    const client = makeClient(firstFixture, {
      matches: [],
      exact: [],
      createInternetGateway,
    });
    const { resource } = makePorts(firstFixture, { client });

    await expect(
      resource.executeAction(firstFixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInternetGatewayResourceUnknownError);
    await expect(
      resource.executeAction(secondFixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInternetGatewayResourceUnknownError);

    expect(createInternetGateway).toHaveBeenCalledTimes(2);
    const observedNonces = createInternetGateway.mock.calls.map(
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

  it('preflights a corroborated discovered effect without creating', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);

    expect(client.describeInternetGateways).toHaveBeenCalledTimes(2);
    expect(client.createInternetGateway).not.toHaveBeenCalled();
    expect(client.deleteInternetGateway).not.toHaveBeenCalled();
  });

  it('blocks duplicate discovery without destructive compaction', async () => {
    const fixture = makeFixture();
    const duplicate = makeInternetGateway(fixture, {
      InternetGatewayId: INTERNET_GATEWAY_IDS.duplicate,
    });
    const client = makeClient(fixture, {
      matches: [makeInternetGateway(fixture), duplicate],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInternetGatewayResourceConflictError);
    expect(client.createInternetGateway).not.toHaveBeenCalled();
    expect(client.deleteInternetGateway).not.toHaveBeenCalled();
  });

  it('keeps one-sided candidate visibility unresolved', async () => {
    const fixture = makeFixture();
    const internetGateway = makeInternetGateway(fixture);
    const client = makeClient(fixture, { matches: [], exact: [] });
    const { resource } = makePorts(fixture, { client });
    await resource.executeAction(fixture.context);
    client.describeInternetGateways.mockImplementation(
      async (/** @type {AnyRecord} */ input) => {
        if (!input.InternetGatewayIds) {
          return { InternetGateways: [internetGateway] };
        }
        const error = new Error('not found');
        error.name = 'InvalidInternetGatewayID.NotFound';
        throw error;
      },
    );

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(client.createInternetGateway).toHaveBeenCalledTimes(1);
  });

  it('classifies a wrong owner before one-sided visibility', async () => {
    const fixture = makeFixture();
    const wrongOwner = makeInternetGateway(fixture, {
      OwnerId: '999999999999',
    });
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) => {
        if (!input.InternetGatewayIds) {
          return { InternetGateways: [wrongOwner] };
        }
        const error = new Error('not found');
        error.name = 'InvalidInternetGatewayID.NotFound';
        throw error;
      },
    );
    const client = makeClient(fixture, { describeInternetGateways });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('treats successful exact empty arrays and malformed reads as unknown', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      matches: [makeInternetGateway(fixture)],
      exact: [],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInternetGatewayResourceUnknownError);
    expect(client.createInternetGateway).not.toHaveBeenCalled();

    client.describeInternetGateways.mockResolvedValue({});
    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInternetGatewayResourceUnknownError);
  });
});

describe('AWS single-node internet gateway evidence and noop', () => {
  it('accepts an attached gateway on create because attachment is another role', async () => {
    const fixture = makeFixture();
    const internetGateway = makeInternetGateway(fixture, {
      Attachments: [{ State: 'available', VpcId: VPC_ID }],
    });
    const client = makeClient(fixture, {
      matches: [internetGateway],
      exact: [internetGateway],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(client.createInternetGateway).not.toHaveBeenCalled();
    expect(client.deleteInternetGateway).not.toHaveBeenCalled();
  });

  it('accepts an attached gateway on noop and preserves its binding', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const internetGateway = makeInternetGateway(fixture, {
      Attachments: [{ State: 'available', VpcId: VPC_ID }],
    });
    const client = makeClient(fixture, {
      matches: [internetGateway],
      exact: [internetGateway],
    });
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
      fixture.priorBinding?.createdByActionId,
    );
    expect(client.createInternetGateway).not.toHaveBeenCalled();
    expect(client.deleteInternetGateway).not.toHaveBeenCalled();
  });

  it('does not inspect malformed attachment relationship data on create or noop', async () => {
    const operations = /** @type {const} */ (['apply', 'reconcile']);
    for (const operation of operations) {
      const fixture = makeFixture({ operation });
      const internetGateway = makeInternetGateway(fixture, {
        Attachments: { secret: 'owned by attachment role' },
      });
      const client = makeClient(fixture, {
        matches: [internetGateway],
        exact: [internetGateway],
      });
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        expect.objectContaining({ status: 'converged' }),
      );
      expect(client.createInternetGateway).not.toHaveBeenCalled();
      expect(client.deleteInternetGateway).not.toHaveBeenCalled();
    }
  });

  it('treats missing create tags as propagation but conflicting tags as blocked', async () => {
    const fixture = makeFixture();
    const incompleteTags = expectedTags(fixture);
    delete incompleteTags['wharfie:ownership-nonce'];
    const incomplete = makeInternetGateway(fixture, {
      Tags: tagArray(incompleteTags),
    });
    const incompleteClient = makeClient(fixture, {
      matches: [incomplete],
      exact: [incomplete],
    });
    const incompleteResource = makePorts(fixture, {
      client: incompleteClient,
    }).resource;
    await expect(
      incompleteResource.verifySettlement(fixture.context),
    ).resolves.toEqual({ status: 'not-converged' });
    await expect(
      incompleteResource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInternetGatewayResourceUnknownError);
    expect(incompleteClient.createInternetGateway).not.toHaveBeenCalled();

    const conflictingTags = expectedTags(fixture);
    conflictingTags['wharfie:ownership-nonce'] = nonce(99);
    const conflicting = makeInternetGateway(fixture, {
      Tags: tagArray(conflictingTags),
    });
    const conflictingClient = makeClient(fixture, {
      matches: [conflicting],
      exact: [conflicting],
    });
    const conflictingResource = makePorts(fixture, {
      client: conflictingClient,
    }).resource;
    await expect(
      conflictingResource.verifySettlement(fixture.context),
    ).resolves.toEqual({ status: 'blocked' });
  });

  it('blocks incomplete noop tags and a foreign owner', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const incompleteTags = expectedTags(fixture);
    delete incompleteTags['wharfie:state-digest'];
    const incomplete = makeInternetGateway(fixture, {
      Tags: tagArray(incompleteTags),
    });
    const incompleteResource = makePorts(fixture, {
      matches: [incomplete],
      exact: [incomplete],
    }).resource;
    await expect(
      incompleteResource.verifySettlement(fixture.context),
    ).resolves.toEqual({ status: 'blocked' });

    const foreign = makeInternetGateway(fixture, {
      OwnerId: '999999999999',
    });
    const foreignResource = makePorts(fixture, {
      matches: [foreign],
      exact: [foreign],
    }).resource;
    await expect(
      foreignResource.verifySettlement(fixture.context),
    ).resolves.toEqual({ status: 'blocked' });
  });

  it('rejects malformed tag structures as unknown without echoing provider data', async () => {
    const fixture = makeFixture();
    const malformed = makeInternetGateway(fixture, {
      Tags: [{ Key: 'wharfie:managed-by', Value: { secret: 'do-not-echo' } }],
    });
    const client = makeClient(fixture, {
      matches: [malformed],
      exact: [malformed],
    });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeInternetGatewayResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('do-not-echo');
  });

  it('blocks a different broad ID from the bound noop identity', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const replacement = makeInternetGateway(fixture, {
      InternetGatewayId: INTERNET_GATEWAY_IDS.replacement,
    });
    const client = makeClient(fixture, {
      matches: [replacement],
      exact: [makeInternetGateway(fixture)],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('retries transient one-sided noop visibility but blocks complete absence', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const internetGateway = makeInternetGateway(fixture);
    const waitForRetry = jest.fn();
    let broadReads = 0;
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) => {
        if (input.InternetGatewayIds) {
          return { InternetGateways: [internetGateway] };
        }
        broadReads += 1;
        return { InternetGateways: broadReads === 1 ? [] : [internetGateway] };
      },
    );
    const client = makeClient(fixture, { describeInternetGateways });
    const { resource } = makePorts(fixture, {
      client,
      maxAttempts: 2,
      waitForRetry,
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: fixture.priorBinding,
    });
    expect(waitForRetry).toHaveBeenCalledTimes(1);
    expect(waitForRetry).toHaveBeenCalledWith(1);

    const absentDescribe = jest.fn(async (/** @type {AnyRecord} */ input) => {
      if (!input.InternetGatewayIds) return { InternetGateways: [] };
      const error = new Error('gone');
      error.name = 'InvalidInternetGatewayID.NotFound';
      throw error;
    });
    const absentClient = makeClient(fixture, {
      describeInternetGateways: absentDescribe,
    });
    const absent = makePorts(fixture, { client: absentClient }).resource;
    await expect(absent.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });
});

describe('AWS single-node internet gateway destroy', () => {
  it('deletes only the exact bound owned gateway when both reads are detached', async () => {
    const fixture = makeFixture({
      operation: 'destroy',
      observedStateDigest: digest('observed internet gateway state'),
    });
    const internetGateway = makeInternetGateway(fixture, { Attachments: [] });
    const deleteInternetGateway = jest.fn(
      async (/** @type {AnyRecord} */ _input) => ({}),
    );
    const client = makeClient(fixture, {
      matches: [internetGateway],
      exact: [internetGateway],
      deleteInternetGateway,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);

    expect(deleteInternetGateway).toHaveBeenCalledTimes(1);
    expect(deleteInternetGateway).toHaveBeenCalledWith({
      InternetGatewayId: INTERNET_GATEWAY_IDS.primary,
    });
    expectDeepFrozen(deleteInternetGateway.mock.calls[0][0]);
    expect(client.createInternetGateway).not.toHaveBeenCalled();
  });

  it('fences documented available attachments without deleting', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const attached = makeInternetGateway(fixture, {
      Attachments: [{ State: 'available', VpcId: VPC_ID }],
    });
    const client = makeClient(fixture, {
      matches: [attached],
      exact: [attached],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(client.deleteInternetGateway).not.toHaveBeenCalled();
  });

  it('requires empty attachments in both independent views', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const broad = makeInternetGateway(fixture, { Attachments: [] });
    const exact = makeInternetGateway(fixture, {
      Attachments: [{ State: 'attached', VpcId: VPC_ID }],
    });
    const client = makeClient(fixture, {
      matches: [broad],
      exact: [exact],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(client.deleteInternetGateway).not.toHaveBeenCalled();
  });

  it('does not let a broad attachment hide an exact owner conflict', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const broad = makeInternetGateway(fixture, {
      Attachments: [{ State: 'available', VpcId: VPC_ID }],
    });
    const exact = makeInternetGateway(fixture, {
      Attachments: [],
      OwnerId: '999999999999',
    });
    const client = makeClient(fixture, {
      matches: [broad],
      exact: [exact],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInternetGatewayResourceConflictError);
    expect(client.deleteInternetGateway).not.toHaveBeenCalled();
  });

  it('does not let a broad attachment hide malformed exact attachments', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const broad = makeInternetGateway(fixture, {
      Attachments: [{ State: 'available', VpcId: VPC_ID }],
    });
    const exact = makeInternetGateway(fixture, { Attachments: null });
    const client = makeClient(fixture, {
      matches: [broad],
      exact: [exact],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInternetGatewayResourceUnknownError);
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInternetGatewayResourceUnknownError);
    expect(client.deleteInternetGateway).not.toHaveBeenCalled();
  });

  it.each([undefined, null, {}, 'attached'])(
    'treats malformed delete Attachments %p as unknown',
    async (attachments) => {
      const fixture = makeFixture({ operation: 'destroy' });
      const malformed = makeInternetGateway(fixture, {
        Attachments: attachments,
      });
      const client = makeClient(fixture, {
        matches: [malformed],
        exact: [malformed],
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.verifySettlement(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeInternetGatewayResourceUnknownError,
      );
      expect(client.deleteInternetGateway).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{}],
    [{ State: 'mystery', VpcId: VPC_ID }],
    [{ State: 'available', VpcId: 'not-a-vpc' }],
  ])('treats malformed attachment entries as unknown', async (attachments) => {
    const fixture = makeFixture({ operation: 'destroy' });
    const malformed = makeInternetGateway(fixture, {
      Attachments: attachments,
    });
    const client = makeClient(fixture, {
      matches: [malformed],
      exact: [malformed],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInternetGatewayResourceUnknownError);
    expect(client.deleteInternetGateway).not.toHaveBeenCalled();
  });

  it('validates exact-only malformed attachments before visibility classification', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const exact = makeInternetGateway(fixture, { Attachments: null });
    const client = makeClient(fixture, {
      matches: [],
      exact: [exact],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInternetGatewayResourceUnknownError);
    expect(client.deleteInternetGateway).not.toHaveBeenCalled();
  });

  it('converges deletion only from named not-found plus empty discovery', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) => {
        if (!input.InternetGatewayIds) return { InternetGateways: [] };
        const error = new Error('provider detail');
        error.name = 'InvalidInternetGatewayID.NotFound';
        throw error;
      },
    );
    const client = makeClient(fixture, { describeInternetGateways });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(client.deleteInternetGateway).not.toHaveBeenCalled();
  });

  it('does not accept successful exact empty arrays as absence', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, { matches: [], exact: [] });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInternetGatewayResourceUnknownError);
    expect(client.deleteInternetGateway).not.toHaveBeenCalled();
  });

  it('keeps a successful delete unsettled until both reads prove absence', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const internetGateway = makeInternetGateway(fixture);
    let deleted = false;
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) => {
        if (!deleted) return { InternetGateways: [internetGateway] };
        if (!input.InternetGatewayIds) return { InternetGateways: [] };
        const error = new Error('gone');
        error.name = 'InvalidInternetGatewayID.NotFound';
        throw error;
      },
    );
    const deleteInternetGateway = jest.fn(async () => {
      deleted = true;
      return {};
    });
    const client = makeClient(fixture, {
      describeInternetGateways,
      deleteInternetGateway,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(deleteInternetGateway).toHaveBeenCalledTimes(1);
  });

  it.each(['DependencyViolation', 'IncorrectState'])(
    'treats %s delete failure as recoverable',
    async (name) => {
      const fixture = makeFixture({ operation: 'destroy' });
      const internetGateway = makeInternetGateway(fixture);
      const error = new Error('provider-secret');
      error.name = name;
      const deleteInternetGateway = jest.fn(async () => {
        throw error;
      });
      const client = makeClient(fixture, {
        matches: [internetGateway],
        exact: [internetGateway],
        deleteInternetGateway,
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();
      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        { status: 'not-converged' },
      );
      expect(deleteInternetGateway).toHaveBeenCalledTimes(1);
    },
  );

  it('treats a named delete not-found as a mutation no-op without claiming settlement', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const error = new Error('delete-not-found');
    error.name = 'InvalidInternetGatewayID.NotFound';
    const deleteInternetGateway = jest.fn(async () => {
      throw error;
    });
    const client = makeClient(fixture, { deleteInternetGateway });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(deleteInternetGateway).toHaveBeenCalledTimes(1);
  });

  it('sanitizes an unknown delete failure', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const providerError = new Error('delete-provider-secret');
    const deleteInternetGateway = jest.fn(async () => {
      throw providerError;
    });
    const client = makeClient(fixture, { deleteInternetGateway });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeInternetGatewayResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('delete-provider-secret');
  });

  it('blocks duplicates and an unbound replacement before delete', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const primary = makeInternetGateway(fixture);
    const duplicate = makeInternetGateway(fixture, {
      InternetGatewayId: INTERNET_GATEWAY_IDS.duplicate,
    });
    const duplicatePorts = makePorts(fixture, {
      matches: [primary, duplicate],
      exact: [primary],
    });
    await expect(
      duplicatePorts.resource.verifySettlement(fixture.context),
    ).resolves.toEqual({ status: 'blocked' });
    expect(duplicatePorts.client.deleteInternetGateway).not.toHaveBeenCalled();

    const replacement = makeInternetGateway(fixture, {
      InternetGatewayId: INTERNET_GATEWAY_IDS.replacement,
    });
    const replacementPorts = makePorts(fixture, {
      matches: [replacement],
      exact: [primary],
    });
    await expect(
      replacementPorts.resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInternetGatewayResourceConflictError);
    expect(
      replacementPorts.client.deleteInternetGateway,
    ).not.toHaveBeenCalled();
  });
});

describe('AWS single-node internet gateway pagination and retry bounds', () => {
  it('follows bounded frozen discovery pages', async () => {
    const fixture = makeFixture();
    const internetGateway = makeInternetGateway(fixture);
    let page = 0;
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) => {
        if (input.InternetGatewayIds) {
          return { InternetGateways: [internetGateway] };
        }
        page += 1;
        return page === 1
          ? { InternetGateways: [], NextToken: 'next' }
          : { InternetGateways: [internetGateway] };
      },
    );
    const client = makeClient(fixture, { describeInternetGateways });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(describeInternetGateways.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        NextToken: 'next',
        MaxResults: AWS_SINGLE_NODE_INTERNET_GATEWAY_DISCOVERY_MAX_RESULTS,
      }),
    );
    expectDeepFrozen(describeInternetGateways.mock.calls[1][0]);
  });

  it('rejects repeated tokens and the maximum-page continuation', async () => {
    const fixture = makeFixture();
    let client = makeClient(fixture, {
      describeInternetGateways: jest.fn(async () => ({
        InternetGateways: [],
        NextToken: 'same',
      })),
    });
    let resource = makePorts(fixture, { client }).resource;
    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInternetGatewayResourceUnknownError);

    let page = 0;
    const describeInternetGateways = jest.fn(async () => {
      page += 1;
      return { InternetGateways: [], NextToken: `page-${page}` };
    });
    client = makeClient(fixture, { describeInternetGateways });
    resource = makePorts(fixture, { client }).resource;
    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInternetGatewayResourceUnknownError);
    expect(describeInternetGateways).toHaveBeenCalledTimes(
      AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_DISCOVERY_PAGES,
    );
  });

  it('rejects malformed page tokens, duplicate IDs across pages, and exact pagination', async () => {
    const fixture = makeFixture();
    for (const NextToken of ['', 1, {}]) {
      const malformedClient = makeClient(fixture, {
        describeInternetGateways: jest.fn(async () => ({
          InternetGateways: [],
          NextToken,
        })),
      });
      const malformed = makePorts(fixture, {
        client: malformedClient,
      }).resource;
      await expect(
        malformed.verifySettlement(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeInternetGatewayResourceUnknownError,
      );
    }

    const internetGateway = makeInternetGateway(fixture);
    let page = 0;
    const duplicateClient = makeClient(fixture, {
      describeInternetGateways: jest.fn(async () => {
        page += 1;
        return page === 1
          ? { InternetGateways: [internetGateway], NextToken: 'next' }
          : { InternetGateways: [internetGateway] };
      }),
    });
    const duplicate = makePorts(fixture, {
      client: duplicateClient,
    }).resource;
    await expect(duplicate.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });

    const exactPaginationClient = makeClient(fixture, {
      describeInternetGateways: jest.fn(
        async (/** @type {AnyRecord} */ input) =>
          input.InternetGatewayIds
            ? { InternetGateways: [internetGateway], NextToken: 'impossible' }
            : { InternetGateways: [internetGateway] },
      ),
    });
    const exactPagination = makePorts(fixture, {
      client: exactPaginationClient,
    }).resource;
    await expect(
      exactPagination.verifySettlement(fixture.context),
    ).resolves.toEqual({ status: 'blocked' });
  });

  it('maps provider and waiter failures to fixed unknown state', async () => {
    const fixture = makeFixture();
    const providerClient = makeClient(fixture, {
      describeInternetGateways: jest.fn(async () => {
        throw new Error('describe-provider-secret');
      }),
    });
    const providerResource = makePorts(fixture, {
      client: providerClient,
    }).resource;
    let observed = await providerResource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeInternetGatewayResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('describe-provider-secret');

    const absentClient = makeClient(fixture, { matches: [], exact: [] });
    const waiterResource = makePorts(fixture, {
      client: absentClient,
      maxAttempts: 2,
      waitForRetry: jest.fn(async () => {
        throw new Error('wait-secret');
      }),
    }).resource;
    observed = await waiterResource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeInternetGatewayResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('wait-secret');
  });

  it('exports explicit retry and discovery bounds', () => {
    expect(AWS_SINGLE_NODE_INTERNET_GATEWAY_DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_ATTEMPTS).toBe(10);
    expect(AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_DISCOVERY_PAGES).toBe(16);
    expect(AWS_SINGLE_NODE_INTERNET_GATEWAY_DISCOVERY_MAX_RESULTS).toBe(100);
  });
});

describe('AWS single-node internet gateway controller authority', () => {
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
      AwsSingleNodeInternetGatewayResourceConflictError,
    ],
    [
      'wrong index',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        actionIndex: 0,
      }),
      AwsSingleNodeInternetGatewayResourceConflictError,
    ],
    [
      'blocked operation',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        head: recreateHead(fixture, { status: 'blocked' }),
      }),
      AwsSingleNodeInternetGatewayResourceConflictError,
    ],
  ])(
    'rejects %s before any provider call',
    async (_name, mutate, ErrorType) => {
      const fixture = makeFixture();
      const client = makeClient(fixture, { matches: [], exact: [] });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(mutate(fixture)),
      ).rejects.toBeInstanceOf(ErrorType);
      expect(client.createInternetGateway).not.toHaveBeenCalled();
      expect(client.describeInternetGateways).not.toHaveBeenCalled();
      expect(client.deleteInternetGateway).not.toHaveBeenCalled();
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
    await expect(resource.verifySettlement(context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(client.createInternetGateway).not.toHaveBeenCalled();
    expect(client.deleteInternetGateway).not.toHaveBeenCalled();
  });

  it('returns only frozen ports and never closes the caller client', () => {
    const fixture = makeFixture();
    const client = { ...makeClient(fixture), close: jest.fn() };
    const resource = createAwsSingleNodeInternetGatewayResource({
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

  it('rejects unsupported options, incomplete clients, retry bounds, and bad scope', () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    expect(() =>
      createAwsSingleNodeInternetGatewayResource({
        client,
        providerScope: fixture.base.providerScope,
        unsupported: true,
      }),
    ).toThrow(TypeError);
    for (const method of [
      'createInternetGateway',
      'describeInternetGateways',
      'deleteInternetGateway',
    ]) {
      expect(() =>
        createAwsSingleNodeInternetGatewayResource({
          client: { ...client, [method]: undefined },
          providerScope: fixture.base.providerScope,
        }),
      ).toThrow(TypeError);
    }
    for (const maxAttempts of [
      0,
      AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_ATTEMPTS + 1,
      1.5,
    ]) {
      expect(() =>
        createAwsSingleNodeInternetGatewayResource({
          client,
          providerScope: fixture.base.providerScope,
          maxAttempts,
        }),
      ).toThrow(TypeError);
    }
    expect(() =>
      createAwsSingleNodeInternetGatewayResource({
        client,
        providerScope: fixture.base.providerScope,
        waitForRetry: 'not-a-function',
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeInternetGatewayResource({ client, providerScope: {} }),
    ).toThrow(TypeError);
  });

  it('rejects malformed create IDs without echoing provider data', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      matches: [],
      exact: [],
      createInternetGateway: jest.fn(async () => ({
        InternetGateway: {
          InternetGatewayId: 'provider-secret-invalid',
        },
      })),
    });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeInternetGatewayResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('provider-secret-invalid');
  });
});
