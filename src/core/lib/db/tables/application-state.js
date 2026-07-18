/* eslint-disable jsdoc/require-param, jsdoc/require-returns -- Internal exact-schema helpers keep their types compact. */

import { randomUUID } from 'node:crypto';

import { CONDITION_TYPE } from '../base.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../../../runtime/content-id.js';
import {
  cloneJsonObject,
  cloneJsonValue,
} from '../../../runtime/json-value.js';
import { assertLedgerOpaqueId } from '../../ledger/record-key.js';

export const APPLICATION_STATE_KEY_NAME = 'resource_id';
export const APPLICATION_STATE_SORT_KEY_NAME = 'sort_key';
export const APPLICATION_STATE_STORE_RESOURCE_ID = 'application-state/v1/store';
export const APPLICATION_STATE_STORE_SORT_KEY = 'identity/v1';
export const APPLICATION_STATE_RECEIPT_SORT_KEY = 'receipt/v1';

const STORE_IDENTITY_KIND = 'application-state-store-identity';
const VALUE_RECORD_KIND = 'application-state-value';
const RECEIPT_RECORD_KIND = 'application-state-effect-receipt';
const PUT_IF_ABSENT_OPERATION = 'put-if-absent';
const SCHEMA_VERSION = 1;

/** A retained row is missing, malformed, or inconsistent with its digest. */
export class ApplicationStateCorruptionError extends Error {
  /** @param {string} message - Bounded corruption description. */
  constructor(message) {
    super(message);
    this.name = 'ApplicationStateCorruptionError';
  }
}

/** A physical store is missing or does not match its retained identity. */
export class ApplicationStateStoreIdentityError extends Error {
  /** @param {string} message - Bounded identity description. */
  constructor(message) {
    super(message);
    this.name = 'ApplicationStateStoreIdentityError';
  }
}

/** One destination effect ID was reused for a different logical contract. */
export class ApplicationStateEffectConflictError extends Error {
  /** @param {string} destinationEffectId - Conflicting destination identity. */
  constructor(destinationEffectId) {
    super(
      `Application-state destination effect conflicts with its permanent receipt: ${destinationEffectId}`,
    );
    this.name = 'ApplicationStateEffectConflictError';
    this.destinationEffectId = destinationEffectId;
  }
}

/** @param {Record<string, any>} value - Candidate exact record. @param {string[]} expected - Exact keys. @param {string} label - Boundary label. */
function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (
    actual.length !== canonical.length ||
    actual.some((key, index) => key !== canonical[index])
  ) {
    throw new ApplicationStateCorruptionError(
      `${label} does not have the exact v1 record shape.`,
    );
  }
}

/** @param {any} value - JSON value. @returns {any} - Recursively frozen value. */
function deepFreezeJson(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
}

/** @param {unknown} error - Candidate conditional failure. @returns {boolean} - Whether a portable condition lost. */
function isConditionalFailure(error) {
  return (
    error instanceof Error && error.name === 'ConditionalCheckFailedException'
  );
}

/** @param {string} storeId - Store identity. @returns {string} - Identity digest. */
function createStoreIdentityDigest(storeId) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:application-state:store-identity:v1',
    prefix: 'wai',
    value: {
      resourceId: APPLICATION_STATE_STORE_RESOURCE_ID,
      sortKey: APPLICATION_STATE_STORE_SORT_KEY,
      recordKind: STORE_IDENTITY_KIND,
      schemaVersion: SCHEMA_VERSION,
      storeId,
    },
    valuePath: 'application-state store identity',
  });
}

/** @returns {string} - Fresh random logical store identity. */
function createRandomStoreId() {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:application-state:store:v1',
    prefix: 'was',
    value: { entropy: randomUUID() },
    valuePath: 'application-state store identity entropy',
  });
}

/** @param {string} namespace - Trusted app namespace. @param {string} key - Logical key. @returns {{resourceId: string, sortKey: string}} - Physical business key. */
export function createApplicationStateBusinessKey(namespace, key) {
  const digest = createCanonicalJsonSha256Id({
    domain: 'wharfie:application-state:business-key:v1',
    prefix: 'wak',
    value: { namespace, key },
    valuePath: 'application-state business key',
  });
  return Object.freeze({
    resourceId: `application-state/v1/record/${digest}`,
    sortKey: 'value/v1',
  });
}

/** @param {string} destinationEffectId - Permanent destination effect ID. @returns {{resourceId: string, sortKey: string}} - Physical receipt key. */
export function createApplicationStateReceiptKey(destinationEffectId) {
  assertLedgerOpaqueId(
    destinationEffectId,
    'application-state destinationEffectId',
  );
  return Object.freeze({
    resourceId: `application-state/v1/effect/${destinationEffectId}`,
    sortKey: APPLICATION_STATE_RECEIPT_SORT_KEY,
  });
}

/** @param {Record<string, any>} fields - Business fields without digest. @returns {string} - Content digest. */
function createBusinessRecordDigest(fields) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:application-state:business-record:v1',
    prefix: 'war',
    value: fields,
    valuePath: 'application-state business record',
  });
}

/** @param {Record<string, any>} fields - Receipt fields without digest. @returns {string} - Content digest. */
function createReceiptDigest(fields) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:application-state:effect-receipt:v1',
    prefix: 'wap',
    value: fields,
    valuePath: 'application-state effect receipt',
  });
}

/** @param {{namespace: string, key: string, value: any, destinationEffectId: string, contractDigest: string}} options - New value record inputs. @returns {Readonly<Record<string, any>>} - Exact record. */
export function createApplicationStateBusinessRecord(options) {
  const key = createApplicationStateBusinessKey(options.namespace, options.key);
  const value = cloneJsonValue(options.value, 'application-state value');
  const fields = {
    [APPLICATION_STATE_KEY_NAME]: key.resourceId,
    [APPLICATION_STATE_SORT_KEY_NAME]: key.sortKey,
    record_kind: VALUE_RECORD_KIND,
    schema_version: SCHEMA_VERSION,
    namespace: options.namespace,
    logical_key: options.key,
    value,
    value_digest: createCanonicalJsonSha256Id({
      domain: 'wharfie:application-state:value:v1',
      prefix: 'wav',
      value,
      valuePath: 'application-state value',
    }),
    created_by_destination_effect_id: options.destinationEffectId,
    contract_digest: options.contractDigest,
  };
  return deepFreezeJson({
    ...fields,
    record_digest: createBusinessRecordDigest(fields),
  });
}

/** @param {{destinationEffectId: string, contractDigest: string, businessRecord: Record<string, any>, inserted: boolean}} options - Receipt inputs. @returns {Readonly<Record<string, any>>} - Exact receipt. */
export function createApplicationStateReceiptRecord(options) {
  const key = createApplicationStateReceiptKey(options.destinationEffectId);
  const fields = {
    [APPLICATION_STATE_KEY_NAME]: key.resourceId,
    [APPLICATION_STATE_SORT_KEY_NAME]: key.sortKey,
    record_kind: RECEIPT_RECORD_KIND,
    schema_version: SCHEMA_VERSION,
    destination_effect_id: options.destinationEffectId,
    operation: PUT_IF_ABSENT_OPERATION,
    contract_digest: options.contractDigest,
    business_resource_id: options.businessRecord[APPLICATION_STATE_KEY_NAME],
    business_sort_key: options.businessRecord[APPLICATION_STATE_SORT_KEY_NAME],
    business_record_digest: options.businessRecord.record_digest,
    outcome_code: options.inserted ? 'inserted' : 'already-present',
    inserted: options.inserted,
  };
  return deepFreezeJson({
    ...fields,
    receipt_digest: createReceiptDigest(fields),
  });
}

/** @param {unknown} value - Candidate store row. @returns {Readonly<Record<string, any>>} - Verified row. */
function validateStoreIdentityRecord(value) {
  let record;
  try {
    record = cloneJsonObject(value, 'application-state store identity');
  } catch {
    throw new ApplicationStateCorruptionError(
      'Application-state store identity is not strict JSON.',
    );
  }
  assertExactKeys(
    record,
    [
      APPLICATION_STATE_KEY_NAME,
      APPLICATION_STATE_SORT_KEY_NAME,
      'record_kind',
      'schema_version',
      'store_id',
      'identity_digest',
    ],
    'Application-state store identity',
  );
  try {
    assertDomainSeparatedSha256Id(
      record.store_id,
      'was',
      'application-state store_id',
    );
    assertDomainSeparatedSha256Id(
      record.identity_digest,
      'wai',
      'application-state identity_digest',
    );
  } catch {
    throw new ApplicationStateCorruptionError(
      'Application-state store identity contains an invalid identifier.',
    );
  }
  if (
    record[APPLICATION_STATE_KEY_NAME] !==
      APPLICATION_STATE_STORE_RESOURCE_ID ||
    record[APPLICATION_STATE_SORT_KEY_NAME] !==
      APPLICATION_STATE_STORE_SORT_KEY ||
    record.record_kind !== STORE_IDENTITY_KIND ||
    record.schema_version !== SCHEMA_VERSION ||
    record.identity_digest !== createStoreIdentityDigest(record.store_id)
  ) {
    throw new ApplicationStateCorruptionError(
      'Application-state store identity failed v1 verification.',
    );
  }
  return deepFreezeJson(record);
}

/** @param {unknown} value - Candidate business row. @returns {Readonly<Record<string, any>>} - Verified row. */
export function validateApplicationStateBusinessRecord(value) {
  let record;
  try {
    record = cloneJsonObject(value, 'application-state business record');
  } catch {
    throw new ApplicationStateCorruptionError(
      'Application-state business record is not strict JSON.',
    );
  }
  const keys = [
    APPLICATION_STATE_KEY_NAME,
    APPLICATION_STATE_SORT_KEY_NAME,
    'record_kind',
    'schema_version',
    'namespace',
    'logical_key',
    'value',
    'value_digest',
    'created_by_destination_effect_id',
    'contract_digest',
    'record_digest',
  ];
  assertExactKeys(record, keys, 'Application-state business record');
  const expectedKey = createApplicationStateBusinessKey(
    record.namespace,
    record.logical_key,
  );
  const fields = Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== 'record_digest'),
  );
  let validIds = true;
  try {
    assertLedgerOpaqueId(
      record.created_by_destination_effect_id,
      'application-state created_by_destination_effect_id',
    );
    assertDomainSeparatedSha256Id(
      record.contract_digest,
      'wac',
      'application-state contract_digest',
    );
    assertDomainSeparatedSha256Id(
      record.value_digest,
      'wav',
      'application-state value_digest',
    );
    assertDomainSeparatedSha256Id(
      record.record_digest,
      'war',
      'application-state record_digest',
    );
  } catch {
    validIds = false;
  }
  if (
    !validIds ||
    typeof record.namespace !== 'string' ||
    !record.namespace ||
    typeof record.logical_key !== 'string' ||
    !record.logical_key ||
    record[APPLICATION_STATE_KEY_NAME] !== expectedKey.resourceId ||
    record[APPLICATION_STATE_SORT_KEY_NAME] !== expectedKey.sortKey ||
    record.record_kind !== VALUE_RECORD_KIND ||
    record.schema_version !== SCHEMA_VERSION ||
    record.value_digest !==
      createCanonicalJsonSha256Id({
        domain: 'wharfie:application-state:value:v1',
        prefix: 'wav',
        value: record.value,
        valuePath: 'application-state retained value',
      }) ||
    record.record_digest !== createBusinessRecordDigest(fields)
  ) {
    throw new ApplicationStateCorruptionError(
      'Application-state business record failed v1 verification.',
    );
  }
  return deepFreezeJson(record);
}

/** @param {unknown} value - Candidate receipt row. @returns {Readonly<Record<string, any>>} - Verified receipt. */
export function validateApplicationStateReceiptRecord(value) {
  let record;
  try {
    record = cloneJsonObject(value, 'application-state effect receipt');
  } catch {
    throw new ApplicationStateCorruptionError(
      'Application-state effect receipt is not strict JSON.',
    );
  }
  const keys = [
    APPLICATION_STATE_KEY_NAME,
    APPLICATION_STATE_SORT_KEY_NAME,
    'record_kind',
    'schema_version',
    'destination_effect_id',
    'operation',
    'contract_digest',
    'business_resource_id',
    'business_sort_key',
    'business_record_digest',
    'outcome_code',
    'inserted',
    'receipt_digest',
  ];
  assertExactKeys(record, keys, 'Application-state effect receipt');
  /** @type {{resourceId: string, sortKey: string}} */
  let receiptKey = { resourceId: '', sortKey: '' };
  const fields = Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== 'receipt_digest'),
  );
  let validIds = true;
  try {
    receiptKey = createApplicationStateReceiptKey(record.destination_effect_id);
    assertDomainSeparatedSha256Id(
      record.contract_digest,
      'wac',
      'application-state receipt contract_digest',
    );
    assertDomainSeparatedSha256Id(
      record.business_record_digest,
      'war',
      'application-state receipt business_record_digest',
    );
    assertDomainSeparatedSha256Id(
      record.receipt_digest,
      'wap',
      'application-state receipt_digest',
    );
  } catch {
    validIds = false;
  }
  const dispositionMatches =
    (record.inserted === true && record.outcome_code === 'inserted') ||
    (record.inserted === false && record.outcome_code === 'already-present');
  if (
    !validIds ||
    record[APPLICATION_STATE_KEY_NAME] !== receiptKey.resourceId ||
    record[APPLICATION_STATE_SORT_KEY_NAME] !== receiptKey.sortKey ||
    record.record_kind !== RECEIPT_RECORD_KIND ||
    record.schema_version !== SCHEMA_VERSION ||
    record.operation !== PUT_IF_ABSENT_OPERATION ||
    !dispositionMatches ||
    typeof record.business_resource_id !== 'string' ||
    typeof record.business_sort_key !== 'string' ||
    record.receipt_digest !== createReceiptDigest(fields)
  ) {
    throw new ApplicationStateCorruptionError(
      'Application-state effect receipt failed v1 verification.',
    );
  }
  return deepFreezeJson(record);
}

/**
 * Create the provider-neutral physical v1 application-state table.
 * @param {{db: import('../base.js').DBClient, tableName: string, createStoreId?: () => string}} options - Exact dependencies.
 */
export function createApplicationStateTable(options) {
  if (!options?.db || typeof options.db.transactionWrite !== 'function') {
    throw new TypeError(
      'createApplicationStateTable requires a transactional DB client.',
    );
  }
  if (typeof options.tableName !== 'string' || !options.tableName.trim()) {
    throw new TypeError(
      'createApplicationStateTable requires a non-empty tableName.',
    );
  }
  if (
    options.createStoreId !== undefined &&
    typeof options.createStoreId !== 'function'
  ) {
    throw new TypeError(
      'createApplicationStateTable.createStoreId must be a function.',
    );
  }
  const db = options.db;
  const tableName = options.tableName.trim();
  const createStoreId = options.createStoreId || createRandomStoreId;

  /** @param {string} resourceId - Partition key. @param {string} sortKey - Sort key. @returns {Promise<Record<string, any> | null>} - Exact row. */
  async function readRecord(resourceId, sortKey) {
    const record = await db.get({
      tableName,
      keyName: APPLICATION_STATE_KEY_NAME,
      keyValue: resourceId,
      sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
      sortKeyValue: sortKey,
      consistentRead: true,
    });
    return record || null;
  }

  /** @returns {Promise<Readonly<Record<string, any>> | null>} - Verified identity or null. */
  async function readStoreIdentity() {
    const row = await readRecord(
      APPLICATION_STATE_STORE_RESOURCE_ID,
      APPLICATION_STATE_STORE_SORT_KEY,
    );
    return row ? validateStoreIdentityRecord(row) : null;
  }

  /** @returns {Promise<Readonly<Record<string, any>>>} - Existing or newly created identity. */
  async function ensureStoreIdentity() {
    const retained = await readStoreIdentity();
    if (retained) return retained;
    const storeId = createStoreId();
    assertDomainSeparatedSha256Id(
      storeId,
      'was',
      'application-state createStoreId result',
    );
    const candidate = deepFreezeJson({
      [APPLICATION_STATE_KEY_NAME]: APPLICATION_STATE_STORE_RESOURCE_ID,
      [APPLICATION_STATE_SORT_KEY_NAME]: APPLICATION_STATE_STORE_SORT_KEY,
      record_kind: STORE_IDENTITY_KIND,
      schema_version: SCHEMA_VERSION,
      store_id: storeId,
      identity_digest: createStoreIdentityDigest(storeId),
    });
    try {
      await db.transactionWrite({
        tableName,
        putRequests: [
          {
            keyName: APPLICATION_STATE_KEY_NAME,
            sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
            record: candidate,
            conditions: [
              {
                conditionType: CONDITION_TYPE.NOT_EXISTS,
                propertyName: APPLICATION_STATE_KEY_NAME,
              },
            ],
          },
        ],
      });
    } catch (error) {
      const winner = await readStoreIdentity();
      if (winner) return winner;
      throw error;
    }
    const persisted = await readStoreIdentity();
    if (!persisted || persisted.store_id !== storeId) {
      throw new ApplicationStateStoreIdentityError(
        'Application-state store identity was not durably readable after creation.',
      );
    }
    return persisted;
  }

  /** @param {string} storeId - Expected store. @returns {Promise<Readonly<Record<string, any>>>} - Verified exact identity. */
  async function assertStoreIdentity(storeId) {
    assertDomainSeparatedSha256Id(
      storeId,
      'was',
      'application-state expected storeId',
    );
    const identity = await readStoreIdentity();
    if (!identity || identity.store_id !== storeId) {
      throw new ApplicationStateStoreIdentityError(
        `Application-state store identity does not match expected store ${storeId}.`,
      );
    }
    return identity;
  }

  /** @param {string} destinationEffectId - Receipt identity. @returns {Promise<Readonly<Record<string, any>> | null>} - Verified receipt. */
  async function readReceipt(destinationEffectId) {
    const key = createApplicationStateReceiptKey(destinationEffectId);
    const row = await readRecord(key.resourceId, key.sortKey);
    return row ? validateApplicationStateReceiptRecord(row) : null;
  }

  /** @param {string} resourceId - Business partition. @param {string} sortKey - Business sort key. @returns {Promise<Readonly<Record<string, any>> | null>} - Verified business row. */
  async function readBusinessByPhysicalKey(resourceId, sortKey) {
    const row = await readRecord(resourceId, sortKey);
    return row ? validateApplicationStateBusinessRecord(row) : null;
  }

  /** @param {Readonly<Record<string, any>>} receipt - Receipt to substantiate physically. @returns {Promise<void>} - Completes when linked business exists and matches. */
  async function assertReceiptBusiness(receipt) {
    const business = await readBusinessByPhysicalKey(
      receipt.business_resource_id,
      receipt.business_sort_key,
    );
    const dispositionMatchesBusiness = receipt.inserted
      ? business?.created_by_destination_effect_id ===
          receipt.destination_effect_id &&
        business?.contract_digest === receipt.contract_digest
      : business?.created_by_destination_effect_id !==
        receipt.destination_effect_id;
    if (
      !business ||
      business.record_digest !== receipt.business_record_digest ||
      !dispositionMatchesBusiness
    ) {
      throw new ApplicationStateCorruptionError(
        `Application-state receipt ${receipt.destination_effect_id} has no semantically matching business record.`,
      );
    }
  }

  /** @param {Readonly<Record<string, any>>} receipt - Candidate retained outcome. @param {{destinationEffectId: string, contractDigest: string, businessKey: {resourceId: string, sortKey: string}, insertedBusinessRecordDigest: string}} expected - Exact current contract. @returns {Promise<Readonly<Record<string, any>>>} - Matching substantiated receipt. */
  async function requireMatchingReceipt(receipt, expected) {
    if (
      receipt.destination_effect_id !== expected.destinationEffectId ||
      receipt.contract_digest !== expected.contractDigest ||
      receipt.business_resource_id !== expected.businessKey.resourceId ||
      receipt.business_sort_key !== expected.businessKey.sortKey
    ) {
      throw new ApplicationStateEffectConflictError(
        expected.destinationEffectId,
      );
    }
    if (
      receipt.inserted &&
      receipt.business_record_digest !== expected.insertedBusinessRecordDigest
    ) {
      throw new ApplicationStateCorruptionError(
        `Application-state inserted receipt ${receipt.destination_effect_id} does not match its logical value.`,
      );
    }
    await assertReceiptBusiness(receipt);
    return receipt;
  }

  /** @returns {import('../base.js').TransactionConditionCheck} - Store identity transaction guard. */
  function identityCondition(
    /** @type {string} */ storeId,
    /** @type {string} */ identityDigest,
  ) {
    return {
      keyName: APPLICATION_STATE_KEY_NAME,
      keyValue: APPLICATION_STATE_STORE_RESOURCE_ID,
      sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
      sortKeyValue: APPLICATION_STATE_STORE_SORT_KEY,
      conditions: [
        {
          conditionType: CONDITION_TYPE.EQUALS,
          propertyName: 'store_id',
          propertyValue: storeId,
        },
        {
          conditionType: CONDITION_TYPE.EQUALS,
          propertyName: 'identity_digest',
          propertyValue: identityDigest,
        },
      ],
    };
  }

  /**
   * Atomically create one value and permanent receipt, or retain a stable
   * already-present outcome for another valid value record.
   * @param {{storeId: string, namespace: string, key: string, value: any, destinationEffectId: string, contractDigest: string, maxAttempts?: number}} input - Exact logical contract.
   * @returns {Promise<Readonly<Record<string, any>>>} - Permanent receipt.
   */
  async function putIfAbsent(input) {
    const identity = await assertStoreIdentity(input.storeId);
    if (typeof input.namespace !== 'string' || !input.namespace) {
      throw new TypeError('application-state namespace must be non-empty.');
    }
    if (typeof input.key !== 'string' || !input.key) {
      throw new TypeError('application-state key must be non-empty.');
    }
    assertLedgerOpaqueId(
      input.destinationEffectId,
      'application-state destinationEffectId',
    );
    assertDomainSeparatedSha256Id(
      input.contractDigest,
      'wac',
      'application-state contractDigest',
    );
    const businessRecord = createApplicationStateBusinessRecord({
      namespace: input.namespace,
      key: input.key,
      value: input.value,
      destinationEffectId: input.destinationEffectId,
      contractDigest: input.contractDigest,
    });
    const businessKey = {
      resourceId: businessRecord[APPLICATION_STATE_KEY_NAME],
      sortKey: businessRecord[APPLICATION_STATE_SORT_KEY_NAME],
    };
    const expected = {
      destinationEffectId: input.destinationEffectId,
      contractDigest: input.contractDigest,
      businessKey,
      insertedBusinessRecordDigest: businessRecord.record_digest,
    };
    const existingReceipt = await readReceipt(input.destinationEffectId);
    if (existingReceipt) {
      return await requireMatchingReceipt(existingReceipt, expected);
    }

    const insertedReceipt = createApplicationStateReceiptRecord({
      destinationEffectId: input.destinationEffectId,
      contractDigest: input.contractDigest,
      businessRecord,
      inserted: true,
    });
    const maxAttempts = input.maxAttempts ?? 3;
    if (
      !Number.isSafeInteger(maxAttempts) ||
      maxAttempts < 1 ||
      maxAttempts > 8
    ) {
      throw new TypeError(
        'application-state maxAttempts must be between 1 and 8.',
      );
    }

    /** @type {unknown} */
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await db.transactionWrite({
          tableName,
          conditionChecks: [
            identityCondition(input.storeId, identity.identity_digest),
          ],
          putRequests: [
            {
              keyName: APPLICATION_STATE_KEY_NAME,
              sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
              record: businessRecord,
              conditions: [
                {
                  conditionType: CONDITION_TYPE.NOT_EXISTS,
                  propertyName: APPLICATION_STATE_KEY_NAME,
                },
              ],
            },
            {
              keyName: APPLICATION_STATE_KEY_NAME,
              sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
              record: insertedReceipt,
              conditions: [
                {
                  conditionType: CONDITION_TYPE.NOT_EXISTS,
                  propertyName: APPLICATION_STATE_KEY_NAME,
                },
              ],
            },
          ],
        });
        return await requireMatchingReceipt(insertedReceipt, expected);
      } catch (error) {
        lastError = error;
        const receipt = await readReceipt(input.destinationEffectId);
        if (receipt) return await requireMatchingReceipt(receipt, expected);

        const existingBusiness = await readBusinessByPhysicalKey(
          businessKey.resourceId,
          businessKey.sortKey,
        );
        if (existingBusiness) {
          if (
            existingBusiness.created_by_destination_effect_id ===
            input.destinationEffectId
          ) {
            throw new ApplicationStateCorruptionError(
              `Application-state effect ${input.destinationEffectId} has a business record without its permanent receipt.`,
            );
          }
          const conflictReceipt = createApplicationStateReceiptRecord({
            destinationEffectId: input.destinationEffectId,
            contractDigest: input.contractDigest,
            businessRecord: existingBusiness,
            inserted: false,
          });
          try {
            await db.transactionWrite({
              tableName,
              conditionChecks: [
                identityCondition(input.storeId, identity.identity_digest),
                {
                  keyName: APPLICATION_STATE_KEY_NAME,
                  keyValue: businessKey.resourceId,
                  sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
                  sortKeyValue: businessKey.sortKey,
                  conditions: [
                    {
                      conditionType: CONDITION_TYPE.EQUALS,
                      propertyName: 'record_digest',
                      propertyValue: existingBusiness.record_digest,
                    },
                  ],
                },
              ],
              putRequests: [
                {
                  keyName: APPLICATION_STATE_KEY_NAME,
                  sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
                  record: conflictReceipt,
                  conditions: [
                    {
                      conditionType: CONDITION_TYPE.NOT_EXISTS,
                      propertyName: APPLICATION_STATE_KEY_NAME,
                    },
                  ],
                },
              ],
            });
            return await requireMatchingReceipt(conflictReceipt, expected);
          } catch (conflictError) {
            lastError = conflictError;
            const retained = await readReceipt(input.destinationEffectId);
            if (retained) {
              return await requireMatchingReceipt(retained, expected);
            }
            if (isConditionalFailure(conflictError)) {
              await assertStoreIdentity(input.storeId);
            }
          }
        } else if (isConditionalFailure(error)) {
          await assertStoreIdentity(input.storeId);
        }
      }
    }
    throw lastError;
  }

  /**
   * Recover a destination outcome without repeating the business mutation.
   * @param {{storeId: string, namespace: string, key: string, value: any, destinationEffectId: string, contractDigest: string}} input - Exact retained contract.
   * @returns {Promise<Readonly<Record<string, any>> | null>} - Matching permanent receipt, if committed.
   */
  async function recoverPutIfAbsent(input) {
    await assertStoreIdentity(input.storeId);
    const receipt = await readReceipt(input.destinationEffectId);
    if (!receipt) return null;
    const insertedBusinessRecord = createApplicationStateBusinessRecord({
      namespace: input.namespace,
      key: input.key,
      value: input.value,
      destinationEffectId: input.destinationEffectId,
      contractDigest: input.contractDigest,
    });
    return await requireMatchingReceipt(receipt, {
      destinationEffectId: input.destinationEffectId,
      contractDigest: input.contractDigest,
      businessKey: createApplicationStateBusinessKey(
        input.namespace,
        input.key,
      ),
      insertedBusinessRecordDigest: insertedBusinessRecord.record_digest,
    });
  }

  return Object.freeze({
    tableName,
    readStoreIdentity,
    ensureStoreIdentity,
    assertStoreIdentity,
    readReceipt,
    readBusinessByPhysicalKey,
    putIfAbsent,
    recoverPutIfAbsent,
  });
}

export default createApplicationStateTable;
