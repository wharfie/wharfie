import { createHash } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import {
  DEPLOYMENT_ARTIFACT_STAGE_DOCUMENT_MAX_BYTES,
  DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_DOMAIN,
  DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_PREFIX,
  DEPLOYMENT_ARTIFACT_STAGE_INTENT_KIND,
  DEPLOYMENT_ARTIFACT_STAGE_INTENT_SCHEMA_VERSION,
  DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES,
  DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_DOMAIN,
  DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_PREFIX,
  DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_KIND,
  DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_SCHEMA_VERSION,
  DEPLOYMENT_ARTIFACT_STAGE_VERSION_ID_MAX_BYTES,
  createDeploymentArtifactStageIntent,
  createDeploymentArtifactStageReceipt,
  getDeploymentArtifactStageObjectKey,
  getDeploymentArtifactStageObjectLocation,
  getDeploymentControlBucketName,
  validateDeploymentArtifactStageIntent,
  validateDeploymentArtifactStageIntentContext,
  validateDeploymentArtifactStageReceipt,
  validateDeploymentArtifactStageReceiptContext,
} from '../../src/core/runtime/deployment-artifact-stage.js';
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

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {string} value @returns {{algorithm: 'sha256', value: string}} */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {'x64'|'arm64'} [architecture] @param {string} [region] */
function makeProfile(architecture = 'x64', region = 'us-east-1') {
  return createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'artifact-stage-demo',
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture,
      libc: 'glibc',
    },
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider(region),
  });
}

/** @param {string} [accountId] @param {string} [region] @param {string} [partition] */
function makeScope(
  accountId = '123456789012',
  region = 'us-east-1',
  partition = 'aws',
) {
  return createAwsProviderScope({ partition, accountId, region });
}

/** @param {string} value */
function makeArtifact(value = 'exact running SEA bytes') {
  const byteDigest = digest(value);
  return {
    artifactId: `waf1_${byteDigest.value}`,
    byteDigest,
    size: Buffer.byteLength(value),
    appId: 'artifact-stage-demo',
    revisionId: createCanonicalJsonSha256Id({
      domain: 'wharfie:revision:v1',
      prefix: 'wrv1',
      value: { fixture: 'revision' },
    }),
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
  };
}

/** @param {ReturnType<typeof makeArtifact>} artifact @param {ReturnType<typeof makeProfile>} profile */
function makeDeploymentRevision(artifact, profile) {
  const payload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'api' },
    appId: artifact.appId,
    revisionId: artifact.revisionId,
    artifactId: artifact.artifactId,
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

/** @param {Record<string, any>} [overrides] */
function makeFixture(overrides = {}) {
  const artifact = overrides.artifact || makeArtifact();
  const profile = overrides.profile || makeProfile();
  const providerScope = overrides.providerScope || makeScope();
  const intent = createDeploymentArtifactStageIntent({
    providerScope,
    artifact,
    ownershipNonce:
      overrides.ownershipNonce || createOwnershipNonce(Buffer.alloc(32, 7)),
  });
  const deploymentRevision =
    overrides.deploymentRevision || makeDeploymentRevision(artifact, profile);
  return { artifact, profile, providerScope, intent, deploymentRevision };
}

/** @param {ReturnType<typeof makeFixture>} fixture @param {Record<string, any>} [overrides] */
function receiptObject(fixture, overrides = {}) {
  return {
    bucketName: fixture.intent.object.bucketName,
    key: fixture.intent.object.key,
    versionId: '3/L4kqtJlcpXroDTDmJ+rmSpXd3dIbrHY+MTRCxf3vjVBH40=',
    contentLength: fixture.artifact.size,
    checksum: clone(fixture.artifact.byteDigest),
    serverSideEncryption: 'AES256',
    storageClass: 'STANDARD',
    ...overrides,
  };
}

/** @param {Record<string, any>} intent */
function reidentifyIntent(intent) {
  const copy = clone(intent);
  delete copy.stageIntentId;
  return {
    ...copy,
    stageIntentId: createCanonicalJsonSha256Id({
      domain: DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_DOMAIN,
      prefix: DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_PREFIX,
      value: copy,
    }),
  };
}

/** @param {Record<string, any>} receipt */
function reidentifyReceipt(receipt) {
  const copy = clone(receipt);
  delete copy.stageReceiptId;
  return {
    ...copy,
    stageReceiptId: createCanonicalJsonSha256Id({
      domain: DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_DOMAIN,
      prefix: DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_PREFIX,
      value: copy,
    }),
  };
}

describe('deployment artifact stage intent', () => {
  it('binds scope, artifact, deterministic location, and ownership in one immutable identity', () => {
    const fixture = makeFixture();
    const { stageIntentId: _stageIntentId, ...payload } = fixture.intent;
    const scopeHash = createHash('sha256')
      .update(fixture.providerScope.providerScopeId, 'utf8')
      .digest('hex')
      .slice(0, 20);

    expect(fixture.intent).toEqual({
      schemaVersion: 1,
      kind: 'deploymentArtifactStageIntent',
      stageIntentId: expect.stringMatching(/^wsi1_[A-Za-z0-9_-]{43}$/),
      providerScope: fixture.providerScope,
      artifact: fixture.artifact,
      object: {
        bucketName: `wharfie-dc-v1-123456789012-${scopeHash}`,
        key: `stage/v1/${fixture.artifact.artifactId}`,
      },
      ownershipNonce: createOwnershipNonce(Buffer.alloc(32, 7)),
    });
    expect(fixture.intent.stageIntentId).toBe(
      createCanonicalJsonSha256Id({
        domain: 'wharfie:deployment-artifact-stage-intent:v1',
        prefix: 'wsi1',
        value: payload,
      }),
    );
    expect(Object.isFrozen(fixture.intent)).toBe(true);
    expect(Object.isFrozen(fixture.intent.providerScope)).toBe(true);
    expect(Object.isFrozen(fixture.intent.artifact.target)).toBe(true);
    expect(Object.isFrozen(fixture.intent.object)).toBe(true);
    expect(DEPLOYMENT_ARTIFACT_STAGE_INTENT_SCHEMA_VERSION).toBe(1);
    expect(DEPLOYMENT_ARTIFACT_STAGE_INTENT_KIND).toBe(
      'deploymentArtifactStageIntent',
    );
    expect(DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_DOMAIN).toBe(
      'wharfie:deployment-artifact-stage-intent:v1',
    );
    expect(DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_PREFIX).toBe('wsi1');
  });

  it('exposes one deterministic bucket, object key, and full lookup', () => {
    const fixture = makeFixture();
    const location = getDeploymentArtifactStageObjectLocation(
      fixture.providerScope,
      fixture.artifact.artifactId,
    );

    expect(getDeploymentControlBucketName(fixture.providerScope)).toBe(
      fixture.intent.object.bucketName,
    );
    expect(
      getDeploymentArtifactStageObjectKey(fixture.artifact.artifactId),
    ).toBe(fixture.intent.object.key);
    expect(location).toEqual(fixture.intent.object);
    expect(Object.isFrozen(location)).toBe(true);

    const otherRegion = makeScope('123456789012', 'us-west-2');
    const otherPartition = makeScope('123456789012', 'us-east-1', 'aws-us-gov');
    expect(getDeploymentControlBucketName(otherRegion)).not.toBe(
      location.bucketName,
    );
    expect(getDeploymentControlBucketName(otherPartition)).not.toBe(
      location.bucketName,
    );
    expect(getDeploymentControlBucketName(otherRegion)).toMatch(
      /^wharfie-dc-v1-123456789012-[a-f0-9]{20}$/,
    );
  });

  it('canonicalizes and independently freezes serialized values', () => {
    const fixture = makeFixture();
    const reorderedArtifact = {
      target: {
        libc: 'glibc',
        architecture: 'x64',
        platform: 'linux',
        nodeVersion: '24.13.1',
      },
      revisionId: fixture.artifact.revisionId,
      appId: fixture.artifact.appId,
      size: fixture.artifact.size,
      byteDigest: {
        value: fixture.artifact.byteDigest.value,
        algorithm: 'sha256',
      },
      artifactId: fixture.artifact.artifactId,
    };
    const recreated = createDeploymentArtifactStageIntent({
      ownershipNonce: fixture.intent.ownershipNonce,
      artifact: reorderedArtifact,
      providerScope: clone(fixture.providerScope),
    });
    const serialized = clone(fixture.intent);
    const validated = validateDeploymentArtifactStageIntent(serialized);

    expect(recreated).toEqual(fixture.intent);
    expect(validated).toEqual(fixture.intent);
    expect(validated).not.toBe(serialized);
    serialized.artifact.target.nodeVersion = '25.0.0';
    expect(validated.artifact.target.nodeVersion).toBe('24.13.1');
  });

  it('changes identity when any scope, artifact, or ownership input changes', () => {
    const first = makeFixture();
    const second = makeFixture({
      ownershipNonce: createOwnershipNonce(Buffer.alloc(32, 8)),
    });
    const otherArtifact = makeArtifact('different bytes');
    const third = makeFixture({ artifact: otherArtifact });
    const fourth = makeFixture({
      providerScope: makeScope('210987654321'),
    });

    expect(
      new Set([
        first.intent.stageIntentId,
        second.intent.stageIntentId,
        third.intent.stageIntentId,
        fourth.intent.stageIntentId,
      ]).size,
    ).toBe(4);
  });

  it('accepts a zero-byte observation but enforces one explicit safe upper bound', () => {
    const empty = makeArtifact('');
    expect(makeFixture({ artifact: empty }).intent.artifact.size).toBe(0);

    for (const size of [
      -1,
      0.5,
      DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES + 1,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      const artifact = { ...makeArtifact(), size };
      expect(() => makeFixture({ artifact })).toThrow(
        /size must be a nonnegative safe integer no larger/i,
      );
    }
    expect(DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES).toBe(5 * 1024 ** 3);
    expect(DEPLOYMENT_ARTIFACT_STAGE_DOCUMENT_MAX_BYTES).toBe(32 * 1024);
  });

  it.each([
    [
      'artifact ID syntax',
      /** @type {(value: any) => void} */ (
        (value) => (value.artifact.artifactId = 'waf1_bad')
      ),
      /artifactId must be a canonical/i,
    ],
    [
      'artifact digest relation',
      /** @type {(value: any) => void} */ (
        (value) => (value.artifact.byteDigest = digest('other'))
      ),
      /artifactId must name its exact byteDigest/i,
    ],
    [
      'application identity',
      /** @type {(value: any) => void} */ (
        (value) => (value.artifact.appId = 'Not Canonical')
      ),
      /appId must be a canonical logical ID/i,
    ],
    [
      'revision identity',
      /** @type {(value: any) => void} */ (
        (value) => (value.artifact.revisionId = 'wrv1_bad')
      ),
      /revisionId must be a canonical/i,
    ],
    [
      'target',
      /** @type {(value: any) => void} */ (
        (value) => (value.artifact.target.libc = 'musl')
      ),
      /libc must be 'glibc'/i,
    ],
    [
      'ownership nonce',
      /** @type {(value: any) => void} */ (
        (value) => (value.ownershipNonce = 'short')
      ),
      /ownershipNonce must be canonical/i,
    ],
  ])('rejects an invalid %s', (_name, mutate, pattern) => {
    const fixture = makeFixture();
    const input = {
      providerScope: clone(fixture.providerScope),
      artifact: clone(fixture.artifact),
      ownershipNonce: fixture.intent.ownershipNonce,
    };
    mutate(input);
    expect(() => createDeploymentArtifactStageIntent(input)).toThrow(pattern);
  });

  it('requires exact fields and refuses a forged bucket, key, or content identity', () => {
    const fixture = makeFixture();
    expect(() =>
      createDeploymentArtifactStageIntent({
        providerScope: fixture.providerScope,
        artifact: fixture.artifact,
        ownershipNonce: fixture.intent.ownershipNonce,
        extra: true,
      }),
    ).toThrow(/extra is not supported/i);

    const extraArtifact = clone(fixture.artifact);
    extraArtifact.credential = 'do-not-store';
    expect(() =>
      createDeploymentArtifactStageIntent({
        providerScope: fixture.providerScope,
        artifact: extraArtifact,
        ownershipNonce: fixture.intent.ownershipNonce,
      }),
    ).toThrow(/artifact\.credential is not supported/i);

    const wrongBucket = clone(fixture.intent);
    wrongBucket.object.bucketName = getDeploymentControlBucketName(
      makeScope('210987654321'),
    );
    expect(() =>
      validateDeploymentArtifactStageIntent(reidentifyIntent(wrongBucket)),
    ).toThrow(/canonical control bucket/i);

    const wrongKey = clone(fixture.intent);
    wrongKey.object.key = `stage/v1/waf1_${digest('other').value}`;
    expect(() =>
      validateDeploymentArtifactStageIntent(reidentifyIntent(wrongKey)),
    ).toThrow(/object\.key must be/i);

    const wrongId = clone(fixture.intent);
    wrongId.artifact.size += 1;
    expect(() => validateDeploymentArtifactStageIntent(wrongId)).toThrow(
      /stageIntentId does not match/i,
    );
  });

  it('cross-checks deployment revision, profile, target, and resolved scope authority', () => {
    const fixture = makeFixture();
    const context = {
      deploymentRevision: fixture.deploymentRevision,
      profile: fixture.profile,
      providerScope: fixture.providerScope,
    };
    expect(
      validateDeploymentArtifactStageIntentContext(
        clone(fixture.intent),
        context,
      ),
    ).toEqual(fixture.intent);

    const otherScope = makeScope('123456789012', 'us-west-2');
    expect(() =>
      validateDeploymentArtifactStageIntentContext(fixture.intent, {
        ...context,
        providerScope: otherScope,
      }),
    ).toThrow(/providerScope does not match context/i);

    const otherArtifact = makeArtifact('other exact bytes');
    expect(() =>
      validateDeploymentArtifactStageIntentContext(fixture.intent, {
        ...context,
        deploymentRevision: makeDeploymentRevision(
          otherArtifact,
          fixture.profile,
        ),
      }),
    ).toThrow(/artifactId does not match context/i);

    const armProfile = makeProfile('arm64');
    expect(() =>
      validateDeploymentArtifactStageIntentContext(fixture.intent, {
        ...context,
        profile: armProfile,
        deploymentRevision: makeDeploymentRevision(
          fixture.artifact,
          armProfile,
        ),
      }),
    ).toThrow(/artifact\.target does not match context/i);

    expect(() =>
      validateDeploymentArtifactStageIntentContext(fixture.intent, {
        ...context,
        extra: true,
      }),
    ).toThrow(/context\.extra is not supported/i);
  });
});

describe('deployment artifact stage receipt', () => {
  it('binds the exact intent and provider object version in one immutable identity', () => {
    const fixture = makeFixture();
    const object = receiptObject(fixture);
    const receipt = createDeploymentArtifactStageReceipt({
      intent: fixture.intent,
      object,
    });
    const { stageReceiptId: _stageReceiptId, ...payload } = receipt;

    expect(receipt).toEqual({
      schemaVersion: 1,
      kind: 'deploymentArtifactStageReceipt',
      stageReceiptId: expect.stringMatching(/^wsr1_[A-Za-z0-9_-]{43}$/),
      stageIntentId: fixture.intent.stageIntentId,
      artifactId: fixture.artifact.artifactId,
      object,
    });
    expect(receipt.stageReceiptId).toBe(
      createCanonicalJsonSha256Id({
        domain: 'wharfie:deployment-artifact-stage-receipt:v1',
        prefix: 'wsr1',
        value: payload,
      }),
    );
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.object.checksum)).toBe(true);
    expect(DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_SCHEMA_VERSION).toBe(1);
    expect(DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_KIND).toBe(
      'deploymentArtifactStageReceipt',
    );
    expect(DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_DOMAIN).toBe(
      'wharfie:deployment-artifact-stage-receipt:v1',
    );
    expect(DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_PREFIX).toBe('wsr1');
  });

  it('canonicalizes, clones, and validates opaque S3-style version IDs', () => {
    const fixture = makeFixture();
    const receipt = createDeploymentArtifactStageReceipt({
      object: receiptObject(fixture, {
        versionId: '版本 / 🌊\nBearer provider-opaque-value',
      }),
      intent: clone(fixture.intent),
    });
    const serialized = clone(receipt);
    const validated = validateDeploymentArtifactStageReceipt(serialized);

    expect(validated).toEqual(receipt);
    expect(validated).not.toBe(serialized);
    serialized.object.checksum.value = digest('mutated').value;
    expect(validated.object.checksum.value).toBe(
      fixture.artifact.byteDigest.value,
    );
    expect(validated.object.versionId).toBe(
      '版本 / 🌊\nBearer provider-opaque-value',
    );
    expect(DEPLOYMENT_ARTIFACT_STAGE_VERSION_ID_MAX_BYTES).toBe(1024);
  });

  it('bounds opaque version identities by UTF-8 bytes rather than UTF-16 code units', () => {
    const fixture = makeFixture();
    const exactLimit = 'é'.repeat(512);
    expect(
      createDeploymentArtifactStageReceipt({
        intent: fixture.intent,
        object: receiptObject(fixture, { versionId: exactLimit }),
      }).object.versionId,
    ).toBe(exactLimit);
    expect(() =>
      createDeploymentArtifactStageReceipt({
        intent: fixture.intent,
        object: receiptObject(fixture, { versionId: `${exactLimit}é` }),
      }),
    ).toThrow(/no longer than 1024 UTF-8 bytes/i);
  });

  it.each([
    [
      'literal null versionId',
      { versionId: 'null' },
      /versionId must be a nonempty, non-'null'/i,
    ],
    [
      'empty versionId',
      { versionId: '' },
      /versionId must be a nonempty, non-'null'/i,
    ],
    [
      'version length',
      { versionId: 'a'.repeat(1025) },
      /no longer than 1024 UTF-8 bytes/i,
    ],
    [
      'unpaired high surrogate',
      { versionId: '\ud800' },
      /well-formed opaque Unicode/i,
    ],
    [
      'unpaired low surrogate',
      { versionId: '\udfff' },
      /well-formed opaque Unicode/i,
    ],
    [
      'content length',
      { contentLength: -1 },
      /contentLength must be a nonnegative safe integer/i,
    ],
    [
      'oversize content',
      { contentLength: DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES + 1 },
      /contentLength must be a nonnegative safe integer/i,
    ],
    [
      'checksum',
      { checksum: { algorithm: 'sha512', value: digest('x').value } },
      /checksum\.algorithm must be 'sha256'/i,
    ],
    [
      'encryption',
      { serverSideEncryption: 'aws:kms' },
      /serverSideEncryption must be 'AES256'/i,
    ],
    [
      'storage class',
      { storageClass: 'INTELLIGENT_TIERING' },
      /storageClass must be 'STANDARD'/i,
    ],
  ])('rejects invalid provider evidence: %s', (_name, override, pattern) => {
    const fixture = makeFixture();
    expect(() =>
      createDeploymentArtifactStageReceipt({
        intent: fixture.intent,
        object: receiptObject(fixture, override),
      }),
    ).toThrow(pattern);
  });

  it('requires exact receipt fields and the exact deterministic artifact key', () => {
    const fixture = makeFixture();
    expect(() =>
      createDeploymentArtifactStageReceipt({
        intent: fixture.intent,
        object: { ...receiptObject(fixture), etag: 'not-authority' },
      }),
    ).toThrow(/object\.etag is not supported/i);
    expect(() =>
      createDeploymentArtifactStageReceipt({
        intent: fixture.intent,
        object: receiptObject(fixture),
        extra: true,
      }),
    ).toThrow(/extra is not supported/i);
    expect(() =>
      createDeploymentArtifactStageReceipt({
        intent: fixture.intent,
        object: receiptObject(fixture, {
          key: `stage/v1/waf1_${digest('other').value}`,
        }),
      }),
    ).toThrow(/object\.key must be/i);
  });

  it('requires exact bucket, key, artifact, content length, and digest context', () => {
    const fixture = makeFixture();
    const receipt = createDeploymentArtifactStageReceipt({
      intent: fixture.intent,
      object: receiptObject(fixture),
    });
    expect(
      validateDeploymentArtifactStageReceiptContext(clone(receipt), {
        intent: fixture.intent,
      }),
    ).toEqual(receipt);

    const otherIntent = makeFixture({
      ownershipNonce: createOwnershipNonce(Buffer.alloc(32, 9)),
    }).intent;
    expect(() =>
      validateDeploymentArtifactStageReceiptContext(receipt, {
        intent: otherIntent,
      }),
    ).toThrow(/stageIntentId does not match context/i);

    const wrongLength = clone(receipt);
    wrongLength.object.contentLength += 1;
    expect(
      validateDeploymentArtifactStageReceipt(reidentifyReceipt(wrongLength))
        .object.contentLength,
    ).toBe(fixture.artifact.size + 1);
    expect(() =>
      validateDeploymentArtifactStageReceiptContext(
        reidentifyReceipt(wrongLength),
        { intent: fixture.intent },
      ),
    ).toThrow(/contentLength does not match context/i);

    const wrongChecksum = clone(receipt);
    wrongChecksum.object.checksum = digest('different bytes');
    expect(() =>
      validateDeploymentArtifactStageReceiptContext(
        reidentifyReceipt(wrongChecksum),
        { intent: fixture.intent },
      ),
    ).toThrow(/checksum does not match context/i);

    const otherScope = makeScope('210987654321');
    const wrongBucket = clone(receipt);
    wrongBucket.object.bucketName = getDeploymentControlBucketName(otherScope);
    expect(() =>
      validateDeploymentArtifactStageReceiptContext(
        reidentifyReceipt(wrongBucket),
        { intent: fixture.intent },
      ),
    ).toThrow(/object location does not match context/i);
  });

  it('rejects a structurally valid receipt for another artifact and detects stale identity', () => {
    const fixture = makeFixture();
    const receipt = createDeploymentArtifactStageReceipt({
      intent: fixture.intent,
      object: receiptObject(fixture),
    });
    const otherFixture = makeFixture({ artifact: makeArtifact('other bytes') });
    const otherReceipt = createDeploymentArtifactStageReceipt({
      intent: otherFixture.intent,
      object: receiptObject(otherFixture),
    });

    expect(() =>
      validateDeploymentArtifactStageReceiptContext(otherReceipt, {
        intent: fixture.intent,
      }),
    ).toThrow(/stageIntentId does not match context/i);

    const staleId = clone(receipt);
    staleId.object.versionId = 'another-version';
    expect(() => validateDeploymentArtifactStageReceipt(staleId)).toThrow(
      /stageReceiptId does not match/i,
    );
  });

  it('refuses oversized documents before allocating an unbounded durable clone', () => {
    const fixture = makeFixture();
    const receipt = createDeploymentArtifactStageReceipt({
      intent: fixture.intent,
      object: receiptObject(fixture),
    });
    const oversized = /** @type {Record<string, any>} */ (clone(receipt));
    oversized.untrusted = 'x'.repeat(
      DEPLOYMENT_ARTIFACT_STAGE_DOCUMENT_MAX_BYTES,
    );
    expect(() => validateDeploymentArtifactStageReceipt(oversized)).toThrow(
      /encoded JSON must not exceed 32768 bytes/i,
    );
  });
});
