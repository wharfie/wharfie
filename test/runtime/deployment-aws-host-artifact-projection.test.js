import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  createAwsSingleNodeHostActivationRequest,
  validateAwsSingleNodeHostActivationRequest,
} from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import { getAwsSingleNodeHostActivationIntentId } from '../../src/core/runtime/deployment-aws-host-activation.js';
import {
  AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_MAX_DIRECTORY_ENTRIES,
  AwsSingleNodeHostArtifactProjectionConflictError,
  AwsSingleNodeHostArtifactProjectionTimeoutError,
  AwsSingleNodeHostArtifactProjectionUnknownError,
  createAwsSingleNodeHostArtifactProjectionAdapter,
  getAwsSingleNodeHostArtifactProjectionLayout,
} from '../../src/core/runtime/deployment-aws-host-artifact-projection.js';
import { getAwsSingleNodeManagedArtifactStateDigest } from '../../src/core/runtime/deployment-aws-managed-artifact-evidence.js';
import {
  DEPLOYMENT_REVISION_ID_DOMAIN,
  DEPLOYMENT_REVISION_ID_PREFIX,
} from '../../src/core/runtime/deployment-revision.js';
import {
  clone,
  expectDeepFrozen,
  makeFixture,
  reidentifyRequest,
} from './fixtures/deployment-aws-host-activation.js';
import { createAwsSingleNodeHostSettledStorageFixture } from './fixtures/deployment-aws-host-settled-storage.js';

/** @typedef {Record<string, any>} AnyRecord */

/** @type {string[]} */
const temporaryRoots = [];
/** @type {WeakMap<Readonly<AnyRecord>, Readonly<AnyRecord>>} */
const settledStorageByRequest = new WeakMap();

/** @param {Readonly<AnyRecord>} request @returns {Promise<void>} */
async function prepareSettledStorage(request) {
  if (settledStorageByRequest.has(request)) return;
  const storage = await createAwsSingleNodeHostSettledStorageFixture(request);
  settledStorageByRequest.set(request, storage.priorEvidence);
}

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fsp.rm(root, { recursive: true, force: true })),
  );
});

/** @param {AnyRecord} value @returns {Readonly<AnyRecord>} */
function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') {
      deepFreeze(/** @type {AnyRecord} */ (child));
    }
  }
  return Object.freeze(value);
}

/** @param {Buffer} bytes @returns {{fixture: Readonly<AnyRecord>, request: Readonly<AnyRecord>}} */
function makeRequestForBytes(bytes) {
  const fixture = makeFixture();
  const original = createAwsSingleNodeHostActivationRequest(
    fixture.requestContext,
  );
  const digest = sha256Base64Url(bytes);
  const artifactId = `waf1_${digest}`;
  const revisionPayload = clone(fixture.deploymentRevision);
  delete revisionPayload.deploymentRevisionId;
  revisionPayload.artifactId = artifactId;
  const deploymentRevisionId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_REVISION_ID_DOMAIN,
    prefix: DEPLOYMENT_REVISION_ID_PREFIX,
    value: revisionPayload,
  });
  const deploymentRevision = {
    ...revisionPayload,
    deploymentRevisionId,
  };
  const stateDigest = getAwsSingleNodeManagedArtifactStateDigest({
    deploymentRevision,
    profile: fixture.profile,
    providerScope: fixture.providerScope,
    providerSpec: fixture.providerSpec,
    deploymentInstanceId: fixture.deploymentInstanceId,
    incarnationId: fixture.incarnationId,
  });
  const request = validateAwsSingleNodeHostActivationRequest(
    reidentifyRequest({
      ...clone(original),
      deploymentRevisionId,
      artifactId,
      artifact: {
        ...clone(original.artifact),
        contentLength: bytes.byteLength,
        byteDigest: { algorithm: 'sha256', value: digest },
        stateDigest,
      },
    }),
  );
  return { fixture, request };
}

/** @param {Readonly<AnyRecord>} request @param {number} [attemptGeneration] @param {AnyRecord} [overrides] @returns {Readonly<AnyRecord>} */
function makeContext(request, attemptGeneration = 1, overrides = {}) {
  const priorEvidence = settledStorageByRequest.get(request);
  if (priorEvidence === undefined) {
    throw new Error('settled storage fixture is missing for request');
  }
  return deepFreeze({
    request,
    step: {
      intentId: getAwsSingleNodeHostActivationIntentId(
        request,
        'artifact-projection',
      ),
      kind: 'artifact-projection',
      attemptGeneration,
    },
    priorEvidence,
    ...overrides,
  });
}

/**
 * @param {Readonly<AnyRecord>} fixture
 * @param {Readonly<AnyRecord>} request
 * @param {unknown} body
 * @param {AnyRecord} [overrides]
 * @returns {AnyRecord}
 */
function makeGetResponse(fixture, request, body, overrides = {}) {
  const metadata = {
    ...clone(fixture.managedArtifact.metadata),
    'wharfie-state-digest': request.artifact.stateDigest.value,
    'wharfie-deployment-revision-id': request.deploymentRevisionId,
    'wharfie-artifact-id': request.artifactId,
    'wharfie-content-length': String(request.artifact.contentLength),
  };
  return {
    VersionId: request.artifact.versionId,
    ETag: request.artifact.etag,
    ContentLength: request.artifact.contentLength,
    ChecksumSHA256: Buffer.from(
      request.artifact.byteDigest.value,
      'base64url',
    ).toString('base64'),
    ChecksumType: 'FULL_OBJECT',
    ServerSideEncryption: 'AES256',
    StorageClass: 'STANDARD',
    ContentType: 'application/octet-stream',
    CacheControl: 'no-store',
    Metadata: metadata,
    Body: body,
    ...overrides,
  };
}

/** @param {Buffer[]} chunks @returns {{body: AnyRecord, destroy: jest.Mock<() => void>}} */
function makeBody(chunks) {
  const destroy = jest.fn(function destroy() {
    this.destroyed = true;
  });
  const body = {
    destroyed: false,
    readableEnded: false,
    destroy,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
      this.readableEnded = true;
    },
  };
  return { body, destroy };
}

/** @param {Readonly<AnyRecord>} request @param {AnyRecord} response @param {AnyRecord} [overrides] @returns {Promise<{adapter: Readonly<AnyRecord>, root: string, calls: AnyRecord[]}>} */
async function makeAdapter(request, response, overrides = {}) {
  await prepareSettledStorage(request);
  const base = await fsp.mkdtemp(
    path.join(tmpdir(), 'wharfie-host-artifact-projection-'),
  );
  temporaryRoots.push(base);
  await fsp.chmod(base, 0o700);
  const root = path.join(base, 'projection');
  /** @type {AnyRecord[]} */
  const calls = [];
  const client = {
    async getObject(
      /** @type {AnyRecord} */ input,
      /** @type {AnyRecord} */ callOptions,
    ) {
      calls.push({ receiver: this, input, callOptions });
      return response;
    },
  };
  const adapter = createAwsSingleNodeHostArtifactProjectionAdapter({
    client,
    root,
    testOnlyRoot: true,
    expectedUid: process.getuid?.() ?? 0,
    runtimeGid: (process.getgid?.() ?? 0) || 1,
    ...overrides,
  });
  return { adapter, root, calls };
}

describe('AWS single-node host artifact projection', () => {
  it('streams, verifies, atomically publishes, and replays one exact S3 version', async () => {
    const bytes = Buffer.from(
      'exact portable SEA bytes for artifact projection',
      'utf8',
    );
    const { fixture, request } = makeRequestForBytes(bytes);
    const { body, destroy } = makeBody([
      bytes.subarray(0, 7),
      bytes.subarray(7, 19),
      bytes.subarray(19),
    ]);
    const response = makeGetResponse(fixture, request, body);
    const { adapter, root, calls } = await makeAdapter(request, response);
    const context = makeContext(request);

    await expect(adapter.observe(makeContext(request, 0))).resolves.toEqual({
      status: 'ready',
    });
    await expect(adapter.converge(context)).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0].receiver).not.toBeUndefined();
    expect(calls[0].input).toEqual({
      Bucket: request.artifact.bucketName,
      Key: request.artifact.key,
      VersionId: request.artifact.versionId,
      ExpectedBucketOwner: request.providerScope.accountId,
      ChecksumMode: 'ENABLED',
      IfMatch: request.artifact.etag,
    });
    expect(Object.isFrozen(calls[0].input)).toBe(true);
    expect(calls[0].callOptions.abortSignal).toBeInstanceOf(AbortSignal);
    expect(Object.isFrozen(calls[0].callOptions)).toBe(true);
    expect(destroy).not.toHaveBeenCalled();

    const observation = await adapter.observe(makeContext(request, 0));
    const layout = getAwsSingleNodeHostArtifactProjectionLayout(request, root);
    expect(observation).toEqual({
      status: 'settled',
      evidence: {
        schemaVersion:
          AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_SCHEMA_VERSION,
        kind: AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_KIND,
        requestId: request.requestId,
        deploymentInstanceId: request.deploymentInstanceId,
        appId: request.appId,
        artifactId: request.artifactId,
        revisionId: request.revisionId,
        targetId: request.targetId,
        contentLength: bytes.byteLength,
        byteDigest: request.artifact.byteDigest,
        artifactPath: layout.artifactPath,
      },
    });
    expect(JSON.stringify(observation)).not.toContain(
      request.artifact.versionId,
    );
    expect(JSON.stringify(observation)).not.toContain(request.artifact.etag);
    expectDeepFrozen(observation);
    expect(
      adapter.validateEvidence(
        clone(observation.evidence),
        makeContext(request, 0),
      ),
    ).toEqual(observation.evidence);

    expect(await fsp.readFile(layout.artifactPath)).toEqual(bytes);
    const artifactStats = await fsp.lstat(layout.artifactPath);
    const recordStats = await fsp.lstat(layout.recordPath);
    expect(artifactStats.mode & 0o777).toBe(0o550);
    expect(recordStats.mode & 0o777).toBe(0o440);
    expect(artifactStats.nlink).toBe(1);
    expect(recordStats.nlink).toBe(1);
    expect(artifactStats.gid).toBe((process.getgid?.() ?? 0) || 1);

    await expect(adapter.converge(context)).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('recovers a rename response loss from exact final readback and removes its stable temp path', async () => {
    const bytes = Buffer.from('response loss artifact bytes', 'utf8');
    const { fixture, request } = makeRequestForBytes(bytes);
    const { body } = makeBody([bytes]);
    const response = makeGetResponse(fixture, request, body);
    const responseLosingFs = Object.create(fsp);
    responseLosingFs.rename = async (
      /** @type {string} */ oldPath,
      /** @type {string} */ newPath,
    ) => {
      await fsp.rename(oldPath, newPath);
      throw new Error('rename response was lost');
    };
    const { adapter, root, calls } = await makeAdapter(request, response, {
      fsOps: responseLosingFs,
    });

    await expect(
      adapter.converge(makeContext(request)),
    ).resolves.toBeUndefined();
    await expect(
      adapter.observe(makeContext(request, 0)),
    ).resolves.toMatchObject({
      status: 'settled',
    });
    expect(calls).toHaveLength(1);
    const layout = getAwsSingleNodeHostArtifactProjectionLayout(request, root);
    await expect(
      fsp.lstat(
        path.join(layout.deploymentDirectory, `.${request.requestId}.tmp`),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps post-rename parent-fsync failure poisoned until one successful durability repair', async () => {
    const bytes = Buffer.from('parent fsync recovery bytes', 'utf8');
    const { fixture, request } = makeRequestForBytes(bytes);
    const { body } = makeBody([bytes]);
    const response = makeGetResponse(fixture, request, body);
    const durabilityFailingFs = Object.create(fsp);
    let deploymentDirectory = '';
    let failDeploymentSync = false;
    durabilityFailingFs.open = async (
      /** @type {string} */ filePath,
      /** @type {number|string} */ flags,
      /** @type {number|undefined} */ mode,
    ) => {
      const handle = await fsp.open(filePath, flags, mode);
      if (filePath !== deploymentDirectory || !failDeploymentSync) {
        return handle;
      }
      return {
        sync: async () => {
          throw new Error('parent fsync response is unknown');
        },
        close: handle.close.bind(handle),
      };
    };
    durabilityFailingFs.rename = async (
      /** @type {string} */ oldPath,
      /** @type {string} */ newPath,
    ) => {
      await fsp.rename(oldPath, newPath);
      failDeploymentSync = true;
    };
    const { adapter, root } = await makeAdapter(request, response, {
      fsOps: durabilityFailingFs,
    });
    deploymentDirectory = getAwsSingleNodeHostArtifactProjectionLayout(
      request,
      root,
    ).deploymentDirectory;

    await expect(adapter.converge(makeContext(request))).rejects.toBeInstanceOf(
      AwsSingleNodeHostArtifactProjectionUnknownError,
    );
    await expect(adapter.observe(makeContext(request, 0))).resolves.toEqual({
      status: 'unknown',
    });
    failDeploymentSync = false;
    await expect(
      adapter.observe(makeContext(request, 0)),
    ).resolves.toMatchObject({
      status: 'settled',
    });
  });

  it('re-proves existing-final namespace repair durability after adapter recreation', async () => {
    const bytes = Buffer.from('namespace repair recovery bytes', 'utf8');
    const { fixture, request } = makeRequestForBytes(bytes);
    const { body } = makeBody([bytes]);
    const response = makeGetResponse(fixture, request, body);
    const durabilityFailingFs = Object.create(fsp);
    let root = '';
    let failRootSync = false;
    durabilityFailingFs.open = async (
      /** @type {string} */ filePath,
      /** @type {number|string} */ flags,
      /** @type {number|undefined} */ mode,
    ) => {
      const handle = await fsp.open(filePath, flags, mode);
      if (filePath !== root) return handle;
      return {
        sync: async () => {
          if (failRootSync) {
            throw new Error('root fsync response is unknown');
          }
          await handle.sync();
        },
        close: handle.close.bind(handle),
      };
    };
    const created = await makeAdapter(request, response, {
      fsOps: durabilityFailingFs,
    });
    root = created.root;
    const { adapter, calls } = created;

    await adapter.converge(makeContext(request));
    expect(calls).toHaveLength(1);
    await fsp.chmod(root, 0o700);
    failRootSync = true;

    await expect(adapter.converge(makeContext(request))).rejects.toBeInstanceOf(
      AwsSingleNodeHostArtifactProjectionUnknownError,
    );
    expect((await fsp.lstat(root)).mode & 0o777).toBe(0o750);
    const recreatedGetObject = jest.fn(async () => response);
    const recreated = createAwsSingleNodeHostArtifactProjectionAdapter({
      client: { getObject: recreatedGetObject },
      root,
      testOnlyRoot: true,
      expectedUid: process.getuid?.() ?? 0,
      runtimeGid: (process.getgid?.() ?? 0) || 1,
      fsOps: durabilityFailingFs,
    });
    await expect(recreated.observe(makeContext(request, 0))).resolves.toEqual({
      status: 'unknown',
    });

    failRootSync = false;
    await expect(
      recreated.observe(makeContext(request, 0)),
    ).resolves.toMatchObject({
      status: 'settled',
    });
    expect(calls).toHaveLength(1);
    expect(recreatedGetObject).not.toHaveBeenCalled();
  });

  it('forces bounded authenticated stale-temp collection without deleting immutable finals', async () => {
    const bytes = Buffer.from('stale temp collection bytes', 'utf8');
    const { fixture, request } = makeRequestForBytes(bytes);
    const firstBody = makeBody([bytes]);
    const response = makeGetResponse(fixture, request, firstBody.body);
    const { adapter, root, calls } = await makeAdapter(request, response);
    await adapter.converge(makeContext(request));
    const layout = getAwsSingleNodeHostArtifactProjectionLayout(request, root);
    const stale = path.join(
      layout.deploymentDirectory,
      `.whaq1_${'A'.repeat(43)}.tmp`,
    );
    await fsp.mkdir(stale, { mode: 0o700 });

    await expect(adapter.observe(makeContext(request, 0))).resolves.toEqual({
      status: 'ready',
    });
    await expect(
      adapter.converge(makeContext(request)),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    await expect(fsp.lstat(stale)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.lstat(layout.projectionDirectory)).resolves.toMatchObject({
      mode: expect.any(Number),
    });
  });

  it('does not add a publication entry when the immutable namespace is at its cap', async () => {
    const bytes = Buffer.from('at-cap artifact bytes', 'utf8');
    const { fixture, request } = makeRequestForBytes(bytes);
    const { body } = makeBody([bytes]);
    const response = makeGetResponse(fixture, request, body);
    const { adapter, root, calls } = await makeAdapter(request, response);
    const layout = getAwsSingleNodeHostArtifactProjectionLayout(request, root);
    const expectedUid = process.getuid?.() ?? 0;
    const runtimeGid = (process.getgid?.() ?? 0) || 1;
    await fsp.mkdir(layout.deploymentDirectory, {
      recursive: true,
      mode: 0o750,
    });
    for (const directory of [root, layout.deploymentDirectory]) {
      await fsp.chown(directory, expectedUid, runtimeGid);
      await fsp.chmod(directory, 0o750);
    }
    for (
      let index = 0;
      index < AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_MAX_DIRECTORY_ENTRIES;
      index += 1
    ) {
      const finalDirectory = path.join(
        layout.deploymentDirectory,
        `whaq1_${index.toString(36).padStart(3, '0')}${'A'.repeat(40)}`,
      );
      await fsp.mkdir(finalDirectory, { mode: 0o750 });
      await fsp.chown(finalDirectory, expectedUid, runtimeGid);
      await fsp.chmod(finalDirectory, 0o750);
    }

    await expect(adapter.converge(makeContext(request))).rejects.toBeInstanceOf(
      AwsSingleNodeHostArtifactProjectionUnknownError,
    );
    expect(calls).toHaveLength(0);
    expect(await fsp.readdir(layout.deploymentDirectory)).toHaveLength(
      AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_MAX_DIRECTORY_ENTRIES,
    );
    await expect(fsp.lstat(layout.projectionDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(adapter.observe(makeContext(request, 0))).resolves.toEqual({
      status: 'ready',
    });
  });

  it('rejects an overlong body, destroys it once, and publishes no final directory', async () => {
    const bytes = Buffer.from('bounded artifact bytes', 'utf8');
    const { fixture, request } = makeRequestForBytes(bytes);
    const { body, destroy } = makeBody([
      bytes,
      Buffer.from('unexpected-extra-byte'),
    ]);
    const response = makeGetResponse(fixture, request, body);
    const { adapter, root } = await makeAdapter(request, response);

    await expect(adapter.converge(makeContext(request))).rejects.toBeInstanceOf(
      AwsSingleNodeHostArtifactProjectionConflictError,
    );
    expect(destroy).toHaveBeenCalledTimes(1);
    const layout = getAwsSingleNodeHostArtifactProjectionLayout(request, root);
    await expect(fsp.lstat(layout.projectionDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects rapid zero-length iterator chunks and performs bounded cleanup', async () => {
    const bytes = Buffer.from('progress-bound artifact bytes', 'utf8');
    const { fixture, request } = makeRequestForBytes(bytes);
    const iteratorReturn = jest.fn(async () => ({ done: true }));
    let remainingEmptyChunks = 64;
    const next = jest.fn(async () => {
      if (remainingEmptyChunks > 0) {
        remainingEmptyChunks -= 1;
        return { done: false, value: new Uint8Array(0) };
      }
      return { done: true };
    });
    const destroy = jest.fn(function destroy() {
      this.destroyed = true;
    });
    const body = {
      destroyed: false,
      readableEnded: false,
      destroy,
      [Symbol.asyncIterator]() {
        return { next, return: iteratorReturn };
      },
    };
    const response = makeGetResponse(fixture, request, body);
    const { adapter, root } = await makeAdapter(request, response);

    await expect(adapter.converge(makeContext(request))).rejects.toBeInstanceOf(
      AwsSingleNodeHostArtifactProjectionConflictError,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(iteratorReturn).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    const layout = getAwsSingleNodeHostArtifactProjectionLayout(request, root);
    await expect(fsp.lstat(layout.projectionDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      fsp.lstat(
        path.join(layout.deploymentDirectory, `.${request.requestId}.tmp`),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed on mismatched managed headers before consuming bytes', async () => {
    const bytes = Buffer.from('header-bound artifact bytes', 'utf8');
    const { fixture, request } = makeRequestForBytes(bytes);
    const { body, destroy } = makeBody([bytes]);
    const response = makeGetResponse(fixture, request, body, {
      VersionId: 'wrong-provider-version',
    });
    const { adapter } = await makeAdapter(request, response);

    await expect(adapter.converge(makeContext(request))).rejects.toBeInstanceOf(
      AwsSingleNodeHostArtifactProjectionConflictError,
    );
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('bounds body iteration, aborts the read, and contains cleanup rejection', async () => {
    const bytes = Buffer.from('timed artifact bytes', 'utf8');
    const { fixture, request } = makeRequestForBytes(bytes);
    const destroy = jest.fn(() =>
      Promise.reject(new Error('Bearer cleanup detail')),
    );
    const body = {
      destroyed: false,
      readableEnded: false,
      destroy,
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise(() => undefined),
        };
      },
    };
    const response = makeGetResponse(fixture, request, body);
    const { adapter, calls } = await makeAdapter(request, response, {
      attemptTimeoutMilliseconds: 5,
    });

    await expect(adapter.converge(makeContext(request))).rejects.toBeInstanceOf(
      AwsSingleNodeHostArtifactProjectionTimeoutError,
    );
    expect(calls[0].callOptions.abortSignal.aborted).toBe(true);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('redacts provider and iterator failures behind one fixed unknown error', async () => {
    const bytes = Buffer.from('redacted artifact bytes', 'utf8');
    const { request } = makeRequestForBytes(bytes);
    const secret = 'Bearer provider-secret-detail';
    const base = await fsp.mkdtemp(
      path.join(tmpdir(), 'wharfie-host-artifact-projection-redaction-'),
    );
    temporaryRoots.push(base);
    await prepareSettledStorage(request);
    const adapter = createAwsSingleNodeHostArtifactProjectionAdapter({
      client: {
        async getObject() {
          throw new Error(secret);
        },
      },
      root: path.join(base, 'projection'),
      testOnlyRoot: true,
      expectedUid: process.getuid?.() ?? 0,
      runtimeGid: (process.getgid?.() ?? 0) || 1,
    });

    let failure;
    try {
      await adapter.converge(makeContext(request));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(
      AwsSingleNodeHostArtifactProjectionUnknownError,
    );
    expect(String(failure)).not.toContain(secret);
  });

  it('rejects malformed contexts before provider or filesystem mutation', async () => {
    const bytes = Buffer.from('context-bound artifact bytes', 'utf8');
    const { fixture, request } = makeRequestForBytes(bytes);
    const { body } = makeBody([bytes]);
    const response = makeGetResponse(fixture, request, body);
    const { adapter, calls } = await makeAdapter(request, response);

    await expect(
      adapter.converge(
        makeContext(request, 1, {
          priorEvidence: {
            'runtime-identity': { proof: 'runtime' },
            'application-storage': { proof: 'application' },
          },
        }),
      ),
    ).rejects.toThrow(/control-storage/u);

    const forgedRuntime = clone(makeContext(request));
    forgedRuntime.priorEvidence['runtime-identity'].accountId = '999999999999';
    await expect(adapter.converge(forgedRuntime)).rejects.toThrow(
      /accountId does not match/u,
    );

    const forgedApplication = clone(makeContext(request));
    forgedApplication.priorEvidence['application-storage'].requestId =
      `whaq1_${'A'.repeat(43)}`;
    await expect(adapter.converge(forgedApplication)).rejects.toThrow(
      /settled-evidence-mismatch/u,
    );

    const forgedControl = clone(makeContext(request));
    forgedControl.priorEvidence['control-storage'].directory.uid += 1;
    await expect(adapter.converge(forgedControl)).rejects.toThrow(
      /exact fixed wharfie-runtime account/u,
    );

    await expect(adapter.converge(makeContext(request, 0))).rejects.toThrow(
      /positive attemptGeneration/u,
    );
    expect(calls).toHaveLength(0);
  });

  it('repairs safe mode drift and confines owner/filesystem seams to isolated test roots', async () => {
    const bytes = Buffer.from('repairable namespace bytes', 'utf8');
    const { fixture, request } = makeRequestForBytes(bytes);
    const { body } = makeBody([bytes]);
    const response = makeGetResponse(fixture, request, body);
    const { adapter, root } = await makeAdapter(request, response);
    await fsp.mkdir(root, { mode: 0o700 });
    await fsp.chmod(root, 0o000);

    await expect(adapter.observe(makeContext(request, 0))).resolves.toEqual({
      status: 'ready',
    });
    await adapter.converge(makeContext(request));
    expect((await fsp.lstat(root)).mode & 0o777).toBe(0o750);

    expect(() =>
      createAwsSingleNodeHostArtifactProjectionAdapter({
        client: { getObject: async () => response },
        root: '/etc/wharfie-artifact-test',
        testOnlyRoot: true,
        expectedUid: process.getuid?.() ?? 0,
        runtimeGid: (process.getgid?.() ?? 0) || 1,
      }),
    ).toThrow(/isolated test-only path/u);
    for (const productionSeam of [
      { expectedUid: 0 },
      { fsOps: fsp },
      { testOnlyRoot: false },
    ]) {
      expect(() =>
        createAwsSingleNodeHostArtifactProjectionAdapter({
          client: { getObject: async () => response },
          runtimeGid: (process.getgid?.() ?? 0) || 1,
          ...productionSeam,
        }),
      ).toThrow(/isolated custom test root/u);
    }
  });

  it('classifies canonical-record whitespace tampering as a local conflict', async () => {
    const bytes = Buffer.from('canonical record artifact bytes', 'utf8');
    const { fixture, request } = makeRequestForBytes(bytes);
    const { body } = makeBody([bytes]);
    const response = makeGetResponse(fixture, request, body);
    const { adapter, root } = await makeAdapter(request, response);
    await adapter.converge(makeContext(request));
    const layout = getAwsSingleNodeHostArtifactProjectionLayout(request, root);
    const parsed = JSON.parse(await fsp.readFile(layout.recordPath, 'utf8'));
    await fsp.chmod(layout.recordPath, 0o640);
    await fsp.writeFile(
      layout.recordPath,
      `${JSON.stringify(parsed, null, 2)}\n`,
    );
    await fsp.chmod(layout.recordPath, 0o440);

    await expect(adapter.observe(makeContext(request, 0))).resolves.toEqual({
      status: 'conflict',
    });
  });

  it('hash helper used by fixtures is byte-identical to the request digest', () => {
    const bytes = Buffer.from('fixture hash sanity', 'utf8');
    const { request } = makeRequestForBytes(bytes);
    expect(createHash('sha256').update(bytes).digest('base64url')).toBe(
      request.artifact.byteDigest.value,
    );
  });
});
