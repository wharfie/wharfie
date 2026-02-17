/**
 * SQS-like queue interface used by the pluggable queue adapters.
 *
 * This mirrors the public interface of `lambdas/lib/sqs.js` (plus `close()` for
 * resource cleanup in local adapters / tests).
 *
 * Adapters should provide SQS Standard-queue semantics (non-FIFO):
 * - best-effort ordering (do not rely on FIFO)
 * - at-least-once delivery (messages may be delivered more than once)
 * - visibility timeout (received messages are hidden for a period unless deleted)
 */

/**
 * @typedef {import("@aws-sdk/client-sqs").SendMessageRequest} SendMessageRequest
 * @typedef {import("@aws-sdk/client-sqs").SendMessageResult} SendMessageResult
 * @typedef {import("@aws-sdk/client-sqs").SendMessageBatchRequest} SendMessageBatchRequest
 * @typedef {import("@aws-sdk/client-sqs").DeleteMessageBatchRequest} DeleteMessageBatchRequest
 * @typedef {import("@aws-sdk/client-sqs").DeleteMessageRequest} DeleteMessageRequest
 * @typedef {import("@aws-sdk/client-sqs").ReceiveMessageRequest} ReceiveMessageRequest
 * @typedef {import("@aws-sdk/client-sqs").ReceiveMessageResult} ReceiveMessageResult
 * @typedef {import("@aws-sdk/client-sqs").ListQueuesCommandInput} ListQueuesCommandInput
 * @typedef {import("@aws-sdk/client-sqs").GetQueueUrlCommandInput} GetQueueUrlCommandInput
 * @typedef {import("@aws-sdk/client-sqs").GetQueueUrlCommandOutput} GetQueueUrlCommandOutput
 * @typedef {import("@aws-sdk/client-sqs").GetQueueAttributesCommandInput} GetQueueAttributesCommandInput
 * @typedef {import("@aws-sdk/client-sqs").GetQueueAttributesCommandOutput} GetQueueAttributesCommandOutput
 * @typedef {import("@aws-sdk/client-sqs").SetQueueAttributesCommandInput} SetQueueAttributesCommandInput
 * @typedef {import("@aws-sdk/client-sqs").SetQueueAttributesCommandOutput} SetQueueAttributesCommandOutput
 * @typedef {import("@aws-sdk/client-sqs").CreateQueueCommandInput} CreateQueueCommandInput
 * @typedef {import("@aws-sdk/client-sqs").CreateQueueCommandOutput} CreateQueueCommandOutput
 * @typedef {import("@aws-sdk/client-sqs").DeleteQueueCommandInput} DeleteQueueCommandInput
 * @typedef {import("@aws-sdk/client-sqs").DeleteQueueCommandOutput} DeleteQueueCommandOutput
 * @typedef {import("@aws-sdk/client-sqs").ListQueueTagsCommandInput} ListQueueTagsCommandInput
 * @typedef {import("@aws-sdk/client-sqs").ListQueueTagsCommandOutput} ListQueueTagsCommandOutput
 * @typedef {import("@aws-sdk/client-sqs").TagQueueCommandInput} TagQueueCommandInput
 * @typedef {import("@aws-sdk/client-sqs").TagQueueCommandOutput} TagQueueCommandOutput
 * @typedef {import("@aws-sdk/client-sqs").UntagQueueCommandInput} UntagQueueCommandInput
 * @typedef {import("@aws-sdk/client-sqs").UntagQueueCommandOutput} UntagQueueCommandOutput
 */

import { createId } from '../id.js';

/**
 * @typedef listQueuesOutput
 * @property {string[]} QueueUrls - QueueUrls.
 * @property {Object<string, any>} QueueDetails - QueueDetails.
 */

/**
 * @typedef {Object} QueueClient
 * @property {(params: SendMessageRequest) => Promise<SendMessageResult>} sendMessage - sendMessage.
 * @property {(params: SendMessageBatchRequest) => Promise<any>} sendMessageBatch - sendMessageBatch.
 * @property {(params: DeleteMessageBatchRequest) => Promise<any>} deleteMessageBatch - deleteMessageBatch.
 * @property {(params: DeleteMessageRequest) => Promise<void>} deleteMessage - deleteMessage.
 * @property {(params: ReceiveMessageRequest) => Promise<ReceiveMessageResult>} receiveMessage - receiveMessage.
 * @property {(event: any, queueUrl: string, delay?: number) => Promise<void>} enqueue - enqueue.
 * @property {(events: any[], queueUrl: string) => Promise<void>} enqueueBatch - enqueueBatch.
 * @property {(event: any, queueUrl: string) => Promise<void>} reenqueue - reenqueue.
 * @property {(params: ListQueuesCommandInput) => Promise<listQueuesOutput>} listQueues - listQueues.
 * @property {(params: GetQueueUrlCommandInput) => Promise<GetQueueUrlCommandOutput>} getQueueUrl - getQueueUrl.
 * @property {(params: GetQueueAttributesCommandInput) => Promise<GetQueueAttributesCommandOutput>} getQueueAttributes - getQueueAttributes.
 * @property {(params: SetQueueAttributesCommandInput) => Promise<SetQueueAttributesCommandOutput>} setQueueAttributes - setQueueAttributes.
 * @property {(params: CreateQueueCommandInput) => Promise<CreateQueueCommandOutput>} createQueue - createQueue.
 * @property {(params: DeleteQueueCommandInput) => Promise<DeleteQueueCommandOutput>} deleteQueue - deleteQueue.
 * @property {(params: ListQueueTagsCommandInput) => Promise<ListQueueTagsCommandOutput>} listQueueTags - listQueueTags.
 * @property {(params: TagQueueCommandInput) => Promise<TagQueueCommandOutput>} tagQueue - tagQueue.
 * @property {(params: UntagQueueCommandInput) => Promise<UntagQueueCommandOutput>} untagQueue - untagQueue.
 * @property {() => Promise<void>} close - close.
 */

/**
 * @param {SendMessageRequest} _params - _params.
 * @returns {Promise<SendMessageResult>} - Result.
 */
async function sendMessage(_params) {
  return /** @type {any} */ ({ MessageId: '' });
}

/**
 * @param {SendMessageBatchRequest} _params - _params.
 */
async function sendMessageBatch(_params) {}

/**
 * @param {DeleteMessageBatchRequest} _params - _params.
 */
async function deleteMessageBatch(_params) {}

/**
 * @param {DeleteMessageRequest} _params - _params.
 */
async function deleteMessage(_params) {}

/**
 * @param {ReceiveMessageRequest} _params - _params.
 * @returns {Promise<ReceiveMessageResult>} - Result.
 */
async function receiveMessage(_params) {
  return /** @type {any} */ ({ Messages: [] });
}

/**
 * @this {QueueClient}
 * @param {any} event - event.
 * @param {string} queueUrl - queueUrl.
 * @param {number} [delay] - delay.
 */
async function enqueue(event, queueUrl, delay = 0) {
  await this.sendMessage({
    MessageBody: JSON.stringify(event),
    QueueUrl: queueUrl,
    DelaySeconds: Math.min(Math.max(delay, 0), 60),
  });
}

/**
 * @this {QueueClient}
 * @param {any[]} events - events.
 * @param {string} queueUrl - queueUrl.
 */
async function enqueueBatch(events, queueUrl) {
  const promises = [];
  const copy = [...events];

  while (copy.length > 0) {
    promises.push(
      this.sendMessageBatch({
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
 * @this {QueueClient}
 * @param {any} event - event.
 * @param {string} queueUrl - queueUrl.
 */
async function reenqueue(event, queueUrl) {
  await this.sendMessage({
    MessageBody: JSON.stringify(event),
    QueueUrl: queueUrl,
    DelaySeconds: Math.floor(Math.random() * (90 - 30) + 30),
  });
}

/**
 * @param {ListQueuesCommandInput} _params - _params.
 * @returns {Promise<listQueuesOutput>} - Result.
 */
async function listQueues(_params) {
  return { QueueUrls: [], QueueDetails: {} };
}

/**
 * @param {GetQueueUrlCommandInput} _params - _params.
 * @returns {Promise<GetQueueUrlCommandOutput>} - Result.
 */
async function getQueueUrl(_params) {
  return /** @type {any} */ ({ QueueUrl: '' });
}

/**
 * @param {GetQueueAttributesCommandInput} _params - _params.
 * @returns {Promise<GetQueueAttributesCommandOutput>} - Result.
 */
async function getQueueAttributes(_params) {
  return /** @type {any} */ ({ Attributes: {} });
}

/**
 * @param {SetQueueAttributesCommandInput} _params - _params.
 * @returns {Promise<SetQueueAttributesCommandOutput>} - Result.
 */
async function setQueueAttributes(_params) {
  return /** @type {any} */ ({});
}

/**
 * @param {CreateQueueCommandInput} _params - _params.
 * @returns {Promise<CreateQueueCommandOutput>} - Result.
 */
async function createQueueCmd(_params) {
  return /** @type {any} */ ({ QueueUrl: '' });
}

/**
 * @param {DeleteQueueCommandInput} _params - _params.
 * @returns {Promise<DeleteQueueCommandOutput>} - Result.
 */
async function deleteQueue(_params) {
  return /** @type {any} */ ({});
}

/**
 * @param {ListQueueTagsCommandInput} _params - _params.
 * @returns {Promise<ListQueueTagsCommandOutput>} - Result.
 */
async function listQueueTags(_params) {
  return /** @type {any} */ ({ Tags: {} });
}

/**
 * @param {TagQueueCommandInput} _params - _params.
 * @returns {Promise<TagQueueCommandOutput>} - Result.
 */
async function tagQueue(_params) {
  return /** @type {any} */ ({});
}

/**
 * @param {UntagQueueCommandInput} _params - _params.
 * @returns {Promise<UntagQueueCommandOutput>} - Result.
 */
async function untagQueue(_params) {
  return /** @type {any} */ ({});
}

/**
 * @returns {Promise<void>} - Result.
 */
async function close() {}

/**
 * Factory function that creates a queue client exposing the base queue methods.
 * @returns {QueueClient} - Result.
 */
export default function createQueue() {
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
    createQueue: createQueueCmd,
    deleteQueue,
    listQueueTags,
    tagQueue,
    untagQueue,
    close,
  };
}
