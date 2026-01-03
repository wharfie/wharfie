// eslint-disable-next-line node/no-unpublished-import
import { jest } from '@jest/globals';

import { promises, existsSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { createId } from '../../id.js';
import paths from '../../paths.js';
import { CONDITION_TYPE } from '../base.js';

/**
 * @type {Object<string,Object<string,import('../base.js').DBRecord>>}
 */
const ROOT_DB = {};

/**
 * Factory options for creating a DynamoDB wrapper client.
 * @typedef CreateDynamoDBOptions
 * @property {string} [region] AWS region to use. Defaults to `process.env.AWS_REGION`.
 */

/**
 * @returns {import('../base.js').DBClient} -
 */
export default function createMockDB() {
  /**
   * @param {import('../base.js').QueryParams} params -
   * @returns {import('../base.js').QueryReturn} -
   */
  const query = async (params) => {
    let currentRecords = Object.values(ROOT_DB[params.tableName]);
    params.keyConditions.forEach((condition) => {
      if (condition.conditionType === CONDITION_TYPE.BEGINS_WITH) {
        /**
         * @type {import('../base.js').DBRecord[]}
         */
        const futureRecords = [];
        currentRecords.forEach((record) => {
          if (
            record[condition.propertyName.toString()].startsWith(
              condition.propertyValue,
            )
          ) {
            futureRecords.push(record);
          }
        });
        currentRecords = futureRecords;
      } else if (condition.conditionType === CONDITION_TYPE.EQUALS) {
        /**
         * @type {import('../base.js').DBRecord[]}
         */
        const futureRecords = [];
        currentRecords.forEach((record) => {
          if (record[condition.propertyName] === condition.propertyValue) {
            futureRecords.push(record);
          }
        });
        currentRecords = futureRecords;
      } else {
        throw new Error(`invalid condition type: ${condition.conditionType}`);
      }
    });
    return currentRecords;
  };

  /**
   * @param {import('../base.js').BatchWriteParams} params -
   * @returns {import('../base.js').BatchWriteReturn} -
   */
  const batchWrite = async (params) => {
    // no-op
  };

  /**
   * @param {import('../base.js').UpdateParams} params -
   * @returns {import('../base.js').UpdateReturn} -
   */
  const update = async (params) => {};

  /**
   * @param {import('../base.js').PutParams} params -
   * @returns {import('../base.js').PutReturn} -
   */
  const put = async (params) => {
    // no-op
  };

  /**
   * @param {import('../base.js').GetParams} params -
   * @returns {import('../base.js').GetReturn} -
   */
  const get = async (params) => {
    return undefined;
  };

  /**
   * @param {import('../base.js').RemoveParams} params -
   * @returns {import('../base.js').RemoveReturn} -
   */
  const remove = async (params) => {
    // no-op
  };

  const close = async () => {
    // no-op
  };

  return {
    query,
    put,
    update,
    get,
    remove,
    batchWrite,
    close,
  };
}
