import { describe, expect, it, jest } from '@jest/globals';

import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
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
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { getAwsSingleNodeRouteTableStateDigest } from '../../src/core/runtime/deployment-aws-route-table-resource.js';
import {
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_PREFIX,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_STATE_DIGEST_DOMAIN,
  AwsSingleNodeSubnetRouteTableAssociationResourceConflictError,
  AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError,
  createAwsSingleNodeSubnetRouteTableAssociationResource,
  getAwsSingleNodeSubnetRouteTableAssociationStateDigest,
} from '../../src/core/runtime/deployment-aws-subnet-route-table-association-resource.js';
import { getAwsSingleNodeSubnetStateDigest } from '../../src/core/runtime/deployment-aws-subnet-resource.js';
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

const VPC_IDS = Object.freeze({
  primary: 'vpc-00000000000000001',
  other: 'vpc-00000000000000002',
});
const INTERNET_GATEWAY_ID = 'igw-00000000000000001';
const SUBNET_IDS = Object.freeze({
  primary: 'subnet-00000000000000001',
  other: 'subnet-00000000000000002',
});
const ROUTE_TABLE_IDS = Object.freeze({
  primary: 'rtb-00000000000000001',
  other: 'rtb-00000000000000002',
});
const ASSOCIATION_IDS = Object.freeze({
  primary: 'rtbassoc-00000000000000001',
  other: 'rtbassoc-00000000000000002',
});
const VPC_CIDR = '10.42.0.0/16';
const SUBNET_CIDR = '10.42.0.0/24';
const DEFAULT_IPV4_CIDR = '0.0.0.0/0';
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

/** @param {string} routeTableId @param {string} subnetId @returns {string} */
function associationProviderResourceId(routeTableId, subnetId) {
  return createCanonicalJsonSha256Id({
    prefix:
      AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_PREFIX,
    domain:
      AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_DOMAIN,
    value: { routeTableId, subnetId },
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
    placement: { availabilityZoneId: AVAILABILITY_ZONE_ID },
    storage: {
      ebsKmsKeyArn:
        'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    },
    bootstrapDigest: digest('subnet route-table association bootstrap'),
    runtimeIdentityPolicyDigest: digest(
      'subnet route-table association runtime identity policy',
    ),
  });
}

/** @param {{imageId?: string}} [options] @returns {Readonly<Record<string, any>>} */
function makeBase(options = {}) {
  const profile = validateDeploymentProfile(
    createDeploymentProfile({
      profile: { id: 'production' },
      appId: 'subnet-route-table-association-resource-test',
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
      'wharfie:test:subnet-route-table-association-revision:v1',
      { revision: 1 },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'subnet route-table association resource artifact',
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
    return INTERNET_GATEWAY_ID;
  }
  if (definition.resourceKey === 'network-internet-gateway-attachment') {
    return attachmentProviderResourceId(INTERNET_GATEWAY_ID, VPC_IDS.primary);
  }
  if (definition.resourceKey === 'network-subnet') return SUBNET_IDS.primary;
  if (definition.resourceKey === 'network-route-table') {
    return ROUTE_TABLE_IDS.primary;
  }
  if (definition.resourceKey === 'network-default-ipv4-route') {
    return defaultRouteProviderResourceId(
      INTERNET_GATEWAY_ID,
      ROUTE_TABLE_IDS.primary,
    );
  }
  if (definition.resourceKey === 'network-subnet-route-table-association') {
    return associationProviderResourceId(
      ROUTE_TABLE_IDS.primary,
      SUBNET_IDS.primary,
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
  let stateDigest;
  if (definition.resourceKey === 'network-vpc') {
    stateDigest = getAwsSingleNodeVpcStateDigest(base.providerSpec);
  } else if (definition.resourceKey === 'network-internet-gateway') {
    stateDigest = getAwsSingleNodeInternetGatewayStateDigest(base.providerSpec);
  } else if (definition.resourceKey === 'network-internet-gateway-attachment') {
    stateDigest = getAwsSingleNodeInternetGatewayAttachmentStateDigest(
      base.providerSpec,
    );
  } else if (definition.resourceKey === 'network-subnet') {
    stateDigest = getAwsSingleNodeSubnetStateDigest(base.providerSpec);
  } else if (definition.resourceKey === 'network-route-table') {
    stateDigest = getAwsSingleNodeRouteTableStateDigest(base.providerSpec);
  } else if (definition.resourceKey === 'network-default-ipv4-route') {
    stateDigest = getAwsSingleNodeDefaultIpv4RouteStateDigest(
      base.providerSpec,
    );
  } else if (
    definition.resourceKey === 'network-subnet-route-table-association'
  ) {
    stateDigest = getAwsSingleNodeSubnetRouteTableAssociationStateDigest(
      base.providerSpec,
    );
  } else {
    stateDigest = digest(`${definition.resourceKey} desired`);
  }
  return {
    providerType: definition.providerType,
    providerResourceId: null,
    stateDigest,
  };
}

/** @param {Readonly<Record<string, any>>} base @param {'apply'|'reconcile'|'destroy'} operation @param {{observedStateDigest?: Readonly<Record<string, any>>, wrongDependencyDigestResourceKey?: string}} [options] */
function makePlan(base, operation, options = {}) {
  const definitions =
    operation === 'destroy'
      ? [...AWS_SINGLE_NODE_RESOURCE_GRAPH.resources].reverse()
      : AWS_SINGLE_NODE_RESOURCE_GRAPH.resources;
  const actions = definitions.map(
    (/** @type {Readonly<AnyRecord>} */ definition) => {
      const desired = desiredState(base, definition);
      if (definition.resourceKey === options.wrongDependencyDigestResourceKey) {
        desired.stateDigest = digest(
          `wrong ${definition.resourceKey} dependency state`,
        );
      }
      const existing = {
        ...desired,
        providerResourceId: providerResourceId(definition),
        ...(definition.resourceKey ===
          'network-subnet-route-table-association' &&
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
          'wharfie:test:subnet-route-table-association-inspection:v1',
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
      ),
    providerType: action.before?.providerType ?? action.after.providerType,
    providerResourceId: options.providerResourceId,
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce: options.ownershipNonce,
    createdByActionId: options.createdByActionId,
  });
}

/** @param {{operation?: 'apply'|'reconcile'|'destroy', observedStateDigest?: Readonly<Record<string, any>>, ownershipNonceByte?: number, wrongDependencyDigestResourceKey?: string}} [options] */
function makeFixture(options = {}) {
  const operation = options.operation ?? 'apply';
  const base = makeBase();
  const plan = makePlan(base, operation, options);
  const indexOf = (/** @type {string} */ resourceKey) =>
    plan.actions.findIndex(
      (/** @type {Readonly<AnyRecord>} */ candidate) =>
        candidate.resourceKey === resourceKey,
    );
  const actionIndex = indexOf('network-subnet-route-table-association');
  const action = plan.actions[actionIndex];
  const indices = Object.freeze({
    vpc: indexOf('network-vpc'),
    internetGateway: indexOf('network-internet-gateway'),
    attachment: indexOf('network-internet-gateway-attachment'),
    subnet: indexOf('network-subnet'),
    routeTable: indexOf('network-route-table'),
    defaultRoute: indexOf('network-default-ipv4-route'),
  });
  const actions = Object.freeze({
    vpc: plan.actions[indices.vpc],
    internetGateway: plan.actions[indices.internetGateway],
    attachment: plan.actions[indices.attachment],
    subnet: plan.actions[indices.subnet],
    routeTable: plan.actions[indices.routeTable],
    defaultRoute: plan.actions[indices.defaultRoute],
  });
  if (
    action === undefined ||
    Object.values(actions).some((candidate) => candidate === undefined)
  ) {
    throw new Error('Missing subnet route-table association dependencies.');
  }
  const ownershipNonce = nonce(options.ownershipNonceByte ?? 89);
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
          'wharfie:test:subnet-route-table-association-dependency-create-action:v1',
          { resourceKey: candidate.resourceKey },
        );
  const vpcBinding = makeBinding(base, actions.vpc, {
    dependencies: [],
    providerResourceId: VPC_IDS.primary,
    ownershipNonce: intentNonces[indices.vpc],
    createdByActionId: dependencyReceipt(actions.vpc),
  });
  const internetGatewayBinding = makeBinding(base, actions.internetGateway, {
    dependencies: [],
    providerResourceId: INTERNET_GATEWAY_ID,
    ownershipNonce: intentNonces[indices.internetGateway],
    createdByActionId: dependencyReceipt(actions.internetGateway),
  });
  const attachmentBinding = makeBinding(base, actions.attachment, {
    dependencies: [vpcBinding, internetGatewayBinding],
    providerResourceId: attachmentProviderResourceId(
      INTERNET_GATEWAY_ID,
      VPC_IDS.primary,
    ),
    ownershipNonce: intentNonces[indices.attachment],
    createdByActionId: dependencyReceipt(actions.attachment),
  });
  const subnetBinding = makeBinding(base, actions.subnet, {
    dependencies: [vpcBinding],
    providerResourceId: SUBNET_IDS.primary,
    ownershipNonce: intentNonces[indices.subnet],
    createdByActionId: dependencyReceipt(actions.subnet),
  });
  const routeTableBinding = makeBinding(base, actions.routeTable, {
    dependencies: [vpcBinding],
    providerResourceId: ROUTE_TABLE_IDS.primary,
    ownershipNonce: intentNonces[indices.routeTable],
    createdByActionId: dependencyReceipt(actions.routeTable),
  });
  const defaultRouteBinding = makeBinding(base, actions.defaultRoute, {
    dependencies: [attachmentBinding, routeTableBinding],
    providerResourceId: defaultRouteProviderResourceId(
      INTERNET_GATEWAY_ID,
      ROUTE_TABLE_IDS.primary,
    ),
    ownershipNonce: intentNonces[indices.defaultRoute],
    createdByActionId: dependencyReceipt(actions.defaultRoute),
  });
  const directDependencies = [
    subnetBinding,
    routeTableBinding,
    defaultRouteBinding,
  ];
  const priorBinding =
    action.action === 'create'
      ? null
      : makeBinding(base, action, {
          dependencies: directDependencies,
          providerResourceId: associationProviderResourceId(
            ROUTE_TABLE_IDS.primary,
            SUBNET_IDS.primary,
          ),
          ownershipNonce,
          createdByActionId: semanticId(
            'wda3',
            'wharfie:test:subnet-route-table-association-create-action:v1',
            { resourceKey: action.resourceKey },
          ),
        });
  const resourceBindings = [
    vpcBinding,
    internetGatewayBinding,
    attachmentBinding,
    subnetBinding,
    routeTableBinding,
    defaultRouteBinding,
    ...(priorBinding === null ? [] : [priorBinding]),
  ];
  /** @type {AnyRecord|null} */
  let lastOperation = null;
  if (operation !== 'apply') {
    if (priorBinding === null) {
      throw new Error('Missing existing association binding.');
    }
    lastOperation = {
      kind: 'create',
      planId: semanticId(
        'wpl3',
        'wharfie:test:subnet-route-table-association-last-plan:v1',
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
    indices,
    actions,
    vpcBinding,
    internetGatewayBinding,
    attachmentBinding,
    subnetBinding,
    routeTableBinding,
    defaultRouteBinding,
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

/** @param {ReturnType<typeof makeFixture>} fixture @param {'subnet'|'routeTable'} kind */
function expectedTags(fixture, kind) {
  const binding =
    kind === 'subnet' ? fixture.subnetBinding : fixture.routeTableBinding;
  const action =
    kind === 'subnet' ? fixture.actions.subnet : fixture.actions.routeTable;
  const stateDigest = action.before?.stateDigest ?? action.after?.stateDigest;
  if (
    stateDigest === undefined ||
    typeof binding.createdByActionId !== 'string' ||
    typeof binding.ownershipNonce !== 'string'
  ) {
    throw new Error('Missing parent receipt metadata.');
  }
  return {
    'wharfie:managed-by': 'wharfie',
    'wharfie:resource-kind': `single-node-${kind === 'subnet' ? 'subnet' : 'route-table'}`,
    'wharfie:retention': 'purge',
    'wharfie:schema-version': '2',
    'wharfie:capability': 'networking',
    'wharfie:role': kind === 'subnet' ? 'subnet' : 'route-table',
    'wharfie:provider-scope-id': fixture.base.providerScope.providerScopeId,
    'wharfie:deployment-instance-id': fixture.base.deploymentInstanceId,
    'wharfie:incarnation-id': fixture.base.incarnationId,
    'wharfie:resource-key':
      kind === 'subnet' ? 'network-subnet' : 'network-route-table',
    'wharfie:created-by-action-id': binding.createdByActionId,
    'wharfie:ownership-nonce': binding.ownershipNonce,
    'wharfie:state-digest': stateDigest.value,
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
    SubnetId: fixture.subnetBinding.providerResourceId,
    Tags: tagArray(expectedTags(fixture, 'subnet')),
    VpcId: fixture.vpcBinding.providerResourceId,
    ...overrides,
  };
}

/** @param {Record<string, any>} [overrides] */
function makeAssociation(overrides = {}) {
  return {
    AssociationState: { State: 'associated' },
    Main: false,
    RouteTableAssociationId: ASSOCIATION_IDS.primary,
    RouteTableId: ROUTE_TABLE_IDS.primary,
    SubnetId: SUBNET_IDS.primary,
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function makeRouteTable(fixture, overrides = {}) {
  return {
    Associations: [makeAssociation()],
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
      {
        DestinationCidrBlock: DEFAULT_IPV4_CIDR,
        GatewayId: INTERNET_GATEWAY_ID,
        Origin: 'CreateRoute',
        State: 'active',
      },
    ],
    Tags: tagArray(expectedTags(fixture, 'routeTable')),
    VpcId: fixture.vpcBinding.providerResourceId,
    ...overrides,
  };
}

/** @param {Readonly<Record<string, any>>} request @returns {'exact'|'slot'} */
function routeTableRequestKind(request) {
  return request.RouteTableIds ? 'exact' : 'slot';
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makeClient(fixture, options = {}) {
  const subnet = options.subnet ?? makeSubnet(fixture);
  const exactRouteTable = options.exactRouteTable ?? makeRouteTable(fixture);
  const slotRouteTables = options.slotRouteTables ?? [exactRouteTable];
  return Object.freeze({
    associateRouteTable:
      options.associateRouteTable ??
      jest.fn(async () => ({
        AssociationId: ASSOCIATION_IDS.primary,
        AssociationState: { State: 'associated' },
      })),
    describeRouteTables:
      options.describeRouteTables ??
      jest.fn(async (/** @type {AnyRecord} */ input) => ({
        RouteTables:
          routeTableRequestKind(input) === 'exact'
            ? [exactRouteTable]
            : slotRouteTables,
      })),
    describeSubnets:
      options.describeSubnets ?? jest.fn(async () => ({ Subnets: [subnet] })),
    disassociateRouteTable:
      options.disassociateRouteTable ?? jest.fn(async () => ({})),
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makePorts(fixture, options = {}) {
  const client = options.client ?? makeClient(fixture, options);
  const waitForRetry = options.waitForRetry ?? jest.fn();
  return {
    client,
    waitForRetry,
    resource: createAwsSingleNodeSubnetRouteTableAssociationResource({
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

describe('AWS single-node subnet route-table association identities', () => {
  it('derives the exact frozen relationship digest without dynamic IDs', () => {
    const base = makeBase();
    const observed = getAwsSingleNodeSubnetRouteTableAssociationStateDigest(
      base.providerSpec,
    );
    const descriptor = sortCanonicalJsonValue({
      schemaVersion: 1,
      kind: 'awsSingleNodeEc2SubnetRouteTableAssociationState',
      associationType: 'explicit-subnet',
      main: false,
      state: 'associated',
      onDestroy: 'purge',
    });

    expect(
      AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_STATE_DIGEST_DOMAIN,
    ).toBe(
      'wharfie:aws-single-node-ec2-subnet-route-table-association-state:v1',
    );
    expect(observed).toEqual({
      algorithm: 'sha256',
      value: sha256Base64Url(
        `${AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
          descriptor,
        )}`,
      ),
    });
    expect(JSON.stringify(observed)).not.toContain(SUBNET_IDS.primary);
    expect(JSON.stringify(observed)).not.toContain(ROUTE_TABLE_IDS.primary);
    expect(JSON.stringify(observed)).not.toContain(ASSOCIATION_IDS.primary);
    expectDeepFrozen(observed);
  });

  it('rejects noncanonical provider specs and ignores unrelated image selection', () => {
    expect(() =>
      getAwsSingleNodeSubnetRouteTableAssociationStateDigest({}),
    ).toThrow(TypeError);
    const base = makeBase();
    const changed = JSON.parse(JSON.stringify(base.providerSpec));
    changed.capabilities.networking.subnetCidr = '10.42.1.0/24';
    expect(() =>
      getAwsSingleNodeSubnetRouteTableAssociationStateDigest(changed),
    ).toThrow(TypeError);
    const otherImage = makeBase({ imageId: 'ami-0fedcba9876543210' });
    expect(
      getAwsSingleNodeSubnetRouteTableAssociationStateDigest(
        otherImage.providerSpec,
      ),
    ).toEqual(
      getAwsSingleNodeSubnetRouteTableAssociationStateDigest(base.providerSpec),
    );
  });

  it('uses one collision-free synthetic endpoint-pair provider identity', () => {
    const observed = associationProviderResourceId(
      ROUTE_TABLE_IDS.primary,
      SUBNET_IDS.primary,
    );
    expect(
      AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_PREFIX,
    ).toBe('wsa1');
    expect(
      AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_PROVIDER_RESOURCE_ID_DOMAIN,
    ).toBe('wharfie:aws-single-node-ec2-subnet-route-table-association:v1');
    expect(observed).toBe(
      createCanonicalJsonSha256Id({
        prefix: 'wsa1',
        domain: 'wharfie:aws-single-node-ec2-subnet-route-table-association:v1',
        value: {
          routeTableId: ROUTE_TABLE_IDS.primary,
          subnetId: SUBNET_IDS.primary,
        },
      }),
    );
    expect(observed).not.toBe(
      associationProviderResourceId(ROUTE_TABLE_IDS.other, SUBNET_IDS.primary),
    );
    expect(observed).not.toBe(
      associationProviderResourceId(ROUTE_TABLE_IDS.primary, SUBNET_IDS.other),
    );
    expect(observed).not.toContain('rtbassoc-');
  });
});

describe('AWS single-node subnet route-table association create and recovery', () => {
  it('associates only after exact parents and the complete natural subnet slot prove explicit absence', async () => {
    const fixture = makeFixture();
    const exactRouteTable = makeRouteTable(fixture, { Associations: [] });
    const client = makeClient(fixture, {
      exactRouteTable,
      slotRouteTables: [],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();

    expect(client.describeSubnets).toHaveBeenCalledTimes(1);
    expect(client.describeSubnets).toHaveBeenCalledWith({
      SubnetIds: [SUBNET_IDS.primary],
    });
    expect(client.describeRouteTables).toHaveBeenCalledTimes(2);
    expect(client.describeRouteTables.mock.calls).toEqual(
      expect.arrayContaining([
        [{ RouteTableIds: [ROUTE_TABLE_IDS.primary] }],
        [
          {
            Filters: [
              {
                Name: 'association.subnet-id',
                Values: [SUBNET_IDS.primary],
              },
            ],
            MaxResults:
              AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DISCOVERY_MAX_RESULTS,
          },
        ],
      ]),
    );
    for (const [request] of client.describeRouteTables.mock.calls) {
      expectDeepFrozen(request);
    }
    expectDeepFrozen(client.describeSubnets.mock.calls[0][0]);
    expect(client.associateRouteTable).toHaveBeenCalledTimes(1);
    expect(client.associateRouteTable).toHaveBeenCalledWith({
      RouteTableId: ROUTE_TABLE_IDS.primary,
      SubnetId: SUBNET_IDS.primary,
    });
    expectDeepFrozen(client.associateRouteTable.mock.calls[0][0]);
    expect(client.disassociateRouteTable).not.toHaveBeenCalled();
  });

  it('treats implicit main routing as explicit-association absence', async () => {
    const fixture = makeFixture();
    const exactRouteTable = makeRouteTable(fixture, { Associations: [] });
    const client = makeClient(fixture, {
      exactRouteTable,
      slotRouteTables: [],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(client.associateRouteTable).not.toHaveBeenCalled();
  });

  it('does not mutate an already-present agreed relationship and returns a frozen synthetic binding', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    const settlement = await resource.verifySettlement(fixture.context);

    expect(client.associateRouteTable).not.toHaveBeenCalled();
    expect(client.disassociateRouteTable).not.toHaveBeenCalled();
    expect(settlement).toEqual({
      status: 'converged',
      binding: createDeploymentResourceBinding({
        schemaVersion: 2,
        kind: 'deploymentResourceBinding',
        deploymentInstanceId: fixture.base.deploymentInstanceId,
        incarnationId: fixture.base.incarnationId,
        resourceKey: 'network-subnet-route-table-association',
        capability: { kind: 'networking', version: 1 },
        role: { kind: 'subnet-route-table-association', version: 1 },
        management: 'managed',
        ownershipMode: 'derived',
        onDestroy: 'purge',
        dependencyBindings: [
          {
            resourceKey: 'network-default-ipv4-route',
            bindingId: fixture.defaultRouteBinding.bindingId,
          },
          {
            resourceKey: 'network-route-table',
            bindingId: fixture.routeTableBinding.bindingId,
          },
          {
            resourceKey: 'network-subnet',
            bindingId: fixture.subnetBinding.bindingId,
          },
        ],
        providerType: 'ec2-subnet-route-table-association',
        providerResourceId: associationProviderResourceId(
          ROUTE_TABLE_IDS.primary,
          SUBNET_IDS.primary,
        ),
        providerScopeId: fixture.base.providerScope.providerScopeId,
        ownershipNonce: fixture.ownershipNonce,
        createdByActionId: fixture.action.actionId,
      }),
    });
    expect(settlement.binding.providerResourceId).not.toBe(
      ASSOCIATION_IDS.primary,
    );
    expectDeepFrozen(settlement);
  });

  it('ignores every associate response field and settles only from later reads', async () => {
    const fixture = makeFixture();
    const exactRouteTable = makeRouteTable(fixture, { Associations: [] });
    const associateRouteTable = jest.fn(async () => ({
      AssociationId: ASSOCIATION_IDS.other,
      AssociationState: { State: 'associated' },
      secret: 'associate-response-secret',
    }));
    const client = makeClient(fixture, {
      exactRouteTable,
      slotRouteTables: [],
      associateRouteTable,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(associateRouteTable).toHaveBeenCalledTimes(1);
  });

  it('recovers a lost associate response from agreed natural-slot readback without replay', async () => {
    const fixture = makeFixture();
    let present = false;
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ input) => ({
        RouteTables: input.RouteTableIds
          ? [
              makeRouteTable(fixture, {
                Associations: present ? [makeAssociation()] : [],
              }),
            ]
          : present
            ? [makeRouteTable(fixture)]
            : [],
      }),
    );
    const associateRouteTable = jest.fn(async () => {
      present = true;
      throw providerError('NetworkingError', 'lost-associate-secret');
    });
    const client = makeClient(fixture, {
      describeRouteTables,
      associateRouteTable,
    });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('lost-associate-secret');
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(associateRouteTable).toHaveBeenCalledTimes(1);
  });

  it.each([
    'Resource.AlreadyAssociated',
    'InvalidRouteTableID.NotFound',
    'InvalidSubnetID.NotFound',
    'InvalidSubnetId.NotFound',
    'IncorrectState',
  ])('treats typed associate %s as readback-only', async (name) => {
    const fixture = makeFixture();
    const exactRouteTable = makeRouteTable(fixture, { Associations: [] });
    const associateRouteTable = jest.fn(async () => {
      throw providerError(name, 'typed-associate-secret');
    });
    const client = makeClient(fixture, {
      exactRouteTable,
      slotRouteTables: [],
      associateRouteTable,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(associateRouteTable).toHaveBeenCalledTimes(1);
  });

  it('preserves the exact prior synthetic binding, receipt, nonce, and three-edge lineage on noop', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    if (fixture.priorBinding === null) {
      throw new Error('Missing prior association binding.');
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
    expect(settlement.binding.dependencyBindings).toEqual(
      fixture.priorBinding.dependencyBindings,
    );
    expect(client.associateRouteTable).not.toHaveBeenCalled();
    expect(client.disassociateRouteTable).not.toHaveBeenCalled();
  });
});

describe('AWS single-node subnet route-table association evidence fencing', () => {
  it.each([['associating'], ['disassociating'], ['disassociated']])(
    'keeps an agreed desired %s relationship retryable',
    async (state) => {
      const fixture = makeFixture();
      const association = makeAssociation({
        AssociationState: { State: state },
      });
      const routeTable = makeRouteTable(fixture, {
        Associations: [association],
      });
      const client = makeClient(fixture, {
        exactRouteTable: routeTable,
        slotRouteTables: [routeTable],
      });
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'not-converged',
        },
      );
      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();
      expect(client.associateRouteTable).not.toHaveBeenCalled();
    },
  );

  it('blocks an agreed failed relationship without mutation', async () => {
    const fixture = makeFixture();
    const association = makeAssociation({
      AssociationState: { State: 'failed', StatusMessage: 'ignored detail' },
    });
    const routeTable = makeRouteTable(fixture, {
      Associations: [association],
    });
    const client = makeClient(fixture, {
      exactRouteTable: routeTable,
      slotRouteTables: [routeTable],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeSubnetRouteTableAssociationResourceConflictError,
    );
    expect(client.associateRouteTable).not.toHaveBeenCalled();
  });

  it.each([
    [
      'exact present but filtered absent',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exactRouteTable: makeRouteTable(fixture),
        slotRouteTables: [],
      }),
    ],
    [
      'exact absent but filtered present',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exactRouteTable: makeRouteTable(fixture, { Associations: [] }),
        slotRouteTables: [makeRouteTable(fixture)],
      }),
    ],
    [
      'association IDs disagree across views',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exactRouteTable: makeRouteTable(fixture),
        slotRouteTables: [
          makeRouteTable(fixture, {
            Associations: [
              makeAssociation({
                RouteTableAssociationId: ASSOCIATION_IDS.other,
              }),
            ],
          }),
        ],
      }),
    ],
  ])('keeps stale %s visibility transient', async (_name, evidence) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, evidence(fixture));
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.associateRouteTable).not.toHaveBeenCalled();
  });

  it('blocks a different route table occupying the subnet natural slot', async () => {
    const fixture = makeFixture();
    const wrongAssociation = makeAssociation({
      RouteTableAssociationId: ASSOCIATION_IDS.other,
      RouteTableId: ROUTE_TABLE_IDS.other,
    });
    const wrongTable = makeRouteTable(fixture, {
      Associations: [wrongAssociation],
      RouteTableId: ROUTE_TABLE_IDS.other,
    });
    const client = makeClient(fixture, {
      exactRouteTable: makeRouteTable(fixture, { Associations: [] }),
      slotRouteTables: [wrongTable],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeSubnetRouteTableAssociationResourceConflictError,
    );
    expect(client.associateRouteTable).not.toHaveBeenCalled();
  });

  it.each([
    [
      'foreign subnet association on the intended table',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exactRouteTable: makeRouteTable(fixture, {
          Associations: [
            makeAssociation({
              RouteTableAssociationId: ASSOCIATION_IDS.other,
              SubnetId: SUBNET_IDS.other,
            }),
          ],
        }),
        slotRouteTables: [],
      }),
    ],
    [
      'main association in the filtered result',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exactRouteTable: makeRouteTable(fixture, { Associations: [] }),
        slotRouteTables: [
          makeRouteTable(fixture, {
            Associations: [
              makeAssociation({ Main: true, SubnetId: undefined }),
            ],
          }),
        ],
      }),
    ],
    [
      'two filtered occupants',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exactRouteTable: makeRouteTable(fixture, { Associations: [] }),
        slotRouteTables: [
          makeRouteTable(fixture),
          makeRouteTable(fixture, {
            Associations: [
              makeAssociation({
                RouteTableAssociationId: ASSOCIATION_IDS.other,
              }),
            ],
          }),
        ],
      }),
    ],
  ])('blocks %s as conflicting topology', async (_name, evidence) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, evidence(fixture));
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.associateRouteTable).not.toHaveBeenCalled();
  });

  it.each([
    [
      'foreign subnet owner',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        subnet: makeSubnet(fixture, { OwnerId: '999999999999' }),
      }),
    ],
    [
      'subnet in another VPC',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        subnet: makeSubnet(fixture, { VpcId: VPC_IDS.other }),
      }),
    ],
    [
      'wrong subnet CIDR',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        subnet: makeSubnet(fixture, { CidrBlock: '10.42.1.0/24' }),
      }),
    ],
    [
      'wrong subnet availability zone',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        subnet: makeSubnet(fixture, { AvailabilityZoneId: 'use1-az2' }),
      }),
    ],
    [
      'foreign route-table owner',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exactRouteTable: makeRouteTable(fixture, {
          OwnerId: '999999999999',
        }),
      }),
    ],
    [
      'route table in another VPC',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exactRouteTable: makeRouteTable(fixture, { VpcId: VPC_IDS.other }),
      }),
    ],
    [
      'wrong route-table ownership tag',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => {
        const tags = tagArray(expectedTags(fixture, 'routeTable'));
        const role = tags.find((tag) => tag.Key === 'wharfie:role');
        if (role === undefined)
          throw new Error('Missing route-table role tag.');
        role.Value = 'other';
        return { exactRouteTable: makeRouteTable(fixture, { Tags: tags }) };
      },
    ],
    [
      'blackhole default route',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exactRouteTable: makeRouteTable(fixture, {
          Routes: [
            makeRouteTable(fixture).Routes[0],
            {
              ...makeRouteTable(fixture).Routes[1],
              State: 'blackhole',
            },
          ],
        }),
        slotRouteTables: [makeRouteTable(fixture)],
      }),
    ],
  ])('fences %s parent evidence', async (_name, evidence) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, evidence(fixture));
    const { resource } = makePorts(fixture, { client });
    const settlement = await resource.verifySettlement(fixture.context);

    if (_name === 'blackhole default route') {
      expect(settlement).toEqual({ status: 'not-converged' });
    } else {
      expect(settlement).toEqual({ status: 'blocked' });
    }
    expect(client.associateRouteTable).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong gateway target', { GatewayId: 'igw-00000000000000002' }],
    ['wrong origin', { Origin: 'Advertisement' }],
  ])(
    'keeps create and noop strict when the configured default route has a %s',
    async (_name, routeChanges) => {
      for (const operation of /** @type {const} */ (['apply', 'reconcile'])) {
        const fixture = makeFixture({ operation });
        const routeTable = makeRouteTable(fixture, {
          Routes: [
            makeRouteTable(fixture).Routes[0],
            { ...makeRouteTable(fixture).Routes[1], ...routeChanges },
          ],
        });
        const client = makeClient(fixture, {
          exactRouteTable: routeTable,
          slotRouteTables: [routeTable],
        });
        const { resource } = makePorts(fixture, { client });

        await expect(
          resource.verifySettlement(fixture.context),
        ).resolves.toEqual({ status: 'blocked' });
        expect(client.associateRouteTable).not.toHaveBeenCalled();
        expect(client.disassociateRouteTable).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    [
      'malformed subnet payload',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        subnet: makeSubnet(fixture, { Tags: null }),
      }),
    ],
    [
      'malformed route table payload',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exactRouteTable: makeRouteTable(fixture, { Associations: null }),
      }),
    ],
    [
      'malformed association state',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exactRouteTable: makeRouteTable(fixture, {
          Associations: [
            makeAssociation({ AssociationState: { State: 'mystery' } }),
          ],
        }),
      }),
    ],
    [
      'malformed filtered page',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        describeRouteTables: jest.fn(
          async (/** @type {Readonly<AnyRecord>} */ input) =>
            input.RouteTableIds
              ? { RouteTables: [makeRouteTable(fixture)] }
              : { RouteTables: null },
        ),
      }),
    ],
  ])('maps %s to a fixed unknown error', async (_name, evidence) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, evidence(fixture));
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError,
    );
    expect(client.associateRouteTable).not.toHaveBeenCalled();
  });

  it.each(['subnet', 'route table'])(
    'does not accept a successful exact empty %s response as authoritative absence',
    async (parent) => {
      const fixture = makeFixture();
      const client = makeClient(fixture, {
        ...(parent === 'subnet'
          ? { describeSubnets: jest.fn(async () => ({ Subnets: [] })) }
          : {
              describeRouteTables: jest.fn(
                async (/** @type {Readonly<AnyRecord>} */ input) =>
                  input.RouteTableIds
                    ? { RouteTables: [] }
                    : { RouteTables: [makeRouteTable(fixture)] },
              ),
            }),
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.verifySettlement(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError,
      );
      expect(client.associateRouteTable).not.toHaveBeenCalled();
    },
  );

  it('blocks stable explicit absence for a durable noop binding', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const client = makeClient(fixture, {
      exactRouteTable: makeRouteTable(fixture, { Associations: [] }),
      slotRouteTables: [],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('retries transient agreement within the bound and waits only between attempts', async () => {
    const fixture = makeFixture();
    let attempt = 0;
    const describeSubnets = jest.fn(async () => {
      attempt += 1;
      return { Subnets: [makeSubnet(fixture)] };
    });
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ _input) => {
        const association = makeAssociation({
          AssociationState: {
            State: attempt === 1 ? 'associating' : 'associated',
          },
        });
        return {
          RouteTables: [
            makeRouteTable(fixture, { Associations: [association] }),
          ],
        };
      },
    );
    const waitForRetry = jest.fn();
    const client = makeClient(fixture, {
      describeSubnets,
      describeRouteTables,
    });
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

  it('follows complete frozen association pages and rejects token cycles', async () => {
    const fixture = makeFixture();
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ input) => {
        if (input.RouteTableIds) {
          return { RouteTables: [makeRouteTable(fixture)] };
        }
        if (input.NextToken === undefined) {
          return { RouteTables: [], NextToken: 'page-2' };
        }
        return { RouteTables: [makeRouteTable(fixture)] };
      },
    );
    const client = makeClient(fixture, { describeRouteTables });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    const slotCalls = describeRouteTables.mock.calls.filter(
      ([input]) => input.Filters,
    );
    expect(slotCalls).toHaveLength(2);
    expect(slotCalls[1][0]).toEqual({
      Filters: [
        {
          Name: 'association.subnet-id',
          Values: [SUBNET_IDS.primary],
        },
      ],
      MaxResults:
        AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DISCOVERY_MAX_RESULTS,
      NextToken: 'page-2',
    });
    expectDeepFrozen(slotCalls[1][0]);

    const cyclicClient = makeClient(fixture, {
      describeRouteTables: jest.fn(
        async (/** @type {Readonly<AnyRecord>} */ input) =>
          input.RouteTableIds
            ? { RouteTables: [makeRouteTable(fixture)] }
            : { RouteTables: [], NextToken: 'cycle' },
      ),
    });
    const cyclic = makePorts(fixture, { client: cyclicClient }).resource;
    await expect(
      cyclic.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError,
    );
  });

  it('sanitizes provider and waiter failures', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      describeSubnets: jest.fn(async () => {
        throw providerError('NetworkingError', 'provider-read-secret');
      }),
    });
    const { resource } = makePorts(fixture, { client });
    const observed = await resource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('provider-read-secret');

    const transientAssociation = makeAssociation({
      AssociationState: { State: 'associating' },
    });
    const transientTable = makeRouteTable(fixture, {
      Associations: [transientAssociation],
    });
    const transientClient = makeClient(fixture, {
      exactRouteTable: transientTable,
      slotRouteTables: [transientTable],
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
      AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError,
    );
    expect(JSON.stringify(waiterError)).not.toContain('waiter-secret');
  });
});

describe('AWS single-node subnet route-table association destroy', () => {
  it('disassociates only the exact agreed provider association ID with one frozen request', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();

    expect(client.disassociateRouteTable).toHaveBeenCalledTimes(1);
    expect(client.disassociateRouteTable).toHaveBeenCalledWith({
      AssociationId: ASSOCIATION_IDS.primary,
    });
    expectDeepFrozen(client.disassociateRouteTable.mock.calls[0][0]);
    expect(client.associateRouteTable).not.toHaveBeenCalled();
  });

  it('deletes despite degraded endpoint health and well-formed unrelated parent topology', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const desired = makeAssociation();
    const unrelated = makeAssociation({
      RouteTableAssociationId: ASSOCIATION_IDS.other,
      SubnetId: SUBNET_IDS.other,
    });
    const routeTable = makeRouteTable(fixture, {
      Associations: [desired, unrelated],
      PropagatingVgws: [{ GatewayId: 'vgw-00000000000000001' }],
      Routes: [
        makeRouteTable(fixture).Routes[0],
        { ...makeRouteTable(fixture).Routes[1], State: 'blackhole' },
        {
          DestinationCidrBlock: '10.99.0.0/16',
          GatewayId: 'igw-00000000000000002',
          Origin: 'CreateRoute',
          State: 'active',
        },
      ],
    });
    const client = makeClient(fixture, {
      subnet: makeSubnet(fixture, {
        State: 'failed-insufficient-capacity',
      }),
      exactRouteTable: routeTable,
      slotRouteTables: [routeTable],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.disassociateRouteTable).toHaveBeenCalledWith({
      AssociationId: ASSOCIATION_IDS.primary,
    });
  });

  it.each([
    ['wrong gateway target', { GatewayId: 'igw-00000000000000002' }],
    ['wrong origin', { Origin: 'Advertisement' }],
  ])(
    'does not strand deletion when the configured default route has a %s',
    async (_name, routeChanges) => {
      const fixture = makeFixture({ operation: 'destroy' });
      const routeTable = makeRouteTable(fixture, {
        Routes: [
          makeRouteTable(fixture).Routes[0],
          { ...makeRouteTable(fixture).Routes[1], ...routeChanges },
        ],
      });
      const client = makeClient(fixture, {
        exactRouteTable: routeTable,
        slotRouteTables: [routeTable],
      });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();
      expect(client.disassociateRouteTable).toHaveBeenCalledTimes(1);
      expect(client.disassociateRouteTable).toHaveBeenCalledWith({
        AssociationId: ASSOCIATION_IDS.primary,
      });
      expectDeepFrozen(client.disassociateRouteTable.mock.calls[0][0]);
      expect(client.associateRouteTable).not.toHaveBeenCalled();
    },
  );

  it('blocks contradictory InstanceOwnerId evidence on a configured-default GatewayId route during destroy', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const routeTable = makeRouteTable(fixture, {
      Routes: [
        makeRouteTable(fixture).Routes[0],
        {
          ...makeRouteTable(fixture).Routes[1],
          InstanceOwnerId: fixture.base.providerScope.accountId,
        },
      ],
    });
    const client = makeClient(fixture, {
      exactRouteTable: routeTable,
      slotRouteTables: [routeTable],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeSubnetRouteTableAssociationResourceConflictError,
    );
    expect(observed).toMatchObject({
      code: 'AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_RESOURCE_CONFLICT',
      message:
        'AWS single-node subnet route-table association conflicts with its exact contract.',
    });
    expect(client.disassociateRouteTable).not.toHaveBeenCalled();
    expect(client.associateRouteTable).not.toHaveBeenCalled();
  });

  it('settles null when valid parents and the complete subnet slot show explicit absence', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, {
      exactRouteTable: makeRouteTable(fixture, { Associations: [] }),
      slotRouteTables: [],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(client.disassociateRouteTable).not.toHaveBeenCalled();
  });

  it.each([
    ['subnet', 'InvalidSubnetID.NotFound'],
    ['subnet', 'InvalidSubnetId.NotFound'],
    ['route table', 'InvalidRouteTableID.NotFound'],
    ['both parents', 'both'],
  ])(
    'accepts typed %s disappearance only with complete empty association evidence',
    async (parent, errorName) => {
      const fixture = makeFixture({ operation: 'destroy' });
      const describeSubnets = jest.fn(async () => {
        if (parent === 'subnet' || parent === 'both parents') {
          throw providerError(
            errorName === 'both' ? 'InvalidSubnetID.NotFound' : errorName,
          );
        }
        return { Subnets: [makeSubnet(fixture)] };
      });
      const describeRouteTables = jest.fn(
        async (/** @type {Readonly<AnyRecord>} */ input) => {
          if (input.RouteTableIds) {
            if (parent === 'route table' || parent === 'both parents') {
              throw providerError('InvalidRouteTableID.NotFound');
            }
            return {
              RouteTables: [makeRouteTable(fixture, { Associations: [] })],
            };
          }
          return { RouteTables: [] };
        },
      );
      const client = makeClient(fixture, {
        describeSubnets,
        describeRouteTables,
      });
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        { status: 'converged', binding: null },
      );
      expect(client.disassociateRouteTable).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'missing exact route table with a visible association descendant',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        describeRouteTables: jest.fn(
          async (/** @type {Readonly<AnyRecord>} */ input) => {
            if (input.RouteTableIds) {
              throw providerError('InvalidRouteTableID.NotFound');
            }
            return { RouteTables: [makeRouteTable(fixture)] };
          },
        ),
      }),
    ],
    [
      'missing exact subnet with a visible association descendant',
      (/** @type {ReturnType<typeof makeFixture>} */ _fixture) => ({
        describeSubnets: jest.fn(async () => {
          throw providerError('InvalidSubnetID.NotFound');
        }),
      }),
    ],
    [
      'exact association visible before the filtered descendant',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exactRouteTable: makeRouteTable(fixture),
        slotRouteTables: [],
      }),
    ],
    [
      'filtered association visible before the exact parent',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        exactRouteTable: makeRouteTable(fixture, { Associations: [] }),
        slotRouteTables: [makeRouteTable(fixture)],
      }),
    ],
  ])('keeps %s transient and never deletes', async (_name, evidence) => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, evidence(fixture));
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.disassociateRouteTable).not.toHaveBeenCalled();
  });

  it('does not treat successful empty exact-parent arrays as deletion proof', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const describeSubnets = jest.fn(async () => ({ Subnets: [] }));
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ input) =>
        input.RouteTableIds ? { RouteTables: [] } : { RouteTables: [] },
    );
    const client = makeClient(fixture, {
      describeSubnets,
      describeRouteTables,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError,
    );
    expect(client.disassociateRouteTable).not.toHaveBeenCalled();
  });

  it('ignores a successful disassociate response and remains unsettled while provider state is present', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const disassociateRouteTable = jest.fn(async () => ({
      Return: true,
      secret: 'disassociate-response-secret',
    }));
    const client = makeClient(fixture, { disassociateRouteTable });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(disassociateRouteTable).toHaveBeenCalledTimes(1);
  });

  it('recovers a lost disassociate response from agreed absence without replay', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    let present = true;
    const describeRouteTables = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ input) => ({
        RouteTables: input.RouteTableIds
          ? [
              makeRouteTable(fixture, {
                Associations: present ? [makeAssociation()] : [],
              }),
            ]
          : present
            ? [makeRouteTable(fixture)]
            : [],
      }),
    );
    const disassociateRouteTable = jest.fn(async () => {
      present = false;
      throw providerError(
        'NetworkingError',
        'lost-disassociate-response-secret',
      );
    });
    const client = makeClient(fixture, {
      describeRouteTables,
      disassociateRouteTable,
    });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain(
      'lost-disassociate-response-secret',
    );
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(disassociateRouteTable).toHaveBeenCalledTimes(1);
  });

  it.each([
    'InvalidAssociationID.NotFound',
    'IncorrectState',
    'DependencyViolation',
  ])('treats typed disassociate %s as readback-only', async (name) => {
    const fixture = makeFixture({ operation: 'destroy' });
    const disassociateRouteTable = jest.fn(async () => {
      throw providerError(name, 'typed-disassociate-secret');
    });
    const client = makeClient(fixture, { disassociateRouteTable });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(disassociateRouteTable).toHaveBeenCalledTimes(1);
  });

  it('never deletes a wrong-table occupant of the subnet slot', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const wrong = makeRouteTable(fixture, {
      Associations: [
        makeAssociation({
          RouteTableAssociationId: ASSOCIATION_IDS.other,
          RouteTableId: ROUTE_TABLE_IDS.other,
        }),
      ],
      RouteTableId: ROUTE_TABLE_IDS.other,
    });
    const client = makeClient(fixture, {
      exactRouteTable: makeRouteTable(fixture, { Associations: [] }),
      slotRouteTables: [wrong],
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeSubnetRouteTableAssociationResourceConflictError,
    );
    expect(client.disassociateRouteTable).not.toHaveBeenCalled();
  });
});

describe('AWS single-node subnet route-table association controller authority', () => {
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
      AwsSingleNodeSubnetRouteTableAssociationResourceConflictError,
    ],
    [
      'the wrong action index',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        actionIndex: 0,
      }),
      AwsSingleNodeSubnetRouteTableAssociationResourceConflictError,
    ],
    [
      'a blocked operation',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        ...fixture.context,
        head: recreateHead(fixture, {
          activeOperation: { status: 'blocked' },
        }),
      }),
      AwsSingleNodeSubnetRouteTableAssociationResourceConflictError,
    ],
  ])('rejects %s before provider access', async (_name, mutate, ErrorType) => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(mutate(fixture)),
    ).rejects.toBeInstanceOf(ErrorType);
    expect(client.describeSubnets).not.toHaveBeenCalled();
    expect(client.describeRouteTables).not.toHaveBeenCalled();
    expect(client.associateRouteTable).not.toHaveBeenCalled();
  });

  it.each([
    'network-vpc',
    'network-internet-gateway',
    'network-internet-gateway-attachment',
    'network-subnet',
    'network-route-table',
    'network-default-ipv4-route',
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
      expect(client.describeSubnets).not.toHaveBeenCalled();
      expect(client.describeRouteTables).not.toHaveBeenCalled();
    },
  );

  it('requires earlier apply dependency actions settled and later destroy dependencies pending', async () => {
    const applyFixture = makeFixture();
    const applyHead = JSON.parse(JSON.stringify(applyFixture.head));
    applyHead.activeOperation.intents[
      applyFixture.indices.defaultRoute
    ].status = 'pending';
    const applyClient = makeClient(applyFixture);
    await expect(
      makePorts(applyFixture, { client: applyClient }).resource.executeAction({
        ...applyFixture.context,
        head: applyHead,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(applyClient.describeSubnets).not.toHaveBeenCalled();

    const destroyFixture = makeFixture({ operation: 'destroy' });
    const destroyHead = JSON.parse(JSON.stringify(destroyFixture.head));
    destroyHead.activeOperation.intents[destroyFixture.indices.subnet].status =
      'settled';
    const destroyClient = makeClient(destroyFixture);
    await expect(
      makePorts(destroyFixture, {
        client: destroyClient,
      }).resource.executeAction({
        ...destroyFixture.context,
        head: destroyHead,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(destroyClient.describeSubnets).not.toHaveBeenCalled();
  });

  it.each([
    'network-vpc',
    'network-internet-gateway',
    'network-internet-gateway-attachment',
    'network-subnet',
    'network-route-table',
    'network-default-ipv4-route',
  ])(
    'recomputes and rejects a wrong %s dependency state digest',
    async (resourceKey) => {
      const fixture = makeFixture({
        wrongDependencyDigestResourceKey: resourceKey,
      });
      const client = makeClient(fixture);
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeSubnetRouteTableAssociationResourceConflictError,
      );
      expect(client.describeSubnets).not.toHaveBeenCalled();
      expect(client.describeRouteTables).not.toHaveBeenCalled();
    },
  );

  it('rejects attachment, subnet, route-table, and default-route receipts with reconstructed wrong lineage or identity', async () => {
    const fixture = makeFixture();
    const wrongAttachment = recreateBinding(fixture.attachmentBinding, {
      providerResourceId: attachmentProviderResourceId(
        INTERNET_GATEWAY_ID,
        VPC_IDS.other,
      ),
    });
    const wrongSubnet = recreateBinding(fixture.subnetBinding, {
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
    const wrongDefaultRoute = recreateBinding(fixture.defaultRouteBinding, {
      dependencyBindings: [
        {
          resourceKey: fixture.attachmentBinding.resourceKey,
          bindingId: fixture.attachmentBinding.bindingId,
        },
      ],
    });
    const defaultRouteWithWrongAttachment = recreateBinding(
      fixture.defaultRouteBinding,
      {
        dependencyBindings: [
          {
            resourceKey: wrongAttachment.resourceKey,
            bindingId: wrongAttachment.bindingId,
          },
          {
            resourceKey: fixture.routeTableBinding.resourceKey,
            bindingId: fixture.routeTableBinding.bindingId,
          },
        ].sort((left, right) =>
          left.resourceKey < right.resourceKey
            ? -1
            : left.resourceKey > right.resourceKey
              ? 1
              : 0,
        ),
      },
    );
    const defaultRouteWithWrongRouteTable = recreateBinding(
      fixture.defaultRouteBinding,
      {
        dependencyBindings: [
          {
            resourceKey: fixture.attachmentBinding.resourceKey,
            bindingId: fixture.attachmentBinding.bindingId,
          },
          {
            resourceKey: wrongRouteTable.resourceKey,
            bindingId: wrongRouteTable.bindingId,
          },
        ].sort((left, right) =>
          left.resourceKey < right.resourceKey
            ? -1
            : left.resourceKey > right.resourceKey
              ? 1
              : 0,
        ),
      },
    );
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    for (const replacements of [
      [wrongAttachment, defaultRouteWithWrongAttachment],
      [wrongSubnet],
      [wrongRouteTable, defaultRouteWithWrongRouteTable],
      [wrongDefaultRoute],
    ]) {
      const head = recreateHead(fixture, {
        resourceBindings: fixture.head.resourceBindings.map(
          (/** @type {Readonly<AnyRecord>} */ binding) => {
            const replacement = replacements.find(
              (candidate) => candidate.resourceKey === binding.resourceKey,
            );
            return replacement ?? binding;
          },
        ),
      });
      await expect(
        resource.executeAction({ ...fixture.context, head }),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeSubnetRouteTableAssociationResourceConflictError,
      );
    }
    expect(client.describeSubnets).not.toHaveBeenCalled();
  });

  it('rejects a structurally valid prior binding with the wrong synthetic identity or direct lineage', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    if (fixture.priorBinding === null) {
      throw new Error('Missing prior association binding.');
    }
    const wrongIdentity = recreateBinding(fixture.priorBinding, {
      providerResourceId: associationProviderResourceId(
        ROUTE_TABLE_IDS.other,
        SUBNET_IDS.primary,
      ),
    });
    const wrongLineage = recreateBinding(fixture.priorBinding, {
      dependencyBindings: [
        {
          resourceKey: fixture.subnetBinding.resourceKey,
          bindingId: fixture.subnetBinding.bindingId,
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
        AwsSingleNodeSubnetRouteTableAssociationResourceConflictError,
      );
    }
    expect(client.describeSubnets).not.toHaveBeenCalled();
  });

  it('accepts and ignores an opaque artifact receipt owned by the controller', async () => {
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

describe('AWS single-node subnet route-table association factory contract', () => {
  it('returns only frozen ports and never closes the caller client', () => {
    const fixture = makeFixture();
    const client = { ...makeClient(fixture), close: jest.fn() };
    const resource = createAwsSingleNodeSubnetRouteTableAssociationResource({
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
      createAwsSingleNodeSubnetRouteTableAssociationResource({
        client,
        providerScope: fixture.base.providerScope,
        extra: true,
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeSubnetRouteTableAssociationResource({
        client: {},
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(TypeError);
    for (const method of [
      'associateRouteTable',
      'describeRouteTables',
      'describeSubnets',
      'disassociateRouteTable',
    ]) {
      expect(() =>
        createAwsSingleNodeSubnetRouteTableAssociationResource({
          client: { ...client, [method]: null },
          providerScope: fixture.base.providerScope,
        }),
      ).toThrow(TypeError);
    }
    for (const maxAttempts of [
      0,
      1.5,
      AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_ATTEMPTS + 1,
    ]) {
      expect(() =>
        createAwsSingleNodeSubnetRouteTableAssociationResource({
          client,
          providerScope: fixture.base.providerScope,
          maxAttempts,
        }),
      ).toThrow(TypeError);
    }
    expect(() =>
      createAwsSingleNodeSubnetRouteTableAssociationResource({
        client,
        providerScope: {},
      }),
    ).toThrow(TypeError);
  });

  it('exports fixed limits and non-echoing public errors', () => {
    expect(
      AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DEFAULT_MAX_ATTEMPTS,
    ).toBe(3);
    expect(AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_ATTEMPTS).toBe(
      10,
    );
    expect(
      AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_DISCOVERY_PAGES,
    ).toBe(16);
    expect(
      AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DISCOVERY_MAX_RESULTS,
    ).toBe(100);

    const conflict =
      new AwsSingleNodeSubnetRouteTableAssociationResourceConflictError();
    expect(conflict.name).toBe(
      'AwsSingleNodeSubnetRouteTableAssociationResourceConflictError',
    );
    expect(conflict.code).toBe(
      'AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_RESOURCE_CONFLICT',
    );
    expect(conflict.message).toBe(
      'AWS single-node subnet route-table association conflicts with its exact contract.',
    );
    expect(JSON.stringify(conflict)).not.toContain('secret');

    const unknown =
      new AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError();
    expect(unknown.name).toBe(
      'AwsSingleNodeSubnetRouteTableAssociationResourceUnknownError',
    );
    expect(unknown.code).toBe(
      'AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_RESOURCE_UNKNOWN',
    );
    expect(unknown.message).toBe(
      'AWS single-node subnet route-table association state is unknown.',
    );
    expect(JSON.stringify(unknown)).not.toContain('secret');
  });
});
