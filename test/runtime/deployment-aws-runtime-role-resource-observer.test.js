import { describe, expect, it, jest } from '@jest/globals';

import { compareCanonicalStrings } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { getAwsSingleNodeDefaultIpv4RouteProviderResourceId } from '../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource.js';
import {
  AwsSingleNodeRuntimeRoleResourceObserverAuthorityError,
  createAwsSingleNodeRuntimeRoleResourceObserver,
} from '../../src/core/runtime/deployment-aws-runtime-role-resource-observer.js';
import { createAwsSingleNodeResourceObservationAuthority } from '../../src/core/runtime/deployment-aws-resource-observation-authority.js';
import {
  AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
  AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  createAwsSingleNodeRuntimeIdentityTags,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimeRoleName,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
  getAwsSingleNodeRuntimeRoleTrustPolicy,
} from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
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
import { getAwsSingleNodeVolumeAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-volume-attachment-resource.js';
import { getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId } from '../../src/core/runtime/deployment-aws-subnet-route-table-association-resource.js';

/** @typedef {Record<string, any>} AnyRecord */

const ROLE_ID = 'AROA1234567890EXAMPLE';
const OTHER_ROLE_ID = 'AROA0987654321EXAMPLE';
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

function makeBase() {
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'runtime-role-resource-observer-test',
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
    revisionId: semanticId(
      'wrv1',
      'wharfie:test:runtime-role-resource-observer-revision:v1',
      {},
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'runtime role observer artifact',
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
  return Object.freeze({
    profile,
    deploymentRevision,
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
          'wharfie:test:runtime-role-resource-observer-inspection:v1',
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
  const byKey = new Map();
  const bindings = [];
  for (const action of plan.actions.slice(0, frontier)) {
    const index = plan.actions.indexOf(action);
    const dependencyBindings = action.dependsOn
      .map((/** @type {string} */ resourceKey) => {
        const dependency = byKey.get(resourceKey);
        if (dependency === undefined) {
          throw new Error(`Missing dependency binding '${resourceKey}'.`);
        }
        return {
          resourceKey,
          bindingId: dependency.bindingId,
        };
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

/** @param {{mode?: 'bound'|'current-create'|'unbound'}} [options] */
function makeFixture(options = {}) {
  const mode = options.mode ?? 'bound';
  const base = makeBase();
  const plan = makeCreatePlan(base);
  const roleIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'runtime-role',
  );
  const roleAction = plan.actions[roleIndex];
  const frontier =
    mode === 'bound'
      ? roleIndex + 1
      : mode === 'current-create'
        ? roleIndex
        : 0;
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
            ? 'intended'
            : 'pending',
      ownershipNonce: nonce(100 + index),
    }),
  );
  const resourceBindings = makePrefixBindings(base, plan, intents, frontier);
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation: 1 + frontier * 2 + 1,
    phase: 'CONVERGING',
    settledDeploymentRevisionId: null,
    targetDeploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
    resourceBindings,
    activeOperation: {
      kind: 'create',
      planId: plan.planId,
      status: 'running',
      nextActionIndex: frontier,
      intents,
    },
    lastOperation: null,
  });
  const target = targetFor(makeTargets(base, head), 'runtime-role');
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
    roleAction,
    roleIndex,
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
          'wharfie:test:runtime-role-resource-observer-delete-inspection:v1',
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
      action.resourceKey === 'runtime-role',
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
  const target = targetFor(makeTargets(base, head), 'runtime-role');
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
    settledPlan,
    roleAction: settledPlan.actions.find(
      (/** @type {Readonly<AnyRecord>} */ action) =>
        action.resourceKey === 'runtime-role',
    ),
    actionIndex,
    head,
    target,
    authority,
  });
}

/** @param {Readonly<AnyRecord>} fixture */
function expectedTags(fixture) {
  const binding = fixture.authority.binding;
  const currentAction = fixture.authority.currentAction;
  const ownershipNonce =
    binding === null ? currentAction.ownershipNonce : binding.ownershipNonce;
  return createAwsSingleNodeRuntimeIdentityTags({
    resourceKind: 'single-node-runtime-role',
    capabilityKind: 'runtime-identity',
    roleKind: 'role',
    providerScopeId: fixture.base.providerScope.providerScopeId,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
    resourceKey: 'runtime-role',
    createdByActionId:
      binding === null
        ? currentAction.action.actionId
        : binding.createdByActionId,
    ownershipNonce,
    stateDigest: fixture.target.target.stateDigest,
  });
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [overrides] */
function makeRole(fixture, overrides = {}) {
  const authority = {
    providerScopeId: fixture.base.providerScope.providerScopeId,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
  };
  const roleName = getAwsSingleNodeRuntimeRoleName(authority);
  return {
    Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
    RoleName: roleName,
    RoleId: ROLE_ID,
    Arn: `arn:aws:iam::123456789012:role${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${roleName}`,
    Description: AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
    MaxSessionDuration: AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
    AssumeRolePolicyDocument: encodeURIComponent(
      JSON.stringify(getAwsSingleNodeRuntimeRoleTrustPolicy()),
    ),
    ...overrides,
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [options] */
function makeClient(fixture, options = {}) {
  const tags = fixture.mode === 'unbound' ? [] : expectedTags(fixture);
  return Object.freeze({
    getRole:
      options.getRole ?? jest.fn(async () => ({ Role: makeRole(fixture) })),
    listRoleTags:
      options.listRoleTags ??
      jest.fn(async () => ({ Tags: tags, IsTruncated: false })),
    listRolePolicies:
      options.listRolePolicies ??
      jest.fn(async () => ({ PolicyNames: [], IsTruncated: false })),
    listAttachedRolePolicies:
      options.listAttachedRolePolicies ??
      jest.fn(async () => ({ AttachedPolicies: [], IsTruncated: false })),
    listInstanceProfilesForRole:
      options.listInstanceProfilesForRole ??
      jest.fn(async () => ({ InstanceProfiles: [], IsTruncated: false })),
  });
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [options] */
function makeObserver(fixture, options = {}) {
  const client = options.client ?? makeClient(fixture, options);
  const waitForRetry = options.waitForRetry ?? jest.fn();
  return {
    client,
    waitForRetry,
    observer: createAwsSingleNodeRuntimeRoleResourceObserver({
      client,
      providerScope: fixture.base.providerScope,
      maxAttempts: options.maxAttempts ?? 1,
      waitForRetry,
    }),
  };
}

function noSuchEntity(name = 'NoSuchEntity') {
  return Object.assign(new Error('provider secret no such entity'), {
    name,
  });
}

describe('AWS single-node runtime role resource observer', () => {
  it('verifies exact bound role identity, ownership, views, and digest', async () => {
    const fixture = makeFixture();
    const { client, observer } = makeObserver(fixture);
    const observation = await observer.observe(fixture.authority);
    expect(observation).toEqual({
      resourceKey: 'runtime-role',
      presence: 'present',
      ownership: 'verified',
      providerIdentity: {
        providerType: 'iam-role',
        providerResourceId: ROLE_ID,
      },
      observedDigest: fixture.roleAction.after.stateDigest,
      health: 'not-applicable',
      execution: 'none',
    });
    expect(client.getRole).toHaveBeenCalledWith({
      RoleName: makeRole(fixture).RoleName,
    });
    for (const method of [
      'listRoleTags',
      'listRolePolicies',
      'listAttachedRolePolicies',
      'listInstanceProfilesForRole',
    ]) {
      expect(client[method]).toHaveBeenCalledWith({
        RoleName: makeRole(fixture).RoleName,
        MaxItems: 1000,
      });
    }
    expectDeepFrozen(observation);
  });

  it('reports readable bound configuration drift through the actual digest', async () => {
    const fixture = makeFixture();
    const { observer } = makeObserver(fixture, {
      getRole: jest.fn(async () => ({
        Role: makeRole(fixture, { Description: 'operator drift' }),
      })),
    });
    const observation = await observer.observe(fixture.authority);
    expect(observation).toMatchObject({
      presence: 'present',
      ownership: 'verified',
      providerIdentity: { providerResourceId: ROLE_ID },
    });
    expect(observation.observedDigest).not.toEqual(
      fixture.roleAction.after.stateDigest,
    );
  });

  it('conflicts on current-create configuration drift', async () => {
    const fixture = makeFixture({ mode: 'current-create' });
    const { observer } = makeObserver(fixture, {
      getRole: jest.fn(async () => ({
        Role: makeRole(fixture, { MaxSessionDuration: 7200 }),
      })),
    });
    await expect(observer.observe(fixture.authority)).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      providerIdentity: { providerResourceId: ROLE_ID },
      observedDigest: null,
      execution: 'none',
    });
  });

  it.each([
    [
      'RoleId',
      {
        getRole: (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
          jest.fn(async () => ({
            Role: makeRole(fixture, { RoleId: OTHER_ROLE_ID }),
          })),
      },
    ],
    [
      'ownership tags',
      {
        listRoleTags: (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
          jest.fn(async () => ({
            Tags: expectedTags(fixture).map((tag) =>
              tag.Key === 'wharfie:ownership-nonce'
                ? { ...tag, Value: nonce(1) }
                : tag,
            ),
            IsTruncated: false,
          })),
      },
    ],
    [
      'foreign inline policy',
      {
        listRolePolicies: () =>
          jest.fn(async () => ({
            PolicyNames: ['foreign-policy'],
            IsTruncated: false,
          })),
      },
    ],
    [
      'managed policy',
      {
        listAttachedRolePolicies: () =>
          jest.fn(async () => ({
            AttachedPolicies: [
              {
                PolicyName: 'ReadOnlyAccess',
                PolicyArn: 'arn:aws:iam::aws:policy/ReadOnlyAccess',
              },
            ],
            IsTruncated: false,
          })),
      },
    ],
  ])(
    'reports a present conflict for contradictory %s',
    async (_name, build) => {
      const fixture = makeFixture();
      const options = Object.fromEntries(
        Object.entries(build).map(([key, factory]) => [key, factory(fixture)]),
      );
      const { observer } = makeObserver(fixture, options);
      await expect(observer.observe(fixture.authority)).resolves.toMatchObject({
        presence: 'present',
        ownership: 'conflict',
        providerIdentity: { providerResourceId: expect.any(String) },
        observedDigest: null,
      });
    },
  );

  it('never adopts an unbound exact-name role', async () => {
    const fixture = makeFixture({ mode: 'unbound' });
    const { observer } = makeObserver(fixture);
    await expect(observer.observe(fixture.authority)).resolves.toEqual({
      resourceKey: 'runtime-role',
      presence: 'present',
      ownership: 'conflict',
      providerIdentity: {
        providerType: 'iam-role',
        providerResourceId: ROLE_ID,
      },
      observedDigest: null,
      health: 'not-applicable',
      execution: 'none',
    });
  });

  it.each([
    ['bound', 'unknown'],
    ['unbound', 'absent'],
    ['current-create', 'unknown'],
  ])('classifies all-clean %s absence as %s', async (mode, presence) => {
    const fixtureMode = /** @type {'bound'|'current-create'|'unbound'} */ (
      mode
    );
    const fixture = makeFixture({ mode: fixtureMode });
    const getRole = jest.fn(async () => {
      throw noSuchEntity();
    });
    const { client, observer, waitForRetry } = makeObserver(fixture, {
      getRole,
      maxAttempts: 2,
    });
    await expect(observer.observe(fixture.authority)).resolves.toMatchObject({
      presence,
      execution: 'none',
    });
    expect(getRole).toHaveBeenCalledTimes(2);
    expect(waitForRetry).toHaveBeenCalledTimes(1);
    expect(client.listRoleTags).not.toHaveBeenCalled();
  });

  it('recognizes the IAM SDK NoSuchEntityException absence name', async () => {
    const fixture = makeFixture({ mode: 'unbound' });
    const getRole = jest.fn(async () => {
      throw noSuchEntity('NoSuchEntityException');
    });
    const { observer } = makeObserver(fixture, {
      getRole,
      maxAttempts: 2,
    });

    await expect(observer.observe(fixture.authority)).resolves.toMatchObject({
      presence: 'absent',
      ownership: 'missing',
      execution: 'none',
    });
    expect(getRole).toHaveBeenCalledTimes(2);
  });

  it('suppresses absence after any dirty read history', async () => {
    const fixture = makeFixture();
    const getRole = jest
      .fn(async () => {
        throw noSuchEntity();
      })
      .mockRejectedValueOnce(new Error('transport failed'));
    const { observer } = makeObserver(fixture, {
      getRole,
      maxAttempts: 2,
    });
    await expect(observer.observe(fixture.authority)).resolves.toMatchObject({
      presence: 'unknown',
      ownership: 'unknown',
    });
  });

  it('retries incomplete exact tags without verifying partial lineage', async () => {
    const fixture = makeFixture({ mode: 'current-create' });
    const listRoleTags = jest
      .fn(async () => ({
        Tags: expectedTags(fixture),
        IsTruncated: false,
      }))
      .mockResolvedValueOnce({
        Tags: expectedTags(fixture).slice(0, 5),
        IsTruncated: false,
      });
    const { observer, waitForRetry } = makeObserver(fixture, {
      listRoleTags,
      maxAttempts: 2,
    });
    await expect(observer.observe(fixture.authority)).resolves.toMatchObject({
      presence: 'present',
      ownership: 'verified',
    });
    expect(waitForRetry).toHaveBeenCalledTimes(1);
  });

  it('treats a resident bound tag subset as ownership drift', async () => {
    const fixture = makeFixture();
    const { observer } = makeObserver(fixture, {
      listRoleTags: jest.fn(async () => ({
        Tags: expectedTags(fixture).slice(0, 5),
        IsTruncated: false,
      })),
    });
    await expect(observer.observe(fixture.authority)).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      providerIdentity: { providerResourceId: ROLE_ID },
    });
  });

  it('conflicts when the fixed inline policy remains at current role delete', async () => {
    const fixture = makeDeleteFixture();
    const { observer } = makeObserver(fixture, {
      listRolePolicies: jest.fn(async () => ({
        PolicyNames: [AWS_SINGLE_NODE_RUNTIME_POLICY_NAME],
        IsTruncated: false,
      })),
    });
    await expect(observer.observe(fixture.authority)).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      providerIdentity: { providerResourceId: ROLE_ID },
    });
  });

  it('retains an earlier page-local contradiction without reading a later page', async () => {
    const fixture = makeFixture();
    const listRolePolicies = jest
      .fn(async () => /** @type {AnyRecord} */ ({}))
      .mockResolvedValueOnce(
        /** @type {AnyRecord} */ ({
          PolicyNames: ['foreign-policy'],
          IsTruncated: true,
          Marker: 'later',
        }),
      )
      .mockRejectedValueOnce(new Error('later failure'));
    const { observer } = makeObserver(fixture, { listRolePolicies });
    await expect(observer.observe(fixture.authority)).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
    });
    expect(listRolePolicies).toHaveBeenCalledTimes(1);
  });

  it('accepts the sole fixed inline policy through complete pagination', async () => {
    const fixture = makeFixture();
    const listRolePolicies = jest
      .fn(
        async () =>
          /** @type {AnyRecord} */ ({
            PolicyNames: [],
            IsTruncated: false,
          }),
      )
      .mockResolvedValueOnce(
        /** @type {AnyRecord} */ ({
          PolicyNames: [AWS_SINGLE_NODE_RUNTIME_POLICY_NAME],
          IsTruncated: true,
          Marker: 'later',
        }),
      );
    const { observer } = makeObserver(fixture, { listRolePolicies });
    await expect(observer.observe(fixture.authority)).resolves.toMatchObject({
      presence: 'present',
      ownership: 'verified',
    });
    expect(listRolePolicies).toHaveBeenCalledTimes(2);
  });

  it('maps malformed evidence, provider failures, and failed waits to unknown', async () => {
    for (const options of [
      { getRole: jest.fn(async () => ({ Role: {} })) },
      {
        listRoleTags: jest.fn(async () => ({
          Tags: 'bad',
          IsTruncated: false,
        })),
      },
      {
        getRole: jest.fn(async () => {
          throw new Error('provider secret');
        }),
      },
    ]) {
      const fixture = makeFixture();
      const { observer } = makeObserver(fixture, options);
      await expect(observer.observe(fixture.authority)).resolves.toMatchObject({
        presence: 'unknown',
        ownership: 'unknown',
      });
    }
    const fixture = makeFixture();
    const getRole = jest.fn(async () => {
      throw noSuchEntity();
    });
    const { observer } = makeObserver(fixture, {
      getRole,
      maxAttempts: 2,
      waitForRetry: jest.fn(async () => {
        throw new Error('wait failed');
      }),
    });
    await expect(observer.observe(fixture.authority)).resolves.toMatchObject({
      presence: 'unknown',
    });
    expect(getRole).toHaveBeenCalledTimes(1);
  });

  it('rejects stale or altered authority before provider I/O', async () => {
    const fixture = makeFixture();
    const { client, observer } = makeObserver(fixture);
    const altered = {
      ...fixture.authority,
      binding: {
        ...fixture.authority.binding,
        ownershipNonce: nonce(3),
      },
    };
    await expect(observer.observe(altered)).rejects.toBeInstanceOf(
      AwsSingleNodeRuntimeRoleResourceObserverAuthorityError,
    );
    expect(client.getRole).not.toHaveBeenCalled();
  });

  it('validates the exact narrow factory contract', () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    expect(() =>
      createAwsSingleNodeRuntimeRoleResourceObserver({
        client: { ...client, createRole: jest.fn() },
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeRuntimeRoleResourceObserver({
        client,
        providerScope: fixture.base.providerScope,
        maxAttempts: 11,
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeRuntimeRoleResourceObserver({
        client,
        providerScope: fixture.base.providerScope,
        waitForRetry: false,
      }),
    ).toThrow(TypeError);
  });

  it('does not mutate caller authority while recreating it', async () => {
    const fixture = makeFixture();
    const authority = clone(fixture.authority);
    const before = clone(authority);
    const { observer } = makeObserver(fixture);
    await observer.observe(authority);
    expect(authority).toEqual(before);
  });
});
