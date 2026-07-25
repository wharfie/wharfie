import { Readable } from 'node:stream';

import { describe, expect, it, jest } from '@jest/globals';

import { createApplicationRevision } from '../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../src/core/runtime/artifact-record.js';
import {
  createDeploymentArtifactStageIntent,
  createDeploymentArtifactStageReceipt,
} from '../../src/core/runtime/deployment-artifact-stage.js';
import {
  createDeploymentArtifactStager,
  DEPLOYMENT_ARTIFACT_STAGE_CONTENT_TYPE,
  DEPLOYMENT_ARTIFACT_STAGE_METADATA_SCHEMA,
  DeploymentArtifactStageConflictError,
  DeploymentArtifactStageMissingError,
  DeploymentArtifactStageUnknownError,
} from '../../src/core/runtime/deployment-artifact-stager.js';
import {
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';
import { createOwnershipNonce } from '../../src/core/runtime/deployment-resource-binding.js';

const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {Promise<unknown>} promise @returns {Promise<unknown>} */
async function captureRejection(promise) {
  let rejected = false;
  /** @type {unknown} */
  let reason;
  try {
    await promise;
  } catch (error) {
    rejected = true;
    reason = error;
  }
  if (!rejected) throw new Error('Expected promise to reject.');
  return reason;
}

/** @param {string|Buffer} value @returns {{algorithm: 'sha256', value: string}} */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {ReturnType<typeof makeArtifactObservation>} observation @param {Readonly<Record<string, any>>} profile @param {string} revisionId */
function makeDeploymentRevision(observation, profile, revisionId) {
  const payload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'api' },
    appId: profile.appId,
    revisionId,
    artifactId: observation.artifactId,
    profileRevisionId: profile.profileRevisionId,
  };
  return {
    ...payload,
    deploymentRevisionId: createCanonicalJsonSha256Id({
      domain: 'wharfie:deployment-revision:v1',
      prefix: 'wdr1',
      value: payload,
    }),
  };
}

/** @param {string} [appId] @param {string} [salt] */
function makeApplicationRevision(
  appId = 'artifact-stager-demo',
  salt = 'default',
) {
  return createApplicationRevision({
    contract: {
      schemaVersion: 2,
      app: { id: appId },
      cli: {
        entrypoint: {
          kind: 'node',
          path: 'src/cli.js',
          export: 'main',
        },
      },
      activities: {
        serve: {
          entrypoint: {
            kind: 'node',
            path: 'src/serve.js',
            export: 'serve',
          },
        },
      },
    },
    inputs: {
      source: {
        format: 'wharfie-source-tree-v1',
        digest: digest(`source-${salt}`),
      },
      dependencies: {
        format: 'wharfie-npm-package-lock-v3-closure-v1',
        digest: digest('dependencies'),
      },
      runtime: {
        format: 'wharfie-runtime-v1',
        digest: digest('runtime'),
      },
    },
  });
}

/**
 * @param {ReturnType<typeof makeApplicationRevision>} revision
 * @param {Readonly<Record<string, any>>} [target]
 */
function makeProvenance(revision, target = TARGET) {
  return {
    schemaVersion: 1,
    builder: {
      name: '@wharfie/wharfie',
      version: '0.0.15',
      runtimeDigest: clone(revision.inputs.runtime.digest),
      toolchainDigest: digest('toolchain'),
    },
    node: {
      version: target.nodeVersion,
      archive: {
        fileName: `node-v${target.nodeVersion}-${target.platform}-${target.architecture}.tar.gz`,
        digest: digest('node-archive'),
      },
      binary: { digest: digest('node-binary') },
    },
    dependencies: {
      lock: clone(revision.inputs.dependencies),
      digest: digest('target-dependency-closure'),
    },
    signing: { mode: 'unsigned' },
  };
}

/** @param {string} [appId] @param {Readonly<Record<string, any>>} [target] @param {string} [region] */
function makeProfile(
  appId = 'artifact-stager-demo',
  target = TARGET,
  region = 'us-east-1',
) {
  return createDeploymentProfile({
    profile: { id: 'production' },
    appId,
    target,
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider(region),
  });
}

/** @param {Buffer} bytes */
function makeArtifactObservation(bytes) {
  const byteDigest = digest(bytes);
  return Object.freeze({
    artifactId: `waf1_${byteDigest.value}`,
    byteDigest: Object.freeze(byteDigest),
    size: bytes.byteLength,
  });
}

/** @param {Buffer} [bytes] @param {string} [region] */
function makeFixture(
  bytes = Buffer.from('exact held SEA bytes'),
  region = 'us-east-1',
) {
  const profile = makeProfile('artifact-stager-demo', TARGET, region);
  const revision = makeApplicationRevision(profile.appId);
  const record = createArtifactRecord({
    bytes,
    revision,
    target: profile.target,
    provenance: makeProvenance(revision, profile.target),
  });
  const observation = makeArtifactObservation(bytes);
  const runtime = Object.freeze({
    schemaVersion: 1,
    kind: 'artifactRuntime',
    appId: revision.contract.app.id,
    revisionId: revision.revisionId,
    target: profile.target,
  });
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId: '123456789012',
    region,
  });
  const deploymentRevision = makeDeploymentRevision(
    observation,
    profile,
    revision.revisionId,
  );
  const readEmbeddedRevisionRuntimePair = jest.fn(async () => ({
    revision,
    runtime,
  }));
  return {
    bytes,
    observation,
    profile,
    providerScope,
    record,
    revision,
    runtime,
    readEmbeddedRevisionRuntimePair,
    deploymentRevision,
    authority: { deploymentRevision, profile, providerScope },
  };
}

/**
 * @param {ReturnType<typeof makeFixture>} fixture
 * @param {Readonly<Record<string, any>>} source
 * @param {Record<string, any>} [overrides]
 */
function makeClaim(fixture, source, overrides = {}) {
  return {
    deploymentRevision: fixture.deploymentRevision,
    profile: fixture.profile,
    providerScope: fixture.providerScope,
    source,
    revision: fixture.revision,
    runtime: fixture.runtime,
    record: fixture.record,
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {number} [nonceByte] */
function makeIntent(fixture, nonceByte = 11) {
  return createDeploymentArtifactStageIntent({
    providerScope: fixture.providerScope,
    artifact: {
      ...fixture.observation,
      appId: fixture.deploymentRevision.appId,
      revisionId: fixture.deploymentRevision.revisionId,
      target: fixture.profile.target,
    },
    ownershipNonce: createOwnershipNonce(Buffer.alloc(32, nonceByte)),
  });
}

/** @param {Readonly<Record<string, any>>} intent */
function expectedMetadata(intent) {
  return {
    'wharfie-schema': 'deployment-artifact-stage-v1',
    'wharfie-intent': intent.stageIntentId,
    'wharfie-nonce': intent.ownershipNonce,
    'wharfie-artifact': intent.artifact.artifactId,
    'wharfie-digest': intent.artifact.byteDigest.value,
  };
}

/** @param {Readonly<Record<string, any>>} intent @param {string} versionId @param {Record<string, any>} [overrides] */
function makeHead(intent, versionId = 'version-1', overrides = {}) {
  return {
    VersionId: versionId,
    ContentLength: intent.artifact.size,
    ChecksumSHA256: Buffer.from(
      intent.artifact.byteDigest.value,
      'base64url',
    ).toString('base64'),
    ServerSideEncryption: 'AES256',
    ContentType: 'application/octet-stream',
    Metadata: expectedMetadata(intent),
    ...overrides,
  };
}

/** @param {Readonly<Record<string, any>>} intent @param {string} [versionId] */
function makeReceipt(intent, versionId = 'version-1') {
  return createDeploymentArtifactStageReceipt({
    intent,
    object: {
      bucketName: intent.object.bucketName,
      key: intent.object.key,
      versionId,
      contentLength: intent.artifact.size,
      checksum: intent.artifact.byteDigest,
      serverSideEncryption: 'AES256',
      storageClass: 'STANDARD',
    },
  });
}

/**
 * @param {Buffer} bytes
 * @param {{observation?: Readonly<Record<string, any>>, verifyError?: Error, closeFailure?: unknown}} [options]
 */
function makeSource(bytes, options = {}) {
  let consumed = false;
  const observation = options.observation || makeArtifactObservation(bytes);
  const createReadStream = jest.fn(() =>
    Readable.from(
      (async function* () {
        yield bytes;
        consumed = true;
      })(),
      { objectMode: false },
    ),
  );
  const verifyUnchanged = jest.fn(async () => {
    if (options.verifyError) throw options.verifyError;
    if (!consumed) throw new Error('test source was not consumed');
    return observation;
  });
  const close = jest.fn(async () => {
    if (Object.hasOwn(options, 'closeFailure')) throw options.closeFailure;
  });
  return {
    source: Object.freeze({
      observation,
      createReadStream,
      verifyUnchanged,
      close,
    }),
    createReadStream,
    verifyUnchanged,
    close,
    wasConsumed: () => consumed,
  };
}

/** @param {{intent?: Readonly<Record<string, any>>|null, receipt?: Readonly<Record<string, any>>|null, events?: string[]}} [options] */
function makeStore(options = {}) {
  const events = options.events || [];
  const state = {
    intent: /** @type {Readonly<Record<string, any>>|null} */ (
      options.intent || null
    ),
    receipt: /** @type {Readonly<Record<string, any>>|null} */ (
      options.receipt || null
    ),
  };
  const store = {
    putArtifactStageIntentIfAbsent: jest.fn(async (intent) => {
      events.push('store:put-intent');
      if (state.intent === null) {
        state.intent = clone(
          /** @type {Readonly<Record<string, any>>} */ (intent),
        );
        return true;
      }
      if (JSON.stringify(state.intent) === JSON.stringify(intent)) return false;
      throw new Error('intent identity is occupied');
    }),
    readArtifactStageIntent: jest.fn(async () => {
      events.push('store:read-intent');
      return state.intent === null ? null : clone(state.intent);
    }),
    putArtifactStageReceiptIfAbsent: jest.fn(async (_intent, receipt) => {
      events.push('store:put-receipt');
      if (state.receipt === null) {
        state.receipt = clone(
          /** @type {Readonly<Record<string, any>>} */ (receipt),
        );
        return true;
      }
      if (JSON.stringify(state.receipt) === JSON.stringify(receipt)) {
        return false;
      }
      throw new Error('receipt identity is occupied');
    }),
    readArtifactStageReceipt: jest.fn(async (_intent) => {
      events.push('store:read-receipt');
      return state.receipt === null ? null : clone(state.receipt);
    }),
  };
  return { store, state, events };
}

/** @param {{events?: string[], returnVersion?: boolean, versionId?: string, putMode?: 'success'|'throw-before'|'throw-after', putError?: Error, headTransform?: (value: Record<string, any>, input: Record<string, any>) => Record<string, any>}} [options] */
function makeClient(options = {}) {
  const events = options.events || [];
  const state = {
    currentVersionId: /** @type {string|null} */ (null),
    versions: new Map(),
    nextVersion: 1,
    uploadedBytes: Buffer.alloc(0),
  };

  /** @param {Record<string, any>} head @param {boolean} [current] */
  function installHead(head, current = true) {
    state.versions.set(head.VersionId, clone(head));
    if (current) state.currentVersionId = head.VersionId;
  }

  const putObject = jest.fn(async (input) => {
    const request = /** @type {Record<string, any>} */ (input);
    events.push('client:put');
    if (options.putMode === 'throw-before') {
      throw options.putError || new Error('conditional collision');
    }
    const chunks = [];
    for await (const chunk of request.Body) chunks.push(Buffer.from(chunk));
    state.uploadedBytes = Buffer.concat(chunks);
    const versionId = options.versionId || `version-${state.nextVersion}`;
    state.nextVersion += 1;
    installHead({
      VersionId: versionId,
      ContentLength: request.ContentLength,
      ChecksumSHA256: request.ChecksumSHA256,
      ServerSideEncryption: request.ServerSideEncryption,
      ContentType: request.ContentType,
      Metadata: clone(request.Metadata),
    });
    if (options.putMode === 'throw-after') {
      throw options.putError || new Error('response lost');
    }
    return options.returnVersion === false ? {} : { VersionId: versionId };
  });

  const headObject = jest.fn(async (input) => {
    const request = /** @type {Record<string, any>} */ (input);
    events.push('client:head');
    const versionId = request.VersionId || state.currentVersionId;
    const head = versionId ? state.versions.get(versionId) : undefined;
    if (!head) {
      const error = new Error('not found');
      error.name = request.VersionId ? 'NoSuchVersion' : 'NotFound';
      throw error;
    }
    const response = clone(head);
    return options.headTransform
      ? options.headTransform(response, request)
      : response;
  });
  const close = jest.fn(async () => {});
  return {
    client: { putObject, headObject, close },
    state,
    events,
    putObject,
    headObject,
    close,
    installHead,
  };
}

/**
 * @param {ReturnType<typeof makeFixture>} fixture
 * @param {{source?: ReturnType<typeof makeSource>, store?: ReturnType<typeof makeStore>, client?: ReturnType<typeof makeClient>, nonceByte?: number, readEmbeddedRevisionRuntimePair?: Function}} [options]
 */
function makeHarness(fixture, options = {}) {
  const source = options.source || makeSource(fixture.bytes);
  const store = options.store || makeStore();
  const client = options.client || makeClient();
  const openArtifactSource = jest.fn(async () => source.source);
  const createNonce = jest.fn(() =>
    createOwnershipNonce(Buffer.alloc(32, options.nonceByte || 11)),
  );
  const readEmbeddedRevisionRuntimePair =
    options.readEmbeddedRevisionRuntimePair ||
    fixture.readEmbeddedRevisionRuntimePair;
  const stager = createDeploymentArtifactStager({
    client: client.client,
    store: store.store,
    openArtifactSource,
    createOwnershipNonce: createNonce,
    readEmbeddedRevisionRuntimePair,
  });
  return {
    stager,
    source,
    store,
    client,
    openArtifactSource,
    createNonce,
    readEmbeddedRevisionRuntimePair,
  };
}

/**
 * Build a canonical authority that names the held bytes but lies about one
 * embedded application/runtime semantic.
 * @param {ReturnType<typeof makeFixture>} fixture
 * @param {'app'|'revision'|'target'} semantic
 */
function makeSemanticallyFalseAuthority(fixture, semantic) {
  let profile = fixture.profile;
  let revisionId = fixture.revision.revisionId;
  if (semantic === 'app') {
    profile = makeProfile('different-artifact-app');
  } else if (semantic === 'revision') {
    revisionId = makeApplicationRevision(profile.appId, 'different').revisionId;
  } else {
    profile = makeProfile(profile.appId, {
      ...TARGET,
      architecture: 'arm64',
    });
  }
  const deploymentRevision = makeDeploymentRevision(
    fixture.observation,
    profile,
    revisionId,
  );
  return {
    deploymentRevision,
    profile,
    providerScope: fixture.providerScope,
  };
}

describe('deployment artifact stager', () => {
  it('persists intent before one exact upload and returns strong receipt evidence', async () => {
    const events = /** @type {string[]} */ ([]);
    const fixture = makeFixture();
    const harness = makeHarness(fixture, {
      store: makeStore({ events }),
      client: makeClient({ events }),
    });

    const bundle = await harness.stager.stageRunningArtifact(fixture.authority);

    expect(bundle).toEqual({
      intent: harness.store.state.intent,
      receipt: harness.store.state.receipt,
    });
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.intent)).toBe(true);
    expect(Object.isFrozen(bundle.receipt)).toBe(true);
    expect(events).toEqual([
      'store:put-intent',
      'store:read-intent',
      'store:read-receipt',
      'client:put',
      'client:head',
      'store:put-receipt',
      'store:read-receipt',
    ]);
    expect(harness.source.wasConsumed()).toBe(true);
    expect(harness.source.verifyUnchanged).toHaveBeenCalledTimes(1);
    expect(harness.source.close).toHaveBeenCalledTimes(1);
    expect(harness.readEmbeddedRevisionRuntimePair).toHaveBeenCalledTimes(1);
    expect(harness.openArtifactSource).toHaveBeenCalledTimes(1);
    expect(harness.client.close).not.toHaveBeenCalled();
    expect(harness.client.state.uploadedBytes).toEqual(fixture.bytes);
    expect(harness.client.putObject).toHaveBeenCalledTimes(1);
    const request = harness.client.putObject.mock.calls[0][0];
    expect(request).toEqual({
      Bucket: bundle.intent.object.bucketName,
      Key: bundle.intent.object.key,
      Body: expect.any(Readable),
      ContentLength: fixture.bytes.byteLength,
      ChecksumAlgorithm: 'SHA256',
      ChecksumSHA256: Buffer.from(
        fixture.observation.byteDigest.value,
        'base64url',
      ).toString('base64'),
      ServerSideEncryption: 'AES256',
      StorageClass: 'STANDARD',
      ContentType: 'application/octet-stream',
      IfNoneMatch: '*',
      ExpectedBucketOwner: fixture.providerScope.accountId,
      Metadata: expectedMetadata(bundle.intent),
    });
    expect(harness.client.headObject).toHaveBeenCalledWith({
      Bucket: bundle.intent.object.bucketName,
      Key: bundle.intent.object.key,
      VersionId: 'version-1',
      ChecksumMode: 'ENABLED',
      ExpectedBucketOwner: fixture.providerScope.accountId,
    });
    expect(
      harness.store.store.putArtifactStageReceiptIfAbsent,
    ).toHaveBeenCalledWith(bundle.intent, bundle.receipt);
    expect(
      harness.store.store.readArtifactStageReceipt.mock.calls.every(
        ([intent]) =>
          /** @type {Record<string, any>} */ (intent).stageIntentId ===
          bundle.intent.stageIntentId,
      ),
    ).toBe(true);
    expect(DEPLOYMENT_ARTIFACT_STAGE_CONTENT_TYPE).toBe(
      'application/octet-stream',
    );
    expect(DEPLOYMENT_ARTIFACT_STAGE_METADATA_SCHEMA).toBe(
      'deployment-artifact-stage-v1',
    );
  });

  it('stages one claimed selected source without opening or observing the running executable', async () => {
    const fixture = makeFixture();
    const harness = makeHarness(fixture);

    const bundle = await harness.stager.stageClaimedArtifact(
      makeClaim(fixture, harness.source.source),
    );

    expect(bundle).toEqual({
      intent: harness.store.state.intent,
      receipt: harness.store.state.receipt,
    });
    expect(Object.keys(harness.stager)).toEqual([
      'stageClaimedArtifact',
      'stageRunningArtifact',
      'validateStagedArtifact',
    ]);
    expect(Object.isFrozen(harness.stager)).toBe(true);
    expect(harness.source.wasConsumed()).toBe(true);
    expect(harness.source.verifyUnchanged).toHaveBeenCalledTimes(1);
    expect(harness.source.close).toHaveBeenCalledTimes(1);
    expect(harness.openArtifactSource).not.toHaveBeenCalled();
    expect(harness.readEmbeddedRevisionRuntimePair).not.toHaveBeenCalled();
    expect(harness.client.putObject).toHaveBeenCalledTimes(1);
    expect(harness.client.state.uploadedBytes).toEqual(fixture.bytes);
  });

  it.each([
    [
      'record bytes',
      /** @type {(fixture: ReturnType<typeof makeFixture>) => Record<string, any>} */ (
        (fixture) => {
          const record = clone(fixture.record);
          record.size += 1;
          return { record };
        }
      ),
    ],
    [
      'record target',
      /** @type {(fixture: ReturnType<typeof makeFixture>) => Record<string, any>} */ (
        (fixture) => {
          const target = { ...TARGET, architecture: 'arm64' };
          return {
            record: createArtifactRecord({
              bytes: fixture.bytes,
              revision: fixture.revision,
              target,
              provenance: makeProvenance(fixture.revision, target),
            }),
          };
        }
      ),
    ],
    [
      'application revision',
      /** @type {(fixture: ReturnType<typeof makeFixture>) => Record<string, any>} */ (
        (fixture) => ({
          revision: makeApplicationRevision(fixture.profile.appId, 'other'),
        })
      ),
    ],
    [
      'runtime target',
      /** @type {(fixture: ReturnType<typeof makeFixture>) => Record<string, any>} */ (
        (fixture) => ({
          runtime: {
            ...clone(fixture.runtime),
            target: { ...TARGET, architecture: 'arm64' },
          },
        })
      ),
    ],
    [
      'deployment revision',
      /** @type {(fixture: ReturnType<typeof makeFixture>) => Record<string, any>} */ (
        (fixture) => ({
          deploymentRevision: makeDeploymentRevision(
            fixture.observation,
            fixture.profile,
            makeApplicationRevision(fixture.profile.appId, 'other').revisionId,
          ),
        })
      ),
    ],
  ])(
    'rejects mismatched claimed %s before durable or provider mutation and closes it',
    async (_name, mutate) => {
      const fixture = makeFixture();
      const harness = makeHarness(fixture);

      await expect(
        harness.stager.stageClaimedArtifact(
          makeClaim(fixture, harness.source.source, mutate(fixture)),
        ),
      ).rejects.toBeInstanceOf(DeploymentArtifactStageConflictError);

      expect(harness.source.close).toHaveBeenCalledTimes(1);
      expect(harness.source.createReadStream).not.toHaveBeenCalled();
      expect(harness.source.verifyUnchanged).not.toHaveBeenCalled();
      expect(harness.createNonce).not.toHaveBeenCalled();
      expect(
        harness.store.store.putArtifactStageIntentIfAbsent,
      ).not.toHaveBeenCalled();
      expect(harness.client.putObject).not.toHaveBeenCalled();
      expect(harness.client.headObject).not.toHaveBeenCalled();
      expect(harness.openArtifactSource).not.toHaveBeenCalled();
      expect(harness.readEmbeddedRevisionRuntimePair).not.toHaveBeenCalled();
    },
  );

  it('reuses exact claimed-source receipt evidence without streaming and still closes ownership', async () => {
    const fixture = makeFixture();
    const intent = makeIntent(fixture);
    const receipt = makeReceipt(intent, 'claimed-retained-version');
    const store = makeStore({ intent, receipt });
    const client = makeClient();
    client.installHead(makeHead(intent, 'claimed-retained-version'), false);
    const harness = makeHarness(fixture, { store, client });

    await expect(
      harness.stager.stageClaimedArtifact(
        makeClaim(fixture, harness.source.source),
      ),
    ).resolves.toEqual({ intent, receipt });

    expect(harness.source.createReadStream).not.toHaveBeenCalled();
    expect(harness.source.verifyUnchanged).not.toHaveBeenCalled();
    expect(harness.source.close).toHaveBeenCalledTimes(1);
    expect(harness.openArtifactSource).not.toHaveBeenCalled();
    expect(harness.readEmbeddedRevisionRuntimePair).not.toHaveBeenCalled();
    expect(client.putObject).not.toHaveBeenCalled();
    expect(client.headObject).toHaveBeenCalledWith(
      expect.objectContaining({ VersionId: 'claimed-retained-version' }),
    );
  });

  it('preserves claimed-source close failure unchanged after successful staging', async () => {
    const fixture = makeFixture();
    const closeFailure = Object.freeze({ code: 'CLAIMED_SOURCE_CLOSE_FAILED' });
    const source = makeSource(fixture.bytes, { closeFailure });
    const harness = makeHarness(fixture, { source });

    await expect(
      captureRejection(
        harness.stager.stageClaimedArtifact(makeClaim(fixture, source.source)),
      ),
    ).resolves.toBe(closeFailure);
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it('retains claimed staging and close failures in primary-first order', async () => {
    const fixture = makeFixture();
    const primaryFailure = undefined;
    const closeFailure = undefined;
    const store = makeStore();
    store.store.putArtifactStageIntentIfAbsent.mockRejectedValueOnce(
      primaryFailure,
    );
    const source = makeSource(fixture.bytes, { closeFailure });
    const harness = makeHarness(fixture, { store, source });

    const failure = await captureRejection(
      harness.stager.stageClaimedArtifact(makeClaim(fixture, source.source)),
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect(/** @type {AggregateError} */ (failure).errors).toEqual([
      primaryFailure,
      closeFailure,
    ]);
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it('closes a transferred source when the claimed top-level shape is invalid', async () => {
    const fixture = makeFixture();
    const harness = makeHarness(fixture);

    await expect(
      harness.stager.stageClaimedArtifact({
        ...makeClaim(fixture, harness.source.source),
        extra: true,
      }),
    ).rejects.toThrow(/exact supported fields/i);

    expect(harness.source.close).toHaveBeenCalledTimes(1);
    expect(harness.source.createReadStream).not.toHaveBeenCalled();
    expect(
      harness.store.store.putArtifactStageIntentIfAbsent,
    ).not.toHaveBeenCalled();
    expect(harness.client.putObject).not.toHaveBeenCalled();
  });

  it('retains and closes a source captured before a later claim descriptor trap throws', async () => {
    const fixture = makeFixture();
    const harness = makeHarness(fixture);
    const validClaim = makeClaim(fixture, harness.source.source);
    const trapped = new Proxy(validClaim, {
      ownKeys: () => [
        'source',
        'deploymentRevision',
        'profile',
        'providerScope',
        'revision',
        'runtime',
        'record',
      ],
      getOwnPropertyDescriptor(target, property) {
        if (property === 'source') {
          return Object.getOwnPropertyDescriptor(target, property);
        }
        throw new Error('later claim descriptor trap');
      },
    });

    await expect(harness.stager.stageClaimedArtifact(trapped)).rejects.toThrow(
      /exact supported fields/i,
    );

    expect(harness.source.close).toHaveBeenCalledTimes(1);
    expect(harness.source.createReadStream).not.toHaveBeenCalled();
    expect(
      harness.store.store.putArtifactStageIntentIfAbsent,
    ).not.toHaveBeenCalled();
    expect(harness.client.putObject).not.toHaveBeenCalled();
  });

  it('heads the current object when a successful PutObject omits VersionId', async () => {
    const fixture = makeFixture();
    const client = makeClient({ returnVersion: false });
    const harness = makeHarness(fixture, { client });

    const bundle = await harness.stager.stageRunningArtifact(fixture.authority);

    expect(bundle.receipt.object.versionId).toBe('version-1');
    expect(client.headObject).toHaveBeenCalledWith({
      Bucket: bundle.intent.object.bucketName,
      Key: bundle.intent.object.key,
      ChecksumMode: 'ENABLED',
      ExpectedBucketOwner: fixture.providerScope.accountId,
    });
    expect(harness.source.verifyUnchanged).toHaveBeenCalledTimes(1);
    expect(harness.source.close).toHaveBeenCalledTimes(1);
  });

  it('preserves an opaque well-formed Unicode VersionId from Put through exact Head', async () => {
    const fixture = makeFixture();
    const versionId = '版本 / 🌊\nprovider opaque';
    const client = makeClient({ versionId });
    const harness = makeHarness(fixture, { client });

    const bundle = await harness.stager.stageRunningArtifact(fixture.authority);

    expect(bundle.receipt.object.versionId).toBe(versionId);
    expect(client.headObject).toHaveBeenCalledWith(
      expect.objectContaining({ VersionId: versionId }),
    );
  });

  it('adopts a concurrent exact intent with a different nonce and replays its receipt without upload', async () => {
    const fixture = makeFixture();
    const intent = makeIntent(fixture, 21);
    const receipt = makeReceipt(intent);
    const store = makeStore({ intent, receipt });
    const client = makeClient();
    client.installHead(makeHead(intent));
    const harness = makeHarness(fixture, {
      store,
      client,
      nonceByte: 22,
    });

    const bundle = await harness.stager.stageRunningArtifact(fixture.authority);

    expect(bundle).toEqual({ intent, receipt });
    expect(store.store.putArtifactStageIntentIfAbsent).toHaveBeenCalledTimes(1);
    expect(client.putObject).not.toHaveBeenCalled();
    expect(client.headObject).toHaveBeenCalledWith(
      expect.objectContaining({ VersionId: receipt.object.versionId }),
    );
    expect(harness.source.createReadStream).not.toHaveBeenCalled();
    expect(harness.source.verifyUnchanged).not.toHaveBeenCalled();
    expect(harness.source.close).toHaveBeenCalledTimes(1);
  });

  it('recovers a lost PutObject response from exact current HeadObject evidence', async () => {
    const fixture = makeFixture();
    const client = makeClient({
      putMode: 'throw-after',
      putError: new Error('provider response disappeared'),
    });
    const harness = makeHarness(fixture, { client });

    const bundle = await harness.stager.stageRunningArtifact(fixture.authority);

    expect(bundle.receipt.object.versionId).toBe('version-1');
    expect(client.headObject.mock.calls[0][0]).not.toHaveProperty('VersionId');
    expect(harness.source.wasConsumed()).toBe(true);
    expect(harness.source.verifyUnchanged).not.toHaveBeenCalled();
    expect(
      harness.store.store.putArtifactStageReceiptIfAbsent,
    ).toHaveBeenCalledTimes(1);
    expect(harness.source.close).toHaveBeenCalledTimes(1);
  });

  it('recovers an unconsumed conditional collision only from exact adopted-intent metadata', async () => {
    const fixture = makeFixture();
    const intent = makeIntent(fixture, 31);
    const store = makeStore({ intent });
    const client = makeClient({ putMode: 'throw-before' });
    client.installHead(makeHead(intent));
    const harness = makeHarness(fixture, {
      store,
      client,
      nonceByte: 32,
    });

    const bundle = await harness.stager.stageRunningArtifact(fixture.authority);

    expect(bundle.intent).toEqual(intent);
    expect(bundle.receipt.object.versionId).toBe('version-1');
    expect(harness.source.wasConsumed()).toBe(false);
    expect(harness.source.verifyUnchanged).not.toHaveBeenCalled();
    expect(harness.source.close).toHaveBeenCalledTimes(1);
  });

  it('recovers ambiguous intent and receipt writes only through strong readback', async () => {
    const fixture = makeFixture();
    const store = makeStore();
    store.store.putArtifactStageIntentIfAbsent.mockImplementationOnce(
      async (intent) => {
        store.state.intent = clone(
          /** @type {Readonly<Record<string, any>>} */ (intent),
        );
        throw new Error('intent response lost');
      },
    );
    store.store.putArtifactStageReceiptIfAbsent.mockImplementationOnce(
      async (_intent, receipt) => {
        store.state.receipt = clone(
          /** @type {Readonly<Record<string, any>>} */ (receipt),
        );
        throw new Error('receipt response lost');
      },
    );
    const harness = makeHarness(fixture, { store });

    const bundle = await harness.stager.stageRunningArtifact(fixture.authority);

    expect(bundle.intent).toEqual(store.state.intent);
    expect(bundle.receipt).toEqual(store.state.receipt);
    expect(store.store.readArtifactStageIntent).toHaveBeenCalledTimes(1);
    expect(store.store.readArtifactStageReceipt).toHaveBeenCalledTimes(2);
    expect(harness.source.close).toHaveBeenCalledTimes(1);
  });

  it('does not adopt an intent write failure when no exact durable intent is visible', async () => {
    const fixture = makeFixture();
    const store = makeStore();
    const original = new Error('intent write unknown');
    store.store.putArtifactStageIntentIfAbsent.mockRejectedValueOnce(original);
    const harness = makeHarness(fixture, { store });

    await expect(
      harness.stager.stageRunningArtifact(fixture.authority),
    ).rejects.toBe(original);
    expect(harness.client.putObject).not.toHaveBeenCalled();
    expect(harness.source.close).toHaveBeenCalledTimes(1);
  });

  it('preserves an undefined stage failure unchanged when source close succeeds', async () => {
    const fixture = makeFixture();
    const store = makeStore();
    store.store.putArtifactStageIntentIfAbsent.mockRejectedValueOnce(undefined);
    const harness = makeHarness(fixture, { store });

    await expect(
      captureRejection(harness.stager.stageRunningArtifact(fixture.authority)),
    ).resolves.toBeUndefined();
    expect(harness.source.close).toHaveBeenCalledTimes(1);
  });

  it('preserves source-close failure unchanged after successful staging', async () => {
    const fixture = makeFixture();
    const closeFailure = Object.freeze({ code: 'SOURCE_CLOSE_FAILED' });
    const source = makeSource(fixture.bytes, { closeFailure });
    const harness = makeHarness(fixture, { source });

    await expect(
      captureRejection(harness.stager.stageRunningArtifact(fixture.authority)),
    ).resolves.toBe(closeFailure);
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it('retains stage and source-close failures in primary-first order', async () => {
    const fixture = makeFixture();
    const store = makeStore();
    const primaryFailure = undefined;
    const closeFailure = undefined;
    store.store.putArtifactStageIntentIfAbsent.mockRejectedValueOnce(
      primaryFailure,
    );
    const source = makeSource(fixture.bytes, { closeFailure });
    const harness = makeHarness(fixture, { store, source });

    const failure = await captureRejection(
      harness.stager.stageRunningArtifact(fixture.authority),
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect(/** @type {AggregateError} */ (failure).errors).toEqual([
      primaryFailure,
      closeFailure,
    ]);
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'metadata',
      /** @type {(head: Record<string, any>) => Record<string, any>} */ (
        (head) => ({
          ...head,
          Metadata: { ...head.Metadata, 'wharfie-digest': digest('bad').value },
        })
      ),
    ],
    [
      'checksum',
      /** @type {(head: Record<string, any>) => Record<string, any>} */ (
        (head) => ({
          ...head,
          ChecksumSHA256: Buffer.from(
            digest('bad').value,
            'base64url',
          ).toString('base64'),
        })
      ),
    ],
    [
      'version ID',
      /** @type {(head: Record<string, any>) => Record<string, any>} */ (
        (head) => {
          const value = { ...head };
          delete value.VersionId;
          return value;
        }
      ),
    ],
    [
      'content type',
      /** @type {(head: Record<string, any>) => Record<string, any>} */ (
        (head) => ({ ...head, ContentType: 'text/plain' })
      ),
    ],
  ])(
    'rejects corrupt HeadObject %s before persisting a receipt',
    async (_name, transform) => {
      const fixture = makeFixture();
      const client = makeClient({ headTransform: transform });
      const harness = makeHarness(fixture, { client });

      await expect(
        harness.stager.stageRunningArtifact(fixture.authority),
      ).rejects.toBeInstanceOf(DeploymentArtifactStageConflictError);
      expect(
        harness.store.store.putArtifactStageReceiptIfAbsent,
      ).not.toHaveBeenCalled();
      expect(harness.store.state.receipt).toBeNull();
      expect(harness.source.close).toHaveBeenCalledTimes(1);
    },
  );

  it('fails unknown when a failed upload has no authoritative object evidence', async () => {
    const fixture = makeFixture();
    const harness = makeHarness(fixture, {
      client: makeClient({ putMode: 'throw-before' }),
    });

    await expect(
      harness.stager.stageRunningArtifact(fixture.authority),
    ).rejects.toBeInstanceOf(DeploymentArtifactStageUnknownError);
    expect(
      harness.store.store.putArtifactStageReceiptIfAbsent,
    ).not.toHaveBeenCalled();
    expect(harness.source.close).toHaveBeenCalledTimes(1);
  });

  it('requires descriptor stability after a successful consumed upload', async () => {
    const fixture = makeFixture();
    const source = makeSource(fixture.bytes, {
      verifyError: new Error('held file changed'),
    });
    const harness = makeHarness(fixture, { source });

    await expect(
      harness.stager.stageRunningArtifact(fixture.authority),
    ).rejects.toThrow(/held file changed/i);
    expect(harness.client.headObject).not.toHaveBeenCalled();
    expect(
      harness.store.store.putArtifactStageReceiptIfAbsent,
    ).not.toHaveBeenCalled();
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it('requires verifyUnchanged to return the exact held observation', async () => {
    const fixture = makeFixture();
    const source = makeSource(fixture.bytes);
    source.verifyUnchanged.mockResolvedValueOnce(
      makeArtifactObservation(Buffer.from('different bytes')),
    );
    const harness = makeHarness(fixture, { source });

    await expect(
      harness.stager.stageRunningArtifact(fixture.authority),
    ).rejects.toBeInstanceOf(DeploymentArtifactStageConflictError);
    expect(harness.client.headObject).not.toHaveBeenCalled();
    expect(
      harness.store.store.putArtifactStageReceiptIfAbsent,
    ).not.toHaveBeenCalled();
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it('rejects a held artifact that is not the deployment revision before mutation', async () => {
    const fixture = makeFixture();
    const source = makeSource(Buffer.from('different executable'));
    const harness = makeHarness(fixture, { source });

    await expect(
      harness.stager.stageRunningArtifact(fixture.authority),
    ).rejects.toBeInstanceOf(DeploymentArtifactStageConflictError);
    expect(
      harness.store.store.putArtifactStageIntentIfAbsent,
    ).not.toHaveBeenCalled();
    expect(harness.client.putObject).not.toHaveBeenCalled();
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it('rejects false embedded app, revision, and target semantics before mutation', async () => {
    for (const semantic of /** @type {const} */ ([
      'app',
      'revision',
      'target',
    ])) {
      const fixture = makeFixture();
      const harness = makeHarness(fixture);

      await expect(
        harness.stager.stageRunningArtifact(
          makeSemanticallyFalseAuthority(fixture, semantic),
        ),
      ).rejects.toBeInstanceOf(DeploymentArtifactStageConflictError);
      expect(harness.readEmbeddedRevisionRuntimePair).toHaveBeenCalledTimes(1);
      expect(harness.source.close).toHaveBeenCalledTimes(1);
      expect(harness.source.createReadStream).not.toHaveBeenCalled();
      expect(harness.source.verifyUnchanged).not.toHaveBeenCalled();
      expect(harness.createNonce).not.toHaveBeenCalled();
      expect(
        harness.store.store.putArtifactStageIntentIfAbsent,
      ).not.toHaveBeenCalled();
      expect(
        harness.store.store.readArtifactStageIntent,
      ).not.toHaveBeenCalled();
      expect(harness.client.putObject).not.toHaveBeenCalled();
      expect(harness.client.headObject).not.toHaveBeenCalled();
    }
  });

  it('validates persisted intent and receipt by exact version without opening local bytes', async () => {
    const fixture = makeFixture();
    const intent = makeIntent(fixture);
    const receipt = makeReceipt(intent, 'retained-version');
    const store = makeStore({ intent, receipt });
    const client = makeClient();
    client.installHead(makeHead(intent, 'retained-version'), false);
    client.installHead(
      makeHead(intent, 'new-current-version', {
        Metadata: { ...expectedMetadata(intent), 'wharfie-digest': 'corrupt' },
      }),
    );
    const harness = makeHarness(fixture, { store, client });

    const bundle = await harness.stager.validateStagedArtifact(
      fixture.authority,
    );

    expect(bundle).toEqual({ intent, receipt });
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(client.headObject).toHaveBeenCalledWith({
      Bucket: intent.object.bucketName,
      Key: intent.object.key,
      VersionId: 'retained-version',
      ChecksumMode: 'ENABLED',
      ExpectedBucketOwner: fixture.providerScope.accountId,
    });
    expect(client.putObject).not.toHaveBeenCalled();
    expect(harness.openArtifactSource).not.toHaveBeenCalled();
    expect(harness.readEmbeddedRevisionRuntimePair).not.toHaveBeenCalled();
  });

  it('reports missing intent and receipt records without touching S3 or local bytes', async () => {
    const fixture = makeFixture();
    const harness = makeHarness(fixture);

    await expect(
      harness.stager.validateStagedArtifact(fixture.authority),
    ).rejects.toBeInstanceOf(DeploymentArtifactStageMissingError);
    const intent = makeIntent(fixture);
    harness.store.state.intent = intent;
    await expect(
      harness.stager.validateStagedArtifact(fixture.authority),
    ).rejects.toBeInstanceOf(DeploymentArtifactStageMissingError);
    expect(harness.client.headObject).not.toHaveBeenCalled();
    expect(harness.client.putObject).not.toHaveBeenCalled();
    expect(harness.openArtifactSource).not.toHaveBeenCalled();
    expect(harness.readEmbeddedRevisionRuntimePair).not.toHaveBeenCalled();
  });

  it('rejects corrupt exact-version evidence during validation', async () => {
    const fixture = makeFixture();
    const intent = makeIntent(fixture);
    const receipt = makeReceipt(intent);
    const client = makeClient({
      headTransform: (head) => ({ ...head, ChecksumSHA256: 'bad' }),
    });
    client.installHead(makeHead(intent));
    const harness = makeHarness(fixture, {
      store: makeStore({ intent, receipt }),
      client,
    });

    await expect(
      harness.stager.validateStagedArtifact(fixture.authority),
    ).rejects.toBeInstanceOf(DeploymentArtifactStageConflictError);
    expect(harness.openArtifactSource).not.toHaveBeenCalled();
  });

  it('reports an absent exact receipt version during validation', async () => {
    const fixture = makeFixture();
    const intent = makeIntent(fixture);
    const receipt = makeReceipt(intent, 'missing-version');
    const harness = makeHarness(fixture, {
      store: makeStore({ intent, receipt }),
    });

    await expect(
      harness.stager.validateStagedArtifact(fixture.authority),
    ).rejects.toBeInstanceOf(DeploymentArtifactStageMissingError);
    expect(harness.openArtifactSource).not.toHaveBeenCalled();
  });

  it('rejects mismatched deployment authority before opening or distributed reads', async () => {
    const fixture = makeFixture();
    const harness = makeHarness(fixture);
    const otherScope = createAwsProviderScope({
      partition: 'aws',
      accountId: '123456789012',
      region: 'us-west-2',
    });

    await expect(
      harness.stager.stageRunningArtifact({
        ...fixture.authority,
        providerScope: otherScope,
      }),
    ).rejects.toBeInstanceOf(DeploymentArtifactStageConflictError);
    expect(harness.openArtifactSource).not.toHaveBeenCalled();
    expect(harness.store.store.readArtifactStageIntent).not.toHaveBeenCalled();
  });

  it('closes a malformed injected artifact source before rejecting it', async () => {
    const fixture = makeFixture();
    const close = jest.fn(async () => {});
    const store = makeStore().store;
    const client = makeClient().client;
    const stager = createDeploymentArtifactStager({
      client,
      store,
      openArtifactSource: async () => ({
        observation: {},
        createReadStream: () => null,
        close,
      }),
      createOwnershipNonce: () => createOwnershipNonce(Buffer.alloc(32, 19)),
    });

    await expect(
      stager.stageRunningArtifact(fixture.authority),
    ).rejects.toThrow(/source\.verifyUnchanged is required/i);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('retains malformed-source validation before its close failure', async () => {
    const fixture = makeFixture();
    const closeFailure = Symbol('malformed source close failed');
    const close = jest.fn(async () => {
      throw closeFailure;
    });
    const store = makeStore().store;
    const client = makeClient().client;
    const stager = createDeploymentArtifactStager({
      client,
      store,
      openArtifactSource: async () => ({
        observation: {},
        createReadStream: () => null,
        close,
      }),
      createOwnershipNonce: () => createOwnershipNonce(Buffer.alloc(32, 19)),
    });

    const failure = await captureRejection(
      stager.stageRunningArtifact(fixture.authority),
    );

    expect(failure).toBeInstanceOf(AggregateError);
    const errors = /** @type {AggregateError} */ (failure).errors;
    expect(errors[0]).toBeInstanceOf(TypeError);
    expect(/** @type {Error} */ (errors[0]).message).toMatch(
      /source\.verifyUnchanged is required/i,
    );
    expect(errors[1]).toBe(closeFailure);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('captures a stateful source close method exactly once', async () => {
    const fixture = makeFixture();
    const base = makeSource(fixture.bytes);
    let closeReads = 0;
    const statefulSource = {
      observation: base.source.observation,
      createReadStream: base.source.createReadStream,
      verifyUnchanged: base.source.verifyUnchanged,
      get close() {
        closeReads += 1;
        if (closeReads > 1) {
          throw new Error('source close was read more than once');
        }
        return base.close;
      },
    };
    const source = {
      ...base,
      source: statefulSource,
    };
    const harness = makeHarness(fixture, { source });

    const bundle = await harness.stager.stageRunningArtifact(fixture.authority);
    expect(bundle).toEqual({
      intent: harness.store.state.intent,
      receipt: harness.store.state.receipt,
    });
    expect(closeReads).toBe(1);
    expect(base.close).toHaveBeenCalledTimes(1);
  });

  it('retains source validation before an initial close-lookup failure', async () => {
    const fixture = makeFixture();
    const closeLookupFailure = Symbol('source close lookup failed');
    const source = {
      observation: fixture.observation,
      createReadStream: () => null,
      verifyUnchanged: async () => fixture.observation,
    };
    Object.defineProperty(source, 'close', {
      enumerable: true,
      get: () => {
        throw closeLookupFailure;
      },
    });
    const stager = createDeploymentArtifactStager({
      client: makeClient().client,
      store: makeStore().store,
      openArtifactSource: async () => source,
      createOwnershipNonce: () => createOwnershipNonce(Buffer.alloc(32, 23)),
    });

    const failure = await captureRejection(
      stager.stageRunningArtifact(fixture.authority),
    );

    expect(failure).toBeInstanceOf(AggregateError);
    const errors = /** @type {AggregateError} */ (failure).errors;
    expect(errors[0]).toBeInstanceOf(TypeError);
    expect(/** @type {Error} */ (errors[0]).message).toMatch(
      /source\.close is required/i,
    );
    expect(errors[1]).toBe(closeLookupFailure);
  });

  it('enforces the exact factory and public method boundaries', async () => {
    const fixture = makeFixture();
    const store = makeStore().store;
    const client = makeClient().client;

    expect(() =>
      createDeploymentArtifactStager({ client, store, extra: true }),
    ).toThrow(/options\.extra is not supported/i);
    expect(() =>
      createDeploymentArtifactStager({
        client: { headObject: async () => ({}) },
        store,
      }),
    ).toThrow(/client\.putObject is required/i);
    expect(() =>
      createDeploymentArtifactStager({
        client,
        store: { ...store, readArtifactStageReceipt: undefined },
      }),
    ).toThrow(/store\.readArtifactStageReceipt is required/i);
    expect(() =>
      createDeploymentArtifactStager({
        client,
        store,
        openArtifactSource: null,
      }),
    ).toThrow(/openArtifactSource must be a function/i);
    expect(() =>
      createDeploymentArtifactStager({
        client,
        store,
        createOwnershipNonce: null,
      }),
    ).toThrow(/createOwnershipNonce must be a function/i);
    expect(() =>
      createDeploymentArtifactStager({
        client,
        store,
        readEmbeddedRevisionRuntimePair: null,
      }),
    ).toThrow(/readEmbeddedRevisionRuntimePair must be a function/i);

    const harness = makeHarness(fixture);
    await expect(
      harness.stager.validateStagedArtifact({
        ...fixture.authority,
        extra: true,
      }),
    ).rejects.toThrow(/authority\.extra is not supported/i);
  });
});
