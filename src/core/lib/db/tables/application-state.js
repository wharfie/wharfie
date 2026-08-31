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
import { assertCoordinatorAuthorityToken } from './coordinator-authority.js';
import {
  ApplicationStateCoordinatorAuthorityConflictError,
  ApplicationStateCoordinatorAuthorityStaleError,
  applicationStateCoordinatorRecordConditions,
  createApplicationStateCoordinatorAuthorityFence,
  createApplicationStateCoordinatorAuthorityKey,
  createApplicationStateCoordinatorAuthorityRecord,
  validateApplicationStateCoordinatorAuthorityRecord,
} from './application-state-authority.js';

export {
  ApplicationStateCoordinatorAuthorityConflictError,
  ApplicationStateCoordinatorAuthorityStaleError,
} from './application-state-authority.js';

export const APPLICATION_STATE_KEY_NAME = 'resource_id';
export const APPLICATION_STATE_SORT_KEY_NAME = 'sort_key';
export const APPLICATION_STATE_STORE_RESOURCE_ID = 'application-state/v2/store';
export const APPLICATION_STATE_STORE_SORT_KEY = 'identity/v2';
export const APPLICATION_STATE_RECEIPT_SORT_KEY = 'receipt/v2';
export const APPLICATION_STATE_RESOLUTION_SORT_KEY = 'resolution/v2';
export const APPLICATION_STATE_RETIREMENT_SORT_KEY = 'retirement/v1';
export const APPLICATION_STATE_ACTIVATION_SORT_KEY = 'activation/v1';

const STORE_IDENTITY_KIND = 'application-state-store-identity';
const VALUE_RECORD_KIND = 'application-state-value';
const RECEIPT_RECORD_KIND = 'application-state-effect-receipt';
const RESOLUTION_RECORD_KIND = 'application-state-effect-resolution';
const RETIREMENT_RECORD_KIND = 'application-state-store-retirement';
const ACTIVATION_RECORD_KIND = 'application-state-snapshot-activation';
const PUT_IF_ABSENT_OPERATION = 'put-if-absent';
const NOT_APPLIED_DISPOSITION = 'not-applied';
const SCHEMA_VERSION = 2;

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

/** A physical source volume was durably sealed for snapshot cutover. */
export class ApplicationStateStoreRetiredError extends Error {
  /** @param {string} namespace - Retired application namespace. */
  constructor(namespace) {
    super(`Application-state physical store is retired: ${namespace}`);
    this.name = 'ApplicationStateStoreRetiredError';
    this.code = 'WHARFIE_APPLICATION_STATE_STORE_RETIRED';
    this.namespace = namespace;
  }
}

/** One destination effect ID was reused for a different logical contract. */
export class ApplicationStateEffectConflictError extends Error {
  /** @param {string} destinationEffectId - Conflicting destination identity. */
  constructor(destinationEffectId) {
    super(
      `Application-state destination effect conflicts with its permanent disposition: ${destinationEffectId}`,
    );
    this.name = 'ApplicationStateEffectConflictError';
    this.destinationEffectId = destinationEffectId;
  }
}

/** A permanent not-applied decision closed this destination effect. */
export class ApplicationStateEffectNotAppliedError extends Error {
  /** @param {string} destinationEffectId - Permanently closed destination identity. */
  constructor(destinationEffectId) {
    super(
      `Application-state destination effect was permanently resolved as not applied: ${destinationEffectId}`,
    );
    this.name = 'ApplicationStateEffectNotAppliedError';
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
      `${label} does not have the exact v2 record shape.`,
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
    domain: 'wharfie:application-state:store-identity:v2',
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
    domain: 'wharfie:application-state:store:v2',
    prefix: 'was',
    value: { entropy: randomUUID() },
    valuePath: 'application-state store identity entropy',
  });
}

/** @param {string} namespace - Trusted app namespace. @param {string} key - Logical key. @returns {{resourceId: string, sortKey: string}} - Physical business key. */
export function createApplicationStateBusinessKey(namespace, key) {
  const digest = createCanonicalJsonSha256Id({
    domain: 'wharfie:application-state:business-key:v2',
    prefix: 'wak',
    value: { namespace, key },
    valuePath: 'application-state business key',
  });
  return Object.freeze({
    resourceId: `application-state/v2/record/${digest}`,
    sortKey: 'value/v2',
  });
}

/** @param {string} destinationEffectId - Permanent destination effect ID. @returns {{resourceId: string, sortKey: string}} - Physical receipt key. */
export function createApplicationStateReceiptKey(destinationEffectId) {
  assertLedgerOpaqueId(
    destinationEffectId,
    'application-state destinationEffectId',
  );
  return Object.freeze({
    resourceId: `application-state/v2/effect/${destinationEffectId}`,
    sortKey: APPLICATION_STATE_RECEIPT_SORT_KEY,
  });
}

/** @param {string} destinationEffectId - Permanent destination effect ID. @returns {{resourceId: string, sortKey: string}} - Physical resolution key. */
export function createApplicationStateResolutionKey(destinationEffectId) {
  assertLedgerOpaqueId(
    destinationEffectId,
    'application-state destinationEffectId',
  );
  return Object.freeze({
    resourceId: `application-state/v2/effect/${destinationEffectId}`,
    sortKey: APPLICATION_STATE_RESOLUTION_SORT_KEY,
  });
}

/** @param {string} storeId - Physical store identity. @returns {{resourceId: string, sortKey: 'retirement/v1'}} - Reserved physical-retirement key. */
export function createApplicationStateRetirementKey(storeId) {
  assertDomainSeparatedSha256Id(
    storeId,
    'was',
    'application-state retirement storeId',
  );
  const partition = createCanonicalJsonSha256Id({
    domain: 'wharfie:application-state:retirement-partition:v1',
    prefix: 'warp1',
    value: { storeId },
    valuePath: 'application-state retirement store',
  });
  return Object.freeze({
    resourceId: `application-state/v2/retirement/${partition}`,
    sortKey: APPLICATION_STATE_RETIREMENT_SORT_KEY,
  });
}

/** @param {string} storeId - Physical store identity. @returns {import('../base.js').TransactionConditionCheck} - Exact whole-store retirement-absence fence. */
export function createApplicationStateRetirementAbsenceFence(storeId) {
  const key = createApplicationStateRetirementKey(storeId);
  return {
    keyName: APPLICATION_STATE_KEY_NAME,
    keyValue: key.resourceId,
    sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
    sortKeyValue: key.sortKey,
    conditions: [
      {
        conditionType: CONDITION_TYPE.NOT_EXISTS,
        propertyName: APPLICATION_STATE_KEY_NAME,
      },
    ],
  };
}

/** @param {string} namespace - Application namespace. @returns {{resourceId: string, sortKey: 'activation/v1'}} - Reserved physical activation key. */
export function createApplicationStateActivationKey(namespace) {
  if (typeof namespace !== 'string' || !namespace) {
    throw new TypeError(
      'Application-state activation namespace must be non-empty.',
    );
  }
  const partition = createCanonicalJsonSha256Id({
    domain: 'wharfie:application-state:activation-partition:v1',
    prefix: 'waap1',
    value: { namespace },
    valuePath: 'application-state activation namespace',
  });
  return Object.freeze({
    resourceId: `application-state/v2/activation/${partition}`,
    sortKey: APPLICATION_STATE_ACTIVATION_SORT_KEY,
  });
}

/** @param {{storeId: string, namespace: string, transferId: string, snapshotId: string, distributionId: string, replicaId: string, transportStatus: 'RETAINED'|'HYDRATED', authority: unknown}} input - Exact activated snapshot identity. @returns {Readonly<Record<string, any>>} - Durable local activation evidence. */
export function createApplicationStateActivationRecord(input) {
  assertDomainSeparatedSha256Id(
    input.storeId,
    'was',
    'application-state activation storeId',
  );
  assertDomainSeparatedSha256Id(
    input.transferId,
    'wast1',
    'application-state activation transferId',
  );
  assertDomainSeparatedSha256Id(
    input.snapshotId,
    'wass1',
    'application-state activation snapshotId',
  );
  assertDomainSeparatedSha256Id(
    input.distributionId,
    'wasd1',
    'application-state activation distributionId',
  );
  assertDomainSeparatedSha256Id(
    input.replicaId,
    'wasr1',
    'application-state activation replicaId',
  );
  const authority = assertCoordinatorAuthorityToken(
    input.authority,
    'application-state activation authority',
  );
  if (authority.appId !== input.namespace) {
    throw new TypeError(
      'Application-state activation authority must match the namespace.',
    );
  }
  if (!['RETAINED', 'HYDRATED'].includes(input.transportStatus)) {
    throw new TypeError(
      'Application-state activation transportStatus must be RETAINED or HYDRATED.',
    );
  }
  const key = createApplicationStateActivationKey(input.namespace);
  const fields = {
    [APPLICATION_STATE_KEY_NAME]: key.resourceId,
    [APPLICATION_STATE_SORT_KEY_NAME]: key.sortKey,
    record_kind: ACTIVATION_RECORD_KIND,
    schema_version: 1,
    store_id: input.storeId,
    namespace: input.namespace,
    transfer_id: input.transferId,
    snapshot_id: input.snapshotId,
    distribution_id: input.distributionId,
    replica_id: input.replicaId,
    transport_status: input.transportStatus,
    authority_schema_version: authority.schemaVersion,
    coordinator_id: authority.coordinatorId,
    authority_id: authority.authorityId,
    epoch: authority.epoch,
  };
  return deepFreezeJson({
    ...fields,
    record_digest: createCanonicalJsonSha256Id({
      domain: 'wharfie:application-state:snapshot-activation:v1',
      prefix: 'wasa1',
      value: fields,
      valuePath: 'application-state snapshot activation',
    }),
  });
}

/** @param {unknown} value - Candidate activation row. @returns {Readonly<Record<string, any>>} - Verified exact activation. */
export function validateApplicationStateActivationRecord(value) {
  try {
    const record = cloneJsonObject(
      value,
      'application-state activation record',
    );
    assertExactKeys(
      record,
      [
        APPLICATION_STATE_KEY_NAME,
        APPLICATION_STATE_SORT_KEY_NAME,
        'record_kind',
        'schema_version',
        'store_id',
        'namespace',
        'transfer_id',
        'snapshot_id',
        'distribution_id',
        'replica_id',
        'transport_status',
        'authority_schema_version',
        'coordinator_id',
        'authority_id',
        'epoch',
        'record_digest',
      ],
      'application-state activation record',
    );
    const expected = createApplicationStateActivationRecord({
      storeId: record.store_id,
      namespace: record.namespace,
      transferId: record.transfer_id,
      snapshotId: record.snapshot_id,
      distributionId: record.distribution_id,
      replicaId: record.replica_id,
      transportStatus: record.transport_status,
      authority: {
        schemaVersion: record.authority_schema_version,
        appId: record.namespace,
        coordinatorId: record.coordinator_id,
        authorityId: record.authority_id,
        epoch: record.epoch,
      },
    });
    if (Object.keys(expected).some((key) => expected[key] !== record[key])) {
      throw new TypeError('activation record mismatch');
    }
    return expected;
  } catch (cause) {
    if (cause instanceof ApplicationStateCorruptionError) throw cause;
    throw new ApplicationStateCorruptionError(
      'Application-state activation record failed verification.',
    );
  }
}

/** @param {{storeId: string, namespace: string, retirementId: string, artifact: string, authority: unknown}} input - Exact source retirement. @returns {Readonly<Record<string, any>>} - Immutable retirement record. */
export function createApplicationStateRetirementRecord(input) {
  assertDomainSeparatedSha256Id(
    input.storeId,
    'was',
    'application-state retirement storeId',
  );
  assertLedgerOpaqueId(
    input.retirementId,
    'application-state retirement retirementId',
  );
  if (
    typeof input.artifact !== 'string' ||
    !input.artifact ||
    Buffer.byteLength(input.artifact, 'utf8') > 192 * 1024
  ) {
    throw new TypeError(
      'Application-state retirement artifact must be bounded nonempty UTF-8 text.',
    );
  }
  const authority = assertCoordinatorAuthorityToken(
    input.authority,
    'application-state retirement authority',
  );
  if (authority.appId !== input.namespace) {
    throw new TypeError(
      'Application-state retirement authority must match the namespace.',
    );
  }
  const key = createApplicationStateRetirementKey(input.storeId);
  const fields = {
    [APPLICATION_STATE_KEY_NAME]: key.resourceId,
    [APPLICATION_STATE_SORT_KEY_NAME]: key.sortKey,
    record_kind: RETIREMENT_RECORD_KIND,
    schema_version: 1,
    store_id: input.storeId,
    namespace: input.namespace,
    retirement_id: input.retirementId,
    retirement_artifact: input.artifact,
    authority_schema_version: authority.schemaVersion,
    coordinator_id: authority.coordinatorId,
    authority_id: authority.authorityId,
    epoch: authority.epoch,
  };
  return deepFreezeJson({
    ...fields,
    record_digest: createCanonicalJsonSha256Id({
      domain: 'wharfie:application-state:store-retirement:v1',
      prefix: 'wart1',
      value: fields,
      valuePath: 'application-state store retirement',
    }),
  });
}

/** @param {unknown} value - Candidate retirement row. @returns {Readonly<Record<string, any>>} - Verified exact retirement. */
export function validateApplicationStateRetirementRecord(value) {
  /** @type {Record<string, any>} */
  let record;
  try {
    record = cloneJsonObject(value, 'application-state retirement record');
    assertExactKeys(
      record,
      [
        APPLICATION_STATE_KEY_NAME,
        APPLICATION_STATE_SORT_KEY_NAME,
        'record_kind',
        'schema_version',
        'store_id',
        'namespace',
        'retirement_id',
        'retirement_artifact',
        'authority_schema_version',
        'coordinator_id',
        'authority_id',
        'epoch',
        'record_digest',
      ],
      'application-state retirement record',
    );
    const expected = createApplicationStateRetirementRecord({
      storeId: record.store_id,
      namespace: record.namespace,
      retirementId: record.retirement_id,
      artifact: record.retirement_artifact,
      authority: {
        schemaVersion: record.authority_schema_version,
        appId: record.namespace,
        coordinatorId: record.coordinator_id,
        authorityId: record.authority_id,
        epoch: record.epoch,
      },
    });
    if (Object.keys(expected).some((key) => expected[key] !== record[key])) {
      throw new TypeError('retirement record mismatch');
    }
    return expected;
  } catch (cause) {
    if (cause instanceof ApplicationStateCorruptionError) throw cause;
    throw new ApplicationStateCorruptionError(
      'Application-state retirement record failed verification.',
    );
  }
}

/** @param {Record<string, any>} fields - Business fields without digest. @returns {string} - Content digest. */
function createBusinessRecordDigest(fields) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:application-state:business-record:v2',
    prefix: 'war',
    value: fields,
    valuePath: 'application-state business record',
  });
}

/** @param {Record<string, any>} fields - Receipt fields without digest. @returns {string} - Content digest. */
function createReceiptDigest(fields) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:application-state:effect-receipt:v2',
    prefix: 'wap',
    value: fields,
    valuePath: 'application-state effect receipt',
  });
}

/** @param {Record<string, any>} fields - Resolution fields without digest. @returns {string} - Content digest. */
function createResolutionDigest(fields) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:application-state:effect-resolution:v2',
    prefix: 'waf',
    value: fields,
    valuePath: 'application-state effect resolution',
  });
}

/** @param {{storeId: string, namespace: string, key: string, value: any, destinationEffectId: string, contractDigest: string}} options - New value record inputs. @returns {Readonly<Record<string, any>>} - Exact record. */
export function createApplicationStateBusinessRecord(options) {
  assertDomainSeparatedSha256Id(
    options.storeId,
    'was',
    'application-state business storeId',
  );
  const key = createApplicationStateBusinessKey(options.namespace, options.key);
  const value = cloneJsonValue(options.value, 'application-state value');
  const fields = {
    [APPLICATION_STATE_KEY_NAME]: key.resourceId,
    [APPLICATION_STATE_SORT_KEY_NAME]: key.sortKey,
    record_kind: VALUE_RECORD_KIND,
    schema_version: SCHEMA_VERSION,
    store_id: options.storeId,
    namespace: options.namespace,
    logical_key: options.key,
    value,
    value_digest: createCanonicalJsonSha256Id({
      domain: 'wharfie:application-state:value:v2',
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

/** @param {unknown} value - Candidate business observation. @returns {Readonly<{kind: 'absent'} | {kind: 'present-other', recordDigest: string, createdByDestinationEffectId: string}>} - Exact observation. */
function normalizeBusinessObservation(value) {
  let observation;
  try {
    observation = cloneJsonObject(
      value,
      'application-state resolution business observation',
    );
  } catch {
    throw new ApplicationStateCorruptionError(
      'Application-state resolution business observation is not strict JSON.',
    );
  }
  if (observation.kind === 'absent') {
    assertExactKeys(
      observation,
      ['kind'],
      'Application-state resolution business observation',
    );
    return Object.freeze({ kind: 'absent' });
  }
  assertExactKeys(
    observation,
    ['kind', 'recordDigest', 'createdByDestinationEffectId'],
    'Application-state resolution business observation',
  );
  if (observation.kind !== 'present-other') {
    throw new ApplicationStateCorruptionError(
      'Application-state resolution business observation kind is unsupported.',
    );
  }
  try {
    assertDomainSeparatedSha256Id(
      observation.recordDigest,
      'war',
      'application-state resolution business recordDigest',
    );
    assertLedgerOpaqueId(
      observation.createdByDestinationEffectId,
      'application-state resolution business owner',
    );
  } catch {
    throw new ApplicationStateCorruptionError(
      'Application-state resolution business observation contains an invalid identifier.',
    );
  }
  return Object.freeze({
    kind: 'present-other',
    recordDigest: observation.recordDigest,
    createdByDestinationEffectId: observation.createdByDestinationEffectId,
  });
}

/** @param {{storeId: string, destinationEffectId: string, contractDigest: string, businessKey: {resourceId: string, sortKey: string}, businessObservation: {kind: 'absent'} | {kind: 'present-other', recordDigest: string, createdByDestinationEffectId: string}}} options - Permanent negative-decision inputs. @returns {Readonly<Record<string, any>>} - Exact resolution. */
export function createApplicationStateNotAppliedResolutionRecord(options) {
  assertDomainSeparatedSha256Id(
    options.storeId,
    'was',
    'application-state resolution storeId',
  );
  assertDomainSeparatedSha256Id(
    options.contractDigest,
    'wac',
    'application-state resolution contractDigest',
  );
  const key = createApplicationStateResolutionKey(options.destinationEffectId);
  const businessObservation = normalizeBusinessObservation(
    options.businessObservation,
  );
  if (
    businessObservation.kind === 'present-other' &&
    businessObservation.createdByDestinationEffectId ===
      options.destinationEffectId
  ) {
    throw new ApplicationStateCorruptionError(
      `Application-state effect ${options.destinationEffectId} has a business record without its permanent receipt.`,
    );
  }
  const fields = {
    [APPLICATION_STATE_KEY_NAME]: key.resourceId,
    [APPLICATION_STATE_SORT_KEY_NAME]: key.sortKey,
    record_kind: RESOLUTION_RECORD_KIND,
    schema_version: SCHEMA_VERSION,
    store_id: options.storeId,
    destination_effect_id: options.destinationEffectId,
    operation: PUT_IF_ABSENT_OPERATION,
    contract_digest: options.contractDigest,
    business_resource_id: options.businessKey.resourceId,
    business_sort_key: options.businessKey.sortKey,
    business_observation: businessObservation,
    disposition: NOT_APPLIED_DISPOSITION,
  };
  return deepFreezeJson({
    ...fields,
    resolution_digest: createResolutionDigest(fields),
  });
}

/** @param {{destinationEffectId: string, contractDigest: string, businessRecord: Record<string, any>, inserted: boolean}} options - Receipt inputs. @returns {Readonly<Record<string, any>>} - Exact receipt. */
export function createApplicationStateReceiptRecord(options) {
  assertDomainSeparatedSha256Id(
    options.businessRecord.store_id,
    'was',
    'application-state receipt business store_id',
  );
  const key = createApplicationStateReceiptKey(options.destinationEffectId);
  const fields = {
    [APPLICATION_STATE_KEY_NAME]: key.resourceId,
    [APPLICATION_STATE_SORT_KEY_NAME]: key.sortKey,
    record_kind: RECEIPT_RECORD_KIND,
    schema_version: SCHEMA_VERSION,
    store_id: options.businessRecord.store_id,
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
      'Application-state store identity failed v2 verification.',
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
    'store_id',
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
    assertDomainSeparatedSha256Id(
      record.store_id,
      'was',
      'application-state business store_id',
    );
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
        domain: 'wharfie:application-state:value:v2',
        prefix: 'wav',
        value: record.value,
        valuePath: 'application-state retained value',
      }) ||
    record.record_digest !== createBusinessRecordDigest(fields)
  ) {
    throw new ApplicationStateCorruptionError(
      'Application-state business record failed v2 verification.',
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
    'store_id',
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
      record.store_id,
      'was',
      'application-state receipt store_id',
    );
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
      'Application-state effect receipt failed v2 verification.',
    );
  }
  return deepFreezeJson(record);
}

/** @param {unknown} value - Candidate resolution row. @returns {Readonly<Record<string, any>>} - Verified resolution. */
export function validateApplicationStateNotAppliedResolutionRecord(value) {
  let record;
  try {
    record = cloneJsonObject(value, 'application-state effect resolution');
  } catch {
    throw new ApplicationStateCorruptionError(
      'Application-state effect resolution is not strict JSON.',
    );
  }
  const keys = [
    APPLICATION_STATE_KEY_NAME,
    APPLICATION_STATE_SORT_KEY_NAME,
    'record_kind',
    'schema_version',
    'store_id',
    'destination_effect_id',
    'operation',
    'contract_digest',
    'business_resource_id',
    'business_sort_key',
    'business_observation',
    'disposition',
    'resolution_digest',
  ];
  assertExactKeys(record, keys, 'Application-state effect resolution');
  /** @type {{resourceId: string, sortKey: string}} */
  let resolutionKey = { resourceId: '', sortKey: '' };
  const fields = Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== 'resolution_digest'),
  );
  let validIds = true;
  let businessObservation;
  try {
    resolutionKey = createApplicationStateResolutionKey(
      record.destination_effect_id,
    );
    assertDomainSeparatedSha256Id(
      record.store_id,
      'was',
      'application-state resolution store_id',
    );
    assertDomainSeparatedSha256Id(
      record.contract_digest,
      'wac',
      'application-state resolution contract_digest',
    );
    assertDomainSeparatedSha256Id(
      record.resolution_digest,
      'waf',
      'application-state resolution_digest',
    );
    businessObservation = normalizeBusinessObservation(
      record.business_observation,
    );
  } catch {
    validIds = false;
  }
  if (
    !validIds ||
    record[APPLICATION_STATE_KEY_NAME] !== resolutionKey.resourceId ||
    record[APPLICATION_STATE_SORT_KEY_NAME] !== resolutionKey.sortKey ||
    record.record_kind !== RESOLUTION_RECORD_KIND ||
    record.schema_version !== SCHEMA_VERSION ||
    record.operation !== PUT_IF_ABSENT_OPERATION ||
    record.disposition !== NOT_APPLIED_DISPOSITION ||
    typeof record.business_resource_id !== 'string' ||
    typeof record.business_sort_key !== 'string' ||
    (businessObservation?.kind === 'present-other' &&
      businessObservation.createdByDestinationEffectId ===
        record.destination_effect_id) ||
    record.resolution_digest !== createResolutionDigest(fields)
  ) {
    throw new ApplicationStateCorruptionError(
      'Application-state effect resolution failed v2 verification.',
    );
  }
  return deepFreezeJson(record);
}

/**
 * Create the provider-neutral physical v2 application-state table.
 * @param {{db: import('../base.js').DBClient, tableName: string, createStoreId?: () => string, coordinatorAuthority?: import('./coordinator-authority.js').CoordinatorAuthorityToken | import('./coordinator-authority.js').CoordinatorAuthoritySnapshot}} options - Exact dependencies.
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
  const coordinatorAuthority =
    options.coordinatorAuthority === undefined
      ? undefined
      : assertCoordinatorAuthorityToken(
          options.coordinatorAuthority,
          'createApplicationStateTable.coordinatorAuthority',
        );

  /** @param {unknown} input - Caller-owned namespace binding. @returns {Readonly<{storeId: string, namespace: string}>} - Validated immutable scope. */
  function normalizeCoordinatorScope(input) {
    const scope = cloneJsonObject(input, 'application-state coordinator scope');
    if (
      Object.keys(scope).length !== 2 ||
      !Object.hasOwn(scope, 'storeId') ||
      !Object.hasOwn(scope, 'namespace')
    ) {
      throw new TypeError(
        'Application-state coordinator scope requires exactly storeId and namespace.',
      );
    }
    assertDomainSeparatedSha256Id(
      scope.storeId,
      'was',
      'application-state storeId',
    );
    if (typeof scope.namespace !== 'string' || !scope.namespace) {
      throw new TypeError('application-state namespace must be non-empty.');
    }
    if (
      coordinatorAuthority &&
      coordinatorAuthority.appId !== scope.namespace
    ) {
      throw new TypeError(
        'Application-state coordinator authority must match the namespace.',
      );
    }
    return Object.freeze({
      storeId: scope.storeId,
      namespace: scope.namespace,
    });
  }

  /** @param {unknown} value - Optional retained destination-authority floor. @param {Readonly<{storeId: string, namespace: string}>} scope - Exact destination scope. @returns {Readonly<{destinationAuthorityFloor?: Readonly<Record<string, any>>}>} - Validated immutable adoption options. */
  function normalizeCoordinatorAdoptionOptions(value, scope) {
    if (value === undefined) return Object.freeze({});
    const input = cloneJsonObject(
      value,
      'application-state coordinator adoption options',
    );
    if (
      Object.keys(input).length !== 1 ||
      !Object.hasOwn(input, 'destinationAuthorityFloor')
    ) {
      throw new TypeError(
        'Application-state coordinator adoption options require exactly destinationAuthorityFloor.',
      );
    }
    let floor;
    try {
      floor = validateApplicationStateCoordinatorAuthorityRecord(
        input.destinationAuthorityFloor,
      );
    } catch {
      throw new TypeError(
        'Application-state coordinator destinationAuthorityFloor is invalid.',
      );
    }
    if (
      floor.store_id !== scope.storeId ||
      floor.namespace !== scope.namespace
    ) {
      throw new TypeError(
        'Application-state coordinator destinationAuthorityFloor must match the adoption scope.',
      );
    }
    return Object.freeze({ destinationAuthorityFloor: floor });
  }

  /** @param {unknown} value - Caller-owned logical mutation. @param {boolean} [allowMaxAttempts] - Whether the mutation accepts bounded retry configuration. @returns {Readonly<{storeId: string, namespace: string, key: string, value: any, destinationEffectId: string, contractDigest: string, maxAttempts: number}>} - Deeply frozen request captured before any await. */
  function normalizeMutationInput(value, allowMaxAttempts = true) {
    const input = cloneJsonObject(value, 'application-state mutation input');
    const required = [
      'storeId',
      'namespace',
      'key',
      'value',
      'destinationEffectId',
      'contractDigest',
    ];
    if (
      required.some((key) => !Object.hasOwn(input, key)) ||
      Object.keys(input).some(
        (key) =>
          !required.includes(key) &&
          !(allowMaxAttempts && key === 'maxAttempts'),
      )
    ) {
      throw new TypeError(
        'Application-state mutation input has unsupported or missing fields.',
      );
    }
    const scope = normalizeCoordinatorScope({
      storeId: input.storeId,
      namespace: input.namespace,
    });
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
    return deepFreezeJson({ ...input, ...scope, maxAttempts });
  }

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

  /** @param {{storeId: string, namespace: string}} input - Exact physical-store scope. @returns {Promise<Readonly<Record<string, any>> | null>} - Verified retirement or absence. */
  async function readStoreRetirement(input) {
    const scope = normalizeCoordinatorScope(input);
    const key = createApplicationStateRetirementKey(scope.storeId);
    const row = await readRecord(key.resourceId, key.sortKey);
    if (!row) return null;
    const retirement = validateApplicationStateRetirementRecord(row);
    if (retirement.store_id !== scope.storeId) {
      throw new ApplicationStateStoreIdentityError(
        'Application-state retirement does not belong to the expected store.',
      );
    }
    return retirement;
  }

  /** @param {{storeId: string, namespace: string}} input - Exact physical-store scope. @returns {Promise<Readonly<Record<string, any>> | null>} - Verified current activation or absence. */
  async function readStoreActivation(input) {
    const scope = normalizeCoordinatorScope(input);
    const key = createApplicationStateActivationKey(scope.namespace);
    const row = await readRecord(key.resourceId, key.sortKey);
    if (!row) return null;
    const activation = validateApplicationStateActivationRecord(row);
    if (
      activation.store_id !== scope.storeId ||
      activation.namespace !== scope.namespace
    ) {
      throw new ApplicationStateStoreIdentityError(
        'Application-state activation does not belong to the expected store.',
      );
    }
    return activation;
  }

  /** @param {{storeId: string, namespace: string}} scope - Exact store scope. @returns {import('../base.js').TransactionConditionCheck} - Retirement-absence mutation guard. */
  function retirementAbsentCondition(scope) {
    return createApplicationStateRetirementAbsenceFence(scope.storeId);
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
    const initialAuthority = coordinatorAuthority
      ? createApplicationStateCoordinatorAuthorityRecord({
          storeId,
          namespace: coordinatorAuthority.appId,
          authority: coordinatorAuthority,
        })
      : undefined;
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
          ...(initialAuthority
            ? [
                {
                  keyName: APPLICATION_STATE_KEY_NAME,
                  sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
                  record: initialAuthority,
                  conditions: createApplicationStateCoordinatorAuthorityFence({
                    storeId,
                    namespace: initialAuthority.namespace,
                  }).conditions,
                },
              ]
            : []),
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

  /** @param {{storeId: string, namespace: string}} scope - Validated scope. @returns {Promise<Readonly<Record<string, any>> | null>} - Verified destination fence, without another identity read. */
  async function readCoordinatorRecord(scope) {
    const key = createApplicationStateCoordinatorAuthorityKey(scope.namespace);
    const row = await readRecord(key.resourceId, key.sortKey);
    if (!row) return null;
    let record;
    try {
      record = validateApplicationStateCoordinatorAuthorityRecord(row);
      if (record.namespace !== scope.namespace) {
        throw new TypeError(
          'Application-state coordinator record crossed namespace.',
        );
      }
    } catch {
      throw new ApplicationStateCorruptionError(
        'Application-state coordinator record failed verification.',
      );
    }
    if (record.store_id !== scope.storeId) {
      throw new ApplicationStateStoreIdentityError(
        'Application-state coordinator record does not belong to the expected store.',
      );
    }
    return record;
  }

  /**
   * Read only the destination-local high-water record. This neither inspects
   * nor proves currentness in the separate control database.
   * @param {{storeId: string, namespace: string}} input - Exact destination scope.
   * @returns {Promise<Readonly<Record<string, any>> | null>} - Verified destination record or absence.
   */
  async function readCoordinatorAuthority(input) {
    const scope = normalizeCoordinatorScope(input);
    await assertStoreIdentity(scope.storeId);
    return await readCoordinatorRecord(scope);
  }

  /** @param {Readonly<Record<string, any>> | null} current - Verified current destination fence. @param {Readonly<Record<string, any>> | undefined} floor - Retained ADOPTED high-water evidence. @param {Readonly<{namespace: string}>} scope - Exact destination scope. @returns {void} - Throws unless current covers the floor. */
  function assertDestinationAuthorityFloor(current, floor, scope) {
    if (!floor) return;
    if (
      !current ||
      (current.record_digest !== floor.record_digest &&
        current.epoch <= floor.epoch)
    ) {
      throw new ApplicationStateCoordinatorAuthorityStaleError(scope.namespace);
    }
  }

  /** @param {Readonly<{storeId: string, namespace: string}>} scope - Exact destination scope. @param {Readonly<{destinationAuthorityFloor?: Readonly<Record<string, any>>}>} adoption - Validated adoption options. @returns {Promise<{identity: Readonly<Record<string, any>>, current: Readonly<Record<string, any>> | null, candidate: Readonly<Record<string, any>>}>} - One exact predecessor snapshot suitable for adoption. */
  async function readCoordinatorAdoptionPrecondition(scope, adoption) {
    if (!coordinatorAuthority) {
      throw new TypeError(
        'Application-state coordinator adoption requires a bound authority.',
      );
    }
    const candidate = createApplicationStateCoordinatorAuthorityRecord({
      ...scope,
      authority: coordinatorAuthority,
    });
    const identity = await assertStoreIdentity(scope.storeId);
    if (await readStoreRetirement(scope)) {
      throw new ApplicationStateStoreRetiredError(scope.namespace);
    }
    const current = await readCoordinatorRecord(scope);
    assertDestinationAuthorityFloor(
      current,
      adoption.destinationAuthorityFloor,
      scope,
    );
    if (
      current &&
      current.record_digest !== candidate.record_digest &&
      candidate.epoch <= current.epoch
    ) {
      throw new ApplicationStateCoordinatorAuthorityStaleError(scope.namespace);
    }
    return { identity, current, candidate };
  }

  /**
   * Read and verify the exact predecessor required by a later adoption. This
   * is a read-only guard for callers that must fail before another durable
   * store is mutated. Adoption still repeats this check and CASes the exact
   * predecessor because the destination may change after this read.
   * @param {{storeId: string, namespace: string}} input - Exact destination scope.
   * @param {{destinationAuthorityFloor: unknown}} [options] - Retained ADOPTED floor.
   * @returns {Promise<Readonly<Record<string, any>> | null>} - Exact verified current barrier.
   */
  async function assertCoordinatorAuthorityAdoptionPrecondition(
    input,
    options,
  ) {
    const scope = normalizeCoordinatorScope(input);
    const adoption = normalizeCoordinatorAdoptionOptions(options, scope);
    const { current } = await readCoordinatorAdoptionPrecondition(
      scope,
      adoption,
    );
    return current;
  }

  /**
   * Explicitly install this bound token at the destination. Higher epochs may
   * advance one exact predecessor; same-token replay is read-only. Superseded
   * adoption is rejected, not replayed from historical receipts. This assumes
   * one trusted control-authority lineage and does not infer a lease, release,
   * control-store currentness, or a cross-database atomic handoff.
   * @param {{storeId: string, namespace: string}} input - Exact destination scope.
   * @param {{destinationAuthorityFloor: unknown}} [options] - Retained ADOPTED floor.
   * @returns {Promise<Readonly<Record<string, any>>>} - Verified adopted record.
   */
  async function adoptCoordinatorAuthority(input, options) {
    const scope = normalizeCoordinatorScope(input);
    const adoption = normalizeCoordinatorAdoptionOptions(options, scope);
    const { identity, current, candidate } =
      await readCoordinatorAdoptionPrecondition(scope, adoption);
    if (current && current.record_digest === candidate.record_digest) {
      try {
        await db.transactionWrite({
          tableName,
          conditionChecks: [
            identityCondition(scope.storeId, identity.identity_digest),
            retirementAbsentCondition(scope),
            createApplicationStateCoordinatorAuthorityFence({
              ...scope,
              authority: coordinatorAuthority,
            }),
          ],
        });
      } catch (error) {
        await assertStoreIdentity(scope.storeId);
        if (await readStoreRetirement(scope)) {
          throw new ApplicationStateStoreRetiredError(scope.namespace);
        }
        const winner = await readCoordinatorRecord(scope);
        if (
          !winner ||
          winner.record_digest !== candidate.record_digest ||
          isConditionalFailure(error)
        ) {
          throw new ApplicationStateCoordinatorAuthorityConflictError(
            scope.namespace,
          );
        }
        throw error;
      }
      return current;
    }
    try {
      await db.transactionWrite({
        tableName,
        conditionChecks: [
          identityCondition(scope.storeId, identity.identity_digest),
          retirementAbsentCondition(scope),
        ],
        putRequests: [
          {
            keyName: APPLICATION_STATE_KEY_NAME,
            sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
            record: candidate,
            conditions: current
              ? applicationStateCoordinatorRecordConditions(current)
              : createApplicationStateCoordinatorAuthorityFence(scope)
                  .conditions,
          },
        ],
      });
    } catch (error) {
      await assertStoreIdentity(scope.storeId);
      if (await readStoreRetirement(scope)) {
        throw new ApplicationStateStoreRetiredError(scope.namespace);
      }
      const winner = await readCoordinatorRecord(scope);
      assertDestinationAuthorityFloor(
        winner,
        adoption.destinationAuthorityFloor,
        scope,
      );
      if (winner && winner.record_digest === candidate.record_digest)
        return winner;
      if (winner && winner.epoch >= candidate.epoch) {
        throw new ApplicationStateCoordinatorAuthorityStaleError(
          scope.namespace,
        );
      }
      if (isConditionalFailure(error)) {
        throw new ApplicationStateCoordinatorAuthorityConflictError(
          scope.namespace,
        );
      }
      throw error;
    }
    const retained = await readCoordinatorAuthority(scope);
    if (await readStoreRetirement(scope)) {
      throw new ApplicationStateStoreRetiredError(scope.namespace);
    }
    assertDestinationAuthorityFloor(
      retained,
      adoption.destinationAuthorityFloor,
      scope,
    );
    if (!retained || retained.record_digest !== candidate.record_digest) {
      if (retained && retained.epoch >= candidate.epoch) {
        throw new ApplicationStateCoordinatorAuthorityStaleError(
          scope.namespace,
        );
      }
      throw new ApplicationStateCoordinatorAuthorityConflictError(
        scope.namespace,
      );
    }
    return retained;
  }

  /** @param {Readonly<Record<string, any>>} retirement - Verified retirement. @returns {import('../base.js').KeyCondition[]} - Exact CAS conditions. */
  function retirementRecordConditions(retirement) {
    return Object.keys(retirement).map((propertyName) => ({
      conditionType: CONDITION_TYPE.EQUALS,
      propertyName,
      propertyValue: retirement[propertyName],
    }));
  }

  /** @param {Readonly<Record<string, any>>} activation - Verified activation. @returns {import('../base.js').KeyCondition[]} - Exact CAS conditions. */
  function activationRecordConditions(activation) {
    return Object.keys(activation).map((propertyName) => ({
      conditionType: CONDITION_TYPE.EQUALS,
      propertyName,
      propertyValue: activation[propertyName],
    }));
  }

  /**
   * Permanently close this physical source before its immutable checkpoint is
   * read. Every ordinary mutation transaction tests retirement absence, so
   * even the previously adopted token can no longer write after this returns.
   * @param {{storeId: string, namespace: string, retirementId: string, artifact: string}} input - Exact source-seal scope.
   * @returns {Promise<Readonly<Record<string, any>>>} - Durable source-seal evidence.
   */
  async function retireStore(input) {
    const scope = normalizeCoordinatorScope({
      storeId: input.storeId,
      namespace: input.namespace,
    });
    if (!coordinatorAuthority) {
      throw new TypeError(
        'Application-state store retirement requires a bound authority.',
      );
    }
    assertLedgerOpaqueId(
      input.retirementId,
      'application-state retirement retirementId',
    );
    const candidate = createApplicationStateRetirementRecord({
      ...scope,
      retirementId: input.retirementId,
      artifact: input.artifact,
      authority: coordinatorAuthority,
    });
    const existing = await readStoreRetirement(scope);
    if (existing) {
      if (existing.record_digest === candidate.record_digest) return existing;
      throw new ApplicationStateStoreIdentityError(
        'Application-state store was retired by a different transfer.',
      );
    }
    const identity = await assertStoreIdentity(scope.storeId);
    await assertCurrentCoordinatorAuthority(scope);
    try {
      await db.transactionWrite({
        tableName,
        conditionChecks: [
          identityCondition(scope.storeId, identity.identity_digest),
          createApplicationStateCoordinatorAuthorityFence({
            ...scope,
            authority: coordinatorAuthority,
          }),
        ],
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
      const winner = await readStoreRetirement(scope);
      if (winner && winner.record_digest === candidate.record_digest) {
        return winner;
      }
      throw error;
    }
    const retained = await readStoreRetirement(scope);
    if (!retained || retained.record_digest !== candidate.record_digest) {
      throw new ApplicationStateStoreIdentityError(
        'Application-state store retirement was not durably readable.',
      );
    }
    return retained;
  }

  /**
   * Select the exact retired source as the replacement's retained volume.
   * Authority adoption and retirement removal share one local transaction,
   * so the predecessor never regains a write window.
   * @param {{storeId: string, namespace: string, retirementId: string, snapshotId: string, distributionId: string, replicaId: string, transportStatus: 'RETAINED'|'HYDRATED'}} input - Receipt-pinned retained source.
   * @returns {Promise<Readonly<Record<string, any>>>} - Replacement destination authority.
   */
  async function reactivateRetiredStore(input) {
    const scope = normalizeCoordinatorScope({
      storeId: input.storeId,
      namespace: input.namespace,
    });
    if (!coordinatorAuthority) {
      throw new TypeError(
        'Application-state store reactivation requires a bound authority.',
      );
    }
    assertLedgerOpaqueId(
      input.retirementId,
      'application-state reactivation retirementId',
    );
    const identity = await assertStoreIdentity(scope.storeId);
    const current = await readCoordinatorRecord(scope);
    const candidate = createApplicationStateCoordinatorAuthorityRecord({
      ...scope,
      authority: coordinatorAuthority,
    });
    const activationCandidate = createApplicationStateActivationRecord({
      ...scope,
      transferId: input.retirementId,
      snapshotId: input.snapshotId,
      distributionId: input.distributionId,
      replicaId: input.replicaId,
      transportStatus: input.transportStatus,
      authority: coordinatorAuthority,
    });
    const retirement = await readStoreRetirement(scope);
    const currentActivation = await readStoreActivation(scope);
    if (!retirement) {
      if (
        current &&
        current.record_digest === candidate.record_digest &&
        currentActivation &&
        currentActivation.record_digest === activationCandidate.record_digest
      ) {
        return current;
      }
      throw new ApplicationStateStoreIdentityError(
        'Application-state retained source is not retired by the pinned transfer.',
      );
    }
    if (
      retirement.namespace !== scope.namespace ||
      retirement.retirement_id !== input.retirementId
    ) {
      throw new ApplicationStateStoreIdentityError(
        'Application-state retained source retirement does not match the pinned transfer.',
      );
    }
    if (
      !current ||
      coordinatorAuthority.epoch <= current.epoch ||
      coordinatorAuthority.epoch <= retirement.epoch
    ) {
      throw new ApplicationStateCoordinatorAuthorityStaleError(scope.namespace);
    }
    try {
      await db.transactionWrite({
        tableName,
        conditionChecks: [
          identityCondition(scope.storeId, identity.identity_digest),
        ],
        putRequests: [
          {
            keyName: APPLICATION_STATE_KEY_NAME,
            sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
            record: candidate,
            conditions: applicationStateCoordinatorRecordConditions(current),
          },
          {
            keyName: APPLICATION_STATE_KEY_NAME,
            sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
            record: activationCandidate,
            conditions: currentActivation
              ? activationRecordConditions(currentActivation)
              : [
                  {
                    conditionType: CONDITION_TYPE.NOT_EXISTS,
                    propertyName: APPLICATION_STATE_KEY_NAME,
                  },
                ],
          },
        ],
        deleteRequests: [
          {
            keyName: APPLICATION_STATE_KEY_NAME,
            keyValue: retirement[APPLICATION_STATE_KEY_NAME],
            sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
            sortKeyValue: retirement[APPLICATION_STATE_SORT_KEY_NAME],
            conditions: retirementRecordConditions(retirement),
          },
        ],
      });
    } catch (error) {
      const winner = await readCoordinatorRecord(scope);
      const remainingRetirement = await readStoreRetirement(scope);
      const winningActivation = await readStoreActivation(scope);
      if (
        winner &&
        winner.record_digest === candidate.record_digest &&
        !remainingRetirement &&
        winningActivation &&
        winningActivation.record_digest === activationCandidate.record_digest
      ) {
        return winner;
      }
      throw error;
    }
    const retained = await readCoordinatorRecord(scope);
    const retainedActivation = await readStoreActivation(scope);
    if (
      !retained ||
      retained.record_digest !== candidate.record_digest ||
      (await readStoreRetirement(scope)) ||
      !retainedActivation ||
      retainedActivation.record_digest !== activationCandidate.record_digest
    ) {
      throw new ApplicationStateCoordinatorAuthorityConflictError(
        scope.namespace,
      );
    }
    return retained;
  }

  /** @param {{storeId: string, namespace: string}} scope - Snapshotted mutation scope. @returns {Promise<void>} - Throws if a new mutation has no matching local authority. */
  async function assertCurrentCoordinatorAuthority(scope) {
    const retirementScope = {
      storeId: scope.storeId,
      namespace: scope.namespace,
    };
    if (await readStoreRetirement(retirementScope)) {
      throw new ApplicationStateStoreRetiredError(scope.namespace);
    }
    const retained = await readCoordinatorAuthority({
      storeId: scope.storeId,
      namespace: scope.namespace,
    });
    const expected = coordinatorAuthority
      ? createApplicationStateCoordinatorAuthorityRecord({
          storeId: scope.storeId,
          namespace: scope.namespace,
          authority: coordinatorAuthority,
        })
      : null;
    if (retained?.record_digest !== expected?.record_digest) {
      throw new ApplicationStateCoordinatorAuthorityStaleError(scope.namespace);
    }
  }

  /** @param {import('../base.js').TransactionWriteParams} params - Destination mutation. @param {{storeId: string, namespace: string}} scope - Snapshotted mutation scope. @returns {Promise<void>} - Atomic locally fenced write. */
  async function writeWithCoordinatorFence(params, scope) {
    await db.transactionWrite({
      ...params,
      conditionChecks: [
        ...(params.conditionChecks || []),
        retirementAbsentCondition(scope),
        createApplicationStateCoordinatorAuthorityFence({
          storeId: scope.storeId,
          namespace: scope.namespace,
          ...(coordinatorAuthority ? { authority: coordinatorAuthority } : {}),
        }),
      ],
    });
  }

  /** @param {string} destinationEffectId - Receipt identity. @returns {Promise<Readonly<Record<string, any>> | null>} - Verified receipt. */
  async function readReceipt(destinationEffectId) {
    const key = createApplicationStateReceiptKey(destinationEffectId);
    const row = await readRecord(key.resourceId, key.sortKey);
    return row ? validateApplicationStateReceiptRecord(row) : null;
  }

  /** @param {string} destinationEffectId - Resolution identity. @returns {Promise<Readonly<Record<string, any>> | null>} - Verified resolution. */
  async function readNotAppliedResolution(destinationEffectId) {
    const key = createApplicationStateResolutionKey(destinationEffectId);
    const row = await readRecord(key.resourceId, key.sortKey);
    return row ? validateApplicationStateNotAppliedResolutionRecord(row) : null;
  }

  /** @param {string} destinationEffectId - Destination identity. @returns {Promise<{receipt: Readonly<Record<string, any>> | null, resolution: Readonly<Record<string, any>> | null}>} - Exclusive retained disposition. */
  async function readEffectDisposition(destinationEffectId) {
    const [receipt, resolution] = await Promise.all([
      readReceipt(destinationEffectId),
      readNotAppliedResolution(destinationEffectId),
    ]);
    if (receipt && resolution) {
      throw new ApplicationStateCorruptionError(
        `Application-state effect ${destinationEffectId} has both a positive receipt and a not-applied resolution.`,
      );
    }
    return { receipt, resolution };
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
        business?.contract_digest === receipt.contract_digest &&
        business?.store_id === receipt.store_id
      : business?.created_by_destination_effect_id !==
          receipt.destination_effect_id &&
        business?.store_id === receipt.store_id;
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

  /** @param {Readonly<Record<string, any>>} receipt - Candidate retained outcome. @param {{storeId: string, destinationEffectId: string, contractDigest: string, businessKey: {resourceId: string, sortKey: string}, insertedBusinessRecordDigest: string}} expected - Exact current contract. @returns {Promise<Readonly<Record<string, any>>>} - Matching substantiated receipt. */
  async function requireMatchingReceipt(receipt, expected) {
    if (
      receipt.store_id !== expected.storeId ||
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

  /** @param {Readonly<Record<string, any>>} resolution - Candidate retained decision. @param {{storeId: string, destinationEffectId: string, contractDigest: string, businessKey: {resourceId: string, sortKey: string}}} expected - Exact current contract. @returns {Promise<Readonly<Record<string, any>>>} - Matching substantiated resolution. */
  async function requireMatchingResolution(resolution, expected) {
    if (
      resolution.store_id !== expected.storeId ||
      resolution.destination_effect_id !== expected.destinationEffectId ||
      resolution.contract_digest !== expected.contractDigest ||
      resolution.business_resource_id !== expected.businessKey.resourceId ||
      resolution.business_sort_key !== expected.businessKey.sortKey
    ) {
      throw new ApplicationStateEffectConflictError(
        expected.destinationEffectId,
      );
    }
    const business = await readBusinessByPhysicalKey(
      resolution.business_resource_id,
      resolution.business_sort_key,
    );
    const observation = resolution.business_observation;
    const observationMatches =
      observation.kind === 'present-other'
        ? business?.store_id === resolution.store_id &&
          business?.record_digest === observation.recordDigest &&
          business?.created_by_destination_effect_id ===
            observation.createdByDestinationEffectId
        : !business ||
          (business.store_id === resolution.store_id &&
            business.created_by_destination_effect_id !==
              resolution.destination_effect_id);
    if (!observationMatches) {
      throw new ApplicationStateCorruptionError(
        `Application-state resolution ${resolution.destination_effect_id} has no semantically matching business observation.`,
      );
    }
    return resolution;
  }

  /** @param {string} destinationEffectId - Destination identity. @returns {import('../base.js').TransactionConditionCheck} - Resolution-absence transaction guard. */
  function resolutionAbsentCondition(destinationEffectId) {
    const key = createApplicationStateResolutionKey(destinationEffectId);
    return {
      keyName: APPLICATION_STATE_KEY_NAME,
      keyValue: key.resourceId,
      sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
      sortKeyValue: key.sortKey,
      conditions: [
        {
          conditionType: CONDITION_TYPE.NOT_EXISTS,
          propertyName: APPLICATION_STATE_KEY_NAME,
        },
      ],
    };
  }

  /** @param {string} destinationEffectId - Destination identity. @returns {import('../base.js').TransactionConditionCheck} - Receipt-absence transaction guard. */
  function receiptAbsentCondition(destinationEffectId) {
    const key = createApplicationStateReceiptKey(destinationEffectId);
    return {
      keyName: APPLICATION_STATE_KEY_NAME,
      keyValue: key.resourceId,
      sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
      sortKeyValue: key.sortKey,
      conditions: [
        {
          conditionType: CONDITION_TYPE.NOT_EXISTS,
          propertyName: APPLICATION_STATE_KEY_NAME,
        },
      ],
    };
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
    input = normalizeMutationInput(input);
    const identity = await assertStoreIdentity(input.storeId);
    const businessRecord = createApplicationStateBusinessRecord({
      storeId: input.storeId,
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
      storeId: input.storeId,
      destinationEffectId: input.destinationEffectId,
      contractDigest: input.contractDigest,
      businessKey,
      insertedBusinessRecordDigest: businessRecord.record_digest,
    };
    const existingDisposition = await readEffectDisposition(
      input.destinationEffectId,
    );
    if (existingDisposition.receipt) {
      return await requireMatchingReceipt(
        existingDisposition.receipt,
        expected,
      );
    }
    if (existingDisposition.resolution) {
      await requireMatchingResolution(existingDisposition.resolution, expected);
      throw new ApplicationStateEffectNotAppliedError(
        input.destinationEffectId,
      );
    }
    await assertCurrentCoordinatorAuthority(input);

    const insertedReceipt = createApplicationStateReceiptRecord({
      destinationEffectId: input.destinationEffectId,
      contractDigest: input.contractDigest,
      businessRecord,
      inserted: true,
    });
    const maxAttempts = input.maxAttempts ?? 3;

    /** @type {unknown} */
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await writeWithCoordinatorFence(
          {
            tableName,
            conditionChecks: [
              identityCondition(input.storeId, identity.identity_digest),
              resolutionAbsentCondition(input.destinationEffectId),
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
          },
          input,
        );
        return await requireMatchingReceipt(insertedReceipt, expected);
      } catch (error) {
        lastError = error;
        const disposition = await readEffectDisposition(
          input.destinationEffectId,
        );
        if (disposition.receipt) {
          return await requireMatchingReceipt(disposition.receipt, expected);
        }
        if (disposition.resolution) {
          await requireMatchingResolution(disposition.resolution, expected);
          throw new ApplicationStateEffectNotAppliedError(
            input.destinationEffectId,
          );
        }
        await assertCurrentCoordinatorAuthority(input);

        const existingBusiness = await readBusinessByPhysicalKey(
          businessKey.resourceId,
          businessKey.sortKey,
        );
        if (existingBusiness) {
          if (existingBusiness.store_id !== input.storeId) {
            throw new ApplicationStateStoreIdentityError(
              `Application-state business record does not belong to expected store ${input.storeId}.`,
            );
          }
          if (
            existingBusiness.created_by_destination_effect_id ===
            input.destinationEffectId
          ) {
            const winner = await readEffectDisposition(
              input.destinationEffectId,
            );
            if (winner.receipt) {
              return await requireMatchingReceipt(winner.receipt, expected);
            }
            if (winner.resolution) {
              await requireMatchingResolution(winner.resolution, expected);
              throw new ApplicationStateEffectNotAppliedError(
                input.destinationEffectId,
              );
            }
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
            await writeWithCoordinatorFence(
              {
                tableName,
                conditionChecks: [
                  identityCondition(input.storeId, identity.identity_digest),
                  resolutionAbsentCondition(input.destinationEffectId),
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
              },
              input,
            );
            return await requireMatchingReceipt(conflictReceipt, expected);
          } catch (conflictError) {
            lastError = conflictError;
            const retained = await readEffectDisposition(
              input.destinationEffectId,
            );
            if (retained.receipt) {
              return await requireMatchingReceipt(retained.receipt, expected);
            }
            if (retained.resolution) {
              await requireMatchingResolution(retained.resolution, expected);
              throw new ApplicationStateEffectNotAppliedError(
                input.destinationEffectId,
              );
            }
            await assertCurrentCoordinatorAuthority(input);
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
   * Permanently resolve one destination effect as not applied. The negative
   * resolution and positive receipt are mutually exclusive transaction
   * winners. Once the resolution wins, every normal put path is fenced from
   * creating a receipt or mutating the business key for this effect.
   * @param {{storeId: string, namespace: string, key: string, value: any, destinationEffectId: string, contractDigest: string, maxAttempts?: number}} input - Exact retained contract.
   * @returns {Promise<Readonly<{kind: 'outcome', receipt: Readonly<Record<string, any>>} | {kind: 'not-applied', resolution: Readonly<Record<string, any>>}>>} - Permanent destination disposition.
   */
  async function resolvePutIfAbsentNotApplied(input) {
    input = normalizeMutationInput(input);
    const identity = await assertStoreIdentity(input.storeId);
    const insertedBusinessRecord = createApplicationStateBusinessRecord({
      storeId: input.storeId,
      namespace: input.namespace,
      key: input.key,
      value: input.value,
      destinationEffectId: input.destinationEffectId,
      contractDigest: input.contractDigest,
    });
    const businessKey = createApplicationStateBusinessKey(
      input.namespace,
      input.key,
    );
    const expectedReceipt = {
      storeId: input.storeId,
      destinationEffectId: input.destinationEffectId,
      contractDigest: input.contractDigest,
      businessKey,
      insertedBusinessRecordDigest: insertedBusinessRecord.record_digest,
    };
    const expectedResolution = {
      storeId: input.storeId,
      destinationEffectId: input.destinationEffectId,
      contractDigest: input.contractDigest,
      businessKey,
    };

    const retained = await readEffectDisposition(input.destinationEffectId);
    if (retained.receipt) {
      return Object.freeze({
        kind: 'outcome',
        receipt: await requireMatchingReceipt(
          retained.receipt,
          expectedReceipt,
        ),
      });
    }
    if (retained.resolution) {
      return Object.freeze({
        kind: 'not-applied',
        resolution: await requireMatchingResolution(
          retained.resolution,
          expectedResolution,
        ),
      });
    }
    await assertCurrentCoordinatorAuthority(input);

    const maxAttempts = input.maxAttempts ?? 3;

    /** @type {unknown} */
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const business = await readBusinessByPhysicalKey(
        businessKey.resourceId,
        businessKey.sortKey,
      );
      if (business && business.store_id !== input.storeId) {
        throw new ApplicationStateStoreIdentityError(
          `Application-state business record does not belong to expected store ${input.storeId}.`,
        );
      }
      if (
        business?.created_by_destination_effect_id === input.destinationEffectId
      ) {
        const winner = await readEffectDisposition(input.destinationEffectId);
        if (winner.receipt) {
          return Object.freeze({
            kind: 'outcome',
            receipt: await requireMatchingReceipt(
              winner.receipt,
              expectedReceipt,
            ),
          });
        }
        if (winner.resolution) {
          return Object.freeze({
            kind: 'not-applied',
            resolution: await requireMatchingResolution(
              winner.resolution,
              expectedResolution,
            ),
          });
        }
        throw new ApplicationStateCorruptionError(
          `Application-state effect ${input.destinationEffectId} has a business record without its permanent receipt.`,
        );
      }
      /** @type {{kind: 'absent'} | {kind: 'present-other', recordDigest: string, createdByDestinationEffectId: string}} */
      const businessObservation = business
        ? {
            kind: 'present-other',
            recordDigest: business.record_digest,
            createdByDestinationEffectId:
              business.created_by_destination_effect_id,
          }
        : { kind: 'absent' };
      const candidate = createApplicationStateNotAppliedResolutionRecord({
        ...expectedResolution,
        businessObservation,
      });
      const businessCondition = {
        keyName: APPLICATION_STATE_KEY_NAME,
        keyValue: businessKey.resourceId,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        sortKeyValue: businessKey.sortKey,
        conditions: business
          ? [
              {
                conditionType: CONDITION_TYPE.EQUALS,
                propertyName: 'record_digest',
                propertyValue: business.record_digest,
              },
            ]
          : [
              {
                conditionType: CONDITION_TYPE.NOT_EXISTS,
                propertyName: APPLICATION_STATE_KEY_NAME,
              },
            ],
      };
      try {
        await writeWithCoordinatorFence(
          {
            tableName,
            conditionChecks: [
              identityCondition(input.storeId, identity.identity_digest),
              receiptAbsentCondition(input.destinationEffectId),
              businessCondition,
            ],
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
          },
          input,
        );
        return Object.freeze({
          kind: 'not-applied',
          resolution: await requireMatchingResolution(
            candidate,
            expectedResolution,
          ),
        });
      } catch (error) {
        lastError = error;
        const winner = await readEffectDisposition(input.destinationEffectId);
        if (winner.receipt) {
          return Object.freeze({
            kind: 'outcome',
            receipt: await requireMatchingReceipt(
              winner.receipt,
              expectedReceipt,
            ),
          });
        }
        if (winner.resolution) {
          return Object.freeze({
            kind: 'not-applied',
            resolution: await requireMatchingResolution(
              winner.resolution,
              expectedResolution,
            ),
          });
        }
        await assertCurrentCoordinatorAuthority(input);
        if (isConditionalFailure(error)) {
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
    input = normalizeMutationInput(input, false);
    await assertStoreIdentity(input.storeId);
    const { receipt, resolution } = await readEffectDisposition(
      input.destinationEffectId,
    );
    const insertedBusinessRecord = createApplicationStateBusinessRecord({
      storeId: input.storeId,
      namespace: input.namespace,
      key: input.key,
      value: input.value,
      destinationEffectId: input.destinationEffectId,
      contractDigest: input.contractDigest,
    });
    const expected = {
      storeId: input.storeId,
      destinationEffectId: input.destinationEffectId,
      contractDigest: input.contractDigest,
      businessKey: createApplicationStateBusinessKey(
        input.namespace,
        input.key,
      ),
      insertedBusinessRecordDigest: insertedBusinessRecord.record_digest,
    };
    if (resolution) {
      await requireMatchingResolution(resolution, expected);
      return null;
    }
    if (!receipt) return null;
    return await requireMatchingReceipt(receipt, expected);
  }

  return Object.freeze({
    tableName,
    readStoreIdentity,
    ensureStoreIdentity,
    assertStoreIdentity,
    readStoreRetirement,
    readStoreActivation,
    retireStore,
    reactivateRetiredStore,
    readCoordinatorAuthority,
    assertCoordinatorAuthorityAdoptionPrecondition,
    adoptCoordinatorAuthority,
    readReceipt,
    readNotAppliedResolution,
    readBusinessByPhysicalKey,
    putIfAbsent,
    resolvePutIfAbsentNotApplied,
    recoverPutIfAbsent,
  });
}

export default createApplicationStateTable;
