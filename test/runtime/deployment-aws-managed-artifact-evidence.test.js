import { describe, expect, it, jest } from '@jest/globals';

import {
  createCanonicalJsonSha256Id,
  createSha256Id,
} from '../../src/core/runtime/content-id.js';
import {
  AwsSingleNodeManagedArtifactEvidenceConflictError,
  AwsSingleNodeManagedArtifactEvidenceTransientError,
  AwsSingleNodeManagedArtifactEvidenceUnknownError,
  createAwsSingleNodeManagedArtifactHistoryEvidence,
  decodeAwsSingleNodeManagedArtifactHead,
  decodeAwsSingleNodeManagedArtifactMetadata,
  getAwsSingleNodeManagedArtifactStateDigest,
  validateAwsSingleNodeManagedArtifactHeadEvidence,
} from '../../src/core/runtime/deployment-aws-managed-artifact-evidence.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import { getAwsSingleNodeManagedArtifactObjectLocation } from '../../src/core/runtime/deployment-aws-runtime-identity-contract.js';
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
  createOwnershipNonce,
} from '../../src/core/runtime/deployment-resource-binding.js';
import { validateDeploymentRevision } from '../../src/core/runtime/deployment-revision.js';

/** @typedef {Record<string, any>} AnyRecord */

/** @param {string} prefix @param {string} domain @param {unknown} value @returns {string} */
function semanticId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({ prefix, domain, value });
}

/** @param {any} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @param {Readonly<AnyRecord>} profile @param {number} number */
function makeRevision(profile, number) {
  const payload = {
    schemaVersion: 1,
    kind: 'deploymentRevision',
    deployment: { id: 'production' },
    appId: profile.appId,
    revisionId: semanticId(
      'wrv1',
      'wharfie:test:managed-artifact-evidence-revision:v1',
      { number },
    ),
    artifactId: createSha256Id({
      prefix: 'waf1',
      payload: `managed artifact evidence bytes ${number}`,
    }),
    profileRevisionId: profile.profileRevisionId,
  };
  return validateDeploymentRevision({
    ...payload,
    deploymentRevisionId: semanticId(
      'wdr1',
      'wharfie:deployment-revision:v1',
      payload,
    ),
  });
}

/** @returns {Readonly<AnyRecord>} */
function makeBase() {
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'managed-artifact-evidence-test',
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider('us-east-1'),
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
      ebsKmsKeyArn:
        'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555',
    },
  });
  const deploymentRevision = makeRevision(profile, 2);
  const previousDeploymentRevision = makeRevision(profile, 1);
  const deploymentInstanceId = getDeploymentInstanceId({
    deploymentRevision,
    providerScope,
  });
  const incarnationId = createDeploymentIncarnationId(Buffer.alloc(32, 17));
  return Object.freeze({
    profile,
    providerScope,
    providerSpec,
    deploymentRevision,
    previousDeploymentRevision,
    deploymentInstanceId,
    incarnationId,
    location: getAwsSingleNodeManagedArtifactObjectLocation({
      providerScope,
      deploymentInstanceId,
      incarnationId,
    }),
    createdByActionId: semanticId(
      'wda3',
      'wharfie:test:managed-artifact-evidence-action:v1',
      {},
    ),
    ownershipNonce: createOwnershipNonce(Buffer.alloc(32, 18)),
  });
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>} revision */
function stateDigest(base, revision) {
  return getAwsSingleNodeManagedArtifactStateDigest({
    deploymentRevision: revision,
    profile: base.profile,
    providerScope: base.providerScope,
    providerSpec: base.providerSpec,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
  });
}

/** @param {Readonly<AnyRecord>} base */
function evidenceAuthority(base) {
  return {
    providerScope: base.providerScope,
    artifactStorage: base.providerSpec.capabilities.artifactStorage,
    deploymentInstanceId: base.deploymentInstanceId,
    incarnationId: base.incarnationId,
    createdByActionId: base.createdByActionId,
    ownershipNonce: base.ownershipNonce,
    appId: base.profile.appId,
  };
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>} revision @param {Record<string, any>} [overrides] */
function metadata(base, revision, overrides = {}) {
  return {
    'wharfie-schema': 'deployment-managed-artifact-v1',
    'wharfie-managed-by': 'wharfie',
    'wharfie-resource-kind': 'single-node-managed-artifact',
    'wharfie-retention': 'purge',
    'wharfie-capability': 'artifact-storage',
    'wharfie-role': 'object',
    'wharfie-provider-scope-id': base.providerScope.providerScopeId,
    'wharfie-deployment-instance-id': base.deploymentInstanceId,
    'wharfie-incarnation-id': base.incarnationId,
    'wharfie-resource-key': 'artifact',
    'wharfie-created-by-action-id': base.createdByActionId,
    'wharfie-ownership-nonce': base.ownershipNonce,
    'wharfie-state-digest': stateDigest(base, revision).value,
    'wharfie-deployment-revision-id': revision.deploymentRevisionId,
    'wharfie-profile-revision-id': revision.profileRevisionId,
    'wharfie-app-id': revision.appId,
    'wharfie-revision-id': revision.revisionId,
    'wharfie-artifact-id': revision.artifactId,
    'wharfie-content-length': '137',
    'wharfie-stage-intent-id': semanticId(
      'wsi1',
      'wharfie:test:managed-artifact-evidence-stage-intent:v1',
      { revisionId: revision.revisionId },
    ),
    'wharfie-stage-receipt-id': semanticId(
      'wsr1',
      'wharfie:test:managed-artifact-evidence-stage-receipt:v1',
      { revisionId: revision.revisionId },
    ),
    ...overrides,
  };
}

/** @param {Readonly<AnyRecord>} base @param {Readonly<AnyRecord>} revision @param {Record<string, any>} [overrides] */
function head(base, revision, overrides = {}) {
  return {
    VersionId: 'opaque-version-1',
    ETag: '"opaque-etag"',
    ContentLength: 137,
    ChecksumSHA256: Buffer.from(
      revision.artifactId.slice('waf1_'.length),
      'base64url',
    ).toString('base64'),
    ServerSideEncryption: 'AES256',
    StorageClass: 'STANDARD',
    ContentType: 'application/octet-stream',
    CacheControl: 'no-store',
    Metadata: metadata(base, revision),
    ...overrides,
  };
}

/** @param {Readonly<AnyRecord>} base @param {AnyRecord[]} versions @param {AnyRecord[]} [markers] @param {Record<string, any>} [overrides] */
function page(base, versions, markers = [], overrides = {}) {
  return {
    Name: base.location.bucketName,
    Prefix: base.location.key,
    MaxKeys: 1000,
    EncodingType: 'url',
    IsTruncated: false,
    Versions: versions,
    DeleteMarkers: markers,
    ...overrides,
  };
}

/** @param {Readonly<AnyRecord>} base @param {string} versionId @param {string} etag @param {number} size @param {boolean} isLatest */
function listed(base, versionId, etag, size, isLatest) {
  return {
    Key: base.location.key,
    VersionId: versionId,
    ETag: etag,
    Size: size,
    IsLatest: isLatest,
    StorageClass: 'STANDARD',
    ChecksumAlgorithm: ['SHA256'],
  };
}

describe('AWS single-node managed artifact provider evidence', () => {
  it('derives verified actual digest from immutable metadata references', () => {
    const base = makeBase();
    const previous = base.previousDeploymentRevision;
    const decodedMetadata = decodeAwsSingleNodeManagedArtifactMetadata(
      metadata(base, previous),
      evidenceAuthority(base),
    );
    const decodedHead = decodeAwsSingleNodeManagedArtifactHead(
      head(base, previous),
      evidenceAuthority(base),
      'opaque-version-1',
    );

    expect(decodedMetadata.stateDigest).toEqual(stateDigest(base, previous));
    expect(decodedMetadata.stateDigest).not.toEqual(
      stateDigest(base, base.deploymentRevision),
    );
    expect(decodedHead).toMatchObject({
      versionId: 'opaque-version-1',
      etag: '"opaque-etag"',
      contentLength: 137,
      stateDigest: stateDigest(base, previous),
    });
    expectDeepFrozen(decodedMetadata);
    expectDeepFrozen(decodedHead);
  });

  it('revalidates one decoded head into an independent canonical frozen value', () => {
    const base = makeBase();
    const authority = evidenceAuthority(base);
    const versionId = 'Bearer opaque-provider-version';
    const decoded = decodeAwsSingleNodeManagedArtifactHead(
      head(base, base.deploymentRevision, {
        VersionId: versionId,
        ETag: '"secret-token"',
      }),
      authority,
      versionId,
    );
    const candidate = structuredClone(decoded);

    const validated = validateAwsSingleNodeManagedArtifactHeadEvidence(
      candidate,
      authority,
    );

    expect(validated).toEqual(decoded);
    expect(validated).not.toBe(candidate);
    expect(validated.metadata).not.toBe(candidate.metadata);
    expect(validated.stateDigest).not.toBe(candidate.stateDigest);
    expect(Object.keys(validated)).toEqual(
      [
        'versionId',
        'etag',
        'contentLength',
        'metadata',
        'stateDigest',
        'artifactId',
        'deploymentRevisionId',
        'revisionId',
        'stageIntentId',
        'stageReceiptId',
      ].sort(),
    );
    candidate.metadata['wharfie-app-id'] = 'changed-after-validation';
    candidate.stateDigest.value = 'changed-after-validation';
    expect(validated.metadata['wharfie-app-id']).toBe(base.profile.appId);
    expect(validated.stateDigest).toEqual(
      stateDigest(base, base.deploymentRevision),
    );
    expectDeepFrozen(validated);
  });

  it('rejects malformed decoded heads and exact-shape contradictions with the evidence taxonomy', () => {
    const base = makeBase();
    const authority = evidenceAuthority(base);
    const valid = structuredClone(
      decodeAwsSingleNodeManagedArtifactHead(
        head(base, base.deploymentRevision),
        authority,
        'opaque-version-1',
      ),
    );
    const missing = /** @type {AnyRecord} */ (structuredClone(valid));
    delete missing.stageReceiptId;

    expect(() =>
      validateAwsSingleNodeManagedArtifactHeadEvidence(null, authority),
    ).toThrow(AwsSingleNodeManagedArtifactEvidenceUnknownError);
    for (const candidate of [
      { ...valid, unsupported: true },
      missing,
      { ...valid, versionId: 'null' },
      { ...valid, etag: 'unquoted-etag' },
      { ...valid, contentLength: '137' },
      { ...valid, contentLength: 138 },
    ]) {
      expect(() =>
        validateAwsSingleNodeManagedArtifactHeadEvidence(candidate, authority),
      ).toThrow(AwsSingleNodeManagedArtifactEvidenceConflictError);
    }
  });

  it('re-decodes metadata and cross-checks every derived head field', () => {
    const base = makeBase();
    const authority = evidenceAuthority(base);
    const previous = structuredClone(
      decodeAwsSingleNodeManagedArtifactHead(
        head(base, base.previousDeploymentRevision),
        authority,
        'opaque-version-1',
      ),
    );
    const current = decodeAwsSingleNodeManagedArtifactHead(
      head(base, base.deploymentRevision),
      authority,
      'opaque-version-1',
    );
    const mismatches = {
      contentLength: previous.contentLength + 1,
      stateDigest: current.stateDigest,
      artifactId: current.artifactId,
      deploymentRevisionId: current.deploymentRevisionId,
      revisionId: current.revisionId,
      stageIntentId: current.stageIntentId,
      stageReceiptId: current.stageReceiptId,
    };

    for (const [field, replacement] of Object.entries(mismatches)) {
      expect(() =>
        validateAwsSingleNodeManagedArtifactHeadEvidence(
          { ...previous, [field]: replacement },
          authority,
        ),
      ).toThrow(AwsSingleNodeManagedArtifactEvidenceConflictError);
    }

    expect(() =>
      validateAwsSingleNodeManagedArtifactHeadEvidence(
        { ...previous, metadata: current.metadata },
        authority,
      ),
    ).toThrow(AwsSingleNodeManagedArtifactEvidenceConflictError);
    expect(() =>
      validateAwsSingleNodeManagedArtifactHeadEvidence(
        {
          ...previous,
          metadata: {
            ...previous.metadata,
            'wharfie-ownership-nonce': createOwnershipNonce(
              Buffer.alloc(32, 99),
            ),
          },
        },
        authority,
      ),
    ).toThrow(AwsSingleNodeManagedArtifactEvidenceConflictError);
  });

  it('rejects a claimed digest inconsistent with the metadata references', () => {
    const base = makeBase();
    expect(() =>
      decodeAwsSingleNodeManagedArtifactMetadata(
        metadata(base, base.previousDeploymentRevision, {
          'wharfie-state-digest': stateDigest(base, base.deploymentRevision)
            .value,
        }),
        evidenceAuthority(base),
      ),
    ).toThrow(AwsSingleNodeManagedArtifactEvidenceConflictError);
  });

  it('distinguishes malformed provider envelopes from contradictory object contracts', () => {
    const base = makeBase();
    expect(() =>
      decodeAwsSingleNodeManagedArtifactHead(
        null,
        evidenceAuthority(base),
        undefined,
      ),
    ).toThrow(AwsSingleNodeManagedArtifactEvidenceUnknownError);
    expect(() =>
      decodeAwsSingleNodeManagedArtifactHead(
        head(base, base.deploymentRevision, { StorageClass: 'GLACIER' }),
        evidenceAuthority(base),
        undefined,
      ),
    ).toThrow(AwsSingleNodeManagedArtifactEvidenceConflictError);
  });

  it('reads every bounded page before reconciling listed and current heads', async () => {
    const base = makeBase();
    const oldHead = {
      versionId: 'old-version',
      etag: '"old"',
      contentLength: 113,
    };
    const currentHead = {
      versionId: 'current-version',
      etag: '"current"',
      contentLength: 137,
    };
    const pages = [
      page(base, [listed(base, 'old-version', '"old"', 113, false)], [], {
        IsTruncated: true,
        NextKeyMarker: base.location.key,
        NextVersionIdMarker: 'cursor-version',
      }),
      page(base, [listed(base, 'current-version', '"current"', 137, true)]),
    ];
    const readHistoryPage = jest.fn(
      async (/** @type {Readonly<Record<string, any>>} */ _request) =>
        pages.shift(),
    );
    const readHead = jest.fn(
      async (/** @type {string|undefined} */ versionId) =>
        versionId === 'old-version' ? oldHead : currentHead,
    );
    const evidence = createAwsSingleNodeManagedArtifactHistoryEvidence({
      readHistoryPage,
      readHead,
    });

    const history = await evidence.readHistory({
      location: base.location,
      accountId: base.providerScope.accountId,
    });

    expect(history.versions).toEqual(
      [
        { ...listed(base, 'old-version', '"old"', 113, false), key: undefined },
        {
          ...listed(base, 'current-version', '"current"', 137, true),
          key: undefined,
        },
      ].map((entry, index) => ({
        key: base.location.key,
        versionId: index === 0 ? 'old-version' : 'current-version',
        isLatest: index === 1,
        etag: index === 0 ? '"old"' : '"current"',
        size: index === 0 ? 113 : 137,
        head: index === 0 ? oldHead : currentHead,
      })),
    );
    expect(history.current).toBe(currentHead);
    expect(readHistoryPage).toHaveBeenCalledTimes(2);
    expect(readHistoryPage.mock.calls[1][0]).toMatchObject({
      KeyMarker: base.location.key,
      VersionIdMarker: 'cursor-version',
    });
    for (const [request] of readHistoryPage.mock.calls) {
      expectDeepFrozen(request);
    }
    expectDeepFrozen(history);
  });

  it('rejects a duplicate version ID before requiring a continuation cursor', async () => {
    const base = makeBase();
    const duplicate = listed(base, 'duplicate-version', '"etag"', 7, true);
    const readHead = jest.fn();
    const readHistoryPage = jest.fn(async () =>
      page(base, [duplicate, { ...duplicate, IsLatest: false }], [], {
        IsTruncated: true,
      }),
    );
    const evidence = createAwsSingleNodeManagedArtifactHistoryEvidence({
      readHistoryPage,
      readHead,
    });

    await expect(
      evidence.readHistory({
        location: base.location,
        accountId: base.providerScope.accountId,
      }),
    ).rejects.toBeInstanceOf(AwsSingleNodeManagedArtifactEvidenceConflictError);
    expect(readHistoryPage).toHaveBeenCalledTimes(1);
    expect(readHead).not.toHaveBeenCalled();
  });

  it('rejects disagreement between the latest immutable head and its current alias', async () => {
    const base = makeBase();
    const authority = evidenceAuthority(base);
    const versionId = 'same-version';
    const etag = '"same"';
    const immutableHead = decodeAwsSingleNodeManagedArtifactHead(
      head(base, base.previousDeploymentRevision, {
        VersionId: versionId,
        ETag: etag,
      }),
      authority,
      versionId,
    );
    const currentHead = decodeAwsSingleNodeManagedArtifactHead(
      head(base, base.deploymentRevision, {
        VersionId: versionId,
        ETag: etag,
      }),
      authority,
      versionId,
    );
    const readHead = jest.fn(
      async (/** @type {string|undefined} */ requestedVersionId) =>
        requestedVersionId === undefined ? currentHead : immutableHead,
    );
    const evidence = createAwsSingleNodeManagedArtifactHistoryEvidence({
      readHistoryPage: async () =>
        page(base, [listed(base, versionId, etag, 137, true)]),
      readHead,
    });

    await expect(
      evidence.readHistory({
        location: base.location,
        accountId: base.providerScope.accountId,
      }),
    ).rejects.toBeInstanceOf(AwsSingleNodeManagedArtifactEvidenceConflictError);
    expect(readHead).toHaveBeenCalledTimes(2);
  });

  it('recognizes a fully reconciled latest delete marker and fails transiently on a missing listed version', async () => {
    const base = makeBase();
    const markerEvidence = createAwsSingleNodeManagedArtifactHistoryEvidence({
      readHistoryPage: async () =>
        page(
          base,
          [],
          [
            {
              Key: base.location.key,
              VersionId: 'delete-marker',
              IsLatest: true,
            },
          ],
        ),
      readHead: async () => null,
    });
    await expect(
      markerEvidence.readHistory({
        location: base.location,
        accountId: base.providerScope.accountId,
      }),
    ).resolves.toMatchObject({
      versions: [],
      markers: [{ versionId: 'delete-marker', isLatest: true }],
      current: null,
    });

    const transientEvidence = createAwsSingleNodeManagedArtifactHistoryEvidence(
      {
        readHistoryPage: async () =>
          page(base, [listed(base, 'lost-version', '"etag"', 7, true)]),
        readHead: async () => null,
      },
    );
    await expect(
      transientEvidence.readHistory({
        location: base.location,
        accountId: base.providerScope.accountId,
      }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeManagedArtifactEvidenceTransientError,
    );
  });
});
