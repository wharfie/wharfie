/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { jest } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';

import { startDbService } from '../../../lambdas/lib/actor/runtime/services/db-service.js';
import { startQueueService } from '../../../lambdas/lib/actor/runtime/services/queue-service.js';
import { startLambdaService } from '../../../lambdas/lib/actor/runtime/services/lambda-service.js';
import { createGrpcRpcClient } from '../../../lambdas/lib/actor/runtime/services/rpc-grpc.js';

describe('Lambda service queue poll loop (gRPC)', () => {
  it('polls queue messages and launches workers based on message shape', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-lambda-poll-'),
    );

    const dbSvc = await startDbService({
      dbSpec: { adapter: 'vanilla', options: { path: tmp } },
      host: '127.0.0.1',
      port: 0,
    });

    const queueSvc = await startQueueService({
      queueSpec: { adapter: 'vanilla', options: { path: tmp } },
      host: '127.0.0.1',
      port: 0,
    });

    const db = createGrpcRpcClient({ address: dbSvc.address });
    const queue = createGrpcRpcClient({ address: queueSvc.address });

    const fnName = `test-lambda-fn-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

    const bundleCode = `
      global[Symbol.for(${JSON.stringify(fnName)})] = async (event, context) => {
        const who = event?.who || 'world';
        await context.resources.db.put({
          tableName: 'lambda',
          keyName: 'id',
          record: { id: 'greeting', who, message: 'hello ' + who }
        });
      };
    `;

    const assetDescription = {
      codeBundle: brotliCompressSync(Buffer.from(bundleCode, 'utf8')).toString(
        'base64',
      ),
      externalsTar: '',
    };

    // Mock SEA asset lookup to serve our in-memory bundle.
    jest.unstable_mockModule('node:sea', () => ({
      getAsset: async (/** @type {string} */ name) => {
        if (name !== fnName) {
          throw new Error(`Unexpected asset request: ${name}`);
        }
        return Buffer.from(JSON.stringify(assetDescription), 'utf8');
      },
    }));

    const { default: Function } =
      await import('../../../lambdas/lib/actor/resources/builds/function.js');

    const lambdaSvc = await startLambdaService({
      host: '127.0.0.1',
      port: 0,
      execute: async ({ functionName, event, context }) => {
        await Function.run(functionName, event, context ?? {}, {
          resources: {
            db,
            queue,
          },
        });
      },
      poll: {
        queue,
        queueUrls: ['lambda-invoke'],
        waitTimeSeconds: 0,
        maxNumberOfMessages: 1,
        visibilityTimeout: 5,
      },
    });

    try {
      // Enqueue an invocation message.
      await queue.sendMessage({
        QueueUrl: 'lambda-invoke',
        MessageBody: JSON.stringify({
          functionName: fnName,
          event: { who: 'world' },
          context: { requestId: 'test' },
        }),
      });

      // Wait for the function to write to DB via gRPC->worker RPC chain.
      const record = await waitFor(async () => {
        const r = await db.get({
          tableName: 'lambda',
          keyName: 'id',
          keyValue: 'greeting',
        });
        return r;
      });

      expect(record).toEqual({
        id: 'greeting',
        who: 'world',
        message: 'hello world',
      });

      // Queue message should be acked (deleted)
      const q = await queue.receiveMessage({
        QueueUrl: 'lambda-invoke',
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 0,
      });

      expect(q?.Messages?.length || 0).toBe(0);
    } finally {
      await lambdaSvc.close();
      try {
        db.__wharfie_closeTransport && db.__wharfie_closeTransport();
      } catch {}
      try {
        queue.__wharfie_closeTransport && queue.__wharfie_closeTransport();
      } catch {}
      await dbSvc.close();
      await queueSvc.close();
    }
  });
});

/**
 * Poll helper: waits until the callback returns a truthy value.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ timeoutMs?: number, intervalMs?: number }} [options]
 * @returns {Promise<T>}
 */
async function waitFor(fn, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Number(options.timeoutMs)
    : 2000;
  const intervalMs = Number.isFinite(options.intervalMs)
    ? options.intervalMs
    : 50;

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const v = await fn();
    if (v) return v;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
