'use strict';
const { DynamoDBDocument } = require('@aws-sdk/lib-dynamodb');
const Dynamo = require('@aws-sdk/client-dynamodb');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');
const { ResourceNotFoundException } = require('@aws-sdk/client-dynamodb');

const BaseAWS = require('../../../base');
const BaseResource = require('../base-resource');

/**
 * @typedef TableRecordProperties
 * @property {string} tableName -
 * @property {string} keyValue -
 * @property {string} [keyName] -
 * @property {string} [sortKeyValue] -
 * @property {string} [sortKeyName] -
 * @property {any} data -
 */

/**
 * @typedef TableRecordOptions
 * @property {string} name -
 * @property {import('../reconcilable').Status} [status] -
 * @property {TableRecordProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class TableRecord extends BaseResource {
  /**
   * @param {TableRecordOptions} options -
   */
  constructor({ name, status, dependsOn = [], properties }) {
    const propertiesWithDefaults = Object.assign(
      {
        keyName: 'key',
        sortKeyName: 'sort_key',
      },
      properties
    );
    super({ name, status, dependsOn, properties: propertiesWithDefaults });
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

  async _reconcile() {
    await this.dynamoDocument.put({
      TableName: this.get('tableName'),
      Item: {
        [this.get('keyName')]: this.get('keyValue'),
        ...(this.has('sortKeyValue')
          ? { [this.get('sortKeyName')]: this.get('sortKeyValue') }
          : {}),
        ...this.get('data', {}),
      },
      ReturnValues: 'NONE',
    });
  }

  async _destroy() {
    try {
      await this.dynamoDocument.delete({
        TableName: this.get('tableName'),
        Key: {
          [this.get('keyName')]: this.get('keyValue'),
          ...(this.has('sortKeyValue')
            ? { [this.get('sortKeyName')]: this.get('sortKeyValue') }
            : {}),
        },
        ReturnValues: 'NONE',
      });
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) {
        throw error;
      }
    }
  }
}

module.exports = TableRecord;
