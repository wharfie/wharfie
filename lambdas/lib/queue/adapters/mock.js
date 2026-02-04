// eslint-disable-next-line n/no-unpublished-import
import { jest } from '@jest/globals';

/**
 * Mock queue adapter. Intended for unit tests that only need spies and do not
 * require SQS-like delivery semantics.
 * @returns {import('../base.js').QueueClient} - Result.
 */
export default function createMockQueue() {
  const sendMessage = jest.fn(async (_params) => {
    return { MessageId: 'mock' };
  });

  const sendMessageBatch = jest.fn(async (_params) => {
    return { Failed: [] };
  });

  const deleteMessageBatch = jest.fn(async (_params) => {
    return { Failed: [] };
  });

  const deleteMessage = jest.fn(async (_params) => {
    // no-op
  });

  const receiveMessage = jest.fn(async (_params) => {
    return { Messages: [] };
  });

  const enqueue = jest.fn(async (_event, _queueUrl, _delay = 0) => {
    // no-op
  });

  const enqueueBatch = jest.fn(async (_events, _queueUrl) => {
    // no-op
  });

  const reenqueue = jest.fn(async (_event, _queueUrl) => {
    // no-op
  });

  const listQueues = jest.fn(async (_params) => {
    return { QueueUrls: [], QueueDetails: {} };
  });

  const getQueueUrl = jest.fn(async (_params) => {
    return { QueueUrl: '' };
  });

  const getQueueAttributes = jest.fn(async (_params) => {
    return { Attributes: {} };
  });

  const setQueueAttributes = jest.fn(async (_params) => {
    return {};
  });

  const createQueue = jest.fn(async (_params) => {
    return { QueueUrl: '' };
  });

  const deleteQueue = jest.fn(async (_params) => {
    return {};
  });

  const listQueueTags = jest.fn(async (_params) => {
    return { Tags: {} };
  });

  const tagQueue = jest.fn(async (_params) => {
    return {};
  });

  const untagQueue = jest.fn(async (_params) => {
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
