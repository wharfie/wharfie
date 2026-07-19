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
import { getActivityAttemptProtocolSymbol } from '../../../src/core/runtime/activity-attempt.js';
import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
} from '../../../src/core/runtime/activity-protocol.js';

const VM_PATH = path.join(paths.temp, 'vms');
const TEST_PACKAGE = 'wharfie-worker-cache-boundary';
const TEST_TIMEOUT_MS = 15_000;
/** @type {Set<string>} */
const testPaths = new Set();

function makeName(/** @type {string} */ prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function startFrame(
  /** @type {string} */ activityId,
  /** @type {string} */ attemptId,
) {
  return {
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
    type: 'start',
    revisionId: `wrv1_${'A'.repeat(43)}`,
    activityId,
    runId: `run-${attemptId}`,
    invocationId: `invocation-${attemptId}`,
    attemptId,
    fencingToken: `fence-${attemptId}`,
    input: {},
    caller: { metadata: {} },
  };
}

function protocolBundle(
  /** @type {string} */ activityId,
  /** @type {string} */ resultExpression,
) {
  const entrypointSymbol = getActivityAttemptProtocolSymbol(activityId);
  return {
    entrypointSymbol,
    codeString: `
      globalThis[Symbol.for(${JSON.stringify(entrypointSymbol)})] =
        async ({ startFrame, transport }) => {
          await transport.onComponentFrame({
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'completed',
            attemptId: startFrame.attemptId,
            sequence: 1,
            result: ${resultExpression},
          });
        };
    `,
  };
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
    'ignores a preexisting deterministic cache and gives concurrent attempts fresh private roots',
    async () => {
      const name = makeName('preexisting-cache');
      const archive = await createExternalArchive('sealed-archive');
      const externalBundleDigest =
        sandboxWorker.getExternalBundleDigest(archive);
      const { codeString, entrypointSymbol } = protocolBundle(
        name,
        `({
          identity: require(${JSON.stringify(TEST_PACKAGE)}).identity,
          root: process.cwd(),
          mode: require('node:fs').statSync(process.cwd()).mode & 0o777,
        })`,
      );
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
        Array.from({ length: 4 }, (_, index) =>
          sandboxWorker.runActivityAttemptInSandbox(
            name,
            codeString,
            startFrame(name, `attempt-${index}`),
            {
              externalsTar: archive,
              externalBundleDigest,
              entrypointSymbol,
            },
          ),
        ),
      );
      const resultValues = results.map((result) => result.terminal.result);
      const roots = new Set(resultValues.map((result) => result.root));

      expect(resultValues.map((result) => result.identity)).toEqual([
        'sealed-archive',
        'sealed-archive',
        'sealed-archive',
        'sealed-archive',
      ]);
      expect(roots).toHaveProperty('size', 4);
      expect(resultValues.map((result) => result.mode)).toEqual([
        0o700, 0o700, 0o700, 0o700,
      ]);
      for (const freshRoot of roots) {
        expect(freshRoot).not.toBe(deterministicRoot);
        expect(path.dirname(freshRoot)).toBe(VM_PATH);
        await expect(fsp.lstat(freshRoot)).rejects.toMatchObject({
          code: 'ENOENT',
        });
      }
      await expect(
        fsp.readFile(path.join(tamperedPackageRoot, 'index.js'), 'utf8'),
      ).resolves.toContain('tampered-preexisting-cache');
    },
    TEST_TIMEOUT_MS,
  );

  it('removes each one-shot root and prepares a different root afterward', async () => {
    const name = makeName('cache-clear');
    const { codeString, entrypointSymbol } = protocolBundle(
      name,
      '({ root: process.cwd() })',
    );

    const first = await sandboxWorker.runActivityAttemptInSandbox(
      name,
      codeString,
      startFrame(name, 'attempt-first'),
      { entrypointSymbol },
    );
    const firstRoot = first.terminal.result.root;
    await expect(fsp.lstat(firstRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const second = await sandboxWorker.runActivityAttemptInSandbox(
      name,
      codeString,
      startFrame(name, 'attempt-second'),
      { entrypointSymbol },
    );
    const secondRoot = second.terminal.result.root;
    expect(secondRoot).not.toBe(firstRoot);
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
    const { codeString, entrypointSymbol } = protocolBundle(
      name,
      "'unreachable'",
    );
    const before = sandboxWorker._getOwnedSandboxRoots();

    await expect(
      sandboxWorker.runActivityAttemptInSandbox(
        name,
        codeString,
        startFrame(name, 'attempt-symlink'),
        {
          externalsTar: archive,
          externalBundleDigest,
          entrypointSymbol,
        },
      ),
    ).rejects.toThrow(/unsupported entry type|symbolic link/i);

    expect(sandboxWorker._getOwnedSandboxRoots()).toEqual(before);
  });
});
