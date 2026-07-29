import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import { createApplicationRevision } from '../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../src/core/runtime/content-id.js';
import {
  SINGLE_NODE_DEPLOYMENT_PAYLOAD_MANIFEST_ASSET_NAME,
  SINGLE_NODE_DEPLOYMENT_PAYLOAD_SEA_ASSET_NAME,
  createSingleNodeDeploymentPayloadAssets,
  createSingleNodeDeploymentPayloadManifest,
  readEmbeddedSingleNodeDeploymentPayload,
  stringifySingleNodeDeploymentPayloadManifest,
  validateSingleNodeDeploymentPayloadManifest,
} from '../../src/core/runtime/single-node-deployment-payload.js';

/** @type {string[]} */
const temporaryRoots = [];
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fsp.rm(root, { recursive: true, force: true })),
  );
});

/** @param {string|Buffer} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

function makeRevision() {
  return createApplicationRevision({
    contract: {
      schemaVersion: 4,
      app: { id: 'hello-app' },
      cli: {
        entrypoint: {
          kind: 'node',
          path: 'src/cli.js',
          export: 'main',
        },
      },
      activities: {
        greet: {
          entrypoint: {
            kind: 'node',
            path: 'src/greet.js',
            export: 'greet',
          },
        },
      },
    },
    inputs: {
      source: {
        format: 'wharfie-source-tree-v1',
        digest: digest('source'),
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

/** @param {ReturnType<typeof makeRevision>} revision */
function makeProvenance(revision) {
  return {
    schemaVersion: 1,
    builder: {
      name: '@wharfie/wharfie',
      version: '0.0.15',
      runtimeDigest: revision.inputs.runtime.digest,
      toolchainDigest: digest('toolchain'),
    },
    node: {
      version: TARGET.nodeVersion,
      archive: {
        fileName: 'node-v24.13.1-linux-x64.tar.gz',
        digest: digest('node-archive'),
      },
      binary: { digest: digest('node-binary') },
    },
    dependencies: {
      lock: revision.inputs.dependencies,
      digest: digest('target-dependencies'),
    },
    signing: { mode: 'unsigned' },
  };
}

/** @param {Buffer} [bytes] */
function makeFixture(bytes = Buffer.from('exact Linux SEA payload bytes')) {
  const revision = makeRevision();
  const artifactRecord = createArtifactRecord({
    bytes,
    revision,
    target: TARGET,
    provenance: makeProvenance(revision),
  });
  const observation = {
    artifactId: artifactRecord.artifactId,
    byteDigest: artifactRecord.byteDigest,
    size: artifactRecord.size,
  };
  return { bytes, revision, artifactRecord, observation };
}

/** @param {Buffer} bytes */
function standaloneArrayBuffer(bytes) {
  return Uint8Array.from(bytes).buffer;
}

describe('single-node deployment payload', () => {
  it('content-addresses one exact Linux SEA record and validates serialization', () => {
    const fixture = makeFixture();
    const manifest = createSingleNodeDeploymentPayloadManifest({
      artifactRecord: fixture.artifactRecord,
      observation: fixture.observation,
      revision: fixture.revision,
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      kind: 'singleNodeDeploymentPayload',
      payloadId: expect.stringMatching(/^wsdp1_[A-Za-z0-9_-]{43}$/u),
      artifactRecord: fixture.artifactRecord,
    });
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(
      validateSingleNodeDeploymentPayloadManifest(manifest, {
        observation: fixture.observation,
        revision: fixture.revision,
      }),
    ).toEqual(manifest);
    expect(
      JSON.parse(stringifySingleNodeDeploymentPayloadManifest(manifest)),
    ).toEqual(manifest);
  });

  it('copies held bytes into private framework-owned build assets', async () => {
    const fixture = makeFixture();
    const root = await fsp.mkdtemp(
      path.join(tmpdir(), 'wharfie-payload-source-test-'),
    );
    temporaryRoots.push(root);
    const artifactPath = path.join(root, 'hello-linux-sea');
    await fsp.writeFile(artifactPath, fixture.bytes, { mode: 0o700 });

    const assets = await createSingleNodeDeploymentPayloadAssets({
      artifactPath,
      artifactRecord: fixture.artifactRecord,
      revision: fixture.revision,
    });
    const manifestPath =
      assets.assets[SINGLE_NODE_DEPLOYMENT_PAYLOAD_MANIFEST_ASSET_NAME];
    const payloadPath =
      assets.assets[SINGLE_NODE_DEPLOYMENT_PAYLOAD_SEA_ASSET_NAME];
    const assetRoot = path.dirname(payloadPath);
    temporaryRoots.push(assetRoot);

    await fsp.writeFile(artifactPath, Buffer.alloc(fixture.bytes.length, 9));

    expect(await fsp.readFile(payloadPath)).toEqual(fixture.bytes);
    expect(JSON.parse(await fsp.readFile(manifestPath, 'utf8'))).toEqual(
      assets.manifest,
    );
    expect((await fsp.stat(assetRoot)).mode & 0o777).toBe(0o700);
    expect((await fsp.stat(payloadPath)).mode & 0o777).toBe(0o600);
    expect((await fsp.stat(manifestPath)).mode & 0o777).toBe(0o600);
    expect(
      assets.assetDigests[SINGLE_NODE_DEPLOYMENT_PAYLOAD_SEA_ASSET_NAME],
    ).toEqual(fixture.artifactRecord.byteDigest);
    expect(
      assets.assetDigests[SINGLE_NODE_DEPLOYMENT_PAYLOAD_MANIFEST_ASSET_NAME],
    ).toEqual(digest(await fsp.readFile(manifestPath)));

    await assets.cleanup();
    await assets.cleanup();
    await expect(fsp.stat(assetRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reads raw embedded bytes and authenticates them against the outer revision', async () => {
    const fixture = makeFixture();
    const manifest = createSingleNodeDeploymentPayloadManifest({
      artifactRecord: fixture.artifactRecord,
      observation: fixture.observation,
      revision: fixture.revision,
    });
    const result = await readEmbeddedSingleNodeDeploymentPayload({
      revision: fixture.revision,
      assetProvider: {
        isSea: () => true,
        getAsset: (name) => {
          expect(name).toBe(SINGLE_NODE_DEPLOYMENT_PAYLOAD_MANIFEST_ASSET_NAME);
          return Buffer.from(
            stringifySingleNodeDeploymentPayloadManifest(manifest),
          );
        },
        getRawAsset: (name) => {
          expect(name).toBe(SINGLE_NODE_DEPLOYMENT_PAYLOAD_SEA_ASSET_NAME);
          return standaloneArrayBuffer(fixture.bytes);
        },
      },
    });

    expect(result.manifest).toEqual(manifest);
    expect(result.artifactRecord).toEqual(fixture.artifactRecord);
    expect(result).not.toHaveProperty('bytes');
    /** @type {Buffer[]} */
    const chunks = [];
    for await (const chunk of result.source.createReadStream()) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(fixture.bytes);
    await expect(result.source.verifyUnchanged()).resolves.toEqual(
      fixture.observation,
    );
    await result.source.close();
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('detects mutation of an explicit raw-asset buffer while it is streamed', async () => {
    const fixture = makeFixture();
    const manifest = createSingleNodeDeploymentPayloadManifest({
      artifactRecord: fixture.artifactRecord,
      observation: fixture.observation,
      revision: fixture.revision,
    });
    const raw = standaloneArrayBuffer(fixture.bytes);
    const result = await readEmbeddedSingleNodeDeploymentPayload({
      revision: fixture.revision,
      assetProvider: {
        getAsset: () =>
          Buffer.from(stringifySingleNodeDeploymentPayloadManifest(manifest)),
        getRawAsset: () => raw,
      },
    });
    new Uint8Array(raw)[0] ^= 0xff;

    let streamedBytes = 0;
    await expect(async () => {
      for await (const chunk of result.source.createReadStream()) {
        streamedBytes += Buffer.byteLength(chunk);
      }
    }).rejects.toThrow(/changed while streamed/iu);
    expect(streamedBytes).toBe(fixture.bytes.byteLength);
    await expect(result.source.verifyUnchanged()).rejects.toThrow(
      /did not finish successfully/iu,
    );
    await result.source.close();
  });

  it('rejects changed embedded bytes and unsupported deployment targets', async () => {
    const fixture = makeFixture();
    const manifest = createSingleNodeDeploymentPayloadManifest({
      artifactRecord: fixture.artifactRecord,
      observation: fixture.observation,
      revision: fixture.revision,
    });
    await expect(
      readEmbeddedSingleNodeDeploymentPayload({
        revision: fixture.revision,
        assetProvider: {
          getAsset: () =>
            Buffer.from(stringifySingleNodeDeploymentPayloadManifest(manifest)),
          getRawAsset: () =>
            standaloneArrayBuffer(Buffer.from('different payload')),
        },
      }),
    ).rejects.toThrow(/exact artifact bytes|trusted inputs|does not match/iu);

    const darwinRecord = createArtifactRecord({
      bytes: fixture.bytes,
      revision: fixture.revision,
      target: {
        nodeVersion: '24.13.1',
        platform: 'darwin',
        architecture: 'arm64',
      },
      provenance: {
        ...makeProvenance(fixture.revision),
        node: {
          ...makeProvenance(fixture.revision).node,
          archive: {
            ...makeProvenance(fixture.revision).node.archive,
            fileName: 'node-v24.13.1-darwin-arm64.tar.gz',
          },
          binary: { digest: digest('darwin-node-binary') },
        },
        dependencies: {
          lock: fixture.revision.inputs.dependencies,
          digest: digest('darwin-target-dependencies'),
        },
        signing: { mode: 'ad-hoc' },
      },
    });
    expect(() =>
      createSingleNodeDeploymentPayloadManifest({
        artifactRecord: darwinRecord,
        observation: {
          artifactId: darwinRecord.artifactId,
          byteDigest: darwinRecord.byteDigest,
          size: darwinRecord.size,
        },
        revision: fixture.revision,
      }),
    ).toThrow(/Linux x64 glibc SEA/u);
  });

  it('rejects credential fields without echoing their values', () => {
    const fixture = makeFixture();
    const sentinel = 'secret-deployment-token';
    let thrown;
    try {
      createSingleNodeDeploymentPayloadManifest({
        artifactRecord: fixture.artifactRecord,
        observation: fixture.observation,
        revision: fixture.revision,
        token: sentinel,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).not.toContain(sentinel);
  });
});
