/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact internal boundary helpers are clearer than expanded parser-specific annotations. */

import { validateProviderScope } from './deployment-provider-scope.js';

export const DEPLOYMENT_CONTROL_TABLE_NAME = 'wharfie-deployment-control-v1';
export const DEPLOYMENT_CONTROL_TABLE_RECORD_KEY = 'record_key';
export const DEPLOYMENT_CONTROL_TABLE_PITR_DAYS = 35;
export const DEPLOYMENT_CONTROL_TABLE_MAX_INSPECTION_ATTEMPTS = 30;

const FACTORY_KEYS = new Set(['client', 'providerScope', 'waitForActive']);
const REQUIRED_CLIENT_METHODS = Object.freeze([
  'createTable',
  'describeContinuousBackups',
  'describeTable',
  'describeTimeToLive',
  'listTagsOfResource',
  'updateContinuousBackups',
]);
const TABLE_ARN_PATTERN =
  /^arn:(aws(?:-[a-z0-9]+)*):dynamodb:([a-z0-9]+(?:-[a-z0-9]+)+):([0-9]{12}):table\/([A-Za-z0-9_.-]{3,255})$/;
const TABLE_ID_PATTERN = /^[!-~]{1,1024}$/;
const MAX_TAG_PAGES = 16;

const BASE_RESERVED_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'deployment-control-table',
  'wharfie:retention': 'retain',
  'wharfie:storage-schema-version': '1',
});

/**
 * @typedef DeploymentControlTableClient
 * @property {(input: import('@aws-sdk/client-dynamodb').CreateTableCommandInput) => Promise<any>} createTable - Create the table.
 * @property {(input: import('@aws-sdk/client-dynamodb').DescribeContinuousBackupsCommandInput) => Promise<any>} describeContinuousBackups - Read backup state.
 * @property {(input: import('@aws-sdk/client-dynamodb').DescribeTableCommandInput) => Promise<any>} describeTable - Read table state.
 * @property {(input: import('@aws-sdk/client-dynamodb').DescribeTimeToLiveCommandInput) => Promise<any>} describeTimeToLive - Read TTL state.
 * @property {(input: import('@aws-sdk/client-dynamodb').ListTagsOfResourceCommandInput) => Promise<any>} listTagsOfResource - Read tags.
 * @property {(input: import('@aws-sdk/client-dynamodb').UpdateContinuousBackupsCommandInput) => Promise<any>} updateContinuousBackups - Strengthen backups.
 */

export class DeploymentControlTableConflictError extends Error {
  constructor(
    message = 'AWS deployment control table conflicts with the required contract.',
  ) {
    super(message);
    this.name = 'DeploymentControlTableConflictError';
    this.code = 'DEPLOYMENT_CONTROL_TABLE_CONFLICT';
  }
}

export class DeploymentControlTableUnknownError extends Error {
  constructor(message = 'AWS deployment control table state is unknown.') {
    super(message);
    this.name = 'DeploymentControlTableUnknownError';
    this.code = 'DEPLOYMENT_CONTROL_TABLE_UNKNOWN';
  }
}

class DeploymentControlTableTagsNotVisibleError extends DeploymentControlTableConflictError {}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {Record<string, any>} value @param {Set<string>} allowed @param {string} path @returns {void} */
function assertSupportedKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${path} are invalid.`);
  }
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} error @param {string} name @returns {boolean} */
function errorNamed(error, name) {
  return (
    !!error &&
    typeof error === 'object' &&
    /** @type {{name?: unknown}} */ (error).name === name
  );
}

/** @returns {Promise<void>} */
async function defaultWaitForActive() {
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

/** @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, string>>} */
function requiredTags(providerScope) {
  return Object.freeze({
    ...BASE_RESERVED_TAGS,
    'wharfie:provider-scope-id': providerScope.providerScopeId,
  });
}

/** @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, any>>} */
function absentEvidence(providerScope) {
  return deepFreeze({
    schemaVersion: 1,
    kind: 'deploymentControlTableInspection',
    status: 'absent',
    evidence: 'resource-not-found',
    tableName: DEPLOYMENT_CONTROL_TABLE_NAME,
    providerScopeId: providerScope.providerScopeId,
    tableArn: null,
    tableId: null,
    pitrEnabled: false,
    pitrRecoveryPeriodDays: null,
    ttlEnabled: false,
  });
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, any>>} */
function validateTableDescription(value, providerScope) {
  if (!isPlainObject(value) || !isPlainObject(value.Table)) {
    throw new DeploymentControlTableUnknownError();
  }
  const table = value.Table;
  const arnMatch =
    typeof table.TableArn === 'string'
      ? TABLE_ARN_PATTERN.exec(table.TableArn)
      : null;
  if (
    table.TableName !== DEPLOYMENT_CONTROL_TABLE_NAME ||
    typeof table.TableId !== 'string' ||
    !TABLE_ID_PATTERN.test(table.TableId) ||
    !arnMatch ||
    arnMatch[1] !== providerScope.partition ||
    arnMatch[2] !== providerScope.region ||
    arnMatch[3] !== providerScope.accountId ||
    arnMatch[4] !== DEPLOYMENT_CONTROL_TABLE_NAME
  ) {
    throw new DeploymentControlTableConflictError();
  }

  const attributeDefinitions = table.AttributeDefinitions;
  const keySchema = table.KeySchema;
  const exactKey =
    Array.isArray(attributeDefinitions) &&
    attributeDefinitions.length === 1 &&
    attributeDefinitions[0]?.AttributeName ===
      DEPLOYMENT_CONTROL_TABLE_RECORD_KEY &&
    attributeDefinitions[0]?.AttributeType === 'S' &&
    Array.isArray(keySchema) &&
    keySchema.length === 1 &&
    keySchema[0]?.AttributeName === DEPLOYMENT_CONTROL_TABLE_RECORD_KEY &&
    keySchema[0]?.KeyType === 'HASH';
  const noIndexes =
    (table.LocalSecondaryIndexes === undefined ||
      (Array.isArray(table.LocalSecondaryIndexes) &&
        table.LocalSecondaryIndexes.length === 0)) &&
    (table.GlobalSecondaryIndexes === undefined ||
      (Array.isArray(table.GlobalSecondaryIndexes) &&
        table.GlobalSecondaryIndexes.length === 0));
  const noReplicas =
    table.Replicas === undefined ||
    (Array.isArray(table.Replicas) && table.Replicas.length === 0);
  const noStream =
    table.LatestStreamArn === undefined &&
    (table.StreamSpecification === undefined ||
      table.StreamSpecification?.StreamEnabled === false);
  const onDemand = table.BillingModeSummary?.BillingMode === 'PAY_PER_REQUEST';
  const standardClass =
    table.TableClassSummary === undefined ||
    table.TableClassSummary?.TableClass === 'STANDARD';
  const deletionProtected = table.DeletionProtectionEnabled === true;
  const encryption = table.SSEDescription;
  // DynamoDB's absent encryption type is the default AWS-owned key. AES256 is
  // accepted for legacy descriptions of that same service-owned boundary.
  const awsOwnedEncryption =
    encryption === undefined ||
    (encryption?.SSEType === 'AES256' &&
      encryption?.KMSMasterKeyArn === undefined &&
      (encryption?.Status === undefined || encryption.Status === 'ENABLED'));
  if (
    !exactKey ||
    !noIndexes ||
    !noReplicas ||
    !noStream ||
    !onDemand ||
    !standardClass ||
    !deletionProtected ||
    !awsOwnedEncryption
  ) {
    throw new DeploymentControlTableConflictError();
  }
  if (table.TableStatus !== 'CREATING' && table.TableStatus !== 'ACTIVE') {
    throw new DeploymentControlTableUnknownError();
  }
  return deepFreeze({
    tableArn: table.TableArn,
    tableId: table.TableId,
    tableStatus: table.TableStatus,
  });
}

/** @param {DeploymentControlTableClient} client @returns {Promise<void>} */
async function validateTimeToLiveDisabled(client) {
  let response;
  try {
    response = await client.describeTimeToLive({
      TableName: DEPLOYMENT_CONTROL_TABLE_NAME,
    });
  } catch {
    throw new DeploymentControlTableUnknownError();
  }
  const status = response?.TimeToLiveDescription?.TimeToLiveStatus;
  if (status === 'DISABLED') return;
  if (status === 'ENABLING' || status === 'ENABLED') {
    throw new DeploymentControlTableConflictError();
  }
  if (status === 'DISABLING') throw new DeploymentControlTableUnknownError();
  throw new DeploymentControlTableUnknownError();
}

/** @param {DeploymentControlTableClient} client @param {string} tableArn @param {Readonly<Record<string, string>>} expected @returns {Promise<void>} */
async function validateTags(client, tableArn, expected) {
  const observed = new Map();
  let nextToken;
  for (let page = 0; page < MAX_TAG_PAGES; page += 1) {
    let response;
    try {
      response = await client.listTagsOfResource({
        ResourceArn: tableArn,
        ...(nextToken === undefined ? {} : { NextToken: nextToken }),
      });
    } catch {
      throw new DeploymentControlTableUnknownError();
    }
    if (!response || typeof response !== 'object') {
      throw new DeploymentControlTableUnknownError();
    }
    const tags = response.Tags ?? [];
    if (!Array.isArray(tags)) throw new DeploymentControlTableUnknownError();
    for (const tag of tags) {
      if (
        !tag ||
        typeof tag.Key !== 'string' ||
        typeof tag.Value !== 'string' ||
        observed.has(tag.Key)
      ) {
        throw new DeploymentControlTableConflictError();
      }
      observed.set(tag.Key, tag.Value);
    }
    nextToken = response.NextToken;
    if (nextToken === undefined) break;
    if (typeof nextToken !== 'string' || nextToken.length === 0) {
      throw new DeploymentControlTableUnknownError();
    }
    if (page + 1 === MAX_TAG_PAGES) {
      throw new DeploymentControlTableUnknownError();
    }
  }
  for (const [key, value] of observed) {
    if (key.startsWith('wharfie:') && expected[key] === undefined) {
      throw new DeploymentControlTableConflictError();
    }
    if (expected[key] !== undefined && expected[key] !== value) {
      throw new DeploymentControlTableConflictError();
    }
  }
  for (const [key, value] of Object.entries(expected)) {
    if (observed.get(key) !== value) {
      throw new DeploymentControlTableTagsNotVisibleError();
    }
  }
}

/** @param {DeploymentControlTableClient} client @returns {Promise<{enabled: boolean, recoveryPeriodDays: number|null}>} */
async function inspectPitr(client) {
  let response;
  try {
    response = await client.describeContinuousBackups({
      TableName: DEPLOYMENT_CONTROL_TABLE_NAME,
    });
  } catch {
    throw new DeploymentControlTableUnknownError();
  }
  const description = response?.ContinuousBackupsDescription;
  const pitr = description?.PointInTimeRecoveryDescription;
  if (description?.ContinuousBackupsStatus !== 'ENABLED') {
    throw new DeploymentControlTableUnknownError();
  }
  if (pitr?.PointInTimeRecoveryStatus === 'DISABLED') {
    return { enabled: false, recoveryPeriodDays: null };
  }
  if (
    pitr?.PointInTimeRecoveryStatus === 'ENABLED' &&
    Number.isSafeInteger(pitr.RecoveryPeriodInDays) &&
    pitr.RecoveryPeriodInDays >= 1 &&
    pitr.RecoveryPeriodInDays <= 35
  ) {
    return {
      enabled: true,
      recoveryPeriodDays: pitr.RecoveryPeriodInDays,
    };
  }
  throw new DeploymentControlTableUnknownError();
}

/** @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<import('@aws-sdk/client-dynamodb').CreateTableCommandInput>} */
function createTableRequest(providerScope) {
  const tags = requiredTags(providerScope);
  return deepFreeze({
    TableName: DEPLOYMENT_CONTROL_TABLE_NAME,
    AttributeDefinitions: [
      {
        AttributeName: DEPLOYMENT_CONTROL_TABLE_RECORD_KEY,
        AttributeType: 'S',
      },
    ],
    KeySchema: [
      { AttributeName: DEPLOYMENT_CONTROL_TABLE_RECORD_KEY, KeyType: 'HASH' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
    TableClass: 'STANDARD',
    DeletionProtectionEnabled: true,
    Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
  });
}

/**
 * Bind the fixed, retained deployment-control table lifecycle to one exact AWS
 * provider scope. `inspect` is strictly read-only; `bootstrap` is the only
 * mutating entry point and never deletes or weakens the table.
 * @param {{client: DeploymentControlTableClient, providerScope: unknown, waitForActive?: (attempt: number) => Promise<void>}} options - Explicit client, scope, and optional wait hook.
 * @returns {Readonly<{inspect: () => Promise<Readonly<Record<string, any>>>, bootstrap: () => Promise<Readonly<Record<string, any>>>}>} - Lifecycle API.
 */
export function createDeploymentControlTableLifecycle(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('deploymentControlTable options must be an object.');
  }
  assertSupportedKeys(options, FACTORY_KEYS, 'deploymentControlTable options');
  if (
    !Object.hasOwn(options, 'client') ||
    !Object.hasOwn(options, 'providerScope')
  ) {
    throw new TypeError(
      'deploymentControlTable client and providerScope are required.',
    );
  }
  const client = options.client;
  if (!client || typeof client !== 'object') {
    throw new TypeError('deploymentControlTable client must be an object.');
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof (/** @type {any} */ (client)[method]) !== 'function') {
      throw new TypeError(
        `deploymentControlTable client.${method} is required.`,
      );
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'deploymentControlTable providerScope',
  );
  const waitForActive = options.waitForActive ?? defaultWaitForActive;
  if (typeof waitForActive !== 'function') {
    throw new TypeError(
      'deploymentControlTable waitForActive must be a function.',
    );
  }
  const expectedTags = requiredTags(providerScope);

  /** @returns {Promise<Readonly<Record<string, any>>>} */
  async function inspect() {
    let response;
    try {
      response = await client.describeTable({
        TableName: DEPLOYMENT_CONTROL_TABLE_NAME,
      });
    } catch (error) {
      if (errorNamed(error, 'ResourceNotFoundException')) {
        return absentEvidence(providerScope);
      }
      throw new DeploymentControlTableUnknownError();
    }
    const table = validateTableDescription(response, providerScope);
    if (table.tableStatus === 'CREATING') {
      return deepFreeze({
        schemaVersion: 1,
        kind: 'deploymentControlTableInspection',
        status: 'creating',
        evidence: 'describe-table',
        tableName: DEPLOYMENT_CONTROL_TABLE_NAME,
        providerScopeId: providerScope.providerScopeId,
        tableArn: table.tableArn,
        tableId: table.tableId,
        pitrEnabled: null,
        pitrRecoveryPeriodDays: null,
        ttlEnabled: null,
      });
    }
    const [, pitr] = await Promise.all([
      validateTags(client, table.tableArn, expectedTags),
      inspectPitr(client),
      validateTimeToLiveDisabled(client),
    ]);
    const pitrReady =
      pitr.enabled === true &&
      pitr.recoveryPeriodDays === DEPLOYMENT_CONTROL_TABLE_PITR_DAYS;
    return deepFreeze({
      schemaVersion: 1,
      kind: 'deploymentControlTableInspection',
      status: pitrReady ? 'active' : 'bootstrap-required',
      evidence: 'describe-table-tags-backups-and-ttl',
      tableName: DEPLOYMENT_CONTROL_TABLE_NAME,
      providerScopeId: providerScope.providerScopeId,
      tableArn: table.tableArn,
      tableId: table.tableId,
      pitrEnabled: pitr.enabled,
      pitrRecoveryPeriodDays: pitr.recoveryPeriodDays,
      ttlEnabled: false,
    });
  }

  /** @param {(state: Readonly<Record<string, any>>) => boolean} accepted @param {boolean} [retryMissingTags] @returns {Promise<Readonly<Record<string, any>>>} */
  async function awaitInspection(accepted, retryMissingTags = false) {
    for (
      let attempt = 0;
      attempt < DEPLOYMENT_CONTROL_TABLE_MAX_INSPECTION_ATTEMPTS;
      attempt += 1
    ) {
      // Bootstrap is the explicit bounded convergence boundary. Public
      // inspection remains one-shot, while transient/transitioning reads are
      // retried here before any mutation decision is made.
      let state;
      try {
        state = await inspect();
      } catch (error) {
        const retryable =
          error instanceof DeploymentControlTableUnknownError ||
          (retryMissingTags &&
            error instanceof DeploymentControlTableTagsNotVisibleError);
        if (!retryable) throw error;
        if (attempt + 1 === DEPLOYMENT_CONTROL_TABLE_MAX_INSPECTION_ATTEMPTS) {
          throw error;
        }
        try {
          await waitForActive(attempt + 1);
        } catch {
          throw new DeploymentControlTableUnknownError();
        }
        continue;
      }
      if (accepted(state)) return state;
      if (attempt + 1 < DEPLOYMENT_CONTROL_TABLE_MAX_INSPECTION_ATTEMPTS) {
        try {
          await waitForActive(attempt + 1);
        } catch {
          throw new DeploymentControlTableUnknownError();
        }
      }
    }
    throw new DeploymentControlTableUnknownError();
  }

  /** @returns {Promise<Readonly<Record<string, any>>>} */
  async function bootstrap() {
    let state = await awaitInspection(() => true);
    if (state.status === 'absent') {
      try {
        await client.createTable(createTableRequest(providerScope));
      } catch {
        // Create success, ResourceInUse, and response loss are all resolved by
        // the same exact bounded describe/readback below.
      }
      state = await awaitInspection(
        (candidate) =>
          candidate.status === 'active' ||
          candidate.status === 'bootstrap-required',
        true,
      );
    } else if (state.status === 'creating') {
      state = await awaitInspection(
        (candidate) =>
          candidate.status === 'active' ||
          candidate.status === 'bootstrap-required',
        true,
      );
    }
    if (state.status === 'active') return state;
    if (state.status !== 'bootstrap-required') {
      throw new DeploymentControlTableUnknownError();
    }
    const expectedTableArn = state.tableArn;
    const expectedTableId = state.tableId;
    try {
      await client.updateContinuousBackups({
        TableName: DEPLOYMENT_CONTROL_TABLE_NAME,
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
          RecoveryPeriodInDays: DEPLOYMENT_CONTROL_TABLE_PITR_DAYS,
        },
      });
    } catch {
      // The update may have committed despite a lost response. Only exact
      // final inspection is authoritative.
    }
    return await awaitInspection((candidate) => {
      if (
        candidate.tableArn !== expectedTableArn ||
        candidate.tableId !== expectedTableId
      ) {
        throw new DeploymentControlTableConflictError();
      }
      return candidate.status === 'active';
    });
  }

  return Object.freeze({ inspect, bootstrap });
}

export default { createDeploymentControlTableLifecycle };
