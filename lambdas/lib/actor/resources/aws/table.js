'use strict';
const DynamoDB = require('../../../dynamodb');
const { DynamoDBDocument } = require('@aws-sdk/lib-dynamodb');
const { ResourceNotFoundException } = require('@aws-sdk/client-dynamodb');

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
 * @property {TableProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class Table extends BaseResource {
  /**
   * @param {TableOptions} options -
   */
  constructor({ name, status, properties, dependsOn = [] }) {
    super({ name, status, properties, dependsOn });
    this.dynamo = new DynamoDB({});
    this.dynamoDocument = DynamoDBDocument.from(this.dynamo.dynamodb, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async exists() {
    try {
      await this.dynamo.describeTable({ TableName: this.name });
      return true;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        return false;
      }
      throw error;
    }
  }

  async _reconcile() {
    try {
      const { Table } = await this.dynamo.describeTable({
        TableName: this.name,
      });
      this.set('arn', Table?.TableArn);
      if (
        Table?.ProvisionedThroughput?.ReadCapacityUnits !==
          this.get('provisionedThroughput').ReadCapacityUnits ||
        Table?.ProvisionedThroughput?.WriteCapacityUnits !==
          this.get('provisionedThroughput').WriteCapacityUnits
      ) {
        await this.dynamo.updateTable({
          TableName: this.name,
          ProvisionedThroughput: this.get('provisionedThroughput'),
        });
      }
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        const { TableDescription } = await this.dynamo.createTable({
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
      const { TimeToLiveDescription } = await this.dynamo.describeTimeToLive({
        TableName: this.name,
      });
      if (
        TimeToLiveDescription?.AttributeName !==
        this.get('timeToLiveSpecification').AttributeName
      ) {
        await this.dynamo.updateTimeToLive({
          TableName: this.name,
          TimeToLiveSpecification: this.get('timeToLiveSpecification'),
        });
      }
    }
  }

  async _destroy() {
    try {
      await this.dynamo.deleteTable({ TableName: this.name });
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) {
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
      const { Table } = await this.dynamo.describeTable({
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
        await this.dynamo.describeTable({
          TableName: this.name,
        });
      } catch (error) {
        if (error instanceof ResourceNotFoundException) {
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