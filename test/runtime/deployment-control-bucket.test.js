import { describe, expect, it, jest } from '@jest/globals';

import {
  DEPLOYMENT_CONTROL_BUCKET_VERSIONING_PROPAGATION_MS,
  DEPLOYMENT_CONTROL_BUCKET_VERSIONING_READY_CHECKSUM_SHA256,
  DEPLOYMENT_CONTROL_BUCKET_VERSIONING_READY_KEY,
  DeploymentControlBucketConflictError,
  DeploymentControlBucketUnknownError,
  createDeploymentControlBucket,
  getDeploymentControlBucketName,
} from '../../src/core/runtime/deployment-control-bucket.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';

const PROVIDER_SCOPE = createAwsProviderScope({
  partition: 'aws',
  accountId: '123456789012',
  region: 'us-east-1',
});
const BUCKET_NAME = 'wharfie-dc-v1-123456789012-b32358f5848d01f2415e';
const REQUIRED_TAGS = Object.freeze([
  { Key: 'wharfie:managed-by', Value: 'wharfie' },
  {
    Key: 'wharfie:resource-kind',
    Value: 'deployment-control-bucket',
  },
  { Key: 'wharfie:retention', Value: 'retain' },
  { Key: 'wharfie:storage-schema-version', Value: '1' },
  {
    Key: 'wharfie:provider-scope-id',
    Value: PROVIDER_SCOPE.providerScopeId,
  },
]);

/** @param {string} name @returns {Error} */
function awsError(name) {
  const error = new Error('provider detail must not cross the boundary');
  error.name = name;
  return error;
}

/** @returns {Record<string, any>} */
function publicAccessResponse() {
  return {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  };
}

/** @returns {Record<string, any>} */
function ownershipResponse() {
  return {
    OwnershipControls: {
      Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }],
    },
  };
}

/** @returns {Record<string, any>} */
function encryptionResponse() {
  return {
    ServerSideEncryptionConfiguration: {
      Rules: [
        {
          ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' },
        },
      ],
    },
  };
}

/** @param {Readonly<Record<string, any>>} [providerScope] @returns {Record<string, string>} */
function sentinelMetadata(providerScope = PROVIDER_SCOPE) {
  return {
    'wharfie-kind': 'deployment-control-versioning-ready',
    'wharfie-retention': 'retain',
    'wharfie-schema-version': '1',
    'wharfie-provider-scope-id': providerScope.providerScopeId,
  };
}

/** @param {Readonly<Record<string, any>>} [providerScope] @param {Record<string, any>} [overrides] @returns {Record<string, any>} */
function sentinelResponse(providerScope = PROVIDER_SCOPE, overrides = {}) {
  return {
    ContentLength: 0,
    ContentType: 'application/octet-stream',
    ChecksumSHA256: DEPLOYMENT_CONTROL_BUCKET_VERSIONING_READY_CHECKSUM_SHA256,
    ServerSideEncryption: 'AES256',
    StorageClass: 'STANDARD',
    Metadata: sentinelMetadata(providerScope),
    VersionId: 'versioning-ready-version-1',
    ...overrides,
  };
}

/**
 * @param {Record<string, any>} [overrides] - Client method overrides.
 * @param {Readonly<Record<string, any>>} [providerScope] - Expected scope.
 * @returns {Record<string, any>} - Complete low-level S3 double.
 */
function createClient(overrides = {}, providerScope = PROVIDER_SCOPE) {
  const noLifecycle = async () => {
    throw awsError('NoSuchLifecycleConfiguration');
  };
  const noReplication = async () => {
    throw awsError('ReplicationConfigurationNotFoundError');
  };
  const noBucketPolicy = async () => {
    throw awsError('NoSuchBucketPolicy');
  };
  return {
    headBucket: jest.fn(overrides.headBucket ?? (async () => ({}))),
    getBucketLocation: jest.fn(
      overrides.getBucketLocation ?? (async () => ({})),
    ),
    getBucketTagging: jest.fn(
      overrides.getBucketTagging ??
        (async () => ({ TagSet: [...REQUIRED_TAGS] })),
    ),
    getBucketVersioning: jest.fn(
      overrides.getBucketVersioning ?? (async () => ({ Status: 'Enabled' })),
    ),
    getPublicAccessBlock: jest.fn(
      overrides.getPublicAccessBlock ?? (async () => publicAccessResponse()),
    ),
    getBucketOwnershipControls: jest.fn(
      overrides.getBucketOwnershipControls ?? (async () => ownershipResponse()),
    ),
    getBucketPolicy: jest.fn(overrides.getBucketPolicy ?? noBucketPolicy),
    getBucketEncryption: jest.fn(
      overrides.getBucketEncryption ?? (async () => encryptionResponse()),
    ),
    getBucketLifecycleConfiguration: jest.fn(
      overrides.getBucketLifecycleConfiguration ?? noLifecycle,
    ),
    getBucketReplication: jest.fn(
      overrides.getBucketReplication ?? noReplication,
    ),
    headObject: jest.fn(
      overrides.headObject ?? (async () => sentinelResponse(providerScope)),
    ),
    createBucket: jest.fn(overrides.createBucket ?? (async () => ({}))),
    putBucketVersioning: jest.fn(
      overrides.putBucketVersioning ?? (async () => ({})),
    ),
    putPublicAccessBlock: jest.fn(
      overrides.putPublicAccessBlock ?? (async () => ({})),
    ),
    putBucketOwnershipControls: jest.fn(
      overrides.putBucketOwnershipControls ?? (async () => ({})),
    ),
    putBucketEncryption: jest.fn(
      overrides.putBucketEncryption ?? (async () => ({})),
    ),
    putObject: jest.fn(overrides.putObject ?? (async () => ({}))),
  };
}

/** @param {Record<string, any>} client @param {Readonly<Record<string, any>>} [providerScope] @param {(attempt: number) => Promise<void>} [waitForReady] @param {(attempt: number) => Promise<void>} [waitForVersioningPropagation] */
function createBucket(
  client,
  providerScope = PROVIDER_SCOPE,
  waitForReady,
  waitForVersioningPropagation = async () => {},
) {
  const controlClient = /** @type {any} */ (client);
  return createDeploymentControlBucket({
    client: controlClient,
    providerScope,
    ...(waitForReady === undefined ? {} : { waitForReady }),
    waitForVersioningPropagation,
  });
}

describe('AWS deployment control bucket', () => {
  it('shares the deterministic, bounded stage-bucket name contract', () => {
    expect(getDeploymentControlBucketName(PROVIDER_SCOPE)).toBe(BUCKET_NAME);
    expect(BUCKET_NAME).toMatch(/^wharfie-dc-v1-[0-9]{12}-[a-f0-9]{20}$/);
    expect(BUCKET_NAME.length).toBeLessThanOrEqual(63);
    expect(DEPLOYMENT_CONTROL_BUCKET_VERSIONING_PROPAGATION_MS).toBe(900_000);
  });

  it('reports authoritative absence after only an owner-bound head request', async () => {
    const client = createClient({
      headBucket: async () => {
        throw awsError('NotFound');
      },
    });

    const state = await createBucket(client).inspect();

    expect(state).toEqual({
      schemaVersion: 1,
      kind: 'deploymentControlBucketInspection',
      status: 'absent',
      evidence: 'head-bucket-resource-not-found',
      bucketName: BUCKET_NAME,
      providerScopeId: PROVIDER_SCOPE.providerScopeId,
      bucketRegion: null,
      tagsConform: false,
      versioningEnabled: false,
      versioningWriteReady: false,
      publicAccessBlocked: false,
      objectOwnership: null,
      defaultEncryption: null,
      lifecycleConfigurationPresent: null,
      bucketPolicyPresent: null,
      replicationConfigurationPresent: null,
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(client.headBucket).toHaveBeenCalledWith({
      Bucket: BUCKET_NAME,
      ExpectedBucketOwner: PROVIDER_SCOPE.accountId,
    });
    expect(client.getBucketLocation).not.toHaveBeenCalled();
    expect(client.getBucketPolicy).not.toHaveBeenCalled();
    expect(client.headObject).not.toHaveBeenCalled();
    expect(client.createBucket).not.toHaveBeenCalled();
  });

  it('admits only exact active state and owner-binds every supported read', async () => {
    const client = createClient();

    const state = await createBucket(client).inspect();

    expect(state).toEqual({
      schemaVersion: 1,
      kind: 'deploymentControlBucketInspection',
      status: 'active',
      evidence:
        'head-location-tags-versioning-public-access-ownership-encryption-no-lifecycle-no-policy-no-replication-and-versioned-sentinel',
      bucketName: BUCKET_NAME,
      providerScopeId: PROVIDER_SCOPE.providerScopeId,
      bucketRegion: 'us-east-1',
      tagsConform: true,
      versioningEnabled: true,
      versioningWriteReady: true,
      publicAccessBlocked: true,
      objectOwnership: 'BucketOwnerEnforced',
      defaultEncryption: 'AES256',
      lifecycleConfigurationPresent: false,
      bucketPolicyPresent: false,
      replicationConfigurationPresent: false,
    });
    for (const method of [
      'headBucket',
      'getBucketLocation',
      'getBucketTagging',
      'getBucketVersioning',
      'getPublicAccessBlock',
      'getBucketOwnershipControls',
      'getBucketEncryption',
      'getBucketLifecycleConfiguration',
      'getBucketPolicy',
      'getBucketReplication',
    ]) {
      expect(client[method]).toHaveBeenCalledWith({
        Bucket: BUCKET_NAME,
        ExpectedBucketOwner: PROVIDER_SCOPE.accountId,
      });
    }
    expect(client.headObject).toHaveBeenCalledWith({
      Bucket: BUCKET_NAME,
      Key: DEPLOYMENT_CONTROL_BUCKET_VERSIONING_READY_KEY,
      ExpectedBucketOwner: PROVIDER_SCOPE.accountId,
      ChecksumMode: 'ENABLED',
    });
    expect(client.createBucket).not.toHaveBeenCalled();
    expect(client.putObject).not.toHaveBeenCalled();
  });

  it.each([
    [
      'absent',
      async () => {
        throw awsError('NotFound');
      },
    ],
    [
      'unversioned',
      async () => sentinelResponse(PROVIDER_SCOPE, { VersionId: 'null' }),
    ],
  ])(
    'reports an exact %s sentinel as bootstrap-required without writing',
    async (_label, headObject) => {
      const client = createClient({ headObject });

      await expect(createBucket(client).inspect()).resolves.toMatchObject({
        status: 'bootstrap-required',
        versioningEnabled: true,
        versioningWriteReady: false,
      });
      expect(client.putObject).not.toHaveBeenCalled();
    },
  );

  it('keeps inspect read-only while reporting safely repairable state', async () => {
    const client = createClient({
      getBucketVersioning: async () => ({}),
      headObject: async () =>
        sentinelResponse(PROVIDER_SCOPE, { VersionId: 'null' }),
      getPublicAccessBlock: async () => ({
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: false,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      }),
      getBucketOwnershipControls: async () => {
        throw awsError('OwnershipControlsNotFoundError');
      },
      getBucketEncryption: async () => {
        throw awsError('ServerSideEncryptionConfigurationNotFoundError');
      },
    });

    await expect(createBucket(client).inspect()).resolves.toMatchObject({
      status: 'bootstrap-required',
      tagsConform: true,
      versioningEnabled: false,
      versioningWriteReady: false,
      publicAccessBlocked: false,
      objectOwnership: null,
      defaultEncryption: null,
    });
    expect(client.createBucket).not.toHaveBeenCalled();
    expect(client.putBucketVersioning).not.toHaveBeenCalled();
    expect(client.putPublicAccessBlock).not.toHaveBeenCalled();
    expect(client.putBucketOwnershipControls).not.toHaveBeenCalled();
    expect(client.putBucketEncryption).not.toHaveBeenCalled();
    expect(client.putObject).not.toHaveBeenCalled();
  });

  it('refuses to adopt an already-existing bucket without exact ownership tags', async () => {
    const client = createClient({
      getBucketTagging: async () => {
        throw awsError('NoSuchTagSet');
      },
    });

    await expect(
      createBucket(client, PROVIDER_SCOPE, async () => {}).bootstrap(),
    ).rejects.toBeInstanceOf(DeploymentControlBucketConflictError);
    expect(client.createBucket).not.toHaveBeenCalled();
    expect(client.getBucketTagging).toHaveBeenCalledTimes(30);
  });

  it.each([
    [
      'a different region',
      { getBucketLocation: async () => ({ LocationConstraint: 'us-west-2' }) },
    ],
    [
      'changed reserved tags',
      {
        getBucketTagging: async () => ({
          TagSet: REQUIRED_TAGS.map((tag) =>
            tag.Key === 'wharfie:managed-by'
              ? { ...tag, Value: 'someone-else' }
              : tag,
          ),
        }),
      },
    ],
    [
      'a customer-managed encryption default',
      {
        getBucketEncryption: async () => ({
          ServerSideEncryptionConfiguration: {
            Rules: [
              {
                ApplyServerSideEncryptionByDefault: {
                  SSEAlgorithm: 'aws:kms',
                  KMSMasterKeyID: 'opaque-key',
                },
              },
            ],
          },
        }),
      },
    ],
    [
      'a lifecycle configuration',
      {
        getBucketLifecycleConfiguration: async () => ({
          Rules: [{ ID: 'expire-retained-data', Status: 'Enabled' }],
        }),
      },
    ],
    [
      'a bucket policy',
      {
        getBucketPolicy: async () => ({
          Policy: '{"Version":"2012-10-17","Statement":[]}',
        }),
      },
    ],
    [
      'a replication configuration',
      {
        getBucketReplication: async () => ({
          ReplicationConfiguration: {
            Role: 'opaque-role',
            Rules: [{ Status: 'Enabled' }],
          },
        }),
      },
    ],
    [
      'MFA delete',
      {
        getBucketVersioning: async () => ({
          Status: 'Enabled',
          MFADelete: 'Enabled',
        }),
      },
    ],
    [
      'suspended versioning',
      { getBucketVersioning: async () => ({ Status: 'Suspended' }) },
    ],
    [
      'an incompatible versioning-readiness sentinel',
      {
        headObject: async () =>
          sentinelResponse(PROVIDER_SCOPE, {
            ChecksumSHA256: 'not-the-empty-object-checksum',
          }),
      },
    ],
    [
      'a malformed sentinel version identity',
      {
        headObject: async () =>
          sentinelResponse(PROVIDER_SCOPE, { VersionId: '\ud800' }),
      },
    ],
    [
      'an oversized sentinel version identity',
      {
        headObject: async () =>
          sentinelResponse(PROVIDER_SCOPE, { VersionId: 'é'.repeat(513) }),
      },
    ],
  ])(
    'rejects incompatible preexisting state with %s',
    async (_label, override) => {
      const client = createClient(override);

      await expect(createBucket(client).bootstrap()).rejects.toBeInstanceOf(
        DeploymentControlBucketConflictError,
      );
      expect(client.createBucket).not.toHaveBeenCalled();
      expect(client.putBucketVersioning).not.toHaveBeenCalled();
      expect(client.putObject).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['location', { getBucketLocation: async () => null }],
    ['tags', { getBucketTagging: async () => ({ TagSet: {} }) }],
    [
      'versioning',
      { getBucketVersioning: async () => ({ Status: 'UNKNOWN' }) },
    ],
    [
      'public access',
      {
        getPublicAccessBlock: async () => ({
          PublicAccessBlockConfiguration: { BlockPublicAcls: true },
        }),
      },
    ],
    [
      'ownership',
      {
        getBucketOwnershipControls: async () => ({
          OwnershipControls: { Rules: {} },
        }),
      },
    ],
    [
      'encryption',
      {
        getBucketEncryption: async () => ({
          ServerSideEncryptionConfiguration: { Rules: {} },
        }),
      },
    ],
    ['lifecycle', { getBucketLifecycleConfiguration: async () => ({}) }],
    [
      'bucket policy absence',
      {
        getBucketPolicy: async () => {
          throw awsError('NotFound');
        },
      },
    ],
    ['replication', { getBucketReplication: async () => ({}) }],
    ['versioning sentinel', { headObject: async () => null }],
  ])(
    'turns malformed %s evidence into a fixed unknown boundary',
    async (_label, override) => {
      await expect(
        createBucket(createClient(override)).inspect(),
      ).rejects.toEqual(new DeploymentControlBucketUnknownError());
    },
  );

  it('creates and configures the retained bucket after lost write responses', async () => {
    const state = {
      exists: false,
      tags: false,
      versioning: false,
      publicAccess: false,
      ownership: false,
      encryption: false,
      sentinel: false,
    };
    const client = createClient({
      headBucket: async () => {
        if (!state.exists) throw awsError('NoSuchBucket');
        return {};
      },
      getBucketTagging: async () => {
        if (!state.tags) throw awsError('NoSuchTagSet');
        return { TagSet: [...REQUIRED_TAGS] };
      },
      getBucketVersioning: async () =>
        state.versioning ? { Status: 'Enabled' } : {},
      getPublicAccessBlock: async () => {
        if (!state.publicAccess) {
          throw awsError('NoSuchPublicAccessBlockConfiguration');
        }
        return publicAccessResponse();
      },
      getBucketOwnershipControls: async () => {
        if (!state.ownership) {
          throw awsError('OwnershipControlsNotFoundError');
        }
        return ownershipResponse();
      },
      getBucketEncryption: async () => {
        if (!state.encryption) {
          throw awsError('ServerSideEncryptionConfigurationNotFoundError');
        }
        return encryptionResponse();
      },
      headObject: async () => {
        if (!state.sentinel) throw awsError('NotFound');
        return sentinelResponse();
      },
      createBucket: async () => {
        state.exists = true;
        state.tags = true;
        throw new Error('lost create response');
      },
      putBucketVersioning: async () => {
        state.versioning = true;
        throw new Error('lost versioning response');
      },
      putPublicAccessBlock: async () => {
        state.publicAccess = true;
        throw new Error('lost public-access response');
      },
      putBucketOwnershipControls: async () => {
        state.ownership = true;
        throw new Error('lost ownership response');
      },
      putBucketEncryption: async () => {
        state.encryption = true;
        throw new Error('lost encryption response');
      },
      putObject: async () => {
        state.sentinel = true;
        throw new Error('lost sentinel response');
      },
    });

    await expect(createBucket(client).bootstrap()).resolves.toMatchObject({
      status: 'active',
      bucketName: BUCKET_NAME,
    });
    expect(client.createBucket).toHaveBeenCalledWith({
      Bucket: BUCKET_NAME,
      ObjectOwnership: 'BucketOwnerEnforced',
      CreateBucketConfiguration: { Tags: REQUIRED_TAGS },
    });
    expect(client.putPublicAccessBlock).toHaveBeenCalledWith({
      Bucket: BUCKET_NAME,
      ExpectedBucketOwner: PROVIDER_SCOPE.accountId,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    expect(client.putBucketOwnershipControls).toHaveBeenCalledWith({
      Bucket: BUCKET_NAME,
      ExpectedBucketOwner: PROVIDER_SCOPE.accountId,
      OwnershipControls: {
        Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }],
      },
    });
    expect(client.putBucketEncryption).toHaveBeenCalledWith({
      Bucket: BUCKET_NAME,
      ExpectedBucketOwner: PROVIDER_SCOPE.accountId,
      ServerSideEncryptionConfiguration: {
        Rules: [
          {
            ApplyServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          },
        ],
      },
    });
    expect(client.putBucketVersioning).toHaveBeenCalledWith({
      Bucket: BUCKET_NAME,
      ExpectedBucketOwner: PROVIDER_SCOPE.accountId,
      VersioningConfiguration: { Status: 'Enabled' },
    });
    expect(client.putObject).toHaveBeenCalledWith({
      Bucket: BUCKET_NAME,
      Key: DEPLOYMENT_CONTROL_BUCKET_VERSIONING_READY_KEY,
      ExpectedBucketOwner: PROVIDER_SCOPE.accountId,
      Body: new Uint8Array(0),
      ContentLength: 0,
      ContentType: 'application/octet-stream',
      ChecksumAlgorithm: 'SHA256',
      ChecksumSHA256:
        DEPLOYMENT_CONTROL_BUCKET_VERSIONING_READY_CHECKSUM_SHA256,
      ServerSideEncryption: 'AES256',
      StorageClass: 'STANDARD',
      Metadata: sentinelMetadata(),
      IfNoneMatch: '*',
    });
  });

  it('retries null writes, 404 propagation, and response loss until HeadObject proves a version', async () => {
    let sentinel = 'absent';
    let propagated404s = 0;
    let writes = 0;
    const waitForReady = jest.fn(async () => {});
    const waitForVersioningPropagation = jest.fn(
      async (/** @type {number} */ _attempt) => {},
    );
    const client = createClient({
      headObject: async () => {
        if (propagated404s > 0) {
          propagated404s -= 1;
          throw awsError('NotFound');
        }
        if (sentinel === 'absent') throw awsError('NotFound');
        return sentinelResponse(PROVIDER_SCOPE, {
          VersionId:
            sentinel === 'unversioned' ? 'null' : 'versioning-ready-version-2',
        });
      },
      putObject: async () => {
        writes += 1;
        if (writes === 1) {
          sentinel = 'unversioned';
          propagated404s = 1;
          return { VersionId: null };
        }
        if (writes === 2) {
          throw awsError('PreconditionFailed');
        }
        sentinel = 'versioned';
        throw new Error('lost versioned sentinel response');
      },
    });

    await expect(
      createBucket(
        client,
        PROVIDER_SCOPE,
        waitForReady,
        waitForVersioningPropagation,
      ).bootstrap(),
    ).resolves.toMatchObject({
      status: 'active',
      versioningWriteReady: true,
    });
    expect(client.putObject).toHaveBeenCalledTimes(3);
    expect(client.putObject.mock.calls[0][0]).toMatchObject({
      IfNoneMatch: '*',
    });
    expect(client.putObject.mock.calls[1][0]).toMatchObject({
      IfNoneMatch: '*',
    });
    expect(client.putObject.mock.calls[2][0]).not.toHaveProperty('IfNoneMatch');
    expect(waitForReady).toHaveBeenCalledTimes(2);
    expect(waitForVersioningPropagation).toHaveBeenCalledTimes(1);
    expect(waitForVersioningPropagation).toHaveBeenCalledWith(1);
  });

  it('waits once and reinspects immediately before the first sentinel write', async () => {
    /** @type {string[]} */
    const events = [];
    let sentinelReady = false;
    const waitForVersioningPropagation = jest.fn(async () => {
      events.push('propagation-wait');
    });
    const client = createClient({
      headObject: async () => {
        events.push('head-object');
        if (!sentinelReady) throw awsError('NotFound');
        return sentinelResponse();
      },
      putObject: async () => {
        events.push('put-object');
        sentinelReady = true;
      },
    });

    await expect(
      createBucket(
        client,
        PROVIDER_SCOPE,
        undefined,
        waitForVersioningPropagation,
      ).bootstrap(),
    ).resolves.toMatchObject({ status: 'active' });

    const barrierIndex = events.indexOf('propagation-wait');
    expect(events.slice(barrierIndex, barrierIndex + 4)).toEqual([
      'propagation-wait',
      'head-object',
      'put-object',
      'head-object',
    ]);
    expect(waitForVersioningPropagation).toHaveBeenCalledTimes(1);
  });

  it('waits a fresh full interval when bootstrap restarts with an unversioned sentinel', async () => {
    let sentinel = 'absent';
    /** @type {string[]} */
    const events = [];
    const firstPropagationWait = jest.fn(async () => {
      events.push('first-propagation-wait');
    });
    const secondPropagationWait = jest.fn(async () => {
      events.push('second-propagation-wait');
    });
    const client = createClient({
      headObject: async () => {
        if (sentinel === 'absent') throw awsError('NotFound');
        return sentinelResponse(PROVIDER_SCOPE, {
          VersionId: sentinel === 'unversioned' ? 'null' : 'versioned',
        });
      },
      putObject: async () => {
        events.push('put-object');
        sentinel = sentinel === 'absent' ? 'unversioned' : 'ready';
      },
    });

    await expect(
      createBucket(
        client,
        PROVIDER_SCOPE,
        async () => {
          throw new Error('stop this invocation after its first write');
        },
        firstPropagationWait,
      ).bootstrap(),
    ).rejects.toBeInstanceOf(DeploymentControlBucketUnknownError);
    expect(sentinel).toBe('unversioned');

    await expect(
      createBucket(
        client,
        PROVIDER_SCOPE,
        async () => {},
        secondPropagationWait,
      ).bootstrap(),
    ).resolves.toMatchObject({ status: 'active' });

    expect(firstPropagationWait).toHaveBeenCalledTimes(1);
    expect(secondPropagationWait).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      'first-propagation-wait',
      'put-object',
      'second-propagation-wait',
      'put-object',
    ]);
    expect(client.putObject.mock.calls[0][0]).toMatchObject({
      IfNoneMatch: '*',
    });
    expect(client.putObject.mock.calls[1][0]).not.toHaveProperty('IfNoneMatch');
  });

  it('skips the propagation interval when inspection is already active', async () => {
    const waitForVersioningPropagation = jest.fn(async () => {});
    const client = createClient();

    await expect(
      createBucket(
        client,
        PROVIDER_SCOPE,
        undefined,
        waitForVersioningPropagation,
      ).bootstrap(),
    ).resolves.toMatchObject({ status: 'active' });

    expect(waitForVersioningPropagation).not.toHaveBeenCalled();
    expect(client.putObject).not.toHaveBeenCalled();
  });

  it('allows unrelated tags without rewriting the retained bucket', async () => {
    const client = createClient({
      getBucketTagging: async () => ({
        TagSet: [...REQUIRED_TAGS, { Key: 'owner', Value: 'platform' }],
      }),
    });

    await expect(createBucket(client).bootstrap()).resolves.toMatchObject({
      status: 'active',
      tagsConform: true,
    });
    expect(client.createBucket).not.toHaveBeenCalled();
  });

  it('bounds post-create ownership-tag propagation before hardening', async () => {
    let exists = false;
    let tagReads = 0;
    const waitForReady = jest.fn(async () => {});
    const client = createClient({
      headBucket: async () => {
        if (!exists) throw awsError('NotFound');
        return {};
      },
      getBucketTagging: async () => {
        tagReads += 1;
        if (tagReads === 1) throw awsError('NoSuchTagSet');
        return { TagSet: [...REQUIRED_TAGS] };
      },
      createBucket: async () => {
        exists = true;
      },
    });

    await expect(
      createBucket(client, PROVIDER_SCOPE, waitForReady).bootstrap(),
    ).resolves.toMatchObject({ status: 'active', tagsConform: true });
    expect(client.createBucket).toHaveBeenCalledTimes(1);
    expect(waitForReady).toHaveBeenCalledTimes(1);
    expect(client.putBucketVersioning).not.toHaveBeenCalled();
  });

  it('resumes a restarted bootstrap while atomic creation tags become visible', async () => {
    let tagReads = 0;
    const waitForReady = jest.fn(async () => {});
    const client = createClient({
      getBucketTagging: async () => {
        tagReads += 1;
        if (tagReads < 3) throw awsError('NoSuchTagSet');
        return { TagSet: [...REQUIRED_TAGS] };
      },
    });

    await expect(
      createBucket(client, PROVIDER_SCOPE, waitForReady).bootstrap(),
    ).resolves.toMatchObject({
      status: 'active',
      tagsConform: true,
      versioningWriteReady: true,
    });
    expect(client.createBucket).not.toHaveBeenCalled();
    expect(client.getBucketTagging).toHaveBeenCalledTimes(3);
    expect(waitForReady).toHaveBeenCalledTimes(2);
  });

  it('retries unknown bootstrap reads while keeping public inspection one-shot', async () => {
    let reads = 0;
    const waitForReady = jest.fn(async () => {});
    const client = createClient({
      getBucketVersioning: async () => {
        reads += 1;
        if (reads === 1) throw awsError('ServiceUnavailable');
        return { Status: 'Enabled' };
      },
    });
    const bucket = createBucket(client, PROVIDER_SCOPE, waitForReady);

    await expect(bucket.inspect()).rejects.toBeInstanceOf(
      DeploymentControlBucketUnknownError,
    );
    expect(waitForReady).not.toHaveBeenCalled();

    reads = 0;
    await expect(bucket.bootstrap()).resolves.toMatchObject({
      status: 'active',
    });
    expect(waitForReady).toHaveBeenCalledTimes(1);
    expect(client.createBucket).not.toHaveBeenCalled();
  });

  it('uses the exact non-us-east-1 creation constraint', async () => {
    const providerScope = createAwsProviderScope({
      partition: 'aws',
      accountId: '123456789012',
      region: 'us-west-2',
    });
    const bucketName = getDeploymentControlBucketName(providerScope);
    let exists = false;
    const client = createClient(
      {
        headBucket: async () => {
          if (!exists) throw awsError('NotFound');
          return {};
        },
        getBucketLocation: async () => ({ LocationConstraint: 'us-west-2' }),
        getBucketTagging: async () => ({
          TagSet: REQUIRED_TAGS.map((tag) =>
            tag.Key === 'wharfie:provider-scope-id'
              ? { ...tag, Value: providerScope.providerScopeId }
              : tag,
          ),
        }),
        createBucket: async () => {
          exists = true;
        },
      },
      providerScope,
    );

    await expect(
      createBucket(client, providerScope).bootstrap(),
    ).resolves.toMatchObject({
      status: 'active',
      bucketName,
    });
    expect(client.createBucket).toHaveBeenCalledWith({
      Bucket: bucketName,
      ObjectOwnership: 'BucketOwnerEnforced',
      CreateBucketConfiguration: {
        LocationConstraint: 'us-west-2',
        Tags: REQUIRED_TAGS.map((tag) =>
          tag.Key === 'wharfie:provider-scope-id'
            ? { ...tag, Value: providerScope.providerScopeId }
            : tag,
        ),
      },
    });
  });

  it('does not take ownership of or close the caller-supplied client', async () => {
    const client = createClient();
    client.close = jest.fn();
    client.destroy = jest.fn();

    const bucket = createBucket(client);
    await bucket.inspect();

    expect(bucket).not.toHaveProperty('close');
    expect(client.close).not.toHaveBeenCalled();
    expect(client.destroy).not.toHaveBeenCalled();
  });
});
