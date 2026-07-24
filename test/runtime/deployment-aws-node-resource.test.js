import { describe, expect, it, jest } from '@jest/globals';

import { compareCanonicalStrings } from '../../src/core/runtime/canonical-order.js';
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
import {
  AwsSingleNodeNodeResourceObserverAuthorityError,
  createAwsSingleNodeNodeResourceObserver,
} from '../../src/core/runtime/deployment-aws-node-resource-observer.js';
import {
  AWS_SINGLE_NODE_NODE_CREATE_CLIENT_TOKEN_DOMAIN,
  AWS_SINGLE_NODE_NODE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_NODE_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_NODE_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_NODE_STATE_DIGEST_DOMAIN,
  AwsSingleNodeNodeResourceConflictError,
  AwsSingleNodeNodeResourceUnknownError,
  createAwsSingleNodeNodeResource,
  getAwsSingleNodeNodeCreateClientToken,
  getAwsSingleNodeNodeStateDigest,
} from '../../src/core/runtime/deployment-aws-node-resource.js';
import { getAwsSingleNodeBootstrapBase64 } from '../../src/core/runtime/deployment-aws-node-bootstrap-contract.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import { createAwsSingleNodeResourceObservationAuthority } from '../../src/core/runtime/deployment-aws-resource-observation-authority.js';
import { getAwsSingleNodeRouteTableStateDigest } from '../../src/core/runtime/deployment-aws-route-table-resource.js';
import {
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimeAssociationStateDigest,
  getAwsSingleNodeRuntimeInstanceProfileName,
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
  networkInterface: 'eni-00000000000000001',
  networkInterfaceAttachment: 'eni-attach-00000000000000001',
  rootVolume: 'vol-00000000000000003',
  applicationVolume: 'vol-00000000000000001',
  controlVolume: 'vol-00000000000000002',
  vpc: 'vpc-00000000000000001',
  internetGateway: 'igw-00000000000000001',
  subnet: 'subnet-00000000000000001',
  routeTable: 'rtb-00000000000000001',
  routeTableAssociation: 'rtbassoc-00000000000000001',
  securityGroup: 'sg-00000000000000001',
  runtimeRole: 'AROA1234567890EXAMPLE',
  instanceProfile: 'AIPA1234567890EXAMPLE',
});
const CREATE_TIME = new Date('2026-07-22T12:00:00.000Z');

/** @param {string} value @returns {{algorithm: 'sha256', value: string}} */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {string} name @param {string} [message] @returns {Error} */
function providerError(name, message = 'provider-secret') {
  const error = new Error(message);
  error.name = name;
  return error;
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

/** @param {{architecture?: 'x64'|'arm64', imageId?: string, incarnationByte?: number}} [options] */
function makeBase(options = {}) {
  const architecture = options.architecture ?? 'x64';
  const profile = validateDeploymentProfile(
    createDeploymentProfile({
      profile: { id: 'production' },
      appId: 'node-resource-test',
      target: {
        nodeVersion: '24.13.1',
        platform: 'linux',
        architecture,
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
    revisionId: semanticId('wrv1', 'wharfie:test:node-revision:v1', {
      revision: 1,
    }),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'node resource artifact',
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
        name:
          architecture === 'x64'
            ? AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64
            : AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.arm64,
        version: 42,
      },
      imageId: options.imageId ?? 'ami-0123456789abcdef0',
      ownerAccountId: '137112412989',
      architecture: architecture === 'x64' ? 'x86_64' : 'arm64',
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
    incarnationId: createDeploymentIncarnationId(
      Buffer.alloc(32, options.incarnationByte ?? 7),
    ),
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

/** @param {Readonly<Record<string, any>>} base @param {'apply'|'reconcile'|'destroy'} operation @param {{substrateBeforeStateDigest?: Readonly<Record<string, string>>}} [options] */
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
        providerResourceId: providerResourceId(base, definition),
        ...(definition.resourceKey === 'substrate' &&
        options.substrateBeforeStateDigest !== undefined
          ? { stateDigest: options.substrateBeforeStateDigest }
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
        inspectionId: semanticId('win6', 'wharfie:test:node-inspection:v1', {
          operation,
        }),
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

/** @param {{operation?: 'apply'|'reconcile'|'destroy', base?: Readonly<Record<string, any>>}} [options] */
function makeFixture(options = {}) {
  const operation = options.operation ?? 'apply';
  const base = options.base ?? makeBase();
  const plan = makePlan(base, operation);
  const actionByKey = new Map(
    plan.actions.map((/** @type {Readonly<AnyRecord>} */ action) => [
      action.resourceKey,
      action,
    ]),
  );
  const action = actionByKey.get('substrate');
  if (action === undefined) throw new Error('Missing substrate action.');
  const actionIndex = plan.actions.indexOf(action);
  const ownershipNonce = nonce(90);
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
      candidate.resourceKey === 'substrate'
        ? ownershipNonce
        : nonce(10 + graphIndexByKey.get(candidate.resourceKey)),
    ]),
  );
  const bindingByKey = new Map();
  for (const definition of AWS_SINGLE_NODE_RESOURCE_GRAPH.resources) {
    if (definition.resourceKey === 'substrate' && operation === 'apply') break;
    if (definition.resourceKey.endsWith('-attachment')) {
      if (definition.resourceKey !== 'network-internet-gateway-attachment') {
        continue;
      }
    }
    const candidate = actionByKey.get(definition.resourceKey);
    if (candidate === undefined) throw new Error('Missing fixture action.');
    const dependencies = definition.dependsOn.map(
      (/** @type {string} */ resourceKey) => {
        const binding = bindingByKey.get(resourceKey);
        if (binding === undefined) {
          throw new Error(`Missing fixture binding '${resourceKey}'.`);
        }
        return binding;
      },
    );
    const createdByActionId =
      operation === 'apply'
        ? candidate.actionId
        : semanticId('wda3', 'wharfie:test:node-create-action:v1', {
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
  const priorBinding = bindingByKey.get('substrate') ?? null;
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
            planId: semanticId('wpl3', 'wharfie:test:node-last-plan:v1', {
              operation,
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
  const dependencies = action.dependsOn.map(
    (/** @type {string} */ resourceKey) => {
      const binding = bindingByKey.get(resourceKey);
      if (binding === undefined) {
        throw new Error(`Missing node dependency '${resourceKey}'.`);
      }
      return binding;
    },
  );
  return Object.freeze({
    base,
    plan,
    action,
    actionIndex,
    ownershipNonce,
    bindingByKey,
    dependencyBindings: receipts(dependencies),
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

/** @param {Readonly<Record<string, any>>} head @param {ReadonlyArray<Readonly<Record<string, any>>>} intents */
function replaceHeadIntents(head, intents) {
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
      intents,
    },
    lastOperation: head.lastOperation,
  });
}

/** @param {any} fixture @returns {Record<string, string>} */
function expectedTags(fixture) {
  const settledNodeAction = fixture.settledPlan?.actions.find(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === 'substrate',
  );
  return {
    'wharfie:managed-by': 'wharfie',
    'wharfie:resource-kind': 'single-node-substrate',
    'wharfie:retention': 'purge',
    'wharfie:schema-version': '2',
    'wharfie:capability': 'resident-node',
    'wharfie:role': 'node',
    'wharfie:provider-scope-id': fixture.base.providerScope.providerScopeId,
    'wharfie:deployment-instance-id': fixture.base.deploymentInstanceId,
    'wharfie:incarnation-id': fixture.base.incarnationId,
    'wharfie:resource-key': 'substrate',
    'wharfie:created-by-action-id':
      fixture.priorBinding?.createdByActionId ?? fixture.action.actionId,
    'wharfie:ownership-nonce': fixture.ownershipNonce,
    'wharfie:state-digest':
      settledNodeAction?.after?.stateDigest.value ??
      fixture.action.after?.stateDigest.value ??
      fixture.action.before.stateDigest.value,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @returns {Record<string, string>} */
function expectedRootVolumeTags(fixture) {
  return {
    ...expectedTags(fixture),
    'wharfie:resource-kind': 'single-node-substrate-root-volume',
  };
}

/** @param {Record<string, string>} tags */
function tagArray(tags) {
  return Object.entries(tags)
    .sort(([left], [right]) => compareCanonicalStrings(left, right))
    .map(([Key, Value]) => ({ Key, Value }));
}

/** @param {ReturnType<typeof makeFixture>} fixture @returns {string} */
function creationActionId(fixture) {
  return fixture.priorBinding?.createdByActionId ?? fixture.action.actionId;
}

/** @param {ReturnType<typeof makeFixture>} fixture @returns {string} */
function expectedClientToken(fixture) {
  return getAwsSingleNodeNodeCreateClientToken(
    creationActionId(fixture),
    fixture.ownershipNonce,
  );
}

/** @param {ReturnType<typeof makeFixture>} fixture @returns {string} */
function instanceProfileName(fixture) {
  return getAwsSingleNodeRuntimeInstanceProfileName(
    nameAuthority(fixture.base),
  );
}

/** @param {ReturnType<typeof makeFixture>} fixture @returns {string} */
function instanceProfileArn(fixture) {
  return `arn:aws:iam::${fixture.base.providerScope.accountId}:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${instanceProfileName(fixture)}`;
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function makeInstance(fixture, overrides = {}) {
  const publicAssociation = {
    IpOwnerId: 'amazon',
    PublicDnsName: 'ec2-203-0-113-10.compute-1.amazonaws.com',
    PublicIp: '203.0.113.10',
  };
  return {
    InstanceId: IDS.instance,
    ImageId: fixture.base.providerSpec.machineImage.imageId,
    Architecture: fixture.base.providerSpec.machineImage.architecture,
    InstanceType: fixture.base.providerSpec.node.instanceType,
    ClientToken: expectedClientToken(fixture),
    State: { Code: 16, Name: 'running' },
    LaunchTime: new Date(CREATE_TIME),
    AmiLaunchIndex: 0,
    EbsOptimized: true,
    EnaSupport: true,
    IamInstanceProfile: {
      Arn: instanceProfileArn(fixture),
      Id: IDS.instanceProfile,
    },
    NetworkInterfaces: [
      {
        Association: publicAssociation,
        Attachment: {
          AttachTime: new Date(CREATE_TIME),
          AttachmentId: IDS.networkInterfaceAttachment,
          DeleteOnTermination: true,
          DeviceIndex: 0,
          NetworkCardIndex: 0,
          Status: 'attached',
        },
        Description:
          fixture.base.providerSpec.node.primaryNetworkInterface.description,
        Groups: [{ GroupId: IDS.securityGroup, GroupName: 'wharfie-runtime' }],
        Ipv4Prefixes: [],
        Ipv6Addresses: [],
        Ipv6Prefixes: [],
        NetworkInterfaceId: IDS.networkInterface,
        OwnerId: fixture.base.providerScope.accountId,
        PrivateDnsName: 'ip-10-42-0-10.ec2.internal',
        PrivateIpAddress: '10.42.0.10',
        PrivateIpAddresses: [
          {
            Association: { ...publicAssociation },
            Primary: true,
            PrivateDnsName: 'ip-10-42-0-10.ec2.internal',
            PrivateIpAddress: '10.42.0.10',
          },
        ],
        SourceDestCheck: true,
        Status: 'in-use',
        SubnetId: IDS.subnet,
        VpcId: IDS.vpc,
        InterfaceType: 'interface',
      },
    ],
    RootDeviceName: fixture.base.providerSpec.node.rootVolume.deviceName,
    RootDeviceType: 'ebs',
    BlockDeviceMappings: [
      {
        DeviceName: fixture.base.providerSpec.node.rootVolume.deviceName,
        Ebs: {
          AttachTime: new Date(CREATE_TIME),
          DeleteOnTermination: true,
          Status: 'attached',
          VolumeId: IDS.rootVolume,
        },
      },
    ],
    SecurityGroups: [
      { GroupId: IDS.securityGroup, GroupName: 'wharfie-runtime' },
    ],
    SourceDestCheck: true,
    SubnetId: IDS.subnet,
    VpcId: IDS.vpc,
    PrivateIpAddress: '10.42.0.10',
    PublicIpAddress: '203.0.113.10',
    Tags: tagArray(expectedTags(fixture)),
    VirtualizationType: 'hvm',
    CapacityReservationSpecification: {
      CapacityReservationPreference: 'none',
    },
    HibernationOptions: { Configured: false },
    MetadataOptions: {
      State: 'applied',
      HttpEndpoint: 'enabled',
      HttpTokens: 'required',
      HttpPutResponseHopLimit: 1,
      HttpProtocolIpv6: 'disabled',
      InstanceMetadataTags: 'disabled',
    },
    EnclaveOptions: { Enabled: false },
    PrivateDnsNameOptions: {
      HostnameType: 'ip-name',
      EnableResourceNameDnsARecord: false,
      EnableResourceNameDnsAAAARecord: false,
    },
    MaintenanceOptions: { AutoRecovery: 'default' },
    Monitoring: { State: 'disabled' },
    Placement: {
      AvailabilityZone: 'us-east-1a',
      AvailabilityZoneId:
        fixture.base.providerSpec.placement.availabilityZoneId,
      Tenancy: 'default',
    },
    ProductCodes: [],
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {ReadonlyArray<Record<string, any>>} records @param {string} [nextToken] */
function makeInstanceResponse(fixture, records, nextToken) {
  return {
    Reservations:
      records.length === 0
        ? []
        : [
            {
              OwnerId: fixture.base.providerScope.accountId,
              Instances: records,
            },
          ],
    ...(nextToken === undefined ? {} : { NextToken: nextToken }),
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture */
function makeStoppedInstance(fixture) {
  const instance = /** @type {AnyRecord} */ (
    makeInstance(fixture, {
      State: { Code: 80, Name: 'stopped' },
    })
  );
  delete instance.PublicIpAddress;
  delete instance.NetworkInterfaces[0].Association;
  delete instance.NetworkInterfaces[0].PrivateIpAddresses[0].Association;
  return instance;
}

/** @param {Record<string, any>} instance @param {boolean} deleteOnTermination */
function addRetainedVolumeMappings(instance, deleteOnTermination) {
  instance.BlockDeviceMappings.push(
    {
      DeviceName: '/dev/sdf',
      Ebs: {
        AttachTime: new Date(CREATE_TIME),
        DeleteOnTermination: deleteOnTermination,
        Status: 'attached',
        VolumeId: IDS.applicationVolume,
      },
    },
    {
      DeviceName: '/dev/sdg',
      Ebs: {
        AttachTime: new Date(CREATE_TIME),
        DeleteOnTermination: deleteOnTermination,
        Status: 'attached',
        VolumeId: IDS.controlVolume,
      },
    },
  );
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function makeRootVolume(fixture, overrides = {}) {
  const root = fixture.base.providerSpec.node.rootVolume;
  return {
    VolumeId: IDS.rootVolume,
    AvailabilityZone: 'us-east-1a',
    AvailabilityZoneId: fixture.base.providerSpec.placement.availabilityZoneId,
    VolumeType: root.volumeType,
    Size: root.sizeGiB,
    Iops: root.iops,
    Throughput: root.throughputMiBps,
    MultiAttachEnabled: root.multiAttach,
    Encrypted: root.encrypted,
    KmsKeyId: fixture.base.providerSpec.storage.ebsKmsKeyArn,
    SnapshotId: root.snapshotId,
    State: 'in-use',
    CreateTime: new Date(CREATE_TIME),
    Attachments: [
      {
        AttachTime: new Date(CREATE_TIME),
        DeleteOnTermination: true,
        Device: root.deviceName,
        InstanceId: IDS.instance,
        State: 'attached',
        VolumeId: IDS.rootVolume,
      },
    ],
    Tags: tagArray(expectedRootVolumeTags(fixture)),
    FastRestored: false,
    SseType: 'sse-kms',
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {string} attribute @param {unknown} [valueOverride] */
function makeAttributeResponse(fixture, attribute, valueOverride) {
  /** @type {Readonly<Record<string, unknown>>} */
  const values = {
    userData: getAwsSingleNodeBootstrapBase64(),
    disableApiTermination: false,
    disableApiStop: false,
    instanceInitiatedShutdownBehavior: 'stop',
  };
  /** @type {Readonly<Record<string, string>>} */
  const responseKeys = {
    userData: 'UserData',
    disableApiTermination: 'DisableApiTermination',
    disableApiStop: 'DisableApiStop',
    instanceInitiatedShutdownBehavior: 'InstanceInitiatedShutdownBehavior',
  };
  const key = responseKeys[attribute];
  if (key === undefined)
    throw new Error(`Unexpected attribute '${attribute}'.`);
  return {
    InstanceId: IDS.instance,
    [key]: {
      Value: valueOverride === undefined ? values[attribute] : valueOverride,
    },
  };
}

/**
 * @param {ReturnType<typeof makeFixture>} fixture
 * @param {{instance?: AnyRecord|null, discovery?: AnyRecord[], exact?: AnyRecord|null, exactError?: Error, rootVolume?: AnyRecord, rootDiscovery?: AnyRecord[], rootExact?: AnyRecord|null, rootExactError?: Error, attributeOverrides?: Record<string, unknown>, credits?: string, runResponse?: unknown}} [options]
 */
function makeClient(fixture, options = {}) {
  const instance =
    options.instance === undefined ? makeInstance(fixture) : options.instance;
  const discovery = options.discovery ?? (instance === null ? [] : [instance]);
  const exact = options.exact === undefined ? instance : options.exact;
  const rootVolume = options.rootVolume ?? makeRootVolume(fixture);
  const rootExact =
    options.rootExact === undefined ? rootVolume : options.rootExact;
  const rootDiscovery =
    options.rootDiscovery ?? (rootExact === null ? [] : [rootExact]);
  const describeInstances = jest.fn(
    async (/** @type {AnyRecord} */ request) => {
      if (
        Object.hasOwn(request, 'InstanceIds') &&
        options.exactError !== undefined
      ) {
        throw options.exactError;
      }
      const records = Object.hasOwn(request, 'InstanceIds')
        ? exact === null
          ? []
          : [exact]
        : discovery;
      return {
        Reservations:
          records.length === 0
            ? []
            : [
                {
                  OwnerId: fixture.base.providerScope.accountId,
                  Instances: records,
                },
              ],
      };
    },
  );
  return Object.freeze({
    runInstances: jest.fn(
      async (/** @type {AnyRecord} */ _request) =>
        options.runResponse ?? { Instances: [{ InstanceId: IDS.instance }] },
    ),
    startInstances: jest.fn(async (/** @type {AnyRecord} */ _request) => ({
      StartingInstances: [],
    })),
    describeInstances,
    describeInstanceAttribute: jest.fn(
      async (/** @type {AnyRecord} */ request) =>
        makeAttributeResponse(
          fixture,
          request.Attribute,
          options.attributeOverrides?.[request.Attribute],
        ),
    ),
    describeInstanceCreditSpecifications: jest.fn(
      async (/** @type {AnyRecord} */ _request) => ({
        InstanceCreditSpecifications: [
          {
            InstanceId: IDS.instance,
            CpuCredits: options.credits ?? 'standard',
          },
        ],
      }),
    ),
    describeVolumes: jest.fn(async (/** @type {AnyRecord} */ request) => {
      if (Object.hasOwn(request, 'VolumeIds')) {
        if (options.rootExactError !== undefined) {
          throw options.rootExactError;
        }
        return { Volumes: rootExact === null ? [] : [rootExact] };
      }
      return { Volumes: rootDiscovery };
    }),
    terminateInstances: jest.fn(async (/** @type {AnyRecord} */ _request) => ({
      TerminatingInstances: [],
    })),
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makePorts(fixture, options = {}) {
  const client = options.client ?? makeClient(fixture, options);
  const waitForRetry = options.waitForRetry ?? jest.fn();
  const resource = createAwsSingleNodeNodeResource({
    client,
    providerScope: fixture.base.providerScope,
    maxAttempts: options.maxAttempts ?? 2,
    waitForRetry,
  });
  return { client, waitForRetry, resource };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Readonly<Record<string, any>>} head */
function makeNodeObservationAuthority(fixture, head) {
  const targets = createAwsSingleNodeDesiredResourceTargetCatalog({
    deploymentRevision: fixture.base.deploymentRevision,
    profile: fixture.base.profile,
    providerScope: fixture.base.providerScope,
    providerSpec: fixture.base.providerSpec,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
    head,
  });
  const target = targets.find(
    (candidate) => candidate.resourceKey === 'substrate',
  );
  if (target === undefined) throw new Error('Missing substrate target.');
  return createAwsSingleNodeResourceObservationAuthority({
    operation: fixture.plan.operation,
    deploymentRevision: fixture.base.deploymentRevision,
    profile: fixture.base.profile,
    providerScope: fixture.base.providerScope,
    providerSpec: fixture.base.providerSpec,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
    head,
    plan: fixture.plan,
    settledPlan: null,
    target,
  });
}

/** @returns {any} */
function makeCurrentCreateObservationFixture() {
  const fixture = makeFixture();
  return Object.freeze({
    ...fixture,
    authority: makeNodeObservationAuthority(fixture, fixture.head),
  });
}

/** @returns {any} */
function makeBoundObservationFixture() {
  const fixture = makeFixture();
  const dependencies = fixture.action.dependsOn.map(
    (/** @type {string} */ resourceKey) => {
      const binding = fixture.bindingByKey.get(resourceKey);
      if (binding === undefined) {
        throw new Error(`Missing node dependency '${resourceKey}'.`);
      }
      return binding;
    },
  );
  const substrateBinding = makeBinding(
    fixture.base,
    fixture.action,
    fixture.ownershipNonce,
    dependencies,
    fixture.action.actionId,
  );
  const frontier = fixture.plan.actions.length;
  const intents = fixture.plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ action,
      /** @type {number} */ index,
    ) => ({
      actionId: action.actionId,
      status: 'settled',
      ownershipNonce:
        fixture.head.activeOperation.intents[index].ownershipNonce,
    }),
  );
  const head = createDeploymentHead({
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    providerScope: fixture.base.providerScope,
    incarnationId: fixture.base.incarnationId,
    generation: fixture.head.generation + 2,
    phase: 'CONVERGING',
    settledDeploymentRevisionId: null,
    targetDeploymentRevisionId:
      fixture.base.deploymentRevision.deploymentRevisionId,
    resourceBindings: [...fixture.head.resourceBindings, substrateBinding],
    activeOperation: {
      kind: 'create',
      planId: fixture.plan.planId,
      status: 'running',
      nextActionIndex: frontier,
      intents,
    },
    lastOperation: null,
  });
  const boundFixture = Object.freeze({
    ...fixture,
    priorBinding: substrateBinding,
    head,
  });
  return Object.freeze({
    ...boundFixture,
    authority: makeNodeObservationAuthority(boundFixture, head),
  });
}

/** @param {{substrateBeforeStateDigest?: Readonly<Record<string, string>>}} [options] @returns {any} */
function makeDeleteObservationFixture(options = {}) {
  const base = makeBase();
  const settledPlan = makePlan(base, 'apply');
  const settledIntentByKey = new Map(
    settledPlan.actions.map(
      (
        /** @type {Readonly<AnyRecord>} */ action,
        /** @type {number} */ index,
      ) => [
        action.resourceKey,
        {
          actionId: action.actionId,
          status: 'settled',
          ownershipNonce: nonce(100 + index),
        },
      ],
    ),
  );
  const settledIntents = settledPlan.actions.map(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      settledIntentByKey.get(action.resourceKey),
  );
  const settledActionByKey = new Map(
    settledPlan.actions.map((/** @type {Readonly<AnyRecord>} */ action) => [
      action.resourceKey,
      action,
    ]),
  );
  const bindingByKey = new Map();
  for (const definition of AWS_SINGLE_NODE_RESOURCE_GRAPH.resources) {
    const action = settledActionByKey.get(definition.resourceKey);
    if (action === undefined) throw new Error('Missing settled action.');
    const dependencies = definition.dependsOn.map(
      (/** @type {string} */ resourceKey) => {
        const binding = bindingByKey.get(resourceKey);
        if (binding === undefined) {
          throw new Error(`Missing settled dependency '${resourceKey}'.`);
        }
        return binding;
      },
    );
    const intent = settledIntentByKey.get(definition.resourceKey);
    bindingByKey.set(
      definition.resourceKey,
      makeBinding(
        base,
        action,
        intent.ownershipNonce,
        dependencies,
        action.actionId,
      ),
    );
    if (definition.resourceKey === 'substrate') break;
  }
  const priorBinding = bindingByKey.get('substrate');
  if (priorBinding === undefined) throw new Error('Missing substrate binding.');
  const readyGeneration = 40;
  const readyHead = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: readyGeneration,
    phase: 'READY',
    settledDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    resourceBindings: [...bindingByKey.values()],
    activeOperation: null,
    lastOperation: {
      kind: 'create',
      planId: settledPlan.planId,
      intents: settledIntents,
    },
  });
  const plan = makePlan(base, 'destroy', options);
  const action = plan.actions.find(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === 'substrate',
  );
  if (action === undefined) throw new Error('Missing substrate delete.');
  const actionIndex = plan.actions.indexOf(action);
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
        bindingByKey.get(candidate.resourceKey)?.ownershipNonce ??
        nonce(200 + index),
    }),
  );
  const deletedKeys = new Set(
    plan.actions
      .slice(0, actionIndex)
      .filter(
        (/** @type {Readonly<AnyRecord>} */ candidate) =>
          candidate.action === 'delete',
      )
      .map(
        (/** @type {Readonly<AnyRecord>} */ candidate) => candidate.resourceKey,
      ),
  );
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: readyGeneration + 2,
    phase: 'DESTROYING',
    settledDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: null,
    resourceBindings: [...bindingByKey.values()].filter(
      (binding) => !deletedKeys.has(binding.resourceKey),
    ),
    activeOperation: {
      kind: 'destroy',
      planId: plan.planId,
      status: 'running',
      nextActionIndex: actionIndex,
      intents,
    },
    lastOperation: readyHead.lastOperation,
  });
  const targets = createAwsSingleNodeDesiredResourceTargetCatalog({
    deploymentRevision: base.deploymentRevision,
    profile: base.profile,
    providerScope: base.providerScope,
    providerSpec: base.providerSpec,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    head,
  });
  const target = targets.find(
    (candidate) => candidate.resourceKey === 'substrate',
  );
  if (target === undefined) throw new Error('Missing substrate target.');
  const authority = createAwsSingleNodeResourceObservationAuthority({
    operation: 'destroy',
    deploymentRevision: base.deploymentRevision,
    profile: base.profile,
    providerScope: base.providerScope,
    providerSpec: base.providerSpec,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    head,
    plan,
    settledPlan,
    target,
  });
  return Object.freeze({
    base,
    plan,
    settledPlan,
    action,
    actionIndex,
    ownershipNonce: priorBinding.ownershipNonce,
    bindingByKey,
    dependencyBindings: priorBinding.dependencyBindings,
    priorBinding,
    head,
    authority,
  });
}

/** @returns {any} */
function makeSettledNoopObservationFixture() {
  const created = makeDeleteObservationFixture();
  const settledPlan = makePlan(created.base, 'reconcile');
  const action = settledPlan.actions.find(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === 'substrate',
  );
  if (action === undefined) throw new Error('Missing settled substrate noop.');
  const intents = settledPlan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ candidate,
      /** @type {number} */ index,
    ) => ({
      actionId: candidate.actionId,
      status: 'settled',
      ownershipNonce:
        created.bindingByKey.get(candidate.resourceKey)?.ownershipNonce ??
        nonce(300 + index),
    }),
  );
  const head = createDeploymentHead({
    deploymentInstanceId: created.base.deploymentInstanceId,
    providerScope: created.base.providerScope,
    incarnationId: created.base.incarnationId,
    generation: created.head.generation + 4,
    phase: 'READY',
    settledDeploymentRevisionId:
      created.base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId:
      created.base.deploymentRevision.deploymentRevisionId,
    resourceBindings: [...created.bindingByKey.values()],
    activeOperation: null,
    lastOperation: {
      kind: 'reconcile',
      planId: settledPlan.planId,
      intents,
    },
  });
  const targets = createAwsSingleNodeDesiredResourceTargetCatalog({
    deploymentRevision: created.base.deploymentRevision,
    profile: created.base.profile,
    providerScope: created.base.providerScope,
    providerSpec: created.base.providerSpec,
    deploymentInstanceId: created.base.deploymentInstanceId,
    incarnationId: created.base.incarnationId,
    head,
  });
  const target = targets.find(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === 'substrate',
  );
  if (target === undefined) throw new Error('Missing substrate target.');
  const authority = createAwsSingleNodeResourceObservationAuthority({
    operation: 'reconcile',
    deploymentRevision: created.base.deploymentRevision,
    profile: created.base.profile,
    providerScope: created.base.providerScope,
    providerSpec: created.base.providerSpec,
    deploymentInstanceId: created.base.deploymentInstanceId,
    incarnationId: created.base.incarnationId,
    head,
    plan: null,
    settledPlan,
    target,
  });
  return Object.freeze({
    ...created,
    plan: null,
    settledPlan,
    action,
    head,
    authority,
  });
}

/** @param {any} fixture @param {Record<string, any>} [options] */
function makeObserverPorts(fixture, options = {}) {
  const fullClient = options.client ?? makeClient(fixture, options);
  const client = Object.freeze({
    describeInstances: fullClient.describeInstances,
    describeInstanceAttribute: fullClient.describeInstanceAttribute,
    describeInstanceCreditSpecifications:
      fullClient.describeInstanceCreditSpecifications,
    describeVolumes: fullClient.describeVolumes,
  });
  const waitForRetry = options.waitForRetry ?? jest.fn();
  const observer = createAwsSingleNodeNodeResourceObserver({
    client,
    providerScope: fixture.base.providerScope,
    maxAttempts: options.maxAttempts ?? 2,
    waitForRetry,
  });
  return { client, waitForRetry, observer };
}

/** @param {ReturnType<typeof makeFixture>} fixture */
function expectedRunInstancesRequest(fixture) {
  const node = fixture.base.providerSpec.node;
  const root = node.rootVolume;
  const instanceTags = tagArray(expectedTags(fixture));
  const rootVolumeTags = tagArray(expectedRootVolumeTags(fixture));
  return {
    BlockDeviceMappings: [
      {
        DeviceName: root.deviceName,
        Ebs: {
          DeleteOnTermination: true,
          Encrypted: true,
          Iops: root.iops,
          KmsKeyId: fixture.base.providerSpec.storage.ebsKmsKeyArn,
          SnapshotId: root.snapshotId,
          Throughput: root.throughputMiBps,
          VolumeSize: root.sizeGiB,
          VolumeType: root.volumeType,
        },
      },
    ],
    CapacityReservationSpecification: {
      CapacityReservationPreference: 'none',
    },
    ClientToken: expectedClientToken(fixture),
    CreditSpecification: { CpuCredits: 'standard' },
    DisableApiStop: false,
    DisableApiTermination: false,
    EbsOptimized: true,
    EnclaveOptions: { Enabled: false },
    HibernationOptions: { Configured: false },
    IamInstanceProfile: { Arn: instanceProfileArn(fixture) },
    ImageId: fixture.base.providerSpec.machineImage.imageId,
    InstanceInitiatedShutdownBehavior: 'stop',
    InstanceType: node.instanceType,
    MaintenanceOptions: { AutoRecovery: 'default' },
    MaxCount: 1,
    MetadataOptions: {
      HttpEndpoint: 'enabled',
      HttpTokens: 'required',
      HttpPutResponseHopLimit: 1,
      HttpProtocolIpv6: 'disabled',
      InstanceMetadataTags: 'disabled',
    },
    MinCount: 1,
    Monitoring: { Enabled: false },
    NetworkInterfaces: [
      {
        AssociatePublicIpAddress: true,
        DeleteOnTermination: true,
        Description: node.primaryNetworkInterface.description,
        DeviceIndex: 0,
        Groups: [IDS.securityGroup],
        InterfaceType: 'interface',
        NetworkCardIndex: 0,
        SubnetId: IDS.subnet,
      },
    ],
    Placement: {
      AvailabilityZoneId:
        fixture.base.providerSpec.placement.availabilityZoneId,
      Tenancy: 'default',
    },
    PrivateDnsNameOptions: {
      HostnameType: 'ip-name',
      EnableResourceNameDnsARecord: false,
      EnableResourceNameDnsAAAARecord: false,
    },
    TagSpecifications: [
      { ResourceType: 'instance', Tags: instanceTags },
      { ResourceType: 'volume', Tags: rootVolumeTags },
    ],
    UserData: getAwsSingleNodeBootstrapBase64(),
  };
}

describe('AWS single-node substrate identity', () => {
  it('exports deterministic intrinsic state and replay identities', () => {
    const fixture = makeFixture();
    const state = getAwsSingleNodeNodeStateDigest(
      fixture.base.providerSpec,
      nameAuthority(fixture.base),
    );
    const repeated = getAwsSingleNodeNodeStateDigest(
      fixture.base.providerSpec,
      nameAuthority(fixture.base),
    );

    expect(AWS_SINGLE_NODE_NODE_STATE_DIGEST_DOMAIN).toBe(
      'wharfie:aws-single-node-ec2-instance-state:v1',
    );
    expect(state).toEqual(repeated);
    expect(state).toEqual({
      algorithm: 'sha256',
      value: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expectDeepFrozen(state);

    const token = getAwsSingleNodeNodeCreateClientToken(
      fixture.action.actionId,
      fixture.ownershipNonce,
    );
    const payload = JSON.stringify({
      actionId: fixture.action.actionId,
      ownershipNonce: fixture.ownershipNonce,
    });
    expect(AWS_SINGLE_NODE_NODE_CREATE_CLIENT_TOKEN_DOMAIN).toBe(
      'wharfie:aws-single-node-ec2-instance-create-client-token:v1',
    );
    expect(token).toBe(
      Buffer.from(
        sha256Base64Url(
          `${AWS_SINGLE_NODE_NODE_CREATE_CLIENT_TOKEN_DOMAIN}\0${payload}`,
        ),
        'base64url',
      ).toString('hex'),
    );
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(
      getAwsSingleNodeNodeCreateClientToken(
        fixture.action.actionId,
        fixture.ownershipNonce,
      ),
    ).toBe(token);
    expect(
      getAwsSingleNodeNodeCreateClientToken(fixture.action.actionId, nonce(91)),
    ).not.toBe(token);
  });

  it('changes intrinsic state with launch authority and deterministic profile identity', () => {
    const first = makeBase();
    const changedImage = makeBase({ imageId: 'ami-0fedcba9876543210' });
    const changedIncarnation = makeBase({ incarnationByte: 8 });
    const state = (/** @type {ReturnType<typeof makeBase>} */ base) =>
      getAwsSingleNodeNodeStateDigest(base.providerSpec, nameAuthority(base))
        .value;

    expect(state(changedImage)).not.toBe(state(first));
    expect(state(changedIncarnation)).not.toBe(state(first));
  });
});

describe('AWS single-node substrate launch and settlement', () => {
  it('submits one exact deeply frozen RunInstances request with atomic instance and root tags', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      instance: null,
      discovery: [],
      exact: null,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();

    expect(client.runInstances).toHaveBeenCalledTimes(1);
    const request = client.runInstances.mock.calls[0][0];
    expect(request).toEqual(expectedRunInstancesRequest(fixture));
    expectDeepFrozen(request);
    expect(JSON.stringify(request)).not.toMatch(
      /secret|access.?key|artifact\/v1|node resource artifact/i,
    );
  });

  it('settles a fully read running node with all eight sorted dependency receipts', async () => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: expect.objectContaining({
        resourceKey: 'substrate',
        providerType: 'ec2-instance',
        providerResourceId: IDS.instance,
        ownershipNonce: fixture.ownershipNonce,
        createdByActionId: fixture.action.actionId,
        dependencyBindings: fixture.dependencyBindings,
      }),
    });

    expect(fixture.dependencyBindings).toHaveLength(8);
    expect(
      fixture.dependencyBindings.map(({ resourceKey }) => resourceKey),
    ).toEqual([...fixture.action.dependsOn].sort(compareCanonicalStrings));
    expect(client.describeInstanceAttribute).toHaveBeenCalledTimes(4);
    expect(client.describeInstanceCreditSpecifications).toHaveBeenCalledWith({
      InstanceIds: [IDS.instance],
    });
    expect(client.describeVolumes).toHaveBeenCalledWith({
      VolumeIds: [IDS.rootVolume],
    });
  });

  it('treats a run response as a candidate only and recovers it through fresh tagged discovery', async () => {
    const fixture = makeFixture();
    const launchClient = makeClient(fixture, {
      instance: null,
      discovery: [],
      exact: null,
    });
    const launch = makePorts(fixture, { client: launchClient }).resource;

    await expect(
      launch.executeAction(fixture.context),
    ).resolves.toBeUndefined();

    const recoveryClient = makeClient(fixture);
    const recovery = makePorts(fixture, { client: recoveryClient }).resource;
    await expect(
      recovery.verifySettlement(fixture.context),
    ).resolves.toMatchObject({
      status: 'converged',
      binding: { providerResourceId: IDS.instance },
    });
    expect(recoveryClient.runInstances).not.toHaveBeenCalled();
  });

  it('replays an ambiguous launch with byte-identical authority in the same and a fresh factory', async () => {
    const fixture = makeFixture();
    const instance = makeInstance(fixture);
    let visible = false;
    const describeInstances = jest.fn(
      async (/** @type {AnyRecord} */ request) => {
        if (Object.hasOwn(request, 'InstanceIds') && !visible) {
          throw providerError(
            'InvalidInstanceID.NotFound',
            'not-yet-visible-secret',
          );
        }
        return makeInstanceResponse(fixture, visible ? [instance] : []);
      },
    );
    const client = {
      ...makeClient(fixture, { instance: null }),
      describeInstances,
    };
    client.runInstances
      .mockRejectedValueOnce(new Error('first-lost-response-secret'))
      .mockRejectedValueOnce(new Error('second-lost-response-secret'))
      .mockResolvedValueOnce({ Instances: [{ InstanceId: IDS.instance }] });
    const first = makePorts(fixture, { client }).resource;

    await expect(first.executeAction(fixture.context)).resolves.toBeUndefined();
    await expect(first.executeAction(fixture.context)).resolves.toBeUndefined();

    const fresh = makePorts(fixture, { client }).resource;
    await expect(fresh.executeAction(fixture.context)).resolves.toBeUndefined();

    expect(client.runInstances).toHaveBeenCalledTimes(3);
    const requests = client.runInstances.mock.calls.map(([request]) => request);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[2]).toEqual(requests[0]);
    expect(requests[0].ClientToken).toBe(expectedClientToken(fixture));
    for (const request of requests) expectDeepFrozen(request);

    await expect(fresh.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    visible = true;
    await expect(
      fresh.verifySettlement(fixture.context),
    ).resolves.toMatchObject({
      status: 'converged',
      binding: { providerResourceId: IDS.instance },
    });
  });

  it('maps launch mismatch, malformed success, and provider-read failures to fixed non-echoing errors', async () => {
    const fixture = makeFixture();
    const absent = { instance: null, discovery: [], exact: null };
    const mismatchClient = makeClient(fixture, absent);
    mismatchClient.runInstances.mockRejectedValue(
      providerError('IdempotentParameterMismatch', 'mismatched-launch-secret'),
    );
    const mismatch = makePorts(fixture, { client: mismatchClient }).resource;
    const mismatchError = await mismatch
      .executeAction(fixture.context)
      .catch((error) => error);
    expect(mismatchError).toBeInstanceOf(
      AwsSingleNodeNodeResourceConflictError,
    );
    expect(JSON.stringify(mismatchError)).not.toContain(
      'mismatched-launch-secret',
    );

    const malformedClient = makeClient(fixture, absent);
    malformedClient.runInstances.mockResolvedValue({
      Instances: [{ InstanceId: 'not-an-instance' }],
      secret: 'malformed-launch-secret',
    });
    const malformed = makePorts(fixture, { client: malformedClient }).resource;
    const malformedError = await malformed
      .executeAction(fixture.context)
      .catch((error) => error);
    expect(malformedError).toBeInstanceOf(
      AwsSingleNodeNodeResourceUnknownError,
    );
    expect(JSON.stringify(malformedError)).not.toContain(
      'malformed-launch-secret',
    );

    const readClient = {
      ...makeClient(fixture),
      describeInstances: jest.fn(async () => {
        throw providerError('AccessDenied', 'discovery-provider-secret');
      }),
    };
    const readFailure = makePorts(fixture, { client: readClient }).resource;
    const readError = await readFailure
      .verifySettlement(fixture.context)
      .catch((error) => error);
    expect(readError).toBeInstanceOf(AwsSingleNodeNodeResourceUnknownError);
    expect(JSON.stringify(readError)).not.toContain(
      'discovery-provider-secret',
    );
  });

  it('adapts bounded EC2 reservation pages and blocks a duplicate identity across pages', async () => {
    const fixture = makeFixture();
    const instance = makeInstance(fixture);
    const describeInstances = jest.fn(
      async (/** @type {AnyRecord} */ request) => {
        if (Object.hasOwn(request, 'InstanceIds')) {
          return makeInstanceResponse(fixture, [instance]);
        }
        if (request.NextToken === undefined) {
          return makeInstanceResponse(fixture, [], 'page-2');
        }
        return makeInstanceResponse(fixture, [instance]);
      },
    );
    const client = { ...makeClient(fixture), describeInstances };
    const paged = makePorts(fixture, { client }).resource;

    await expect(
      paged.verifySettlement(fixture.context),
    ).resolves.toMatchObject({
      status: 'converged',
      binding: { providerResourceId: IDS.instance },
    });
    const discoveryRequests = describeInstances.mock.calls
      .map(([request]) => request)
      .filter((request) => !Object.hasOwn(request, 'InstanceIds'));
    expect(discoveryRequests).toHaveLength(2);
    expect(discoveryRequests[0]).toMatchObject({
      MaxResults: AWS_SINGLE_NODE_NODE_DISCOVERY_MAX_RESULTS,
    });
    expect(discoveryRequests[0]).not.toHaveProperty('NextToken');
    expect(discoveryRequests[1]).toMatchObject({ NextToken: 'page-2' });
    for (const request of discoveryRequests) expectDeepFrozen(request);

    const duplicateDescribe = jest.fn(
      async (/** @type {AnyRecord} */ request) => {
        if (Object.hasOwn(request, 'InstanceIds')) {
          return makeInstanceResponse(fixture, [instance]);
        }
        return makeInstanceResponse(
          fixture,
          [instance],
          request.NextToken === undefined ? 'duplicate-page' : undefined,
        );
      },
    );
    const duplicateClient = {
      ...makeClient(fixture),
      describeInstances: duplicateDescribe,
    };
    const duplicate = makePorts(fixture, {
      client: duplicateClient,
    }).resource;
    await expect(duplicate.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(duplicateDescribe).toHaveBeenCalledTimes(2);
    expect(duplicateClient.describeInstanceAttribute).not.toHaveBeenCalled();
  });

  it('allows every retained non-root mapping only with delete-on-termination false', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const instance = makeInstance(fixture);
    addRetainedVolumeMappings(instance, false);
    const { resource } = makePorts(fixture, {
      client: makeClient(fixture, { instance }),
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: fixture.priorBinding,
    });

    const destroyFixture = makeFixture({ operation: 'destroy' });
    const destroyInstance = makeInstance(destroyFixture);
    addRetainedVolumeMappings(destroyInstance, false);
    const destroyClient = makeClient(destroyFixture, {
      instance: destroyInstance,
    });
    const destroy = makePorts(destroyFixture, {
      client: destroyClient,
    }).resource;
    await expect(
      destroy.executeAction(destroyFixture.context),
    ).resolves.toBeUndefined();
    expect(destroyClient.terminateInstances).toHaveBeenCalledTimes(1);

    const unsafeInstance = makeInstance(destroyFixture);
    addRetainedVolumeMappings(unsafeInstance, false);
    unsafeInstance.BlockDeviceMappings[1].Ebs.DeleteOnTermination = true;
    const unsafeClient = makeClient(destroyFixture, {
      instance: unsafeInstance,
    });
    const unsafe = makePorts(destroyFixture, {
      client: unsafeClient,
    }).resource;
    await expect(unsafe.executeAction(destroyFixture.context)).rejects.toEqual(
      new AwsSingleNodeNodeResourceConflictError(),
    );
    expect(unsafeClient.terminateInstances).not.toHaveBeenCalled();
  });
});

describe('AWS single-node substrate lifecycle recovery', () => {
  it.each([
    ['create', 'apply'],
    ['noop', 'reconcile'],
  ])(
    'starts an exactly owned stopped %s only after full static readback',
    async (_action, operation) => {
      const typedOperation = /** @type {'apply'|'reconcile'} */ (operation);
      const fixture = makeFixture({
        operation: typedOperation,
      });
      const stopped = makeStoppedInstance(fixture);
      const client = makeClient(fixture, { instance: stopped });
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        { status: 'not-converged' },
      );
      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();

      expect(client.startInstances).toHaveBeenCalledWith({
        InstanceIds: [IDS.instance],
      });
      expect(client.runInstances).not.toHaveBeenCalled();
    },
  );

  it('waits for a stopped Amazon public association to disappear before restart', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    let observed = /** @type {AnyRecord} */ (
      makeInstance(fixture, {
        State: { Code: 80, Name: 'stopped' },
      })
    );
    const client = {
      ...makeClient(fixture),
      describeInstances: jest.fn(async () =>
        makeInstanceResponse(fixture, [observed]),
      ),
    };
    const resource = makePorts(fixture, { client }).resource;

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.startInstances).not.toHaveBeenCalled();

    observed = makeStoppedInstance(fixture);
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.startInstances).toHaveBeenCalledWith({
      InstanceIds: [IDS.instance],
    });
  });

  it('blocks a terminated create instead of launching a replacement', async () => {
    const fixture = makeFixture();
    const terminated = makeInstance(fixture, {
      State: { Code: 48, Name: 'terminated' },
    });
    const client = makeClient(fixture, { instance: terminated });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.runInstances).not.toHaveBeenCalled();
    expect(client.startInstances).not.toHaveBeenCalled();
  });

  it('terminates only the exact live destroy binding and accepts its owned tombstone', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const liveClient = makeClient(fixture);
    const live = makePorts(fixture, { client: liveClient }).resource;

    await expect(live.executeAction(fixture.context)).resolves.toBeUndefined();
    expect(liveClient.terminateInstances).toHaveBeenCalledWith({
      InstanceIds: [IDS.instance],
      SkipOsShutdown: false,
    });
    expect(liveClient.describeInstanceAttribute).toHaveBeenCalledTimes(4);
    expect(
      liveClient.describeInstanceCreditSpecifications,
    ).toHaveBeenCalledWith({ InstanceIds: [IDS.instance] });
    expect(liveClient.describeVolumes).toHaveBeenCalledWith({
      VolumeIds: [IDS.rootVolume],
    });

    const driftedRoot = makeRootVolume(fixture, {
      KmsKeyId:
        'arn:aws:kms:us-east-1:123456789012:key/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
    const driftedClient = makeClient(fixture, {
      rootVolume: driftedRoot,
    });
    const drifted = makePorts(fixture, {
      client: driftedClient,
    }).resource;
    await expect(drifted.executeAction(fixture.context)).rejects.toEqual(
      new AwsSingleNodeNodeResourceConflictError(),
    );
    expect(driftedClient.terminateInstances).not.toHaveBeenCalled();

    await expect(live.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });

    const terminated = makeInstance(fixture, {
      State: { Code: 48, Name: 'terminated' },
    });
    const tombstone = makePorts(fixture, {
      client: makeClient(fixture, {
        instance: terminated,
        rootDiscovery: [],
        rootExactError: providerError('InvalidVolume.NotFound'),
      }),
    }).resource;
    await expect(tombstone.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
  });

  it('settles start and termination races only from fresh provider readback', async () => {
    const startFixture = makeFixture({ operation: 'reconcile' });
    let startObserved = makeStoppedInstance(startFixture);
    const startInstances = jest.fn(async () => {
      startObserved = makeInstance(startFixture);
      throw providerError('IncorrectInstanceState', 'start-race-secret');
    });
    const startClient = {
      ...makeClient(startFixture),
      startInstances,
      describeInstances: jest.fn(async () =>
        makeInstanceResponse(startFixture, [startObserved]),
      ),
    };
    const start = makePorts(startFixture, { client: startClient }).resource;

    await expect(
      start.executeAction(startFixture.context),
    ).resolves.toBeUndefined();
    expect(startInstances).toHaveBeenCalledTimes(1);
    await expect(start.verifySettlement(startFixture.context)).resolves.toEqual(
      {
        status: 'converged',
        binding: startFixture.priorBinding,
      },
    );

    const destroyFixture = makeFixture({ operation: 'destroy' });
    let destroyObserved = makeInstance(destroyFixture);
    let destroyRootGone = false;
    const destroyRoot = makeRootVolume(destroyFixture);
    const terminateInstances = jest.fn(async () => {
      destroyObserved = makeInstance(destroyFixture, {
        State: { Code: 32, Name: 'shutting-down' },
      });
      throw providerError('OperationNotPermitted', 'termination-race-secret');
    });
    const destroyClient = {
      ...makeClient(destroyFixture),
      terminateInstances,
      describeInstances: jest.fn(async () =>
        makeInstanceResponse(destroyFixture, [destroyObserved]),
      ),
      describeVolumes: jest.fn(async (/** @type {AnyRecord} */ request) => {
        if (destroyRootGone) {
          if (Object.hasOwn(request, 'VolumeIds')) {
            throw providerError('InvalidVolume.NotFound');
          }
          return { Volumes: [] };
        }
        return { Volumes: [destroyRoot] };
      }),
    };
    const destroy = makePorts(destroyFixture, {
      client: destroyClient,
    }).resource;

    await expect(
      destroy.executeAction(destroyFixture.context),
    ).resolves.toBeUndefined();
    await expect(
      destroy.verifySettlement(destroyFixture.context),
    ).resolves.toEqual({ status: 'not-converged' });
    await expect(
      destroy.executeAction(destroyFixture.context),
    ).resolves.toBeUndefined();
    expect(terminateInstances).toHaveBeenCalledTimes(1);

    destroyObserved = makeInstance(destroyFixture, {
      State: { Code: 48, Name: 'terminated' },
    });
    destroyRootGone = true;
    await expect(
      destroy.verifySettlement(destroyFixture.context),
    ).resolves.toEqual({ status: 'converged', binding: null });

    const changedFixture = makeFixture({ operation: 'destroy' });
    let changedObserved = makeInstance(changedFixture);
    const changedTerminate = jest.fn(async () => {
      changedObserved = makeInstance(changedFixture, {
        State: { Code: 64, Name: 'stopping' },
      });
      throw providerError(
        'OperationNotPermitted',
        'changed-state-refusal-secret',
      );
    });
    const changedClient = {
      ...makeClient(changedFixture),
      terminateInstances: changedTerminate,
      describeInstances: jest.fn(async () =>
        makeInstanceResponse(changedFixture, [changedObserved]),
      ),
    };
    const changed = makePorts(changedFixture, {
      client: changedClient,
    }).resource;
    await expect(
      changed.executeAction(changedFixture.context),
    ).resolves.toBeUndefined();
    expect(changedTerminate).toHaveBeenCalledTimes(1);
    await expect(
      changed.verifySettlement(changedFixture.context),
    ).resolves.toEqual({ status: 'not-converged' });

    const unchangedFixture = makeFixture({ operation: 'destroy' });
    const unchangedClient = makeClient(unchangedFixture);
    unchangedClient.terminateInstances.mockRejectedValue(
      providerError(
        'OperationNotPermitted',
        'unchanged-termination-refusal-secret',
      ),
    );
    const unchanged = makePorts(unchangedFixture, {
      client: unchangedClient,
    }).resource;
    const unchangedError = await unchanged
      .executeAction(unchangedFixture.context)
      .catch((error) => error);
    expect(unchangedError).toBeInstanceOf(
      AwsSingleNodeNodeResourceConflictError,
    );
    expect(JSON.stringify(unchangedError)).not.toContain(
      'unchanged-termination-refusal-secret',
    );
    expect(unchangedClient.terminateInstances).toHaveBeenCalledTimes(1);
  });

  it('distinguishes instance absence and live-root NotFound from successful-empty evidence', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const emptyResponse = makeInstanceResponse(fixture, []);
    const typedClient = {
      ...makeClient(fixture, { rootDiscovery: [] }),
      describeInstances: jest.fn(async (/** @type {AnyRecord} */ request) => {
        if (Object.hasOwn(request, 'InstanceIds')) {
          throw providerError('InvalidInstanceID.NotFound');
        }
        return emptyResponse;
      }),
    };
    const typed = makePorts(fixture, { client: typedClient }).resource;
    await expect(typed.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });

    const emptyClient = {
      ...makeClient(fixture),
      describeInstances: jest.fn(async () => emptyResponse),
    };
    const empty = makePorts(fixture, { client: emptyClient }).resource;
    await expect(empty.verifySettlement(fixture.context)).rejects.toEqual(
      new AwsSingleNodeNodeResourceUnknownError(),
    );

    const instance = makeInstance(fixture);
    const discoveryOnlyClient = {
      ...makeClient(fixture),
      describeInstances: jest.fn(async (/** @type {AnyRecord} */ request) => {
        if (Object.hasOwn(request, 'InstanceIds')) {
          throw providerError('InvalidInstanceId.NotFound');
        }
        return makeInstanceResponse(fixture, [instance]);
      }),
    };
    const discoveryOnly = makePorts(fixture, {
      client: discoveryOnlyClient,
    }).resource;
    await expect(
      discoveryOnly.verifySettlement(fixture.context),
    ).resolves.toEqual({ status: 'not-converged' });

    const createFixture = makeFixture();
    const createClient = makeClient(createFixture, {
      rootExactError: providerError('InvalidVolume.NotFound'),
    });
    const create = makePorts(createFixture, { client: createClient }).resource;
    await expect(
      create.verifySettlement(createFixture.context),
    ).resolves.toEqual({ status: 'not-converged' });

    const noopFixture = makeFixture({ operation: 'reconcile' });
    const noopClient = makeClient(noopFixture, {
      rootExactError: providerError('InvalidVolume.NotFound'),
    });
    const noop = makePorts(noopFixture, { client: noopClient }).resource;
    await expect(noop.verifySettlement(noopFixture.context)).resolves.toEqual({
      status: 'blocked',
    });

    const destroyFixture = makeFixture({ operation: 'destroy' });
    const destroyClient = makeClient(destroyFixture, {
      rootExactError: providerError('InvalidVolume.NotFound'),
    });
    const destroy = makePorts(destroyFixture, {
      client: destroyClient,
    }).resource;
    await expect(destroy.executeAction(destroyFixture.context)).rejects.toEqual(
      new AwsSingleNodeNodeResourceConflictError(),
    );
    expect(destroyClient.terminateInstances).not.toHaveBeenCalled();

    const emptyVolume = makePorts(noopFixture, {
      client: makeClient(noopFixture, { rootExact: null }),
    }).resource;
    await expect(
      emptyVolume.verifySettlement(noopFixture.context),
    ).rejects.toEqual(new AwsSingleNodeNodeResourceUnknownError());
  });

  it('requires independent root absence after a terminal or absent instance', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const terminated = makeInstance(fixture, {
      State: { Code: 48, Name: 'terminated' },
    });
    const successfulEmpty = makePorts(fixture, {
      client: makeClient(fixture, {
        instance: terminated,
        rootDiscovery: [],
        rootExact: null,
      }),
    }).resource;
    await expect(
      successfulEmpty.verifySettlement(fixture.context),
    ).rejects.toEqual(new AwsSingleNodeNodeResourceUnknownError());

    const rootVolume = makeRootVolume(fixture);
    const instanceAbsentClient = {
      ...makeClient(fixture, { rootVolume }),
      describeInstances: jest.fn(async (/** @type {AnyRecord} */ request) => {
        if (Object.hasOwn(request, 'InstanceIds')) {
          throw providerError('InvalidInstanceID.NotFound');
        }
        return makeInstanceResponse(fixture, []);
      }),
    };
    const instanceAbsent = makePorts(fixture, {
      client: instanceAbsentClient,
    }).resource;
    await expect(
      instanceAbsent.verifySettlement(fixture.context),
    ).resolves.toEqual({ status: 'not-converged' });
  });

  it('does not converge from only the first jointly empty logical sample', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const rootVolume = makeRootVolume(fixture);
    let rootVisible = false;
    const client = {
      ...makeClient(fixture),
      describeInstances: jest.fn(async (/** @type {AnyRecord} */ request) => {
        if (Object.hasOwn(request, 'InstanceIds')) {
          throw providerError('InvalidInstanceID.NotFound');
        }
        return makeInstanceResponse(fixture, []);
      }),
      describeVolumes: jest.fn(async () => ({
        Volumes: rootVisible ? [rootVolume] : [],
      })),
    };
    const waitForRetry = jest.fn(async () => {
      rootVisible = true;
    });
    const resource = makePorts(fixture, {
      client,
      waitForRetry,
    }).resource;

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(waitForRetry).toHaveBeenCalledTimes(1);
    expect(client.describeInstances).toHaveBeenCalledTimes(4);
    expect(client.describeVolumes).toHaveBeenCalledTimes(3);
  });

  it('converges only after every configured jointly empty logical sample', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = {
      ...makeClient(fixture, { rootDiscovery: [] }),
      describeInstances: jest.fn(async (/** @type {AnyRecord} */ request) => {
        if (Object.hasOwn(request, 'InstanceIds')) {
          throw providerError('InvalidInstanceID.NotFound');
        }
        return makeInstanceResponse(fixture, []);
      }),
    };
    const waitForRetry = jest.fn();
    const resource = makePorts(fixture, {
      client,
      maxAttempts: 3,
      waitForRetry,
    }).resource;

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(waitForRetry).toHaveBeenCalledTimes(2);
    expect(client.describeInstances).toHaveBeenCalledTimes(6);
    expect(client.describeVolumes).toHaveBeenCalledTimes(3);
  });

  it.each([
    [
      'attached root',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRootVolume(fixture),
      { status: 'not-converged' },
      1,
    ],
    [
      'deleting root',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => {
        const volume = makeRootVolume(fixture, { State: 'deleting' });
        volume.Attachments[0].State = 'detaching';
        return volume;
      },
      { status: 'not-converged' },
      1,
    ],
    [
      'available orphan root',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRootVolume(fixture, { State: 'available', Attachments: [] }),
      { status: 'blocked' },
      0,
    ],
    [
      'deleted root tombstone',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
        makeRootVolume(fixture, { State: 'deleted', Attachments: [] }),
      { status: 'converged', binding: null },
      0,
    ],
  ])(
    'classifies terminal-instance %s evidence without false absence',
    async (_name, makeVolume, expected, expectedWaits) => {
      const fixture = makeFixture({ operation: 'destroy' });
      const terminated = makeInstance(fixture, {
        State: { Code: 48, Name: 'terminated' },
      });
      const rootVolume = makeVolume(fixture);
      const { resource, waitForRetry } = makePorts(fixture, {
        client: makeClient(fixture, { instance: terminated, rootVolume }),
      });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        expected,
      );
      expect(waitForRetry).toHaveBeenCalledTimes(expectedWaits);
    },
  );
});

describe('AWS single-node substrate evidence and factory fences', () => {
  it('rejects upstream authority and destructive ownership drift before mutation', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const subnetIndex = fixture.plan.actions.findIndex(
      (/** @type {Readonly<AnyRecord>} */ action) =>
        action.resourceKey === 'network-subnet',
    );
    const intents = fixture.head.activeOperation.intents.map(
      (
        /** @type {Readonly<AnyRecord>} */ intent,
        /** @type {number} */ index,
      ) =>
        index === subnetIndex
          ? { ...intent, ownershipNonce: nonce(200) }
          : intent,
    );
    const driftedHead = replaceHeadIntents(fixture.head, intents);
    const driftedContext = { ...fixture.context, head: driftedHead };
    const client = makeClient(fixture);
    const drifted = makePorts(fixture, { client }).resource;

    await expect(drifted.executeAction(driftedContext)).rejects.toEqual(
      new AwsSingleNodeNodeResourceConflictError(),
    );
    for (const method of Object.values(client)) {
      if (typeof method === 'function') expect(method).not.toHaveBeenCalled();
    }

    const destroyFixture = makeFixture({ operation: 'destroy' });
    const instance = makeInstance(destroyFixture);
    const ownershipTag = instance.Tags.find(
      (tag) => tag.Key === 'wharfie:ownership-nonce',
    );
    if (ownershipTag === undefined) throw new Error('Missing ownership tag.');
    ownershipTag.Value = nonce(201);
    const destroyClient = makeClient(destroyFixture, { instance });
    const destroy = makePorts(destroyFixture, {
      client: destroyClient,
    }).resource;

    await expect(destroy.executeAction(destroyFixture.context)).rejects.toEqual(
      new AwsSingleNodeNodeResourceConflictError(),
    );
    expect(destroyClient.terminateInstances).not.toHaveBeenCalled();
  });

  it.each([
    [
      'root attachment volume identity',
      (
        /** @type {{instance: AnyRecord, rootVolume: AnyRecord}} */ evidence,
      ) => {
        evidence.rootVolume.Attachments[0].VolumeId = IDS.applicationVolume;
      },
    ],
    [
      'single-instance launch index',
      (
        /** @type {{instance: AnyRecord, rootVolume: AnyRecord}} */ evidence,
      ) => {
        evidence.instance.AmiLaunchIndex = 1;
      },
    ],
    [
      'non-negative instance state code',
      (
        /** @type {{instance: AnyRecord, rootVolume: AnyRecord}} */ evidence,
      ) => {
        evidence.instance.State = { Code: -240, Name: 'running' };
      },
    ],
    [
      'IPv4 address syntax',
      (
        /** @type {{instance: AnyRecord, rootVolume: AnyRecord}} */ evidence,
      ) => {
        const { instance } = evidence;
        const network = instance.NetworkInterfaces[0];
        const primary = network.PrivateIpAddresses[0];
        instance.PrivateIpAddress = 'not-an-ip';
        network.PrivateIpAddress = 'not-an-ip';
        primary.PrivateIpAddress = 'not-an-ip';
        instance.PublicIpAddress = 'also-not-an-ip';
        network.Association.PublicIp = 'also-not-an-ip';
        primary.Association.PublicIp = 'also-not-an-ip';
      },
    ],
  ])('blocks contradictory %s evidence', async (_name, mutateEvidence) => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const instance = makeInstance(fixture);
    const rootVolume = makeRootVolume(fixture);
    mutateEvidence({ instance, rootVolume });
    const { resource } = makePorts(fixture, {
      client: makeClient(fixture, { instance, rootVolume }),
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it.each([
    ['non-Amazon provenance', 'IpOwnerId', '123456789012'],
    ['elastic allocation identity', 'AllocationId', 'eipalloc-0000000000001'],
    ['elastic association identity', 'AssociationId', 'eipassoc-0000000000001'],
    ['carrier address', 'CarrierIp', '198.51.100.20'],
    ['customer-owned address', 'CustomerOwnedIp', '192.0.2.20'],
  ])('blocks public IPv4 association %s', async (_name, key, value) => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const instance = makeInstance(fixture);
    const association = /** @type {AnyRecord} */ (
      instance.NetworkInterfaces[0].Association
    );
    association[key] = value;
    const resource = makePorts(fixture, {
      client: makeClient(fixture, { instance }),
    }).resource;

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it.each([
    [
      'instance key name',
      (
        /** @type {{instance: AnyRecord, rootVolume: AnyRecord}} */ evidence,
      ) => {
        evidence.instance.KeyName = '';
      },
    ],
    [
      'public allocation identity',
      (
        /** @type {{instance: AnyRecord, rootVolume: AnyRecord}} */ evidence,
      ) => {
        evidence.instance.NetworkInterfaces[0].Association.AllocationId = '';
      },
    ],
    [
      'block mapping associated resource',
      (
        /** @type {{instance: AnyRecord, rootVolume: AnyRecord}} */ evidence,
      ) => {
        evidence.instance.BlockDeviceMappings[0].Ebs.AssociatedResource = '';
      },
    ],
    [
      'root source volume identity',
      (
        /** @type {{instance: AnyRecord, rootVolume: AnyRecord}} */ evidence,
      ) => {
        evidence.rootVolume.SourceVolumeId = '';
      },
    ],
    [
      'root attachment owning service',
      (
        /** @type {{instance: AnyRecord, rootVolume: AnyRecord}} */ evidence,
      ) => {
        evidence.rootVolume.Attachments[0].InstanceOwningService = '';
      },
    ],
  ])('does not treat empty-string %s as omission', async (_name, mutate) => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const instance = makeInstance(fixture);
    const rootVolume = makeRootVolume(fixture);
    mutate({ instance, rootVolume });
    const resource = makePorts(fixture, {
      client: makeClient(fixture, { instance, rootVolume }),
    }).resource;

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('blocks exact user-data drift and maps malformed provider envelopes to fixed unknown state', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const drifted = makePorts(fixture, {
      client: makeClient(fixture, {
        attributeOverrides: { userData: 'd3Jvbmc=' },
      }),
    }).resource;
    await expect(drifted.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });

    const malformedClient = {
      ...makeClient(fixture),
      describeInstances: jest.fn(async () => ({ Reservations: null })),
    };
    const malformed = makePorts(fixture, {
      client: malformedClient,
    }).resource;
    await expect(malformed.verifySettlement(fixture.context)).rejects.toEqual(
      new AwsSingleNodeNodeResourceUnknownError(),
    );
  });

  it('exports explicit bounds, fixed errors, and only frozen controller ports', () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const resource = createAwsSingleNodeNodeResource({
      client,
      providerScope: fixture.base.providerScope,
    });

    expect(AWS_SINGLE_NODE_NODE_DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(AWS_SINGLE_NODE_NODE_MAX_ATTEMPTS).toBe(10);
    expect(AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES).toBe(16);
    expect(AWS_SINGLE_NODE_NODE_DISCOVERY_MAX_RESULTS).toBe(1000);
    expect(Object.keys(resource).sort()).toEqual([
      'executeAction',
      'verifySettlement',
    ]);
    expect(Object.isFrozen(resource)).toBe(true);
    expect(new AwsSingleNodeNodeResourceConflictError()).toMatchObject({
      code: 'AWS_SINGLE_NODE_NODE_RESOURCE_CONFLICT',
    });
    expect(new AwsSingleNodeNodeResourceUnknownError()).toMatchObject({
      code: 'AWS_SINGLE_NODE_NODE_RESOURCE_UNKNOWN',
    });
    expect(() =>
      createAwsSingleNodeNodeResource({
        client,
        providerScope: fixture.base.providerScope,
        unsupported: true,
      }),
    ).toThrow(TypeError);
  });
});

describe('AWS single-node substrate read-only observation', () => {
  it.each([
    ['pending', 0, 'starting'],
    ['running', 16, 'degraded'],
    ['shutting-down', 32, 'failed'],
    ['terminated', 48, 'failed'],
    ['stopping', 64, 'stopped'],
    ['stopped', 80, 'stopped'],
  ])(
    'maps exact owned %s lifecycle without mutation',
    async (name, code, health) => {
      const fixture = makeBoundObservationFixture();
      const instance =
        name === 'stopped'
          ? makeStoppedInstance(fixture)
          : makeInstance(fixture, { State: { Name: name, Code: code } });
      const ports = makeObserverPorts(fixture, {
        client: makeClient(fixture, { instance }),
      });

      await expect(ports.observer.observe(fixture.authority)).resolves.toEqual({
        resourceKey: 'substrate',
        presence: 'present',
        ownership: 'verified',
        providerIdentity: {
          providerType: 'ec2-instance',
          providerResourceId: IDS.instance,
        },
        observedDigest: fixture.action.after.stateDigest,
        health,
        execution: 'none',
      });
      expect(
        ports.client.describeInstances.mock.calls.every(
          (/** @type {AnyRecord[]} */ [request]) =>
            Object.hasOwn(request, 'InstanceIds'),
        ),
      ).toBe(true);
    },
  );

  it('returns verified actual drift for an exact current create', async () => {
    const fixture = makeCurrentCreateObservationFixture();
    const ports = makeObserverPorts(fixture, {
      client: makeClient(fixture, {
        attributeOverrides: { userData: 'd3Jvbmc=' },
      }),
    });

    const observation = await ports.observer.observe(fixture.authority);

    expect(observation).toMatchObject({
      presence: 'present',
      ownership: 'verified',
      providerIdentity: {
        providerResourceId: IDS.instance,
      },
      health: 'degraded',
      execution: 'none',
    });
    expect(observation.observedDigest).not.toEqual(
      fixture.action.after.stateDigest,
    );
    expectDeepFrozen(observation);
  });

  it('recommends stable-token replay only after the full clean empty current-create window', async () => {
    const fixture = makeCurrentCreateObservationFixture();
    const ports = makeObserverPorts(fixture, {
      client: makeClient(fixture, { instance: null }),
    });

    await expect(ports.observer.observe(fixture.authority)).resolves.toEqual({
      resourceKey: 'substrate',
      presence: 'unknown',
      ownership: 'unknown',
      providerIdentity: null,
      observedDigest: null,
      health: 'unknown',
      execution: 'replay-safe-create',
    });
    expect(ports.client.describeInstances).toHaveBeenCalledTimes(2);
    expect(ports.client.describeVolumes).not.toHaveBeenCalled();
  });

  it('returns zero-I/O unknown for a legitimate partial upstream head', async () => {
    const fixture = makeFixture();
    const frontier = 2;
    const intents = fixture.plan.actions.map(
      (
        /** @type {Readonly<AnyRecord>} */ action,
        /** @type {number} */ index,
      ) => ({
        actionId: action.actionId,
        status:
          index < frontier
            ? 'settled'
            : index === frontier
              ? 'intended'
              : 'pending',
        ownershipNonce:
          fixture.head.activeOperation.intents[index].ownershipNonce,
      }),
    );
    const head = createDeploymentHead({
      deploymentInstanceId: fixture.base.deploymentInstanceId,
      providerScope: fixture.base.providerScope,
      incarnationId: fixture.base.incarnationId,
      generation: fixture.head.generation,
      phase: 'CONVERGING',
      settledDeploymentRevisionId: null,
      targetDeploymentRevisionId:
        fixture.base.deploymentRevision.deploymentRevisionId,
      resourceBindings: fixture.head.resourceBindings.slice(0, frontier),
      activeOperation: {
        kind: 'create',
        planId: fixture.plan.planId,
        status: 'running',
        nextActionIndex: frontier,
        intents,
      },
      lastOperation: null,
    });
    const partial = Object.freeze({
      ...fixture,
      head,
      authority: makeNodeObservationAuthority(fixture, head),
    });
    const ports = makeObserverPorts(partial);

    await expect(ports.observer.observe(partial.authority)).resolves.toEqual({
      resourceKey: 'substrate',
      presence: 'unknown',
      ownership: 'unknown',
      providerIdentity: null,
      observedDigest: null,
      health: 'unknown',
      execution: 'none',
    });
    expect(ports.client.describeInstances).not.toHaveBeenCalled();
    expect(ports.client.describeVolumes).not.toHaveBeenCalled();
  });

  it('rejects a forged partial binding receipt before any provider I/O', async () => {
    const fixture = makeFixture();
    const frontier = 1;
    const artifactAction = fixture.plan.actions[0];
    const forgedArtifact = makeBinding(
      fixture.base,
      artifactAction,
      fixture.head.activeOperation.intents[0].ownershipNonce,
      [],
      semanticId('wda3', 'wharfie:test:forged-action:v1', {
        resourceKey: 'artifact',
      }),
    );
    const intents = fixture.plan.actions.map(
      (
        /** @type {Readonly<AnyRecord>} */ action,
        /** @type {number} */ index,
      ) => ({
        actionId: action.actionId,
        status:
          index < frontier
            ? 'settled'
            : index === frontier
              ? 'intended'
              : 'pending',
        ownershipNonce:
          fixture.head.activeOperation.intents[index].ownershipNonce,
      }),
    );
    const head = createDeploymentHead({
      deploymentInstanceId: fixture.base.deploymentInstanceId,
      providerScope: fixture.base.providerScope,
      incarnationId: fixture.base.incarnationId,
      generation: fixture.head.generation,
      phase: 'CONVERGING',
      settledDeploymentRevisionId: null,
      targetDeploymentRevisionId:
        fixture.base.deploymentRevision.deploymentRevisionId,
      resourceBindings: [forgedArtifact],
      activeOperation: {
        kind: 'create',
        planId: fixture.plan.planId,
        status: 'running',
        nextActionIndex: frontier,
        intents,
      },
      lastOperation: null,
    });
    const partial = Object.freeze({
      ...fixture,
      head,
      authority: makeNodeObservationAuthority(fixture, head),
    });
    const ports = makeObserverPorts(partial);

    await expect(
      ports.observer.observe(partial.authority),
    ).rejects.toBeInstanceOf(AwsSingleNodeNodeResourceObserverAuthorityError);
    expect(ports.client.describeInstances).not.toHaveBeenCalled();
    expect(ports.client.describeVolumes).not.toHaveBeenCalled();
  });

  it('returns candidate-known conflict for exact ownership drift and page-local collision evidence', async () => {
    const bound = makeBoundObservationFixture();
    const wrongTags = makeInstance(bound, {
      Tags: tagArray({
        ...expectedTags(bound),
        'wharfie:ownership-nonce': nonce(1),
      }),
    });
    const boundPorts = makeObserverPorts(bound, {
      client: makeClient(bound, { instance: wrongTags }),
    });
    await expect(
      boundPorts.observer.observe(bound.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      providerIdentity: { providerResourceId: IDS.instance },
    });

    const creating = makeCurrentCreateObservationFixture();
    const collision = makeInstance(creating, {
      ClientToken: 'wrong-token',
    });
    const baseClient = makeClient(creating);
    const describeInstances = jest.fn(async () => ({
      Reservations: [
        {
          OwnerId: creating.base.providerScope.accountId,
          Instances: [collision],
        },
      ],
      NextToken: 'later-page',
    }));
    const collisionPorts = makeObserverPorts(creating, {
      client: {
        ...baseClient,
        describeInstances,
      },
    });
    await expect(
      collisionPorts.observer.observe(creating.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      providerIdentity: { providerResourceId: IDS.instance },
    });
    expect(describeInstances).toHaveBeenCalledTimes(1);
  });

  it('makes same-page instance cardinality conflict outrank malformed candidate evidence', async () => {
    const fixture = makeCurrentCreateObservationFixture();
    const malformed = makeInstance(fixture, {
      InstanceId: 'i-00000000000000002',
      Tags: 'malformed',
    });
    const contradictory = makeInstance(fixture, {
      InstanceId: 'i-00000000000000003',
      ClientToken: 'wrong-token',
    });
    const baseClient = makeClient(fixture);
    const describeInstances = jest.fn(async () => ({
      Reservations: [
        {
          OwnerId: fixture.base.providerScope.accountId,
          Instances: [malformed, contradictory],
        },
      ],
    }));
    const ports = makeObserverPorts(fixture, {
      client: { ...baseClient, describeInstances },
    });

    await expect(
      ports.observer.observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      providerIdentity: {
        providerResourceId: 'i-00000000000000002',
      },
    });
    expect(describeInstances).toHaveBeenCalledTimes(1);
  });

  it('ranks fulfilled conclusive conflicts over concurrent unknown reads', async () => {
    const fixture = makeBoundObservationFixture();
    const baseClient = makeClient(fixture);
    const client = {
      ...baseClient,
      describeInstanceAttribute: jest.fn(
        async (/** @type {AnyRecord} */ request) => {
          if (request.Attribute === 'userData') {
            throw providerError('ServiceUnavailable');
          }
          return makeAttributeResponse(fixture, request.Attribute);
        },
      ),
      describeInstanceCreditSpecifications: jest.fn(async () => ({
        InstanceCreditSpecifications: [
          { InstanceId: IDS.instance, CpuCredits: 'standard' },
        ],
        NextToken: 'contradictory-page',
      })),
    };
    const ports = makeObserverPorts(fixture, { client });

    await expect(
      ports.observer.observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      providerIdentity: { providerResourceId: IDS.instance },
    });
  });

  it('ranks a fulfilled credit conflict over malformed static instance evidence', async () => {
    const fixture = makeBoundObservationFixture();
    const malformed = makeInstance(fixture, {
      CapacityReservationSpecification: {
        CapacityReservationPreference: 'none',
        CapacityReservationTarget: { CapacityReservationId: '' },
      },
    });
    const baseClient = makeClient(fixture, { instance: malformed });
    const client = {
      ...baseClient,
      describeInstanceCreditSpecifications: jest.fn(async () => ({
        InstanceCreditSpecifications: [
          { InstanceId: IDS.instance, CpuCredits: 'standard' },
        ],
        NextToken: 'contradictory-page',
      })),
    };
    const ports = makeObserverPorts(fixture, { client });

    await expect(
      ports.observer.observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      providerIdentity: { providerResourceId: IDS.instance },
    });
    expect(client.describeVolumes).toHaveBeenCalled();
  });

  it('uses the settled ownership receipt when destroy before-state has readable drift', async () => {
    const fixture = makeDeleteObservationFixture({
      substrateBeforeStateDigest: digest('destroy-observed-drift'),
    });
    const settledNode = fixture.settledPlan.actions.find(
      (/** @type {Readonly<AnyRecord>} */ candidate) =>
        candidate.resourceKey === 'substrate',
    );
    expect(fixture.action.before.stateDigest).not.toEqual(
      settledNode.after.stateDigest,
    );
    const ports = makeObserverPorts(fixture);

    await expect(
      ports.observer.observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'verified',
      providerIdentity: { providerResourceId: IDS.instance },
    });
  });

  it('accepts the creation ownership provenance carried by a later settled noop receipt', async () => {
    const fixture = makeSettledNoopObservationFixture();
    expect(fixture.action.action).toBe('noop');
    expect(fixture.priorBinding.createdByActionId).not.toBe(
      fixture.action.actionId,
    );
    const ports = makeObserverPorts(fixture);

    await expect(
      ports.observer.observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'verified',
      providerIdentity: { providerResourceId: IDS.instance },
    });
  });

  it('requires the identical full-window joint negative before deleting an aged-out binding', async () => {
    const fixture = makeDeleteObservationFixture();
    const ports = makeObserverPorts(fixture, {
      client: makeClient(fixture, {
        exactError: providerError('InvalidInstanceID.NotFound'),
        discovery: [],
        rootExact: null,
        rootDiscovery: [],
      }),
    });

    await expect(ports.observer.observe(fixture.authority)).resolves.toEqual({
      resourceKey: 'substrate',
      presence: 'absent',
      ownership: 'missing',
      providerIdentity: null,
      observedDigest: null,
      health: 'absent',
      execution: 'none',
    });
    expect(ports.waitForRetry).toHaveBeenCalledTimes(1);
    expect(ports.client.describeInstances).toHaveBeenCalledTimes(4);
    expect(ports.client.describeVolumes).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['typed root absence', null, null],
    ['rootless terminal tombstone', undefined, null],
    ['exact deleted root tombstone', 'deleted', []],
  ])(
    'accepts exact terminated instance proof with %s',
    async (_name, rootState, attachments) => {
      const fixture = makeDeleteObservationFixture();
      const instance = makeInstance(fixture, {
        State: { Name: 'terminated', Code: 48 },
        ...(rootState === undefined ? { BlockDeviceMappings: undefined } : {}),
      });
      const rootVolume =
        rootState === 'deleted'
          ? makeRootVolume(fixture, {
              State: 'deleted',
              Attachments: attachments,
            })
          : null;
      const ports = makeObserverPorts(fixture, {
        client: makeClient(fixture, {
          instance,
          rootExact: rootVolume,
          rootDiscovery: [],
          ...(rootState === null
            ? {
                rootExactError: providerError('InvalidVolume.NotFound'),
              }
            : {}),
        }),
      });

      await expect(
        ports.observer.observe(fixture.authority),
      ).resolves.toMatchObject({
        presence: 'absent',
        ownership: 'missing',
        health: 'absent',
      });
    },
  );

  it('accepts an owned unattached deleted root tombstone with readable intrinsic drift', async () => {
    const fixture = makeDeleteObservationFixture();
    const instance = makeInstance(fixture, {
      State: { Name: 'terminated', Code: 48 },
    });
    const rootVolume = makeRootVolume(fixture, {
      State: 'deleted',
      Attachments: [],
      Size: fixture.base.providerSpec.node.rootVolume.sizeGiB + 8,
    });
    const ports = makeObserverPorts(fixture, {
      client: makeClient(fixture, {
        instance,
        rootExact: rootVolume,
        rootDiscovery: [],
      }),
    });

    await expect(
      ports.observer.observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'absent',
      ownership: 'missing',
      health: 'absent',
    });
  });

  it('never treats shutting-down or a deleting root as terminal absence', async () => {
    const fixture = makeDeleteObservationFixture();
    const shuttingDownPorts = makeObserverPorts(fixture, {
      client: makeClient(fixture, {
        instance: makeInstance(fixture, {
          State: { Name: 'shutting-down', Code: 32 },
        }),
      }),
    });
    await expect(
      shuttingDownPorts.observer.observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'unknown',
      ownership: 'unknown',
      health: 'unknown',
    });
    expect(
      shuttingDownPorts.client.describeInstanceAttribute,
    ).not.toHaveBeenCalled();

    const deletingRoot = makeRootVolume(fixture, { State: 'deleting' });
    const deleting = makeObserverPorts(fixture, {
      client: makeClient(fixture, {
        instance: makeInstance(fixture, {
          State: { Name: 'terminated', Code: 48 },
        }),
        rootExact: deletingRoot,
        rootDiscovery: [],
      }),
    }).observer;
    await expect(deleting.observe(fixture.authority)).resolves.toMatchObject({
      presence: 'unknown',
      ownership: 'unknown',
      health: 'unknown',
    });
  });

  it('reports a different owned root locator as conflict after exact root absence', async () => {
    const fixture = makeDeleteObservationFixture();
    const differentRoot = makeRootVolume(fixture, {
      VolumeId: 'vol-00000000000000009',
      Attachments: [
        {
          ...makeRootVolume(fixture).Attachments[0],
          VolumeId: 'vol-00000000000000009',
        },
      ],
    });
    const ports = makeObserverPorts(fixture, {
      client: makeClient(fixture, {
        instance: makeInstance(fixture, {
          State: { Name: 'terminated', Code: 48 },
        }),
        rootExact: null,
        rootDiscovery: [differentRoot],
        rootExactError: providerError('InvalidVolume.NotFound'),
      }),
    });

    await expect(
      ports.observer.observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      providerIdentity: { providerResourceId: IDS.instance },
    });
  });

  it('makes same-page root cardinality conflict outrank malformed root tags', async () => {
    const fixture = makeDeleteObservationFixture();
    const malformedRoot = makeRootVolume(fixture, {
      VolumeId: 'vol-00000000000000009',
      Tags: 'malformed',
      Attachments: [],
    });
    const contradictoryRoot = makeRootVolume(fixture, {
      VolumeId: 'vol-0000000000000000a',
      Attachments: [],
    });
    const ports = makeObserverPorts(fixture, {
      client: makeClient(fixture, {
        instance: makeInstance(fixture, {
          State: { Name: 'terminated', Code: 48 },
        }),
        rootExactError: providerError('InvalidVolume.NotFound'),
        rootDiscovery: [malformedRoot, contradictoryRoot],
      }),
    });

    await expect(
      ports.observer.observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      providerIdentity: { providerResourceId: IDS.instance },
    });
  });

  it('keeps a current-create instance candidate when exact root identity conflicts', async () => {
    const fixture = makeCurrentCreateObservationFixture();
    const wrongRoot = makeRootVolume(fixture, {
      VolumeId: 'vol-00000000000000009',
      Attachments: [
        {
          ...makeRootVolume(fixture).Attachments[0],
          VolumeId: 'vol-00000000000000009',
        },
      ],
    });
    const ports = makeObserverPorts(fixture, {
      client: makeClient(fixture, { rootExact: wrongRoot }),
    });

    await expect(
      ports.observer.observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      providerIdentity: { providerResourceId: IDS.instance },
    });
  });

  it('does not conclude delete absence when the negative-window wait fails', async () => {
    const fixture = makeDeleteObservationFixture();
    const waitForRetry = jest.fn(async () => {
      throw new Error('cancelled');
    });
    const ports = makeObserverPorts(fixture, {
      client: makeClient(fixture, {
        exactError: providerError('InvalidInstanceID.NotFound'),
        discovery: [],
        rootExact: null,
        rootDiscovery: [],
      }),
      waitForRetry,
    });

    await expect(
      ports.observer.observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'unknown',
      ownership: 'unknown',
      execution: 'none',
    });
    expect(waitForRetry).toHaveBeenCalledTimes(1);
  });

  it('exposes only a frozen observe port and preserves the two-attempt floor', () => {
    const fixture = makeCurrentCreateObservationFixture();
    const client = makeClient(fixture);
    const observer = makeObserverPorts(fixture, { client }).observer;

    expect(Object.keys(observer)).toEqual(['observe']);
    expect(Object.isFrozen(observer)).toBe(true);
    expect(() =>
      createAwsSingleNodeNodeResourceObserver({
        client: {
          describeInstances: client.describeInstances,
          describeInstanceAttribute: client.describeInstanceAttribute,
          describeInstanceCreditSpecifications:
            client.describeInstanceCreditSpecifications,
          describeVolumes: client.describeVolumes,
        },
        providerScope: fixture.base.providerScope,
        maxAttempts: 1,
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeNodeResourceObserver({
        client,
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(TypeError);
  });
});
