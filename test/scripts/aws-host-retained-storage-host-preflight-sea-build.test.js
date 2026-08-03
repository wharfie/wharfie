import { createHash } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';

import {
  createAwsRetainedStorageHostPreflightSeaDeliveryManifest,
  stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
} from '../../scripts/aws-host-retained-storage-host-preflight-sea-delivery.js';
import { createAwsRetainedStorageHostPreflightSeaBuilderForTest } from '../../scripts/aws-host-retained-storage-host-preflight-sea-build.js';

const SOURCE_COMMIT = 'ab'.repeat(20);

/** @param {Buffer | Uint8Array | string} value */
function digest(value) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/**
 * @param {{beforeNodeReconcile?: () => Promise<void>, omitArchiveReceipt?: boolean}} [options]
 */
function makeResourceDoubles(options = {}) {
  /** @type {{nodes: any[], builds: any[], workspaces: string[], manifestBytes: Buffer | undefined}} */
  const observed = {
    nodes: [],
    builds: [],
    workspaces: [],
    manifestBytes: undefined,
  };

  class FakeNodeBinary {
    static TEMP_DIR = '/original/node-temp';
    static BINARIES_DIR = '/original/node-binaries';

    /** @param {any} input */
    constructor(input) {
      this.input = input;
      /** @type {Record<string, any>} */
      this.properties = {};
      observed.nodes.push(input);
    }

    async reconcile() {
      if (options.beforeNodeReconcile) {
        await options.beforeNodeReconcile();
      }
      observed.workspaces.push(path.dirname(FakeNodeBinary.TEMP_DIR));
      await fsp.mkdir(FakeNodeBinary.BINARIES_DIR, { recursive: true });
      this.properties.binaryPath = path.join(
        FakeNodeBinary.BINARIES_DIR,
        'node',
      );
      await fsp.writeFile(this.properties.binaryPath, 'official-node');
    }

    /** @param {string} key */
    get(key) {
      return this.properties[key];
    }
  }

  class FakeSeaBuild {
    static BUILD_DIR = '/original/sea-builds';
    static BINARIES_DIR = '/original/sea-binaries';

    /** @param {any} input */
    constructor(input) {
      this.input = input;
      /** @type {Record<string, any>} */
      this.properties = { ...input.properties };
      /** @type {any} */
      this.evidence = undefined;
      observed.builds.push(input);
    }

    async build() {
      const assetName =
        AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME;
      const manifestPath = this.properties.assets[assetName];
      observed.manifestBytes = await fsp.readFile(manifestPath);
      await fsp.mkdir(FakeSeaBuild.BINARIES_DIR, { recursive: true });
      this.properties.binaryPath = path.join(
        FakeSeaBuild.BINARIES_DIR,
        'preflight-sea',
      );
      const artifactBytes = Buffer.from(
        `sea:${this.properties.entryCode}`,
        'utf8',
      );
      await fsp.writeFile(this.properties.binaryPath, artifactBytes);
      const nodeBytes = await fsp.readFile(this.properties.nodeBinaryPath);
      const codeBundleBytes = Buffer.from(
        `second-stage:${this.properties.entryCode}`,
        'utf8',
      );
      const seaBlobBytes = Buffer.from(
        `sea-blob:${this.properties.entryCode}`,
        'utf8',
      );
      this.evidence = Object.freeze({
        binaryPath: this.properties.binaryPath,
        binaryDigest: digest(artifactBytes),
        entryCode: Object.freeze({
          digest: digest(this.properties.entryCode),
          size: Buffer.byteLength(this.properties.entryCode, 'utf8'),
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
          path: this.properties.nodeBinaryPath,
          digest: digest(nodeBytes),
          size: nodeBytes.length,
          archive: options.omitArchiveReceipt
            ? null
            : Object.freeze({
                fileName: `node-v${this.properties.nodeVersion}-${this.properties.platform}-${this.properties.architecture}.tar.gz`,
                digest: digest('official-node-archive'),
              }),
        }),
        assets: Object.freeze({
          [assetName]: this.properties.assetDigests[assetName],
        }),
        functionAssets: Object.freeze({}),
        coreRuntimeDependencies: null,
        signing: Object.freeze({ mode: 'unsigned' }),
      });
    }

    /** @param {string} key */
    get(key) {
      return this.properties[key];
    }

    /** @param {Buffer | Uint8Array} artifactBytes */
    getSuccessfulBuildEvidence(artifactBytes) {
      if (
        !this.evidence ||
        digest(artifactBytes).value !== this.evidence.binaryDigest.value
      ) {
        throw new Error('artifact mismatch');
      }
      return this.evidence;
    }
  }

  return { FakeNodeBinary, FakeSeaBuild, observed };
}

describe('AWS retained-storage host preflight SEA build adapter', () => {
  it.each([
    ['x86_64', 'x64'],
    ['arm64', 'arm64'],
  ])(
    'builds and cleans one exact %s target through isolated resource directories',
    async (expectedArchitecture, nodeArchitecture) => {
      const { FakeNodeBinary, FakeSeaBuild, observed } = makeResourceDoubles();
      const originalDirectories = {
        nodeTemp: FakeNodeBinary.TEMP_DIR,
        nodeBinaries: FakeNodeBinary.BINARIES_DIR,
        seaBuilds: FakeSeaBuild.BUILD_DIR,
        seaBinaries: FakeSeaBuild.BINARIES_DIR,
      };
      const build = createAwsRetainedStorageHostPreflightSeaBuilderForTest({
        NodeBinaryClass: FakeNodeBinary,
        SeaBuildClass: FakeSeaBuild,
      });
      const delivery = createAwsRetainedStorageHostPreflightSeaDeliveryManifest(
        {
          sourceCommit: SOURCE_COMMIT,
          expectedArchitecture,
        },
      );
      const bundleBytes = Buffer.from('require("node:process");\n', 'utf8');

      const result = await build({ delivery, bundleBytes });

      expect(result.artifactBytes.toString('utf8')).toBe(
        `sea:${bundleBytes.toString('utf8')}`,
      );
      expect(result.generation.entryCode).toEqual({
        digest: digest(bundleBytes),
        size: bundleBytes.length,
      });
      expect(result.generation.codeBundle).toEqual({
        digest: digest(`second-stage:${bundleBytes.toString('utf8')}`),
        size: Buffer.byteLength(`second-stage:${bundleBytes.toString('utf8')}`),
      });
      expect(result.generation.seaBlob).toEqual({
        digest: digest(`sea-blob:${bundleBytes.toString('utf8')}`),
        size: Buffer.byteLength(`sea-blob:${bundleBytes.toString('utf8')}`),
      });
      expect(observed.nodes).toHaveLength(1);
      expect(observed.nodes[0]).toEqual({
        name: 'aws-retained-storage-host-preflight-node',
        properties: {
          version: '24.13.1',
          platform: 'linux',
          architecture: nodeArchitecture,
        },
      });
      expect(observed.builds).toHaveLength(1);
      expect(observed.builds[0].dependsOn).toHaveLength(1);
      expect(observed.builds[0].properties).toMatchObject({
        entryCode: bundleBytes.toString('utf8'),
        nodeVersion: '24.13.1',
        platform: 'linux',
        architecture: nodeArchitecture,
        libc: 'glibc',
        environmentVariables: {},
        functionAssetDigests: {},
      });
      expect(observed.manifestBytes).toEqual(
        Buffer.from(
          stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest(delivery),
          'utf8',
        ),
      );
      expect(FakeNodeBinary.TEMP_DIR).toBe(originalDirectories.nodeTemp);
      expect(FakeNodeBinary.BINARIES_DIR).toBe(
        originalDirectories.nodeBinaries,
      );
      expect(FakeSeaBuild.BUILD_DIR).toBe(originalDirectories.seaBuilds);
      expect(FakeSeaBuild.BINARIES_DIR).toBe(originalDirectories.seaBinaries);
      expect(
        observed.workspaces.every((workspace) => !existsSync(workspace)),
      ).toBe(true);
    },
  );

  it('rejects malformed input and invalid UTF-8 before constructing resources', async () => {
    const { FakeNodeBinary, FakeSeaBuild, observed } = makeResourceDoubles();
    const build = createAwsRetainedStorageHostPreflightSeaBuilderForTest({
      NodeBinaryClass: FakeNodeBinary,
      SeaBuildClass: FakeSeaBuild,
    });
    const delivery = createAwsRetainedStorageHostPreflightSeaDeliveryManifest({
      sourceCommit: SOURCE_COMMIT,
      expectedArchitecture: 'x86_64',
    });

    await expect(
      build({
        delivery,
        bundleBytes: Buffer.from([0xc3, 0x28]),
      }),
    ).rejects.toThrow(/valid UTF-8/i);
    await expect(
      build({ delivery, bundleBytes: Buffer.from('ok'), extra: true }),
    ).rejects.toThrow(/exact required keys/i);
    expect(observed.nodes).toHaveLength(0);
    expect(observed.builds).toHaveLength(0);
  });

  it('excludes a concurrent build before replacing process-global directories', async () => {
    /** @type {() => void} */
    let release = () => {};
    const gate = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    /** @type {() => void} */
    let entered = () => {};
    const enteredPromise = new Promise((resolve) => {
      entered = () => resolve(undefined);
    });
    const { FakeNodeBinary, FakeSeaBuild } = makeResourceDoubles({
      async beforeNodeReconcile() {
        entered();
        await gate;
      },
    });
    const build = createAwsRetainedStorageHostPreflightSeaBuilderForTest({
      NodeBinaryClass: FakeNodeBinary,
      SeaBuildClass: FakeSeaBuild,
    });
    const delivery = createAwsRetainedStorageHostPreflightSeaDeliveryManifest({
      sourceCommit: SOURCE_COMMIT,
      expectedArchitecture: 'arm64',
    });
    const input = { delivery, bundleBytes: Buffer.from('void 0;\n') };
    const first = build(input);
    await enteredPromise;

    await expect(build(input)).rejects.toThrow(/another .* build is active/i);
    release();
    await expect(first).resolves.toBeDefined();
  });

  it('rejects a completed build that lacks its official Node archive receipt', async () => {
    const { FakeNodeBinary, FakeSeaBuild, observed } = makeResourceDoubles({
      omitArchiveReceipt: true,
    });
    const build = createAwsRetainedStorageHostPreflightSeaBuilderForTest({
      NodeBinaryClass: FakeNodeBinary,
      SeaBuildClass: FakeSeaBuild,
    });
    const delivery = createAwsRetainedStorageHostPreflightSeaDeliveryManifest({
      sourceCommit: SOURCE_COMMIT,
      expectedArchitecture: 'x86_64',
    });

    await expect(
      build({ delivery, bundleBytes: Buffer.from('void 0;\n') }),
    ).rejects.toThrow(/requires its official Node archive receipt/i);
    expect(
      observed.workspaces.every((workspace) => !existsSync(workspace)),
    ).toBe(true);
  });
});
