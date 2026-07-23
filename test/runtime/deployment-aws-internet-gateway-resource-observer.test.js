import { describe, expect, it, jest } from '@jest/globals';

import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import {
  createAwsSingleNodeInternetGatewayEvidenceKernel,
  createAwsSingleNodeInternetGatewayStateDigest,
} from '../../src/core/runtime/deployment-aws-internet-gateway-evidence.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  AwsSingleNodeInternetGatewayResourceObserverAuthorityError,
  createAwsSingleNodeInternetGatewayResourceObserver,
} from '../../src/core/runtime/deployment-aws-internet-gateway-resource-observer.js';
import { createAwsSingleNodeResourceObservationAuthority } from '../../src/core/runtime/deployment-aws-resource-observation-authority.js';
import { getAwsSingleNodeManagedArtifactObjectLocation } from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
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
  internetGateway: 'igw-00000000000000001',
  otherInternetGateway: 'igw-00000000000000002',
  vpc: 'vpc-00000000000000001',
  application: 'vol-00000000000000001',
  control: 'vol-00000000000000002',
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

/**
 * @param {{accountId?: string, incarnationByte?: number}} [options]
 * @returns {Readonly<AnyRecord>}
 */
function makeBase(options = {}) {
  const accountId = options.accountId ?? '123456789012';
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'internet-gateway-resource-observer-test',
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
      'wharfie:test:internet-gateway-resource-observer-revision:v1',
      { appId: profile.appId },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'internet gateway observer artifact',
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
    incarnationId: createDeploymentIncarnationId(
      Buffer.alloc(32, options.incarnationByte ?? 77),
    ),
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
          'wharfie:test:internet-gateway-resource-observer-inspection:v1',
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

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>} action */
function prefixProviderResourceId(base, action) {
  if (action.resourceKey === 'artifact') {
    return getAwsSingleNodeManagedArtifactObjectLocation({
      providerScope: base.providerScope,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
    }).arn;
  }
  if (action.resourceKey === 'application-state') return IDS.application;
  if (action.resourceKey === 'control-state') return IDS.control;
  if (action.resourceKey === 'network-vpc') return IDS.vpc;
  if (action.resourceKey === 'network-internet-gateway') {
    return IDS.internetGateway;
  }
  throw new Error(`Unsupported prefix binding '${action.resourceKey}'.`);
}

/**
 * @param {Readonly<AnyRecord>} base
 * @param {Readonly<AnyRecord>} plan
 * @param {ReadonlyArray<Readonly<AnyRecord>>} intents
 * @param {number} frontier
 */
function makePrefixBindings(base, plan, intents, frontier) {
  return plan.actions
    .slice(0, frontier)
    .map(
      (
        /** @type {Readonly<AnyRecord>} */ action,
        /** @type {number} */ index,
      ) =>
        createDeploymentResourceBinding({
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
          dependencyBindings: [],
          providerType: action.after.providerType,
          providerResourceId: prefixProviderResourceId(base, action),
          providerScopeId: base.providerScope.providerScopeId,
          ownershipNonce: intents[index].ownershipNonce,
          createdByActionId: action.actionId,
        }),
    );
}

/**
 * @param {{mode?: 'bound'|'current-create'|'unbound', base?: Readonly<AnyRecord>}} [options]
 */
function makeAuthorityFixture(options = {}) {
  const mode = options.mode ?? 'bound';
  const base = options.base ?? makeBase();
  const plan = makeCreatePlan(base);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'network-internet-gateway',
  );
  const action = plan.actions[actionIndex];
  if (action === undefined) throw new Error('Missing internet gateway action.');
  const frontier = mode === 'bound' ? actionIndex + 1 : actionIndex;
  const currentStatus = mode === 'current-create' ? 'intended' : 'pending';
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
            ? currentStatus
            : 'pending',
      ownershipNonce: nonce(100 + index),
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
      (currentStatus === 'intended' && frontier < plan.actions.length ? 1 : 0),
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
  const target = targetFor(makeTargets(base, head), 'network-internet-gateway');
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

const tagEvidence = createAwsSingleNodeInternetGatewayEvidenceKernel({
  readDiscoveryPage: async () => ({ records: [], nextToken: null }),
  readExact: async () => null,
});

/** @param {Readonly<AnyRecord>} fixture */
function fixtureLocator(fixture) {
  return {
    capabilityKind: fixture.target.capability.kind,
    roleKind: fixture.target.role.kind,
    providerScopeId: fixture.base.providerScope.providerScopeId,
    deploymentInstanceId: fixture.base.deploymentInstanceId,
    incarnationId: fixture.base.incarnationId,
    resourceKey: fixture.target.resourceKey,
  };
}

/** @param {Readonly<AnyRecord>} fixture */
function fixtureOwnershipTags(fixture) {
  if (fixture.authority.binding !== null) {
    return tagEvidence.ownershipTags({
      ...fixtureLocator(fixture),
      createdByActionId: fixture.authority.binding.createdByActionId,
      ownershipNonce: fixture.authority.binding.ownershipNonce,
      stateDigestValue: fixture.action.after.stateDigest.value,
    });
  }
  const currentAction = fixture.authority.currentAction;
  if (currentAction === null) {
    throw new Error('Fixture has no ownership receipt.');
  }
  return tagEvidence.ownershipTags({
    ...fixtureLocator(fixture),
    createdByActionId: currentAction.action.actionId,
    ownershipNonce: currentAction.ownershipNonce,
    stateDigestValue: currentAction.action.after.stateDigest.value,
  });
}

/**
 * @param {Readonly<AnyRecord>} fixture
 * @param {{id?: string, ownerId?: string, tags?: Readonly<Record<string, string>>, tagList?: ReadonlyArray<Readonly<AnyRecord>>, attachments?: unknown}} [options]
 */
function gateway(fixture, options = {}) {
  const tags =
    options.tagList ??
    tagEvidence.sortedTags(
      options.tags ??
        (fixture.mode === 'unbound'
          ? tagEvidence.locatorTags(fixtureLocator(fixture))
          : fixtureOwnershipTags(fixture)),
    );
  return {
    InternetGatewayId: options.id ?? IDS.internetGateway,
    OwnerId: options.ownerId ?? fixture.base.providerScope.accountId,
    Tags: tags,
    Attachments: options.attachments ?? [],
  };
}

/** @param {(request: Readonly<AnyRecord>, callIndex: number) => unknown|Promise<unknown>} handler */
function scriptedClient(handler) {
  let callIndex = 0;
  return {
    describeInternetGateways: jest.fn(async (request) => {
      callIndex += 1;
      return handler(/** @type {Readonly<AnyRecord>} */ (request), callIndex);
    }),
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} client @param {Readonly<AnyRecord>} [options] */
function observerFor(fixture, client, options = {}) {
  return createAwsSingleNodeInternetGatewayResourceObserver({
    client,
    providerScope: fixture.base.providerScope,
    maxAttempts: options.maxAttempts ?? 1,
    waitForRetry: options.waitForRetry ?? (async () => {}),
  });
}

/** @param {Readonly<AnyRecord>} request */
function isDiscovery(request) {
  return Object.hasOwn(request, 'Filters');
}

describe('AWS single-node internet-gateway resource observer', () => {
  it('constructs without I/O and requires the exact narrow client port', () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient(() => {
      throw new Error('constructor performed I/O');
    });
    const observer = observerFor(fixture, client);

    expect(Object.keys(observer)).toEqual(['observe']);
    expect(Object.isFrozen(observer)).toBe(true);
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
    expect(() =>
      createAwsSingleNodeInternetGatewayResourceObserver({
        client: {
          describeInternetGateways: async () => ({}),
          createInternetGateway: async () => ({}),
        },
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(/createInternetGateway is not supported/);
  });

  it('verifies bound identity, historical receipt tags, and intrinsic state by exact ID only', async () => {
    const fixture = makeAuthorityFixture();
    const record = gateway(fixture, {
      attachments: [{ malformed: 'graph-owned attachment is ignored' }],
    });
    const client = scriptedClient((request) =>
      isDiscovery(request)
        ? { InternetGateways: [clone(record)] }
        : { InternetGateways: [clone(record)] },
    );

    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual({
      resourceKey: 'network-internet-gateway',
      presence: 'present',
      ownership: 'verified',
      providerIdentity: {
        providerType: 'ec2-internet-gateway',
        providerResourceId: IDS.internetGateway,
      },
      observedDigest: createAwsSingleNodeInternetGatewayStateDigest(),
      health: 'not-applicable',
      execution: 'none',
    });
    expectDeepFrozen(observation);
    expect(client.describeInternetGateways).toHaveBeenCalledTimes(1);
    for (const [request] of client.describeInternetGateways.mock.calls) {
      expectDeepFrozen(request);
    }
    expect(client.describeInternetGateways.mock.calls[0][0]).toEqual({
      InternetGatewayIds: [IDS.internetGateway],
    });
  });

  it('keeps a bound typed exact NotFound unknown after bounded retries', async () => {
    const fixture = makeAuthorityFixture();
    const waits = /** @type {number[]} */ ([]);
    const client = scriptedClient((request) => {
      const error = new Error('not found');
      error.name = 'InvalidInternetGatewayID.NotFound';
      throw error;
    });

    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
      waitForRetry: async (/** @type {number} */ attempt) =>
        waits.push(attempt),
    }).observe(fixture.authority);

    expect(observation).toEqual({
      resourceKey: 'network-internet-gateway',
      presence: 'unknown',
      ownership: 'unknown',
      providerIdentity: null,
      observedDigest: null,
      health: 'unknown',
      execution: 'none',
    });
    expect(client.describeInternetGateways).toHaveBeenCalledTimes(2);
    expect(
      client.describeInternetGateways.mock.calls.every(
        ([request]) =>
          !isDiscovery(/** @type {Readonly<AnyRecord>} */ (request)),
      ),
    ).toBe(true);
    expect(waits).toEqual([1]);
  });

  it('treats a successful empty exact envelope as unknown, never as absence', async () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient(() => ({ InternetGateways: [] }));

    await expect(
      observerFor(fixture, client, { maxAttempts: 2 }).observe(
        fixture.authority,
      ),
    ).resolves.toMatchObject({
      presence: 'unknown',
      ownership: 'unknown',
      execution: 'none',
    });
  });

  it('does not search for a replacement when a durable binding is missing', async () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient((request) => {
      if (isDiscovery(request)) {
        throw new Error('bound observation must not run locator discovery');
      }
      const error = new Error('not found');
      error.name = 'InvalidInternetGatewayID.NotFound';
      throw error;
    });

    await expect(
      observerFor(fixture, client, { maxAttempts: 2 }).observe(
        fixture.authority,
      ),
    ).resolves.toMatchObject({ presence: 'unknown', execution: 'none' });
    expect(
      client.describeInternetGateways.mock.calls.every(
        ([request]) =>
          !isDiscovery(/** @type {Readonly<AnyRecord>} */ (request)),
      ),
    ).toBe(true);
  });

  it.each([
    ['wrong owner', { ownerId: '210987654321' }],
    [
      'wrong receipt',
      {
        tags: {
          ...fixtureOwnershipTags(makeAuthorityFixture()),
          'wharfie:ownership-nonce': nonce(17),
        },
      },
    ],
  ])(
    'reports bound %s as a present ownership conflict',
    async (_name, edit) => {
      const fixture = makeAuthorityFixture();
      const record = gateway(fixture, edit);
      const client = scriptedClient(() => ({
        InternetGateways: [clone(record)],
      }));

      await expect(
        observerFor(fixture, client).observe(fixture.authority),
      ).resolves.toEqual({
        resourceKey: 'network-internet-gateway',
        presence: 'present',
        ownership: 'conflict',
        providerIdentity: {
          providerType: 'ec2-internet-gateway',
          providerResourceId: IDS.internetGateway,
        },
        observedDigest: null,
        health: 'not-applicable',
        execution: 'none',
      });
    },
  );

  it('verifies a current create only from current receipt evidence and exact corroboration', async () => {
    const fixture = makeAuthorityFixture({ mode: 'current-create' });
    const record = gateway(fixture);
    const client = scriptedClient(() => ({
      InternetGateways: [clone(record)],
    }));

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'verified',
      providerIdentity: {
        providerResourceId: IDS.internetGateway,
      },
      execution: 'none',
    });
  });

  it('never exposes replay-safe execution for a current internet-gateway create', async () => {
    const fixture = makeAuthorityFixture({ mode: 'current-create' });
    const client = scriptedClient(() => ({ InternetGateways: [] }));

    await expect(
      observerFor(fixture, client, { maxAttempts: 2 }).observe(
        fixture.authority,
      ),
    ).resolves.toEqual({
      resourceKey: 'network-internet-gateway',
      presence: 'unknown',
      ownership: 'unknown',
      providerIdentity: null,
      observedDigest: null,
      health: 'unknown',
      execution: 'none',
    });
  });

  it('retries incomplete current-create tag propagation before verifying', async () => {
    const fixture = makeAuthorityFixture({ mode: 'current-create' });
    const complete = gateway(fixture);
    const incomplete = gateway(fixture, {
      tagList: complete.Tags.filter(
        (/** @type {Readonly<AnyRecord>} */ tag) =>
          tag.Key !== 'wharfie:state-digest',
      ),
    });
    let attempt = 0;
    const waits = /** @type {number[]} */ ([]);
    const client = scriptedClient((request) => {
      if (isDiscovery(request)) attempt += 1;
      const record = attempt === 1 ? incomplete : complete;
      return { InternetGateways: [clone(record)] };
    });

    await expect(
      observerFor(fixture, client, {
        maxAttempts: 2,
        waitForRetry: async (/** @type {number} */ value) => waits.push(value),
      }).observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'verified',
      execution: 'none',
    });
    expect(waits).toEqual([1]);
  });

  it('proves clean unbound logical emptiness as absent', async () => {
    const fixture = makeAuthorityFixture({ mode: 'unbound' });
    const client = scriptedClient(() => ({ InternetGateways: [] }));

    await expect(
      observerFor(fixture, client, { maxAttempts: 2 }).observe(
        fixture.authority,
      ),
    ).resolves.toMatchObject({
      presence: 'absent',
      ownership: 'missing',
      execution: 'none',
    });
    expect(client.describeInternetGateways).toHaveBeenCalledTimes(2);
  });

  it('reports a corroborated unbound locator collision without adopting it', async () => {
    const fixture = makeAuthorityFixture({ mode: 'unbound' });
    const record = gateway(fixture, {
      tags: {
        ...tagEvidence.locatorTags(fixtureLocator(fixture)),
        'wharfie:created-by-action-id':
          'wda1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'wharfie:ownership-nonce': nonce(11),
        'wharfie:state-digest':
          createAwsSingleNodeInternetGatewayStateDigest().value,
      },
    });
    const client = scriptedClient(() => ({
      InternetGateways: [clone(record)],
    }));

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      providerIdentity: {
        providerResourceId: IDS.internetGateway,
      },
      observedDigest: null,
      execution: 'none',
    });
  });

  it('keeps malformed or ambiguous unbound discovery conservative', async () => {
    const fixture = makeAuthorityFixture({ mode: 'unbound' });
    const incomplete = gateway(fixture, {
      tagList: tagEvidence
        .sortedTags(tagEvidence.locatorTags(fixtureLocator(fixture)))
        .filter(
          (/** @type {Readonly<AnyRecord>} */ tag) =>
            tag.Key !== 'wharfie:resource-key',
        ),
    });
    const second = gateway(fixture, {
      id: IDS.otherInternetGateway,
    });
    const cases = [[incomplete], [gateway(fixture), second]];
    for (const records of cases) {
      const client = scriptedClient(() => ({
        InternetGateways: clone(records),
      }));
      await expect(
        observerFor(fixture, client).observe(fixture.authority),
      ).resolves.toMatchObject({
        presence: 'unknown',
        ownership: 'unknown',
        execution: 'none',
      });
    }
  });

  it('rejects forged authority and a mismatched constructor scope before I/O', async () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient(() => ({ InternetGateways: [] }));
    const forged = {
      ...fixture.authority,
      binding: {
        ...fixture.authority.binding,
        providerResourceId: IDS.otherInternetGateway,
      },
    };

    await expect(
      observerFor(fixture, client).observe(forged),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayResourceObserverAuthorityError,
    );
    expect(client.describeInternetGateways).not.toHaveBeenCalled();

    const otherBase = makeBase({
      accountId: '210987654321',
      incarnationByte: 78,
    });
    const observer = createAwsSingleNodeInternetGatewayResourceObserver({
      client,
      providerScope: otherBase.providerScope,
      maxAttempts: 1,
    });
    await expect(observer.observe(fixture.authority)).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayResourceObserverAuthorityError,
    );
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
  });

  it('sanitizes provider and retry failures into an immutable unknown observation', async () => {
    const fixture = makeAuthorityFixture({ mode: 'unbound' });
    const client = scriptedClient(() => {
      throw new Error('credential text must not escape');
    });
    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
      waitForRetry: async () => {
        throw new Error('timer failure');
      },
    }).observe(fixture.authority);

    expect(observation).toMatchObject({
      presence: 'unknown',
      ownership: 'unknown',
      execution: 'none',
    });
    expectDeepFrozen(observation);
    expect(client.describeInternetGateways).toHaveBeenCalledTimes(1);
  });
});
