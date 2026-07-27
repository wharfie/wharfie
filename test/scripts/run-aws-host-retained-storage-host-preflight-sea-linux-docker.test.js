import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { jest } from '@jest/globals';

import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
import {
  createAwsRetainedStorageHostPreflightSeaLinuxDockerRunErrorForTest,
  createAwsRetainedStorageHostPreflightSeaLinuxDockerProofReceiptForTest,
  createAwsRetainedStorageHostPreflightSeaLinuxDockerProofDriverForTest,
  parseAwsRetainedStorageHostPreflightSeaLinuxDockerCidFileForTest,
  parseAwsRetainedStorageHostPreflightSeaLinuxDockerGuestFrameForTest,
  parseAwsRetainedStorageHostPreflightSeaLinuxDockerProofArgv,
  publishAwsRetainedStorageHostPreflightSeaLinuxDockerProofReceiptForTest,
} from '../../scripts/run-aws-host-retained-storage-host-preflight-sea-linux-docker.js';
import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_DRIVER_PATH,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_NODE_ARCHIVE_SIZE,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_PROTOCOL_PATH,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_VERIFIER_PATH,
  stringifyAwsRetainedStorageHostPreflightSeaLinuxProofReceipt,
  validateAwsRetainedStorageHostPreflightSeaLinuxProofReceipt,
} from '../../scripts/aws-host-retained-storage-host-preflight-sea-linux-proof.js';
import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
  createAwsRetainedStorageHostPreflightSeaDeliveryManifest,
  stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest,
} from '../../scripts/aws-host-retained-storage-host-preflight-sea-delivery.js';
import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SOURCE_ARCHIVE_FORMAT,
  createAwsRetainedStorageHostPreflightSeaArtifactRecord,
} from '../../scripts/aws-host-retained-storage-host-preflight-sea-artifact-record.js';

const SOURCE_COMMIT = 'ab'.repeat(20);
const IMAGE_ID = `sha256:${'12'.repeat(32)}`;
const OUTPUT_ROOT = '/private/tmp/wharfie-linux-proof-output';
const WORKSPACE_ROOT = '/private/tmp/wharfie-linux-proof-private';
const INPUT_DIRECTORY = `${WORKSPACE_ROOT}/input`;
const CONTAINER_NAME = `wharfie-sea-proof-${SOURCE_COMMIT}`;
const INVOCATION_ID = '34'.repeat(16);
const STALE_INVOCATION_ID = '56'.repeat(16);
const CURRENT_CONTAINER_ID = '78'.repeat(32);
const STALE_CONTAINER_ID = '9a'.repeat(32);
const REUSED_CONTAINER_ID = 'bc'.repeat(32);
const PROOF_LABELS = Object.freeze({
  'org.wharfie.proof.kind':
    'aws-retained-storage-host-preflight-sea-linux-docker-proof',
  'org.wharfie.proof.sourceCommit': SOURCE_COMMIT,
  'org.wharfie.proof.toolingCommit': SOURCE_COMMIT,
  'org.wharfie.proof.invocationId': INVOCATION_ID,
});

/** @param {string | Buffer} value */
function digest(value) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

const PINNED_NODE_X64_ARCHIVE_DIGEST = Object.freeze({
  algorithm: 'sha256',
  value: 'etKPsXKpqwWT-GwaOeXCaNDY_D1ssBZ_RVtWVaem4v0',
});

/** @param {string | Buffer} value */
function byteObservation(value) {
  return {
    byteDigest: digest(value),
    size: Buffer.byteLength(value),
  };
}

/** @returns {Record<string, any>} */
function productionWhlp2ReceiptInput() {
  const delivery = createAwsRetainedStorageHostPreflightSeaDeliveryManifest({
    sourceCommit: SOURCE_COMMIT,
    expectedArchitecture: 'x86_64',
  });
  const bundleBytes = Buffer.from('require("node:process");\n', 'utf8');
  const runtimeBundleBytes = Buffer.from(
    'production-shaped runtime bundle',
    'utf8',
  );
  const seaBlobBytes = Buffer.from('production-shaped SEA blob', 'utf8');
  const artifactBytes = Buffer.from(
    'production-shaped final Linux SEA bytes',
    'utf8',
  );
  const sourceArchiveBytes = Buffer.from(
    'production-shaped exact source archive',
    'utf8',
  );
  const nodeSourceBytes = Buffer.from(
    'production-shaped official Node executable',
    'utf8',
  );
  const manifestBytes = Buffer.from(
    stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest(delivery),
    'utf8',
  );
  const sourceArchive = {
    format: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SOURCE_ARCHIVE_FORMAT,
    ...byteObservation(sourceArchiveBytes),
  };
  const record = createAwsRetainedStorageHostPreflightSeaArtifactRecord({
    delivery,
    sourceArchive,
    bundleBytes,
    artifactBytes,
    generation: {
      binaryPath: '/private/tmp/production-shaped-final-sea',
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
        path: '/private/tmp/production-shaped-node',
        digest: digest(nodeSourceBytes),
        size: nodeSourceBytes.length,
        archive: {
          fileName: 'node-v24.13.1-linux-x64.tar.gz',
          digest: PINNED_NODE_X64_ARCHIVE_DIGEST,
        },
      },
      assets: {
        [AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME]:
          digest(manifestBytes),
      },
      functionAssets: {},
      coreRuntimeDependencies: null,
      signing: { mode: 'unsigned' },
    },
  });
  const sourceTransport = byteObservation(
    'production-shaped complete Git bundle',
  );
  const baselineExecution = {
    status: 1,
    stdout: byteObservation(''),
    stderr: byteObservation(
      'AWS retained-storage host preflight SEA delivery failed.\n',
    ),
  };

  return {
    subject: {
      sourceCommit: SOURCE_COMMIT,
      recordId: record.recordId,
      artifactId: record.artifactId,
    },
    runnerClaims: {
      implementation: {
        sourceCommit: SOURCE_COMMIT,
        driver: {
          logicalPath:
            AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_DRIVER_PATH,
          ...byteObservation('production-shaped driver source'),
        },
        verifier: {
          logicalPath:
            AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_VERIFIER_PATH,
          ...byteObservation('production-shaped verifier source'),
        },
        protocol: {
          logicalPath:
            AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_PROTOCOL_PATH,
          ...byteObservation('production-shaped protocol source'),
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
        containerId: CURRENT_CONTAINER_ID,
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
        memoryBytes: 6 * 1024 * 1024 * 1024,
        pidsLimit: 512,
        workTmpfsBytes: 4 * 1024 * 1024 * 1024,
        tempTmpfsBytes: 512 * 1024 * 1024,
        evidenceMaxBytes: 1024 * 1024,
        cpuLimit: 4,
        wallClockLimitMilliseconds: 30 * 60 * 1000,
      },
    },
    builderClaims: {
      artifactRecord: record,
    },
    independentObservations: {
      bootstrapNodeArchive: {
        basis: 'downloaded-pinned-sha256-observation',
        fileName: record.node.archive.fileName,
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
        format: record.sourceArchive.format,
        ...byteObservation(sourceArchiveBytes),
      },
      regeneratedEntryBundle: {
        basis: 'implementation-under-test-reproduction',
        format: record.entryBundle.format,
        ...byteObservation(bundleBytes),
      },
      publishedArtifact: {
        basis: 'held-file-observation',
        artifactId: record.artifactId,
        ...byteObservation(artifactBytes),
      },
      relocatedArtifact: {
        basis: 'held-file-observation',
        artifactId: record.artifactId,
        ...byteObservation(artifactBytes),
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
        original: baselineExecution,
        relocated: baselineExecution,
        extraArgument: baselineExecution,
        inheritedNodeOptions: {
          ...baselineExecution,
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
          containerId: CURRENT_CONTAINER_ID,
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

/**
 * @param {(this: Record<string, any>, ...args: any[]) => any} implementation
 * @returns {any}
 */
function mockPort(implementation) {
  return jest.fn(implementation);
}

/** @param {{containerSequence?: any[], imageChanges?: boolean, runError?: Error, removeTreeError?: Error, createReceiptError?: Error, publishError?: Error, runStatus?: number}} [options] */
function createFixture(options = {}) {
  /** @type {string[]} */
  const events = [];
  let imageInspections = 0;
  let containerInspections = 0;
  const containerSequence = options.containerSequence || [null, null];
  const image = {
    id: IMAGE_ID,
    platform: 'linux',
    architecture: 'amd64',
    rootfsDigest: digest('exact-rootfs'),
  };
  /** @type {Record<string, any>} */
  const ports = {
    readRepository: mockPort(async function () {
      expect(this).toBe(ports);
      events.push('repository');
      return {
        root: '/workspace/wharfie',
        sourceCommit: SOURCE_COMMIT,
        toolingCommit: SOURCE_COMMIT,
      };
    }),
    createInvocationId: mockPort(async function () {
      expect(this).toBe(ports);
      events.push('invocation-id');
      return INVOCATION_ID;
    }),
    inspectImage: mockPort(async function (imageId) {
      expect(this).toBe(ports);
      expect(imageId).toBe(IMAGE_ID);
      imageInspections += 1;
      events.push(`image:${imageInspections}`);
      if (options.imageChanges && imageInspections === 2) {
        return { ...image, rootfsDigest: digest('changed-rootfs') };
      }
      return image;
    }),
    observeExecutionMode: mockPort(async function () {
      expect(this).toBe(ports);
      events.push('execution-mode');
      return 'emulated';
    }),
    inspectContainer: mockPort(async function (input) {
      expect(this).toBe(ports);
      expect(Object.keys(input)).toHaveLength(1);
      if (Object.hasOwn(input, 'name')) {
        expect(input.name).toBe(CONTAINER_NAME);
      } else {
        expect(input.containerId).toMatch(/^[0-9a-f]{64}$/u);
      }
      containerInspections += 1;
      events.push(`container:${containerInspections}`);
      return containerSequence[containerInspections - 1] ?? null;
    }),
    removeContainer: mockPort(async function (input) {
      expect(this).toBe(ports);
      events.push('remove-container');
      expect(input).toMatchObject({
        containerId: expect.stringMatching(/^[0-9a-f]{64}$/u),
        expectedName: CONTAINER_NAME,
        expectedImageId: IMAGE_ID,
        expectedLabels: expect.objectContaining({
          'org.wharfie.proof.kind':
            'aws-retained-storage-host-preflight-sea-linux-docker-proof',
          'org.wharfie.proof.sourceCommit': SOURCE_COMMIT,
          'org.wharfie.proof.toolingCommit': SOURCE_COMMIT,
          'org.wharfie.proof.invocationId':
            expect.stringMatching(/^[0-9a-f]{32}$/u),
        }),
        expectedState: expect.stringMatching(/^(?:running|stopped)$/u),
      });
    }),
    prepareWorkspace: mockPort(async function (input) {
      expect(this).toBe(ports);
      events.push('workspace');
      expect(input).toEqual({ directoryMode: 0o700 });
      return {
        root: WORKSPACE_ROOT,
        inputDirectory: INPUT_DIRECTORY,
      };
    }),
    createGitBundle: mockPort(async function (input) {
      expect(this).toBe(ports);
      events.push('bundle');
      expect(input).toEqual({
        repositoryRoot: '/workspace/wharfie',
        sourceCommit: SOURCE_COMMIT,
        destinationPath: `${INPUT_DIRECTORY}/repo.bundle`,
        mode: 0o400,
      });
      return {
        format: 'git-bundle-complete-head-v1',
        headCommit: SOURCE_COMMIT,
        prerequisiteCount: 0,
      };
    }),
    exportTooling: mockPort(async function (input) {
      expect(this).toBe(ports);
      events.push(`tooling:${input.repositoryPath}`);
      /** @type {Record<string, string>} */
      const destinations = {
        'scripts/run-aws-host-retained-storage-host-preflight-sea-linux-docker.js': `${INPUT_DIRECTORY}/runner.js`,
        'scripts/verify-aws-host-retained-storage-host-preflight-sea-linux.js': `${INPUT_DIRECTORY}/verifier.js`,
        'scripts/aws-host-retained-storage-host-preflight-sea-linux-proof.js': `${INPUT_DIRECTORY}/protocol.js`,
      };
      expect(input).toEqual({
        repositoryRoot: '/workspace/wharfie',
        toolingCommit: SOURCE_COMMIT,
        repositoryPath: expect.stringMatching(/^scripts\/.+\.js$/u),
        destinationPath: destinations[input.repositoryPath],
        mode: 0o400,
      });
    }),
    observeFile: mockPort(async function ({ filePath }) {
      expect(this).toBe(ports);
      const name = filePath.split('/').at(-1);
      events.push(`observe:${name}`);
      return {
        byteDigest: digest(`exact-${name}`),
        size: Buffer.byteLength(`exact-${name}`),
      };
    }),
    runContainer: mockPort(async function ({
      argv,
      cidFilePath,
      containerName,
    }) {
      expect(this).toBe(ports);
      events.push('run');
      if (options.runError) throw options.runError;
      expect(Array.isArray(argv)).toBe(true);
      expect(cidFilePath).toBe(`${WORKSPACE_ROOT}/container.cid`);
      expect(containerName).toBe(CONTAINER_NAME);
      return {
        status: options.runStatus ?? 0,
        containerId: CURRENT_CONTAINER_ID,
        guestDraft: {
          subject: {
            sourceCommit: SOURCE_COMMIT,
            recordId: `whp1_${digest('record').value}`,
            artifactId: `waf1_${digest('artifact').value}`,
          },
          builderClaims: { artifactRecord: { fixture: true } },
          independentObservations: {
            cleanup: {
              guestWork: {
                invocationId: INVOCATION_ID,
                removed: true,
              },
            },
          },
        },
      };
    }),
    removeTree: mockPort(async function (input) {
      expect(this).toBe(ports);
      events.push('remove-workspace');
      expect(input).toEqual({ root: WORKSPACE_ROOT });
      if (options.removeTreeError) throw options.removeTreeError;
    }),
    createReceipt: mockPort(async function (input) {
      expect(this).toBe(ports);
      events.push('receipt');
      expect(Object.keys(input)).toEqual([
        'subject',
        'runnerClaims',
        'builderClaims',
        'independentObservations',
      ]);
      expect(input.independentObservations.cleanup).toEqual({
        guestWork: {
          invocationId: INVOCATION_ID,
          removed: true,
        },
        container: {
          invocationId: INVOCATION_ID,
          containerId: CURRENT_CONTAINER_ID,
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
      });
      if (options.createReceiptError) throw options.createReceiptError;
      return {
        receipt: {
          proofId: `whlp2_${digest('proof').value}`,
          input,
        },
        bytes: Buffer.from(
          `${JSON.stringify({
            proofId: `whlp2_${digest('proof').value}`,
            input,
          })}\n`,
          'utf8',
        ),
      };
    }),
    publishReceipt: mockPort(async function (input) {
      expect(this).toBe(ports);
      events.push('publish');
      if (options.publishError) throw options.publishError;
      expect(input).toMatchObject({
        outputRoot: OUTPUT_ROOT,
        sourceCommit: SOURCE_COMMIT,
        fileMode: 0o400,
        directoryMode: 0o700,
      });
      expect(input.receiptBytes).toBeInstanceOf(Buffer);
      expect(input.receiptBytes.toString('utf8')).not.toContain(WORKSPACE_ROOT);
      return {
        proofPath: `${OUTPUT_ROOT}/${SOURCE_COMMIT}/proof.json`,
        checksumPath: `${OUTPUT_ROOT}/${SOURCE_COMMIT}/SHA256SUMS`,
        outputDirectory: `${OUTPUT_ROOT}/${SOURCE_COMMIT}`,
      };
    }),
  };
  return {
    driver:
      createAwsRetainedStorageHostPreflightSeaLinuxDockerProofDriverForTest({
        ports,
      }),
    ports,
    events,
  };
}

/** @param {{containerId?: string, invocationId?: string, state?: 'running' | 'stopped'}} [options] @returns {Record<string, any>} */
function ownedContainer(options = {}) {
  return {
    containerId: options.containerId || CURRENT_CONTAINER_ID,
    name: CONTAINER_NAME,
    imageId: IMAGE_ID,
    labels: {
      ...PROOF_LABELS,
      'org.wharfie.proof.invocationId': options.invocationId || INVOCATION_ID,
    },
    state: options.state || 'stopped',
  };
}

describe('AWS retained-storage host preflight SEA Linux Docker proof driver', () => {
  it('parses only one immutable image ID and one canonical output root', () => {
    expect(
      parseAwsRetainedStorageHostPreflightSeaLinuxDockerProofArgv([
        'node',
        'driver.js',
        IMAGE_ID,
        OUTPUT_ROOT,
      ]),
    ).toEqual({ imageId: IMAGE_ID, outputRoot: OUTPUT_ROOT });

    for (const argv of [
      ['node', 'driver.js', 'node:24-bullseye', OUTPUT_ROOT],
      ['node', 'driver.js', IMAGE_ID, 'relative'],
      ['node', 'driver.js', IMAGE_ID, OUTPUT_ROOT, 'extra'],
    ]) {
      expect(() =>
        parseAwsRetainedStorageHostPreflightSeaLinuxDockerProofArgv(argv),
      ).toThrow();
    }
  });

  it('accepts only Docker cidfile bytes containing one exact immutable ID', () => {
    expect(
      parseAwsRetainedStorageHostPreflightSeaLinuxDockerCidFileForTest(
        Buffer.from(CURRENT_CONTAINER_ID, 'ascii'),
      ),
    ).toBe(CURRENT_CONTAINER_ID);
    expect(
      parseAwsRetainedStorageHostPreflightSeaLinuxDockerCidFileForTest(
        Buffer.from(`${CURRENT_CONTAINER_ID}\n`, 'ascii'),
      ),
    ).toBe(CURRENT_CONTAINER_ID);

    for (const bytes of [
      Buffer.from(`${CURRENT_CONTAINER_ID}\r\n`, 'ascii'),
      Buffer.from('AB'.repeat(32), 'ascii'),
      Buffer.from(`${CURRENT_CONTAINER_ID}\0`, 'ascii'),
      Buffer.from(CURRENT_CONTAINER_ID.slice(1), 'ascii'),
    ]) {
      expect(() =>
        parseAwsRetainedStorageHostPreflightSeaLinuxDockerCidFileForTest(bytes),
      ).toThrow(/container ID|cidfile/iu);
    }
    expect(() =>
      parseAwsRetainedStorageHostPreflightSeaLinuxDockerCidFileForTest(
        CURRENT_CONTAINER_ID,
      ),
    ).toThrow(/Buffer/u);
  });

  it('accepts only one canonical newline-terminated object from the guest', () => {
    const body = '{"subject":{"artifact":"bounded"}}';
    expect(
      parseAwsRetainedStorageHostPreflightSeaLinuxDockerGuestFrameForTest(
        Buffer.from(`${body}\n`, 'utf8'),
        Buffer.alloc(0),
      ),
    ).toEqual({ subject: { artifact: 'bounded' } });

    for (const stdout of [
      Buffer.from(body, 'utf8'),
      Buffer.from(` ${body}\n`, 'utf8'),
      Buffer.from(`${body}\n{}\n`, 'utf8'),
      Buffer.from('{"duplicate":1,"duplicate":2}\n', 'utf8'),
      Buffer.from('{"z":1,"a":2}\n', 'utf8'),
      Buffer.from('[]\n', 'utf8'),
      Buffer.from([0xff, 0x0a]),
      Buffer.alloc(1024 * 1024 + 1, 0x61),
    ]) {
      expect(() =>
        parseAwsRetainedStorageHostPreflightSeaLinuxDockerGuestFrameForTest(
          stdout,
          Buffer.alloc(0),
        ),
      ).toThrow();
    }
    expect(() =>
      parseAwsRetainedStorageHostPreflightSeaLinuxDockerGuestFrameForTest(
        Buffer.from(`${body}\n`, 'utf8'),
        Buffer.from('diagnostic', 'utf8'),
      ),
    ).toThrow(/diagnostic/iu);
  });

  it('refuses a pre-interrupted proof before touching any port', async () => {
    const fixture = createFixture();
    const controller = new AbortController();
    controller.abort();

    await expect(
      fixture.driver.run(
        { imageId: IMAGE_ID, outputRoot: OUTPUT_ROOT },
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/interrupted/u);
    expect(fixture.ports.readRepository).not.toHaveBeenCalled();
  });

  it('propagates an in-flight interruption to Docker and still closes outer state', async () => {
    const fixture = createFixture({ containerSequence: [null, null] });
    const controller = new AbortController();
    /** @type {() => void} */
    let markEntered = () => {};
    /** @type {Promise<void>} */
    const entered = new Promise((resolve) => {
      markEntered = () => resolve();
    });
    /** @type {(this: Record<string, any>, input: {signal: AbortSignal}) => Promise<any>} */
    const runUntilInterrupted = async function (input) {
      expect(this).toBe(fixture.ports);
      expect(input.signal).toBe(controller.signal);
      markEntered();
      return await new Promise((_resolve, reject) => {
        input.signal.addEventListener(
          'abort',
          () => reject(new Error('Docker proof interrupted in flight.')),
          { once: true },
        );
      });
    };
    fixture.ports.runContainer.mockImplementation(runUntilInterrupted);

    const running = fixture.driver.run(
      { imageId: IMAGE_ID, outputRoot: OUTPUT_ROOT },
      { signal: controller.signal },
    );
    await entered;
    controller.abort();

    await expect(running).rejects.toThrow(/interrupted in flight/u);
    expect(fixture.ports.removeTree).toHaveBeenCalledTimes(1);
    expect(fixture.ports.inspectImage).toHaveBeenCalledTimes(2);
    expect(fixture.ports.createReceipt).not.toHaveBeenCalled();
    expect(fixture.ports.publishReceipt).not.toHaveBeenCalled();
  });

  it('binds private exact-HEAD inputs and runs one pull-disabled residue-bounded container', async () => {
    const fixture = createFixture();

    const result = await fixture.driver.run({
      imageId: IMAGE_ID,
      outputRoot: OUTPUT_ROOT,
    });

    expect(result).toEqual({
      sourceCommit: SOURCE_COMMIT,
      proofPath: `${OUTPUT_ROOT}/${SOURCE_COMMIT}/proof.json`,
      checksumPath: `${OUTPUT_ROOT}/${SOURCE_COMMIT}/SHA256SUMS`,
      outputDirectory: `${OUTPUT_ROOT}/${SOURCE_COMMIT}`,
    });
    const argv = /** @type {string[]} */ (
      fixture.ports.runContainer.mock.calls[0][0].argv
    );
    expect(argv.slice(0, 6)).toEqual([
      'run',
      '--pull=never',
      '--rm',
      `--cidfile=${WORKSPACE_ROOT}/container.cid`,
      '--name',
      CONTAINER_NAME,
    ]);
    expect(argv).toEqual(
      expect.arrayContaining([
        '--platform',
        'linux/amd64',
        '--network',
        'bridge',
        '--log-driver=none',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges:true',
        '--pids-limit=512',
        '--memory=6g',
        '--memory-swap=6g',
        '--cpus=4',
        '--entrypoint',
        '/usr/local/bin/node',
        IMAGE_ID,
        '/wharfie-input/verifier.js',
        '--bootstrap',
        SOURCE_COMMIT,
        INVOCATION_ID,
        '/wharfie-input/repo.bundle',
        `/wharfie-work/invocation-${INVOCATION_ID}`,
        `org.wharfie.proof.invocationId=${INVOCATION_ID}`,
      ]),
    );
    expect(argv.slice(argv.indexOf(IMAGE_ID))).toEqual([
      IMAGE_ID,
      '/wharfie-input/verifier.js',
      '--bootstrap',
      SOURCE_COMMIT,
      INVOCATION_ID,
      '/wharfie-input/repo.bundle',
      `/wharfie-work/invocation-${INVOCATION_ID}`,
    ]);
    expect(argv).not.toContain('/wharfie-input/runner.js');
    expect(argv).toContain(
      `type=bind,source=${INPUT_DIRECTORY},target=/wharfie-input,readonly`,
    );
    expect(argv.join('\n')).not.toContain('wharfie-evidence');
    expect(argv.filter((value) => value === '--pull=never')).toHaveLength(1);
    expect(argv).not.toEqual(
      expect.arrayContaining(['pull', 'build', 'volume', '--privileged']),
    );
    expect(fixture.ports.createGitBundle).toHaveBeenCalledTimes(1);
    expect(fixture.ports.exportTooling).toHaveBeenCalledTimes(3);
    expect(fixture.ports.createInvocationId).toHaveBeenCalledTimes(1);
    expect(fixture.ports.removeTree).toHaveBeenCalledTimes(1);
    expect(fixture.ports.createReceipt).toHaveBeenCalledWith({
      subject: {
        sourceCommit: SOURCE_COMMIT,
        recordId: `whp1_${digest('record').value}`,
        artifactId: `waf1_${digest('artifact').value}`,
      },
      runnerClaims: {
        implementation: {
          sourceCommit: SOURCE_COMMIT,
          driver: {
            logicalPath:
              'scripts/run-aws-host-retained-storage-host-preflight-sea-linux-docker.js',
            ...{
              byteDigest: digest('exact-runner.js'),
              size: Buffer.byteLength('exact-runner.js'),
            },
          },
          verifier: {
            logicalPath:
              'scripts/verify-aws-host-retained-storage-host-preflight-sea-linux.js',
            ...{
              byteDigest: digest('exact-verifier.js'),
              size: Buffer.byteLength('exact-verifier.js'),
            },
          },
          protocol: {
            logicalPath:
              'scripts/aws-host-retained-storage-host-preflight-sea-linux-proof.js',
            ...{
              byteDigest: digest('exact-protocol.js'),
              size: Buffer.byteLength('exact-protocol.js'),
            },
          },
        },
        sourceTransport: {
          format: 'git-bundle-complete-head-v1',
          headCommit: SOURCE_COMMIT,
          prerequisiteCount: 0,
          byteDigest: digest('exact-repo.bundle'),
          size: Buffer.byteLength('exact-repo.bundle'),
        },
        container: {
          engine: 'docker',
          imageId: IMAGE_ID,
          invocationId: INVOCATION_ID,
          containerId: CURRENT_CONTAINER_ID,
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
          memoryBytes: 6 * 1024 * 1024 * 1024,
          pidsLimit: 512,
          workTmpfsBytes: 4 * 1024 * 1024 * 1024,
          tempTmpfsBytes: 512 * 1024 * 1024,
          evidenceMaxBytes: 1024 * 1024,
          cpuLimit: 4,
          wallClockLimitMilliseconds: 30 * 60 * 1000,
        },
      },
      builderClaims: {
        artifactRecord: { fixture: true },
      },
      independentObservations: {
        cleanup: {
          guestWork: {
            invocationId: INVOCATION_ID,
            removed: true,
          },
          container: {
            invocationId: INVOCATION_ID,
            containerId: CURRENT_CONTAINER_ID,
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
    });
    expect(fixture.events.indexOf('receipt')).toBeGreaterThan(
      fixture.events.indexOf('remove-workspace'),
    );
    expect(fixture.events.indexOf('receipt')).toBeGreaterThan(
      fixture.events.indexOf('image:2'),
    );
    expect(fixture.events.indexOf('publish')).toBeGreaterThan(
      fixture.events.indexOf('receipt'),
    );
  });

  it('reconciles an exact stopped stale invocation by immutable container ID before preparing inputs', async () => {
    const stale = ownedContainer({
      containerId: STALE_CONTAINER_ID,
      invocationId: STALE_INVOCATION_ID,
      state: 'stopped',
    });
    const fixture = createFixture({
      containerSequence: [stale, null, null],
    });

    await fixture.driver.run({
      imageId: IMAGE_ID,
      outputRoot: OUTPUT_ROOT,
    });

    expect(fixture.ports.removeContainer).toHaveBeenCalledTimes(1);
    expect(fixture.ports.removeContainer).toHaveBeenCalledWith({
      containerId: STALE_CONTAINER_ID,
      expectedName: CONTAINER_NAME,
      expectedImageId: IMAGE_ID,
      expectedLabels: {
        ...PROOF_LABELS,
        'org.wharfie.proof.invocationId': STALE_INVOCATION_ID,
      },
      expectedState: 'stopped',
    });
    expect(fixture.events.indexOf('remove-container')).toBeLessThan(
      fixture.events.indexOf('workspace'),
    );
    expect(fixture.events.indexOf('container:2')).toBeLessThan(
      fixture.events.indexOf('workspace'),
    );
  });

  it('refuses a running same-commit invocation without inspecting it again or removing it', async () => {
    const concurrent = ownedContainer({
      containerId: STALE_CONTAINER_ID,
      invocationId: STALE_INVOCATION_ID,
      state: 'running',
    });
    const fixture = createFixture({
      containerSequence: [concurrent],
    });

    await expect(
      fixture.driver.run({
        imageId: IMAGE_ID,
        outputRoot: OUTPUT_ROOT,
      }),
    ).rejects.toThrow(/already running|concurrent proof/u);

    expect(fixture.ports.inspectContainer).toHaveBeenCalledTimes(1);
    expect(fixture.ports.removeContainer).not.toHaveBeenCalled();
    expect(fixture.ports.prepareWorkspace).not.toHaveBeenCalled();
    expect(fixture.ports.createReceipt).not.toHaveBeenCalled();
    expect(fixture.ports.publishReceipt).not.toHaveBeenCalled();
  });

  it('refuses a foreign deterministic-name collision without removing it', async () => {
    const foreign = {
      ...ownedContainer(),
      labels: {
        ...PROOF_LABELS,
        'org.wharfie.proof.sourceCommit': 'cd'.repeat(20),
      },
    };
    const fixture = createFixture({
      containerSequence: [foreign, foreign],
    });

    await expect(
      fixture.driver.run({
        imageId: IMAGE_ID,
        outputRoot: OUTPUT_ROOT,
      }),
    ).rejects.toThrow(/not owned|cleanup was incomplete/u);

    expect(fixture.ports.removeContainer).not.toHaveBeenCalled();
    expect(fixture.ports.prepareWorkspace).not.toHaveBeenCalled();
    expect(fixture.ports.createReceipt).not.toHaveBeenCalled();
    expect(fixture.ports.publishReceipt).not.toHaveBeenCalled();
  });

  it('removes a possibly surviving owned container and all workspace bytes after guest failure', async () => {
    const failure = new Error('guest failed');
    const fixture = createFixture({
      runError: failure,
      containerSequence: [null, ownedContainer({ state: 'running' }), null],
    });

    await expect(
      fixture.driver.run({
        imageId: IMAGE_ID,
        outputRoot: OUTPUT_ROOT,
      }),
    ).rejects.toBe(failure);

    expect(fixture.ports.removeContainer).toHaveBeenCalledTimes(1);
    expect(fixture.ports.removeContainer).toHaveBeenCalledWith({
      containerId: CURRENT_CONTAINER_ID,
      expectedName: CONTAINER_NAME,
      expectedImageId: IMAGE_ID,
      expectedLabels: PROOF_LABELS,
      expectedState: 'running',
    });
    expect(fixture.ports.inspectImage).toHaveBeenCalledTimes(2);
    expect(fixture.ports.removeTree).toHaveBeenCalledTimes(1);
    expect(fixture.ports.createReceipt).not.toHaveBeenCalled();
    expect(fixture.ports.publishReceipt).not.toHaveBeenCalled();
    expect(fixture.events.indexOf('remove-container')).toBeGreaterThan(
      fixture.events.indexOf('run'),
    );
  });

  it('uses a cidfile-captured immutable ID as cleanup authority after Docker failure', async () => {
    const failure =
      createAwsRetainedStorageHostPreflightSeaLinuxDockerRunErrorForTest(
        CURRENT_CONTAINER_ID,
      );
    const fixture = createFixture({
      runError: failure,
      containerSequence: [
        null,
        ownedContainer({ state: 'running' }),
        null,
        null,
      ],
    });

    await expect(
      fixture.driver.run({
        imageId: IMAGE_ID,
        outputRoot: OUTPUT_ROOT,
      }),
    ).rejects.toBe(failure);

    expect(fixture.ports.inspectContainer).toHaveBeenNthCalledWith(2, {
      containerId: CURRENT_CONTAINER_ID,
    });
    expect(fixture.ports.removeContainer).toHaveBeenCalledWith(
      expect.objectContaining({ containerId: CURRENT_CONTAINER_ID }),
    );
    expect(fixture.ports.createReceipt).not.toHaveBeenCalled();
    expect(fixture.ports.publishReceipt).not.toHaveBeenCalled();
  });

  it('does not remove a deterministic name reused after immutable-ID cleanup reinspection', async () => {
    const failure = new Error('guest interrupted');
    const replacement = ownedContainer({
      containerId: REUSED_CONTAINER_ID,
      invocationId: STALE_INVOCATION_ID,
      state: 'running',
    });
    const fixture = createFixture({
      runError: failure,
      containerSequence: [
        null,
        ownedContainer({
          containerId: CURRENT_CONTAINER_ID,
          state: 'stopped',
        }),
        null,
        replacement,
      ],
    });

    await expect(
      fixture.driver.run({
        imageId: IMAGE_ID,
        outputRoot: OUTPUT_ROOT,
      }),
    ).rejects.toThrow(/cleanup was incomplete/u);

    expect(fixture.ports.removeContainer).toHaveBeenCalledTimes(1);
    expect(fixture.ports.removeContainer).toHaveBeenCalledWith(
      expect.objectContaining({ containerId: CURRENT_CONTAINER_ID }),
    );
    expect(fixture.ports.removeContainer).not.toHaveBeenCalledWith(
      expect.objectContaining({ containerId: REUSED_CONTAINER_ID }),
    );
    expect(fixture.ports.createReceipt).not.toHaveBeenCalled();
    expect(fixture.ports.publishReceipt).not.toHaveBeenCalled();
  });

  it('does not construct or publish a receipt when the selected image changes', async () => {
    const fixture = createFixture({ imageChanges: true });

    await expect(
      fixture.driver.run({
        imageId: IMAGE_ID,
        outputRoot: OUTPUT_ROOT,
      }),
    ).rejects.toThrow(/cleanup was incomplete/u);

    expect(fixture.ports.removeTree).toHaveBeenCalledTimes(1);
    expect(fixture.ports.createReceipt).not.toHaveBeenCalled();
    expect(fixture.ports.publishReceipt).not.toHaveBeenCalled();
  });

  it('does not publish when private workspace cleanup is incomplete', async () => {
    const fixture = createFixture({
      removeTreeError: new Error('cannot remove workspace'),
    });

    await expect(
      fixture.driver.run({
        imageId: IMAGE_ID,
        outputRoot: OUTPUT_ROOT,
      }),
    ).rejects.toThrow(/cleanup was incomplete/u);

    expect(fixture.ports.createReceipt).not.toHaveBeenCalled();
    expect(fixture.ports.publishReceipt).not.toHaveBeenCalled();
  });

  it('constructs the receipt only after cleanup and leaves no publication when construction fails', async () => {
    const receiptError = new Error('receipt schema rejected');
    const fixture = createFixture({ createReceiptError: receiptError });

    await expect(
      fixture.driver.run({
        imageId: IMAGE_ID,
        outputRoot: OUTPUT_ROOT,
      }),
    ).rejects.toBe(receiptError);

    expect(fixture.ports.removeTree).toHaveBeenCalledTimes(1);
    expect(fixture.events.indexOf('receipt')).toBeGreaterThan(
      fixture.events.indexOf('remove-workspace'),
    );
    expect(fixture.ports.publishReceipt).not.toHaveBeenCalled();
  });

  it('treats a nonzero guest result as failure and still closes all outer state', async () => {
    const fixture = createFixture({ runStatus: 23 });

    await expect(
      fixture.driver.run({
        imageId: IMAGE_ID,
        outputRoot: OUTPUT_ROOT,
      }),
    ).rejects.toThrow(/guest failed/u);

    expect(fixture.ports.removeTree).toHaveBeenCalledTimes(1);
    expect(fixture.ports.inspectImage).toHaveBeenCalledTimes(2);
    expect(fixture.ports.publishReceipt).not.toHaveBeenCalled();
  });

  it('maps one production-shaped guest draft through live whlp2 create, validate, and stringify', async () => {
    const input = productionWhlp2ReceiptInput();
    const guestDraft = {
      subject: input.subject,
      builderClaims: input.builderClaims,
      independentObservations: {
        ...input.independentObservations,
        cleanup: {
          guestWork: input.independentObservations.cleanup.guestWork,
        },
      },
    };
    const parsedGuestDraft =
      parseAwsRetainedStorageHostPreflightSeaLinuxDockerGuestFrameForTest(
        Buffer.from(
          `${JSON.stringify(sortCanonicalJsonValue(guestDraft))}\n`,
          'utf8',
        ),
        Buffer.alloc(0),
      );
    const result =
      await createAwsRetainedStorageHostPreflightSeaLinuxDockerProofReceiptForTest(
        {
          subject: parsedGuestDraft.subject,
          runnerClaims: input.runnerClaims,
          builderClaims: parsedGuestDraft.builderClaims,
          independentObservations: {
            ...parsedGuestDraft.independentObservations,
            cleanup: input.independentObservations.cleanup,
          },
        },
      );
    const text = result.bytes.toString('utf8');
    const transported =
      validateAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(
        JSON.parse(text),
      );

    expect(result.receipt.proofId).toMatch(/^whlp2_[A-Za-z0-9_-]{43}$/u);
    expect(result.receipt.subject).toEqual(input.subject);
    expect(result.receipt.runnerClaims).toEqual(input.runnerClaims);
    expect(result.receipt.builderClaims).toEqual(input.builderClaims);
    expect(result.receipt.independentObservations).toEqual(
      input.independentObservations,
    );
    expect(text).toBe(
      stringifyAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(
        result.receipt,
      ),
    );
    expect(transported).toEqual(result.receipt);
  });

  it('publishes a private checksummed pair through a staged atomic directory', async () => {
    const root = await fsp.realpath(
      await fsp.mkdtemp(
        path.join(os.tmpdir(), 'wharfie-linux-proof-publish-test-'),
      ),
    );
    const outputRoot = path.join(root, 'receipts');
    const receiptBytes = Buffer.from('{"proof":"bounded"}\n', 'utf8');

    try {
      const publication =
        await publishAwsRetainedStorageHostPreflightSeaLinuxDockerProofReceiptForTest(
          {
            outputRoot,
            sourceCommit: SOURCE_COMMIT,
            receiptBytes,
            fileMode: 0o400,
            directoryMode: 0o700,
          },
        );

      expect(await fsp.readFile(publication.proofPath)).toEqual(receiptBytes);
      expect(await fsp.readFile(publication.checksumPath, 'utf8')).toBe(
        `${createHash('sha256').update(receiptBytes).digest('hex')}  proof.json\n`,
      );
      expect((await fsp.stat(publication.outputDirectory)).mode & 0o777).toBe(
        0o700,
      );
      expect((await fsp.stat(publication.proofPath)).mode & 0o777).toBe(0o400);
      expect((await fsp.stat(publication.checksumPath)).mode & 0o777).toBe(
        0o400,
      );
      expect(
        (await fsp.readdir(outputRoot)).filter((name) => name.startsWith('.')),
      ).toEqual([]);
      await expect(
        publishAwsRetainedStorageHostPreflightSeaLinuxDockerProofReceiptForTest(
          {
            outputRoot,
            sourceCommit: SOURCE_COMMIT,
            receiptBytes,
            fileMode: 0o400,
            directoryMode: 0o700,
          },
        ),
      ).rejects.toThrow(/already exists/iu);
      expect(await fsp.readFile(publication.proofPath)).toEqual(receiptBytes);
    } finally {
      await fsp.rm(root, { force: true, recursive: true });
    }
  });
});
