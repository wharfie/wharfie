import { describe, expect, it } from '@jest/globals';

import { compareCanonicalStrings } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import { getAwsSingleNodeDefaultIpv4RouteProviderResourceId } from '../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource.js';
import {
  AWS_SINGLE_NODE_DEPLOYMENT_PLAN_UNSUPPORTED,
  AwsSingleNodeDeploymentPlanUnsupportedError,
  createAwsSingleNodeDeploymentPlan,
} from '../../src/core/runtime/deployment-aws-plan.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
} from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import { getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId } from '../../src/core/runtime/deployment-aws-subnet-route-table-association-resource.js';
import { getAwsSingleNodeVolumeAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-volume-attachment-resource.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
import { createDeploymentInspection } from '../../src/core/runtime/deployment-inspection.js';
import {
  createDeploymentServiceHealthReceipt,
  getDeploymentServiceHealthObjectLocation,
} from '../../src/core/runtime/deployment-service-health.js';
import { validateDeploymentServiceHealthObservation } from '../../src/core/runtime/deployment-service-health-s3.js';
import { validateDeploymentPlanContext } from '../../src/core/runtime/deployment-plan.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import {
  createAwsProviderScope,
  getDeploymentInstanceId,
} from '../../src/core/runtime/deployment-provider-scope.js';
import {
  createDeploymentIncarnationId,
  createDeploymentResourceBinding,
  createOwnershipNonce,
} from '../../src/core/runtime/deployment-resource-binding.js';
import {
  AWS_SINGLE_NODE_RESOURCE_GRAPH,
  getAwsSingleNodeResourceApplyOrder,
  getAwsSingleNodeResourceDestroyOrder,
} from '../../src/core/runtime/deployment-resource-graph.js';
import { validateDeploymentRevision } from '../../src/core/runtime/deployment-revision.js';
import { createLedgerServiceId } from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';

/** @typedef {Record<string, any>} AnyRecord */
/**
 * @typedef InspectionOptions
 * @property {Readonly<Record<string, 'present'|'absent'|'unknown'|'conflict'>>} [states] - Per-role provider presence/ownership evidence.
 * @property {Readonly<Record<string, Readonly<AnyRecord>>>} [desiredDigests] - Per-role inspection desired-digest overrides.
 * @property {Readonly<Record<string, Readonly<AnyRecord>>>} [observedDigests] - Per-role provider observed-digest overrides.
 * @property {Readonly<Record<string, string>>} [providerResourceIds] - Per-role provider identity overrides.
 * @property {string} [status] - Aggregate inspection status override.
 */

const IDS = Object.freeze({
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
const HEALTH_NOW = 1_700_000_000_000;

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {Readonly<AnyRecord>} inspection @returns {AnyRecord} */
function rehashInspection(inspection) {
  const payload = /** @type {AnyRecord} */ (clone(inspection));
  delete payload.inspectionId;
  return {
    ...payload,
    inspectionId: semanticId(
      'win6',
      'wharfie:deployment-inspection:v6',
      payload,
    ),
  };
}

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

/** @param {number} byte @returns {string} */
function nonce(byte) {
  return createOwnershipNonce(Buffer.alloc(32, byte));
}

/** @param {string} label @returns {{algorithm: 'sha256', value: string}} */
function digest(label) {
  return { algorithm: 'sha256', value: sha256Base64Url(label) };
}

/** @param {any} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @param {() => unknown} callback @returns {void} */
function expectUnsupported(callback) {
  /** @type {unknown} */
  let error;
  try {
    callback();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(AwsSingleNodeDeploymentPlanUnsupportedError);
  expect(error).toMatchObject({
    name: 'AwsSingleNodeDeploymentPlanUnsupportedError',
    code: AWS_SINGLE_NODE_DEPLOYMENT_PLAN_UNSUPPORTED,
    message: 'AWS single-node deployment plan is unsupported.',
  });
}

/** @returns {Readonly<AnyRecord>} */
function makeProfile() {
  return createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'aws-plan-test',
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider('us-east-1'),
  });
}

/** @param {Readonly<AnyRecord>} profile @param {number} revision @returns {Readonly<AnyRecord>} */
function makeDeploymentRevision(profile, revision) {
  const payload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'production' },
    appId: profile.appId,
    revisionId: semanticId('wrv1', 'wharfie:test:aws-plan-revision:v1', {
      revision,
    }),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: `aws plan artifact ${revision}`,
    }),
    profileRevisionId: profile.profileRevisionId,
  };
  return validateDeploymentRevision({
    ...payload,
    deploymentRevisionId: semanticId(
      'wdr1',
      'wharfie:deployment-revision:v1',
      payload,
    ),
  });
}

/** @param {Readonly<AnyRecord>} profile @param {Readonly<AnyRecord>} providerScope @returns {Readonly<AnyRecord>} */
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

/** @param {number} [revision] @returns {Readonly<AnyRecord>} */
function makeBase(revision = 1) {
  const profile = makeProfile();
  const deploymentRevision = makeDeploymentRevision(profile, revision);
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId: '123456789012',
    region: 'us-east-1',
  });
  const providerSpec = makeProviderSpec(profile, providerScope);
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
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 77)),
  });
}

/** @param {Readonly<AnyRecord>} base @returns {Readonly<AnyRecord>} */
function policyAuthority(base) {
  return Object.freeze({
    providerScope: base.providerScope,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
  });
}

/** @param {Readonly<AnyRecord>} base @param {string} resourceKey @returns {string} */
function providerResourceId(base, resourceKey) {
  switch (resourceKey) {
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
 * @param {{omit?: ReadonlySet<string>}} [options]
 * @returns {Readonly<AnyRecord>[]}
 */
function makeBindings(base, options = {}) {
  const omit = options.omit ?? new Set();
  /** @type {Readonly<AnyRecord>[]} */
  const bindings = [];
  const bindingByKey = new Map();
  for (
    let index = 0;
    index < AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.length;
    index += 1
  ) {
    const definition = AWS_SINGLE_NODE_RESOURCE_GRAPH.resources[index];
    if (omit.has(definition.resourceKey)) continue;
    const dependencyBindings = definition.dependsOn
      .map((/** @type {string} */ resourceKey) => {
        const dependency = bindingByKey.get(resourceKey);
        if (dependency === undefined) {
          throw new Error(`Missing fixture dependency '${resourceKey}'.`);
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
      ownershipNonce: nonce(index + 1),
      createdByActionId: semanticId(
        'wda3',
        'wharfie:test:aws-plan-binding-action:v1',
        { resourceKey: definition.resourceKey },
      ),
    });
    bindingByKey.set(definition.resourceKey, binding);
    bindings.push(binding);
  }
  return bindings;
}

/** @param {Readonly<AnyRecord>[]} bindings @returns {Readonly<AnyRecord>} */
function settledOperation(bindings) {
  return {
    kind: 'create',
    planId: semanticId('wpl3', 'wharfie:test:aws-plan-head-plan:v1', {
      bindingIds: bindings.map((binding) => binding.bindingId),
    }),
    intents: bindings.map((binding) => ({
      actionId: binding.createdByActionId,
      status: 'settled',
      ownershipNonce: binding.ownershipNonce,
    })),
  };
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>[]} bindings
 * @param {{deploymentRevisionId?: string, generation?: number}} [overrides]
 * @returns {Readonly<AnyRecord>}
 */
function makeReadyHead(base, bindings, overrides = {}) {
  const deploymentRevisionId =
    overrides.deploymentRevisionId ??
    base.deploymentRevision.deploymentRevisionId;
  return createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: overrides.generation ?? 7,
    phase: 'READY',
    settledDeploymentRevisionId: deploymentRevisionId,
    targetDeploymentRevisionId: deploymentRevisionId,
    resourceBindings: bindings,
    activeOperation: null,
    lastOperation: settledOperation(bindings),
  });
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>[]} bindings @param {string} settledDeploymentRevisionId @returns {Readonly<AnyRecord>} */
function makeConvergingHead(base, bindings, settledDeploymentRevisionId) {
  return createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 8,
    phase: 'CONVERGING',
    settledDeploymentRevisionId,
    targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    resourceBindings: bindings,
    activeOperation: {
      kind: 'update',
      planId: semanticId('wpl3', 'wharfie:test:aws-plan-active:v1', {
        kind: 'update',
      }),
      status: 'running',
      nextActionIndex: 0,
      intents: [
        {
          actionId: semanticId(
            'wda3',
            'wharfie:test:aws-plan-active-action:v1',
            { kind: 'update' },
          ),
          status: 'pending',
          ownershipNonce: null,
        },
      ],
    },
    lastOperation: settledOperation(bindings),
  });
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>[]} bindings @returns {Readonly<AnyRecord>} */
function makeDestroyingHead(base, bindings) {
  return createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 9,
    phase: 'DESTROYING',
    settledDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: null,
    resourceBindings: bindings,
    activeOperation: {
      kind: 'destroy',
      planId: semanticId('wpl3', 'wharfie:test:aws-plan-active:v1', {
        kind: 'destroy',
      }),
      status: 'running',
      nextActionIndex: 0,
      intents: [
        {
          actionId: semanticId(
            'wda3',
            'wharfie:test:aws-plan-active-action:v1',
            { kind: 'destroy' },
          ),
          status: 'pending',
          ownershipNonce: null,
        },
      ],
    },
    lastOperation: settledOperation(bindings),
  });
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>[]} bindings @returns {Readonly<AnyRecord>} */
function makeDestroyedHead(base, bindings) {
  return createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 10,
    phase: 'DESTROYED',
    settledDeploymentRevisionId: null,
    targetDeploymentRevisionId: null,
    resourceBindings: bindings,
    activeOperation: null,
    lastOperation: {
      kind: 'destroy',
      planId: semanticId('wpl3', 'wharfie:test:aws-plan-destroyed:v1', {
        bindingIds: bindings.map((binding) => binding.bindingId),
      }),
      intents: [
        {
          actionId: semanticId(
            'wda3',
            'wharfie:test:aws-plan-destroyed-action:v1',
            { bindingIds: bindings.map((binding) => binding.bindingId) },
          ),
          status: 'settled',
          ownershipNonce: nonce(250),
        },
      ],
    },
  });
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>|null} head @returns {ReadonlyArray<Readonly<AnyRecord>>} */
function makeTargets(base, head) {
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

/** @param {Readonly<AnyRecord>|null} head @returns {Map<string, Readonly<AnyRecord>>} */
function bindingsByKey(head) {
  return new Map(
    (head?.resourceBindings ?? []).map(
      (/** @type {Readonly<AnyRecord>} */ binding) => [
        binding.resourceKey,
        binding,
      ],
    ),
  );
}

/** @param {string} resourceKey @returns {string} */
function syntheticBindingId(resourceKey) {
  return semanticId('wrb2', 'wharfie:test:aws-plan-observed-binding:v1', {
    resourceKey,
  });
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>} head
 * @param {InspectionOptions} [options]
 * @returns {Readonly<AnyRecord>}
 */
function makeInspection(base, head, options = {}) {
  const states = options.states ?? {};
  const targets = makeTargets(base, head);
  const bindings = bindingsByKey(head);
  let hasAbsent = false;
  let hasUnknown = false;
  let hasConflict = false;
  let hasDrift = false;
  const resources = targets.map((entry) => {
    const state = states[entry.resourceKey] ?? 'present';
    const binding = bindings.get(entry.resourceKey);
    const desiredDigest =
      options.desiredDigests?.[entry.resourceKey] ?? entry.target.stateDigest;
    const observedDigest =
      options.observedDigests?.[entry.resourceKey] ?? entry.target.stateDigest;
    if (JSON.stringify(desiredDigest) !== JSON.stringify(observedDigest)) {
      hasDrift = true;
    }
    if (state === 'absent') {
      hasAbsent = true;
      return {
        resourceKey: entry.resourceKey,
        capability: entry.capability,
        role: entry.role,
        management: entry.management,
        ownershipMode: entry.ownershipMode,
        dependsOn: entry.dependsOn,
        onDestroy: entry.onDestroy,
        bindingId: null,
        dependencyBindings: null,
        presence: 'absent',
        presenceEvidence: 'authoritative-not-found',
        ownership: 'missing',
        providerIdentity: null,
        desiredDigest,
        observedDigest: null,
        health: 'absent',
        service: null,
        execution: 'none',
      };
    }
    if (state === 'unknown') {
      hasUnknown = true;
      return {
        resourceKey: entry.resourceKey,
        capability: entry.capability,
        role: entry.role,
        management: entry.management,
        ownershipMode: entry.ownershipMode,
        dependsOn: entry.dependsOn,
        onDestroy: entry.onDestroy,
        bindingId: null,
        dependencyBindings: null,
        presence: 'unknown',
        presenceEvidence: 'access-failure',
        ownership: 'unknown',
        providerIdentity: null,
        desiredDigest,
        observedDigest: null,
        health: 'unknown',
        service: null,
        execution: 'none',
      };
    }
    const providerId =
      options.providerResourceIds?.[entry.resourceKey] ??
      binding?.providerResourceId ??
      providerResourceId(base, entry.resourceKey);
    if (state === 'conflict') {
      hasConflict = true;
      return {
        resourceKey: entry.resourceKey,
        capability: entry.capability,
        role: entry.role,
        management: entry.management,
        ownershipMode: entry.ownershipMode,
        dependsOn: entry.dependsOn,
        onDestroy: entry.onDestroy,
        bindingId: null,
        dependencyBindings: null,
        presence: 'present',
        presenceEvidence: 'exact-read',
        ownership: 'conflict',
        providerIdentity: {
          providerType: entry.target.providerType,
          providerResourceId: providerId,
        },
        desiredDigest,
        observedDigest,
        health:
          entry.resourceKey === 'substrate' ? 'starting' : 'not-applicable',
        service: null,
        execution: 'none',
      };
    }
    const dependencyBindings = entry.dependsOn
      .map((/** @type {string} */ resourceKey) => ({
        resourceKey,
        bindingId:
          bindings.get(resourceKey)?.bindingId ??
          syntheticBindingId(resourceKey),
      }))
      .sort(
        (
          /** @type {{resourceKey: string}} */ left,
          /** @type {{resourceKey: string}} */ right,
        ) => compareCanonicalStrings(left.resourceKey, right.resourceKey),
      );
    return {
      resourceKey: entry.resourceKey,
      capability: entry.capability,
      role: entry.role,
      management: entry.management,
      ownershipMode: entry.ownershipMode,
      dependsOn: entry.dependsOn,
      onDestroy: entry.onDestroy,
      bindingId: binding?.bindingId ?? syntheticBindingId(entry.resourceKey),
      dependencyBindings,
      presence: 'present',
      presenceEvidence: 'exact-read',
      ownership: 'verified',
      providerIdentity: {
        providerType: entry.target.providerType,
        providerResourceId: providerId,
      },
      desiredDigest,
      observedDigest,
      health: entry.resourceKey === 'substrate' ? 'starting' : 'not-applicable',
      service: null,
      execution: 'none',
    };
  });
  const status =
    options.status ??
    (hasConflict
      ? 'conflict'
      : hasUnknown
        ? 'unknown'
        : hasAbsent || hasDrift
          ? 'drifted'
          : 'in-flight');
  return createDeploymentInspection(
    {
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpecId: base.providerSpec.providerSpecId,
      deploymentInstanceId: base.deploymentInstanceId,
      controlState: { status: 'present', evidence: 'provider-head-read' },
      incarnationId: head.incarnationId,
      headGeneration: head.generation,
      status,
      resources,
    },
    {
      profile: base.profile,
      providerSpec: base.providerSpec,
      head,
      plan: null,
    },
  );
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>} head @returns {Readonly<AnyRecord>} */
function makeConvergedInspection(base, head) {
  const resources = clone(makeInspection(base, head).resources);
  const bindings = bindingsByKey(head);
  const nodeBinding = bindings.get('substrate');
  const runtimeRoleBinding = bindings.get('runtime-role');
  if (
    nodeBinding === undefined ||
    runtimeRoleBinding === undefined ||
    head.lastOperation === null
  ) {
    throw new Error(
      'Converged fixture requires settled node and role authority.',
    );
  }
  const receipt = createDeploymentServiceHealthReceipt({
    providerScopeId: base.providerScope.providerScopeId,
    providerSpecId: base.providerSpec.providerSpecId,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    deploymentOperationId: head.lastOperation.operationId,
    authorizedHeadId: head.headId,
    authorizedHeadGeneration: head.generation,
    nodeBindingId: nodeBinding.bindingId,
    nodeProviderResourceId: nodeBinding.providerResourceId,
    runtimeRoleBindingId: runtimeRoleBinding.bindingId,
    runtimeRoleId: runtimeRoleBinding.providerResourceId,
    deploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    appId: base.deploymentRevision.appId,
    artifactId: base.deploymentRevision.artifactId,
    revisionId: base.deploymentRevision.revisionId,
    serviceId: createLedgerServiceId({ appId: base.deploymentRevision.appId }),
    sessionId: `wss_${Buffer.alloc(32, 5).toString('base64url')}`,
    lifecycleGeneration: 1,
    ownerGeneration: 1,
    activationRecordVersion: 1,
    activationSelectionGeneration: 1,
    processId: 4321,
    sequence: 1,
    health: 'healthy',
  });
  const location = getDeploymentServiceHealthObjectLocation(
    base.providerScope,
    receipt,
  );
  const healthReceipt = validateDeploymentServiceHealthObservation({
    receipt,
    object: {
      bucketName: location.bucketName,
      key: location.key,
      versionId: 'aws-plan-health-version-1',
      etag: '"aws-plan-health-etag-1"',
      lastModifiedAt: HEALTH_NOW,
    },
  });
  const substrate = resources.find(
    (/** @type {AnyRecord} */ resource) => resource.resourceKey === 'substrate',
  );
  if (substrate === undefined) throw new Error('Missing fixture substrate.');
  substrate.health = 'healthy';
  substrate.service = {
    health: 'healthy',
    artifactId: base.deploymentRevision.artifactId,
    revisionId: base.deploymentRevision.revisionId,
    healthReceipt,
  };
  return createDeploymentInspection(
    {
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpecId: base.providerSpec.providerSpecId,
      deploymentInstanceId: base.deploymentInstanceId,
      controlState: { status: 'present', evidence: 'provider-head-read' },
      incarnationId: head.incarnationId,
      headGeneration: head.generation,
      status: 'converged',
      resources,
    },
    {
      profile: base.profile,
      providerSpec: base.providerSpec,
      head,
      plan: null,
      now: HEALTH_NOW,
    },
  );
}

/** @param {Readonly<AnyRecord>} base @returns {Readonly<AnyRecord>} */
function makeAbsentInspection(base) {
  return createDeploymentInspection(
    {
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpecId: base.providerSpec.providerSpecId,
      deploymentInstanceId: base.deploymentInstanceId,
      controlState: {
        status: 'absent',
        evidence: 'authoritative-not-found',
      },
      incarnationId: null,
      headGeneration: 0,
      status: 'absent',
      resources: [],
    },
    {
      profile: base.profile,
      providerSpec: base.providerSpec,
      head: null,
      plan: null,
    },
  );
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {'apply'|'reconcile'|'destroy'} operation
 * @param {Readonly<AnyRecord>|null} head
 * @param {Readonly<AnyRecord>} inspection
 * @param {Readonly<AnyRecord>} [overrides]
 * @returns {AnyRecord}
 */
function planInput(base, operation, head, inspection, overrides = {}) {
  return {
    operation,
    deploymentRevision: base.deploymentRevision,
    profile: base.profile,
    providerScope: base.providerScope,
    providerSpec: base.providerSpec,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    head,
    inspection,
    ...overrides,
  };
}

/** @param {Readonly<AnyRecord>} plan @param {string} resourceKey @returns {Readonly<AnyRecord>} */
function actionFor(plan, resourceKey) {
  const action = plan.actions.find(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === resourceKey,
  );
  if (action === undefined) {
    throw new Error(`Missing fixture action '${resourceKey}'.`);
  }
  return action;
}

/** @param {Readonly<AnyRecord>} target @returns {Readonly<AnyRecord>} */
function targetState(target) {
  return {
    providerType: target.target.providerType,
    providerResourceId: target.target.providerResourceId,
    stateDigest: target.target.stateDigest,
  };
}

/** @param {Readonly<AnyRecord>} resource @returns {Readonly<AnyRecord>} */
function observedState(resource) {
  if (resource.providerIdentity === null || resource.observedDigest === null) {
    throw new Error(
      `Fixture resource '${resource.resourceKey}' is not present.`,
    );
  }
  return {
    providerType: resource.providerIdentity.providerType,
    providerResourceId: resource.providerIdentity.providerResourceId,
    stateDigest: resource.observedDigest,
  };
}

describe('AWS single-node deterministic deployment planning', () => {
  it('creates one deterministic deeply frozen 18-action apply plan from authoritative head absence', () => {
    const base = makeBase();
    const inspection = makeAbsentInspection(base);
    const input = planInput(base, 'apply', null, inspection);
    const first = createAwsSingleNodeDeploymentPlan(input);
    const second = createAwsSingleNodeDeploymentPlan(clone(input));
    const targets = makeTargets(base, null);

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.actions).toHaveLength(18);
    expect(
      first.actions.map(
        (/** @type {Readonly<AnyRecord>} */ action) => action.resourceKey,
      ),
    ).toEqual(getAwsSingleNodeResourceApplyOrder());
    expect(first.actions).toEqual(
      targets.map((target, index) => ({
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
        after: targetState(target),
        actionId: first.actions[index].actionId,
      })),
    );
    expect(first.basis).toEqual({
      headGeneration: 0,
      settledDeploymentRevisionId: null,
      inspectionId: inspection.inspectionId,
    });
    expect(first.summary).toEqual({
      create: 18,
      update: 0,
      delete: 0,
      verify: 0,
      noop: 0,
      destructive: false,
    });
    expect(first.actions[0].after.providerResourceId).toBe(
      providerResourceId(base, 'artifact'),
    );
    expect(
      first.actions
        .slice(1)
        .map(
          (/** @type {Readonly<AnyRecord>} */ action) =>
            action.after.providerResourceId,
        ),
    ).toEqual(Array(17).fill(null));
    expect(
      validateDeploymentPlanContext(clone(first), { profile: base.profile }),
    ).toEqual(first);
    expectDeepFrozen(first);
  });

  it.each(['apply', 'reconcile'])(
    'produces exact already-converged noops in apply order for READY %s',
    (operation) => {
      const base = makeBase();
      const head = makeReadyHead(base, makeBindings(base));
      const inspection = makeInspection(base, head);
      const plan = createAwsSingleNodeDeploymentPlan(
        planInput(
          base,
          /** @type {'apply'|'reconcile'} */ (operation),
          head,
          inspection,
        ),
      );
      const targets = makeTargets(base, head);

      expect(
        plan.actions.map(
          (/** @type {Readonly<AnyRecord>} */ action) => action.resourceKey,
        ),
      ).toEqual(getAwsSingleNodeResourceApplyOrder());
      expect(plan.actions).toEqual(
        targets.map((target, index) => ({
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
          before: targetState(target),
          after: targetState(target),
          actionId: plan.actions[index].actionId,
        })),
      );
      expect(plan.basis).toEqual({
        headGeneration: head.generation,
        settledDeploymentRevisionId:
          base.deploymentRevision.deploymentRevisionId,
        inspectionId: inspection.inspectionId,
      });
      expect(plan.summary).toEqual({
        create: 0,
        update: 0,
        delete: 0,
        verify: 0,
        noop: 18,
        destructive: false,
      });
      expectDeepFrozen(plan);
    },
  );

  it('uses a structurally valid converged health inspection without resampling a clock', () => {
    const base = makeBase();
    const head = makeReadyHead(base, makeBindings(base));
    const inspection = makeConvergedInspection(base, head);
    const input = planInput(base, 'reconcile', head, inspection);
    const plan = createAwsSingleNodeDeploymentPlan(input);

    expect(Object.keys(input).sort()).toEqual(
      [
        'operation',
        'deploymentRevision',
        'profile',
        'providerScope',
        'providerSpec',
        'deploymentInstanceId',
        'incarnationId',
        'head',
        'inspection',
      ].sort(),
    );
    expect(inspection.status).toBe('converged');
    expect(
      inspection.resources.find(
        (/** @type {Readonly<AnyRecord>} */ resource) =>
          resource.resourceKey === 'substrate',
      )?.service?.healthReceipt,
    ).not.toBeNull();
    expect(
      plan.actions.every(
        (/** @type {Readonly<AnyRecord>} */ action) => action.action === 'noop',
      ),
    ).toBe(true);
    expect(plan.basis.inspectionId).toBe(inspection.inspectionId);
  });

  it('updates only the stable artifact target for a prospective READY deployment revision', () => {
    const settled = makeBase(1);
    const desired = makeBase(2);
    const bindings = makeBindings(desired);
    const head = makeReadyHead(desired, bindings, {
      deploymentRevisionId: settled.deploymentRevision.deploymentRevisionId,
    });
    const settledHead = makeReadyHead(settled, bindings);
    const settledArtifact = makeTargets(settled, settledHead)[0];
    const inspection = makeInspection(desired, head, {
      observedDigests: {
        artifact: settledArtifact.target.stateDigest,
      },
    });
    const plan = createAwsSingleNodeDeploymentPlan(
      planInput(desired, 'apply', head, inspection),
    );
    const artifact = actionFor(plan, 'artifact');
    const desiredArtifact = makeTargets(desired, head)[0];

    expect(artifact).toMatchObject({
      action: 'update',
      destructive: false,
      reason: 'deployment-change',
      before: {
        providerType: desiredArtifact.target.providerType,
        providerResourceId: desiredArtifact.target.providerResourceId,
        stateDigest: settledArtifact.target.stateDigest,
      },
      after: targetState(desiredArtifact),
    });
    expect(artifact.before.providerResourceId).toBe(
      artifact.after.providerResourceId,
    );
    expect(
      plan.actions
        .filter(
          (/** @type {Readonly<AnyRecord>} */ action) =>
            action.resourceKey !== 'artifact',
        )
        .map((/** @type {Readonly<AnyRecord>} */ action) => [
          action.action,
          action.reason,
        ]),
    ).toEqual(Array(17).fill(['noop', 'already-converged']));
    expect(plan.basis.settledDeploymentRevisionId).toBe(
      settled.deploymentRevision.deploymentRevisionId,
    );

    for (const operation of ['reconcile', 'destroy']) {
      expectUnsupported(() =>
        createAwsSingleNodeDeploymentPlan(
          planInput(
            desired,
            /** @type {'reconcile'|'destroy'} */ (operation),
            head,
            inspection,
          ),
        ),
      );
    }
  });

  it.each([
    [
      'drifted',
      { observedDigests: { artifact: digest('artifact drift') } },
      'drift',
    ],
    ['missing', { states: { artifact: 'absent' } }, 'drift'],
  ])('repairs a bound %s artifact with update', (_case, options, reason) => {
    const base = makeBase();
    const head = makeReadyHead(base, makeBindings(base));
    const inspection = makeInspection(
      base,
      head,
      /** @type {InspectionOptions} */ (options),
    );
    const target = makeTargets(base, head)[0];

    for (const operation of ['apply', 'reconcile']) {
      const plan = createAwsSingleNodeDeploymentPlan(
        planInput(
          base,
          /** @type {'apply'|'reconcile'} */ (operation),
          head,
          inspection,
        ),
      );
      const artifact = actionFor(plan, 'artifact');
      expect(artifact.action).toBe('update');
      expect(artifact.reason).toBe(reason);
      expect(artifact.after).toEqual(targetState(target));
      expect(artifact.before.providerResourceId).toBe(
        target.target.providerResourceId,
      );
      expect(artifact.before).toEqual(
        _case === 'missing'
          ? targetState(target)
          : observedState(inspection.resources[0]),
      );
      expect(
        plan.actions.filter(
          (/** @type {Readonly<AnyRecord>} */ action) =>
            action.action === 'noop',
        ),
      ).toHaveLength(17);
    }
  });

  it.each(['apply', 'reconcile'])(
    'creates only authoritatively absent unbound leaf roles during READY %s',
    (operation) => {
      const base = makeBase();
      const missing = new Set([
        'application-state-attachment',
        'control-state-attachment',
      ]);
      const head = makeReadyHead(base, makeBindings(base, { omit: missing }));
      const inspection = makeInspection(base, head, {
        states: {
          'application-state-attachment': 'absent',
          'control-state-attachment': 'absent',
        },
      });
      const plan = createAwsSingleNodeDeploymentPlan(
        planInput(
          base,
          /** @type {'apply'|'reconcile'} */ (operation),
          head,
          inspection,
        ),
      );

      expect(
        plan.actions
          .filter(
            (/** @type {Readonly<AnyRecord>} */ action) =>
              action.action === 'create',
          )
          .map(
            (/** @type {Readonly<AnyRecord>} */ action) => action.resourceKey,
          ),
      ).toEqual(['application-state-attachment', 'control-state-attachment']);
      for (const resourceKey of missing) {
        expect(actionFor(plan, resourceKey)).toMatchObject({
          action: 'create',
          reason: 'missing',
          before: null,
          after: { providerResourceId: null },
        });
      }
      expect(
        plan.actions.filter(
          (/** @type {Readonly<AnyRecord>} */ action) =>
            action.action === 'noop',
        ),
      ).toHaveLength(16);
    },
  );

  it('refuses to adopt a provider-present resource that has no durable binding', () => {
    expect.hasAssertions();
    const base = makeBase();
    const head = makeReadyHead(
      base,
      makeBindings(base, {
        omit: new Set(['control-state-attachment']),
      }),
    );
    const inspection = makeInspection(
      base,
      makeReadyHead(base, makeBindings(base), {
        generation: head.generation,
      }),
    );

    expectUnsupported(() =>
      createAwsSingleNodeDeploymentPlan(
        planInput(base, 'apply', head, inspection),
      ),
    );
  });

  it.each(['application-state', 'application-state-attachment'])(
    'fails closed on bound non-artifact drift for %s',
    (resourceKey) => {
      expect.hasAssertions();
      const base = makeBase();
      const head = makeReadyHead(base, makeBindings(base));
      const inspection = makeInspection(base, head, {
        observedDigests: { [resourceKey]: digest(`${resourceKey} drift`) },
      });

      expectUnsupported(() =>
        createAwsSingleNodeDeploymentPlan(
          planInput(base, 'reconcile', head, inspection),
        ),
      );
    },
  );

  it.each(['application-state', 'application-state-attachment'])(
    'fails closed on authoritative absence of bound non-artifact %s',
    (resourceKey) => {
      expect.hasAssertions();
      const base = makeBase();
      const head = makeReadyHead(base, makeBindings(base));
      const inspection = makeInspection(base, head, {
        states: { [resourceKey]: 'absent' },
      });

      expectUnsupported(() =>
        createAwsSingleNodeDeploymentPlan(
          planInput(base, 'apply', head, inspection),
        ),
      );
    },
  );

  it('rejects unknown and conflicting provider authority', () => {
    expect.hasAssertions();
    const base = makeBase();
    const head = makeReadyHead(base, makeBindings(base));
    const unknown = makeInspection(base, head, {
      states: { artifact: 'unknown' },
    });
    const conflict = makeInspection(base, head, {
      states: { artifact: 'conflict' },
    });

    expectUnsupported(() =>
      createAwsSingleNodeDeploymentPlan(
        planInput(base, 'apply', head, unknown),
      ),
    );
    expectUnsupported(() =>
      createAwsSingleNodeDeploymentPlan(
        planInput(base, 'apply', head, conflict),
      ),
    );
  });

  it('rejects inspection desired-state, provider-identity, and graph mismatches', () => {
    const base = makeBase();
    const head = makeReadyHead(base, makeBindings(base));
    const wrongDesired = makeInspection(base, head, {
      desiredDigests: {
        'control-state-attachment': digest('wrong desired state'),
      },
    });
    expectUnsupported(() =>
      createAwsSingleNodeDeploymentPlan(
        planInput(base, 'apply', head, wrongDesired),
      ),
    );

    const wrongIdentityInput = /** @type {AnyRecord} */ (
      clone(makeInspection(base, head))
    );
    const wrongIdentityResource = wrongIdentityInput.resources.find(
      (/** @type {AnyRecord} */ resource) =>
        resource.resourceKey === 'substrate',
    );
    if (wrongIdentityResource === undefined) {
      throw new Error('Missing fixture substrate.');
    }
    wrongIdentityResource.providerIdentity.providerResourceId =
      'i-00000000000000002';
    const wrongIdentity = rehashInspection(wrongIdentityInput);
    expectUnsupported(() =>
      createAwsSingleNodeDeploymentPlan(
        planInput(base, 'apply', head, wrongIdentity),
      ),
    );

    const wrongGraph = clone(makeInspection(base, head));
    [wrongGraph.resources[0], wrongGraph.resources[1]] = [
      wrongGraph.resources[1],
      wrongGraph.resources[0],
    ];
    expect(() =>
      createAwsSingleNodeDeploymentPlan(
        planInput(base, 'apply', head, wrongGraph),
      ),
    ).toThrow(/graph|order|inspection/i);
  });

  it('rejects mismatched inspection tuple and basis identity', () => {
    expect.hasAssertions();
    const base = makeBase(1);
    const otherRevision = makeBase(2);
    const bindings = makeBindings(base);
    const head = makeReadyHead(base, bindings);
    const otherInspection = makeInspection(otherRevision, head, {
      observedDigests: {
        artifact: makeTargets(base, head)[0].target.stateDigest,
      },
    });
    expectUnsupported(() =>
      createAwsSingleNodeDeploymentPlan(
        planInput(base, 'apply', head, otherInspection),
      ),
    );

    const otherGenerationHead = makeReadyHead(base, bindings, {
      generation: head.generation + 1,
    });
    const otherGenerationInspection = makeInspection(base, otherGenerationHead);
    expectUnsupported(() =>
      createAwsSingleNodeDeploymentPlan(
        planInput(base, 'apply', head, otherGenerationInspection),
      ),
    );

    const otherIncarnation = createDeploymentIncarnationId(
      Buffer.alloc(32, 78),
    );
    expectUnsupported(() =>
      createAwsSingleNodeDeploymentPlan(
        planInput(base, 'apply', head, makeInspection(base, head), {
          incarnationId: otherIncarnation,
        }),
      ),
    );
  });

  it('rejects legacy InspectionV5 identities before deriving a plan', () => {
    const base = makeBase();
    const head = makeReadyHead(base, makeBindings(base));
    const inspection = /** @type {AnyRecord} */ (
      clone(makeInspection(base, head))
    );
    inspection.inspectionId = semanticId(
      'win5',
      'wharfie:deployment-inspection:v5',
      { legacy: true },
    );

    expect(() =>
      createAwsSingleNodeDeploymentPlan(
        planInput(base, 'apply', head, inspection),
      ),
    ).toThrow(/win6/i);
  });

  it('rejects active durable lifecycle phases before deriving a new plan', () => {
    expect.hasAssertions();
    const settled = makeBase(1);
    const desired = makeBase(2);
    const bindings = makeBindings(desired);
    const converging = makeConvergingHead(
      desired,
      bindings,
      settled.deploymentRevision.deploymentRevisionId,
    );
    const convergingInspection = makeInspection(
      desired,
      makeReadyHead(desired, bindings, {
        deploymentRevisionId: settled.deploymentRevision.deploymentRevisionId,
        generation: converging.generation,
      }),
    );
    expectUnsupported(() =>
      createAwsSingleNodeDeploymentPlan(
        planInput(desired, 'apply', converging, convergingInspection),
      ),
    );

    const base = makeBase();
    const destroyingBindings = makeBindings(base);
    const destroying = makeDestroyingHead(base, destroyingBindings);
    const destroyingInspection = makeInspection(
      base,
      makeReadyHead(base, destroyingBindings, {
        generation: destroying.generation,
      }),
    );
    expectUnsupported(() =>
      createAwsSingleNodeDeploymentPlan(
        planInput(base, 'destroy', destroying, destroyingInspection),
      ),
    );
  });

  it('rejects a durable DESTROYED head even when its retained-state inspection is exact', () => {
    expect.hasAssertions();
    const base = makeBase();
    const retainedKeys = new Set(['application-state', 'control-state']);
    const omit = new Set(
      getAwsSingleNodeResourceApplyOrder().filter(
        (resourceKey) => !retainedKeys.has(resourceKey),
      ),
    );
    const head = makeDestroyedHead(base, makeBindings(base, { omit }));
    const states = /** @type {Record<string, 'present'|'absent'>} */ (
      Object.fromEntries(
        getAwsSingleNodeResourceApplyOrder().map((resourceKey) => [
          resourceKey,
          retainedKeys.has(resourceKey) ? 'present' : 'absent',
        ]),
      )
    );
    const inspection = makeInspection(base, head, {
      states,
      status: 'destroyed',
    });

    for (const operation of ['apply', 'destroy']) {
      expectUnsupported(() =>
        createAwsSingleNodeDeploymentPlan(
          planInput(
            base,
            /** @type {'apply'|'destroy'} */ (operation),
            head,
            inspection,
          ),
        ),
      );
    }
  });

  it('derives exact reverse-order purge and retention actions for destroy', () => {
    const base = makeBase();
    const head = makeReadyHead(base, makeBindings(base));
    const inspection = makeInspection(base, head);
    const plan = createAwsSingleNodeDeploymentPlan(
      planInput(base, 'destroy', head, inspection),
    );

    expect(
      plan.actions.map(
        (/** @type {Readonly<AnyRecord>} */ action) => action.resourceKey,
      ),
    ).toEqual(getAwsSingleNodeResourceDestroyOrder());
    expect(
      plan.actions.filter(
        (/** @type {Readonly<AnyRecord>} */ action) =>
          action.action === 'delete',
      ),
    ).toHaveLength(16);
    expect(
      plan.actions.filter(
        (/** @type {Readonly<AnyRecord>} */ action) => action.action === 'noop',
      ),
    ).toHaveLength(2);
    for (const action of plan.actions) {
      const resource = inspection.resources.find(
        (/** @type {Readonly<AnyRecord>} */ candidate) =>
          candidate.resourceKey === action.resourceKey,
      );
      if (resource === undefined) throw new Error('Missing fixture resource.');
      if (action.onDestroy === 'retain') {
        expect(action).toMatchObject({
          action: 'noop',
          destructive: false,
          reason: 'retained-data',
          before: observedState(resource),
          after: observedState(resource),
        });
      } else {
        expect(action).toMatchObject({
          action: 'delete',
          destructive: true,
          reason: 'destroy-requested',
          before: observedState(resource),
          after: null,
        });
      }
    }
    expect(plan.basis).toEqual({
      headGeneration: head.generation,
      settledDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
      inspectionId: inspection.inspectionId,
    });
    expect(plan.summary).toEqual({
      create: 0,
      update: 0,
      delete: 16,
      verify: 0,
      noop: 2,
      destructive: true,
    });
    expectDeepFrozen(plan);
  });

  it('plans destroy from effect-ahead destroyed inspection evidence and rejects that evidence for apply or reconcile', () => {
    const base = makeBase();
    const head = makeReadyHead(base, makeBindings(base));
    const states = /** @type {Record<string, 'present'|'absent'>} */ (
      Object.fromEntries(
        AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.map(
          (/** @type {Readonly<AnyRecord>} */ resource) => [
            resource.resourceKey,
            resource.onDestroy === 'retain' ? 'present' : 'absent',
          ],
        ),
      )
    );
    const inspection = makeInspection(base, head, {
      states,
      status: 'destroyed',
    });
    const plan = createAwsSingleNodeDeploymentPlan(
      planInput(base, 'destroy', head, inspection),
    );
    const targets = new Map(
      makeTargets(base, head).map((target) => [target.resourceKey, target]),
    );

    expect(
      plan.actions.filter(
        (/** @type {Readonly<AnyRecord>} */ action) =>
          action.action === 'delete',
      ),
    ).toHaveLength(16);
    for (const action of plan.actions.filter(
      (/** @type {Readonly<AnyRecord>} */ candidate) =>
        candidate.action === 'delete',
    )) {
      const target = targets.get(action.resourceKey);
      if (target === undefined) throw new Error('Missing fixture target.');
      expect(action.before).toEqual(targetState(target));
      expect(action.after).toBeNull();
      expect(action.reason).toBe('destroy-requested');
    }
    for (const operation of ['apply', 'reconcile']) {
      expectUnsupported(() =>
        createAwsSingleNodeDeploymentPlan(
          planInput(
            base,
            /** @type {'apply'|'reconcile'} */ (operation),
            head,
            inspection,
          ),
        ),
      );
    }
  });

  it('uses observed drift as destroy before-state for all generic purge roles', () => {
    const base = makeBase();
    const head = makeReadyHead(base, makeBindings(base));
    const desiredOnly = new Set([
      'artifact',
      'application-state-attachment',
      'control-state-attachment',
    ]);
    const genericPurgeKeys = AWS_SINGLE_NODE_RESOURCE_GRAPH.resources
      .filter(
        (/** @type {Readonly<AnyRecord>} */ resource) =>
          resource.onDestroy === 'purge' &&
          !desiredOnly.has(resource.resourceKey),
      )
      .map(
        (/** @type {Readonly<AnyRecord>} */ resource) => resource.resourceKey,
      );
    const observedDigests = Object.fromEntries(
      genericPurgeKeys.map((/** @type {string} */ resourceKey) => [
        resourceKey,
        digest(`destroy ${resourceKey} drift`),
      ]),
    );
    const inspection = makeInspection(base, head, { observedDigests });
    const plan = createAwsSingleNodeDeploymentPlan(
      planInput(base, 'destroy', head, inspection),
    );

    expect(genericPurgeKeys).toHaveLength(13);
    for (const resourceKey of genericPurgeKeys) {
      const action = actionFor(plan, resourceKey);
      const resource = inspection.resources.find(
        (/** @type {Readonly<AnyRecord>} */ candidate) =>
          candidate.resourceKey === resourceKey,
      );
      if (resource === undefined) throw new Error('Missing fixture resource.');
      expect(action.before).toEqual(observedState(resource));
      expect(action).toMatchObject({
        action: 'delete',
        reason: 'destroy-requested',
        after: null,
      });
    }
  });

  it.each([
    'artifact',
    'application-state',
    'control-state',
    'application-state-attachment',
    'control-state-attachment',
  ])('refuses destroy when desired-only role %s is drifted', (resourceKey) => {
    expect.hasAssertions();
    const base = makeBase();
    const head = makeReadyHead(base, makeBindings(base));
    const inspection = makeInspection(base, head, {
      observedDigests: {
        [resourceKey]: digest(`unsafe destroy ${resourceKey} drift`),
      },
    });

    expectUnsupported(() =>
      createAwsSingleNodeDeploymentPlan(
        planInput(base, 'destroy', head, inspection),
      ),
    );
  });

  it('refuses destroy when any graph role lacks its exact durable binding', () => {
    expect.hasAssertions();
    const base = makeBase();
    const head = makeReadyHead(
      base,
      makeBindings(base, { omit: new Set(['control-state-attachment']) }),
    );
    const inspection = makeInspection(base, head, {
      states: { 'control-state-attachment': 'absent' },
    });

    expectUnsupported(() =>
      createAwsSingleNodeDeploymentPlan(
        planInput(base, 'destroy', head, inspection),
      ),
    );
  });

  it('enforces operation/head/revision correlation and exact own input keys', () => {
    const base = makeBase();
    const absent = makeAbsentInspection(base);
    for (const operation of ['reconcile', 'destroy']) {
      expectUnsupported(() =>
        createAwsSingleNodeDeploymentPlan(
          planInput(
            base,
            /** @type {'reconcile'|'destroy'} */ (operation),
            null,
            absent,
          ),
        ),
      );
    }

    const head = makeReadyHead(base, makeBindings(base));
    const inspection = makeInspection(base, head);
    const exact = planInput(base, 'apply', head, inspection);
    expect(() =>
      createAwsSingleNodeDeploymentPlan({ ...exact, observationNow: 1 }),
    ).toThrow(/observationNow|supported|key/i);
    const missing = clone(exact);
    delete missing.inspection;
    expect(() => createAwsSingleNodeDeploymentPlan(missing)).toThrow(
      /inspection|required/i,
    );
    expect(() => createAwsSingleNodeDeploymentPlan(null)).toThrow(/object/i);
    expect(() =>
      createAwsSingleNodeDeploymentPlan({ ...exact, operation: 'verify' }),
    ).toThrow(/operation|supported/i);

    const inherited = Object.create({ inspection });
    Object.assign(inherited, clone(exact));
    delete inherited.inspection;
    expect(() => createAwsSingleNodeDeploymentPlan(inherited)).toThrow(
      /JSON object/i,
    );
  });
});
