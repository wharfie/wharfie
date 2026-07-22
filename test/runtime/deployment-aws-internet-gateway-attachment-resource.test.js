import { describe, expect, it, jest } from '@jest/globals';

import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_STATE_DIGEST_DOMAIN,
  AwsSingleNodeInternetGatewayAttachmentResourceConflictError,
  AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
  createAwsSingleNodeInternetGatewayAttachmentResource,
  getAwsSingleNodeInternetGatewayAttachmentStateDigest,
} from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource.js';
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
  other: 'igw-00000000000000002',
  third: 'igw-00000000000000003',
});
const VPC_IDS = Object.freeze({
  primary: 'vpc-00000000000000001',
  other: 'vpc-00000000000000002',
});

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

/** @param {string} internetGatewayId @param {string} vpcId @returns {string} */
function attachmentProviderResourceId(internetGatewayId, vpcId) {
  return createCanonicalJsonSha256Id({
    prefix:
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
    domain:
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
    value: { internetGatewayId, vpcId },
  });
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
    },
    placement: { availabilityZoneId: 'use1-az1' },
    storage: {
      ebsKmsKeyArn:
        'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    },
    bootstrapDigest: digest('attachment test bootstrap'),
  });
}

/** @param {{imageId?: string}} [options] @returns {Readonly<Record<string, any>>} */
function makeBase(options = {}) {
  const profile = validateDeploymentProfile(
    createDeploymentProfile({
      profile: { id: 'production' },
      appId: 'internet-gateway-attachment-resource-test',
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
      'wharfie:test:internet-gateway-attachment-revision:v1',
      { revision: 1 },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'internet gateway attachment resource artifact',
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
    return INTERNET_GATEWAY_IDS.primary;
  }
  if (definition.resourceKey === 'network-internet-gateway-attachment') {
    return attachmentProviderResourceId(
      INTERNET_GATEWAY_IDS.primary,
      VPC_IDS.primary,
    );
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
      definition.resourceKey === 'network-internet-gateway-attachment'
        ? getAwsSingleNodeInternetGatewayAttachmentStateDigest(
            base.providerSpec,
          )
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
        ...(definition.resourceKey === 'network-internet-gateway-attachment' &&
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
          'win5',
          'wharfie:test:internet-gateway-attachment-inspection:v1',
          { operation },
        ),
      },
      actions,
    },
    { profile: base.profile },
  );
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} action @param {Record<string, any>} options */
function makeDirectBinding(base, action, options) {
  return createDeploymentResourceBinding({
    schemaVersion: 2,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    resourceKey: action.resourceKey,
    capability: action.capability,
    role: action.role,
    management: 'managed',
    ownershipMode: 'direct',
    onDestroy: action.onDestroy,
    dependencyBindings: [],
    providerType: action.before?.providerType ?? action.after.providerType,
    providerResourceId: options.providerResourceId,
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce: options.ownershipNonce,
    createdByActionId: options.createdByActionId,
  });
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>[]} dependencies @param {Record<string, any>} options */
function makeAttachmentBinding(base, action, dependencies, options) {
  return createDeploymentResourceBinding({
    schemaVersion: 2,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    resourceKey: action.resourceKey,
    capability: action.capability,
    role: action.role,
    management: 'managed',
    ownershipMode: 'derived',
    onDestroy: 'purge',
    dependencyBindings: dependencies
      .map((binding) => ({
        resourceKey: binding.resourceKey,
        bindingId: binding.bindingId,
      }))
      .sort((left, right) =>
        left.resourceKey < right.resourceKey
          ? -1
          : left.resourceKey > right.resourceKey
            ? 1
            : 0,
      ),
    providerType: 'ec2-internet-gateway-attachment',
    providerResourceId:
      options.providerResourceId ??
      attachmentProviderResourceId(
        INTERNET_GATEWAY_IDS.primary,
        VPC_IDS.primary,
      ),
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
      action.resourceKey === 'network-internet-gateway-attachment',
  );
  const action = plan.actions[actionIndex];
  if (action === undefined) {
    throw new Error('Missing network-internet-gateway-attachment action.');
  }
  const vpcActionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === 'network-vpc',
  );
  const internetGatewayActionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === 'network-internet-gateway',
  );
  const vpcAction = plan.actions[vpcActionIndex];
  const internetGatewayAction = plan.actions[internetGatewayActionIndex];
  if (vpcAction === undefined || internetGatewayAction === undefined) {
    throw new Error('Missing attachment dependency actions.');
  }
  const ownershipNonce = nonce(options.ownershipNonceByte ?? 73);
  const intentNonces = plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ _candidate,
      /** @type {number} */ index,
    ) => (index === actionIndex ? ownershipNonce : nonce(10 + index)),
  );
  const dependencyReceipt = (/** @type {Readonly<AnyRecord>} */ candidate) =>
    operation === 'apply'
      ? candidate.actionId
      : semanticId(
          'wda3',
          'wharfie:test:internet-gateway-attachment-dependency-create-action:v1',
          { resourceKey: candidate.resourceKey },
        );
  const vpcBinding = makeDirectBinding(base, vpcAction, {
    providerResourceId: VPC_IDS.primary,
    ownershipNonce: intentNonces[vpcActionIndex],
    createdByActionId: dependencyReceipt(vpcAction),
  });
  const internetGatewayBinding = makeDirectBinding(
    base,
    internetGatewayAction,
    {
      providerResourceId: INTERNET_GATEWAY_IDS.primary,
      ownershipNonce: intentNonces[internetGatewayActionIndex],
      createdByActionId: dependencyReceipt(internetGatewayAction),
    },
  );
  const dependencies = [vpcBinding, internetGatewayBinding];
  const priorBinding =
    action.action === 'create'
      ? null
      : makeAttachmentBinding(base, action, dependencies, {
          ownershipNonce,
          createdByActionId: semanticId(
            'wda3',
            'wharfie:test:internet-gateway-attachment-create-action:v1',
            { resourceKey: action.resourceKey },
          ),
        });
  const resourceBindings = [
    vpcBinding,
    internetGatewayBinding,
    ...(priorBinding === null ? [] : [priorBinding]),
  ];
  /** @type {AnyRecord|null} */
  let lastOperation = null;
  if (operation !== 'apply') {
    if (priorBinding === null) {
      throw new Error('Missing existing attachment binding.');
    }
    lastOperation = {
      kind: 'create',
      planId: semanticId(
        'wpl3',
        'wharfie:test:internet-gateway-attachment-last-plan:v1',
        { operation },
      ),
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
    internetGatewayBinding,
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

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function makeInternetGateway(fixture, overrides = {}) {
  return {
    Attachments: [
      {
        State: 'available',
        VpcId: fixture.vpcBinding.providerResourceId,
      },
    ],
    InternetGatewayId: fixture.internetGatewayBinding.providerResourceId,
    OwnerId: fixture.base.providerScope.accountId,
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makeClient(fixture, options = {}) {
  const exact = options.exact ?? makeInternetGateway(fixture);
  const broad = options.broad ?? [exact];
  return Object.freeze({
    attachInternetGateway:
      options.attachInternetGateway ?? jest.fn(async () => ({})),
    describeInternetGateways:
      options.describeInternetGateways ??
      jest.fn(async (/** @type {AnyRecord} */ input) => ({
        InternetGateways: input.InternetGatewayIds ? [exact] : broad,
      })),
    detachInternetGateway:
      options.detachInternetGateway ?? jest.fn(async () => ({})),
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makePorts(fixture, options = {}) {
  const client = options.client ?? makeClient(fixture, options);
  const waitForRetry = options.waitForRetry ?? jest.fn();
  return {
    client,
    waitForRetry,
    resource: createAwsSingleNodeInternetGatewayAttachmentResource({
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

describe('AWS single-node internet gateway attachment state identity', () => {
  it('uses an exact frozen constant descriptor independent of unrelated provider inputs', () => {
    const firstBase = makeBase();
    const secondBase = makeBase({ imageId: 'ami-0fedcba9876543210' });
    const first = getAwsSingleNodeInternetGatewayAttachmentStateDigest(
      firstBase.providerSpec,
    );
    const second = getAwsSingleNodeInternetGatewayAttachmentStateDigest(
      secondBase.providerSpec,
    );

    expect(first).toEqual(second);
    expect(first.algorithm).toBe('sha256');
    expect(first.value).toHaveLength(43);
    expect(Object.isFrozen(first)).toBe(true);
    expect(
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_STATE_DIGEST_DOMAIN,
    ).toBe('wharfie:aws-single-node-ec2-internet-gateway-attachment-state:v1');
    expect(first.value).toBe(
      sha256Base64Url(
        `${AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
          sortCanonicalJsonValue({
            schemaVersion: 1,
            kind: 'awsSingleNodeEc2InternetGatewayAttachmentState',
            state: 'available',
            onDestroy: 'purge',
          }),
        )}`,
      ),
    );
    expect(JSON.stringify(first)).not.toContain(VPC_IDS.primary);
    expect(JSON.stringify(first)).not.toContain(INTERNET_GATEWAY_IDS.primary);
  });

  it('rejects malformed and noncanonical provider specifications', () => {
    expect(() =>
      getAwsSingleNodeInternetGatewayAttachmentStateDigest({}),
    ).toThrow(TypeError);
    const base = makeBase();
    const changed = JSON.parse(JSON.stringify(base.providerSpec));
    changed.capabilities.networking.vpcCidr = '10.99.0.0/16';
    expect(() =>
      getAwsSingleNodeInternetGatewayAttachmentStateDigest(changed),
    ).toThrow(TypeError);
  });

  it('derives a domain-separated content address from the exact endpoint IDs', () => {
    expect(
      attachmentProviderResourceId(
        INTERNET_GATEWAY_IDS.primary,
        VPC_IDS.primary,
      ),
    ).toBe(
      createCanonicalJsonSha256Id({
        prefix: 'wia1',
        domain: 'wharfie:aws-single-node-ec2-internet-gateway-attachment:v1',
        value: {
          internetGatewayId: INTERNET_GATEWAY_IDS.primary,
          vpcId: VPC_IDS.primary,
        },
      }),
    );
    expect(
      attachmentProviderResourceId(
        INTERNET_GATEWAY_IDS.primary,
        VPC_IDS.primary,
      ),
    ).not.toBe(
      attachmentProviderResourceId(INTERNET_GATEWAY_IDS.other, VPC_IDS.primary),
    );
    expect(
      attachmentProviderResourceId(
        INTERNET_GATEWAY_IDS.primary,
        VPC_IDS.primary,
      ),
    ).not.toBe(
      attachmentProviderResourceId(INTERNET_GATEWAY_IDS.primary, VPC_IDS.other),
    );
  });
});

describe('AWS single-node internet gateway attachment create and recovery', () => {
  it('attaches only after independent exact-gateway and broad-VPC reads prove both endpoints free', async () => {
    const fixture = makeFixture();
    const freeGateway = makeInternetGateway(fixture, { Attachments: [] });
    const attachInternetGateway = jest.fn(
      async (/** @type {AnyRecord} */ _input) => ({ ignored: true }),
    );
    const client = makeClient(fixture, {
      exact: freeGateway,
      broad: [],
      attachInternetGateway,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();

    expect(client.describeInternetGateways).toHaveBeenCalledTimes(2);
    expect(client.describeInternetGateways.mock.calls[0][0]).toEqual({
      InternetGatewayIds: [INTERNET_GATEWAY_IDS.primary],
    });
    expect(client.describeInternetGateways.mock.calls[1][0]).toEqual({
      Filters: [{ Name: 'attachment.vpc-id', Values: [VPC_IDS.primary] }],
      MaxResults:
        AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DISCOVERY_MAX_RESULTS,
    });
    expectDeepFrozen(client.describeInternetGateways.mock.calls[0][0]);
    expectDeepFrozen(client.describeInternetGateways.mock.calls[1][0]);
    expect(attachInternetGateway).toHaveBeenCalledTimes(1);
    expect(attachInternetGateway).toHaveBeenCalledWith({
      InternetGatewayId: INTERNET_GATEWAY_IDS.primary,
      VpcId: VPC_IDS.primary,
    });
    expectDeepFrozen(attachInternetGateway.mock.calls[0][0]);
    expect(client.detachInternetGateway).not.toHaveBeenCalled();
  });

  it('does not attach when the exact pair is already present and creates the derived binding', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    const settlement = await resource.verifySettlement(fixture.context);

    expect(client.attachInternetGateway).not.toHaveBeenCalled();
    expect(client.detachInternetGateway).not.toHaveBeenCalled();
    expect(settlement).toEqual({
      status: 'converged',
      binding: createDeploymentResourceBinding({
        schemaVersion: 2,
        kind: 'deploymentResourceBinding',
        deploymentInstanceId: fixture.base.deploymentInstanceId,
        incarnationId: fixture.base.incarnationId,
        resourceKey: 'network-internet-gateway-attachment',
        capability: { kind: 'networking', version: 1 },
        role: { kind: 'internet-gateway-attachment', version: 1 },
        management: 'managed',
        ownershipMode: 'derived',
        onDestroy: 'purge',
        dependencyBindings: [
          {
            resourceKey: 'network-internet-gateway',
            bindingId: fixture.internetGatewayBinding.bindingId,
          },
          {
            resourceKey: 'network-vpc',
            bindingId: fixture.vpcBinding.bindingId,
          },
        ],
        providerType: 'ec2-internet-gateway-attachment',
        providerResourceId: attachmentProviderResourceId(
          INTERNET_GATEWAY_IDS.primary,
          VPC_IDS.primary,
        ),
        providerScopeId: fixture.base.providerScope.providerScopeId,
        ownershipNonce: fixture.ownershipNonce,
        createdByActionId: fixture.action.actionId,
      }),
    });
    expectDeepFrozen(settlement);
  });

  it('ignores every mutation response field and settles only from later reads', async () => {
    const fixture = makeFixture();
    let attached = false;
    const free = makeInternetGateway(fixture, { Attachments: [] });
    const present = makeInternetGateway(fixture);
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) => ({
        InternetGateways: input.InternetGatewayIds
          ? [attached ? present : free]
          : attached
            ? [present]
            : [],
      }),
    );
    const attachInternetGateway = jest.fn(async () => {
      attached = true;
      return {
        InternetGatewayId: INTERNET_GATEWAY_IDS.other,
        VpcId: VPC_IDS.other,
        secret: 'mutation-response-secret',
      };
    });
    const client = makeClient(fixture, {
      describeInternetGateways,
      attachInternetGateway,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(attachInternetGateway).toHaveBeenCalledTimes(1);
  });

  it('recovers response loss by exact readback without replaying the mutation', async () => {
    const fixture = makeFixture();
    let attached = false;
    const free = makeInternetGateway(fixture, { Attachments: [] });
    const present = makeInternetGateway(fixture);
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) => ({
        InternetGateways: input.InternetGatewayIds
          ? [attached ? present : free]
          : attached
            ? [present]
            : [],
      }),
    );
    const attachInternetGateway = jest.fn(async () => {
      attached = true;
      throw providerError('NetworkingError', 'attach-response-secret');
    });
    const client = makeClient(fixture, {
      describeInternetGateways,
      attachInternetGateway,
    });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('attach-response-secret');
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(attachInternetGateway).toHaveBeenCalledTimes(1);
  });

  it('does not replay an ambiguous attach that later reads prove was applied', async () => {
    const fixture = makeFixture();
    let attached = false;
    const free = makeInternetGateway(fixture, { Attachments: [] });
    const present = makeInternetGateway(fixture);
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) => ({
        InternetGateways: input.InternetGatewayIds
          ? [attached ? present : free]
          : attached
            ? [present]
            : [],
      }),
    );
    const attachInternetGateway = jest.fn(async () => {
      attached = true;
      throw providerError('NetworkingError');
    });
    const client = makeClient(fixture, {
      describeInternetGateways,
      attachInternetGateway,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
    );
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(attachInternetGateway).toHaveBeenCalledTimes(1);
  });

  it('safely replays the exact pair when an ambiguous attach was not applied', async () => {
    const fixture = makeFixture();
    let attached = false;
    const free = makeInternetGateway(fixture, { Attachments: [] });
    const present = makeInternetGateway(fixture);
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) => ({
        InternetGateways: input.InternetGatewayIds
          ? [attached ? present : free]
          : attached
            ? [present]
            : [],
      }),
    );
    const attachInternetGateway = jest
      .fn(async (/** @type {AnyRecord} */ _input) => ({}))
      .mockRejectedValueOnce(providerError('NetworkingError'))
      .mockImplementationOnce(async () => {
        attached = true;
        return {};
      });
    const client = makeClient(fixture, {
      describeInternetGateways,
      attachInternetGateway,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
    );
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(attachInternetGateway).toHaveBeenCalledTimes(2);
    expect(attachInternetGateway.mock.calls[0][0]).toEqual(
      attachInternetGateway.mock.calls[1][0],
    );
    expectDeepFrozen(attachInternetGateway.mock.calls[1][0]);
  });

  it.each(['Resource.AlreadyAssociated', 'IncorrectState'])(
    'treats typed attach %s as readback-only without claiming convergence',
    async (errorName) => {
      const fixture = makeFixture();
      const free = makeInternetGateway(fixture, { Attachments: [] });
      const attachInternetGateway = jest.fn(async () => {
        throw providerError(errorName, 'typed-attach-secret');
      });
      const client = makeClient(fixture, {
        exact: free,
        broad: [],
        attachInternetGateway,
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();
      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'not-converged',
        },
      );
      expect(attachInternetGateway).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves the exact prior binding, creation receipt, nonce, and lineage on noop', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const priorBinding = fixture.priorBinding;
    if (priorBinding === null) {
      throw new Error('Missing existing attachment binding.');
    }
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });
    const exactHeadLineage = fixture.head.resourceBindings
      .filter((/** @type {Readonly<AnyRecord>} */ binding) =>
        ['network-internet-gateway', 'network-vpc'].includes(
          binding.resourceKey,
        ),
      )
      .map((/** @type {Readonly<AnyRecord>} */ binding) => ({
        resourceKey: binding.resourceKey,
        bindingId: binding.bindingId,
      }))
      .sort(
        (
          /** @type {Readonly<AnyRecord>} */ left,
          /** @type {Readonly<AnyRecord>} */ right,
        ) =>
          left.resourceKey < right.resourceKey
            ? -1
            : left.resourceKey > right.resourceKey
              ? 1
              : 0,
      );

    expect(priorBinding.dependencyBindings).toEqual(exactHeadLineage);

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    const settlement = await resource.verifySettlement(fixture.context);

    expect(settlement).toEqual({
      status: 'converged',
      binding: priorBinding,
    });
    expect(settlement.binding.createdByActionId).toBe(
      priorBinding.createdByActionId,
    );
    expect(settlement.binding.ownershipNonce).toBe(priorBinding.ownershipNonce);
    expect(settlement.binding.dependencyBindings).toEqual(
      priorBinding.dependencyBindings,
    );
    expect(client.attachInternetGateway).not.toHaveBeenCalled();
    expect(client.detachInternetGateway).not.toHaveBeenCalled();
  });
});

describe('AWS single-node internet gateway attachment evidence fencing', () => {
  it.each([
    [
      'the expected gateway is attached to a different VPC',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exact: makeInternetGateway(fixture, {
          Attachments: [{ State: 'available', VpcId: VPC_IDS.other }],
        }),
        broad: [],
      }),
    ],
    [
      'the expected VPC is attached to another gateway',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exact: makeInternetGateway(fixture, { Attachments: [] }),
        broad: [
          makeInternetGateway(fixture, {
            InternetGatewayId: INTERNET_GATEWAY_IDS.other,
          }),
        ],
      }),
    ],
    [
      'the exact gateway reports multiple attachments',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exact: makeInternetGateway(fixture, {
          Attachments: [
            { State: 'available', VpcId: VPC_IDS.primary },
            { State: 'available', VpcId: VPC_IDS.other },
          ],
        }),
        broad: [makeInternetGateway(fixture)],
      }),
    ],
    [
      'the broad VPC query returns multiple gateways',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exact: makeInternetGateway(fixture),
        broad: [
          makeInternetGateway(fixture),
          makeInternetGateway(fixture, {
            InternetGatewayId: INTERNET_GATEWAY_IDS.other,
          }),
        ],
      }),
    ],
    [
      'the exact gateway has a foreign owner',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exact: makeInternetGateway(fixture, { OwnerId: '999999999999' }),
        broad: [makeInternetGateway(fixture)],
      }),
    ],
    [
      'the broad gateway has a foreign owner',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exact: makeInternetGateway(fixture),
        broad: [makeInternetGateway(fixture, { OwnerId: '999999999999' })],
      }),
    ],
  ])('blocks when %s', async (_name, evidence) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, evidence(fixture));
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceConflictError,
    );
    expect(client.attachInternetGateway).not.toHaveBeenCalled();
  });

  it('blocks a valid different gateway returned by the exact-ID query', async () => {
    const fixture = makeFixture();
    const wrongExact = makeInternetGateway(fixture, {
      InternetGatewayId: INTERNET_GATEWAY_IDS.other,
    });
    const expectedBroad = makeInternetGateway(fixture);
    const client = makeClient(fixture, {
      exact: wrongExact,
      broad: [expectedBroad],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceConflictError,
    );
    expect(client.attachInternetGateway).not.toHaveBeenCalled();
    expect(client.detachInternetGateway).not.toHaveBeenCalled();
  });

  it.each(['missing', 'nonstring'])(
    'maps %s OwnerId evidence to fixed unknown state',
    async (variant) => {
      const fixture = makeFixture();
      const malformed = makeInternetGateway(fixture);
      if (variant === 'missing') delete malformed.OwnerId;
      else malformed.OwnerId = 42;
      const client = makeClient(fixture, {
        exact: malformed,
        broad: [makeInternetGateway(fixture)],
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.verifySettlement(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
      );
      expect(client.attachInternetGateway).not.toHaveBeenCalled();
      expect(client.detachInternetGateway).not.toHaveBeenCalled();
    },
  );

  it('lets a broad conflicting gateway dominate malformed exact evidence', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      exact: makeInternetGateway(fixture, { Attachments: null }),
      broad: [
        makeInternetGateway(fixture, {
          InternetGatewayId: INTERNET_GATEWAY_IDS.other,
        }),
      ],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceConflictError,
    );
    expect(client.attachInternetGateway).not.toHaveBeenCalled();
    expect(client.detachInternetGateway).not.toHaveBeenCalled();
  });

  it('keeps malformed exact evidence unknown even when the broad view is present', async () => {
    const fixture = makeFixture();
    const malformed = makeInternetGateway(fixture, {
      Attachments: null,
      secret: 'mixed-evidence-secret',
    });
    const client = makeClient(fixture, {
      exact: malformed,
      broad: [makeInternetGateway(fixture)],
    });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('mixed-evidence-secret');
  });

  it('keeps malformed broad evidence unknown even when the exact view is present', async () => {
    const fixture = makeFixture();
    const present = makeInternetGateway(fixture);
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) =>
        input.InternetGatewayIds
          ? { InternetGateways: [present] }
          : { InternetGateways: null, secret: 'malformed-broad-secret' },
    );
    const client = makeClient(fixture, { describeInternetGateways });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('malformed-broad-secret');
    expect(client.attachInternetGateway).not.toHaveBeenCalled();
  });

  it('lets an exact foreign-owner conflict dominate malformed broad evidence', async () => {
    const fixture = makeFixture();
    const foreign = makeInternetGateway(fixture, {
      OwnerId: '999999999999',
    });
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) =>
        input.InternetGatewayIds
          ? { InternetGateways: [foreign] }
          : { InternetGateways: null, secret: 'mixed-broad-secret' },
    );
    const client = makeClient(fixture, { describeInternetGateways });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceConflictError,
    );
    expect(JSON.stringify(observed)).not.toContain('mixed-broad-secret');
  });

  it.each([
    [undefined],
    [null],
    [{}],
    ['not-an-array'],
    [[{}]],
    [[{ State: 'mystery', VpcId: VPC_IDS.primary }]],
    [[{ State: 'available', VpcId: 'not-a-vpc' }]],
  ])(
    'maps malformed exact Attachments %p to fixed unknown state',
    async (attachments) => {
      const fixture = makeFixture();
      const malformed = makeInternetGateway(fixture, {
        Attachments: attachments,
        secret: 'malformed-response-secret',
      });
      const client = makeClient(fixture, {
        exact: malformed,
        broad: [malformed],
      });
      const { resource } = makePorts(fixture, { client });

      const observed = await resource
        .verifySettlement(fixture.context)
        .catch((/** @type {unknown} */ error) => error);
      expect(observed).toBeInstanceOf(
        AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
      );
      expect(JSON.stringify(observed)).not.toContain(
        'malformed-response-secret',
      );
      expect(client.attachInternetGateway).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { InternetGateways: null },
    { InternetGateways: [] },
    {
      InternetGateways: [
        {
          Attachments: [],
          InternetGatewayId: 'invalid-secret-id',
          OwnerId: '123456789012',
        },
      ],
    },
  ])(
    'does not trust malformed successful exact response %#',
    async (response) => {
      const fixture = makeFixture();
      const describeInternetGateways = jest.fn(async () => response);
      const client = makeClient(fixture, { describeInternetGateways });
      const { resource } = makePorts(fixture, { client });

      const observed = await resource
        .verifySettlement(fixture.context)
        .catch((/** @type {unknown} */ error) => error);
      expect(observed).toBeInstanceOf(
        AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
      );
      expect(JSON.stringify(observed)).not.toContain('invalid-secret-id');
    },
  );

  it('keeps one-sided present evidence retryable and never mutates from it', async () => {
    const fixture = makeFixture();
    const present = makeInternetGateway(fixture);
    const cases = [
      { exact: present, broad: [] },
      {
        exact: makeInternetGateway(fixture, { Attachments: [] }),
        broad: [present],
      },
    ];
    for (const evidence of cases) {
      const client = makeClient(fixture, evidence);
      const { resource } = makePorts(fixture, { client });
      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        { status: 'not-converged' },
      );
      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();
      expect(client.attachInternetGateway).not.toHaveBeenCalled();
      expect(client.detachInternetGateway).not.toHaveBeenCalled();
    }
  });

  it('keeps exact typed not-found plus a broad exact pair retryable', async () => {
    const fixture = makeFixture();
    const present = makeInternetGateway(fixture);
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) => {
        if (input.InternetGatewayIds) {
          throw providerError(
            'InvalidInternetGatewayID.NotFound',
            'one-sided-not-found-secret',
          );
        }
        return { InternetGateways: [present] };
      },
    );
    const client = makeClient(fixture, { describeInternetGateways });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.attachInternetGateway).not.toHaveBeenCalled();
    expect(client.detachInternetGateway).not.toHaveBeenCalled();
  });

  it.each(['provider failure', 'malformed response'])(
    'keeps exact typed not-found plus broad %s unknown',
    async (broadFailure) => {
      const fixture = makeFixture();
      const describeInternetGateways = jest.fn(
        async (/** @type {AnyRecord} */ input) => {
          if (input.InternetGatewayIds) {
            throw providerError('InvalidInternetGatewayID.NotFound');
          }
          if (broadFailure === 'provider failure') {
            throw providerError('NetworkingError');
          }
          return { InternetGateways: null };
        },
      );
      const client = makeClient(fixture, { describeInternetGateways });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.verifySettlement(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
      );
      expect(client.attachInternetGateway).not.toHaveBeenCalled();
      expect(client.detachInternetGateway).not.toHaveBeenCalled();
    },
  );

  it('blocks stable dual-read absence for a durable noop binding', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const free = makeInternetGateway(fixture, { Attachments: [] });
    const client = makeClient(fixture, { exact: free, broad: [] });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.attachInternetGateway).not.toHaveBeenCalled();
    expect(client.detachInternetGateway).not.toHaveBeenCalled();
  });

  it.each(['attaching', 'attached', 'detaching', 'detached'])(
    'keeps the documented same-pair %s state transient',
    async (state) => {
      const fixture = makeFixture();
      const transitional = makeInternetGateway(fixture, {
        Attachments: [{ State: state, VpcId: VPC_IDS.primary }],
      });
      const client = makeClient(fixture, {
        exact: transitional,
        broad: [transitional],
      });
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        { status: 'not-converged' },
      );
      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();
      expect(client.attachInternetGateway).not.toHaveBeenCalled();
      expect(client.detachInternetGateway).not.toHaveBeenCalled();
    },
  );

  it('treats a typed exact internet-gateway not-found as dependency conflict without echoing details', async () => {
    const fixture = makeFixture();
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) => {
        if (input.InternetGatewayIds) {
          throw providerError(
            'InvalidInternetGatewayID.NotFound',
            'missing-gateway-secret',
          );
        }
        return { InternetGateways: [] };
      },
    );
    const client = makeClient(fixture, { describeInternetGateways });
    const { resource } = makePorts(fixture, { client });

    const settlement = await resource.verifySettlement(fixture.context);
    expect(settlement).toEqual({ status: 'blocked' });
    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceConflictError,
    );
    expect(JSON.stringify(observed)).not.toContain('missing-gateway-secret');
    expect(client.attachInternetGateway).not.toHaveBeenCalled();
  });
});

describe('AWS single-node internet gateway attachment destroy', () => {
  it('detaches only after exact and broad reads corroborate the bound pair', async () => {
    const fixture = makeFixture({
      operation: 'destroy',
      observedStateDigest: digest('observed attachment state'),
    });
    const detachInternetGateway = jest.fn(
      async (/** @type {AnyRecord} */ _input) => ({ ignored: true }),
    );
    const client = makeClient(fixture, { detachInternetGateway });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();

    expect(detachInternetGateway).toHaveBeenCalledTimes(1);
    expect(detachInternetGateway).toHaveBeenCalledWith({
      InternetGatewayId: INTERNET_GATEWAY_IDS.primary,
      VpcId: VPC_IDS.primary,
    });
    expectDeepFrozen(detachInternetGateway.mock.calls[0][0]);
    expect(client.attachInternetGateway).not.toHaveBeenCalled();
  });

  it('settles null only after exact and broad reads both prove the relation absent', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    let attached = true;
    const present = makeInternetGateway(fixture);
    const free = makeInternetGateway(fixture, { Attachments: [] });
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) => ({
        InternetGateways: input.InternetGatewayIds
          ? [attached ? present : free]
          : attached
            ? [present]
            : [],
      }),
    );
    const detachInternetGateway = jest.fn(async () => {
      attached = false;
      return { secret: 'ignored-detach-response' };
    });
    const client = makeClient(fixture, {
      describeInternetGateways,
      detachInternetGateway,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(detachInternetGateway).toHaveBeenCalledTimes(1);
  });

  it('keeps a successful detach unsettled while either independent view remains present', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const present = makeInternetGateway(fixture);
    const free = makeInternetGateway(fixture, { Attachments: [] });
    const cases = [
      { exact: present, broad: [] },
      { exact: free, broad: [present] },
    ];
    for (const evidence of cases) {
      const client = makeClient(fixture, evidence);
      const { resource } = makePorts(fixture, { client });
      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        { status: 'not-converged' },
      );
    }
  });

  it.each(['Gateway.NotAttached', 'IncorrectState', 'DependencyViolation'])(
    'treats typed detach %s as readback-only without claiming absence',
    async (errorName) => {
      const fixture = makeFixture({ operation: 'destroy' });
      const detachInternetGateway = jest.fn(async () => {
        throw providerError(errorName, 'typed-detach-secret');
      });
      const client = makeClient(fixture, { detachInternetGateway });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();
      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'not-converged',
        },
      );
      expect(detachInternetGateway).toHaveBeenCalledTimes(1);
    },
  );

  it('recovers a lost detach response from later absence without replay', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    let attached = true;
    const present = makeInternetGateway(fixture);
    const free = makeInternetGateway(fixture, { Attachments: [] });
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) => ({
        InternetGateways: input.InternetGatewayIds
          ? [attached ? present : free]
          : attached
            ? [present]
            : [],
      }),
    );
    const detachInternetGateway = jest.fn(async () => {
      attached = false;
      throw providerError('NetworkingError', 'detach-response-secret');
    });
    const client = makeClient(fixture, {
      describeInternetGateways,
      detachInternetGateway,
    });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('detach-response-secret');
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(detachInternetGateway).toHaveBeenCalledTimes(1);
  });

  it('does not replay an ambiguous detach that later reads prove was applied', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    let attached = true;
    const present = makeInternetGateway(fixture);
    const free = makeInternetGateway(fixture, { Attachments: [] });
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) => ({
        InternetGateways: input.InternetGatewayIds
          ? [attached ? present : free]
          : attached
            ? [present]
            : [],
      }),
    );
    const detachInternetGateway = jest.fn(async () => {
      attached = false;
      throw providerError('NetworkingError');
    });
    const client = makeClient(fixture, {
      describeInternetGateways,
      detachInternetGateway,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
    );
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(detachInternetGateway).toHaveBeenCalledTimes(1);
  });

  it('safely replays the exact pair when an ambiguous detach was not applied', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    let attached = true;
    const present = makeInternetGateway(fixture);
    const free = makeInternetGateway(fixture, { Attachments: [] });
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) => ({
        InternetGateways: input.InternetGatewayIds
          ? [attached ? present : free]
          : attached
            ? [present]
            : [],
      }),
    );
    const detachInternetGateway = jest
      .fn(async (/** @type {AnyRecord} */ _input) => ({}))
      .mockRejectedValueOnce(providerError('NetworkingError'))
      .mockImplementationOnce(async () => {
        attached = false;
        return {};
      });
    const client = makeClient(fixture, {
      describeInternetGateways,
      detachInternetGateway,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
    );
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(detachInternetGateway).toHaveBeenCalledTimes(2);
    expect(detachInternetGateway.mock.calls[0][0]).toEqual(
      detachInternetGateway.mock.calls[1][0],
    );
    expectDeepFrozen(detachInternetGateway.mock.calls[1][0]);
  });

  it('never detaches a conflicting relationship', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const wrongVpc = makeInternetGateway(fixture, {
      Attachments: [{ State: 'available', VpcId: VPC_IDS.other }],
    });
    const client = makeClient(fixture, { exact: wrongVpc, broad: [] });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceConflictError,
    );
    expect(client.detachInternetGateway).not.toHaveBeenCalled();
  });
});

describe('AWS single-node internet gateway attachment retry bounds', () => {
  it('retries one-sided evidence within the explicit bound and converges', async () => {
    const fixture = makeFixture();
    const present = makeInternetGateway(fixture);
    let broadReads = 0;
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) => {
        if (input.InternetGatewayIds) {
          return { InternetGateways: [present] };
        }
        broadReads += 1;
        return {
          InternetGateways: broadReads === 1 ? [] : [present],
        };
      },
    );
    const waitForRetry = jest.fn();
    const client = makeClient(fixture, { describeInternetGateways });
    const { resource } = makePorts(fixture, {
      client,
      maxAttempts: 2,
      waitForRetry,
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(waitForRetry).toHaveBeenCalledTimes(1);
    expect(waitForRetry).toHaveBeenCalledWith(1);
  });

  it('returns not-converged after bounded stable absence and waits only between attempts', async () => {
    const fixture = makeFixture();
    const free = makeInternetGateway(fixture, { Attachments: [] });
    const waitForRetry = jest.fn();
    const client = makeClient(fixture, { exact: free, broad: [] });
    const { resource } = makePorts(fixture, {
      client,
      maxAttempts: 3,
      waitForRetry,
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(waitForRetry.mock.calls).toEqual([[1], [2]]);
    expect(client.describeInternetGateways).toHaveBeenCalledTimes(6);
  });

  it('maps provider and waiter failures to fixed non-echoing unknown errors', async () => {
    const fixture = makeFixture();
    const describeInternetGateways = jest.fn(async () => {
      throw providerError('NetworkingError', 'read-secret');
    });
    const readClient = makeClient(fixture, { describeInternetGateways });
    const readResource = makePorts(fixture, {
      client: readClient,
      maxAttempts: 2,
    }).resource;
    const readObserved = await readResource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(readObserved).toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
    );
    expect(JSON.stringify(readObserved)).not.toContain('read-secret');

    const present = makeInternetGateway(fixture);
    const waitForRetry = jest.fn(async () => {
      throw new Error('wait-secret');
    });
    const waitClient = makeClient(fixture, { exact: present, broad: [] });
    const waitResource = makePorts(fixture, {
      client: waitClient,
      maxAttempts: 2,
      waitForRetry,
    }).resource;
    const waitObserved = await waitResource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(waitObserved).toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
    );
    expect(JSON.stringify(waitObserved)).not.toContain('wait-secret');
  });

  it('follows bounded frozen broad-discovery pages and rejects duplicate results', async () => {
    const fixture = makeFixture();
    const present = makeInternetGateway(fixture);
    const describeInternetGateways = jest.fn(
      async (/** @type {AnyRecord} */ input) => {
        if (input.InternetGatewayIds) {
          return { InternetGateways: [present] };
        }
        if (input.NextToken === undefined) {
          return { InternetGateways: [], NextToken: 'page-2' };
        }
        return { InternetGateways: [present] };
      },
    );
    const client = makeClient(fixture, { describeInternetGateways });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(describeInternetGateways.mock.calls[2][0]).toEqual({
      Filters: [{ Name: 'attachment.vpc-id', Values: [VPC_IDS.primary] }],
      MaxResults:
        AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DISCOVERY_MAX_RESULTS,
      NextToken: 'page-2',
    });
    expectDeepFrozen(describeInternetGateways.mock.calls[2][0]);

    const duplicateDescribe = jest.fn(
      async (/** @type {AnyRecord} */ input) => {
        if (input.InternetGatewayIds) {
          return { InternetGateways: [present] };
        }
        if (input.NextToken === undefined) {
          return { InternetGateways: [present], NextToken: 'page-2' };
        }
        return { InternetGateways: [present] };
      },
    );
    const duplicateClient = makeClient(fixture, {
      describeInternetGateways: duplicateDescribe,
    });
    const duplicateResource = makePorts(fixture, {
      client: duplicateClient,
    }).resource;
    await expect(
      duplicateResource.verifySettlement(fixture.context),
    ).resolves.toEqual({ status: 'blocked' });
  });

  it('rejects broad pagination token cycles and continuation at the hard page limit', async () => {
    const fixture = makeFixture();
    const present = makeInternetGateway(fixture);
    const repeatedTokenDescribe = jest.fn(
      async (/** @type {AnyRecord} */ input) => {
        if (input.InternetGatewayIds) {
          return { InternetGateways: [present] };
        }
        return { InternetGateways: [], NextToken: 'same-token' };
      },
    );
    const repeatedClient = makeClient(fixture, {
      describeInternetGateways: repeatedTokenDescribe,
    });
    const repeatedResource = makePorts(fixture, {
      client: repeatedClient,
    }).resource;
    await expect(
      repeatedResource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
    );
    expect(repeatedTokenDescribe).toHaveBeenCalledTimes(3);

    let page = 0;
    const boundedDescribe = jest.fn(async (/** @type {AnyRecord} */ input) => {
      if (input.InternetGatewayIds) {
        return { InternetGateways: [present] };
      }
      page += 1;
      return { InternetGateways: [], NextToken: `page-${page + 1}` };
    });
    const boundedClient = makeClient(fixture, {
      describeInternetGateways: boundedDescribe,
    });
    const boundedResource = makePorts(fixture, {
      client: boundedClient,
    }).resource;
    await expect(
      boundedResource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
    );
    expect(page).toBe(
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_DISCOVERY_PAGES,
    );
  });

  it('rejects pagination on exact reads and malformed broad page tokens', async () => {
    const fixture = makeFixture();
    const present = makeInternetGateway(fixture);
    const exactTokenDescribe = jest.fn(
      async (/** @type {AnyRecord} */ input) =>
        input.InternetGatewayIds
          ? { InternetGateways: [present], NextToken: 'impossible-exact-page' }
          : { InternetGateways: [present] },
    );
    const exactTokenClient = makeClient(fixture, {
      describeInternetGateways: exactTokenDescribe,
    });
    const exactTokenResource = makePorts(fixture, {
      client: exactTokenClient,
    }).resource;
    await expect(
      exactTokenResource.verifySettlement(fixture.context),
    ).resolves.toEqual({ status: 'blocked' });

    for (const NextToken of ['', 42, {}]) {
      const malformedTokenDescribe = jest.fn(
        async (/** @type {AnyRecord} */ input) =>
          input.InternetGatewayIds
            ? {
                InternetGateways: [
                  makeInternetGateway(fixture, { Attachments: [] }),
                ],
              }
            : { InternetGateways: [], NextToken },
      );
      const malformedTokenClient = makeClient(fixture, {
        describeInternetGateways: malformedTokenDescribe,
      });
      const malformedTokenResource = makePorts(fixture, {
        client: malformedTokenClient,
      }).resource;
      await expect(
        malformedTokenResource.verifySettlement(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeInternetGatewayAttachmentResourceUnknownError,
      );
    }
  });

  it('exports explicit retry and discovery limits', () => {
    expect(
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DEFAULT_MAX_ATTEMPTS,
    ).toBe(3);
    expect(AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_ATTEMPTS).toBe(10);
    expect(
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_DISCOVERY_PAGES,
    ).toBe(16);
    expect(
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_DISCOVERY_MAX_RESULTS,
    ).toBe(100);
  });
});

describe('AWS single-node internet gateway attachment controller authority', () => {
  it.each([
    [
      'an extra context key',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        extra: true,
      }),
      TypeError,
    ],
    [
      'a missing artifact stage key',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => {
        const context = /** @type {AnyRecord} */ ({ ...fixture.context });
        delete context.artifactStage;
        return context;
      },
      TypeError,
    ],
    [
      'the wrong nonce',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        ownershipNonce: nonce(99),
      }),
      AwsSingleNodeInternetGatewayAttachmentResourceConflictError,
    ],
    [
      'the wrong action index',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        actionIndex: 0,
      }),
      AwsSingleNodeInternetGatewayAttachmentResourceConflictError,
    ],
    [
      'a blocked operation',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        head: recreateHead(fixture, {
          activeOperation: { status: 'blocked' },
        }),
      }),
      AwsSingleNodeInternetGatewayAttachmentResourceConflictError,
    ],
  ])(
    'rejects %s before any provider call',
    async (_name, mutate, ErrorType) => {
      const fixture = makeFixture();
      const client = makeClient(fixture, {
        exact: makeInternetGateway(fixture, { Attachments: [] }),
        broad: [],
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(mutate(fixture)),
      ).rejects.toBeInstanceOf(ErrorType);
      expect(client.describeInternetGateways).not.toHaveBeenCalled();
      expect(client.attachInternetGateway).not.toHaveBeenCalled();
      expect(client.detachInternetGateway).not.toHaveBeenCalled();
    },
  );

  it('requires both exact direct dependency bindings before any provider call', async () => {
    const fixture = makeFixture();
    const missingVpcHead = recreateHead(fixture, {
      resourceBindings: [fixture.internetGatewayBinding],
    });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction({ ...fixture.context, head: missingVpcHead }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceConflictError,
    );
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
  });

  it('requires dependency actions to already be settled', async () => {
    const fixture = makeFixture();
    const head = JSON.parse(JSON.stringify(fixture.head));
    const dependencyIndex = fixture.plan.actions.findIndex(
      (/** @type {Readonly<AnyRecord>} */ action) =>
        action.resourceKey === 'network-vpc',
    );
    head.activeOperation.intents[dependencyIndex].status = 'pending';
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction({ ...fixture.context, head }),
    ).rejects.toBeInstanceOf(Error);
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
  });

  it('rejects a canonical reconstructed dependency lineage whose nonce disagrees with its intent', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const vpcAction = fixture.plan.actions.find(
      (/** @type {Readonly<AnyRecord>} */ action) =>
        action.resourceKey === 'network-vpc',
    );
    if (vpcAction === undefined || fixture.priorBinding === null) {
      throw new Error('Missing VPC action or prior attachment binding.');
    }
    const reconstructedVpcBinding = makeDirectBinding(fixture.base, vpcAction, {
      providerResourceId: VPC_IDS.primary,
      ownershipNonce: nonce(98),
      createdByActionId: fixture.vpcBinding.createdByActionId,
    });
    const reconstructedPriorBinding = makeAttachmentBinding(
      fixture.base,
      fixture.action,
      [reconstructedVpcBinding, fixture.internetGatewayBinding],
      {
        ownershipNonce: fixture.priorBinding.ownershipNonce,
        createdByActionId: fixture.priorBinding.createdByActionId,
      },
    );
    const head = recreateHead(fixture, {
      resourceBindings: [
        reconstructedVpcBinding,
        fixture.internetGatewayBinding,
        reconstructedPriorBinding,
      ],
    });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction({ ...fixture.context, head }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceConflictError,
    );
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
  });

  it('rejects a structurally valid prior binding with the wrong synthetic identity through settlement verification', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    if (fixture.priorBinding === null) {
      throw new Error('Missing prior attachment binding.');
    }
    const wrongPriorBinding = makeAttachmentBinding(
      fixture.base,
      fixture.action,
      [fixture.vpcBinding, fixture.internetGatewayBinding],
      {
        providerResourceId: attachmentProviderResourceId(
          INTERNET_GATEWAY_IDS.other,
          VPC_IDS.primary,
        ),
        ownershipNonce: fixture.priorBinding.ownershipNonce,
        createdByActionId: fixture.priorBinding.createdByActionId,
      },
    );
    const head = recreateHead(fixture, {
      resourceBindings: [
        fixture.vpcBinding,
        fixture.internetGatewayBinding,
        wrongPriorBinding,
      ],
    });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement({ ...fixture.context, head }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceConflictError,
    );
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
  });

  it('rejects a structurally valid prior binding with the wrong exact dependency lineage', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const artifactAction = fixture.plan.actions.find(
      (/** @type {Readonly<AnyRecord>} */ action) =>
        action.resourceKey === 'artifact',
    );
    if (artifactAction === undefined || fixture.priorBinding === null) {
      throw new Error('Missing artifact action or prior attachment binding.');
    }
    const artifactBinding = makeDirectBinding(fixture.base, artifactAction, {
      providerResourceId: 'provider-resource-artifact',
      ownershipNonce: nonce(98),
      createdByActionId: semanticId(
        'wda3',
        'wharfie:test:historical-artifact-create-action:v1',
        { resourceKey: artifactAction.resourceKey },
      ),
    });
    const wrongPriorBinding = makeAttachmentBinding(
      fixture.base,
      fixture.action,
      [artifactBinding],
      {
        ownershipNonce: fixture.priorBinding.ownershipNonce,
        createdByActionId: fixture.priorBinding.createdByActionId,
      },
    );
    const head = recreateHead(fixture, {
      resourceBindings: [
        artifactBinding,
        fixture.vpcBinding,
        fixture.internetGatewayBinding,
        wrongPriorBinding,
      ],
    });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction({ ...fixture.context, head }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceConflictError,
    );
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
  });

  it.each([
    ['the dependency creation receipt', 'receipt'],
    ['the dependency role', 'role'],
  ])('rejects a mismatch in %s', async (_name, mismatch) => {
    const fixture = makeFixture();
    const badVpcBinding = createDeploymentResourceBinding({
      schemaVersion: 2,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: fixture.base.deploymentInstanceId,
      incarnationId: fixture.base.incarnationId,
      resourceKey: 'network-vpc',
      capability: { kind: 'networking', version: 1 },
      role:
        mismatch === 'role'
          ? { kind: 'subnet', version: 1 }
          : { kind: 'vpc', version: 1 },
      management: 'managed',
      ownershipMode: 'direct',
      onDestroy: 'purge',
      dependencyBindings: [],
      providerType: 'ec2-vpc',
      providerResourceId: VPC_IDS.primary,
      providerScopeId: fixture.base.providerScope.providerScopeId,
      ownershipNonce: fixture.vpcBinding.ownershipNonce,
      createdByActionId:
        mismatch === 'receipt'
          ? semanticId(
              'wda3',
              'wharfie:test:wrong-dependency-create-action:v1',
              { mismatch },
            )
          : fixture.vpcBinding.createdByActionId,
    });
    const badHead = recreateHead(fixture, {
      resourceBindings: [badVpcBinding, fixture.internetGatewayBinding],
    });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction({ ...fixture.context, head: badHead }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceConflictError,
    );
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
  });

  it('rejects a dependency whose exact role and provider type do not agree', async () => {
    const fixture = makeFixture();
    const badVpcBinding = createDeploymentResourceBinding({
      schemaVersion: 2,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: fixture.base.deploymentInstanceId,
      incarnationId: fixture.base.incarnationId,
      resourceKey: 'network-vpc',
      capability: { kind: 'networking', version: 1 },
      role: { kind: 'vpc', version: 1 },
      management: 'managed',
      ownershipMode: 'direct',
      onDestroy: 'purge',
      dependencyBindings: [],
      providerType: 'ec2-subnet',
      providerResourceId: VPC_IDS.primary,
      providerScopeId: fixture.base.providerScope.providerScopeId,
      ownershipNonce: fixture.vpcBinding.ownershipNonce,
      createdByActionId: fixture.vpcBinding.createdByActionId,
    });
    const badHead = recreateHead(fixture, {
      resourceBindings: [badVpcBinding, fixture.internetGatewayBinding],
    });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction({ ...fixture.context, head: badHead }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceConflictError,
    );
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
  });

  it('accepts and ignores a non-null artifact receipt owned by the controller', async () => {
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
    const resource = createAwsSingleNodeInternetGatewayAttachmentResource({
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
      createAwsSingleNodeInternetGatewayAttachmentResource({
        client,
        providerScope: fixture.base.providerScope,
        unsupported: true,
      }),
    ).toThrow(TypeError);
    for (const method of [
      'attachInternetGateway',
      'describeInternetGateways',
      'detachInternetGateway',
    ]) {
      expect(() =>
        createAwsSingleNodeInternetGatewayAttachmentResource({
          client: { ...client, [method]: undefined },
          providerScope: fixture.base.providerScope,
        }),
      ).toThrow(TypeError);
    }
    for (const maxAttempts of [
      0,
      AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_MAX_ATTEMPTS + 1,
      1.5,
    ]) {
      expect(() =>
        createAwsSingleNodeInternetGatewayAttachmentResource({
          client,
          providerScope: fixture.base.providerScope,
          maxAttempts,
        }),
      ).toThrow(TypeError);
    }
    expect(() =>
      createAwsSingleNodeInternetGatewayAttachmentResource({
        client,
        providerScope: fixture.base.providerScope,
        waitForRetry: 'not-a-function',
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeInternetGatewayAttachmentResource({
        client,
        providerScope: {},
      }),
    ).toThrow(TypeError);
  });

  it('exports fixed non-echoing public errors', () => {
    const conflict =
      new AwsSingleNodeInternetGatewayAttachmentResourceConflictError();
    const unknown =
      new AwsSingleNodeInternetGatewayAttachmentResourceUnknownError();
    expect(conflict).toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeInternetGatewayAttachmentResourceConflictError',
        code: 'AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_RESOURCE_CONFLICT',
      }),
    );
    expect(unknown).toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeInternetGatewayAttachmentResourceUnknownError',
        code: 'AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_RESOURCE_UNKNOWN',
      }),
    );
    expect(JSON.stringify({ conflict, unknown })).not.toContain('provider');
  });
});
