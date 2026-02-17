/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { createActorSystemResources } from '../../../lambdas/lib/actor/runtime/resources.js';
import { startDbService } from '../../../lambdas/lib/actor/runtime/services/db-service.js';
import { startQueueService } from '../../../lambdas/lib/actor/runtime/services/queue-service.js';
import { createGrpcRpcClient } from '../../../lambdas/lib/actor/runtime/services/rpc-grpc.js';
import sandboxWorker from '../../../lambdas/lib/code-execution/worker.js';

describe('ActorSystem resources over service RPC (gRPC)', () => {
  it('worker sandbox: resources can be remote gRPC RPC clients', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-actor-system-remote-grpc-'),
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

    const { resources: local, close: closeLocal } =
      await createActorSystemResources({
        objectStorage: { adapter: 'vanilla', options: { path: tmp } },
      });

    const objectStorage = local.objectStorage;

    const fnName = `wharfie-worker-remote-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;

    const codeString = `
      global[Symbol.for(${JSON.stringify(fnName)})] = async (event, context) => {
        const who = event?.who || 'world';
        const message = 'hello ' + who;

        await context.resources.db.put({
          tableName: 'test',
          keyName: 'id',
          record: { id: 'greeting', who, message }
        });

        await context.resources.queue.sendMessage({
          QueueUrl: 'test-queue',
          MessageBody: JSON.stringify({ hello: who })
        });

        await context.resources.objectStorage.createBucket({ Bucket: 'test-bucket' });
        await context.resources.objectStorage.putObject({
          Bucket: 'test-bucket',
          Key: 'greeting.txt',
          Body: message,
        });
      };
    `;

    try {
      await sandboxWorker.runInSandbox(
        fnName,
        codeString,
        [{ who: 'world' }, { resources: {} }],
        {
          rpc: {
            resources: {
              db,
              queue,
              objectStorage,
            },
          },
        },
      );

      const dbRecord = await db.get({
        tableName: 'test',
        keyName: 'id',
        keyValue: 'greeting',
      });

      expect(dbRecord).toEqual({
        id: 'greeting',
        who: 'world',
        message: 'hello world',
      });

      const q = await queue.receiveMessage({
        QueueUrl: 'test-queue',
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 0,
      });

      const body = q?.Messages?.[0]?.Body;
      expect(body).toBe(JSON.stringify({ hello: 'world' }));

      if (!objectStorage) {
        throw new Error('objectStorage not available');
      }
      const objectBody = await objectStorage.getObject({
        Bucket: 'test-bucket',
        Key: 'greeting.txt',
      });

      // vanilla returns string
      expect(objectBody).toBe('hello world');
    } finally {
      try {
        db.__wharfie_closeTransport && db.__wharfie_closeTransport();
      } catch {}
      try {
        queue.__wharfie_closeTransport && queue.__wharfie_closeTransport();
      } catch {}
      await dbSvc.close();
      await queueSvc.close();
      await closeLocal();
      await sandboxWorker._destroyWorker();
      await sandboxWorker._clearSandboxCache();
    }
  });
});
