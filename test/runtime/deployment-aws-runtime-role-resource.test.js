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
  AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  createAwsSingleNodeRuntimeIdentityTags,
  getAwsSingleNodeRuntimeRoleName,
  getAwsSingleNodeRuntimeRoleStateDigest,
  getAwsSingleNodeRuntimeRoleTrustPolicy,
} from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import {
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_READ_PAGES,
  AWS_SINGLE_NODE_RUNTIME_ROLE_READ_MAX_ITEMS,
  AwsSingleNodeRuntimeRoleResourceConflictError,
  AwsSingleNodeRuntimeRoleResourceUnknownError,
  createAwsSingleNodeRuntimeRoleResource,
} from '../../src/core/runtime/deployment-aws-runtime-role-resource.js';
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
      appId: 'runtime-role-resource-test',
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
    revisionId: semanticId('wrv1', 'wharfie:test:runtime-role-revision:v1', {
      revision: 1,
    }),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'runtime role resource artifact',
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

/** @param {Readonly<Record<string, any>>} definition @returns {string} */
function providerResourceId(definition) {
  if (definition.resourceKey === 'runtime-role') return ROLE_ID;
  if (definition.resourceKey === 'runtime-identity') return PROFILE_ID;
  if (definition.resourceKey === 'substrate') return 'i-00000000000000001';
  if (definition.role.kind === 'volume') {
    return definition.resourceKey === 'application-state'
      ? 'vol-00000000000000001'
      : 'vol-00000000000000002';
  }
  return `provider-resource-${definition.resourceKey}`;
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} definition @returns {Readonly<Record<string, any>>} */
function desiredState(base, definition) {
  return {
    providerType: definition.providerType,
    providerResourceId: null,
    stateDigest:
      definition.resourceKey === 'runtime-role'
        ? getAwsSingleNodeRuntimeRoleStateDigest(nameAuthority(base))
        : digest(`${definition.resourceKey} desired`),
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
        providerResourceId: providerResourceId(definition),
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
          'wharfie:test:runtime-role-inspection:v1',
          { operation },
        ),
      },
      actions,
    },
    { profile: base.profile },
  );
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} action @param {string} ownershipNonce @returns {Readonly<Record<string, any>>} */
function makeBinding(base, action, ownershipNonce) {
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
    dependencyBindings: [],
    providerType: 'iam-role',
    providerResourceId: ROLE_ID,
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce,
    createdByActionId: semanticId(
      'wda3',
      'wharfie:test:runtime-role-create-action:v1',
      { resourceKey: action.resourceKey },
    ),
  });
}

/** @param {{operation?: 'apply'|'reconcile'|'destroy', ownershipNonceByte?: number}} [options] @returns {Readonly<Record<string, any>>} */
function makeFixture(options = {}) {
  const operation = options.operation ?? 'apply';
  const base = makeBase();
  const plan = makePlan(base, operation);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'runtime-role',
  );
  const action = plan.actions[actionIndex];
  if (action === undefined) throw new Error('Missing runtime-role action.');
  const ownershipNonce = nonce(options.ownershipNonceByte ?? 71);
  const priorBinding =
    action.action === 'create'
      ? null
      : makeBinding(base, action, ownershipNonce);
  const resourceBindings = priorBinding === null ? [] : [priorBinding];
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
        index === actionIndex ? ownershipNonce : nonce(10 + index),
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
              'wharfie:test:runtime-role-last-plan:v1',
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

/** @param {ReturnType<typeof makeFixture>} fixture @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>} */
function expectedTags(fixture) {
  return createAwsSingleNodeRuntimeIdentityTags({
    resourceKind: 'single-node-runtime-role',
    capabilityKind: 'runtime-identity',
    roleKind: 'role',
    providerScopeId: fixture.base.providerScope.providerScopeId,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
    resourceKey: 'runtime-role',
    createdByActionId:
      fixture.priorBinding?.createdByActionId ?? fixture.action.actionId,
    ownershipNonce: fixture.ownershipNonce,
    stateDigest: getAwsSingleNodeRuntimeRoleStateDigest(
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

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] @returns {Readonly<Record<string, jest.Mock>>} */
function makeClient(fixture, options = {}) {
  return Object.freeze({
    createRole:
      options.createRole ?? jest.fn(async () => ({ Role: makeRole(fixture) })),
    getRole:
      options.getRole ?? jest.fn(async () => ({ Role: makeRole(fixture) })),
    deleteRole: options.deleteRole ?? jest.fn(async () => ({})),
    listRoleTags:
      options.listRoleTags ??
      jest.fn(async () => ({
        Tags: expectedTags(fixture),
        IsTruncated: false,
      })),
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

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makePorts(fixture, options = {}) {
  const client = options.client ?? makeClient(fixture, options);
  const waitForRetry = options.waitForRetry ?? jest.fn();
  return {
    client,
    waitForRetry,
    resource: createAwsSingleNodeRuntimeRoleResource({
      client,
      providerScope: fixture.base.providerScope,
      maxAttempts: options.maxAttempts ?? 1,
      waitForRetry,
    }),
  };
}

function noSuchEntity() {
  return Object.assign(new Error('provider secret no such entity'), {
    name: 'NoSuchEntity',
  });
}

describe('AWS single-node runtime role create and recovery', () => {
  it('submits one exact deeply frozen CreateRole request with all 13 atomic tags', async () => {
    const fixture = makeFixture();
    const getRole = jest
      .fn(async (/** @type {AnyRecord} */ _input) => ({
        Role: makeRole(fixture),
      }))
      .mockRejectedValueOnce(noSuchEntity())
      .mockResolvedValueOnce({ Role: makeRole(fixture) });
    const client = makeClient(fixture, { getRole });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);

    expect(client.createRole).toHaveBeenCalledTimes(1);
    const request = /** @type {AnyRecord} */ (
      client.createRole.mock.calls[0][0]
    );
    expect(request).toEqual({
      RoleName: getAwsSingleNodeRuntimeRoleName(nameAuthority(fixture.base)),
      Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
      AssumeRolePolicyDocument: JSON.stringify(
        getAwsSingleNodeRuntimeRoleTrustPolicy(),
      ),
      Description: AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
      MaxSessionDuration: AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
      Tags: expectedTags(fixture),
    });
    expect(request.Tags).toHaveLength(13);
    expect(request).not.toHaveProperty('PermissionsBoundary');
    expectDeepFrozen(request);
    expect(client.getRole).toHaveBeenCalledTimes(2);
    expect(client.listRoleTags).toHaveBeenCalledTimes(1);
  });

  it('recovers a lost or EntityAlreadyExists CreateRole result only through exact readback', async () => {
    for (const createErrorName of [
      'AwsDeploymentRuntimeIdentityResourceError',
      'EntityAlreadyExists',
    ]) {
      const fixture = makeFixture();
      const getRole = jest
        .fn(async (/** @type {AnyRecord} */ _input) => ({
          Role: makeRole(fixture),
        }))
        .mockRejectedValueOnce(noSuchEntity())
        .mockResolvedValueOnce({ Role: makeRole(fixture) });
      const createRole = jest.fn(async () => {
        throw Object.assign(new Error('provider secret create failure'), {
          name: createErrorName,
        });
      });
      const client = makeClient(fixture, { createRole, getRole });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();
      expect(createRole).toHaveBeenCalledTimes(1);
      expect(getRole).toHaveBeenCalledTimes(2);
      expect(client.listRoleTags).toHaveBeenCalledTimes(1);
    }
  });

  it('never replays one ambiguous non-idempotent create in the same factory', async () => {
    const fixture = makeFixture();
    const getRole = jest.fn(async () => {
      throw noSuchEntity();
    });
    const createRole = jest.fn(async () => {
      throw new Error('ambiguous provider create secret');
    });
    const client = makeClient(fixture, { createRole, getRole });
    const { resource } = makePorts(fixture, { client });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const observed = await resource
        .executeAction(fixture.context)
        .catch((/** @type {unknown} */ error) => error);
      expect(observed).toBeInstanceOf(
        AwsSingleNodeRuntimeRoleResourceUnknownError,
      );
      expect(JSON.stringify(observed)).not.toContain('provider');
    }
    expect(createRole).toHaveBeenCalledTimes(1);
    expect(client.deleteRole).not.toHaveBeenCalled();
  });

  it('settles from the immutable RoleId and tolerates only the fixed derived inline policy', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      listRolePolicies: jest.fn(async () => ({
        PolicyNames: [AWS_SINGLE_NODE_RUNTIME_POLICY_NAME],
        IsTruncated: false,
      })),
    });
    const { resource } = makePorts(fixture, { client });

    const settlement = await resource.verifySettlement(fixture.context);

    expect(settlement).toMatchObject({
      status: 'converged',
      binding: {
        resourceKey: 'runtime-role',
        providerType: 'iam-role',
        providerResourceId: ROLE_ID,
        ownershipMode: 'direct',
        onDestroy: 'purge',
        dependencyBindings: [],
        ownershipNonce: fixture.ownershipNonce,
        createdByActionId: fixture.action.actionId,
      },
    });
    expectDeepFrozen(settlement);
  });

  it('retries an exact subset of atomic create tags while IAM readback converges', async () => {
    const fixture = makeFixture();
    const tags = expectedTags(fixture);
    const listRoleTags = jest
      .fn(async (/** @type {AnyRecord} */ _input) => ({
        .../** @type {AnyRecord} */ ({
          Tags: tags,
          IsTruncated: false,
        }),
      }))
      .mockResolvedValueOnce({
        Tags: tags.slice(0, 7),
        IsTruncated: false,
      })
      .mockResolvedValueOnce({ Tags: tags, IsTruncated: false });
    const waitForRetry = jest.fn();
    const client = makeClient(fixture, { listRoleTags });
    const { resource } = makePorts(fixture, {
      client,
      maxAttempts: 2,
      waitForRetry,
    });

    await expect(
      resource.verifySettlement(fixture.context),
    ).resolves.toMatchObject({ status: 'converged' });
    expect(waitForRetry).toHaveBeenCalledTimes(1);
    expect(client.createRole).not.toHaveBeenCalled();
  });

  it('does not create a second role while exact-name ownership tags are still propagating', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      listRoleTags: jest.fn(async () => ({
        Tags: expectedTags(fixture).slice(0, 5),
        IsTruncated: false,
      })),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.createRole).not.toHaveBeenCalled();
    expect(client.deleteRole).not.toHaveBeenCalled();
  });
});

describe('AWS single-node runtime role exact evidence', () => {
  it.each([
    ['path', { Path: '/wrong/' }],
    ['name', { RoleName: 'foreign-role' }],
    [
      'account ARN',
      {
        Arn: `arn:aws:iam::999999999999:role${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}foreign`,
      },
    ],
    ['description', { Description: 'foreign role' }],
    ['session duration', { MaxSessionDuration: 7200 }],
    [
      'trust policy',
      {
        AssumeRolePolicyDocument: JSON.stringify({
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Principal: '*', Action: 'sts:*' }],
        }),
      },
    ],
    [
      'permissions boundary',
      {
        PermissionsBoundary: {
          PermissionsBoundaryType: 'Policy',
          PermissionsBoundaryArn:
            'arn:aws:iam::123456789012:policy/foreign-boundary',
        },
      },
    ],
  ])('blocks contradictory %s evidence', async (_name, override) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      getRole: jest.fn(async () => ({ Role: makeRole(fixture, override) })),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('accepts both raw JSON and URI-encoded exact trust-policy readback', async () => {
    const fixture = makeFixture();
    for (const AssumeRolePolicyDocument of [
      JSON.stringify(getAwsSingleNodeRuntimeRoleTrustPolicy()),
      encodeURIComponent(
        JSON.stringify(getAwsSingleNodeRuntimeRoleTrustPolicy()),
      ),
    ]) {
      const client = makeClient(fixture, {
        getRole: jest.fn(async () => ({
          Role: makeRole(fixture, { AssumeRolePolicyDocument }),
        })),
      });
      const { resource } = makePorts(fixture, { client });
      await expect(
        resource.verifySettlement(fixture.context),
      ).resolves.toMatchObject({ status: 'converged' });
    }
  });

  it('distinguishes propagating create-tag subsets from contradictory ownership tags', async () => {
    const fixture = makeFixture();
    const variants = [
      [expectedTags(fixture).slice(1), 'not-converged'],
      [
        expectedTags(fixture).map((tag) =>
          tag.Key === 'wharfie:state-digest'
            ? { ...tag, Value: digest('wrong').value }
            : tag,
        ),
        'blocked',
      ],
      [
        [...expectedTags(fixture), { Key: 'operator-note', Value: 'extra' }],
        'blocked',
      ],
      [[...expectedTags(fixture), expectedTags(fixture)[0]], 'blocked'],
    ];
    for (const [tags, status] of variants) {
      const client = makeClient(fixture, {
        listRoleTags: jest.fn(async () => ({
          Tags: tags,
          IsTruncated: false,
        })),
      });
      const { resource } = makePorts(fixture, { client });
      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        { status },
      );
    }
  });

  it.each([
    [
      'foreign inline policy',
      {
        listRolePolicies: jest.fn(async () => ({
          PolicyNames: ['foreign-policy'],
          IsTruncated: false,
        })),
      },
    ],
    [
      'attached managed policy',
      {
        listAttachedRolePolicies: jest.fn(async () => ({
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
  ])('blocks a %s without repairing it', async (_name, options) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, options);
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.createRole).not.toHaveBeenCalled();
    expect(client.deleteRole).not.toHaveBeenCalled();
  });

  it('maps malformed provider envelopes and failures to one fixed non-echoing unknown error', async () => {
    const fixture = makeFixture();
    for (const getRole of [
      jest.fn(async () => ({ providerSecret: 'bad-envelope' })),
      jest.fn(async () => {
        throw new Error('credential-bearing provider secret');
      }),
    ]) {
      const client = makeClient(fixture, { getRole });
      const { resource } = makePorts(fixture, { client });
      const observed = await resource
        .verifySettlement(fixture.context)
        .catch((/** @type {unknown} */ error) => error);
      expect(observed).toBeInstanceOf(
        AwsSingleNodeRuntimeRoleResourceUnknownError,
      );
      expect(observed).toEqual(
        expect.objectContaining({
          name: 'AwsSingleNodeRuntimeRoleResourceUnknownError',
          message: 'AWS single-node runtime role state is unknown.',
        }),
      );
      expect(JSON.stringify(observed)).not.toContain('secret');
    }
  });

  it('reads every bounded tag page before accepting exact ownership', async () => {
    const fixture = makeFixture();
    const tags = expectedTags(fixture);
    const listRoleTags = jest
      .fn(async (/** @type {AnyRecord} */ _input) => ({
        .../** @type {AnyRecord} */ ({
          Tags: tags,
          IsTruncated: false,
        }),
      }))
      .mockResolvedValueOnce({
        Tags: tags.slice(0, 6),
        IsTruncated: true,
        Marker: 'next-page',
      })
      .mockResolvedValueOnce({
        Tags: tags.slice(6),
        IsTruncated: false,
      });
    const client = makeClient(fixture, { listRoleTags });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).resolves.toMatchObject({ status: 'converged' });
    expect(listRoleTags).toHaveBeenNthCalledWith(1, {
      RoleName: getAwsSingleNodeRuntimeRoleName(nameAuthority(fixture.base)),
      MaxItems: AWS_SINGLE_NODE_RUNTIME_ROLE_READ_MAX_ITEMS,
    });
    expect(listRoleTags).toHaveBeenNthCalledWith(2, {
      RoleName: getAwsSingleNodeRuntimeRoleName(nameAuthority(fixture.base)),
      MaxItems: AWS_SINGLE_NODE_RUNTIME_ROLE_READ_MAX_ITEMS,
      Marker: 'next-page',
    });
    expectDeepFrozen(listRoleTags.mock.calls[0][0]);
    expectDeepFrozen(listRoleTags.mock.calls[1][0]);
  });

  it('fails closed when IAM pagination exceeds its fixed bound', async () => {
    const fixture = makeFixture();
    const listRoleTags = jest.fn(async (/** @type {AnyRecord} */ input) => ({
      Tags: [],
      IsTruncated: true,
      Marker: `${input.Marker ?? 'start'}-next`,
    }));
    const client = makeClient(fixture, { listRoleTags });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeRuntimeRoleResourceUnknownError);
    expect(listRoleTags).toHaveBeenCalledTimes(
      AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_READ_PAGES,
    );
  });

  it.each([
    [
      'an oversized page',
      {
        Tags: Array.from(
          { length: AWS_SINGLE_NODE_RUNTIME_ROLE_READ_MAX_ITEMS + 1 },
          () => ({ Key: 'duplicate', Value: 'value' }),
        ),
        IsTruncated: false,
      },
    ],
    [
      'an oversized continuation marker',
      {
        Tags: [],
        IsTruncated: true,
        Marker: 'm'.repeat(4097),
      },
    ],
  ])('fails closed on %s', async (_label, response) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      listRoleTags: jest.fn(async () => response),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeRuntimeRoleResourceUnknownError);
  });
});

describe('AWS single-node runtime role deletion and authority', () => {
  it('deletes only an exact owned role with no policies or instance profiles', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);

    expect(client.deleteRole).toHaveBeenCalledWith({
      RoleName: getAwsSingleNodeRuntimeRoleName(nameAuthority(fixture.base)),
    });
    expect(client.listRolePolicies).toHaveBeenCalledTimes(1);
    expect(client.listAttachedRolePolicies).toHaveBeenCalledTimes(1);
    expect(client.listInstanceProfilesForRole).toHaveBeenCalledTimes(1);
    expectDeepFrozen(client.deleteRole.mock.calls[0][0]);
  });

  it.each([
    [
      'fixed inline policy',
      {
        listRolePolicies: jest.fn(async () => ({
          PolicyNames: [AWS_SINGLE_NODE_RUNTIME_POLICY_NAME],
          IsTruncated: false,
        })),
      },
    ],
    [
      'foreign inline policy',
      {
        listRolePolicies: jest.fn(async () => ({
          PolicyNames: ['foreign-inline-policy'],
          IsTruncated: false,
        })),
      },
    ],
    [
      'managed policy',
      {
        listAttachedRolePolicies: jest.fn(async () => ({
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
      'instance profile',
      {
        listInstanceProfilesForRole: jest.fn(async () => ({
          InstanceProfiles: [
            {
              InstanceProfileId: PROFILE_ID,
              InstanceProfileName: 'wharfie-runtime-profile',
              Arn: 'arn:aws:iam::123456789012:instance-profile/wharfie-runtime-profile',
            },
          ],
          IsTruncated: false,
        })),
      },
    ],
  ])('blocks deletion while a valid %s remains', async (_name, options) => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, options);
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.deleteRole).not.toHaveBeenCalled();
  });

  it('treats exact absence as converged deletion and does not mutate', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, {
      getRole: jest.fn(async () => {
        throw noSuchEntity();
      }),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.deleteRole).not.toHaveBeenCalled();
  });

  it('recovers a lost delete response through exact absence readback', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    let readCount = 0;
    const getRole = jest.fn(async () => {
      readCount += 1;
      if (readCount > 1) throw noSuchEntity();
      return { Role: makeRole(fixture) };
    });
    const deleteRole = jest.fn(async () => {
      throw new Error('secret lost DeleteRole response');
    });
    const client = makeClient(fixture, { getRole, deleteRole });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(getRole).toHaveBeenCalledTimes(3);
    expect(deleteRole).toHaveBeenCalledTimes(1);
  });

  it('does not mutate while delete-side IAM list evidence is disappearing', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, {
      listRoleTags: jest.fn(async () => {
        throw noSuchEntity();
      }),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(client.deleteRole).not.toHaveBeenCalled();
  });

  it('treats a delete-side subset of exact ownership tags as transient', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, {
      listRoleTags: jest.fn(async () => ({
        Tags: expectedTags(fixture).slice(0, 7),
        IsTruncated: false,
      })),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(client.deleteRole).not.toHaveBeenCalled();
  });

  it('blocks a bound role when exact RoleId readback changes', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const client = makeClient(fixture, {
      getRole: jest.fn(async () => ({
        Role: makeRole(fixture, { RoleId: OTHER_ROLE_ID }),
      })),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('rejects caller authority changes before any provider call', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });
    const changed = {
      ...fixture.context,
      ownershipNonce: nonce(99),
    };

    await expect(resource.verifySettlement(changed)).rejects.toBeInstanceOf(
      AwsSingleNodeRuntimeRoleResourceConflictError,
    );
    expect(client.getRole).not.toHaveBeenCalled();
  });

  it('validates the exact narrow client and bounded retry options', () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    for (const method of Object.keys(client)) {
      expect(() =>
        createAwsSingleNodeRuntimeRoleResource({
          client: { ...client, [method]: undefined },
          providerScope: fixture.base.providerScope,
        }),
      ).toThrow(`client.${method} is required`);
    }
    expect(() =>
      createAwsSingleNodeRuntimeRoleResource({
        client,
        providerScope: fixture.base.providerScope,
        maxAttempts: 0,
      }),
    ).toThrow(TypeError);
    expect(() =>
      createAwsSingleNodeRuntimeRoleResource({
        client,
        providerScope: fixture.base.providerScope,
        extra: true,
      }),
    ).toThrow(TypeError);
  });
});
