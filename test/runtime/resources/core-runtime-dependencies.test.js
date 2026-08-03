/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME,
  CORE_RUNTIME_DEPENDENCY_ACTIVITY,
  CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME,
} from '../../../src/core/resources/builds/lib/core-runtime-dependency-asset.js';
import { DEPENDENCY_LOCK_INPUT_FORMAT } from '../../../src/core/runtime/application-revision.js';
import { sortCanonicalJsonValue } from '../../../src/core/runtime/canonical-order.js';
import { sha256Base64Url } from '../../../src/core/runtime/content-id.js';
import { digestFrozenDependencyClosurePlan } from '../../../src/core/resources/builds/lib/frozen-dependency-closure-plan.js';

const INSTALL_DEPS_IMPORT =
  '../../../src/core/resources/builds/lib/install-deps.js';
const CORE_RESOURCE_IMPORT =
  '../../../src/core/resources/builds/core-runtime-dependencies.js';
const FROZEN_CLOSURE_IMPORT =
  '../../../src/core/resources/builds/lib/frozen-dependency-closure.js';
const CORE_LOCK_PATH = path.join(
  process.cwd(),
  'src',
  'core',
  'resources',
  'builds',
  'assets',
  'core-lmdb.package-lock.json',
);

const TARGETS = [
  {
    target: {
      nodeVersion: '24.13.1',
      platform: 'darwin',
      architecture: 'arm64',
    },
    packageCount: 10,
  },
  {
    target: {
      nodeVersion: '24.13.1',
      platform: 'darwin',
      architecture: 'x64',
    },
    packageCount: 10,
  },
  {
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'arm64',
      libc: 'glibc',
    },
    packageCount: 10,
  },
  {
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    packageCount: 10,
  },
];

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe('CoreRuntimeDependenciesResource', () => {
  it('ships the exact reachable LMDB graph from the repository lock', async () => {
    const [coreLock, repositoryLock] = await Promise.all([
      fsp.readFile(CORE_LOCK_PATH, 'utf8').then(JSON.parse),
      fsp
        .readFile(path.join(process.cwd(), 'package-lock.json'), 'utf8')
        .then(JSON.parse),
    ]);
    const locations = Object.keys(coreLock.packages).filter(
      (location) => location !== '',
    );

    expect(coreLock.packages['']).toEqual({
      name: '@wharfie/core-lmdb-closure',
      version: '1.0.0',
      private: true,
      dependencies: { lmdb: '3.4.4' },
    });
    expect(locations).toHaveLength(21);
    expect(locations).toContain('node_modules/@lmdb/lmdb-linux-arm');
    expect(locations).toContain(
      'node_modules/@msgpackr-extract/msgpackr-extract-linux-arm',
    );
    for (const location of locations) {
      expect(coreLock.packages[location]).toEqual(
        repositoryLock.packages[location],
      );
    }
    expect(
      sha256Base64Url(JSON.stringify(sortCanonicalJsonValue(coreLock))),
    ).toBe('aTLcH6_nhkLpmYgXRHTGIzEhzZKgT4gQ_mE-SOBct4w');
  });

  it.each(TARGETS)(
    'plans the shipped lock for $target.platform/$target.architecture',
    async ({ target, packageCount }) => {
      const { getCoreLmdbDependencyLock } = await import(CORE_RESOURCE_IMPORT);
      const { createFrozenDependencyClosurePlan } = await import(
        FROZEN_CLOSURE_IMPORT
      );
      const dependencyLock = await getCoreLmdbDependencyLock();
      expect(dependencyLock.path).toBe(CORE_LOCK_PATH);
      const plan = await createFrozenDependencyClosurePlan({
        activity: CORE_RUNTIME_DEPENDENCY_ACTIVITY,
        buildTarget: target,
        dependencyLock,
        externals: [{ name: 'lmdb', version: '3.4.4' }],
      });

      expect(plan.plan.roots).toEqual([
        {
          name: 'lmdb',
          version: '3.4.4',
          location: 'node_modules/lmdb',
        },
      ]);
      expect(plan.plan.packages).toHaveLength(packageCount);
      expect(plan.plan.packages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'lmdb', version: '3.4.4' }),
        ]),
      );
    },
  );

  it('rejects Windows until private runtime extraction has a hardened design', async () => {
    const { default: CoreRuntimeDependenciesResource } = await import(
      CORE_RESOURCE_IMPORT
    );
    const resource = new CoreRuntimeDependenciesResource({
      name: 'unsupported-windows-core-runtime-dependencies',
      properties: {
        buildTarget: {
          nodeVersion: '24.13.1',
          platform: 'win32',
          architecture: 'x64',
        },
      },
    });

    await expect(resource._reconcile()).rejects.toThrow(
      /Windows SEA targets are deferred until private core-runtime extraction is hardened and tested/i,
    );
  });

  it('seals a core-owned target archive and strict receipt', async () => {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-core-runtime-dependencies-'),
    );
    const installForTarget = jest.fn(
      async ({ tmpBuildDir, dependencyLock, buildTarget }) => {
        const lmdbPath = path.join(tmpBuildDir, 'node_modules', 'lmdb');
        await fsp.mkdir(lmdbPath, { recursive: true });
        await fsp.writeFile(
          path.join(tmpBuildDir, 'package.json'),
          JSON.stringify({ name: 'frozen-core-closure', private: true }),
        );
        await fsp.writeFile(
          path.join(lmdbPath, 'package.json'),
          JSON.stringify({ name: 'lmdb', version: '3.4.4' }),
        );
        await fsp.writeFile(
          path.join(lmdbPath, 'index.js'),
          'exports.open = () => {};',
        );
        const plan = {
          schemaVersion: 2,
          kind: 'frozenDependencyClosure',
          activity: CORE_RUNTIME_DEPENDENCY_ACTIVITY,
          lock: dependencyLock.input,
          target: buildTarget,
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
        };
        return {
          dependencyLockInput: dependencyLock.input,
          closureDigest: digestFrozenDependencyClosurePlan(plan),
          plan,
        };
      },
    );
    await jest.unstable_mockModule(INSTALL_DEPS_IMPORT, () => ({
      installForTarget,
    }));
    const { default: CoreRuntimeDependenciesResource } = await import(
      CORE_RESOURCE_IMPORT
    );
    const originalBuildDir = CoreRuntimeDependenciesResource.BUILD_DIR;
    CoreRuntimeDependenciesResource.BUILD_DIR = tmpRoot;
    const target = {
      nodeVersion: '24.13.1',
      platform: 'darwin',
      architecture: 'arm64',
    };
    const resource = new CoreRuntimeDependenciesResource({
      name: 'core-runtime-dependencies',
      properties: { buildTarget: target },
    });

    try {
      await resource.reconcile();
      const assets = resource.get('assets');
      const receipt = resource.get('receipt');
      const manifest = JSON.parse(
        await fsp.readFile(
          assets[CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME],
          'utf8',
        ),
      );
      const archive = await fsp.readFile(
        assets[CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME],
      );

      expect(installForTarget).toHaveBeenCalledWith(
        expect.objectContaining({
          activity: CORE_RUNTIME_DEPENDENCY_ACTIVITY,
          buildTarget: target,
          dependencyLock: expect.objectContaining({
            input: {
              format: DEPENDENCY_LOCK_INPUT_FORMAT,
              digest: {
                algorithm: 'sha256',
                value: 'aTLcH6_nhkLpmYgXRHTGIzEhzZKgT4gQ_mE-SOBct4w',
              },
            },
          }),
          externals: [{ name: 'lmdb', version: '3.4.4' }],
        }),
      );
      expect(manifest).toEqual(receipt);
      expect(manifest.target).toEqual(target);
      expect(manifest.archive.digest).toEqual({
        algorithm: 'sha256',
        value: createHash('sha256').update(archive).digest('base64url'),
      });
      expect(resource.get('assetDigests')).toEqual({
        [CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME]: {
          algorithm: 'sha256',
          value: createHash('sha256')
            .update(
              await fsp.readFile(
                assets[CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME],
              ),
            )
            .digest('base64url'),
        },
        [CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME]: manifest.archive.digest,
      });
    } finally {
      await fsp.rm(tmpRoot, { force: true, recursive: true });
      CoreRuntimeDependenciesResource.BUILD_DIR = originalBuildDir;
    }
  });
});
