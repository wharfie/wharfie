import { describe, expect, it, jest } from '@jest/globals';

import { createLedgerServiceId } from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
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
import {
  DEPLOYMENT_SERVICE_HEALTH_CACHE_CONTROL,
  DEPLOYMENT_SERVICE_HEALTH_CONTENT_TYPE,
  DEPLOYMENT_SERVICE_HEALTH_DOCUMENT_MAX_BYTES,
  DeploymentServiceHealthConflictError,
  DeploymentServiceHealthMissingError,
  DeploymentServiceHealthStaleError,
  DeploymentServiceHealthUnknownError,
  createDeploymentServiceHealthS3,
  validateDeploymentServiceHealthObservation,
} from '../../src/core/runtime/deployment-service-health-s3.js';
import {
  createDeploymentServiceHealthReceipt,
  getDeploymentServiceHealthObjectLocation,
} from '../../src/core/runtime/deployment-service-health.js';
import {
  createCanonicalJsonSha256Id,
  createSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';

const NOW = 1_800_000_000_000;

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {string} value @returns {{algorithm: 'sha256', value: string}} */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

/** @returns {Readonly<Record<string, any>>} */
function makeFixture() {
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'health-s3-demo',
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
    revisionId: semanticId('wrv1', 'wharfie:test:health-s3-revision:v1', {
      seed: 1,
    }),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: 'health-s3-artifact',
    }),
    profileRevisionId: profile.profileRevisionId,
  };
  const deploymentRevision = Object.freeze({
    ...revisionPayload,
    deploymentRevisionId: semanticId(
      'wdr1',
      'wharfie:deployment-revision:v1',
      revisionPayload,
    ),
  });
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId: '123456789012',
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
    },
    bootstrapDigest: digest('health-s3-bootstrap'),
    runtimeIdentityPolicyDigest: digest('health-s3-runtime-identity'),
  });
  const deploymentInstanceId = getDeploymentInstanceId({
    deploymentRevision,
    providerScope,
  });
  const incarnationId = createDeploymentIncarnationId(Buffer.alloc(32, 17));
  const actionId = semanticId('wda2', 'wharfie:test:health-s3-action:v1', {
    seed: 1,
  });
  const node = createDeploymentResourceBinding({
    schemaVersion: 1,
    kind: 'deploymentResourceBinding',
    deploymentInstanceId,
    incarnationId,
    resourceKey: 'node',
    capability: { kind: 'resident-node', version: 1 },
    management: 'managed',
    providerType: 'ec2-instance',
    providerResourceId: 'i-0123456789abcdef0',
    providerScopeId: providerScope.providerScopeId,
    ownershipNonce: createOwnershipNonce(Buffer.alloc(32, 19)),
    createdByActionId: actionId,
  });
  const head = createDeploymentHead({
    deploymentInstanceId,
    providerScope,
    incarnationId,
    generation: 7,
    phase: 'READY',
    settledDeploymentRevisionId: deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: deploymentRevision.deploymentRevisionId,
    resourceBindings: [node],
    activeOperation: null,
    lastOperation: {
      kind: 'create',
      planId: semanticId('wpl2', 'wharfie:test:health-s3-plan:v1', {
        seed: 1,
      }),
      intents: [
        {
          actionId,
          status: 'settled',
          ownershipNonce: node.ownershipNonce,
        },
      ],
    },
  });
  const context = {
    deploymentRevision,
    profile,
    providerScope,
    providerSpec,
    head,
  };
  return Object.freeze({
    profile,
    deploymentRevision,
    providerScope,
    providerSpec,
    deploymentInstanceId,
    incarnationId,
    node,
    head,
    context,
  });
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function makeReceipt(fixture, overrides = {}) {
  return createDeploymentServiceHealthReceipt({
    providerScopeId: fixture.providerScope.providerScopeId,
    providerSpecId: fixture.providerSpec.providerSpecId,
    deploymentInstanceId: fixture.deploymentInstanceId,
    incarnationId: fixture.incarnationId,
    deploymentOperationId: fixture.head.lastOperation.operationId,
    authorizedHeadId: fixture.head.headId,
    authorizedHeadGeneration: fixture.head.generation,
    nodeBindingId: fixture.node.bindingId,
    nodeProviderResourceId: fixture.node.providerResourceId,
    deploymentRevisionId: fixture.deploymentRevision.deploymentRevisionId,
    appId: fixture.deploymentRevision.appId,
    artifactId: fixture.deploymentRevision.artifactId,
    revisionId: fixture.deploymentRevision.revisionId,
    serviceId: createLedgerServiceId({
      appId: fixture.deploymentRevision.appId,
    }),
    sessionId: semanticId('wss', 'wharfie:test:health-s3-session:v1', {
      seed: 1,
    }),
    lifecycleGeneration: 3,
    ownerGeneration: 4,
    activationRecordVersion: 12,
    activationSelectionGeneration: 2,
    processId: 4242,
    sequence: 1,
    health: 'healthy',
    ...overrides,
  });
}

/** @param {Readonly<Record<string, any>>} receipt @param {Record<string, any>} overrides */
function successor(receipt, overrides) {
  const {
    schemaVersion: _schemaVersion,
    kind: _kind,
    receiptId: _receiptId,
    ...input
  } = clone(receipt);
  return createDeploymentServiceHealthReceipt({ ...input, ...overrides });
}

/** @param {Readonly<Record<string, any>>} receipt @param {number} version @param {number} lastModifiedAt @returns {Record<string, any>} */
function makeStoredObject(receipt, version, lastModifiedAt) {
  const Body = Buffer.from(JSON.stringify(receipt), 'utf8');
  const checksum = Buffer.from(sha256Base64Url(Body), 'base64url').toString(
    'base64',
  );
  return {
    Body,
    VersionId: `version-${version}`,
    ETag: `"opaque-${version}"`,
    LastModified: new Date(lastModifiedAt),
    ContentLength: Body.byteLength,
    ChecksumSHA256: checksum,
    ServerSideEncryption: 'AES256',
    StorageClass: 'STANDARD',
    ContentType: DEPLOYMENT_SERVICE_HEALTH_CONTENT_TYPE,
    CacheControl: DEPLOYMENT_SERVICE_HEALTH_CACHE_CONTROL,
    Metadata: {
      'wharfie-schema': 'deployment-service-health-v1',
      'wharfie-receipt': receipt.receiptId,
    },
  };
}

/** @param {{receipt?: Readonly<Record<string, any>>, lastModifiedAt?: number, throwAfterPut?: boolean}} [options] */
function makeClient(options = {}) {
  let version = options.receipt ? 1 : 0;
  let current = options.receipt
    ? makeStoredObject(options.receipt, version, options.lastModifiedAt ?? NOW)
    : null;
  let throwAfterPut = options.throwAfterPut ?? false;
  const getObject = jest.fn(
    async (/** @type {Record<string, any>} */ _request) => {
      if (current === null) {
        throw Object.assign(new Error('absent'), {
          name: 'NoSuchKey',
          $metadata: { httpStatusCode: 404 },
        });
      }
      return { ...current, Body: Buffer.from(current.Body) };
    },
  );
  const headObject = jest.fn(
    async (/** @type {Record<string, any>} */ _request) => {
      if (current === null) {
        throw Object.assign(new Error('absent'), {
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        });
      }
      const { Body: _Body, ...head } = current;
      return { ...head };
    },
  );
  const putObject = jest.fn(
    async (/** @type {Record<string, any>} */ request) => {
      if (request.IfNoneMatch === '*' && current !== null) {
        throw Object.assign(new Error('occupied'), {
          name: 'PreconditionFailed',
        });
      }
      if (request.IfMatch !== undefined && request.IfMatch !== current?.ETag) {
        throw Object.assign(new Error('changed'), {
          name: 'PreconditionFailed',
        });
      }
      version += 1;
      const receipt = JSON.parse(Buffer.from(request.Body).toString('utf8'));
      current = makeStoredObject(receipt, version, NOW);
      if (throwAfterPut) {
        throwAfterPut = false;
        throw new Error('response lost');
      }
      return { VersionId: current.VersionId, ETag: current.ETag };
    },
  );
  return {
    client: { getObject, headObject, putObject },
    get current() {
      return current;
    },
    set current(value) {
      current = value;
    },
  };
}

describe('deployment service-health S3 transport', () => {
  it('publishes the first receipt conditionally and independently inspects fresh provider evidence', async () => {
    const fixture = makeFixture();
    const receipt = makeReceipt(fixture);
    const harness = makeClient();
    const health = createDeploymentServiceHealthS3({
      client: harness.client,
      providerScope: fixture.providerScope,
      now: () => NOW,
    });

    const published = await health.publish(receipt, fixture.context);
    const inspected = await health.inspect(fixture.context);
    const stored = harness.current;
    if (stored === null) throw new Error('Expected published object.');

    expect(published).toEqual(inspected);
    expect(
      validateDeploymentServiceHealthObservation(clone(inspected)),
    ).toEqual(inspected);
    expect(Object.isFrozen(inspected)).toBe(true);
    expect(inspected.object).toMatchObject({
      ...getDeploymentServiceHealthObjectLocation(
        fixture.providerScope,
        receipt,
      ),
      versionId: 'version-1',
      etag: '"opaque-1"',
      lastModifiedAt: NOW,
    });
    expect(harness.client.putObject).toHaveBeenCalledWith({
      Bucket: inspected.object.bucketName,
      Key: inspected.object.key,
      Body: expect.any(Buffer),
      ContentLength: Buffer.byteLength(JSON.stringify(receipt)),
      ChecksumAlgorithm: 'SHA256',
      ChecksumSHA256: stored.ChecksumSHA256,
      ServerSideEncryption: 'AES256',
      StorageClass: 'STANDARD',
      ContentType: DEPLOYMENT_SERVICE_HEALTH_CONTENT_TYPE,
      CacheControl: 'no-store',
      ExpectedBucketOwner: fixture.providerScope.accountId,
      Metadata: {
        'wharfie-schema': 'deployment-service-health-v1',
        'wharfie-receipt': receipt.receiptId,
      },
      IfNoneMatch: '*',
    });
    expect(harness.client.getObject).toHaveBeenLastCalledWith({
      Bucket: inspected.object.bucketName,
      Key: inspected.object.key,
      ChecksumMode: 'ENABLED',
      ExpectedBucketOwner: fixture.providerScope.accountId,
    });
  });

  it('uses the opaque current ETag for successors and resolves a lost Put response by readback', async () => {
    const fixture = makeFixture();
    const first = makeReceipt(fixture);
    const second = successor(first, { sequence: 2 });
    const harness = makeClient({ receipt: first, throwAfterPut: true });
    const health = createDeploymentServiceHealthS3({
      client: harness.client,
      providerScope: fixture.providerScope,
      now: () => NOW,
    });

    await expect(
      health.publish(second, fixture.context),
    ).resolves.toMatchObject({
      receipt: { receiptId: second.receiptId },
      object: { versionId: 'version-2' },
    });
    expect(harness.client.putObject.mock.calls[0][0]).toMatchObject({
      IfMatch: '"opaque-1"',
    });
    expect(harness.client.putObject.mock.calls[0][0]).not.toHaveProperty(
      'IfNoneMatch',
    );
  });

  it('fails closed for absent, stale, future, and corrupted current evidence', async () => {
    const fixture = makeFixture();
    const receipt = makeReceipt(fixture);
    const absent = makeClient();
    const stale = makeClient({
      receipt,
      lastModifiedAt: NOW - 65_001,
    });
    const future = makeClient({ receipt, lastModifiedAt: NOW + 5_001 });
    const corrupted = makeClient({ receipt });
    const corruptedObject = corrupted.current;
    if (corruptedObject === null) throw new Error('Expected seeded object.');
    corruptedObject.Metadata = { ...corruptedObject.Metadata, extra: 'x' };

    /** @param {Record<string, any>} client */
    const options = (client) => ({
      client,
      providerScope: fixture.providerScope,
      now: () => NOW,
    });
    await expect(
      createDeploymentServiceHealthS3(options(absent.client)).inspect(
        fixture.context,
      ),
    ).rejects.toBeInstanceOf(DeploymentServiceHealthMissingError);
    await expect(
      createDeploymentServiceHealthS3(options(stale.client)).inspect(
        fixture.context,
      ),
    ).rejects.toBeInstanceOf(DeploymentServiceHealthStaleError);
    await expect(
      createDeploymentServiceHealthS3(options(future.client)).inspect(
        fixture.context,
      ),
    ).rejects.toBeInstanceOf(DeploymentServiceHealthConflictError);
    await expect(
      createDeploymentServiceHealthS3(options(corrupted.client)).inspect(
        fixture.context,
      ),
    ).rejects.toBeInstanceOf(DeploymentServiceHealthConflictError);
  });

  it('accepts the exact 65-second stale and 5-second future freshness boundaries', async () => {
    const fixture = makeFixture();
    const receipt = makeReceipt(fixture);

    for (const lastModifiedAt of [NOW - 65_000, NOW + 5_000]) {
      const harness = makeClient({ receipt, lastModifiedAt });
      const health = createDeploymentServiceHealthS3({
        client: harness.client,
        providerScope: fixture.providerScope,
        now: () => NOW,
      });

      await expect(health.inspect(fixture.context)).resolves.toMatchObject({
        object: { lastModifiedAt },
      });
    }
  });

  it('retries when Get and Head observe different current versions', async () => {
    const fixture = makeFixture();
    const first = makeReceipt(fixture);
    const second = successor(first, { sequence: 2 });
    const harness = makeClient({ receipt: first });
    const secondObject = makeStoredObject(second, 2, NOW);
    harness.client.headObject.mockImplementationOnce(async () => {
      harness.current = secondObject;
      const { Body: _Body, ...head } = secondObject;
      return head;
    });
    const health = createDeploymentServiceHealthS3({
      client: harness.client,
      providerScope: fixture.providerScope,
      now: () => NOW,
    });

    await expect(health.inspect(fixture.context)).resolves.toMatchObject({
      receipt: { receiptId: second.receiptId },
      object: { versionId: 'version-2' },
    });
    expect(harness.client.getObject).toHaveBeenCalledTimes(2);
    expect(harness.client.headObject).toHaveBeenCalledTimes(2);
  });

  it('rejects Get and Head envelope disagreement for the same version', async () => {
    const fixture = makeFixture();
    const receipt = makeReceipt(fixture);
    const harness = makeClient({ receipt });
    harness.client.headObject.mockImplementationOnce(async () => {
      const stored = harness.current;
      if (stored === null) throw new Error('Expected seeded object.');
      const { Body: _Body, ...head } = stored;
      return { ...head, ETag: '"different-opaque-etag"' };
    });
    const health = createDeploymentServiceHealthS3({
      client: harness.client,
      providerScope: fixture.providerScope,
      now: () => NOW,
    });

    await expect(health.inspect(fixture.context)).rejects.toBeInstanceOf(
      DeploymentServiceHealthConflictError,
    );
    expect(harness.client.getObject).toHaveBeenCalledTimes(1);
    expect(harness.client.headObject).toHaveBeenCalledTimes(1);
  });

  it('reports Unknown after bounded Get and Head version-race exhaustion', async () => {
    const fixture = makeFixture();
    const receipt = makeReceipt(fixture);
    const harness = makeClient({ receipt });
    harness.client.headObject.mockImplementation(async () => {
      const stored = harness.current;
      if (stored === null) throw new Error('Expected seeded object.');
      const { Body: _Body, ...head } = stored;
      return { ...head, VersionId: 'racing-version' };
    });
    const health = createDeploymentServiceHealthS3({
      client: harness.client,
      providerScope: fixture.providerScope,
      now: () => NOW,
      maxAttempts: 2,
    });

    await expect(health.inspect(fixture.context)).rejects.toBeInstanceOf(
      DeploymentServiceHealthUnknownError,
    );
    expect(harness.client.getObject).toHaveBeenCalledTimes(2);
    expect(harness.client.headObject).toHaveBeenCalledTimes(2);
  });

  it('rejects noninitial creation and adopts an already-current valid successor without writing', async () => {
    const fixture = makeFixture();
    const first = makeReceipt(fixture);
    const noninitial = successor(first, { sequence: 2 });
    const missing = makeClient();
    const occupied = makeClient({ receipt: noninitial });
    /** @param {Record<string, any>} client */
    const create = (client) =>
      createDeploymentServiceHealthS3({
        client,
        providerScope: fixture.providerScope,
        now: () => NOW,
      });

    await expect(
      create(missing.client).publish(noninitial, fixture.context),
    ).rejects.toBeInstanceOf(DeploymentServiceHealthConflictError);
    await expect(
      create(occupied.client).publish(first, fixture.context),
    ).resolves.toMatchObject({ receipt: { receiptId: noninitial.receiptId } });
    expect(missing.client.putObject).not.toHaveBeenCalled();
    expect(occupied.client.putObject).not.toHaveBeenCalled();
  });

  it('adopts an already-valid successor after losing a conditional write race', async () => {
    const fixture = makeFixture();
    const first = makeReceipt(fixture);
    const candidate = successor(first, { sequence: 2 });
    const winner = successor(candidate, { sequence: 3 });
    const harness = makeClient({ receipt: first });
    harness.client.putObject.mockImplementationOnce(async () => {
      harness.current = makeStoredObject(winner, 3, NOW);
      throw Object.assign(new Error('conditional write lost'), {
        name: 'PreconditionFailed',
        $metadata: { httpStatusCode: 412 },
      });
    });
    const health = createDeploymentServiceHealthS3({
      client: harness.client,
      providerScope: fixture.providerScope,
      now: () => NOW,
    });

    await expect(
      health.publish(candidate, fixture.context),
    ).resolves.toMatchObject({
      receipt: { receiptId: winner.receiptId },
      object: { versionId: 'version-3' },
    });
    expect(harness.client.putObject).toHaveBeenCalledTimes(1);
  });

  it('does not adopt a structural successor authorized by a future head', async () => {
    const fixture = makeFixture();
    const candidate = makeReceipt(fixture);
    const future = successor(candidate, {
      authorizedHeadGeneration: fixture.head.generation + 1,
      authorizedHeadId: semanticId(
        'wdh1',
        'wharfie:test:health-s3-future-head:v1',
        { seed: 1 },
      ),
      sequence: 2,
    });
    const harness = makeClient({ receipt: future });
    const health = createDeploymentServiceHealthS3({
      client: harness.client,
      providerScope: fixture.providerScope,
      now: () => NOW,
    });

    await expect(
      health.publish(candidate, fixture.context),
    ).rejects.toBeInstanceOf(DeploymentServiceHealthConflictError);
    expect(harness.client.putObject).not.toHaveBeenCalled();
  });

  it('requires every newly published receipt to name the exact current head', async () => {
    const fixture = makeFixture();
    const olderHeadReceipt = makeReceipt(fixture, {
      authorizedHeadGeneration: fixture.head.generation - 1,
      authorizedHeadId: semanticId(
        'wdh1',
        'wharfie:test:health-s3-older-head:v1',
        { seed: 1 },
      ),
    });
    const harness = makeClient();
    const health = createDeploymentServiceHealthS3({
      client: harness.client,
      providerScope: fixture.providerScope,
      now: () => NOW,
    });

    await expect(
      health.publish(olderHeadReceipt, fixture.context),
    ).rejects.toBeInstanceOf(DeploymentServiceHealthConflictError);
    expect(harness.client.getObject).not.toHaveBeenCalled();
    expect(harness.client.putObject).not.toHaveBeenCalled();
  });

  it('destroys an unread response body when declared size is rejected', async () => {
    const fixture = makeFixture();
    const receipt = makeReceipt(fixture);
    const harness = makeClient({ receipt });
    const stored = harness.current;
    if (stored === null) throw new Error('Expected seeded object.');
    const destroy = jest.fn();
    const Body = {
      destroy,
      async *[Symbol.asyncIterator]() {
        yield stored.Body;
      },
    };
    harness.client.getObject.mockImplementationOnce(
      async () =>
        /** @type {any} */ ({
          ...stored,
          Body,
          ContentLength: DEPLOYMENT_SERVICE_HEALTH_DOCUMENT_MAX_BYTES + 1,
        }),
    );
    const health = createDeploymentServiceHealthS3({
      client: harness.client,
      providerScope: fixture.providerScope,
      now: () => NOW,
    });

    await expect(health.inspect(fixture.context)).rejects.toBeInstanceOf(
      DeploymentServiceHealthConflictError,
    );
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(harness.client.headObject).not.toHaveBeenCalled();
  });

  it('destroys a streamed response body when its actual size overflows', async () => {
    const fixture = makeFixture();
    const receipt = makeReceipt(fixture);
    const harness = makeClient({ receipt });
    const stored = harness.current;
    if (stored === null) throw new Error('Expected seeded object.');
    const destroy = jest.fn();
    const Body = {
      destroy,
      async *[Symbol.asyncIterator]() {
        yield Buffer.alloc(DEPLOYMENT_SERVICE_HEALTH_DOCUMENT_MAX_BYTES);
        yield Buffer.alloc(1);
      },
    };
    harness.client.getObject.mockImplementationOnce(
      async () =>
        /** @type {any} */ ({
          ...stored,
          Body,
          ContentLength: DEPLOYMENT_SERVICE_HEALTH_DOCUMENT_MAX_BYTES,
        }),
    );
    const health = createDeploymentServiceHealthS3({
      client: harness.client,
      providerScope: fixture.providerScope,
      now: () => NOW,
    });

    await expect(health.inspect(fixture.context)).rejects.toBeInstanceOf(
      DeploymentServiceHealthConflictError,
    );
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(harness.client.headObject).not.toHaveBeenCalled();
  });

  it('destroys an iterator-failed response body and reports Unknown', async () => {
    const fixture = makeFixture();
    const receipt = makeReceipt(fixture);
    const harness = makeClient({ receipt });
    const stored = harness.current;
    if (stored === null) throw new Error('Expected seeded object.');
    const destroy = jest.fn();
    const Body = {
      destroy,
      async *[Symbol.asyncIterator]() {
        yield stored.Body.subarray(0, 1);
        throw new Error('body stream interrupted');
      },
    };
    harness.client.getObject.mockImplementationOnce(
      async () => /** @type {any} */ ({ ...stored, Body }),
    );
    const health = createDeploymentServiceHealthS3({
      client: harness.client,
      providerScope: fixture.providerScope,
      now: () => NOW,
    });

    await expect(health.inspect(fixture.context)).rejects.toBeInstanceOf(
      DeploymentServiceHealthUnknownError,
    );
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(harness.client.headObject).not.toHaveBeenCalled();
  });
});
