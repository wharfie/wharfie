import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAwsRetainedStorageHostPreflightSeaPackagerForTest,
  createAwsRetainedStorageHostPreflightSeaSnapshotDeliveryProtocolForTest,
  parseAwsRetainedStorageHostPreflightSeaPackageArgv,
} from '../../scripts/aws-host-retained-storage-host-preflight-sea-package.js';
import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
  createAwsRetainedStorageHostPreflightSeaDeliveryManifest,
  stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest,
} from '../../scripts/aws-host-retained-storage-host-preflight-sea-delivery.js';
import { validateAwsRetainedStorageHostPreflightSeaArtifactRecord } from '../../scripts/aws-host-retained-storage-host-preflight-sea-artifact-record.js';

const SOURCE_COMMIT = 'ef'.repeat(20);
const OUTPUT_DIRECTORY = '/private/tmp/wharfie-package-output';
const REPO_ROOT = path.resolve(
  fileURLToPath(new URL('../../', import.meta.url)),
);

/** @param {Buffer | string} value */
function digest(value) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/**
 * @param {{bundleError?: Error, closeError?: Error, badBundleDigest?: boolean, liveBundleMismatch?: boolean, snapshotAssetNameMismatch?: boolean, snapshotManifestMismatch?: boolean, snapshotSourceCommit?: string}} [options]
 */
function createFixture(options = {}) {
  /** @type {any[]} */
  const calls = [];
  let closeCalls = 0;
  let bundleCalls = 0;
  const bundleBytes = Buffer.from('require("node:process");\n', 'utf8');
  const artifactBytes = Buffer.from('exact-sea-artifact', 'utf8');
  const sourceArchive = Object.freeze({
    format: 'git-archive-tar-v1',
    byteDigest: digest('exact-source-archive'),
    size: Buffer.byteLength('exact-source-archive'),
  });
  /** @type {any} */
  let generation;

  const ports = {
    /** @param {string} input */
    async preflightOutput(input) {
      expect(this).toBe(ports);
      calls.push(['output', input]);
      return input;
    },
    /** @param {any} input */
    async createSnapshot(input) {
      expect(this).toBe(ports);
      calls.push(['snapshot', input]);
      return {
        root: '/private/tmp/wharfie-source-snapshot/source',
        sourceCommit: options.snapshotSourceCommit || SOURCE_COMMIT,
        archive: sourceArchive,
        async close() {
          closeCalls += 1;
          if (options.closeError) throw options.closeError;
        },
      };
    },
    /** @param {any} input */
    async createSnapshotDelivery(input) {
      expect(this).toBe(ports);
      calls.push(['delivery', input]);
      if (options.snapshotManifestMismatch) {
        return {
          assetName:
            AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
          manifestBytes: Buffer.from('{"different":true}\n', 'utf8'),
        };
      }
      const delivery = createAwsRetainedStorageHostPreflightSeaDeliveryManifest(
        {
          sourceCommit: input.sourceCommit,
          expectedArchitecture: input.expectedArchitecture,
        },
      );
      return {
        assetName: options.snapshotAssetNameMismatch
          ? '<WHARFIE_HOST_PREFLIGHT>/different.json'
          : AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
        manifestBytes: Buffer.from(
          stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest(delivery),
          'utf8',
        ),
      };
    },
    /** @param {any} input */
    async bundle(input) {
      expect(this).toBe(ports);
      calls.push(['bundle', input]);
      bundleCalls += 1;
      if (options.bundleError) throw options.bundleError;
      const returnedBytes =
        bundleCalls === 2 && options.liveBundleMismatch
          ? Buffer.from('different-live-bundle', 'utf8')
          : bundleBytes;
      return {
        bytes: returnedBytes,
        byteDigest: options.badBundleDigest
          ? digest('wrong-bundle')
          : digest(returnedBytes),
        size: returnedBytes.length,
      };
    },
    /** @param {any} input */
    async buildSea(input) {
      expect(this).toBe(ports);
      calls.push(['build', input]);
      const manifestBytes = Buffer.from(
        stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest(
          input.delivery,
        ),
        'utf8',
      );
      const nodeBytes = Buffer.from(
        `node-${input.delivery.target.architecture}`,
      );
      generation = Object.freeze({
        binaryPath: '/private/tmp/private-sea',
        binaryDigest: digest(artifactBytes),
        entryCode: Object.freeze({
          digest: digest(bundleBytes),
          size: bundleBytes.length,
        }),
        codeBundle: Object.freeze({
          digest: digest('second-stage-runtime-bundle'),
          size: Buffer.byteLength('second-stage-runtime-bundle'),
        }),
        seaBlob: Object.freeze({
          digest: digest('node-sea-blob'),
          size: Buffer.byteLength('node-sea-blob'),
        }),
        nodeSource: Object.freeze({
          path: '/private/tmp/private-node',
          digest: digest(nodeBytes),
          size: nodeBytes.length,
          archive: Object.freeze({
            fileName:
              `node-v24.13.1-linux-` +
              `${input.delivery.target.architecture}.tar.gz`,
            digest: digest('official-node-archive'),
          }),
        }),
        assets: Object.freeze({
          [AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME]:
            digest(manifestBytes),
        }),
        functionAssets: Object.freeze({}),
        coreRuntimeDependencies: null,
        signing: Object.freeze({ mode: 'unsigned' }),
      });
      return { artifactBytes, generation };
    },
    /** @param {any} input */
    async publish(input) {
      expect(this).toBe(ports);
      calls.push(['publish', input]);
      expect(
        validateAwsRetainedStorageHostPreflightSeaArtifactRecord(input.record, {
          bundleBytes: input.bundleBytes,
          artifactBytes: input.artifactBytes,
          generation: input.generation,
        }),
      ).toEqual(input.record);
      return {
        artifactId: input.record.artifactId,
        recordId: input.record.recordId,
        path: `${input.outputDirectory}/artifact`,
        recordPath: `${input.outputDirectory}/artifact.artifact.json`,
      };
    },
  };
  return {
    packager: createAwsRetainedStorageHostPreflightSeaPackagerForTest({
      ports,
    }),
    calls,
    getCloseCalls: () => closeCalls,
    bundleBytes,
    artifactBytes,
    getGeneration: () => generation,
  };
}

describe('AWS retained-storage host preflight SEA package orchestration', () => {
  it('loads the delivery protocol from the exact snapshot module', async () => {
    const snapshotRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-package-protocol-test-'),
    );
    const moduleDirectory = path.join(snapshotRoot, 'scripts');
    await fsp.mkdir(moduleDirectory);
    await fsp.writeFile(
      path.join(snapshotRoot, 'package.json'),
      '{"type":"module"}\n',
      'utf8',
    );
    await fsp.writeFile(
      path.join(
        moduleDirectory,
        'aws-host-retained-storage-host-preflight-sea-delivery.js',
      ),
      [
        "export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME = '<snapshot>/delivery.json';",
        'export function createAwsRetainedStorageHostPreflightSeaDeliveryManifest(value) { return value; }',
        'export function stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest(value) { return `${JSON.stringify(value)}\\n`; }',
        '',
      ].join('\n'),
      'utf8',
    );

    try {
      const protocol =
        await createAwsRetainedStorageHostPreflightSeaSnapshotDeliveryProtocolForTest(
          {
            snapshotRoot,
            sourceCommit: SOURCE_COMMIT,
            expectedArchitecture: 'arm64',
          },
        );

      expect(protocol.assetName).toBe('<snapshot>/delivery.json');
      expect(protocol.manifestBytes.toString('utf8')).toBe(
        `${JSON.stringify({
          sourceCommit: SOURCE_COMMIT,
          expectedArchitecture: 'arm64',
        })}\n`,
      );
    } finally {
      await fsp.rm(snapshotRoot, { force: true, recursive: true });
    }
  });

  it.each(['x86_64', 'arm64'])(
    'runs the exact %s pipeline and closes its source snapshot',
    async (expectedArchitecture) => {
      const fixture = createFixture();

      const result = await fixture.packager.package({
        sourceCommit: SOURCE_COMMIT,
        expectedArchitecture,
        outputDirectory: OUTPUT_DIRECTORY,
      });

      expect(result.path).toBe(`${OUTPUT_DIRECTORY}/artifact`);
      expect(fixture.getCloseCalls()).toBe(1);
      expect(fixture.calls.map(([name]) => name)).toEqual([
        'output',
        'snapshot',
        'delivery',
        'bundle',
        'bundle',
        'build',
        'publish',
      ]);
      expect(fixture.calls[0][1]).toBe(OUTPUT_DIRECTORY);
      expect(fixture.calls[1][1]).toEqual({
        sourceCommit: SOURCE_COMMIT,
      });
      expect(fixture.calls[2][1]).toEqual({
        snapshotRoot: '/private/tmp/wharfie-source-snapshot/source',
        sourceCommit: SOURCE_COMMIT,
        expectedArchitecture,
      });
      expect(fixture.calls[3][1]).toEqual({
        snapshotRoot: '/private/tmp/wharfie-source-snapshot/source',
        sourceCommit: SOURCE_COMMIT,
        expectedArchitecture,
      });
      expect(fixture.calls[4][1]).toEqual({
        snapshotRoot: REPO_ROOT,
        sourceCommit: SOURCE_COMMIT,
        expectedArchitecture,
      });
      expect(fixture.calls[5][1].bundleBytes).toEqual(fixture.bundleBytes);
      expect(fixture.calls[6][1]).toMatchObject({
        outputDirectory: OUTPUT_DIRECTORY,
        bundleBytes: fixture.bundleBytes,
        artifactBytes: fixture.artifactBytes,
        generation: fixture.getGeneration(),
      });
    },
  );

  it('closes the snapshot after a pipeline failure', async () => {
    const bundleError = new Error('bundle-failure-sentinel');
    const fixture = createFixture({ bundleError });

    await expect(
      fixture.packager.package({
        sourceCommit: SOURCE_COMMIT,
        expectedArchitecture: 'x86_64',
        outputDirectory: OUTPUT_DIRECTORY,
      }),
    ).rejects.toBe(bundleError);
    expect(fixture.getCloseCalls()).toBe(1);
    expect(fixture.calls.map(([name]) => name)).toEqual([
      'output',
      'snapshot',
      'delivery',
      'bundle',
    ]);
  });

  it('retains both a primary failure and snapshot cleanup failure', async () => {
    const bundleError = new Error('bundle-failure-sentinel');
    const closeError = new Error('close-failure-sentinel');
    const fixture = createFixture({ bundleError, closeError });

    /** @type {any} */
    let caught;
    try {
      await fixture.packager.package({
        sourceCommit: SOURCE_COMMIT,
        expectedArchitecture: 'arm64',
        outputDirectory: OUTPUT_DIRECTORY,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect(caught.errors).toEqual([bundleError, closeError]);
    expect(fixture.getCloseCalls()).toBe(1);
  });

  it('rejects dishonest bundle evidence and still closes the snapshot', async () => {
    const fixture = createFixture({ badBundleDigest: true });

    await expect(
      fixture.packager.package({
        sourceCommit: SOURCE_COMMIT,
        expectedArchitecture: 'x86_64',
        outputDirectory: OUTPUT_DIRECTORY,
      }),
    ).rejects.toThrow(/bundle byte evidence is invalid/i);
    expect(fixture.getCloseCalls()).toBe(1);
    expect(fixture.calls.map(([name]) => name)).toEqual([
      'output',
      'snapshot',
      'delivery',
      'bundle',
    ]);
  });

  it('rejects live delivery drift before building and still closes the snapshot', async () => {
    const fixture = createFixture({ liveBundleMismatch: true });

    await expect(
      fixture.packager.package({
        sourceCommit: SOURCE_COMMIT,
        expectedArchitecture: 'x86_64',
        outputDirectory: OUTPUT_DIRECTORY,
      }),
    ).rejects.toThrow(/does not match the live repository delivery graph/i);
    expect(fixture.getCloseCalls()).toBe(1);
    expect(fixture.calls.map(([name]) => name)).toEqual([
      'output',
      'snapshot',
      'delivery',
      'bundle',
      'bundle',
    ]);
  });

  it('rejects a snapshot for a different commit and still closes it', async () => {
    const fixture = createFixture({ snapshotSourceCommit: 'ab'.repeat(20) });

    await expect(
      fixture.packager.package({
        sourceCommit: SOURCE_COMMIT,
        expectedArchitecture: 'arm64',
        outputDirectory: OUTPUT_DIRECTORY,
      }),
    ).rejects.toThrow(/does not match the requested commit/i);
    expect(fixture.getCloseCalls()).toBe(1);
    expect(fixture.calls.map(([name]) => name)).toEqual(['output', 'snapshot']);
  });

  it('rejects loaded/snapshot delivery protocol drift before bundling and still closes the snapshot', async () => {
    const fixture = createFixture({ snapshotManifestMismatch: true });

    await expect(
      fixture.packager.package({
        sourceCommit: SOURCE_COMMIT,
        expectedArchitecture: 'x86_64',
        outputDirectory: OUTPUT_DIRECTORY,
      }),
    ).rejects.toThrow(/delivery protocol does not match the loaded packager/i);
    expect(fixture.getCloseCalls()).toBe(1);
    expect(fixture.calls.map(([name]) => name)).toEqual([
      'output',
      'snapshot',
      'delivery',
    ]);
  });

  it('rejects snapshot delivery asset-name drift before bundling and still closes the snapshot', async () => {
    const fixture = createFixture({ snapshotAssetNameMismatch: true });

    await expect(
      fixture.packager.package({
        sourceCommit: SOURCE_COMMIT,
        expectedArchitecture: 'arm64',
        outputDirectory: OUTPUT_DIRECTORY,
      }),
    ).rejects.toThrow(/delivery protocol does not match the loaded packager/i);
    expect(fixture.getCloseCalls()).toBe(1);
    expect(fixture.calls.map(([name]) => name)).toEqual([
      'output',
      'snapshot',
      'delivery',
    ]);
  });

  it('validates all caller input before invoking a port', async () => {
    const fixture = createFixture();

    await expect(
      fixture.packager.package({
        sourceCommit: SOURCE_COMMIT.toUpperCase(),
        expectedArchitecture: 'x86_64',
        outputDirectory: OUTPUT_DIRECTORY,
      }),
    ).rejects.toThrow(/40 lowercase hexadecimal/i);
    await expect(
      fixture.packager.package({
        sourceCommit: SOURCE_COMMIT,
        expectedArchitecture: 'x86_64',
        outputDirectory: 'relative/output',
      }),
    ).rejects.toThrow(/canonical absolute non-root path/i);
    expect(fixture.calls).toEqual([]);
    expect(fixture.getCloseCalls()).toBe(0);
  });

  it('parses only the exact three-argument CLI surface', () => {
    expect(
      parseAwsRetainedStorageHostPreflightSeaPackageArgv([
        '/usr/bin/node',
        '/repo/package.js',
        SOURCE_COMMIT,
        'arm64',
        OUTPUT_DIRECTORY,
      ]),
    ).toEqual({
      sourceCommit: SOURCE_COMMIT,
      expectedArchitecture: 'arm64',
      outputDirectory: OUTPUT_DIRECTORY,
    });
    expect(() =>
      parseAwsRetainedStorageHostPreflightSeaPackageArgv([
        '/usr/bin/node',
        '/repo/package.js',
        SOURCE_COMMIT,
        'arm64',
        OUTPUT_DIRECTORY,
        '--extra',
      ]),
    ).toThrow(/Usage:/);
  });
});
