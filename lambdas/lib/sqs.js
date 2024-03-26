'use strict';
const AWS = require('@aws-sdk/client-sqs');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

const BaseAWS = require('./base');
const { createId } = require('./id');

class SQS {
  /**
   * @param {import("@aws-sdk/client-sqs").SQSClientConfig} options - SQS sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.sqs = new AWS.SQS({
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
    const command = new AWS.SendMessageCommand(params);
    return await this.sqs.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-sqs").SendMessageBatchRequest} params - SQS sendMessage params
   */
  async sendMessageBatch(params) {
    const command = new AWS.SendMessageBatchCommand(params);
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
    const command = new AWS.DeleteMessageBatchCommand(params);
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
   * @param {import("@aws-sdk/client-sqs").DeleteMessageRequest} params -
   */
  async deleteMessage(params) {
    const command = new AWS.DeleteMessageCommand(params);
    await this.sqs.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-sqs").ReceiveMessageRequest} params - SQS receiveMessage params
   * @returns {Promise<import("@aws-sdk/client-sqs").ReceiveMessageResult>} - SQS receiveMessage result
   */
  async receiveMessage(params) {
    const command = new AWS.ReceiveMessageCommand(params);
    return await this.sqs.send(command);
  }

  /**
   * @param {import('../typedefs').WharfieEvent | import('../typedefs').AthenaEvent} event -
   * @param {string} queueUrl -
   * @param {number} [delay] -
   */
  async enqueue(event, queueUrl, delay = 0) {
    const command = new AWS.SendMessageCommand({
      MessageBody: JSON.stringify(event),
      QueueUrl: queueUrl,
      DelaySeconds: Math.min(Math.max(delay, 0), 60),
    });
    await this.sqs.send(command);
  }

  /**
   * @param {import('../typedefs').WharfieEvent[]} events -
   * @param {string} queueUrl -
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
        })
      );
    }
    await Promise.all(promises);
  }

  /**
   * @param {import('../typedefs').WharfieEvent} event -
   * @param {string} queueUrl -
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
   * @property {string[]} QueueUrls -
   * @property {Object<string, any>} QueueDetails -
   */

  /**
   * @param {import("@aws-sdk/client-sqs").ListQueuesCommandInput} params - SQS listQueues params
   * @returns {Promise<listQueuesOutput>} - SQS listQueues result
   */
  async listQueues(params) {
    const allQueueUrls = [];
    const { NextToken, QueueUrls } = await this.sqs.send(
      new AWS.ListQueuesCommand(params)
    );
    allQueueUrls.push(...(QueueUrls || []));
    let Marker = NextToken;
    while (Marker) {
      const { NextToken, QueueUrls } = await this.sqs.send(
        new AWS.ListQueuesCommand({
          ...params,
          NextToken: Marker,
        })
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
   * @param {import("@aws-sdk/client-sqs").GetQueueAttributesCommandInput} params - SQS getQueueAttributes params
   * @returns {Promise<import("@aws-sdk/client-sqs").GetQueueAttributesCommandOutput>} - SQS getQueueAttributes result
   */
  async getQueueAttributes(params) {
    const command = new AWS.GetQueueAttributesCommand(params);
    return await this.sqs.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-sqs").SetQueueAttributesCommandInput} params - SQS setQueueAttributes params
   * @returns {Promise<import("@aws-sdk/client-sqs").SetQueueAttributesCommandOutput>} - SQS setQueueAttributes result
   */
  async setQueueAttributes(params) {
    const command = new AWS.SetQueueAttributesCommand(params);
    return await this.sqs.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-sqs").CreateQueueCommandInput} params - SQS createQueue params
   * @returns {Promise<import("@aws-sdk/client-sqs").CreateQueueCommandOutput>} - SQS createQueue result
   */
  async createQueue(params) {
    const command = new AWS.CreateQueueCommand(params);
    return await this.sqs.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-sqs").DeleteQueueCommandInput} params - SQS deleteQueue params
   * @returns {Promise<import("@aws-sdk/client-sqs").DeleteQueueCommandOutput>} - SQS deleteQueue result
   */
  async deleteQueue(params) {
    const command = new AWS.DeleteQueueCommand(params);
    return await this.sqs.send(command);
  }
}

module.exports = SQS;
