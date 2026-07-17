/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createApplicationRevision,
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
} from '../../../src/core/runtime/application-revision.js';
import { ARTIFACT_ID_PREFIX } from '../../../src/core/runtime/artifact-record.js';
import { sortCanonicalJsonValue } from '../../../src/core/runtime/canonical-order.js';
import { createSha256Id } from '../../../src/core/runtime/content-id.js';
import {
  APPLICATION_REVISION_ASSET_NAME,
  ARTIFACT_RUNTIME_ASSET_NAME,
} from '../../../src/core/resources/builds/lib/revision-runtime-assets.js';
import metadataCommand, {
  printEmbeddedMetadata,
} from '../../../src/core/resources/builds/actor-system-cli/control_cmds/metadata.js';

/** @type {string[]} */
const temporaryDirectories = [];

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fsp.rm(directory, { force: true, recursive: true })),
  );
});

/**
 * @param {string} character - Base64url fixture character.
 * @returns {import('../../../src/core/runtime/application-revision.js').Sha256Digest} - Digest fixture.
 */
function digest(character) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(character).digest('base64url'),
  };
}

/**
 * @param {string} [sourceDigest] - Source digest fixture character.
 * @returns {import('../../../src/core/runtime/application-revision.js').ApplicationRevision} - Revision fixture.
 */
function makeRevision(sourceDigest = 'A') {
  return createApplicationRevision({
    contract: {
      schemaVersion: 2,
      app: { id: 'metadata-demo' },
      cli: {
        entrypoint: { kind: 'node', path: 'cli.js', export: 'main' },
      },
      activities: {
        inspect: {
          entrypoint: {
            kind: 'node',
            path: 'activities/inspect.js',
            export: 'inspect',
          },
        },
      },
    },
    inputs: {
      source: {
        format: SOURCE_TREE_INPUT_FORMAT,
        digest: digest(sourceDigest),
      },
      dependencies: {
        format: DEPENDENCY_LOCK_INPUT_FORMAT,
        digest: digest('B'),
      },
      runtime: {
        format: RUNTIME_INPUT_FORMAT,
        digest: digest('C'),
      },
    },
  });
}

/**
 * @param {import('../../../src/core/runtime/application-revision.js').ApplicationRevision} [revision] - Owning revision.
 * @returns {import('../../../src/core/resources/builds/lib/revision-runtime-assets.js').ArtifactRuntime} - Runtime fixture.
 */
function makeRuntime(revision = makeRevision()) {
  return {
    schemaVersion: 1,
    kind: 'artifactRuntime',
    appId: revision.contract.app.id,
    revisionId: revision.revisionId,
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
  };
}

/**
 * @param {import('../../../src/core/runtime/application-revision.js').ApplicationRevision} revision - Revision asset.
 * @param {import('../../../src/core/resources/builds/lib/revision-runtime-assets.js').ArtifactRuntime} runtime - Runtime asset.
 * @returns {import('../../../src/core/resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimeAssetProvider} - Asset provider.
 */
function makeAssetProvider(revision, runtime) {
  const assets = new Map([
    [APPLICATION_REVISION_ASSET_NAME, JSON.stringify(revision)],
    [ARTIFACT_RUNTIME_ASSET_NAME, JSON.stringify(runtime)],
  ]);
  return {
    getAsset: async (/** @type {string} */ name) => {
      const value = assets.get(name);
      return value === undefined ? undefined : Buffer.from(value, 'utf8');
    },
  };
}

/**
 * @param {string | Buffer} bytes - Exact artifact bytes.
 * @returns {Promise<string>} - Temporary artifact path.
 */
async function makeArtifact(bytes) {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-metadata-command-'),
  );
  temporaryDirectories.push(directory);
  const artifactPath = path.join(directory, 'artifact');
  await fsp.writeFile(artifactPath, bytes);
  return artifactPath;
}

/**
 * @param {any} value - JSON subtree.
 * @param {string} expectedKey - Property name to find.
 * @returns {boolean} - Whether the key occurs anywhere in the subtree.
 */
function containsOwnKey(value, expectedKey) {
  if (value === null || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, expectedKey)) return true;
  return Object.values(value).some((child) =>
    containsOwnKey(child, expectedKey),
  );
}

/**
 * @param {{ revision: import('../../../src/core/runtime/application-revision.js').ApplicationRevision, runtime: import('../../../src/core/resources/builds/lib/revision-runtime-assets.js').ArtifactRuntime, artifactPath: string, pretty: boolean | undefined }} options - Helper inputs.
 * @returns {Promise<string>} - Captured command output.
 */
async function captureMetadata({ revision, runtime, artifactPath, pretty }) {
  /** @type {string[]} */
  const writes = [];
  await printEmbeddedMetadata(
    { pretty },
    {
      assetProvider: makeAssetProvider(revision, runtime),
      artifactPath,
      write: (text) => writes.push(text),
    },
  );
  return writes.join('');
}

describe('embedded operator metadata command', () => {
  it('emits canonical compact JSON for the exact injected artifact bytes', async () => {
    const revision = makeRevision();
    const runtime = makeRuntime(revision);
    const bytes = Buffer.from('exact artifact bytes\0one', 'utf8');
    const artifactPath = await makeArtifact(bytes);
    const output = await captureMetadata({
      revision,
      runtime,
      artifactPath,
      pretty: false,
    });
    const metadata = JSON.parse(output);
    const artifactId = createSha256Id({
      prefix: ARTIFACT_ID_PREFIX,
      payload: bytes,
    });
    const expected = {
      revision,
      runtime,
      artifact: {
        artifactId,
        byteDigest: {
          algorithm: 'sha256',
          value: artifactId.slice(`${ARTIFACT_ID_PREFIX}_`.length),
        },
        size: bytes.byteLength,
      },
    };

    expect(metadata).toEqual(expected);
    expect(output).toBe(
      `${JSON.stringify(sortCanonicalJsonValue(expected))}\n`,
    );
    expect(metadata.artifact).not.toHaveProperty('provenance');
    expect(containsOwnKey(metadata.revision, 'artifactId')).toBe(false);
    expect(containsOwnKey(metadata.runtime, 'artifactId')).toBe(false);
  });

  it('changes artifact identity when exact executable bytes change', async () => {
    const revision = makeRevision();
    const runtime = makeRuntime(revision);
    const artifactPath = await makeArtifact(Buffer.from('artifact-one'));
    const first = JSON.parse(
      await captureMetadata({
        revision,
        runtime,
        artifactPath,
        pretty: false,
      }),
    );

    await fsp.writeFile(artifactPath, Buffer.from('artifact-two'));
    const second = JSON.parse(
      await captureMetadata({
        revision,
        runtime,
        artifactPath,
        pretty: false,
      }),
    );

    expect(second.revision).toEqual(first.revision);
    expect(second.runtime).toEqual(first.runtime);
    expect(second.artifact.size).toBe(first.artifact.size);
    expect(second.artifact.artifactId).not.toBe(first.artifact.artifactId);
    expect(second.artifact.byteDigest.value).not.toBe(
      first.artifact.byteDigest.value,
    );
  });

  it('supports pretty output by default and compact --no-pretty semantics', async () => {
    const revision = makeRevision();
    const runtime = makeRuntime(revision);
    const artifactPath = await makeArtifact(Buffer.from('artifact'));

    const pretty = await captureMetadata({
      revision,
      runtime,
      artifactPath,
      pretty: undefined,
    });
    const compact = await captureMetadata({
      revision,
      runtime,
      artifactPath,
      pretty: false,
    });

    expect(pretty).toContain('\n  "artifact"');
    expect(compact.slice(0, -1)).not.toContain('\n');
    expect(metadataCommand.options.map((option) => option.long)).toEqual([
      '--json',
      '--no-pretty',
    ]);
  });

  it('fails before hashing or writing when embedded metadata does not match', async () => {
    const revision = makeRevision();
    const otherRevision = makeRevision('D');
    const write = jest.fn();

    await expect(
      printEmbeddedMetadata(
        { pretty: false },
        {
          assetProvider: makeAssetProvider(revision, {
            ...makeRuntime(revision),
            revisionId: otherRevision.revisionId,
          }),
          artifactPath: path.join(os.tmpdir(), 'must-not-be-read-artifact'),
          write,
        },
      ),
    ).rejects.toThrow(/runtime\.revisionId.*revision\.revisionId/);
    expect(write).not.toHaveBeenCalled();
  });

  it('registers metadata on the minimal packaged operator surface', async () => {
    /** @type {string[]} */
    const writes = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const { default: entrypoint } =
      await import('../../../src/core/resources/builds/actor-system-cli/index.js');

    await entrypoint(['node', 'wharfie-artifact']);

    expect(writes.join('')).toContain('metadata');
  });
});
