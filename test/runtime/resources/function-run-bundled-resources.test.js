/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brotliCompressSync } from 'node:zlib';

import { createActorSystemResources } from '../../../lambdas/lib/actor/runtime/resources.js';
import sandboxWorker from '../../../lambdas/lib/code-execution/worker.js';

/** @type {Map<string, any>} */
const seaAssets = new Map();

jest.unstable_mockModule('node:sea', () => ({
  getAsset: async (/** @type {string} */ name) => {
    const assetDescription = seaAssets.get(name);
    if (!assetDescription) {
      throw new Error(`Unexpected asset request: ${name}`);
    }
    return Buffer.from(JSON.stringify(assetDescription), 'utf8');
  },
}));

describe('Function.run bundled resource specs', () => {
  beforeEach(() => {
    seaAssets.clear();
  });

  it('instantiates bundled function resource specs when no host resources are provided', async () => {
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

    seaAssets.set(fnName, {
      codeBundle: brotliCompressSync(Buffer.from(bundleCode, 'utf8')).toString(
        'base64',
      ),
      externalsTar: '',
      resourceSpecs: {
        db: { adapter: 'vanilla', options: { path: tmp } },
      },
    });

    const { default: Function } =
      await import('../../../lambdas/lib/actor/resources/builds/function.js');

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
    }
  });
});
