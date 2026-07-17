/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buffer as streamToBuffer } from 'node:stream/consumers';

import { afterEach, describe, expect, it } from '@jest/globals';
import { c } from 'tar';

import {
  CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME,
  CORE_RUNTIME_DEPENDENCY_ASSET_KIND,
  CORE_RUNTIME_DEPENDENCY_ASSET_SCHEMA_VERSION,
  CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME,
  CORE_RUNTIME_DEPENDENCY_PURPOSE,
} from '../../src/core/resources/builds/lib/core-runtime-dependency-asset.js';
import {
  _resetPackagedCoreRuntimeDependenciesForTest,
  preparePackagedCoreRuntimeDependencies,
  requirePackagedCoreRuntimeDependency,
} from '../../src/core/runtime/core-runtime-dependencies.js';

const PACKAGE_METADATA = JSON.parse(
  readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
);
const CAN_OPEN_NATIVE_LMDB =
  process.versions.node === PACKAGE_METADATA.engines.node;

/**
 * @returns {import('../../src/core/runtime/build-target.js').BuildTarget} - Current test target.
 */
function currentTarget() {
  return {
    nodeVersion: process.versions.node,
    platform: /** @type {'darwin'|'linux'|'win32'} */ (process.platform),
    architecture: /** @type {'arm64'|'x64'} */ (process.arch),
    ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
  };
}

/**
 * @param {{symlink?: boolean}} [options] - Archive options.
 * @returns {Promise<{directory: string, archive: Buffer}>} - Archive fixture.
 */
async function makeClosureArchive(options = {}) {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-core-runtime-loader-'),
  );
  const lmdbPath = path.join(directory, 'node_modules', 'lmdb');
  await fsp.mkdir(lmdbPath, { recursive: true });
  await fsp.writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({ name: 'archive-controlled-package' }),
  );
  await fsp.writeFile(
    path.join(lmdbPath, 'package.json'),
    JSON.stringify({ name: 'lmdb', version: '3.4.4' }),
  );
  await fsp.writeFile(
    path.join(lmdbPath, 'index.js'),
    'exports.open = () => {};',
  );
  if (options.symlink) {
    await fsp.symlink('index.js', path.join(lmdbPath, 'unsafe-link'));
  }
  return {
    directory,
    archive: await streamToBuffer(
      c(
        {
          cwd: directory,
          gzip: { level: 9 },
          portable: true,
          noMtime: true,
        },
        ['.'],
      ),
    ),
  };
}

/**
 * Build an archive from the real installed LMDB closure for the current test
 * target. This exercises native resolution without relying on the workspace
 * module tree after the fresh closure has been materialized.
 * @param {{omitLmdbNative?: boolean}} [options] - Fixture options.
 * @returns {Promise<Buffer>} - Exact closure archive bytes.
 */
async function makeInstalledLmdbClosureArchive(options = {}) {
  const target = currentTarget();
  const lmdbNativePackage = `@lmdb/lmdb-${target.platform}-${target.architecture}`;
  const msgpackrExtractNativePackage = `@msgpackr-extract/msgpackr-extract-${target.platform}-${target.architecture}`;
  const packagePaths = [
    'node_modules/lmdb',
    'node_modules/lmdb/node_modules/node-addon-api',
    'node_modules/msgpackr',
    'node_modules/msgpackr-extract',
    'node_modules/node-gyp-build-optional-packages',
    'node_modules/detect-libc',
    'node_modules/ordered-binary',
    'node_modules/weak-lru-cache',
  ];
  if (!options.omitLmdbNative) {
    packagePaths.push(`node_modules/${lmdbNativePackage}`);
  }
  const msgpackrExtractPath = path.join(
    process.cwd(),
    'node_modules',
    msgpackrExtractNativePackage,
  );
  if (existsSync(msgpackrExtractPath)) {
    packagePaths.push(`node_modules/${msgpackrExtractNativePackage}`);
  }
  for (const packagePath of packagePaths) {
    await expect(
      fsp.lstat(path.join(process.cwd(), packagePath)),
    ).resolves.toBeDefined();
  }
  return await streamToBuffer(
    c(
      {
        cwd: process.cwd(),
        gzip: { level: 9 },
        portable: true,
        noMtime: true,
      },
      packagePaths,
    ),
  );
}

/**
 * @param {Buffer} archive - Exact archive bytes.
 * @returns {Record<string, any>} - Strict fake SEA asset map.
 */
function makeAssets(archive) {
  const target = currentTarget();
  const manifest = {
    schemaVersion: CORE_RUNTIME_DEPENDENCY_ASSET_SCHEMA_VERSION,
    kind: CORE_RUNTIME_DEPENDENCY_ASSET_KIND,
    purpose: CORE_RUNTIME_DEPENDENCY_PURPOSE,
    target,
    roots: [{ name: 'lmdb', version: '3.4.4' }],
    dependencyLockInput: {
      format: 'wharfie-npm-package-lock-v3-closure-v1',
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256')
          .update('dependency-lock')
          .digest('base64url'),
      },
    },
    closureDigest: {
      algorithm: 'sha256',
      value: createHash('sha256').update('closure').digest('base64url'),
    },
    archive: {
      assetName: CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME,
      digest: {
        algorithm: 'sha256',
        value: createHash('sha256').update(archive).digest('base64url'),
      },
    },
  };
  return {
    [CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME]: Buffer.from(
      JSON.stringify(manifest),
      'utf8',
    ),
    [CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME]: archive,
  };
}

afterEach(async () => {
  await _resetPackagedCoreRuntimeDependenciesForTest();
});

describe('packaged core runtime dependencies', () => {
  it('extracts exactly one verified closure into a fresh private root', async () => {
    const fixture = await makeClosureArchive();
    const tempParent = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-core-runtime-parent-'),
    );
    const assets = makeAssets(fixture.archive);
    const assetProvider = {
      isSea: () => true,
      getAsset: /** @param {string} name */ (name) => assets[name],
    };
    const identity = { runtime: { target: currentTarget() } };

    try {
      const [first, second] = await Promise.all([
        preparePackagedCoreRuntimeDependencies({
          assetProvider,
          readEmbeddedRevisionRuntimePair: async () => identity,
          tempParent,
        }),
        preparePackagedCoreRuntimeDependencies({
          assetProvider,
          readEmbeddedRevisionRuntimePair: async () => identity,
          tempParent,
        }),
      ]);

      expect(first).not.toBeNull();
      expect(second?.root).toBe(first?.root);
      expect((lstatSync(String(first?.root)).mode & 0o777).toString(8)).toBe(
        '700',
      );
      await expect(
        fsp.readFile(path.join(String(first?.root), 'package.json'), 'utf8'),
      ).resolves.toContain('wharfie-core-runtime-dependencies');
      await expect(
        fsp.readFile(
          path.join(String(first?.root), 'node_modules', 'lmdb', 'index.js'),
          'utf8',
        ),
      ).resolves.toContain('exports.open');
    } finally {
      await fsp.rm(fixture.directory, { force: true, recursive: true });
      await fsp.rm(tempParent, { force: true, recursive: true });
    }
  });

  it('rejects archive bytes that do not match the sealed receipt', async () => {
    const fixture = await makeClosureArchive();
    const tempParent = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-core-runtime-parent-'),
    );
    const assets = makeAssets(fixture.archive);
    assets[CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME] = Buffer.concat([
      fixture.archive,
      Buffer.from('tampered'),
    ]);

    try {
      await expect(
        preparePackagedCoreRuntimeDependencies({
          assetProvider: {
            isSea: () => true,
            getAsset: /** @param {string} name */ (name) => assets[name],
          },
          readEmbeddedRevisionRuntimePair: async () => ({
            runtime: { target: currentTarget() },
          }),
          tempParent,
        }),
      ).rejects.toThrow(/does not match its embedded receipt/i);
    } finally {
      await fsp.rm(fixture.directory, { force: true, recursive: true });
      await fsp.rm(tempParent, { force: true, recursive: true });
    }
  });

  it('rejects a link from the embedded dependency archive', async () => {
    const fixture = await makeClosureArchive({ symlink: true });
    const tempParent = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-core-runtime-parent-'),
    );
    const assets = makeAssets(fixture.archive);

    try {
      await expect(
        preparePackagedCoreRuntimeDependencies({
          assetProvider: {
            isSea: () => true,
            getAsset: /** @param {string} name */ (name) => assets[name],
          },
          readEmbeddedRevisionRuntimePair: async () => ({
            runtime: { target: currentTarget() },
          }),
          tempParent,
        }),
      ).rejects.toThrow(/unsupported entry type|symbolic link/i);
    } finally {
      await fsp.rm(fixture.directory, { force: true, recursive: true });
      await fsp.rm(tempParent, { force: true, recursive: true });
    }
  });

  it('loads real LMDB from the verified closure despite an ambient prebuild override', async () => {
    const archive = await makeInstalledLmdbClosureArchive();
    const tempParent = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-core-runtime-parent-'),
    );
    const databasePath = path.join(tempParent, 'database');
    const overridePath = path.join(tempParent, 'ambient-prebuild');
    const target = currentTarget();
    const fakeAddonPath = path.join(
      overridePath,
      'prebuilds',
      `${target.platform}-${target.architecture}`,
      'node.napi.node',
    );
    const priorPrebuildOverride = process.env.LMDB_PREBUILD;
    const assets = makeAssets(archive);

    try {
      await fsp.mkdir(path.dirname(fakeAddonPath), { recursive: true });
      await fsp.writeFile(fakeAddonPath, 'not a native addon');
      process.env.LMDB_PREBUILD = overridePath;
      await preparePackagedCoreRuntimeDependencies({
        assetProvider: {
          isSea: () => true,
          getAsset: /** @param {string} name */ (name) => assets[name],
        },
        readEmbeddedRevisionRuntimePair: async () => ({
          runtime: { target },
        }),
        tempParent,
      });

      const lmdb = requirePackagedCoreRuntimeDependency('lmdb');
      expect(typeof lmdb.open).toBe('function');
      // The repository intentionally requires Node 24.13.1 for packaged
      // artifacts. The local checkout may be inspected under another Node
      // version whose installed LMDB prebuild is not ABI-safe to open; CI and
      // the package SEA verifier run this actual read/write under the target.
      if (CAN_OPEN_NATIVE_LMDB) {
        const database = lmdb.open({
          path: databasePath,
          eventTurnBatching: false,
          commitDelay: 0,
        });
        try {
          database.putSync('native-closure', { source: 'verified' });
          expect(database.get('native-closure')).toEqual({
            source: 'verified',
          });
        } finally {
          await database.close();
        }
      }
    } finally {
      if (priorPrebuildOverride === undefined) {
        delete process.env.LMDB_PREBUILD;
      } else {
        process.env.LMDB_PREBUILD = priorPrebuildOverride;
      }
      await fsp.rm(tempParent, { force: true, recursive: true });
    }
  });

  it('does not resolve a missing native platform package from parent module paths', async () => {
    const archive = await makeInstalledLmdbClosureArchive({
      omitLmdbNative: true,
    });
    const tempParent = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-core-runtime-parent-'),
    );
    const assets = makeAssets(archive);
    const priorNodePath = process.env.NODE_PATH;

    try {
      process.env.NODE_PATH = path.join(process.cwd(), 'node_modules');
      await preparePackagedCoreRuntimeDependencies({
        assetProvider: {
          isSea: () => true,
          getAsset: /** @param {string} name */ (name) => assets[name],
        },
        readEmbeddedRevisionRuntimePair: async () => ({
          runtime: { target: currentTarget() },
        }),
        tempParent,
      });
      await expect(
        Promise.resolve().then(() =>
          requirePackagedCoreRuntimeDependency('lmdb'),
        ),
      ).rejects.toThrow(/@lmdb\/lmdb-/i);
    } finally {
      if (priorNodePath === undefined) {
        delete process.env.NODE_PATH;
      } else {
        process.env.NODE_PATH = priorNodePath;
      }
      await fsp.rm(tempParent, { force: true, recursive: true });
    }
  });
});
