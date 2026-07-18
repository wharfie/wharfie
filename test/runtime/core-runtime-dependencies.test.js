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
  FROZEN_DEPENDENCY_CLOSURE_DIGEST_DOMAIN,
  digestFrozenDependencyClosurePlan,
  validateFrozenDependencyClosurePlan,
} from '../../src/core/resources/builds/lib/frozen-dependency-closure-plan.js';
import { createFrozenDependencyClosurePlan } from '../../src/core/resources/builds/lib/frozen-dependency-closure.js';
import { getCoreLmdbDependencyLock } from '../../src/core/resources/builds/core-runtime-dependencies.js';
import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
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
 * @param {{nestedMain?: boolean}} [options] - Whether the entry points into a nested planned package.
 * @returns {Promise<{directory: string, archive: Buffer, plan: Readonly<Record<string, any>>}>} - Closure whose dependency entry does not belong to its package root.
 */
async function makeMisdirectedPackageClosure(options = {}) {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-core-runtime-loader-'),
  );
  const lmdbPath = path.join(directory, 'node_modules', 'lmdb');
  const dependencyPath = path.join(directory, 'node_modules', 'ordered-binary');
  const nestedDependencyPath = path.join(
    dependencyPath,
    'node_modules',
    'nested-entry',
  );
  const directories = [
    fsp.mkdir(lmdbPath, { recursive: true }),
    fsp.mkdir(dependencyPath, { recursive: true }),
  ];
  if (options.nestedMain) {
    directories.push(fsp.mkdir(nestedDependencyPath, { recursive: true }));
  }
  await Promise.all(directories);
  const files = [
    fsp.writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ name: 'archive-controlled-package' }),
    ),
    fsp.writeFile(
      path.join(lmdbPath, 'package.json'),
      JSON.stringify({
        name: 'lmdb',
        version: '3.4.4',
        dependencies: { 'ordered-binary': '1.0.0' },
      }),
    ),
    fsp.writeFile(path.join(lmdbPath, 'index.js'), 'exports.open = () => {};'),
    fsp.writeFile(
      path.join(dependencyPath, 'package.json'),
      JSON.stringify({
        name: 'ordered-binary',
        version: '1.0.0',
        main: options.nestedMain
          ? 'node_modules/nested-entry/index.js'
          : '../lmdb/index.js',
        ...(options.nestedMain
          ? { dependencies: { 'nested-entry': '1.0.0' } }
          : {}),
      }),
    ),
  ];
  if (options.nestedMain) {
    files.push(
      fsp.writeFile(
        path.join(nestedDependencyPath, 'package.json'),
        JSON.stringify({ name: 'nested-entry', version: '1.0.0' }),
      ),
      fsp.writeFile(
        path.join(nestedDependencyPath, 'index.js'),
        'module.exports = { nested: true };',
      ),
    );
  }
  await Promise.all(files);
  const lock = makeMinimalPlan().lock;
  const plan = validateFrozenDependencyClosurePlan({
    schemaVersion: 2,
    kind: 'frozenDependencyClosure',
    activity: 'core-local-control-store',
    lock,
    target: currentTarget(),
    installScripts: 'ignored',
    binLinks: 'not-created',
    selectedOptionalFailures: 'fatal',
    roots: [
      {
        name: 'lmdb',
        version: '3.4.4',
        location: 'node_modules/lmdb',
      },
    ],
    packages: [
      {
        location: 'node_modules/lmdb',
        name: 'lmdb',
        version: '3.4.4',
        resolved: 'https://registry.npmjs.org/lmdb/-/lmdb-3.4.4.tgz',
        integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
        hasInstallScript: false,
        manifestContract: sortCanonicalJsonValue({
          name: 'lmdb',
          version: '3.4.4',
          dependencies: { 'ordered-binary': '1.0.0' },
          bundleDependencies: [],
          hasInstallScript: false,
        }),
        edges: [
          {
            name: 'ordered-binary',
            type: 'prod',
            spec: '1.0.0',
            location: 'node_modules/ordered-binary',
          },
        ],
      },
      {
        location: 'node_modules/ordered-binary',
        name: 'ordered-binary',
        version: '1.0.0',
        resolved:
          'https://registry.npmjs.org/ordered-binary/-/ordered-binary-1.0.0.tgz',
        integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
        hasInstallScript: false,
        manifestContract: sortCanonicalJsonValue({
          name: 'ordered-binary',
          version: '1.0.0',
          ...(options.nestedMain
            ? { dependencies: { 'nested-entry': '1.0.0' } }
            : {}),
          bundleDependencies: [],
          hasInstallScript: false,
        }),
        edges: options.nestedMain
          ? [
              {
                name: 'nested-entry',
                type: 'prod',
                spec: '1.0.0',
                location:
                  'node_modules/ordered-binary/node_modules/nested-entry',
              },
            ]
          : [],
      },
      ...(options.nestedMain
        ? [
            {
              location: 'node_modules/ordered-binary/node_modules/nested-entry',
              name: 'nested-entry',
              version: '1.0.0',
              resolved:
                'https://registry.npmjs.org/nested-entry/-/nested-entry-1.0.0.tgz',
              integrity: `sha512-${Buffer.alloc(64, 2).toString('base64')}`,
              hasInstallScript: false,
              manifestContract: sortCanonicalJsonValue({
                name: 'nested-entry',
                version: '1.0.0',
                bundleDependencies: [],
                hasInstallScript: false,
              }),
              edges: [],
            },
          ]
        : []),
    ],
  });
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
    plan,
  };
}

/**
 * Build an archive from the real installed LMDB closure for the current test
 * target. This exercises native resolution without relying on the workspace
 * module tree after the fresh closure has been materialized.
 * @param {{omitLmdbNative?: boolean, omitPackage?: string}} [options] - Fixture options.
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
  ].filter((packagePath) => packagePath !== options.omitPackage);
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

/** @returns {Readonly<Record<string, any>>} - Minimal valid plan. */
function makeMinimalPlan() {
  const target = currentTarget();
  const lock = {
    format: 'wharfie-npm-package-lock-v3-closure-v1',
    digest: {
      algorithm: 'sha256',
      value: createHash('sha256').update('dependency-lock').digest('base64url'),
    },
  };
  return validateFrozenDependencyClosurePlan({
    schemaVersion: 2,
    kind: 'frozenDependencyClosure',
    activity: 'core-local-control-store',
    lock,
    target,
    installScripts: 'ignored',
    binLinks: 'not-created',
    selectedOptionalFailures: 'fatal',
    roots: [
      {
        name: 'lmdb',
        version: '3.4.4',
        location: 'node_modules/lmdb',
      },
    ],
    packages: [
      {
        location: 'node_modules/lmdb',
        name: 'lmdb',
        version: '3.4.4',
        resolved: 'https://registry.npmjs.org/lmdb/-/lmdb-3.4.4.tgz',
        integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
        hasInstallScript: false,
        manifestContract: sortCanonicalJsonValue({
          name: 'lmdb',
          version: '3.4.4',
          bundleDependencies: [],
          hasInstallScript: false,
        }),
        edges: [],
      },
    ],
  });
}

/**
 * @returns {Promise<Readonly<Record<string, any>>>} - Real target plan.
 */
async function makeInstalledLmdbClosurePlan() {
  return (
    await createFrozenDependencyClosurePlan({
      activity: 'core-local-control-store',
      buildTarget: currentTarget(),
      dependencyLock: await getCoreLmdbDependencyLock(),
      externals: [{ name: 'lmdb', version: '3.4.4' }],
    })
  ).plan;
}

/**
 * @param {Buffer} archive - Exact archive bytes.
 * @param {Readonly<Record<string, any>>} [plan] - Embedded closure plan.
 * @returns {Record<string, any>} - Strict fake SEA asset map.
 */
function makeAssets(archive, plan = makeMinimalPlan()) {
  const target = currentTarget();
  const closureDigest = digestFrozenDependencyClosurePlan(plan);
  const manifest = {
    schemaVersion: CORE_RUNTIME_DEPENDENCY_ASSET_SCHEMA_VERSION,
    kind: CORE_RUNTIME_DEPENDENCY_ASSET_KIND,
    purpose: CORE_RUNTIME_DEPENDENCY_PURPOSE,
    target,
    roots: [{ name: 'lmdb', version: '3.4.4' }],
    dependencyLockInput: plan.lock,
    closureDigest,
    plan,
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

/**
 * Build an intentionally unchecked manifest to prove runtime validation does
 * not trust a coordinated caller-computed plan digest.
 * @param {Buffer} archive - Exact archive bytes.
 * @param {Record<string, any>} plan - Deliberately malformed plan.
 * @returns {Record<string, any>} - Untrusted SEA asset map.
 */
function makeUncheckedAssets(archive, plan) {
  const closureDigest = {
    algorithm: 'sha256',
    value: createHash('sha256')
      .update(
        `${FROZEN_DEPENDENCY_CLOSURE_DIGEST_DOMAIN}\0${JSON.stringify(plan)}`,
      )
      .digest('base64url'),
  };
  const manifest = {
    schemaVersion: CORE_RUNTIME_DEPENDENCY_ASSET_SCHEMA_VERSION,
    kind: CORE_RUNTIME_DEPENDENCY_ASSET_KIND,
    purpose: CORE_RUNTIME_DEPENDENCY_PURPOSE,
    target: currentTarget(),
    roots: [{ name: 'lmdb', version: '3.4.4' }],
    dependencyLockInput: plan.lock,
    closureDigest,
    plan,
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

  it('rejects an embedded closure plan that no longer matches its semantic digest', async () => {
    const fixture = await makeClosureArchive();
    const tempParent = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-core-runtime-parent-'),
    );
    const assets = makeAssets(fixture.archive);
    const manifest = JSON.parse(
      assets[CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME].toString('utf8'),
    );
    manifest.plan.packages[0].resolved =
      'https://registry.npmjs.org/lmdb/-/lmdb-3.4.3.tgz';
    assets[CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME] = Buffer.from(
      JSON.stringify(manifest),
      'utf8',
    );

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
      ).rejects.toThrow(
        /closureDigest does not match its embedded closure plan/i,
      );
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

  it('rejects a planned package whose CommonJS entry resolves outside its exact package root', async () => {
    const fixture = await makeMisdirectedPackageClosure();
    const tempParent = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-core-runtime-parent-'),
    );
    const assets = makeAssets(fixture.archive, fixture.plan);

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
      ).rejects.toThrow(
        /resolved 'ordered-binary' outside its sealed closure package/i,
      );
    } finally {
      await fsp.rm(fixture.directory, { force: true, recursive: true });
      await fsp.rm(tempParent, { force: true, recursive: true });
    }
  });

  it('rejects a planned package whose CommonJS entry resolves from its nested node_modules', async () => {
    const fixture = await makeMisdirectedPackageClosure({ nestedMain: true });
    const tempParent = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-core-runtime-parent-'),
    );
    const assets = makeAssets(fixture.archive, fixture.plan);

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
      ).rejects.toThrow(
        /from a nested package instead of its exact sealed closure package/i,
      );
    } finally {
      await fsp.rm(fixture.directory, { force: true, recursive: true });
      await fsp.rm(tempParent, { force: true, recursive: true });
    }
  });

  it('loads real LMDB from the verified closure despite an ambient prebuild override', async () => {
    const archive = await makeInstalledLmdbClosureArchive();
    const plan = await makeInstalledLmdbClosurePlan();
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
    const assets = makeAssets(archive, plan);

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
    const plan = await makeInstalledLmdbClosurePlan();
    const tempParent = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-core-runtime-parent-'),
    );
    const assets = makeAssets(archive, plan);
    const priorNodePath = process.env.NODE_PATH;

    try {
      process.env.NODE_PATH = path.join(process.cwd(), 'node_modules');
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
      ).rejects.toThrow(/does not match its exact closure plan package roots/i);
    } finally {
      if (priorNodePath === undefined) {
        delete process.env.NODE_PATH;
      } else {
        process.env.NODE_PATH = priorNodePath;
      }
      await fsp.rm(tempParent, { force: true, recursive: true });
    }
  });

  it('rejects a missing planned JavaScript package before ambient CommonJS resolution', async () => {
    const archive = await makeInstalledLmdbClosureArchive({
      omitPackage: 'node_modules/ordered-binary',
    });
    const plan = await makeInstalledLmdbClosurePlan();
    const tempParent = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-core-runtime-parent-'),
    );
    const ambientPackage = path.join(
      tempParent,
      'node_modules',
      'ordered-binary',
    );
    const assets = makeAssets(archive, plan);

    try {
      await fsp.mkdir(path.dirname(ambientPackage), { recursive: true });
      await fsp.cp(
        path.join(process.cwd(), 'node_modules', 'ordered-binary'),
        ambientPackage,
        { recursive: true },
      );
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
      ).rejects.toThrow(/does not match its exact closure plan package roots/i);
    } finally {
      await fsp.rm(tempParent, { force: true, recursive: true });
    }
  });

  it('rejects ambient CommonJS resolution for a plan-explicit omitted optional package', async () => {
    const archive = await makeInstalledLmdbClosureArchive();
    const plan = await makeInstalledLmdbClosurePlan();
    const omittedEdge = plan.packages
      .flatMap(
        (/** @type {Record<string, any>} */ packageEntry) => packageEntry.edges,
      )
      .find(
        (/** @type {Record<string, any>} */ edge) => edge.location === null,
      );
    expect(omittedEdge).toBeDefined();
    if (!omittedEdge) {
      throw new Error(
        'Expected one installed target-incompatible optional package.',
      );
    }
    const tempParent = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-core-runtime-parent-'),
    );
    const ambientPackage = path.join(
      tempParent,
      'node_modules',
      ...omittedEdge.name.split('/'),
    );
    const assets = makeAssets(archive, plan);

    try {
      await fsp.mkdir(ambientPackage, { recursive: true });
      await Promise.all([
        fsp.writeFile(
          path.join(ambientPackage, 'package.json'),
          JSON.stringify({
            name: omittedEdge.name,
            version: '0.0.0-ambient',
          }),
        ),
        fsp.writeFile(
          path.join(ambientPackage, 'index.js'),
          'module.exports = { ambient: true };',
        ),
      ]);
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
      ).rejects.toThrow(
        /omitted .*generic CommonJS resolution selected ambient entry/i,
      );
    } finally {
      await fsp.rm(tempParent, { force: true, recursive: true });
    }
  });

  it('rejects a coordinated omitted edge and package even when ambient JavaScript exists', async () => {
    const archive = await makeInstalledLmdbClosureArchive({
      omitPackage: 'node_modules/ordered-binary',
    });
    const plan = JSON.parse(
      JSON.stringify(await makeInstalledLmdbClosurePlan()),
    );
    const lmdb = plan.packages.find(
      (/** @type {Record<string, any>} */ packageEntry) =>
        packageEntry.location === 'node_modules/lmdb',
    );
    lmdb.edges = lmdb.edges.filter(
      (/** @type {Record<string, any>} */ edge) =>
        edge.name !== 'ordered-binary',
    );
    plan.packages = plan.packages.filter(
      (/** @type {Record<string, any>} */ packageEntry) =>
        packageEntry.location !== 'node_modules/ordered-binary',
    );
    const tempParent = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-core-runtime-parent-'),
    );
    const ambientPackage = path.join(
      tempParent,
      'node_modules',
      'ordered-binary',
    );
    const assets = makeUncheckedAssets(archive, plan);

    try {
      await fsp.mkdir(path.dirname(ambientPackage), { recursive: true });
      await fsp.cp(
        path.join(process.cwd(), 'node_modules', 'ordered-binary'),
        ambientPackage,
        { recursive: true },
      );
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
      ).rejects.toThrow(
        /edges must exactly cover its manifest dependency contract/i,
      );
    } finally {
      await fsp.rm(tempParent, { force: true, recursive: true });
    }
  });
});
