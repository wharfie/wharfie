import { describe, expect, it, jest } from '@jest/globals';

import { compareCanonicalStrings } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import { getAwsSingleNodeDefaultIpv4RouteProviderResourceId } from '../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource.js';
import { getAwsSingleNodeManagedArtifactStateDigest } from '../../src/core/runtime/deployment-aws-managed-artifact-evidence.js';
import {
  AwsSingleNodeManagedArtifactResourceObserverAuthorityError,
  createAwsSingleNodeManagedArtifactResourceObserver,
} from '../../src/core/runtime/deployment-aws-managed-artifact-resource-observer.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { createAwsSingleNodeResourceObservationAuthority } from '../../src/core/runtime/deployment-aws-resource-observation-authority.js';
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
import { getAwsSingleNodeResourceDestroyOrder } from '../../src/core/runtime/deployment-resource-graph.js';
import { validateDeploymentRevision } from '../../src/core/runtime/deployment-revision.js';

/** @typedef {Record<string, any>} AnyRecord */

const ROLE_ID = 'AROA1234567890EXAMPLE';
const PROFILE_ID = 'AIPA1234567890EXAMPLE';
const SUBSTRATE_ID = 'i-00000000000000001';

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
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

/** @param {Readonly<AnyRecord>} profile @param {number} number */
function makeRevision(profile, number) {
  const payload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'production' },
    appId: profile.appId,
    revisionId: semanticId(
      'wrv1',
      'wharfie:test:managed-artifact-observer-revision:v1',
      { number },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: `managed artifact observer bytes ${number}`,
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

/** @returns {Readonly<AnyRecord>} */
function makeBase() {
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'managed-artifact-resource-observer-test',
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider('us-east-1'),
  });
  const deploymentRevision = makeRevision(profile, 2);
  const previousDeploymentRevision = makeRevision(profile, 1);
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
  return Object.freeze({
    profile,
    deploymentRevision,
    previousDeploymentRevision,
    providerScope,
    providerSpec,
    deploymentInstanceId: getDeploymentInstanceId({
      deploymentRevision,
      providerScope,
    }),
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 77)),
  });
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>|null} head */
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

/** @param {ReadonlyArray<Readonly<AnyRecord>>} targets @param {string} resourceKey */
function targetFor(targets, resourceKey) {
  const target = targets.find(
    (candidate) => candidate.resourceKey === resourceKey,
  );
  if (target === undefined) throw new Error(`Missing target '${resourceKey}'.`);
  return target;
}

/** @param {Readonly<AnyRecord>} base */
function makeCreatePlan(base) {
  const targets = makeTargets(base, null);
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
          'win5',
          'wharfie:test:managed-artifact-observer-inspection:v1',
          {},
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
        after: target.target,
      })),
    },
    { profile: base.profile },
  );
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>} action */
function providerResourceId(base, action) {
  const vpcId = 'vpc-00000000000000001';
  const internetGatewayId = 'igw-00000000000000001';
  const subnetId = 'subnet-00000000000000001';
  const routeTableId = 'rtb-00000000000000001';
  /** @type {Record<string, string>} */
  const ids = {
    'application-state': 'vol-00000000000000001',
    'control-state': 'vol-00000000000000002',
    'network-vpc': vpcId,
    'network-internet-gateway': internetGatewayId,
    'network-internet-gateway-attachment':
      getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
        internetGatewayId,
        vpcId,
      ),
    'network-subnet': subnetId,
    'network-route-table': routeTableId,
    'network-default-ipv4-route':
      getAwsSingleNodeDefaultIpv4RouteProviderResourceId(
        base.providerSpec.capabilities.networking.egressCidr,
        internetGatewayId,
        routeTableId,
      ),
    'network-subnet-route-table-association':
      getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId(
        routeTableId,
        subnetId,
      ),
    'network-security-group': 'sg-00000000000000001',
    'runtime-role': ROLE_ID,
  };
  if (action.resourceKey === 'artifact') {
    return getAwsSingleNodeManagedArtifactObjectLocation({
      providerScope: base.providerScope,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
    }).arn;
  }
  if (action.resourceKey === 'runtime-role-policy') {
    return getAwsSingleNodeRuntimePolicyProviderResourceId({
      runtimeRoleId: ROLE_ID,
    });
  }
  if (action.resourceKey === 'runtime-identity') return PROFILE_ID;
  if (action.resourceKey === 'runtime-identity-role-association') {
    return getAwsSingleNodeRuntimeAssociationProviderResourceId({
      runtimeRoleId: ROLE_ID,
      instanceProfileId: PROFILE_ID,
    });
  }
  if (action.resourceKey === 'substrate') return SUBSTRATE_ID;
  if (action.resourceKey === 'application-state-attachment') {
    return getAwsSingleNodeVolumeAttachmentProviderResourceId(
      base.providerSpec,
      'application-state',
      SUBSTRATE_ID,
      'vol-00000000000000001',
    );
  }
  if (action.resourceKey === 'control-state-attachment') {
    return getAwsSingleNodeVolumeAttachmentProviderResourceId(
      base.providerSpec,
      'control-state',
      SUBSTRATE_ID,
      'vol-00000000000000002',
    );
  }
  return ids[action.resourceKey] ?? `provider-${action.resourceKey}`;
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>} plan @param {ReadonlyArray<Readonly<AnyRecord>>} intents @param {number} frontier */
function makePrefixBindings(base, plan, intents, frontier) {
  /** @type {Map<string, Readonly<AnyRecord>>} */
  const byKey = new Map();
  /** @type {Readonly<AnyRecord>[]} */
  const bindings = [];
  for (const action of plan.actions.slice(0, frontier)) {
    const index = plan.actions.indexOf(action);
    const dependencyBindings = action.dependsOn
      .map((/** @type {string} */ resourceKey) => {
        const dependency = byKey.get(resourceKey);
        if (dependency === undefined) {
          throw new Error(`Missing dependency binding '${resourceKey}'.`);
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
      resourceKey: action.resourceKey,
      capability: action.capability,
      role: action.role,
      management: action.management,
      ownershipMode: action.ownershipMode,
      onDestroy: action.onDestroy,
      dependencyBindings,
      providerType: action.after.providerType,
      providerResourceId: providerResourceId(base, action),
      providerScopeId: base.providerScope.providerScopeId,
      ownershipNonce: intents[index].ownershipNonce,
      createdByActionId: action.actionId,
    });
    bindings.push(binding);
    byKey.set(action.resourceKey, binding);
  }
  return bindings;
}

/** @param {'bound'|'current-create'|'unbound'} mode */
function makeApplyFixture(mode) {
  const base = makeBase();
  const plan = makeCreatePlan(base);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'artifact',
  );
  const frontier = mode === 'bound' ? actionIndex + 1 : actionIndex;
  const frontierStatus = mode === 'current-create' ? 'intended' : 'pending';
  const intents = plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ action,
      /** @type {number} */ index,
    ) => ({
      actionId: action.actionId,
      status:
        index < frontier
          ? 'settled'
          : index === frontier
            ? frontierStatus
            : 'pending',
      ownershipNonce: nonce(100 + index),
    }),
  );
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 2 + frontier * 2,
    phase: 'CONVERGING',
    settledDeploymentRevisionId: null,
    targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    resourceBindings: makePrefixBindings(base, plan, intents, frontier),
    activeOperation: {
      kind: 'create',
      planId: plan.planId,
      status: 'running',
      nextActionIndex: frontier,
      intents,
    },
    lastOperation: null,
  });
  const target = targetFor(makeTargets(base, head), 'artifact');
  const authority = createAwsSingleNodeResourceObservationAuthority({
    operation: 'apply',
    deploymentRevision: base.deploymentRevision,
    profile: base.profile,
    providerScope: base.providerScope,
    providerSpec: base.providerSpec,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    head,
    plan,
    settledPlan: null,
    target,
  });
  return Object.freeze({
    mode,
    base,
    plan,
    actionIndex,
    head,
    target,
    authority,
  });
}

/** @returns {Readonly<AnyRecord>} */
function makeDeleteFixture() {
  const base = makeBase();
  const settledPlan = makeCreatePlan(base);
  const settledIntents = settledPlan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ action,
      /** @type {number} */ index,
    ) => ({
      actionId: action.actionId,
      status: 'settled',
      ownershipNonce: nonce(100 + index),
    }),
  );
  const settledBindings = makePrefixBindings(
    base,
    settledPlan,
    settledIntents,
    settledPlan.actions.length,
  );
  const readyHead = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 2 + settledPlan.actions.length * 2,
    phase: 'READY',
    settledDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    resourceBindings: settledBindings,
    activeOperation: null,
    lastOperation: {
      kind: 'create',
      planId: settledPlan.planId,
      intents: settledIntents,
    },
  });
  const bindingByKey = new Map(
    settledBindings.map((binding) => [binding.resourceKey, binding]),
  );
  const targetByKey = new Map(
    makeTargets(base, readyHead).map((target) => [target.resourceKey, target]),
  );
  const plan = createDeploymentPlan(
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
          'win5',
          'wharfie:test:managed-artifact-observer-delete-inspection:v1',
          { headId: readyHead.headId },
        ),
      },
      actions: getAwsSingleNodeResourceDestroyOrder().map((resourceKey) => {
        const target = targetByKey.get(resourceKey);
        const binding = bindingByKey.get(resourceKey);
        if (target === undefined || binding === undefined) {
          throw new Error(`Missing destroy fixture '${resourceKey}'.`);
        }
        const before = {
          providerType: target.target.providerType,
          providerResourceId: binding.providerResourceId,
          stateDigest: target.target.stateDigest,
        };
        const retained = target.onDestroy === 'retain';
        return {
          resourceKey: target.resourceKey,
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
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'artifact',
  );
  const intents = plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ action,
      /** @type {number} */ index,
    ) => ({
      actionId: action.actionId,
      status:
        index < actionIndex
          ? 'settled'
          : index === actionIndex
            ? 'intended'
            : 'pending',
      ownershipNonce:
        bindingByKey.get(action.resourceKey)?.ownershipNonce ?? null,
    }),
  );
  const deletedKeys = new Set(
    plan.actions
      .slice(0, actionIndex)
      .filter(
        (/** @type {Readonly<AnyRecord>} */ action) =>
          action.action === 'delete',
      )
      .map((/** @type {Readonly<AnyRecord>} */ action) => action.resourceKey),
  );
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: readyHead.generation + 2 + actionIndex * 2,
    phase: 'DESTROYING',
    settledDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: null,
    resourceBindings: settledBindings.filter(
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
  const target = targetFor(makeTargets(base, head), 'artifact');
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
    mode: 'current-delete',
    base,
    plan,
    actionIndex,
    head,
    target,
    authority,
  });
}

/** @param {Readonly<AnyRecord>} base */
function location(base) {
  return getAwsSingleNodeManagedArtifactObjectLocation({
    providerScope: base.providerScope,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
  });
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} revision */
function stateDigest(fixture, revision) {
  return getAwsSingleNodeManagedArtifactStateDigest({
    deploymentRevision: revision,
    profile: fixture.base.profile,
    providerScope: fixture.base.providerScope,
    providerSpec: fixture.base.providerSpec,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
  });
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} revision */
function metadata(fixture, revision) {
  const binding = fixture.authority.binding;
  const currentAction = fixture.authority.currentAction;
  if (binding === null && currentAction === null) {
    throw new Error('Fixture has no artifact ownership authority.');
  }
  return {
    'wharfie-schema': 'deployment-managed-artifact-v1',
    'wharfie-managed-by': 'wharfie',
    'wharfie-resource-kind': 'single-node-managed-artifact',
    'wharfie-retention': 'purge',
    'wharfie-capability': 'artifact-storage',
    'wharfie-role': 'object',
    'wharfie-provider-scope-id': fixture.base.providerScope.providerScopeId,
    'wharfie-deployment-instance-id': fixture.base.deploymentInstanceId,
    'wharfie-incarnation-id': fixture.base.incarnationId,
    'wharfie-resource-key': 'artifact',
    'wharfie-created-by-action-id':
      binding?.createdByActionId ?? currentAction.action.actionId,
    'wharfie-ownership-nonce':
      binding?.ownershipNonce ?? currentAction.ownershipNonce,
    'wharfie-state-digest': stateDigest(fixture, revision).value,
    'wharfie-deployment-revision-id': revision.deploymentRevisionId,
    'wharfie-profile-revision-id': revision.profileRevisionId,
    'wharfie-app-id': revision.appId,
    'wharfie-revision-id': revision.revisionId,
    'wharfie-artifact-id': revision.artifactId,
    'wharfie-content-length': '137',
    'wharfie-stage-intent-id': semanticId(
      'wsi1',
      'wharfie:test:managed-artifact-observer-stage-intent:v1',
      { revisionId: revision.revisionId },
    ),
    'wharfie-stage-receipt-id': semanticId(
      'wsr1',
      'wharfie:test:managed-artifact-observer-stage-receipt:v1',
      { revisionId: revision.revisionId },
    ),
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} [revision] @param {Record<string, any>} [overrides] */
function managedHead(
  fixture,
  revision = fixture.base.deploymentRevision,
  overrides = {},
) {
  return {
    VersionId: 'managed-version',
    ETag: '"managed-etag"',
    ContentLength: 137,
    ChecksumSHA256: Buffer.from(
      revision.artifactId.slice('waf1_'.length),
      'base64url',
    ).toString('base64'),
    ServerSideEncryption: 'AES256',
    StorageClass: 'STANDARD',
    ContentType: 'application/octet-stream',
    CacheControl: 'no-store',
    Metadata: metadata(fixture, revision),
    ...overrides,
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} head @param {boolean} [isLatest] */
function listedVersion(fixture, head, isLatest = true) {
  return {
    Key: location(fixture.base).key,
    VersionId: head.VersionId,
    IsLatest: isLatest,
    ETag: head.ETag,
    Size: head.ContentLength,
    StorageClass: 'STANDARD',
    ChecksumAlgorithm: ['SHA256'],
    __head: head,
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {AnyRecord[]} versions @param {AnyRecord[]} markers @param {Record<string, any>} [overrides] */
function historyPage(fixture, versions, markers, overrides = {}) {
  return {
    Name: location(fixture.base).bucketName,
    Prefix: location(fixture.base).key,
    MaxKeys: 1000,
    EncodingType: 'url',
    IsTruncated: false,
    Versions: versions.map(({ __head: _head, ...version }) => version),
    DeleteMarkers: markers,
    ...overrides,
  };
}

/** @param {string} name */
function providerError(name) {
  return Object.assign(new Error('provider-secret-detail'), { name });
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [options] */
function makeClient(fixture, options = {}) {
  const versions = /** @type {AnyRecord[]} */ (options.versions ?? []);
  const markers = /** @type {AnyRecord[]} */ (options.markers ?? []);
  const current = Object.hasOwn(options, 'current')
    ? options.current
    : (versions.find((/** @type {AnyRecord} */ version) => version.IsLatest)
        ?.__head ?? null);
  return Object.freeze({
    headObject:
      options.headObject ??
      jest.fn(async (/** @type {AnyRecord} */ request) => {
        if (request.VersionId !== undefined) {
          const version = versions.find(
            (/** @type {AnyRecord} */ candidate) =>
              candidate.VersionId === request.VersionId,
          );
          if (version?.__head === undefined) {
            throw providerError('NoSuchVersion');
          }
          return clone(version.__head);
        }
        if (current === null) throw providerError('NotFound');
        return clone(current);
      }),
    listObjectVersions:
      options.listObjectVersions ??
      jest.fn(async () => historyPage(fixture, versions, markers)),
  });
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} client @param {Record<string, any>} [options] */
function observerFor(fixture, client, options = {}) {
  return createAwsSingleNodeManagedArtifactResourceObserver({
    client,
    providerScope: fixture.base.providerScope,
    maxAttempts: options.maxAttempts ?? 1,
    waitForRetry: options.waitForRetry ?? (async () => {}),
  });
}

/** @param {'present'|'absent'|'unknown'} presence @param {'verified'|'missing'|'conflict'|'unknown'} ownership @param {Readonly<AnyRecord>|null} providerIdentity @param {Readonly<AnyRecord>|null} observedDigest */
function expectedObservation(
  presence,
  ownership,
  providerIdentity,
  observedDigest,
) {
  return {
    resourceKey: 'artifact',
    presence,
    ownership,
    providerIdentity,
    observedDigest,
    health:
      presence === 'present'
        ? 'not-applicable'
        : presence === 'absent'
          ? 'absent'
          : 'unknown',
    execution: 'none',
  };
}

describe('AWS single-node managed artifact resource observer authority', () => {
  it('constructs without I/O and accepts exactly two read methods', () => {
    const fixture = makeApplyFixture('bound');
    const client = makeClient(fixture);
    const observer = observerFor(fixture, client);

    expect(Object.keys(observer)).toEqual(['observe']);
    expectDeepFrozen(observer);
    expect(client.headObject).not.toHaveBeenCalled();
    expect(client.listObjectVersions).not.toHaveBeenCalled();
    expect(() =>
      createAwsSingleNodeManagedArtifactResourceObserver({
        client: { ...client, copyObject: jest.fn() },
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(/copyObject is not supported/);
  });

  it('re-proves derived V48 binding authority before provider I/O', async () => {
    const fixture = makeApplyFixture('bound');
    const forged = clone(fixture.authority);
    forged.binding.ownershipNonce = nonce(250);
    const client = makeClient(fixture);

    await expect(
      observerFor(fixture, client).observe(forged),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeManagedArtifactResourceObserverAuthorityError,
    );
    expect(client.headObject).not.toHaveBeenCalled();
    expect(client.listObjectVersions).not.toHaveBeenCalled();
  });
});

describe('AWS single-node managed artifact resource observation', () => {
  it('audits complete history and reports deeply frozen verified actual state', async () => {
    const fixture = makeApplyFixture('bound');
    const head = managedHead(fixture);
    const versions = [listedVersion(fixture, head)];
    const client = makeClient(fixture, { versions });
    const result = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(result).toEqual(
      expectedObservation(
        'present',
        'verified',
        {
          providerType: 's3-object',
          providerResourceId: location(fixture.base).arn,
        },
        stateDigest(fixture, fixture.base.deploymentRevision),
      ),
    );
    expectDeepFrozen(result);
    expect(client.listObjectVersions).toHaveBeenCalledTimes(1);
    expect(client.headObject).toHaveBeenCalledTimes(2);
    for (const [request] of [
      ...client.listObjectVersions.mock.calls,
      ...client.headObject.mock.calls,
    ]) {
      expectDeepFrozen(request);
    }
  });

  it('returns readable owned drift as a verified actual digest', async () => {
    const fixture = makeApplyFixture('bound');
    const head = managedHead(fixture, fixture.base.previousDeploymentRevision);
    const result = await observerFor(
      fixture,
      makeClient(fixture, {
        versions: [listedVersion(fixture, head)],
      }),
    ).observe(fixture.authority);

    expect(result).toEqual(
      expectedObservation(
        'present',
        'verified',
        {
          providerType: 's3-object',
          providerResourceId: location(fixture.base).arn,
        },
        stateDigest(fixture, fixture.base.previousDeploymentRevision),
      ),
    );
  });

  it('accepts only one exact desired version during current create', async () => {
    const fixture = makeApplyFixture('current-create');
    const desired = managedHead(fixture);
    const verified = await observerFor(
      fixture,
      makeClient(fixture, {
        versions: [listedVersion(fixture, desired)],
      }),
    ).observe(fixture.authority);
    expect(verified).toEqual(
      expectedObservation(
        'present',
        'verified',
        {
          providerType: 's3-object',
          providerResourceId: location(fixture.base).arn,
        },
        stateDigest(fixture, fixture.base.deploymentRevision),
      ),
    );

    const drift = managedHead(fixture, fixture.base.previousDeploymentRevision);
    await expect(
      observerFor(
        fixture,
        makeClient(fixture, {
          versions: [listedVersion(fixture, drift)],
        }),
      ).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation(
        'present',
        'conflict',
        {
          providerType: 's3-object',
          providerResourceId: location(fixture.base).arn,
        },
        null,
      ),
    );
  });

  it('keeps repeated current-create empty history unknown', async () => {
    const fixture = makeApplyFixture('current-create');
    const client = makeClient(fixture, { current: null });
    const result = await observerFor(fixture, client, {
      maxAttempts: 2,
    }).observe(fixture.authority);

    expect(result).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(client.listObjectVersions).toHaveBeenCalledTimes(2);
    expect(client.headObject).toHaveBeenCalledTimes(2);
  });

  it('reports clean empty unbound and bound namespaces absent', async () => {
    for (const mode of /** @type {('unbound'|'bound')[]} */ ([
      'unbound',
      'bound',
    ])) {
      const fixture = makeApplyFixture(mode);
      const client = makeClient(fixture, { current: null });
      await expect(
        observerFor(fixture, client, { maxAttempts: 2 }).observe(
          fixture.authority,
        ),
      ).resolves.toEqual(expectedObservation('absent', 'missing', null, null));
      expect(client.listObjectVersions).toHaveBeenCalledTimes(2);
      expect(client.headObject).toHaveBeenCalledTimes(2);
    }
  });

  it('never adopts exact-key history without durable ownership authority', async () => {
    const fixture = makeApplyFixture('unbound');
    const foreignHead = {
      VersionId: 'foreign-version',
      ETag: '"foreign"',
      ContentLength: 7,
    };
    const versions = [listedVersion(fixture, foreignHead)];
    const client = makeClient(fixture, { versions, current: foreignHead });

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation(
        'present',
        'conflict',
        {
          providerType: 's3-object',
          providerResourceId: location(fixture.base).arn,
        },
        null,
      ),
    );
    expect(client.headObject).not.toHaveBeenCalled();
  });

  it('preserves a first-page unbound history conflict over a later-page failure', async () => {
    const fixture = makeApplyFixture('unbound');
    const listObjectVersions = jest
      .fn(
        async (/** @type {AnyRecord} */ _input) =>
          /** @type {AnyRecord} */ ({}),
      )
      .mockResolvedValueOnce(
        /** @type {AnyRecord} */ (
          historyPage(
            fixture,
            [],
            [
              {
                Key: location(fixture.base).key,
                VersionId: 'foreign-delete-marker',
                IsLatest: true,
              },
            ],
            {
              IsTruncated: true,
              NextKeyMarker: location(fixture.base).key,
              NextVersionIdMarker: 'later-page',
            },
          )
        ),
      )
      .mockRejectedValueOnce(new Error('provider-secret-later-page'));
    const client = makeClient(fixture, { listObjectVersions });

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation(
        'present',
        'conflict',
        {
          providerType: 's3-object',
          providerResourceId: location(fixture.base).arn,
        },
        null,
      ),
    );
    expect(listObjectVersions).toHaveBeenCalledTimes(1);
    expect(client.headObject).not.toHaveBeenCalled();
  });

  it('treats fully audited retained history ending in a delete marker as bound absence', async () => {
    for (const fixture of [makeApplyFixture('bound'), makeDeleteFixture()]) {
      const retainedHead = managedHead(fixture);
      const client = makeClient(fixture, {
        current: null,
        versions: [listedVersion(fixture, retainedHead, false)],
        markers: [
          {
            Key: location(fixture.base).key,
            VersionId: 'delete-marker',
            IsLatest: true,
          },
        ],
      });

      await expect(
        observerFor(fixture, client).observe(fixture.authority),
      ).resolves.toEqual(expectedObservation('absent', 'missing', null, null));
      expect(client.listObjectVersions).toHaveBeenCalledTimes(1);
      expect(client.headObject).toHaveBeenCalledTimes(2);
    }
  });

  it('keeps retained delete markers conflicting without durable binding', async () => {
    for (const mode of /** @type {('unbound'|'current-create')[]} */ ([
      'unbound',
      'current-create',
    ])) {
      const fixture = makeApplyFixture(mode);
      const client = makeClient(fixture, {
        current: null,
        markers: [
          {
            Key: location(fixture.base).key,
            VersionId: 'delete-marker',
            IsLatest: true,
          },
        ],
      });

      await expect(
        observerFor(fixture, client).observe(fixture.authority),
      ).resolves.toEqual(
        expectedObservation(
          'present',
          'conflict',
          {
            providerType: 's3-object',
            providerResourceId: location(fixture.base).arn,
          },
          null,
        ),
      );
    }
  });

  it('keeps current-delete content verified and recognizes a complete purge', async () => {
    const fixture = makeDeleteFixture();
    const head = managedHead(fixture);
    await expect(
      observerFor(
        fixture,
        makeClient(fixture, {
          versions: [listedVersion(fixture, head)],
        }),
      ).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation(
        'present',
        'verified',
        {
          providerType: 's3-object',
          providerResourceId: location(fixture.base).arn,
        },
        stateDigest(fixture, fixture.base.deploymentRevision),
      ),
    );
    await expect(
      observerFor(fixture, makeClient(fixture, { current: null })).observe(
        fixture.authority,
      ),
    ).resolves.toEqual(expectedObservation('absent', 'missing', null, null));
  });

  it('retries unknown provider envelopes without leaking provider details', async () => {
    const fixture = makeApplyFixture('bound');
    const waitForRetry = jest.fn(async () => {});
    let call = 0;
    const listObjectVersions = jest.fn(async () => {
      call += 1;
      if (call === 1) throw new Error('provider-secret-detail');
      return { malformed: 'provider-secret-detail' };
    });
    const result = await observerFor(
      fixture,
      makeClient(fixture, { listObjectVersions }),
      { maxAttempts: 2, waitForRetry },
    ).observe(fixture.authority);

    expect(result).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(JSON.stringify(result)).not.toContain('provider-secret-detail');
    expect(waitForRetry).toHaveBeenCalledTimes(1);
  });
});
