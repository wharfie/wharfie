import { open } from 'lmdb';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import paths from '../../paths.js';
import { createId } from '../../id.js';

/**
 * @typedef {Record<string, string>} QueueAttributes
 * @typedef {Record<string, string>} QueueTags
 * @typedef QueueMessageRecord
 * @property {string} MessageId - MessageId.
 * @property {string} Body - Body.
 * @property {any} [MessageAttributes] - MessageAttributes.
 * @property {number} SentTimestamp - SentTimestamp.
 * @property {number} AvailableAt - AvailableAt.
 * @property {number} [InvisibleUntil] - InvisibleUntil.
 * @property {string} [ReceiptHandle] - ReceiptHandle.
 * @property {number} ReceiveCount - ReceiveCount.
 * @typedef QueueRecord
 * @property {QueueAttributes} Attributes - Attributes.
 * @property {QueueTags} Tags - Tags.
 * @property {QueueMessageRecord[]} messages - messages.
 * @typedef QueueState
 * @property {Record<string, QueueRecord>} queues - queues.
 */

/**
 * @typedef CreateLMDBQueueOptions
 * @property {string} [path] - Base directory to store queue state. Defaults to `paths.data`. [queue_path]
 */

/**
 * LMDB-backed local queue adapter implementing SQS Standard-like semantics.
 *
 * Implementation notes (mirrors the DB LMDB adapter intent):
 * - Use synchronous LMDB writes to avoid background commit scheduling keeping Jest alive.
 * - Persist state on each mutation so callers don’t need to call close() for durability.
 * @param {CreateLMDBQueueOptions} [options] - options.
 * @returns {import('../base.js').QueueClient} - Result.
 */
export default function createLMDBQueue(options = {}) {
  const dbRoot = options.path
    ? join(options.path, 'queue-lmdb')
    : join(paths.data, 'queue-lmdb');
  mkdirSync(dbRoot, { recursive: true });

  const env = open({
    path: dbRoot,
    eventTurnBatching: false,
    commitDelay: 0,
  });

  const store = env.openDB({ name: 'queue_state' });

  let closed = false;

  /** @type {QueueState} */
  const state = store.get('state') || { queues: {} };

  /**
   * @template T
   * @param {T} v - v.
   * @returns {T} - Result.
   */
  function deepClone(v) {
    if (v === undefined) return /** @type {any} */ (undefined);
    return JSON.parse(JSON.stringify(v));
  }

  /**
   * @returns {import('@smithy/types').ResponseMetadata} - Result.
   */
  function emptyMetadata() {
    return /** @type {any} */ ({});
  }

  /**
   * Persist current state (sync).
   */
  function persist() {
    store.putSync('state', state);
  }

  /**
   * @param {any} n - n.
   * @param {number} min - min.
   * @param {number} max - max.
   * @param {number} fallback - fallback.
   * @returns {number} - Result.
   */
  function clampNumber(n, min, max, fallback) {
    const x = Number(n);
    if (!Number.isFinite(x)) return fallback;
    return Math.min(Math.max(x, min), max);
  }

  /**
   * @param {string} queueUrl - queueUrl.
   * @returns {QueueRecord} - Result.
   */
  function ensureQueue(queueUrl) {
    if (!state.queues[queueUrl]) {
      const region = process.env.AWS_REGION || 'local';
      const accountId = process.env.AWS_ACCOUNT_ID || '000000000000';
      state.queues[queueUrl] = {
        messages: [],
        Tags: {},
        Attributes: {
          DelaySeconds: '0',
          VisibilityTimeout: '30',
          MessageRetentionPeriod: '1209600',
          ReceiveMessageWaitTimeSeconds: '0',
          QueueArn: `arn:aws:sqs:${region}:${accountId}:${queueUrl}`,
        },
      };
      persist();
    }
    return state.queues[queueUrl];
  }

  /**
   * @param {string} queueUrl - queueUrl.
   * @returns {QueueRecord} - Result.
   */
  function requireQueue(queueUrl) {
    const q = state.queues[queueUrl];
    if (!q) throw new Error(`queue ${queueUrl} does not exist`);
    return q;
  }

  /**
   * @param {QueueRecord} queue - queue.
   * @param {number} now - now.
   */
  function pruneExpired(queue, now) {
    const retentionSeconds = clampNumber(
      queue.Attributes?.MessageRetentionPeriod,
      60,
      1209600,
      1209600,
    );
    const cutoff = now - retentionSeconds * 1000;
    const before = queue.messages.length;
    queue.messages = queue.messages.filter((m) => m.SentTimestamp >= cutoff);
    if (queue.messages.length !== before) persist();
  }

  /**
   * @param {QueueMessageRecord} m - m.
   * @param {number} now - now.
   * @returns {boolean} - Result.
   */
  function isVisible(m, now) {
    if (now < (m.AvailableAt || 0)) return false;
    const invisibleUntil = m.InvisibleUntil;
    if (invisibleUntil !== undefined && now < invisibleUntil) return false;
    return true;
  }

  /**
   * @param {QueueRecord} queue - queue.
   * @param {number} max - max.
   * @param {number} now - now.
   * @param {number} visibilityTimeoutMs - visibilityTimeoutMs.
   * @returns {import("@aws-sdk/client-sqs").Message[]} - Result.
   */
  function takeVisible(queue, max, now, visibilityTimeoutMs) {
    /** @type {number[]} */
    const visibleIndexes = [];
    for (let i = 0; i < queue.messages.length; i++) {
      if (isVisible(queue.messages[i], now)) visibleIndexes.push(i);
    }

    /** @type {import("@aws-sdk/client-sqs").Message[]} */
    const out = [];

    let mutated = false;

    while (out.length < max && visibleIndexes.length > 0) {
      const pick = Math.floor(Math.random() * visibleIndexes.length);
      const idx = visibleIndexes.splice(pick, 1)[0];

      const rec = queue.messages[idx];
      rec.ReceiveCount = (rec.ReceiveCount || 0) + 1;

      const receiptHandle = createId();
      rec.ReceiptHandle = receiptHandle;
      rec.InvisibleUntil = now + visibilityTimeoutMs;

      mutated = true;

      out.push(
        /** @type {any} */ ({
          MessageId: rec.MessageId,
          ReceiptHandle: receiptHandle,
          Body: rec.Body,
          MessageAttributes: deepClone(rec.MessageAttributes),
          Attributes: {
            ApproximateReceiveCount: String(rec.ReceiveCount),
            SentTimestamp: String(rec.SentTimestamp),
          },
        }),
      );
    }

    if (mutated) persist();

    return out;
  }

  /**
   * @param {import("@aws-sdk/client-sqs").CreateQueueCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-sqs").CreateQueueCommandOutput>} - Result.
   */
  async function createQueue(params) {
    const name = params?.QueueName;
    if (!name) throw new Error('QueueName is required');

    const q = ensureQueue(name);

    if (params.Attributes && typeof params.Attributes === 'object') {
      q.Attributes = { ...q.Attributes, ...deepClone(params.Attributes) };
    }

    const tags = /** @type {any} */ (params)?.tags;
    if (tags && typeof tags === 'object') {
      q.Tags = { ...q.Tags, ...deepClone(tags) };
    }

    persist();
    return { $metadata: emptyMetadata(), QueueUrl: name };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").DeleteQueueCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-sqs").DeleteQueueCommandOutput>} - Result.
   */
  async function deleteQueue(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');
    if (state.queues[queueUrl]) {
      delete state.queues[queueUrl];
      persist();
    }
    return { $metadata: emptyMetadata() };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").GetQueueUrlCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-sqs").GetQueueUrlCommandOutput>} - Result.
   */
  async function getQueueUrl(params) {
    const name = params?.QueueName;
    if (!name) throw new Error('QueueName is required');
    requireQueue(name);
    return { $metadata: emptyMetadata(), QueueUrl: name };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").GetQueueAttributesCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-sqs").GetQueueAttributesCommandOutput>} - Result.
   */
  async function getQueueAttributes(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');
    const q = requireQueue(queueUrl);

    /** @type {Record<string, string>} */
    const Attributes = {};
    const names = params?.AttributeNames || ['All'];

    if (names.includes('All')) {
      Object.assign(Attributes, deepClone(q.Attributes || {}));
      return { $metadata: emptyMetadata(), Attributes };
    }

    for (const n of names) {
      if (q.Attributes && q.Attributes[n] !== undefined) {
        Attributes[n] = q.Attributes[n];
      }
    }
    return { $metadata: emptyMetadata(), Attributes };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").SetQueueAttributesCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-sqs").SetQueueAttributesCommandOutput>} - Result.
   */
  async function setQueueAttributes(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');
    const q = requireQueue(queueUrl);
    q.Attributes = { ...q.Attributes, ...(deepClone(params.Attributes) || {}) };
    persist();
    return { $metadata: emptyMetadata() };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").ListQueueTagsCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-sqs").ListQueueTagsCommandOutput>} - Result.
   */
  async function listQueueTags(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');
    const q = requireQueue(queueUrl);
    return { $metadata: emptyMetadata(), Tags: deepClone(q.Tags || {}) };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").TagQueueCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-sqs").TagQueueCommandOutput>} - Result.
   */
  async function tagQueue(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');
    const q = requireQueue(queueUrl);
    q.Tags = { ...q.Tags, ...(deepClone(params.Tags) || {}) };
    persist();
    return { $metadata: emptyMetadata() };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").UntagQueueCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-sqs").UntagQueueCommandOutput>} - Result.
   */
  async function untagQueue(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');
    const q = requireQueue(queueUrl);
    const remove = new Set(params.TagKeys || []);
    q.Tags = Object.fromEntries(
      Object.entries(q.Tags || {}).filter(([k]) => !remove.has(k)),
    );
    persist();
    return { $metadata: emptyMetadata() };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").ListQueuesCommandInput} [params] - params.
   * @returns {Promise<import("../base.js").listQueuesOutput>} - Result.
   */
  async function listQueues(params = {}) {
    const prefix = params.QueueNamePrefix
      ? String(params.QueueNamePrefix)
      : undefined;

    const urls = Object.keys(state.queues).filter((u) =>
      prefix ? u.startsWith(prefix) : true,
    );

    /** @type {Record<string, any>} */
    const details = {};
    for (const url of urls) {
      const { Attributes } = await getQueueAttributes({
        QueueUrl: url,
        AttributeNames: ['All'],
      });
      details[url] = Attributes;
    }

    return { QueueUrls: urls, QueueDetails: details };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").SendMessageRequest} params - params.
   * @returns {Promise<import("@aws-sdk/client-sqs").SendMessageResult>} - Result.
   */
  async function sendMessage(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');
    const body = params?.MessageBody;
    if (body === undefined) throw new Error('MessageBody is required');

    const q = ensureQueue(queueUrl);

    const now = Date.now();
    pruneExpired(q, now);

    const queueDelay = clampNumber(q.Attributes?.DelaySeconds, 0, 900, 0);
    const delaySeconds = clampNumber(params.DelaySeconds, 0, 900, queueDelay);

    const MessageId = createId();

    /** @type {QueueMessageRecord} */
    const rec = {
      MessageId,
      Body: String(body),
      MessageAttributes: deepClone(params.MessageAttributes),
      SentTimestamp: now,
      AvailableAt: now + delaySeconds * 1000,
      ReceiveCount: 0,
    };

    q.messages.push(rec);
    persist();

    return { MessageId };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").SendMessageBatchRequest} params - params.
   * @returns {Promise<import("@aws-sdk/client-sqs").SendMessageBatchResult>} - Result.
   */
  async function sendMessageBatch(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');

    const entries = params.Entries || [];
    /** @type {import("@aws-sdk/client-sqs").SendMessageBatchResultEntry[]} */
    const Successful = [];
    /** @type {import("@aws-sdk/client-sqs").BatchResultErrorEntry[]} */
    const Failed = [];

    await Promise.all(
      entries.map(async (e, idx) => {
        try {
          const result = await sendMessage({
            QueueUrl: queueUrl,
            MessageBody: e.MessageBody,
            DelaySeconds: e.DelaySeconds,
            MessageAttributes: e.MessageAttributes,
          });
          const messageId = result.MessageId || createId();
          Successful.push({
            Id: e.Id || String(idx),
            MessageId: messageId,
            MD5OfMessageBody: '00000000000000000000000000000000',
          });
        } catch (err) {
          Failed.push({
            Id: e.Id || String(idx),
            Code: err instanceof Error ? err.name || 'Error' : 'Error',
            Message: err instanceof Error ? err.message : String(err),
            SenderFault: true,
          });
        }
      }),
    );

    return { Successful, Failed };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").ReceiveMessageRequest} params - params.
   * @returns {Promise<import("@aws-sdk/client-sqs").ReceiveMessageResult>} - Result.
   */
  async function receiveMessage(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');

    const q = ensureQueue(queueUrl);

    const max = clampNumber(params.MaxNumberOfMessages, 1, 10, 1);

    const queueVisibilitySeconds = clampNumber(
      q.Attributes?.VisibilityTimeout,
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

    const queueWaitSeconds = clampNumber(
      q.Attributes?.ReceiveMessageWaitTimeSeconds,
      0,
      20,
      0,
    );
    const waitSeconds = clampNumber(
      params.WaitTimeSeconds,
      0,
      20,
      queueWaitSeconds,
    );

    const start = Date.now();
    while (true) {
      const now = Date.now();
      pruneExpired(q, now);

      const Messages = takeVisible(q, max, now, visibilitySeconds * 1000);

      if (Messages.length > 0 || waitSeconds === 0) {
        return { Messages };
      }

      const remaining = waitSeconds * 1000 - (now - start);
      if (remaining <= 0) return { Messages: [] };

      const slice = Math.min(200, remaining);
      await new Promise((resolve) => setTimeout(resolve, slice));
    }
  }

  /**
   * @param {import("@aws-sdk/client-sqs").DeleteMessageRequest} params - params.
   */
  async function deleteMessage(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');
    const receipt = params?.ReceiptHandle;
    if (!receipt) throw new Error('ReceiptHandle is required');

    const q = requireQueue(queueUrl);

    const idx = q.messages.findIndex((m) => m.ReceiptHandle === receipt);
    if (idx === -1) {
      const err = new Error('ReceiptHandleIsInvalid');
      // eslint-disable-next-line no-underscore-dangle
      err.name = 'ReceiptHandleIsInvalid';
      throw err;
    }

    q.messages.splice(idx, 1);
    persist();
  }

  /**
   * @param {import("@aws-sdk/client-sqs").DeleteMessageBatchRequest} params - params.
   * @returns {Promise<import("@aws-sdk/client-sqs").DeleteMessageBatchResult>} - Result.
   */
  async function deleteMessageBatch(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');
    const entries = params.Entries || [];

    /** @type {import("@aws-sdk/client-sqs").DeleteMessageBatchResultEntry[]} */
    const Successful = [];
    /** @type {import("@aws-sdk/client-sqs").BatchResultErrorEntry[]} */
    const Failed = [];

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      try {
        await deleteMessage({
          QueueUrl: queueUrl,
          ReceiptHandle: e.ReceiptHandle,
        });
        Successful.push({ Id: e.Id || String(i) });
      } catch (err) {
        Failed.push({
          Id: e.Id || String(i),
          Code: err instanceof Error ? err.name || 'Error' : 'Error',
          Message: err instanceof Error ? err.message : String(err),
          SenderFault: true,
        });
      }
    }

    return { Successful, Failed };
  }

  /**
   * @param {any} event - event.
   * @param {string} queueUrl - queueUrl.
   * @param {number} [delay] - delay.
   */
  async function enqueue(event, queueUrl, delay = 0) {
    await sendMessage({
      MessageBody: JSON.stringify(event),
      QueueUrl: queueUrl,
      DelaySeconds: Math.min(Math.max(delay, 0), 60),
    });
  }

  /**
   * @param {any[]} events - events.
   * @param {string} queueUrl - queueUrl.
   */
  async function enqueueBatch(events, queueUrl) {
    const copy = [...events];
    const promises = [];
    while (copy.length > 0) {
      promises.push(
        sendMessageBatch({
          Entries: copy.splice(0, 10).map((event) => ({
            Id: createId(),
            MessageBody: JSON.stringify(event),
          })),
          QueueUrl: queueUrl,
        }),
      );
    }
    await Promise.all(promises);
  }

  /**
   * @param {any} event - event.
   * @param {string} queueUrl - queueUrl.
   */
  async function reenqueue(event, queueUrl) {
    await sendMessage({
      MessageBody: JSON.stringify(event),
      QueueUrl: queueUrl,
      DelaySeconds: Math.floor(Math.random() * (90 - 30) + 30),
    });
  }

  /**
   * Close LMDB resources.
   * @returns {Promise<void>} - Result.
   */
  async function close() {
    if (closed) return;
    closed = true;

    try {
      if (typeof store.close === 'function') store.close();
    } catch {
      /* ignore */
    }

    try {
      if (typeof env.close === 'function') env.close();
    } catch {
      /* ignore */
    }
  }

  return {
    sendMessage,
    sendMessageBatch,
    deleteMessageBatch,
    deleteMessage,
    receiveMessage,
    enqueue,
    enqueueBatch,
    reenqueue,
    listQueues,
    getQueueUrl,
    getQueueAttributes,
    setQueueAttributes,
    createQueue,
    deleteQueue,
    listQueueTags,
    tagQueue,
    untagQueue,
    close,
  };
}
