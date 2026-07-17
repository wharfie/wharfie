/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buffer as streamToBuffer } from 'node:stream/consumers';
import { c } from 'tar';

import paths from '../../../src/core/lib/paths.js';
import sandboxWorker from '../../../src/core/lib/code-execution/worker.js';

const VM_PATH = path.join(paths.temp, 'vms');
const TEST_PACKAGE = 'wharfie-worker-cache-boundary';
const TEST_TIMEOUT_MS = 15_000;
/** @type {Set<string>} */
const testPaths = new Set();

function makeName(/** @type {string} */ prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function getBundleKey(
  /** @type {string} */ name,
  /** @type {string} */ codeString,
  /** @type {string} */ externalBundleDigest,
) {
  const activityKey = createHash('sha256')
    .update('wharfie-activity-v1\0')
    .update(name)
    .update('\0')
    .update(codeString)
    .digest('hex');
  return createHash('sha256')
    .update('wharfie-sandbox-v1\0')
    .update(activityKey)
    .update('\0')
    .update(externalBundleDigest)
    .digest('hex');
}

async function createExternalArchive(
  /** @type {string} */ identity,
  /** @type {{symbolicLink?: boolean}} */ options = {},
) {
  const root = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-worker-cache-archive-'),
  );
  const packageRoot = path.join(root, 'node_modules', TEST_PACKAGE);

  try {
    await fsp.mkdir(packageRoot, { recursive: true });
    await fsp.writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: TEST_PACKAGE,
        version: '1.0.0',
        main: 'index.js',
      }),
    );
    await fsp.writeFile(
      path.join(packageRoot, 'index.js'),
      `exports.identity = ${JSON.stringify(identity)};\n`,
    );
    if (options.symbolicLink === true) {
      await fsp.symlink('index.js', path.join(packageRoot, 'identity-link.js'));
    }

    return await streamToBuffer(
      c(
        {
          cwd: root,
          gzip: true,
          noMtime: true,
          portable: true,
        },
        ['node_modules'],
      ),
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

afterEach(async () => {
  await sandboxWorker._destroyWorker();
  await sandboxWorker._clearSandboxCache();
  await Promise.all(
    [...testPaths].map((testPath) =>
      fsp.rm(testPath, { recursive: true, force: true }),
    ),
  );
  testPaths.clear();
});

describe('worker sandbox cache security', () => {
  it(
    'ignores a preexisting deterministic cache and shares one fresh private root concurrently',
    async () => {
      const name = makeName('preexisting-cache');
      const archive = await createExternalArchive('sealed-archive');
      const externalBundleDigest =
        sandboxWorker.getExternalBundleDigest(archive);
      const codeString = `
        const cacheBoundaryIdentity = require(${JSON.stringify(TEST_PACKAGE)});
        global[Symbol.for(${JSON.stringify(name)})] = async () => ({
          identity: cacheBoundaryIdentity.identity,
          root: process.cwd(),
        });
      `;
      const key = getBundleKey(name, codeString, externalBundleDigest);
      const deterministicRoot = path.join(VM_PATH, key);
      const tamperedPackageRoot = path.join(
        deterministicRoot,
        'node_modules',
        TEST_PACKAGE,
      );
      testPaths.add(deterministicRoot);
      await fsp.mkdir(tamperedPackageRoot, { recursive: true, mode: 0o700 });
      await fsp.writeFile(
        path.join(tamperedPackageRoot, 'package.json'),
        JSON.stringify({
          name: TEST_PACKAGE,
          version: '9.9.9',
          main: 'index.js',
        }),
      );
      await fsp.writeFile(
        path.join(tamperedPackageRoot, 'index.js'),
        "exports.identity = 'tampered-preexisting-cache';\n",
      );

      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          sandboxWorker.runInSandbox(name, codeString, [], {
            externalsTar: archive,
            externalBundleDigest,
          }),
        ),
      );
      const roots = new Set(results.map((result) => result.root));

      expect(results.map((result) => result.identity)).toEqual([
        'sealed-archive',
        'sealed-archive',
        'sealed-archive',
        'sealed-archive',
      ]);
      expect(roots).toHaveProperty('size', 1);
      const [freshRoot] = roots;
      expect(freshRoot).not.toBe(deterministicRoot);
      expect(path.dirname(freshRoot)).toBe(VM_PATH);
      expect(path.basename(freshRoot)).toMatch(new RegExp(`^${key}-`));
      expect((await fsp.lstat(freshRoot)).mode & 0o777).toBe(0o700);

      await sandboxWorker._destroyWorker(
        name,
        codeString,
        externalBundleDigest,
      );
      await expect(fsp.lstat(freshRoot)).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(
        fsp.readFile(path.join(tamperedPackageRoot, 'index.js'), 'utf8'),
      ).resolves.toContain('tampered-preexisting-cache');
    },
    TEST_TIMEOUT_MS,
  );

  it('removes roots on cache clear and prepares a different root afterward', async () => {
    const name = makeName('cache-clear');
    const codeString = `
      global[Symbol.for(${JSON.stringify(name)})] = async () => process.cwd();
    `;

    const firstRoot = await sandboxWorker.runInSandbox(name, codeString, []);
    await sandboxWorker._clearSandboxCache();
    await expect(fsp.lstat(firstRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const secondRoot = await sandboxWorker.runInSandbox(name, codeString, []);
    expect(secondRoot).not.toBe(firstRoot);
    await sandboxWorker._clearSandboxCache();
    await expect(fsp.lstat(secondRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects symbolic links from an external archive and removes the failed root', async () => {
    const name = makeName('archive-symlink');
    const archive = await createExternalArchive('linked', {
      symbolicLink: true,
    });
    const externalBundleDigest = sandboxWorker.getExternalBundleDigest(archive);
    const codeString = `
      global[Symbol.for(${JSON.stringify(name)})] = async () => 'unreachable';
    `;
    const key = getBundleKey(name, codeString, externalBundleDigest);
    await fsp.mkdir(VM_PATH, { recursive: true });
    const before = new Set(await fsp.readdir(VM_PATH));

    await expect(
      sandboxWorker.runInSandbox(name, codeString, [], {
        externalsTar: archive,
        externalBundleDigest,
      }),
    ).rejects.toThrow(/unsupported entry type|symbolic link/i);

    const leakedRoots = (await fsp.readdir(VM_PATH)).filter(
      (entry) => entry.startsWith(`${key}-`) && !before.has(entry),
    );
    expect(leakedRoots).toEqual([]);
  });
});
