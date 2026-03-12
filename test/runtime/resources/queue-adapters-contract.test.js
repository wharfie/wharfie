/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VANILLA_QUEUE_IMPORT = '../../../lambdas/lib/queue/adapters/vanilla.js';
const LMDB_QUEUE_IMPORT = '../../../lambdas/lib/queue/adapters/lmdb.js';
const AWS_SQS_IMPORT = '../../../lambdas/lib/aws/sqs.js';
const SQS_QUEUE_IMPORT = '../../../lambdas/lib/queue/adapters/sqs.js';

/**
 * @returns {string} - Result.
 */
function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'wharfie-queue-contract-'));
}

/**
 * @param {string} tmpDir - tmpDir.
 * @returns {Promise<import('../../../lambdas/lib/queue/base.js').QueueClient>} - Result.
 */
async function createVanillaQueue(tmpDir) {
  jest.resetModules();
  const mod = await import(VANILLA_QUEUE_IMPORT);
  return mod.default({ path: tmpDir });
}

/**
 * @param {string} tmpDir - tmpDir.
 * @returns {Promise<import('../../../lambdas/lib/queue/base.js').QueueClient>} - Result.
 */
async function createLMDBQueue(tmpDir) {
  jest.resetModules();
  const mod = await import(LMDB_QUEUE_IMPORT);
  return mod.default({ path: tmpDir });
}

/**
 * @param {{
 *   name: string,
 *   create: (tmpDir: string) => Promise<import('../../../lambdas/lib/queue/base.js').QueueClient>
 * }} adapter - adapter.
 */
function runQueueContract(adapter) {
  describe(`${adapter.name} queue adapter contract`, () => {
    /** @type {string} */
    let tmpDir = '';
    /** @type {import('../../../lambdas/lib/queue/base.js').QueueClient | undefined} */
    let queue;

    afterEach(async () => {
      if (queue) {
        await queue.close();
        queue = undefined;
      }

      if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = '';
      }
    });

    it('supports queue management and visibility semantics', async () => {
      tmpDir = makeTmpDir();
      queue = await adapter.create(tmpDir);

      const created = await queue.createQueue({
        QueueName: 'jobs',
        Attributes: { VisibilityTimeout: '30' },
        tags: { env: 'test' },
      });

      const queueUrl = created.QueueUrl;

      expect(queueUrl).toBe('jobs');

      const listed = await queue.listQueues({ QueueNamePrefix: 'jo' });

      expect(listed.QueueUrls).toEqual(['jobs']);

      const { QueueUrl } = await queue.getQueueUrl({ QueueName: 'jobs' });

      expect(QueueUrl).toBe('jobs');

      await queue.setQueueAttributes({
        QueueUrl: 'jobs',
        Attributes: {
          DelaySeconds: '0',
          ReceiveMessageWaitTimeSeconds: '0',
          VisibilityTimeout: '30',
        },
      });

      const attributes = await queue.getQueueAttributes({
        QueueUrl: 'jobs',
        AttributeNames: ['All'],
      });

      expect(attributes.Attributes?.VisibilityTimeout).toBe('30');

      const tags = await queue.listQueueTags({ QueueUrl: 'jobs' });

      expect(tags.Tags).toEqual({ env: 'test' });

      await queue.sendMessage({
        QueueUrl: 'jobs',
        MessageBody: JSON.stringify({ type: 'one' }),
      });

      const first = await queue.receiveMessage({
        QueueUrl: 'jobs',
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 0,
        VisibilityTimeout: 30,
      });

      expect(first.Messages?.[0]?.Body).toBe(JSON.stringify({ type: 'one' }));

      const hidden = await queue.receiveMessage({
        QueueUrl: 'jobs',
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 0,
      });

      expect(hidden.Messages).toEqual([]);

      const receiptHandle = first.Messages?.[0]?.ReceiptHandle;
      if (!receiptHandle) {
        throw new Error('Expected receipt handle from first receive');
      }

      await queue.deleteMessage({
        QueueUrl: 'jobs',
        ReceiptHandle: receiptHandle,
      });

      const afterDelete = await queue.receiveMessage({
        QueueUrl: 'jobs',
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 0,
      });

      expect(afterDelete.Messages).toEqual([]);
    });

    it('supports enqueueBatch helper semantics', async () => {
      tmpDir = makeTmpDir();
      queue = await adapter.create(tmpDir);
      await queue.createQueue({ QueueName: 'batch' });

      await queue.enqueueBatch(
        [{ job: 'one' }, { job: 'two' }, { job: 'three' }],
        'batch',
      );

      const received = await queue.receiveMessage({
        QueueUrl: 'batch',
        MaxNumberOfMessages: 3,
        WaitTimeSeconds: 0,
        VisibilityTimeout: 0,
      });

      expect(
        (received.Messages || []).map((message) => message.Body).sort(),
      ).toEqual([
        JSON.stringify({ job: 'one' }),
        JSON.stringify({ job: 'three' }),
        JSON.stringify({ job: 'two' }),
      ]);
    });
  });
}

runQueueContract({
  name: 'vanilla',
  create: createVanillaQueue,
});

runQueueContract({
  name: 'lmdb',
  create: createLMDBQueue,
});

describe('queue adapter wiring', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('sqs adapter forwards client config without network access', async () => {
    jest.resetModules();
    jest.unstable_mockModule(AWS_SQS_IMPORT, () => ({
      default: class FakeSQS {
        /**
         * @param {Record<string, any>} options - options.
         */
        constructor(options) {
          this.options = options;
        }

        /**
         * @returns {Promise<void>} - Result.
         */
        async close() {}
      },
    }));

    const mod = await import(SQS_QUEUE_IMPORT);
    const queue = mod.default({
      region: 'us-east-2',
      endpoint: 'http://localhost:4566',
    });

    expect(queue.options).toMatchObject({
      region: 'us-east-2',
      endpoint: 'http://localhost:4566',
    });

    await queue.close();
  });
});
