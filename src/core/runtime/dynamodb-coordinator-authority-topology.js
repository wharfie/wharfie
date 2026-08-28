export const DYNAMODB_COORDINATOR_AUTHORITY_TOPOLOGY_SCHEMA_VERSION = 1;
export const DYNAMODB_COORDINATOR_AUTHORITY_TOPOLOGY_KIND =
  'dynamodb-coordinator-authority-topology';

const TABLE_NAME_PATTERN = /^[A-Za-z0-9_.-]{3,255}$/u;
const REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z0-9-]+-[0-9]+$/u;
const TABLE_ARN_PATTERN =
  /^arn:(aws(?:-[a-z0-9]+)*):dynamodb:([^:]+):([0-9]{12}):table\/([A-Za-z0-9_.-]{3,255})$/u;
const EXPECTED_KEY_SCHEMA = Object.freeze([
  Object.freeze({
    attributeName: 'run_id',
    attributeType: 'S',
    keyType: 'HASH',
  }),
  Object.freeze({
    attributeName: 'sort_key',
    attributeType: 'S',
    keyType: 'RANGE',
  }),
]);

/** The observed table definitively conflicts with the authority topology. */
export class DynamoDBCoordinatorAuthorityTopologyError extends Error {
  /**
   * @param {string} tableName - Expected table name.
   * @param {string} region - Expected Region.
   * @param {string} reason - Safe bounded rejection reason.
   */
  constructor(tableName, region, reason) {
    super(
      `DynamoDB coordinator authority topology is invalid: ${tableName}@${region} (${reason})`,
    );
    this.name = 'DynamoDBCoordinatorAuthorityTopologyError';
    this.code = 'WHARFIE_DYNAMODB_COORDINATOR_TOPOLOGY_INVALID';
    this.tableName = tableName;
    this.region = region;
    this.reason = reason;
  }
}

/** The table topology could not be established from provider evidence. */
export class DynamoDBCoordinatorAuthorityTopologyUnknownError extends Error {
  /**
   * @param {string} tableName - Expected table name.
   * @param {string} region - Expected Region.
   * @param {string} reason - Safe bounded failure reason.
   * @param {{cause?: unknown}} [options] - Optional provider failure.
   */
  constructor(tableName, region, reason, options = {}) {
    super(
      `DynamoDB coordinator authority topology is unknown: ${tableName}@${region} (${reason})`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'DynamoDBCoordinatorAuthorityTopologyUnknownError';
    this.code = 'WHARFIE_DYNAMODB_COORDINATOR_TOPOLOGY_UNKNOWN';
    this.tableName = tableName;
    this.region = region;
    this.reason = reason;
  }
}

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
 * @param {any} value - JSON-like value.
 * @returns {any} - Recursively frozen value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * @param {unknown} value - Candidate table name.
 * @returns {string} - Exact validated name.
 */
function tableNameInput(value) {
  if (typeof value !== 'string' || !TABLE_NAME_PATTERN.test(value)) {
    throw new TypeError(
      'DynamoDB coordinator authority tableName must be an exact valid DynamoDB table name.',
    );
  }
  return value;
}

/**
 * @param {unknown} value - Candidate AWS Region.
 * @returns {string} - Exact validated Region.
 */
function regionInput(value) {
  if (typeof value !== 'string' || !REGION_PATTERN.test(value)) {
    throw new TypeError(
      'DynamoDB coordinator authority region must be an exact AWS Region.',
    );
  }
  return value;
}

/**
 * @param {unknown} value - Candidate array metadata.
 * @returns {boolean} - Whether provider metadata proves no members.
 */
function absentOrEmptyArray(value) {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

/**
 * @param {unknown} keySchema - Provider key schema.
 * @param {unknown} attributeDefinitions - Provider attribute definitions.
 * @returns {boolean} - Whether the exact ledger key schema is present.
 */
function hasExactLedgerSchema(keySchema, attributeDefinitions) {
  if (
    !Array.isArray(keySchema) ||
    keySchema.length !== EXPECTED_KEY_SCHEMA.length ||
    !Array.isArray(attributeDefinitions) ||
    attributeDefinitions.length !== EXPECTED_KEY_SCHEMA.length
  ) {
    return false;
  }
  return EXPECTED_KEY_SCHEMA.every(
    ({ attributeName, attributeType, keyType }) =>
      keySchema.some(
        (entry) =>
          isPlainObject(entry) &&
          entry.AttributeName === attributeName &&
          entry.KeyType === keyType,
      ) &&
      attributeDefinitions.some(
        (entry) =>
          isPlainObject(entry) &&
          entry.AttributeName === attributeName &&
          entry.AttributeType === attributeType,
      ),
  );
}

/**
 * Validate one DescribeTable response against the resident authority contract.
 * No provider client or SDK type crosses this core boundary. The table ARN is
 * used only to prove the exact Region and table resource; account identity is
 * deliberately omitted from the returned evidence.
 * @param {{description: unknown, tableName: string, region: string}} options - Exact response and expected identity.
 * @returns {Readonly<{
 *   schemaVersion: 1,
 *   kind: 'dynamodb-coordinator-authority-topology',
 *   tableName: string,
 *   region: string,
 *   arnPartition: string,
 *   tableStatus: 'ACTIVE',
 *   keySchema: typeof EXPECTED_KEY_SCHEMA,
 *   replicaCount: 0,
 *   witnessCount: 0,
 *   globalTable: false,
 * }>} - Frozen normalized topology evidence.
 */
export function assertDynamoDBCoordinatorAuthorityTableTopology(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'DynamoDB coordinator authority topology options must be an object.',
    );
  }
  const allowed = new Set(['description', 'tableName', 'region']);
  if (
    Object.keys(options).some((key) => !allowed.has(key)) ||
    !Object.prototype.hasOwnProperty.call(options, 'description') ||
    !Object.prototype.hasOwnProperty.call(options, 'tableName') ||
    !Object.prototype.hasOwnProperty.call(options, 'region')
  ) {
    throw new TypeError(
      'DynamoDB coordinator authority topology options contain unsupported or missing fields.',
    );
  }
  const tableName = tableNameInput(options.tableName);
  const region = regionInput(options.region);
  const description = options.description;
  if (!isPlainObject(description) || !isPlainObject(description.Table)) {
    throw new DynamoDBCoordinatorAuthorityTopologyUnknownError(
      tableName,
      region,
      'table description is unavailable',
    );
  }
  const table = description.Table;
  const arnMatch =
    typeof table.TableArn === 'string'
      ? TABLE_ARN_PATTERN.exec(table.TableArn)
      : null;
  if (
    table.TableName !== tableName ||
    !arnMatch ||
    arnMatch[2] !== region ||
    arnMatch[4] !== tableName
  ) {
    throw new DynamoDBCoordinatorAuthorityTopologyError(
      tableName,
      region,
      'table identity does not match',
    );
  }
  if (table.TableStatus !== 'ACTIVE') {
    throw new DynamoDBCoordinatorAuthorityTopologyError(
      tableName,
      region,
      'table is not ACTIVE',
    );
  }
  if (!hasExactLedgerSchema(table.KeySchema, table.AttributeDefinitions)) {
    throw new DynamoDBCoordinatorAuthorityTopologyError(
      tableName,
      region,
      'primary key schema does not match',
    );
  }
  if (
    !absentOrEmptyArray(table.Replicas) ||
    !absentOrEmptyArray(table.GlobalTableWitnesses) ||
    table.GlobalTableVersion !== undefined ||
    table.MultiRegionConsistency !== undefined
  ) {
    throw new DynamoDBCoordinatorAuthorityTopologyError(
      tableName,
      region,
      'table is replicated or global',
    );
  }
  return deepFreeze({
    schemaVersion: DYNAMODB_COORDINATOR_AUTHORITY_TOPOLOGY_SCHEMA_VERSION,
    kind: DYNAMODB_COORDINATOR_AUTHORITY_TOPOLOGY_KIND,
    tableName,
    region,
    arnPartition: arnMatch[1],
    tableStatus: 'ACTIVE',
    keySchema: EXPECTED_KEY_SCHEMA.map((entry) => ({ ...entry })),
    replicaCount: 0,
    witnessCount: 0,
    globalTable: false,
  });
}

/**
 * Obtain and validate the exact DynamoDB table topology through an injected
 * DescribeTable-style port.
 * @param {{describeTable: (input: Readonly<{TableName: string}>) => Promise<unknown> | unknown, tableName: string, region: string}} options - Exact provider-free inspection dependencies.
 * @returns {Promise<ReturnType<typeof assertDynamoDBCoordinatorAuthorityTableTopology>>} - Frozen normalized topology evidence.
 */
export async function validateDynamoDBCoordinatorAuthorityTableTopology(
  options,
) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'DynamoDB coordinator authority topology validation options must be an object.',
    );
  }
  const allowed = new Set(['describeTable', 'tableName', 'region']);
  if (
    Object.keys(options).some((key) => !allowed.has(key)) ||
    typeof options.describeTable !== 'function' ||
    !Object.prototype.hasOwnProperty.call(options, 'tableName') ||
    !Object.prototype.hasOwnProperty.call(options, 'region')
  ) {
    throw new TypeError(
      'DynamoDB coordinator authority topology validation options contain unsupported or missing fields.',
    );
  }
  const tableName = tableNameInput(options.tableName);
  const region = regionInput(options.region);
  let description;
  try {
    description = await options.describeTable(
      Object.freeze({ TableName: tableName }),
    );
  } catch (cause) {
    throw new DynamoDBCoordinatorAuthorityTopologyUnknownError(
      tableName,
      region,
      'DescribeTable failed',
      { cause },
    );
  }
  return assertDynamoDBCoordinatorAuthorityTableTopology({
    description,
    tableName,
    region,
  });
}
