import { CONDITION_TYPE } from '../base.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../../../runtime/content-id.js';
import { cloneBoundedJsonObject } from '../../../runtime/json-value.js';
import { assertCoordinatorAuthorityToken } from './coordinator-authority.js';

const KEY_NAME = 'resource_id';
const SORT_KEY_NAME = 'sort_key';
export const APPLICATION_STATE_COORDINATOR_AUTHORITY_RECORD_KIND =
  'application-state-coordinator-authority';
export const APPLICATION_STATE_COORDINATOR_AUTHORITY_SORT_KEY = 'authority/v1';
const SCHEMA_VERSION = 1;
const RECORD_KEYS = Object.freeze([
  KEY_NAME,
  SORT_KEY_NAME,
  'record_kind',
  'schema_version',
  'store_id',
  'namespace',
  'authority_schema_version',
  'coordinator_id',
  'authority_id',
  'epoch',
  'record_digest',
]);

/** A caller is not the destination's exact adopted coordinator. */
export class ApplicationStateCoordinatorAuthorityStaleError extends Error {
  /** @param {string} namespace - Destination application namespace. */
  constructor(namespace) {
    super(
      `Application-state coordinator authority is not adopted: ${namespace}`,
    );
    this.name = 'ApplicationStateCoordinatorAuthorityStaleError';
    this.code = 'WHARFIE_APPLICATION_STATE_COORDINATOR_AUTHORITY_STALE';
    this.namespace = namespace;
  }
}

/** Another destination adoption changed the exact predecessor. */
export class ApplicationStateCoordinatorAuthorityConflictError extends Error {
  /** @param {string} namespace - Destination application namespace. */
  constructor(namespace) {
    super(
      `Application-state coordinator adoption changed concurrently: ${namespace}`,
    );
    this.name = 'ApplicationStateCoordinatorAuthorityConflictError';
    this.code = 'WHARFIE_APPLICATION_STATE_COORDINATOR_AUTHORITY_CONFLICT';
    this.namespace = namespace;
  }
}

/**
 * @param {string} namespace - Trusted destination namespace.
 * @returns {Readonly<{resourceId: string, sortKey: string}>} - Reserved local fence key.
 */
export function createApplicationStateCoordinatorAuthorityKey(namespace) {
  if (typeof namespace !== 'string' || !namespace) {
    throw new TypeError(
      'Application-state coordinator namespace must be non-empty.',
    );
  }
  const partition = createCanonicalJsonSha256Id({
    domain: 'wharfie:application-state:coordinator-partition:v1',
    prefix: 'waap1',
    value: { namespace },
    valuePath: 'application-state coordinator namespace',
  });
  return Object.freeze({
    resourceId: `application-state/v2/coordinator/${partition}`,
    sortKey: APPLICATION_STATE_COORDINATOR_AUTHORITY_SORT_KEY,
  });
}

/**
 * This record is a destination-local high-water mark, not a copy of current
 * control-store authority, an acquisition capability, or a lease. Ordering
 * assumes one trusted control-authority lineage for this store/namespace.
 * @param {{storeId: string, namespace: string, authority: unknown}} input - Exact local binding.
 * @returns {Readonly<Record<string, any>>} - Canonical immutable record.
 */
export function createApplicationStateCoordinatorAuthorityRecord(input) {
  assertDomainSeparatedSha256Id(
    input.storeId,
    'was',
    'application-state coordinator storeId',
  );
  const token = assertCoordinatorAuthorityToken(input.authority);
  if (token.appId !== input.namespace) {
    throw new TypeError(
      'Application-state coordinator authority must match the namespace.',
    );
  }
  const key = createApplicationStateCoordinatorAuthorityKey(input.namespace);
  const fields = {
    [KEY_NAME]: key.resourceId,
    [SORT_KEY_NAME]: key.sortKey,
    record_kind: APPLICATION_STATE_COORDINATOR_AUTHORITY_RECORD_KIND,
    schema_version: SCHEMA_VERSION,
    store_id: input.storeId,
    namespace: input.namespace,
    authority_schema_version: token.schemaVersion,
    coordinator_id: token.coordinatorId,
    authority_id: token.authorityId,
    epoch: token.epoch,
  };
  return Object.freeze({
    ...fields,
    record_digest: createCanonicalJsonSha256Id({
      domain: 'wharfie:application-state:coordinator-authority:v1',
      prefix: 'waaf1',
      value: fields,
      valuePath: 'application-state coordinator record',
    }),
  });
}

/**
 * @param {unknown} value - Candidate retained destination fence.
 * @returns {Readonly<Record<string, any>>} - Exact verified record.
 */
export function validateApplicationStateCoordinatorAuthorityRecord(value) {
  const record = cloneBoundedJsonObject(
    value,
    32 * 1024,
    'application-state coordinator record',
  );
  const keys = Object.keys(record);
  if (
    keys.length !== RECORD_KEYS.length ||
    keys.some((key) => !RECORD_KEYS.includes(key))
  ) {
    throw new TypeError(
      'Application-state coordinator record has an invalid shape.',
    );
  }
  const expected = createApplicationStateCoordinatorAuthorityRecord({
    storeId: record.store_id,
    namespace: record.namespace,
    authority: {
      schemaVersion: record.authority_schema_version,
      appId: record.namespace,
      coordinatorId: record.coordinator_id,
      authorityId: record.authority_id,
      epoch: record.epoch,
    },
  });
  if (RECORD_KEYS.some((key) => record[key] !== expected[key])) {
    throw new TypeError(
      'Application-state coordinator record failed verification.',
    );
  }
  return expected;
}

/**
 * @param {Readonly<Record<string, any>>} record - Verified exact predecessor.
 * @returns {import('../base.js').KeyCondition[]} - Primitive equality CAS conditions.
 */
export function applicationStateCoordinatorRecordConditions(record) {
  return RECORD_KEYS.map((key) => ({
    conditionType: CONDITION_TYPE.EQUALS,
    propertyName: key,
    propertyValue: record[key],
  }));
}

/**
 * Bound writers require their exact local high-water record. New unbound
 * writes require its absence, so adopting a namespace closes the legacy path
 * in this binary too. These conditions must share the destination transaction.
 * @param {{storeId: string, namespace: string, authority?: unknown}} input - Snapshotted write binding.
 * @returns {import('../base.js').TransactionConditionCheck} - Same-table write guard.
 */
export function createApplicationStateCoordinatorAuthorityFence(input) {
  const key = createApplicationStateCoordinatorAuthorityKey(input.namespace);
  return {
    keyName: KEY_NAME,
    keyValue: key.resourceId,
    sortKeyName: SORT_KEY_NAME,
    sortKeyValue: key.sortKey,
    conditions:
      input.authority === undefined
        ? [
            {
              conditionType: CONDITION_TYPE.NOT_EXISTS,
              propertyName: KEY_NAME,
            },
            {
              conditionType: CONDITION_TYPE.NOT_EXISTS,
              propertyName: SORT_KEY_NAME,
            },
          ]
        : applicationStateCoordinatorRecordConditions(
            createApplicationStateCoordinatorAuthorityRecord({
              storeId: input.storeId,
              namespace: input.namespace,
              authority: input.authority,
            }),
          ),
  };
}
