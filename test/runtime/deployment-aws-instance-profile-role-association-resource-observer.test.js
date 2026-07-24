import { describe, expect, it, jest } from '@jest/globals';

import { compareCanonicalStrings } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import { getAwsSingleNodeDefaultIpv4RouteProviderResourceId } from '../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-evidence.js';
import { createAwsSingleNodeInstanceProfileOwnershipTags } from '../../src/core/runtime/deployment-aws-instance-profile-evidence.js';
import {
  AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError,
  createAwsSingleNodeInstanceProfileRoleAssociationResourceObserver,
} from '../../src/core/runtime/deployment-aws-instance-profile-role-association-resource-observer.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { createAwsSingleNodeResourceObservationAuthority } from '../../src/core/runtime/deployment-aws-resource-observation-authority.js';
import {
  AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
  AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  createAwsSingleNodeRuntimePolicy,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimeInstanceProfileName,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
  getAwsSingleNodeRuntimeRoleName,
  getAwsSingleNodeRuntimeRoleTrustPolicy,
} from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import { getAwsSingleNodeRuntimeRoleOwnershipTags } from '../../src/core/runtime/deployment-aws-runtime-role-evidence.js';
import { getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId } from '../../src/core/runtime/deployment-aws-subnet-route-table-association-resource.js';
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

/** @param {string} name @returns {Error} */
function providerError(name) {
  const error = new Error('provider-secret-detail');
  error.name = name;
  return error;
}

/** @returns {Readonly<AnyRecord>} */
function makeBase() {
  const accountId = '123456789012';
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'instance-profile-role-association-resource-observer-test',
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
      'wharfie:test:instance-profile-role-association-resource-observer-revision:v1',
      { appId: profile.appId },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'instance profile role association observer artifact',
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
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 79)),
  });
}

/** @param {Readonly<AnyRecord>} base @returns {Readonly<AnyRecord>} */
function nameAuthority(base) {
  return Object.freeze({
    providerScopeId: base.providerScope.providerScopeId,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
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
          'win6',
          'wharfie:test:instance-profile-role-association-resource-observer-inspection:v1',
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
    default:
      throw new Error(`Unsupported fixture resource '${resourceKey}'.`);
  }
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>} plan
 * @param {ReadonlyArray<Readonly<AnyRecord>>} intents
 * @param {number} limit
 */
function makeBindings(base, plan, intents, limit) {
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
 * @param {'bound'|'current-create'|'unbound'|'early-unbound'} [mode]
 * @returns {Readonly<AnyRecord>}
 */
function makeAuthorityFixture(mode = 'bound') {
  const base = makeBase();
  const plan = makeCreatePlan(base);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'runtime-identity-role-association',
  );
  const action = plan.actions[actionIndex];
  if (action === undefined) throw new Error('Missing association action.');
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
      /** @type {Readonly<AnyRecord>} */ candidate,
      /** @type {number} */ index,
    ) => ({
      actionId: candidate.actionId,
      status:
        index < frontier
          ? 'settled'
          : index === frontier
            ? frontierStatus
            : 'pending',
      ownershipNonce:
        candidate.management === 'managed' ? nonce(100 + index) : null,
    }),
  );
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation:
      2 +
      frontier * 2 +
      (frontierStatus === 'intended' && frontier < plan.actions.length ? 1 : 0),
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
  const target = targetFor(
    makeTargets(base, head),
    'runtime-identity-role-association',
  );
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
    action,
    actionIndex,
    head,
    target,
    authority,
  });
}

/** @param {Readonly<AnyRecord>} fixture @param {string} resourceKey */
function bindingFor(fixture, resourceKey) {
  const binding = fixture.head.resourceBindings.find(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === resourceKey,
  );
  if (binding === undefined) {
    throw new Error(`Missing fixture binding '${resourceKey}'.`);
  }
  return binding;
}

/** @param {Readonly<AnyRecord>} fixture @param {string} resourceKey */
function actionFor(fixture, resourceKey) {
  const action = fixture.plan.actions.find(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === resourceKey,
  );
  if (action === undefined) {
    throw new Error(`Missing fixture action '${resourceKey}'.`);
  }
  return action;
}

/** @param {Readonly<AnyRecord>} fixture @returns {string} */
function roleName(fixture) {
  return getAwsSingleNodeRuntimeRoleName(nameAuthority(fixture.base));
}

/** @param {Readonly<AnyRecord>} fixture @returns {string} */
function profileName(fixture) {
  return getAwsSingleNodeRuntimeInstanceProfileName(
    nameAuthority(fixture.base),
  );
}

/** @param {Readonly<AnyRecord>} fixture @returns {string} */
function roleArn(fixture) {
  return `arn:aws:iam::123456789012:role${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${roleName(fixture)}`;
}

/** @param {Readonly<AnyRecord>} fixture @returns {string} */
function profileArn(fixture) {
  return `arn:aws:iam::123456789012:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${profileName(fixture)}`;
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [overrides] */
function roleReference(fixture, overrides = {}) {
  return {
    Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
    RoleName: roleName(fixture),
    RoleId: IDS.runtimeRole,
    Arn: roleArn(fixture),
    ...overrides,
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [overrides] */
function profileReference(fixture, overrides = {}) {
  return {
    Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
    InstanceProfileName: profileName(fixture),
    InstanceProfileId: IDS.runtimeIdentity,
    Arn: profileArn(fixture),
    ...overrides,
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [overrides] */
function roleResponse(fixture, overrides = {}) {
  return {
    Role: {
      ...roleReference(fixture),
      Description: AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
      MaxSessionDuration: AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
      AssumeRolePolicyDocument: encodeURIComponent(
        JSON.stringify(getAwsSingleNodeRuntimeRoleTrustPolicy()),
      ),
      ...overrides,
    },
  };
}

/**
 * @param {Readonly<AnyRecord>} fixture
 * @param {ReadonlyArray<Readonly<AnyRecord>>} [roles]
 * @param {Record<string, any>} [overrides]
 */
function profileResponse(
  fixture,
  roles = [roleReference(fixture)],
  overrides = {},
) {
  return {
    InstanceProfile: {
      ...profileReference(fixture),
      Roles: roles,
      ...overrides,
    },
  };
}

/** @param {Readonly<AnyRecord>} fixture */
function expectedRoleTags(fixture) {
  const binding = bindingFor(fixture, 'runtime-role');
  return getAwsSingleNodeRuntimeRoleOwnershipTags({
    capabilityKind: binding.capability.kind,
    roleKind: binding.role.kind,
    providerScopeId: fixture.base.providerScope.providerScopeId,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
    resourceKey: binding.resourceKey,
    createdByActionId: binding.createdByActionId,
    ownershipNonce: binding.ownershipNonce,
    stateDigest: actionFor(fixture, 'runtime-role').after.stateDigest,
  });
}

/** @param {Readonly<AnyRecord>} fixture */
function expectedProfileTags(fixture) {
  const binding = bindingFor(fixture, 'runtime-identity');
  return createAwsSingleNodeInstanceProfileOwnershipTags({
    providerScopeId: fixture.base.providerScope.providerScopeId,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
    createdByActionId: binding.createdByActionId,
    ownershipNonce: binding.ownershipNonce,
    stateDigest: actionFor(fixture, 'runtime-identity').after.stateDigest,
  });
}

/** @param {Readonly<AnyRecord>} fixture @param {unknown} [document] @param {Record<string, any>} [overrides] */
function policyResponse(fixture, document = undefined, overrides = {}) {
  return {
    RoleName: roleName(fixture),
    PolicyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
    PolicyDocument: encodeURIComponent(
      JSON.stringify(
        document ??
          createAwsSingleNodeRuntimePolicy(policyAuthority(fixture.base)),
      ),
    ),
    ...overrides,
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Record<string, any>} [overrides] */
function makeClient(fixture, overrides = {}) {
  return {
    getRole: overrides.getRole ?? jest.fn(async () => roleResponse(fixture)),
    listRoleTags:
      overrides.listRoleTags ??
      jest.fn(async () => ({
        Tags: expectedRoleTags(fixture),
        IsTruncated: false,
      })),
    listRolePolicies:
      overrides.listRolePolicies ??
      jest.fn(async () => ({
        PolicyNames: [AWS_SINGLE_NODE_RUNTIME_POLICY_NAME],
        IsTruncated: false,
      })),
    listAttachedRolePolicies:
      overrides.listAttachedRolePolicies ??
      jest.fn(async () => ({
        AttachedPolicies: [],
        IsTruncated: false,
      })),
    getRolePolicy:
      overrides.getRolePolicy ?? jest.fn(async () => policyResponse(fixture)),
    getInstanceProfile:
      overrides.getInstanceProfile ??
      jest.fn(async () => profileResponse(fixture)),
    listInstanceProfileTags:
      overrides.listInstanceProfileTags ??
      jest.fn(async () => ({
        Tags: expectedProfileTags(fixture),
        IsTruncated: false,
      })),
    listInstanceProfilesForRole:
      overrides.listInstanceProfilesForRole ??
      jest.fn(async () => ({
        InstanceProfiles: [profileReference(fixture)],
        IsTruncated: false,
      })),
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} client @param {{maxAttempts?: number, waitForRetry?: (attempt: number) => Promise<void>}} [options] */
function observerFor(fixture, client, options = {}) {
  return createAwsSingleNodeInstanceProfileRoleAssociationResourceObserver({
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
    resourceKey: 'runtime-identity-role-association',
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

/** @returns {Readonly<AnyRecord>} */
function associationIdentity() {
  return {
    providerType: 'iam-instance-profile-role-association',
    providerResourceId: getAwsSingleNodeRuntimeAssociationProviderResourceId({
      runtimeRoleId: IDS.runtimeRole,
      instanceProfileId: IDS.runtimeIdentity,
    }),
  };
}

describe('AWS single-node instance-profile/role association resource observer', () => {
  it('constructs without I/O and accepts only the exact read port', () => {
    const fixture = makeAuthorityFixture();
    const client = makeClient(fixture);
    const observer = observerFor(fixture, client);

    expect(Object.keys(observer)).toEqual(['observe']);
    expect(Object.isFrozen(observer)).toBe(true);
    for (const method of Object.values(client)) {
      expect(method).not.toHaveBeenCalled();
    }
    expect(() =>
      createAwsSingleNodeInstanceProfileRoleAssociationResourceObserver({
        client: { ...client, addRoleToInstanceProfile: async () => ({}) },
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(/addRoleToInstanceProfile is not supported/);
  });

  it('re-proves exact dependency lineage before provider I/O', async () => {
    const fixture = makeAuthorityFixture();
    const forged = clone(fixture.authority);
    forged.binding.dependencyBindings[0].bindingId = semanticId(
      'wdb2',
      'wharfie:test:wrong-association-dependency:v1',
      {},
    );
    const client = makeClient(fixture);

    await expect(
      observerFor(fixture, client).observe(forged),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError,
    );
    for (const method of Object.values(client)) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it('verifies a bound exact relationship and freezes every request', async () => {
    const fixture = makeAuthorityFixture();
    const client = makeClient(fixture);
    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'verified',
        associationIdentity(),
        fixture.action.after.stateDigest,
      ),
    );
    expectDeepFrozen(observation);
    expect(client.getRole).toHaveBeenCalledWith({
      RoleName: roleName(fixture),
    });
    expect(client.getInstanceProfile).toHaveBeenCalledWith({
      InstanceProfileName: profileName(fixture),
    });
    for (const method of Object.values(client)) {
      for (const [request] of method.mock.calls) expectDeepFrozen(request);
    }
  });

  it('accepts an exact effect-ahead current create without replay advice', async () => {
    const fixture = makeAuthorityFixture('current-create');

    const observation = await observerFor(fixture, makeClient(fixture)).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'verified',
        associationIdentity(),
        fixture.action.after.stateDigest,
      ),
    );
    expect(observation.execution).toBe('none');
  });

  it('does not adopt an exact relationship in an unbound natural slot', async () => {
    const fixture = makeAuthorityFixture('unbound');

    await expect(
      observerFor(fixture, makeClient(fixture)).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation('present', 'conflict', associationIdentity(), null),
    );
  });

  it('keeps a bound relationship verified when readable parent configuration drifts', async () => {
    const fixture = makeAuthorityFixture();
    const client = makeClient(fixture, {
      getRole: jest.fn(async () =>
        roleResponse(fixture, { Description: 'readable drift' }),
      ),
      getRolePolicy: jest.fn(async () =>
        policyResponse(fixture, {
          Version: '2012-10-17',
          Statement: [],
        }),
      ),
    });

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation(
        'present',
        'verified',
        associationIdentity(),
        fixture.action.after.stateDigest,
      ),
    );
  });

  it('reports a relationship with drifted parents during current create as conflict', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const client = makeClient(fixture, {
      getRolePolicy: jest.fn(async () =>
        policyResponse(fixture, {
          Version: '2012-10-17',
          Statement: [],
        }),
      ),
    });

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation('present', 'conflict', associationIdentity(), null),
    );
  });

  it('reports bound relationship absence only after both projections stay clean', async () => {
    const fixture = makeAuthorityFixture();
    const client = makeClient(fixture, {
      getInstanceProfile: jest.fn(async () => profileResponse(fixture, [])),
      listInstanceProfilesForRole: jest.fn(async () => ({
        InstanceProfiles: [],
        IsTruncated: false,
      })),
    });

    await expect(
      observerFor(fixture, client, { maxAttempts: 2 }).observe(
        fixture.authority,
      ),
    ).resolves.toEqual(expectedObservation('absent', 'missing', null, null));
    expect(client.getInstanceProfile).toHaveBeenCalledTimes(2);
    expect(client.listInstanceProfilesForRole).toHaveBeenCalledTimes(2);
  });

  it('keeps current-create repeated clean relationship absence unknown', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const client = makeClient(fixture, {
      getInstanceProfile: jest.fn(async () => profileResponse(fixture, [])),
      listInstanceProfilesForRole: jest.fn(async () => ({
        InstanceProfiles: [],
        IsTruncated: false,
      })),
    });

    await expect(
      observerFor(fixture, client, { maxAttempts: 2 }).observe(
        fixture.authority,
      ),
    ).resolves.toEqual(expectedObservation('unknown', 'unknown', null, null));
  });

  it('reports an unbound, repeatedly clean natural slot as absent', async () => {
    const fixture = makeAuthorityFixture('unbound');
    const client = makeClient(fixture, {
      getInstanceProfile: jest.fn(async () => profileResponse(fixture, [])),
      listInstanceProfilesForRole: jest.fn(async () => ({
        InstanceProfiles: [],
        IsTruncated: false,
      })),
    });

    await expect(
      observerFor(fixture, client, { maxAttempts: 2 }).observe(
        fixture.authority,
      ),
    ).resolves.toEqual(expectedObservation('absent', 'missing', null, null));
  });

  it('keeps one-sided relationship propagation unknown', async () => {
    const fixture = makeAuthorityFixture();
    const client = makeClient(fixture, {
      listInstanceProfilesForRole: jest.fn(async () => ({
        InstanceProfiles: [],
        IsTruncated: false,
      })),
    });

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(expectedObservation('unknown', 'unknown', null, null));
  });

  it('treats repeated complete role-endpoint loss plus empty profile membership as absence', async () => {
    const fixture = makeAuthorityFixture();
    const missing = jest.fn(async () => {
      throw providerError('NoSuchEntity');
    });
    const client = makeClient(fixture, {
      getRole: missing,
      listRoleTags: missing,
      listRolePolicies: missing,
      listAttachedRolePolicies: missing,
      getRolePolicy: missing,
      getInstanceProfile: jest.fn(async () => profileResponse(fixture, [])),
      listInstanceProfilesForRole: missing,
    });

    await expect(
      observerFor(fixture, client, { maxAttempts: 2 }).observe(
        fixture.authority,
      ),
    ).resolves.toEqual(expectedObservation('absent', 'missing', null, null));
    expect(missing).toHaveBeenCalledTimes(12);
  });

  it('treats repeated complete profile-endpoint loss plus empty role membership as absence', async () => {
    const fixture = makeAuthorityFixture();
    const missing = jest.fn(async () => {
      throw providerError('NoSuchEntityException');
    });
    const client = makeClient(fixture, {
      getInstanceProfile: missing,
      listInstanceProfileTags: missing,
      listInstanceProfilesForRole: jest.fn(async () => ({
        InstanceProfiles: [],
        IsTruncated: false,
      })),
    });

    await expect(
      observerFor(fixture, client, { maxAttempts: 2 }).observe(
        fixture.authority,
      ),
    ).resolves.toEqual(expectedObservation('absent', 'missing', null, null));
    expect(missing).toHaveBeenCalledTimes(4);
  });

  it('suppresses absence after any earlier unreadable projection', async () => {
    const fixture = makeAuthorityFixture();
    const getInstanceProfile = jest
      .fn(async () => profileResponse(fixture, []))
      .mockRejectedValueOnce(providerError('NetworkingError'));
    const client = makeClient(fixture, {
      getInstanceProfile,
      listInstanceProfilesForRole: jest.fn(async () => ({
        InstanceProfiles: [],
        IsTruncated: false,
      })),
    });

    await expect(
      observerFor(fixture, client, { maxAttempts: 2 }).observe(
        fixture.authority,
      ),
    ).resolves.toEqual(expectedObservation('unknown', 'unknown', null, null));
  });

  it('gives a decoded endpoint identity conflict precedence over another failed read', async () => {
    const fixture = makeAuthorityFixture();
    const client = makeClient(fixture, {
      getRole: jest.fn(async () =>
        roleResponse(fixture, { RoleId: 'AROA0987654321EXAMPLE' }),
      ),
      listInstanceProfileTags: jest.fn(async () => {
        throw providerError('NetworkingError');
      }),
    });

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation('present', 'conflict', associationIdentity(), null),
    );
  });

  it('does not request a later page after an earlier profile contradiction', async () => {
    const fixture = makeAuthorityFixture();
    let callCount = 0;
    const listInstanceProfilesForRole = jest.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          InstanceProfiles: [
            profileReference(fixture, {
              InstanceProfileId: IDS.otherRuntimeIdentity,
            }),
          ],
          IsTruncated: true,
          Marker: 'later-page',
        };
      }
      throw providerError('NetworkingError');
    });
    const client = makeClient(fixture, { listInstanceProfilesForRole });

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation('present', 'conflict', associationIdentity(), null),
    );
    expect(listInstanceProfilesForRole).toHaveBeenCalledTimes(1);
  });

  it('reports contradictory parent ownership tags as conflict', async () => {
    const fixture = makeAuthorityFixture();
    const wrongTags = /** @type {Array<{Key: string, Value: string}>} */ (
      clone(expectedProfileTags(fixture))
    );
    wrongTags[0].Value = 'foreign';
    const client = makeClient(fixture, {
      listInstanceProfileTags: jest.fn(async () => ({
        Tags: wrongTags,
        IsTruncated: false,
      })),
    });

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation('present', 'conflict', associationIdentity(), null),
    );
  });

  it('keeps an early unbound target without dependency receipts unknown', async () => {
    const fixture = makeAuthorityFixture('early-unbound');
    const client = makeClient(makeAuthorityFixture());

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(expectedObservation('unknown', 'unknown', null, null));
    for (const method of Object.values(client)) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it('maps a failed retry wait to unknown without replay advice', async () => {
    const fixture = makeAuthorityFixture();
    const client = makeClient(fixture, {
      getInstanceProfile: jest.fn(async () => {
        throw providerError('NetworkingError');
      }),
    });
    const waitForRetry = jest.fn(async () => {
      throw new Error('timer failure');
    });

    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
      waitForRetry,
    }).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(observation.execution).toBe('none');
    expect(waitForRetry).toHaveBeenCalledTimes(1);
  });
});
