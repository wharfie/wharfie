import { describeDynamoDBTableForClient as describeDefaultDynamoDBTableForClient } from '../lib/db/adapters/dynamodb.js';
import { validateDynamoDBCoordinatorAuthorityTableTopology } from './dynamodb-coordinator-authority-topology.js';

/**
 * @param {unknown} value - Candidate object.
 * @returns {value is Record<string, any>} - Whether the value is a plain object.
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Validate the exact authority table through the raw DynamoDB service client
 * already owned by the ledger's DB wrapper. The adapter keeps that capability
 * private in a WeakMap, so a copied brand or a separately configured AWS
 * client cannot substitute a different Region, credential scope, or endpoint.
 * @param {{db: import('../lib/db/base.js').DBClient, tableName: string, region: string}} options - Exact open data client and resolved table scope.
 * @param {{describeTableForClient?: typeof describeDefaultDynamoDBTableForClient}} [dependencies] - Focused adapter-capability test seam.
 * @returns {Promise<Readonly<Record<string, any>>>} - Frozen topology evidence.
 */
export async function validateAwsDynamoDBCoordinatorAuthorityTableTopology(
  options,
  dependencies = {},
) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'AWS DynamoDB coordinator topology options must be an object.',
    );
  }
  const allowedOptions = new Set(['db', 'tableName', 'region']);
  if (
    Object.keys(options).some((key) => !allowedOptions.has(key)) ||
    !Object.prototype.hasOwnProperty.call(options, 'db') ||
    !Object.prototype.hasOwnProperty.call(options, 'tableName') ||
    !Object.prototype.hasOwnProperty.call(options, 'region')
  ) {
    throw new TypeError(
      'AWS DynamoDB coordinator topology options contain unsupported or missing fields.',
    );
  }
  if (
    !isPlainObject(dependencies) ||
    Object.keys(dependencies).some((key) => key !== 'describeTableForClient') ||
    (dependencies.describeTableForClient !== undefined &&
      typeof dependencies.describeTableForClient !== 'function')
  ) {
    throw new TypeError(
      'AWS DynamoDB coordinator topology dependencies are invalid.',
    );
  }
  const describeTableForClient =
    dependencies.describeTableForClient ??
    describeDefaultDynamoDBTableForClient;
  return await validateDynamoDBCoordinatorAuthorityTableTopology({
    tableName: options.tableName,
    region: options.region,
    describeTable: async (input) =>
      await describeTableForClient(options.db, input),
  });
}

export default validateAwsDynamoDBCoordinatorAuthorityTableTopology;
