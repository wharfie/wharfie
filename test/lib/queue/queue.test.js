/* eslint-disable jest/no-hooks */
/* eslint-disable jest/max-expects */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  jest,
} from '@jest/globals';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VANILLA_ADAPTER_IMPORT = '../../../lambdas/lib/queue/adapters/vanilla.js';
const LMDB_ADAPTER_IMPORT = '../../../lambdas/lib/queue/adapters/lmdb.js';
const SQS_ADAPTER_IMPORT = '../../../lambdas/lib/queue/adapters/sqs.js';
const PATHS_IMPORT = '../../../lambdas/lib/paths.js';

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'wharfie-queue-'));
}

/**
 * Create vanilla adapter with an isolated `paths.data`.
 * @param {string} tmpDataDir
 */
async function createVanillaQueue(tmpDataDir) {
  jest.resetModules();
  await jest.unstable_mockModule(PATHS_IMPORT, () => ({
    default: {
      data: tmpDataDir,
    },
  }));
  const mod = await import(VANILLA_ADAPTER_IMPORT);
  return mod.default();
}

/**
 * Create lmdb adapter with an isolated `paths.data`.
 * @param {string} tmpDataDir
 */
async function createLMDBQueue(tmpDataDir) {
  jest.resetModules();
  await jest.unstable_mockModule(PATHS_IMPORT, () => ({
    default: {
      data: tmpDataDir,
    },
  }));
  const mod = await import(LMDB_ADAPTER_IMPORT);
  return mod.default();
}

/**
 * Minimal, in-memory SQS client implementation with Standard-queue semantics.
 * This is used ONLY for the contract test of the AWS SQS adapter.
 */
function createFakeSQSModule() {
  /** @type {number} */
  let id = 0;

  function nextId(prefix = 'id') {
    id++;
    return `${prefix}-${id}`;
  }

  /**
   * @param {any} n
   * @param {number} min
   * @param {number} max
   * @param {number} fallback
   * @returns {number}
   */
  function clampNumber(n, min, max, fallback) {
    const x = Number(n);
    if (!Number.isFinite(x)) return fallback;
    return Math.min(Math.max(x, min), max);
  }

  class ReceiptHandleIsInvalid extends Error {
    constructor(message = 'ReceiptHandleIsInvalid') {
      super(message);
      this.name = 'ReceiptHandleIsInvalid';
    }
  }

  class QueueDoesNotExist extends Error {
    constructor(message = 'QueueDoesNotExist') {
      super(message);
      this.name = 'QueueDoesNotExist';
    }
  }

  class SendMessageCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class SendMessageBatchCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class DeleteMessageBatchCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class DeleteMessageCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class ReceiveMessageCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class ListQueuesCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class GetQueueUrlCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class GetQueueAttributesCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class SetQueueAttributesCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class CreateQueueCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class DeleteQueueCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class ListQueueTagsCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class TagQueueCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class UntagQueueCommand {
    constructor(input) {
      this.input = input;
    }
  }

  /**
   * @typedef QueueMessageRecord
   * @property {string} MessageId
   * @property {string} Body
   * @property {any} [MessageAttributes]
   * @property {number} SentTimestamp
   * @property {number} AvailableAt
   * @property {number} [InvisibleUntil]
   * @property {string} [ReceiptHandle]
   * @property {number} ReceiveCount
   */

  class SQS {
    constructor(_config = {}) {
      this._config = _config;
      /** @type {Record<string, { Attributes: Record<string,string>, Tags: Record<string,string>, messages: QueueMessageRecord[] }>} */
      this._queues = {};
      this._destroyed = false;
    }

    destroy() {
      this._destroyed = true;
    }

    /**
     * @param {string} queueUrl
     */
    _ensureQueue(queueUrl) {
      if (!this._queues[queueUrl]) {
        const region = process.env.AWS_REGION || 'local';
        const accountId = process.env.AWS_ACCOUNT_ID || '000000000000';
        this._queues[queueUrl] = {
          Tags: {},
          Attributes: {
            DelaySeconds: '0',
            VisibilityTimeout: '30',
            MessageRetentionPeriod: '1209600',
            ReceiveMessageWaitTimeSeconds: '0',
            QueueArn: `arn:aws:sqs:${region}:${accountId}:${queueUrl}`,
          },
          messages: [],
        };
      }
      return this._queues[queueUrl];
    }

    /**
     * @param {string} queueUrl
     */
    _requireQueue(queueUrl) {
      const q = this._queues[queueUrl];
      if (!q) throw new QueueDoesNotExist(`queue ${queueUrl} does not exist`);
      return q;
    }

    /**
     * @param {any} command
     */
    async send(command) {
      switch (command.constructor.name) {
        case 'CreateQueueCommand':
          return this.createQueue(command.input);
        case 'DeleteQueueCommand':
          return this.deleteQueue(command.input);
        case 'GetQueueUrlCommand':
          return this.getQueueUrl(command.input);
        case 'ListQueuesCommand':
          return this.listQueues(command.input);
        case 'GetQueueAttributesCommand':
          return this.getQueueAttributes(command.input);
        case 'SetQueueAttributesCommand':
          return this.setQueueAttributes(command.input);
        case 'ListQueueTagsCommand':
          return this.listQueueTags(command.input);
        case 'TagQueueCommand':
          return this.tagQueue(command.input);
        case 'UntagQueueCommand':
          return this.untagQueue(command.input);
        case 'SendMessageCommand':
          return this.sendMessage(command.input);
        case 'SendMessageBatchCommand':
          return this.sendMessageBatch(command.input);
        case 'ReceiveMessageCommand':
          return this.receiveMessage(command.input);
        case 'DeleteMessageCommand':
          return this.deleteMessage(command.input);
        case 'DeleteMessageBatchCommand':
          return this.deleteMessageBatch(command.input);
      }
      throw new Error(`Unsupported command: ${command.constructor.name}`);
    }

    async createQueue(params) {
      const name = params?.QueueName;
      if (!name) throw new Error('QueueName is required');
      const q = this._ensureQueue(name);

      if (params.Attributes) {
        q.Attributes = { ...q.Attributes, ...(params.Attributes || {}) };
      }
      const tags = params.tags || {};
      q.Tags = { ...q.Tags, ...tags };

      return { QueueUrl: name };
    }

    async deleteQueue(params) {
      const url = params?.QueueUrl;
      if (!url) throw new Error('QueueUrl is required');
      delete this._queues[url];
      return {};
    }

    async getQueueUrl(params) {
      const name = params?.QueueName;
      if (!name) throw new Error('QueueName is required');
      this._requireQueue(name);
      return { QueueUrl: name };
    }

    async listQueues(params = {}) {
      const prefix = params.QueueNamePrefix;
      const QueueUrls = Object.keys(this._queues).filter((u) =>
        prefix ? u.startsWith(prefix) : true,
      );
      return { QueueUrls };
    }

    async getQueueAttributes(params) {
      const url = params?.QueueUrl;
      if (!url) throw new Error('QueueUrl is required');
      const q = this._requireQueue(url);

      const names = params.AttributeNames || ['All'];
      /** @type {Record<string,string>} */
      const Attributes = {};

      if (names.includes('All')) {
        Object.assign(Attributes, q.Attributes);
        return { Attributes };
      }

      for (const n of names) {
        if (q.Attributes[n] !== undefined) Attributes[n] = q.Attributes[n];
      }

      return { Attributes };
    }

    async setQueueAttributes(params) {
      const url = params?.QueueUrl;
      if (!url) throw new Error('QueueUrl is required');
      const q = this._requireQueue(url);
      q.Attributes = { ...q.Attributes, ...(params.Attributes || {}) };
      return {};
    }

    async listQueueTags(params) {
      const url = params?.QueueUrl;
      if (!url) throw new Error('QueueUrl is required');
      const q = this._requireQueue(url);
      return { Tags: { ...q.Tags } };
    }

    async tagQueue(params) {
      const url = params?.QueueUrl;
      if (!url) throw new Error('QueueUrl is required');
      const q = this._requireQueue(url);
      q.Tags = { ...q.Tags, ...(params.Tags || {}) };
      return {};
    }

    async untagQueue(params) {
      const url = params?.QueueUrl;
      if (!url) throw new Error('QueueUrl is required');
      const q = this._requireQueue(url);
      const remove = new Set(params.TagKeys || []);
      q.Tags = Object.fromEntries(
        Object.entries(q.Tags).filter(([k]) => !remove.has(k)),
      );
      return {};
    }

    async sendMessage(params) {
      const url = params?.QueueUrl;
      if (!url) throw new Error('QueueUrl is required');
      const body = params?.MessageBody;
      if (body === undefined) throw new Error('MessageBody is required');

      const q = this._ensureQueue(url);

      const now = Date.now();
      const queueDelay = clampNumber(q.Attributes.DelaySeconds, 0, 900, 0);
      const delaySeconds = clampNumber(params.DelaySeconds, 0, 900, queueDelay);

      const MessageId = nextId('msg');

      q.messages.push({
        MessageId,
        Body: String(body),
        MessageAttributes: params.MessageAttributes,
        SentTimestamp: now,
        AvailableAt: now + delaySeconds * 1000,
        ReceiveCount: 0,
      });

      return { MessageId };
    }

    async sendMessageBatch(params) {
      const url = params?.QueueUrl;
      if (!url) throw new Error('QueueUrl is required');
      const entries = params.Entries || [];
      /** @type {any[]} */
      const Failed = [];

      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        try {
          await this.sendMessage({
            QueueUrl: url,
            MessageBody: e.MessageBody,
            DelaySeconds: e.DelaySeconds,
            MessageAttributes: e.MessageAttributes,
          });
        } catch (err) {
          Failed.push({
            Id: e.Id || String(i),
            Message: err instanceof Error ? err.message : String(err),
            SenderFault: true,
          });
        }
      }

      return { Failed };
    }

    async receiveMessage(params) {
      const url = params?.QueueUrl;
      if (!url) throw new Error('QueueUrl is required');
      const q = this._ensureQueue(url);

      const max = clampNumber(params.MaxNumberOfMessages, 1, 10, 1);

      const queueVisibilitySeconds = clampNumber(
        q.Attributes.VisibilityTimeout,
        0,
        43200,
        30,
      );
      const visibilitySeconds = clampNumber(
        params.VisibilityTimeout,
        0,
        43200,
        queueVisibilitySeconds,
      );

      const now = Date.now();
      /** @type {number[]} */
      const visibleIndexes = [];
      for (let i = 0; i < q.messages.length; i++) {
        const m = q.messages[i];
        if (now < m.AvailableAt) continue;
        if (m.InvisibleUntil !== undefined && now < m.InvisibleUntil) continue;
        visibleIndexes.push(i);
      }

      /** @type {any[]} */
      const Messages = [];

      while (Messages.length < max && visibleIndexes.length > 0) {
        const pick = Math.floor(Math.random() * visibleIndexes.length);
        const idx = visibleIndexes.splice(pick, 1)[0];
        const m = q.messages[idx];

        m.ReceiveCount = (m.ReceiveCount || 0) + 1;
        m.ReceiptHandle = nextId('rh');
        m.InvisibleUntil = now + visibilitySeconds * 1000;

        Messages.push({
          MessageId: m.MessageId,
          ReceiptHandle: m.ReceiptHandle,
          Body: m.Body,
          MessageAttributes: m.MessageAttributes,
          Attributes: {
            ApproximateReceiveCount: String(m.ReceiveCount),
            SentTimestamp: String(m.SentTimestamp),
          },
        });
      }

      return { Messages };
    }

    async deleteMessage(params) {
      const url = params?.QueueUrl;
      if (!url) throw new Error('QueueUrl is required');
      const receipt = params?.ReceiptHandle;
      if (!receipt) throw new Error('ReceiptHandle is required');

      const q = this._requireQueue(url);
      const idx = q.messages.findIndex((m) => m.ReceiptHandle === receipt);
      if (idx === -1) throw new ReceiptHandleIsInvalid();

      q.messages.splice(idx, 1);
      return {};
    }

    async deleteMessageBatch(params) {
      const url = params?.QueueUrl;
      if (!url) throw new Error('QueueUrl is required');
      const entries = params.Entries || [];

      /** @type {any[]} */
      const Failed = [];

      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        try {
          await this.deleteMessage({
            QueueUrl: url,
            ReceiptHandle: e.ReceiptHandle,
          });
        } catch (err) {
          Failed.push({
            Id: e.Id || String(i),
            Message: err instanceof Error ? err.message : String(err),
            SenderFault: true,
          });
        }
      }

      return { Failed };
    }
  }

  return {
    SQS,
    QueueDoesNotExist,
    ReceiptHandleIsInvalid,
    SendMessageCommand,
    SendMessageBatchCommand,
    DeleteMessageBatchCommand,
    DeleteMessageCommand,
    ReceiveMessageCommand,
    ListQueuesCommand,
    GetQueueUrlCommand,
    GetQueueAttributesCommand,
    SetQueueAttributesCommand,
    CreateQueueCommand,
    DeleteQueueCommand,
    ListQueueTagsCommand,
    TagQueueCommand,
    UntagQueueCommand,
  };
}

async function createSQSQueueMocked() {
  jest.resetModules();

  await jest.unstable_mockModule('@aws-sdk/credential-providers', () => ({
    fromNodeProviderChain: () => ({}),
  }));

  await jest.unstable_mockModule('@aws-sdk/client-sqs', () => {
    return createFakeSQSModule();
  });

  const mod = await import(SQS_ADAPTER_IMPORT);
  return mod.default({ region: 'us-east-1' });
}

function runContract(adapter) {
  describe(`${adapter.name} adapter contract`, () => {
    /** @type {any} */
    let queue;

    /** @type {string} */
    let queueUrl;

    /** @type {number} */
    let now;

    /** @type {import("@jest/globals").SpyInstance} */
    let nowSpy;

    /** @type {import("@jest/globals").SpyInstance} */
    let randomSpy;

    beforeEach(async () => {
      now = 0;
      nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
      randomSpy = jest.spyOn(Math, 'random').mockImplementation(() => 0.5);

      queue = await adapter.create();

      const created = await queue.createQueue({
        QueueName: 'contract-queue',
        Attributes: { VisibilityTimeout: '30' },
      });

      queueUrl = created.QueueUrl;
    });

    afterEach(async () => {
      if (nowSpy) nowSpy.mockRestore();
      if (randomSpy) randomSpy.mockRestore();

      if (queue?.close) await queue.close();
      if (adapter.cleanup) await adapter.cleanup();
    });

    test('createQueue/getQueueUrl/listQueues/deleteQueue roundtrip', async () => {
      const list = await queue.listQueues({});
      expect(list.QueueUrls).toContain(queueUrl);
      expect(list.QueueDetails[queueUrl]).toBeDefined();

      const url = await queue.getQueueUrl({ QueueName: 'contract-queue' });
      expect(url).toEqual({ QueueUrl: queueUrl });

      await queue.deleteQueue({ QueueUrl: queueUrl });

      await expect(
        queue.getQueueUrl({ QueueName: 'contract-queue' }),
      ).rejects.toThrow();
    });

    test('sendMessage respects DelaySeconds', async () => {
      await queue.sendMessage({
        QueueUrl: queueUrl,
        MessageBody: 'delayed',
        DelaySeconds: 5,
      });

      const r0 = await queue.receiveMessage({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      });
      expect(r0.Messages || []).toHaveLength(0);

      now = 4999;
      const r1 = await queue.receiveMessage({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      });
      expect(r1.Messages || []).toHaveLength(0);

      now = 5000;
      const r2 = await queue.receiveMessage({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      });
      expect(r2.Messages || []).toHaveLength(1);
      expect(r2.Messages[0].Body).toBe('delayed');

      await queue.deleteMessage({
        QueueUrl: queueUrl,
        ReceiptHandle: r2.Messages[0].ReceiptHandle,
      });

      const r3 = await queue.receiveMessage({ QueueUrl: queueUrl });
      expect(r3.Messages || []).toHaveLength(0);
    });

    test('receiveMessage enforces visibility timeout + receipt handle rotation', async () => {
      const { MessageId } = await queue.sendMessage({
        QueueUrl: queueUrl,
        MessageBody: 'v',
      });
      expect(typeof MessageId).toBe('string');

      const first = await queue.receiveMessage({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 10,
      });

      expect(first.Messages || []).toHaveLength(1);
      const m1 = first.Messages[0];

      const second = await queue.receiveMessage({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      });

      // should be hidden during visibility timeout
      expect(second.Messages || []).toHaveLength(0);

      // after visibility timeout, message can be received again with a NEW receipt handle
      now = 10001;
      const third = await queue.receiveMessage({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 10,
      });
      expect(third.Messages || []).toHaveLength(1);
      const m2 = third.Messages[0];

      expect(m2.MessageId).toBe(m1.MessageId);
      expect(m2.ReceiptHandle).not.toBe(m1.ReceiptHandle);

      // old receipt handle should be invalid after re-receive
      await expect(
        queue.deleteMessage({
          QueueUrl: queueUrl,
          ReceiptHandle: m1.ReceiptHandle,
        }),
      ).rejects.toThrow(/ReceiptHandleIsInvalid/);

      // new receipt handle deletes the message
      await queue.deleteMessage({
        QueueUrl: queueUrl,
        ReceiptHandle: m2.ReceiptHandle,
      });

      const after = await queue.receiveMessage({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      });
      expect(after.Messages || []).toHaveLength(0);
    });

    test('sendMessageBatch + deleteMessageBatch roundtrip', async () => {
      await queue.sendMessageBatch({
        QueueUrl: queueUrl,
        Entries: [
          { Id: 'a', MessageBody: 'a' },
          { Id: 'b', MessageBody: 'b' },
          { Id: 'c', MessageBody: 'c' },
          { Id: 'd', MessageBody: 'd' },
          { Id: 'e', MessageBody: 'e' },
          { Id: 'f', MessageBody: 'f' },
          { Id: 'g', MessageBody: 'g' },
        ],
      });

      const res = await queue.receiveMessage({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 30,
      });

      expect(res.Messages || []).toHaveLength(7);
      const bodies = (res.Messages || []).map((m) => m.Body).sort();
      expect(bodies).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

      await queue.deleteMessageBatch({
        QueueUrl: queueUrl,
        Entries: (res.Messages || []).map((m, i) => ({
          Id: `del-${i}`,
          ReceiptHandle: m.ReceiptHandle,
        })),
      });

      const after = await queue.receiveMessage({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
      });

      expect(after.Messages || []).toHaveLength(0);
    });

    test('tagQueue/listQueueTags/untagQueue', async () => {
      await queue.tagQueue({
        QueueUrl: queueUrl,
        Tags: { a: '1', b: '2' },
      });

      const t1 = await queue.listQueueTags({ QueueUrl: queueUrl });
      expect(t1.Tags).toEqual({ a: '1', b: '2' });

      await queue.untagQueue({
        QueueUrl: queueUrl,
        TagKeys: ['a'],
      });

      const t2 = await queue.listQueueTags({ QueueUrl: queueUrl });
      expect(t2.Tags).toEqual({ b: '2' });
    });

    test('setQueueAttributes/getQueueAttributes', async () => {
      await queue.setQueueAttributes({
        QueueUrl: queueUrl,
        Attributes: { VisibilityTimeout: '5', DelaySeconds: '2' },
      });

      const res = await queue.getQueueAttributes({
        QueueUrl: queueUrl,
        AttributeNames: ['VisibilityTimeout', 'DelaySeconds'],
      });

      expect(res.Attributes).toEqual({
        VisibilityTimeout: '5',
        DelaySeconds: '2',
      });
    });

    test('enqueue/enqueueBatch/reenqueue helpers', async () => {
      await queue.enqueue({ t: 'one' }, queueUrl, 0);

      const r1 = await queue.receiveMessage({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 30,
      });

      expect(r1.Messages || []).toHaveLength(1);
      expect(JSON.parse(r1.Messages[0].Body)).toEqual({ t: 'one' });
      await queue.deleteMessage({
        QueueUrl: queueUrl,
        ReceiptHandle: r1.Messages[0].ReceiptHandle,
      });

      await queue.enqueueBatch([{ t: 'two' }, { t: 'three' }], queueUrl);

      const r2 = await queue.receiveMessage({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 30,
      });

      expect(r2.Messages || []).toHaveLength(2);
      const payloads = (r2.Messages || [])
        .map((m) => JSON.parse(m.Body))
        .sort((a, b) => a.t.localeCompare(b.t));
      expect(payloads).toEqual([{ t: 'three' }, { t: 'two' }]);

      await queue.deleteMessageBatch({
        QueueUrl: queueUrl,
        Entries: (r2.Messages || []).map((m, i) => ({
          Id: `d-${i}`,
          ReceiptHandle: m.ReceiptHandle,
        })),
      });

      // reenqueue uses a random delay between 30-90 seconds
      await queue.reenqueue({ t: 'later' }, queueUrl);

      const r3 = await queue.receiveMessage({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      });
      expect(r3.Messages || []).toHaveLength(0);

      now = 59999;
      const r4 = await queue.receiveMessage({ QueueUrl: queueUrl });
      expect(r4.Messages || []).toHaveLength(0);

      now = 60000;
      const r5 = await queue.receiveMessage({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 30,
      });
      expect(r5.Messages || []).toHaveLength(1);
      expect(JSON.parse(r5.Messages[0].Body)).toEqual({ t: 'later' });

      await queue.deleteMessage({
        QueueUrl: queueUrl,
        ReceiptHandle: r5.Messages[0].ReceiptHandle,
      });
    });

    test('close does not throw', async () => {
      await expect(queue.close()).resolves.toBeUndefined();
    });
  });
}

describe('QueueClient contract suite', () => {
  let tmpDataDir;

  beforeEach(() => {
    tmpDataDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDataDir, { recursive: true, force: true });
  });

  test('smoke: tmp data dir exists', async () => {
    expect(existsSync(tmpDataDir)).toBe(true);
  });

  test('load adapters', async () => {
    const vanilla = await createVanillaQueue(tmpDataDir);
    await vanilla.close();

    const sqs = await createSQSQueueMocked();
    await sqs.close();

    const lmdb = await createLMDBQueue(tmpDataDir);
    await lmdb.close();
  });

  runContract({
    name: 'vanilla',
    create: () => createVanillaQueue(tmpDataDir),
  });
  runContract({ name: 'lmdb', create: () => createLMDBQueue(tmpDataDir) });
  runContract({ name: 'sqs (mocked)', create: () => createSQSQueueMocked() });
});
