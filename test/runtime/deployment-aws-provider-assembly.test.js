import { describe, expect, it, jest } from '@jest/globals';

import { compareCanonicalStrings } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import { createAwsSingleNodeDeploymentInvocationFromClientFamily } from '../../src/core/runtime/deployment-aws-invocation.js';
import { createAwsSingleNodeDeploymentProviderFromClientFamily } from '../../src/core/runtime/deployment-aws-provider-assembly.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import { getAwsSingleNodeDefaultIpv4RouteProviderResourceId } from '../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource.js';
import {
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
} from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import { getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId } from '../../src/core/runtime/deployment-aws-subnet-route-table-association-resource.js';
import { getAwsSingleNodeVolumeAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-volume-attachment-resource.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
import { createDeploymentPlan } from '../../src/core/runtime/deployment-plan.js';
import {
  createAwsProviderScope,
  getDeploymentInstanceId,
} from '../../src/core/runtime/deployment-provider-scope.js';
import {
  createDeploymentIncarnationId,
  createDeploymentResourceBinding,
  createOwnershipNonce,
} from '../../src/core/runtime/deployment-resource-binding.js';
import { getAwsSingleNodeResourceDestroyOrder } from '../../src/core/runtime/deployment-resource-graph.js';
import { validateDeploymentRevision } from '../../src/core/runtime/deployment-revision.js';
import { brandDBClient, DB_ADAPTER_NAMES } from '../../src/core/lib/db/base.js';

const PROVIDER_METHODS = Object.freeze([
  'resolveScope',
  'resolveProviderSpec',
  'validateProviderSpec',
  'inspect',
  'createPlan',
  'executeAction',
  'verifySettlement',
]);
const CLIENT_KEYS = Object.freeze([
  'deploymentStore',
  'dynamoControl',
  's3Control',
  'providerSpecRead',
  'managedArtifact',
  'volume',
  'network',
  'runtimeIdentity',
  'node',
  'volumeAttachment',
]);
/** @type {Readonly<Record<string, ReadonlyArray<string>>>} */
const CLIENT_METHODS = Object.freeze({
  deploymentStore: Object.freeze([
    'query',
    'queryPage',
    'batchWrite',
    'transactionWrite',
    'update',
    'put',
    'get',
    'remove',
    'close',
  ]),
  dynamoControl: Object.freeze([
    'createTable',
    'describeContinuousBackups',
    'describeTable',
    'describeTimeToLive',
    'listTagsOfResource',
    'updateContinuousBackups',
    'close',
  ]),
  s3Control: Object.freeze([
    'createBucket',
    'headBucket',
    'getBucketEncryption',
    'getBucketLifecycleConfiguration',
    'getBucketLocation',
    'getBucketOwnershipControls',
    'getBucketPolicy',
    'getBucketReplication',
    'getBucketTagging',
    'getBucketVersioning',
    'getPublicAccessBlock',
    'getObject',
    'putBucketEncryption',
    'putBucketLifecycleConfiguration',
    'putBucketOwnershipControls',
    'putBucketVersioning',
    'putPublicAccessBlock',
    'putObject',
    'headObject',
    'close',
  ]),
  providerSpecRead: Object.freeze([
    'getParameter',
    'describeImages',
    'describeAvailabilityZones',
    'describeInstanceTypeOfferings',
    'getEbsDefaultKmsKeyId',
    'close',
  ]),
  managedArtifact: Object.freeze([
    'copyObject',
    'close',
    'headObject',
    'listObjectVersions',
    'deleteObjectVersion',
  ]),
  volume: Object.freeze(['close', 'createVolume', 'describeVolumes']),
  network: Object.freeze([
    'associateRouteTable',
    'attachInternetGateway',
    'createInternetGateway',
    'createRoute',
    'createRouteTable',
    'createSecurityGroup',
    'createSubnet',
    'createVpc',
    'close',
    'deleteInternetGateway',
    'deleteRoute',
    'deleteRouteTable',
    'deleteSecurityGroup',
    'deleteSubnet',
    'deleteVpc',
    'describeInternetGateways',
    'describeRouteTables',
    'describeSecurityGroups',
    'describeSubnets',
    'describeVpcAttribute',
    'describeVpcs',
    'detachInternetGateway',
    'disassociateRouteTable',
  ]),
  runtimeIdentity: Object.freeze([
    'addRoleToInstanceProfile',
    'createInstanceProfile',
    'createRole',
    'close',
    'deleteInstanceProfile',
    'deleteRole',
    'deleteRolePolicy',
    'describeInstances',
    'getInstanceProfile',
    'getRole',
    'getRolePolicy',
    'listAttachedRolePolicies',
    'listInstanceProfilesForRole',
    'listInstanceProfileTags',
    'listRolePolicies',
    'listRoleTags',
    'putRolePolicy',
    'removeRoleFromInstanceProfile',
  ]),
  node: Object.freeze([
    'close',
    'runInstances',
    'startInstances',
    'describeInstances',
    'describeInstanceAttribute',
    'describeInstanceCreditSpecifications',
    'describeVolumes',
    'terminateInstances',
  ]),
  volumeAttachment: Object.freeze([
    'attachVolume',
    'close',
    'describeInstances',
    'describeVolumes',
    'detachVolume',
    'modifyInstanceAttribute',
  ]),
});

/** @typedef {Record<string, any>} AnyRecord */

const APPLICATION_VOLUME_ID = 'vol-00000000000000001';
const CONTROL_VOLUME_ID = 'vol-00000000000000002';
const VPC_ID = 'vpc-00000000000000001';
const INTERNET_GATEWAY_ID = 'igw-00000000000000001';
const SUBNET_ID = 'subnet-00000000000000001';
const ROUTE_TABLE_ID = 'rtb-00000000000000001';
const SECURITY_GROUP_ID = 'sg-00000000000000001';
const RUNTIME_ROLE_ID = 'AROA1234567890EXAMPLE';
const RUNTIME_IDENTITY_ID = 'AIPA1234567890EXAMPLE';
const SUBSTRATE_ID = 'i-00000000000000001';

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

/** @param {number} byte @returns {string} */
function nonce(byte) {
  return createOwnershipNonce(Buffer.alloc(32, byte));
}

/** @param {string} clientKey @param {readonly string[]} methods @param {jest.Mock[]} io */
function makeClient(clientKey, methods, io) {
  const client = Object.fromEntries(
    methods.map((method) => {
      const mock = jest.fn();
      mock.mockName(`${clientKey}.${method}`);
      io.push(mock);
      return [method, mock];
    }),
  );
  if (clientKey === 'deploymentStore') {
    brandDBClient(client, DB_ADAPTER_NAMES.DYNAMODB);
  }
  return Object.freeze(client);
}

/** @returns {{family: Readonly<AnyRecord>, providerScope: Readonly<AnyRecord>, io: jest.Mock[], receivers: unknown[]}} */
function makeClientFamily() {
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId: '123456789012',
    region: 'us-east-1',
  });
  /** @type {jest.Mock[]} */
  const io = [];
  /** @type {unknown[]} */
  const receivers = [];
  const scopeResolver = {
    resolveScope: jest.fn(
      /**
       * @this {unknown}
       * @param {unknown} context
       */
      function resolveScope(context) {
        receivers.push(this);
        return Object.freeze({ providerScope, context });
      },
    ),
  };
  Object.freeze(scopeResolver);
  const clients = Object.freeze(
    Object.fromEntries(
      CLIENT_KEYS.map((clientKey) => [
        clientKey,
        makeClient(clientKey, CLIENT_METHODS[clientKey], io),
      ]),
    ),
  );
  const close = jest.fn();
  return {
    family: Object.freeze({
      providerScope,
      scopeResolver,
      clients,
      close,
    }),
    providerScope,
    io,
    receivers,
  };
}

/** @param {Readonly<AnyRecord>} providerScope @returns {Readonly<AnyRecord>} */
function makeAbsentInspectionContext(providerScope) {
  const appId = 'aws-provider-assembly-test';
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId,
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider(providerScope.region),
  });
  const revisionPayload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'production' },
    appId,
    revisionId: semanticId(
      'wrv1',
      'wharfie:test:aws-provider-assembly-revision:v1',
      { appId },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'provider assembly artifact',
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
  const providerSpec = createAwsSingleNodeProviderSpec({
    profile,
    providerScope,
    machineImage: {
      sourceParameter: {
        name: AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64,
        version: 42,
      },
      imageId: 'ami-0123456789abcdef1',
      ownerAccountId: '137112412989',
      architecture: 'x86_64',
      imageType: 'machine',
      rootDeviceType: 'ebs',
      virtualizationType: 'hvm',
      enaSupport: true,
      rootDeviceName: '/dev/xvda',
      rootBlockDevice: {
        snapshotId: 'snap-0123456789abcdef1',
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
  const deploymentInstanceId = getDeploymentInstanceId({
    deploymentRevision,
    providerScope,
  });
  return Object.freeze({
    operation: 'apply',
    deploymentRevision,
    profile,
    providerScope,
    providerSpec,
    deploymentInstanceId,
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 71)),
    head: null,
    plan: null,
    settledPlan: null,
    pendingBinding: null,
  });
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>|null} [head]
 * @returns {ReadonlyArray<Readonly<AnyRecord>>}
 */
function makeTargets(base, head = null) {
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

/** @param {Readonly<AnyRecord>} base @returns {Readonly<AnyRecord>} */
function makeCreatePlan(base) {
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
          'wharfie:test:aws-provider-assembly-create-basis:v1',
          base.deploymentInstanceId,
        ),
      },
      actions: makeTargets(base).map((target) => ({
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

/** @param {Readonly<AnyRecord>} base @param {string} resourceKey @returns {string} */
function providerResourceId(base, resourceKey) {
  if (resourceKey === 'artifact') {
    return getAwsSingleNodeManagedArtifactObjectLocation({
      providerScope: base.providerScope,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
    }).arn;
  }
  if (resourceKey === 'application-state') return APPLICATION_VOLUME_ID;
  if (resourceKey === 'control-state') return CONTROL_VOLUME_ID;
  if (resourceKey === 'network-vpc') return VPC_ID;
  if (resourceKey === 'network-internet-gateway') {
    return INTERNET_GATEWAY_ID;
  }
  if (resourceKey === 'network-internet-gateway-attachment') {
    return getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
      INTERNET_GATEWAY_ID,
      VPC_ID,
    );
  }
  if (resourceKey === 'network-subnet') return SUBNET_ID;
  if (resourceKey === 'network-route-table') return ROUTE_TABLE_ID;
  if (resourceKey === 'network-default-ipv4-route') {
    return getAwsSingleNodeDefaultIpv4RouteProviderResourceId(
      base.providerSpec.capabilities.networking.egressCidr,
      INTERNET_GATEWAY_ID,
      ROUTE_TABLE_ID,
    );
  }
  if (resourceKey === 'network-subnet-route-table-association') {
    return getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId(
      ROUTE_TABLE_ID,
      SUBNET_ID,
    );
  }
  if (resourceKey === 'network-security-group') return SECURITY_GROUP_ID;
  if (resourceKey === 'runtime-role') return RUNTIME_ROLE_ID;
  if (resourceKey === 'runtime-role-policy') {
    return getAwsSingleNodeRuntimePolicyProviderResourceId({
      runtimeRoleId: RUNTIME_ROLE_ID,
    });
  }
  if (resourceKey === 'runtime-identity') return RUNTIME_IDENTITY_ID;
  if (resourceKey === 'runtime-identity-role-association') {
    return getAwsSingleNodeRuntimeAssociationProviderResourceId({
      runtimeRoleId: RUNTIME_ROLE_ID,
      instanceProfileId: RUNTIME_IDENTITY_ID,
    });
  }
  if (resourceKey === 'substrate') return SUBSTRATE_ID;
  if (resourceKey === 'application-state-attachment') {
    return getAwsSingleNodeVolumeAttachmentProviderResourceId(
      base.providerSpec,
      'application-state',
      SUBSTRATE_ID,
      APPLICATION_VOLUME_ID,
    );
  }
  if (resourceKey === 'control-state-attachment') {
    return getAwsSingleNodeVolumeAttachmentProviderResourceId(
      base.providerSpec,
      'control-state',
      SUBSTRATE_ID,
      CONTROL_VOLUME_ID,
    );
  }
  throw new Error(`Unsupported provider-assembly resource '${resourceKey}'.`);
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>} plan
 * @param {ReadonlyArray<Readonly<AnyRecord>>} intents
 * @returns {ReadonlyArray<Readonly<AnyRecord>>}
 */
function makeBindings(base, plan, intents) {
  const bindingByKey = new Map();
  return makeTargets(base).map((target, index) => {
    const dependencyBindings = target.dependsOn
      .map((/** @type {string} */ resourceKey) => {
        const dependency = bindingByKey.get(resourceKey);
        if (dependency === undefined) {
          throw new Error(
            `Missing provider-assembly dependency '${resourceKey}'.`,
          );
        }
        return { resourceKey, bindingId: dependency.bindingId };
      })
      .sort(
        (
          /** @type {{resourceKey: string}} */ left,
          /** @type {{resourceKey: string}} */ right,
        ) => compareCanonicalStrings(left.resourceKey, right.resourceKey),
      );
    const binding = createDeploymentResourceBinding({
      schemaVersion: 2,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      resourceKey: target.resourceKey,
      capability: target.capability,
      role: target.role,
      management: target.management,
      ownershipMode: target.ownershipMode,
      onDestroy: target.onDestroy,
      dependencyBindings,
      providerType: target.target.providerType,
      providerResourceId: providerResourceId(base, target.resourceKey),
      providerScopeId: base.providerScope.providerScopeId,
      ownershipNonce: intents[index].ownershipNonce,
      createdByActionId: plan.actions[index].actionId,
    });
    bindingByKey.set(target.resourceKey, binding);
    return binding;
  });
}

/**
 * Create a real DESTROYED head whose purge bindings have been removed, paired
 * with the exact completed destroy PlanV3 receipt that remains read authority.
 * @param {Readonly<AnyRecord>} providerScope
 * @returns {Readonly<AnyRecord>}
 */
function makeDestroyedInspectionContext(providerScope) {
  const base = makeAbsentInspectionContext(providerScope);
  const createPlan = makeCreatePlan(base);
  const createIntents = createPlan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ action,
      /** @type {number} */ index,
    ) => ({
      actionId: action.actionId,
      status: 'settled',
      ownershipNonce: nonce(100 + index),
    }),
  );
  const bindings = makeBindings(base, createPlan, createIntents);
  const readyHead = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 38,
    phase: 'READY',
    settledDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    resourceBindings: bindings,
    activeOperation: null,
    lastOperation: {
      kind: 'create',
      planId: createPlan.planId,
      intents: createIntents,
    },
  });
  const targetByKey = new Map(
    makeTargets(base, readyHead).map((target) => [target.resourceKey, target]),
  );
  const bindingByKey = new Map(
    bindings.map((binding) => [binding.resourceKey, binding]),
  );
  const destroyPlan = createDeploymentPlan(
    {
      operation: 'destroy',
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpec: base.providerSpec,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      basis: {
        headGeneration: readyHead.generation,
        settledDeploymentRevisionId:
          base.deploymentRevision.deploymentRevisionId,
        inspectionId: semanticId(
          'win6',
          'wharfie:test:aws-provider-assembly-destroy-basis:v1',
          readyHead.headId,
        ),
      },
      actions: getAwsSingleNodeResourceDestroyOrder().map((resourceKey) => {
        const target = targetByKey.get(resourceKey);
        const binding = bindingByKey.get(resourceKey);
        if (target === undefined || binding === undefined) {
          throw new Error(
            `Missing provider-assembly destroy resource '${resourceKey}'.`,
          );
        }
        const before = {
          providerType: target.target.providerType,
          providerResourceId: binding.providerResourceId,
          stateDigest: target.target.stateDigest,
        };
        const retained = target.onDestroy === 'retain';
        return {
          resourceKey,
          capability: target.capability,
          role: target.role,
          management: target.management,
          ownershipMode: target.ownershipMode,
          dependsOn: target.dependsOn,
          onDestroy: target.onDestroy,
          action: retained ? 'noop' : 'delete',
          destructive: !retained,
          reason: retained ? 'retained-data' : 'destroy-requested',
          before,
          after: retained ? before : null,
        };
      }),
    },
    { profile: base.profile },
  );
  const destroyIntents = destroyPlan.actions.map(
    (/** @type {Readonly<AnyRecord>} */ action) => {
      const binding = bindingByKey.get(action.resourceKey);
      if (binding === undefined) {
        throw new Error(
          `Missing provider-assembly destroy intent '${action.resourceKey}'.`,
        );
      }
      return {
        actionId: action.actionId,
        status: 'settled',
        ownershipNonce: binding.ownershipNonce,
      };
    },
  );
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: readyHead.generation + 38,
    phase: 'DESTROYED',
    settledDeploymentRevisionId: null,
    targetDeploymentRevisionId: null,
    resourceBindings: bindings.filter(
      (binding) => binding.onDestroy === 'retain',
    ),
    activeOperation: null,
    lastOperation: {
      kind: 'destroy',
      planId: destroyPlan.planId,
      intents: destroyIntents,
    },
  });
  return Object.freeze({
    ...base,
    operation: 'destroy',
    head,
    plan: null,
    settledPlan: destroyPlan,
    pendingBinding: null,
    readyBindings: bindings,
    targets: makeTargets(base, head),
  });
}

/** @param {Record<string, string>} tags @returns {{Key: string, Value: string}[]} */
function tagArray(tags) {
  return Object.entries(tags)
    .sort(([left], [right]) => compareCanonicalStrings(left, right))
    .map(([Key, Value]) => ({ Key, Value }));
}

/**
 * @param {Readonly<AnyRecord>} context
 * @param {'application-state'|'control-state'} resourceKey
 * @param {Readonly<AnyRecord>} [overrides]
 * @returns {Readonly<AnyRecord>}
 */
function retainedVolume(context, resourceKey, overrides = {}) {
  const target = context.targets.find(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === resourceKey,
  );
  const binding = context.readyBindings.find(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === resourceKey,
  );
  if (target === undefined || binding === undefined) {
    throw new Error(`Missing retained volume '${resourceKey}'.`);
  }
  const configuration =
    resourceKey === 'application-state'
      ? context.providerSpec.capabilities.applicationState
      : context.providerSpec.capabilities.controlState;
  return Object.freeze({
    VolumeId: binding.providerResourceId,
    AvailabilityZoneId: context.providerSpec.placement.availabilityZoneId,
    AvailabilityZone: 'us-east-1a',
    VolumeType: configuration.volumeType,
    Size: configuration.sizeGiB,
    Iops: configuration.iops,
    Throughput: configuration.throughputMiBps,
    MultiAttachEnabled: configuration.multiAttach,
    Encrypted: configuration.encrypted,
    KmsKeyId: context.providerSpec.storage.ebsKmsKeyArn,
    SnapshotId: '',
    State: 'available',
    CreateTime: new Date('2026-07-23T12:00:00.000Z'),
    Attachments: [],
    Tags: tagArray({
      'wharfie:managed-by': 'wharfie',
      'wharfie:resource-kind': 'single-node-state-volume',
      'wharfie:retention': 'retain',
      'wharfie:schema-version': '2',
      'wharfie:capability': target.capability.kind,
      'wharfie:role': target.role.kind,
      'wharfie:provider-scope-id': context.providerScope.providerScopeId,
      'wharfie:deployment-instance-id': context.deploymentInstanceId,
      'wharfie:incarnation-id': context.incarnationId,
      'wharfie:resource-key': resourceKey,
      'wharfie:created-by-action-id': binding.createdByActionId,
      'wharfie:ownership-nonce': binding.ownershipNonce,
      'wharfie:state-digest': target.target.stateDigest.value,
    }),
    FastRestored: false,
    SseType: 'sse-kms',
    ...overrides,
  });
}

/** @param {string} name @returns {Error & {name: string}} */
function awsError(name) {
  const error = /** @type {Error & {name: string}} */ (
    new Error(`simulated ${name}`)
  );
  error.name = name;
  return error;
}

/**
 * @param {Readonly<AnyRecord>} clientFamily
 * @param {Readonly<AnyRecord>} context
 * @param {'application-state'|'control-state'|null} [remainingAttachment]
 * @returns {ReadonlyArray<Readonly<AnyRecord>>}
 */
function configureDestroyedReadClients(
  clientFamily,
  context,
  remainingAttachment = null,
) {
  const clients = clientFamily.clients;
  const location = getAwsSingleNodeManagedArtifactObjectLocation({
    providerScope: context.providerScope,
    deploymentInstanceId: context.deploymentInstanceId,
    incarnationId: context.incarnationId,
  });
  clients.managedArtifact.listObjectVersions.mockResolvedValue({
    Name: location.bucketName,
    Prefix: location.key,
    MaxKeys: 1000,
    EncodingType: 'url',
    IsTruncated: false,
    Versions: [],
    DeleteMarkers: [],
  });
  clients.managedArtifact.headObject.mockRejectedValue(awsError('NotFound'));
  const retainedResourceKeys =
    /** @type {ReadonlyArray<'application-state'|'control-state'>} */ ([
      'application-state',
      'control-state',
    ]);
  const volumes = retainedResourceKeys.map(
    (/** @type {'application-state'|'control-state'} */ resourceKey) => {
      if (resourceKey !== remainingAttachment) {
        return retainedVolume(context, resourceKey);
      }
      const configuration =
        resourceKey === 'application-state'
          ? context.providerSpec.capabilities.applicationState
          : context.providerSpec.capabilities.controlState;
      const volumeId =
        resourceKey === 'application-state'
          ? APPLICATION_VOLUME_ID
          : CONTROL_VOLUME_ID;
      return retainedVolume(context, resourceKey, {
        State: 'in-use',
        Attachments: [
          {
            VolumeId: volumeId,
            InstanceId: SUBSTRATE_ID,
            Device: configuration.deviceName,
            State: 'attached',
            DeleteOnTermination: false,
            EbsCardIndex: 0,
          },
        ],
      });
    },
  );
  const describeVolumes = (/** @type {Readonly<AnyRecord>} */ request) => ({
    Volumes: volumes.filter((volume) =>
      request.VolumeIds.includes(volume.VolumeId),
    ),
  });
  clients.volume.describeVolumes.mockImplementation(describeVolumes);
  clients.network.describeVpcs.mockResolvedValue({ Vpcs: [] });
  clients.network.describeInternetGateways.mockResolvedValue({
    InternetGateways: [],
  });
  clients.network.describeSubnets.mockResolvedValue({ Subnets: [] });
  clients.network.describeRouteTables.mockResolvedValue({
    RouteTables: [],
  });
  clients.network.describeSecurityGroups.mockResolvedValue({
    SecurityGroups: [],
  });
  clients.runtimeIdentity.getRole.mockRejectedValue(awsError('NoSuchEntity'));
  clients.runtimeIdentity.getInstanceProfile.mockRejectedValue(
    awsError('NoSuchEntity'),
  );
  clients.node.describeInstances.mockImplementation(
    async (/** @type {Readonly<AnyRecord>} */ request) => {
      if (Object.hasOwn(request, 'InstanceIds')) {
        throw awsError('InvalidInstanceID.NotFound');
      }
      return { Reservations: [] };
    },
  );
  clients.node.describeVolumes.mockResolvedValue({ Volumes: [] });
  clients.volumeAttachment.describeInstances.mockRejectedValue(
    awsError('InvalidInstanceID.NotFound'),
  );
  clients.volumeAttachment.describeVolumes.mockImplementation(describeVolumes);
  return Object.freeze(volumes);
}

describe('AWS single-node deployment provider client-family assembly', () => {
  it('composes through the real owned invocation boundary without construction I/O', async () => {
    const fixture = makeClientFamily();

    const invocation = createAwsSingleNodeDeploymentInvocationFromClientFamily({
      clientFamily: fixture.family,
      now: () => 1_900_000_000_000,
      maxAttempts: 2,
      waitForRetry: async () => {},
    });

    expect(Object.keys(invocation)).toEqual([
      'providerScope',
      'inspectControl',
      'requireControl',
      'reconcileControl',
      'bootstrapControl',
      'inspect',
      'plan',
      'converge',
      'resume',
      'close',
    ]);
    expect(fixture.io.every((method) => method.mock.calls.length === 0)).toBe(
      true,
    );
    expect(fixture.family.close).not.toHaveBeenCalled();

    await invocation.close();
    expect(fixture.family.close).toHaveBeenCalledTimes(1);
  });

  it('constructs the exact frozen provider without I/O, close, or leaked capabilities', () => {
    const fixture = makeClientFamily();
    const provider = createAwsSingleNodeDeploymentProviderFromClientFamily({
      clientFamily: fixture.family,
      now: () => 1_900_000_000_000,
      maxAttempts: 2,
      waitForRetry: async () => {},
    });

    expect(Object.keys(provider)).toEqual(PROVIDER_METHODS);
    expect(Object.isFrozen(provider)).toBe(true);
    expect(provider).not.toHaveProperty('close');
    expect(provider).not.toHaveProperty('publish');
    expect(provider).not.toHaveProperty('observeResource');
    expect(provider).not.toHaveProperty('createVolume');
    expect(fixture.family.close).not.toHaveBeenCalled();
    expect(fixture.io.every((mock) => mock.mock.calls.length === 0)).toBe(true);
  });

  it('preserves the caller-owned scope resolver receiver and exact argument', () => {
    const fixture = makeClientFamily();
    const provider = createAwsSingleNodeDeploymentProviderFromClientFamily({
      clientFamily: fixture.family,
    });
    const context = Object.freeze({ operation: 'inspect' });

    const result = provider.resolveScope(context);

    expect(result).toEqual({
      providerScope: fixture.providerScope,
      context,
    });
    expect(fixture.receivers).toEqual([fixture.family.scopeResolver]);
    expect(fixture.family.scopeResolver.resolveScope).toHaveBeenCalledWith(
      context,
    );
  });

  it('returns authoritative null-head absence without resource or service I/O', async () => {
    const fixture = makeClientFamily();
    const now = jest.fn(() => 1_900_000_000_000);
    const provider = createAwsSingleNodeDeploymentProviderFromClientFamily({
      clientFamily: fixture.family,
      now,
    });

    const inspection = /** @type {AnyRecord} */ (
      await provider.inspect(makeAbsentInspectionContext(fixture.providerScope))
    );

    expect(inspection.status).toBe('absent');
    expect(inspection.resources).toEqual([]);
    expect(now).toHaveBeenCalledTimes(1);
    expect(fixture.io.every((mock) => mock.mock.calls.length === 0)).toBe(true);
    expect(fixture.family.close).not.toHaveBeenCalled();
  });

  it('derives DESTROYED through the fully assembled real observers after purge bindings are gone', async () => {
    const fixture = makeClientFamily();
    const destroyed = makeDestroyedInspectionContext(fixture.providerScope);
    const { readyBindings: _readyBindings, targets, ...context } = destroyed;
    const clients = fixture.family.clients;
    configureDestroyedReadClients(fixture.family, destroyed);
    const waitForRetry = jest.fn(async () => {});
    const provider = createAwsSingleNodeDeploymentProviderFromClientFamily({
      clientFamily: fixture.family,
      now: () => 1_900_000_000_000,
      maxAttempts: 2,
      waitForRetry,
    });

    const inspection = /** @type {AnyRecord} */ (
      await provider.inspect(context)
    );

    expect(inspection.status).toBe('destroyed');
    expect(inspection.resources).toHaveLength(targets.length);
    expect(
      inspection.resources
        .filter(
          (/** @type {Readonly<AnyRecord>} */ resource) =>
            resource.onDestroy === 'retain',
        )
        .every(
          (/** @type {Readonly<AnyRecord>} */ resource) =>
            resource.presence === 'present' &&
            resource.ownership === 'verified' &&
            resource.bindingId !== null,
        ),
    ).toBe(true);
    expect(
      inspection.resources
        .filter(
          (/** @type {Readonly<AnyRecord>} */ resource) =>
            resource.onDestroy === 'purge',
        )
        .every(
          (/** @type {Readonly<AnyRecord>} */ resource) =>
            resource.presence === 'absent' &&
            resource.ownership === 'missing' &&
            resource.bindingId === null,
        ),
    ).toBe(true);
    expect(clients.node.describeInstances).toHaveBeenCalledTimes(4);
    expect(clients.node.describeInstances).toHaveBeenCalledWith({
      InstanceIds: [SUBSTRATE_ID],
    });
    expect(
      clients.node.describeInstances.mock.calls.filter(
        (/** @type {AnyRecord[]} */ call) => Object.hasOwn(call[0], 'Filters'),
      ),
    ).toHaveLength(2);
    expect(clients.node.describeVolumes).toHaveBeenCalledTimes(2);
    expect(clients.node.runInstances).not.toHaveBeenCalled();
    expect(clients.node.terminateInstances).not.toHaveBeenCalled();
    expect(clients.volume.createVolume).not.toHaveBeenCalled();
    expect(clients.network.deleteVpc).not.toHaveBeenCalled();
    expect(clients.runtimeIdentity.deleteRole).not.toHaveBeenCalled();
    expect(clients.managedArtifact.deleteObjectVersion).not.toHaveBeenCalled();
    expect(fixture.family.close).not.toHaveBeenCalled();
  });

  it('keeps a destroyed retained-volume attachment unknown while fresh volume evidence still carries it', async () => {
    const fixture = makeClientFamily();
    const destroyed = makeDestroyedInspectionContext(fixture.providerScope);
    const {
      readyBindings: _readyBindings,
      targets: _targets,
      ...context
    } = destroyed;
    configureDestroyedReadClients(
      fixture.family,
      destroyed,
      'application-state',
    );
    const provider = createAwsSingleNodeDeploymentProviderFromClientFamily({
      clientFamily: fixture.family,
      now: () => 1_900_000_000_000,
      maxAttempts: 2,
      waitForRetry: async () => {},
    });

    const inspection = /** @type {AnyRecord} */ (
      await provider.inspect(context)
    );
    const resource = (/** @type {string} */ resourceKey) =>
      inspection.resources.find(
        (/** @type {Readonly<AnyRecord>} */ candidate) =>
          candidate.resourceKey === resourceKey,
      );

    expect(inspection.status).toBe('unknown');
    expect(resource('application-state')).toMatchObject({
      presence: 'present',
      ownership: 'verified',
    });
    expect(resource('application-state-attachment')).toMatchObject({
      presence: 'unknown',
      ownership: 'unknown',
    });
    expect(resource('control-state-attachment')).toMatchObject({
      presence: 'absent',
      ownership: 'missing',
    });
    expect(
      fixture.family.clients.volumeAttachment.describeVolumes,
    ).toHaveBeenCalledWith({
      VolumeIds: [APPLICATION_VOLUME_ID],
    });
  });

  it('preserves a projected read receiver and the common retry policy', async () => {
    const fixture = makeClientFamily();
    const providerSpecRead = fixture.family.clients.providerSpecRead;
    /** @type {unknown[]} */
    const receivers = [];
    providerSpecRead.getParameter.mockImplementation(
      /**
       * @this {unknown}
       */
      function getParameter() {
        receivers.push(this);
        throw new Error('simulated provider read failure');
      },
    );
    const waitForRetry = jest.fn(async (/** @type {number} */ _attempt) => {});
    const provider = createAwsSingleNodeDeploymentProviderFromClientFamily({
      clientFamily: fixture.family,
      maxAttempts: 2,
      waitForRetry,
    });
    const context = makeAbsentInspectionContext(fixture.providerScope);

    await expect(
      provider.resolveProviderSpec({
        operation: context.operation,
        deploymentRevision: context.deploymentRevision,
        providerScope: context.providerScope,
        deploymentInstanceId: context.deploymentInstanceId,
        incarnationId: context.incarnationId,
        profile: context.profile,
        head: null,
      }),
    ).rejects.toMatchObject({
      name: 'AwsSingleNodeProviderSpecUnknownError',
      code: 'AWS_SINGLE_NODE_PROVIDER_SPEC_UNKNOWN',
    });
    expect(providerSpecRead.getParameter).toHaveBeenCalledTimes(2);
    expect(receivers).toEqual([providerSpecRead, providerSpecRead]);
    expect(waitForRetry).toHaveBeenCalledTimes(1);
    expect(waitForRetry).toHaveBeenCalledWith(1);
  });

  it('projects full mutation-capable clients through all real read-only observers', () => {
    const fixture = makeClientFamily();

    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: fixture.family,
        maxAttempts: 10,
        waitForRetry: async () => {},
      }),
    ).not.toThrow();
  });

  it.each([null, [], () => {}, Object.create({ clientFamily: {} })])(
    'rejects non-plain assembly options %#',
    (options) => {
      expect(() =>
        createAwsSingleNodeDeploymentProviderFromClientFamily(options),
      ).toThrow(/options must be an object/i);
    },
  );

  it('rejects missing and unsupported assembly options', () => {
    const fixture = makeClientFamily();
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({}),
    ).toThrow(/clientFamily.*required/i);
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: fixture.family,
        bootstrap: true,
      }),
    ).toThrow(/bootstrap.*not supported/i);
  });

  it.each([1, 11, 2.5, Number.NaN])(
    'rejects an invalid common maxAttempts value %#',
    (maxAttempts) => {
      const fixture = makeClientFamily();
      expect(() =>
        createAwsSingleNodeDeploymentProviderFromClientFamily({
          clientFamily: fixture.family,
          maxAttempts,
        }),
      ).toThrow(/maxAttempts.*2.*10/i);
    },
  );

  it('rejects invalid clock and wait policy options', () => {
    const fixture = makeClientFamily();
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: fixture.family,
        now: 1,
      }),
    ).toThrow(/now.*function/i);
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: fixture.family,
        waitForRetry: true,
      }),
    ).toThrow(/waitForRetry.*function/i);
  });

  it('requires the exact family and client-map surfaces', () => {
    const fixture = makeClientFamily();
    const missingClose = { ...fixture.family };
    delete missingClose.close;
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: missingClose,
      }),
    ).toThrow(/clientFamily\.close.*required/i);

    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: { ...fixture.family, bootstrap: jest.fn() },
      }),
    ).toThrow(/clientFamily\.bootstrap.*not supported/i);

    const missingClient = { ...fixture.family.clients };
    delete missingClient.node;
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: { ...fixture.family, clients: missingClient },
      }),
    ).toThrow(/clients\.node.*required/i);

    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: {
          ...fixture.family,
          clients: { ...fixture.family.clients, bootstrap: {} },
        },
      }),
    ).toThrow(/clients\.bootstrap.*not supported/i);
  });

  it('rejects malformed family ports and required read methods', () => {
    const fixture = makeClientFamily();
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: {
          ...fixture.family,
          scopeResolver: { resolveScope: null },
        },
      }),
    ).toThrow(/scopeResolver\.resolveScope.*function/i);
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: {
          ...fixture.family,
          scopeResolver: {
            ...fixture.family.scopeResolver,
            close: jest.fn(),
          },
        },
      }),
    ).toThrow(/scopeResolver\.close.*not supported/i);
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: { ...fixture.family, close: null },
      }),
    ).toThrow(/clientFamily\.close.*function/i);

    const providerSpecRead = { ...fixture.family.clients.providerSpecRead };
    delete providerSpecRead.getParameter;
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: {
          ...fixture.family,
          clients: {
            ...fixture.family.clients,
            providerSpecRead,
          },
        },
      }),
    ).toThrow(/provider-spec client\.getParameter.*function/i);
  });
});
