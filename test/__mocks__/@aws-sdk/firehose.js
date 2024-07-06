'use strict';
const { ResourceNotFoundException } = jest.requireActual(
  '@aws-sdk/client-firehose'
);

class FirehoseMock {
  __setMockState(firehoseState = {}) {
    FirehoseMock.__state = firehoseState;
  }

  __getMockState() {
    return FirehoseMock.__state;
  }

  async send(command) {
    switch (command.constructor.name) {
      case 'PutRecordBatchCommand':
        return await this.putRecordBatch(command.input);
      case 'DescribeDeliveryStreamCommand':
        return await this.describeDeliveryStream(command.input);
      case 'CreateDeliveryStreamCommand':
        return await this.createDeliveryStream(command.input);
      case 'DeleteDeliveryStreamCommand':
        return await this.deleteDeliveryStream(command.input);
    }
  }

  async putRecordBatch(params) {
    if (!FirehoseMock.__state[params.DeliveryStreamName]) {
      FirehoseMock.__state[params.DeliveryStreamName] = {
        records: [],
      };
    }
    FirehoseMock.__state[params.DeliveryStreamName].records.push(
      ...params.Records
    );
    return {};
  }

  async describeDeliveryStream(params) {
    if (!FirehoseMock.__state[params.DeliveryStreamName]) {
      throw new ResourceNotFoundException({
        message: `DeliveryStream ${params.DeliveryStreamName} does not exist`,
      });
    }
    return {
      DeliveryStreamDescription:
        FirehoseMock.__state[params.DeliveryStreamName],
    };
  }

  async createDeliveryStream(params) {
    if (FirehoseMock.__state[params.DeliveryStreamName]) {
      throw new Error(
        `DeliveryStream ${params.DeliveryStreamName} already exists`
      );
    }
    FirehoseMock.__state[params.DeliveryStreamName] = {
      ...params,
      records: [],
      DeliveryStreamARN: `arn:aws:firehose:us-east-1:123456789012:deliverystream/${params.DeliveryStreamName}`,
      DeliveryStreamStatus: 'ACTIVE',
    };
    return FirehoseMock.__state[params.DeliveryStreamName];
  }

  async deleteDeliveryStream(params) {
    if (!FirehoseMock.__state[params.DeliveryStreamName]) {
      throw new ResourceNotFoundException({
        message: `DeliveryStream ${params.DeliveryStreamName} does not exist`,
      });
    }
    delete FirehoseMock.__state[params.DeliveryStreamName];
  }
}

/** @type {Object<string, string[]>} */
FirehoseMock.__state = {};

module.exports = FirehoseMock;
