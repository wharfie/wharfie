/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { jest } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';

import { startDbService } from '../../../src/core/runtime/services/db-service.js';
import { startQueueService } from '../../../src/core/runtime/services/queue-service.js';
import { createGrpcRpcClient } from '../../../src/core/runtime/services/rpc-grpc.js';
import createOperationsStore from '../../../src/core/lib/graph/operations-store.js';
import createVanillaDB from '../../../src/core/lib/db/adapters/vanilla.js';

const NODE_SEA_IMPORT = '../../../src/core/lib/node-sea.js';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const OTHER_REVISION_ID = `wrv1_${'B'.repeat(42)}Q`;

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

const { startLambdaService } =
  await import('../../../src/core/runtime/services/lambda-service.js');
const {
  createOperationFromActivity,
  getAppResourceId,
  getQueueOperationId,
  runPersistedActivity,
} = await import('../../../src/core/runtime/app-runs.js');

describe('Lambda service queue poll loop (gRPC)', () => {
  beforeEach(() => {
    seaAssets.clear();
  });

  it('refuses queue polling without durable operation state', async () => {
    await expect(
      startLambdaService({
        execute: async () => undefined,
        poll: /** @type {any} */ ({
          queue: {},
          queueUrls: ['queue://missing-control-state'],
        }),
      }),
    ).rejects.toThrow(/requires operationsStore, appId, and revisionId/i);
  });

  it('derives stable queue operation IDs without composite-identity collisions', () => {
    const identity = { queueUrl: 'queue://one', messageId: 'message-1' };
    const firstRevisionIdentity = { ...identity, revisionId: REVISION_ID };
    const secondRevisionIdentity = {
      ...identity,
      revisionId: OTHER_REVISION_ID,
    };

    expect(getQueueOperationId(identity)).toBe(getQueueOperationId(identity));
    expect(getQueueOperationId(firstRevisionIdentity)).toBe(
      getQueueOperationId(secondRevisionIdentity),
    );
    expect(getQueueOperationId(identity)).not.toBe(
      getQueueOperationId({
        queueUrl: 'queue://two',
        messageId: identity.messageId,
      }),
    );
    expect(getQueueOperationId({ queueUrl: 'ab', messageId: 'c' })).not.toBe(
      getQueueOperationId({ queueUrl: 'a', messageId: 'bc' }),
    );
    expect(
      getQueueOperationId({
        queueUrl: identity.queueUrl,
        messageId: ` ${identity.messageId} `,
      }),
    ).not.toBe(getQueueOperationId(identity));
  });

  it('builds one canonical activity action and keeps receipts out of immutable trigger state', () => {
    const context = { requestId: 'stable-request' };
    const operation = createOperationFromActivity({
      appId: 'canonical-app',
      revisionId: REVISION_ID,
      activityName: 'process-message',
      operationId: 'operation-1',
      event: { value: 1 },
      context,
      trigger: {
        source: 'event',
        queueUrl: 'queue://one',
        messageId: 'message-1',
        receiptHandle: 'attempt-only',
      },
    });
    context.requestId = 'caller-mutated';

    expect(operation.operation_config).toEqual({
      source: 'app-manifest',
      app_id: 'canonical-app',
      activity_name: 'process-message',
      context: { requestId: 'stable-request' },
      trigger: {
        source: 'event',
        queueUrl: 'queue://one',
        messageId: 'message-1',
      },
    });
    expect(operation.getActions()).toEqual([
      expect.objectContaining({
        id: 'invoke',
        type: 'INVOKE_FUNCTION',
        function_name: 'process-message',
        inputs: { value: 1 },
      }),
    ]);
    expect(
      createOperationFromActivity({
        appId: 'canonical-app',
        revisionId: REVISION_ID,
        activityName: 'process-message',
        operationId: '  opaque operation/id  ',
      }).id,
    ).toBe('  opaque operation/id  ');
    expect(() =>
      createOperationFromActivity({
        appId: 'canonical-app',
        revisionId: REVISION_ID,
        activityName: 'process-message',
        operationId: '',
      }),
    ).toThrow(/operationId must be a nonempty string/i);
    expect(() =>
      createOperationFromActivity({
        appId: 'Canonical App',
        revisionId: REVISION_ID,
        activityName: 'process-message',
      }),
    ).toThrow(/canonical logical ID/i);
    expect(() =>
      createOperationFromActivity({
        appId: 'canonical-app',
        revisionId: REVISION_ID,
        activityName: 'Process Message',
      }),
    ).toThrow(/canonical logical ID/i);
    expect(() =>
      createOperationFromActivity(
        /** @type {any} */ ({
          appId: 'canonical-app',
          activityName: 'process-message',
        }),
      ),
    ).toThrow(/revisionId/i);
    expect(() =>
      createOperationFromActivity({
        appId: 'canonical-app',
        revisionId: 'latest',
        activityName: 'process-message',
      }),
    ).toThrow(/revisionId must be a canonical/i);
  });

  it('deduplicates a completed queue operation without executing it again', async () => {
    const appId = 'dedupe-app';
    const operationId = getQueueOperationId({
      queueUrl: 'queue://dedupe',
      messageId: 'message-1',
    });
    const duplicate = new Error('already exists');
    duplicate.name = 'OperationAlreadyExistsError';
    const existing = createOperationFromActivity({
      appId,
      revisionId: REVISION_ID,
      activityName: 'work',
      operationId,
      event: { value: 1 },
      context: { requestId: 'stable-request' },
      trigger: {
        source: 'event',
        queueUrl: 'queue://dedupe',
        messageId: 'message-1',
      },
    });
    existing.status = 'COMPLETED';
    const store = {
      createOperation: jest.fn(async () => {
        throw duplicate;
      }),
      getRecords: jest.fn(async () => ({
        operations: [existing],
        actions: existing.getActions(),
      })),
    };
    const execute = jest.fn(async () => undefined);

    await expect(
      runPersistedActivity({
        store: /** @type {any} */ (store),
        appId,
        revisionId: REVISION_ID,
        activityName: 'work',
        operationId,
        event: { value: 1 },
        context: { requestId: 'stable-request' },
        attemptContext: {
          trigger: { receiptHandle: 'attempt-scoped-receipt' },
        },
        trigger: {
          source: 'event',
          queueUrl: 'queue://dedupe',
          messageId: 'message-1',
        },
        execute,
      }),
    ).resolves.toEqual({
      resourceId: getAppResourceId(appId),
      operationId,
      status: 'COMPLETED',
      deduplicated: true,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses to deduplicate or execute an operation from another revision', async () => {
    const appId = 'revision-fence-app';
    const operationId = 'provider-message-operation';
    const existing = createOperationFromActivity({
      appId,
      revisionId: REVISION_ID,
      activityName: 'work',
      operationId,
      event: { value: 1 },
      trigger: { source: 'manual' },
    });
    existing.status = 'COMPLETED';
    const duplicate = new Error('already exists');
    duplicate.name = 'OperationAlreadyExistsError';
    const store = {
      createOperation: jest.fn(async () => {
        throw duplicate;
      }),
      getRecords: jest.fn(async () => ({
        operations: [existing],
        actions: existing.getActions(),
      })),
    };
    const execute = jest.fn(async () => ({ shouldNotRun: true }));

    await expect(
      runPersistedActivity({
        store: /** @type {any} */ (store),
        appId,
        revisionId: OTHER_REVISION_ID,
        activityName: 'work',
        operationId,
        event: { value: 1 },
        trigger: { source: 'manual' },
        execute,
      }),
    ).rejects.toMatchObject({
      name: 'OperationRevisionMismatchError',
      resourceId: getAppResourceId(appId),
      operationId,
      requestedRevisionId: OTHER_REVISION_ID,
      persistedRevisionId: REVISION_ID,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('isolates immutable activity inputs from handler mutation before deduplication', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-activity-inputs-'),
    );
    try {
      const store = createOperationsStore({
        db: createVanillaDB({ path: tmp }),
        tableName: 'activity-inputs',
      });
      const request = {
        store,
        appId: 'input-app',
        revisionId: REVISION_ID,
        activityName: 'work',
        operationId: 'immutable-input',
        event: { value: 1 },
        context: { request: { id: 'stable-context' } },
        trigger: { source: 'manual' },
      };
      const execute = jest.fn(
        async (
          /** @type {{activityName: string, event?: any, context: Record<string, any>}} */ {
            event,
            context,
          },
        ) => {
          event.value = 2;
          context.request.id = 'handler-mutated';
          return { observed: event.value, context: context.request.id };
        },
      );

      await expect(
        runPersistedActivity({ ...request, execute }),
      ).resolves.toMatchObject({ status: 'COMPLETED', deduplicated: false });

      const records = await store.getRecords(
        getAppResourceId(request.appId),
        request.operationId,
      );
      expect(records.operations[0].operation_inputs).toEqual({ value: 1 });
      expect(records.operations[0].operation_config.context).toEqual({
        request: { id: 'stable-context' },
      });
      expect(records.actions[0].inputs).toEqual({ value: 1 });

      const duplicateExecute = jest.fn(async () => undefined);
      await expect(
        runPersistedActivity({ ...request, execute: duplicateExecute }),
      ).resolves.toMatchObject({ status: 'COMPLETED', deduplicated: true });
      expect(duplicateExecute).not.toHaveBeenCalled();
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  it('refuses to claim a definition replaced after identity validation', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-activity-claim-race-'),
    );
    try {
      const store = createOperationsStore({
        db: createVanillaDB({ path: tmp }),
        tableName: 'activity-claim-race',
      });
      const request = {
        appId: 'claim-race-app',
        revisionId: REVISION_ID,
        activityName: 'work',
        operationId: 'stable-operation',
        event: { value: 1 },
        trigger: { source: 'manual' },
      };
      const original = createOperationFromActivity(request);
      await store.createOperation(original);

      let exactReads = 0;
      const racingStore = {
        ...store,
        getRecords: async (
          /** @type {string} */ resourceId,
          /** @type {string | undefined} */ operationId,
        ) => {
          exactReads += 1;
          if (exactReads === 2) {
            const replacement = createOperationFromActivity({
              ...request,
              event: { value: 2 },
            });
            await store.replaceOperation(replacement, original.version);
          }
          return await store.getRecords(resourceId, operationId);
        },
      };
      const execute = jest.fn(async () => ({ shouldNotRun: true }));

      await expect(
        runPersistedActivity({
          store: /** @type {any} */ (racingStore),
          ...request,
          execute,
        }),
      ).rejects.toThrow(/snapshot changed before claim/i);
      expect(execute).not.toHaveBeenCalled();

      const records = await store.getRecords(
        getAppResourceId(request.appId),
        request.operationId,
      );
      expect(records.operations[0]).toMatchObject({
        status: 'PENDING',
        generation: 2,
        version: 2,
        operation_inputs: { value: 2 },
      });
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  it('preserves provider queue identities and defaults an omitted event', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-queue-identity-'),
    );
    const queueUrl = 'queue://opaque-identities';
    const messageId = ' provider-message ';
    const receiptHandle = ' provider-receipt ';
    let delivered = false;
    const queue = /** @type {any} */ ({
      receiveMessage: jest.fn(async () => {
        if (delivered) return { Messages: [] };
        delivered = true;
        return {
          Messages: [
            {
              MessageId: messageId,
              ReceiptHandle: receiptHandle,
              Body: JSON.stringify({ activity: 'work' }),
            },
          ],
        };
      }),
      deleteMessage: jest.fn(async () => ({})),
    });
    const store = createOperationsStore({
      db: createVanillaDB({ path: tmp }),
      tableName: 'queue-identities',
    });
    const execute = jest.fn(async () => ({ ok: true }));
    const lambdaSvc = await startLambdaService({
      execute,
      poll: {
        queue,
        queueUrls: [queueUrl],
        waitTimeSeconds: 0,
        maxNumberOfMessages: 1,
        operationsStore: store,
        appId: 'queue-identity-app',
        revisionId: REVISION_ID,
      },
    });

    try {
      await waitFor(async () => queue.deleteMessage.mock.calls.length > 0);
      expect(queue.deleteMessage).toHaveBeenCalledWith({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      });
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'work',
          activity: 'work',
          revisionId: REVISION_ID,
          event: {},
          context: expect.objectContaining({
            trigger: {
              source: 'event',
              queueUrl,
              messageId,
              receiptHandle,
            },
          }),
        }),
      );

      const operationId = getQueueOperationId({ queueUrl, messageId });
      const records = await store.getRecords(
        getAppResourceId('queue-identity-app'),
        operationId,
      );
      expect(records.operations[0]).toEqual(
        expect.objectContaining({
          id: operationId,
          revision_id: REVISION_ID,
          operation_inputs: {},
          operation_config: expect.objectContaining({
            context: {},
            trigger: {
              source: 'event',
              queueUrl,
              messageId,
            },
          }),
        }),
      );
    } finally {
      await lambdaSvc.close();
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  it('leaves a queue message unacked when its operation belongs to another revision', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-queue-revision-fence-'),
    );
    const queueUrl = 'queue://revision-fence';
    const messageId = 'provider-message-1';
    const receiptHandle = 'delivery-receipt-1';
    const operationId = getQueueOperationId({ queueUrl, messageId });
    const store = createOperationsStore({
      db: createVanillaDB({ path: tmp }),
      tableName: 'queue-revision-fence',
    });
    const existing = createOperationFromActivity({
      appId: 'queue-revision-app',
      revisionId: REVISION_ID,
      activityName: 'work',
      operationId,
      event: { value: 1 },
      trigger: { source: 'event', queueUrl, messageId },
    });
    existing.status = 'COMPLETED';
    await store.createOperation(existing);

    let delivered = false;
    const queue = /** @type {any} */ ({
      receiveMessage: jest.fn(async () => {
        if (delivered) return { Messages: [] };
        delivered = true;
        return {
          Messages: [
            {
              MessageId: messageId,
              ReceiptHandle: receiptHandle,
              Body: JSON.stringify({ activity: 'work', event: { value: 1 } }),
            },
          ],
        };
      }),
      deleteMessage: jest.fn(async () => ({})),
    });
    const execute = jest.fn(async () => ({ shouldNotRun: true }));
    const log = jest.fn();
    const lambdaSvc = await startLambdaService({
      execute,
      poll: {
        queue,
        queueUrls: [queueUrl],
        waitTimeSeconds: 0,
        maxNumberOfMessages: 1,
        operationsStore: store,
        appId: 'queue-revision-app',
        revisionId: OTHER_REVISION_ID,
        log,
      },
    });

    try {
      await waitFor(async () =>
        log.mock.calls.some(
          ([message]) =>
            message === 'lambda poll: invocation failed (message will retry)',
        ),
      );
      expect(execute).not.toHaveBeenCalled();
      expect(queue.deleteMessage).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        'lambda poll: invocation failed (message will retry)',
        expect.objectContaining({
          queueUrl,
          messageId,
          error: expect.stringContaining('OperationRevisionMismatchError'),
        }),
      );
    } finally {
      await lambdaSvc.close();
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  it.each([
    ['activity', { activityName: 'other-work' }],
    ['event', { event: { value: 2 } }],
    [
      'prototype-named event property',
      { event: JSON.parse('{"value":1,"__proto__":{"marker":2}}') },
    ],
    [
      'trigger',
      {
        trigger: {
          source: 'event',
          queueUrl: 'queue://identity',
          messageId: 'message-2',
        },
      },
    ],
    ['context', { context: { requestId: 'changed-request' } }],
  ])(
    'rejects a completed operation ID reused for different %s identity',
    async (_field, changed) => {
      const appId = 'identity-app';
      const operationId = 'stable-operation-id';
      const trigger = {
        source: 'event',
        queueUrl: 'queue://identity',
        messageId: 'message-1',
      };
      const context = { requestId: 'stable-request' };
      const existing = createOperationFromActivity({
        appId,
        revisionId: REVISION_ID,
        activityName: 'work',
        operationId,
        event: { value: 1 },
        context,
        trigger,
      });
      existing.status = 'COMPLETED';
      const duplicate = new Error('already exists');
      duplicate.name = 'OperationAlreadyExistsError';
      const store = {
        createOperation: jest.fn(async () => {
          throw duplicate;
        }),
        getRecords: jest.fn(async () => ({
          operations: [existing],
          actions: existing.getActions(),
        })),
      };
      const execute = jest.fn(async () => undefined);

      await expect(
        runPersistedActivity({
          store: /** @type {any} */ (store),
          appId,
          revisionId: REVISION_ID,
          activityName: 'work',
          operationId,
          event: { value: 1 },
          context,
          trigger,
          ...changed,
          execute,
        }),
      ).rejects.toMatchObject({
        name: 'OperationIdentityConflictError',
        resourceId: getAppResourceId(appId),
        operationId,
      });
      expect(execute).not.toHaveBeenCalled();
    },
  );

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
        return await Function.run(functionName, event, context ?? {}, {
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
        appId: 'lambda-poll-app',
        revisionId: REVISION_ID,
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
      const operationId = getQueueOperationId({
        queueUrl: 'lambda-invoke',
        messageId: sendResult.MessageId,
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

      const resourceId = getAppResourceId('lambda-poll-app');
      const persisted = /** @type {{ operation: any, actions: any[] }} */ (
        await waitFor(async () => {
          const records = await operationsStore.getRecords(
            resourceId,
            operationId,
          );
          const operation = records.operations.find(
            (candidate) => candidate.id === operationId,
          );
          if (!operation || operation.status !== 'COMPLETED') {
            return null;
          }
          return { operation, actions: records.actions };
        })
      );

      expect(persisted.operation.resource_id).toBe(resourceId);
      expect(persisted.operation.revision_id).toBe(REVISION_ID);
      expect(persisted.operation.operation_config).toEqual({
        source: 'app-manifest',
        app_id: 'lambda-poll-app',
        activity_name: fnName,
        context: payload.context,
        trigger: {
          source: 'event',
          queueUrl: 'lambda-invoke',
          messageId: sendResult.MessageId,
        },
      });
      expect(persisted.operation.operation_inputs).toEqual({ who: 'world' });
      expect(persisted.actions).toHaveLength(1);
      expect(persisted.actions[0]).toEqual(
        expect.objectContaining({
          id: 'invoke',
          operation_id: operationId,
          resource_id: resourceId,
          function_name: fnName,
          inputs: { who: 'world' },
          attempt_count: 1,
          status: 'COMPLETED',
        }),
      );

      const duplicateExecute = jest.fn(async () => undefined);
      await expect(
        runPersistedActivity({
          store: operationsStore,
          appId: 'lambda-poll-app',
          revisionId: REVISION_ID,
          activityName: fnName,
          operationId,
          event: payload.event,
          context: payload.context,
          attemptContext: {
            trigger: {
              source: 'event',
              queueUrl: 'lambda-invoke',
              messageId: sendResult.MessageId,
              receiptHandle: 'redelivery-receipt',
            },
          },
          trigger: {
            source: 'event',
            queueUrl: 'lambda-invoke',
            messageId: sendResult.MessageId,
          },
          execute: duplicateExecute,
        }),
      ).resolves.toEqual({
        resourceId,
        operationId,
        status: 'COMPLETED',
        deduplicated: true,
      });
      expect(duplicateExecute).not.toHaveBeenCalled();

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
        appId: 'lambda-poll-app',
        revisionId: REVISION_ID,
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
      const operationId = getQueueOperationId({
        queueUrl: 'lambda-invoke',
        messageId: sendResult.MessageId,
      });

      const resourceId = getAppResourceId('lambda-poll-app');
      const persisted = /** @type {{ operation: any, actions: any[] }} */ (
        await waitFor(async () => {
          const records = await operationsStore.getRecords(
            resourceId,
            operationId,
          );
          const operation = records.operations.find(
            (candidate) => candidate.id === operationId,
          );
          if (!operation || operation.status !== 'FAILED') {
            return null;
          }
          return { operation, actions: records.actions };
        })
      );

      expect(persisted.operation.operation_config).toEqual({
        source: 'app-manifest',
        app_id: 'lambda-poll-app',
        activity_name: 'failing-activity',
        context: payload.context,
        trigger: {
          source: 'event',
          queueUrl: 'lambda-invoke',
          messageId: sendResult.MessageId,
        },
      });
      expect(persisted.operation.operation_inputs).toEqual({ who: 'world' });
      expect(persisted.actions).toHaveLength(1);
      expect(persisted.actions[0]).toEqual(
        expect.objectContaining({
          id: 'invoke',
          operation_id: operationId,
          resource_id: resourceId,
          function_name: 'failing-activity',
          attempt_count: 1,
          status: 'FAILED',
          error: expect.objectContaining({
            message: 'boom',
          }),
        }),
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

      const retryExecute = jest.fn(async () => ({ recovered: true }));
      await expect(
        runPersistedActivity({
          store: operationsStore,
          appId: 'lambda-poll-app',
          revisionId: REVISION_ID,
          activityName: 'failing-activity',
          operationId,
          event: payload.event,
          context: payload.context,
          attemptContext: {
            trigger: {
              source: 'event',
              queueUrl: 'lambda-invoke',
              messageId: sendResult.MessageId,
              receiptHandle: q.Messages[0].ReceiptHandle,
            },
          },
          trigger: {
            source: 'event',
            queueUrl: 'lambda-invoke',
            messageId: sendResult.MessageId,
          },
          execute: retryExecute,
        }),
      ).resolves.toEqual({
        resourceId,
        operationId,
        status: 'COMPLETED',
        deduplicated: false,
      });
      expect(retryExecute).toHaveBeenCalledTimes(1);
      expect(retryExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          context: {
            ...payload.context,
            trigger: {
              source: 'event',
              queueUrl: 'lambda-invoke',
              messageId: sendResult.MessageId,
              receiptHandle: q.Messages[0].ReceiptHandle,
            },
          },
        }),
      );

      const retriedRecords = await operationsStore.getRecords(
        resourceId,
        operationId,
      );
      expect(retriedRecords.operations[0]).toEqual(
        expect.objectContaining({ status: 'COMPLETED', generation: 2 }),
      );
      expect(retriedRecords.actions).toEqual([
        expect.objectContaining({
          id: 'invoke',
          status: 'COMPLETED',
          attempt_count: 2,
          outputs: { recovered: true },
          operation_generation: 2,
        }),
      ]);
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
