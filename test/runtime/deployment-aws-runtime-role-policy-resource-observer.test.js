import { describe, expect, it, jest } from '@jest/globals';

import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import { getAwsSingleNodeDefaultIpv4RouteProviderResourceId } from '../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-evidence.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { createAwsSingleNodeResourceObservationAuthority } from '../../src/core/runtime/deployment-aws-resource-observation-authority.js';
import { createAwsSingleNodeRuntimeRolePolicyObservedStateDigest } from '../../src/core/runtime/deployment-aws-runtime-role-policy-evidence.js';
import {
  AwsSingleNodeRuntimeRolePolicyResourceObserverAuthorityError,
  createAwsSingleNodeRuntimeRolePolicyResourceObserver,
} from '../../src/core/runtime/deployment-aws-runtime-role-policy-resource-observer.js';
import { getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId } from '../../src/core/runtime/deployment-aws-subnet-route-table-association-resource.js';
import {
  AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
  AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  createAwsSingleNodeRuntimePolicy,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
  getAwsSingleNodeRuntimeRoleName,
  getAwsSingleNodeRuntimeRoleTrustPolicy,
} from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import { getAwsSingleNodeRuntimeRoleOwnershipTags } from '../../src/core/runtime/deployment-aws-runtime-role-evidence.js';
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
  application: 'vol-00000000000000001',
  control: 'vol-00000000000000002',
  vpc: 'vpc-00000000000000001',
  internetGateway: 'igw-00000000000000001',
  subnet: 'subnet-00000000000000001',
  routeTable: 'rtb-00000000000000001',
  securityGroup: 'sg-00000000000000001',
  runtimeRole: 'AROAABCDEFGHIJKLMNOP',
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
    appId: 'runtime-role-policy-resource-observer-test',
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
      'wharfie:test:runtime-role-policy-resource-observer-revision:v1',
      { appId: profile.appId },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'runtime role policy observer artifact',
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
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 75)),
  });
}

/** @param {Readonly<AnyRecord>} base @returns {Readonly<AnyRecord>} */
function runtimePolicyAuthority(base) {
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
          'win6',
          'wharfie:test:runtime-role-policy-resource-observer-inspection:v1',
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
function prefixProviderResourceId(base, resourceKey) {
  if (resourceKey === 'artifact') {
    return getAwsSingleNodeManagedArtifactObjectLocation(
      runtimePolicyAuthority(base),
    ).arn;
  }
  if (resourceKey === 'application-state') return IDS.application;
  if (resourceKey === 'control-state') return IDS.control;
  if (resourceKey === 'network-vpc') return IDS.vpc;
  if (resourceKey === 'network-internet-gateway') {
    return IDS.internetGateway;
  }
  if (resourceKey === 'network-internet-gateway-attachment') {
    return getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
      IDS.internetGateway,
      IDS.vpc,
    );
  }
  if (resourceKey === 'network-subnet') return IDS.subnet;
  if (resourceKey === 'network-route-table') return IDS.routeTable;
  if (resourceKey === 'network-default-ipv4-route') {
    return getAwsSingleNodeDefaultIpv4RouteProviderResourceId(
      base.providerSpec.capabilities.networking.egressCidr,
      IDS.internetGateway,
      IDS.routeTable,
    );
  }
  if (resourceKey === 'network-subnet-route-table-association') {
    return getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId(
      IDS.routeTable,
      IDS.subnet,
    );
  }
  if (resourceKey === 'network-security-group') return IDS.securityGroup;
  if (resourceKey === 'runtime-role') return IDS.runtimeRole;
  if (resourceKey === 'runtime-role-policy') {
    return getAwsSingleNodeRuntimePolicyProviderResourceId({
      runtimeRoleId: IDS.runtimeRole,
    });
  }
  throw new Error(`Unsupported prefix binding '${resourceKey}'.`);
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>} plan
 * @param {ReadonlyArray<Readonly<AnyRecord>>} intents
 * @param {number} frontier
 */
function makePrefixBindings(base, plan, intents, frontier) {
  const bindingByKey = new Map();
  for (let index = 0; index < frontier; index += 1) {
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
      dependencyBindings: action.dependsOn.map(
        (/** @type {string} */ resourceKey) => ({
          resourceKey,
          bindingId: bindingByKey.get(resourceKey).bindingId,
        }),
      ),
      providerType: action.after.providerType,
      providerResourceId: prefixProviderResourceId(base, action.resourceKey),
      providerScopeId: base.providerScope.providerScopeId,
      ownershipNonce: intents[index].ownershipNonce,
      createdByActionId: action.actionId,
    });
    bindingByKey.set(action.resourceKey, binding);
  }
  return [...bindingByKey.values()];
}

/**
 * @param {'bound'|'current-create'|'early-unbound'} [mode]
 * @returns {Readonly<AnyRecord>}
 */
function makeAuthorityFixture(mode = 'bound') {
  const base = makeBase();
  const plan = makeCreatePlan(base);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'runtime-role-policy',
  );
  const action = plan.actions[actionIndex];
  if (action === undefined)
    throw new Error('Missing runtime role policy action.');
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
        candidate.management === 'managed' ? nonce(90 + index) : null,
    }),
  );
  const resourceBindings = makePrefixBindings(base, plan, intents, frontier);
  const head = createDeploymentHead({
    deploymentInstanceId: base.deploymentInstanceId,
    providerScope: base.providerScope,
    incarnationId: base.incarnationId,
    generation:
      1 +
      frontier * 2 +
      (frontierStatus === 'intended' && frontier < plan.actions.length ? 1 : 0),
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
  const target = targetFor(makeTargets(base, head), 'runtime-role-policy');
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

/** @param {Readonly<AnyRecord>} fixture */
function runtimeRoleBinding(fixture) {
  const binding = fixture.head.resourceBindings.find(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === 'runtime-role',
  );
  if (binding === undefined) throw new Error('Missing runtime role binding.');
  return binding;
}

/** @param {Readonly<AnyRecord>} fixture */
function roleResponse(fixture) {
  const roleName = getAwsSingleNodeRuntimeRoleName({
    providerScopeId: fixture.base.providerScope.providerScopeId,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
  });
  return {
    Role: {
      Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
      RoleName: roleName,
      RoleId: IDS.runtimeRole,
      Arn: `arn:aws:iam::123456789012:role${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${roleName}`,
      Description: AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
      MaxSessionDuration: AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
      AssumeRolePolicyDocument: encodeURIComponent(
        JSON.stringify(getAwsSingleNodeRuntimeRoleTrustPolicy()),
      ),
    },
  };
}

/** @param {Readonly<AnyRecord>} fixture */
function expectedRoleTags(fixture) {
  const binding = runtimeRoleBinding(fixture);
  const roleAction = fixture.plan.actions.find(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === 'runtime-role',
  );
  if (roleAction === undefined) throw new Error('Missing runtime role action.');
  return getAwsSingleNodeRuntimeRoleOwnershipTags({
    capabilityKind: binding.capability.kind,
    roleKind: binding.role.kind,
    providerScopeId: fixture.base.providerScope.providerScopeId,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
    resourceKey: binding.resourceKey,
    createdByActionId: binding.createdByActionId,
    ownershipNonce: binding.ownershipNonce,
    stateDigest: roleAction.after.stateDigest,
  });
}

/** @param {Readonly<AnyRecord>} fixture @param {unknown} [document] @param {Record<string, any>} [overrides] */
function policyResponse(fixture, document = undefined, overrides = {}) {
  const roleName = roleResponse(fixture).Role.RoleName;
  return {
    RoleName: roleName,
    PolicyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
    PolicyDocument: encodeURIComponent(
      JSON.stringify(
        document ??
          createAwsSingleNodeRuntimePolicy(
            runtimePolicyAuthority(fixture.base),
          ),
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
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} client @param {{maxAttempts?: number, waitForRetry?: (attempt: number) => Promise<void>}} [options] */
function observerFor(fixture, client, options = {}) {
  return createAwsSingleNodeRuntimeRolePolicyResourceObserver({
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
    resourceKey: 'runtime-role-policy',
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
function policyIdentity() {
  return {
    providerType: 'iam-role-inline-policy',
    providerResourceId: getAwsSingleNodeRuntimePolicyProviderResourceId({
      runtimeRoleId: IDS.runtimeRole,
    }),
  };
}

describe('AWS single-node runtime role policy resource observer', () => {
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
      createAwsSingleNodeRuntimeRolePolicyResourceObserver({
        client: { ...client, putRolePolicy: async () => ({}) },
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(/putRolePolicy is not supported/);
  });

  it('re-proves exact artifact and RoleId lineage before I/O', async () => {
    const fixture = makeAuthorityFixture();
    const forged = clone(fixture.authority);
    forged.binding.dependencyBindings[0].bindingId = semanticId(
      'wdb2',
      'wharfie:test:wrong-runtime-role-policy-dependency:v1',
      {},
    );
    const client = makeClient(fixture);

    await expect(
      observerFor(fixture, client).observe(forged),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeRuntimeRolePolicyResourceObserverAuthorityError,
    );
    expect(client.getRole).not.toHaveBeenCalled();
  });

  it('verifies bound desired policy evidence and freezes every request', async () => {
    const fixture = makeAuthorityFixture();
    const client = makeClient(fixture);
    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'verified',
        policyIdentity(),
        fixture.action.after.stateDigest,
      ),
    );
    expectDeepFrozen(observation);
    const roleName = roleResponse(fixture).Role.RoleName;
    expect(client.getRole).toHaveBeenCalledWith({ RoleName: roleName });
    expect(client.getRolePolicy).toHaveBeenCalledWith({
      RoleName: roleName,
      PolicyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
    });
    for (const method of Object.values(client)) {
      for (const [request] of method.mock.calls) expectDeepFrozen(request);
    }
  });

  it('reports bound readable policy drift as verified actual state', async () => {
    const fixture = makeAuthorityFixture();
    const drifted = { Version: '2012-10-17', Statement: [] };
    const client = makeClient(fixture, {
      getRolePolicy: jest.fn(async () => policyResponse(fixture, drifted)),
    });

    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'verified',
        policyIdentity(),
        createAwsSingleNodeRuntimeRolePolicyObservedStateDigest({
          policyDocument: drifted,
        }),
      ),
    );
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
        policyIdentity(),
        fixture.action.after.stateDigest,
      ),
    );
    expect(observation.execution).toBe('none');
  });

  it('reports a drifted occupied current-create slot as conflict', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const client = makeClient(fixture, {
      listRoleTags: jest.fn(async () => {
        throw providerError('NetworkingError');
      }),
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
      expectedObservation('present', 'conflict', policyIdentity(), null),
    );
  });

  it('reports bound absence only after every policy projection stays clean', async () => {
    const fixture = makeAuthorityFixture();
    const client = makeClient(fixture, {
      listRolePolicies: jest.fn(async () => ({
        PolicyNames: [],
        IsTruncated: false,
      })),
      getRolePolicy: jest.fn(async () => {
        throw providerError('NoSuchEntity');
      }),
    });

    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
    }).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('absent', 'missing', null, null),
    );
    expect(client.getRolePolicy).toHaveBeenCalledTimes(2);
    expect(client.listRolePolicies).toHaveBeenCalledTimes(2);
  });

  it('keeps current-create repeated clean absence unknown', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const client = makeClient(fixture, {
      listRolePolicies: jest.fn(async () => ({
        PolicyNames: [],
        IsTruncated: false,
      })),
      getRolePolicy: jest.fn(async () => {
        throw providerError('NoSuchEntityException');
      }),
    });

    await expect(
      observerFor(fixture, client, { maxAttempts: 2 }).observe(
        fixture.authority,
      ),
    ).resolves.toEqual(expectedObservation('unknown', 'unknown', null, null));
  });

  it('treats repeated complete parent-role loss as clean non-create absence', async () => {
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
    });

    await expect(
      observerFor(fixture, client, { maxAttempts: 2 }).observe(
        fixture.authority,
      ),
    ).resolves.toEqual(expectedObservation('absent', 'missing', null, null));
    expect(missing).toHaveBeenCalledTimes(10);
  });

  it('suppresses absence after any earlier unreadable policy projection', async () => {
    const fixture = makeAuthorityFixture();
    const getRolePolicy = jest
      .fn(async () => {
        throw providerError('NoSuchEntity');
      })
      .mockRejectedValueOnce(providerError('NetworkingError'));
    const client = makeClient(fixture, {
      listRolePolicies: jest.fn(async () => ({
        PolicyNames: [],
        IsTruncated: false,
      })),
      getRolePolicy,
    });

    await expect(
      observerFor(fixture, client, { maxAttempts: 2 }).observe(
        fixture.authority,
      ),
    ).resolves.toEqual(expectedObservation('unknown', 'unknown', null, null));
  });

  it('keeps ListRolePolicies/GetRolePolicy propagation disagreement unknown', async () => {
    const fixture = makeAuthorityFixture();
    const client = makeClient(fixture, {
      getRolePolicy: jest.fn(async () => {
        throw providerError('NoSuchEntity');
      }),
    });

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(expectedObservation('unknown', 'unknown', null, null));
  });

  it('gives a decoded wrong policy identity precedence over another failed read', async () => {
    const fixture = makeAuthorityFixture();
    const client = makeClient(fixture, {
      listRoleTags: jest.fn(async () => {
        throw providerError('NetworkingError');
      }),
      getRolePolicy: jest.fn(async () =>
        policyResponse(fixture, undefined, { RoleName: 'foreign-role' }),
      ),
    });

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation('present', 'conflict', policyIdentity(), null),
    );
  });

  it('does not request a later page after an earlier inline-policy contradiction', async () => {
    const fixture = makeAuthorityFixture();
    let callCount = 0;
    const listRolePolicies = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ _request) => {
        callCount += 1;
        if (callCount === 1) {
          return {
            PolicyNames: ['foreign-admin-policy'],
            IsTruncated: true,
            Marker: 'later-page',
          };
        }
        throw providerError('NetworkingError');
      },
    );
    const client = makeClient(fixture, { listRolePolicies });

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation('present', 'conflict', policyIdentity(), null),
    );
    expect(listRolePolicies).toHaveBeenCalledTimes(1);
  });

  it('reports contradictory role ownership tags as conflict', async () => {
    const fixture = makeAuthorityFixture();
    const wrongTags = /** @type {Array<{Key: string, Value: string}>} */ (
      clone(expectedRoleTags(fixture))
    );
    wrongTags[0].Value = 'foreign';
    const client = makeClient(fixture, {
      listRoleTags: jest.fn(async () => ({
        Tags: wrongTags,
        IsTruncated: false,
      })),
    });

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(
      expectedObservation('present', 'conflict', policyIdentity(), null),
    );
  });

  it('keeps an early unbound target without dependency receipts unknown', async () => {
    const fixture = makeAuthorityFixture('early-unbound');
    const client = makeClient(makeAuthorityFixture());

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual(expectedObservation('unknown', 'unknown', null, null));
    expect(client.getRole).not.toHaveBeenCalled();
  });

  it('maps a failed retry wait to unknown without replay advice', async () => {
    const fixture = makeAuthorityFixture();
    const client = makeClient(fixture, {
      getRolePolicy: jest.fn(async () => {
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
