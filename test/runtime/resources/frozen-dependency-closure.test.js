/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createFrozenDependencyClosurePlan } from '../../../src/core/resources/builds/lib/frozen-dependency-closure.js';
import { sortCanonicalJsonValue } from '../../../src/core/runtime/canonical-order.js';
import { sha256Base64Url } from '../../../src/core/runtime/content-id.js';
import { DEPENDENCY_LOCK_INPUT_FORMAT } from '../../../src/core/runtime/application-revision.js';

const require = createRequire(import.meta.url);
const npmInstallChecksModule = 'npm-install-checks';
const { checkPlatform } = /** @type {{checkPlatform: Function}} */ (
  require(npmInstallChecksModule)
);

const tempDirectories = new Set();
const linuxTarget = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});
const darwinTarget = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'darwin',
  architecture: 'arm64',
});

/** @param {string} seed */
function integrity(seed) {
  return `sha512-${createHash('sha512').update(seed).digest('base64')}`;
}

/**
 * @param {string} name
 * @param {string} version
 * @param {Record<string, any>} [extra]
 */
function registryPackage(name, version, extra = {}) {
  const nameParts = name.split('/');
  const fileName = `${nameParts[nameParts.length - 1]}-${version}.tgz`;
  return {
    version,
    resolved: `https://registry.example.test/${encodeURIComponent(name)}/-/${fileName}`,
    integrity: integrity(`${name}@${version}`),
    ...extra,
  };
}

/**
 * @param {Record<string, any>} rootPackage
 * @param {Record<string, any>} packages
 * @returns {Record<string, any>}
 */
function createLock(rootPackage, packages) {
  return {
    name: 'frozen-closure-fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'frozen-closure-fixture',
        version: '1.0.0',
        ...rootPackage,
      },
      ...packages,
    },
  };
}

/** @param {Record<string, any>} lock */
async function writeLock(lock) {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-frozen-closure-test-'),
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

/**
 * @param {Record<string, any>} lock
 * @param {{ activity?: string, buildTarget?: Record<string, any>, externals?: {name: string, version: string}[] }} [options]
 */
async function plan(lock, options = {}) {
  return await createFrozenDependencyClosurePlan({
    activity: options.activity || 'example',
    buildTarget: options.buildTarget || linuxTarget,
    dependencyLock: await writeLock(lock),
    externals: options.externals || [{ name: 'alpha', version: '1.0.0' }],
  });
}

afterEach(async () => {
  await Promise.all(
    Array.from(tempDirectories, (directory) =>
      fsp.rm(directory, { recursive: true, force: true }),
    ),
  );
  tempDirectories.clear();
});

describe('frozen dependency closure planning', () => {
  it('selects exact physical transitive and peer nodes without unrelated roots', async () => {
    const lock = createLock(
      {
        dependencies: {
          alpha: '1.0.0',
          'peer-lib': '1.0.0',
          shared: '2.0.0',
        },
      },
      {
        'node_modules/alpha': registryPackage('alpha', '1.0.0', {
          dependencies: { shared: '1.0.0' },
          peerDependencies: { 'peer-lib': '1.0.0' },
        }),
        'node_modules/alpha/node_modules/shared': registryPackage(
          'shared',
          '1.0.0',
        ),
        'node_modules/peer-lib': registryPackage('peer-lib', '1.0.0'),
        'node_modules/shared': registryPackage('shared', '2.0.0'),
      },
    );

    const result = await plan(lock);

    expect(result.plan.roots).toEqual([
      {
        name: 'alpha',
        version: '1.0.0',
        location: 'node_modules/alpha',
      },
    ]);
    expect(
      result.plan.packages.map((/** @type {any} */ entry) => entry.location),
    ).toEqual([
      'node_modules/alpha',
      'node_modules/alpha/node_modules/shared',
      'node_modules/peer-lib',
    ]);
    expect(result.plan.packages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: 'node_modules/shared' }),
      ]),
    );
    expect(result.plan.installScripts).toBe('ignored');
    expect(result.plan.binLinks).toBe('not-created');
    expect(result.plan.selectedOptionalFailures).toBe('fatal');
    expect(result.digest).toEqual({
      algorithm: 'sha256',
      value: expect.any(String),
    });
  });

  it('selects only target-compatible optional packages', async () => {
    const lock = createLock(
      { dependencies: { alpha: '1.0.0' } },
      {
        'node_modules/alpha': registryPackage('alpha', '1.0.0', {
          optionalDependencies: {
            'native-darwin': '1.0.0',
            'native-linux': '1.0.0',
          },
        }),
        'node_modules/native-darwin': registryPackage(
          'native-darwin',
          '1.0.0',
          { os: ['darwin'], cpu: ['arm64'] },
        ),
        'node_modules/native-linux': registryPackage('native-linux', '1.0.0', {
          os: ['linux'],
          cpu: ['x64'],
          libc: ['glibc'],
        }),
      },
    );

    const linux = await plan(lock);
    const darwin = await plan(lock, { buildTarget: darwinTarget });

    expect(
      linux.plan.packages.map((/** @type {any} */ entry) => entry.name),
    ).toEqual(['alpha', 'native-linux']);
    expect(
      darwin.plan.packages.map((/** @type {any} */ entry) => entry.name),
    ).toEqual(['alpha', 'native-darwin']);
    expect(linux.digest).not.toEqual(darwin.digest);
  });

  it('accepts npm string constraints and a sole any constraint', async () => {
    const lock = createLock(
      { dependencies: { alpha: '1.0.0' } },
      {
        'node_modules/alpha': registryPackage('alpha', '1.0.0', {
          optionalDependencies: { native: '1.0.0' },
        }),
        'node_modules/native': registryPackage('native', '1.0.0', {
          os: 'any',
          cpu: 'x64',
          libc: 'glibc',
        }),
      },
    );

    const result = await plan(lock);

    expect(
      result.plan.packages.map((/** @type {any} */ entry) => entry.name),
    ).toEqual(['alpha', 'native']);
  });

  it.each([
    ['libc any without a libc target', 'libc', ['any'], darwinTarget],
    ['libc !any without a libc target', 'libc', ['!any'], darwinTarget],
    ['libc !any with glibc', 'libc', ['!any'], linuxTarget],
    ['negative matching libc', 'libc', ['!glibc'], linuxTarget],
    ['mixed any with matching libc', 'libc', ['any', 'glibc'], linuxTarget],
    ['mixed any without matching libc', 'libc', ['any', 'musl'], linuxTarget],
    ['empty libc list with glibc', 'libc', [], linuxTarget],
    ['empty libc list without libc', 'libc', [], darwinTarget],
    ['negated any operating system', 'os', ['!any'], darwinTarget],
    ['mixed positive and negative cpu', 'cpu', ['x64', '!arm64'], linuxTarget],
  ])(
    'matches npm-install-checks for %s',
    async (_label, field, constraints, buildTarget) => {
      const nativeConstraints = { [field]: constraints };
      let expected = true;
      try {
        checkPlatform(nativeConstraints, false, {
          os: buildTarget.platform,
          cpu: buildTarget.architecture,
          ...(buildTarget.platform === 'linux'
            ? { libc: buildTarget.libc }
            : {}),
        });
      } catch (error) {
        if (
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 'EBADPLATFORM'
        ) {
          throw error;
        }
        expected = false;
      }
      const lock = createLock(
        { dependencies: { alpha: '1.0.0' } },
        {
          'node_modules/alpha': registryPackage('alpha', '1.0.0', {
            optionalDependencies: { native: '1.0.0' },
          }),
          'node_modules/native': registryPackage(
            'native',
            '1.0.0',
            nativeConstraints,
          ),
        },
      );

      const result = await plan(lock, { buildTarget });
      expect(
        result.plan.packages.some(
          (/** @type {any} */ entry) => entry.name === 'native',
        ),
      ).toBe(expected);
    },
  );

  it('binds lock-preserved package behavior into the canonical plan', async () => {
    const lock = createLock(
      { dependencies: { alpha: '1.0.0', peer: '1.0.0' } },
      {
        'node_modules/alpha': registryPackage('alpha', '1.0.0', {
          dependencies: { child: '1.0.0' },
          optionalDependencies: { optional: '1.0.0' },
          peerDependencies: { peer: '1.0.0' },
          peerDependenciesMeta: { peer: { optional: true } },
          os: ['linux'],
          cpu: ['x64'],
          libc: ['glibc'],
          engines: { node: '>=24' },
          hasInstallScript: true,
        }),
        'node_modules/child': registryPackage('child', '1.0.0'),
        'node_modules/optional': registryPackage('optional', '1.0.0'),
        'node_modules/peer': registryPackage('peer', '1.0.0'),
      },
    );

    const result = await plan(lock);
    const alpha = result.plan.packages.find(
      (/** @type {any} */ entry) => entry.name === 'alpha',
    );

    expect(alpha.manifestContract).toEqual({
      bundleDependencies: [],
      dependencies: { child: '1.0.0' },
      hasInstallScript: true,
      name: 'alpha',
      optionalDependencies: { optional: '1.0.0' },
      peerDependencies: { peer: '1.0.0' },
      peerDependenciesMeta: { peer: { optional: true } },
      targetConstraints: {
        cpu: ['x64'],
        libc: ['glibc'],
        node: '>=24',
        os: ['linux'],
      },
      version: '1.0.0',
    });
  });

  it('fails when a required transitive edge is absent from the lock', async () => {
    const lock = createLock(
      { dependencies: { alpha: '1.0.0' } },
      {
        'node_modules/alpha': registryPackage('alpha', '1.0.0', {
          dependencies: { missing: '1.0.0' },
        }),
      },
    );

    await expect(plan(lock)).rejects.toThrow(
      "missing prod dependency 'missing'",
    );
  });

  it('fails when an applicable optional edge is absent from the lock', async () => {
    const lock = createLock(
      { dependencies: { alpha: '1.0.0' } },
      {
        'node_modules/alpha': registryPackage('alpha', '1.0.0', {
          optionalDependencies: { 'native-linux': '1.0.0' },
        }),
      },
    );

    await expect(plan(lock)).rejects.toThrow(
      "missing optional dependency 'native-linux'",
    );
  });

  it('permits an absent explicitly optional peer', async () => {
    const lock = createLock(
      { dependencies: { alpha: '1.0.0' } },
      {
        'node_modules/alpha': registryPackage('alpha', '1.0.0', {
          peerDependencies: { adapter: '1.0.0' },
          peerDependenciesMeta: { adapter: { optional: true } },
        }),
      },
    );

    const result = await plan(lock);

    expect(result.plan.packages).toEqual([
      expect.objectContaining({
        name: 'alpha',
        edges: [
          {
            name: 'adapter',
            type: 'peerOptional',
            spec: '1.0.0',
            location: null,
          },
        ],
      }),
    ]);
  });

  it('rejects a required package that is incompatible with the target', async () => {
    const lock = createLock(
      { dependencies: { alpha: '1.0.0' } },
      {
        'node_modules/alpha': registryPackage('alpha', '1.0.0', {
          dependencies: { 'linux-only': '1.0.0' },
        }),
        'node_modules/linux-only': registryPackage('linux-only', '1.0.0', {
          os: ['linux'],
          cpu: ['x64'],
        }),
      },
    );

    await expect(plan(lock, { buildTarget: darwinTarget })).rejects.toThrow(
      "requires 'linux-only', which does not support target darwin/arm64",
    );
  });

  it('fails a selected optional branch whose required child is incompatible', async () => {
    const lock = createLock(
      { dependencies: { alpha: '1.0.0' } },
      {
        'node_modules/alpha': registryPackage('alpha', '1.0.0', {
          optionalDependencies: { native: '1.0.0' },
        }),
        'node_modules/native': registryPackage('native', '1.0.0', {
          os: ['linux'],
          cpu: ['x64'],
          dependencies: { 'darwin-child': '1.0.0' },
        }),
        'node_modules/darwin-child': registryPackage('darwin-child', '1.0.0', {
          os: ['darwin'],
          cpu: ['arm64'],
        }),
      },
    );

    await expect(plan(lock)).rejects.toThrow(
      "requires 'darwin-child', which does not support target linux/x64",
    );
  });

  it('rejects a package whose Node engine excludes the exact target runtime', async () => {
    const lock = createLock(
      { dependencies: { alpha: '1.0.0' } },
      {
        'node_modules/alpha': registryPackage('alpha', '1.0.0', {
          engines: { node: '<24' },
        }),
      },
    );

    await expect(plan(lock)).rejects.toThrow(
      "External 'alpha' does not support target linux/x64",
    );
  });

  it('rejects externals that are only development dependencies', async () => {
    const lock = createLock(
      { devDependencies: { alpha: '1.0.0' } },
      {
        'node_modules/alpha': registryPackage('alpha', '1.0.0', { dev: true }),
      },
    );

    await expect(plan(lock)).rejects.toThrow(
      'must be a root production or optional dependency',
    );
  });

  it.each([
    [
      'missing integrity',
      { integrity: undefined },
      'must be a sha512 SRI string',
    ],
    [
      'mutable locator',
      { resolved: 'file:../alpha' },
      'must be a credential-free canonical HTTPS URL',
    ],
    [
      'query-bearing locator',
      { resolved: 'https://registry.example.test/alpha.tgz?token=secret' },
      'must be a credential-free canonical HTTPS URL',
    ],
    [
      'bundled dependency',
      { bundleDependencies: ['inside'] },
      'contains bundled dependencies',
    ],
    [
      'malformed dependency map',
      { dependencies: ['not-a-map'] },
      'dependencies must be an object',
    ],
    [
      'peer metadata for an undeclared peer',
      { peerDependenciesMeta: { ghost: { optional: true } } },
      'must name a declared peer dependency',
    ],
    [
      'unsupported peer metadata',
      {
        peerDependencies: { peer: '1.0.0' },
        peerDependenciesMeta: { peer: { optional: true, injected: true } },
      },
      "supports only the 'optional' property",
    ],
    [
      'malformed Node engine',
      { engines: { node: 24 } },
      'engines.node must be a canonical semantic-version range',
    ],
    [
      'malformed install-script marker',
      { hasInstallScript: 'yes' },
      'hasInstallScript must be a boolean',
    ],
    [
      'duplicate target constraint',
      { os: ['linux', 'linux'] },
      'must not contain duplicates',
    ],
  ])('rejects a root with %s', async (_label, overrides, message) => {
    const alpha = registryPackage('alpha', '1.0.0');
    Object.assign(alpha, overrides);
    const lock = createLock(
      { dependencies: { alpha: '1.0.0' } },
      { 'node_modules/alpha': alpha },
    );

    await expect(plan(lock)).rejects.toThrow(message);
  });

  it('rejects a lock whose bytes no longer match the revision digest', async () => {
    const original = createLock(
      { dependencies: { alpha: '1.0.0' } },
      { 'node_modules/alpha': registryPackage('alpha', '1.0.0') },
    );
    const dependencyLock = await writeLock(original);
    const changed = structuredClone(original);
    changed.packages['node_modules/alpha'].integrity = integrity('changed');
    await fsp.writeFile(
      dependencyLock.path,
      JSON.stringify(changed, null, 2),
      'utf8',
    );

    await expect(
      createFrozenDependencyClosurePlan({
        activity: 'example',
        buildTarget: linuxTarget,
        dependencyLock,
        externals: [{ name: 'alpha', version: '1.0.0' }],
      }),
    ).rejects.toThrow('does not match the owning application revision');
  });

  it('changes the closure digest when locked package integrity changes', async () => {
    const firstLock = createLock(
      { dependencies: { alpha: '1.0.0' } },
      { 'node_modules/alpha': registryPackage('alpha', '1.0.0') },
    );
    const secondLock = structuredClone(firstLock);
    secondLock.packages['node_modules/alpha'].integrity =
      integrity('different bytes');

    const first = await plan(firstLock);
    const second = await plan(secondLock);

    expect(first.digest).not.toEqual(second.digest);
    expect(first.plan.lock.digest).not.toEqual(second.plan.lock.digest);
  });
});
