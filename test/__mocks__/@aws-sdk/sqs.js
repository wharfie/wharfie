'use strict';
const { createId } = require('../../../lambdas/lib/id');

const { QueueDoesNotExist } = jest.requireActual('@aws-sdk/client-sqs');

class SQSMock {
  __setMockState(sqsState) {
    SQSMock.__state = {
      queues: {},
    };
    if (sqsState) {
      SQSMock.__state = sqsState;
    }
  }

  __getMockState() {
    return SQSMock.__state;
  }

  async send(command) {
    switch (command.constructor.name) {
      case 'CreateQueueCommand':
        return await this.createQueue(command.input);
      case 'GetQueueUrlCommand':
        return await this.getQueueUrl(command.input);
      case 'GetQueueAttributesCommand':
        return await this.getQueueAttributes(command.input);
      case 'SetQueueAttributesCommand':
        return await this.setQueueAttributes(command.input);
      case 'DeleteQueueCommand':
        return await this.deleteQueue(command.input);
      case 'SendMessageCommand':
        return await this.sendMessage(command.input);
      case 'SendMessageBatchCommand':
        return await this.sendMessageBatch(command.input);
      case 'ReceiveMessageCommand':
        return await this.receiveMessage(command.input);
      case 'DeleteMessageCommand':
        return await this.deleteMessage(command.input);
      case 'DeleteMessageBatchCommand':
        return await this.deleteMessageBatch(command.input);
    }
  }

  async createQueue(params) {
    SQSMock.__state.queues[params.QueueName] = {
      queue: [],
      Attributes: params.Attributes || {},
    };
    return { QueueUrl: params.QueueName };
  }

  async deleteQueue(params) {
    delete SQSMock.__state.queues[params.QueueUrl];
  }

  async getQueueUrl(params) {
    if (!SQSMock.__state.queues[params.QueueName])
      throw new QueueDoesNotExist({
        message: `queue ${params.QueueName} does not exist`,
      });
    return { QueueUrl: params.QueueName };
  }

  async setQueueAttributes(params) {
    if (!SQSMock.__state.queues[params.QueueUrl])
      throw new QueueDoesNotExist({
        message: `queue ${params.QueueUrl} does not exist`,
      });
    SQSMock.__state.queues[params.QueueUrl].Attributes = params.Attributes;
  }

  async getQueueAttributes(params) {
    if (!SQSMock.__state.queues[params.QueueUrl])
      throw new QueueDoesNotExist({
        message: `queue ${params.QueueUrl} does not exist`,
      });
    return SQSMock.__state.queues[params.QueueUrl];
  }

  async sendMessage(params) {
    if (!SQSMock.__state.queues[params.QueueUrl])
      SQSMock.__state.queues[params.QueueUrl] = {
        queue: [],
        Attributes: {},
      };
    const MessageId = createId();
    SQSMock.__state.queues[params.QueueUrl].queue.push({
      MessageId,
      Body: params.MessageBody,
    });
    return {
      MessageId,
    };
  }

  async sendMessageBatch(params) {
    await Promise.all(
      params.Entries.map(
        async (e) => await this.sendMessage({ QueueUrl: params.QueueUrl, ...e })
      )
    );
    return {
      Failed: [],
    };
  }

  async receiveMessage(params) {
    const Messages = [];
    params.MaxNumberOfMessages = params.MaxNumberOfMessages || 1;
    while (
      params.MaxNumberOfMessages > 0 &&
      SQSMock.__state.queues[params.QueueUrl].queue.length > 0
    ) {
      const limit = SQSMock.__state.queues[params.QueueUrl].queue.length;
      const messageIndex = Math.floor(Math.random() * limit);
      const _message = SQSMock.__state.queues[params.QueueUrl].queue.splice(
        messageIndex,
        1
      )[0];
      Messages.push({
        ..._message,
        // instead of generating a unique receiptHandle just use the MessageID
        ReceiptHandle: _message.MessageId,
      });
      params.MaxNumberOfMessages--;
    }
    return {
      Messages,
    };
  }

  async deleteMessage(params) {
    SQSMock.__state.queues[params.QueueUrl].queue = SQSMock.__state.queues[
      params.QueueUrl
    ].queue.filter((message) => message.MessageId !== params.ReceiptHandle);
  }

  async deleteMessageBatch(params) {
    params.Entries.forEach((entry) => {
      this.deleteMessage({
        QueueUrl: params.QueueUrl,
        ReceiptHandle: entry.ReceiptHandle,
      });
    });
    return {};
  }
}

SQSMock.__state = {
  queues: {},
};

module.exports = SQSMock;
