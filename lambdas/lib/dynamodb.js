import {
  DynamoDB as _DynamoDB,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  UpdateTableCommand,
  DescribeTimeToLiveCommand,
  UpdateTimeToLiveCommand,
  ListTagsOfResourceCommand,
  TagResourceCommand,
  UntagResourceCommand,
} from '@aws-sdk/client-dynamodb';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import BaseAWS from './base.js';

class DynamoDB {
  /**
   * @param {import("@aws-sdk/client-dynamodb").DynamoDBClientConfig} options - DynamoDB sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.dynamodb = new _DynamoDB({
      ...BaseAWS.config({
        maxAttempts: Number(process.env?.DYNAMO_MAX_RETRIES || 300),
      }),
      credentials,
      ...options,
    });
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").CreateTableCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").CreateTableCommandOutput>} -
   */
  async createTable(params) {
    const command = new CreateTableCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").DeleteTableCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").DeleteTableCommandOutput>} -
   */
  async deleteTable(params) {
    const command = new DeleteTableCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").DescribeTableCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").DescribeTableCommandOutput>} -
   */
  async describeTable(params) {
    const command = new DescribeTableCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").UpdateTableCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").UpdateTableCommandOutput>} -
   */
  async updateTable(params) {
    const command = new UpdateTableCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").DescribeTimeToLiveCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").DescribeTimeToLiveCommandOutput>} -
   */
  async describeTimeToLive(params) {
    const command = new DescribeTimeToLiveCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").UpdateTimeToLiveCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").UpdateTimeToLiveCommandOutput>} -
   */
  async updateTimeToLive(params) {
    const command = new UpdateTimeToLiveCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").ListTagsOfResourceCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").ListTagsOfResourceCommandOutput>} -
   */
  async listTagsOfResource(params) {
    const command = new ListTagsOfResourceCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").TagResourceCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").TagResourceCommandOutput>} -
   */
  async tagResource(params) {
    const command = new TagResourceCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").UntagResourceCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").UntagResourceCommandOutput>} -
   */
  async untagResource(params) {
    const command = new UntagResourceCommand(params);
    return this.dynamodb.send(command);
  }
}

export default DynamoDB;
