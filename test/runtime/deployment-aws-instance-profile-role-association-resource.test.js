import { describe, expect, it, jest } from '@jest/globals';

import { compareCanonicalStrings } from '../../src/core/runtime/canonical-order.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_READ_PAGES,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_PROFILE_PAGE_SIZE,
  AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError,
  AwsSingleNodeInstanceProfileRoleAssociationResourceUnknownError,
  createAwsSingleNodeInstanceProfileRoleAssociationResource,
} from '../../src/core/runtime/deployment-aws-instance-profile-role-association-resource.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
  AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  createAwsSingleNodeRuntimeIdentityTags,
  createAwsSingleNodeRuntimePolicy,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimeAssociationStateDigest,
  getAwsSingleNodeRuntimeInstanceProfileName,
  getAwsSingleNodeRuntimeInstanceProfileStateDigest,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
  getAwsSingleNodeRuntimePolicyStateDigest,
  getAwsSingleNodeRuntimeRoleName,
  getAwsSingleNodeRuntimeRoleStateDigest,
  getAwsSingleNodeRuntimeRoleTrustPolicy,
} from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
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

const ROLE_ID = 'AROA1234567890EXAMPLE';
const OTHER_ROLE_ID = 'AROA0987654321EXAMPLE';
const PROFILE_ID = 'AIPA1234567890EXAMPLE';
const OTHER_PROFILE_ID = 'AIPA0987654321EXAMPLE';

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

/** @returns {Readonly<Record<string, any>>} */
function makeBase() {
  const profile = validateDeploymentProfile(
    createDeploymentProfile({
      profile: { id: 'production' },
      appId: 'runtime-association-resource-test',
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
      'wharfie:test:runtime-association-revision:v1',
      { revision: 1 },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'runtime association resource artifact',
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
    },
    placement: { availabilityZoneId: 'use1-az1' },
    storage: {
      ebsKmsKeyArn:
        'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    },
    bootstrapDigest: digest('runtime association bootstrap'),
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
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 7)),
  });
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

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} definition @returns {string} */
function providerResourceId(base, definition) {
  if (definition.resourceKey === 'artifact') {
    return getAwsSingleNodeManagedArtifactObjectLocation(policyAuthority(base))
      .arn;
  }
  if (definition.resourceKey === 'runtime-role') return ROLE_ID;
  if (definition.resourceKey === 'runtime-role-policy') {
    return getAwsSingleNodeRuntimePolicyProviderResourceId({
      runtimeRoleId: ROLE_ID,
    });
  }
  if (definition.resourceKey === 'runtime-identity') return PROFILE_ID;
  if (definition.resourceKey === 'runtime-identity-role-association') {
    return getAwsSingleNodeRuntimeAssociationProviderResourceId({
      runtimeRoleId: ROLE_ID,
      instanceProfileId: PROFILE_ID,
    });
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

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} definition @returns {Readonly<Record<string, any>>} */
function desiredState(base, definition) {
  let stateDigest = digest(`${definition.resourceKey} desired`);
  if (definition.resourceKey === 'runtime-role') {
    stateDigest = getAwsSingleNodeRuntimeRoleStateDigest(nameAuthority(base));
  } else if (definition.resourceKey === 'runtime-role-policy') {
    stateDigest = getAwsSingleNodeRuntimePolicyStateDigest(
      policyAuthority(base),
    );
  } else if (definition.resourceKey === 'runtime-identity') {
    stateDigest = getAwsSingleNodeRuntimeInstanceProfileStateDigest(
      nameAuthority(base),
    );
  } else if (definition.resourceKey === 'runtime-identity-role-association') {
    stateDigest = getAwsSingleNodeRuntimeAssociationStateDigest(
      nameAuthority(base),
    );
  }
  return {
    providerType: definition.providerType,
    providerResourceId: null,
    stateDigest,
  };
}

/** @param {Readonly<Record<string, any>>} base @param {'apply'|'reconcile'|'destroy'} operation @returns {Readonly<Record<string, any>>} */
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
          'win5',
          'wharfie:test:runtime-association-inspection:v1',
          { operation },
        ),
      },
      actions,
    },
    { profile: base.profile },
  );
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} action @param {string} ownershipNonce @param {Readonly<Array<Readonly<{resourceKey: string, bindingId: string}>>>} dependencyBindings @returns {Readonly<Record<string, any>>} */
function makeBinding(base, action, ownershipNonce, dependencyBindings) {
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
    dependencyBindings,
    providerType: action.before?.providerType ?? action.after.providerType,
    providerResourceId: providerResourceId(base, action),
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce,
    createdByActionId:
      action.action === 'create'
        ? action.actionId
        : semanticId(
            'wda3',
            'wharfie:test:runtime-association-create-action:v1',
            { resourceKey: action.resourceKey },
          ),
  });
}

/** @param {Readonly<Array<Readonly<Record<string, any>>>>} bindings @returns {Readonly<Array<Readonly<{resourceKey: string, bindingId: string}>>>} */
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

/** @param {{operation?: 'apply'|'reconcile'|'destroy'}} [options] @returns {Readonly<Record<string, any>>} */
function makeFixture(options = {}) {
  const operation = options.operation ?? 'apply';
  const base = makeBase();
  const plan = makePlan(base, operation);
  const actionByKey = new Map(
    plan.actions.map((/** @type {Readonly<AnyRecord>} */ action) => [
      action.resourceKey,
      action,
    ]),
  );
  const artifactAction = actionByKey.get('artifact');
  const roleAction = actionByKey.get('runtime-role');
  const policyAction = actionByKey.get('runtime-role-policy');
  const profileAction = actionByKey.get('runtime-identity');
  const action = actionByKey.get('runtime-identity-role-association');
  if (
    artifactAction === undefined ||
    roleAction === undefined ||
    policyAction === undefined ||
    profileAction === undefined ||
    action === undefined
  ) {
    throw new Error('Missing runtime association action graph.');
  }
  const actionIndex = plan.actions.indexOf(action);
  const artifactBinding = makeBinding(base, artifactAction, nonce(31), []);
  const roleBinding = makeBinding(base, roleAction, nonce(32), []);
  const profileBinding = makeBinding(base, profileAction, nonce(33), []);
  const policyBinding = makeBinding(
    base,
    policyAction,
    nonce(34),
    receipts([artifactBinding, roleBinding]),
  );
  const ownershipNonce = nonce(35);
  const dependencyBindings = receipts([
    roleBinding,
    policyBinding,
    profileBinding,
  ]);
  const priorBinding =
    action.action === 'create'
      ? null
      : makeBinding(base, action, ownershipNonce, dependencyBindings);
  const resourceBindings = [
    artifactBinding,
    roleBinding,
    policyBinding,
    profileBinding,
    ...(priorBinding === null ? [] : [priorBinding]),
  ];
  const bindingByKey = new Map(
    resourceBindings.map((binding) => [binding.resourceKey, binding]),
  );
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
        index === actionIndex
          ? ownershipNonce
          : (bindingByKey.get(candidate.resourceKey)?.ownershipNonce ??
            nonce(60 + index)),
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
    lastOperation:
      priorBinding === null
        ? null
        : {
            kind: 'create',
            planId: semanticId(
              'wpl3',
              'wharfie:test:runtime-association-last-plan:v1',
              { operation },
            ),
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
    artifactBinding,
    roleBinding,
    policyBinding,
    profileBinding,
    dependencyBindings,
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

/** @param {ReturnType<typeof makeFixture>} fixture @param {Readonly<Array<Readonly<Record<string, any>>>>} resourceBindings @returns {Readonly<Record<string, any>>} */
function contextWithBindings(fixture, resourceBindings) {
  const head = fixture.head;
  const changed = createDeploymentHead({
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
  return Object.freeze({ ...fixture.context, head: changed });
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Array<Readonly<{resourceKey: string, bindingId: string}>>>} dependencyBindings @returns {Readonly<Record<string, any>>} */
function bindingWithDependencies(binding, dependencyBindings) {
  return createDeploymentResourceBinding({
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
    dependencyBindings,
    providerType: binding.providerType,
    providerResourceId: binding.providerResourceId,
    providerScopeId: binding.providerScopeId,
    ownershipNonce: binding.ownershipNonce,
    createdByActionId: binding.createdByActionId,
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {'role'|'profile'} kind @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>} */
function endpointTags(fixture, kind) {
  const roleEndpoint = kind === 'role';
  const binding = roleEndpoint ? fixture.roleBinding : fixture.profileBinding;
  return createAwsSingleNodeRuntimeIdentityTags({
    resourceKind: roleEndpoint
      ? 'single-node-runtime-role'
      : 'single-node-runtime-instance-profile',
    capabilityKind: 'runtime-identity',
    roleKind: roleEndpoint ? 'role' : 'instance-profile',
    providerScopeId: fixture.base.providerScope.providerScopeId,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
    resourceKey: roleEndpoint ? 'runtime-role' : 'runtime-identity',
    createdByActionId: binding.createdByActionId,
    ownershipNonce: binding.ownershipNonce,
    stateDigest: roleEndpoint
      ? getAwsSingleNodeRuntimeRoleStateDigest(nameAuthority(fixture.base))
      : getAwsSingleNodeRuntimeInstanceProfileStateDigest(
          nameAuthority(fixture.base),
        ),
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] @returns {AnyRecord} */
function makeRole(fixture, overrides = {}) {
  const roleName = getAwsSingleNodeRuntimeRoleName(nameAuthority(fixture.base));
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

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] @returns {AnyRecord} */
function makeRoleReference(fixture, overrides = {}) {
  const role = makeRole(fixture);
  return {
    Path: role.Path,
    RoleName: role.RoleName,
    RoleId: role.RoleId,
    Arn: role.Arn,
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Readonly<Array<Readonly<Record<string, any>>>>} roles @param {Record<string, any>} [overrides] @returns {AnyRecord} */
function makeInstanceProfile(fixture, roles, overrides = {}) {
  const name = getAwsSingleNodeRuntimeInstanceProfileName(
    nameAuthority(fixture.base),
  );
  return {
    Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
    InstanceProfileName: name,
    InstanceProfileId: PROFILE_ID,
    Arn: `arn:aws:iam::123456789012:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${name}`,
    Roles: roles,
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] @returns {AnyRecord} */
function makeProfileReference(fixture, overrides = {}) {
  const profile = makeInstanceProfile(fixture, []);
  return {
    Path: profile.Path,
    InstanceProfileName: profile.InstanceProfileName,
    InstanceProfileId: profile.InstanceProfileId,
    Arn: profile.Arn,
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] @returns {Readonly<Record<string, jest.Mock>>} */
function makeClient(fixture, options = {}) {
  const membership = options.membership ?? 'present';
  const roles = membership === 'present' ? [makeRoleReference(fixture)] : [];
  const profiles =
    membership === 'present' ? [makeProfileReference(fixture)] : [];
  return Object.freeze({
    getRole:
      options.getRole ?? jest.fn(async () => ({ Role: makeRole(fixture) })),
    listRoleTags:
      options.listRoleTags ??
      jest.fn(async () => ({
        Tags: endpointTags(fixture, 'role'),
        IsTruncated: false,
      })),
    getRolePolicy:
      options.getRolePolicy ??
      jest.fn(async () => ({
        RoleName: getAwsSingleNodeRuntimeRoleName(nameAuthority(fixture.base)),
        PolicyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
        PolicyDocument: encodeURIComponent(
          JSON.stringify(
            createAwsSingleNodeRuntimePolicy(policyAuthority(fixture.base)),
          ),
        ),
      })),
    listRolePolicies:
      options.listRolePolicies ??
      jest.fn(async () => ({
        PolicyNames: [AWS_SINGLE_NODE_RUNTIME_POLICY_NAME],
        IsTruncated: false,
      })),
    listAttachedRolePolicies:
      options.listAttachedRolePolicies ??
      jest.fn(async () => ({
        AttachedPolicies: [],
        IsTruncated: false,
      })),
    getInstanceProfile:
      options.getInstanceProfile ??
      jest.fn(async () => ({
        InstanceProfile: makeInstanceProfile(fixture, roles),
      })),
    listInstanceProfileTags:
      options.listInstanceProfileTags ??
      jest.fn(async () => ({
        Tags: endpointTags(fixture, 'profile'),
        IsTruncated: false,
      })),
    listInstanceProfilesForRole:
      options.listInstanceProfilesForRole ??
      jest.fn(async () => ({
        InstanceProfiles: profiles,
        IsTruncated: false,
      })),
    addRoleToInstanceProfile:
      options.addRoleToInstanceProfile ?? jest.fn(async () => ({})),
    removeRoleFromInstanceProfile:
      options.removeRoleFromInstanceProfile ?? jest.fn(async () => ({})),
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makePorts(fixture, options = {}) {
  const client = options.client ?? makeClient(fixture, options);
  const waitForRetry = options.waitForRetry ?? jest.fn();
  return {
    client,
    waitForRetry,
    resource: createAwsSingleNodeInstanceProfileRoleAssociationResource({
      client,
      providerScope: fixture.base.providerScope,
      maxAttempts: options.maxAttempts ?? 1,
      waitForRetry,
    }),
  };
}

describe('AWS runtime role/profile association create and recovery', () => {
  it('settles exact bidirectional membership into a frozen synthetic binding with three receipts', async () => {
    const fixture = makeFixture();
    const { resource } = makePorts(fixture);

    expect(fixture.action.after).toEqual({
      providerType: 'iam-instance-profile-role-association',
      providerResourceId: null,
      stateDigest: getAwsSingleNodeRuntimeAssociationStateDigest(
        nameAuthority(fixture.base),
      ),
    });
    expect(JSON.stringify(fixture.plan)).not.toContain(ROLE_ID);
    expect(JSON.stringify(fixture.plan)).not.toContain(PROFILE_ID);

    const settlement = await resource.verifySettlement(fixture.context);

    expect(settlement).toMatchObject({
      status: 'converged',
      binding: {
        resourceKey: 'runtime-identity-role-association',
        providerType: 'iam-instance-profile-role-association',
        providerResourceId:
          getAwsSingleNodeRuntimeAssociationProviderResourceId({
            runtimeRoleId: ROLE_ID,
            instanceProfileId: PROFILE_ID,
          }),
        ownershipMode: 'derived',
        dependencyBindings: fixture.dependencyBindings,
        ownershipNonce: fixture.ownershipNonce,
        createdByActionId: fixture.action.actionId,
      },
    });
    expect(settlement.binding.dependencyBindings).toHaveLength(3);
    expectDeepFrozen(settlement);
  });

  it('adds the exact endpoints at most once and recovers only through exact bidirectional readback', async () => {
    const fixture = makeFixture();
    const getInstanceProfile = jest
      .fn(async (/** @type {AnyRecord} */ _input) => ({
        InstanceProfile: makeInstanceProfile(fixture, []),
      }))
      .mockResolvedValueOnce({
        InstanceProfile: makeInstanceProfile(fixture, []),
      })
      .mockResolvedValueOnce({
        InstanceProfile: makeInstanceProfile(fixture, [
          makeRoleReference(fixture),
        ]),
      });
    const listInstanceProfilesForRole = jest
      .fn(async (/** @type {AnyRecord} */ _input) => ({
        InstanceProfiles: [makeProfileReference(fixture)],
        IsTruncated: false,
      }))
      .mockResolvedValueOnce({
        InstanceProfiles: [],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({
        InstanceProfiles: [makeProfileReference(fixture)],
        IsTruncated: false,
      });
    const client = makeClient(fixture, {
      getInstanceProfile,
      listInstanceProfilesForRole,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);

    expect(client.addRoleToInstanceProfile).toHaveBeenCalledTimes(1);
    expect(client.addRoleToInstanceProfile).toHaveBeenCalledWith({
      InstanceProfileName: getAwsSingleNodeRuntimeInstanceProfileName(
        nameAuthority(fixture.base),
      ),
      RoleName: getAwsSingleNodeRuntimeRoleName(nameAuthority(fixture.base)),
    });
    expectDeepFrozen(client.addRoleToInstanceProfile.mock.calls[0][0]);
    expect(client.removeRoleFromInstanceProfile).not.toHaveBeenCalled();
  });

  it('recovers an ambiguous AddRoleToInstanceProfile response without echoing provider details', async () => {
    const fixture = makeFixture();
    const getInstanceProfile = jest
      .fn(async (/** @type {AnyRecord} */ _input) => ({
        InstanceProfile: makeInstanceProfile(fixture, []),
      }))
      .mockResolvedValueOnce({
        InstanceProfile: makeInstanceProfile(fixture, []),
      })
      .mockResolvedValueOnce({
        InstanceProfile: makeInstanceProfile(fixture, [
          makeRoleReference(fixture),
        ]),
      });
    const listInstanceProfilesForRole = jest
      .fn(async (/** @type {AnyRecord} */ _input) => ({
        InstanceProfiles: [makeProfileReference(fixture)],
        IsTruncated: false,
      }))
      .mockResolvedValueOnce({ InstanceProfiles: [], IsTruncated: false })
      .mockResolvedValueOnce({
        InstanceProfiles: [makeProfileReference(fixture)],
        IsTruncated: false,
      });
    const addRoleToInstanceProfile = jest.fn(async () => {
      throw new Error('provider credential response-loss secret');
    });
    const client = makeClient(fixture, {
      getInstanceProfile,
      listInstanceProfilesForRole,
      addRoleToInstanceProfile,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(addRoleToInstanceProfile).toHaveBeenCalledTimes(1);
  });

  it('retries one-sided eventual consistency and does not replay the mutation', async () => {
    const fixture = makeFixture();
    const listInstanceProfilesForRole = jest
      .fn(async (/** @type {AnyRecord} */ _input) => ({
        InstanceProfiles: [makeProfileReference(fixture)],
        IsTruncated: false,
      }))
      .mockResolvedValueOnce({ InstanceProfiles: [], IsTruncated: false })
      .mockResolvedValueOnce({
        InstanceProfiles: [makeProfileReference(fixture)],
        IsTruncated: false,
      });
    const waitForRetry = jest.fn();
    const client = makeClient(fixture, { listInstanceProfilesForRole });
    const { resource } = makePorts(fixture, {
      client,
      maxAttempts: 2,
      waitForRetry,
    });

    await expect(
      resource.verifySettlement(fixture.context),
    ).resolves.toMatchObject({ status: 'converged' });
    expect(waitForRetry).toHaveBeenCalledTimes(1);
    expect(client.addRoleToInstanceProfile).not.toHaveBeenCalled();
  });
});

describe('AWS runtime role/profile association exact effect evidence', () => {
  it.each([
    [
      'broadened role trust',
      {
        getRole: (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
          jest.fn(async () => ({
            Role: makeRole(fixture, {
              AssumeRolePolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [
                  { Effect: 'Allow', Principal: '*', Action: 'sts:*' },
                ],
              }),
            }),
          })),
      },
    ],
    [
      'drifted inline policy',
      {
        getRolePolicy: (
          /** @type {ReturnType<typeof makeFixture>} */ fixture,
        ) =>
          jest.fn(async () => ({
            RoleName: getAwsSingleNodeRuntimeRoleName(
              nameAuthority(fixture.base),
            ),
            PolicyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
            PolicyDocument: JSON.stringify({
              Version: '2012-10-17',
              Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }],
            }),
          })),
      },
    ],
    [
      'drifted profile tags',
      {
        listInstanceProfileTags: (
          /** @type {ReturnType<typeof makeFixture>} */ fixture,
        ) =>
          jest.fn(async () => ({
            Tags: endpointTags(fixture, 'profile').map((tag) =>
              tag.Key === 'wharfie:state-digest'
                ? { ...tag, Value: digest('wrong').value }
                : tag,
            ),
            IsTruncated: false,
          })),
      },
    ],
    [
      'an extra inline policy',
      {
        listRolePolicies: (
          /** @type {ReturnType<typeof makeFixture>} */ _fixture,
        ) =>
          jest.fn(async () => ({
            PolicyNames: [
              AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
              'foreign-inline-policy',
            ],
            IsTruncated: false,
          })),
      },
    ],
    [
      'an attached managed policy',
      {
        listAttachedRolePolicies: (
          /** @type {ReturnType<typeof makeFixture>} */ _fixture,
        ) =>
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
    [
      'recreated role ID',
      {
        getRole: (/** @type {ReturnType<typeof makeFixture>} */ fixture) =>
          jest.fn(async () => ({
            Role: makeRole(fixture, { RoleId: OTHER_ROLE_ID }),
          })),
      },
    ],
    [
      'recreated profile ID',
      {
        getInstanceProfile: (
          /** @type {ReturnType<typeof makeFixture>} */ fixture,
        ) =>
          jest.fn(async () => ({
            InstanceProfile: makeInstanceProfile(
              fixture,
              [makeRoleReference(fixture)],
              { InstanceProfileId: OTHER_PROFILE_ID },
            ),
          })),
      },
    ],
  ])('blocks %s before mutation', async (_name, factories) => {
    const fixture = makeFixture();
    const options = Object.fromEntries(
      Object.entries(factories).map(([key, factory]) => [
        key,
        factory(fixture),
      ]),
    );
    const client = makeClient(fixture, options);
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError,
    );
    expect(client.addRoleToInstanceProfile).not.toHaveBeenCalled();
    expect(client.removeRoleFromInstanceProfile).not.toHaveBeenCalled();
  });

  it.each([
    [
      'foreign role in the profile',
      {
        getInstanceProfile: (
          /** @type {ReturnType<typeof makeFixture>} */ fixture,
        ) =>
          jest.fn(async () => ({
            InstanceProfile: makeInstanceProfile(fixture, [
              makeRoleReference(fixture, {
                RoleName: 'foreign-role',
                RoleId: OTHER_ROLE_ID,
                Arn: `arn:aws:iam::123456789012:role${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}foreign-role`,
              }),
            ]),
          })),
      },
    ],
    [
      'foreign profile on the role',
      {
        listInstanceProfilesForRole: (
          /** @type {ReturnType<typeof makeFixture>} */ fixture,
        ) =>
          jest.fn(async () => ({
            InstanceProfiles: [
              makeProfileReference(fixture, {
                InstanceProfileName: 'foreign-profile',
                InstanceProfileId: OTHER_PROFILE_ID,
                Arn: `arn:aws:iam::123456789012:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}foreign-profile`,
              }),
            ],
            IsTruncated: false,
          })),
      },
    ],
    [
      'multiple profile roles',
      {
        getInstanceProfile: (
          /** @type {ReturnType<typeof makeFixture>} */ fixture,
        ) =>
          jest.fn(async () => ({
            InstanceProfile: makeInstanceProfile(fixture, [
              makeRoleReference(fixture),
              makeRoleReference(fixture),
            ]),
          })),
      },
    ],
  ])(
    'blocks well-formed contradictory membership: %s',
    async (_name, factories) => {
      const fixture = makeFixture();
      const options = Object.fromEntries(
        Object.entries(factories).map(([key, factory]) => [
          key,
          factory(fixture),
        ]),
      );
      const client = makeClient(fixture, options);
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'blocked',
        },
      );
    },
  );

  it('rejects policy dependency lineage tampering before any provider read', async () => {
    const fixture = makeFixture();
    const changedPolicyBinding = bindingWithDependencies(
      fixture.policyBinding,
      receipts([fixture.artifactBinding]),
    );
    const changedBindings = fixture.head.resourceBindings.map(
      (/** @type {Readonly<AnyRecord>} */ binding) =>
        binding.resourceKey === 'runtime-role-policy'
          ? changedPolicyBinding
          : binding,
    );
    const context = contextWithBindings(fixture, changedBindings);
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(context)).rejects.toBeInstanceOf(
      AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError,
    );
    expect(client.getRole).not.toHaveBeenCalled();
  });

  it('maps malformed/access evidence to a fixed unknown error without provider details', async () => {
    const fixture = makeFixture();
    for (const options of [
      { getRole: jest.fn(async () => ({ providerSecret: 'bad envelope' })) },
      {
        getRolePolicy: jest.fn(async () => {
          throw new Error('credential-bearing access provider secret');
        }),
      },
    ]) {
      const client = makeClient(fixture, options);
      const { resource } = makePorts(fixture, { client });
      const observed = await resource
        .verifySettlement(fixture.context)
        .catch((/** @type {unknown} */ error) => error);
      expect(observed).toBeInstanceOf(
        AwsSingleNodeInstanceProfileRoleAssociationResourceUnknownError,
      );
      expect(observed).toEqual(
        expect.objectContaining({
          message:
            'AWS single-node instance profile role association state is unknown.',
        }),
      );
      expect(JSON.stringify(observed)).not.toContain('secret');
    }
  });

  it('never treats an IAM list page without explicit truncation evidence as complete', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      listRolePolicies: jest.fn(async () => ({
        PolicyNames: [AWS_SINGLE_NODE_RUNTIME_POLICY_NAME],
      })),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInstanceProfileRoleAssociationResourceUnknownError,
    );
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInstanceProfileRoleAssociationResourceUnknownError,
    );
    expect(client.addRoleToInstanceProfile).not.toHaveBeenCalled();
    expect(client.removeRoleFromInstanceProfile).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an oversized result page',
      (/** @type {ReturnType<typeof makeFixture>} */ fixture) => ({
        InstanceProfiles: Array.from(
          {
            length:
              AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_PROFILE_PAGE_SIZE +
              1,
          },
          () => makeProfileReference(fixture),
        ),
        IsTruncated: false,
      }),
    ],
    [
      'an oversized continuation marker',
      (/** @type {ReturnType<typeof makeFixture>} */ _fixture) => ({
        InstanceProfiles: [],
        IsTruncated: true,
        Marker: 'm'.repeat(4097),
      }),
    ],
  ])('rejects %s without following it', async (_name, responseFactory) => {
    const fixture = makeFixture();
    const listInstanceProfilesForRole = jest.fn(async () =>
      responseFactory(fixture),
    );
    const client = makeClient(fixture, { listInstanceProfilesForRole });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInstanceProfileRoleAssociationResourceUnknownError,
    );
    expect(listInstanceProfilesForRole).toHaveBeenCalledTimes(1);
    expect(client.addRoleToInstanceProfile).not.toHaveBeenCalled();
    expect(client.removeRoleFromInstanceProfile).not.toHaveBeenCalled();
  });

  it('reads paginated role-side membership before declaring presence', async () => {
    const fixture = makeFixture();
    const listInstanceProfilesForRole = jest
      .fn(async (/** @type {AnyRecord} */ _input) => ({
        .../** @type {AnyRecord} */ ({
          InstanceProfiles: [makeProfileReference(fixture)],
          IsTruncated: false,
        }),
      }))
      .mockResolvedValueOnce({
        InstanceProfiles: [],
        IsTruncated: true,
        Marker: 'next-page',
      })
      .mockResolvedValueOnce({
        InstanceProfiles: [makeProfileReference(fixture)],
        IsTruncated: false,
      });
    const client = makeClient(fixture, { listInstanceProfilesForRole });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).resolves.toMatchObject({ status: 'converged' });
    expect(listInstanceProfilesForRole).toHaveBeenNthCalledWith(1, {
      RoleName: getAwsSingleNodeRuntimeRoleName(nameAuthority(fixture.base)),
      MaxItems:
        AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_PROFILE_PAGE_SIZE,
    });
    expect(listInstanceProfilesForRole).toHaveBeenNthCalledWith(2, {
      RoleName: getAwsSingleNodeRuntimeRoleName(nameAuthority(fixture.base)),
      MaxItems:
        AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_PROFILE_PAGE_SIZE,
      Marker: 'next-page',
    });
    expectDeepFrozen(listInstanceProfilesForRole.mock.calls[0][0]);
  });

  it.each([
    ['a repeated marker', 'cycle', 2],
    [
      'the fixed page cap',
      'unique',
      AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_READ_PAGES,
    ],
  ])('fails closed at %s', async (_name, mode, expectedCalls) => {
    const fixture = makeFixture();
    let page = 0;
    const listInstanceProfilesForRole = jest.fn(
      async (/** @type {AnyRecord} */ _input) => {
        page += 1;
        return {
          InstanceProfiles: [],
          IsTruncated: true,
          Marker: mode === 'cycle' ? 'same' : `page-${page}`,
        };
      },
    );
    const client = makeClient(fixture, { listInstanceProfilesForRole });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInstanceProfileRoleAssociationResourceUnknownError,
    );
    expect(listInstanceProfilesForRole).toHaveBeenCalledTimes(expectedCalls);
  });
});

describe('AWS runtime role/profile association noop and destroy', () => {
  it('returns the exact prior binding for noop and never mutates', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: fixture.priorBinding,
    });
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.addRoleToInstanceProfile).not.toHaveBeenCalled();
    expect(client.removeRoleFromInstanceProfile).not.toHaveBeenCalled();
  });

  it('removes exact present membership once and recovers exact absence', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const getInstanceProfile = jest
      .fn(async (/** @type {AnyRecord} */ _input) => ({
        InstanceProfile: makeInstanceProfile(fixture, []),
      }))
      .mockResolvedValueOnce({
        InstanceProfile: makeInstanceProfile(fixture, [
          makeRoleReference(fixture),
        ]),
      })
      .mockResolvedValueOnce({
        InstanceProfile: makeInstanceProfile(fixture, []),
      });
    const listInstanceProfilesForRole = jest
      .fn(async (/** @type {AnyRecord} */ _input) => ({
        .../** @type {AnyRecord} */ ({
          InstanceProfiles: [],
          IsTruncated: false,
        }),
      }))
      .mockResolvedValueOnce({
        InstanceProfiles: [makeProfileReference(fixture)],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({ InstanceProfiles: [], IsTruncated: false });
    const client = makeClient(fixture, {
      getInstanceProfile,
      listInstanceProfilesForRole,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);

    expect(client.removeRoleFromInstanceProfile).toHaveBeenCalledTimes(1);
    expect(client.removeRoleFromInstanceProfile).toHaveBeenCalledWith({
      InstanceProfileName: getAwsSingleNodeRuntimeInstanceProfileName(
        nameAuthority(fixture.base),
      ),
      RoleName: getAwsSingleNodeRuntimeRoleName(nameAuthority(fixture.base)),
    });
    expectDeepFrozen(client.removeRoleFromInstanceProfile.mock.calls[0][0]);
    expect(client.addRoleToInstanceProfile).not.toHaveBeenCalled();
  });

  it('recovers ambiguous removal and settles bidirectional absence', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const getInstanceProfile = jest
      .fn(async (/** @type {AnyRecord} */ _input) => ({
        InstanceProfile: makeInstanceProfile(fixture, []),
      }))
      .mockResolvedValueOnce({
        InstanceProfile: makeInstanceProfile(fixture, [
          makeRoleReference(fixture),
        ]),
      })
      .mockResolvedValueOnce({
        InstanceProfile: makeInstanceProfile(fixture, []),
      });
    const listInstanceProfilesForRole = jest
      .fn(async (/** @type {AnyRecord} */ _input) => ({
        .../** @type {AnyRecord} */ ({
          InstanceProfiles: [],
          IsTruncated: false,
        }),
      }))
      .mockResolvedValueOnce({
        InstanceProfiles: [makeProfileReference(fixture)],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({ InstanceProfiles: [], IsTruncated: false });
    const removeRoleFromInstanceProfile = jest.fn(async () => {
      throw new Error('provider response-loss secret');
    });
    const client = makeClient(fixture, {
      getInstanceProfile,
      listInstanceProfilesForRole,
      removeRoleFromInstanceProfile,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(removeRoleFromInstanceProfile).toHaveBeenCalledTimes(1);
  });

  it('settles already absent membership without a mutation', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, { membership: 'absent' });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.removeRoleFromInstanceProfile).not.toHaveBeenCalled();
  });

  it('never mutates a recreated endpoint during destroy', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, {
      getInstanceProfile: jest.fn(async () => ({
        InstanceProfile: makeInstanceProfile(
          fixture,
          [makeRoleReference(fixture)],
          { InstanceProfileId: OTHER_PROFILE_ID },
        ),
      })),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError,
    );
    expect(client.removeRoleFromInstanceProfile).not.toHaveBeenCalled();
  });

  it('does not remove membership while an attached managed policy is present', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, {
      listAttachedRolePolicies: jest.fn(async () => ({
        AttachedPolicies: [
          {
            PolicyName: 'ReadOnlyAccess',
            PolicyArn: 'arn:aws:iam::aws:policy/ReadOnlyAccess',
          },
        ],
        IsTruncated: false,
      })),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError,
    );
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.removeRoleFromInstanceProfile).not.toHaveBeenCalled();
  });

  it('validates the exact narrow client and bounded options', () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    for (const method of Object.keys(client)) {
      expect(() =>
        createAwsSingleNodeInstanceProfileRoleAssociationResource({
          client: { ...client, [method]: undefined },
          providerScope: fixture.base.providerScope,
        }),
      ).toThrow(`client.${method} is required`);
    }
    expect(() =>
      createAwsSingleNodeInstanceProfileRoleAssociationResource({
        client,
        providerScope: fixture.base.providerScope,
        maxAttempts: 0,
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeInstanceProfileRoleAssociationResource({
        client,
        providerScope: fixture.base.providerScope,
        extra: true,
      }),
    ).toThrow(TypeError);
  });
});
