/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brotliCompressSync } from 'node:zlib';

import { createActorSystemResources } from '../../../src/core/runtime/resources.js';
import sandboxWorker from '../../../src/core/lib/code-execution/worker.js';
import {
  FUNCTION_ASSET_SCHEMA_VERSION,
  serializeFunctionAssetDescription,
} from '../../../src/core/resources/builds/lib/function-asset.js';

const NODE_SEA_IMPORT = '../../../src/core/lib/node-sea.js';
const BUNDLED_RESOURCE_TEST_TIMEOUT_MS = 15_000;

/** @type {Map<string, any>} */
const seaAssets = new Map();

jest.unstable_mockModule(NODE_SEA_IMPORT, () => ({
  getAsset: async (/** @type {string} */ name) => {
    const assetBytes = seaAssets.get(name);
    if (!assetBytes) {
      throw new Error(`Unexpected asset request: ${name}`);
    }
    return assetBytes;
  },
}));

describe('Function.run bundled resource specs', () => {
  beforeEach(() => {
    seaAssets.clear();
  });

  it(
    'instantiates bundled function resource specs when no host resources are provided',
    async () => {
      const tmp = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'wharfie-function-run-bundled-'),
      );
      const fnName = `bundled-resource-spec-${Date.now()}-${Math.floor(
        Math.random() * 1e9,
      )}`;

      const bundleCode = `
      global[Symbol.for(${JSON.stringify(fnName)})] = async (event, context) => {
        const who = event?.who || 'world';
        await context.resources.db.put({
          tableName: 'bundled-function',
          keyName: 'id',
          record: { id: 'greeting', who, message: 'hello ' + who }
        });
      };
    `;

      seaAssets.set(
        fnName,
        serializeFunctionAssetDescription({
          schemaVersion: FUNCTION_ASSET_SCHEMA_VERSION,
          activity: fnName,
          target: {
            nodeVersion: process.versions.node,
            platform: process.platform,
            architecture: process.arch,
            ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
          },
          externals: [],
          codeBundle: brotliCompressSync(
            Buffer.from(bundleCode, 'utf8'),
          ).toString('base64'),
          externalsTar: '',
          externalDependencyReceipt: null,
          resourceSpecs: {
            db: { adapter: 'vanilla', options: { path: tmp } },
          },
        }),
      );

      const { default: Function } =
        await import('../../../src/core/resources/builds/function.js');

      try {
        await Function.run(fnName, { who: 'bundled' }, { requestId: 'req-1' });

        const { resources, close } = await createActorSystemResources({
          db: { adapter: 'vanilla', options: { path: tmp } },
        });

        try {
          if (!resources.db) {
            throw new Error('db resource not available');
          }
          const record = await resources.db.get({
            tableName: 'bundled-function',
            keyName: 'id',
            keyValue: 'greeting',
          });

          expect(record).toEqual({
            id: 'greeting',
            who: 'bundled',
            message: 'hello bundled',
          });
        } finally {
          await close();
        }
      } finally {
        await sandboxWorker._destroyWorker();
        sandboxWorker._clearSandboxCache();
        await fsp.rm(tmp, { recursive: true, force: true });
      }
    },
    BUNDLED_RESOURCE_TEST_TIMEOUT_MS,
  );
});
