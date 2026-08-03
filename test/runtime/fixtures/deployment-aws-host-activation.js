import { expect } from '@jest/globals';

import { createLedgerServiceId } from '../../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { compareCanonicalStrings } from '../../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../../src/core/runtime/content-id.js';
import { getAwsSingleNodeDefaultIpv4RouteProviderResourceId } from '../../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import {
  AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
} from '../../../src/core/runtime/deployment-aws-host-agent-contract.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from '../../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource.js';
import {
  decodeAwsSingleNodeManagedArtifactHead,
  getAwsSingleNodeManagedArtifactStateDigest,
} from '../../../src/core/runtime/deployment-aws-managed-artifact-evidence.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
} from '../../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import { getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId } from '../../../src/core/runtime/deployment-aws-subnet-route-table-association-resource.js';
import { getAwsSingleNodeVolumeAttachmentProviderResourceId } from '../../../src/core/runtime/deployment-aws-volume-attachment-resource.js';
import { createDeploymentHead } from '../../../src/core/runtime/deployment-head.js';
import { createDeploymentPlan } from '../../../src/core/runtime/deployment-plan.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../../src/core/runtime/deployment-profile.js';
import {
  createAwsProviderScope,
  getDeploymentInstanceId,
} from '../../../src/core/runtime/deployment-provider-scope.js';
import {
  createDeploymentIncarnationId,
  createDeploymentResourceBinding,
  createOwnershipNonce,
} from '../../../src/core/runtime/deployment-resource-binding.js';
import { AWS_SINGLE_NODE_RESOURCE_GRAPH } from '../../../src/core/runtime/deployment-resource-graph.js';
import { validateDeploymentRevision } from '../../../src/core/runtime/deployment-revision.js';
import { createDeploymentServiceHealthReceipt } from '../../../src/core/runtime/deployment-service-health.js';

/** @typedef {Record<string, any>} AnyRecord */

export const IDS = Object.freeze({
  applicationVolume: 'vol-00000000000000001',
  controlVolume: 'vol-00000000000000002',
  vpc: 'vpc-00000000000000001',
  internetGateway: 'igw-00000000000000001',
  subnet: 'subnet-00000000000000001',
  routeTable: 'rtb-00000000000000001',
  securityGroup: 'sg-00000000000000001',
  runtimeRole: 'AROA1234567890EXAMPLE',
  runtimeIdentity: 'AIPA1234567890EXAMPLE',
  substrate: 'i-00000000000000001',
});

/** @template T @param {T} value @returns {T} */
export function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
export function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

/** @param {number} byte @returns {string} */
function nonce(byte) {
  return createOwnershipNonce(Buffer.alloc(32, byte));
}

/** @param {unknown} value @returns {void} */
export function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @param {unknown} value @returns {unknown} */
export function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(/** @type {AnyRecord} */ (value))
      .reverse()
      .map(([key, child]) => [key, reverseObjectKeys(child)]),
  );
}

/** @param {() => unknown} callback @param {string} secret @returns {void} */
export function expectRejectionWithoutSecret(callback, secret) {
  /** @type {unknown} */
  let thrown;
  try {
    callback();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeDefined();
  expect(String(thrown)).not.toContain(secret);
}

/** @param {Readonly<AnyRecord>} request @returns {Readonly<AnyRecord>} */
export function reidentifyRequest(request) {
  const payload = /** @type {AnyRecord} */ (clone(request));
  delete payload.requestId;
  return {
    ...payload,
    requestId: createCanonicalJsonSha256Id({
      domain: AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_DOMAIN,
      prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
      value: payload,
    }),
  };
}

/** @param {Readonly<AnyRecord>} receipt @returns {Readonly<AnyRecord>} */
export function reidentifyReceipt(receipt) {
  const payload = /** @type {AnyRecord} */ (clone(receipt));
  delete payload.receiptId;
  return {
    ...payload,
    receiptId: createCanonicalJsonSha256Id({
      domain: AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_ID_DOMAIN,
      prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_RECEIPT_ID_PREFIX,
      value: payload,
    }),
  };
}

/** @param {Readonly<AnyRecord>} base @returns {Readonly<AnyRecord>} */
function authority(base) {
  return {
    providerScope: base.providerScope,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
  };
}

/** @param {Readonly<AnyRecord>} base @param {string} resourceKey @returns {string} */
function providerResourceId(base, resourceKey) {
  switch (resourceKey) {
    case 'artifact':
      return getAwsSingleNodeManagedArtifactObjectLocation(authority(base)).arn;
    case 'application-state':
      return IDS.applicationVolume;
    case 'control-state':
      return IDS.controlVolume;
    case 'network-vpc':
      return IDS.vpc;
    case 'network-internet-gateway':
      return IDS.internetGateway;
    case 'network-internet-gateway-attachment':
      return getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
        IDS.internetGateway,
        IDS.vpc,
      );
    case 'network-subnet':
      return IDS.subnet;
    case 'network-route-table':
      return IDS.routeTable;
    case 'network-default-ipv4-route':
      return getAwsSingleNodeDefaultIpv4RouteProviderResourceId(
        base.providerSpec.capabilities.networking.egressCidr,
        IDS.internetGateway,
        IDS.routeTable,
      );
    case 'network-subnet-route-table-association':
      return getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId(
        IDS.routeTable,
        IDS.subnet,
      );
    case 'network-security-group':
      return IDS.securityGroup;
    case 'runtime-role':
      return IDS.runtimeRole;
    case 'runtime-role-policy':
      return getAwsSingleNodeRuntimePolicyProviderResourceId({
        runtimeRoleId: IDS.runtimeRole,
      });
    case 'runtime-identity':
      return IDS.runtimeIdentity;
    case 'runtime-identity-role-association':
      return getAwsSingleNodeRuntimeAssociationProviderResourceId({
        runtimeRoleId: IDS.runtimeRole,
        instanceProfileId: IDS.runtimeIdentity,
      });
    case 'substrate':
      return IDS.substrate;
    case 'application-state-attachment':
      return getAwsSingleNodeVolumeAttachmentProviderResourceId(
        base.providerSpec,
        'application-state',
        IDS.substrate,
        IDS.applicationVolume,
      );
    case 'control-state-attachment':
      return getAwsSingleNodeVolumeAttachmentProviderResourceId(
        base.providerSpec,
        'control-state',
        IDS.substrate,
        IDS.controlVolume,
      );
    default:
      throw new Error(`Unsupported fixture resource '${resourceKey}'.`);
  }
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>} plan
 * @param {ReadonlyArray<Readonly<AnyRecord>>} intents
 * @returns {ReadonlyArray<Readonly<AnyRecord>>}
 */
function makeBindings(base, plan, intents) {
  const actionByKey = new Map(
    plan.actions.map((/** @type {Readonly<AnyRecord>} */ action) => [
      action.resourceKey,
      action,
    ]),
  );
  const intentByAction = new Map(
    intents.map((intent) => [intent.actionId, intent]),
  );
  /** @type {Readonly<AnyRecord>[]} */
  const bindings = [];
  const bindingByKey = new Map();
  for (
    let index = 0;
    index < AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.length;
    index += 1
  ) {
    const definition = AWS_SINGLE_NODE_RESOURCE_GRAPH.resources[index];
    const action = actionByKey.get(definition.resourceKey);
    if (action === undefined) {
      throw new Error(`Fixture lacks action '${definition.resourceKey}'.`);
    }
    const intent = intentByAction.get(action.actionId);
    if (intent === undefined || intent.ownershipNonce === null) {
      throw new Error(`Fixture lacks intent '${definition.resourceKey}'.`);
    }
    const dependencyBindings = definition.dependsOn
      .map((/** @type {string} */ resourceKey) => {
        const dependency = bindingByKey.get(resourceKey);
        if (dependency === undefined) {
          throw new Error(`Fixture lacks dependency '${resourceKey}'.`);
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
      resourceKey: definition.resourceKey,
      capability: definition.capability,
      role: definition.role,
      management: 'managed',
      ownershipMode: definition.ownershipMode,
      onDestroy: definition.onDestroy,
      dependencyBindings,
      providerType: definition.providerType,
      providerResourceId: providerResourceId(base, definition.resourceKey),
      providerScopeId: base.providerScope.providerScopeId,
      ownershipNonce: intent.ownershipNonce,
      createdByActionId: action.actionId,
    });
    bindingByKey.set(definition.resourceKey, binding);
    bindings.push(binding);
  }
  return bindings;
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>} artifactBinding @returns {Readonly<AnyRecord>} */
function makeManagedArtifact(base, artifactBinding) {
  const versionId = '版本 / 🌊\nBearer provider-opaque-value';
  const contentLength = 137;
  const stateDigest = getAwsSingleNodeManagedArtifactStateDigest({
    deploymentRevision: base.deploymentRevision,
    profile: base.profile,
    providerScope: base.providerScope,
    providerSpec: base.providerSpec,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
  });
  const stageIntentId = semanticId(
    'wsi1',
    'wharfie:test:host-activation-stage-intent:v1',
    { revisionId: base.deploymentRevision.revisionId },
  );
  const stageReceiptId = semanticId(
    'wsr1',
    'wharfie:test:host-activation-stage-receipt:v1',
    { revisionId: base.deploymentRevision.revisionId },
  );
  const metadata = {
    'wharfie-schema': 'deployment-managed-artifact-v1',
    'wharfie-managed-by': 'wharfie',
    'wharfie-resource-kind': 'single-node-managed-artifact',
    'wharfie-retention': 'purge',
    'wharfie-capability': 'artifact-storage',
    'wharfie-role': 'object',
    'wharfie-provider-scope-id': base.providerScope.providerScopeId,
    'wharfie-deployment-instance-id': base.deploymentInstanceId,
    'wharfie-incarnation-id': base.incarnationId,
    'wharfie-resource-key': 'artifact',
    'wharfie-created-by-action-id': artifactBinding.createdByActionId,
    'wharfie-ownership-nonce': artifactBinding.ownershipNonce,
    'wharfie-state-digest': stateDigest.value,
    'wharfie-deployment-revision-id':
      base.deploymentRevision.deploymentRevisionId,
    'wharfie-profile-revision-id': base.deploymentRevision.profileRevisionId,
    'wharfie-app-id': base.deploymentRevision.appId,
    'wharfie-revision-id': base.deploymentRevision.revisionId,
    'wharfie-artifact-id': base.deploymentRevision.artifactId,
    'wharfie-content-length': String(contentLength),
    'wharfie-stage-intent-id': stageIntentId,
    'wharfie-stage-receipt-id': stageReceiptId,
  };
  return decodeAwsSingleNodeManagedArtifactHead(
    {
      VersionId: versionId,
      ETag: '"managed-etag"',
      ContentLength: contentLength,
      ChecksumSHA256: Buffer.from(
        base.deploymentRevision.artifactId.slice('waf1_'.length),
        'base64url',
      ).toString('base64'),
      ServerSideEncryption: 'AES256',
      StorageClass: 'STANDARD',
      ContentType: 'application/octet-stream',
      CacheControl: 'no-store',
      Metadata: metadata,
    },
    {
      providerScope: base.providerScope,
      artifactStorage: base.providerSpec.capabilities.artifactStorage,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      createdByActionId: artifactBinding.createdByActionId,
      ownershipNonce: artifactBinding.ownershipNonce,
      appId: base.deploymentRevision.appId,
    },
    versionId,
  );
}

/** @returns {Readonly<AnyRecord>} */
export function makeFixture() {
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'host-activation-contract-test',
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider('us-east-1'),
  });
  const revisionPayload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'production' },
    appId: profile.appId,
    revisionId: semanticId('wrv1', 'wharfie:test:host-activation-revision:v1', {
      revision: 1,
    }),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'host activation contract artifact bytes',
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
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId: '123456789012',
    region: 'us-east-1',
  });
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
  const incarnationId = createDeploymentIncarnationId(Buffer.alloc(32, 77));
  const base = {
    profile,
    deploymentRevision,
    providerScope,
    providerSpec,
    deploymentInstanceId,
    incarnationId,
  };
  const targets = createAwsSingleNodeDesiredResourceTargetCatalog({
    deploymentRevision,
    profile,
    providerScope,
    providerSpec,
    deploymentInstanceId,
    incarnationId,
    head: null,
  });
  const plan = createDeploymentPlan(
    {
      operation: 'apply',
      deploymentRevision,
      providerScope,
      providerSpec,
      deploymentInstanceId,
      incarnationId,
      basis: {
        headGeneration: 0,
        settledDeploymentRevisionId: null,
        inspectionId: semanticId(
          'win6',
          'wharfie:test:host-activation-inspection:v1',
          { deploymentRevisionId: deploymentRevision.deploymentRevisionId },
        ),
      },
      actions: targets.map((target) => ({
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
        after: {
          providerType: target.target.providerType,
          providerResourceId: target.target.providerResourceId,
          stateDigest: target.target.stateDigest,
        },
      })),
    },
    { profile },
  );
  const intents = plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ action,
      /** @type {number} */ index,
    ) => ({
      actionId: action.actionId,
      status: 'settled',
      ownershipNonce: nonce(100 + index),
    }),
  );
  const bindings = makeBindings(base, plan, intents);
  const head = createDeploymentHead({
    deploymentInstanceId,
    providerScope,
    incarnationId,
    generation: plan.basis.headGeneration + 1 + plan.actions.length * 2,
    phase: 'CONVERGING',
    settledDeploymentRevisionId: null,
    targetDeploymentRevisionId: deploymentRevision.deploymentRevisionId,
    resourceBindings: bindings,
    activeOperation: {
      kind: 'create',
      planId: plan.planId,
      status: 'running',
      nextActionIndex: plan.actions.length,
      intents,
    },
    lastOperation: null,
  });
  const readyHead = createDeploymentHead({
    deploymentInstanceId,
    providerScope,
    incarnationId,
    generation: head.generation + 1,
    phase: 'READY',
    settledDeploymentRevisionId: deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: deploymentRevision.deploymentRevisionId,
    resourceBindings: bindings,
    activeOperation: null,
    lastOperation: {
      kind: 'create',
      planId: plan.planId,
      intents,
    },
  });
  const artifactBinding = bindings.find(
    (binding) => binding.resourceKey === 'artifact',
  );
  const node = bindings.find((binding) => binding.resourceKey === 'substrate');
  const runtimeRole = bindings.find(
    (binding) => binding.resourceKey === 'runtime-role',
  );
  if (
    artifactBinding === undefined ||
    node === undefined ||
    runtimeRole === undefined
  ) {
    throw new Error('Host activation fixture lacks required bindings.');
  }
  const managedArtifact = makeManagedArtifact(base, artifactBinding);
  return Object.freeze({
    ...base,
    plan,
    intents,
    bindings,
    head,
    readyHead,
    artifactBinding,
    node,
    runtimeRole,
    managedArtifact,
    requestContext: Object.freeze({
      plan,
      settledPlan: null,
      profile,
      head,
      managedArtifact,
    }),
  });
}

/**
 * Build the controller-reachable all-settled reconcile frontier that follows
 * the fixture's READY create result.
 * @param {Readonly<AnyRecord>} fixture
 * @returns {Readonly<AnyRecord>}
 */
export function makeReconcileFixture(fixture) {
  const bindingByKey = new Map(
    fixture.bindings.map((/** @type {Readonly<AnyRecord>} */ binding) => [
      binding.resourceKey,
      binding,
    ]),
  );
  const targets = createAwsSingleNodeDesiredResourceTargetCatalog({
    deploymentRevision: fixture.deploymentRevision,
    profile: fixture.profile,
    providerScope: fixture.providerScope,
    providerSpec: fixture.providerSpec,
    deploymentInstanceId: fixture.deploymentInstanceId,
    incarnationId: fixture.incarnationId,
    head: fixture.readyHead,
  });
  const plan = createDeploymentPlan(
    {
      operation: 'reconcile',
      deploymentRevision: fixture.deploymentRevision,
      providerScope: fixture.providerScope,
      providerSpec: fixture.providerSpec,
      deploymentInstanceId: fixture.deploymentInstanceId,
      incarnationId: fixture.incarnationId,
      basis: {
        headGeneration: fixture.readyHead.generation,
        settledDeploymentRevisionId:
          fixture.deploymentRevision.deploymentRevisionId,
        inspectionId: semanticId(
          'win6',
          'wharfie:test:host-activation-reconcile-inspection:v1',
          { headId: fixture.readyHead.headId },
        ),
      },
      actions: targets.map((target) => {
        const binding = bindingByKey.get(target.resourceKey);
        if (binding === undefined) {
          throw new Error(
            `Reconcile fixture lacks binding '${target.resourceKey}'.`,
          );
        }
        const state = {
          providerType: target.target.providerType,
          providerResourceId: binding.providerResourceId,
          stateDigest: target.target.stateDigest,
        };
        return {
          resourceKey: target.resourceKey,
          capability: target.capability,
          role: target.role,
          management: target.management,
          ownershipMode: target.ownershipMode,
          dependsOn: target.dependsOn,
          onDestroy: target.onDestroy,
          action: 'noop',
          destructive: false,
          reason: 'already-converged',
          before: state,
          after: state,
        };
      }),
    },
    { profile: fixture.profile },
  );
  const intents = plan.actions.map(
    (/** @type {Readonly<AnyRecord>} */ action) => {
      const binding = bindingByKey.get(action.resourceKey);
      if (binding === undefined) {
        throw new Error(
          `Reconcile fixture lacks intent binding '${action.resourceKey}'.`,
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
    deploymentInstanceId: fixture.deploymentInstanceId,
    providerScope: fixture.providerScope,
    incarnationId: fixture.incarnationId,
    generation: fixture.readyHead.generation + 1 + plan.actions.length * 2,
    phase: 'CONVERGING',
    settledDeploymentRevisionId:
      fixture.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: fixture.deploymentRevision.deploymentRevisionId,
    resourceBindings: fixture.bindings,
    activeOperation: {
      kind: 'reconcile',
      planId: plan.planId,
      status: 'running',
      nextActionIndex: plan.actions.length,
      intents,
    },
    lastOperation: fixture.readyHead.lastOperation,
  });
  return Object.freeze({
    plan,
    intents,
    head,
    requestContext: Object.freeze({
      plan,
      settledPlan: fixture.plan,
      profile: fixture.profile,
      head,
      managedArtifact: fixture.managedArtifact,
    }),
  });
}

/** @param {Readonly<AnyRecord>} fixture @param {AnyRecord} [overrides] @returns {Readonly<AnyRecord>} */
export function makeHealthReceipt(fixture, overrides = {}) {
  return createDeploymentServiceHealthReceipt({
    providerScopeId: fixture.providerScope.providerScopeId,
    providerSpecId: fixture.providerSpec.providerSpecId,
    deploymentInstanceId: fixture.deploymentInstanceId,
    incarnationId: fixture.incarnationId,
    deploymentOperationId: fixture.head.activeOperation.operationId,
    authorizedHeadId: fixture.head.headId,
    authorizedHeadGeneration: fixture.head.generation,
    nodeBindingId: fixture.node.bindingId,
    nodeProviderResourceId: fixture.node.providerResourceId,
    runtimeRoleBindingId: fixture.runtimeRole.bindingId,
    runtimeRoleId: fixture.runtimeRole.providerResourceId,
    deploymentRevisionId: fixture.deploymentRevision.deploymentRevisionId,
    appId: fixture.deploymentRevision.appId,
    artifactId: fixture.deploymentRevision.artifactId,
    revisionId: fixture.deploymentRevision.revisionId,
    serviceId: createLedgerServiceId({
      appId: fixture.deploymentRevision.appId,
    }),
    sessionId: semanticId(
      'wss',
      'wharfie:test:host-activation-health-session:v1',
      { seed: 1 },
    ),
    lifecycleGeneration: 3,
    ownerGeneration: 4,
    activationRecordVersion: 12,
    activationSelectionGeneration: 2,
    processId: 4242,
    sequence: 1,
    health: 'healthy',
    ...overrides,
  });
}
