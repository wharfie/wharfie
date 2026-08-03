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
import { getActivityAttemptProtocolSymbol } from '../../../src/core/runtime/activity-attempt.js';
import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
} from '../../../src/core/runtime/activity-protocol.js';

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

function startFrame(
  /** @type {string} */ activityId,
  /** @type {string} */ attemptId = 'attempt-1',
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
 * @returns {{schemaVersion: 4, activity: string, target: {nodeVersion: string, platform: NodeJS.Platform, architecture: string, libc?: string}, externals: never[], codeBundle: string, externalsTar: string, externalDependencyReceipt: null}}
 */
function createFunctionAsset(name, label) {
  const entrypointSymbol = getActivityAttemptProtocolSymbol(name);
  const codeString = `
    globalThis[Symbol.for(${JSON.stringify(entrypointSymbol)})] =
      async ({ startFrame, transport }) => {
        await transport.onComponentFrame({
          protocol: 'wharfie.activity',
          protocolVersion: 1,
          type: 'completed',
          attemptId: startFrame.attemptId,
          sequence: 1,
          result: ${JSON.stringify(label)},
        });
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
      const runActivityAttemptInSandbox = jest.spyOn(
        sandboxWorker,
        'runActivityAttemptInSandbox',
      );
      const { default: WharfieFunction } = await import(FUNCTION_IMPORT);

      await expect(
        WharfieFunction.runActivityAttempt(
          activityName,
          startFrame(activityName),
        ),
      ).rejects.toThrow(error);
      expect(runActivityAttemptInSandbox).not.toHaveBeenCalled();
    },
  );

  it(
    'isolates the same activity code by external bundle content',
    async () => {
      const activityName = makeName('external-bundle-revision');
      const entrypointSymbol = getActivityAttemptProtocolSymbol(activityName);
      const codeString = `
        const externalIdentity = require('wharfie-test-identity');
        globalThis[Symbol.for(${JSON.stringify(entrypointSymbol)})] =
          async ({ startFrame, transport }) => {
            await transport.onComponentFrame({
              protocol: 'wharfie.activity',
              protocolVersion: 1,
              type: 'completed',
              attemptId: startFrame.attemptId,
              sequence: 1,
              result: externalIdentity.identity,
            });
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
      });

      seaAssets.set(activityName, createAsset(firstExternals));
      const { default: WharfieFunction } = await import(FUNCTION_IMPORT);
      const firstRun = WharfieFunction.runActivityAttempt(
        activityName,
        startFrame(activityName, 'attempt-first'),
      );

      seaAssets.set(activityName, createAsset(secondExternals));
      const secondRun = WharfieFunction.runActivityAttempt(
        activityName,
        startFrame(activityName, 'attempt-second'),
      );

      const results = await Promise.all([firstRun, secondRun]);
      expect(results.map((result) => result.terminal.result)).toEqual([
        'first-bundle',
        'second-bundle',
      ]);
    },
    TEST_TIMEOUT_MS,
  );
});
