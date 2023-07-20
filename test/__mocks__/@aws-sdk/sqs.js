'use strict';
const cuid = require('cuid');

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
    SQSMock.__state.queues[params.QueueName] = [];
  }

  async sendMessage(params) {
    if (params.QueueUrl === undefined) {
      console.trace(params);
    }
    if (!SQSMock.__state.queues[params.QueueUrl])
      SQSMock.__state.queues[params.QueueUrl] = [];
    const MessageId = cuid();
    SQSMock.__state.queues[params.QueueUrl].push({
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
      SQSMock.__state.queues[params.QueueUrl].length > 0
    ) {
      const limit = SQSMock.__state.queues[params.QueueUrl].length;
      const messageIndex = Math.floor(Math.random() * limit);
      const _message = SQSMock.__state.queues[params.QueueUrl].splice(
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
    SQSMock.__state.queues[params.QueueUrl] = SQSMock.__state.queues[
      params.QueueUrl
    ].filter((message) => message.MessageId !== params.ReceiptHandle);
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
