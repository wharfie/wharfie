import { createHash } from 'node:crypto';

import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_ID_DOMAIN,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_ID_PREFIX,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SOURCE_ARCHIVE_FORMAT,
  createAwsRetainedStorageHostPreflightSeaArtifactRecord,
  validateAwsRetainedStorageHostPreflightSeaArtifactRecord,
} from '../../scripts/aws-host-retained-storage-host-preflight-sea-artifact-record.js';
import {
  createAwsRetainedStorageHostPreflightSeaDeliveryManifest,
  stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
} from '../../scripts/aws-host-retained-storage-host-preflight-sea-delivery.js';
import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_DRIVER_PATH,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_ID_DOMAIN,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_ID_PREFIX,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_MAX_BYTES,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_PROTOCOL_PATH,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_VERIFIER_PATH,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_NODE_ARCHIVE_SIZE,
  createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt,
  stringifyAwsRetainedStorageHostPreflightSeaLinuxProofReceipt,
  validateAwsRetainedStorageHostPreflightSeaLinuxProofReceipt,
} from '../../scripts/aws-host-retained-storage-host-preflight-sea-linux-proof.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';

const SOURCE_COMMIT = 'cd'.repeat(20);
const INVOCATION_ID = '12'.repeat(16);
const CONTAINER_ID = '34'.repeat(32);
const IMAGE_ID = `sha256:${'ab'.repeat(32)}`;
const PINNED_NODE_X64_ARCHIVE_DIGEST = {
  algorithm: 'sha256',
  value: 'etKPsXKpqwWT-GwaOeXCaNDY_D1ssBZ_RVtWVaem4v0',
};
const EMPTY_OUTPUT_DIGEST = {
  algorithm: 'sha256',
  value: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU',
};
const REDACTED_STARTUP_ERROR_DIGEST = {
  algorithm: 'sha256',
  value: 'ZivTFMztiLh0VvgJtzIU9TWYgnAXuzeIZ7uA4pExZLs',
};

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

/** @param {Readonly<Record<string, any>>} record @returns {Record<string, any>} */
function reidentifyRecord(record) {
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

/** @param {'x86_64' | 'arm64'} [expectedArchitecture] @returns {Record<string, any>} */
function artifactFixture(expectedArchitecture = 'x86_64') {
  const delivery = createAwsRetainedStorageHostPreflightSeaDeliveryManifest({
    sourceCommit: SOURCE_COMMIT,
    expectedArchitecture,
  });
  const bundleBytes = Buffer.from('require("node:process");\n', 'utf8');
  const runtimeBundleBytes = Buffer.from('generated runtime bundle', 'utf8');
  const seaBlobBytes = Buffer.from('generated SEA blob', 'utf8');
  const artifactBytes = Buffer.from('final Linux SEA bytes', 'utf8');
  const sourceArchiveBytes = Buffer.from('exact source archive', 'utf8');
  const nodeSourceBytes = Buffer.from('official Node executable', 'utf8');
  const nodeArchiveBytes = Buffer.from('official Node archive', 'utf8');
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
    binaryPath: '/private/tmp/final-sea',
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
      path: '/private/tmp/node',
      digest: digest(nodeSourceBytes),
      size: nodeSourceBytes.length,
      archive: {
        fileName: `node-v24.13.1-linux-${delivery.target.architecture}.tar.gz`,
        digest:
          delivery.target.architecture === 'x64'
            ? PINNED_NODE_X64_ARCHIVE_DIGEST
            : digest(nodeArchiveBytes),
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
  const record = createAwsRetainedStorageHostPreflightSeaArtifactRecord({
    delivery,
    sourceArchive,
    bundleBytes,
    artifactBytes,
    generation,
  });
  return {
    record,
    bundleBytes,
    artifactBytes,
    sourceArchiveBytes,
    nodeArchiveBytes,
    generation,
  };
}

/** @param {Buffer | string} value @returns {Record<string, any>} */
function byteObservation(value) {
  return {
    byteDigest: digest(value),
    size: Buffer.byteLength(value),
  };
}

/** @param {Record<string, any>} [artifact] @returns {Record<string, any>} */
function proofInput(artifact = artifactFixture()) {
  const output = byteObservation('');
  const error = byteObservation(
    'AWS retained-storage host preflight SEA delivery failed.\n',
  );
  const sourceTransport = byteObservation('complete Git bundle');
  const baseline = {
    status: 1,
    stdout: output,
    stderr: error,
  };
  return {
    subject: {
      sourceCommit: SOURCE_COMMIT,
      recordId: artifact.record.recordId,
      artifactId: artifact.record.artifactId,
    },
    runnerClaims: {
      implementation: {
        sourceCommit: SOURCE_COMMIT,
        driver: {
          logicalPath:
            AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_DRIVER_PATH,
          ...byteObservation('driver source'),
        },
        verifier: {
          logicalPath:
            AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_VERIFIER_PATH,
          ...byteObservation('verifier source'),
        },
        protocol: {
          logicalPath:
            AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_PROTOCOL_PATH,
          ...byteObservation('protocol source'),
        },
      },
      sourceTransport: {
        format: 'git-bundle-complete-head-v1',
        ...sourceTransport,
        headCommit: SOURCE_COMMIT,
        prerequisiteCount: 0,
      },
      container: {
        engine: 'docker',
        imageId: IMAGE_ID,
        invocationId: INVOCATION_ID,
        containerId: CONTAINER_ID,
        imageIdentityBasis: 'host-daemon-observation',
        requestedPlatform: 'linux/amd64',
        pullPolicy: 'never',
        executionMode: 'emulated',
        rootFilesystem: 'read-only',
        capabilities: 'none',
        privilegeEscalation: 'disabled',
        sourceMount: 'read-only-bind',
        evidenceChannel: 'bounded-stdout-json',
        workStorage: 'bounded-tmpfs',
        tempStorage: 'bounded-tmpfs',
        network: 'unrestricted-bridge-network',
        logDriver: 'none',
        removalPolicy: 'automatic',
        memoryBytes: 4 * 1024 * 1024 * 1024,
        pidsLimit: 512,
        workTmpfsBytes: 4 * 1024 * 1024 * 1024,
        tempTmpfsBytes: 512 * 1024 * 1024,
        evidenceMaxBytes: 1024 * 1024,
        cpuLimit: 4,
        wallClockLimitMilliseconds: 30 * 60 * 1000,
      },
    },
    builderClaims: {
      artifactRecord: artifact.record,
    },
    independentObservations: {
      bootstrapNodeArchive: {
        basis: 'downloaded-pinned-sha256-observation',
        fileName: artifact.record.node.archive.fileName,
        byteDigest: PINNED_NODE_X64_ARCHIVE_DIGEST,
        size: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_NODE_ARCHIVE_SIZE,
      },
      sourceCheckout: {
        basis: 'guest-clean-detached-checkout',
        checkedOutCommit: SOURCE_COMMIT,
        clean: true,
        prerequisiteCount: 0,
        transportByteDigest: sourceTransport.byteDigest,
        transportSize: sourceTransport.size,
      },
      reproducedSourceArchive: {
        basis: 'clean-checkout-reproduction',
        format: artifact.record.sourceArchive.format,
        ...byteObservation(artifact.sourceArchiveBytes),
      },
      regeneratedEntryBundle: {
        basis: 'implementation-under-test-reproduction',
        format: artifact.record.entryBundle.format,
        ...byteObservation(artifact.bundleBytes),
      },
      publishedArtifact: {
        basis: 'held-file-observation',
        artifactId: artifact.record.artifactId,
        ...byteObservation(artifact.artifactBytes),
      },
      relocatedArtifact: {
        basis: 'held-file-observation',
        artifactId: artifact.record.artifactId,
        ...byteObservation(artifact.artifactBytes),
        originalPublicationAbsent: true,
      },
      proofEnvironment: {
        platform: 'linux',
        architecture: 'x64',
        kernelRelease: '6.12.0-linuxkit',
        glibcVersionRuntime: '2.31',
        builderNodeVersion: '24.13.1',
        npmVersion: '11.12.0',
      },
      runtimeEnvironment: {
        path: '/usr/bin:/bin',
        nodeFoundOnPath: false,
      },
      executions: {
        original: baseline,
        relocated: clone(baseline),
        extraArgument: clone(baseline),
        inheritedNodeOptions: {
          ...clone(baseline),
          preloadExecuted: false,
        },
      },
      cleanup: {
        guestWork: {
          invocationId: INVOCATION_ID,
          removed: true,
        },
        container: {
          invocationId: INVOCATION_ID,
          containerId: CONTAINER_ID,
          absent: true,
        },
        temporaryRoot: {
          invocationId: INVOCATION_ID,
          removed: true,
        },
        selectedImage: {
          imageId: IMAGE_ID,
          unchanged: true,
        },
      },
    },
  };
}

describe('AWS retained-storage host preflight SEA Linux proof receipt', () => {
  it('creates one canonical transported whlp2 receipt with explicit trust classes', () => {
    const input = proofInput();
    const receipt =
      createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(input);
    const text =
      stringifyAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(receipt);
    const validated =
      validateAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(
        JSON.parse(text),
      );

    expect(receipt.schemaVersion).toBe(2);
    expect(receipt.proofId).toMatch(/^whlp2_[A-Za-z0-9_-]{43}$/u);
    expect(receipt.authority).toBe('none');
    expect(receipt.authoritative).toBe(false);
    expect(receipt.conclusion.classification).toBe(
      'linux-sea-startup-relocation-redacted-failure-observed',
    );
    expect(receipt.conclusion.limitations).toContain(
      'The observed redacted startup failure does not establish successful host-preflight behavior.',
    );
    expect(receipt.conclusion.limitations).toContain(
      'The unrestricted bridge network can reach arbitrary internet, local-network, and link-local endpoints; this receipt makes no network-authority claim.',
    );
    expect(receipt.builderClaims.artifactRecord).toEqual(
      input.builderClaims.artifactRecord,
    );
    expect(receipt.independentObservations).not.toHaveProperty('runtimeBundle');
    expect(receipt.independentObservations).not.toHaveProperty('seaBlob');
    expect(
      receipt.independentObservations.executions.extraArgument,
    ).not.toHaveProperty('argumentRejected');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.slice(0, -1)).not.toContain('\n');
    expect(validated).toEqual(receipt);
    expectDeepFrozen(receipt);
    expectDeepFrozen(validated);
  });

  /** @type {Array<[string, (value: Record<string, any>) => void]>} */
  const mismatchedObservationCases = [
    [
      'subject commit',
      (value) => {
        value.subject.sourceCommit = 'ef'.repeat(20);
      },
    ],
    [
      'runner implementation commit',
      (value) => {
        value.runnerClaims.implementation.sourceCommit = 'ef'.repeat(20);
      },
    ],
    [
      'published artifact',
      (value) => {
        value.independentObservations.publishedArtifact.size += 1;
      },
    ],
    [
      'relocated artifact',
      (value) => {
        value.independentObservations.relocatedArtifact.byteDigest =
          digest('different');
      },
    ],
    [
      'source archive',
      (value) => {
        value.independentObservations.reproducedSourceArchive.size += 1;
      },
    ],
    [
      'entry bundle',
      (value) => {
        value.independentObservations.regeneratedEntryBundle.byteDigest =
          digest('different');
      },
    ],
    [
      'Node archive',
      (value) => {
        value.independentObservations.bootstrapNodeArchive.byteDigest =
          digest('different');
      },
    ],
    [
      'Node archive size',
      (value) => {
        value.independentObservations.bootstrapNodeArchive.size -= 1;
      },
    ],
    [
      'bundle HEAD',
      (value) => {
        value.runnerClaims.sourceTransport.headCommit = 'ef'.repeat(20);
      },
    ],
    [
      'bundle prerequisites',
      (value) => {
        value.runnerClaims.sourceTransport.prerequisiteCount = 1;
      },
    ],
    [
      'checked-out commit',
      (value) => {
        value.independentObservations.sourceCheckout.checkedOutCommit =
          'ef'.repeat(20);
      },
    ],
    [
      'dirty checkout',
      (value) => {
        value.independentObservations.sourceCheckout.clean = false;
      },
    ],
    [
      'checked-out transport digest',
      (value) => {
        value.independentObservations.sourceCheckout.transportByteDigest =
          digest('different transport');
      },
    ],
    [
      'checked-out transport size',
      (value) => {
        value.independentObservations.sourceCheckout.transportSize += 1;
      },
    ],
    [
      'checked-out transport byte limit',
      (value) => {
        value.independentObservations.sourceCheckout.transportSize =
          128 * 1024 * 1024 + 1;
      },
    ],
    [
      'target platform',
      (value) => {
        value.runnerClaims.container.requestedPlatform = 'linux/arm64';
      },
    ],
    [
      'runtime architecture',
      (value) => {
        value.independentObservations.proofEnvironment.architecture = 'arm64';
      },
    ],
    [
      'relocation precondition',
      (value) => {
        value.independentObservations.relocatedArtifact.originalPublicationAbsent = false;
      },
    ],
    [
      'inherited preload',
      (value) => {
        value.independentObservations.executions.inheritedNodeOptions.preloadExecuted = true;
      },
    ],
    [
      'cleanup',
      (value) => {
        value.independentObservations.cleanup.container.absent = false;
      },
    ],
    [
      'cleanup invocation identity',
      (value) => {
        value.independentObservations.cleanup.temporaryRoot.invocationId =
          '56'.repeat(16);
      },
    ],
    [
      'cleanup container identity',
      (value) => {
        value.independentObservations.cleanup.container.containerId =
          '78'.repeat(32);
      },
    ],
    [
      'cleanup image identity',
      (value) => {
        value.independentObservations.cleanup.selectedImage.imageId = `sha256:${'90'.repeat(32)}`;
      },
    ],
  ];

  it.each(mismatchedObservationCases)(
    'rejects a mismatched %s observation',
    (_name, mutate) => {
      const input = proofInput();
      mutate(input);
      expect(() =>
        createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(input),
      ).toThrow();
    },
  );

  it('binds exact runner files, local image identity, pull policy, and invocation limits', () => {
    /** @type {Array<(value: Record<string, any>) => void>} */
    const candidates = [
      (value) => {
        value.runnerClaims.implementation.driver.logicalPath =
          'scripts/different.js';
      },
      (value) => {
        value.runnerClaims.implementation.driver.size = 2 * 1024 * 1024 + 1;
      },
      (value) => {
        value.runnerClaims.container.imageId = 'node:24-bullseye';
      },
      (value) => {
        value.runnerClaims.container.invocationId = 'a'.repeat(31);
      },
      (value) => {
        value.runnerClaims.container.containerId = 'b'.repeat(63);
      },
      (value) => {
        value.runnerClaims.container.pullPolicy = 'missing';
      },
      (value) => {
        value.runnerClaims.container.memoryBytes = Number.MAX_SAFE_INTEGER;
      },
      (value) => {
        value.runnerClaims.container.pidsLimit = 0;
      },
      (value) => {
        value.runnerClaims.container.workTmpfsBytes -= 1;
      },
      (value) => {
        value.runnerClaims.container.tempTmpfsBytes += 1;
      },
      (value) => {
        value.runnerClaims.container.evidenceMaxBytes += 1;
      },
      (value) => {
        value.runnerClaims.container.cpuLimit = 3;
      },
      (value) => {
        value.runnerClaims.container.wallClockLimitMilliseconds += 1;
      },
      (value) => {
        value.runnerClaims.sourceTransport.size = 128 * 1024 * 1024 + 1;
      },
    ];
    for (const mutate of candidates) {
      const input = proofInput();
      mutate(input);
      expect(() =>
        createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(input),
      ).toThrow();
    }
  });

  it('carries changed builder-only claims without promoting them to independent observations', () => {
    const artifact = artifactFixture();
    const changedRecord = clone(artifact.record);
    changedRecord.runtimeBundle.byteDigest = digest('changed runtime bundle');
    changedRecord.seaBlob.byteDigest = digest('changed SEA blob');
    changedRecord.node.sourceBinary.byteDigest = digest(
      'changed Node source binary',
    );
    artifact.record = reidentifyRecord(changedRecord);
    const input = proofInput(artifact);

    const receipt =
      createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(input);

    expect(receipt.builderClaims.artifactRecord).toEqual(artifact.record);
    expect(receipt.independentObservations).not.toHaveProperty('runtimeBundle');
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaArtifactRecord(
        artifact.record,
        {
          bundleBytes: artifact.bundleBytes,
          artifactBytes: artifact.artifactBytes,
          generation: artifact.generation,
        },
      ),
    ).toThrow(/does not match its exact build evidence/iu);
  });

  it('restricts this proof implementation to the pinned Linux x64 target', () => {
    expect(() =>
      createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(
        proofInput(artifactFixture('arm64')),
      ),
    ).toThrow();
  });

  it('requires the exact known redacted startup result for every execution', () => {
    const receipt =
      createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(proofInput());
    const expected = {
      status: 1,
      stdout: {
        byteDigest: EMPTY_OUTPUT_DIGEST,
        size: 0,
      },
      stderr: {
        byteDigest: REDACTED_STARTUP_ERROR_DIGEST,
        size: 57,
      },
    };
    expect(receipt.independentObservations.executions.original).toEqual(
      expected,
    );
    expect(receipt.independentObservations.executions.relocated).toEqual(
      expected,
    );
    expect(receipt.independentObservations.executions.extraArgument).toEqual(
      expected,
    );
    expect(
      receipt.independentObservations.executions.inheritedNodeOptions,
    ).toEqual({
      ...expected,
      preloadExecuted: false,
    });

    for (const key of [
      'original',
      'relocated',
      'extraArgument',
      'inheritedNodeOptions',
    ]) {
      const candidate = proofInput();
      candidate.independentObservations.executions[key].status = 0;
      expect(() =>
        createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(candidate),
      ).toThrow(/known redacted SEA startup outcome/iu);
    }
  });

  it('accepts only the canonical zero-byte digest without raw output', () => {
    const receipt =
      createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(proofInput());
    expect(receipt.independentObservations.executions.original.stdout).toEqual(
      byteObservation(''),
    );
    expect(JSON.stringify(receipt)).not.toContain(
      'AWS retained-storage host preflight SEA delivery failed.',
    );

    const contradictory = proofInput();
    contradictory.independentObservations.executions.original.stdout.byteDigest =
      digest('not empty');
    expect(() =>
      createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(contradictory),
    ).toThrow(/canonical empty byte string/iu);
  });

  it('rejects transport tampering, expanded surfaces, and the historical v1 shape', () => {
    const receipt =
      createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(proofInput());
    const tampered = clone(receipt);
    tampered.runnerClaims.container.executionMode = 'native';
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(tampered),
    ).toThrow(/proofId does not match/iu);

    const expanded = clone(receipt);
    expanded.extra = true;
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(expanded),
    ).toThrow(/exact required keys/iu);

    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaLinuxProofReceipt({
        schemaVersion: 1,
        kind: 'wharfieAwsHostRetainedStorageHostPreflightSeaLinuxProof',
        proofId: `whlp1_${'A'.repeat(43)}`,
      }),
    ).toThrow();
  });

  it('rejects accessors, symbols, oversized JSON, and secret-like expansion', () => {
    const accessor = proofInput();
    Object.defineProperty(accessor, 'subject', {
      enumerable: true,
      get() {
        throw new Error('must not execute');
      },
    });
    expect(() =>
      createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(accessor),
    ).toThrow(/plain JSON property/iu);

    const symbol = proofInput();
    Reflect.set(symbol, Symbol('expanded'), true);
    expect(() =>
      createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(symbol),
    ).toThrow(/non-JSON symbol/iu);

    const oversized = proofInput();
    oversized.extra = 'x'.repeat(
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_MAX_BYTES,
    );
    expect(() =>
      createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(oversized),
    ).toThrow(/must not exceed/iu);

    const secretLike = proofInput();
    secretLike.runnerClaims.container.token = 'do-not-retain';
    expect(() =>
      createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(secretLike),
    ).toThrow();
  });

  it('uses a domain-separated canonical proof identity', () => {
    const receipt =
      createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(proofInput());
    const payload = clone(receipt);
    delete payload.proofId;
    expect(receipt.proofId).toBe(
      createCanonicalJsonSha256Id({
        domain: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_ID_DOMAIN,
        prefix: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_ID_PREFIX,
        value: payload,
      }),
    );
  });
});
