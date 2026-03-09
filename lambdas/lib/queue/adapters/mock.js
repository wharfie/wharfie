// eslint-disable-next-line n/no-unpublished-import
import { jest } from '@jest/globals';

/**
 * Mock queue adapter. Intended for unit tests that only need spies and do not
 * require SQS-like delivery semantics.
 * @returns {import('../base.js').QueueClient} - Result.
 */
export default function createMockQueue() {
  const sendMessage = jest.fn(async (/** @type {any} */ _params) => {
    return { MessageId: 'mock' };
  });

  const sendMessageBatch = jest.fn(async (/** @type {any} */ _params) => {
    return { Failed: [] };
  });

  const deleteMessageBatch = jest.fn(async (/** @type {any} */ _params) => {
    return { Failed: [] };
  });

  const deleteMessage = jest.fn(async (/** @type {any} */ _params) => {
    // no-op
  });

  const receiveMessage = jest.fn(async (/** @type {any} */ _params) => {
    return { Messages: [] };
  });

  const enqueue = jest.fn(
    async (
      /** @type {any} */ _event,
      /** @type {any} */ _queueUrl,
      /** @type {number} */ _delay = 0,
    ) => {
      // no-op
    },
  );

  const enqueueBatch = jest.fn(
    async (/** @type {any} */ _events, /** @type {any} */ _queueUrl) => {
      // no-op
    },
  );

  const reenqueue = jest.fn(
    async (/** @type {any} */ _event, /** @type {any} */ _queueUrl) => {
      // no-op
    },
  );

  const listQueues = jest.fn(async (/** @type {any} */ _params) => {
    return { QueueUrls: [], QueueDetails: {} };
  });

  const getQueueUrl = jest.fn(async (/** @type {any} */ _params) => {
    return { QueueUrl: '' };
  });

  const getQueueAttributes = jest.fn(async (/** @type {any} */ _params) => {
    return { Attributes: {} };
  });

  const setQueueAttributes = jest.fn(async (/** @type {any} */ _params) => {
    return {};
  });

  const createQueue = jest.fn(async (/** @type {any} */ _params) => {
    return { QueueUrl: '' };
  });

  const deleteQueue = jest.fn(async (/** @type {any} */ _params) => {
    return {};
  });

  const listQueueTags = jest.fn(async (/** @type {any} */ _params) => {
    return { Tags: {} };
  });

  const tagQueue = jest.fn(async (/** @type {any} */ _params) => {
    return {};
  });

  const untagQueue = jest.fn(async (/** @type {any} */ _params) => {
    return {};
  });

  const close = jest.fn(async () => {
    // no-op
  });

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
