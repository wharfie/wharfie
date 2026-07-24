import { describe, expect, it, jest } from '@jest/globals';

import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import {
  createAwsSingleNodeInternetGatewayAttachmentStateDigest,
  getAwsSingleNodeInternetGatewayAttachmentProviderResourceId,
} from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-evidence.js';
import {
  AwsSingleNodeInternetGatewayAttachmentResourceObserverAuthorityError,
  createAwsSingleNodeInternetGatewayAttachmentResourceObserver,
} from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource-observer.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
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
  otherVpc: 'vpc-00000000000000002',
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

/** @returns {Readonly<AnyRecord>} */
function makeBase() {
  const accountId = '123456789012';
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'internet-gateway-attachment-resource-observer-test',
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
      'wharfie:test:internet-gateway-attachment-resource-observer-revision:v1',
      { appId: profile.appId },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'internet gateway attachment observer artifact',
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
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 78)),
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
          'wharfie:test:internet-gateway-attachment-resource-observer-inspection:v1',
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
    return getAwsSingleNodeManagedArtifactObjectLocation({
      providerScope: base.providerScope,
      deploymentInstanceId: base.deploymentInstanceId,
      incarnationId: base.incarnationId,
    }).arn;
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
 * @param {'bound'|'current-create'|'unbound'|'early-unbound'} [mode]
 * @returns {Readonly<AnyRecord>}
 */
function makeAuthorityFixture(mode = 'bound') {
  const base = makeBase();
  const plan = makeCreatePlan(base);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'network-internet-gateway-attachment',
  );
  const action = plan.actions[actionIndex];
  if (action === undefined) {
    throw new Error('Missing internet-gateway-attachment action.');
  }
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
  const target = targetFor(
    makeTargets(base, head),
    'network-internet-gateway-attachment',
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

/**
 * @param {Readonly<AnyRecord>} fixture
 * @param {{id?: string, ownerId?: string, vpcId?: string, state?: string, attachments?: unknown}} [options]
 */
function gateway(fixture, options = {}) {
  return {
    InternetGatewayId: options.id ?? IDS.internetGateway,
    OwnerId: options.ownerId ?? fixture.base.providerScope.accountId,
    Attachments: options.attachments ?? [
      {
        State: options.state ?? 'available',
        VpcId: options.vpcId ?? IDS.vpc,
      },
    ],
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

/**
 * @param {Readonly<AnyRecord>} fixture
 * @param {{exact?: unknown, broad?: unknown}} [views]
 */
function dualViewClient(fixture, views = {}) {
  const exact = views.exact === undefined ? gateway(fixture) : views.exact;
  const broad = views.broad === undefined ? [gateway(fixture)] : views.broad;
  return scriptedClient((request) =>
    request.InternetGatewayIds
      ? { InternetGateways: exact === null ? [] : [exact] }
      : { InternetGateways: broad },
  );
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} client @param {{maxAttempts?: number, waitForRetry?: (attempt: number) => Promise<void>}} [options] */
function observerFor(fixture, client, options = {}) {
  return createAwsSingleNodeInternetGatewayAttachmentResourceObserver({
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
    resourceKey: 'network-internet-gateway-attachment',
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

/** @param {Readonly<AnyRecord>} fixture */
function syntheticIdentity(fixture) {
  return {
    providerType: 'ec2-internet-gateway-attachment',
    providerResourceId:
      getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
        IDS.internetGateway,
        IDS.vpc,
      ),
  };
}

describe('AWS single-node internet-gateway-attachment resource observer', () => {
  it('constructs without I/O and accepts only the exact read port', () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient(() => {
      throw new Error('constructor performed I/O');
    });
    const observer = observerFor(fixture, client);

    expect(Object.keys(observer)).toEqual(['observe']);
    expect(Object.isFrozen(observer)).toBe(true);
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
    expect(() =>
      createAwsSingleNodeInternetGatewayAttachmentResourceObserver({
        client: {
          describeInternetGateways: async () => ({}),
          attachInternetGateway: async () => ({}),
        },
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(/attachInternetGateway is not supported/);
  });

  it('re-proves exact dependency receipt lineage before I/O', async () => {
    const fixture = makeAuthorityFixture();
    const forged = clone(fixture.authority);
    forged.binding.dependencyBindings[0].bindingId = semanticId(
      'wdb2',
      'wharfie:test:wrong-internet-gateway-attachment-dependency:v1',
      {},
    );
    const client = dualViewClient(fixture);

    await expect(
      observerFor(fixture, client).observe(forged),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeInternetGatewayAttachmentResourceObserverAuthorityError,
    );
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
  });

  it('verifies bound presence from both endpoint views and freezes I/O', async () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient((request) => {
      expectDeepFrozen(request);
      if (request.InternetGatewayIds) {
        expect(request).toEqual({
          InternetGatewayIds: [IDS.internetGateway],
        });
      } else {
        expect(request).toEqual({
          Filters: [
            {
              Name: 'attachment.vpc-id',
              Values: [IDS.vpc],
            },
          ],
          MaxResults: 100,
        });
      }
      return { InternetGateways: [gateway(fixture)] };
    });

    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'verified',
        syntheticIdentity(fixture),
        createAwsSingleNodeInternetGatewayAttachmentStateDigest({
          state: 'available',
          onDestroy: 'purge',
        }),
      ),
    );
    expectDeepFrozen(observation);
    expect(client.describeInternetGateways).toHaveBeenCalledTimes(2);
  });

  it('recovers current-create presence without adoption or replay advice', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const observation = await observerFor(
      fixture,
      dualViewClient(fixture),
    ).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'verified',
        syntheticIdentity(fixture),
        createAwsSingleNodeInternetGatewayAttachmentStateDigest({
          state: 'available',
          onDestroy: 'purge',
        }),
      ),
    );
  });

  it('reports a correct unbound relationship as collision instead of adopting it', async () => {
    const fixture = makeAuthorityFixture('unbound');
    const observation = await observerFor(
      fixture,
      dualViewClient(fixture),
    ).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'conflict',
        syntheticIdentity(fixture),
        null,
      ),
    );
  });

  it('reports bound physical relationship loss only after a clean history', async () => {
    const fixture = makeAuthorityFixture();
    const client = dualViewClient(fixture, {
      exact: gateway(fixture, { attachments: [] }),
      broad: [],
    });

    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
    }).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('absent', 'missing', null, null),
    );
    expect(client.describeInternetGateways).toHaveBeenCalledTimes(4);
  });

  it('keeps current-create clean absence unknown and never replay-safe', async () => {
    const fixture = makeAuthorityFixture('current-create');
    const client = dualViewClient(fixture, {
      exact: gateway(fixture, { attachments: [] }),
      broad: [],
    });

    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
    }).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(observation.execution).toBe('none');
    expect(client.describeInternetGateways).toHaveBeenCalledTimes(4);
  });

  it('reports absence only after every unbound complete view stays clean', async () => {
    const fixture = makeAuthorityFixture('unbound');
    const waitForRetry = jest.fn(async () => {});
    const client = dualViewClient(fixture, {
      exact: gateway(fixture, { attachments: [] }),
      broad: [],
    });

    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
      waitForRetry,
    }).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('absent', 'missing', null, null),
    );
    expect(client.describeInternetGateways).toHaveBeenCalledTimes(4);
    expect(waitForRetry).toHaveBeenCalledTimes(1);
  });

  it('suppresses absence after an earlier unreadable view', async () => {
    const fixture = makeAuthorityFixture('unbound');
    const free = gateway(fixture, { attachments: [] });
    const client = scriptedClient((request, callIndex) => {
      if (callIndex === 1) throw new Error('transient exact read');
      return {
        InternetGateways: request.InternetGatewayIds ? [free] : [],
      };
    });

    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
    }).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(client.describeInternetGateways).toHaveBeenCalledTimes(4);
  });

  it('keeps an unbound target without endpoint receipts unknown and performs no I/O', async () => {
    const fixture = makeAuthorityFixture('early-unbound');
    const client = dualViewClient(fixture);

    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(client.describeInternetGateways).not.toHaveBeenCalled();
  });

  it.each([
    [
      'exact gateway attached to another VPC',
      (/** @type {Readonly<AnyRecord>} */ fixture) =>
        dualViewClient(fixture, {
          exact: gateway(fixture, { vpcId: IDS.otherVpc }),
          broad: [],
        }),
    ],
    [
      'VPC occupied by another gateway',
      (/** @type {Readonly<AnyRecord>} */ fixture) =>
        dualViewClient(fixture, {
          exact: gateway(fixture, { attachments: [] }),
          broad: [gateway(fixture, { id: IDS.otherInternetGateway })],
        }),
    ],
    [
      'wrong exact account',
      (/** @type {Readonly<AnyRecord>} */ fixture) =>
        dualViewClient(fixture, {
          exact: gateway(fixture, { ownerId: '999999999999' }),
          broad: [],
        }),
    ],
  ])('reports %s as conflict', async (_label, makeClient) => {
    const fixture = makeAuthorityFixture();
    const observation = await observerFor(fixture, makeClient(fixture)).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'conflict',
        syntheticIdentity(fixture),
        null,
      ),
    );
  });

  it('does not let an unreadable exact view hide conflicting VPC occupancy', async () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient((request) => {
      if (request.InternetGatewayIds) {
        throw new Error('exact endpoint unavailable');
      }
      return {
        InternetGateways: [gateway(fixture, { id: IDS.otherInternetGateway })],
      };
    });

    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'conflict',
        syntheticIdentity(fixture),
        null,
      ),
    );
  });

  it('preserves a first-page foreign VPC occupant over later pagination failure', async () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient((request) => {
      if (request.InternetGatewayIds) {
        return {
          InternetGateways: [gateway(fixture, { attachments: [] })],
        };
      }
      if (!request.NextToken) {
        return {
          InternetGateways: [
            gateway(fixture, { id: IDS.otherInternetGateway }),
          ],
          NextToken: 'page-2',
        };
      }
      throw new Error('later-page-secret');
    });

    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'conflict',
        syntheticIdentity(fixture),
        null,
      ),
    );
    expect(client.describeInternetGateways).toHaveBeenCalledTimes(2);
  });

  it('keeps transitional or disagreeing readable views unknown', async () => {
    const fixture = makeAuthorityFixture();
    const client = dualViewClient(fixture, {
      exact: gateway(fixture, { state: 'attaching' }),
      broad: [gateway(fixture, { state: 'attaching' })],
    });

    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
    }).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(client.describeInternetGateways).toHaveBeenCalledTimes(4);
  });

  it('keeps eventually inconsistent exact not-found with broad presence unknown', async () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient((request) => {
      if (request.InternetGatewayIds) {
        throw Object.assign(new Error('not found'), {
          name: 'InvalidInternetGatewayID.NotFound',
        });
      }
      return { InternetGateways: [gateway(fixture)] };
    });

    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
  });

  it('reports exact endpoint absence corroborated by empty occupancy as conflict', async () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient((request) => {
      if (request.InternetGatewayIds) {
        throw Object.assign(new Error('not found'), {
          name: 'InvalidInternetGatewayID.NotFound',
        });
      }
      return { InternetGateways: [] };
    });

    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual(
      expectedObservation(
        'present',
        'conflict',
        syntheticIdentity(fixture),
        null,
      ),
    );
  });

  it('reads all bounded discovery pages and rejects repeated continuation', async () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient((request) => {
      if (request.InternetGatewayIds) {
        return { InternetGateways: [gateway(fixture)] };
      }
      if (!request.NextToken) {
        return { InternetGateways: [], NextToken: 'page-2' };
      }
      return { InternetGateways: [gateway(fixture)] };
    });
    const present = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(present.presence).toBe('present');
    expect(client.describeInternetGateways).toHaveBeenCalledTimes(3);

    const repeated = scriptedClient((request) =>
      request.InternetGatewayIds
        ? { InternetGateways: [gateway(fixture)] }
        : { InternetGateways: [], NextToken: 'same-page' },
    );
    const unknown = await observerFor(fixture, repeated).observe(
      fixture.authority,
    );
    expect(unknown).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
  });

  it('turns retry wait failure into unknown without leaking provider errors', async () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient(() => {
      throw new Error('provider-secret');
    });
    const waitForRetry = jest.fn(async () => {
      throw new Error('wait-secret');
    });

    const observation = await observerFor(fixture, client, {
      maxAttempts: 2,
      waitForRetry,
    }).observe(fixture.authority);

    expect(observation).toEqual(
      expectedObservation('unknown', 'unknown', null, null),
    );
    expect(client.describeInternetGateways).toHaveBeenCalledTimes(2);
    expect(waitForRetry).toHaveBeenCalledTimes(1);
  });
});
