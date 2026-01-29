import { promises as fsp, existsSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

import paths from '../../paths.js';
import { createId } from '../../id.js';

/**
 * @typedef {Record<string, string>} QueueAttributes
 * @typedef {Record<string, string>} QueueTags
 *
 * @typedef QueueMessageRecord
 * @property {string} MessageId
 * @property {string} Body
 * @property {any} [MessageAttributes]
 * @property {number} SentTimestamp
 * @property {number} AvailableAt
 * @property {number} [InvisibleUntil]
 * @property {string} [ReceiptHandle]
 * @property {number} ReceiveCount
 *
 * @typedef QueueRecord
 * @property {QueueAttributes} Attributes
 * @property {QueueTags} Tags
 * @property {QueueMessageRecord[]} messages
 *
 * @typedef QueueState
 * @property {Record<string, QueueRecord>} queues
 */

/**
 * @typedef CreateVanillaQueueOptions
 * @property {string} [path] - Base directory to store queue state. Defaults to `paths.data`. [queue_path]
 */

/**
 * Vanilla local queue adapter implementing an SQS Standard-like queue.
 *
 * Guarantees (matches SQS Standard / non-FIFO, best-effort):
 * - Messages are NOT removed on receive (must delete with receipt handle)
 * - Visibility timeout hides received messages temporarily
 * - DelaySeconds postpones first visibility
 * - Ordering is best-effort (we intentionally do not enforce FIFO)
 *
 * Persistence:
 * - State is loaded from disk on startup (if present)
 * - State is written to disk on close()
 *
 * @param {CreateVanillaQueueOptions} [options] -
 * @returns {import('../base.js').QueueClient} -
 */
export default function createVanillaQueue(options = {}) {
  /** @type {QueueState} */
  let state = { queues: {} };

  const queueFilePath = options.path
    ? join(options.path, 'queue.json')
    : join(paths.data, 'queue.json');

  const queueDir = dirname(queueFilePath);

  if (existsSync(queueFilePath)) {
    try {
      const data = readFileSync(queueFilePath, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object') state = parsed;
    } catch {
      // ignore; start fresh
      state = { queues: {} };
    }
  }

  /**
   * @template T
   * @param {T} v
   * @returns {T}
   */
  function deepClone(v) {
    if (v === undefined) return /** @type {any} */ (undefined);
    return JSON.parse(JSON.stringify(v));
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

  /**
   * @param {string} queueUrl
   * @returns {QueueRecord}
   */
  function ensureQueue(queueUrl) {
    if (!state.queues[queueUrl]) {
      const region = process.env.AWS_REGION || 'local';
      const accountId = process.env.AWS_ACCOUNT_ID || '000000000000';
      state.queues[queueUrl] = {
        messages: [],
        Tags: {},
        Attributes: {
          // Common SQS attributes (string values)
          DelaySeconds: '0',
          VisibilityTimeout: '30',
          MessageRetentionPeriod: '1209600',
          ReceiveMessageWaitTimeSeconds: '0',
          QueueArn: `arn:aws:sqs:${region}:${accountId}:${queueUrl}`,
        },
      };
    }
    return state.queues[queueUrl];
  }

  /**
   * @param {string} queueUrl
   * @returns {QueueRecord}
   */
  function requireQueue(queueUrl) {
    const q = state.queues[queueUrl];
    if (!q) throw new Error(`queue ${queueUrl} does not exist`);
    return q;
  }

  /**
   * Remove messages that exceed retention.
   * @param {QueueRecord} queue
   * @param {number} now
   */
  function pruneExpired(queue, now) {
    const retentionSeconds = clampNumber(
      queue.Attributes?.MessageRetentionPeriod,
      60,
      1209600,
      1209600,
    );
    const cutoff = now - retentionSeconds * 1000;
    queue.messages = queue.messages.filter((m) => m.SentTimestamp >= cutoff);
  }

  /**
   * @param {QueueMessageRecord} m
   * @param {number} now
   * @returns {boolean}
   */
  function isVisible(m, now) {
    if (now < (m.AvailableAt || 0)) return false;
    const invisibleUntil = m.InvisibleUntil;
    if (invisibleUntil !== undefined && now < invisibleUntil) return false;
    return true;
  }

  /**
   * @param {QueueRecord} queue
   * @param {number} max
   * @param {number} now
   * @param {number} visibilityTimeoutMs
   * @returns {import("@aws-sdk/client-sqs").Message[]}
   */
  function takeVisible(queue, max, now, visibilityTimeoutMs) {
    /** @type {number[]} */
    const visibleIndexes = [];
    for (let i = 0; i < queue.messages.length; i++) {
      if (isVisible(queue.messages[i], now)) visibleIndexes.push(i);
    }

    /** @type {import("@aws-sdk/client-sqs").Message[]} */
    const out = [];

    while (out.length < max && visibleIndexes.length > 0) {
      // Best-effort ordering: pick a random visible message like SQS Standard can.
      const pick = Math.floor(Math.random() * visibleIndexes.length);
      const idx = visibleIndexes.splice(pick, 1)[0];

      const rec = queue.messages[idx];
      rec.ReceiveCount = (rec.ReceiveCount || 0) + 1;

      const receiptHandle = createId();
      rec.ReceiptHandle = receiptHandle;
      rec.InvisibleUntil = now + visibilityTimeoutMs;

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

    return out;
  }

  /**
   * @param {import("@aws-sdk/client-sqs").CreateQueueCommandInput} params
   * @returns {Promise<import("@aws-sdk/client-sqs").CreateQueueCommandOutput>}
   */
  async function createQueue(params) {
    const name = params?.QueueName;
    if (!name) throw new Error('QueueName is required');

    const q = ensureQueue(name);

    // Apply provided attributes
    if (params.Attributes && typeof params.Attributes === 'object') {
      q.Attributes = { ...q.Attributes, ...deepClone(params.Attributes) };
    }

    // CreateQueue supports tags in AWS SDK v3 via `tags` (lowercase).
    const tags = /** @type {any} */ (params)?.tags;
    if (tags && typeof tags === 'object') {
      q.Tags = { ...q.Tags, ...deepClone(tags) };
    }

    return { QueueUrl: name };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").DeleteQueueCommandInput} params
   * @returns {Promise<import("@aws-sdk/client-sqs").DeleteQueueCommandOutput>}
   */
  async function deleteQueue(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');
    delete state.queues[queueUrl];
    return {};
  }

  /**
   * @param {import("@aws-sdk/client-sqs").GetQueueUrlCommandInput} params
   * @returns {Promise<import("@aws-sdk/client-sqs").GetQueueUrlCommandOutput>}
   */
  async function getQueueUrl(params) {
    const name = params?.QueueName;
    if (!name) throw new Error('QueueName is required');
    requireQueue(name);
    return { QueueUrl: name };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").GetQueueAttributesCommandInput} params
   * @returns {Promise<import("@aws-sdk/client-sqs").GetQueueAttributesCommandOutput>}
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
      return { Attributes };
    }

    for (const n of names) {
      if (q.Attributes && q.Attributes[n] !== undefined) {
        Attributes[n] = q.Attributes[n];
      }
    }
    return { Attributes };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").SetQueueAttributesCommandInput} params
   * @returns {Promise<import("@aws-sdk/client-sqs").SetQueueAttributesCommandOutput>}
   */
  async function setQueueAttributes(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');
    const q = requireQueue(queueUrl);
    q.Attributes = { ...q.Attributes, ...(deepClone(params.Attributes) || {}) };
    return {};
  }

  /**
   * @param {import("@aws-sdk/client-sqs").ListQueueTagsCommandInput} params
   * @returns {Promise<import("@aws-sdk/client-sqs").ListQueueTagsCommandOutput>}
   */
  async function listQueueTags(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');
    const q = requireQueue(queueUrl);
    return { Tags: deepClone(q.Tags || {}) };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").TagQueueCommandInput} params
   * @returns {Promise<import("@aws-sdk/client-sqs").TagQueueCommandOutput>}
   */
  async function tagQueue(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');
    const q = requireQueue(queueUrl);
    q.Tags = { ...q.Tags, ...(deepClone(params.Tags) || {}) };
    return {};
  }

  /**
   * @param {import("@aws-sdk/client-sqs").UntagQueueCommandInput} params
   * @returns {Promise<import("@aws-sdk/client-sqs").UntagQueueCommandOutput>}
   */
  async function untagQueue(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');
    const q = requireQueue(queueUrl);
    const remove = new Set(params.TagKeys || []);
    q.Tags = Object.fromEntries(
      Object.entries(q.Tags || {}).filter(([k]) => !remove.has(k)),
    );
    return {};
  }

  /**
   * @param {import("@aws-sdk/client-sqs").ListQueuesCommandInput} [params]
   * @returns {Promise<import("../base.js").listQueuesOutput>}
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
   * @param {import("@aws-sdk/client-sqs").SendMessageRequest} params
   * @returns {Promise<import("@aws-sdk/client-sqs").SendMessageResult>}
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

    return { MessageId };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").SendMessageBatchRequest} params
   */
  async function sendMessageBatch(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');

    const entries = params.Entries || [];
    /** @type {import("@aws-sdk/client-sqs").BatchResultErrorEntry[]} */
    const Failed = [];

    await Promise.all(
      entries.map(async (e, idx) => {
        try {
          await sendMessage({
            QueueUrl: queueUrl,
            MessageBody: e.MessageBody,
            DelaySeconds: e.DelaySeconds,
            MessageAttributes: e.MessageAttributes,
          });
        } catch (err) {
          Failed.push({
            Id: e.Id || String(idx),
            Message: err instanceof Error ? err.message : String(err),
            SenderFault: true,
          });
        }
      }),
    );

    // Match AWS SDK shape enough for callers that look at Failed.
    return { Failed };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").ReceiveMessageRequest} params
   * @returns {Promise<import("@aws-sdk/client-sqs").ReceiveMessageResult>}
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

      // Sleep in small increments to allow early return.
      const slice = Math.min(200, remaining);
      await new Promise((resolve) => setTimeout(resolve, slice));
    }
  }

  /**
   * @param {import("@aws-sdk/client-sqs").DeleteMessageRequest} params
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
      // Help callers that key off `name`
      // eslint-disable-next-line no-underscore-dangle
      err.name = 'ReceiptHandleIsInvalid';
      throw err;
    }

    q.messages.splice(idx, 1);
  }

  /**
   * @param {import("@aws-sdk/client-sqs").DeleteMessageBatchRequest} params
   */
  async function deleteMessageBatch(params) {
    const queueUrl = params?.QueueUrl;
    if (!queueUrl) throw new Error('QueueUrl is required');
    const entries = params.Entries || [];

    /** @type {import("@aws-sdk/client-sqs").BatchResultErrorEntry[]} */
    const Failed = [];

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      try {
        await deleteMessage({
          QueueUrl: queueUrl,
          ReceiptHandle: e.ReceiptHandle,
        });
      } catch (err) {
        Failed.push({
          Id: e.Id || e.MessageId || String(i),
          Message: err instanceof Error ? err.message : String(err),
          SenderFault: true,
        });
      }
    }

    return { Failed };
  }

  /**
   * @param {any} event -
   * @param {string} queueUrl -
   * @param {number} [delay] -
   */
  async function enqueue(event, queueUrl, delay = 0) {
    await sendMessage({
      MessageBody: JSON.stringify(event),
      QueueUrl: queueUrl,
      DelaySeconds: Math.min(Math.max(delay, 0), 60),
    });
  }

  /**
   * @param {any[]} events -
   * @param {string} queueUrl -
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
   * @param {any} event -
   * @param {string} queueUrl -
   */
  async function reenqueue(event, queueUrl) {
    await sendMessage({
      MessageBody: JSON.stringify(event),
      QueueUrl: queueUrl,
      DelaySeconds: Math.floor(Math.random() * (90 - 30) + 30),
    });
  }

  /**
   * Flush persisted state to disk.
   * @returns {Promise<void>}
   */
  async function close() {
    const data = JSON.stringify(state);
    await fsp.mkdir(queueDir, { recursive: true });

    const tmp = join(
      queueDir,
      `.tmp-${basename(queueFilePath)}-${process.pid}-${Date.now()}-${createId()}`,
    );

    const handle = await fsp.open(tmp, 'w', 0o600);
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    await fsp.rename(tmp, queueFilePath);

    // Best-effort dir fsync (matches vanilla DB adapter)
    try {
      const dh = await fsp.open(queueDir, 'r');
      try {
        await dh.sync();
      } finally {
        await dh.close();
      }
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
