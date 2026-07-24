import { describe, expect, it, jest } from '@jest/globals';

import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_PREFIX,
  getAwsSingleNodeDefaultIpv4RouteStateDigest,
} from '../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js';
import {
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
  getAwsSingleNodeInternetGatewayAttachmentStateDigest,
} from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource.js';
import { getAwsSingleNodeInternetGatewayStateDigest } from '../../src/core/runtime/deployment-aws-internet-gateway-resource.js';
import { getAwsSingleNodeManagedArtifactStateDigest } from '../../src/core/runtime/deployment-aws-managed-artifact-resource.js';
import { getAwsSingleNodeNodeStateDigest } from '../../src/core/runtime/deployment-aws-node-resource.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { getAwsSingleNodeRouteTableStateDigest } from '../../src/core/runtime/deployment-aws-route-table-resource.js';
import {
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimeAssociationStateDigest,
  getAwsSingleNodeRuntimeInstanceProfileStateDigest,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
  getAwsSingleNodeRuntimePolicyStateDigest,
  getAwsSingleNodeRuntimeRoleStateDigest,
} from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import { getAwsSingleNodeSecurityGroupStateDigest } from '../../src/core/runtime/deployment-aws-security-group-resource.js';
import {
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_PREFIX,
  getAwsSingleNodeSubnetRouteTableAssociationStateDigest,
} from '../../src/core/runtime/deployment-aws-subnet-route-table-association-resource.js';
import { getAwsSingleNodeSubnetStateDigest } from '../../src/core/runtime/deployment-aws-subnet-resource.js';
import {
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DELETE_ON_TERMINATION,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_STATE_DIGEST_DOMAIN,
  AwsSingleNodeVolumeAttachmentResourceConflictError,
  AwsSingleNodeVolumeAttachmentResourceUnknownError,
  createAwsSingleNodeVolumeAttachmentResource,
  getAwsSingleNodeVolumeAttachmentProviderResourceId,
  getAwsSingleNodeVolumeAttachmentStateDigest,
} from '../../src/core/runtime/deployment-aws-volume-attachment-resource.js';
import { getAwsSingleNodeVolumeStateDigest } from '../../src/core/runtime/deployment-aws-volume-resource.js';
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

const IDS = Object.freeze({
  instance: 'i-00000000000000001',
  otherInstance: 'i-00000000000000002',
  rootVolume: 'vol-00000000000000003',
  applicationVolume: 'vol-00000000000000001',
  controlVolume: 'vol-00000000000000002',
  otherVolume: 'vol-00000000000000004',
  vpc: 'vpc-00000000000000001',
  internetGateway: 'igw-00000000000000001',
  subnet: 'subnet-00000000000000001',
  routeTable: 'rtb-00000000000000001',
  routeTableAssociation: 'rtbassoc-00000000000000001',
  securityGroup: 'sg-00000000000000001',
  runtimeRole: 'AROA1234567890EXAMPLE',
  instanceProfile: 'AIPA1234567890EXAMPLE',
});

const CAPABILITY_CASES = Object.freeze([
  Object.freeze({
    capability: 'application-state',
    resourceKey: 'application-state-attachment',
    volumeId: IDS.applicationVolume,
    deviceName: '/dev/sdf',
  }),
  Object.freeze({
    capability: 'control-state',
    resourceKey: 'control-state-attachment',
    volumeId: IDS.controlVolume,
    deviceName: '/dev/sdg',
  }),
]);

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

/** @param {string} name @param {string} [message] @returns {Error} */
function providerError(name, message = 'provider-secret') {
  const error = new Error(message);
  error.name = name;
  return error;
}

/** @param {any} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @param {Readonly<Record<string, any>>} base @returns {Readonly<Record<string, string>>} */
function nameAuthority(base) {
  return Object.freeze({
    providerScopeId: base.providerScope.providerScopeId,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
  });
}

/** @param {Readonly<Record<string, any>>} base @returns {Readonly<Record<string, any>>} */
function policyAuthority(base) {
  return Object.freeze({
    providerScope: base.providerScope,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
  });
}

/** @param {string} internetGatewayId @param {string} vpcId @returns {string} */
function internetGatewayAttachmentId(internetGatewayId, vpcId) {
  return semanticId(
    AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
    AWS_SINGLE_NODE_INTERNET_GATEWAY_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
    { internetGatewayId, vpcId },
  );
}

/** @param {string} internetGatewayId @param {string} routeTableId @returns {string} */
function defaultRouteId(internetGatewayId, routeTableId) {
  return semanticId(
    AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_PREFIX,
    AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_PROVIDER_RESOURCE_ID_DOMAIN,
    {
      destinationCidrBlock: '0.0.0.0/0',
      internetGatewayId,
      routeTableId,
    },
  );
}

/** @param {string} routeTableId @param {string} subnetId @returns {string} */
function subnetAssociationId(routeTableId, subnetId) {
  return semanticId(
    AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_PREFIX,
    AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_DOMAIN,
    { routeTableId, subnetId },
  );
}

function makeBase() {
  const profile = validateDeploymentProfile(
    createDeploymentProfile({
      profile: { id: 'production' },
      appId: 'volume-attachment-resource-test',
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
      'wharfie:test:volume-attachment-revision:v1',
      { revision: 1 },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'volume attachment resource artifact',
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
      ebsKmsKeyArn:
        'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    },
  });
  const deploymentInstanceId = getDeploymentInstanceId({
    deploymentRevision,
    providerScope,
  });
  return Object.freeze({
    profile,
    deploymentRevision,
    providerScope,
    providerSpec,
    deploymentInstanceId,
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 7)),
  });
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} definition @returns {Readonly<Record<string, any>>} */
function stateDigest(base, definition) {
  switch (definition.resourceKey) {
    case 'artifact':
      return getAwsSingleNodeManagedArtifactStateDigest({
        deploymentRevision: base.deploymentRevision,
        profile: base.profile,
        providerScope: base.providerScope,
        providerSpec: base.providerSpec,
        deploymentInstanceId: base.deploymentInstanceId,
        incarnationId: base.incarnationId,
      });
    case 'application-state':
    case 'control-state':
      return getAwsSingleNodeVolumeStateDigest(
        base.providerSpec,
        definition.resourceKey,
      );
    case 'network-vpc':
      return getAwsSingleNodeVpcStateDigest(base.providerSpec);
    case 'network-internet-gateway':
      return getAwsSingleNodeInternetGatewayStateDigest(base.providerSpec);
    case 'network-internet-gateway-attachment':
      return getAwsSingleNodeInternetGatewayAttachmentStateDigest(
        base.providerSpec,
      );
    case 'network-subnet':
      return getAwsSingleNodeSubnetStateDigest(base.providerSpec);
    case 'network-route-table':
      return getAwsSingleNodeRouteTableStateDigest(base.providerSpec);
    case 'network-default-ipv4-route':
      return getAwsSingleNodeDefaultIpv4RouteStateDigest(base.providerSpec);
    case 'network-subnet-route-table-association':
      return getAwsSingleNodeSubnetRouteTableAssociationStateDigest(
        base.providerSpec,
      );
    case 'network-security-group':
      return getAwsSingleNodeSecurityGroupStateDigest(base.providerSpec);
    case 'runtime-role':
      return getAwsSingleNodeRuntimeRoleStateDigest(nameAuthority(base));
    case 'runtime-role-policy':
      return getAwsSingleNodeRuntimePolicyStateDigest(policyAuthority(base));
    case 'runtime-identity':
      return getAwsSingleNodeRuntimeInstanceProfileStateDigest(
        nameAuthority(base),
      );
    case 'runtime-identity-role-association':
      return getAwsSingleNodeRuntimeAssociationStateDigest(nameAuthority(base));
    case 'substrate':
      return getAwsSingleNodeNodeStateDigest(
        base.providerSpec,
        nameAuthority(base),
      );
    case 'application-state-attachment':
      return getAwsSingleNodeVolumeAttachmentStateDigest(
        base.providerSpec,
        'application-state',
      );
    case 'control-state-attachment':
      return getAwsSingleNodeVolumeAttachmentStateDigest(
        base.providerSpec,
        'control-state',
      );
    default:
      return digest(`${definition.resourceKey} desired`);
  }
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} definition @returns {string} */
function providerResourceId(base, definition) {
  switch (definition.resourceKey) {
    case 'artifact':
      return getAwsSingleNodeManagedArtifactObjectLocation(
        policyAuthority(base),
      ).arn;
    case 'application-state':
      return IDS.applicationVolume;
    case 'control-state':
      return IDS.controlVolume;
    case 'network-vpc':
      return IDS.vpc;
    case 'network-internet-gateway':
      return IDS.internetGateway;
    case 'network-internet-gateway-attachment':
      return internetGatewayAttachmentId(IDS.internetGateway, IDS.vpc);
    case 'network-subnet':
      return IDS.subnet;
    case 'network-route-table':
      return IDS.routeTable;
    case 'network-default-ipv4-route':
      return defaultRouteId(IDS.internetGateway, IDS.routeTable);
    case 'network-subnet-route-table-association':
      return subnetAssociationId(IDS.routeTable, IDS.subnet);
    case 'network-security-group':
      return IDS.securityGroup;
    case 'runtime-role':
      return IDS.runtimeRole;
    case 'runtime-role-policy':
      return getAwsSingleNodeRuntimePolicyProviderResourceId({
        runtimeRoleId: IDS.runtimeRole,
      });
    case 'runtime-identity':
      return IDS.instanceProfile;
    case 'runtime-identity-role-association':
      return getAwsSingleNodeRuntimeAssociationProviderResourceId({
        runtimeRoleId: IDS.runtimeRole,
        instanceProfileId: IDS.instanceProfile,
      });
    case 'substrate':
      return IDS.instance;
    case 'application-state-attachment':
      return getAwsSingleNodeVolumeAttachmentProviderResourceId(
        base.providerSpec,
        'application-state',
        IDS.instance,
        IDS.applicationVolume,
      );
    case 'control-state-attachment':
      return getAwsSingleNodeVolumeAttachmentProviderResourceId(
        base.providerSpec,
        'control-state',
        IDS.instance,
        IDS.controlVolume,
      );
    default:
      return `provider-${definition.resourceKey}`;
  }
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} definition */
function desiredState(base, definition) {
  return {
    providerType: definition.providerType,
    providerResourceId:
      definition.resourceKey === 'artifact'
        ? providerResourceId(base, definition)
        : null,
    stateDigest: stateDigest(base, definition),
  };
}

/** @param {Readonly<Record<string, any>>} base @param {'apply'|'reconcile'|'destroy'} operation */
function makePlan(base, operation) {
  const definitions =
    operation === 'destroy'
      ? [...AWS_SINGLE_NODE_RESOURCE_GRAPH.resources].reverse()
      : AWS_SINGLE_NODE_RESOURCE_GRAPH.resources;
  const actions = definitions.map(
    (/** @type {Readonly<AnyRecord>} */ definition) => {
      const desired = desiredState(base, definition);
      const existing = {
        ...desired,
        providerResourceId: providerResourceId(base, definition),
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
          'win6',
          'wharfie:test:volume-attachment-inspection:v1',
          { operation },
        ),
      },
      actions,
    },
    { profile: base.profile },
  );
}

/** @param {ReadonlyArray<Readonly<Record<string, any>>>} bindings */
function receipts(bindings) {
  return bindings
    .map((binding) => ({
      resourceKey: binding.resourceKey,
      bindingId: binding.bindingId,
    }))
    .sort((left, right) =>
      compareCanonicalStrings(left.resourceKey, right.resourceKey),
    );
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} action @param {string} ownershipNonce @param {ReadonlyArray<Readonly<Record<string, any>>>} dependencies @param {string} createdByActionId */
function makeBinding(
  base,
  action,
  ownershipNonce,
  dependencies,
  createdByActionId,
) {
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
    dependencyBindings: receipts(dependencies),
    providerType: action.before?.providerType ?? action.after.providerType,
    providerResourceId: providerResourceId(base, action),
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce,
    createdByActionId,
  });
}

/** @param {{operation?: 'apply'|'reconcile'|'destroy', capability?: 'application-state'|'control-state'}} [options] */
function makeFixture(options = {}) {
  const operation = options.operation ?? 'apply';
  const capability = options.capability ?? 'application-state';
  const resourceKey = `${capability}-attachment`;
  const base = makeBase();
  const plan = makePlan(base, operation);
  const actionByKey = new Map(
    plan.actions.map((/** @type {Readonly<AnyRecord>} */ action) => [
      action.resourceKey,
      action,
    ]),
  );
  const action = actionByKey.get(resourceKey);
  if (action === undefined) throw new Error(`Missing ${resourceKey} action.`);
  const actionIndex = plan.actions.indexOf(action);
  const ownershipNonce = nonce(capability === 'application-state' ? 90 : 91);
  const graphIndexByKey = new Map(
    AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.map(
      (
        /** @type {Readonly<AnyRecord>} */ definition,
        /** @type {number} */ index,
      ) => [definition.resourceKey, index],
    ),
  );
  const intentNonceByKey = new Map(
    plan.actions.map((/** @type {Readonly<AnyRecord>} */ candidate) => [
      candidate.resourceKey,
      candidate.resourceKey === resourceKey
        ? ownershipNonce
        : nonce(10 + graphIndexByKey.get(candidate.resourceKey)),
    ]),
  );
  const bindingByKey = new Map();
  for (const definition of AWS_SINGLE_NODE_RESOURCE_GRAPH.resources) {
    if (definition.resourceKey.endsWith('-attachment')) {
      if (definition.resourceKey === 'network-internet-gateway-attachment') {
        // This attachment is part of the substrate's recursive closure.
      } else {
        continue;
      }
    }
    const candidate = actionByKey.get(definition.resourceKey);
    if (candidate === undefined) throw new Error('Missing fixture action.');
    const dependencies = definition.dependsOn.map(
      (/** @type {string} */ dependencyKey) => {
        const binding = bindingByKey.get(dependencyKey);
        if (binding === undefined) {
          throw new Error(`Missing fixture binding '${dependencyKey}'.`);
        }
        return binding;
      },
    );
    const createdByActionId =
      operation === 'apply'
        ? candidate.actionId
        : semanticId('wda3', 'wharfie:test:attachment-create-action:v1', {
            resourceKey: candidate.resourceKey,
          });
    bindingByKey.set(
      definition.resourceKey,
      makeBinding(
        base,
        candidate,
        intentNonceByKey.get(candidate.resourceKey),
        dependencies,
        createdByActionId,
      ),
    );
    if (definition.resourceKey === 'substrate') break;
  }
  const directDependencies = action.dependsOn.map(
    (/** @type {string} */ dependencyKey) => {
      const binding = bindingByKey.get(dependencyKey);
      if (binding === undefined) {
        throw new Error(`Missing attachment dependency '${dependencyKey}'.`);
      }
      return binding;
    },
  );
  const priorBinding =
    action.action === 'create'
      ? null
      : makeBinding(
          base,
          action,
          ownershipNonce,
          directDependencies,
          semanticId('wda3', 'wharfie:test:attachment-create-action:v1', {
            resourceKey,
          }),
        );
  if (priorBinding !== null) bindingByKey.set(resourceKey, priorBinding);
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
      ownershipNonce: intentNonceByKey.get(candidate.resourceKey),
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
    resourceBindings: [...bindingByKey.values()],
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
    lastOperation:
      priorBinding === null
        ? null
        : {
            kind: 'create',
            planId: semanticId('wpl3', 'wharfie:test:attachment-last-plan:v1', {
              operation,
              resourceKey,
            }),
            intents: [
              {
                actionId: priorBinding.createdByActionId,
                status: 'settled',
                ownershipNonce: priorBinding.ownershipNonce,
              },
            ],
          },
  });
  return Object.freeze({
    base,
    plan,
    action,
    actionIndex,
    ownershipNonce,
    bindingByKey,
    dependencyBindings: receipts(directDependencies),
    priorBinding,
    head,
    context: Object.freeze({
      operation,
      plan,
      action,
      actionIndex,
      ownershipNonce,
      head,
      profile: base.profile,
      artifactStage: null,
    }),
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {string} resourceKey */
function makeLineageDriftHead(fixture, resourceKey) {
  const head = fixture.head;
  if (resourceKey !== 'network-vpc') {
    throw new Error(`Unsupported lineage drift '${resourceKey}'.`);
  }
  /** @type {Map<string, Readonly<AnyRecord>>} */
  const originalByKey = new Map(
    head.resourceBindings.map((/** @type {Readonly<AnyRecord>} */ binding) => [
      binding.resourceKey,
      binding,
    ]),
  );
  /** @type {Map<string, Readonly<AnyRecord>>} */
  const rebuiltByKey = new Map();
  /** @type {Readonly<AnyRecord>[]} */
  const resourceBindings = [];
  for (const definition of AWS_SINGLE_NODE_RESOURCE_GRAPH.resources) {
    const binding = originalByKey.get(definition.resourceKey);
    if (binding === undefined) continue;
    const dependencies = binding.dependencyBindings.map(
      (/** @type {Readonly<AnyRecord>} */ reference) => {
        const dependency = rebuiltByKey.get(reference.resourceKey);
        if (dependency === undefined) {
          throw new Error(`Missing rebuilt '${reference.resourceKey}'.`);
        }
        return dependency;
      },
    );
    const rebuilt = createDeploymentResourceBinding({
      schemaVersion: 2,
      kind: 'deploymentResourceBinding',
      deploymentInstanceId: binding.deploymentInstanceId,
      incarnationId: binding.incarnationId,
      resourceKey: binding.resourceKey,
      capability: binding.capability,
      role: binding.role,
      management: binding.management,
      ownershipMode: binding.ownershipMode,
      onDestroy: binding.onDestroy,
      dependencyBindings: receipts(dependencies),
      providerType: binding.providerType,
      providerResourceId:
        binding.resourceKey === resourceKey
          ? 'vpc-00000000000000002'
          : binding.providerResourceId,
      providerScopeId: binding.providerScopeId,
      ownershipNonce: binding.ownershipNonce,
      createdByActionId: binding.createdByActionId,
    });
    rebuiltByKey.set(rebuilt.resourceKey, rebuilt);
    resourceBindings.push(rebuilt);
  }
  return createDeploymentHead({
    deploymentInstanceId: head.deploymentInstanceId,
    providerScope: head.providerScope,
    incarnationId: head.incarnationId,
    generation: head.generation,
    phase: head.phase,
    settledDeploymentRevisionId: head.settledDeploymentRevisionId,
    targetDeploymentRevisionId: head.targetDeploymentRevisionId,
    resourceBindings,
    activeOperation: head.activeOperation,
    lastOperation: head.lastOperation,
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @returns {string} */
function deviceName(fixture) {
  return fixture.action.capability.kind === 'application-state'
    ? '/dev/sdf'
    : '/dev/sdg';
}

/** @param {ReturnType<typeof makeFixture>} fixture @returns {string} */
function volumeId(fixture) {
  return fixture.action.capability.kind === 'application-state'
    ? IDS.applicationVolume
    : IDS.controlVolume;
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function makeInstance(fixture, overrides = {}) {
  return {
    InstanceId: IDS.instance,
    Placement: {
      AvailabilityZoneId:
        fixture.base.providerSpec.placement.availabilityZoneId,
    },
    State: { Code: 16, Name: 'running' },
    BlockDeviceMappings: [],
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function makeInstanceMapping(fixture, overrides = {}) {
  const { Ebs: ebsOverrides = {}, ...mappingOverrides } = overrides;
  return {
    DeviceName: deviceName(fixture),
    ...mappingOverrides,
    Ebs: {
      VolumeId: volumeId(fixture),
      Status: 'attached',
      DeleteOnTermination: false,
      EbsCardIndex: AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX,
      ...ebsOverrides,
    },
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function makeVolumeAttachment(fixture, overrides = {}) {
  return {
    VolumeId: volumeId(fixture),
    InstanceId: IDS.instance,
    Device: deviceName(fixture),
    State: 'attached',
    DeleteOnTermination: false,
    EbsCardIndex: AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX,
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function makeVolume(fixture, overrides = {}) {
  return {
    VolumeId: volumeId(fixture),
    AvailabilityZoneId: fixture.base.providerSpec.placement.availabilityZoneId,
    State: 'available',
    MultiAttachEnabled: false,
    Attachments: [],
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {{instance?: Record<string, any>, volume?: Record<string, any>, instanceState?: 'running'|'stopped', attachmentState?: string, deleteOnTermination?: boolean}} [options] */
function attachedEvidence(fixture, options = {}) {
  const attachmentState = options.attachmentState ?? 'attached';
  const deleteOnTermination = options.deleteOnTermination ?? false;
  const instanceState = options.instanceState ?? 'running';
  const instanceStateCode = instanceState === 'stopped' ? 80 : 16;
  const instance =
    options.instance ??
    makeInstance(fixture, {
      State: { Code: instanceStateCode, Name: instanceState },
      BlockDeviceMappings: [
        makeInstanceMapping(fixture, {
          Ebs: {
            Status: attachmentState,
            DeleteOnTermination: deleteOnTermination,
          },
        }),
      ],
    });
  const volume =
    options.volume ??
    makeVolume(fixture, {
      State: 'in-use',
      Attachments: [
        makeVolumeAttachment(fixture, {
          State: attachmentState,
          DeleteOnTermination: deleteOnTermination,
        }),
      ],
    });
  return { instance, volume };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makeClient(fixture, options = {}) {
  const instance = options.instance ?? makeInstance(fixture);
  const volume = options.volume ?? makeVolume(fixture);
  return {
    attachVolume: options.attachVolume ?? jest.fn(async () => ({})),
    describeInstances:
      options.describeInstances ??
      jest.fn(async () => ({
        Reservations: [
          {
            OwnerId: fixture.base.providerScope.accountId,
            Instances: [instance],
          },
        ],
      })),
    describeVolumes:
      options.describeVolumes ?? jest.fn(async () => ({ Volumes: [volume] })),
    detachVolume: options.detachVolume ?? jest.fn(async () => ({})),
    modifyInstanceAttribute:
      options.modifyInstanceAttribute ?? jest.fn(async () => ({})),
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makePorts(fixture, options = {}) {
  const client = options.client ?? makeClient(fixture, options);
  const waitForRetry = options.waitForRetry ?? jest.fn(async () => {});
  const resource = createAwsSingleNodeVolumeAttachmentResource({
    client,
    providerScope: fixture.base.providerScope,
    maxAttempts: options.maxAttempts ?? 2,
    waitForRetry,
  });
  return { client, waitForRetry, resource };
}

describe('AWS single-node retained volume attachment identity', () => {
  it.each(CAPABILITY_CASES)(
    '$resourceKey has a deterministic plan-time state and exact pair identity',
    ({ capability, volumeId: exactVolumeId, deviceName: exactDeviceName }) => {
      const base = makeBase();
      const descriptor = sortCanonicalJsonValue({
        schemaVersion: 1,
        kind: 'awsSingleNodeEbsVolumeAttachmentState',
        capability: { kind: capability, version: 1 },
        role: { kind: 'attachment', version: 1 },
        deviceName: exactDeviceName,
        attachmentState: 'attached',
        ebsCardIndex: AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX,
        deleteOnTermination:
          AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DELETE_ON_TERMINATION,
        onDestroy: 'purge',
      });
      const state = getAwsSingleNodeVolumeAttachmentStateDigest(
        base.providerSpec,
        capability,
      );
      const providerId = getAwsSingleNodeVolumeAttachmentProviderResourceId(
        base.providerSpec,
        capability,
        IDS.instance,
        exactVolumeId,
      );

      expect(state).toEqual({
        algorithm: 'sha256',
        value: sha256Base64Url(
          `${AWS_SINGLE_NODE_VOLUME_ATTACHMENT_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
            descriptor,
          )}`,
        ),
      });
      expect(
        getAwsSingleNodeVolumeAttachmentStateDigest(
          JSON.parse(JSON.stringify(base.providerSpec)),
          capability,
        ),
      ).toEqual(state);
      expect(providerId).toBe(
        createCanonicalJsonSha256Id({
          domain: AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
          prefix: AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
          value: sortCanonicalJsonValue({
            ...descriptor,
            instanceId: IDS.instance,
            volumeId: exactVolumeId,
          }),
        }),
      );
      expect(providerId).not.toBe(
        getAwsSingleNodeVolumeAttachmentProviderResourceId(
          base.providerSpec,
          capability,
          IDS.otherInstance,
          exactVolumeId,
        ),
      );
      expectDeepFrozen(state);
    },
  );
});

describe('AWS single-node retained volume attachment lifecycle', () => {
  it.each(CAPABILITY_CASES)(
    '$resourceKey issues only exact frozen attach and never settles from its response',
    async ({
      capability,
      volumeId: exactVolumeId,
      deviceName: exactDevice,
    }) => {
      const fixture = makeFixture({ capability });
      const { client, resource } = makePorts(fixture);

      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();
      expect(client.attachVolume).toHaveBeenCalledTimes(1);
      expect(client.attachVolume).toHaveBeenCalledWith({
        Device: exactDevice,
        EbsCardIndex: AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX,
        InstanceId: IDS.instance,
        VolumeId: exactVolumeId,
      });
      expect(client.modifyInstanceAttribute).not.toHaveBeenCalled();
      expectDeepFrozen(client.attachVolume.mock.calls[0][0]);
      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        { status: 'not-converged' },
      );
    },
  );

  it.each(CAPABILITY_CASES)(
    '$resourceKey repairs DeleteOnTermination only after matching dual-view attachment evidence',
    async ({
      capability,
      volumeId: exactVolumeId,
      deviceName: exactDevice,
    }) => {
      const fixture = makeFixture({ capability });
      const evidence = attachedEvidence(fixture, {
        deleteOnTermination: true,
      });
      const { client, resource } = makePorts(fixture, evidence);

      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();
      expect(client.attachVolume).not.toHaveBeenCalled();
      expect(client.modifyInstanceAttribute).toHaveBeenCalledWith({
        InstanceId: IDS.instance,
        Attribute: 'blockDeviceMapping',
        BlockDeviceMappings: [
          {
            DeviceName: exactDevice,
            Ebs: {
              VolumeId: exactVolumeId,
              DeleteOnTermination: false,
            },
          },
        ],
      });
      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        { status: 'not-converged' },
      );
    },
  );

  it.each(CAPABILITY_CASES)(
    '$resourceKey destroy uses one exact non-forced detach and waits for readback absence',
    async ({
      capability,
      volumeId: exactVolumeId,
      deviceName: exactDevice,
    }) => {
      const fixture = makeFixture({ operation: 'destroy', capability });
      const evidence = attachedEvidence(fixture);
      const { client, resource } = makePorts(fixture, evidence);

      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();
      expect(client.detachVolume).toHaveBeenCalledTimes(1);
      expect(client.detachVolume).toHaveBeenCalledWith({
        Device: exactDevice,
        Force: false,
        InstanceId: IDS.instance,
        VolumeId: exactVolumeId,
      });
      expectDeepFrozen(client.detachVolume.mock.calls[0][0]);
      expect(client.attachVolume).not.toHaveBeenCalled();
      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        { status: 'not-converged' },
      );
    },
  );

  it('uses the same exact non-forced detach for an explicitly stopped node', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const evidence = attachedEvidence(fixture, { instanceState: 'stopped' });
    const { client, resource } = makePorts(fixture, evidence);

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.detachVolume).toHaveBeenCalledWith({
      Device: '/dev/sdf',
      Force: false,
      InstanceId: IDS.instance,
      VolumeId: IDS.applicationVolume,
    });
    expectDeepFrozen(client.detachVolume.mock.calls[0][0]);
  });

  it.each(CAPABILITY_CASES)(
    '$resourceKey converges only from exact matching instance and volume reads',
    async ({ capability }) => {
      const fixture = makeFixture({ capability });
      const evidence = attachedEvidence(fixture);
      const { client, resource } = makePorts(fixture, evidence);

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'converged',
          binding: expect.objectContaining({
            resourceKey: fixture.action.resourceKey,
            providerType: 'ebs-volume-attachment',
            providerResourceId:
              getAwsSingleNodeVolumeAttachmentProviderResourceId(
                fixture.base.providerSpec,
                capability,
                IDS.instance,
                volumeId(fixture),
              ),
            dependencyBindings: fixture.dependencyBindings,
          }),
        },
      );
      expect(client.describeInstances).toHaveBeenCalledWith({
        InstanceIds: [IDS.instance],
      });
      expect(client.describeVolumes).toHaveBeenCalledWith({
        VolumeIds: [volumeId(fixture)],
      });
      expectDeepFrozen(client.describeInstances.mock.calls[0][0]);
      expectDeepFrozen(client.describeVolumes.mock.calls[0][0]);
      expect(client.attachVolume).not.toHaveBeenCalled();
      expect(client.modifyInstanceAttribute).not.toHaveBeenCalled();
    },
  );
});

describe('AWS single-node retained volume attachment recovery and evidence fences', () => {
  it('recovers an applied attach after response loss using a fresh client and dual readback', async () => {
    const fixture = makeFixture();
    let attached = false;
    const dynamicInstance = () =>
      attached
        ? attachedEvidence(fixture).instance
        : makeInstance(fixture, { BlockDeviceMappings: [] });
    const dynamicVolume = () =>
      attached
        ? attachedEvidence(fixture).volume
        : makeVolume(fixture, { State: 'available', Attachments: [] });
    const firstClient = makeClient(fixture, {
      describeInstances: jest.fn(async () => ({
        Reservations: [
          {
            OwnerId: fixture.base.providerScope.accountId,
            Instances: [dynamicInstance()],
          },
        ],
      })),
      describeVolumes: jest.fn(async () => ({ Volumes: [dynamicVolume()] })),
      attachVolume: jest.fn(async () => {
        attached = true;
        throw providerError('NetworkingError', 'attach-response-secret');
      }),
    });
    const first = makePorts(fixture, { client: firstClient });

    await expect(
      first.resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(firstClient.attachVolume).toHaveBeenCalledTimes(1);

    const freshClient = makeClient(fixture, {
      describeInstances: jest.fn(async () => ({
        Reservations: [
          {
            OwnerId: fixture.base.providerScope.accountId,
            Instances: [dynamicInstance()],
          },
        ],
      })),
      describeVolumes: jest.fn(async () => ({ Volumes: [dynamicVolume()] })),
    });
    const fresh = makePorts(fixture, { client: freshClient });
    await expect(
      fresh.resource.verifySettlement(fixture.context),
    ).resolves.toEqual({
      status: 'converged',
      binding: expect.objectContaining({
        resourceKey: 'application-state-attachment',
      }),
    });
    expect(freshClient.attachVolume).not.toHaveBeenCalled();
    expect(freshClient.modifyInstanceAttribute).not.toHaveBeenCalled();
  });

  it('recovers an applied retention repair after response loss using a fresh client', async () => {
    const fixture = makeFixture();
    let retained = false;
    const currentEvidence = () =>
      attachedEvidence(fixture, { deleteOnTermination: !retained });
    const descriptions = {
      describeInstances: jest.fn(async () => ({
        Reservations: [
          {
            OwnerId: fixture.base.providerScope.accountId,
            Instances: [currentEvidence().instance],
          },
        ],
      })),
      describeVolumes: jest.fn(async () => ({
        Volumes: [currentEvidence().volume],
      })),
    };
    const firstClient = makeClient(fixture, {
      ...descriptions,
      modifyInstanceAttribute: jest.fn(async () => {
        retained = true;
        throw providerError('NetworkingError', 'retention-response-secret');
      }),
    });
    const first = makePorts(fixture, { client: firstClient });

    await expect(
      first.resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(firstClient.modifyInstanceAttribute).toHaveBeenCalledTimes(1);

    const freshClient = makeClient(fixture, {
      describeInstances: jest.fn(async () => ({
        Reservations: [
          {
            OwnerId: fixture.base.providerScope.accountId,
            Instances: [currentEvidence().instance],
          },
        ],
      })),
      describeVolumes: jest.fn(async () => ({
        Volumes: [currentEvidence().volume],
      })),
    });
    const fresh = makePorts(fixture, { client: freshClient });
    await expect(
      fresh.resource.verifySettlement(fixture.context),
    ).resolves.toEqual({
      status: 'converged',
      binding: expect.objectContaining({
        resourceKey: 'application-state-attachment',
      }),
    });
    expect(freshClient.modifyInstanceAttribute).not.toHaveBeenCalled();
    expect(freshClient.attachVolume).not.toHaveBeenCalled();
  });

  it('recovers an applied detach after response loss using a fresh client', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    let attached = true;
    const currentEvidence = () =>
      attached
        ? attachedEvidence(fixture)
        : {
            instance: makeInstance(fixture),
            volume: makeVolume(fixture),
          };
    const firstClient = makeClient(fixture, {
      describeInstances: jest.fn(async () => ({
        Reservations: [
          {
            OwnerId: fixture.base.providerScope.accountId,
            Instances: [currentEvidence().instance],
          },
        ],
      })),
      describeVolumes: jest.fn(async () => ({
        Volumes: [currentEvidence().volume],
      })),
      detachVolume: jest.fn(async () => {
        attached = false;
        throw providerError('NetworkingError', 'detach-response-secret');
      }),
    });
    const first = makePorts(fixture, { client: firstClient });

    await expect(
      first.resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(firstClient.detachVolume).toHaveBeenCalledTimes(1);

    const evidence = currentEvidence();
    const freshClient = makeClient(fixture, evidence);
    const fresh = makePorts(fixture, { client: freshClient });
    await expect(
      fresh.resource.verifySettlement(fixture.context),
    ).resolves.toEqual({ status: 'converged', binding: null });
    expect(freshClient.detachVolume).not.toHaveBeenCalled();
  });

  it.each(['attaching', 'detaching', 'detached', 'busy'])(
    'treats dual-view %s propagation as bounded non-settlement',
    async (attachmentState) => {
      const fixture = makeFixture();
      const evidence = attachedEvidence(fixture, { attachmentState });
      const { client, resource } = makePorts(fixture, evidence);

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        { status: 'not-converged' },
      );
      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();
      expect(client.attachVolume).not.toHaveBeenCalled();
      expect(client.detachVolume).not.toHaveBeenCalled();
      expect(client.modifyInstanceAttribute).not.toHaveBeenCalled();
    },
  );

  it('treats one-sided exact evidence as transient and repairs any non-false retention view', async () => {
    const fixture = makeFixture();
    const oneSided = attachedEvidence(fixture, {
      attachmentState: 'attaching',
      volume: makeVolume(fixture, {
        State: 'in-use',
        Attachments: [],
      }),
    });
    const first = makePorts(fixture, oneSided);
    await expect(
      first.resource.verifySettlement(fixture.context),
    ).resolves.toEqual({ status: 'not-converged' });

    const stableOneSided = attachedEvidence(fixture, {
      volume: makeVolume(fixture, {
        State: 'in-use',
        Attachments: [],
      }),
    });
    const stable = makePorts(fixture, stableOneSided);
    await expect(
      stable.resource.verifySettlement(fixture.context),
    ).resolves.toEqual({ status: 'not-converged' });

    const crossView = attachedEvidence(fixture, {
      instance: makeInstance(fixture, {
        BlockDeviceMappings: [
          makeInstanceMapping(fixture, {
            Ebs: { DeleteOnTermination: true },
          }),
        ],
      }),
      volume: makeVolume(fixture, {
        State: 'in-use',
        Attachments: [makeVolumeAttachment(fixture)],
      }),
    });
    const second = makePorts(fixture, crossView);
    await expect(
      second.resource.verifySettlement(fixture.context),
    ).resolves.toEqual({ status: 'not-converged' });
    await expect(
      second.resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(second.client.modifyInstanceAttribute).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'the exact device occupied by another volume',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        instance: makeInstance(fixture, {
          BlockDeviceMappings: [
            makeInstanceMapping(fixture, {
              Ebs: { VolumeId: IDS.otherVolume },
            }),
          ],
        }),
        volume: makeVolume(fixture),
      }),
    ],
    [
      'the exact volume attached to another instance',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        instance: makeInstance(fixture),
        volume: makeVolume(fixture, {
          State: 'in-use',
          Attachments: [
            makeVolumeAttachment(fixture, { InstanceId: IDS.otherInstance }),
          ],
        }),
      }),
    ],
    [
      'multiple volume-side attachments',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        instance: makeInstance(fixture),
        volume: makeVolume(fixture, {
          State: 'in-use',
          Attachments: [
            makeVolumeAttachment(fixture),
            makeVolumeAttachment(fixture, {
              InstanceId: IDS.otherInstance,
            }),
          ],
        }),
      }),
    ],
  ])('blocks %s without mutation', async (_name, makeEvidence) => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture, makeEvidence(fixture));

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeVolumeAttachmentResourceConflictError,
    );
    expect(client.attachVolume).not.toHaveBeenCalled();
    expect(client.detachVolume).not.toHaveBeenCalled();
    expect(client.modifyInstanceAttribute).not.toHaveBeenCalled();
  });

  it('distinguishes stable typed endpoint absence from successful empty exact responses on delete', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const typedClient = makeClient(fixture, {
      describeInstances: jest.fn(async () => {
        throw providerError('InvalidInstanceID.NotFound');
      }),
      describeVolumes: jest.fn(async () => {
        throw providerError('InvalidVolume.NotFound');
      }),
    });
    const typed = makePorts(fixture, { client: typedClient });
    await expect(
      typed.resource.verifySettlement(fixture.context),
    ).resolves.toEqual({ status: 'converged', binding: null });
    expect(typedClient.describeInstances).toHaveBeenCalledTimes(2);
    expect(typedClient.describeVolumes).toHaveBeenCalledTimes(2);

    const emptyClient = makeClient(fixture, {
      describeInstances: jest.fn(async () => ({ Reservations: [] })),
      describeVolumes: jest.fn(async () => ({ Volumes: [] })),
    });
    const empty = makePorts(fixture, { client: emptyClient });
    await expect(
      empty.resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVolumeAttachmentResourceUnknownError);
  });

  it('never converges alternating typed endpoint-absence signatures', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const instanceNotFound = providerError('InvalidInstanceID.NotFound');
    const volumeNotFound = providerError('InvalidVolume.NotFound');
    const instanceResponse = {
      Reservations: [
        {
          OwnerId: fixture.base.providerScope.accountId,
          Instances: [makeInstance(fixture)],
        },
      ],
    };
    const volumeResponse = { Volumes: [makeVolume(fixture)] };
    let instanceRead = 0;
    const describeInstances = jest.fn(async () => {
      instanceRead += 1;
      if (instanceRead !== 2) throw instanceNotFound;
      return instanceResponse;
    });
    let volumeRead = 0;
    const describeVolumes = jest.fn(async () => {
      volumeRead += 1;
      if (volumeRead !== 1) throw volumeNotFound;
      return volumeResponse;
    });
    const client = makeClient(fixture, {
      describeInstances,
      describeVolumes,
    });
    const { resource } = makePorts(fixture, { client, maxAttempts: 3 });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(describeInstances).toHaveBeenCalledTimes(3);
    expect(describeVolumes).toHaveBeenCalledTimes(3);
  });

  it.each(['instance', 'volume'])(
    'blocks a nonzero EbsCardIndex on the exact %s view without mutation',
    async (side) => {
      const fixture = makeFixture();
      const exact = attachedEvidence(fixture);
      const evidence = {
        instance:
          side === 'instance'
            ? makeInstance(fixture, {
                BlockDeviceMappings: [
                  makeInstanceMapping(fixture, {
                    Ebs: { EbsCardIndex: 1 },
                  }),
                ],
              })
            : exact.instance,
        volume:
          side === 'volume'
            ? makeVolume(fixture, {
                State: 'in-use',
                Attachments: [
                  makeVolumeAttachment(fixture, { EbsCardIndex: 1 }),
                ],
              })
            : exact.volume,
      };
      const { client, resource } = makePorts(fixture, evidence);

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        { status: 'blocked' },
      );
      await expect(
        resource.executeAction(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeVolumeAttachmentResourceConflictError,
      );
      expect(client.attachVolume).not.toHaveBeenCalled();
      expect(client.detachVolume).not.toHaveBeenCalled();
      expect(client.modifyInstanceAttribute).not.toHaveBeenCalled();
    },
  );

  it('keeps dual no-row in-use evidence bounded as detach propagation', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const evidence = {
      instance: makeInstance(fixture, { BlockDeviceMappings: [] }),
      volume: makeVolume(fixture, { State: 'in-use', Attachments: [] }),
    };
    const { client, resource } = makePorts(fixture, evidence);

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.attachVolume).not.toHaveBeenCalled();
    expect(client.detachVolume).not.toHaveBeenCalled();
    expect(client.modifyInstanceAttribute).not.toHaveBeenCalled();
  });

  it('blocks service-managed exact instance mapping evidence without mutation', async () => {
    const fixture = makeFixture();
    const exact = attachedEvidence(fixture);
    const evidence = {
      instance: makeInstance(fixture, {
        BlockDeviceMappings: [
          makeInstanceMapping(fixture, {
            Ebs: {
              Operator: {
                Managed: true,
                Principal: 'arn:aws:iam::123456789012:role/provider-service',
              },
            },
          }),
        ],
      }),
      volume: exact.volume,
    };
    const { client, resource } = makePorts(fixture, evidence);

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeVolumeAttachmentResourceConflictError,
    );
    expect(client.attachVolume).not.toHaveBeenCalled();
    expect(client.detachVolume).not.toHaveBeenCalled();
    expect(client.modifyInstanceAttribute).not.toHaveBeenCalled();
  });

  it('returns the identical settled noop binding and preserves its provenance', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const expectedBinding = fixture.head.resourceBindings.find(
      (/** @type {Readonly<AnyRecord>} */ binding) =>
        binding.resourceKey === fixture.action.resourceKey,
    );
    if (expectedBinding === undefined || fixture.priorBinding === null) {
      throw new Error('Missing prior attachment binding.');
    }
    const evidence = attachedEvidence(fixture);
    const { resource } = makePorts(fixture, evidence);

    const settled = await resource.verifySettlement(fixture.context);
    expect(settled).toEqual({
      status: 'converged',
      binding: expectedBinding,
    });
    expect(settled.binding).toStrictEqual(expectedBinding);
    expect(settled.binding).toEqual(
      expect.objectContaining({
        bindingId: fixture.priorBinding.bindingId,
        createdByActionId: fixture.priorBinding.createdByActionId,
        ownershipNonce: fixture.priorBinding.ownershipNonce,
        dependencyBindings: fixture.priorBinding.dependencyBindings,
      }),
    );
  });

  it('blocks externally absent noop state and never silently recreates it', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const { client, resource } = makePorts(fixture);

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.attachVolume).not.toHaveBeenCalled();
    expect(client.modifyInstanceAttribute).not.toHaveBeenCalled();
  });
});

describe('AWS single-node retained volume attachment controller authority', () => {
  it('rejects missing recursive upstream lineage before either public port reaches the provider', async () => {
    const fixture = makeFixture();
    const badHead = makeLineageDriftHead(fixture, 'network-vpc');
    const context = { ...fixture.context, head: badHead };
    const { client, resource } = makePorts(fixture);

    await expect(resource.executeAction(context)).rejects.toBeInstanceOf(
      AwsSingleNodeVolumeAttachmentResourceConflictError,
    );
    await expect(resource.verifySettlement(context)).rejects.toBeInstanceOf(
      AwsSingleNodeVolumeAttachmentResourceConflictError,
    );
    expect(client.describeInstances).not.toHaveBeenCalled();
    expect(client.describeVolumes).not.toHaveBeenCalled();
    expect(client.attachVolume).not.toHaveBeenCalled();
    expect(client.detachVolume).not.toHaveBeenCalled();
    expect(client.modifyInstanceAttribute).not.toHaveBeenCalled();
  });

  it('reproves upstream lineage between the instance and volume reads', async () => {
    const fixture = makeFixture();
    const badHead = makeLineageDriftHead(fixture, 'network-vpc');
    const context = /** @type {AnyRecord} */ ({ ...fixture.context });
    const instance = makeInstance(fixture);
    const volume = makeVolume(fixture);
    const client = makeClient(fixture, {
      describeInstances: jest.fn(async () => {
        context.head = badHead;
        return {
          Reservations: [
            {
              OwnerId: fixture.base.providerScope.accountId,
              Instances: [instance],
            },
          ],
        };
      }),
      describeVolumes: jest.fn(async () => ({ Volumes: [volume] })),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.executeAction(context)).rejects.toBeInstanceOf(
      AwsSingleNodeVolumeAttachmentResourceConflictError,
    );
    expect(client.describeInstances).toHaveBeenCalledTimes(1);
    expect(client.describeVolumes).not.toHaveBeenCalled();
    expect(client.attachVolume).not.toHaveBeenCalled();
  });

  it('reproves upstream lineage after dual reads and before attach mutation', async () => {
    const fixture = makeFixture();
    const badHead = makeLineageDriftHead(fixture, 'network-vpc');
    const context = /** @type {AnyRecord} */ ({ ...fixture.context });
    const client = makeClient(fixture, {
      describeVolumes: jest.fn(async () => {
        context.head = badHead;
        return { Volumes: [makeVolume(fixture)] };
      }),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.executeAction(context)).rejects.toBeInstanceOf(
      AwsSingleNodeVolumeAttachmentResourceConflictError,
    );
    expect(client.describeInstances).toHaveBeenCalledTimes(1);
    expect(client.describeVolumes).toHaveBeenCalledTimes(1);
    expect(client.attachVolume).not.toHaveBeenCalled();
    expect(client.modifyInstanceAttribute).not.toHaveBeenCalled();
  });

  it('maps raw read failures to a fixed unknown error without provider details', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      describeInstances: jest.fn(async () => {
        throw providerError('NetworkingError', 'credential-read-secret');
      }),
      describeVolumes: jest.fn(async () => {
        throw providerError('AccessDenied', 'volume-read-secret');
      }),
    });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeVolumeAttachmentResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toMatch(
      /credential-read-secret|volume-read-secret|NetworkingError|AccessDenied/,
    );
  });

  it.each([
    ['attach', 'UnsupportedOperation'],
    ['retention', 'InvalidInstanceAttributeValue'],
  ])(
    'maps deterministic %s refusal to a fixed non-echoing conflict',
    async (operation, errorName) => {
      const fixture = makeFixture();
      const evidence =
        operation === 'retention'
          ? attachedEvidence(fixture, { deleteOnTermination: true })
          : {};
      const client = makeClient(fixture, {
        ...evidence,
        attachVolume: jest.fn(async () => {
          throw providerError(errorName, 'mutation-provider-secret');
        }),
        modifyInstanceAttribute: jest.fn(async () => {
          throw providerError(errorName, 'mutation-provider-secret');
        }),
      });
      const { resource } = makePorts(fixture, { client });

      const observed = await resource
        .executeAction(fixture.context)
        .catch((/** @type {unknown} */ error) => error);
      expect(observed).toBeInstanceOf(
        AwsSingleNodeVolumeAttachmentResourceConflictError,
      );
      expect(JSON.stringify(observed)).not.toContain(
        'mutation-provider-secret',
      );
    },
  );

  it('maps DetachVolume UnsupportedOperation to a fixed non-echoing conflict', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const evidence = attachedEvidence(fixture);
    const client = makeClient(fixture, {
      ...evidence,
      detachVolume: jest.fn(async () => {
        throw providerError('UnsupportedOperation', 'detach-provider-secret');
      }),
    });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeVolumeAttachmentResourceConflictError,
    );
    expect(JSON.stringify(observed)).not.toContain('detach-provider-secret');
    expect(client.detachVolume).toHaveBeenCalledWith({
      Device: '/dev/sdf',
      Force: false,
      InstanceId: IDS.instance,
      VolumeId: IDS.applicationVolume,
    });
  });

  it('returns only frozen action ports and never owns or closes the caller client', () => {
    const fixture = makeFixture();
    const client = { ...makeClient(fixture), close: jest.fn() };
    const resource = createAwsSingleNodeVolumeAttachmentResource({
      client,
      providerScope: fixture.base.providerScope,
      maxAttempts: 2,
      waitForRetry: jest.fn(async () => {}),
    });

    expect(Object.keys(resource).sort()).toEqual([
      'executeAction',
      'verifySettlement',
    ]);
    expect(Object.isFrozen(resource)).toBe(true);
    expect(client.close).not.toHaveBeenCalled();
  });

  it('exports fixed public errors and rejects unsafe retry bounds', () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    expect(new AwsSingleNodeVolumeAttachmentResourceConflictError()).toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeVolumeAttachmentResourceConflictError',
        code: 'AWS_SINGLE_NODE_VOLUME_ATTACHMENT_RESOURCE_CONFLICT',
      }),
    );
    expect(new AwsSingleNodeVolumeAttachmentResourceUnknownError()).toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeVolumeAttachmentResourceUnknownError',
        code: 'AWS_SINGLE_NODE_VOLUME_ATTACHMENT_RESOURCE_UNKNOWN',
      }),
    );
    for (const maxAttempts of [
      1,
      1.5,
      AWS_SINGLE_NODE_VOLUME_ATTACHMENT_MAX_ATTEMPTS + 1,
    ]) {
      expect(() =>
        createAwsSingleNodeVolumeAttachmentResource({
          client,
          providerScope: fixture.base.providerScope,
          maxAttempts,
        }),
      ).toThrow(TypeError);
    }
  });
});
