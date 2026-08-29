import {
  describeDynamoDBTableForClient as describeDefaultDynamoDBTableForClient,
  pinDescribedDynamoDBTableForClient as pinDefaultDescribedDynamoDBTableForClient,
} from '../lib/db/adapters/dynamodb.js';
import { assertDomainSeparatedSha256Id } from './content-id.js';
import {
  DYNAMODB_TABLE_RESOURCE_ID_PREFIX,
  DynamoDBCoordinatorAuthorityTopologyError,
  validateDynamoDBCoordinatorAuthorityTableTopology,
} from './dynamodb-coordinator-authority-topology.js';

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
 * client cannot substitute a different Region or endpoint. After pure
 * validation succeeds, the exact response privately pins its full table ARN;
 * credential refresh can then access only that resource or fail closed.
 * @param {{db: import('../lib/db/base.js').DBClient, tableName: string, region: string, expectedTableResourceId?: string}} options - Exact open data client, resolved table scope, and optional shared physical-resource expectation.
 * @param {{describeTableForClient?: typeof describeDefaultDynamoDBTableForClient, pinDescribedTableForClient?: typeof pinDefaultDescribedDynamoDBTableForClient}} [dependencies] - Focused adapter-capability test seams.
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
  const allowedOptions = new Set([
    'db',
    'tableName',
    'region',
    'expectedTableResourceId',
  ]);
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
  if (options.expectedTableResourceId !== undefined) {
    try {
      assertDomainSeparatedSha256Id(
        options.expectedTableResourceId,
        DYNAMODB_TABLE_RESOURCE_ID_PREFIX,
        'AWS DynamoDB coordinator expected table resource',
      );
    } catch {
      throw new TypeError(
        'AWS DynamoDB coordinator expected table resource is invalid.',
      );
    }
  }
  if (
    !isPlainObject(dependencies) ||
    Object.keys(dependencies).some(
      (key) =>
        key !== 'describeTableForClient' &&
        key !== 'pinDescribedTableForClient',
    ) ||
    (dependencies.describeTableForClient !== undefined &&
      typeof dependencies.describeTableForClient !== 'function') ||
    (dependencies.pinDescribedTableForClient !== undefined &&
      typeof dependencies.pinDescribedTableForClient !== 'function')
  ) {
    throw new TypeError(
      'AWS DynamoDB coordinator topology dependencies are invalid.',
    );
  }
  const describeTableForClient =
    dependencies.describeTableForClient ??
    describeDefaultDynamoDBTableForClient;
  const pinDescribedTableForClient =
    dependencies.pinDescribedTableForClient ??
    pinDefaultDescribedDynamoDBTableForClient;
  /** @type {unknown} */
  let exactDescription;
  const topology = await validateDynamoDBCoordinatorAuthorityTableTopology({
    tableName: options.tableName,
    region: options.region,
    describeTable: async (input) => {
      exactDescription = await describeTableForClient(options.db, input);
      return exactDescription;
    },
  });
  if (
    options.expectedTableResourceId !== undefined &&
    topology.tableResourceId !== options.expectedTableResourceId
  ) {
    throw new DynamoDBCoordinatorAuthorityTopologyError(
      options.tableName,
      options.region,
      'the table resource does not match the configured identity',
    );
  }
  const tableInput = Object.freeze({ TableName: options.tableName });
  await pinDescribedTableForClient(options.db, tableInput, exactDescription);
  return topology;
}

export default validateAwsDynamoDBCoordinatorAuthorityTableTopology;
