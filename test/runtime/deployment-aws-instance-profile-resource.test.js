import { describe, expect, it, jest } from '@jest/globals';

import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_INSTANCE_PROFILE_INSTANCE_PAGE_SIZE,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_INSTANCE_PAGES,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_TAG_PAGES,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_TAG_PAGE_SIZE,
  AwsSingleNodeInstanceProfileResourceConflictError,
  AwsSingleNodeInstanceProfileResourceUnknownError,
  createAwsSingleNodeInstanceProfileResource,
} from '../../src/core/runtime/deployment-aws-instance-profile-resource.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  createAwsSingleNodeRuntimeIdentityTags,
  getAwsSingleNodeRuntimeInstanceProfileName,
  getAwsSingleNodeRuntimeInstanceProfileStateDigest,
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

const INSTANCE_PROFILE_ID = 'AIPA1234567890EXAMPLE';
const ROLE_ID = 'AROA1234567890EXAMPLE';
const INSTANCE_ID = 'i-00000000000000001';

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
    },
    placement: { availabilityZoneId: 'use1-az1' },
    storage: {
      ebsKmsKeyArn:
        'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    },
    bootstrapDigest: digest('instance profile test bootstrap'),
  });
}

/** @returns {Readonly<Record<string, any>>} */
function makeBase() {
  const profile = validateDeploymentProfile(
    createDeploymentProfile({
      profile: { id: 'production' },
      appId: 'instance-profile-resource-test',
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
      'wharfie:test:instance-profile-revision:v1',
      { revision: 1 },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'instance profile resource artifact',
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

/** @param {Readonly<Record<string, any>>} definition @returns {string} */
function providerResourceId(definition) {
  if (definition.resourceKey === 'runtime-identity') return INSTANCE_PROFILE_ID;
  if (definition.resourceKey === 'runtime-role') return ROLE_ID;
  if (definition.resourceKey === 'substrate') return INSTANCE_ID;
  if (definition.role.kind === 'volume') {
    return definition.resourceKey === 'application-state'
      ? 'vol-00000000000000001'
      : 'vol-00000000000000002';
  }
  return `provider-resource-${definition.resourceKey}`;
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} definition */
function desiredState(base, definition) {
  return {
    providerType: definition.providerType,
    providerResourceId: null,
    stateDigest:
      definition.resourceKey === 'runtime-identity'
        ? getAwsSingleNodeRuntimeInstanceProfileStateDigest({
            providerScopeId: base.providerScope.providerScopeId,
            deploymentInstanceId: base.deploymentInstanceId,
            incarnationId: base.incarnationId,
          })
        : digest(`${definition.resourceKey} desired`),
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
          'win5',
          'wharfie:test:instance-profile-inspection:v1',
          { operation },
        ),
      },
      actions,
    },
    { profile: base.profile },
  );
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} action @param {Record<string, any>} [overrides] */
function makeBinding(base, action, overrides = {}) {
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
    providerType: action.before?.providerType ?? action.after.providerType,
    providerResourceId:
      overrides.providerResourceId ??
      action.before?.providerResourceId ??
      INSTANCE_PROFILE_ID,
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce: overrides.ownershipNonce ?? nonce(71),
    createdByActionId:
      overrides.createdByActionId ??
      semanticId('wda3', 'wharfie:test:instance-profile-create-action:v1', {
        resourceKey: action.resourceKey,
      }),
  });
}

/** @param {{operation?: 'apply'|'reconcile'|'destroy', ownershipNonceByte?: number}} [options] */
function makeFixture(options = {}) {
  const operation = options.operation ?? 'apply';
  const base = makeBase();
  const plan = makePlan(base, operation);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'runtime-identity',
  );
  const action = plan.actions[actionIndex];
  if (action === undefined) throw new Error('Missing runtime-identity action.');
  const ownershipNonce = nonce(options.ownershipNonceByte ?? 71);
  const priorBinding =
    action.action === 'create'
      ? null
      : makeBinding(base, action, { ownershipNonce });
  const resourceBindings = priorBinding === null ? [] : [priorBinding];
  /** @type {AnyRecord|null} */
  let lastOperation = null;
  if (operation !== 'apply') {
    if (priorBinding === null) throw new Error('Missing existing binding.');
    lastOperation = {
      kind: 'create',
      planId: semanticId('wpl3', 'wharfie:test:instance-profile-last-plan:v1', {
        operation,
      }),
      intents: [
        {
          actionId: priorBinding.createdByActionId,
          status: 'settled',
          ownershipNonce: priorBinding.ownershipNonce,
        },
      ],
    };
  }
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
    priorBinding,
    head,
    context,
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture */
function nameAuthority(fixture) {
  return {
    providerScopeId: fixture.base.providerScope.providerScopeId,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture */
function profileName(fixture) {
  return getAwsSingleNodeRuntimeInstanceProfileName(nameAuthority(fixture));
}

/** @param {ReturnType<typeof makeFixture>} fixture */
function profileArn(fixture) {
  return `arn:aws:iam::123456789012:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${profileName(fixture)}`;
}

/** @param {ReturnType<typeof makeFixture>} fixture */
function expectedTags(fixture) {
  return createAwsSingleNodeRuntimeIdentityTags({
    resourceKind: 'single-node-runtime-instance-profile',
    capabilityKind: 'runtime-identity',
    roleKind: 'instance-profile',
    providerScopeId: fixture.base.providerScope.providerScopeId,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
    resourceKey: 'runtime-identity',
    createdByActionId:
      fixture.priorBinding?.createdByActionId ?? fixture.action.actionId,
    ownershipNonce: fixture.ownershipNonce,
    stateDigest: getAwsSingleNodeRuntimeInstanceProfileStateDigest(
      nameAuthority(fixture),
    ),
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function makeInstanceProfile(fixture, overrides = {}) {
  return {
    Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
    InstanceProfileName: profileName(fixture),
    InstanceProfileId: INSTANCE_PROFILE_ID,
    Arn: profileArn(fixture),
    Roles: [],
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function makeRole(fixture, overrides = {}) {
  return {
    Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
    RoleName: 'wharfie-runtime-role-v1-0123456789abcdef0123456789abcdef',
    RoleId: ROLE_ID,
    Arn: `arn:aws:iam::123456789012:role${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}wharfie-runtime-role-v1-0123456789abcdef0123456789abcdef`,
    ...overrides,
  };
}

/** @param {'NoSuchEntity'|'NoSuchEntityException'} [name] @returns {Error} */
function noSuchEntity(name = 'NoSuchEntityException') {
  return Object.assign(new Error('provider secret missing detail'), {
    name,
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makeClient(fixture, options = {}) {
  const instanceProfile =
    options.instanceProfile ?? makeInstanceProfile(fixture);
  return Object.freeze({
    getInstanceProfile:
      options.getInstanceProfile ??
      jest.fn(async () => ({ InstanceProfile: instanceProfile })),
    createInstanceProfile:
      options.createInstanceProfile ??
      jest.fn(async () => ({ InstanceProfile: instanceProfile })),
    deleteInstanceProfile:
      options.deleteInstanceProfile ?? jest.fn(async () => ({})),
    listInstanceProfileTags:
      options.listInstanceProfileTags ??
      jest.fn(async () => ({ Tags: expectedTags(fixture) })),
    describeInstances:
      options.describeInstances ?? jest.fn(async () => ({ Reservations: [] })),
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makePorts(fixture, options = {}) {
  const client = options.client ?? makeClient(fixture, options);
  const waitForRetry = options.waitForRetry ?? jest.fn();
  return {
    client,
    waitForRetry,
    resource: createAwsSingleNodeInstanceProfileResource({
      client,
      providerScope: fixture.base.providerScope,
      maxAttempts: options.maxAttempts ?? 1,
      waitForRetry,
    }),
  };
}

describe('AWS single-node runtime instance profile create and recovery', () => {
  it('submits one exact frozen CreateInstanceProfile request with all 13 atomic tags', async () => {
    const fixture = makeFixture();
    const createInstanceProfile = jest.fn(
      async (/** @type {AnyRecord} */ _input) => ({}),
    );
    const getInstanceProfile = jest.fn(async () => {
      throw noSuchEntity();
    });
    const client = makeClient(fixture, {
      getInstanceProfile,
      createInstanceProfile,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);

    expect(createInstanceProfile).toHaveBeenCalledTimes(1);
    const request = /** @type {AnyRecord} */ (
      createInstanceProfile.mock.calls[0][0]
    );
    expect(request).toEqual({
      InstanceProfileName: profileName(fixture),
      Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
      Tags: expectedTags(fixture),
    });
    expect(request.Tags).toHaveLength(13);
    expectDeepFrozen(request);
    expect(client.listInstanceProfileTags).not.toHaveBeenCalled();
    expect(client.describeInstances).not.toHaveBeenCalled();
  });

  it('never replays an ambiguous create in-process and advances only through exact readback', async () => {
    const fixture = makeFixture();
    const createInstanceProfile = jest.fn(async () => {
      throw new Error('secret ambiguous create response');
    });
    const client = makeClient(fixture, {
      getInstanceProfile: jest.fn(async () => {
        throw noSuchEntity();
      }),
      createInstanceProfile,
    });
    const { resource } = makePorts(fixture, { client });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();
    }
    expect(createInstanceProfile).toHaveBeenCalledTimes(1);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
  });

  it.each(['EntityAlreadyExists', 'EntityAlreadyExistsException'])(
    'recovers %s only through exact immutable-id and paginated tag readback',
    async (errorName) => {
      const fixture = makeFixture();
      let created = false;
      const getInstanceProfile = jest.fn(async () => {
        if (!created) throw noSuchEntity();
        return { InstanceProfile: makeInstanceProfile(fixture) };
      });
      const createInstanceProfile = jest.fn(async () => {
        created = true;
        throw Object.assign(new Error('secret collision detail'), {
          name: errorName,
        });
      });
      const tags = expectedTags(fixture);
      const listInstanceProfileTags = jest.fn(
        async (/** @type {AnyRecord} */ input) =>
          input.Marker === undefined
            ? {
                Tags: tags.slice(0, 7),
                IsTruncated: true,
                Marker: 'page-two',
              }
            : { Tags: tags.slice(7), IsTruncated: false },
      );
      const client = makeClient(fixture, {
        getInstanceProfile,
        createInstanceProfile,
        listInstanceProfileTags,
      });
      const { resource } = makePorts(fixture, { client });

      await resource.executeAction(fixture.context);
      const settlement = await resource.verifySettlement(fixture.context);

      expect(settlement).toMatchObject({
        status: 'converged',
        binding: {
          resourceKey: 'runtime-identity',
          providerType: 'instance-profile',
          providerResourceId: INSTANCE_PROFILE_ID,
          dependencyBindings: [],
        },
      });
      expect(createInstanceProfile).toHaveBeenCalledTimes(1);
      expect(listInstanceProfileTags).toHaveBeenCalledTimes(4);
      expect(listInstanceProfileTags.mock.calls[0][0]).toEqual({
        InstanceProfileName: profileName(fixture),
        MaxItems: AWS_SINGLE_NODE_INSTANCE_PROFILE_TAG_PAGE_SIZE,
      });
      expect(listInstanceProfileTags.mock.calls[1][0]).toEqual({
        InstanceProfileName: profileName(fixture),
        Marker: 'page-two',
        MaxItems: AWS_SINGLE_NODE_INSTANCE_PROFILE_TAG_PAGE_SIZE,
      });
      expectDeepFrozen(listInstanceProfileTags.mock.calls[0][0]);
      expectDeepFrozen(settlement);
      expect(JSON.stringify(settlement)).not.toContain('secret');
    },
  );
});

describe('AWS single-node runtime instance profile evidence', () => {
  it.each(['NoSuchEntity', 'NoSuchEntityException'])(
    'treats canonical %s as exact absence without exposing provider detail',
    async (errorName) => {
      const fixture = makeFixture();
      const client = makeClient(fixture, {
        getInstanceProfile: jest.fn(async () => {
          throw noSuchEntity(
            /** @type {'NoSuchEntity'|'NoSuchEntityException'} */ (errorName),
          );
        }),
      });
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'not-converged',
        },
      );
      expect(client.listInstanceProfileTags).not.toHaveBeenCalled();
    },
  );

  it('accepts zero or one structurally valid role without claiming association ownership', async () => {
    const fixture = makeFixture();
    for (const roles of [[], [makeRole(fixture)]]) {
      const client = makeClient(fixture, {
        instanceProfile: makeInstanceProfile(fixture, { Roles: roles }),
      });
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        expect.objectContaining({ status: 'converged' }),
      );
      expect(client.describeInstances).not.toHaveBeenCalled();
    }
  });

  it.each([
    [
      'wrong account ARN',
      { Arn: 'arn:aws:iam::999999999999:instance-profile/wrong' },
    ],
    ['wrong path', { Path: '/foreign/' }],
    ['wrong name', { InstanceProfileName: 'foreign-profile' }],
    [
      'multiple roles',
      {
        Roles: [
          makeRole(makeFixture()),
          makeRole(makeFixture(), { RoleName: 'second-role' }),
        ],
      },
    ],
    ['invalid role', { Roles: [makeRole(makeFixture(), { RoleId: 'bad' })] }],
  ])(
    'blocks %s instead of adopting contradictory evidence',
    async (_label, change) => {
      const fixture = makeFixture();
      const client = makeClient(fixture, {
        instanceProfile: makeInstanceProfile(fixture, change),
      });
      const { resource } = makePorts(fixture, { client });

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'blocked',
        },
      );
      expect(client.createInstanceProfile).not.toHaveBeenCalled();
    },
  );

  it('distinguishes malformed provider identity from a well-formed immutable-id contradiction', async () => {
    const createFixture = makeFixture();
    const malformedClient = makeClient(createFixture, {
      instanceProfile: makeInstanceProfile(createFixture, {
        InstanceProfileId: 'not-an-aipa-id',
      }),
    });
    const malformed = makePorts(createFixture, {
      client: malformedClient,
    }).resource;
    await expect(
      malformed.verifySettlement(createFixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInstanceProfileResourceUnknownError);

    const reconcileFixture = makeFixture({ operation: 'reconcile' });
    const conflictingClient = makeClient(reconcileFixture, {
      instanceProfile: makeInstanceProfile(reconcileFixture, {
        InstanceProfileId: 'AIPA0987654321EXAMPLE',
      }),
    });
    const conflicting = makePorts(reconcileFixture, {
      client: conflictingClient,
    }).resource;
    await expect(
      conflicting.verifySettlement(reconcileFixture.context),
    ).resolves.toEqual({ status: 'blocked' });
  });

  it('treats a post-create subset of exact tags as transient', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      listInstanceProfileTags: jest.fn(async () => ({
        Tags: expectedTags(fixture).slice(1),
      })),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
  });

  it('does not replay create while exact ownership tags are still propagating', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      listInstanceProfileTags: jest.fn(async () => ({
        Tags: expectedTags(fixture).slice(0, 7),
      })),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.createInstanceProfile).not.toHaveBeenCalled();
    expect(client.deleteInstanceProfile).not.toHaveBeenCalled();
  });

  it.each([
    [
      'changed',
      (/** @type {AnyRecord[]} */ tags) => [
        { ...tags[0], Value: 'foreign' },
        ...tags.slice(1),
      ],
    ],
    [
      'duplicate',
      (/** @type {AnyRecord[]} */ tags) => [...tags, { ...tags[0] }],
    ],
    [
      'extra',
      (/** @type {AnyRecord[]} */ tags) => [
        ...tags,
        { Key: 'owner', Value: 'someone' },
      ],
    ],
  ])('blocks %s tag evidence', async (_label, mutate) => {
    const fixture = makeFixture();
    const client = makeClient(fixture, {
      listInstanceProfileTags: jest.fn(async () => ({
        Tags: mutate([...expectedTags(fixture)]),
      })),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('fails closed on cyclic or over-budget tag pagination without leaking provider data', async () => {
    const fixture = makeFixture();
    const listInstanceProfileTags = jest.fn(async () => ({
      Tags: [],
      IsTruncated: true,
      Marker: 'same-marker',
      providerSecret: 'do not surface',
    }));
    const client = makeClient(fixture, { listInstanceProfileTags });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .verifySettlement(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeInstanceProfileResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('providerSecret');
    expect(listInstanceProfileTags).toHaveBeenCalledTimes(2);
    expect(listInstanceProfileTags.mock.calls.length).toBeLessThanOrEqual(
      AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_TAG_PAGES,
    );
  });
});

describe('AWS single-node runtime instance profile safe deletion', () => {
  it.each([
    'DeleteConflict',
    'DeleteConflictException',
    'ConcurrentModification',
    'ConcurrentModificationException',
  ])(
    'keeps canonical %s deletion failures on the readback path',
    async (errorName) => {
      const fixture = makeFixture({ operation: 'destroy' });
      const deleteInstanceProfile = jest.fn(async () => {
        throw Object.assign(new Error('secret delete conflict'), {
          name: errorName,
        });
      });
      const client = makeClient(fixture, { deleteInstanceProfile });
      const { resource } = makePorts(fixture, { client });

      await expect(
        resource.executeAction(fixture.context),
      ).resolves.toBeUndefined();
      expect(deleteInstanceProfile).toHaveBeenCalledTimes(1);
    },
  );

  it('deletes only after zero roles and a bounded exact current-region usage fence', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const terminated = {
      InstanceId: INSTANCE_ID,
      IamInstanceProfile: {
        Id: INSTANCE_PROFILE_ID,
        Arn: profileArn(fixture),
      },
      State: { Code: 48, Name: 'terminated' },
    };
    const describeInstances = jest.fn(async (/** @type {AnyRecord} */ input) =>
      input.NextToken === undefined
        ? {
            Reservations: [{ Instances: [terminated] }],
            NextToken: 'page-two',
          }
        : { Reservations: [] },
    );
    const deleteInstanceProfile = jest.fn(
      async (/** @type {AnyRecord} */ _input) => ({}),
    );
    const client = makeClient(fixture, {
      describeInstances,
      deleteInstanceProfile,
    });
    const { resource } = makePorts(fixture, { client });

    await resource.executeAction(fixture.context);

    expect(describeInstances).toHaveBeenCalledTimes(2);
    expect(describeInstances.mock.calls[0][0]).toEqual({
      Filters: [
        {
          Name: 'iam-instance-profile.id',
          Values: [INSTANCE_PROFILE_ID],
        },
      ],
      IncludeManagedResources: true,
      MaxResults: AWS_SINGLE_NODE_INSTANCE_PROFILE_INSTANCE_PAGE_SIZE,
    });
    expect(describeInstances.mock.calls[1][0]).toEqual({
      Filters: [
        {
          Name: 'iam-instance-profile.id',
          Values: [INSTANCE_PROFILE_ID],
        },
      ],
      IncludeManagedResources: true,
      MaxResults: AWS_SINGLE_NODE_INSTANCE_PROFILE_INSTANCE_PAGE_SIZE,
      NextToken: 'page-two',
    });
    expectDeepFrozen(describeInstances.mock.calls[0][0]);
    expect(deleteInstanceProfile).toHaveBeenCalledWith({
      InstanceProfileName: profileName(fixture),
    });
    expectDeepFrozen(
      /** @type {AnyRecord} */ (deleteInstanceProfile.mock.calls[0][0]),
    );
  });

  it('blocks deletion while role membership remains and does not consult EC2', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, {
      instanceProfile: makeInstanceProfile(fixture, {
        Roles: [makeRole(fixture)],
      }),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.describeInstances).not.toHaveBeenCalled();
    expect(client.deleteInstanceProfile).not.toHaveBeenCalled();
  });

  it('treats a delete-side subset of exact ownership tags as transient', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, {
      listInstanceProfileTags: jest.fn(async () => ({
        Tags: expectedTags(fixture).slice(0, 7),
      })),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(client.describeInstances).not.toHaveBeenCalled();
    expect(client.deleteInstanceProfile).not.toHaveBeenCalled();
  });

  it.each([
    ['pending', { Code: 0, Name: 'pending' }],
    ['running', { Code: 16, Name: 'running' }],
    ['stopping', { Code: 64, Name: 'stopping' }],
    ['stopped', { Code: 80, Name: 'stopped' }],
    ['shutting-down', { Code: 32, Name: 'shutting-down' }],
  ])('blocks deletion for a returned %s instance', async (_label, state) => {
    const fixture = makeFixture({ operation: 'destroy' });
    const client = makeClient(fixture, {
      describeInstances: jest.fn(async () => ({
        Reservations: [
          {
            Instances: [
              {
                InstanceId: INSTANCE_ID,
                IamInstanceProfile: {
                  Id: INSTANCE_PROFILE_ID,
                  Arn: profileArn(fixture),
                },
                State: state,
              },
            ],
          },
        ],
      })),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.deleteInstanceProfile).not.toHaveBeenCalled();
  });

  it('fails closed on malformed or unbounded current-region instance evidence', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const malformedClient = makeClient(fixture, {
      describeInstances: jest.fn(async () => ({
        Reservations: [{ Instances: [{ InstanceId: INSTANCE_ID }] }],
      })),
    });
    const malformed = makePorts(fixture, { client: malformedClient }).resource;
    await expect(
      malformed.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInstanceProfileResourceUnknownError);

    const paginatedClient = makeClient(fixture, {
      describeInstances: jest.fn(async (/** @type {AnyRecord} */ input) => ({
        Reservations: [],
        NextToken: input.NextToken ?? 'repeated-token',
      })),
    });
    const paginated = makePorts(fixture, { client: paginatedClient }).resource;
    await expect(
      paginated.verifySettlement(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeInstanceProfileResourceUnknownError);
    expect(
      paginatedClient.describeInstances.mock.calls.length,
    ).toBeLessThanOrEqual(AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_INSTANCE_PAGES);
  });

  it('settles deletion from exact absence and recovers a lost delete response by exact readback', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const missingClient = makeClient(fixture, {
      getInstanceProfile: jest.fn(async () => {
        throw noSuchEntity();
      }),
    });
    const missing = makePorts(fixture, { client: missingClient }).resource;
    await expect(missing.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(missingClient.listInstanceProfileTags).not.toHaveBeenCalled();
    expect(missingClient.describeInstances).not.toHaveBeenCalled();

    let readCount = 0;
    const deleteClient = makeClient(fixture, {
      getInstanceProfile: jest.fn(async () => {
        readCount += 1;
        if (readCount > 1) throw noSuchEntity();
        return { InstanceProfile: makeInstanceProfile(fixture) };
      }),
      deleteInstanceProfile: jest.fn(async () => {
        throw new Error('secret delete provider response');
      }),
    });
    const deleting = makePorts(fixture, { client: deleteClient }).resource;
    await expect(
      deleting.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    await expect(deleting.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: null,
    });
    expect(deleteClient.deleteInstanceProfile).toHaveBeenCalledTimes(1);
  });

  it('sanitizes an ambiguous delete when exact readback also fails', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    let readCount = 0;
    const client = makeClient(fixture, {
      getInstanceProfile: jest.fn(async () => {
        readCount += 1;
        if (readCount > 1) throw new Error('secret readback failure');
        return { InstanceProfile: makeInstanceProfile(fixture) };
      }),
      deleteInstanceProfile: jest.fn(async () => {
        throw new Error('secret delete provider response');
      }),
    });
    const { resource } = makePorts(fixture, { client });

    const observed = await resource
      .executeAction(fixture.context)
      .catch((/** @type {unknown} */ error) => error);
    expect(observed).toBeInstanceOf(
      AwsSingleNodeInstanceProfileResourceUnknownError,
    );
    expect(JSON.stringify(observed)).not.toContain('secret');
  });

  it('keeps a lost delete response on the settlement path while tag removal propagates', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    let tagReadCount = 0;
    const listInstanceProfileTags = jest.fn(async () => {
      tagReadCount += 1;
      if (tagReadCount > 1) throw noSuchEntity();
      return { Tags: expectedTags(fixture) };
    });
    const client = makeClient(fixture, {
      listInstanceProfileTags,
      deleteInstanceProfile: jest.fn(async () => {
        throw new Error('secret lost DeleteInstanceProfile response');
      }),
    });
    const { resource } = makePorts(fixture, { client });

    await expect(
      resource.executeAction(fixture.context),
    ).resolves.toBeUndefined();
    expect(client.deleteInstanceProfile).toHaveBeenCalledTimes(1);
  });
});

describe('AWS single-node runtime instance profile authority', () => {
  it('rejects tampered action authority before any provider call', async () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    const { resource } = makePorts(fixture, { client });
    const context = {
      ...fixture.context,
      actionIndex: fixture.actionIndex + 1,
    };

    await expect(resource.executeAction(context)).rejects.toBeInstanceOf(
      AwsSingleNodeInstanceProfileResourceConflictError,
    );
    for (const method of Object.values(client)) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it('requires exactly the narrow five-method client and bounded retry settings', () => {
    const fixture = makeFixture();
    const client = makeClient(fixture);
    for (const method of Object.keys(client)) {
      expect(() =>
        createAwsSingleNodeInstanceProfileResource({
          client: { ...client, [method]: undefined },
          providerScope: fixture.base.providerScope,
        }),
      ).toThrow(new RegExp(`client\\.${method} is required`, 'i'));
    }
    expect(() =>
      createAwsSingleNodeInstanceProfileResource({
        client,
        providerScope: fixture.base.providerScope,
        maxAttempts: 0,
      }),
    ).toThrow(/maxAttempts/i);
  });
});
