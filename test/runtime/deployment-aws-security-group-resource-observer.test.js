import { describe, expect, it, jest } from '@jest/globals';

import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import { getAwsSingleNodeDefaultIpv4RouteProviderResourceId } from '../../src/core/runtime/deployment-aws-default-ipv4-route-resource.js';
import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from '../../src/core/runtime/deployment-aws-internet-gateway-attachment-resource.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { createAwsSingleNodeResourceObservationAuthority } from '../../src/core/runtime/deployment-aws-resource-observation-authority.js';
import { getAwsSingleNodeManagedArtifactObjectLocation } from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
import {
  AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
  AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
  createAwsSingleNodeSecurityGroupEvidenceKernel,
  createAwsSingleNodeSecurityGroupStateDigest,
  getAwsSingleNodeSecurityGroupStateDigest,
} from '../../src/core/runtime/deployment-aws-security-group-evidence.js';
import {
  AwsSingleNodeSecurityGroupResourceObserverAuthorityError,
  createAwsSingleNodeSecurityGroupResourceObserver,
} from '../../src/core/runtime/deployment-aws-security-group-resource-observer.js';
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
  securityGroup: 'sg-00000000000000001',
  otherSecurityGroup: 'sg-00000000000000002',
  vpc: 'vpc-00000000000000001',
  otherVpc: 'vpc-00000000000000002',
  internetGateway: 'igw-00000000000000001',
  subnet: 'subnet-00000000000000001',
  routeTable: 'rtb-00000000000000001',
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
    appId: 'security-group-resource-observer-test',
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
      'wharfie:test:security-group-resource-observer-revision:v1',
      { appId: profile.appId },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'security group observer artifact',
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
          'win6',
          'wharfie:test:security-group-resource-observer-inspection:v1',
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
 * @param {{mode?: 'bound'|'current-create'|'unbound'|'early-unbound', base?: Readonly<AnyRecord>}} [options]
 */
function makeAuthorityFixture(options = {}) {
  const mode = options.mode ?? 'bound';
  const base = options.base ?? makeBase();
  const plan = makeCreatePlan(base);
  const actionIndex = plan.actions.findIndex(
    (/** @type {Readonly<AnyRecord>} */ action) =>
      action.resourceKey === 'network-security-group',
  );
  const action = plan.actions[actionIndex];
  if (action === undefined) throw new Error('Missing security-group action.');
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
  const target = targetFor(makeTargets(base, head), 'network-security-group');
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

const tagEvidence = createAwsSingleNodeSecurityGroupEvidenceKernel({
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
 * @param {{id?: string, ownerId?: string, vpcId?: string, groupName?: string, description?: string, tags?: Readonly<Record<string, string>>, tagList?: ReadonlyArray<Readonly<AnyRecord>>, ingress?: unknown, egress?: unknown}} [options]
 */
function securityGroup(fixture, options = {}) {
  const defaultTags =
    fixture.mode === 'bound' || fixture.mode === 'current-create'
      ? fixtureOwnershipTags(fixture)
      : tagEvidence.locatorTags(fixtureLocator(fixture));
  return {
    GroupId: options.id ?? IDS.securityGroup,
    OwnerId: options.ownerId ?? fixture.base.providerScope.accountId,
    VpcId: options.vpcId ?? IDS.vpc,
    GroupName: options.groupName ?? AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
    Description:
      options.description ?? AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
    IpPermissions: options.ingress ?? [],
    IpPermissionsEgress: options.egress ?? [
      {
        IpProtocol: '-1',
        IpRanges: [
          {
            CidrIp:
              fixture.base.providerSpec.capabilities.networking.egressCidr,
          },
        ],
      },
    ],
    Tags:
      options.tagList ?? tagEvidence.sortedTags(options.tags ?? defaultTags),
  };
}

/** @param {(request: Readonly<AnyRecord>, callIndex: number) => unknown|Promise<unknown>} handler */
function scriptedClient(handler) {
  let callIndex = 0;
  return {
    describeSecurityGroups: jest.fn(async (request) => {
      callIndex += 1;
      return handler(/** @type {Readonly<AnyRecord>} */ (request), callIndex);
    }),
  };
}

/** @param {Readonly<AnyRecord>} fixture @param {Readonly<AnyRecord>} client @param {Readonly<AnyRecord>} [options] */
function observerFor(fixture, client, options = {}) {
  return createAwsSingleNodeSecurityGroupResourceObserver({
    client,
    providerScope: fixture.base.providerScope,
    maxAttempts: options.maxAttempts ?? 1,
    waitForRetry: options.waitForRetry ?? (async () => {}),
  });
}

/** @param {Readonly<AnyRecord>} request */
function requestKind(request) {
  if (Object.hasOwn(request, 'GroupIds')) return 'exact';
  if (request.Filters.length === 1 && request.Filters[0].Name === 'vpc-id') {
    return 'natural';
  }
  return 'locator';
}

describe('AWS single-node security-group resource observer', () => {
  it('constructs without I/O and requires the exact narrow client port', () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient(() => {
      throw new Error('constructor performed I/O');
    });
    const observer = observerFor(fixture, client);

    expect(Object.keys(observer)).toEqual(['observe']);
    expect(Object.isFrozen(observer)).toBe(true);
    expect(client.describeSecurityGroups).not.toHaveBeenCalled();
    expect(() =>
      createAwsSingleNodeSecurityGroupResourceObserver({
        client: {
          describeSecurityGroups: async () => ({}),
          createSecurityGroup: async () => ({}),
        },
        providerScope: fixture.base.providerScope,
      }),
    ).toThrow(/createSecurityGroup is not supported/);
  });

  it('verifies a bound group by exact ID only and freezes requests and results', async () => {
    const fixture = makeAuthorityFixture();
    const record = securityGroup(fixture);
    const client = scriptedClient(() => ({
      SecurityGroups: [clone(record)],
    }));

    const observation = await observerFor(fixture, client).observe(
      fixture.authority,
    );

    expect(observation).toEqual({
      resourceKey: 'network-security-group',
      presence: 'present',
      ownership: 'verified',
      providerIdentity: {
        providerType: 'ec2-security-group',
        providerResourceId: IDS.securityGroup,
      },
      observedDigest: getAwsSingleNodeSecurityGroupStateDigest(
        fixture.base.providerSpec,
      ),
      health: 'not-applicable',
      execution: 'none',
    });
    expectDeepFrozen(observation);
    expect(client.describeSecurityGroups).toHaveBeenCalledTimes(1);
    expect(client.describeSecurityGroups.mock.calls[0][0]).toEqual({
      GroupIds: [IDS.securityGroup],
    });
    expectDeepFrozen(client.describeSecurityGroups.mock.calls[0][0]);
  });

  it('reports readable bound configuration drift with its actual digest', async () => {
    const fixture = makeAuthorityFixture();
    const record = securityGroup(fixture, {
      description: 'Operator-edited description.',
      ingress: [
        {
          IpProtocol: 'tcp',
          FromPort: 443,
          ToPort: 443,
          IpRanges: [{ CidrIp: '10.0.0.0/24' }],
        },
      ],
    });
    const client = scriptedClient(() => ({
      SecurityGroups: [clone(record)],
    }));

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'verified',
      observedDigest: createAwsSingleNodeSecurityGroupStateDigest({
        groupName: AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
        description: 'Operator-edited description.',
        ingressRules: [
          {
            protocol: 'tcp',
            ports: { from: 443, to: 443 },
            destinations: [{ kind: 'ipv4-cidr', value: '10.0.0.0/24' }],
          },
        ],
        egressRules: [
          {
            protocol: '-1',
            ports: 'all',
            destinations: [
              {
                kind: 'ipv4-cidr',
                value:
                  fixture.base.providerSpec.capabilities.networking.egressCidr,
              },
            ],
          },
        ],
        onDestroy: 'purge',
      }),
      execution: 'none',
    });
  });

  it.each([
    ['InvalidGroup.NotFound', 'typed not found'],
    ['InvalidSecurityGroupID.NotFound', 'alternate typed not found'],
    [null, 'successful empty exact envelope'],
  ])(
    'keeps bound %s evidence unknown without searching',
    async (name, _description) => {
      const fixture = makeAuthorityFixture();
      const client = scriptedClient(() => {
        if (name === null) return { SecurityGroups: [] };
        const error = new Error('not found');
        error.name = name;
        throw error;
      });

      await expect(
        observerFor(fixture, client, { maxAttempts: 2 }).observe(
          fixture.authority,
        ),
      ).resolves.toMatchObject({
        presence: 'unknown',
        ownership: 'unknown',
        execution: 'none',
      });
      expect(
        client.describeSecurityGroups.mock.calls.every(
          ([request]) =>
            requestKind(/** @type {Readonly<AnyRecord>} */ (request)) ===
            'exact',
        ),
      ).toBe(true);
    },
  );

  it.each([
    ['wrong owner', { ownerId: '210987654321' }],
    ['wrong VPC', { vpcId: IDS.otherVpc }],
    [
      'wrong receipt tag',
      {
        tags: {
          ...fixtureOwnershipTags(makeAuthorityFixture()),
          'wharfie:ownership-nonce': nonce(17),
        },
      },
    ],
  ])('reports bound %s as an ownership conflict', async (_name, edit) => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient(() => ({
      SecurityGroups: [securityGroup(fixture, edit)],
    }));

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      providerIdentity: {
        providerResourceId: IDS.securityGroup,
      },
      observedDigest: null,
      execution: 'none',
    });
  });

  it('verifies a current create only when locator, case-insensitive natural slot, and exact ID agree', async () => {
    const fixture = makeAuthorityFixture({ mode: 'current-create' });
    const record = securityGroup(fixture, {
      groupName: AWS_SINGLE_NODE_SECURITY_GROUP_NAME.toUpperCase(),
    });
    const client = scriptedClient(() => ({
      SecurityGroups: [clone(record)],
    }));

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'verified',
      providerIdentity: {
        providerResourceId: IDS.securityGroup,
      },
      execution: 'none',
    });
    expect(
      client.describeSecurityGroups.mock.calls.map(([request]) =>
        requestKind(/** @type {Readonly<AnyRecord>} */ (request)),
      ),
    ).toEqual(['locator', 'natural', 'exact']);
  });

  it('never exposes replay when current-create corroboration or receipt propagation is incomplete', async () => {
    const fixture = makeAuthorityFixture({ mode: 'current-create' });
    const complete = securityGroup(fixture);
    const incomplete = {
      ...complete,
      Tags: complete.Tags.filter(
        (/** @type {Readonly<AnyRecord>} */ tag) =>
          tag.Key !== 'wharfie:state-digest',
      ),
    };
    const client = scriptedClient((request) => ({
      SecurityGroups:
        requestKind(request) === 'natural' ? [] : [clone(incomplete)],
    }));

    await expect(
      observerFor(fixture, client).observe(fixture.authority),
    ).resolves.toEqual({
      resourceKey: 'network-security-group',
      presence: 'unknown',
      ownership: 'unknown',
      providerIdentity: null,
      observedDigest: null,
      health: 'unknown',
      execution: 'none',
    });
  });

  it('proves unbound absence only from clean locator and paginated natural-slot views on every attempt', async () => {
    const fixture = makeAuthorityFixture({ mode: 'unbound' });
    const client = scriptedClient((request) => {
      if (
        requestKind(request) === 'natural' &&
        !Object.hasOwn(request, 'NextToken')
      ) {
        return { SecurityGroups: [], NextToken: 'page-2' };
      }
      return { SecurityGroups: [] };
    });

    await expect(
      observerFor(fixture, client, { maxAttempts: 2 }).observe(
        fixture.authority,
      ),
    ).resolves.toMatchObject({
      presence: 'absent',
      ownership: 'missing',
      execution: 'none',
    });
    expect(client.describeSecurityGroups).toHaveBeenCalledTimes(6);
  });

  it('reports locator and untagged natural-slot occupants as collisions without adoption', async () => {
    const fixture = makeAuthorityFixture({ mode: 'unbound' });
    const locatorRecord = securityGroup(fixture, {
      groupName: 'different-name',
    });
    const locatorClient = scriptedClient((request) => ({
      SecurityGroups:
        requestKind(request) === 'locator' ? [clone(locatorRecord)] : [],
    }));
    await expect(
      observerFor(fixture, locatorClient).observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      providerIdentity: { providerResourceId: IDS.securityGroup },
      execution: 'none',
    });

    const naturalRecord = securityGroup(fixture, { tagList: [] });
    const naturalClient = scriptedClient((request) => ({
      SecurityGroups:
        requestKind(request) === 'natural' ? [clone(naturalRecord)] : [],
    }));
    await expect(
      observerFor(fixture, naturalClient).observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      providerIdentity: { providerResourceId: IDS.securityGroup },
      execution: 'none',
    });

    const staleLocatorClient = scriptedClient(() => ({
      SecurityGroups: [clone(naturalRecord)],
    }));
    await expect(
      observerFor(fixture, staleLocatorClient).observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      providerIdentity: { providerResourceId: IDS.securityGroup },
      execution: 'none',
    });
  });

  it.each(['locator', 'natural'])(
    'keeps a %s collision authoritative when the other view fails',
    async (presentView) => {
      const fixture = makeAuthorityFixture({ mode: 'unbound' });
      const record = securityGroup(fixture, {
        ...(presentView === 'locator'
          ? { groupName: 'different-name' }
          : { tagList: [] }),
      });
      const client = scriptedClient((request) => {
        if (requestKind(request) !== presentView) {
          throw new Error('independent view unavailable');
        }
        return { SecurityGroups: [clone(record)] };
      });

      await expect(
        observerFor(fixture, client).observe(fixture.authority),
      ).resolves.toMatchObject({
        presence: 'present',
        ownership: 'conflict',
        providerIdentity: { providerResourceId: IDS.securityGroup },
        execution: 'none',
      });
    },
  );

  it('uses locator-only collisions before the VPC exists and never claims locator-only absence', async () => {
    const fixture = makeAuthorityFixture({ mode: 'early-unbound' });
    const collision = securityGroup(fixture);
    const collisionClient = scriptedClient(() => ({
      SecurityGroups: [clone(collision)],
    }));
    await expect(
      observerFor(fixture, collisionClient).observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'present',
      ownership: 'conflict',
      execution: 'none',
    });
    expect(collisionClient.describeSecurityGroups).toHaveBeenCalledTimes(1);
    expect(
      requestKind(
        /** @type {Readonly<AnyRecord>} */ (
          collisionClient.describeSecurityGroups.mock.calls[0][0]
        ),
      ),
    ).toBe('locator');

    const emptyClient = scriptedClient(() => ({ SecurityGroups: [] }));
    await expect(
      observerFor(fixture, emptyClient).observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'unknown',
      ownership: 'unknown',
      execution: 'none',
    });
  });

  it('removes absence when either view or retry waiting fails', async () => {
    const fixture = makeAuthorityFixture({ mode: 'unbound' });
    const client = scriptedClient((request) => {
      if (requestKind(request) === 'locator') {
        throw new Error('credential text must not escape');
      }
      return { SecurityGroups: [] };
    });

    await expect(
      observerFor(fixture, client, {
        maxAttempts: 2,
        waitForRetry: async () => {
          throw new Error('timer failed');
        },
      }).observe(fixture.authority),
    ).resolves.toMatchObject({
      presence: 'unknown',
      ownership: 'unknown',
      execution: 'none',
    });
    expect(client.describeSecurityGroups).toHaveBeenCalledTimes(2);
  });

  it('rejects forged dependency lineage and constructor scope before provider I/O', async () => {
    const fixture = makeAuthorityFixture();
    const client = scriptedClient(() => ({ SecurityGroups: [] }));
    const forged = {
      ...fixture.authority,
      binding: {
        ...fixture.authority.binding,
        dependencyBindings: [
          {
            resourceKey: 'network-vpc',
            bindingId: 'wrb2_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        ],
      },
    };

    await expect(
      observerFor(fixture, client).observe(forged),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeSecurityGroupResourceObserverAuthorityError,
    );
    expect(client.describeSecurityGroups).not.toHaveBeenCalled();

    const otherBase = makeBase({
      accountId: '210987654321',
      incarnationByte: 78,
    });
    const observer = createAwsSingleNodeSecurityGroupResourceObserver({
      client,
      providerScope: otherBase.providerScope,
      maxAttempts: 1,
    });
    await expect(observer.observe(fixture.authority)).rejects.toBeInstanceOf(
      AwsSingleNodeSecurityGroupResourceObserverAuthorityError,
    );
    expect(client.describeSecurityGroups).not.toHaveBeenCalled();
  });
});
