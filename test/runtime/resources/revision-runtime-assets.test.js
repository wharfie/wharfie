/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import {
  createApplicationRevision,
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
} from '../../../src/core/runtime/application-revision.js';
import {
  APPLICATION_REVISION_ASSET_NAME,
  ARTIFACT_RUNTIME_ASSET_NAME,
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
  createEmbeddedRevisionRuntimeAssets,
  readEmbeddedRevisionRuntimePair,
  stringifyEmbeddedApplicationRevision,
  stringifyEmbeddedArtifactRuntime,
  validateArtifactRuntime,
  validateEmbeddedRevisionRuntimePair,
} from '../../../src/core/resources/builds/lib/revision-runtime-assets.js';

const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
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
 * @param {string} [appId] - Application ID.
 * @param {string} [sourceDigest] - Source digest fixture character.
 * @returns {import('../../../src/core/runtime/application-revision.js').ApplicationRevision} - Revision fixture.
 */
function makeRevision(appId = 'embedded-demo', sourceDigest = 'A') {
  return createApplicationRevision({
    contract: {
      schemaVersion: 2,
      app: { id: appId },
      cli: {
        entrypoint: { kind: 'node', path: 'cli.js', export: 'main' },
      },
      activities: {
        greet: {
          entrypoint: {
            kind: 'node',
            path: 'activities/greet.js',
            export: 'greet',
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
    schemaVersion: ARTIFACT_RUNTIME_SCHEMA_VERSION,
    kind: ARTIFACT_RUNTIME_KIND,
    appId: revision.contract.app.id,
    revisionId: revision.revisionId,
    target: { ...TARGET },
  };
}

/**
 * @param {import('../../../src/core/runtime/application-revision.js').ApplicationRevision} revision - Revision asset.
 * @param {import('../../../src/core/resources/builds/lib/revision-runtime-assets.js').ArtifactRuntime} runtime - Runtime asset.
 * @returns {import('../../../src/core/resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimeAssetProvider} - Asset provider.
 */
function makeProvider(revision, runtime) {
  const assets = new Map([
    [
      APPLICATION_REVISION_ASSET_NAME,
      Buffer.from(JSON.stringify(revision), 'utf8'),
    ],
    [ARTIFACT_RUNTIME_ASSET_NAME, Buffer.from(JSON.stringify(runtime), 'utf8')],
  ]);
  return {
    getAsset: async (/** @type {string} */ name) => assets.get(name),
  };
}

describe('embedded revision and runtime assets', () => {
  it('reserves stable SEA asset names and runtime discriminators', () => {
    expect(APPLICATION_REVISION_ASSET_NAME).toBe('<WHARFIE_APP>/revision.json');
    expect(ARTIFACT_RUNTIME_ASSET_NAME).toBe('<WHARFIE_APP>/runtime.json');
    expect(ARTIFACT_RUNTIME_SCHEMA_VERSION).toBe(1);
    expect(ARTIFACT_RUNTIME_KIND).toBe('artifactRuntime');
  });

  it('validates and independently clones exact target runtime metadata', () => {
    const revision = makeRevision();
    const input = makeRuntime(revision);
    const runtime = validateArtifactRuntime(input);

    input.target.nodeVersion = '22.0.0';

    expect(runtime).toEqual(makeRuntime(revision));
    expect(runtime).not.toBe(input);
    expect(runtime.target).not.toBe(input.target);
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.target)).toBe(true);
  });

  it.each([
    ['artifactId', 'waf1_not-embedded'],
    ['provider', 'aws'],
    ['credentials', { token: 'secret' }],
    ['env', { REGION: 'us-east-1' }],
  ])('rejects unsupported runtime field %s', (field, fieldValue) => {
    expect(() =>
      validateArtifactRuntime({
        ...makeRuntime(),
        [field]: fieldValue,
      }),
    ).toThrow(`runtime.${field} is not supported`);
  });

  it('rejects unknown target fields', () => {
    const runtime = makeRuntime();
    expect(() =>
      validateArtifactRuntime({
        ...runtime,
        target: { ...runtime.target, provider: 'aws' },
      }),
    ).toThrow('runtime.target.provider is not supported');
  });

  it.each([
    [{ schemaVersion: 2 }, /schemaVersion/],
    [{ kind: 'artifact' }, /kind/],
    [{ appId: 'Not-Canonical' }, /appId/],
    [{ revisionId: 'latest' }, /revisionId/],
    [
      {
        target: {
          nodeVersion: '24.13.1',
          platform: 'linux',
          architecture: 'x64',
        },
      },
      /libc/,
    ],
  ])('rejects an invalid runtime field', (override, expected) => {
    expect(() =>
      validateArtifactRuntime({ ...makeRuntime(), ...override }),
    ).toThrow(expected);
  });

  it('cross-checks a runtime against its full embedded revision', () => {
    const revision = makeRevision();
    const pair = validateEmbeddedRevisionRuntimePair(
      revision,
      makeRuntime(revision),
    );

    expect(pair.revision).toEqual(revision);
    expect(pair.runtime).toEqual(makeRuntime(revision));
    expect(pair.revision).not.toBe(revision);
    expect(Object.isFrozen(pair)).toBe(true);
    expect(Object.isFrozen(pair.revision)).toBe(true);
    expect(Object.isFrozen(pair.revision.contract)).toBe(true);
    expect(Object.isFrozen(pair.runtime)).toBe(true);
  });

  it('rejects a runtime application that differs from the revision contract', () => {
    const revision = makeRevision();
    expect(() =>
      validateEmbeddedRevisionRuntimePair(revision, {
        ...makeRuntime(revision),
        appId: 'another-app',
      }),
    ).toThrow(/runtime\.appId.*revision\.contract\.app\.id/);
  });

  it('rejects a runtime revision that differs from the embedded revision', () => {
    const revision = makeRevision();
    const otherRevision = makeRevision('embedded-demo', 'D');
    expect(() =>
      validateEmbeddedRevisionRuntimePair(revision, {
        ...makeRuntime(revision),
        revisionId: otherRevision.revisionId,
      }),
    ).toThrow(/runtime\.revisionId.*revision\.revisionId/);
  });

  it('rejects a tampered full embedded revision before pair matching', () => {
    const revision = makeRevision();
    expect(() =>
      validateEmbeddedRevisionRuntimePair(
        {
          ...revision,
          contract: { ...revision.contract, app: { id: 'another-app' } },
        },
        makeRuntime(revision),
      ),
    ).toThrow(/revisionId does not match/);
  });

  it('serializes both documents with deterministic object-key ordering', () => {
    const revision = makeRevision();
    const runtime = makeRuntime(revision);
    const runtimeText = stringifyEmbeddedArtifactRuntime(
      {
        target: runtime.target,
        revisionId: runtime.revisionId,
        appId: runtime.appId,
        kind: runtime.kind,
        schemaVersion: runtime.schemaVersion,
      },
      { pretty: false },
    );
    const revisionText = stringifyEmbeddedApplicationRevision(revision, {
      pretty: false,
    });

    expect(Object.keys(JSON.parse(runtimeText))).toEqual([
      'appId',
      'kind',
      'revisionId',
      'schemaVersion',
      'target',
    ]);
    expect(JSON.parse(revisionText)).toEqual(revision);
    expect(runtimeText).not.toContain('artifactId');
  });

  it('materializes private paired files and cleans them up idempotently', async () => {
    const revision = makeRevision();
    const runtime = makeRuntime(revision);
    const handle = await createEmbeddedRevisionRuntimeAssets({
      revision,
      runtime,
    });
    const assetDir = path.dirname(handle.revisionPath);

    try {
      expect(path.dirname(handle.runtimePath)).toBe(assetDir);
      expect(path.basename(handle.revisionPath)).toBe('revision.json');
      expect(path.basename(handle.runtimePath)).toBe('runtime.json');
      expect((await fsp.stat(assetDir)).mode & 0o777).toBe(0o700);
      expect((await fsp.stat(handle.revisionPath)).mode & 0o777).toBe(0o600);
      expect((await fsp.stat(handle.runtimePath)).mode & 0o777).toBe(0o600);
      expect(handle.assets).toEqual({
        [APPLICATION_REVISION_ASSET_NAME]: handle.revisionPath,
        [ARTIFACT_RUNTIME_ASSET_NAME]: handle.runtimePath,
      });
      expect(Object.isFrozen(handle.assets)).toBe(true);

      const writtenRevision = JSON.parse(
        await fsp.readFile(handle.revisionPath, 'utf8'),
      );
      const writtenRuntime = JSON.parse(
        await fsp.readFile(handle.runtimePath, 'utf8'),
      );
      expect(writtenRevision).toEqual(revision);
      expect(writtenRuntime).toEqual(runtime);
      expect(writtenRuntime).not.toHaveProperty('artifactId');
    } finally {
      await handle.cleanup();
    }

    await expect(handle.cleanup()).resolves.toBeUndefined();
    await expect(fsp.stat(assetDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reads both reserved assets through an injected provider', async () => {
    const revision = makeRevision();
    const runtime = makeRuntime(revision);
    /** @type {string[]} */
    const reads = [];
    const provider = makeProvider(revision, runtime);

    const pair = await readEmbeddedRevisionRuntimePair({
      assetProvider: {
        getAsset: async (name) => {
          reads.push(name);
          return await provider.getAsset(name);
        },
      },
    });

    expect(reads).toEqual([
      APPLICATION_REVISION_ASSET_NAME,
      ARTIFACT_RUNTIME_ASSET_NAME,
    ]);
    expect(pair).toEqual({ revision, runtime });
  });

  it('fails closed when an embedded runtime asset is missing', async () => {
    const revision = makeRevision();
    await expect(
      readEmbeddedRevisionRuntimePair({
        assetProvider: {
          getAsset: async (name) =>
            name === APPLICATION_REVISION_ASSET_NAME
              ? Buffer.from(JSON.stringify(revision), 'utf8')
              : undefined,
        },
      }),
    ).rejects.toThrow(ARTIFACT_RUNTIME_ASSET_NAME);
  });

  it.each([
    [APPLICATION_REVISION_ASSET_NAME, 'application revision'],
    [ARTIFACT_RUNTIME_ASSET_NAME, 'artifact runtime metadata'],
  ])('rejects invalid JSON in %s', async (invalidName, label) => {
    const revision = makeRevision();
    const runtime = makeRuntime(revision);
    const provider = makeProvider(revision, runtime);

    await expect(
      readEmbeddedRevisionRuntimePair({
        assetProvider: {
          getAsset: async (name) =>
            name === invalidName
              ? Buffer.from('{', 'utf8')
              : await provider.getAsset(name),
        },
      }),
    ).rejects.toThrow(`Embedded ${label} is not valid JSON`);
  });

  it('cross-checks pairs read from an injected provider', async () => {
    const revision = makeRevision();
    await expect(
      readEmbeddedRevisionRuntimePair({
        assetProvider: makeProvider(revision, {
          ...makeRuntime(revision),
          appId: 'another-app',
        }),
      }),
    ).rejects.toThrow(/runtime\.appId.*revision\.contract\.app\.id/);
  });

  it('requires a real SEA when no asset provider is injected', async () => {
    await expect(readEmbeddedRevisionRuntimePair()).rejects.toThrow(
      'only available inside a packaged SEA artifact',
    );
  });

  it('rejects injected providers without getAsset', async () => {
    await expect(
      readEmbeddedRevisionRuntimePair({
        assetProvider: /** @type {any} */ ({}),
      }),
    ).rejects.toThrow('asset provider is unavailable');
  });
});
