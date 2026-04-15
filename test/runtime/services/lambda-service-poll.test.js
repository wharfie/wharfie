/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { jest } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';

import { startDbService } from '../../../src/core/runtime/services/db-service.js';
import { startQueueService } from '../../../src/core/runtime/services/queue-service.js';
import { startLambdaService } from '../../../src/core/runtime/services/lambda-service.js';
import { createGrpcRpcClient } from '../../../src/core/runtime/services/rpc-grpc.js';
import createOperationsStore from '../../../src/core/lib/graph/operations-store.js';
import { getSyntheticAppResourceId } from '../../../src/core/lib/graph/app-run.js';

const NODE_SEA_IMPORT = '../../../src/core/lib/node-sea.js';

/** @type {Map<string, any>} */
const seaAssets = new Map();

// Mock SEA asset lookup to serve our in-memory bundles.
jest.unstable_mockModule(NODE_SEA_IMPORT, () => ({
  getAsset: async (/** @type {string} */ name) => {
    const assetDescription = seaAssets.get(name);
    if (!assetDescription) {
      throw new Error(`Unexpected asset request: ${name}`);
    }
    return Buffer.from(JSON.stringify(assetDescription), 'utf8');
  },
}));

describe('Lambda service queue poll loop (gRPC)', () => {
  beforeEach(() => {
    seaAssets.clear();
  });

  it('polls queue messages, persists an event run, and acks on success', async () => {
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

    seaAssets.set(fnName, assetDescription);

    const { default: Function } =
      await import('../../../src/core/resources/builds/function.js');
    const operationsStore = createOperationsStore({
      db,
      tableName: 'lambda-operations',
    });

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
        operationsStore,
        appName: 'lambda-poll-app',
      },
    });

    try {
      const payload = {
        activity: fnName,
        event: { who: 'world' },
        context: { requestId: 'test' },
      };
      const sendResult = await queue.sendMessage({
        QueueUrl: 'lambda-invoke',
        MessageBody: JSON.stringify(payload),
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

      const resourceId = getSyntheticAppResourceId('lambda-poll-app');
      const persisted = /** @type {{ operation: any, actions: any[] }} */ (
        await waitFor(async () => {
          const records = await operationsStore.getRecords(
            resourceId,
            sendResult.MessageId,
          );
          const operation = records.operations.find(
            (candidate) => candidate.id === sendResult.MessageId,
          );
          if (!operation || operation.status !== 'COMPLETED') {
            return null;
          }
          return { operation, actions: records.actions };
        })
      );

      expect(persisted.operation.resource_id).toBe(resourceId);
      expect(persisted.operation.operation_config).toEqual(
        expect.objectContaining({
          app: 'lambda-poll-app',
          activity: fnName,
          trigger: expect.objectContaining({
            source: 'event',
            queueUrl: 'lambda-invoke',
            messageId: sendResult.MessageId,
            receiptHandle: expect.any(String),
          }),
        }),
      );
      expect(persisted.operation.operation_inputs).toEqual(payload);
      expect(persisted.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation_id: sendResult.MessageId,
            resource_id: resourceId,
            function_name: fnName,
            inputs: { who: 'world' },
            attempt_count: 1,
            status: 'COMPLETED',
          }),
        ]),
      );

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

  it('keeps failed queue messages retryable and records a failed event run', async () => {
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
    const operationsStore = createOperationsStore({
      db,
      tableName: 'lambda-operations-failure',
    });

    const lambdaSvc = await startLambdaService({
      host: '127.0.0.1',
      port: 0,
      execute: async () => {
        throw new Error('boom');
      },
      poll: {
        queue,
        queueUrls: ['lambda-invoke'],
        waitTimeSeconds: 0,
        maxNumberOfMessages: 1,
        visibilityTimeout: 1,
        operationsStore,
        appName: 'lambda-poll-app',
      },
    });

    try {
      const payload = {
        activity: 'failing-activity',
        event: { who: 'world' },
        context: { requestId: 'test-failure' },
      };
      const sendResult = await queue.sendMessage({
        QueueUrl: 'lambda-invoke',
        MessageBody: JSON.stringify(payload),
      });

      const resourceId = getSyntheticAppResourceId('lambda-poll-app');
      const persisted = /** @type {{ operation: any, actions: any[] }} */ (
        await waitFor(async () => {
          const records = await operationsStore.getRecords(
            resourceId,
            sendResult.MessageId,
          );
          const operation = records.operations.find(
            (candidate) => candidate.id === sendResult.MessageId,
          );
          if (!operation || operation.status !== 'FAILED') {
            return null;
          }
          return { operation, actions: records.actions };
        })
      );

      expect(persisted.operation.operation_config).toEqual(
        expect.objectContaining({
          app: 'lambda-poll-app',
          activity: 'failing-activity',
          trigger: expect.objectContaining({
            source: 'event',
            queueUrl: 'lambda-invoke',
            messageId: sendResult.MessageId,
          }),
        }),
      );
      expect(persisted.operation.operation_inputs).toEqual(payload);
      expect(persisted.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation_id: sendResult.MessageId,
            resource_id: resourceId,
            function_name: 'failing-activity',
            attempt_count: 1,
            status: 'FAILED',
            error: expect.objectContaining({
              message: 'boom',
            }),
          }),
        ]),
      );

      await lambdaSvc.close();
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const q = await queue.receiveMessage({
        QueueUrl: 'lambda-invoke',
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 0,
      });

      expect(q?.Messages?.length || 0).toBe(1);
      expect(q.Messages[0]).toEqual(
        expect.objectContaining({
          MessageId: sendResult.MessageId,
          Body: JSON.stringify(payload),
        }),
      );
    } finally {
      try {
        await lambdaSvc.close();
      } catch {}
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
