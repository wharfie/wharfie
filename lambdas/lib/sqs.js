'use strict';
const AWS = require('@aws-sdk/client-sqs');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');
const uuid = require('uuid');

const BaseAWS = require('./base');

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
            Id: uuid.v4(),
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
}

module.exports = SQS;
