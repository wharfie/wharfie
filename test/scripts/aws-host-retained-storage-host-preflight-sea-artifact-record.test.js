import { createHash } from 'node:crypto';

import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ENTRY_BUNDLE_FORMAT,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_ID_DOMAIN,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_ID_PREFIX,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_BLOB_FORMAT,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_RUNTIME_BUNDLE_FORMAT,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SOURCE_ARCHIVE_FORMAT,
  createAwsRetainedStorageHostPreflightSeaArtifactRecord,
  validateAwsRetainedStorageHostPreflightSeaArtifactRecordClaims,
  validateAwsRetainedStorageHostPreflightSeaArtifactRecord,
} from '../../scripts/aws-host-retained-storage-host-preflight-sea-artifact-record.js';
import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
  createAwsRetainedStorageHostPreflightSeaDeliveryManifest,
  stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest,
} from '../../scripts/aws-host-retained-storage-host-preflight-sea-delivery.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';

const SOURCE_COMMIT = 'ab'.repeat(20);

/** @param {Buffer | string} value */
function digest(value) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/** @param {unknown} value @returns {any} */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** @param {unknown} value */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @param {string} expectedArchitecture @returns {Record<string, any>} */
function fixture(expectedArchitecture = 'x86_64') {
  const delivery = createAwsRetainedStorageHostPreflightSeaDeliveryManifest({
    sourceCommit: SOURCE_COMMIT,
    expectedArchitecture,
  });
  const bundleBytes = Buffer.from(
    `require("node:process"); // ${expectedArchitecture}\n`,
    'utf8',
  );
  const runtimeBundleBytes = Buffer.from(
    `"use strict";require("node:process"); // generated-${expectedArchitecture}\n`,
    'utf8',
  );
  const seaBlobBytes = Buffer.from(
    `node-sea-blob:${expectedArchitecture}`,
    'utf8',
  );
  const artifactBytes = Buffer.from(
    `exact-final-sea:${expectedArchitecture}`,
    'utf8',
  );
  const sourceArchiveBytes = Buffer.from(
    `git archive ${SOURCE_COMMIT}`,
    'utf8',
  );
  const nodeSourceBytes = Buffer.from(
    `official-node:${delivery.target.architecture}`,
    'utf8',
  );
  const nodeArchiveBytes = Buffer.from(
    `official-node-archive:${delivery.target.architecture}`,
    'utf8',
  );
  const manifestBytes = Buffer.from(
    stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest(delivery),
    'utf8',
  );
  const sourceArchive = {
    format: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SOURCE_ARCHIVE_FORMAT,
    byteDigest: digest(sourceArchiveBytes),
    size: sourceArchiveBytes.length,
  };
  const generation = {
    binaryPath: `/private/tmp/final-${expectedArchitecture}`,
    binaryDigest: digest(artifactBytes),
    entryCode: {
      digest: digest(bundleBytes),
      size: bundleBytes.length,
    },
    codeBundle: {
      digest: digest(runtimeBundleBytes),
      size: runtimeBundleBytes.length,
    },
    seaBlob: {
      digest: digest(seaBlobBytes),
      size: seaBlobBytes.length,
    },
    nodeSource: {
      path: `/private/tmp/node-${delivery.target.architecture}`,
      digest: digest(nodeSourceBytes),
      size: nodeSourceBytes.length,
      archive: {
        fileName: `node-v${delivery.target.nodeVersion}-${delivery.target.platform}-${delivery.target.architecture}.tar.gz`,
        digest: digest(nodeArchiveBytes),
      },
    },
    assets: {
      [AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME]:
        digest(manifestBytes),
    },
    functionAssets: {},
    coreRuntimeDependencies: null,
    signing: { mode: 'unsigned' },
  };
  return {
    delivery,
    bundleBytes,
    runtimeBundleBytes,
    seaBlobBytes,
    artifactBytes,
    sourceArchive,
    generation,
    manifestBytes,
    nodeSourceBytes,
    nodeArchiveBytes,
  };
}

/** @param {Record<string, any>} value @returns {Readonly<Record<string, any>>} */
function createRecord(value = fixture()) {
  return createAwsRetainedStorageHostPreflightSeaArtifactRecord({
    delivery: value.delivery,
    sourceArchive: value.sourceArchive,
    bundleBytes: value.bundleBytes,
    artifactBytes: value.artifactBytes,
    generation: value.generation,
  });
}

/** @param {Record<string, any>} value @returns {Record<string, any>} */
function validationContext(value) {
  return {
    bundleBytes: value.bundleBytes,
    artifactBytes: value.artifactBytes,
    generation: value.generation,
  };
}

/** @param {Readonly<Record<string, any>>} record @returns {Record<string, any>} */
function reidentify(record) {
  const payload = clone(record);
  delete payload.recordId;
  return {
    ...clone(record),
    recordId: createCanonicalJsonSha256Id({
      domain: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_ID_DOMAIN,
      prefix: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_ID_PREFIX,
      value: payload,
    }),
  };
}

describe('AWS retained-storage host preflight SEA artifact record', () => {
  /** @type {Array<[string, string]>} */
  const targetCases = [
    ['x86_64', 'x64'],
    ['arm64', 'arm64'],
  ];

  it.each(targetCases)(
    'seals exact post-build evidence for the %s provider target',
    (expectedArchitecture, nodeArchitecture) => {
      const value = fixture(expectedArchitecture);
      const record = createRecord(value);

      expect(record).toMatchObject({
        schemaVersion: 1,
        kind: 'awsSingleNodeRetainedStorageHostPreflightSeaArtifactRecord',
        delivery: value.delivery,
        sourceArchive: value.sourceArchive,
        entryBundle: {
          format: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ENTRY_BUNDLE_FORMAT,
          byteDigest: digest(value.bundleBytes),
          size: value.bundleBytes.length,
        },
        runtimeBundle: {
          format: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_RUNTIME_BUNDLE_FORMAT,
          byteDigest: digest(value.runtimeBundleBytes),
          size: value.runtimeBundleBytes.length,
        },
        seaBlob: {
          format: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_BLOB_FORMAT,
          byteDigest: digest(value.seaBlobBytes),
          size: value.seaBlobBytes.length,
        },
        manifestAsset: {
          name: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
          byteDigest: digest(value.manifestBytes),
          size: value.manifestBytes.length,
        },
        artifactId: `waf1_${digest(value.artifactBytes).value}`,
        byteDigest: digest(value.artifactBytes),
        size: value.artifactBytes.length,
        format: { kind: 'node-sea', version: 1 },
        target: {
          nodeVersion: '24.13.1',
          platform: 'linux',
          architecture: nodeArchitecture,
          libc: 'glibc',
        },
        targetId: `node-v24.13.1-linux-${nodeArchitecture}-glibc`,
        node: {
          version: '24.13.1',
          archive: {
            fileName: `node-v24.13.1-linux-${nodeArchitecture}.tar.gz`,
            byteDigest: digest(value.nodeArchiveBytes),
          },
          sourceBinary: {
            byteDigest: digest(value.nodeSourceBytes),
            size: value.nodeSourceBytes.length,
          },
        },
        signing: { mode: 'unsigned' },
      });
      expect(record.recordId).toMatch(/^whp1_[A-Za-z0-9_-]{43}$/u);
      expect(JSON.stringify(record)).not.toContain('/private/tmp/');
      expectDeepFrozen(record);
    },
  );

  it('validates a transported record into a fresh deeply frozen snapshot', () => {
    const value = fixture();
    const record = createRecord(value);
    const transported = clone(record);

    const validated = validateAwsRetainedStorageHostPreflightSeaArtifactRecord(
      transported,
      validationContext(value),
    );

    expect(validated).toEqual(record);
    expect(validated).not.toBe(record);
    expect(validated.delivery).not.toBe(record.delivery);
    expectDeepFrozen(validated);
  });

  it('keeps transported schema validation separate from exact-byte verification', () => {
    const value = fixture();
    const record = createRecord(value);
    const transported = clone(record);

    const validated =
      validateAwsRetainedStorageHostPreflightSeaArtifactRecordClaims(
        transported,
      );

    expect(validated).toEqual(record);
    expect(validated).not.toBe(record);
    expectDeepFrozen(validated);

    const reidentifiedBuilderClaim = clone(record);
    reidentifiedBuilderClaim.runtimeBundle.byteDigest = digest(
      'different builder-claimed runtime bundle',
    );
    const structurallyValid = reidentify(reidentifiedBuilderClaim);
    expect(
      validateAwsRetainedStorageHostPreflightSeaArtifactRecordClaims(
        structurallyValid,
      ),
    ).toEqual(structurallyValid);
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaArtifactRecord(
        structurallyValid,
        validationContext(value),
      ),
    ).toThrow(/does not match its exact build evidence/iu);
  });

  /** @type {Array<[string, (record: Record<string, any>) => void]>} */
  const oversizedClaimCases = [
    [
      'source archive',
      (record) => {
        record.sourceArchive.size = 32 * 1024 * 1024 + 1;
      },
    ],
    [
      'entry bundle',
      (record) => {
        record.entryBundle.size = 8 * 1024 * 1024 + 1;
      },
    ],
    [
      'runtime bundle',
      (record) => {
        record.runtimeBundle.size = 8 * 1024 * 1024 + 1;
      },
    ],
    [
      'SEA blob',
      (record) => {
        record.seaBlob.size = 8 * 1024 * 1024 + 1;
      },
    ],
    [
      'delivery manifest asset',
      (record) => {
        record.manifestAsset.size = 32 * 1024 + 1;
      },
    ],
    [
      'final artifact',
      (record) => {
        record.size = 512 * 1024 * 1024 + 1;
      },
    ],
    [
      'Node source binary',
      (record) => {
        record.node.sourceBinary.size = 512 * 1024 * 1024 + 1;
      },
    ],
  ];

  it.each(oversizedClaimCases)(
    'rejects transported %s claims outside creator byte limits',
    (_name, mutate) => {
      const candidate = clone(createRecord());
      mutate(candidate);
      expect(() =>
        validateAwsRetainedStorageHostPreflightSeaArtifactRecordClaims(
          reidentify(candidate),
        ),
      ).toThrow(/exceeds its byte limit/iu);
    },
  );

  it('cross-checks every reidentified byte stage against the exact successful generation', () => {
    const value = fixture();
    const record = createRecord(value);
    const candidates = [
      () => {
        const candidate = clone(record);
        candidate.entryBundle.size += 1;
        return reidentify(candidate);
      },
      () => {
        const candidate = clone(record);
        candidate.runtimeBundle.size += 1;
        return reidentify(candidate);
      },
      () => {
        const candidate = clone(record);
        candidate.seaBlob.size += 1;
        return reidentify(candidate);
      },
      () => {
        const candidate = clone(record);
        candidate.size += 1;
        return reidentify(candidate);
      },
      () => {
        const candidate = clone(record);
        candidate.node.archive.byteDigest = digest('different archive');
        return reidentify(candidate);
      },
    ];

    for (const candidate of candidates) {
      expect(() =>
        validateAwsRetainedStorageHostPreflightSeaArtifactRecord(
          candidate(),
          validationContext(value),
        ),
      ).toThrow(/does not match its exact build evidence/iu);
    }
  });

  it('binds all semantic content to the record ID and rejects expanded surfaces', () => {
    const value = fixture();
    const record = createRecord(value);
    const tamperedSource = clone(record);
    tamperedSource.sourceArchive.size += 1;
    const expanded = { ...clone(record), extra: true };

    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaArtifactRecord(
        tamperedSource,
        validationContext(value),
      ),
    ).toThrow(/record ID does not match/iu);
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaArtifactRecord(
        expanded,
        validationContext(value),
      ),
    ).toThrow(/exact required keys/iu);
    expect(() =>
      createAwsRetainedStorageHostPreflightSeaArtifactRecord({
        delivery: value.delivery,
        sourceArchive: value.sourceArchive,
        bundleBytes: value.bundleBytes,
        artifactBytes: value.artifactBytes,
        generation: value.generation,
        extra: true,
      }),
    ).toThrow(/exact required keys/iu);
  });

  it('strictly validates each formatted byte-evidence surface', () => {
    const value = fixture();
    const record = createRecord(value);
    const candidates = [
      () => {
        const candidate = clone(record);
        candidate.entryBundle.format = 'unknown-entry-bundle-v1';
        return reidentify(candidate);
      },
      () => {
        const candidate = clone(record);
        candidate.runtimeBundle.extra = true;
        return reidentify(candidate);
      },
      () => {
        const candidate = clone(record);
        candidate.seaBlob.size = 0;
        return reidentify(candidate);
      },
    ];

    for (const candidate of candidates) {
      expect(() =>
        validateAwsRetainedStorageHostPreflightSeaArtifactRecord(
          candidate(),
          validationContext(value),
        ),
      ).toThrow();
    }
  });

  it('accepts only bounded git-archive source evidence', () => {
    const wrongFormat = fixture();
    wrongFormat.sourceArchive.format = 'git-bundle-v1';
    const oversized = fixture();
    oversized.sourceArchive.size = Number.MAX_SAFE_INTEGER;

    expect(() => createRecord(wrongFormat)).toThrow(/format is invalid/iu);
    expect(() => createRecord(oversized)).toThrow(/exceeds its byte limit/iu);
  });

  it('requires the exact canonical delivery asset as the only embedded asset', () => {
    const candidates = [
      () => {
        const value = fixture();
        value.generation.assets[
          AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME
        ] = digest('different manifest');
        return value;
      },
      () => {
        const value = fixture();
        delete value.generation.assets[
          AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME
        ];
        return value;
      },
      () => {
        const value = fixture();
        value.generation.assets.extra = digest('extra asset');
        return value;
      },
    ];

    for (const candidate of candidates) {
      expect(() => createRecord(candidate())).toThrow();
    }
  });

  it('requires strict entry-code, runtime-bundle, and SEA-blob generation evidence', () => {
    const candidates = [
      () => {
        const value = fixture();
        delete value.generation.entryCode;
        return value;
      },
      () => {
        const value = fixture();
        value.generation.entryCode.digest = digest('different bundle');
        return value;
      },
      () => {
        const value = fixture();
        value.generation.entryCode.size += 1;
        return value;
      },
      () => {
        const value = fixture();
        delete value.generation.codeBundle;
        return value;
      },
      () => {
        const value = fixture();
        value.generation.codeBundle.extra = true;
        return value;
      },
      () => {
        const value = fixture();
        value.generation.codeBundle.size = 0;
        return value;
      },
      () => {
        const value = fixture();
        delete value.generation.seaBlob;
        return value;
      },
      () => {
        const value = fixture();
        value.generation.seaBlob.digest = {
          algorithm: 'sha512',
          value: digest('wrong algorithm').value,
        };
        return value;
      },
      () => {
        const value = fixture();
        value.generation.seaBlob.size = -1;
        return value;
      },
    ];

    for (const candidate of candidates) {
      expect(() => createRecord(candidate())).toThrow();
    }
  });

  /** @type {Array<[string, (value: Record<string, any>) => void]>} */
  const invalidGenerationCases = [
    [
      'a missing official archive receipt',
      (value) => {
        value.generation.nodeSource.archive = null;
      },
    ],
    [
      'a noncanonical archive filename',
      (value) => {
        value.generation.nodeSource.archive.fileName =
          'node-v24.13.1-linux-x64.tar.xz';
      },
    ],
    [
      'function assets',
      (value) => {
        value.generation.functionAssets.handler = {
          digest: digest('handler'),
        };
      },
    ],
    [
      'core runtime dependencies',
      (value) => {
        value.generation.coreRuntimeDependencies = {};
      },
    ],
    [
      'a signed artifact',
      (value) => {
        value.generation.signing = { mode: 'ad-hoc' };
      },
    ],
    [
      'different final bytes',
      (value) => {
        value.generation.binaryDigest = digest('different final SEA');
      },
    ],
  ];

  it.each(invalidGenerationCases)(
    'rejects successful generation evidence containing %s',
    (_name, mutate) => {
      const value = fixture();
      mutate(value);
      expect(() => createRecord(value)).toThrow();
    },
  );

  it('snapshots byte inputs and rejects accessor-backed evidence without invoking it', () => {
    const value = fixture();
    const expectedBundleDigest = digest(value.bundleBytes);
    const expectedArtifactDigest = digest(value.artifactBytes);
    const record = createRecord(value);
    value.bundleBytes.fill(0);
    value.artifactBytes.fill(0);

    expect(record.entryBundle.byteDigest).toEqual(expectedBundleDigest);
    expect(record.byteDigest).toEqual(expectedArtifactDigest);

    let accessorInvoked = false;
    const accessorArchive = clone(fixture().sourceArchive);
    Object.defineProperty(accessorArchive, 'format', {
      enumerable: true,
      get() {
        accessorInvoked = true;
        return AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SOURCE_ARCHIVE_FORMAT;
      },
    });
    const accessorValue = fixture();
    accessorValue.sourceArchive = accessorArchive;

    expect(() => createRecord(accessorValue)).toThrow(/plain JSON property/iu);
    expect(accessorInvoked).toBe(false);
  });

  it('requires exact validation bytes, context properties, and bounded records', () => {
    const value = fixture();
    const record = createRecord(value);

    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaArtifactRecord(record, {
        ...validationContext(value),
        bundleBytes: Buffer.from('different bundle'),
      }),
    ).toThrow();
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaArtifactRecord(record, {
        ...validationContext(value),
        artifactBytes: Buffer.from('different artifact'),
      }),
    ).toThrow();
    const differentRuntimeGeneration = clone(value.generation);
    differentRuntimeGeneration.codeBundle.digest = digest(
      'different generated runtime bundle',
    );
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaArtifactRecord(record, {
        ...validationContext(value),
        generation: differentRuntimeGeneration,
      }),
    ).toThrow(/does not match its exact build evidence/iu);
    const differentSeaBlobGeneration = clone(value.generation);
    differentSeaBlobGeneration.seaBlob.digest = digest(
      'different generated SEA blob',
    );
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaArtifactRecord(record, {
        ...validationContext(value),
        generation: differentSeaBlobGeneration,
      }),
    ).toThrow(/does not match its exact build evidence/iu);
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaArtifactRecord(record, {
        ...validationContext(value),
        extra: true,
      }),
    ).toThrow(/exact required keys/iu);

    let accessorInvoked = false;
    const accessorContext = {
      artifactBytes: value.artifactBytes,
      generation: value.generation,
    };
    Object.defineProperty(accessorContext, 'bundleBytes', {
      enumerable: true,
      get() {
        accessorInvoked = true;
        return value.bundleBytes;
      },
    });
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaArtifactRecord(
        record,
        accessorContext,
      ),
    ).toThrow(/own data property/iu);
    expect(accessorInvoked).toBe(false);

    const oversized = {
      ...clone(record),
      padding: 'x'.repeat(70 * 1024),
    };
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaArtifactRecord(
        oversized,
        validationContext(value),
      ),
    ).toThrow(/must not exceed/iu);
  });
});
