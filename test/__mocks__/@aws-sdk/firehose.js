import { jest } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
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
      case 'ListTagsForDeliveryStreamCommand':
        return await this.listTagsForDeliveryStream(command.input);
      case 'TagDeliveryStreamCommand':
        return await this.tagDeliveryStream(command.input);
      case 'UntagDeliveryStreamCommand':
        return await this.untagDeliveryStream(command.input);
    }
  }

  async listTagsForDeliveryStream(params) {
    if (!FirehoseMock.__state[params.DeliveryStreamName]) {
      throw new ResourceNotFoundException({
        message: `DeliveryStream ${params.DeliveryStreamName} does not exist`,
      });
    }
    return {
      Tags: FirehoseMock.__state[params.DeliveryStreamName].tags || [],
    };
  }

  async tagDeliveryStream(params) {
    if (!FirehoseMock.__state[params.DeliveryStreamName]) {
      throw new ResourceNotFoundException({
        message: `DeliveryStream ${params.DeliveryStreamName} does not exist`,
      });
    }
    FirehoseMock.__state[params.DeliveryStreamName].tags.push(...params.Tags);
  }

  async untagDeliveryStream(params) {
    if (!FirehoseMock.__state[params.DeliveryStreamName]) {
      throw new ResourceNotFoundException({
        message: `DeliveryStream ${params.DeliveryStreamName} does not exist`,
      });
    }
    FirehoseMock.__state[params.DeliveryStreamName].tags = FirehoseMock.__state[
      params.DeliveryStreamName
    ].tags.filter((tag) => {
      return !params.TagKeys.includes(tag.Key);
    });
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
      tags: [],
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

FirehoseMock.__state = {};

module.exports = FirehoseMock;
