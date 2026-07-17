/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create as createTar } from 'tar';

import { DEPENDENCY_LOCK_INPUT_FORMAT } from '../../../src/core/runtime/application-revision.js';
import { sortCanonicalJsonValue } from '../../../src/core/runtime/canonical-order.js';
import { sha256Base64Url } from '../../../src/core/runtime/content-id.js';

const INSTALL_DEPS_IMPORT =
  '../../../src/core/resources/builds/lib/install-deps.js';
const tempDirectories = new Set();
const target = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});

/** @param {string} seed */
function integrity(seed) {
  return `sha512-${createHash('sha512').update(seed).digest('base64')}`;
}

/**
 * @param {string} name
 * @param {string} version
 * @param {Record<string, any>} [extra]
 * @returns {Record<string, any>}
 */
function registryPackage(name, version, extra = {}) {
  const nameParts = name.split('/');
  return {
    version,
    resolved: `https://registry.example.test/${encodeURIComponent(name)}/-/${nameParts[nameParts.length - 1]}-${version}.tgz`,
    integrity: integrity(`${name}@${version}`),
    ...extra,
  };
}

/**
 * @param {Record<string, any>} root
 * @param {Record<string, any>} packages
 * @returns {Record<string, any>}
 */
function createLock(root, packages) {
  return {
    name: 'install-fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'install-fixture', version: '1.0.0', ...root },
      ...packages,
    },
  };
}

/** @param {Record<string, any>} lock */
async function createLockHandle(lock) {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-install-lock-'),
  );
  tempDirectories.add(directory);
  const lockPath = path.join(directory, 'package-lock.json');
  await fsp.writeFile(lockPath, JSON.stringify(lock, null, 2), 'utf8');
  return {
    path: lockPath,
    input: {
      format: DEPENDENCY_LOCK_INPUT_FORMAT,
      digest: {
        algorithm: 'sha256',
        value: sha256Base64Url(JSON.stringify(sortCanonicalJsonValue(lock))),
      },
    },
  };
}

async function createBuildDirectory() {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-install-target-'),
  );
  tempDirectories.add(directory);
  return directory;
}

/**
 * @param {Record<string, any>} lock
 * @param {(entry: Record<string, any>, packageDirectory: string) => Promise<void>} [onTarball]
 */
async function loadInstaller(lock, onTarball) {
  const byResolved = new Map(
    Object.entries(lock.packages)
      .filter(([location]) => location !== '')
      .map(([location, entry]) => [
        entry.resolved,
        {
          ...entry,
          name: location.split('node_modules/').slice(-1)[0],
        },
      ]),
  );
  const manifest = jest.fn(() => {
    throw new Error('Mutable manifest resolution must not run.');
  });
  /**
   * @param {string} resolved
   * @param {Record<string, any>} options
   */
  async function tarballImpl(resolved, options) {
    const entry = byResolved.get(resolved);
    if (!entry) throw new Error(`Unexpected locked URL ${resolved}`);
    expect(options.integrity).toBe(entry.integrity);
    const archiveDirectory = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-install-archive-'),
    );
    tempDirectories.add(archiveDirectory);
    const packageDirectory = path.join(archiveDirectory, 'package');
    await fsp.mkdir(packageDirectory, { recursive: true });
    const packageManifest = {
      name: entry.name,
      version: entry.version,
      ...Object.fromEntries(
        [
          'dependencies',
          'optionalDependencies',
          'peerDependencies',
          'peerDependenciesMeta',
          'os',
          'cpu',
          'libc',
          'engines',
          'bundleDependencies',
          'bundledDependencies',
        ]
          .filter((key) => entry[key] !== undefined)
          .map((key) => [key, structuredClone(entry[key])]),
      ),
      ...(entry.hasInstallScript === true
        ? { scripts: { install: 'ignored-by-wharfie' } }
        : {}),
    };
    await fsp.writeFile(
      path.join(packageDirectory, 'package.json'),
      JSON.stringify(packageManifest),
      'utf8',
    );
    await fsp.writeFile(
      path.join(packageDirectory, 'index.js'),
      'module.exports=1',
    );
    if (onTarball) await onTarball(entry, packageDirectory);
    const chunks = [];
    for await (const chunk of createTar(
      { cwd: archiveDirectory, gzip: true, portable: true },
      ['package'],
    )) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  const tarball = jest.fn(tarballImpl);
  await jest.unstable_mockModule('pacote', () => ({
    default: { tarball, manifest },
  }));
  const { installForTarget } = await import(INSTALL_DEPS_IMPORT);
  return { installForTarget, tarball, manifest };
}

afterEach(async () => {
  jest.restoreAllMocks();
  jest.resetModules();
  await Promise.all(
    Array.from(tempDirectories, (directory) =>
      fsp.rm(directory, { recursive: true, force: true }),
    ),
  );
  tempDirectories.clear();
});

describe('installForTarget', () => {
  it('extracts only locked URLs with locked integrity at exact physical paths', async () => {
    const lock = createLock(
      { dependencies: { alpha: '1.0.0' } },
      {
        'node_modules/alpha': registryPackage('alpha', '1.0.0', {
          dependencies: { child: '^1.0.0' },
        }),
        'node_modules/child': registryPackage('child', '1.0.1'),
      },
    );
    const { installForTarget, tarball, manifest } = await loadInstaller(lock);
    const buildDirectory = await createBuildDirectory();
    const dependencyLock = await createLockHandle(lock);

    const receipt = await installForTarget({
      activity: 'example',
      buildTarget: target,
      dependencyLock,
      externals: [{ name: 'alpha', version: '1.0.0' }],
      tmpBuildDir: buildDirectory,
    });

    expect(manifest).not.toHaveBeenCalled();
    expect(tarball).toHaveBeenCalledTimes(2);
    expect(tarball.mock.calls.map((call) => call[0])).toEqual([
      lock.packages['node_modules/alpha'].resolved,
      lock.packages['node_modules/child'].resolved,
    ]);
    expect(
      await fsp.readFile(
        path.join(buildDirectory, 'node_modules', 'child', 'package.json'),
        'utf8',
      ),
    ).toContain('1.0.1');
    expect(receipt).toEqual(
      expect.objectContaining({
        dependencyLockInput: dependencyLock.input,
        closureDigest: { algorithm: 'sha256', value: expect.any(String) },
      }),
    );
    expect(existsSync(path.join(buildDirectory, 'package-lock.json'))).toBe(
      false,
    );
    expect(existsSync(path.join(buildDirectory, '.npmrc'))).toBe(false);
  });

  it('preserves simultaneous nested versions from the physical lock layout', async () => {
    const lock = createLock(
      { dependencies: { alpha: '1.0.0', beta: '1.0.0' } },
      {
        'node_modules/alpha': registryPackage('alpha', '1.0.0', {
          dependencies: { shared: '1.0.0' },
        }),
        'node_modules/alpha/node_modules/shared': registryPackage(
          'shared',
          '1.0.0',
        ),
        'node_modules/beta': registryPackage('beta', '1.0.0', {
          dependencies: { shared: '2.0.0' },
        }),
        'node_modules/shared': registryPackage('shared', '2.0.0'),
      },
    );
    const { installForTarget } = await loadInstaller(lock);
    const buildDirectory = await createBuildDirectory();

    await installForTarget({
      activity: 'nested',
      buildTarget: target,
      dependencyLock: await createLockHandle(lock),
      externals: [
        { name: 'alpha', version: '1.0.0' },
        { name: 'beta', version: '1.0.0' },
      ],
      tmpBuildDir: buildDirectory,
    });

    await expect(
      fsp.readFile(
        path.join(
          buildDirectory,
          'node_modules',
          'alpha',
          'node_modules',
          'shared',
          'package.json',
        ),
        'utf8',
      ),
    ).resolves.toContain('1.0.0');
    await expect(
      fsp.readFile(
        path.join(buildDirectory, 'node_modules', 'shared', 'package.json'),
        'utf8',
      ),
    ).resolves.toContain('2.0.0');
  });

  it('fails rather than falling back when exact extraction rejects locked bytes', async () => {
    const lock = createLock(
      { dependencies: { alpha: '1.0.0' } },
      { 'node_modules/alpha': registryPackage('alpha', '1.0.0') },
    );
    const { installForTarget, tarball, manifest } = await loadInstaller(
      lock,
      async () => {
        throw new Error('integrity mismatch');
      },
    );

    await expect(
      installForTarget({
        activity: 'example',
        buildTarget: target,
        dependencyLock: await createLockHandle(lock),
        externals: [{ name: 'alpha', version: '1.0.0' }],
        tmpBuildDir: await createBuildDirectory(),
      }),
    ).rejects.toThrow('integrity mismatch');
    expect(tarball).toHaveBeenCalledTimes(1);
    expect(manifest).not.toHaveBeenCalled();
  });

  it('rejects an extracted package with the wrong identity', async () => {
    const lock = createLock(
      { dependencies: { alpha: '1.0.0' } },
      { 'node_modules/alpha': registryPackage('alpha', '1.0.0') },
    );
    const { installForTarget } = await loadInstaller(
      lock,
      async (_entry, destination) => {
        await fsp.writeFile(
          path.join(destination, 'package.json'),
          JSON.stringify({ name: 'alpha', version: '9.9.9' }),
          'utf8',
        );
      },
    );

    await expect(
      installForTarget({
        activity: 'example',
        buildTarget: target,
        dependencyLock: await createLockHandle(lock),
        externals: [{ name: 'alpha', version: '1.0.0' }],
        tmpBuildDir: await createBuildDirectory(),
      }),
    ).rejects.toThrow('must identify alpha@1.0.0');
  });

  it.each([
    {
      label: 'dependencies',
      root: { dependencies: { alpha: '1.0.0' } },
      alpha: { dependencies: { child: '1.0.0' } },
      packages: { child: registryPackage('child', '1.0.0') },
      mutate: (/** @type {Record<string, any>} */ manifest) => {
        manifest.dependencies.child = '2.0.0';
      },
    },
    {
      label: 'optionalDependencies',
      root: { dependencies: { alpha: '1.0.0' } },
      alpha: { optionalDependencies: { child: '1.0.0' } },
      packages: { child: registryPackage('child', '1.0.0') },
      mutate: (/** @type {Record<string, any>} */ manifest) => {
        manifest.optionalDependencies.child = '2.0.0';
      },
    },
    {
      label: 'peerDependencies',
      root: { dependencies: { alpha: '1.0.0', child: '1.0.0' } },
      alpha: { peerDependencies: { child: '1.0.0' } },
      packages: { child: registryPackage('child', '1.0.0') },
      mutate: (/** @type {Record<string, any>} */ manifest) => {
        manifest.peerDependencies.child = '2.0.0';
      },
    },
    {
      label: 'peerDependenciesMeta',
      root: { dependencies: { alpha: '1.0.0', child: '1.0.0' } },
      alpha: {
        peerDependencies: { child: '1.0.0' },
        peerDependenciesMeta: { child: { optional: true } },
      },
      packages: { child: registryPackage('child', '1.0.0') },
      mutate: (/** @type {Record<string, any>} */ manifest) => {
        manifest.peerDependenciesMeta.child.optional = false;
      },
    },
    {
      label: 'os',
      root: { dependencies: { alpha: '1.0.0' } },
      alpha: { os: ['linux'] },
      packages: {},
      mutate: (/** @type {Record<string, any>} */ manifest) => {
        manifest.os = ['darwin'];
      },
    },
    {
      label: 'cpu',
      root: { dependencies: { alpha: '1.0.0' } },
      alpha: { cpu: ['x64'] },
      packages: {},
      mutate: (/** @type {Record<string, any>} */ manifest) => {
        manifest.cpu = ['arm64'];
      },
    },
    {
      label: 'libc',
      root: { dependencies: { alpha: '1.0.0' } },
      alpha: { libc: ['glibc'] },
      packages: {},
      mutate: (/** @type {Record<string, any>} */ manifest) => {
        manifest.libc = ['musl'];
      },
    },
    {
      label: 'engines.node',
      root: { dependencies: { alpha: '1.0.0' } },
      alpha: { engines: { node: '>=24' } },
      packages: {},
      mutate: (/** @type {Record<string, any>} */ manifest) => {
        manifest.engines.node = '>=25';
      },
    },
    {
      label: 'bundle metadata',
      root: { dependencies: { alpha: '1.0.0' } },
      alpha: {},
      packages: {},
      mutate: (/** @type {Record<string, any>} */ manifest) => {
        manifest.bundleDependencies = ['hidden'];
      },
    },
    {
      label: 'lifecycle install-script presence',
      root: { dependencies: { alpha: '1.0.0' } },
      alpha: { hasInstallScript: true },
      packages: {},
      mutate: (/** @type {Record<string, any>} */ manifest) => {
        delete manifest.scripts;
      },
    },
  ])('rejects extracted package.json drift in $label', async (fixture) => {
    const packageEntries = Object.fromEntries(
      Object.entries(fixture.packages).map(([name, entry]) => [
        `node_modules/${name}`,
        entry,
      ]),
    );
    const lock = createLock(fixture.root, {
      'node_modules/alpha': registryPackage('alpha', '1.0.0', fixture.alpha),
      ...packageEntries,
    });
    const { installForTarget } = await loadInstaller(
      lock,
      async (entry, packageDirectory) => {
        if (entry.name !== 'alpha') return;
        const manifestPath = path.join(packageDirectory, 'package.json');
        const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
        fixture.mutate(manifest);
        await fsp.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
      },
    );

    await expect(
      installForTarget({
        activity: 'manifest-contract',
        buildTarget: target,
        dependencyLock: await createLockHandle(lock),
        externals: [{ name: 'alpha', version: '1.0.0' }],
        tmpBuildDir: await createBuildDirectory(),
      }),
    ).rejects.toThrow(/sealed lock manifest contract|bundled dependencies/);
  });

  it('rejects an unplanned embedded physical package root', async () => {
    const lock = createLock(
      { dependencies: { alpha: '1.0.0' } },
      { 'node_modules/alpha': registryPackage('alpha', '1.0.0') },
    );
    const { installForTarget } = await loadInstaller(
      lock,
      async (_entry, destination) => {
        const roguePackage = path.join(
          destination,
          'lib',
          'node_modules',
          'rogue',
        );
        await fsp.mkdir(roguePackage, { recursive: true });
        await fsp.writeFile(
          path.join(roguePackage, 'package.json'),
          JSON.stringify({ name: 'rogue', version: '1.0.0' }),
          'utf8',
        );
      },
    );

    await expect(
      installForTarget({
        activity: 'example',
        buildTarget: target,
        dependencyLock: await createLockHandle(lock),
        externals: [{ name: 'alpha', version: '1.0.0' }],
        tmpBuildDir: await createBuildDirectory(),
      }),
    ).rejects.toThrow('embedded node_modules tree');
  });

  it('rejects a parent tar that pre-populates a separately planned nested package', async () => {
    const lock = createLock(
      { dependencies: { alpha: '1.0.0' } },
      {
        'node_modules/alpha': registryPackage('alpha', '1.0.0', {
          dependencies: { child: '1.0.0' },
        }),
        'node_modules/alpha/node_modules/child': registryPackage(
          'child',
          '1.0.0',
        ),
      },
    );
    const { installForTarget } = await loadInstaller(
      lock,
      async (entry, packageDirectory) => {
        if (entry.name !== 'alpha') return;
        const injectedChild = path.join(
          packageDirectory,
          'node_modules',
          'child',
        );
        await fsp.mkdir(injectedChild, { recursive: true });
        await fsp.writeFile(
          path.join(injectedChild, 'rogue.js'),
          'module.exports = "unplanned";',
        );
      },
    );

    await expect(
      installForTarget({
        activity: 'nested-merge',
        buildTarget: target,
        dependencyLock: await createLockHandle(lock),
        externals: [{ name: 'alpha', version: '1.0.0' }],
        tmpBuildDir: await createBuildDirectory(),
      }),
    ).rejects.toThrow('embedded node_modules tree');
  });

  it.each([
    {
      label: 'symbolic link',
      type: 'SymbolicLink',
      create: async (/** @type {string} */ packageDirectory) => {
        await fsp.symlink('index.js', path.join(packageDirectory, 'linked.js'));
      },
    },
    {
      label: 'hard link',
      type: 'Link',
      create: async (/** @type {string} */ packageDirectory) => {
        await fsp.link(
          path.join(packageDirectory, 'index.js'),
          path.join(packageDirectory, 'linked.js'),
        );
      },
    },
  ])('rejects a tar $label before materialization', async (fixture) => {
    const lock = createLock(
      { dependencies: { alpha: '1.0.0' } },
      { 'node_modules/alpha': registryPackage('alpha', '1.0.0') },
    );
    const { installForTarget } = await loadInstaller(
      lock,
      async (_entry, packageDirectory) => {
        await fixture.create(packageDirectory);
      },
    );
    const buildDirectory = await createBuildDirectory();

    await expect(
      installForTarget({
        activity: 'example',
        buildTarget: target,
        dependencyLock: await createLockHandle(lock),
        externals: [{ name: 'alpha', version: '1.0.0' }],
        tmpBuildDir: buildDirectory,
      }),
    ).rejects.toThrow(`unsupported ${fixture.type}`);
    expect(existsSync(path.join(buildDirectory, 'node_modules', 'alpha'))).toBe(
      false,
    );
  });

  it('does no lock or network work when an activity has no externals', async () => {
    const lock = createLock({}, {});
    const { installForTarget, tarball, manifest } = await loadInstaller(lock);

    await expect(
      installForTarget({
        activity: 'plain',
        buildTarget: target,
        dependencyLock: undefined,
        externals: [],
        tmpBuildDir: await createBuildDirectory(),
      }),
    ).resolves.toBeNull();
    expect(tarball).not.toHaveBeenCalled();
    expect(manifest).not.toHaveBeenCalled();
  });
});
