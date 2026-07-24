import { describe, expect, it, jest } from '@jest/globals';

import { compareCanonicalStrings } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import { getAwsSingleNodeDefaultIpv4RouteProviderResourceId } from '../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-evidence.js';
import {
  AWS_SINGLE_NODE_INSTANCE_PROFILE_INSTANCE_PAGE_SIZE,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_TAG_PAGE_SIZE,
  createAwsSingleNodeInstanceProfileOwnershipTags,
} from '../../src/core/runtime/deployment-aws-instance-profile-evidence.js';
import {
  AwsSingleNodeInstanceProfileResourceObserverAuthorityError,
  createAwsSingleNodeInstanceProfileResourceObserver,
} from '../../src/core/runtime/deployment-aws-instance-profile-resource-observer.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { createAwsSingleNodeResourceObservationAuthority } from '../../src/core/runtime/deployment-aws-resource-observation-authority.js';
import {
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimeInstanceProfileName,
  getAwsSingleNodeRuntimeInstanceProfileStateDigest,
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
  otherRuntimeIdentity: 'AIPA0987654321EXAMPLE',
  substrate: 'i-00000000000000001',
});

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

/** @param {unknown} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @returns {Readonly<AnyRecord>} */
function makeBase() {
  const accountId = '123456789012';
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'instance-profile-resource-observer-test',
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
      'wharfie:test:instance-profile-resource-observer-revision:v1',
      { appId: profile.appId },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'instance profile observer artifact',
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
    accountId,
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
      ebsKmsKeyArn: `arn:aws:kms:us-east-1:${accountId}:key/11111111-2222-3333-4444-555555555555`,
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
  if (target === undefined) {
    throw new Error(`Missing fixture target '${resourceKey}'.`);
  }
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
          'wharfie:test:instance-profile-resource-observer-inspection:v1',
          {
            deploymentRevisionId: base.deploymentRevision.deploymentRevisionId,
          },
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

/** @param {Readonly<AnyRecord>} base @param {string} resourceKey */
function providerResourceId(base, resourceKey) {
  switch (resourceKey) {
    case 'artifact':
      return getAwsSingleNodeManagedArtifactObjectLocation({
        providerScope: base.providerScope,
        deploymentInstanceId: base.deploymentInstanceId,
        incarnationId: base.incarnationId,
      }).arn;
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
 * @param {number} [limit]
 */
function makeBindings(base, plan, intents, limit = plan.actions.length) {
  const bindingByKey = new Map();
  const bindings = [];
  for (let index = 0; index < limit; index += 1) {
    const action = plan.actions[index];
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
      dependencyBindings: action.dependsOn
        .map((/** @type {string} */ resourceKey) => ({
          resourceKey,
          bindingId: bindingByKey.get(resourceKey).bindingId,
        }))
        .sort(
          (
            /** @type {{resourceKey: string}} */ left,
            /** @type {{resourceKey: string}} */ right,
          ) => compareCanonicalStrings(left.resourceKey, right.resourceKey),
        ),
      providerType: action.after.providerType,
      providerResourceId: providerResourceId(base, action.resourceKey),
      providerScopeId: base.providerScope.providerScopeId,
      ownershipNonce: intents[index].ownershipNonce,
      createdByActionId: action.actionId,
    });
    bindingByKey.set(action.resourceKey, binding);
    bindings.push(binding);
  }
  return bindings;
}

/**
 * @param {'bound'|'current-create'|'unbound'|'early-unbound'} mode
 * @returns {Readonly<AnyRecord>}
 */
function makeApplyFixture(mode) {
  const base = makeBase();
  const plan = makeCreatePlan(base);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'runtime-identity',
  );
  const frontier =
    mode === 'early-unbound'
      ? 0
      : mode === 'bound'
        ? actionIndex + 1
        : actionIndex;
  const frontierStatus =
    mode === 'current-create' || mode === 'early-unbound'
      ? 'intended'
      : 'pending';
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
    resourceBindings: makeBindings(base, plan, intents, frontier),
    activeOperation: {
      kind: 'create',
      planId: plan.planId,
      status: 'running',
      nextActionIndex: frontier,
      intents,
    },
    lastOperation: null,
  });
  const target = targetFor(makeTargets(base, head), 'runtime-identity');
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
    head,
    target,
    authority,
    actionIndex,
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
  const settledBindings = makeBindings(base, settledPlan, settledIntents);
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
          'wharfie:test:instance-profile-delete-inspection:v1',
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
      action.resourceKey === 'runtime-identity',
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
  const target = targetFor(makeTargets(base, head), 'runtime-identity');
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
    head,
    target,
    authority,
    actionIndex,
  });
}

/** @param {Readonly<AnyRecord>} fixture */
function fixtureNameAuthority(fixture) {
  return {
    providerScopeId: fixture.base.providerScope.providerScopeId,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
  };
}

/** @param {Readonly<AnyRecord>} fixture */
function instanceProfileName(fixture) {
  return getAwsSingleNodeRuntimeInstanceProfileName(
    fixtureNameAuthority(fixture),
  );
}

/** @param {Readonly<AnyRecord>} fixture */
function profileArn(fixture) {
  return `arn:aws:iam::123456789012:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${instanceProfileName(fixture)}`;
}

/** @param {Readonly<AnyRecord>} fixture */
function expectedTags(fixture) {
  if (
    fixture.authority.binding === null &&
    fixture.authority.currentAction === null
  ) {
    throw new Error('Fixture has no instance-profile ownership receipt.');
  }
  const createdByActionId =
    fixture.authority.binding?.createdByActionId ??
    fixture.authority.currentAction.action.actionId;
  const ownershipNonce =
    fixture.authority.binding?.ownershipNonce ??
    fixture.authority.currentAction.ownershipNonce;
  return createAwsSingleNodeInstanceProfileOwnershipTags({
    ...fixtureNameAuthority(fixture),
    createdByActionId,
    ownershipNonce,
    stateDigest: getAwsSingleNodeRuntimeInstanceProfileStateDigest(
      fixtureNameAuthority(fixture),
    ),
  });
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [overrides] */
function makeRole(fixture, overrides = {}) {
  const RoleName = 'wharfie-runtime-role-v1-0123456789abcdef0123456789abcdef';
  return {
    Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
    RoleName,
    RoleId: IDS.runtimeRole,
    Arn: `arn:aws:iam::123456789012:role${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${RoleName}`,
    ...overrides,
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [overrides] */
function makeInstanceProfile(fixture, overrides = {}) {
  return {
    Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
    InstanceProfileName: instanceProfileName(fixture),
    InstanceProfileId: IDS.runtimeIdentity,
    Arn: profileArn(fixture),
    Roles: [],
    ...overrides,
  };
}

/** @param {string} [name] */
function noSuchEntity(name = 'NoSuchEntityException') {
  return Object.assign(new Error('secret missing detail'), { name });
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [options] */
function makeClient(fixture, options = {}) {
  return {
    getInstanceProfile:
      options.getInstanceProfile ??
      jest.fn(async () => ({
        InstanceProfile: makeInstanceProfile(fixture),
      })),
    listInstanceProfileTags:
      options.listInstanceProfileTags ??
      jest.fn(async () => ({ Tags: expectedTags(fixture) })),
    describeInstances:
      options.describeInstances ?? jest.fn(async () => ({ Reservations: [] })),
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} client @param {Record<string, any>} [options] */
function observerFor(fixture, client, options = {}) {
  return createAwsSingleNodeInstanceProfileResourceObserver({
    client,
    providerScope: fixture.base.providerScope,
    maxAttempts: options.maxAttempts ?? 1,
    waitForRetry: options.waitForRetry ?? (async () => {}),
  });
}

/**
 * @param {'present'|'absent'|'unknown'} presence
 * @param {'verified'|'missing'|'conflict'|'unknown'} ownership
 * @param {Readonly<AnyRecord>|null} providerIdentity
 * @param {Readonly<AnyRecord>|null} observedDigest
 */
function expectedObservation(
  presence,
  ownership,
  providerIdentity,
  observedDigest,
) {
  return {
    resourceKey: 'runtime-identity',
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

describe('AWS single-node instance-profile resource observer authority', () => {
  it('constructs without I/O and accepts exactly three read methods', () => {
    const fixture = makeApplyFixture('bound');
    const client = makeClient(fixture);
    const observer = observerFor(fixture, client);

    expect(Object.keys(observer)).toEqual(['observe']);
    expect(Object.isFrozen(observer)).toBe(true);
    for (const method of Object.values(client)) {
      expect(method).not.toHaveBeenCalled();
    }
    expect(() =>
      createAwsSingleNodeInstanceProfileResourceObserver({
        client: { ...client, deleteInstanceProfile: async () => ({}) },
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(/deleteInstanceProfile is not supported/);
  });

  it('re-proves V48 binding authority before provider I/O', async () => {
    const fixture = makeApplyFixture('bound');
    const forged = clone(fixture.authority);
    forged.binding.ownershipNonce = nonce(250);
    const client = makeClient(fixture);

    await expect(
      observerFor(fixture, client).observe(forged),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInstanceProfileResourceObserverAuthorityError,
    );
    for (const method of Object.values(client)) {
      expect(method).not.toHaveBeenCalled();
    }
  });
});

describe('AWS single-node instance-profile resident observation', () => {
  it('verifies a bound profile by deterministic name, immutable ID, exact tags, and actual digest', async () => {
    const fixture = makeApplyFixture('bound');
    const client = makeClient(fixture);
    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'verified',
        {
          providerType: 'instance-profile',
          providerResourceId: IDS.runtimeIdentity,
        },
        getAwsSingleNodeRuntimeInstanceProfileStateDigest(
          fixtureNameAuthority(fixture),
        ),
      ),
    );
    expectDeepFrozen(observation);
    expect(client.getInstanceProfile).toHaveBeenCalledWith({
      InstanceProfileName: instanceProfileName(fixture),
    });
    expect(client.listInstanceProfileTags).toHaveBeenCalledWith({
      InstanceProfileName: instanceProfileName(fixture),
      MaxItems: AWS_SINGLE_NODE_INSTANCE_PROFILE_TAG_PAGE_SIZE,
    });
    expectDeepFrozen(client.getInstanceProfile.mock.calls[0][0]);
    expectDeepFrozen(client.listInstanceProfileTags.mock.calls[0][0]);
    expect(client.describeInstances).not.toHaveBeenCalled();
  });

  it('accepts one structurally valid child role without claiming association ownership', async () => {
    const fixture = makeApplyFixture('bound');
    const client = makeClient(fixture, {
      getInstanceProfile: jest.fn(async () => ({
        InstanceProfile: makeInstanceProfile(fixture, {
          Roles: [makeRole(fixture)],
        }),
      })),
    });

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(
      expect.objectContaining({ presence: 'present', ownership: 'verified' }),
    );
    expect(client.describeInstances).not.toHaveBeenCalled();
  });

  it.each([
    ['immutable ID', { InstanceProfileId: IDS.otherRuntimeIdentity }],
    ['deterministic name', { InstanceProfileName: 'foreign-profile' }],
    ['path', { Path: '/foreign/' }],
    ['tag lineage', null],
    [
      'role cardinality',
      {
        Roles: [
          makeRole(makeApplyFixture('bound')),
          makeRole(makeApplyFixture('bound')),
        ],
      },
    ],
  ])(
    'reports contradictory bound %s evidence as conflict',
    async (_label, change) => {
      const fixture = makeApplyFixture('bound');
      const client =
        change === null
          ? makeClient(fixture, {
              listInstanceProfileTags: jest.fn(async () => ({
                Tags: expectedTags(fixture).map((tag, index) =>
                  index === 0 ? { ...tag, Value: 'foreign' } : tag,
                ),
              })),
            })
          : makeClient(fixture, {
              getInstanceProfile: jest.fn(async () => ({
                InstanceProfile: makeInstanceProfile(fixture, change),
              })),
            });

      const observation = await observerFor(fixture, client).observe(
        fixture.authority,
      );
      expect(observation).toEqual(
        expectedObservation(
          'present',
          'conflict',
          {
            providerType: 'instance-profile',
            providerResourceId: IDS.runtimeIdentity,
          },
          null,
        ),
      );
    },
  );

  it.each(['NoSuchEntity', 'NoSuchEntityException'])(
    'keeps repeated bound %s absence unknown',
    async (errorName) => {
      const fixture = makeApplyFixture('bound');
      const client = makeClient(fixture, {
        getInstanceProfile: jest.fn(async () => {
          throw noSuchEntity(errorName);
        }),
      });
      const observation = await observerFor(fixture, client, {
        maxAttempts: 2,
      }).observe(fixture.authority);

      expect(observation).toEqual(
        expectedObservation('unknown', 'unknown', null, null),
      );
      expect(client.getInstanceProfile).toHaveBeenCalledTimes(2);
      expect(client.listInstanceProfileTags).not.toHaveBeenCalled();
    },
  );

  it('preserves an early tag contradiction over a later pagination failure', async () => {
    const fixture = makeApplyFixture('bound');
    const tags = expectedTags(fixture);
    const listInstanceProfileTags = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => {
        if (request.Marker !== undefined) {
          throw new Error('a later provider secret');
        }
        return {
          Tags: [{ ...tags[0], Value: 'foreign' }],
          IsTruncated: true,
          Marker: 'page-two',
        };
      },
    );
    const client = makeClient(fixture, { listInstanceProfileTags });
    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation.ownership).toBe('conflict');
    expect(listInstanceProfileTags).toHaveBeenCalledTimes(1);
  });
});

describe('AWS single-node instance-profile create and collision observation', () => {
  it.each(['unbound', 'early-unbound'])(
    'returns absence only after clean deterministic-name reads for %s authority',
    async (mode) => {
      const fixture = makeApplyFixture(
        /** @type {'unbound'|'early-unbound'} */ (mode),
      );
      const client = makeClient(fixture, {
        getInstanceProfile: jest.fn(async () => {
          throw noSuchEntity();
        }),
        listInstanceProfileTags: jest.fn(),
      });
      const observation = await observerFor(fixture, client, {
        maxAttempts: 2,
      }).observe(fixture.authority);

      expect(observation).toEqual(
        expectedObservation('absent', 'missing', null, null),
      );
      expect(client.getInstanceProfile).toHaveBeenCalledTimes(2);
      expect(client.listInstanceProfileTags).not.toHaveBeenCalled();
    },
  );

  it('keeps a clean current-create absence unknown and never emits replay advice', async () => {
    const fixture = makeApplyFixture('current-create');
    const client = makeClient(fixture, {
      getInstanceProfile: jest.fn(async () => {
        throw noSuchEntity();
      }),
    });
    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
    }).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(observation.execution).toBe('none');
    expect(client.getInstanceProfile).toHaveBeenCalledTimes(2);
  });

  it('reports an unbound deterministic-name occupant as collision without adoption', async () => {
    const fixture = makeApplyFixture('unbound');
    const client = makeClient(fixture, {
      listInstanceProfileTags: jest.fn(),
    });
    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'conflict',
        {
          providerType: 'instance-profile',
          providerResourceId: IDS.runtimeIdentity,
        },
        null,
      ),
    );
    expect(client.listInstanceProfileTags).not.toHaveBeenCalled();
  });

  it('verifies current create only through its exact immutable tag receipt', async () => {
    const fixture = makeApplyFixture('current-create');
    const client = makeClient(fixture);
    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'verified',
        {
          providerType: 'instance-profile',
          providerResourceId: IDS.runtimeIdentity,
        },
        getAwsSingleNodeRuntimeInstanceProfileStateDigest(
          fixtureNameAuthority(fixture),
        ),
      ),
    );
    expect(observation.execution).toBe('none');
  });

  it('retries a current-create exact tag subset as IAM propagation', async () => {
    const fixture = makeApplyFixture('current-create');
    let reads = 0;
    const client = makeClient(fixture, {
      listInstanceProfileTags: jest.fn(async () => {
        reads += 1;
        return {
          Tags:
            reads === 1
              ? expectedTags(fixture).slice(0, 5)
              : expectedTags(fixture),
        };
      }),
    });
    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
    }).observe(fixture.authority);

    expect(observation.ownership).toBe('verified');
    expect(client.getInstanceProfile).toHaveBeenCalledTimes(2);
    expect(client.listInstanceProfileTags).toHaveBeenCalledTimes(2);
  });

  it('suppresses unbound absence after a dirty provider read or wait', async () => {
    const fixture = makeApplyFixture('unbound');
    let reads = 0;
    const client = makeClient(fixture, {
      getInstanceProfile: jest.fn(async () => {
        reads += 1;
        if (reads === 1) throw new Error('secret provider failure');
        throw noSuchEntity();
      }),
    });
    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
    }).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
  });
});

describe('AWS single-node instance-profile delete-fence observation', () => {
  it('verifies current delete only after empty membership and a complete regional terminated-use scan', async () => {
    const fixture = makeDeleteFixture();
    const terminated = {
      InstanceId: IDS.substrate,
      IamInstanceProfile: {
        Id: IDS.runtimeIdentity,
        Arn: profileArn(fixture),
      },
      State: { Code: 48, Name: 'terminated' },
    };
    const describeInstances = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) =>
        request.NextToken === undefined
          ? {
              Reservations: [{ Instances: [terminated] }],
              NextToken: 'page-two',
            }
          : { Reservations: [] },
    );
    const client = makeClient(fixture, { describeInstances });
    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation.ownership).toBe('verified');
    expect(describeInstances).toHaveBeenCalledTimes(2);
    expect(describeInstances.mock.calls[0][0]).toEqual({
      Filters: [
        {
          Name: 'iam-instance-profile.id',
          Values: [IDS.runtimeIdentity],
        },
      ],
      IncludeManagedResources: true,
      MaxResults: AWS_SINGLE_NODE_INSTANCE_PROFILE_INSTANCE_PAGE_SIZE,
    });
    expect(describeInstances.mock.calls[1][0]).toEqual({
      Filters: [
        {
          Name: 'iam-instance-profile.id',
          Values: [IDS.runtimeIdentity],
        },
      ],
      IncludeManagedResources: true,
      MaxResults: AWS_SINGLE_NODE_INSTANCE_PROFILE_INSTANCE_PAGE_SIZE,
      NextToken: 'page-two',
    });
    expectDeepFrozen(describeInstances.mock.calls[0][0]);
  });

  it('reports residual role membership as conflict without scanning EC2', async () => {
    const fixture = makeDeleteFixture();
    const client = makeClient(fixture, {
      getInstanceProfile: jest.fn(async () => ({
        InstanceProfile: makeInstanceProfile(fixture, {
          Roles: [makeRole(fixture)],
        }),
      })),
    });
    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation.ownership).toBe('conflict');
    expect(client.describeInstances).not.toHaveBeenCalled();
  });

  it.each([
    ['pending', { Code: 0, Name: 'pending' }],
    ['running', { Code: 16, Name: 'running' }],
    ['stopped', { Code: 80, Name: 'stopped' }],
  ])('reports %s regional use as conflict', async (_label, State) => {
    const fixture = makeDeleteFixture();
    const client = makeClient(fixture, {
      describeInstances: jest.fn(async () => ({
        Reservations: [
          {
            Instances: [
              {
                InstanceId: IDS.substrate,
                IamInstanceProfile: {
                  Id: IDS.runtimeIdentity,
                  Arn: profileArn(fixture),
                },
                State,
              },
            ],
          },
        ],
      })),
    });
    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation.ownership).toBe('conflict');
  });

  it('preserves an early active-use conflict over a hypothetical later page failure', async () => {
    const fixture = makeDeleteFixture();
    const describeInstances = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ request) => {
        if (request.NextToken !== undefined) {
          throw new Error('later page secret');
        }
        return {
          Reservations: [
            {
              Instances: [
                {
                  InstanceId: IDS.substrate,
                  IamInstanceProfile: {
                    Id: IDS.runtimeIdentity,
                    Arn: profileArn(fixture),
                  },
                  State: { Code: 16, Name: 'running' },
                },
              ],
            },
          ],
          NextToken: 'page-two',
        };
      },
    );
    const client = makeClient(fixture, { describeInstances });
    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation.ownership).toBe('conflict');
    expect(describeInstances).toHaveBeenCalledTimes(1);
  });

  it('keeps repeated current-delete exact-name absence unknown', async () => {
    const fixture = makeDeleteFixture();
    const client = makeClient(fixture, {
      getInstanceProfile: jest.fn(async () => {
        throw noSuchEntity();
      }),
    });
    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
    }).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(client.describeInstances).not.toHaveBeenCalled();
  });
});
