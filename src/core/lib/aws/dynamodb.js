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
   * @param {import("@aws-sdk/client-dynamodb").CreateTableCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-dynamodb").CreateTableCommandOutput>} - Result.
   */
  async createTable(params) {
    const command = new CreateTableCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").DeleteTableCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-dynamodb").DeleteTableCommandOutput>} - Result.
   */
  async deleteTable(params) {
    const command = new DeleteTableCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").DescribeTableCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-dynamodb").DescribeTableCommandOutput>} - Result.
   */
  async describeTable(params) {
    const command = new DescribeTableCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").UpdateTableCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-dynamodb").UpdateTableCommandOutput>} - Result.
   */
  async updateTable(params) {
    const command = new UpdateTableCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").DescribeTimeToLiveCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-dynamodb").DescribeTimeToLiveCommandOutput>} - Result.
   */
  async describeTimeToLive(params) {
    const command = new DescribeTimeToLiveCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").UpdateTimeToLiveCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-dynamodb").UpdateTimeToLiveCommandOutput>} - Result.
   */
  async updateTimeToLive(params) {
    const command = new UpdateTimeToLiveCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").ListTagsOfResourceCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-dynamodb").ListTagsOfResourceCommandOutput>} - Result.
   */
  async listTagsOfResource(params) {
    const command = new ListTagsOfResourceCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").TagResourceCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-dynamodb").TagResourceCommandOutput>} - Result.
   */
  async tagResource(params) {
    const command = new TagResourceCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").UntagResourceCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-dynamodb").UntagResourceCommandOutput>} - Result.
   */
  async untagResource(params) {
    const command = new UntagResourceCommand(params);
    return this.dynamodb.send(command);
  }
}

export default DynamoDB;
