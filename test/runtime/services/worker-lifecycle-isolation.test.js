/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buffer as streamToBuffer } from 'node:stream/consumers';
import { brotliCompressSync } from 'node:zlib';
import { c } from 'tar';

import { DEPENDENCY_LOCK_INPUT_FORMAT } from '../../../src/core/runtime/application-revision.js';
import { sortCanonicalJsonValue } from '../../../src/core/runtime/canonical-order.js';
import { FUNCTION_ASSET_SCHEMA_VERSION } from '../../../src/core/resources/builds/lib/function-asset.js';

const NODE_SEA_IMPORT = '../../../src/core/lib/node-sea.js';
const FUNCTION_IMPORT = '../../../src/core/resources/builds/function.js';
const WORKER_IMPORT = '../../../src/core/lib/code-execution/worker.js';
const TEST_TIMEOUT_MS = 15_000;

/** @type {Map<string, any>} */
const seaAssets = new Map();

jest.unstable_mockModule(NODE_SEA_IMPORT, () => ({
  getAsset: async (/** @type {string} */ name) => {
    const asset = seaAssets.get(name);
    if (!asset) {
      throw new Error(`Unexpected asset request: ${name}`);
    }
    return Buffer.from(JSON.stringify(sortCanonicalJsonValue(asset)), 'utf8');
  },
  isSea: () => true,
}));

/**
 * @param {string} prefix
 * @returns {string}
 */
function makeName(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** @param {string | Buffer} value */
function digest(value) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/**
 * @param {string} name
 * @param {string} label
 * @returns {{schemaVersion: 3, activity: string, target: {nodeVersion: string, platform: NodeJS.Platform, architecture: string, libc?: string}, externals: never[], codeBundle: string, externalsTar: string, externalDependencyReceipt: null, resourceSpecs: Record<string, any>}}
 */
function createFunctionAsset(name, label) {
  const codeString = `
    global[Symbol.for(${JSON.stringify(name)})] = async (event, context) => {
      const identity = await context.resources.identity.read();
      await new Promise((resolve) => setTimeout(resolve, event.delay));
      return { activity: ${JSON.stringify(label)}, identity, value: event.value };
    };
  `;

  return {
    schemaVersion: FUNCTION_ASSET_SCHEMA_VERSION,
    activity: name,
    target: {
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
      ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
    },
    externals: [],
    codeBundle: brotliCompressSync(Buffer.from(codeString, 'utf8')).toString(
      'base64',
    ),
    externalsTar: '',
    externalDependencyReceipt: null,
    resourceSpecs: {},
  };
}

/**
 * @param {string} activity
 * @param {ReturnType<typeof digest>} archiveDigest
 */
function createExternalReceipt(activity, archiveDigest) {
  return {
    dependencyLockInput: {
      format: DEPENDENCY_LOCK_INPUT_FORMAT,
      digest: digest('worker lifecycle dependency lock'),
    },
    closureDigest: digest(`worker lifecycle closure ${activity}`),
    archiveDigest,
  };
}

async function createIdentityExternalsTar(/** @type {string} */ identity) {
  const tmpRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-worker-external-identity-'),
  );
  const packageDir = path.join(
    tmpRoot,
    'node_modules',
    'wharfie-test-identity',
  );

  try {
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        name: 'wharfie-test-identity',
        version: '1.0.0',
        main: 'index.js',
      }),
      'utf8',
    );
    await fsp.writeFile(
      path.join(packageDir, 'index.js'),
      `exports.identity = ${JSON.stringify(identity)};\n`,
      'utf8',
    );

    return await streamToBuffer(
      c(
        {
          cwd: tmpRoot,
          gzip: true,
          noMtime: true,
          portable: true,
        },
        ['.'],
      ),
    );
  } finally {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
}

beforeEach(() => {
  seaAssets.clear();
  jest.resetModules();
});

afterEach(async () => {
  const { default: sandboxWorker } = await import(WORKER_IMPORT);
  await sandboxWorker._destroyWorker();
  sandboxWorker._clearSandboxCache();
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('sandbox worker lifecycle isolation', () => {
  it('runs two different activity bundles sequentially without resetting the worker pool', async () => {
    const { default: sandboxWorker } = await import(WORKER_IMPORT);
    const firstName = makeName('sequential-first');
    const secondName = makeName('sequential-second');
    const firstCode = `
      global[Symbol.for(${JSON.stringify(firstName)})] = async () => 'first';
    `;
    const secondCode = `
      global[Symbol.for(${JSON.stringify(secondName)})] = async () => 'second';
    `;

    await expect(
      sandboxWorker.runInSandbox(firstName, firstCode, []),
    ).resolves.toBe('first');
    await expect(
      sandboxWorker.runInSandbox(secondName, secondCode, []),
    ).resolves.toBe('second');
  });

  it.each([
    [
      'an archive whose bytes do not match its digest',
      {
        externals: [{ name: 'wharfie-test-identity', version: '1.0.0' }],
        externalsTar: Buffer.from('tampered archive bytes').toString('base64'),
        externalDependencyReceipt: createExternalReceipt(
          'invalid-external-archive',
          digest('different archive bytes'),
        ),
      },
      /does not match the exact embedded archive bytes/i,
    ],
    [
      'archive bytes without a digest',
      {
        externals: [{ name: 'wharfie-test-identity', version: '1.0.0' }],
        externalsTar: Buffer.from('archive without digest').toString('base64'),
        externalDependencyReceipt: null,
      },
      /receipt is required for nonempty external archive bytes/i,
    ],
    [
      'an archive digest without bytes',
      {
        externalsTar: '',
        externalDependencyReceipt: createExternalReceipt(
          'invalid-external-archive',
          digest('absent archive'),
        ),
      },
      /receipt requires nonempty external archive bytes/i,
    ],
  ])(
    'rejects %s before invoking a worker',
    async (_label, overrides, error) => {
      const activityName = makeName('invalid-external-archive');
      seaAssets.set(activityName, {
        ...createFunctionAsset(activityName, 'invalid-archive'),
        ...overrides,
      });
      const { default: sandboxWorker } = await import(WORKER_IMPORT);
      const runInSandbox = jest.spyOn(sandboxWorker, 'runInSandbox');
      const { default: WharfieFunction } = await import(FUNCTION_IMPORT);

      await expect(
        WharfieFunction.run(activityName, { delay: 0 }, {}),
      ).rejects.toThrow(error);
      expect(runInSandbox).not.toHaveBeenCalled();
    },
  );

  it(
    'keeps concurrent WharfieFunction activities and RPC sessions isolated',
    async () => {
      const firstName = makeName('concurrent-first');
      const secondName = makeName('concurrent-second');
      const firstIdentity = jest.fn(async () => 'first-rpc');
      const secondIdentity = jest.fn(async () => 'second-rpc');

      seaAssets.set(
        firstName,
        createFunctionAsset(firstName, 'first-activity'),
      );
      seaAssets.set(
        secondName,
        createFunctionAsset(secondName, 'second-activity'),
      );

      const { default: WharfieFunction } = await import(FUNCTION_IMPORT);
      const [firstResult, secondResult] = await Promise.all([
        WharfieFunction.run(
          firstName,
          { delay: 75, value: 1 },
          {},
          { resources: { identity: { read: firstIdentity } } },
        ),
        WharfieFunction.run(
          secondName,
          { delay: 5, value: 2 },
          {},
          { resources: { identity: { read: secondIdentity } } },
        ),
      ]);

      expect(firstResult).toEqual({
        activity: 'first-activity',
        identity: 'first-rpc',
        value: 1,
      });
      expect(secondResult).toEqual({
        activity: 'second-activity',
        identity: 'second-rpc',
        value: 2,
      });
      expect(firstIdentity).toHaveBeenCalledTimes(1);
      expect(secondIdentity).toHaveBeenCalledTimes(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'isolates the same activity code by external bundle content',
    async () => {
      const activityName = makeName('external-bundle-revision');
      const codeString = `
        const externalIdentity = require('wharfie-test-identity');
        global[Symbol.for(${JSON.stringify(activityName)})] = async (event) => {
          await new Promise((resolve) => setTimeout(resolve, event.delay));
          return externalIdentity.identity;
        };
      `;
      const [firstExternals, secondExternals] = await Promise.all([
        createIdentityExternalsTar('first-bundle'),
        createIdentityExternalsTar('second-bundle'),
      ]);
      const createAsset = (/** @type {Buffer} */ externalsTar) => ({
        schemaVersion: FUNCTION_ASSET_SCHEMA_VERSION,
        activity: activityName,
        target: {
          nodeVersion: process.versions.node,
          platform: process.platform,
          architecture: process.arch,
          ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
        },
        externals: [{ name: 'wharfie-test-identity', version: '1.0.0' }],
        codeBundle: brotliCompressSync(
          Buffer.from(codeString, 'utf8'),
        ).toString('base64'),
        externalsTar: externalsTar.toString('base64'),
        externalDependencyReceipt: createExternalReceipt(
          activityName,
          digest(externalsTar),
        ),
        resourceSpecs: {},
      });

      seaAssets.set(activityName, createAsset(firstExternals));
      const { default: WharfieFunction } = await import(FUNCTION_IMPORT);
      const firstRun = WharfieFunction.run(activityName, { delay: 5 });

      seaAssets.set(activityName, createAsset(secondExternals));
      const secondRun = WharfieFunction.run(activityName, { delay: 75 });

      await expect(Promise.all([firstRun, secondRun])).resolves.toEqual([
        'first-bundle',
        'second-bundle',
      ]);
    },
    TEST_TIMEOUT_MS,
  );
});
