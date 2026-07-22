import { describe, expect, it, jest } from '@jest/globals';

import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_ROUTE_TABLE_CREATE_CLIENT_TOKEN_DOMAIN,
  AWS_SINGLE_NODE_ROUTE_TABLE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_ROUTE_TABLE_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_ROUTE_TABLE_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_ROUTE_TABLE_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_ROUTE_TABLE_STATE_DIGEST_DOMAIN,
  AwsSingleNodeRouteTableResourceConflictError,
  AwsSingleNodeRouteTableResourceUnknownError,
  createAwsSingleNodeRouteTableResource,
  getAwsSingleNodeRouteTableCreateClientToken,
  getAwsSingleNodeRouteTableStateDigest,
} from '../../src/core/runtime/deployment-aws-route-table-resource.js';
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

const ROUTE_TABLE_IDS = Object.freeze({
  primary: 'rtb-00000000000000001',
  duplicate: 'rtb-00000000000000002',
  replacement: 'rtb-00000000000000003',
});
const VPC_IDS = Object.freeze({
  primary: 'vpc-00000000000000001',
  other: 'vpc-00000000000000002',
});
const VPC_CIDR = '10.42.0.0/16';
const OTHER_VPC_CIDR = '10.43.0.0/16';
const AVAILABILITY_ZONE_ID = 'use1-az1';
const ASSOCIATION_ID = 'rtbassoc-00000000000000001';
const SUBNET_ID = 'subnet-00000000000000001';
const INTERNET_GATEWAY_ID = 'igw-00000000000000001';

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
    },
    placement: { availabilityZoneId: AVAILABILITY_ZONE_ID },
    storage: {
      ebsKmsKeyArn:
        'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    },
    bootstrapDigest: digest('route-table resource bootstrap'),
  });
}

/** @param {{imageId?: string}} [options] @returns {Readonly<Record<string, any>>} */
function makeBase(options = {}) {
  const profile = validateDeploymentProfile(
    createDeploymentProfile({
      profile: { id: 'production' },
      appId: 'route-table-resource-test',
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
    revisionId: semanticId('wrv1', 'wharfie:test:route-table-revision:v1', {
      revision: 1,
    }),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'route-table resource artifact',
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
  if (definition.resourceKey === 'network-subnet') return SUBNET_ID;
  if (definition.resourceKey === 'network-route-table') {
    return ROUTE_TABLE_IDS.primary;
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
      definition.resourceKey === 'network-route-table'
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
        ...(definition.resourceKey === 'network-route-table' &&
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
          'wharfie:test:route-table-inspection:v1',
          {
            operation,
          },
        ),
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
function makeRouteTableBinding(base, action, vpcBinding, options) {
  return createDeploymentResourceBinding({
    schemaVersion: 2,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    resourceKey: 'network-route-table',
    capability: action.capability,
    role: action.role,
    management: 'managed',
    ownershipMode: 'direct',
    onDestroy: 'purge',
    dependencyBindings: [
      { resourceKey: 'network-vpc', bindingId: vpcBinding.bindingId },
    ],
    providerType: 'ec2-route-table',
    providerResourceId: options.providerResourceId ?? ROUTE_TABLE_IDS.primary,
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
      action.resourceKey === 'network-route-table',
  );
  const vpcActionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'network-vpc',
  );
  const action = plan.actions[actionIndex];
  const vpcAction = plan.actions[vpcActionIndex];
  if (action === undefined || vpcAction === undefined) {
    throw new Error('Missing route table or VPC action.');
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
      : semanticId('wda3', 'wharfie:test:route-table-vpc-create-action:v1', {
          resourceKey: 'network-vpc',
        });
  const vpcBinding = makeVpcBinding(base, vpcAction, {
    ownershipNonce: intentNonces[vpcActionIndex],
    createdByActionId: vpcCreatedByActionId,
  });
  const priorBinding =
    action.action === 'create'
      ? null
      : makeRouteTableBinding(base, action, vpcBinding, {
          ownershipNonce,
          createdByActionId: semanticId(
            'wda3',
            'wharfie:test:route-table-create-action:v1',
            { resourceKey: 'network-route-table' },
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
          planId: semanticId('wpl3', 'wharfie:test:route-table-last-plan:v1', {
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
    'wharfie:resource-kind': 'single-node-route-table',
    'wharfie:retention': 'purge',
    'wharfie:schema-version': '2',
    'wharfie:capability': 'networking',
    'wharfie:role': 'route-table',
    'wharfie:provider-scope-id': fixture.base.providerScope.providerScopeId,
    'wharfie:deployment-instance-id': fixture.base.deploymentInstanceId,
    'wharfie:incarnation-id': fixture.base.incarnationId,
    'wharfie:resource-key': 'network-route-table',
    'wharfie:created-by-action-id':
      fixture.priorBinding?.createdByActionId ?? fixture.action.actionId,
    'wharfie:ownership-nonce': fixture.ownershipNonce,
    'wharfie:state-digest': getAwsSingleNodeRouteTableStateDigest(
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
function makeRouteTable(fixture, overrides = {}) {
  return {
    Associations: [],
    OwnerId: fixture.base.providerScope.accountId,
    PropagatingVgws: [],
    RouteTableId: ROUTE_TABLE_IDS.primary,
    Routes: [
      {
        DestinationCidrBlock: VPC_CIDR,
        GatewayId: 'local',
        Origin: 'CreateRouteTable',
        State: 'active',
      },
    ],
    Tags: tagArray(expectedTags(fixture)),
    VpcId: fixture.vpcBinding.providerResourceId,
    ...overrides,
  };
}

/** @param {Readonly<Record<string, any>>} request @returns {'exact'|'logical'} */
function requestKind(request) {
  if (request.RouteTableIds) return 'exact';
  return 'logical';
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makeClient(fixture, options = {}) {
  const exact = options.exact ?? makeRouteTable(fixture);
  const logical = options.logical ?? [exact];
  return Object.freeze({
    createRouteTable:
      options.createRouteTable ?? jest.fn(async () => createResponse(fixture)),
    describeRouteTables:
      options.describeRouteTables ??
      jest.fn(async (/** @type {AnyRecord} */ input) => ({
        RouteTables: requestKind(input) === 'exact' ? [exact] : logical,
      })),
    deleteRouteTable: options.deleteRouteTable ?? jest.fn(async () => ({})),
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makePorts(fixture, options = {}) {
  const client = options.client ?? makeClient(fixture, options);
  const waitForRetry = options.waitForRetry ?? jest.fn();
  return {
    client,
    waitForRetry,
    resource: createAwsSingleNodeRouteTableResource({
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

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function createResponse(fixture, overrides = {}) {
  return {
    ClientToken: getAwsSingleNodeRouteTableCreateClientToken(
      fixture.action.actionId,
      fixture.ownershipNonce,
    ),
    RouteTable: { RouteTableId: ROUTE_TABLE_IDS.primary },
    ...overrides,
  };
}

/** @returns {Readonly<Record<string, any>>} */
function defaultRoute() {
  return Object.freeze({
    DestinationCidrBlock: '0.0.0.0/0',
    GatewayId: INTERNET_GATEWAY_ID,
    Origin: 'CreateRoute',
    State: 'active',
  });
}

/** @returns {Readonly<Record<string, any>>} */
function subnetAssociation() {
  return Object.freeze({
    AssociationState: { State: 'associated' },
    Main: false,
    RouteTableAssociationId: ASSOCIATION_ID,
    RouteTableId: ROUTE_TABLE_IDS.primary,
    SubnetId: SUBNET_ID,
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function makeRouteTableWithDescendants(fixture, overrides = {}) {
  return makeRouteTable(fixture, {
    Associations: [subnetAssociation()],
    Routes: [...makeRouteTable(fixture).Routes, defaultRoute()],
    ...overrides,
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture */
function logicalFilters(fixture) {
  return [
    { Name: 'tag:wharfie:managed-by', Values: ['wharfie'] },
    {
      Name: 'tag:wharfie:resource-kind',
      Values: ['single-node-route-table'],
    },
    { Name: 'tag:wharfie:capability', Values: ['networking'] },
    { Name: 'tag:wharfie:role', Values: ['route-table'] },
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
    { Name: 'tag:wharfie:resource-key', Values: ['network-route-table'] },
  ];
}

describe('AWS single-node route-table intrinsic identities', () => {
  it('derives the exact domain-separated state digest and excludes dynamic VPC identity', () => {
    const base = makeBase();
    const observed = getAwsSingleNodeRouteTableStateDigest(base.providerSpec);
    const descriptor = sortCanonicalJsonValue({
      schemaVersion: 1,
      kind: 'awsSingleNodeEc2RouteTableState',
      localIpv4Route: {
        destinationCidrBlock: VPC_CIDR,
        gatewayId: 'local',
        origin: 'CreateRouteTable',
        state: 'active',
      },
      main: false,
      propagatingVirtualGateways: [],
      onDestroy: 'purge',
    });

    expect(AWS_SINGLE_NODE_ROUTE_TABLE_STATE_DIGEST_DOMAIN).toBe(
      'wharfie:aws-single-node-ec2-route-table-state:v1',
    );
    expect(observed).toEqual({
      algorithm: 'sha256',
      value: sha256Base64Url(
        `${AWS_SINGLE_NODE_ROUTE_TABLE_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
          descriptor,
        )}`,
      ),
    });
    expect(JSON.stringify(observed)).not.toContain(VPC_IDS.primary);
    expectDeepFrozen(observed);
  });

  it('rejects noncanonical CIDR changes but ignores unrelated machine-image selection', () => {
    const base = makeBase();
    const changed = JSON.parse(JSON.stringify(base.providerSpec));
    changed.capabilities.networking.vpcCidr = OTHER_VPC_CIDR;
    expect(() => getAwsSingleNodeRouteTableStateDigest(changed)).toThrow(
      TypeError,
    );
    const otherImage = makeBase({ imageId: 'ami-0fedcba9876543210' });
    expect(
      getAwsSingleNodeRouteTableStateDigest(otherImage.providerSpec),
    ).toEqual(getAwsSingleNodeRouteTableStateDigest(base.providerSpec));
    expect(() => getAwsSingleNodeRouteTableStateDigest({})).toThrow(TypeError);
  });

  it('derives one stable lowercase 64-hex create token from action ID and nonce', () => {
    const fixture = makeFixture();
    const token = getAwsSingleNodeRouteTableCreateClientToken(
      fixture.action.actionId,
      fixture.ownershipNonce,
    );
    const payload = JSON.stringify(
      sortCanonicalJsonValue({
        actionId: fixture.action.actionId,
        ownershipNonce: fixture.ownershipNonce,
      }),
    );
    const expected = Buffer.from(
      sha256Base64Url(
        `${AWS_SINGLE_NODE_ROUTE_TABLE_CREATE_CLIENT_TOKEN_DOMAIN}\0${payload}`,
      ),
      'base64url',
    ).toString('hex');

    expect(AWS_SINGLE_NODE_ROUTE_TABLE_CREATE_CLIENT_TOKEN_DOMAIN).toBe(
      'wharfie:aws-single-node-ec2-route-table-create-client-token:v1',
    );
    expect(token).toBe(expected);
    expect(token).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      getAwsSingleNodeRouteTableCreateClientToken(
        fixture.action.actionId,
        nonce(99),
      ),
    ).not.toBe(token);
    expect(() =>
      getAwsSingleNodeRouteTableCreateClientToken(
        'not-an-action-id',
        fixture.ownershipNonce,
      ),
    ).toThrow(TypeError);
  });
});

describe('AWS single-node route-table create and token recovery', () => {
  it('submits one exact frozen create with a stable token and thirteen atomic tags', async () => {
    const fixture = makeFixture();
    const createRouteTable = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ _request) =>
        createResponse(fixture),
    );
    const client = makeClient(fixture, { logical: [], createRouteTable });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();

    expect(createRouteTable).toHaveBeenCalledTimes(1);
    const request = createRouteTable.mock.calls[0]?.[0];
    expect(request).toEqual({
      ClientToken: getAwsSingleNodeRouteTableCreateClientToken(
        fixture.action.actionId,
        fixture.ownershipNonce,
      ),
      TagSpecifications: [
        {
          ResourceType: 'route-table',
          Tags: tagArray(expectedTags(fixture)),
        },
      ],
      VpcId: VPC_IDS.primary,
    });
    expect(request.TagSpecifications[0].Tags).toHaveLength(13);
    expect(Object.keys(request).sort()).toEqual([
      'ClientToken',
      'TagSpecifications',
      'VpcId',
    ]);
    expectDeepFrozen(request);
    expect(client.deleteRouteTable).not.toHaveBeenCalled();
  });

  it('allows only identical token-backed replay across uncertain response boundaries', async () => {
    const fixture = makeFixture();
    const createRouteTable = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ _request) => {
        throw providerError('NetworkingError', 'lost-create-secret');
      },
    );
    const client = makeClient(fixture, { logical: [], createRouteTable });
    const first = makePorts(fixture, { client }).resource;

    for (let call = 0; call < 2; call += 1) {
      const observed = await first
        .executeAction(fixture.context)
        .catch((/** @type {unknown} */ error) => error);
      expect(observed).toBeInstanceOf(
        AwsSingleNodeRouteTableResourceUnknownError,
      );
      expect(JSON.stringify(observed)).not.toContain('lost-create-secret');
    }
    const fresh = makePorts(fixture, { client }).resource;
    await expect(fresh.executeAction(fixture.context)).rejects.toBeInstanceOf(
      AwsSingleNodeRouteTableResourceUnknownError,
    );

    expect(createRouteTable).toHaveBeenCalledTimes(3);
    const requests = createRouteTable.mock.calls.map(([request]) => request);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[2]).toEqual(requests[0]);
    for (const request of requests) expectDeepFrozen(request);
  });

  it('rejects a different candidate identity returned by a replay of the same token', async () => {
    const fixture = makeFixture();
    let creates = 0;
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => {
        if (requestKind(request) === 'exact') {
          throw providerError('InvalidRouteTableID.NotFound');
        }
        return { RouteTables: [] };
      },
    );
    const createRouteTable = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ _request) => {
        creates += 1;
        return createResponse(fixture, {
          RouteTable: {
            RouteTableId:
              creates === 1
                ? ROUTE_TABLE_IDS.primary
                : ROUTE_TABLE_IDS.duplicate,
          },
        });
      },
    );
    const client = makeClient(fixture, {
      describeRouteTables,
      createRouteTable,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeRouteTableResourceConflictError);
    expect(createRouteTable).toHaveBeenCalledTimes(2);
    expect(createRouteTable.mock.calls[1]?.[0].ClientToken).toBe(
      createRouteTable.mock.calls[0]?.[0].ClientToken,
    );
  });

  it('maps idempotency mismatch to a fixed conflict and never leaks provider detail', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      logical: [],
      createRouteTable: jest.fn(async () => {
        throw providerError(
          'IdempotentParameterMismatch',
          'mismatched-secret-request',
        );
      }),
    });
    const { resource } = makePorts(fixture, { client });
    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);

    expect(observed).toBeInstanceOf(
      AwsSingleNodeRouteTableResourceConflictError,
    );
    expect(JSON.stringify(observed)).not.toContain('mismatched-secret-request');
  });

  it('settles a returned candidate only after independent logical and exact reads agree', async () => {
    const fixture = makeFixture();
    const routeTable = makeRouteTable(fixture);
    let created = false;
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => ({
        RouteTables: created
          ? [routeTable]
          : requestKind(request) === 'exact'
            ? []
            : [],
      }),
    );
    const client = makeClient(fixture, {
      describeRouteTables,
      createRouteTable: jest.fn(async () => {
        created = true;
        return createResponse(fixture);
      }),
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({
        status: 'converged',
        binding: expect.objectContaining({
          resourceKey: 'network-route-table',
          providerType: 'ec2-route-table',
          providerResourceId: ROUTE_TABLE_IDS.primary,
          ownershipNonce: fixture.ownershipNonce,
          createdByActionId: fixture.action.actionId,
          dependencyBindings: [
            {
              resourceKey: 'network-vpc',
              bindingId: fixture.vpcBinding.bindingId,
            },
          ],
        }),
      }),
    );
  });

  it('never treats a mutation response as settlement evidence', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      logical: [],
      createRouteTable: jest.fn(async () => ({
        ClientToken: getAwsSingleNodeRouteTableCreateClientToken(
          fixture.action.actionId,
          fixture.ownershipNonce,
        ),
        RouteTable: {
          RouteTableId: ROUTE_TABLE_IDS.primary,
          OwnerId: '999999999999',
          secret: 'untrusted-response',
        },
      })),
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
  });

  it.each([
    [
      'a missing response token',
      (/** @type {ReturnType<typeof makeFixture>} */ _fixture) => ({
        RouteTable: { RouteTableId: ROUTE_TABLE_IDS.primary },
      }),
      AwsSingleNodeRouteTableResourceUnknownError,
    ],
    [
      'a malformed candidate ID',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        createResponse(fixture, {
          RouteTable: { RouteTableId: 'rtb-not-hex' },
        }),
      AwsSingleNodeRouteTableResourceUnknownError,
    ],
    [
      'a mismatched response token',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        createResponse(fixture, { ClientToken: '0'.repeat(64) }),
      AwsSingleNodeRouteTableResourceConflictError,
    ],
  ])(
    'rejects %s without treating it as settlement',
    async (_name, response, ErrorType) => {
      const fixture = makeFixture();
      const client = makeClient(fixture, {
        logical: [],
        createRouteTable: jest.fn(async () => response(fixture)),
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).rejects.toBeInstanceOf(ErrorType);
      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'not-converged',
        },
      );
    },
  );

  it('recovers complete provider evidence in a fresh factory without creating', async () => {
    const fixture = makeFixture();
    const recovered = makeRouteTable(fixture);
    const client = makeClient(fixture, {
      exact: recovered,
      logical: [recovered],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(client.createRouteTable).not.toHaveBeenCalled();
  });
});

describe('AWS single-node route-table discovery and identity evidence', () => {
  it('uses exact frozen eight-tag logical discovery and exact-ID requests', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await resource.verifySettlement(fixture.context);

    const requests = client.describeRouteTables.mock.calls.map(
      (/** @type {[Readonly<AnyRecord>]} */ [request]) => request,
    );
    expect(
      requests.find(
        (/** @type {Readonly<AnyRecord>} */ request) =>
          requestKind(request) === 'logical',
      ),
    ).toEqual({
      Filters: logicalFilters(fixture),
      MaxResults: AWS_SINGLE_NODE_ROUTE_TABLE_DISCOVERY_MAX_RESULTS,
    });
    expect(
      requests.find(
        (/** @type {Readonly<AnyRecord>} */ request) =>
          requestKind(request) === 'exact',
      ),
    ).toEqual({ RouteTableIds: [ROUTE_TABLE_IDS.primary] });
    for (const request of requests) expectDeepFrozen(request);
  });

  it('paginates bounded logical discovery before correlating one exact identity', async () => {
    const fixture = makeFixture();
    const routeTable = makeRouteTable(fixture);
    let page = 0;
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => {
        if (requestKind(request) === 'exact') {
          return { RouteTables: [routeTable] };
        }
        page += 1;
        return page === 1
          ? { RouteTables: [], NextToken: 'logical-page-2' }
          : { RouteTables: [routeTable] };
      },
    );
    const { resource } = makePorts(fixture, {
      client: makeClient(fixture, { describeRouteTables }),
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(page).toBe(2);
    const continuation = describeRouteTables.mock.calls
      .map(([request]) => request)
      .find((request) => request.NextToken === 'logical-page-2');
    expect(continuation).toEqual({
      Filters: logicalFilters(fixture),
      MaxResults: AWS_SINGLE_NODE_ROUTE_TABLE_DISCOVERY_MAX_RESULTS,
      NextToken: 'logical-page-2',
    });
    expectDeepFrozen(continuation);
  });

  it.each([
    [
      'duplicate logical owners',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        logical: [
          makeRouteTable(fixture),
          makeRouteTable(fixture, {
            RouteTableId: ROUTE_TABLE_IDS.duplicate,
          }),
        ],
      }),
    ],
    [
      'a different exact replacement',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exact: makeRouteTable(fixture, {
          RouteTableId: ROUTE_TABLE_IDS.replacement,
        }),
        logical: [makeRouteTable(fixture)],
      }),
    ],
  ])('blocks %s and never mutates', async (_name, evidence) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, evidence(fixture));
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeRouteTableResourceConflictError);
    expect(client.createRouteTable).not.toHaveBeenCalled();
    expect(client.deleteRouteTable).not.toHaveBeenCalled();
  });

  it('keeps one-sided visibility retryable and waits only between attempts', async () => {
    const fixture = makeFixture();
    const routeTable = makeRouteTable(fixture);
    let logicalReads = 0;
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => {
        if (requestKind(request) === 'exact') {
          return { RouteTables: [routeTable] };
        }
        logicalReads += 1;
        return { RouteTables: logicalReads === 1 ? [] : [routeTable] };
      },
    );
    const waitForRetry = jest.fn();
    const { resource } = makePorts(fixture, {
      client: makeClient(fixture, { describeRouteTables }),
      maxAttempts: 2,
      waitForRetry,
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(waitForRetry.mock.calls).toEqual([[1]]);
  });

  it('gives present foreign evidence precedence over one-sided propagation', async () => {
    const fixture = makeFixture();
    const foreign = makeRouteTable(fixture, { OwnerId: '999999999999' });
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => {
        if (requestKind(request) === 'exact') {
          throw providerError('InvalidRouteTableID.NotFound');
        }
        return { RouteTables: [foreign] };
      },
    );
    const { resource } = makePorts(fixture, {
      client: makeClient(fixture, { describeRouteTables }),
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('fails closed as unknown when exact failure prevents broad conflict validation', async () => {
    const fixture = makeFixture();
    const foreign = makeRouteTable(fixture, { OwnerId: '999999999999' });
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => {
        if (requestKind(request) === 'exact') {
          throw providerError('NetworkingError', 'exact-provider-secret');
        }
        return { RouteTables: [foreign] };
      },
    );
    const client = makeClient(fixture, { describeRouteTables });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeRouteTableResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('exact-provider-secret');
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeRouteTableResourceUnknownError);
    expect(client.createRouteTable).not.toHaveBeenCalled();
    expect(client.deleteRouteTable).not.toHaveBeenCalled();
  });

  it('maps malformed provider payloads to fixed unknown state without echoing them', async () => {
    const fixture = makeFixture();
    const malformed = makeRouteTable(fixture, {
      Routes: null,
      secret: 'malformed-route-table-secret',
    });
    const client = makeClient(fixture, {
      exact: malformed,
      logical: [malformed],
    });
    const { resource } = makePorts(fixture, { client });
    const observed = await resource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);

    expect(observed).toBeInstanceOf(
      AwsSingleNodeRouteTableResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain(
      'malformed-route-table-secret',
    );
  });

  it('keeps create recovery nonconverged when exact returns typed InvalidRouteTableID.NotFound', async () => {
    const fixture = makeFixture();
    const routeTable = makeRouteTable(fixture);
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => {
        if (requestKind(request) === 'exact') {
          throw providerError('InvalidRouteTableID.NotFound');
        }
        return { RouteTables: [routeTable] };
      },
    );
    const { resource } = makePorts(fixture, {
      client: makeClient(fixture, { describeRouteTables }),
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
  });

  it('does not treat lowercase InvalidRouteTableId.NotFound as authoritative absence', async () => {
    const fixture = makeFixture();
    const routeTable = makeRouteTable(fixture);
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => {
        if (requestKind(request) === 'exact') {
          throw providerError('InvalidRouteTableId.NotFound');
        }
        return { RouteTables: [routeTable] };
      },
    );
    const { resource } = makePorts(fixture, {
      client: makeClient(fixture, { describeRouteTables }),
    });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeRouteTableResourceUnknownError);
  });

  it('rejects successful exact empty arrays because only typed NotFound proves absence', async () => {
    const fixture = makeFixture();
    const routeTable = makeRouteTable(fixture);
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => ({
        RouteTables: requestKind(request) === 'exact' ? [] : [routeTable],
      }),
    );
    const { resource } = makePorts(fixture, {
      client: makeClient(fixture, { describeRouteTables }),
    });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeRouteTableResourceUnknownError);
  });
});

describe('AWS single-node route-table lifecycle evidence', () => {
  it('requires pristine local-only evidence before a create receipt can settle', async () => {
    const fixture = makeFixture();
    const pristine = makeRouteTable(fixture);
    const client = makeClient(fixture, {
      exact: pristine,
      logical: [pristine],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
  });

  it.each([
    [
      'a child default route',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRouteTable(fixture, {
          Routes: [...makeRouteTable(fixture).Routes, defaultRoute()],
        }),
    ],
    [
      'a child subnet association',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRouteTable(fixture, { Associations: [subnetAssociation()] }),
    ],
    [
      'gateway propagation',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRouteTable(fixture, {
          PropagatingVgws: [{ GatewayId: 'vgw-00000000000000001' }],
        }),
    ],
  ])('blocks create settlement with %s', async (_name, evidence) => {
    const fixture = makeFixture();
    const routeTable = evidence(fixture);
    const { resource } = makePorts(fixture, {
      client: makeClient(fixture, {
        exact: routeTable,
        logical: [routeTable],
      }),
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('gives a present default route without the local route conflict precedence', async () => {
    const fixture = makeFixture();
    const routeTable = makeRouteTable(fixture, { Routes: [defaultRoute()] });
    const client = makeClient(fixture, {
      exact: routeTable,
      logical: [routeTable],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeRouteTableResourceConflictError);
  });

  it.each([
    ['a subnet association', { Associations: [subnetAssociation()] }],
    [
      'gateway propagation',
      { PropagatingVgws: [{ GatewayId: 'vgw-00000000000000001' }] },
    ],
  ])(
    'gives %s conflict precedence over an otherwise transitional empty route set',
    async (_name, overrides) => {
      const fixture = makeFixture();
      const routeTable = makeRouteTable(fixture, {
        Routes: [],
        ...overrides,
      });
      const { resource } = makePorts(fixture, {
        client: makeClient(fixture, {
          exact: routeTable,
          logical: [routeTable],
        }),
      });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'blocked',
        },
      );
    },
  );

  it('treats only an empty create route set as transitional propagation', async () => {
    const fixture = makeFixture();
    const routeTable = makeRouteTable(fixture, { Routes: [] });
    const { resource } = makePorts(fixture, {
      client: makeClient(fixture, {
        exact: routeTable,
        logical: [routeTable],
      }),
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
  });

  it('allows exactly one active fixed default route and one associated nonmain subnet on noop', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const routeTable = makeRouteTableWithDescendants(fixture);
    const client = makeClient(fixture, {
      exact: routeTable,
      logical: [routeTable],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: fixture.priorBinding,
    });
    expect(client.createRouteTable).not.toHaveBeenCalled();
    expect(client.deleteRouteTable).not.toHaveBeenCalled();
  });

  it.each([
    ['foreign owner', { OwnerId: '999999999999' }],
    ['wrong parent VPC', { VpcId: VPC_IDS.other }],
    [
      'a main association',
      {
        Associations: [
          {
            AssociationState: { State: 'associated' },
            Main: true,
            RouteTableAssociationId: ASSOCIATION_ID,
            RouteTableId: ROUTE_TABLE_IDS.primary,
          },
        ],
      },
    ],
  ])('blocks validly shaped but contradictory %s', async (_name, overrides) => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const routeTable = makeRouteTable(fixture, overrides);
    const { resource } = makePorts(fixture, {
      client: makeClient(fixture, {
        exact: routeTable,
        logical: [routeTable],
      }),
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it.each([
    [
      'a blackhole fixed default route',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        Routes: [
          ...makeRouteTable(fixture).Routes,
          { ...defaultRoute(), State: 'blackhole' },
        ],
      }),
    ],
    [
      'a failed fixed subnet association',
      (/** @type {ReturnType<typeof makeFixture>} */ _fixture) => ({
        Associations: [
          {
            ...subnetAssociation(),
            AssociationState: { State: 'failed' },
          },
        ],
      }),
    ],
  ])(
    'allows %s on noop so its child action can repair it',
    async (_name, overrides) => {
      const fixture = makeFixture({ operation: 'reconcile' });
      const routeTable = makeRouteTable(fixture, overrides(fixture));
      const { resource } = makePorts(fixture, {
        client: makeClient(fixture, {
          exact: routeTable,
          logical: [routeTable],
        }),
      });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'converged',
          binding: fixture.priorBinding,
        },
      );
    },
  );

  it.each(['OdbNetworkArn', 'IpAddress'])(
    'rejects %s as an alternate second target on the local route',
    async (field) => {
      const fixture = makeFixture({ operation: 'reconcile' });
      const local = {
        ...makeRouteTable(fixture).Routes[0],
        [field]:
          field === 'OdbNetworkArn'
            ? 'arn:aws:odb:us-east-1:123456789012:odb-network/example'
            : '10.42.0.1',
      };
      const routeTable = makeRouteTable(fixture, { Routes: [local] });
      const { resource } = makePorts(fixture, {
        client: makeClient(fixture, {
          exact: routeTable,
          logical: [routeTable],
        }),
      });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'blocked',
        },
      );
    },
  );

  it.each([
    [
      'an unrelated NAT route',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        Routes: [
          ...makeRouteTable(fixture).Routes,
          {
            DestinationCidrBlock: '10.99.0.0/16',
            NatGatewayId: 'nat-00000000000000001',
            Origin: 'CreateRoute',
            State: 'active',
          },
        ],
      }),
    ],
    [
      'a nonmain gateway association',
      (/** @type {ReturnType<typeof makeFixture>} */ _fixture) => ({
        Associations: [
          {
            AssociationState: { State: 'associated' },
            GatewayId: INTERNET_GATEWAY_ID,
            Main: false,
            RouteTableAssociationId: ASSOCIATION_ID,
            RouteTableId: ROUTE_TABLE_IDS.primary,
          },
        ],
      }),
    ],
  ])('blocks unsupported noop descendant %s', async (_name, overrides) => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const routeTable = makeRouteTable(fixture, overrides(fixture));
    const { resource } = makePorts(fixture, {
      client: makeClient(fixture, {
        exact: routeTable,
        logical: [routeTable],
      }),
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it.each([
    [
      'local route',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => [
        {
          ...makeRouteTable(fixture).Routes[0],
          InstanceOwnerId: fixture.base.providerScope.accountId,
        },
      ],
    ],
    [
      'default route',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => [
        ...makeRouteTable(fixture).Routes,
        {
          ...defaultRoute(),
          InstanceOwnerId: fixture.base.providerScope.accountId,
        },
      ],
    ],
  ])('rejects InstanceOwnerId on a %s', async (_name, routes) => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const routeTable = makeRouteTable(fixture, { Routes: routes(fixture) });
    const { resource } = makePorts(fixture, {
      client: makeClient(fixture, {
        exact: routeTable,
        logical: [routeTable],
      }),
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('blocks incomplete or conflicting ownership tags on noop', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const incompleteTags = expectedTags(fixture);
    delete incompleteTags['wharfie:state-digest'];
    const incomplete = makeRouteTable(fixture, {
      Tags: tagArray(incompleteTags),
    });
    let resource = makePorts(fixture, {
      client: makeClient(fixture, {
        exact: incomplete,
        logical: [incomplete],
      }),
    }).resource;
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });

    const conflictingTags = expectedTags(fixture);
    conflictingTags['wharfie:ownership-nonce'] = nonce(99);
    const conflicting = makeRouteTable(fixture, {
      Tags: tagArray(conflictingTags),
    });
    resource = makePorts(fixture, {
      client: makeClient(fixture, {
        exact: conflicting,
        logical: [conflicting],
      }),
    }).resource;
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('treats incomplete atomic tags during create as propagation, not ownership', async () => {
    const fixture = makeFixture();
    const tags = expectedTags(fixture);
    delete tags['wharfie:state-digest'];
    const routeTable = makeRouteTable(fixture, { Tags: tagArray(tags) });
    const { resource } = makePorts(fixture, {
      client: makeClient(fixture, {
        exact: routeTable,
        logical: [routeTable],
      }),
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
  });
});

describe('AWS single-node route-table dependency authority', () => {
  it('requires an exact earlier settled VPC receipt before any apply reads', async () => {
    const fixture = makeFixture();
    const missingHead = recreateHead(fixture, { resourceBindings: [] });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction({ ...fixture.context, head: missingHead }),
    ).rejects.toBeInstanceOf(AwsSingleNodeRouteTableResourceConflictError);
    expect(client.describeRouteTables).not.toHaveBeenCalled();
    expect(client.createRouteTable).not.toHaveBeenCalled();
  });

  it('rejects a mismatched VPC receipt, role, provider type, or nonce before reads', async () => {
    const fixture = makeFixture();
    const variants = [
      (/** @type {AnyRecord} */ head) => {
        head.resourceBindings[0].role.kind = 'subnet';
      },
      (/** @type {AnyRecord} */ head) => {
        head.resourceBindings[0].providerType = 'ec2-subnet';
      },
      (/** @type {AnyRecord} */ head) => {
        head.resourceBindings[0].createdByActionId = semanticId(
          'wda3',
          'wharfie:test:wrong-route-table-vpc-receipt:v1',
          { wrong: true },
        );
      },
      (/** @type {AnyRecord} */ head) => {
        head.resourceBindings[0].ownershipNonce = nonce(98);
      },
    ];
    for (const mutate of variants) {
      const head = JSON.parse(JSON.stringify(fixture.head));
      mutate(head);
      const client = makeClient(fixture);
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction({ ...fixture.context, head }),
      ).rejects.toBeInstanceOf(Error);
      expect(client.describeRouteTables).not.toHaveBeenCalled();
    }
  });

  it('requires the later VPC destroy intent to remain pending before provider calls', async () => {
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
    expect(client.describeRouteTables).not.toHaveBeenCalled();
    expect(client.deleteRouteTable).not.toHaveBeenCalled();
  });
});

describe('AWS single-node route-table destroy fences', () => {
  it('deletes only the exact bound owned child-free route table with one frozen request', async () => {
    const fixture = makeFixture({
      operation: 'destroy',
      observedStateDigest: digest('observed route-table drift'),
    });
    const deleteRouteTable = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ _request) => ({
        ignored: true,
      }),
    );
    const client = makeClient(fixture, { deleteRouteTable });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();

    expect(deleteRouteTable).toHaveBeenCalledTimes(1);
    expect(deleteRouteTable).toHaveBeenCalledWith({
      RouteTableId: ROUTE_TABLE_IDS.primary,
    });
    expectDeepFrozen(deleteRouteTable.mock.calls[0]?.[0]);
    expect(client.createRouteTable).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the fixed default route',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRouteTable(fixture, {
          Routes: [...makeRouteTable(fixture).Routes, defaultRoute()],
        }),
    ],
    [
      'the subnet association',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRouteTable(fixture, { Associations: [subnetAssociation()] }),
    ],
    [
      'a nonmain gateway association',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRouteTable(fixture, {
          Associations: [
            {
              AssociationState: { State: 'associated' },
              GatewayId: INTERNET_GATEWAY_ID,
              Main: false,
              RouteTableAssociationId: ASSOCIATION_ID,
              RouteTableId: ROUTE_TABLE_IDS.primary,
            },
          ],
        }),
    ],
    [
      'virtual-gateway propagation',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRouteTable(fixture, {
          PropagatingVgws: [{ GatewayId: 'vgw-00000000000000001' }],
        }),
    ],
    [
      'an otherwise well-formed nonlocal NAT route',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRouteTable(fixture, {
          Routes: [
            ...makeRouteTable(fixture).Routes,
            {
              DestinationCidrBlock: '10.99.0.0/16',
              NatGatewayId: 'nat-00000000000000001',
              Origin: 'CreateRoute',
              State: 'active',
            },
          ],
        }),
    ],
  ])('waits without deleting while %s remains', async (_name, evidence) => {
    const fixture = makeFixture({ operation: 'destroy' });
    const routeTable = evidence(fixture);
    const client = makeClient(fixture, {
      exact: routeTable,
      logical: [routeTable],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(client.deleteRouteTable).not.toHaveBeenCalled();
  });

  it.each([
    ['foreign owner', { OwnerId: '999999999999' }],
    ['wrong parent VPC', { VpcId: VPC_IDS.other }],
    [
      'a contradictory local route',
      {
        Routes: [
          {
            DestinationCidrBlock: OTHER_VPC_CIDR,
            GatewayId: 'local',
            Origin: 'CreateRouteTable',
            State: 'active',
          },
        ],
      },
    ],
    [
      'main-table identity',
      {
        Associations: [
          {
            AssociationState: { State: 'associated' },
            Main: true,
            RouteTableAssociationId: ASSOCIATION_ID,
            RouteTableId: ROUTE_TABLE_IDS.primary,
          },
        ],
      },
    ],
  ])('blocks %s even during destroy', async (_name, overrides) => {
    const fixture = makeFixture({ operation: 'destroy' });
    const routeTable = makeRouteTable(fixture, overrides);
    const client = makeClient(fixture, {
      exact: routeTable,
      logical: [routeTable],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeRouteTableResourceConflictError);
    expect(client.deleteRouteTable).not.toHaveBeenCalled();
  });

  it('keeps ownership tags exact during destroy', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const incompleteTags = expectedTags(fixture);
    delete incompleteTags['wharfie:state-digest'];
    const routeTable = makeRouteTable(fixture, {
      Tags: tagArray(incompleteTags),
    });
    const client = makeClient(fixture, {
      exact: routeTable,
      logical: [routeTable],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.deleteRouteTable).not.toHaveBeenCalled();
  });

  it('maps malformed destroy evidence to unknown and never deletes', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const malformed = makeRouteTable(fixture, { Associations: null });
    const client = makeClient(fixture, {
      exact: malformed,
      logical: [malformed],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeRouteTableResourceUnknownError);
    expect(client.deleteRouteTable).not.toHaveBeenCalled();
  });

  it('settles null only after empty logical discovery plus exact typed InvalidRouteTableID.NotFound', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => {
        if (requestKind(request) === 'exact') {
          throw providerError('InvalidRouteTableID.NotFound');
        }
        return { RouteTables: [] };
      },
    );
    const client = makeClient(fixture, { describeRouteTables });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(client.deleteRouteTable).not.toHaveBeenCalled();
  });

  it('does not accept a successful exact empty array as absence', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, {
      describeRouteTables: jest.fn(async () => ({ RouteTables: [] })),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeRouteTableResourceUnknownError);
    expect(client.deleteRouteTable).not.toHaveBeenCalled();
  });

  it('keeps a successful delete unsettled until provider readback proves absence', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const routeTable = makeRouteTable(fixture);
    let deleted = false;
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => {
        if (!deleted) return { RouteTables: [routeTable] };
        if (requestKind(request) === 'exact') {
          throw providerError('InvalidRouteTableID.NotFound');
        }
        return { RouteTables: [] };
      },
    );
    const deleteRouteTable = jest.fn(async () => {
      deleted = true;
      return { secret: 'ignored-delete-response' };
    });
    const client = makeClient(fixture, {
      describeRouteTables,
      deleteRouteTable,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(deleteRouteTable).toHaveBeenCalledTimes(1);
  });

  it.each([
    'InvalidRouteTableID.NotFound',
    'DependencyViolation',
    'IncorrectState',
  ])('treats %s delete failure as readback-only', async (name) => {
    const fixture = makeFixture({ operation: 'destroy' });
    const deleteRouteTable = jest.fn(async () => {
      throw providerError(name, 'delete-race-secret');
    });
    const client = makeClient(fixture, { deleteRouteTable });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(deleteRouteTable).toHaveBeenCalledTimes(1);
  });

  it.each(['InvalidRouteTableId.NotFound', 'NetworkingError'])(
    'does not settle and sanitizes non-authoritative delete error %s',
    async (name) => {
      const fixture = makeFixture({ operation: 'destroy' });
      const client = makeClient(fixture, {
        deleteRouteTable: jest.fn(async () => {
          throw providerError(name, 'unknown-delete-secret');
        }),
      });
      const { resource } = makePorts(fixture, { client });
      const observed = await resource
        .executeAction(fixture.context)
        .catch((/** @type {unknown} */ error) => error);

      expect(observed).toBeInstanceOf(
        AwsSingleNodeRouteTableResourceUnknownError,
      );
      expect(JSON.stringify(observed)).not.toContain('unknown-delete-secret');
    },
  );
});

describe('AWS single-node route-table bounded reads', () => {
  it('rejects a repeated discovery continuation token within the hard bound', async () => {
    const fixture = makeFixture();
    let calls = 0;
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => {
        if (requestKind(request) === 'exact') {
          return { RouteTables: [makeRouteTable(fixture)] };
        }
        calls += 1;
        return { RouteTables: [], NextToken: 'same-token' };
      },
    );
    const { resource } = makePorts(fixture, {
      client: makeClient(fixture, { describeRouteTables }),
    });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeRouteTableResourceUnknownError);
    expect(calls).toBe(2);
  });

  it('stops a continuing discovery traversal at the maximum page count', async () => {
    const fixture = makeFixture();
    let page = 0;
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => {
        if (requestKind(request) === 'exact') {
          return { RouteTables: [makeRouteTable(fixture)] };
        }
        page += 1;
        return { RouteTables: [], NextToken: `page-${page}` };
      },
    );
    const { resource } = makePorts(fixture, {
      client: makeClient(fixture, { describeRouteTables }),
    });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeRouteTableResourceUnknownError);
    expect(page).toBe(AWS_SINGLE_NODE_ROUTE_TABLE_MAX_DISCOVERY_PAGES);
  });

  it.each(['', 1, {}])(
    'rejects malformed continuation token %p',
    async (NextToken) => {
      const fixture = makeFixture();
      const describeRouteTables = jest.fn(async () => ({
        RouteTables: [],
        NextToken,
      }));
      const { resource } = makePorts(fixture, {
        client: makeClient(fixture, { describeRouteTables }),
      });

      await expect(
        resource.verifySettlement(fixture.context),
      ).rejects.toBeInstanceOf(AwsSingleNodeRouteTableResourceUnknownError);
    },
  );

  it('blocks impossible pagination on an exact-ID response', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const routeTable = makeRouteTable(fixture);
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) =>
        requestKind(request) === 'exact'
          ? { RouteTables: [routeTable], NextToken: 'impossible' }
          : { RouteTables: [routeTable] },
    );
    const { resource } = makePorts(fixture, {
      client: makeClient(fixture, { describeRouteTables }),
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('sanitizes provider and retry-waiter failures', async () => {
    const fixture = makeFixture();
    let client = makeClient(fixture, {
      describeRouteTables: jest.fn(async () => {
        throw providerError('NetworkingError', 'read-secret');
      }),
    });
    let resource = makePorts(fixture, { client }).resource;
    let observed = await resource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeRouteTableResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('read-secret');

    const routeTable = makeRouteTable(fixture);
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => {
        if (requestKind(request) === 'exact') {
          throw providerError('InvalidRouteTableID.NotFound');
        }
        return { RouteTables: [routeTable] };
      },
    );
    client = makeClient(fixture, { describeRouteTables });
    resource = makePorts(fixture, {
      client,
      maxAttempts: 2,
      waitForRetry: jest.fn(async () => {
        throw new Error('wait-secret');
      }),
    }).resource;
    observed = await resource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeRouteTableResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('wait-secret');
  });

  it('exports explicit retry and discovery bounds', () => {
    expect(AWS_SINGLE_NODE_ROUTE_TABLE_DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(AWS_SINGLE_NODE_ROUTE_TABLE_MAX_ATTEMPTS).toBe(10);
    expect(AWS_SINGLE_NODE_ROUTE_TABLE_MAX_DISCOVERY_PAGES).toBe(16);
    expect(AWS_SINGLE_NODE_ROUTE_TABLE_DISCOVERY_MAX_RESULTS).toBe(100);
  });
});

describe('AWS single-node route-table controller and factory contracts', () => {
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
      'a missing artifact stage',
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
      AwsSingleNodeRouteTableResourceConflictError,
    ],
    [
      'the wrong action index',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        actionIndex: 0,
      }),
      AwsSingleNodeRouteTableResourceConflictError,
    ],
    [
      'a blocked operation',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        head: recreateHead(fixture, {
          activeOperation: { status: 'blocked' },
        }),
      }),
      AwsSingleNodeRouteTableResourceConflictError,
    ],
  ])('rejects %s before provider calls', async (_name, context, ErrorType) => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(context(fixture)),
    ).rejects.toBeInstanceOf(ErrorType);
    expect(client.describeRouteTables).not.toHaveBeenCalled();
    expect(client.createRouteTable).not.toHaveBeenCalled();
    expect(client.deleteRouteTable).not.toHaveBeenCalled();
  });

  it('accepts but ignores a non-null controller artifact receipt', async () => {
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
    const resource = createAwsSingleNodeRouteTableResource({
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

  it('rejects unsupported options, incomplete clients, bad bounds, and bad scope', () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    expect(() =>
      createAwsSingleNodeRouteTableResource({
        client,
        providerScope: fixture.base.providerScope,
        unsupported: true,
      }),
    ).toThrow(TypeError);
    for (const method of [
      'createRouteTable',
      'describeRouteTables',
      'deleteRouteTable',
    ]) {
      expect(() =>
        createAwsSingleNodeRouteTableResource({
          client: { ...client, [method]: undefined },
          providerScope: fixture.base.providerScope,
        }),
      ).toThrow(TypeError);
    }
    for (const maxAttempts of [
      0,
      1.5,
      AWS_SINGLE_NODE_ROUTE_TABLE_MAX_ATTEMPTS + 1,
    ]) {
      expect(() =>
        createAwsSingleNodeRouteTableResource({
          client,
          providerScope: fixture.base.providerScope,
          maxAttempts,
        }),
      ).toThrow(TypeError);
    }
    expect(() =>
      createAwsSingleNodeRouteTableResource({
        client,
        providerScope: fixture.base.providerScope,
        waitForRetry: 'not-a-function',
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeRouteTableResource({ client, providerScope: {} }),
    ).toThrow(TypeError);
  });

  it('exports fixed non-echoing public errors', () => {
    const conflict = new AwsSingleNodeRouteTableResourceConflictError();
    const unknown = new AwsSingleNodeRouteTableResourceUnknownError();
    expect(conflict).toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeRouteTableResourceConflictError',
        code: 'AWS_SINGLE_NODE_ROUTE_TABLE_RESOURCE_CONFLICT',
      }),
    );
    expect(unknown).toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeRouteTableResourceUnknownError',
        code: 'AWS_SINGLE_NODE_ROUTE_TABLE_RESOURCE_UNKNOWN',
      }),
    );
    expect(JSON.stringify({ conflict, unknown })).not.toContain(
      'provider-secret',
    );
  });
});
