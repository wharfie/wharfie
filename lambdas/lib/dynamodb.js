'use strict';
const AWS = require('@aws-sdk/client-dynamodb');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

const BaseAWS = require('./base');

class DynamoDB {
  /**
   * @param {import("@aws-sdk/client-dynamodb").DynamoDBClientConfig} options - DynamoDB sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.dynamodb = new AWS.DynamoDB({
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
    const command = new AWS.CreateTableCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").DeleteTableCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").DeleteTableCommandOutput>} -
   */
  async deleteTable(params) {
    const command = new AWS.DeleteTableCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").DescribeTableCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").DescribeTableCommandOutput>} -
   */
  async describeTable(params) {
    const command = new AWS.DescribeTableCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").UpdateTableCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").UpdateTableCommandOutput>} -
   */
  async updateTable(params) {
    const command = new AWS.UpdateTableCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").DescribeTimeToLiveCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").DescribeTimeToLiveCommandOutput>} -
   */
  async describeTimeToLive(params) {
    const command = new AWS.DescribeTimeToLiveCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").UpdateTimeToLiveCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").UpdateTimeToLiveCommandOutput>} -
   */
  async updateTimeToLive(params) {
    const command = new AWS.UpdateTimeToLiveCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").ListTagsOfResourceCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").ListTagsOfResourceCommandOutput>} -
   */
  async listTagsOfResource(params) {
    const command = new AWS.ListTagsOfResourceCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").TagResourceCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").TagResourceCommandOutput>} -
   */
  async tagResource(params) {
    const command = new AWS.TagResourceCommand(params);
    return this.dynamodb.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").UntagResourceCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").UntagResourceCommandOutput>} -
   */
  async untagResource(params) {
    const command = new AWS.UntagResourceCommand(params);
    return this.dynamodb.send(command);
  }
}

module.exports = DynamoDB;
