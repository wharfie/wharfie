import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { jest } from '@jest/globals';

import {
  createAwsRetainedStorageHostPreflightSeaArtifactRecord,
  validateAwsRetainedStorageHostPreflightSeaArtifactRecord,
} from '../../scripts/aws-host-retained-storage-host-preflight-sea-artifact-record.js';
import {
  createAwsRetainedStorageHostPreflightSeaDeliveryManifest,
  stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
} from '../../scripts/aws-host-retained-storage-host-preflight-sea-delivery.js';
import { publishAwsRetainedStorageHostPreflightSeaArtifact } from '../../scripts/aws-host-retained-storage-host-preflight-sea-publish.js';

const SOURCE_COMMIT = 'cd'.repeat(20);

/** @param {Buffer | string} value */
function digest(value) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/** @param {'x86_64'|'arm64'} expectedArchitecture */
function fixture(expectedArchitecture = 'x86_64') {
  const delivery = createAwsRetainedStorageHostPreflightSeaDeliveryManifest({
    sourceCommit: SOURCE_COMMIT,
    expectedArchitecture,
  });
  const bundleBytes = Buffer.from('require("node:process");\n', 'utf8');
  const artifactBytes = Buffer.from(
    `sea-${expectedArchitecture}-${bundleBytes}`,
    'utf8',
  );
  const manifestBytes = Buffer.from(
    stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest(delivery),
    'utf8',
  );
  const nodeBytes = Buffer.from(`node-${delivery.target.architecture}`);
  const codeBundleBytes = Buffer.from(
    `second-stage-${expectedArchitecture}`,
    'utf8',
  );
  const seaBlobBytes = Buffer.from(`sea-blob-${expectedArchitecture}`, 'utf8');
  const generation = Object.freeze({
    binaryPath: `/private/build/${expectedArchitecture}/sea`,
    binaryDigest: digest(artifactBytes),
    entryCode: Object.freeze({
      digest: digest(bundleBytes),
      size: bundleBytes.length,
    }),
    codeBundle: Object.freeze({
      digest: digest(codeBundleBytes),
      size: codeBundleBytes.length,
    }),
    seaBlob: Object.freeze({
      digest: digest(seaBlobBytes),
      size: seaBlobBytes.length,
    }),
    nodeSource: Object.freeze({
      path: `/private/build/${expectedArchitecture}/node`,
      digest: digest(nodeBytes),
      size: nodeBytes.length,
      archive: Object.freeze({
        fileName: `node-v24.13.1-linux-${delivery.target.architecture}.tar.gz`,
        digest: digest(`archive-${delivery.target.architecture}`),
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
  const sourceArchive = Object.freeze({
    format: 'git-archive-tar-v1',
    byteDigest: digest('source-archive'),
    size: Buffer.byteLength('source-archive'),
  });
  const record = createAwsRetainedStorageHostPreflightSeaArtifactRecord({
    delivery,
    sourceArchive,
    bundleBytes,
    artifactBytes,
    generation,
  });
  return {
    delivery,
    bundleBytes,
    artifactBytes,
    generation,
    record,
  };
}

describe('AWS retained-storage host preflight SEA immutable publication', () => {
  /** @type {string} */
  let outputDirectory;

  beforeEach(async () => {
    outputDirectory = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-host-preflight-publish-test-'),
    );
    outputDirectory = await fsp.realpath(outputDirectory);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fsp.rm(outputDirectory, { force: true, recursive: true });
  });

  it.each(['x86_64', 'arm64'])(
    'publishes, validates, and reuses an exact %s pair',
    async (expectedArchitecture) => {
      const built = fixture(
        /** @type {'x86_64'|'arm64'} */ (expectedArchitecture),
      );
      const input = {
        outputDirectory,
        record: built.record,
        bundleBytes: built.bundleBytes,
        artifactBytes: built.artifactBytes,
        generation: built.generation,
      };

      const first =
        await publishAwsRetainedStorageHostPreflightSeaArtifact(input);
      const second =
        await publishAwsRetainedStorageHostPreflightSeaArtifact(input);

      expect(second).toEqual(first);
      await expect(fsp.readFile(first.path)).resolves.toEqual(
        built.artifactBytes,
      );
      const sidecarBytes = await fsp.readFile(first.recordPath);
      const parsed = JSON.parse(sidecarBytes.toString('utf8'));
      expect(
        validateAwsRetainedStorageHostPreflightSeaArtifactRecord(parsed, {
          bundleBytes: built.bundleBytes,
          artifactBytes: built.artifactBytes,
          generation: built.generation,
        }),
      ).toEqual(built.record);
      expect((await fsp.stat(first.path)).mode & 0o777).toBe(0o755);
      expect((await fsp.stat(first.recordPath)).mode & 0o777).toBe(0o600);
      const outputNames = await fsp.readdir(outputDirectory);
      expect(outputNames.sort()).toEqual(
        [first.fileName, `${first.fileName}.artifact.json`].sort(),
      );
    },
  );

  it('completes an exact binary left without its sidecar', async () => {
    const built = fixture();
    const input = {
      outputDirectory,
      record: built.record,
      bundleBytes: built.bundleBytes,
      artifactBytes: built.artifactBytes,
      generation: built.generation,
    };
    const first =
      await publishAwsRetainedStorageHostPreflightSeaArtifact(input);
    await fsp.rm(first.recordPath);

    const recovered =
      await publishAwsRetainedStorageHostPreflightSeaArtifact(input);

    expect(recovered.path).toBe(first.path);
    await expect(fsp.readFile(recovered.path)).resolves.toEqual(
      built.artifactBytes,
    );
    await expect(fsp.readFile(recovered.recordPath)).resolves.toBeDefined();
  });

  it('rejects conflicting content-addressed bytes without overwriting them', async () => {
    const built = fixture();
    const input = {
      outputDirectory,
      record: built.record,
      bundleBytes: built.bundleBytes,
      artifactBytes: built.artifactBytes,
      generation: built.generation,
    };
    const published =
      await publishAwsRetainedStorageHostPreflightSeaArtifact(input);
    const conflict = Buffer.alloc(built.artifactBytes.length, 0x78);
    await fsp.writeFile(published.path, conflict);

    await expect(
      publishAwsRetainedStorageHostPreflightSeaArtifact(input),
    ).rejects.toThrow(/conflicts with the exact immutable artifact/i);
    await expect(fsp.readFile(published.path)).resolves.toEqual(conflict);
  });

  it('rejects an oversized existing artifact before reading its content', async () => {
    const built = fixture();
    const fileName =
      `wharfie-aws-retained-storage-host-preflight-x86_64-` +
      `${built.record.artifactId}`;
    const artifactPath = path.join(outputDirectory, fileName);
    const oversized = Buffer.concat([
      built.artifactBytes,
      Buffer.from('x', 'utf8'),
    ]);
    await fsp.writeFile(artifactPath, oversized);

    await expect(
      publishAwsRetainedStorageHostPreflightSeaArtifact({
        outputDirectory,
        record: built.record,
        bundleBytes: built.bundleBytes,
        artifactBytes: built.artifactBytes,
        generation: built.generation,
      }),
    ).rejects.toThrow(/size conflicts with the exact immutable bytes/i);
    await expect(fsp.readFile(artifactPath)).resolves.toEqual(oversized);
  });

  it('rejects an oversized existing sidecar before reading its content', async () => {
    const built = fixture();
    const input = {
      outputDirectory,
      record: built.record,
      bundleBytes: built.bundleBytes,
      artifactBytes: built.artifactBytes,
      generation: built.generation,
    };
    const published =
      await publishAwsRetainedStorageHostPreflightSeaArtifact(input);
    await fsp.appendFile(published.recordPath, 'x', 'utf8');

    await expect(
      publishAwsRetainedStorageHostPreflightSeaArtifact(input),
    ).rejects.toThrow(/size conflicts with the exact immutable bytes/i);
  });

  it('rejects a sidecar without its artifact', async () => {
    const built = fixture();
    const fileName =
      `wharfie-aws-retained-storage-host-preflight-x86_64-` +
      `${built.record.artifactId}`;
    const sidecarPath = path.join(outputDirectory, `${fileName}.artifact.json`);
    await fsp.writeFile(sidecarPath, '{}\n');

    await expect(
      publishAwsRetainedStorageHostPreflightSeaArtifact({
        outputDirectory,
        record: built.record,
        bundleBytes: built.bundleBytes,
        artifactBytes: built.artifactBytes,
        generation: built.generation,
      }),
    ).rejects.toThrow(/exists without its immutable artifact/i);
    await expect(fsp.readFile(sidecarPath, 'utf8')).resolves.toBe('{}\n');
  });

  it('leaves a recoverable binary-only state when sidecar publication is interrupted', async () => {
    const built = fixture();
    const originalLink = fsp.link.bind(fsp);
    let calls = 0;
    const linkSpy = jest
      .spyOn(fsp, 'link')
      .mockImplementation(async (...args) => {
        calls += 1;
        if (calls === 2) {
          throw new Error('sidecar-link-failure-sentinel');
        }
        return originalLink(...args);
      });
    const input = {
      outputDirectory,
      record: built.record,
      bundleBytes: built.bundleBytes,
      artifactBytes: built.artifactBytes,
      generation: built.generation,
    };

    await expect(
      publishAwsRetainedStorageHostPreflightSeaArtifact(input),
    ).rejects.toThrow('sidecar-link-failure-sentinel');
    const fileName =
      `wharfie-aws-retained-storage-host-preflight-x86_64-` +
      `${built.record.artifactId}`;
    await expect(fsp.readdir(outputDirectory)).resolves.toEqual([fileName]);

    linkSpy.mockRestore();
    const recovered =
      await publishAwsRetainedStorageHostPreflightSeaArtifact(input);
    await expect(fsp.readFile(recovered.path)).resolves.toEqual(
      built.artifactBytes,
    );
    await expect(fsp.readFile(recovered.recordPath)).resolves.toBeDefined();
  });

  it('allows concurrent exact publishers to converge on one immutable pair', async () => {
    const built = fixture();
    const originalLink = fsp.link.bind(fsp);
    let artifactLinkCalls = 0;
    /** @type {(() => void) | undefined} */
    let releaseArtifactLinks;
    const artifactLinksReady = new Promise((resolve) => {
      releaseArtifactLinks = () => resolve(undefined);
    });
    jest.spyOn(fsp, 'link').mockImplementation(async (...args) => {
      const destination = String(args[1]);
      if (!destination.endsWith('.artifact.json')) {
        artifactLinkCalls += 1;
        if (artifactLinkCalls === 2) releaseArtifactLinks?.();
        await artifactLinksReady;
      }
      return originalLink(...args);
    });
    const input = {
      outputDirectory,
      record: built.record,
      bundleBytes: built.bundleBytes,
      artifactBytes: built.artifactBytes,
      generation: built.generation,
    };

    const [first, second] = await Promise.all([
      publishAwsRetainedStorageHostPreflightSeaArtifact(input),
      publishAwsRetainedStorageHostPreflightSeaArtifact(input),
    ]);

    expect(artifactLinkCalls).toBe(2);
    expect(second).toEqual(first);
    await expect(fsp.readdir(outputDirectory)).resolves.toEqual(
      [first.fileName, `${first.fileName}.artifact.json`].sort(),
    );
    await expect(fsp.readFile(first.path)).resolves.toEqual(
      built.artifactBytes,
    );
    const sidecar = JSON.parse(await fsp.readFile(first.recordPath, 'utf8'));
    expect(
      validateAwsRetainedStorageHostPreflightSeaArtifactRecord(sidecar, {
        bundleBytes: built.bundleBytes,
        artifactBytes: built.artifactBytes,
        generation: built.generation,
      }),
    ).toEqual(built.record);
  });
});
