import { describe, expect, it, jest } from '@jest/globals';

import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import { createAwsSingleNodeDeploymentProviderFromClientFamily } from '../../src/core/runtime/deployment-aws-provider-assembly.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import {
  createAwsProviderScope,
  getDeploymentInstanceId,
} from '../../src/core/runtime/deployment-provider-scope.js';
import { createDeploymentIncarnationId } from '../../src/core/runtime/deployment-resource-binding.js';
import { validateDeploymentRevision } from '../../src/core/runtime/deployment-revision.js';

const PROVIDER_METHODS = Object.freeze([
  'resolveScope',
  'resolveProviderSpec',
  'validateProviderSpec',
  'inspect',
  'createPlan',
  'executeAction',
  'verifySettlement',
]);
const CLIENT_KEYS = Object.freeze([
  'deploymentStore',
  'dynamoControl',
  's3Control',
  'providerSpecRead',
  'managedArtifact',
  'volume',
  'network',
  'runtimeIdentity',
  'node',
  'volumeAttachment',
]);
/** @type {Readonly<Record<string, ReadonlyArray<string>>>} */
const CLIENT_METHODS = Object.freeze({
  deploymentStore: Object.freeze([
    'query',
    'queryPage',
    'batchWrite',
    'transactionWrite',
    'update',
    'put',
    'get',
    'remove',
    'close',
  ]),
  dynamoControl: Object.freeze([
    'createTable',
    'describeContinuousBackups',
    'describeTable',
    'describeTimeToLive',
    'listTagsOfResource',
    'updateContinuousBackups',
    'close',
  ]),
  s3Control: Object.freeze([
    'createBucket',
    'headBucket',
    'getBucketEncryption',
    'getBucketLifecycleConfiguration',
    'getBucketLocation',
    'getBucketOwnershipControls',
    'getBucketPolicy',
    'getBucketReplication',
    'getBucketTagging',
    'getBucketVersioning',
    'getPublicAccessBlock',
    'getObject',
    'putBucketEncryption',
    'putBucketLifecycleConfiguration',
    'putBucketOwnershipControls',
    'putBucketVersioning',
    'putPublicAccessBlock',
    'putObject',
    'headObject',
    'close',
  ]),
  providerSpecRead: Object.freeze([
    'getParameter',
    'describeImages',
    'describeAvailabilityZones',
    'describeInstanceTypeOfferings',
    'getEbsDefaultKmsKeyId',
    'close',
  ]),
  managedArtifact: Object.freeze([
    'copyObject',
    'close',
    'headObject',
    'listObjectVersions',
    'deleteObjectVersion',
  ]),
  volume: Object.freeze(['close', 'createVolume', 'describeVolumes']),
  network: Object.freeze([
    'associateRouteTable',
    'attachInternetGateway',
    'createInternetGateway',
    'createRoute',
    'createRouteTable',
    'createSecurityGroup',
    'createSubnet',
    'createVpc',
    'close',
    'deleteInternetGateway',
    'deleteRoute',
    'deleteRouteTable',
    'deleteSecurityGroup',
    'deleteSubnet',
    'deleteVpc',
    'describeInternetGateways',
    'describeRouteTables',
    'describeSecurityGroups',
    'describeSubnets',
    'describeVpcAttribute',
    'describeVpcs',
    'detachInternetGateway',
    'disassociateRouteTable',
  ]),
  runtimeIdentity: Object.freeze([
    'addRoleToInstanceProfile',
    'createInstanceProfile',
    'createRole',
    'close',
    'deleteInstanceProfile',
    'deleteRole',
    'deleteRolePolicy',
    'describeInstances',
    'getInstanceProfile',
    'getRole',
    'getRolePolicy',
    'listAttachedRolePolicies',
    'listInstanceProfilesForRole',
    'listInstanceProfileTags',
    'listRolePolicies',
    'listRoleTags',
    'putRolePolicy',
    'removeRoleFromInstanceProfile',
  ]),
  node: Object.freeze([
    'close',
    'runInstances',
    'startInstances',
    'describeInstances',
    'describeInstanceAttribute',
    'describeInstanceCreditSpecifications',
    'describeVolumes',
    'terminateInstances',
  ]),
  volumeAttachment: Object.freeze([
    'attachVolume',
    'close',
    'describeInstances',
    'describeVolumes',
    'detachVolume',
    'modifyInstanceAttribute',
  ]),
});

/** @typedef {Record<string, any>} AnyRecord */

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

/** @param {string} clientKey @param {readonly string[]} methods @param {jest.Mock[]} io */
function makeClient(clientKey, methods, io) {
  return Object.freeze(
    Object.fromEntries(
      methods.map((method) => {
        const mock = jest.fn();
        mock.mockName(`${clientKey}.${method}`);
        io.push(mock);
        return [method, mock];
      }),
    ),
  );
}

/** @returns {{family: Readonly<AnyRecord>, providerScope: Readonly<AnyRecord>, io: jest.Mock[], receivers: unknown[]}} */
function makeClientFamily() {
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId: '123456789012',
    region: 'us-east-1',
  });
  /** @type {jest.Mock[]} */
  const io = [];
  /** @type {unknown[]} */
  const receivers = [];
  const scopeResolver = {
    resolveScope: jest.fn(
      /**
       * @this {unknown}
       * @param {unknown} context
       */
      function resolveScope(context) {
        receivers.push(this);
        return Object.freeze({ providerScope, context });
      },
    ),
  };
  Object.freeze(scopeResolver);
  const clients = Object.freeze(
    Object.fromEntries(
      CLIENT_KEYS.map((clientKey) => [
        clientKey,
        makeClient(clientKey, CLIENT_METHODS[clientKey], io),
      ]),
    ),
  );
  const close = jest.fn();
  return {
    family: Object.freeze({
      providerScope,
      scopeResolver,
      clients,
      close,
    }),
    providerScope,
    io,
    receivers,
  };
}

/** @param {Readonly<AnyRecord>} providerScope @returns {Readonly<AnyRecord>} */
function makeAbsentInspectionContext(providerScope) {
  const appId = 'aws-provider-assembly-test';
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId,
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider(providerScope.region),
  });
  const revisionPayload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'production' },
    appId,
    revisionId: semanticId(
      'wrv1',
      'wharfie:test:aws-provider-assembly-revision:v1',
      { appId },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'provider assembly artifact',
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
  const providerSpec = createAwsSingleNodeProviderSpec({
    profile,
    providerScope,
    machineImage: {
      sourceParameter: {
        name: AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64,
        version: 42,
      },
      imageId: 'ami-0123456789abcdef1',
      ownerAccountId: '137112412989',
      architecture: 'x86_64',
      imageType: 'machine',
      rootDeviceType: 'ebs',
      virtualizationType: 'hvm',
      enaSupport: true,
      rootDeviceName: '/dev/xvda',
      rootBlockDevice: {
        snapshotId: 'snap-0123456789abcdef1',
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
  const deploymentInstanceId = getDeploymentInstanceId({
    deploymentRevision,
    providerScope,
  });
  return Object.freeze({
    operation: 'apply',
    deploymentRevision,
    profile,
    providerScope,
    providerSpec,
    deploymentInstanceId,
    incarnationId: createDeploymentIncarnationId(Buffer.alloc(32, 71)),
    head: null,
    plan: null,
    settledPlan: null,
    pendingBinding: null,
  });
}

describe('AWS single-node deployment provider client-family assembly', () => {
  it('constructs the exact frozen provider without I/O, close, or leaked capabilities', () => {
    const fixture = makeClientFamily();
    const provider = createAwsSingleNodeDeploymentProviderFromClientFamily({
      clientFamily: fixture.family,
      now: () => 1_900_000_000_000,
      maxAttempts: 2,
      waitForRetry: async () => {},
    });

    expect(Object.keys(provider)).toEqual(PROVIDER_METHODS);
    expect(Object.isFrozen(provider)).toBe(true);
    expect(provider).not.toHaveProperty('close');
    expect(provider).not.toHaveProperty('publish');
    expect(provider).not.toHaveProperty('observeResource');
    expect(provider).not.toHaveProperty('createVolume');
    expect(fixture.family.close).not.toHaveBeenCalled();
    expect(fixture.io.every((mock) => mock.mock.calls.length === 0)).toBe(true);
  });

  it('preserves the caller-owned scope resolver receiver and exact argument', () => {
    const fixture = makeClientFamily();
    const provider = createAwsSingleNodeDeploymentProviderFromClientFamily({
      clientFamily: fixture.family,
    });
    const context = Object.freeze({ operation: 'inspect' });

    const result = provider.resolveScope(context);

    expect(result).toEqual({
      providerScope: fixture.providerScope,
      context,
    });
    expect(fixture.receivers).toEqual([fixture.family.scopeResolver]);
    expect(fixture.family.scopeResolver.resolveScope).toHaveBeenCalledWith(
      context,
    );
  });

  it('returns authoritative null-head absence without resource or service I/O', async () => {
    const fixture = makeClientFamily();
    const now = jest.fn(() => 1_900_000_000_000);
    const provider = createAwsSingleNodeDeploymentProviderFromClientFamily({
      clientFamily: fixture.family,
      now,
    });

    const inspection = /** @type {AnyRecord} */ (
      await provider.inspect(makeAbsentInspectionContext(fixture.providerScope))
    );

    expect(inspection.status).toBe('absent');
    expect(inspection.resources).toEqual([]);
    expect(now).toHaveBeenCalledTimes(1);
    expect(fixture.io.every((mock) => mock.mock.calls.length === 0)).toBe(true);
    expect(fixture.family.close).not.toHaveBeenCalled();
  });

  it('preserves a projected read receiver and the common retry policy', async () => {
    const fixture = makeClientFamily();
    const providerSpecRead = fixture.family.clients.providerSpecRead;
    /** @type {unknown[]} */
    const receivers = [];
    providerSpecRead.getParameter.mockImplementation(
      /**
       * @this {unknown}
       */
      function getParameter() {
        receivers.push(this);
        throw new Error('simulated provider read failure');
      },
    );
    const waitForRetry = jest.fn(async (/** @type {number} */ _attempt) => {});
    const provider = createAwsSingleNodeDeploymentProviderFromClientFamily({
      clientFamily: fixture.family,
      maxAttempts: 2,
      waitForRetry,
    });
    const context = makeAbsentInspectionContext(fixture.providerScope);

    await expect(
      provider.resolveProviderSpec({
        operation: context.operation,
        deploymentRevision: context.deploymentRevision,
        providerScope: context.providerScope,
        deploymentInstanceId: context.deploymentInstanceId,
        incarnationId: context.incarnationId,
        profile: context.profile,
        head: null,
      }),
    ).rejects.toMatchObject({
      name: 'AwsSingleNodeProviderSpecUnknownError',
      code: 'AWS_SINGLE_NODE_PROVIDER_SPEC_UNKNOWN',
    });
    expect(providerSpecRead.getParameter).toHaveBeenCalledTimes(2);
    expect(receivers).toEqual([providerSpecRead, providerSpecRead]);
    expect(waitForRetry).toHaveBeenCalledTimes(1);
    expect(waitForRetry).toHaveBeenCalledWith(1);
  });

  it('projects full mutation-capable clients through all real read-only observers', () => {
    const fixture = makeClientFamily();

    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: fixture.family,
        maxAttempts: 10,
        waitForRetry: async () => {},
      }),
    ).not.toThrow();
  });

  it.each([null, [], () => {}, Object.create({ clientFamily: {} })])(
    'rejects non-plain assembly options %#',
    (options) => {
      expect(() =>
        createAwsSingleNodeDeploymentProviderFromClientFamily(options),
      ).toThrow(/options must be an object/i);
    },
  );

  it('rejects missing and unsupported assembly options', () => {
    const fixture = makeClientFamily();
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({}),
    ).toThrow(/clientFamily.*required/i);
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: fixture.family,
        bootstrap: true,
      }),
    ).toThrow(/bootstrap.*not supported/i);
  });

  it.each([1, 11, 2.5, Number.NaN])(
    'rejects an invalid common maxAttempts value %#',
    (maxAttempts) => {
      const fixture = makeClientFamily();
      expect(() =>
        createAwsSingleNodeDeploymentProviderFromClientFamily({
          clientFamily: fixture.family,
          maxAttempts,
        }),
      ).toThrow(/maxAttempts.*2.*10/i);
    },
  );

  it('rejects invalid clock and wait policy options', () => {
    const fixture = makeClientFamily();
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: fixture.family,
        now: 1,
      }),
    ).toThrow(/now.*function/i);
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: fixture.family,
        waitForRetry: true,
      }),
    ).toThrow(/waitForRetry.*function/i);
  });

  it('requires the exact family and client-map surfaces', () => {
    const fixture = makeClientFamily();
    const missingClose = { ...fixture.family };
    delete missingClose.close;
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: missingClose,
      }),
    ).toThrow(/clientFamily\.close.*required/i);

    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: { ...fixture.family, bootstrap: jest.fn() },
      }),
    ).toThrow(/clientFamily\.bootstrap.*not supported/i);

    const missingClient = { ...fixture.family.clients };
    delete missingClient.node;
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: { ...fixture.family, clients: missingClient },
      }),
    ).toThrow(/clients\.node.*required/i);

    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: {
          ...fixture.family,
          clients: { ...fixture.family.clients, bootstrap: {} },
        },
      }),
    ).toThrow(/clients\.bootstrap.*not supported/i);
  });

  it('rejects malformed family ports and required read methods', () => {
    const fixture = makeClientFamily();
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: {
          ...fixture.family,
          scopeResolver: { resolveScope: null },
        },
      }),
    ).toThrow(/scopeResolver\.resolveScope.*function/i);
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: {
          ...fixture.family,
          scopeResolver: {
            ...fixture.family.scopeResolver,
            close: jest.fn(),
          },
        },
      }),
    ).toThrow(/scopeResolver\.close.*not supported/i);
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: { ...fixture.family, close: null },
      }),
    ).toThrow(/clientFamily\.close.*function/i);

    const providerSpecRead = { ...fixture.family.clients.providerSpecRead };
    delete providerSpecRead.getParameter;
    expect(() =>
      createAwsSingleNodeDeploymentProviderFromClientFamily({
        clientFamily: {
          ...fixture.family,
          clients: {
            ...fixture.family.clients,
            providerSpecRead,
          },
        },
      }),
    ).toThrow(/provider-spec client\.getParameter.*function/i);
  });
});
