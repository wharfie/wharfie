import { describe, expect, it, jest } from '@jest/globals';

import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
  AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST,
  AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
  createAwsSingleNodeRuntimePolicy,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
  getAwsSingleNodeRuntimePolicyStateDigest,
  getAwsSingleNodeRuntimeRoleName,
  getAwsSingleNodeRuntimeRoleStateDigest,
  getAwsSingleNodeRuntimeRoleTrustPolicy,
} from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import {
  AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_MAX_READ_PAGES,
  AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_READ_MAX_ITEMS,
  AwsSingleNodeRuntimeRolePolicyResourceConflictError,
  AwsSingleNodeRuntimeRolePolicyResourceUnknownError,
  createAwsSingleNodeRuntimeRolePolicyResource,
} from '../../src/core/runtime/deployment-aws-runtime-role-policy-resource.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
import { createDeploymentPlan } from '../../src/core/runtime/deployment-plan.js';
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
import { AWS_SINGLE_NODE_RESOURCE_GRAPH } from '../../src/core/runtime/deployment-resource-graph.js';
import { validateDeploymentRevision } from '../../src/core/runtime/deployment-revision.js';

/** @typedef {Record<string, any>} AnyRecord */

const RUNTIME_ROLE_ID = 'AROAABCDEFGHIJKLMNOP';
const OTHER_RUNTIME_ROLE_ID = 'AROAQRSTUVWXYZABCDEF';

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

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {any} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @param {Readonly<Record<string, any>>} profile @param {Readonly<Record<string, any>>} providerScope */
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

/** @returns {Readonly<Record<string, any>>} */
function makeBase() {
  const profile = validateDeploymentProfile(
    createDeploymentProfile({
      profile: { id: 'production' },
      appId: 'runtime-role-policy-resource-test',
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
      'wharfie:test:runtime-role-policy-revision:v1',
      { revision: 1 },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'runtime role policy resource artifact',
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
  const providerSpec = makeProviderSpec(profile, providerScope);
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

/** @param {Readonly<Record<string, any>>} base @returns {Readonly<Record<string, any>>} */
function runtimeAuthority(base) {
  return Object.freeze({
    providerScope: base.providerScope,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
  });
}

/** @param {Readonly<Record<string, any>>} base @returns {Readonly<Record<string, any>>} */
function runtimeNameAuthority(base) {
  return Object.freeze({
    providerScopeId: base.providerScope.providerScopeId,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
  });
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} definition @returns {string} */
function providerResourceId(base, definition) {
  if (definition.resourceKey === 'artifact') {
    return getAwsSingleNodeManagedArtifactObjectLocation(runtimeAuthority(base))
      .arn;
  }
  if (definition.resourceKey === 'runtime-role') return RUNTIME_ROLE_ID;
  if (definition.resourceKey === 'runtime-role-policy') {
    return getAwsSingleNodeRuntimePolicyProviderResourceId({
      runtimeRoleId: RUNTIME_ROLE_ID,
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
  const authority = runtimeAuthority(base);
  let stateDigest = digest(`${definition.resourceKey} desired`);
  if (definition.resourceKey === 'runtime-role') {
    stateDigest = getAwsSingleNodeRuntimeRoleStateDigest(
      runtimeNameAuthority(base),
    );
  } else if (definition.resourceKey === 'runtime-role-policy') {
    stateDigest = getAwsSingleNodeRuntimePolicyStateDigest(authority);
  }
  return {
    providerType: definition.providerType,
    providerResourceId: null,
    stateDigest,
  };
}

/** @param {Readonly<Record<string, any>>} base @param {'apply'|'reconcile'|'destroy'} operation */
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
          'win6',
          'wharfie:test:runtime-role-policy-inspection:v1',
          { operation },
        ),
      },
      actions,
    },
    { profile: base.profile },
  );
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} action @param {{providerResourceId: string, ownershipNonce: string, createdByActionId: string}} options */
function makeDirectBinding(base, action, options) {
  return createDeploymentResourceBinding({
    schemaVersion: 2,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    resourceKey: action.resourceKey,
    capability: action.capability,
    role: action.role,
    management: 'managed',
    ownershipMode: 'direct',
    onDestroy: 'purge',
    dependencyBindings: [],
    providerType: action.before?.providerType ?? action.after.providerType,
    providerResourceId: options.providerResourceId,
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce: options.ownershipNonce,
    createdByActionId: options.createdByActionId,
  });
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>[]} dependencies @param {{ownershipNonce: string, createdByActionId: string, providerResourceId?: string}} options */
function makePolicyBinding(base, action, dependencies, options) {
  return createDeploymentResourceBinding({
    schemaVersion: 2,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    resourceKey: action.resourceKey,
    capability: action.capability,
    role: action.role,
    management: 'managed',
    ownershipMode: 'derived',
    onDestroy: 'purge',
    dependencyBindings: dependencies
      .map((binding) => ({
        resourceKey: binding.resourceKey,
        bindingId: binding.bindingId,
      }))
      .sort((left, right) =>
        left.resourceKey < right.resourceKey
          ? -1
          : left.resourceKey > right.resourceKey
            ? 1
            : 0,
      ),
    providerType: 'iam-role-inline-policy',
    providerResourceId:
      options.providerResourceId ??
      getAwsSingleNodeRuntimePolicyProviderResourceId({
        runtimeRoleId: RUNTIME_ROLE_ID,
      }),
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce: options.ownershipNonce,
    createdByActionId: options.createdByActionId,
  });
}

/** @param {{operation?: 'apply'|'reconcile'|'destroy'}} [options] */
function makeFixture(options = {}) {
  const operation = options.operation ?? 'apply';
  const base = makeBase();
  const plan = makePlan(base, operation);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'runtime-role-policy',
  );
  const action = plan.actions[actionIndex];
  const artifactActionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === 'artifact',
  );
  const runtimeRoleActionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === 'runtime-role',
  );
  const artifactAction = plan.actions[artifactActionIndex];
  const runtimeRoleAction = plan.actions[runtimeRoleActionIndex];
  if (
    action === undefined ||
    artifactAction === undefined ||
    runtimeRoleAction === undefined
  ) {
    throw new Error('Missing runtime role policy fixture actions.');
  }
  const ownershipNonce = nonce(73);
  const intentNonces = plan.actions.map(
    (
      /** @type {Readonly<AnyRecord>} */ _candidate,
      /** @type {number} */ index,
    ) => (index === actionIndex ? ownershipNonce : nonce(10 + index)),
  );
  /** @param {Readonly<AnyRecord>} candidate @returns {string} */
  const dependencyReceipt = (candidate) =>
    operation === 'apply'
      ? candidate.actionId
      : semanticId(
          'wda3',
          'wharfie:test:runtime-role-policy-dependency-create-action:v1',
          { resourceKey: candidate.resourceKey },
        );
  const artifactBinding = makeDirectBinding(base, artifactAction, {
    providerResourceId: getAwsSingleNodeManagedArtifactObjectLocation(
      runtimeAuthority(base),
    ).arn,
    ownershipNonce: intentNonces[artifactActionIndex],
    createdByActionId: dependencyReceipt(artifactAction),
  });
  const runtimeRoleBinding = makeDirectBinding(base, runtimeRoleAction, {
    providerResourceId: RUNTIME_ROLE_ID,
    ownershipNonce: intentNonces[runtimeRoleActionIndex],
    createdByActionId: dependencyReceipt(runtimeRoleAction),
  });
  const dependencies = [artifactBinding, runtimeRoleBinding];
  const priorBinding =
    action.action === 'create'
      ? null
      : makePolicyBinding(base, action, dependencies, {
          ownershipNonce,
          createdByActionId: semanticId(
            'wda3',
            'wharfie:test:runtime-role-policy-create-action:v1',
            { resourceKey: action.resourceKey },
          ),
        });
  const resourceBindings = [
    artifactBinding,
    runtimeRoleBinding,
    ...(priorBinding === null ? [] : [priorBinding]),
  ];
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
  /** @type {Readonly<Record<string, any>>|null} */
  let lastOperation = null;
  if (operation !== 'apply') {
    if (priorBinding === null) {
      throw new Error('Missing prior runtime role policy binding.');
    }
    lastOperation = {
      kind: 'create',
      planId: semanticId(
        'wpl3',
        'wharfie:test:runtime-role-policy-last-plan:v1',
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
    artifactAction,
    runtimeRoleAction,
    artifactBinding,
    runtimeRoleBinding,
    priorBinding,
    head,
    context,
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Readonly<Record<string, any>>[]} resourceBindings */
function contextWithBindings(fixture, resourceBindings) {
  const head = createDeploymentHead({
    deploymentInstanceId: fixture.head.deploymentInstanceId,
    providerScope: fixture.head.providerScope,
    incarnationId: fixture.head.incarnationId,
    generation: fixture.head.generation,
    phase: fixture.head.phase,
    settledDeploymentRevisionId: fixture.head.settledDeploymentRevisionId,
    targetDeploymentRevisionId: fixture.head.targetDeploymentRevisionId,
    resourceBindings,
    activeOperation: fixture.head.activeOperation,
    lastOperation: fixture.head.lastOperation,
  });
  return Object.freeze({ ...fixture.context, head });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function policyResponse(fixture, overrides = {}) {
  return {
    RoleName: getAwsSingleNodeRuntimeRoleName(
      runtimeNameAuthority(fixture.base),
    ),
    PolicyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
    PolicyDocument: encodeURIComponent(
      JSON.stringify(
        createAwsSingleNodeRuntimePolicy(runtimeAuthority(fixture.base)),
      ),
    ),
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function roleResponse(fixture, overrides = {}) {
  const roleName = getAwsSingleNodeRuntimeRoleName(
    runtimeNameAuthority(fixture.base),
  );
  return {
    Role: {
      Path: '/wharfie/runtime/v1/',
      RoleName: roleName,
      RoleId: RUNTIME_ROLE_ID,
      Arn: `arn:aws:iam::123456789012:role/wharfie/runtime/v1/${roleName}`,
      Description: AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
      MaxSessionDuration: AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
      AssumeRolePolicyDocument: encodeURIComponent(
        JSON.stringify(getAwsSingleNodeRuntimeRoleTrustPolicy()),
      ),
      ...overrides,
    },
  };
}

/** @param {boolean} present @param {Record<string, any>} [overrides] @returns {AnyRecord} */
function inlinePolicyListResponse(present, overrides = {}) {
  return {
    PolicyNames: present ? [AWS_SINGLE_NODE_RUNTIME_POLICY_NAME] : [],
    IsTruncated: false,
    ...overrides,
  };
}

/** @param {Record<string, any>} [overrides] */
function attachedPolicyListResponse(overrides = {}) {
  return { AttachedPolicies: [], IsTruncated: false, ...overrides };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makeClient(fixture, options = {}) {
  return Object.freeze({
    getRole:
      options.getRole ??
      jest.fn(async (/** @type {AnyRecord} */ _input) => roleResponse(fixture)),
    listRolePolicies:
      options.listRolePolicies ??
      jest.fn(async (/** @type {AnyRecord} */ _input) =>
        inlinePolicyListResponse(true),
      ),
    listAttachedRolePolicies:
      options.listAttachedRolePolicies ??
      jest.fn(async (/** @type {AnyRecord} */ _input) =>
        attachedPolicyListResponse(),
      ),
    getRolePolicy:
      options.getRolePolicy ??
      jest.fn(async (/** @type {AnyRecord} */ _input) =>
        policyResponse(fixture),
      ),
    putRolePolicy:
      options.putRolePolicy ??
      jest.fn(async (/** @type {AnyRecord} */ _input) => ({})),
    deleteRolePolicy:
      options.deleteRolePolicy ??
      jest.fn(async (/** @type {AnyRecord} */ _input) => ({})),
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makePorts(fixture, options = {}) {
  const client = options.client ?? makeClient(fixture, options);
  const waitForRetry = options.waitForRetry ?? jest.fn();
  return {
    client,
    waitForRetry,
    resource: createAwsSingleNodeRuntimeRolePolicyResource({
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

describe('AWS single-node runtime role policy identity', () => {
  it('pins ProviderSpec V6, the exact policy template, desired state, and RoleId-derived identity', () => {
    const fixture = makeFixture();
    const authority = runtimeAuthority(fixture.base);

    expect(fixture.base.providerSpec.schemaVersion).toBe(6);
    expect(
      fixture.base.providerSpec.capabilities.runtimeIdentity.policyDigest,
    ).toEqual(AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST);
    expect(fixture.action.after.stateDigest).toEqual(
      getAwsSingleNodeRuntimePolicyStateDigest(authority),
    );
    expect(
      getAwsSingleNodeRuntimePolicyProviderResourceId({
        runtimeRoleId: RUNTIME_ROLE_ID,
      }),
    ).toMatch(/^wrp1_[A-Za-z0-9_-]{43}$/);
    expect(
      getAwsSingleNodeRuntimePolicyProviderResourceId({
        runtimeRoleId: RUNTIME_ROLE_ID,
      }),
    ).not.toBe(
      getAwsSingleNodeRuntimePolicyProviderResourceId({
        runtimeRoleId: OTHER_RUNTIME_ROLE_ID,
      }),
    );
    expect(Object.isFrozen(fixture.action.after.stateDigest)).toBe(true);
  });
});

describe('AWS single-node runtime role policy create and recovery', () => {
  it('reads absence before putting once and settles only from an exact later read', async () => {
    const fixture = makeFixture();
    let present = false;
    const getRolePolicy = jest.fn(async (/** @type {AnyRecord} */ _input) => {
      if (!present) throw providerError('NoSuchEntity');
      return policyResponse(fixture);
    });
    const putRolePolicy = jest.fn(async (/** @type {AnyRecord} */ _input) => {
      present = true;
      return { ignored: 'mutation-response' };
    });
    const listRolePolicies = jest.fn(async (/** @type {AnyRecord} */ _input) =>
      inlinePolicyListResponse(present),
    );
    const client = makeClient(fixture, {
      getRolePolicy,
      listRolePolicies,
      putRolePolicy,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    const settlement = await resource.verifySettlement(fixture.context);

    expect(getRolePolicy).toHaveBeenCalledTimes(2);
    expect(putRolePolicy).toHaveBeenCalledTimes(1);
    expect(client.getRole.mock.invocationCallOrder[0]).toBeLessThan(
      getRolePolicy.mock.invocationCallOrder[0],
    );
    expect(getRolePolicy.mock.invocationCallOrder[0]).toBeLessThan(
      putRolePolicy.mock.invocationCallOrder[0],
    );
    expect(putRolePolicy.mock.invocationCallOrder[0]).toBeLessThan(
      getRolePolicy.mock.invocationCallOrder[1],
    );
    const roleName = getAwsSingleNodeRuntimeRoleName(
      runtimeNameAuthority(fixture.base),
    );
    expect(getRolePolicy).toHaveBeenCalledWith({
      RoleName: roleName,
      PolicyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
    });
    expect(putRolePolicy).toHaveBeenCalledWith({
      RoleName: roleName,
      PolicyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
      PolicyDocument: JSON.stringify(
        createAwsSingleNodeRuntimePolicy(runtimeAuthority(fixture.base)),
      ),
    });
    expectDeepFrozen(getRolePolicy.mock.calls[0][0]);
    expectDeepFrozen(client.getRole.mock.calls[0][0]);
    expectDeepFrozen(putRolePolicy.mock.calls[0][0]);
    expect(settlement).toEqual({
      status: 'converged',
      binding: createDeploymentResourceBinding({
        schemaVersion: 2,
        kind: 'deploymentResourceBinding',
        deploymentInstanceId: fixture.base.deploymentInstanceId,
        incarnationId: fixture.base.incarnationId,
        resourceKey: 'runtime-role-policy',
        capability: { kind: 'runtime-identity', version: 1 },
        role: { kind: 'inline-policy', version: 1 },
        management: 'managed',
        ownershipMode: 'derived',
        onDestroy: 'purge',
        dependencyBindings: [
          {
            resourceKey: 'artifact',
            bindingId: fixture.artifactBinding.bindingId,
          },
          {
            resourceKey: 'runtime-role',
            bindingId: fixture.runtimeRoleBinding.bindingId,
          },
        ],
        providerType: 'iam-role-inline-policy',
        providerResourceId: getAwsSingleNodeRuntimePolicyProviderResourceId({
          runtimeRoleId: RUNTIME_ROLE_ID,
        }),
        providerScopeId: fixture.base.providerScope.providerScopeId,
        ownershipNonce: fixture.ownershipNonce,
        createdByActionId: fixture.action.actionId,
      }),
    });
    expectDeepFrozen(settlement);
  });

  it('is idempotent when the exact policy is already present', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );

    expect(client.getRolePolicy).toHaveBeenCalledTimes(2);
    expect(client.putRolePolicy).not.toHaveBeenCalled();
    expect(client.deleteRolePolicy).not.toHaveBeenCalled();
  });

  it('blocks an occupied contradictory slot and never overwrites it', async () => {
    const fixture = makeFixture();
    const getRolePolicy = jest.fn(async (/** @type {AnyRecord} */ _input) =>
      policyResponse(fixture, {
        PolicyDocument: JSON.stringify({
          Version: '2012-10-17',
          Statement: [],
        }),
      }),
    );
    const client = makeClient(fixture, { getRolePolicy });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeRuntimeRolePolicyResourceConflictError,
    );
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.putRolePolicy).not.toHaveBeenCalled();
    expect(client.deleteRolePolicy).not.toHaveBeenCalled();
  });

  it('settles ambiguous successful put response loss by exact readback without replaying it', async () => {
    const fixture = makeFixture();
    let present = false;
    const getRolePolicy = jest.fn(async (/** @type {AnyRecord} */ _input) => {
      if (!present) throw providerError('NoSuchEntity');
      return policyResponse(fixture);
    });
    const putRolePolicy = jest.fn(async (/** @type {AnyRecord} */ _input) => {
      present = true;
      throw providerError('NetworkingError', 'put-response-secret');
    });
    const listRolePolicies = jest.fn(async (/** @type {AnyRecord} */ _input) =>
      inlinePolicyListResponse(present),
    );
    const client = makeClient(fixture, {
      getRolePolicy,
      listRolePolicies,
      putRolePolicy,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(putRolePolicy).toHaveBeenCalledTimes(1);
  });

  it('returns not-converged after bounded missing readback', async () => {
    const fixture = makeFixture();
    const getRolePolicy = jest.fn(async (/** @type {AnyRecord} */ _input) => {
      throw providerError('NoSuchEntityException');
    });
    const waitForRetry = jest.fn();
    const client = makeClient(fixture, {
      getRolePolicy,
      listRolePolicies: jest.fn(async () => inlinePolicyListResponse(false)),
    });
    const { resource } = makePorts(fixture, {
      client,
      maxAttempts: 3,
      waitForRetry,
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(getRolePolicy).toHaveBeenCalledTimes(3);
    expect(waitForRetry.mock.calls).toEqual([[1], [2]]);
  });

  it('preserves the exact prior receipt, nonce, and two-edge lineage on noop', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    const settlement = await resource.verifySettlement(fixture.context);

    expect(client.getRolePolicy).toHaveBeenCalledTimes(1);
    expect(client.putRolePolicy).not.toHaveBeenCalled();
    expect(settlement).toEqual({
      status: 'converged',
      binding: fixture.priorBinding,
    });
    expect(settlement.binding.dependencyBindings).toEqual([
      {
        resourceKey: 'artifact',
        bindingId: fixture.artifactBinding.bindingId,
      },
      {
        resourceKey: 'runtime-role',
        bindingId: fixture.runtimeRoleBinding.bindingId,
      },
    ]);
  });
});

describe('AWS single-node runtime role policy destroy', () => {
  it('deletes only an exact policy and converges from exact missing readback', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    let present = true;
    const getRolePolicy = jest.fn(async (/** @type {AnyRecord} */ _input) => {
      if (!present) throw providerError('NoSuchEntity');
      return policyResponse(fixture);
    });
    const deleteRolePolicy = jest.fn(
      async (/** @type {AnyRecord} */ _input) => {
        present = false;
        return { ignored: 'mutation-response' };
      },
    );
    const listRolePolicies = jest.fn(async (/** @type {AnyRecord} */ _input) =>
      inlinePolicyListResponse(present),
    );
    const client = makeClient(fixture, {
      getRolePolicy,
      listRolePolicies,
      deleteRolePolicy,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });

    expect(deleteRolePolicy).toHaveBeenCalledTimes(1);
    expect(getRolePolicy).toHaveBeenCalledTimes(2);
    expect(client.getRole.mock.invocationCallOrder[0]).toBeLessThan(
      getRolePolicy.mock.invocationCallOrder[0],
    );
    expect(getRolePolicy.mock.invocationCallOrder[0]).toBeLessThan(
      deleteRolePolicy.mock.invocationCallOrder[0],
    );
    expect(deleteRolePolicy.mock.invocationCallOrder[0]).toBeLessThan(
      getRolePolicy.mock.invocationCallOrder[1],
    );
    expect(deleteRolePolicy).toHaveBeenCalledWith({
      RoleName: getAwsSingleNodeRuntimeRoleName(
        runtimeNameAuthority(fixture.base),
      ),
      PolicyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
    });
    expectDeepFrozen(deleteRolePolicy.mock.calls[0][0]);
  });

  it('treats NoSuchEntity as absence without issuing delete', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const getRolePolicy = jest.fn(async (/** @type {AnyRecord} */ _input) => {
      throw providerError('NoSuchEntity');
    });
    const client = makeClient(fixture, {
      getRolePolicy,
      listRolePolicies: jest.fn(async () => inlinePolicyListResponse(false)),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(client.deleteRolePolicy).not.toHaveBeenCalled();
  });

  it('blocks rather than deleting a contradictory policy', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const getRolePolicy = jest.fn(async (/** @type {AnyRecord} */ _input) =>
      policyResponse(fixture, {
        PolicyDocument: JSON.stringify({
          Version: '2012-10-17',
          Statement: [],
        }),
      }),
    );
    const client = makeClient(fixture, { getRolePolicy });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeRuntimeRolePolicyResourceConflictError,
    );
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.deleteRolePolicy).not.toHaveBeenCalled();
  });

  it('settles ambiguous successful delete response loss by exact readback', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    let present = true;
    const getRolePolicy = jest.fn(async (/** @type {AnyRecord} */ _input) => {
      if (!present) throw providerError('NoSuchEntity');
      return policyResponse(fixture);
    });
    const deleteRolePolicy = jest.fn(
      async (/** @type {AnyRecord} */ _input) => {
        present = false;
        throw providerError('NetworkingError', 'delete-response-secret');
      },
    );
    const listRolePolicies = jest.fn(async (/** @type {AnyRecord} */ _input) =>
      inlinePolicyListResponse(present),
    );
    const client = makeClient(fixture, {
      getRolePolicy,
      listRolePolicies,
      deleteRolePolicy,
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(deleteRolePolicy).toHaveBeenCalledTimes(1);
    expect(getRolePolicy).toHaveBeenCalledTimes(3);
  });
});

describe('AWS single-node runtime role policy authority and errors', () => {
  it('requires the exact managed artifact ARN dependency', async () => {
    const fixture = makeFixture();
    const wrongArtifact = makeDirectBinding(
      fixture.base,
      fixture.artifactAction,
      {
        providerResourceId:
          'arn:aws:s3:::foreign-bucket/artifact/v1/foreign/current',
        ownershipNonce: /** @type {string} */ (
          fixture.artifactBinding.ownershipNonce
        ),
        createdByActionId: fixture.artifactAction.actionId,
      },
    );
    const context = contextWithBindings(fixture, [
      wrongArtifact,
      fixture.runtimeRoleBinding,
    ]);
    const { resource } = makePorts(fixture);

    await expect(resource.executeAction(context)).rejects.toBeInstanceOf(
      AwsSingleNodeRuntimeRolePolicyResourceConflictError,
    );
  });

  it('requires the runtime-role dependency identity to be an immutable RoleId', async () => {
    const fixture = makeFixture();
    const wrongRole = makeDirectBinding(
      fixture.base,
      fixture.runtimeRoleAction,
      {
        providerResourceId: 'wharfie-runtime-role-name-not-id',
        ownershipNonce: /** @type {string} */ (
          fixture.runtimeRoleBinding.ownershipNonce
        ),
        createdByActionId: fixture.runtimeRoleAction.actionId,
      },
    );
    const context = contextWithBindings(fixture, [
      fixture.artifactBinding,
      wrongRole,
    ]);
    const { resource } = makePorts(fixture);

    await expect(resource.verifySettlement(context)).rejects.toBeInstanceOf(
      AwsSingleNodeRuntimeRolePolicyResourceConflictError,
    );
  });

  it('blocks a deleted and recreated same-name role with a foreign RoleId', async () => {
    const fixture = makeFixture();
    const getRole = jest.fn(async (/** @type {AnyRecord} */ _input) =>
      roleResponse(fixture, { RoleId: OTHER_RUNTIME_ROLE_ID }),
    );
    const client = makeClient(fixture, { getRole });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeRuntimeRolePolicyResourceConflictError,
    );
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.getRolePolicy).not.toHaveBeenCalled();
    expect(client.putRolePolicy).not.toHaveBeenCalled();
    expect(client.deleteRolePolicy).not.toHaveBeenCalled();
  });

  it.each([
    [
      'broadened trust',
      {
        AssumeRolePolicyDocument: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: '*' },
              Action: 'sts:AssumeRole',
            },
          ],
        }),
      },
    ],
    [
      'a permissions boundary',
      {
        PermissionsBoundary: {
          PermissionsBoundaryType: 'Policy',
          PermissionsBoundaryArn:
            'arn:aws:iam::123456789012:policy/foreign-boundary',
        },
      },
    ],
  ])(
    'blocks a role carrying %s before granting permissions',
    async (_name, drift) => {
      const fixture = makeFixture();
      const getRole = jest.fn(async (/** @type {AnyRecord} */ _input) =>
        roleResponse(fixture, drift),
      );
      const client = makeClient(fixture, { getRole });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeRuntimeRolePolicyResourceConflictError,
      );
      expect(client.getRolePolicy).not.toHaveBeenCalled();
      expect(client.putRolePolicy).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'another inline policy',
      {
        listRolePolicies: jest.fn(async () => ({
          PolicyNames: [
            AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
            'foreign-admin-policy',
          ],
          IsTruncated: false,
        })),
      },
    ],
    [
      'an attached managed policy',
      {
        listAttachedRolePolicies: jest.fn(async () => ({
          AttachedPolicies: [
            {
              PolicyName: 'AdministratorAccess',
              PolicyArn: 'arn:aws:iam::aws:policy/AdministratorAccess',
            },
          ],
          IsTruncated: false,
        })),
      },
    ],
  ])('blocks a role carrying %s', async (_name, clientOverrides) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, clientOverrides);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeRuntimeRolePolicyResourceConflictError,
    );
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.putRolePolicy).not.toHaveBeenCalled();
    expect(client.deleteRolePolicy).not.toHaveBeenCalled();
  });

  it('uses bounded pagination and retries a temporarily inconsistent list/get view', async () => {
    const fixture = makeFixture();
    const roleName = getAwsSingleNodeRuntimeRoleName(
      runtimeNameAuthority(fixture.base),
    );
    const listRolePolicies = jest
      .fn(async (/** @type {AnyRecord} */ _input) =>
        inlinePolicyListResponse(true),
      )
      .mockResolvedValueOnce(inlinePolicyListResponse(false))
      .mockResolvedValueOnce({
        PolicyNames: [],
        IsTruncated: true,
        Marker: 'next-page',
      })
      .mockResolvedValueOnce(inlinePolicyListResponse(true));
    const waitForRetry = jest.fn();
    const client = makeClient(fixture, { listRolePolicies });
    const { resource } = makePorts(fixture, {
      client,
      maxAttempts: 2,
      waitForRetry,
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
      expect.objectContaining({ status: 'converged' }),
    );
    expect(waitForRetry).toHaveBeenCalledWith(1);
    expect(listRolePolicies.mock.calls).toEqual([
      [
        {
          RoleName: roleName,
          MaxItems: AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_READ_MAX_ITEMS,
        },
      ],
      [
        {
          RoleName: roleName,
          MaxItems: AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_READ_MAX_ITEMS,
        },
      ],
      [
        {
          RoleName: roleName,
          MaxItems: AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_READ_MAX_ITEMS,
          Marker: 'next-page',
        },
      ],
    ]);
    for (const [request] of listRolePolicies.mock.calls) {
      expectDeepFrozen(request);
    }
  });

  it('preserves an earlier paginated policy conflict before any later read can fail', async () => {
    const fixture = makeFixture();
    let callCount = 0;
    const listRolePolicies = jest.fn(
      async (/** @type {AnyRecord} */ _input) => {
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
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeRuntimeRolePolicyResourceConflictError,
    );
    expect(listRolePolicies).toHaveBeenCalledTimes(1);
    expect(client.getRolePolicy).not.toHaveBeenCalled();
    expect(client.putRolePolicy).not.toHaveBeenCalled();
  });

  it('requires exact prior derived lineage', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const wrongPrior = makePolicyBinding(
      fixture.base,
      fixture.action,
      [fixture.artifactBinding],
      {
        ownershipNonce: fixture.ownershipNonce,
        createdByActionId: /** @type {string} */ (
          fixture.priorBinding?.createdByActionId
        ),
      },
    );
    const context = contextWithBindings(fixture, [
      fixture.artifactBinding,
      fixture.runtimeRoleBinding,
      wrongPrior,
    ]);
    const { resource } = makePorts(fixture);

    await expect(resource.verifySettlement(context)).rejects.toBeInstanceOf(
      AwsSingleNodeRuntimeRolePolicyResourceConflictError,
    );
  });

  it('accepts reverse-destroy dependencies only while their actions remain pending', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const getRolePolicy = jest.fn(async (/** @type {AnyRecord} */ _input) => {
      throw providerError('NoSuchEntity');
    });
    const client = makeClient(fixture, {
      getRolePolicy,
      listRolePolicies: jest.fn(async () => inlinePolicyListResponse(false)),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });

    const changed = clone(fixture.context);
    const dependencyIndex = changed.plan.actions.findIndex(
      (/** @type {Readonly<AnyRecord>} */ action) =>
        action.resourceKey === 'runtime-role',
    );
    changed.head.activeOperation.intents[dependencyIndex].status = 'settled';
    await expect(resource.verifySettlement(changed)).rejects.toThrow();
  });

  it('maps malformed or failed reads to a sanitized unknown error', async () => {
    const fixture = makeFixture();
    const secret = 'get-policy-provider-secret';
    const getRolePolicy = jest
      .fn(async () => ({}))
      .mockRejectedValueOnce(providerError('NetworkingError', secret));
    const client = makeClient(fixture, { getRolePolicy });
    const { resource } = makePorts(fixture, { client });

    const failed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(failed).toBeInstanceOf(
      AwsSingleNodeRuntimeRolePolicyResourceUnknownError,
    );
    expect(String(failed)).not.toContain(secret);
    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeRuntimeRolePolicyResourceUnknownError,
    );
    expect(client.putRolePolicy).not.toHaveBeenCalled();
  });

  it('treats malformed policy JSON as unknown without mutating the slot', async () => {
    const fixture = makeFixture();
    const getRolePolicy = jest.fn(async (/** @type {AnyRecord} */ _input) =>
      policyResponse(fixture, { PolicyDocument: '%not-json' }),
    );
    const client = makeClient(fixture, { getRolePolicy });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeRuntimeRolePolicyResourceUnknownError,
    );
    expect(client.putRolePolicy).not.toHaveBeenCalled();
    expect(client.deleteRolePolicy).not.toHaveBeenCalled();
  });

  it('validates the exact bounded factory surface', () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const base = { client, providerScope: fixture.base.providerScope };

    expect(() =>
      createAwsSingleNodeRuntimeRolePolicyResource({
        ...base,
        maxAttempts: 0,
      }),
    ).toThrow(/maxAttempts/);
    expect(() =>
      createAwsSingleNodeRuntimeRolePolicyResource({
        ...base,
        maxAttempts: 11,
      }),
    ).toThrow(/maxAttempts/);
    expect(() =>
      createAwsSingleNodeRuntimeRolePolicyResource({ ...base, extra: true }),
    ).toThrow(/extra/);
    expect(() =>
      createAwsSingleNodeRuntimeRolePolicyResource({
        ...base,
        client: {
          getRole: async () => ({}),
        },
      }),
    ).toThrow(/listRolePolicies/);
    expect(AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_MAX_ATTEMPTS).toBe(10);
    expect(AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_MAX_READ_PAGES).toBe(16);
    expect(AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_READ_MAX_ITEMS).toBe(1000);
    expect(
      Object.isFrozen(
        createAwsSingleNodeRuntimeRolePolicyResource({ ...base }),
      ),
    ).toBe(true);
  });
});
