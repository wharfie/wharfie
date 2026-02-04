import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import { DynamoDB, ResourceNotFoundException } from '@aws-sdk/client-dynamodb';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import baseAWS from '../../../base.js';
import BaseResource from '../base-resource.js';

/**
 * @typedef GenericRecordProperties
 * @property {string} tableName - tableName.
 * @property {string} keyValue - keyValue.
 * @property {string} [keyName] - keyName.
 * @property {string} [sortKeyValue] - sortKeyValue.
 * @property {string} [sortKeyName] - sortKeyName.
 * @property {any} [data] - data.
 */

/**
 * @typedef GenericRecordOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {GenericRecordProperties & import('../../typedefs.js').SharedProperties} properties - properties.
 * @property {() => Promise<Object<string,any>>} [dataResolver] - dataResolver.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 */

class GenericRecord extends BaseResource {
  /**
   * @param {GenericRecordOptions} options - options.
   */
  constructor({
    name,
    parent,
    status,
    dataResolver,
    dependsOn = [],
    properties,
  }) {
    const propertiesWithDefaults = Object.assign(
      {
        keyName: 'key',
        sortKeyName: 'sort_key',
      },
      properties,
    );
    super({
      name,
      parent,
      status,
      dependsOn,
      properties: propertiesWithDefaults,
    });
    this.dataResolver = dataResolver;
    const credentials = fromNodeProviderChain();
    this.dynamo = new DynamoDB({
      ...baseAWS.config({
        maxAttempts: Number(process.env?.DYNAMO_MAX_RETRIES || 300),
      }),
      credentials,
    });
    this.dynamoDocument = DynamoDBDocument.from(this.dynamo, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async _reconcile() {
    const resolvedData = this.dataResolver ? await this.dataResolver() : {};
    this.set('data', { ...this.get('data', {}), ...resolvedData });
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

export default GenericRecord;
