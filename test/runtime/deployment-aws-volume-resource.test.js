import { describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';

import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
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
  AWS_SINGLE_NODE_VOLUME_CREATE_CLIENT_TOKEN_DOMAIN,
  AWS_SINGLE_NODE_VOLUME_STATE_DIGEST_DOMAIN,
  AwsSingleNodeVolumeResourceConflictError,
  AwsSingleNodeVolumeResourceUnknownError,
  createAwsSingleNodeVolumeResource,
  getAwsSingleNodeVolumeCreateClientToken,
  getAwsSingleNodeVolumeStateDigest,
} from '../../src/core/runtime/deployment-aws-volume-resource.js';
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
/** @typedef {{Key: string, Value: string}} VolumeTag */

const VOLUME_IDS = Object.freeze({
  application: 'vol-00000000000000001',
  control: 'vol-00000000000000002',
  duplicate: 'vol-00000000000000003',
});
const INSTANCE_ID = 'i-00000000000000001';
const CREATE_TIME = new Date('2026-07-21T12:00:00.000Z');

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

/** @param {Readonly<AnyRecord>|null} binding @param {string} [path] @returns {Readonly<AnyRecord>} */
function requireBinding(binding, path = 'binding') {
  if (binding === null) throw new Error(`Test fixture requires ${path}.`);
  return binding;
}

/** @param {Readonly<Record<string, any>>} profile @param {Readonly<Record<string, any>>} providerScope @param {{availabilityZoneId?: string, kmsKeyArn?: string}} [overrides] */
function makeProviderSpec(profile, providerScope, overrides = {}) {
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
    placement: {
      availabilityZoneId: overrides.availabilityZoneId ?? 'use1-az1',
    },
    storage: {
      ebsKmsKeyArn:
        overrides.kmsKeyArn ??
        'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    },
  });
}

/** @param {{availabilityZoneId?: string, kmsKeyArn?: string}} [overrides] */
function makeBase(overrides = {}) {
  const profile = validateDeploymentProfile(
    createDeploymentProfile({
      profile: { id: 'production' },
      appId: 'volume-resource-test',
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
    revisionId: semanticId('wrv1', 'wharfie:test:volume-revision:v1', {
      revision: 1,
    }),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'volume resource artifact',
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
  const providerSpec = makeProviderSpec(profile, providerScope, overrides);
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

/** @param {Readonly<Record<string, any>>} resourceDefinition @returns {string} */
function providerResourceId(resourceDefinition) {
  if (resourceDefinition.resourceKey === 'substrate') return INSTANCE_ID;
  if (resourceDefinition.resourceKey === 'application-state') {
    return VOLUME_IDS.application;
  }
  if (resourceDefinition.resourceKey === 'control-state') {
    return VOLUME_IDS.control;
  }
  return `provider-resource-${resourceDefinition.resourceKey}`;
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} resourceDefinition @param {Readonly<Record<string, any>>|undefined} override */
function desiredState(base, resourceDefinition, override) {
  return {
    providerType: resourceDefinition.providerType,
    providerResourceId: null,
    stateDigest:
      override ??
      (resourceDefinition.role.kind === 'volume'
        ? getAwsSingleNodeVolumeStateDigest(
            base.providerSpec,
            resourceDefinition.capability.kind,
          )
        : digest(`${resourceDefinition.resourceKey} desired`)),
  };
}

/**
 * @param {Readonly<Record<string, any>>} base
 * @param {{operation: 'apply'|'reconcile'|'destroy', volumeDigestOverride?: Readonly<Record<string, any>>, actionOverride?: (action: Record<string, any>, resource: Readonly<Record<string, any>>) => Record<string, any>}} options
 */
function makePlan(base, options) {
  const resourceDefinitions =
    options.operation === 'destroy'
      ? [...AWS_SINGLE_NODE_RESOURCE_GRAPH.resources].reverse()
      : AWS_SINGLE_NODE_RESOURCE_GRAPH.resources;
  const actions = resourceDefinitions.map(
    (/** @type {Readonly<AnyRecord>} */ resourceDefinition) => {
      const desired = desiredState(
        base,
        resourceDefinition,
        resourceDefinition.role.kind === 'volume'
          ? options.volumeDigestOverride
          : undefined,
      );
      const existing = {
        ...desired,
        providerResourceId: providerResourceId(resourceDefinition),
      };
      const resourceContract = {
        resourceKey: resourceDefinition.resourceKey,
        capability: resourceDefinition.capability,
        role: resourceDefinition.role,
        management: 'managed',
        ownershipMode: resourceDefinition.ownershipMode,
        dependsOn: resourceDefinition.dependsOn,
        onDestroy: resourceDefinition.onDestroy,
      };
      let action;
      if (options.operation === 'apply') {
        action = {
          ...resourceContract,
          action: 'create',
          destructive: false,
          reason: 'missing',
          before: null,
          after: desired,
        };
      } else if (options.operation === 'reconcile') {
        action = {
          ...resourceContract,
          action: 'noop',
          destructive: false,
          reason: 'already-converged',
          before: existing,
          after: existing,
        };
      } else {
        const retained = resourceDefinition.onDestroy === 'retain';
        action = {
          ...resourceContract,
          action: retained ? 'noop' : 'delete',
          destructive: !retained,
          reason: retained ? 'retained-data' : 'destroy-requested',
          before: existing,
          after: retained ? existing : null,
        };
      }
      return options.actionOverride?.(action, resourceDefinition) ?? action;
    },
  );
  return createDeploymentPlan(
    {
      operation: options.operation,
      deploymentRevision: base.deploymentRevision,
      providerScope: base.providerScope,
      providerSpec: base.providerSpec,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
      basis: {
        headGeneration: options.operation === 'apply' ? 0 : 1,
        settledDeploymentRevisionId:
          options.operation === 'apply'
            ? null
            : base.deploymentRevision.deploymentRevisionId,
        inspectionId: semanticId('win5', 'wharfie:test:volume-inspection:v1', {
          operation: options.operation,
        }),
      },
      actions,
    },
    { profile: base.profile },
  );
}

/** @param {Readonly<Record<string, any>>} base @param {Readonly<Record<string, any>>} action @param {{providerResourceId?: string, ownershipNonce?: string, createdByActionId?: string}} [overrides] */
function makeBinding(base, action, overrides = {}) {
  const resourceDefinition = AWS_SINGLE_NODE_RESOURCE_GRAPH.resources.find(
    (/** @type {Readonly<AnyRecord>} */ candidate) =>
      candidate.resourceKey === action.resourceKey,
  );
  if (resourceDefinition === undefined) {
    throw new Error(`Missing graph definition for '${action.resourceKey}'.`);
  }
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
    providerType: action.after?.providerType ?? action.before.providerType,
    providerResourceId:
      overrides.providerResourceId ??
      action.before?.providerResourceId ??
      providerResourceId(resourceDefinition),
    providerScopeId: base.providerScope.providerScopeId,
    ownershipNonce: overrides.ownershipNonce ?? nonce(91),
    createdByActionId:
      overrides.createdByActionId ??
      semanticId('wda3', 'wharfie:test:volume-create-action:v1', {
        resourceKey: action.resourceKey,
      }),
  });
}

/**
 * @param {{operation?: 'apply'|'reconcile'|'destroy', capability?: 'application-state'|'control-state', withNode?: boolean, base?: Readonly<Record<string, any>>, planOptions?: Record<string, any>}} [options]
 */
function makeFixture(options = {}) {
  const operation = options.operation ?? 'apply';
  const capability = options.capability ?? 'application-state';
  const base = options.base ?? makeBase();
  const plan = makePlan(base, { operation, ...(options.planOptions ?? {}) });
  const actions = /** @type {Readonly<AnyRecord>[]} */ (plan.actions);
  const actionIndex = actions.findIndex(
    (action) =>
      action.capability.kind === capability && action.role.kind === 'volume',
  );
  const action = actions[actionIndex];
  if (action === undefined) {
    throw new Error(`Missing ${capability} volume action.`);
  }
  const ownershipNonce = nonce(capability === 'application-state' ? 71 : 72);
  /** @type {Readonly<AnyRecord>[]} */
  const resourceBindings = [];
  /** @type {Readonly<AnyRecord>|null} */
  let priorBinding = null;
  if (action.action === 'noop') {
    priorBinding = makeBinding(base, action, { ownershipNonce });
    resourceBindings.push(priorBinding);
  }

  /** @type {Readonly<AnyRecord>|null} */
  let nodeBinding = null;
  if (options.withNode) {
    const nodeIndex = actions.findIndex(
      (candidate) => candidate.resourceKey === 'substrate',
    );
    const nodeAction = actions[nodeIndex];
    if (nodeAction === undefined) throw new Error('Missing substrate action.');
    nodeBinding = makeBinding(base, nodeAction, {
      providerResourceId: INSTANCE_ID,
      ownershipNonce: nonce(70),
      createdByActionId:
        operation === 'apply'
          ? nodeAction.actionId
          : semanticId('wda3', 'wharfie:test:node-create-action:v1', {
              operation,
            }),
    });
    resourceBindings.push(nodeBinding);
  }

  const intents = actions.map((candidate, index) => ({
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
        : candidate.capability.kind === 'resident-node' && nodeBinding !== null
          ? nodeBinding.ownershipNonce
          : nonce(10 + index),
  }));
  const lastIntents = resourceBindings.map((binding) => ({
    actionId: binding.createdByActionId,
    status: 'settled',
    ownershipNonce: binding.ownershipNonce,
  }));
  if (lastIntents.length === 0 && operation !== 'apply') {
    lastIntents.push({
      actionId: semanticId(
        'wda3',
        'wharfie:test:empty-last-operation-action:v1',
        { operation },
      ),
      status: 'settled',
      ownershipNonce: nonce(99),
    });
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
    lastOperation:
      operation === 'apply'
        ? null
        : {
            kind: 'create',
            planId: semanticId('wpl3', 'wharfie:test:volume-last-plan:v1', {
              operation,
            }),
            intents: lastIntents,
          },
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
    head,
    action,
    actionIndex,
    ownershipNonce,
    priorBinding,
    nodeBinding,
    context,
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [activeChanges] */
function recreateHead(fixture, activeChanges = {}) {
  const { head } = fixture;
  return createDeploymentHead({
    deploymentInstanceId: head.deploymentInstanceId,
    providerScope: head.providerScope,
    incarnationId: head.incarnationId,
    generation: head.generation,
    phase: head.phase,
    settledDeploymentRevisionId: head.settledDeploymentRevisionId,
    targetDeploymentRevisionId: head.targetDeploymentRevisionId,
    resourceBindings: head.resourceBindings,
    activeOperation: {
      kind: head.activeOperation.kind,
      planId: head.activeOperation.planId,
      status: head.activeOperation.status,
      nextActionIndex: head.activeOperation.nextActionIndex,
      intents: head.activeOperation.intents,
      ...activeChanges,
    },
    lastOperation:
      head.lastOperation === null
        ? null
        : {
            kind: head.lastOperation.kind,
            planId: head.lastOperation.planId,
            intents: head.lastOperation.intents,
          },
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @returns {Record<string, string>} */
function expectedTags(fixture) {
  return {
    'wharfie:managed-by': 'wharfie',
    'wharfie:resource-kind': 'single-node-state-volume',
    'wharfie:retention': 'retain',
    'wharfie:schema-version': '2',
    'wharfie:capability': fixture.action.capability.kind,
    'wharfie:role': fixture.action.role.kind,
    'wharfie:provider-scope-id': fixture.base.providerScope.providerScopeId,
    'wharfie:deployment-instance-id': fixture.base.deploymentInstanceId,
    'wharfie:incarnation-id': fixture.base.incarnationId,
    'wharfie:resource-key': fixture.action.resourceKey,
    'wharfie:created-by-action-id':
      fixture.priorBinding?.createdByActionId ?? fixture.action.actionId,
    'wharfie:ownership-nonce': fixture.ownershipNonce,
    'wharfie:state-digest': fixture.action.after.stateDigest.value,
  };
}

/** @param {Record<string, string>} tags @returns {{Key: string, Value: string}[]} */
function tagArray(tags) {
  return Object.entries(tags)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([Key, Value]) => ({ Key, Value }));
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function makeVolume(fixture, overrides = {}) {
  const configuration =
    fixture.action.capability.kind === 'application-state'
      ? fixture.base.providerSpec.capabilities.applicationState
      : fixture.base.providerSpec.capabilities.controlState;
  return {
    VolumeId:
      fixture.action.capability.kind === 'application-state'
        ? VOLUME_IDS.application
        : VOLUME_IDS.control,
    AvailabilityZoneId: fixture.base.providerSpec.placement.availabilityZoneId,
    AvailabilityZone: 'us-east-1a',
    VolumeType: configuration.volumeType,
    Size: configuration.sizeGiB,
    Iops: configuration.iops,
    Throughput: configuration.throughputMiBps,
    MultiAttachEnabled: configuration.multiAttach,
    Encrypted: configuration.encrypted,
    KmsKeyId: fixture.base.providerSpec.storage.ebsKmsKeyArn,
    SnapshotId: '',
    State: 'available',
    CreateTime: new Date(CREATE_TIME),
    Attachments: [],
    Tags: tagArray(expectedTags(fixture)),
    FastRestored: false,
    SseType: 'sse-kms',
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [options] */
function makePorts(fixture, options = {}) {
  const client =
    options.client ??
    Object.freeze({
      createVolume: jest.fn(),
      describeVolumes: jest.fn(),
    });
  const waitForRetry = options.waitForRetry ?? jest.fn();
  const resource = createAwsSingleNodeVolumeResource({
    client,
    providerScope: fixture.base.providerScope,
    maxAttempts: options.maxAttempts ?? 1,
    waitForRetry,
  });
  return { client, waitForRetry, resource };
}

describe('AWS single-node retained EBS volume state digest', () => {
  it('is deterministic, domain separated, canonical, and frozen', () => {
    const base = makeBase();
    const result = getAwsSingleNodeVolumeStateDigest(
      base.providerSpec,
      'application-state',
    );
    const configuration = base.providerSpec.capabilities.applicationState;
    const descriptor = sortCanonicalJsonValue({
      schemaVersion: 1,
      kind: 'awsSingleNodeEbsVolumeState',
      availabilityZoneId: base.providerSpec.placement.availabilityZoneId,
      kmsKeyArn: base.providerSpec.storage.ebsKmsKeyArn,
      volumeType: configuration.volumeType,
      sizeGiB: configuration.sizeGiB,
      iops: configuration.iops,
      throughputMiBps: configuration.throughputMiBps,
      multiAttach: configuration.multiAttach,
      encrypted: configuration.encrypted,
      onDestroy: configuration.onDestroy,
    });

    expect(result).toEqual({
      algorithm: 'sha256',
      value: sha256Base64Url(
        `${AWS_SINGLE_NODE_VOLUME_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
          descriptor,
        )}`,
      ),
    });
    expect(
      getAwsSingleNodeVolumeStateDigest(
        JSON.parse(JSON.stringify(base.providerSpec)),
        'application-state',
      ),
    ).toEqual(result);
    expectDeepFrozen(result);
  });

  it('describes physical volume state without coupling it to the device name', () => {
    const base = makeBase();
    expect(
      getAwsSingleNodeVolumeStateDigest(base.providerSpec, 'application-state'),
    ).toEqual(
      getAwsSingleNodeVolumeStateDigest(base.providerSpec, 'control-state'),
    );
  });

  it('changes when pinned placement or encryption identity changes', () => {
    const original = makeBase();
    const moved = makeBase({ availabilityZoneId: 'use1-az2' });
    const rekeyed = makeBase({
      kmsKeyArn:
        'arn:aws:kms:us-east-1:123456789012:key/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
    const originalDigest = getAwsSingleNodeVolumeStateDigest(
      original.providerSpec,
      'application-state',
    );

    expect(
      getAwsSingleNodeVolumeStateDigest(
        moved.providerSpec,
        'application-state',
      ),
    ).not.toEqual(originalDigest);
    expect(
      getAwsSingleNodeVolumeStateDigest(
        rekeyed.providerSpec,
        'application-state',
      ),
    ).not.toEqual(originalDigest);
  });

  it('rejects unsupported capabilities and malformed provider specifications', () => {
    const base = makeBase();
    expect(() =>
      getAwsSingleNodeVolumeStateDigest(base.providerSpec, 'resident-node'),
    ).toThrow('volume capability is not supported');
    expect(() =>
      getAwsSingleNodeVolumeStateDigest({}, 'application-state'),
    ).toThrow();
  });
});

describe('AWS single-node retained EBS volume create client token', () => {
  it('is canonical, domain separated, deterministic, and Cloud Control compatible', () => {
    const fixture = makeFixture();
    const payload = JSON.stringify(
      sortCanonicalJsonValue({
        actionId: fixture.action.actionId,
        ownershipNonce: fixture.ownershipNonce,
      }),
    );
    const expected = createHash('sha256')
      .update(AWS_SINGLE_NODE_VOLUME_CREATE_CLIENT_TOKEN_DOMAIN, 'utf8')
      .update('\0', 'utf8')
      .update(payload, 'utf8')
      .digest('hex');

    expect(
      getAwsSingleNodeVolumeCreateClientToken(
        fixture.action.actionId,
        fixture.ownershipNonce,
      ),
    ).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('is stable for one replay and changes with the nonce for an identical action', () => {
    const fixture = makeFixture();
    const first = getAwsSingleNodeVolumeCreateClientToken(
      fixture.action.actionId,
      fixture.ownershipNonce,
    );

    expect(
      getAwsSingleNodeVolumeCreateClientToken(
        fixture.action.actionId,
        fixture.ownershipNonce,
      ),
    ).toBe(first);
    expect(
      getAwsSingleNodeVolumeCreateClientToken(
        fixture.action.actionId,
        nonce(73),
      ),
    ).not.toBe(first);
  });

  it('rejects malformed action and ownership identities', () => {
    const fixture = makeFixture();
    expect(() =>
      getAwsSingleNodeVolumeCreateClientToken(
        'not-an-action',
        fixture.ownershipNonce,
      ),
    ).toThrow();
    expect(() =>
      getAwsSingleNodeVolumeCreateClientToken(
        fixture.action.actionId,
        'not-a-nonce',
      ),
    ).toThrow();
  });
});

describe('AWS single-node retained EBS volume execution', () => {
  it('submits one exact deeply frozen CreateVolume request with atomic tags', async () => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.createVolume.mockResolvedValue({
      VolumeId: VOLUME_IDS.application,
    });

    await expect(resource.executeAction(fixture.context)).resolves.toBe(
      undefined,
    );

    expect(client.createVolume).toHaveBeenCalledTimes(1);
    const request = client.createVolume.mock.calls[0][0];
    const configuration =
      fixture.base.providerSpec.capabilities.applicationState;
    expect(request).toEqual({
      AvailabilityZoneId:
        fixture.base.providerSpec.placement.availabilityZoneId,
      ClientToken: getAwsSingleNodeVolumeCreateClientToken(
        fixture.action.actionId,
        fixture.ownershipNonce,
      ),
      Encrypted: configuration.encrypted,
      Iops: configuration.iops,
      KmsKeyId: fixture.base.providerSpec.storage.ebsKmsKeyArn,
      Size: configuration.sizeGiB,
      TagSpecifications: [
        {
          ResourceType: 'volume',
          Tags: tagArray(expectedTags(fixture)),
        },
      ],
      Throughput: configuration.throughputMiBps,
      VolumeType: configuration.volumeType,
    });
    expectDeepFrozen(request);
    expect(client.describeVolumes).not.toHaveBeenCalled();
  });

  it('uses distinct capability identity while retaining the same physical shape', async () => {
    const fixture = makeFixture({ capability: 'control-state' });
    const { client, resource } = makePorts(fixture);
    client.createVolume.mockResolvedValue({ VolumeId: VOLUME_IDS.control });

    await resource.executeAction(fixture.context);

    const request = client.createVolume.mock.calls[0][0];
    expect(request.ClientToken).toBe(
      getAwsSingleNodeVolumeCreateClientToken(
        fixture.action.actionId,
        fixture.ownershipNonce,
      ),
    );
    expect(request.TagSpecifications[0].Tags).toContainEqual({
      Key: 'wharfie:capability',
      Value: 'control-state',
    });
    expect(request.TagSpecifications[0].Tags).toContainEqual({
      Key: 'wharfie:resource-key',
      Value: 'control-state',
    });
  });

  it('replays response-loss with exactly the same client token and parameters', async () => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.createVolume
      .mockRejectedValueOnce(new Error('secret provider response'))
      .mockResolvedValueOnce({ VolumeId: VOLUME_IDS.application });

    await expect(resource.executeAction(fixture.context)).rejects.toEqual(
      expect.any(AwsSingleNodeVolumeResourceUnknownError),
    );
    await expect(resource.executeAction(fixture.context)).resolves.toBe(
      undefined,
    );

    expect(client.createVolume).toHaveBeenCalledTimes(2);
    expect(client.createVolume.mock.calls[1][0]).toEqual(
      client.createVolume.mock.calls[0][0],
    );
    expect(client.createVolume.mock.calls[1][0].ClientToken).toBe(
      getAwsSingleNodeVolumeCreateClientToken(
        fixture.action.actionId,
        fixture.ownershipNonce,
      ),
    );
    expectDeepFrozen(client.createVolume.mock.calls[0][0]);
    expectDeepFrozen(client.createVolume.mock.calls[1][0]);
  });

  it('maps IdempotentParameterMismatch to a fixed non-echoing conflict', async () => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    const providerError = new Error('changed size and secret token');
    providerError.name = 'IdempotentParameterMismatch';
    client.createVolume.mockRejectedValue(providerError);

    await expect(resource.executeAction(fixture.context)).rejects.toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeVolumeResourceConflictError',
        code: 'AWS_SINGLE_NODE_VOLUME_RESOURCE_CONFLICT',
        message:
          'AWS single-node volume resource conflicts with its exact contract.',
      }),
    );
    await expect(resource.executeAction(fixture.context)).rejects.not.toThrow(
      /changed size|secret token/u,
    );
  });

  it('rejects malformed successful CreateVolume envelopes as fixed unknown state', async () => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.createVolume.mockResolvedValue({
      VolumeId: 'not-a-volume',
      secret: 'must-not-echo',
    });

    await expect(resource.executeAction(fixture.context)).rejects.toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeVolumeResourceUnknownError',
        code: 'AWS_SINGLE_NODE_VOLUME_RESOURCE_UNKNOWN',
        message: 'AWS single-node volume resource state is unknown.',
      }),
    );
  });

  it.each(
    /** @type {Array<'reconcile'|'destroy'>} */ (['reconcile', 'destroy']),
  )('performs no mutation for retained %s noop', async (operation) => {
    const fixture = makeFixture({ operation });
    const { client, resource } = makePorts(fixture);

    await expect(resource.executeAction(fixture.context)).resolves.toBe(
      undefined,
    );

    expect(client.createVolume).not.toHaveBeenCalled();
    expect(client.describeVolumes).not.toHaveBeenCalled();
  });
});

describe('AWS single-node retained EBS volume discovery and exact-ID recovery', () => {
  it('recovers a lost CreateVolume response by stable fully frozen tag discovery', async () => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.createVolume.mockRejectedValue(new Error('socket reset secret'));
    client.describeVolumes.mockResolvedValue({
      Volumes: [makeVolume(fixture)],
    });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVolumeResourceUnknownError);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: expect.objectContaining({
        providerResourceId: VOLUME_IDS.application,
        createdByActionId: fixture.action.actionId,
        ownershipNonce: fixture.ownershipNonce,
      }),
    });

    expect(client.describeVolumes).toHaveBeenCalledTimes(1);
    const request = client.describeVolumes.mock.calls[0][0];
    expect(request).toEqual({
      Filters: [
        {
          Name: 'tag:wharfie:managed-by',
          Values: ['wharfie'],
        },
        {
          Name: 'tag:wharfie:resource-kind',
          Values: ['single-node-state-volume'],
        },
        {
          Name: 'tag:wharfie:capability',
          Values: ['application-state'],
        },
        {
          Name: 'tag:wharfie:role',
          Values: ['volume'],
        },
        {
          Name: 'tag:wharfie:provider-scope-id',
          Values: [fixture.base.providerScope.providerScopeId],
        },
        {
          Name: 'tag:wharfie:deployment-instance-id',
          Values: [fixture.base.deploymentInstanceId],
        },
        {
          Name: 'tag:wharfie:incarnation-id',
          Values: [fixture.base.incarnationId],
        },
        {
          Name: 'tag:wharfie:resource-key',
          Values: ['application-state'],
        },
      ],
      MaxResults: 500,
    });
    expect(
      request.Filters.map((/** @type {AnyRecord} */ filter) => filter.Name),
    ).not.toContain('tag:wharfie:ownership-nonce');
    expect(
      request.Filters.map((/** @type {AnyRecord} */ filter) => filter.Name),
    ).not.toContain('tag:wharfie:state-digest');
    expectDeepFrozen(request);
  });

  it('remembers only a successful CreateVolume ID and verifies it by exact ID', async () => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.createVolume.mockResolvedValue({ VolumeId: VOLUME_IDS.application });
    client.describeVolumes.mockResolvedValue({
      Volumes: [makeVolume(fixture)],
    });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: expect.objectContaining({
        providerResourceId: VOLUME_IDS.application,
      }),
    });

    expect(client.describeVolumes).toHaveBeenCalledWith({
      VolumeIds: [VOLUME_IDS.application],
    });
    expectDeepFrozen(client.describeVolumes.mock.calls[0][0]);
  });

  it('never settles from the CreateVolume response itself', async () => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.createVolume.mockResolvedValue({
      ...makeVolume(fixture),
      VolumeId: VOLUME_IDS.application,
    });
    client.describeVolumes.mockResolvedValue({ Volumes: [] });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(client.describeVolumes).toHaveBeenCalledTimes(1);
  });
});

describe('AWS single-node retained EBS volume bounded pagination', () => {
  it('follows every discovery page with stable filters and an exact next token', async () => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.describeVolumes
      .mockResolvedValueOnce({ Volumes: [], NextToken: 'page-2' })
      .mockResolvedValueOnce({ Volumes: [makeVolume(fixture)] });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: expect.objectContaining({
        providerResourceId: VOLUME_IDS.application,
      }),
    });

    expect(client.describeVolumes).toHaveBeenCalledTimes(2);
    const first = client.describeVolumes.mock.calls[0][0];
    const second = client.describeVolumes.mock.calls[1][0];
    expect(second).toEqual({ ...first, NextToken: 'page-2' });
    expect(second.Filters).toBe(first.Filters);
    expectDeepFrozen(first);
    expectDeepFrozen(second);
  });

  it('maps a repeated discovery token to bounded unknown state', async () => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.describeVolumes
      .mockResolvedValueOnce({ Volumes: [], NextToken: 'cycle' })
      .mockResolvedValueOnce({ Volumes: [], NextToken: 'cycle' });

    await expect(resource.verifySettlement(fixture.context)).rejects.toEqual(
      expect.any(AwsSingleNodeVolumeResourceUnknownError),
    );
    expect(client.describeVolumes).toHaveBeenCalledTimes(2);
  });

  it('blocks distinct volumes sharing the same stable locator', async () => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.describeVolumes.mockResolvedValue({
      Volumes: [
        makeVolume(fixture),
        makeVolume(fixture, { VolumeId: VOLUME_IDS.duplicate }),
      ],
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('blocks the same volume repeated across provider pages', async () => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.describeVolumes
      .mockResolvedValueOnce({
        Volumes: [makeVolume(fixture)],
        NextToken: 'page-2',
      })
      .mockResolvedValueOnce({ Volumes: [makeVolume(fixture)] });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('rejects malformed pagination envelopes without echoing their content', async () => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.describeVolumes.mockResolvedValue({
      Volumes: [],
      NextToken: { secret: 'provider-pagination-secret' },
    });

    await expect(resource.verifySettlement(fixture.context)).rejects.toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeVolumeResourceUnknownError',
        message: 'AWS single-node volume resource state is unknown.',
      }),
    );
    await expect(
      resource.verifySettlement(fixture.context),
    ).rejects.not.toThrow(/provider-pagination-secret/u);
  });
});

describe('AWS single-node retained EBS volume transient convergence', () => {
  it('retries creating state and converges only from a later authoritative read', async () => {
    const fixture = makeFixture();
    const { client, waitForRetry, resource } = makePorts(fixture, {
      maxAttempts: 2,
    });
    client.createVolume.mockResolvedValue({ VolumeId: VOLUME_IDS.application });
    client.describeVolumes
      .mockResolvedValueOnce({
        Volumes: [makeVolume(fixture, { State: 'creating' })],
      })
      .mockResolvedValueOnce({ Volumes: [makeVolume(fixture)] });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: expect.objectContaining({
        providerResourceId: VOLUME_IDS.application,
      }),
    });

    expect(waitForRetry).toHaveBeenCalledTimes(1);
    expect(waitForRetry).toHaveBeenCalledWith(1);
    expect(client.describeVolumes).toHaveBeenCalledTimes(2);
  });

  it('retries empty exact-ID reads as eventual consistency', async () => {
    const fixture = makeFixture();
    const { client, waitForRetry, resource } = makePorts(fixture, {
      maxAttempts: 2,
    });
    client.createVolume.mockResolvedValue({ VolumeId: VOLUME_IDS.application });
    client.describeVolumes
      .mockResolvedValueOnce({ Volumes: [] })
      .mockResolvedValueOnce({ Volumes: [makeVolume(fixture)] });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: expect.any(Object),
    });
    expect(waitForRetry).toHaveBeenCalledWith(1);
  });

  it('retries InvalidVolume.NotFound for an exact remembered ID', async () => {
    const fixture = makeFixture();
    const { client, waitForRetry, resource } = makePorts(fixture, {
      maxAttempts: 2,
    });
    client.createVolume.mockResolvedValue({ VolumeId: VOLUME_IDS.application });
    const absent = new Error('eventually visible');
    absent.name = 'InvalidVolume.NotFound';
    client.describeVolumes
      .mockRejectedValueOnce(absent)
      .mockResolvedValueOnce({ Volumes: [makeVolume(fixture)] });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: expect.any(Object),
    });
    expect(waitForRetry).toHaveBeenCalledWith(1);
  });

  it('allows bounded tag propagation only for an unbound create', async () => {
    const fixture = makeFixture();
    const { client, waitForRetry, resource } = makePorts(fixture, {
      maxAttempts: 2,
    });
    client.createVolume.mockResolvedValue({ VolumeId: VOLUME_IDS.application });
    client.describeVolumes
      .mockResolvedValueOnce({
        Volumes: [makeVolume(fixture, { Tags: undefined })],
      })
      .mockResolvedValueOnce({ Volumes: [makeVolume(fixture)] });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: expect.any(Object),
    });
    expect(waitForRetry).toHaveBeenCalledWith(1);
  });

  it('returns not-converged after bounded creating evidence is exhausted', async () => {
    const fixture = makeFixture();
    const { client, waitForRetry, resource } = makePorts(fixture, {
      maxAttempts: 3,
    });
    client.createVolume.mockResolvedValue({ VolumeId: VOLUME_IDS.application });
    client.describeVolumes.mockResolvedValue({
      Volumes: [makeVolume(fixture, { State: 'creating' })],
    });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'not-converged',
    });
    expect(client.describeVolumes).toHaveBeenCalledTimes(3);
    expect(waitForRetry.mock.calls).toEqual([[1], [2]]);
  });

  it('maps a retry waiter failure to fixed unknown state', async () => {
    const fixture = makeFixture();
    const waitForRetry = jest.fn(async () => {
      throw new Error('timer secret');
    });
    const { client, resource } = makePorts(fixture, {
      maxAttempts: 2,
      waitForRetry,
    });
    client.createVolume.mockResolvedValue({ VolumeId: VOLUME_IDS.application });
    client.describeVolumes.mockResolvedValue({ Volumes: [] });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).rejects.toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeVolumeResourceUnknownError',
        message: 'AWS single-node volume resource state is unknown.',
      }),
    );
  });
});

describe('AWS single-node retained EBS volume contradictory evidence', () => {
  it('blocks definite size drift before treating creating lifecycle as transient', async () => {
    const fixture = makeFixture();
    const { client, waitForRetry, resource } = makePorts(fixture, {
      maxAttempts: 3,
    });
    client.createVolume.mockResolvedValue({ VolumeId: VOLUME_IDS.application });
    const volume = makeVolume(fixture);
    client.describeVolumes.mockResolvedValue({
      Volumes: [
        {
          ...volume,
          Size: volume.Size + 1,
          State: 'creating',
        },
      ],
    });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.describeVolumes).toHaveBeenCalledTimes(1);
    expect(waitForRetry).not.toHaveBeenCalled();
  });

  it('blocks definite size drift before treating incomplete create ownership tags as propagation', async () => {
    const fixture = makeFixture();
    const { client, waitForRetry, resource } = makePorts(fixture, {
      maxAttempts: 3,
    });
    client.createVolume.mockResolvedValue({ VolumeId: VOLUME_IDS.application });
    const volume = makeVolume(fixture);
    const incompleteTags = volume.Tags.filter(
      (/** @type {VolumeTag} */ tag) => tag.Key !== 'wharfie:ownership-nonce',
    );
    client.describeVolumes.mockResolvedValue({
      Volumes: [
        {
          ...volume,
          Size: volume.Size + 1,
          Tags: incompleteTags,
        },
      ],
    });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
    expect(client.describeVolumes).toHaveBeenCalledTimes(1);
    expect(waitForRetry).not.toHaveBeenCalled();
  });

  it.each(
    /** @type {Array<[string, (volume: AnyRecord) => AnyRecord]>} */ ([
      [
        'availability-zone identity',
        (volume) => ({ ...volume, AvailabilityZoneId: 'use1-az2' }),
      ],
      [
        'availability-zone name region',
        (volume) => ({ ...volume, AvailabilityZone: 'us-west-2a' }),
      ],
      [
        'KMS key identity',
        (volume) => ({
          ...volume,
          KmsKeyId:
            'arn:aws:kms:us-east-1:123456789012:key/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        }),
      ],
      ['volume type', (volume) => ({ ...volume, VolumeType: 'io2' })],
      ['size', (volume) => ({ ...volume, Size: volume.Size + 1 })],
      ['IOPS', (volume) => ({ ...volume, Iops: volume.Iops + 1 })],
      [
        'throughput',
        (volume) => ({ ...volume, Throughput: volume.Throughput + 1 }),
      ],
      ['multi-attach', (volume) => ({ ...volume, MultiAttachEnabled: true })],
      ['encryption', (volume) => ({ ...volume, Encrypted: false })],
      [
        'snapshot lineage',
        (volume) => ({ ...volume, SnapshotId: 'snap-1234' }),
      ],
      [
        'source-volume lineage',
        (volume) => ({ ...volume, SourceVolumeId: VOLUME_IDS.duplicate }),
      ],
      ['outpost placement', (volume) => ({ ...volume, OutpostArn: 'arn:x' })],
      ['fast restore', (volume) => ({ ...volume, FastRestored: true })],
      [
        'initialization rate',
        (volume) => ({ ...volume, VolumeInitializationRate: 100 }),
      ],
      ['server-side mode', (volume) => ({ ...volume, SseType: 'sse-ebs' })],
      [
        'terminal deleting state',
        (volume) => ({ ...volume, State: 'deleting' }),
      ],
      ['terminal error state', (volume) => ({ ...volume, State: 'error' })],
      ['unknown state', (volume) => ({ ...volume, State: 'mystery' })],
      [
        'AWS-managed operator',
        (volume) => ({
          ...volume,
          Operator: { Managed: true, Principal: 'secret-principal' },
        }),
      ],
    ]),
  )('blocks valid but contradictory %s evidence', async (_label, mutate) => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.createVolume.mockResolvedValue({ VolumeId: VOLUME_IDS.application });
    client.describeVolumes.mockResolvedValue({
      Volumes: [mutate(makeVolume(fixture))],
    });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it.each(
    /** @type {Array<[string, (tags: VolumeTag[]) => VolumeTag[]]>} */ ([
      [
        'ownership nonce',
        (tags) =>
          tags.map((tag) =>
            tag.Key === 'wharfie:ownership-nonce'
              ? { ...tag, Value: nonce(88) }
              : tag,
          ),
      ],
      [
        'state digest',
        (tags) =>
          tags.map((tag) =>
            tag.Key === 'wharfie:state-digest'
              ? { ...tag, Value: digest('tampered').value }
              : tag,
          ),
      ],
      [
        'creation action',
        (tags) =>
          tags.map((tag) =>
            tag.Key === 'wharfie:created-by-action-id'
              ? {
                  ...tag,
                  Value: semanticId(
                    'wda3',
                    'wharfie:test:tampered-create-action:v1',
                    {},
                  ),
                }
              : tag,
          ),
      ],
      [
        'extra reserved key',
        (tags) => [...tags, { Key: 'wharfie:unexpected', Value: 'value' }],
      ],
      ['duplicate reserved key', (tags) => [...tags, { ...tags[0] }]],
    ]),
  )('blocks tampered %s tags', async (_label, mutateTags) => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.createVolume.mockResolvedValue({ VolumeId: VOLUME_IDS.application });
    const volume = makeVolume(fixture);
    client.describeVolumes.mockResolvedValue({
      Volumes: [{ ...volume, Tags: mutateTags(volume.Tags) }],
    });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it('permits unrelated non-reserved provider tags', async () => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.createVolume.mockResolvedValue({ VolumeId: VOLUME_IDS.application });
    const volume = makeVolume(fixture);
    client.describeVolumes.mockResolvedValue({
      Volumes: [
        {
          ...volume,
          Tags: [...volume.Tags, { Key: 'owner', Value: 'user' }],
        },
      ],
    });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: expect.any(Object),
    });
  });

  it('blocks an exact-ID response that identifies another valid volume', async () => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.createVolume.mockResolvedValue({ VolumeId: VOLUME_IDS.application });
    client.describeVolumes.mockResolvedValue({
      Volumes: [makeVolume(fixture, { VolumeId: VOLUME_IDS.duplicate })],
    });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });
});

describe('AWS single-node retained EBS volume unknown provider state', () => {
  it.each(
    /** @type {Array<[string, (volume: AnyRecord) => void]>} */ ([
      [
        'missing AvailabilityZoneId',
        (volume) => delete volume.AvailabilityZoneId,
      ],
      [
        'string Size',
        (volume) => {
          volume.Size = '8';
        },
      ],
      [
        'missing State',
        (volume) => {
          delete volume.State;
        },
      ],
      [
        'invalid CreateTime',
        (volume) => {
          volume.CreateTime = 'secret-time';
        },
      ],
      [
        'malformed Tags',
        (volume) => {
          volume.Tags = 'secret-tags';
        },
      ],
    ]),
  )('maps %s to typed non-echoing unknown state', async (_label, mutate) => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.createVolume.mockResolvedValue({ VolumeId: VOLUME_IDS.application });
    const volume = makeVolume(fixture);
    mutate(volume);
    client.describeVolumes.mockResolvedValue({ Volumes: [volume] });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).rejects.toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeVolumeResourceUnknownError',
        code: 'AWS_SINGLE_NODE_VOLUME_RESOURCE_UNKNOWN',
        message: 'AWS single-node volume resource state is unknown.',
      }),
    );
  });

  it.each([
    null,
    {},
    { Volumes: 'provider-secret' },
    { Volumes: [null] },
    { Volumes: [{ VolumeId: 'invalid-provider-secret' }] },
  ])('rejects malformed DescribeVolumes envelope %#', async (response) => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.describeVolumes.mockResolvedValue(response);

    await expect(resource.verifySettlement(fixture.context)).rejects.toEqual(
      expect.any(AwsSingleNodeVolumeResourceUnknownError),
    );
  });

  it('bounds access failures and never echoes provider details', async () => {
    const fixture = makeFixture();
    const { client, waitForRetry, resource } = makePorts(fixture, {
      maxAttempts: 2,
    });
    client.createVolume.mockResolvedValue({ VolumeId: VOLUME_IDS.application });
    const denied = new Error(
      'AccessDenied for arn:aws:iam::123456789012:user/provider-secret',
    );
    denied.name = 'UnauthorizedOperation';
    client.describeVolumes.mockRejectedValue(denied);

    await resource.executeAction(fixture.context);
    /** @type {any} */
    let observed;
    try {
      await resource.verifySettlement(fixture.context);
    } catch (error) {
      observed = error;
    }
    expect(observed).toEqual(
      expect.objectContaining({
        name: 'AwsSingleNodeVolumeResourceUnknownError',
        code: 'AWS_SINGLE_NODE_VOLUME_RESOURCE_UNKNOWN',
        message: 'AWS single-node volume resource state is unknown.',
      }),
    );
    expect(observed.message).not.toMatch(/AccessDenied|provider-secret/u);
    expect(client.describeVolumes).toHaveBeenCalledTimes(2);
    expect(waitForRetry).toHaveBeenCalledWith(1);
  });
});

describe('AWS single-node retained EBS volume graph independence', () => {
  it.each(
    /** @type {Array<[string, (volume: AnyRecord) => AnyRecord]>} */ ([
      [
        'omitted attachment evidence while in use',
        (volume) => {
          /** @type {AnyRecord} */
          const result = { ...volume, State: 'in-use' };
          delete result.Attachments;
          return result;
        },
      ],
      [
        'malformed attachment evidence while available',
        (volume) => ({ ...volume, Attachments: { provider: 'opaque' } }),
      ],
      [
        'attachment evidence that must not be read',
        (volume) => {
          Object.defineProperty(volume, 'Attachments', {
            configurable: true,
            enumerable: true,
            get() {
              throw new Error('attachment evidence was read');
            },
          });
          return volume;
        },
      ],
      [
        'contradictory downstream attachment evidence while in use',
        (volume) => ({
          ...volume,
          State: 'in-use',
          Attachments: [
            {
              VolumeId: VOLUME_IDS.duplicate,
              InstanceId: 'not-an-instance-id',
              Device: '/dev/contradictory',
              State: 'detaching',
              DeleteOnTermination: true,
              AttachTime: 'not-a-date',
            },
          ],
        }),
      ],
    ]),
  )(
    'settles an unbound create from intrinsic volume evidence with %s',
    async (_label, mutate) => {
      const fixture = makeFixture();
      const { client, waitForRetry, resource } = makePorts(fixture, {
        maxAttempts: 2,
      });
      client.createVolume.mockResolvedValue({
        VolumeId: VOLUME_IDS.application,
      });
      client.describeVolumes.mockResolvedValue({
        Volumes: [mutate(makeVolume(fixture))],
      });

      await resource.executeAction(fixture.context);
      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'converged',
          binding: expect.objectContaining({
            resourceKey: fixture.action.resourceKey,
            providerResourceId: VOLUME_IDS.application,
          }),
        },
      );
      expect(client.describeVolumes).toHaveBeenCalledTimes(1);
      expect(waitForRetry).not.toHaveBeenCalled();
    },
  );

  it('recovers a missing-volume reconcile create after response loss without reading attachment state', async () => {
    const fixture = makeFixture({
      operation: 'reconcile',
      planOptions: {
        actionOverride(
          /** @type {AnyRecord} */ action,
          /** @type {Readonly<AnyRecord>} */ resource,
        ) {
          if (resource.resourceKey !== 'application-state') return action;
          return {
            ...action,
            action: 'create',
            reason: 'missing',
            before: null,
            after: { ...action.after, providerResourceId: null },
          };
        },
      },
    });
    const { client, waitForRetry, resource } = makePorts(fixture, {
      maxAttempts: 2,
    });
    client.createVolume.mockRejectedValue(
      new Error('ambiguous CreateVolume response'),
    );
    client.describeVolumes.mockResolvedValue({
      Volumes: [
        makeVolume(fixture, {
          State: 'in-use',
          Attachments: { lifecycle: 'owned-by-attachment-resource' },
        }),
      ],
    });

    expect(fixture.action).toMatchObject({
      resourceKey: 'application-state',
      action: 'create',
      before: null,
      role: { kind: 'volume', version: 1 },
      ownershipMode: 'direct',
      onDestroy: 'retain',
      dependsOn: [],
    });
    expect(fixture.head.activeOperation.kind).toBe('reconcile');
    expect(fixture.priorBinding).toBeNull();
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVolumeResourceUnknownError);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: expect.objectContaining({
        schemaVersion: 2,
        resourceKey: fixture.action.resourceKey,
        role: fixture.action.role,
        ownershipMode: 'direct',
        onDestroy: 'retain',
        dependencyBindings: [],
        providerResourceId: VOLUME_IDS.application,
        ownershipNonce: fixture.ownershipNonce,
        createdByActionId: fixture.action.actionId,
      }),
    });

    expect(client.createVolume).toHaveBeenCalledTimes(1);
    expect(client.describeVolumes).toHaveBeenCalledTimes(1);
    const request = client.describeVolumes.mock.calls[0][0];
    expect(request).toEqual(
      expect.objectContaining({ Filters: expect.any(Array), MaxResults: 500 }),
    );
    expect(request).not.toHaveProperty('VolumeIds');
    expect(waitForRetry).not.toHaveBeenCalled();
  });

  it.each(
    /** @type {Array<[string, Parameters<typeof makeFixture>[0], (volume: AnyRecord) => AnyRecord]>} */ ([
      [
        'reconcile before a node binding exists',
        { operation: 'reconcile' },
        (volume) => ({
          ...volume,
          State: 'in-use',
          Attachments: { lifecycle: 'owned-by-attachment-resource' },
        }),
      ],
      [
        'reconcile while a node binding exists',
        { operation: 'reconcile', withNode: true },
        (volume) => ({
          ...volume,
          State: 'in-use',
          Attachments: [
            {
              VolumeId: VOLUME_IDS.duplicate,
              InstanceId: 'i-00000000000000002',
              Device: '/dev/wrong',
              State: 'busy',
            },
          ],
        }),
      ],
      [
        'retained destroy after the node binding is removed',
        { operation: 'destroy' },
        (volume) => ({
          ...volume,
          State: 'in-use',
          Attachments: [{ State: 'detaching' }],
        }),
      ],
    ]),
  )(
    'settles %s without reading downstream state',
    async (_label, options, mutate) => {
      const fixture = makeFixture(options);
      const priorBinding = requireBinding(
        fixture.priorBinding,
        'prior binding',
      );
      const { client, waitForRetry, resource } = makePorts(fixture, {
        maxAttempts: 2,
      });
      client.describeVolumes.mockResolvedValue({
        Volumes: [mutate(makeVolume(fixture))],
      });

      await expect(resource.executeAction(fixture.context)).resolves.toBe(
        undefined,
      );
      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'converged',
          binding: priorBinding,
        },
      );
      expect(client.createVolume).not.toHaveBeenCalled();
      expect(client.describeVolumes).toHaveBeenCalledTimes(1);
      expect(waitForRetry).not.toHaveBeenCalled();
    },
  );
});

describe('AWS single-node retained EBS volume noop settlement', () => {
  it('reads the retained binding by exact ID and preserves its original creation receipt', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const priorBinding = requireBinding(fixture.priorBinding, 'prior binding');
    const { client, resource } = makePorts(fixture);
    const volume = makeVolume(fixture);
    client.describeVolumes.mockResolvedValue({ Volumes: [volume] });

    await expect(resource.executeAction(fixture.context)).resolves.toBe(
      undefined,
    );
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: priorBinding,
    });

    expect(client.createVolume).not.toHaveBeenCalled();
    expect(client.describeVolumes).toHaveBeenCalledWith({
      VolumeIds: [priorBinding.providerResourceId],
    });
    expectDeepFrozen(client.describeVolumes.mock.calls[0][0]);
    expect(volume.Tags).toContainEqual({
      Key: 'wharfie:created-by-action-id',
      Value: priorBinding.createdByActionId,
    });
    expect(volume.Tags).not.toContainEqual({
      Key: 'wharfie:created-by-action-id',
      Value: fixture.action.actionId,
    });
  });

  it('settles a retained destroy noop without mutating or replacing it', async () => {
    const fixture = makeFixture({ operation: 'destroy' });
    const priorBinding = requireBinding(fixture.priorBinding, 'prior binding');
    const { client, resource } = makePorts(fixture);
    client.describeVolumes.mockResolvedValue({
      Volumes: [makeVolume(fixture)],
    });

    await resource.executeAction(fixture.context);
    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'converged',
      binding: priorBinding,
    });
    expect(client.createVolume).not.toHaveBeenCalled();
    expect(client.describeVolumes).toHaveBeenCalledWith({
      VolumeIds: [priorBinding.providerResourceId],
    });
  });

  it('blocks missing immutable tags after a binding already exists', async () => {
    const fixture = makeFixture({ operation: 'reconcile' });
    const { client, resource } = makePorts(fixture);
    const volume = makeVolume(fixture);
    client.describeVolumes.mockResolvedValue({
      Volumes: [{ ...volume, Tags: volume.Tags.slice(1) }],
    });

    await expect(resource.verifySettlement(fixture.context)).resolves.toEqual({
      status: 'blocked',
    });
  });

  it.each([
    { Volumes: [] },
    (() => {
      const error = new Error('missing retained volume');
      error.name = 'InvalidVolume.NotFound';
      return error;
    })(),
  ])(
    'blocks a missing retained binding after bounded reads %#',
    async (result) => {
      const fixture = makeFixture({ operation: 'reconcile' });
      const { client, resource } = makePorts(fixture);
      if (result instanceof Error)
        client.describeVolumes.mockRejectedValue(result);
      else client.describeVolumes.mockResolvedValue(result);

      await expect(resource.verifySettlement(fixture.context)).resolves.toEqual(
        {
          status: 'blocked',
        },
      );
    },
  );
});

describe('AWS single-node retained EBS volume factory boundary', () => {
  it('returns only frozen controller ports and does not assume client ownership', () => {
    const fixture = makeFixture();
    const client = {
      createVolume: jest.fn(),
      describeVolumes: jest.fn(),
      close: jest.fn(),
    };
    const resource = createAwsSingleNodeVolumeResource({
      client,
      providerScope: fixture.base.providerScope,
      maxAttempts: 1,
      waitForRetry: jest.fn(),
    });

    expect(resource).toEqual({
      executeAction: expect.any(Function),
      verifySettlement: expect.any(Function),
    });
    expect(Object.isFrozen(resource)).toBe(true);
    expect(client.close).not.toHaveBeenCalled();
  });

  it.each([
    ['null options', null],
    ['array options', []],
    ['missing client', {}],
  ])('rejects %s', (_label, options) => {
    expect(() => createAwsSingleNodeVolumeResource(options)).toThrow(TypeError);
  });

  it('rejects unsupported factory keys', () => {
    const fixture = makeFixture();
    expect(() =>
      createAwsSingleNodeVolumeResource({
        client: {
          createVolume: jest.fn(),
          describeVolumes: jest.fn(),
        },
        providerScope: fixture.base.providerScope,
        secretOption: 'must-not-be-accepted',
      }),
    ).toThrow('secretOption is not supported');
  });

  it.each([
    [{ describeVolumes: jest.fn() }, 'createVolume'],
    [{ createVolume: jest.fn() }, 'describeVolumes'],
  ])('requires a narrow client %s method', (client, method) => {
    const fixture = makeFixture();
    expect(() =>
      createAwsSingleNodeVolumeResource({
        client,
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(`client.${method} is required`);
  });

  it.each([0, 1.5, 11, Number.NaN])(
    'rejects unsafe maxAttempts value %p',
    (maxAttempts) => {
      const fixture = makeFixture();
      expect(() =>
        createAwsSingleNodeVolumeResource({
          client: {
            createVolume: jest.fn(),
            describeVolumes: jest.fn(),
          },
          providerScope: fixture.base.providerScope,
          maxAttempts,
        }),
      ).toThrow('maxAttempts must be an integer');
    },
  );

  it('rejects a non-function retry port and malformed provider scope', () => {
    const fixture = makeFixture();
    const client = {
      createVolume: jest.fn(),
      describeVolumes: jest.fn(),
    };
    expect(() =>
      createAwsSingleNodeVolumeResource({
        client,
        providerScope: fixture.base.providerScope,
        waitForRetry: 1,
      }),
    ).toThrow('waitForRetry must be a function');
    expect(() =>
      createAwsSingleNodeVolumeResource({ client, providerScope: {} }),
    ).toThrow();
  });
});

describe('AWS single-node retained EBS volume controller authority', () => {
  it.each(
    /** @type {Array<[string, (context: AnyRecord) => AnyRecord]>} */ ([
      ['extra key', (context) => ({ ...context, extra: true })],
      [
        'missing artifactStage',
        (context) => {
          const candidate = { ...context };
          delete candidate.artifactStage;
          return candidate;
        },
      ],
      ['wrong operation', (context) => ({ ...context, operation: 'destroy' })],
      [
        'wrong action',
        (context) => ({ ...context, action: context.plan.actions[2] }),
      ],
      ['wrong index', (context) => ({ ...context, actionIndex: 2 })],
      [
        'wrong ownership nonce',
        (context) => ({ ...context, ownershipNonce: nonce(87) }),
      ],
    ]),
  )(
    'rejects context with %s before any provider call',
    async (_label, change) => {
      const fixture = makeFixture();
      const { client, resource } = makePorts(fixture);
      client.createVolume.mockResolvedValue({
        VolumeId: VOLUME_IDS.application,
      });

      await expect(
        resource.executeAction(change(fixture.context)),
      ).rejects.toThrow();
      expect(client.createVolume).not.toHaveBeenCalled();
      expect(client.describeVolumes).not.toHaveBeenCalled();
    },
  );

  it('rejects a valid head from a different plan lineage as typed conflict', async () => {
    const fixture = makeFixture();
    const other = makeFixture({
      base: makeBase({ availabilityZoneId: 'use1-az2' }),
    });
    const { client, resource } = makePorts(fixture);

    await expect(
      resource.executeAction({ ...fixture.context, head: other.head }),
    ).rejects.toBeInstanceOf(AwsSingleNodeVolumeResourceConflictError);
    expect(client.createVolume).not.toHaveBeenCalled();
  });

  it('rejects a pending or blocked current operation before mutation', async () => {
    const fixture = makeFixture();
    const pendingHead = recreateHead(fixture, {
      intents: fixture.head.activeOperation.intents.map(
        (/** @type {AnyRecord} */ intent, /** @type {number} */ index) => ({
          actionId: intent.actionId,
          status: index === fixture.actionIndex ? 'pending' : intent.status,
          ownershipNonce: intent.ownershipNonce,
        }),
      ),
    });
    const blockedHead = recreateHead(fixture, { status: 'blocked' });
    const { client, resource } = makePorts(fixture);

    await expect(
      resource.executeAction({ ...fixture.context, head: pendingHead }),
    ).rejects.toBeInstanceOf(AwsSingleNodeVolumeResourceConflictError);
    await expect(
      resource.executeAction({ ...fixture.context, head: blockedHead }),
    ).rejects.toBeInstanceOf(AwsSingleNodeVolumeResourceConflictError);
    expect(client.createVolume).not.toHaveBeenCalled();
  });

  it('rejects reordered durable intents even when the head is independently valid', async () => {
    const fixture = makeFixture();
    const reordered = fixture.head.activeOperation.intents.map(
      (/** @type {AnyRecord} */ intent) => ({
        actionId: intent.actionId,
        status: intent.status,
        ownershipNonce: intent.ownershipNonce,
      }),
    );
    [reordered[2].actionId, reordered[3].actionId] = [
      reordered[3].actionId,
      reordered[2].actionId,
    ];
    const reorderedHead = recreateHead(fixture, { intents: reordered });
    const { client, resource } = makePorts(fixture);

    await expect(
      resource.executeAction({ ...fixture.context, head: reorderedHead }),
    ).rejects.toBeInstanceOf(AwsSingleNodeVolumeResourceConflictError);
    expect(client.createVolume).not.toHaveBeenCalled();
  });

  it('rejects a plan whose volume digest is not the deterministic provider state', async () => {
    const fixture = makeFixture({
      planOptions: { volumeDigestOverride: digest('incorrect desired state') },
    });
    const { client, resource } = makePorts(fixture);

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVolumeResourceConflictError);
    expect(client.createVolume).not.toHaveBeenCalled();
  });

  it('rejects unsupported volume update authority', async () => {
    const fixture = makeFixture({
      operation: 'reconcile',
      planOptions: {
        actionOverride(
          /** @type {AnyRecord} */ action,
          /** @type {Readonly<AnyRecord>} */ resource,
        ) {
          if (
            resource.capability.kind !== 'application-state' ||
            resource.role.kind !== 'volume'
          ) {
            return action;
          }
          return {
            ...action,
            action: 'update',
            reason: 'drift',
            before: {
              ...action.before,
              stateDigest: digest('prior volume state'),
            },
          };
        },
      },
    });
    const { client, resource } = makePorts(fixture);

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVolumeResourceConflictError);
    expect(client.createVolume).not.toHaveBeenCalled();
  });

  it('binds credentials to the configured provider scope', async () => {
    const fixture = makeFixture();
    const otherScope = createAwsProviderScope({
      partition: 'aws',
      accountId: '999999999999',
      region: 'us-east-1',
    });
    const client = {
      createVolume: jest.fn(),
      describeVolumes: jest.fn(),
    };
    const resource = createAwsSingleNodeVolumeResource({
      client,
      providerScope: otherScope,
      maxAttempts: 1,
      waitForRetry: jest.fn(),
    });

    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVolumeResourceConflictError);
    expect(client.createVolume).not.toHaveBeenCalled();
  });

  it('rejects changed successful IDs for the same idempotent action', async () => {
    const fixture = makeFixture();
    const { client, resource } = makePorts(fixture);
    client.createVolume
      .mockResolvedValueOnce({ VolumeId: VOLUME_IDS.application })
      .mockResolvedValueOnce({ VolumeId: VOLUME_IDS.duplicate });

    await resource.executeAction(fixture.context);
    await expect(
      resource.executeAction(fixture.context),
    ).rejects.toBeInstanceOf(AwsSingleNodeVolumeResourceConflictError);
  });
});
