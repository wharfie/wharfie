import {
  SQS as _SQS,
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
} from '@aws-sdk/client-sqs';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import BaseAWS from './base.js';
import { createId } from './id.js';

class SQS {
  /**
   * @param {import("@aws-sdk/client-sqs").SQSClientConfig} options - SQS sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.sqs = new _SQS({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
  }

  /**
   * @param {import("@aws-sdk/client-sqs").SendMessageRequest} params - SQS sendMessage params
   * @returns {Promise<import("@aws-sdk/client-sqs").SendMessageResult>} - SQS sendMessage result
   */
  async sendMessage(params) {
    const command = new SendMessageCommand(params);
    return this.sqs.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-sqs").SendMessageBatchRequest} params - SQS sendMessage params
   */
  async sendMessageBatch(params) {
    const command = new SendMessageBatchCommand(params);
    const { Failed } = await this.sqs.send(command);
    if (Failed && Failed.length > 0) {
      const reruns = [];
      while (Failed.length > 0) {
        const f = Failed.pop();
        const rerun = (params.Entries || []).find((p) => p.Id === f?.Id);
        if (rerun) reruns.push(rerun);
      }
      await this.sendMessageBatch({
        ...params,
        Entries: reruns,
      });
    }
  }

  /**
   * @param {import("@aws-sdk/client-sqs").DeleteMessageBatchRequest} params - SQS deleteMessage params
   */
  async deleteMessageBatch(params) {
    const command = new DeleteMessageBatchCommand(params);
    const { Failed } = await this.sqs.send(command);
    if (Failed && Failed.length > 0) {
      const reruns = [];
      while (Failed.length > 0) {
        const f = Failed.pop();
        const rerun = (params.Entries || []).find((p) => p.Id === f?.Id);
        if (rerun) reruns.push(rerun);
      }
      await this.deleteMessageBatch({
        ...params,
        Entries: reruns,
      });
    }
  }

  /**
   *
   * @param {import("@aws-sdk/client-sqs").DeleteMessageRequest} params - params.
   */
  async deleteMessage(params) {
    const command = new DeleteMessageCommand(params);
    await this.sqs.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-sqs").ReceiveMessageRequest} params - SQS receiveMessage params
   * @returns {Promise<import("@aws-sdk/client-sqs").ReceiveMessageResult>} - SQS receiveMessage result
   */
  async receiveMessage(params) {
    const command = new ReceiveMessageCommand(params);
    return await this.sqs.send(command);
  }

  /**
   * @param {import('../typedefs.js').WharfieEvent | import('../typedefs.js').AthenaEvent} event - event.
   * @param {string} queueUrl - queueUrl.
   * @param {number} [delay] - delay.
   */
  async enqueue(event, queueUrl, delay = 0) {
    const command = new SendMessageCommand({
      MessageBody: JSON.stringify(event),
      QueueUrl: queueUrl,
      DelaySeconds: Math.min(Math.max(delay, 0), 60),
    });
    await this.sqs.send(command);
  }

  /**
   * @param {import('../typedefs.js').WharfieEvent[]} events - events.
   * @param {string} queueUrl - queueUrl.
   */
  async enqueueBatch(events, queueUrl) {
    const promises = [];
    while (events.length > 0) {
      promises.push(
        this.sendMessageBatch({
          Entries: events.splice(0, 10).map((event) => ({
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
   * @param {import('../typedefs.js').WharfieEvent} event - event.
   * @param {string} queueUrl - queueUrl.
   */
  async reenqueue(event, queueUrl) {
    await this.sendMessage({
      MessageBody: JSON.stringify(event),
      QueueUrl: queueUrl,
      DelaySeconds: Math.floor(Math.random() * (90 - 30) + 30),
    });
  }

  /**
   * @typedef listQueuesOutput
   * @property {string[]} QueueUrls - QueueUrls.
   * @property {Object<string, any>} QueueDetails - QueueDetails.
   */

  /**
   * @param {import("@aws-sdk/client-sqs").ListQueuesCommandInput} params - SQS listQueues params
   * @returns {Promise<listQueuesOutput>} - SQS listQueues result
   */
  async listQueues(params) {
    const allQueueUrls = [];
    const { NextToken, QueueUrls } = await this.sqs.send(
      new ListQueuesCommand(params),
    );
    allQueueUrls.push(...(QueueUrls || []));
    let Marker = NextToken;
    while (Marker) {
      const { NextToken, QueueUrls } = await this.sqs.send(
        new ListQueuesCommand({
          ...params,
          NextToken: Marker,
        }),
      );
      allQueueUrls.push(...(QueueUrls || []));
      Marker = NextToken;
    }
    /**
     * @type {Object<string, any>}
     */
    const details = {};
    for (const queueUrl of allQueueUrls) {
      const { Attributes } = await this.getQueueAttributes({
        QueueUrl: queueUrl,
        AttributeNames: ['All'],
      });
      details[queueUrl] = Attributes;
    }

    return {
      QueueUrls: allQueueUrls,
      QueueDetails: details,
    };
  }

  /**
   * @param {import("@aws-sdk/client-sqs").GetQueueUrlCommandInput} params - SQS getQueueUrl params
   * @returns {Promise<import("@aws-sdk/client-sqs").GetQueueUrlCommandOutput>} - SQS getQueueUrl result
   */
  async getQueueUrl(params) {
    const command = new GetQueueUrlCommand(params);
    return await this.sqs.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-sqs").GetQueueAttributesCommandInput} params - SQS getQueueAttributes params
   * @returns {Promise<import("@aws-sdk/client-sqs").GetQueueAttributesCommandOutput>} - SQS getQueueAttributes result
   */
  async getQueueAttributes(params) {
    const command = new GetQueueAttributesCommand(params);
    return await this.sqs.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-sqs").SetQueueAttributesCommandInput} params - SQS setQueueAttributes params
   * @returns {Promise<import("@aws-sdk/client-sqs").SetQueueAttributesCommandOutput>} - SQS setQueueAttributes result
   */
  async setQueueAttributes(params) {
    const command = new SetQueueAttributesCommand(params);
    return await this.sqs.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-sqs").CreateQueueCommandInput} params - SQS createQueue params
   * @returns {Promise<import("@aws-sdk/client-sqs").CreateQueueCommandOutput>} - SQS createQueue result
   */
  async createQueue(params) {
    const command = new CreateQueueCommand(params);
    return await this.sqs.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-sqs").DeleteQueueCommandInput} params - SQS deleteQueue params
   * @returns {Promise<import("@aws-sdk/client-sqs").DeleteQueueCommandOutput>} - SQS deleteQueue result
   */
  async deleteQueue(params) {
    const command = new DeleteQueueCommand(params);
    return await this.sqs.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-sqs").ListQueueTagsCommandInput} params - SQS listQueueTags params
   * @returns {Promise<import("@aws-sdk/client-sqs").ListQueueTagsCommandOutput>} - SQS listQueueTags result
   */
  async listQueueTags(params) {
    const command = new ListQueueTagsCommand(params);
    return await this.sqs.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-sqs").TagQueueCommandInput} params - SQS tagQueue params
   * @returns {Promise<import("@aws-sdk/client-sqs").TagQueueCommandOutput>} - SQS tagQueue result
   */
  async tagQueue(params) {
    const command = new TagQueueCommand(params);
    return await this.sqs.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-sqs").UntagQueueCommandInput} params - SQS untagQueue params
   * @returns {Promise<import("@aws-sdk/client-sqs").UntagQueueCommandOutput>} - SQS untagQueue result
   */
  async untagQueue(params) {
    const command = new UntagQueueCommand(params);
    return await this.sqs.send(command);
  }

  /**
   * Close the underlying SQS client (useful for tests / CLIs to avoid open handles).
   * @returns {Promise<void>} - Result.
   */
  async close() {
    if (typeof this.sqs?.destroy === 'function') this.sqs.destroy();
  }
}

export default SQS;
