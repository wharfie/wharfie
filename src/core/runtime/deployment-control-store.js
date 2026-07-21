/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact internal helpers and assertion signatures are not understood cleanly by the current JSDoc lint parser. */

import { CONDITION_TYPE, readDBClientAdapterIdentity } from '../lib/db/base.js';
import { assertDomainSeparatedSha256Id } from './content-id.js';
import {
  assertDeploymentHeadId,
  validateDeploymentHead,
} from './deployment-head.js';
import {
  assertDeploymentPlanId,
  validateDeploymentPlan,
} from './deployment-plan.js';
import { assertDeploymentInstanceId } from './deployment-provider-scope.js';
import {
  DEPLOYMENT_PROFILE_ID_PREFIX,
  validateDeploymentProfile,
} from './deployment-profile.js';
import { cloneBoundedJsonObject } from './json-value.js';

export const DEPLOYMENT_CONTROL_RECORD_KEY_NAME = 'record_key';
export const DEPLOYMENT_CONTROL_STORAGE_SCHEMA_VERSION = 1;
export const DEPLOYMENT_CONTROL_MAX_RECORD_BYTES = 128 * 1024;

export const DEPLOYMENT_CONTROL_RECORD_TYPES = Object.freeze({
  head: 'deployment-head',
  plan: 'deployment-plan',
  profile: 'deployment-profile',
});

export const DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES = Object.freeze({
  head: 'head/v1/',
  plan: 'plan/v1/',
  profile: 'profile/v2/',
});

const RECORD_KEYS = new Set([
  DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
  'storage_schema_version',
  'record_kind',
  'document_id',
  'document',
]);
const FACTORY_KEYS = new Set(['db', 'tableName']);
const CAS_KEYS = new Set(['expectedHeadId', 'nextHead']);
const DYNAMODB_TABLE_NAME_PATTERN = /^[A-Za-z0-9_.-]{3,255}$/;

/**
 * The physical record exists at the requested key but cannot be proven to be
 * the exact content-addressed Wharfie document expected there.
 */
export class DeploymentControlStoreIntegrityError extends Error {
  /** @param {string} message @param {{cause?: unknown}} [options] */
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'DeploymentControlStoreIntegrityError';
  }
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertExactKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {unknown} error @returns {boolean} */
function isNormalizedConditionalFailure(error) {
  return (
    error instanceof Error && error.name === 'ConditionalCheckFailedException'
  );
}

/**
 * @typedef {'deployment-head'|'deployment-plan'|'deployment-profile'} DeploymentControlRecordType
 */

/**
 * @param {DeploymentControlRecordType} recordType - Exact wrapper type.
 * @param {unknown} document - Candidate document.
 * @param {string} path - Boundary label.
 * @returns {{logicalId: string, documentId: string, document: Readonly<Record<string, any>>}} - Canonical record components.
 */
function canonicalRecordComponents(recordType, document, path) {
  const boundedDocument = cloneBoundedJsonObject(
    document,
    DEPLOYMENT_CONTROL_MAX_RECORD_BYTES,
    `${path}.document`,
  );
  if (recordType === DEPLOYMENT_CONTROL_RECORD_TYPES.head) {
    const canonical = validateDeploymentHead(
      boundedDocument,
      `${path}.document`,
    );
    return {
      logicalId: canonical.deploymentInstanceId,
      documentId: canonical.headId,
      document: canonical,
    };
  }
  if (recordType === DEPLOYMENT_CONTROL_RECORD_TYPES.plan) {
    const canonical = validateDeploymentPlan(
      boundedDocument,
      `${path}.document`,
    );
    return {
      logicalId: canonical.planId,
      documentId: canonical.planId,
      document: canonical,
    };
  }
  if (recordType === DEPLOYMENT_CONTROL_RECORD_TYPES.profile) {
    const canonical = validateDeploymentProfile(
      boundedDocument,
      `${path}.document`,
    );
    return {
      logicalId: canonical.profileRevisionId,
      documentId: canonical.profileRevisionId,
      document: canonical,
    };
  }
  throw new TypeError(`${path}.record_kind is not supported.`);
}

/**
 * @param {DeploymentControlRecordType} recordType - Exact wrapper type.
 * @param {string} logicalId - Document lookup identity.
 * @returns {string} - Distributed, type-versioned physical key.
 */
function createRecordKey(recordType, logicalId) {
  if (recordType === DEPLOYMENT_CONTROL_RECORD_TYPES.head) {
    return `${DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES.head}${logicalId}`;
  }
  if (recordType === DEPLOYMENT_CONTROL_RECORD_TYPES.plan) {
    return `${DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES.plan}${logicalId}`;
  }
  if (recordType === DEPLOYMENT_CONTROL_RECORD_TYPES.profile) {
    return `${DEPLOYMENT_CONTROL_RECORD_KEY_PREFIXES.profile}${logicalId}`;
  }
  throw new TypeError('deploymentControlRecord record_kind is not supported.');
}

/**
 * @param {DeploymentControlRecordType} recordType - Exact wrapper type.
 * @param {unknown} document - Candidate immutable document.
 * @returns {Readonly<Record<string, any>>} - Physical record.
 */
function createRecord(recordType, document) {
  const components = canonicalRecordComponents(
    recordType,
    document,
    'deploymentControlRecord',
  );
  return Object.freeze(
    cloneBoundedJsonObject(
      {
        record_key: createRecordKey(recordType, components.logicalId),
        storage_schema_version: DEPLOYMENT_CONTROL_STORAGE_SCHEMA_VERSION,
        record_kind: recordType,
        document_id: components.documentId,
        document: components.document,
      },
      DEPLOYMENT_CONTROL_MAX_RECORD_BYTES,
      'deploymentControlRecord',
    ),
  );
}

/**
 * Validate the complete physical envelope before exposing its document.
 * @param {unknown} value - Candidate DB record.
 * @param {DeploymentControlRecordType} expectedType - Requested record type.
 * @param {string} expectedLogicalId - Requested document lookup identity.
 * @param {string} path - Boundary label.
 * @returns {Readonly<Record<string, any>>} - Canonical document.
 */
function validateStoredRecord(value, expectedType, expectedLogicalId, path) {
  let record;
  try {
    record = cloneBoundedJsonObject(
      value,
      DEPLOYMENT_CONTROL_MAX_RECORD_BYTES,
      path,
    );
    assertExactKeys(record, RECORD_KEYS, path);
    if (
      record.storage_schema_version !==
      DEPLOYMENT_CONTROL_STORAGE_SCHEMA_VERSION
    ) {
      throw new TypeError(
        `${path}.storage_schema_version must be the integer 1.`,
      );
    }
    if (record.record_kind !== expectedType) {
      throw new TypeError(`${path}.record_kind does not match its key.`);
    }
    const expectedRecordKey = createRecordKey(expectedType, expectedLogicalId);
    if (record.record_key !== expectedRecordKey) {
      throw new TypeError(`${path}.record_key does not match its key.`);
    }
    const components = canonicalRecordComponents(
      expectedType,
      record.document,
      path,
    );
    if (components.logicalId !== expectedLogicalId) {
      throw new Error(`${path}.record_key does not match its document.`);
    }
    if (components.documentId !== record.document_id) {
      throw new Error(`${path}.document_id does not match its document.`);
    }
    return components.document;
  } catch (error) {
    throw new DeploymentControlStoreIntegrityError(
      `${path} is not an exact Wharfie deployment-control record.`,
      { cause: error },
    );
  }
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function exactJsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Bind the deployment controller's durable store port to an already-created
 * portable DB table. The table must use the String `record_key` as its sole
 * partition key. This module never discovers credentials, resolves environment
 * configuration, or creates provider resources.
 * @param {{db: import('../lib/db/base.js').DBClient, tableName: string}} options - Explicit existing DB client and table.
 * @returns {Readonly<Record<string, Function>>} - Controller-shaped store.
 */
export function createDeploymentControlStore(options) {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options)
  ) {
    throw new TypeError('deploymentControlStore options must be an object.');
  }
  assertExactKeys(options, FACTORY_KEYS, 'deploymentControlStore options');
  const { db, tableName } = options;
  readDBClientAdapterIdentity(db);
  if (typeof db.get !== 'function') {
    throw new TypeError('deploymentControlStore db.get is required.');
  }
  if (typeof db.transactionWrite !== 'function') {
    throw new TypeError(
      'deploymentControlStore db.transactionWrite is required.',
    );
  }
  if (
    typeof tableName !== 'string' ||
    !DYNAMODB_TABLE_NAME_PATTERN.test(tableName)
  ) {
    throw new TypeError(
      'deploymentControlStore tableName must be an explicit DynamoDB-compatible table name.',
    );
  }

  /**
   * @param {DeploymentControlRecordType} recordType - Exact type.
   * @param {string} recordId - Exact logical record ID.
   * @returns {Promise<Readonly<Record<string, any>>|null>} - Validated document or absence.
   */
  async function readRecord(recordType, recordId) {
    const recordKey = createRecordKey(recordType, recordId);
    const value = await db.get({
      tableName,
      keyName: DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
      keyValue: recordKey,
      consistentRead: true,
    });
    if (value === undefined) return null;
    return validateStoredRecord(
      value,
      recordType,
      recordId,
      'deploymentControlStore record',
    );
  }

  /**
   * @param {DeploymentControlRecordType} recordType - Exact type.
   * @param {unknown} document - Candidate immutable document.
   * @returns {Promise<boolean>} - True only for the first write; false for an exact replay.
   */
  async function putImmutableIfAbsent(recordType, document) {
    const record = createRecord(recordType, document);
    try {
      await db.transactionWrite({
        tableName,
        putRequests: [
          {
            keyName: DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
            record,
            conditions: [
              {
                conditionType: CONDITION_TYPE.NOT_EXISTS,
                propertyName: DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
              },
            ],
          },
        ],
      });
      return true;
    } catch (error) {
      if (!isNormalizedConditionalFailure(error)) throw error;
    }

    const components = canonicalRecordComponents(
      recordType,
      record.document,
      'deploymentControlRecord',
    );
    const existing = await readRecord(recordType, components.logicalId);
    if (existing !== null && exactJsonEqual(existing, record.document)) {
      return false;
    }
    throw new DeploymentControlStoreIntegrityError(
      `deploymentControlStore ${recordType} identity is occupied by different content.`,
    );
  }

  /** @param {string} deploymentInstanceId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readHead(deploymentInstanceId) {
    assertDeploymentInstanceId(
      deploymentInstanceId,
      'deploymentControlStore deploymentInstanceId',
    );
    return readRecord(
      DEPLOYMENT_CONTROL_RECORD_TYPES.head,
      deploymentInstanceId,
    );
  }

  /**
   * Atomically install one exact head generation when the observed predecessor
   * still owns the key. Conditional loss is the only false result; transport,
   * timeout, throttling, and other ambiguous failures propagate to the
   * controller for strong readback.
   * @param {unknown} value - Expected content ID and successor head.
   * @returns {Promise<boolean>} - Whether this call definitely committed.
   */
  async function compareAndSetHead(value) {
    const input = cloneBoundedJsonObject(
      value,
      DEPLOYMENT_CONTROL_MAX_RECORD_BYTES,
      'deploymentControlStore CAS',
    );
    assertExactKeys(input, CAS_KEYS, 'deploymentControlStore CAS');
    if (input.expectedHeadId !== null) {
      assertDeploymentHeadId(
        input.expectedHeadId,
        'deploymentControlStore CAS.expectedHeadId',
      );
    }
    const record = createRecord(
      DEPLOYMENT_CONTROL_RECORD_TYPES.head,
      input.nextHead,
    );
    const conditions =
      input.expectedHeadId === null
        ? [
            {
              conditionType: CONDITION_TYPE.NOT_EXISTS,
              propertyName: DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
            },
          ]
        : [
            {
              conditionType: CONDITION_TYPE.EQUALS,
              propertyName: 'storage_schema_version',
              propertyValue: DEPLOYMENT_CONTROL_STORAGE_SCHEMA_VERSION,
            },
            {
              conditionType: CONDITION_TYPE.EQUALS,
              propertyName: 'record_kind',
              propertyValue: DEPLOYMENT_CONTROL_RECORD_TYPES.head,
            },
            {
              conditionType: CONDITION_TYPE.EQUALS,
              propertyName: 'document_id',
              propertyValue: input.expectedHeadId,
            },
          ];
    try {
      await db.transactionWrite({
        tableName,
        putRequests: [
          {
            keyName: DEPLOYMENT_CONTROL_RECORD_KEY_NAME,
            record,
            conditions,
          },
        ],
      });
      return true;
    } catch (error) {
      if (isNormalizedConditionalFailure(error)) return false;
      throw error;
    }
  }

  /** @param {unknown} plan @returns {Promise<boolean>} */
  async function putPlanIfAbsent(plan) {
    return putImmutableIfAbsent(DEPLOYMENT_CONTROL_RECORD_TYPES.plan, plan);
  }

  /** @param {string} planId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readPlan(planId) {
    assertDeploymentPlanId(planId, 'deploymentControlStore planId');
    return readRecord(DEPLOYMENT_CONTROL_RECORD_TYPES.plan, planId);
  }

  /** @param {unknown} profile @returns {Promise<boolean>} */
  async function putProfileIfAbsent(profile) {
    return putImmutableIfAbsent(
      DEPLOYMENT_CONTROL_RECORD_TYPES.profile,
      profile,
    );
  }

  /** @param {string} profileRevisionId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readProfile(profileRevisionId) {
    assertDomainSeparatedSha256Id(
      profileRevisionId,
      DEPLOYMENT_PROFILE_ID_PREFIX,
      'deploymentControlStore profileRevisionId',
    );
    return readRecord(
      DEPLOYMENT_CONTROL_RECORD_TYPES.profile,
      profileRevisionId,
    );
  }

  return Object.freeze({
    readHead,
    compareAndSetHead,
    putPlanIfAbsent,
    readPlan,
    putProfileIfAbsent,
    readProfile,
  });
}

export default createDeploymentControlStore;
