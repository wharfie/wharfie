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
  AWS_SINGLE_NODE_SECURITY_GROUP_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
  AWS_SINGLE_NODE_SECURITY_GROUP_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_SECURITY_GROUP_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SECURITY_GROUP_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
  AWS_SINGLE_NODE_SECURITY_GROUP_STATE_DIGEST_DOMAIN,
  AwsSingleNodeSecurityGroupResourceConflictError,
  AwsSingleNodeSecurityGroupResourceUnknownError,
  createAwsSingleNodeSecurityGroupResource,
  getAwsSingleNodeSecurityGroupStateDigest,
} from '../../src/core/runtime/deployment-aws-security-group-resource.js';
import { getAwsSingleNodeVpcStateDigest } from '../../src/core/runtime/deployment-aws-vpc-resource.js';
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

const SECURITY_GROUP_IDS = Object.freeze({
  primary: 'sg-00000000000000001',
  duplicate: 'sg-00000000000000002',
  replacement: 'sg-00000000000000003',
});
const VPC_IDS = Object.freeze({
  primary: 'vpc-00000000000000001',
  other: 'vpc-00000000000000002',
});
const PUBLIC_IPV4_CIDR = '0.0.0.0/0';

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
    placement: { availabilityZoneId: 'use1-az1' },
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
      appId: 'security-group-resource-test',
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
    revisionId: semanticId('wrv1', 'wharfie:test:security-group-revision:v1', {
      revision: 1,
    }),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'security group resource artifact',
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
  if (definition.resourceKey === 'network-security-group') {
    return SECURITY_GROUP_IDS.primary;
  }
  if (definition.resourceKey === 'network-internet-gateway') {
    return 'igw-00000000000000001';
  }
  if (definition.resourceKey === 'network-subnet') {
    return 'subnet-00000000000000001';
  }
  if (definition.resourceKey === 'network-route-table') {
    return 'rtb-00000000000000001';
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
  let stateDigest = digest(`${definition.resourceKey} desired`);
  if (definition.resourceKey === 'network-vpc') {
    stateDigest = getAwsSingleNodeVpcStateDigest(base.providerSpec);
  }
  if (definition.resourceKey === 'network-security-group') {
    stateDigest = getAwsSingleNodeSecurityGroupStateDigest(base.providerSpec);
  }
  return {
    providerType: definition.providerType,
    providerResourceId: null,
    stateDigest,
  };
}

/** @param {Readonly<Record<string, any>>} base @param {'apply'|'reconcile'|'destroy'} operation @param {{observedStateDigest?: Readonly<Record<string, any>>, observedVpcStateDigest?: Readonly<Record<string, any>>}} [options] */
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
        ...(definition.resourceKey === 'network-security-group' &&
        options.observedStateDigest !== undefined
          ? { stateDigest: options.observedStateDigest }
          : {}),
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
        inspectionId: semanticId(
          'win5',
          'wharfie:test:security-group-inspection:v1',
          { operation },
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
function makeSecurityGroupBinding(base, action, vpcBinding, options) {
  return createDeploymentResourceBinding({
    schemaVersion: 2,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    resourceKey: 'network-security-group',
    capability: action.capability,
    role: action.role,
    management: 'managed',
    ownershipMode: 'direct',
    onDestroy: 'purge',
    dependencyBindings: [
      { resourceKey: 'network-vpc', bindingId: vpcBinding.bindingId },
    ],
    providerType: 'ec2-security-group',
    providerResourceId:
      options.providerResourceId ?? SECURITY_GROUP_IDS.primary,
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce: options.ownershipNonce,
    createdByActionId: options.createdByActionId,
  });
}

/** @param {{operation?: 'apply'|'reconcile'|'destroy', observedStateDigest?: Readonly<Record<string, any>>, observedVpcStateDigest?: Readonly<Record<string, any>>, ownershipNonceByte?: number}} [options] */
function makeFixture(options = {}) {
  const operation = options.operation ?? 'apply';
  const base = makeBase();
  const plan = makePlan(base, operation, options);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'network-security-group',
  );
  const vpcActionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'network-vpc',
  );
  const action = plan.actions[actionIndex];
  const vpcAction = plan.actions[vpcActionIndex];
  if (action === undefined || vpcAction === undefined) {
    throw new Error('Missing security-group or VPC action.');
  }
  const ownershipNonce = nonce(options.ownershipNonceByte ?? 79);
  const intentNonces = plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ _candidate,
      /** @type {number} */ index,
    ) => (index === actionIndex ? ownershipNonce : nonce(10 + index)),
  );
  const vpcCreatedByActionId =
    operation === 'apply'
      ? vpcAction.actionId
      : semanticId('wda3', 'wharfie:test:security-group-vpc-create:v1', {
          resourceKey: 'network-vpc',
        });
  const vpcBinding = makeVpcBinding(base, vpcAction, {
    ownershipNonce: intentNonces[vpcActionIndex],
    createdByActionId: vpcCreatedByActionId,
  });
  const priorBinding =
    action.action === 'create'
      ? null
      : makeSecurityGroupBinding(base, action, vpcBinding, {
          ownershipNonce,
          createdByActionId: semanticId(
            'wda3',
            'wharfie:test:security-group-create-action:v1',
            { resourceKey: 'network-security-group' },
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
          planId: semanticId(
            'wpl3',
            'wharfie:test:security-group-last-plan:v1',
            { operation },
          ),
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
    vpcActionIndex,
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
    'wharfie:resource-kind': 'single-node-security-group',
    'wharfie:retention': 'purge',
    'wharfie:schema-version': '2',
    'wharfie:capability': 'networking',
    'wharfie:role': 'security-group',
    'wharfie:provider-scope-id': fixture.base.providerScope.providerScopeId,
    'wharfie:deployment-instance-id': fixture.base.deploymentInstanceId,
    'wharfie:incarnation-id': fixture.base.incarnationId,
    'wharfie:resource-key': 'network-security-group',
    'wharfie:created-by-action-id':
      fixture.priorBinding?.createdByActionId ?? fixture.action.actionId,
    'wharfie:ownership-nonce': fixture.ownershipNonce,
    'wharfie:state-digest': getAwsSingleNodeSecurityGroupStateDigest(
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

/** @returns {Record<string, any>} */
function defaultEgressRule() {
  return {
    IpProtocol: '-1',
    IpRanges: [{ CidrIp: PUBLIC_IPV4_CIDR }],
    Ipv6Ranges: [],
    PrefixListIds: [],
    UserIdGroupPairs: [],
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function makeSecurityGroup(fixture, overrides = {}) {
  return {
    Description: AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
    GroupId: SECURITY_GROUP_IDS.primary,
    GroupName: AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
    IpPermissions: [],
    IpPermissionsEgress: [defaultEgressRule()],
    OwnerId: fixture.base.providerScope.accountId,
    Tags: tagArray(expectedTags(fixture)),
    VpcId: fixture.vpcBinding.providerResourceId,
    ...overrides,
  };
}

/** @param {Readonly<Record<string, any>>} request @returns {'exact'|'logical'|'slot'} */
function requestKind(request) {
  if (request.GroupIds) return 'exact';
  const names = Array.isArray(request.Filters)
    ? request.Filters.map((item) => item.Name)
    : [];
  return names.includes('tag:wharfie:managed-by') ? 'logical' : 'slot';
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makeClient(fixture, options = {}) {
  const exact = options.exact ?? makeSecurityGroup(fixture);
  const logical = options.logical ?? [exact];
  const slot = options.slot ?? [exact];
  return Object.freeze({
    createSecurityGroup:
      options.createSecurityGroup ??
      jest.fn(async () => ({ GroupId: SECURITY_GROUP_IDS.primary })),
    describeSecurityGroups:
      options.describeSecurityGroups ??
      jest.fn(async (/** @type {AnyRecord} */ input) => ({
        SecurityGroups:
          requestKind(input) === 'exact'
            ? [exact]
            : requestKind(input) === 'logical'
              ? logical
              : slot,
      })),
    deleteSecurityGroup:
      options.deleteSecurityGroup ?? jest.fn(async () => ({})),
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makePorts(fixture, options = {}) {
  const client = options.client ?? makeClient(fixture, options);
  const waitForRetry = options.waitForRetry ?? jest.fn();
  return {
    client,
    waitForRetry,
    resource: createAwsSingleNodeSecurityGroupResource({
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

describe('AWS single-node security-group identity and state digest', () => {
  it('exports the fixed natural name and human description', () => {
    expect(AWS_SINGLE_NODE_SECURITY_GROUP_NAME).toBe('wharfie-single-node');
    expect(AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION).toBe(
      'Wharfie single-node application security group.',
    );
  });

  it('is deterministic, domain separated, frozen, and covers only intrinsic policy', () => {
    const base = makeBase();
    const first = getAwsSingleNodeSecurityGroupStateDigest(base.providerSpec);
    const second = getAwsSingleNodeSecurityGroupStateDigest(base.providerSpec);

    expect(first).toEqual(second);
    expect(first.algorithm).toBe('sha256');
    expect(first.value).toHaveLength(43);
    expect(Object.isFrozen(first)).toBe(true);
    expect(AWS_SINGLE_NODE_SECURITY_GROUP_STATE_DIGEST_DOMAIN).toBe(
      'wharfie:aws-single-node-ec2-security-group-state:v1',
    );
    expect(first.value).toBe(
      sha256Base64Url(
        `${AWS_SINGLE_NODE_SECURITY_GROUP_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
          sortCanonicalJsonValue({
            schemaVersion: 1,
            kind: 'awsSingleNodeEc2SecurityGroupState',
            groupName: 'wharfie-single-node',
            description: 'Wharfie single-node application security group.',
            ingressRules: [],
            egressRules: [
              {
                protocol: 'all',
                ports: 'all',
                destination: {
                  kind: 'ipv4-cidr',
                  value: PUBLIC_IPV4_CIDR,
                },
              },
            ],
            onDestroy: 'purge',
          }),
        )}`,
      ),
    );
    expect(JSON.stringify(first)).not.toMatch(/vpc-|sg-/);
  });

  it('rejects malformed specs and ignores unrelated machine-image identity', () => {
    const base = makeBase();
    expect(() => getAwsSingleNodeSecurityGroupStateDigest({})).toThrow(
      TypeError,
    );
    const changed = JSON.parse(JSON.stringify(base.providerSpec));
    changed.capabilities.networking.egressCidr = '10.0.0.0/8';
    expect(() => getAwsSingleNodeSecurityGroupStateDigest(changed)).toThrow(
      TypeError,
    );
    const otherImage = makeBase({ imageId: 'ami-0fedcba9876543210' });
    expect(
      getAwsSingleNodeSecurityGroupStateDigest(otherImage.providerSpec),
    ).toEqual(getAwsSingleNodeSecurityGroupStateDigest(base.providerSpec));
  });
});

describe('AWS single-node security-group create and recovery', () => {
  it('submits the exact frozen create with thirteen sorted tags and no client token', async () => {
    const fixture = makeFixture();
    const createSecurityGroup = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ _request) => ({
        GroupId: SECURITY_GROUP_IDS.primary,
      }),
    );
    const client = makeClient(fixture, {
      logical: [],
      slot: [],
      createSecurityGroup,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);

    expect(createSecurityGroup).toHaveBeenCalledTimes(1);
    const request = createSecurityGroup.mock.calls.at(0)?.at(0);
    if (request === undefined) throw new Error('Missing create request.');
    expect(request).toEqual({
      GroupName: AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
      Description: AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
      VpcId: VPC_IDS.primary,
      TagSpecifications: [
        {
          ResourceType: 'security-group',
          Tags: tagArray(expectedTags(fixture)),
        },
      ],
    });
    expect(request.TagSpecifications[0].Tags).toHaveLength(13);
    expect(
      request.TagSpecifications[0].Tags.map(
        (/** @type {{Key: string}} */ tag) => tag.Key,
      ),
    ).toEqual(
      [...request.TagSpecifications[0].Tags]
        .map((/** @type {{Key: string}} */ tag) => tag.Key)
        .sort(),
    );
    for (const key of [
      'ClientToken',
      'GroupDescription',
      'DryRun',
      'TagSpecification',
    ]) {
      expect(request).not.toHaveProperty(key);
    }
    expectDeepFrozen(request);
    expect(client.deleteSecurityGroup).not.toHaveBeenCalled();
  });

  it('settles only one exact ID correlated by tags and the case-folded VPC name slot', async () => {
    const fixture = makeFixture();
    const group = makeSecurityGroup(fixture);
    let created = false;
    const describeSecurityGroups = jest.fn(
      async (/** @type {AnyRecord} */ input) => ({
        SecurityGroups: created ? [group] : [],
        ...(requestKind(input) === 'exact' ? {} : {}),
      }),
    );
    const createSecurityGroup = jest.fn(async () => {
      created = true;
      return { GroupId: SECURITY_GROUP_IDS.primary };
    });
    const client = makeClient(fixture, {
      describeSecurityGroups,
      createSecurityGroup,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);
    const settlement = await resource.verifySettlement(fixture.context);

    expect(settlement).toMatchObject({
      status: 'converged',
      binding: {
        resourceKey: 'network-security-group',
        providerType: 'ec2-security-group',
        providerResourceId: SECURITY_GROUP_IDS.primary,
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
      createSecurityGroup: jest.fn(async () => {
        throw providerError('NetworkingError', 'lost-create-secret');
      }),
    });
    const first = makePorts(fixture, { client: firstClient }).resource;
    const observed = await first
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeSecurityGroupResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('lost-create-secret');

    const recovered = makeSecurityGroup(fixture);
    const secondClient = makeClient(fixture, {
      exact: recovered,
      logical: [recovered],
      slot: [recovered],
    });
    const second = makePorts(fixture, { client: secondClient }).resource;
    await expect(second.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(secondClient.createSecurityGroup).not.toHaveBeenCalled();
  });

  it('treats duplicate-name create failure as readback-only recovery', async () => {
    const fixture = makeFixture();
    const group = makeSecurityGroup(fixture);
    let created = false;
    const describeSecurityGroups = jest.fn(
      async (/** @type {AnyRecord} */ _input) => ({
        SecurityGroups: created ? [group] : [],
      }),
    );
    const createSecurityGroup = jest.fn(async () => {
      created = true;
      throw providerError('InvalidGroup.Duplicate', 'duplicate-secret');
    });
    const client = makeClient(fixture, {
      describeSecurityGroups,
      createSecurityGroup,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(createSecurityGroup).toHaveBeenCalledTimes(1);
  });

  it('never replays one crossed create boundary in-process and advances only with a new nonce', async () => {
    const fixture = makeFixture();
    const advanced = makeFixture({ ownershipNonceByte: 80 });
    const createSecurityGroup = jest.fn(async () => {
      throw providerError('NetworkingError');
    });
    const client = makeClient(fixture, {
      logical: [],
      slot: [],
      createSecurityGroup,
    });
    const resource = createAwsSingleNodeSecurityGroupResource({
      client,
      providerScope: fixture.base.providerScope,
      maxAttempts: 1,
      waitForRetry: jest.fn(),
    });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeSecurityGroupResourceUnknownError);
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeSecurityGroupResourceUnknownError);
    expect(createSecurityGroup).toHaveBeenCalledTimes(1);

    await expect(
      resource.executeAction(advanced.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeSecurityGroupResourceUnknownError);
    expect(createSecurityGroup).toHaveBeenCalledTimes(2);
  });
});

describe('AWS single-node security-group discovery and exact policy', () => {
  it('uses independent frozen exact, eight-tag, and VPC-wide requests', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await resource.verifySettlement(fixture.context);

    const requests = client.describeSecurityGroups.mock.calls.map(
      (/** @type {[Readonly<AnyRecord>]} */ [request]) => request,
    );
    const exactRequest = requests.find(
      (/** @type {Readonly<AnyRecord>} */ request) =>
        requestKind(request) === 'exact',
    );
    const logicalRequest = requests.find(
      (/** @type {Readonly<AnyRecord>} */ request) =>
        requestKind(request) === 'logical',
    );
    const slotRequest = requests.find(
      (/** @type {Readonly<AnyRecord>} */ request) =>
        requestKind(request) === 'slot',
    );
    expect(exactRequest).toEqual({
      GroupIds: [SECURITY_GROUP_IDS.primary],
    });
    expect(logicalRequest).toEqual({
      Filters: [
        { Name: 'tag:wharfie:managed-by', Values: ['wharfie'] },
        {
          Name: 'tag:wharfie:resource-kind',
          Values: ['single-node-security-group'],
        },
        { Name: 'tag:wharfie:capability', Values: ['networking'] },
        { Name: 'tag:wharfie:role', Values: ['security-group'] },
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
          Values: ['network-security-group'],
        },
      ],
      MaxResults: AWS_SINGLE_NODE_SECURITY_GROUP_DISCOVERY_MAX_RESULTS,
    });
    expect(slotRequest).toEqual({
      Filters: [{ Name: 'vpc-id', Values: [VPC_IDS.primary] }],
      MaxResults: AWS_SINGLE_NODE_SECURITY_GROUP_DISCOVERY_MAX_RESULTS,
    });
    expectDeepFrozen(exactRequest);
    expectDeepFrozen(logicalRequest);
    expectDeepFrozen(slotRequest);
  });

  it('paginates both broad searches and locally ignores unrelated VPC groups', async () => {
    const fixture = makeFixture();
    const group = makeSecurityGroup(fixture);
    const unrelated = makeSecurityGroup(fixture, {
      GroupId: SECURITY_GROUP_IDS.replacement,
      GroupName: 'unrelated-application',
      Tags: [],
    });
    let logicalPage = 0;
    let slotPage = 0;
    const describeSecurityGroups = jest.fn(
      async (/** @type {AnyRecord} */ input) => {
        const kind = requestKind(input);
        if (kind === 'exact') return { SecurityGroups: [group] };
        if (kind === 'logical') {
          logicalPage += 1;
          return logicalPage === 1
            ? { SecurityGroups: [], NextToken: 'logical-next' }
            : { SecurityGroups: [group] };
        }
        slotPage += 1;
        return slotPage === 1
          ? { SecurityGroups: [unrelated], NextToken: 'slot-next' }
          : { SecurityGroups: [group] };
      },
    );
    const client = makeClient(fixture, { describeSecurityGroups });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(logicalPage).toBe(2);
    expect(slotPage).toBe(2);
    expect(
      describeSecurityGroups.mock.calls.find(
        ([request]) => request.NextToken === 'logical-next',
      )?.[0],
    ).toEqual(expect.objectContaining({ NextToken: 'logical-next' }));
    expect(
      describeSecurityGroups.mock.calls.find(
        ([request]) => request.NextToken === 'slot-next',
      )?.[0],
    ).toEqual(expect.objectContaining({ NextToken: 'slot-next' }));
  });

  it('correlates the natural name case-insensitively and fences a case variant occupant', async () => {
    const fixture = makeFixture();
    const occupant = makeSecurityGroup(fixture, {
      GroupId: SECURITY_GROUP_IDS.replacement,
      GroupName: AWS_SINGLE_NODE_SECURITY_GROUP_NAME.toUpperCase(),
      Tags: [],
    });
    const client = makeClient(fixture, {
      exact: makeSecurityGroup(fixture),
      logical: [makeSecurityGroup(fixture)],
      slot: [occupant],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeSecurityGroupResourceConflictError);
    expect(client.createSecurityGroup).not.toHaveBeenCalled();
  });

  it('requires exactly no ingress and the sole all-protocol public IPv4 egress rule', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    const observed = makeSecurityGroup(fixture);
    expect(observed.IpPermissions).toEqual([]);
    expect(observed.IpPermissionsEgress).toEqual([defaultEgressRule()]);
  });

  it.each([
    [
      'all empty collections',
      {
        IpProtocol: '-1',
        IpRanges: [{ CidrIp: PUBLIC_IPV4_CIDR }],
      },
    ],
    [
      'Ipv6Ranges',
      {
        IpProtocol: '-1',
        IpRanges: [{ CidrIp: PUBLIC_IPV4_CIDR }],
        PrefixListIds: [],
        UserIdGroupPairs: [],
      },
    ],
    [
      'PrefixListIds',
      {
        IpProtocol: '-1',
        IpRanges: [{ CidrIp: PUBLIC_IPV4_CIDR }],
        Ipv6Ranges: [],
        UserIdGroupPairs: [],
      },
    ],
    [
      'UserIdGroupPairs',
      {
        IpProtocol: '-1',
        IpRanges: [{ CidrIp: PUBLIC_IPV4_CIDR }],
        Ipv6Ranges: [],
        PrefixListIds: [],
      },
    ],
  ])(
    'settles when AWS omits %s from the empty egress shape',
    async (_name, rule) => {
      const fixture = makeFixture({ operation: 'reconcile' });
      const group = makeSecurityGroup(fixture, {
        IpPermissionsEgress: [rule],
      });
      const client = makeClient(fixture, {
        exact: group,
        logical: [group],
        slot: [group],
      });
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'converged',
          binding: fixture.priorBinding,
        },
      );
    },
  );
});

describe('AWS single-node security-group evidence fences', () => {
  it.each([
    [
      'duplicate logical owners',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        logical: [
          makeSecurityGroup(fixture),
          makeSecurityGroup(fixture, {
            GroupId: SECURITY_GROUP_IDS.duplicate,
          }),
        ],
      }),
    ],
    [
      'a repeated logical provider ID',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => {
        const group = makeSecurityGroup(fixture);
        return { logical: [group, { ...group }] };
      },
    ],
    [
      'duplicate case-folded name occupants',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        slot: [
          makeSecurityGroup(fixture),
          makeSecurityGroup(fixture, {
            GroupId: SECURITY_GROUP_IDS.duplicate,
            GroupName: AWS_SINGLE_NODE_SECURITY_GROUP_NAME.toUpperCase(),
          }),
        ],
      }),
    ],
    [
      'a different logical replacement',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        logical: [
          makeSecurityGroup(fixture, {
            GroupId: SECURITY_GROUP_IDS.replacement,
          }),
        ],
      }),
    ],
    [
      'a different natural-slot replacement',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        slot: [
          makeSecurityGroup(fixture, {
            GroupId: SECURITY_GROUP_IDS.replacement,
          }),
        ],
      }),
    ],
  ])('blocks %s without mutating', async (_name, evidence) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, evidence(fixture));
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeSecurityGroupResourceConflictError);
    expect(client.createSecurityGroup).not.toHaveBeenCalled();
    expect(client.deleteSecurityGroup).not.toHaveBeenCalled();
  });

  it('conflicts when exact is absent but both broad views point to a replacement ID', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const replacement = makeSecurityGroup(fixture, {
      GroupId: SECURITY_GROUP_IDS.replacement,
    });
    const describeSecurityGroups = jest.fn(
      async (/** @type {AnyRecord} */ input) => {
        if (requestKind(input) === 'exact') {
          throw providerError('InvalidGroup.NotFound');
        }
        return { SecurityGroups: [replacement] };
      },
    );
    const client = makeClient(fixture, { describeSecurityGroups });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.createSecurityGroup).not.toHaveBeenCalled();
    expect(client.deleteSecurityGroup).not.toHaveBeenCalled();
  });

  it.each([
    ['owner', { OwnerId: '999999999999' }],
    ['VPC', { VpcId: VPC_IDS.other }],
    ['name', { GroupName: 'wharfie-other' }],
    ['description', { Description: 'A different security group.' }],
    [
      'ingress rule',
      {
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 22,
            ToPort: 22,
            IpRanges: [{ CidrIp: '10.0.0.0/8' }],
            Ipv6Ranges: [],
            PrefixListIds: [],
            UserIdGroupPairs: [],
          },
        ],
      },
    ],
    [
      'extra egress',
      { IpPermissionsEgress: [defaultEgressRule(), defaultEgressRule()] },
    ],
    [
      'protocol-limited egress',
      {
        IpPermissionsEgress: [
          {
            IpProtocol: 'tcp',
            FromPort: 443,
            ToPort: 443,
            IpRanges: [{ CidrIp: PUBLIC_IPV4_CIDR }],
            Ipv6Ranges: [],
            PrefixListIds: [],
            UserIdGroupPairs: [],
          },
        ],
      },
    ],
    [
      'non-public IPv4 egress',
      {
        IpPermissionsEgress: [
          {
            ...defaultEgressRule(),
            IpRanges: [{ CidrIp: '10.0.0.0/8' }],
          },
        ],
      },
    ],
    [
      'omitted IPv4 egress destination',
      {
        IpPermissionsEgress: [
          {
            IpProtocol: '-1',
            Ipv6Ranges: [],
            PrefixListIds: [],
            UserIdGroupPairs: [],
          },
        ],
      },
    ],
    [
      'port bounds on all-protocol egress',
      {
        IpPermissionsEgress: [
          { ...defaultEgressRule(), FromPort: 0, ToPort: 65535 },
        ],
      },
    ],
    [
      'annotated IPv4 egress',
      {
        IpPermissionsEgress: [
          {
            ...defaultEgressRule(),
            IpRanges: [{ CidrIp: PUBLIC_IPV4_CIDR, Description: 'annotated' }],
          },
        ],
      },
    ],
    [
      'IPv6 egress',
      {
        IpPermissionsEgress: [
          {
            ...defaultEgressRule(),
            IpRanges: [],
            Ipv6Ranges: [{ CidrIpv6: '::/0' }],
          },
        ],
      },
    ],
    [
      'prefix-list egress',
      {
        IpPermissionsEgress: [
          {
            ...defaultEgressRule(),
            IpRanges: [],
            PrefixListIds: [{ PrefixListId: 'pl-00000000000000001' }],
          },
        ],
      },
    ],
    [
      'security-group reference egress',
      {
        IpPermissionsEgress: [
          {
            ...defaultEgressRule(),
            IpRanges: [],
            UserIdGroupPairs: [{ GroupId: SECURITY_GROUP_IDS.replacement }],
          },
        ],
      },
    ],
  ])('blocks semantically drifted %s evidence', async (_name, overrides) => {
    const fixture = makeFixture();
    const drifted = makeSecurityGroup(fixture, overrides);
    const client = makeClient(fixture, {
      exact: drifted,
      logical: [drifted],
      slot: [drifted],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.createSecurityGroup).not.toHaveBeenCalled();
  });

  it('treats missing default egress as create propagation but durable drift on noop', async () => {
    let fixture = makeFixture();
    let missing = makeSecurityGroup(fixture, { IpPermissionsEgress: [] });
    let client = makeClient(fixture, {
      exact: missing,
      logical: [missing],
      slot: [missing],
    });
    let resource = makePorts(fixture, { client }).resource;
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });

    fixture = makeFixture({ operation: 'reconcile' });
    missing = makeSecurityGroup(fixture, { IpPermissionsEgress: [] });
    client = makeClient(fixture, {
      exact: missing,
      logical: [missing],
      slot: [missing],
    });
    resource = makePorts(fixture, { client }).resource;
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it.each([
    ['GroupId', { GroupId: null }],
    ['OwnerId', { OwnerId: null }],
    ['VpcId', { VpcId: null }],
    ['GroupName', { GroupName: null }],
    ['Description', { Description: null }],
    ['Tags', { Tags: null }],
    ['IpPermissions', { IpPermissions: null }],
    ['IpPermissionsEgress', { IpPermissionsEgress: null }],
    [
      'IpProtocol',
      {
        IpPermissionsEgress: [{ ...defaultEgressRule(), IpProtocol: null }],
      },
    ],
    [
      'IpRanges',
      {
        IpPermissionsEgress: [{ ...defaultEgressRule(), IpRanges: null }],
      },
    ],
    [
      'wrong-type IpRanges',
      {
        IpPermissionsEgress: [{ ...defaultEgressRule(), IpRanges: {} }],
      },
    ],
    [
      'CidrIp',
      {
        IpPermissionsEgress: [
          { ...defaultEgressRule(), IpRanges: [{ CidrIp: null }] },
        ],
      },
    ],
    [
      'Ipv6Ranges',
      {
        IpPermissionsEgress: [{ ...defaultEgressRule(), Ipv6Ranges: null }],
      },
    ],
    [
      'wrong-type Ipv6Ranges',
      {
        IpPermissionsEgress: [{ ...defaultEgressRule(), Ipv6Ranges: {} }],
      },
    ],
    [
      'PrefixListIds',
      {
        IpPermissionsEgress: [{ ...defaultEgressRule(), PrefixListIds: null }],
      },
    ],
    [
      'wrong-type PrefixListIds',
      {
        IpPermissionsEgress: [{ ...defaultEgressRule(), PrefixListIds: {} }],
      },
    ],
    [
      'UserIdGroupPairs',
      {
        IpPermissionsEgress: [
          { ...defaultEgressRule(), UserIdGroupPairs: null },
        ],
      },
    ],
    [
      'wrong-type UserIdGroupPairs',
      {
        IpPermissionsEgress: [{ ...defaultEgressRule(), UserIdGroupPairs: {} }],
      },
    ],
  ])(
    'maps malformed %s evidence to sanitized unknown',
    async (_name, overrides) => {
      const fixture = makeFixture();
      const malformed = makeSecurityGroup(fixture, {
        ...overrides,
        secret: 'malformed-security-group-secret',
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
      expect(observed).toBeInstanceOf(
        AwsSingleNodeSecurityGroupResourceUnknownError,
      );
      expect(JSON.stringify(observed)).not.toContain(
        'malformed-security-group-secret',
      );
      expect(client.createSecurityGroup).not.toHaveBeenCalled();
    },
  );

  it('treats missing create-time tags as propagation but wrong reserved tags as conflict', async () => {
    const fixture = makeFixture();
    const incompleteTags = expectedTags(fixture);
    delete incompleteTags['wharfie:ownership-nonce'];
    const incomplete = makeSecurityGroup(fixture, {
      Tags: tagArray(incompleteTags),
    });
    let client = makeClient(fixture, {
      exact: incomplete,
      logical: [],
      slot: [incomplete],
    });
    let resource = makePorts(fixture, { client }).resource;
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });

    const conflictingTags = expectedTags(fixture);
    conflictingTags['wharfie:ownership-nonce'] = nonce(99);
    const conflicting = makeSecurityGroup(fixture, {
      Tags: tagArray(conflictingTags),
    });
    client = makeClient(fixture, {
      exact: conflicting,
      logical: [],
      slot: [conflicting],
    });
    resource = makePorts(fixture, { client }).resource;
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('does not turn a successful create response into settlement evidence', async () => {
    const fixture = makeFixture();
    let created = false;
    const describeSecurityGroups = jest.fn(
      async (/** @type {AnyRecord} */ input) => {
        if (created && requestKind(input) === 'exact') {
          throw providerError('InvalidGroup.NotFound');
        }
        return { SecurityGroups: [] };
      },
    );
    const createSecurityGroup = jest.fn(async () => {
      created = true;
      return { GroupId: SECURITY_GROUP_IDS.primary, ignored: 'response-only' };
    });
    const client = makeClient(fixture, {
      describeSecurityGroups,
      createSecurityGroup,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);
    expect(created).toBe(true);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
  });

  it('sanitizes a malformed create response and refuses another same-nonce mutation', async () => {
    const fixture = makeFixture();
    const createSecurityGroup = jest.fn(async () => ({
      GroupId: 'sg-malformed-secret',
    }));
    const client = makeClient(fixture, {
      logical: [],
      slot: [],
      createSecurityGroup,
    });
    const { resource } = makePorts(fixture, { client });

    let observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeSecurityGroupResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('malformed-secret');
    observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeSecurityGroupResourceUnknownError,
    );
    expect(createSecurityGroup).toHaveBeenCalledTimes(1);
  });
});

describe('AWS single-node security-group noop and VPC authority', () => {
  it('preserves the prior receipt, nonce, provider identity, and exact VPC lineage', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    if (fixture.priorBinding === null) {
      throw new Error('Missing prior security-group binding.');
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
    expect(settlement.binding.providerResourceId).toBe(
      SECURITY_GROUP_IDS.primary,
    );
    expect(settlement.binding.dependencyBindings).toEqual([
      {
        resourceKey: 'network-vpc',
        bindingId: fixture.vpcBinding.bindingId,
      },
    ]);
    expect(client.createSecurityGroup).not.toHaveBeenCalled();
    expect(client.deleteSecurityGroup).not.toHaveBeenCalled();
  });

  it('requires complete exact tags for noop evidence', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const incompleteTags = expectedTags(fixture);
    delete incompleteTags['wharfie:state-digest'];
    const incomplete = makeSecurityGroup(fixture, {
      Tags: tagArray(incompleteTags),
    });
    const client = makeClient(fixture, {
      exact: incomplete,
      logical: [incomplete],
      slot: [incomplete],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('pins the VPC dependency digest, receipt lineage, and forward action order', async () => {
    const fixture = makeFixture();
    const vpcAction = fixture.plan.actions[fixture.vpcActionIndex];
    expect(fixture.vpcActionIndex).toBeLessThan(fixture.actionIndex);
    expect(
      fixture.head.activeOperation.intents[fixture.vpcActionIndex],
    ).toEqual(
      expect.objectContaining({
        actionId: vpcAction.actionId,
        status: 'settled',
        ownershipNonce: fixture.vpcBinding.ownershipNonce,
      }),
    );
    expect(vpcAction.after.stateDigest).toEqual(
      getAwsSingleNodeVpcStateDigest(fixture.base.providerSpec),
    );
    expect(fixture.vpcBinding.createdByActionId).toBe(vpcAction.actionId);

    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
  });

  it('rejects a noncanonical VPC action state digest before provider reads', async () => {
    const fixture = makeFixture({
      observedVpcStateDigest: digest('wrong VPC state'),
      operation: 'reconcile',
    });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeSecurityGroupResourceConflictError);
    expect(client.describeSecurityGroups).not.toHaveBeenCalled();
  });

  it('requires the exact settled VPC binding before provider calls', async () => {
    const fixture = makeFixture();
    const missingHead = recreateHead(fixture, { resourceBindings: [] });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction({ ...fixture.context, head: missingHead }),
    ).rejects.toBeInstanceOf(AwsSingleNodeSecurityGroupResourceConflictError);
    expect(client.describeSecurityGroups).not.toHaveBeenCalled();
  });

  it.each([
    ['role', { role: { kind: 'subnet', version: 1 } }],
    ['provider type', { providerType: 'ec2-subnet' }],
    [
      'create receipt',
      {
        createdByActionId: semanticId(
          'wda3',
          'wharfie:test:wrong-security-group-vpc-receipt:v1',
          { wrong: true },
        ),
      },
    ],
  ])(
    'rejects mismatched VPC %s before provider reads',
    async (_name, change) => {
      const fixture = makeFixture();
      const vpcAction = fixture.plan.actions[fixture.vpcActionIndex];
      const candidate = {
        role: { kind: 'vpc', version: 1 },
        providerType: 'ec2-vpc',
        providerResourceId: VPC_IDS.primary,
        ownershipNonce: fixture.vpcBinding.ownershipNonce,
        createdByActionId: fixture.vpcBinding.createdByActionId,
        ...change,
      };
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
        providerResourceId: candidate.providerResourceId,
        providerScopeId: fixture.base.providerScope.providerScopeId,
        ownershipNonce: candidate.ownershipNonce,
        createdByActionId: candidate.createdByActionId,
      });
      const head = recreateHead(fixture, { resourceBindings: [binding] });
      const client = makeClient(fixture);
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction({ ...fixture.context, head }),
      ).rejects.toBeInstanceOf(AwsSingleNodeSecurityGroupResourceConflictError);
      expect(vpcAction.resourceKey).toBe('network-vpc');
      expect(client.describeSecurityGroups).not.toHaveBeenCalled();
    },
  );

  it('rejects stale but internally valid VPC dependency lineage on noop', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    if (fixture.priorBinding === null) {
      throw new Error('Missing prior security-group binding.');
    }
    const staleVpc = makeVpcBinding(
      fixture.base,
      fixture.plan.actions[fixture.vpcActionIndex],
      {
        providerResourceId: VPC_IDS.other,
        ownershipNonce: fixture.vpcBinding.ownershipNonce,
        createdByActionId: fixture.vpcBinding.createdByActionId,
      },
    );
    const staleGroup = makeSecurityGroupBinding(
      fixture.base,
      fixture.action,
      staleVpc,
      {
        ownershipNonce: fixture.ownershipNonce,
        createdByActionId: fixture.priorBinding.createdByActionId,
      },
    );
    const staleHead = recreateHead(fixture, {
      resourceBindings: [staleVpc, staleGroup],
    });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction({ ...fixture.context, head: staleHead }),
    ).rejects.toBeInstanceOf(AwsSingleNodeSecurityGroupResourceConflictError);
    expect(client.describeSecurityGroups).not.toHaveBeenCalled();
  });
});

describe('AWS single-node security-group reverse purge', () => {
  it('requires the later VPC delete intent to remain pending before provider calls', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    expect(fixture.vpcActionIndex).toBeGreaterThan(fixture.actionIndex);
    expect(
      fixture.head.activeOperation.intents[fixture.vpcActionIndex].status,
    ).toBe('pending');
    const head = JSON.parse(JSON.stringify(fixture.head));
    head.activeOperation.intents[fixture.vpcActionIndex].status = 'settled';
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction({ ...fixture.context, head }),
    ).rejects.toBeInstanceOf(Error);
    expect(client.describeSecurityGroups).not.toHaveBeenCalled();
    expect(client.deleteSecurityGroup).not.toHaveBeenCalled();
  });

  it('deletes only the exact bound group with one frozen ID-only request', async () => {
    const fixture = makeFixture({
      operation: 'destroy',
      observedStateDigest: digest('observed security group state'),
    });
    const deleteSecurityGroup = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ _request) => ({
        ignored: 'delete-response-is-not-evidence',
      }),
    );
    const client = makeClient(fixture, { deleteSecurityGroup });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();

    expect(deleteSecurityGroup).toHaveBeenCalledTimes(1);
    expect(deleteSecurityGroup).toHaveBeenCalledWith({
      GroupId: SECURITY_GROUP_IDS.primary,
    });
    const request = deleteSecurityGroup.mock.calls.at(0)?.at(0);
    if (request === undefined) throw new Error('Missing delete request.');
    expectDeepFrozen(request);
    expect(client.createSecurityGroup).not.toHaveBeenCalled();
  });

  it('does not delete while exact and tags are present but the natural slot lags', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const group = makeSecurityGroup(fixture);
    const client = makeClient(fixture, {
      exact: group,
      logical: [group],
      slot: [],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(client.deleteSecurityGroup).not.toHaveBeenCalled();
  });

  it('tolerates well-formed ingress and egress rule drift while deleting', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const drifted = makeSecurityGroup(fixture, {
      IpPermissions: [
        {
          IpProtocol: 'tcp',
          FromPort: 22,
          ToPort: 22,
          IpRanges: [{ CidrIp: '10.0.0.0/8' }],
          Ipv6Ranges: [],
          PrefixListIds: [],
          UserIdGroupPairs: [],
        },
      ],
      IpPermissionsEgress: [
        {
          IpProtocol: 'tcp',
          FromPort: 443,
          ToPort: 443,
          IpRanges: [{ CidrIp: '10.0.0.0/8' }],
          Ipv6Ranges: [{ CidrIpv6: '2001:db8::/32' }],
          PrefixListIds: [],
          UserIdGroupPairs: [],
        },
      ],
    });
    const client = makeClient(fixture, {
      exact: drifted,
      logical: [drifted],
      slot: [drifted],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.deleteSecurityGroup).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['foreign owner', { OwnerId: '999999999999' }],
    ['wrong VPC', { VpcId: VPC_IDS.other }],
    ['wrong name', { GroupName: 'wharfie-other' }],
    ['wrong description', { Description: 'Wrong security group.' }],
  ])('keeps exact %s fenced during destroy', async (_name, overrides) => {
    const fixture = makeFixture({ operation: 'destroy' });
    const conflicting = makeSecurityGroup(fixture, overrides);
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
    ).rejects.toBeInstanceOf(AwsSingleNodeSecurityGroupResourceConflictError);
    expect(client.deleteSecurityGroup).not.toHaveBeenCalled();
  });

  it('requires complete exact ownership tags during destroy', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const incompleteTags = expectedTags(fixture);
    delete incompleteTags['wharfie:state-digest'];
    const incomplete = makeSecurityGroup(fixture, {
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
    conflictingTags['wharfie:created-by-action-id'] = semanticId(
      'wda3',
      'wharfie:test:wrong-security-group-receipt:v1',
      { wrong: true },
    );
    const conflicting = makeSecurityGroup(fixture, {
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

  it.each(['InvalidGroup.NotFound', 'InvalidSecurityGroupID.NotFound'])(
    'settles corroborated absence only from exact %s plus empty broad traversals',
    async (name) => {
      const fixture = makeFixture({ operation: 'destroy' });
      const describeSecurityGroups = jest.fn(
        async (/** @type {AnyRecord} */ input) => {
          if (requestKind(input) === 'exact') throw providerError(name);
          return { SecurityGroups: [] };
        },
      );
      const client = makeClient(fixture, { describeSecurityGroups });
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
      expect(client.deleteSecurityGroup).not.toHaveBeenCalled();
    },
  );

  it('does not accept a successful exact empty array as authoritative absence', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, {
      describeSecurityGroups: jest.fn(async () => ({ SecurityGroups: [] })),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeSecurityGroupResourceUnknownError);
    expect(client.deleteSecurityGroup).not.toHaveBeenCalled();
  });

  it('blocks an absent bound ID when broad reads expose a replacement', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const replacement = makeSecurityGroup(fixture, {
      GroupId: SECURITY_GROUP_IDS.replacement,
    });
    const describeSecurityGroups = jest.fn(
      async (/** @type {AnyRecord} */ input) => {
        if (requestKind(input) === 'exact') {
          throw providerError('InvalidGroup.NotFound');
        }
        return { SecurityGroups: [replacement] };
      },
    );
    const client = makeClient(fixture, { describeSecurityGroups });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeSecurityGroupResourceConflictError);
    expect(client.deleteSecurityGroup).not.toHaveBeenCalled();
  });

  it('keeps a successful delete unsettled until every read proves absence', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const group = makeSecurityGroup(fixture);
    let deleted = false;
    const describeSecurityGroups = jest.fn(
      async (/** @type {AnyRecord} */ input) => {
        if (!deleted) return { SecurityGroups: [group] };
        if (requestKind(input) === 'exact') {
          throw providerError('InvalidGroup.NotFound');
        }
        return { SecurityGroups: [] };
      },
    );
    const deleteSecurityGroup = jest.fn(async () => {
      deleted = true;
      return { secret: 'ignored-delete-response' };
    });
    const client = makeClient(fixture, {
      describeSecurityGroups,
      deleteSecurityGroup,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(deleteSecurityGroup).toHaveBeenCalledTimes(1);
  });

  it.each([
    'InvalidGroup.NotFound',
    'InvalidSecurityGroupID.NotFound',
    'InvalidGroup.InUse',
    'DependencyViolation',
  ])('treats %s delete failure as readback-only', async (name) => {
    const fixture = makeFixture({ operation: 'destroy' });
    const deleteSecurityGroup = jest.fn(async () => {
      throw providerError(name, 'delete-secret');
    });
    const client = makeClient(fixture, { deleteSecurityGroup });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(deleteSecurityGroup).toHaveBeenCalledTimes(1);
  });

  it('sanitizes an unknown delete failure', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const deleteSecurityGroup = jest.fn(async () => {
      throw providerError('NetworkingError', 'unknown-delete-secret');
    });
    const client = makeClient(fixture, { deleteSecurityGroup });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeSecurityGroupResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('unknown-delete-secret');
  });
});

describe('AWS single-node security-group bounded evidence and retries', () => {
  it.each(['InvalidGroup.NotFound', 'InvalidSecurityGroupID.NotFound'])(
    'keeps create recovery transient when exact %s is absent but both broad views agree',
    async (name) => {
      const fixture = makeFixture();
      const group = makeSecurityGroup(fixture);
      const describeSecurityGroups = jest.fn(
        async (/** @type {AnyRecord} */ input) => {
          if (requestKind(input) === 'exact') throw providerError(name);
          return { SecurityGroups: [group] };
        },
      );
      const client = makeClient(fixture, { describeSecurityGroups });
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'not-converged',
        },
      );
      expect(client.createSecurityGroup).not.toHaveBeenCalled();
    },
  );

  it('rejects a successful exact empty array during recovery', async () => {
    const fixture = makeFixture();
    const group = makeSecurityGroup(fixture);
    const describeSecurityGroups = jest.fn(
      async (/** @type {AnyRecord} */ input) => ({
        SecurityGroups: requestKind(input) === 'exact' ? [] : [group],
      }),
    );
    const client = makeClient(fixture, { describeSecurityGroups });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeSecurityGroupResourceUnknownError);
    expect(client.createSecurityGroup).not.toHaveBeenCalled();
  });

  it.each(['logical', 'slot'])(
    'rejects repeated %s discovery tokens within the hard bound',
    async (channel) => {
      const fixture = makeFixture();
      const group = makeSecurityGroup(fixture);
      let calls = 0;
      const describeSecurityGroups = jest.fn(
        async (/** @type {AnyRecord} */ input) => {
          const kind = requestKind(input);
          if (kind === 'exact') return { SecurityGroups: [group] };
          if (kind === channel) {
            calls += 1;
            return { SecurityGroups: [], NextToken: 'same' };
          }
          return { SecurityGroups: [group] };
        },
      );
      const client = makeClient(fixture, { describeSecurityGroups });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.verifySettlement(fixture.context),
      ).rejects.toBeInstanceOf(AwsSingleNodeSecurityGroupResourceUnknownError);
      expect(calls).toBe(2);
    },
  );

  it.each(['logical', 'slot'])(
    'rejects %s continuation at the maximum page count',
    async (channel) => {
      const fixture = makeFixture();
      const group = makeSecurityGroup(fixture);
      let page = 0;
      const describeSecurityGroups = jest.fn(
        async (/** @type {AnyRecord} */ input) => {
          const kind = requestKind(input);
          if (kind === 'exact') return { SecurityGroups: [group] };
          if (kind === channel) {
            page += 1;
            return { SecurityGroups: [], NextToken: `page-${page}` };
          }
          return { SecurityGroups: [group] };
        },
      );
      const client = makeClient(fixture, { describeSecurityGroups });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.verifySettlement(fixture.context),
      ).rejects.toBeInstanceOf(AwsSingleNodeSecurityGroupResourceUnknownError);
      expect(page).toBe(AWS_SINGLE_NODE_SECURITY_GROUP_MAX_DISCOVERY_PAGES);
    },
  );

  it.each(['', 1, {}])(
    'rejects malformed discovery token %p',
    async (NextToken) => {
      const fixture = makeFixture();
      const describeSecurityGroups = jest.fn(async () => ({
        SecurityGroups: [],
        NextToken,
      }));
      const client = makeClient(fixture, { describeSecurityGroups });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.verifySettlement(fixture.context),
      ).rejects.toBeInstanceOf(AwsSingleNodeSecurityGroupResourceUnknownError);
    },
  );

  it('blocks impossible pagination on an exact-ID response', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const group = makeSecurityGroup(fixture);
    const describeSecurityGroups = jest.fn(
      async (/** @type {AnyRecord} */ input) =>
        requestKind(input) === 'exact'
          ? { SecurityGroups: [group], NextToken: 'impossible' }
          : { SecurityGroups: [group] },
    );
    const client = makeClient(fixture, { describeSecurityGroups });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('retries one-sided visibility and waits only between attempts', async () => {
    const fixture = makeFixture();
    const group = makeSecurityGroup(fixture);
    let logicalReads = 0;
    const describeSecurityGroups = jest.fn(
      async (/** @type {AnyRecord} */ input) => {
        if (requestKind(input) === 'logical') {
          logicalReads += 1;
          return {
            SecurityGroups: logicalReads === 1 ? [] : [group],
          };
        }
        return { SecurityGroups: [group] };
      },
    );
    const waitForRetry = jest.fn();
    const client = makeClient(fixture, { describeSecurityGroups });
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
      describeSecurityGroups: jest.fn(async () => {
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
    expect(observed).toBeInstanceOf(
      AwsSingleNodeSecurityGroupResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('read-secret');

    const group = makeSecurityGroup(fixture);
    const waitClient = makeClient(fixture, {
      exact: group,
      logical: [],
      slot: [group],
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
    expect(observed).toBeInstanceOf(
      AwsSingleNodeSecurityGroupResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('wait-secret');
  });

  it('exports explicit retry and discovery bounds', () => {
    expect(AWS_SINGLE_NODE_SECURITY_GROUP_DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(AWS_SINGLE_NODE_SECURITY_GROUP_MAX_ATTEMPTS).toBe(10);
    expect(AWS_SINGLE_NODE_SECURITY_GROUP_MAX_DISCOVERY_PAGES).toBe(16);
    expect(AWS_SINGLE_NODE_SECURITY_GROUP_DISCOVERY_MAX_RESULTS).toBe(1000);
  });
});

describe('AWS single-node security-group controller and factory contracts', () => {
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
      AwsSingleNodeSecurityGroupResourceConflictError,
    ],
    [
      'wrong index',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        actionIndex: 0,
      }),
      AwsSingleNodeSecurityGroupResourceConflictError,
    ],
    [
      'blocked operation',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        head: recreateHead(fixture, {
          activeOperation: { status: 'blocked' },
        }),
      }),
      AwsSingleNodeSecurityGroupResourceConflictError,
    ],
  ])('rejects %s before provider calls', async (_name, mutate, ErrorType) => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(mutate(fixture)),
    ).rejects.toBeInstanceOf(ErrorType);
    expect(client.describeSecurityGroups).not.toHaveBeenCalled();
    expect(client.createSecurityGroup).not.toHaveBeenCalled();
    expect(client.deleteSecurityGroup).not.toHaveBeenCalled();
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
    const resource = createAwsSingleNodeSecurityGroupResource({
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
      createAwsSingleNodeSecurityGroupResource({
        client,
        providerScope: fixture.base.providerScope,
        unsupported: true,
      }),
    ).toThrow(TypeError);
    for (const method of [
      'createSecurityGroup',
      'describeSecurityGroups',
      'deleteSecurityGroup',
    ]) {
      expect(() =>
        createAwsSingleNodeSecurityGroupResource({
          client: { ...client, [method]: undefined },
          providerScope: fixture.base.providerScope,
        }),
      ).toThrow(TypeError);
    }
    for (const maxAttempts of [
      0,
      AWS_SINGLE_NODE_SECURITY_GROUP_MAX_ATTEMPTS + 1,
      1.5,
    ]) {
      expect(() =>
        createAwsSingleNodeSecurityGroupResource({
          client,
          providerScope: fixture.base.providerScope,
          maxAttempts,
        }),
      ).toThrow(TypeError);
    }
    expect(() =>
      createAwsSingleNodeSecurityGroupResource({
        client,
        providerScope: fixture.base.providerScope,
        waitForRetry: 'not-a-function',
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeSecurityGroupResource({ client, providerScope: {} }),
    ).toThrow(TypeError);
  });

  it('exports fixed non-echoing public errors', () => {
    const conflict = new AwsSingleNodeSecurityGroupResourceConflictError();
    const unknown = new AwsSingleNodeSecurityGroupResourceUnknownError();
    expect(conflict).toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeSecurityGroupResourceConflictError',
        code: 'AWS_SINGLE_NODE_SECURITY_GROUP_RESOURCE_CONFLICT',
      }),
    );
    expect(unknown).toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeSecurityGroupResourceUnknownError',
        code: 'AWS_SINGLE_NODE_SECURITY_GROUP_RESOURCE_UNKNOWN',
      }),
    );
    expect(JSON.stringify({ conflict, unknown })).not.toContain(
      'provider-secret',
    );
  });
});
