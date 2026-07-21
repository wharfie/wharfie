import { describe, expect, it, jest } from '@jest/globals';

import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_PREFIX,
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_STATE_DIGEST_DOMAIN,
  AwsSingleNodeDefaultIpv4RouteResourceConflictError,
  AwsSingleNodeDefaultIpv4RouteResourceUnknownError,
  createAwsSingleNodeDefaultIpv4RouteResource,
  getAwsSingleNodeDefaultIpv4RouteStateDigest,
} from '../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js';
import {
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
  getAwsSingleNodeInternetGatewayAttachmentStateDigest,
} from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { getAwsSingleNodeRouteTableStateDigest } from '../../src/core/runtime/deployment-aws-route-table-resource.js';
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
  other: 'vpc-00000000000000002',
});
const INTERNET_GATEWAY_IDS = Object.freeze({
  primary: 'igw-00000000000000001',
  other: 'igw-00000000000000002',
});
const ROUTE_TABLE_IDS = Object.freeze({
  primary: 'rtb-00000000000000001',
  other: 'rtb-00000000000000002',
});
const VPC_CIDR = '10.42.0.0/16';
const DEFAULT_IPV4_CIDR = '0.0.0.0/0';

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

/** @param {string} internetGatewayId @param {string} routeTableId @returns {string} */
function defaultRouteProviderResourceId(internetGatewayId, routeTableId) {
  return createCanonicalJsonSha256Id({
    prefix: AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_PREFIX,
    domain: AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_DOMAIN,
    value: {
      destinationCidrBlock: DEFAULT_IPV4_CIDR,
      internetGatewayId,
      routeTableId,
    },
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
    bootstrapDigest: digest('default route resource bootstrap'),
    runtimeIdentityPolicyDigest: digest(
      'default route runtime identity policy',
    ),
  });
}

/** @param {{imageId?: string}} [options] @returns {Readonly<Record<string, any>>} */
function makeBase(options = {}) {
  const profile = validateDeploymentProfile(
    createDeploymentProfile({
      profile: { id: 'production' },
      appId: 'default-ipv4-route-resource-test',
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
      'wharfie:test:default-ipv4-route-revision:v1',
      { revision: 1 },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'default IPv4 route resource artifact',
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
  if (definition.resourceKey === 'network-subnet') {
    return 'subnet-00000000000000001';
  }
  if (definition.resourceKey === 'network-route-table') {
    return ROUTE_TABLE_IDS.primary;
  }
  if (definition.resourceKey === 'network-default-ipv4-route') {
    return defaultRouteProviderResourceId(
      INTERNET_GATEWAY_IDS.primary,
      ROUTE_TABLE_IDS.primary,
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
      definition.resourceKey === 'network-default-ipv4-route'
        ? getAwsSingleNodeDefaultIpv4RouteStateDigest(base.providerSpec)
        : definition.resourceKey === 'network-internet-gateway-attachment'
          ? getAwsSingleNodeInternetGatewayAttachmentStateDigest(
              base.providerSpec,
            )
          : definition.resourceKey === 'network-route-table'
            ? getAwsSingleNodeRouteTableStateDigest(base.providerSpec)
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
        ...(definition.resourceKey === 'network-default-ipv4-route' &&
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
          'wharfie:test:default-ipv4-route-inspection:v1',
          { operation },
        ),
      },
      actions,
    },
    { profile: base.profile },
  );
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} action @param {Record<string, any>} options */
function makeBinding(base, action, options) {
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
    dependencyBindings: options.dependencies
      .map((/** @type {Readonly<Record<string, any>>} */ binding) => ({
        resourceKey: binding.resourceKey,
        bindingId: binding.bindingId,
      }))
      .sort(
        (
          /** @type {{resourceKey: string}} */ left,
          /** @type {{resourceKey: string}} */ right,
        ) =>
          left.resourceKey < right.resourceKey
            ? -1
            : left.resourceKey > right.resourceKey
              ? 1
              : 0,
      ),
    providerType: action.before?.providerType ?? action.after.providerType,
    providerResourceId: options.providerResourceId,
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
  const indexOf = (/** @type {string} */ resourceKey) =>
    plan.actions.findIndex(
      (/** @type {Readonly<AnyRecord>} */ candidate) =>
        candidate.resourceKey === resourceKey,
    );
  const actionIndex = indexOf('network-default-ipv4-route');
  const action = plan.actions[actionIndex];
  const vpcActionIndex = indexOf('network-vpc');
  const internetGatewayActionIndex = indexOf('network-internet-gateway');
  const attachmentActionIndex = indexOf('network-internet-gateway-attachment');
  const routeTableActionIndex = indexOf('network-route-table');
  const vpcAction = plan.actions[vpcActionIndex];
  const internetGatewayAction = plan.actions[internetGatewayActionIndex];
  const attachmentAction = plan.actions[attachmentActionIndex];
  const routeTableAction = plan.actions[routeTableActionIndex];
  if (
    action === undefined ||
    vpcAction === undefined ||
    internetGatewayAction === undefined ||
    attachmentAction === undefined ||
    routeTableAction === undefined
  ) {
    throw new Error('Missing default IPv4 route dependency actions.');
  }
  const ownershipNonce = nonce(options.ownershipNonceByte ?? 83);
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
          'wharfie:test:default-ipv4-route-dependency-create-action:v1',
          { resourceKey: candidate.resourceKey },
        );
  const vpcBinding = makeBinding(base, vpcAction, {
    dependencies: [],
    providerResourceId: VPC_IDS.primary,
    ownershipNonce: intentNonces[vpcActionIndex],
    createdByActionId: dependencyReceipt(vpcAction),
  });
  const internetGatewayBinding = makeBinding(base, internetGatewayAction, {
    dependencies: [],
    providerResourceId: INTERNET_GATEWAY_IDS.primary,
    ownershipNonce: intentNonces[internetGatewayActionIndex],
    createdByActionId: dependencyReceipt(internetGatewayAction),
  });
  const attachmentBinding = makeBinding(base, attachmentAction, {
    dependencies: [vpcBinding, internetGatewayBinding],
    providerResourceId: attachmentProviderResourceId(
      INTERNET_GATEWAY_IDS.primary,
      VPC_IDS.primary,
    ),
    ownershipNonce: intentNonces[attachmentActionIndex],
    createdByActionId: dependencyReceipt(attachmentAction),
  });
  const routeTableBinding = makeBinding(base, routeTableAction, {
    dependencies: [vpcBinding],
    providerResourceId: ROUTE_TABLE_IDS.primary,
    ownershipNonce: intentNonces[routeTableActionIndex],
    createdByActionId: dependencyReceipt(routeTableAction),
  });
  const dependencies = [attachmentBinding, routeTableBinding];
  const priorBinding =
    action.action === 'create'
      ? null
      : makeBinding(base, action, {
          dependencies,
          providerResourceId: defaultRouteProviderResourceId(
            INTERNET_GATEWAY_IDS.primary,
            ROUTE_TABLE_IDS.primary,
          ),
          ownershipNonce,
          createdByActionId: semanticId(
            'wda3',
            'wharfie:test:default-ipv4-route-create-action:v1',
            { resourceKey: action.resourceKey },
          ),
        });
  const resourceBindings = [
    vpcBinding,
    internetGatewayBinding,
    attachmentBinding,
    routeTableBinding,
    ...(priorBinding === null ? [] : [priorBinding]),
  ];
  /** @type {AnyRecord|null} */
  let lastOperation = null;
  if (operation !== 'apply') {
    if (priorBinding === null) {
      throw new Error('Missing existing default IPv4 route binding.');
    }
    lastOperation = {
      kind: 'create',
      planId: semanticId(
        'wpl3',
        'wharfie:test:default-ipv4-route-last-plan:v1',
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
    attachmentBinding,
    routeTableBinding,
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

/** @param {Readonly<Record<string, any>>} binding @param {Record<string, any>} changes */
function recreateBinding(binding, changes) {
  const { bindingId: _bindingId, ...payload } = binding;
  return createDeploymentResourceBinding({ ...payload, ...changes });
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

/** @param {Record<string, any>} [overrides] */
function makeDefaultRoute(overrides = {}) {
  return {
    DestinationCidrBlock: DEFAULT_IPV4_CIDR,
    GatewayId: INTERNET_GATEWAY_IDS.primary,
    Origin: 'CreateRoute',
    State: 'active',
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @returns {Record<string, string>} */
function expectedRouteTableTags(fixture) {
  const routeTableAction = fixture.plan.actions.find(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'network-route-table',
  );
  const routeTableStateDigest =
    routeTableAction?.before?.stateDigest ??
    routeTableAction?.after?.stateDigest;
  if (routeTableStateDigest === undefined) {
    throw new Error('Missing route-table state digest.');
  }
  const createdByActionId = fixture.routeTableBinding.createdByActionId;
  const ownershipNonce = fixture.routeTableBinding.ownershipNonce;
  if (
    typeof createdByActionId !== 'string' ||
    typeof ownershipNonce !== 'string'
  ) {
    throw new Error('Missing route-table binding identity.');
  }
  return {
    'wharfie:managed-by': 'wharfie',
    'wharfie:resource-kind': 'single-node-route-table',
    'wharfie:retention': 'purge',
    'wharfie:schema-version': '2',
    'wharfie:capability': 'networking',
    'wharfie:role': 'route-table',
    'wharfie:provider-scope-id': fixture.base.providerScope.providerScopeId,
    'wharfie:deployment-instance-id': fixture.base.deploymentInstanceId,
    'wharfie:incarnation-id': fixture.base.incarnationId,
    'wharfie:resource-key': 'network-route-table',
    'wharfie:created-by-action-id': createdByActionId,
    'wharfie:ownership-nonce': ownershipNonce,
    'wharfie:state-digest': routeTableStateDigest.value,
  };
}

/** @param {Record<string, string>} tags @returns {{Key: string, Value: string}[]} */
function tagArray(tags) {
  return Object.entries(tags)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([Key, Value]) => ({ Key, Value }));
}

/** @param {ReturnType<typeof makeFixture>} fixture */
function routeTableDiscoveryFilters(fixture) {
  const tags = expectedRouteTableTags(fixture);
  return [
    'wharfie:managed-by',
    'wharfie:resource-kind',
    'wharfie:capability',
    'wharfie:role',
    'wharfie:provider-scope-id',
    'wharfie:deployment-instance-id',
    'wharfie:incarnation-id',
    'wharfie:resource-key',
  ].map((key) => ({ Name: `tag:${key}`, Values: [tags[key]] }));
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function makeRouteTable(fixture, overrides = {}) {
  return {
    Associations: [],
    OwnerId: fixture.base.providerScope.accountId,
    PropagatingVgws: [],
    RouteTableId: fixture.routeTableBinding.providerResourceId,
    Routes: [
      {
        DestinationCidrBlock: VPC_CIDR,
        GatewayId: 'local',
        Origin: 'CreateRouteTable',
        State: 'active',
      },
      makeDefaultRoute(),
    ],
    Tags: tagArray(expectedRouteTableTags(fixture)),
    VpcId: fixture.vpcBinding.providerResourceId,
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makeClient(fixture, options = {}) {
  const routeTable = options.routeTable ?? makeRouteTable(fixture);
  const internetGateway =
    options.internetGateway ?? makeInternetGateway(fixture);
  return Object.freeze({
    createRoute: options.createRoute ?? jest.fn(async () => ({ Return: true })),
    describeInternetGateways:
      options.describeInternetGateways ??
      jest.fn(async () => ({ InternetGateways: [internetGateway] })),
    describeRouteTables:
      options.describeRouteTables ??
      jest.fn(async () => ({ RouteTables: [routeTable] })),
    deleteRoute: options.deleteRoute ?? jest.fn(async () => ({ Return: true })),
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makePorts(fixture, options = {}) {
  const client = options.client ?? makeClient(fixture, options);
  const waitForRetry = options.waitForRetry ?? jest.fn();
  return {
    client,
    waitForRetry,
    resource: createAwsSingleNodeDefaultIpv4RouteResource({
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

describe('AWS single-node default IPv4 route identities', () => {
  it('derives the exact frozen state digest without dynamic endpoint IDs', () => {
    const base = makeBase();
    const observed = getAwsSingleNodeDefaultIpv4RouteStateDigest(
      base.providerSpec,
    );
    const descriptor = sortCanonicalJsonValue({
      schemaVersion: 1,
      kind: 'awsSingleNodeEc2DefaultIpv4RouteState',
      destinationCidrBlock: DEFAULT_IPV4_CIDR,
      targetKind: 'internet-gateway',
      origin: 'CreateRoute',
      state: 'active',
      onDestroy: 'purge',
    });

    expect(AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_STATE_DIGEST_DOMAIN).toBe(
      'wharfie:aws-single-node-ec2-default-ipv4-route-state:v1',
    );
    expect(observed).toEqual({
      algorithm: 'sha256',
      value: sha256Base64Url(
        `${AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
          descriptor,
        )}`,
      ),
    });
    expect(JSON.stringify(observed)).not.toContain(VPC_IDS.primary);
    expect(JSON.stringify(observed)).not.toContain(
      INTERNET_GATEWAY_IDS.primary,
    );
    expect(JSON.stringify(observed)).not.toContain(ROUTE_TABLE_IDS.primary);
    expectDeepFrozen(observed);
  });

  it('rejects a noncanonical provider spec and ignores unrelated image selection', () => {
    expect(() => getAwsSingleNodeDefaultIpv4RouteStateDigest({})).toThrow(
      TypeError,
    );
    const base = makeBase();
    const changed = JSON.parse(JSON.stringify(base.providerSpec));
    changed.capabilities.networking.egressCidr = '10.0.0.0/8';
    expect(() => getAwsSingleNodeDefaultIpv4RouteStateDigest(changed)).toThrow(
      TypeError,
    );
    const otherImage = makeBase({ imageId: 'ami-0fedcba9876543210' });
    expect(
      getAwsSingleNodeDefaultIpv4RouteStateDigest(otherImage.providerSpec),
    ).toEqual(getAwsSingleNodeDefaultIpv4RouteStateDigest(base.providerSpec));
  });

  it('derives one domain-separated provider identity from destination and endpoints', () => {
    const observed = defaultRouteProviderResourceId(
      INTERNET_GATEWAY_IDS.primary,
      ROUTE_TABLE_IDS.primary,
    );
    expect(AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_PREFIX).toBe(
      'wir1',
    );
    expect(AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_DOMAIN).toBe(
      'wharfie:aws-single-node-ec2-default-ipv4-route:v1',
    );
    expect(observed).toBe(
      createCanonicalJsonSha256Id({
        prefix: 'wir1',
        domain: 'wharfie:aws-single-node-ec2-default-ipv4-route:v1',
        value: {
          destinationCidrBlock: DEFAULT_IPV4_CIDR,
          internetGatewayId: INTERNET_GATEWAY_IDS.primary,
          routeTableId: ROUTE_TABLE_IDS.primary,
        },
      }),
    );
    expect(observed).not.toBe(
      defaultRouteProviderResourceId(
        INTERNET_GATEWAY_IDS.other,
        ROUTE_TABLE_IDS.primary,
      ),
    );
    expect(observed).not.toBe(
      defaultRouteProviderResourceId(
        INTERNET_GATEWAY_IDS.primary,
        ROUTE_TABLE_IDS.other,
      ),
    );
  });
});

describe('AWS single-node default IPv4 route create and recovery', () => {
  it('creates only after exact route-table and internet-gateway reads prove a free natural slot', async () => {
    const fixture = makeFixture();
    const missingRouteTable = makeRouteTable(fixture, {
      Routes: [makeRouteTable(fixture).Routes[0]],
    });
    const client = makeClient(fixture, { routeTable: missingRouteTable });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();

    expect(client.describeInternetGateways).toHaveBeenCalledTimes(1);
    expect(client.describeInternetGateways).toHaveBeenCalledWith({
      InternetGatewayIds: [INTERNET_GATEWAY_IDS.primary],
    });
    expect(client.describeRouteTables).toHaveBeenCalledTimes(1);
    expect(client.describeRouteTables).toHaveBeenCalledWith({
      RouteTableIds: [ROUTE_TABLE_IDS.primary],
    });
    expectDeepFrozen(client.describeInternetGateways.mock.calls[0][0]);
    expectDeepFrozen(client.describeRouteTables.mock.calls[0][0]);
    expect(client.createRoute).toHaveBeenCalledTimes(1);
    expect(client.createRoute).toHaveBeenCalledWith({
      RouteTableId: ROUTE_TABLE_IDS.primary,
      DestinationCidrBlock: DEFAULT_IPV4_CIDR,
      GatewayId: INTERNET_GATEWAY_IDS.primary,
    });
    expectDeepFrozen(client.createRoute.mock.calls[0][0]);
    expect(client.deleteRoute).not.toHaveBeenCalled();
  });

  it('does not mutate an already-present exact slot and returns one frozen derived receipt', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    const settlement = await resource.verifySettlement(fixture.context);

    expect(client.createRoute).not.toHaveBeenCalled();
    expect(client.deleteRoute).not.toHaveBeenCalled();
    expect(settlement).toEqual({
      status: 'converged',
      binding: createDeploymentResourceBinding({
        schemaVersion: 2,
        kind: 'deploymentResourceBinding',
        deploymentInstanceId: fixture.base.deploymentInstanceId,
        incarnationId: fixture.base.incarnationId,
        resourceKey: 'network-default-ipv4-route',
        capability: { kind: 'networking', version: 1 },
        role: { kind: 'default-ipv4-route', version: 1 },
        management: 'managed',
        ownershipMode: 'derived',
        onDestroy: 'purge',
        dependencyBindings: [
          {
            resourceKey: 'network-internet-gateway-attachment',
            bindingId: fixture.attachmentBinding.bindingId,
          },
          {
            resourceKey: 'network-route-table',
            bindingId: fixture.routeTableBinding.bindingId,
          },
        ],
        providerType: 'ec2-ipv4-route',
        providerResourceId: defaultRouteProviderResourceId(
          INTERNET_GATEWAY_IDS.primary,
          ROUTE_TABLE_IDS.primary,
        ),
        providerScopeId: fixture.base.providerScope.providerScopeId,
        ownershipNonce: fixture.ownershipNonce,
        createdByActionId: fixture.action.actionId,
      }),
    });
    expectDeepFrozen(settlement);
  });

  it('never treats a successful create response as settlement evidence', async () => {
    const fixture = makeFixture();
    const missingRouteTable = makeRouteTable(fixture, {
      Routes: [makeRouteTable(fixture).Routes[0]],
    });
    const createRoute = jest.fn(async () => ({
      Return: true,
      RouteTableId: ROUTE_TABLE_IDS.other,
      secret: 'mutation-response-secret',
    }));
    const client = makeClient(fixture, {
      routeTable: missingRouteTable,
      createRoute,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(createRoute).toHaveBeenCalledTimes(1);
  });

  it('recovers an ambiguous create from readback without replaying the natural slot', async () => {
    const fixture = makeFixture();
    let present = false;
    const describeRouteTables = jest.fn(async () => ({
      RouteTables: [
        makeRouteTable(fixture, {
          Routes: [
            makeRouteTable(fixture).Routes[0],
            ...(present ? [makeDefaultRoute()] : []),
          ],
        }),
      ],
    }));
    const createRoute = jest.fn(async () => {
      present = true;
      throw providerError('NetworkingError', 'lost-create-response-secret');
    });
    const client = makeClient(fixture, {
      describeRouteTables,
      createRoute,
    });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeDefaultIpv4RouteResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain(
      'lost-create-response-secret',
    );
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(createRoute).toHaveBeenCalledTimes(1);
  });

  it.each([
    'RouteAlreadyExists',
    'InvalidGatewayID.NotFound',
    'InvalidRouteTableID.NotFound',
    'IncorrectState',
    'DependencyViolation',
  ])('treats typed create %s as readback-only', async (name) => {
    const fixture = makeFixture();
    const missingRouteTable = makeRouteTable(fixture, {
      Routes: [makeRouteTable(fixture).Routes[0]],
    });
    const createRoute = jest.fn(async () => {
      throw providerError(name, 'typed-create-secret');
    });
    const client = makeClient(fixture, {
      routeTable: missingRouteTable,
      createRoute,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(createRoute).toHaveBeenCalledTimes(1);
  });

  it('preserves the exact prior binding, nonce, receipt, and two-edge lineage on noop', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    if (fixture.priorBinding === null) {
      throw new Error('Missing prior default route binding.');
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
        resourceKey: 'network-internet-gateway-attachment',
        bindingId: fixture.attachmentBinding.bindingId,
      },
      {
        resourceKey: 'network-route-table',
        bindingId: fixture.routeTableBinding.bindingId,
      },
    ]);
    expect(client.createRoute).not.toHaveBeenCalled();
    expect(client.deleteRoute).not.toHaveBeenCalled();
  });
});

describe('AWS single-node default IPv4 route provider evidence', () => {
  it('keeps a missing natural slot nonconverged and never invents a receipt', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      routeTable: makeRouteTable(fixture, {
        Routes: [makeRouteTable(fixture).Routes[0]],
      }),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(client.createRoute).not.toHaveBeenCalled();
    expect(client.deleteRoute).not.toHaveBeenCalled();
  });

  it('keeps an exact blackhole route retryable on apply and never replaces its slot', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      routeTable: makeRouteTable(fixture, {
        Routes: [
          makeRouteTable(fixture).Routes[0],
          makeDefaultRoute({ State: 'blackhole' }),
        ],
      }),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(client.createRoute).not.toHaveBeenCalled();
  });

  it.each([
    [
      'wrong gateway target',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRouteTable(fixture, {
          Routes: [
            makeRouteTable(fixture).Routes[0],
            makeDefaultRoute({ GatewayId: INTERNET_GATEWAY_IDS.other }),
          ],
        }),
    ],
    [
      'wrong origin',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRouteTable(fixture, {
          Routes: [
            makeRouteTable(fixture).Routes[0],
            makeDefaultRoute({ Origin: 'Advertisement' }),
          ],
        }),
    ],
    [
      'unrelated nonlocal route',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRouteTable(fixture, {
          Routes: [
            makeRouteTable(fixture).Routes[0],
            makeDefaultRoute({ DestinationCidrBlock: '10.99.0.0/16' }),
          ],
        }),
    ],
    [
      'duplicate desired routes',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRouteTable(fixture, {
          Routes: [
            makeRouteTable(fixture).Routes[0],
            makeDefaultRoute(),
            makeDefaultRoute(),
          ],
        }),
    ],
    [
      'missing intrinsic local route',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRouteTable(fixture, { Routes: [makeDefaultRoute()] }),
    ],
    [
      'foreign route-table owner',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRouteTable(fixture, { OwnerId: '999999999999' }),
    ],
    [
      'different VPC',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRouteTable(fixture, { VpcId: VPC_IDS.other }),
    ],
    [
      'different exact route-table ID',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRouteTable(fixture, { RouteTableId: ROUTE_TABLE_IDS.other }),
    ],
    [
      'wrong ownership tag',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => {
        const tags = tagArray(expectedRouteTableTags(fixture));
        const roleTag = tags.find((tag) => tag.Key === 'wharfie:role');
        if (roleTag === undefined) throw new Error('Missing role tag.');
        roleTag.Value = 'other';
        return makeRouteTable(fixture, { Tags: tags });
      },
    ],
  ])('blocks a present %s without mutation', async (_name, evidence) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, { routeTable: evidence(fixture) });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeDefaultIpv4RouteResourceConflictError,
    );
    expect(client.createRoute).not.toHaveBeenCalled();
    expect(client.deleteRoute).not.toHaveBeenCalled();
  });

  it.each([
    [
      'malformed route array',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        routeTable: makeRouteTable(fixture, { Routes: null }),
      }),
    ],
    [
      'malformed route origin',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        routeTable: makeRouteTable(fixture, {
          Routes: [
            makeRouteTable(fixture).Routes[0],
            makeDefaultRoute({ Origin: null }),
          ],
        }),
      }),
    ],
    [
      'malformed route-table tags',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        routeTable: makeRouteTable(fixture, { Tags: null }),
      }),
    ],
    [
      'malformed gateway attachments',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        internetGateway: makeInternetGateway(fixture, { Attachments: null }),
      }),
    ],
  ])('maps %s to one fixed unknown error', async (_name, evidence) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, evidence(fixture));
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeDefaultIpv4RouteResourceUnknownError);
    expect(client.createRoute).not.toHaveBeenCalled();
    expect(client.deleteRoute).not.toHaveBeenCalled();
  });

  it.each([
    [
      'wrong gateway ID',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeInternetGateway(fixture, {
          InternetGatewayId: INTERNET_GATEWAY_IDS.other,
        }),
    ],
    [
      'foreign gateway owner',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeInternetGateway(fixture, { OwnerId: '999999999999' }),
    ],
    [
      'attachment to another VPC',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeInternetGateway(fixture, {
          Attachments: [{ State: 'available', VpcId: VPC_IDS.other }],
        }),
    ],
    [
      'multiple attachments',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeInternetGateway(fixture, {
          Attachments: [
            { State: 'available', VpcId: VPC_IDS.primary },
            { State: 'available', VpcId: VPC_IDS.other },
          ],
        }),
    ],
  ])(
    'blocks %s even when the route-table slot is desired',
    async (_name, igw) => {
      const fixture = makeFixture();
      const client = makeClient(fixture, { internetGateway: igw(fixture) });
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'blocked',
        },
      );
      expect(client.createRoute).not.toHaveBeenCalled();
    },
  );

  it.each([
    [[]],
    [[{ State: 'attaching', VpcId: VPC_IDS.primary }]],
    [[{ State: 'detaching', VpcId: VPC_IDS.primary }]],
  ])(
    'keeps gateway attachment evidence %p nonconverged',
    async (attachments) => {
      const fixture = makeFixture();
      const client = makeClient(fixture, {
        internetGateway: makeInternetGateway(fixture, {
          Attachments: attachments,
        }),
      });
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'not-converged',
        },
      );
      expect(client.createRoute).not.toHaveBeenCalled();
    },
  );

  it('keeps an exact parent typed-not-found nonconverged on create', async () => {
    const fixture = makeFixture();
    const describeRouteTables = jest.fn(async () => {
      throw providerError(
        'InvalidRouteTableID.NotFound',
        'missing-parent-secret',
      );
    });
    const client = makeClient(fixture, { describeRouteTables });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.createRoute).not.toHaveBeenCalled();
  });

  it.each(['route table', 'internet gateway'])(
    'does not accept a successful exact-ID empty %s response as absence',
    async (endpoint) => {
      const fixture = makeFixture();
      const client = makeClient(fixture, {
        ...(endpoint === 'route table'
          ? {
              describeRouteTables: jest.fn(async () => ({ RouteTables: [] })),
            }
          : {
              describeInternetGateways: jest.fn(async () => ({
                InternetGateways: [],
              })),
            }),
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.verifySettlement(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeDefaultIpv4RouteResourceUnknownError,
      );
      await expect(
        resource.executeAction(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeDefaultIpv4RouteResourceUnknownError,
      );
      expect(client.createRoute).not.toHaveBeenCalled();
    },
  );

  it('blocks stable missing evidence for a durable noop receipt', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const client = makeClient(fixture, {
      routeTable: makeRouteTable(fixture, {
        Routes: [makeRouteTable(fixture).Routes[0]],
      }),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('keeps a blackhole durable noop route retryable', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const client = makeClient(fixture, {
      routeTable: makeRouteTable(fixture, {
        Routes: [
          makeRouteTable(fixture).Routes[0],
          makeDefaultRoute({ State: 'blackhole' }),
        ],
      }),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
  });

  it('allows one valid nonmain subnet association only while reconciling', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const association = {
      AssociationState: { State: 'associated' },
      Main: false,
      RouteTableAssociationId: 'rtbassoc-00000000000000001',
      RouteTableId: ROUTE_TABLE_IDS.primary,
      SubnetId: 'subnet-00000000000000001',
    };
    const client = makeClient(fixture, {
      routeTable: makeRouteTable(fixture, {
        Associations: [association],
      }),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: fixture.priorBinding,
    });
  });

  it('retries transient evidence within the explicit bound and waits only between attempts', async () => {
    const fixture = makeFixture();
    let read = 0;
    const describeRouteTables = jest.fn(async () => {
      read += 1;
      return {
        RouteTables: [
          makeRouteTable(fixture, {
            Routes: [
              makeRouteTable(fixture).Routes[0],
              makeDefaultRoute({ State: read === 1 ? 'blackhole' : 'active' }),
            ],
          }),
        ],
      };
    });
    const waitForRetry = jest.fn();
    const client = makeClient(fixture, { describeRouteTables });
    const { resource } = makePorts(fixture, {
      client,
      maxAttempts: 2,
      waitForRetry,
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(describeRouteTables).toHaveBeenCalledTimes(2);
    expect(waitForRetry).toHaveBeenCalledTimes(1);
    expect(waitForRetry).toHaveBeenCalledWith(1);
  });

  it('sanitizes provider and retry-waiter failures', async () => {
    const fixture = makeFixture();
    const describeRouteTables = jest.fn(async () => {
      throw providerError('NetworkingError', 'provider-read-secret');
    });
    const client = makeClient(fixture, { describeRouteTables });
    const { resource } = makePorts(fixture, { client });
    const observed = await resource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);

    expect(observed).toBeInstanceOf(
      AwsSingleNodeDefaultIpv4RouteResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('provider-read-secret');

    const transientClient = makeClient(fixture, {
      internetGateway: makeInternetGateway(fixture, { Attachments: [] }),
    });
    const waiter = jest.fn(async () => {
      throw new Error('waiter-secret');
    });
    const retrying = makePorts(fixture, {
      client: transientClient,
      maxAttempts: 2,
      waitForRetry: waiter,
    }).resource;
    const waiterError = await retrying
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(waiterError).toBeInstanceOf(
      AwsSingleNodeDefaultIpv4RouteResourceUnknownError,
    );
    expect(JSON.stringify(waiterError)).not.toContain('waiter-secret');
  });
});

describe('AWS single-node default IPv4 route destroy', () => {
  it.each(['active', 'blackhole'])(
    'deletes the exact %s owned slot without requiring current gateway state',
    async (state) => {
      const fixture = makeFixture({ operation: 'destroy' });
      const routeTable = makeRouteTable(fixture, {
        Routes: [
          makeRouteTable(fixture).Routes[0],
          makeDefaultRoute({ State: state }),
        ],
      });
      const describeInternetGateways = jest.fn(async () => {
        throw new Error('destroy must not read the gateway');
      });
      const client = makeClient(fixture, {
        routeTable,
        describeInternetGateways,
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();

      expect(describeInternetGateways).not.toHaveBeenCalled();
      expect(client.deleteRoute).toHaveBeenCalledTimes(1);
      expect(client.deleteRoute).toHaveBeenCalledWith({
        RouteTableId: ROUTE_TABLE_IDS.primary,
        DestinationCidrBlock: DEFAULT_IPV4_CIDR,
      });
      expectDeepFrozen(client.deleteRoute.mock.calls[0][0]);
      expect(client.createRoute).not.toHaveBeenCalled();
    },
  );

  it('settles null from an exact owned parent whose natural slot is absent', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, {
      routeTable: makeRouteTable(fixture, {
        Routes: [makeRouteTable(fixture).Routes[0]],
      }),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(client.deleteRoute).not.toHaveBeenCalled();
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
  });

  it('requires tag-filtered broad absence to corroborate exact parent NotFound', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ input) => {
        if (input.RouteTableIds) {
          throw providerError('InvalidRouteTableID.NotFound');
        }
        return { RouteTables: [] };
      },
    );
    const client = makeClient(fixture, { describeRouteTables });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(describeRouteTables).toHaveBeenCalledTimes(2);
    expect(describeRouteTables.mock.calls[0][0]).toEqual({
      RouteTableIds: [ROUTE_TABLE_IDS.primary],
    });
    expect(describeRouteTables.mock.calls[1][0]).toEqual({
      Filters: routeTableDiscoveryFilters(fixture),
      MaxResults: 100,
    });
    expectDeepFrozen(describeRouteTables.mock.calls[1][0]);
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
  });

  it('keeps exact NotFound plus a broadly present exact parent nonconverged', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ input) => {
        if (input.RouteTableIds) {
          throw providerError('InvalidRouteTableID.NotFound');
        }
        return { RouteTables: [makeRouteTable(fixture)] };
      },
    );
    const client = makeClient(fixture, { describeRouteTables });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.deleteRoute).not.toHaveBeenCalled();
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
  });

  it('does not settle a lone exact NotFound when broad corroboration is unavailable', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ input) => {
        if (input.RouteTableIds) {
          throw providerError('InvalidRouteTableID.NotFound');
        }
        throw providerError('NetworkingError', 'broad-read-secret');
      },
    );
    const client = makeClient(fixture, { describeRouteTables });
    const { resource } = makePorts(fixture, { client });
    const observed = await resource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);

    expect(observed).toBeInstanceOf(
      AwsSingleNodeDefaultIpv4RouteResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('broad-read-secret');
    expect(client.deleteRoute).not.toHaveBeenCalled();
  });

  it('ignores a successful delete response and remains unsettled while the route is present', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const deleteRoute = jest.fn(async () => ({
      Return: true,
      secret: 'delete-response-secret',
    }));
    const client = makeClient(fixture, { deleteRoute });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(deleteRoute).toHaveBeenCalledTimes(1);
  });

  it('recovers a lost delete response from route-table readback without replay', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    let present = true;
    const describeRouteTables = jest.fn(async () => ({
      RouteTables: [
        makeRouteTable(fixture, {
          Routes: [
            makeRouteTable(fixture).Routes[0],
            ...(present ? [makeDefaultRoute()] : []),
          ],
        }),
      ],
    }));
    const deleteRoute = jest.fn(async () => {
      present = false;
      throw providerError('NetworkingError', 'lost-delete-response-secret');
    });
    const client = makeClient(fixture, {
      describeRouteTables,
      deleteRoute,
    });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeDefaultIpv4RouteResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain(
      'lost-delete-response-secret',
    );
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(deleteRoute).toHaveBeenCalledTimes(1);
  });

  it.each([
    'InvalidRoute.NotFound',
    'InvalidRouteTableID.NotFound',
    'IncorrectState',
    'DependencyViolation',
  ])('treats typed delete %s as readback-only', async (name) => {
    const fixture = makeFixture({ operation: 'destroy' });
    const deleteRoute = jest.fn(async () => {
      throw providerError(name, 'typed-delete-secret');
    });
    const client = makeClient(fixture, { deleteRoute });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(deleteRoute).toHaveBeenCalledTimes(1);
  });

  it('never deletes a conflicting destination slot', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, {
      routeTable: makeRouteTable(fixture, {
        Routes: [
          makeRouteTable(fixture).Routes[0],
          makeDefaultRoute({ GatewayId: INTERNET_GATEWAY_IDS.other }),
        ],
      }),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeDefaultIpv4RouteResourceConflictError,
    );
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.deleteRoute).not.toHaveBeenCalled();
  });

  it('keeps deletion retryable while the prior subnet association remains visible', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, {
      routeTable: makeRouteTable(fixture, {
        Associations: [
          {
            AssociationState: { State: 'associated' },
            Main: false,
            RouteTableAssociationId: 'rtbassoc-00000000000000001',
            RouteTableId: ROUTE_TABLE_IDS.primary,
            SubnetId: 'subnet-00000000000000001',
          },
        ],
      }),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.deleteRoute).not.toHaveBeenCalled();
  });
});

describe('AWS single-node default IPv4 route controller authority', () => {
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
      'the wrong ownership nonce',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        ownershipNonce: nonce(99),
      }),
      AwsSingleNodeDefaultIpv4RouteResourceConflictError,
    ],
    [
      'the wrong action index',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        actionIndex: 0,
      }),
      AwsSingleNodeDefaultIpv4RouteResourceConflictError,
    ],
    [
      'a blocked operation',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        head: recreateHead(fixture, {
          activeOperation: { status: 'blocked' },
        }),
      }),
      AwsSingleNodeDefaultIpv4RouteResourceConflictError,
    ],
  ])('rejects %s before provider access', async (_name, mutate, ErrorType) => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(mutate(fixture)),
    ).rejects.toBeInstanceOf(ErrorType);
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
    expect(client.describeRouteTables).not.toHaveBeenCalled();
    expect(client.createRoute).not.toHaveBeenCalled();
  });

  it.each([
    'network-vpc',
    'network-internet-gateway',
    'network-internet-gateway-attachment',
    'network-route-table',
  ])(
    'requires the exact %s receipt before provider access',
    async (resourceKey) => {
      const fixture = makeFixture();
      const head = JSON.parse(JSON.stringify(fixture.head));
      head.resourceBindings = head.resourceBindings.filter(
        (/** @type {Readonly<AnyRecord>} */ binding) =>
          binding.resourceKey !== resourceKey,
      );
      const client = makeClient(fixture);
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction({ ...fixture.context, head }),
      ).rejects.toBeInstanceOf(Error);
      expect(client.describeInternetGateways).not.toHaveBeenCalled();
      expect(client.describeRouteTables).not.toHaveBeenCalled();
    },
  );

  it('requires every apply dependency action to be settled', async () => {
    const fixture = makeFixture();
    const head = JSON.parse(JSON.stringify(fixture.head));
    const dependencyIndex = fixture.plan.actions.findIndex(
      (/** @type {Readonly<AnyRecord>} */ action) =>
        action.resourceKey === 'network-internet-gateway-attachment',
    );
    head.activeOperation.intents[dependencyIndex].status = 'pending';
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction({ ...fixture.context, head }),
    ).rejects.toBeInstanceOf(Error);
    expect(client.describeRouteTables).not.toHaveBeenCalled();
  });

  it('requires every reverse-destroy dependency action to remain pending', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const head = JSON.parse(JSON.stringify(fixture.head));
    const dependencyIndex = fixture.plan.actions.findIndex(
      (/** @type {Readonly<AnyRecord>} */ action) =>
        action.resourceKey === 'network-route-table',
    );
    head.activeOperation.intents[dependencyIndex].status = 'settled';
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction({ ...fixture.context, head }),
    ).rejects.toBeInstanceOf(Error);
    expect(client.describeRouteTables).not.toHaveBeenCalled();
  });

  it('rejects an attachment identity that does not prove the exact gateway and VPC pair', async () => {
    const fixture = makeFixture();
    const wrongAttachment = recreateBinding(fixture.attachmentBinding, {
      providerResourceId: attachmentProviderResourceId(
        INTERNET_GATEWAY_IDS.primary,
        VPC_IDS.other,
      ),
    });
    const head = recreateHead(fixture, {
      resourceBindings: fixture.head.resourceBindings.map(
        (/** @type {Readonly<AnyRecord>} */ binding) =>
          binding.resourceKey === wrongAttachment.resourceKey
            ? wrongAttachment
            : binding,
      ),
    });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction({ ...fixture.context, head }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeDefaultIpv4RouteResourceConflictError,
    );
    expect(client.describeRouteTables).not.toHaveBeenCalled();
  });

  it('rejects reconstructed attachment and route-table receipts with wrong transitive lineage', async () => {
    const fixture = makeFixture();
    const wrongAttachment = recreateBinding(fixture.attachmentBinding, {
      dependencyBindings: [
        {
          resourceKey: fixture.internetGatewayBinding.resourceKey,
          bindingId: fixture.internetGatewayBinding.bindingId,
        },
      ],
    });
    const wrongRouteTable = recreateBinding(fixture.routeTableBinding, {
      dependencyBindings: [
        {
          resourceKey: fixture.internetGatewayBinding.resourceKey,
          bindingId: fixture.internetGatewayBinding.bindingId,
        },
      ],
    });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    for (const replacement of [wrongAttachment, wrongRouteTable]) {
      const head = recreateHead(fixture, {
        resourceBindings: fixture.head.resourceBindings.map(
          (/** @type {Readonly<AnyRecord>} */ binding) =>
            binding.resourceKey === replacement.resourceKey
              ? replacement
              : binding,
        ),
      });
      await expect(
        resource.executeAction({ ...fixture.context, head }),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeDefaultIpv4RouteResourceConflictError,
      );
    }
    expect(client.describeRouteTables).not.toHaveBeenCalled();
  });

  it('rejects a dependency action whose state digest does not match its own driver contract', async () => {
    const fixture = makeFixture();
    const plan = JSON.parse(JSON.stringify(fixture.plan));
    const dependencyIndex = plan.actions.findIndex(
      (/** @type {Readonly<AnyRecord>} */ action) =>
        action.resourceKey === 'network-route-table',
    );
    plan.actions[dependencyIndex].after.stateDigest = digest('wrong state');
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction({ ...fixture.context, plan }),
    ).rejects.toBeInstanceOf(Error);
    expect(client.describeRouteTables).not.toHaveBeenCalled();
  });

  it('rejects a structurally valid prior receipt with the wrong identity or direct lineage', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    if (fixture.priorBinding === null) {
      throw new Error('Missing prior default route binding.');
    }
    const wrongIdentity = recreateBinding(fixture.priorBinding, {
      providerResourceId: defaultRouteProviderResourceId(
        INTERNET_GATEWAY_IDS.other,
        ROUTE_TABLE_IDS.primary,
      ),
    });
    const wrongLineage = recreateBinding(fixture.priorBinding, {
      dependencyBindings: [
        {
          resourceKey: fixture.attachmentBinding.resourceKey,
          bindingId: fixture.attachmentBinding.bindingId,
        },
      ],
    });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    for (const replacement of [wrongIdentity, wrongLineage]) {
      const head = recreateHead(fixture, {
        resourceBindings: fixture.head.resourceBindings.map(
          (/** @type {Readonly<AnyRecord>} */ binding) =>
            binding.resourceKey === replacement.resourceKey
              ? replacement
              : binding,
        ),
      });
      await expect(
        resource.verifySettlement({ ...fixture.context, head }),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeDefaultIpv4RouteResourceConflictError,
      );
    }
    expect(client.describeRouteTables).not.toHaveBeenCalled();
  });

  it('accepts and ignores an opaque controller-owned artifact receipt', async () => {
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
});

describe('AWS single-node default IPv4 route factory contract', () => {
  it('returns only frozen ports and never closes the caller client', () => {
    const fixture = makeFixture();
    const client = { ...makeClient(fixture), close: jest.fn() };
    const resource = createAwsSingleNodeDefaultIpv4RouteResource({
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
      createAwsSingleNodeDefaultIpv4RouteResource({
        client,
        providerScope: fixture.base.providerScope,
        extra: true,
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeDefaultIpv4RouteResource({
        client: {},
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(TypeError);
    for (const method of [
      'createRoute',
      'describeInternetGateways',
      'describeRouteTables',
      'deleteRoute',
    ]) {
      expect(() =>
        createAwsSingleNodeDefaultIpv4RouteResource({
          client: { ...client, [method]: null },
          providerScope: fixture.base.providerScope,
        }),
      ).toThrow(TypeError);
    }
    for (const maxAttempts of [
      0,
      1.5,
      AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_MAX_ATTEMPTS + 1,
    ]) {
      expect(() =>
        createAwsSingleNodeDefaultIpv4RouteResource({
          client,
          providerScope: fixture.base.providerScope,
          maxAttempts,
        }),
      ).toThrow(TypeError);
    }
    expect(() =>
      createAwsSingleNodeDefaultIpv4RouteResource({
        client,
        providerScope: {},
      }),
    ).toThrow(TypeError);
  });

  it('exports explicit retry bounds and fixed non-echoing public errors', () => {
    expect(AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_MAX_ATTEMPTS).toBe(10);

    const conflict = Reflect.construct(
      AwsSingleNodeDefaultIpv4RouteResourceConflictError,
      ['secret'],
    );
    expect(conflict.name).toBe(
      'AwsSingleNodeDefaultIpv4RouteResourceConflictError',
    );
    expect(conflict.code).toBe(
      'AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_RESOURCE_CONFLICT',
    );
    expect(conflict.message).toBe(
      'AWS single-node default IPv4 route conflicts with its exact contract.',
    );
    expect(JSON.stringify(conflict)).not.toContain('secret');

    const unknown = Reflect.construct(
      AwsSingleNodeDefaultIpv4RouteResourceUnknownError,
      ['secret'],
    );
    expect(unknown.name).toBe(
      'AwsSingleNodeDefaultIpv4RouteResourceUnknownError',
    );
    expect(unknown.code).toBe(
      'AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_RESOURCE_UNKNOWN',
    );
    expect(unknown.message).toBe(
      'AWS single-node default IPv4 route state is unknown.',
    );
    expect(JSON.stringify(unknown)).not.toContain('secret');
  });
});
