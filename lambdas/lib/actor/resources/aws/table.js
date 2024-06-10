'use strict';
const { DynamoDBDocument } = require('@aws-sdk/lib-dynamodb');
const Dynamo = require('@aws-sdk/client-dynamodb');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

const BaseAWS = require('../../../base');
const BaseResource = require('../base-resource');
/**
 * @typedef TableProperties
 * @property {import("@aws-sdk/client-dynamodb").AttributeDefinition[]} attributeDefinitions -
 * @property {import("@aws-sdk/client-dynamodb").KeySchemaElement[]} keySchema -
 * @property {import("@aws-sdk/client-dynamodb").ProvisionedThroughput} provisionedThroughput -
 * @property {import("@aws-sdk/client-dynamodb").TimeToLiveSpecification} [timeToLiveSpecification] -
 */

/**
 * @typedef TableOptions
 * @property {string} name -
 * @property {import('../reconcilable').Status} [status] -
 * @property {TableProperties & import('../../typedefs').SharedDeploymentProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class Table extends BaseResource {
  /**
   * @param {TableOptions} options -
   */
  constructor({ name, status, properties, dependsOn = [] }) {
    super({ name, status, properties, dependsOn });
    const credentials = fromNodeProviderChain();
    this.dynamo = new Dynamo.DynamoDB({
      ...BaseAWS.config({
        maxAttempts: Number(process.env?.DYNAMO_MAX_RETRIES || 300),
      }),
      credentials,
    });
    this.dynamoDocument = DynamoDBDocument.from(this.dynamo, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async exists() {
    try {
      await this.describeTable({ TableName: this.name });
      return true;
    } catch (error) {
      // @ts-ignore
      if (error.name === 'ResourceNotFoundException') {
        return false;
      }
      throw error;
    }
  }

  async _reconcile() {
    try {
      const { Table } = await this.describeTable({ TableName: this.name });
      this.set('arn', Table?.TableArn);
      if (
        Table?.ProvisionedThroughput?.ReadCapacityUnits !==
          this.get('provisionedThroughput').ReadCapacityUnits ||
        Table?.ProvisionedThroughput?.WriteCapacityUnits !==
          this.get('provisionedThroughput').WriteCapacityUnits
      ) {
        await this.updateTable({
          TableName: this.name,
          ProvisionedThroughput: this.get('provisionedThroughput'),
        });
      }
    } catch (error) {
      // @ts-ignore
      if (error.name === 'ResourceNotFoundException') {
        const { TableDescription } = await this.createTable({
          TableName: this.name,
          AttributeDefinitions: this.get('attributeDefinitions'),
          KeySchema: this.get('keySchema'),
          ProvisionedThroughput: this.get('provisionedThroughput'),
        });
        this.set('arn', TableDescription?.TableArn);
      } else {
        throw error;
      }
    }
    await this.waitForTableStatus('ACTIVE');
    if (this.has('timeToLiveSpecification')) {
      const { TimeToLiveDescription } = await this.describeTimeToLive({
        TableName: this.name,
      });
      if (
        TimeToLiveDescription?.AttributeName !==
        this.get('timeToLiveSpecification').AttributeName
      ) {
        await this.updateTimeToLive({
          TableName: this.name,
          TimeToLiveSpecification: this.get('timeToLiveSpecification'),
        });
      }
    }
  }

  async _destroy() {
    try {
      await this.deleteTable({ TableName: this.name });
    } catch (error) {
      // @ts-ignore
      if (error.name !== 'ResourceNotFoundException') {
        throw error;
      }
    }
    await this.waitForTableDelete();
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").TableStatus} desiredStatus -
   */
  async waitForTableStatus(desiredStatus) {
    let status = '';
    while (status !== desiredStatus) {
      const { Table } = await this.describeTable({
        TableName: this.name,
      });
      status = Table?.TableStatus || '';
      if (status !== desiredStatus) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  async waitForTableDelete() {
    let waitTimeSeconds = 0;
    while (waitTimeSeconds < 300) {
      try {
        await this.describeTable({
          TableName: this.name,
        });
      } catch (error) {
        // @ts-ignore
        if (error.name === 'ResourceNotFoundException') {
          return;
        } else {
          throw error;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      waitTimeSeconds += 1;
    }
    throw new Error(`Table ${this.name} delete timed out`);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").CreateTableCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").CreateTableCommandOutput>} -
   */
  async createTable(params) {
    const command = new Dynamo.CreateTableCommand(params);
    return this.dynamo.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").DeleteTableCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").DeleteTableCommandOutput>} -
   */
  async deleteTable(params) {
    const command = new Dynamo.DeleteTableCommand(params);
    return this.dynamo.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").DescribeTableCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").DescribeTableCommandOutput>} -
   */
  async describeTable(params) {
    const command = new Dynamo.DescribeTableCommand(params);
    return this.dynamo.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").UpdateTableCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").UpdateTableCommandOutput>} -
   */
  async updateTable(params) {
    const command = new Dynamo.UpdateTableCommand(params);
    return this.dynamo.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").DescribeTimeToLiveCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").DescribeTimeToLiveCommandOutput>} -
   */
  async describeTimeToLive(params) {
    const command = new Dynamo.DescribeTimeToLiveCommand(params);
    return this.dynamo.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-dynamodb").UpdateTimeToLiveCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-dynamodb").UpdateTimeToLiveCommandOutput>} -
   */
  async updateTimeToLive(params) {
    const command = new Dynamo.UpdateTimeToLiveCommand(params);
    return this.dynamo.send(command);
  }

  /**
   * @param {Omit<import("@aws-sdk/lib-dynamodb").PutCommandInput, 'TableName'>} params -
   * @returns {Promise<import("@aws-sdk/lib-dynamodb").PutCommandOutput>} -
   */
  async put(params) {
    return this.dynamoDocument.put({
      ...params,
      TableName: this.name,
    });
  }
}

module.exports = Table;
