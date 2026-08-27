/* eslint-disable jsdoc/require-param, jsdoc/require-returns -- Exact-schema helpers retain compact inline parameter and return types. */

import { CONDITION_TYPE } from '../base.js';
import { createCanonicalJsonSha256Id } from '../../../runtime/content-id.js';
import { cloneBoundedJsonObject } from '../../../runtime/json-value.js';
import { assertLogicalId } from '../../../runtime/logical-id.js';
import { normalizeApplicationStateDestination } from '../../../runtime/effects/application-state.js';
import {
  assertCoordinatorAuthorityCurrent,
  assertCoordinatorAuthorityToken,
  createCoordinatorAuthorityFence,
} from './coordinator-authority.js';
import {
  createApplicationStateCoordinatorAuthorityRecord,
  validateApplicationStateCoordinatorAuthorityRecord,
} from './application-state-authority.js';

const KEY_NAME = 'run_id';
const SORT_KEY_NAME = 'sort_key';
const MAX_RECORD_BYTES = 32 * 1024;
export const APPLICATION_STATE_READINESS_RECORD_KIND =
  'application-state-readiness';
export const APPLICATION_STATE_READINESS_SORT_KEY =
  'application-state-readiness/v1/primary';
export const ApplicationStateReadinessStatus = Object.freeze({
  PREPARING: 'PREPARING',
  ADOPTED: 'ADOPTED',
});

/**
 * @typedef {Readonly<{
 *   run_id: string,
 *   sort_key: string,
 *   schema_version: 1,
 *   record_kind: 'application-state-readiness',
 *   app_id: string,
 *   destination_kind: 'application-state',
 *   destination_version: 2,
 *   binding_id: 'primary',
 *   provider: 'lmdb' | 'vanilla',
 *   store_id: string,
 *   table_name: 'wharfie-application-state-v2',
 *   namespace: string,
 *   authority_schema_version: 1,
 *   coordinator_id: string,
 *   authority_id: string,
 *   epoch: number,
 *   status: 'PREPARING' | 'ADOPTED',
 *   destination_authority_digest: string,
 *   record_digest: string,
 * }>} ApplicationStateReadinessRecord
 */
/** @typedef {import('./coordinator-authority.js').CoordinatorAuthorityToken} AuthorityToken */
/** @typedef {ReturnType<typeof normalizeApplicationStateDestination>} Destination */

/** @type {Readonly<Array<keyof ApplicationStateReadinessRecord>>} */
const RECORD_KEYS = Object.freeze([
  KEY_NAME,
  SORT_KEY_NAME,
  'schema_version',
  'record_kind',
  'app_id',
  'destination_kind',
  'destination_version',
  'binding_id',
  'provider',
  'store_id',
  'table_name',
  'namespace',
  'authority_schema_version',
  'coordinator_id',
  'authority_id',
  'epoch',
  'status',
  'destination_authority_digest',
  'record_digest',
]);

/** An exact readiness predecessor or immutable destination does not match. */
export class ApplicationStateReadinessConflictError extends Error {
  /** @param {string} appId - Application scope. @param {string} reason - Safe conflict reason. @param {{cause?: unknown}} [options] - Optional underlying failure. */
  constructor(appId, reason, options = {}) {
    super(`Application-state readiness conflicts: ${appId} (${reason})`, {
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = 'ApplicationStateReadinessConflictError';
    this.code = 'WHARFIE_APPLICATION_STATE_READINESS_CONFLICT';
    this.appId = appId;
    this.reason = reason;
  }
}

/** Retained readiness bytes fail their exact integrity contract. */
export class ApplicationStateReadinessRecordError extends Error {
  /** @param {string} appId - Expected application scope. @param {{cause?: unknown}} [options] - Optional validation failure. */
  constructor(appId, options = {}) {
    super(`Application-state readiness record is invalid: ${appId}`, {
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = 'ApplicationStateReadinessRecordError';
    this.code = 'WHARFIE_APPLICATION_STATE_READINESS_RECORD_INVALID';
    this.appId = appId;
  }
}

/** @param {unknown} value - Candidate exact object. @param {string[]} keys - Required keys. @param {string} label - Boundary label. @returns {Record<string, any>} - Bounded independent JSON copy. */
function exactObject(value, keys, label) {
  const object = cloneBoundedJsonObject(value, MAX_RECORD_BYTES, label);
  if (
    Object.keys(object).length !== keys.length ||
    Object.keys(object).some((key) => !keys.includes(key))
  ) {
    throw new TypeError(`${label} has unsupported or missing fields.`);
  }
  return object;
}

/** @param {string} appId - Application scope. @returns {string} - Reserved control-table partition. */
export function getApplicationStateReadinessPartitionKey(appId) {
  assertLogicalId(appId, 'application-state readiness appId');
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:application-state:readiness-partition:v1',
    prefix: 'wasrp1',
    value: { schemaVersion: 1, appId },
    valuePath: 'application-state readiness partition',
  });
}

/** @param {Record<string, any>} record - Readiness fields. @returns {Destination} - Exact destination. */
function destinationFromFields(record) {
  return normalizeApplicationStateDestination({
    kind: record.destination_kind,
    version: record.destination_version,
    bindingId: record.binding_id,
    configuration: {
      provider: record.provider,
      storeId: record.store_id,
      tableName: record.table_name,
      namespace: record.namespace,
    },
  });
}

/** @param {Record<string, any>} record - Readiness fields. @returns {AuthorityToken} - Exact stable token. */
function authorityFromFields(record) {
  return assertCoordinatorAuthorityToken({
    schemaVersion: record.authority_schema_version,
    appId: record.app_id,
    coordinatorId: record.coordinator_id,
    authorityId: record.authority_id,
    epoch: record.epoch,
  });
}

/** @param {{destination: unknown, authority: unknown, status: unknown}} input - Exact transition inputs. @returns {ApplicationStateReadinessRecord} - Canonical immutable physical record. */
function createRecord(input) {
  const destination = normalizeApplicationStateDestination(input.destination);
  const authority = assertCoordinatorAuthorityToken(input.authority);
  if (destination.configuration.namespace !== authority.appId) {
    throw new TypeError(
      'Application-state readiness destination must match the authority appId.',
    );
  }
  if (input.status !== 'PREPARING' && input.status !== 'ADOPTED') {
    throw new TypeError('Application-state readiness status is invalid.');
  }
  const barrier = createApplicationStateCoordinatorAuthorityRecord({
    storeId: destination.configuration.storeId,
    namespace: authority.appId,
    authority,
  });
  /** @type {Omit<ApplicationStateReadinessRecord, 'record_digest'>} */
  const fields = {
    [KEY_NAME]: getApplicationStateReadinessPartitionKey(authority.appId),
    [SORT_KEY_NAME]: APPLICATION_STATE_READINESS_SORT_KEY,
    schema_version: 1,
    record_kind: APPLICATION_STATE_READINESS_RECORD_KIND,
    app_id: authority.appId,
    destination_kind: destination.kind,
    destination_version: destination.version,
    binding_id: destination.bindingId,
    provider: destination.configuration.provider,
    store_id: destination.configuration.storeId,
    table_name: destination.configuration.tableName,
    namespace: destination.configuration.namespace,
    authority_schema_version: authority.schemaVersion,
    coordinator_id: authority.coordinatorId,
    authority_id: authority.authorityId,
    epoch: authority.epoch,
    status: input.status,
    destination_authority_digest: barrier.record_digest,
  };
  return Object.freeze({
    ...fields,
    record_digest: createCanonicalJsonSha256Id({
      domain: 'wharfie:application-state:readiness:v1',
      prefix: 'wasr1',
      value: fields,
      valuePath: 'application-state readiness record',
    }),
  });
}

/** @param {unknown} value - Candidate retained readiness. @returns {ApplicationStateReadinessRecord} - Strict immutable record. */
export function validateApplicationStateReadinessRecord(value) {
  const record = exactObject(
    value,
    [...RECORD_KEYS],
    'application-state readiness record',
  );
  const expected = createRecord({
    destination: destinationFromFields(record),
    authority: authorityFromFields(record),
    status: record.status,
  });
  if (RECORD_KEYS.some((key) => record[key] !== expected[key])) {
    throw new TypeError(
      'Application-state readiness record failed verification.',
    );
  }
  return expected;
}

/** @param {unknown} value - Exact retained readiness, in either phase. @returns {Destination} - Normalized pinned destination. */
export function applicationStateReadinessDestination(value) {
  return destinationFromFields(validateApplicationStateReadinessRecord(value));
}

/** @param {unknown} value - Exact retained readiness, in either phase. @returns {AuthorityToken} - Stable captured authority. */
export function applicationStateReadinessAuthority(value) {
  return authorityFromFields(validateApplicationStateReadinessRecord(value));
}

/** @param {ApplicationStateReadinessRecord} record - Verified predecessor. @returns {import('../base.js').KeyCondition[]} - Exact primitive CAS predicates. */
function recordConditions(record) {
  return RECORD_KEYS.map((key) =>
    Object.freeze({
      conditionType: CONDITION_TYPE.EQUALS,
      propertyName: key,
      propertyValue: record[key],
    }),
  );
}

/**
 * A lifecycle READY write must share its control-table transaction with this
 * ADOPTED guard and the captured coordinator authority fence. This does not
 * create a transaction across the control and destination stores.
 * @param {unknown} value - Exact ADOPTED readiness record.
 * @returns {Readonly<import('../base.js').TransactionConditionCheck>} - Same-control-table readiness condition.
 */
export function createApplicationStateReadinessFence(value) {
  const record = validateApplicationStateReadinessRecord(value);
  if (record.status !== 'ADOPTED') {
    throw new TypeError('Application-state readiness fence requires ADOPTED.');
  }
  return Object.freeze({
    keyName: KEY_NAME,
    keyValue: record.run_id,
    sortKeyName: SORT_KEY_NAME,
    sortKeyValue: record.sort_key,
    conditions: recordConditions(record),
  });
}

/** @param {ApplicationStateReadinessRecord} record - Retained row. @param {AuthorityToken} token - Captured token. @returns {boolean} - Exact stable authority equality. */
function sameAuthority(record, token) {
  return (
    record.authority_schema_version === token.schemaVersion &&
    record.app_id === token.appId &&
    record.coordinator_id === token.coordinatorId &&
    record.authority_id === token.authorityId &&
    record.epoch === token.epoch
  );
}

/** @param {ApplicationStateReadinessRecord} left - Retained pin. @param {ApplicationStateReadinessRecord} right - Proposed pin. @returns {boolean} - Immutable destination equality. */
function sameDestination(left, right) {
  return (
    left.app_id === right.app_id &&
    left.destination_kind === right.destination_kind &&
    left.destination_version === right.destination_version &&
    left.binding_id === right.binding_id &&
    left.provider === right.provider &&
    left.store_id === right.store_id &&
    left.table_name === right.table_name &&
    left.namespace === right.namespace
  );
}

/**
 * The readiness row is a resumable control-side pin, not a historical effect
 * receipt. PREPARING retains the immutable destination before adoption;
 * ADOPTED retains an exact destination-local barrier readback. The caller
 * still owns opening and verifying that independent physical destination.
 * No operation adopts a replacement token, rebases a CAS, or resets a pin.
 * @param {{db: import('../base.js').DBClient, tableName: string, coordinatorAuthority?: unknown}} options - Control-table dependencies and optional captured token.
 * @returns {Readonly<{get: (input: {appId: string}) => Promise<ApplicationStateReadinessRecord | null>, prepare: (input: {destination: unknown}) => Promise<ApplicationStateReadinessRecord>, markAdopted: (input: {preparation: unknown, destinationAuthority: unknown}) => Promise<ApplicationStateReadinessRecord>, advanceAdopted: (input: {predecessor: unknown, destinationAuthority: unknown}) => Promise<ApplicationStateReadinessRecord>}>} - Readiness operations.
 */
export function createApplicationStateReadinessStore(options) {
  if (
    !options?.db ||
    typeof options.db.get !== 'function' ||
    typeof options.db.transactionWrite !== 'function'
  ) {
    throw new TypeError('Application-state readiness requires a DB client.');
  }
  if (typeof options.tableName !== 'string' || !options.tableName.trim()) {
    throw new TypeError('Application-state readiness requires a tableName.');
  }
  const db = options.db;
  const tableName = options.tableName.trim();
  const authority =
    options.coordinatorAuthority === undefined
      ? undefined
      : assertCoordinatorAuthorityToken(options.coordinatorAuthority);

  /** @returns {AuthorityToken} - Captured authority, never read from current state. */
  function requireAuthority() {
    if (!authority) {
      throw new TypeError(
        'Application-state readiness requires bound authority.',
      );
    }
    return authority;
  }

  /** @param {AuthorityToken} token - Captured authority. @returns {Promise<void>} - Current active source authority. */
  async function assertCurrent(token) {
    await assertCoordinatorAuthorityCurrent({
      db,
      tableName,
      authority: token,
    });
  }

  /** @param {string} appId - Validated application scope. @returns {Promise<ApplicationStateReadinessRecord | null>} - Strict current readiness bytes. */
  async function readRecord(appId) {
    const raw = await db.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: getApplicationStateReadinessPartitionKey(appId),
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: APPLICATION_STATE_READINESS_SORT_KEY,
      consistentRead: true,
    });
    if (raw === undefined || raw === null) return null;
    try {
      const record = validateApplicationStateReadinessRecord(raw);
      if (record.app_id !== appId) {
        throw new TypeError(
          'Application-state readiness appId does not match.',
        );
      }
      return record;
    } catch (cause) {
      throw new ApplicationStateReadinessRecordError(appId, { cause });
    }
  }

  /** @param {{appId: string}} input - Read-only application lookup. @returns {Promise<ApplicationStateReadinessRecord | null>} - Current retained readiness without authority or destination claims. */
  async function get(input) {
    const scope = exactObject(
      input,
      ['appId'],
      'application-state readiness lookup',
    );
    assertLogicalId(scope.appId, 'application-state readiness appId');
    if (authority && scope.appId !== authority.appId) {
      throw new TypeError(
        'Application-state readiness lookup must match the bound appId.',
      );
    }
    return await readRecord(scope.appId);
  }

  /** @param {ApplicationStateReadinessRecord | null} current - Exact predecessor. @param {ApplicationStateReadinessRecord} candidate - Exact successor. @param {AuthorityToken} token - Captured source authority. @returns {Promise<ApplicationStateReadinessRecord>} - Exact retained transition, still under current authority. */
  async function writeTransition(current, candidate, token) {
    try {
      await db.transactionWrite({
        tableName,
        conditionChecks: [createCoordinatorAuthorityFence(token)],
        putRequests: [
          {
            keyName: KEY_NAME,
            sortKeyName: SORT_KEY_NAME,
            record: candidate,
            conditions: current
              ? recordConditions(current)
              : [
                  {
                    conditionType: CONDITION_TYPE.NOT_EXISTS,
                    propertyName: KEY_NAME,
                  },
                  {
                    conditionType: CONDITION_TYPE.NOT_EXISTS,
                    propertyName: SORT_KEY_NAME,
                  },
                ],
          },
        ],
      });
    } catch (error) {
      const retained = await readRecord(token.appId);
      await assertCurrent(token);
      if (retained?.record_digest === candidate.record_digest) return retained;
      if (
        error instanceof Error &&
        error.name === 'ConditionalCheckFailedException'
      ) {
        throw new ApplicationStateReadinessConflictError(
          token.appId,
          'exact predecessor changed',
          { cause: error },
        );
      }
      throw error;
    }
    const retained = await readRecord(token.appId);
    await assertCurrent(token);
    if (retained?.record_digest === candidate.record_digest) return retained;
    throw new ApplicationStateReadinessConflictError(
      token.appId,
      'accepted transition was superseded',
    );
  }

  /** @param {{destination: unknown}} input - Exact normalized destination intent. @returns {Promise<ApplicationStateReadinessRecord>} - Current preparation or same-token adopted row. */
  async function prepare(input) {
    const captured = exactObject(
      input,
      ['destination'],
      'application-state readiness prepare',
    );
    const token = requireAuthority();
    const candidate = createRecord({
      destination: captured.destination,
      authority: token,
      status: 'PREPARING',
    });
    await assertCurrent(token);
    const current = await readRecord(token.appId);
    if (current) {
      if (!sameDestination(current, candidate)) {
        throw new ApplicationStateReadinessConflictError(
          token.appId,
          'destination is already pinned',
        );
      }
      if (sameAuthority(current, token)) {
        await assertCurrent(token);
        return current;
      }
      if (current.status === 'ADOPTED') {
        throw new ApplicationStateReadinessConflictError(
          token.appId,
          'ADOPTED authority must advance through exact destination evidence',
        );
      }
      if (token.epoch <= current.epoch) {
        throw new ApplicationStateReadinessConflictError(
          token.appId,
          'authority cannot advance the retained epoch',
        );
      }
    }
    return await writeTransition(current, candidate, token);
  }

  /** @param {{preparation: unknown, destinationAuthority: unknown}} input - Exact preparation and independently read destination barrier. @returns {Promise<ApplicationStateReadinessRecord>} - Current exact adopted row. */
  async function markAdopted(input) {
    const captured = exactObject(
      input,
      ['preparation', 'destinationAuthority'],
      'application-state readiness adoption',
    );
    const token = requireAuthority();
    const preparation = validateApplicationStateReadinessRecord(
      captured.preparation,
    );
    if (!sameAuthority(preparation, token)) {
      throw new TypeError(
        'Application-state readiness preparation must match the bound authority.',
      );
    }
    const barrier = validateApplicationStateCoordinatorAuthorityRecord(
      captured.destinationAuthority,
    );
    if (barrier.record_digest !== preparation.destination_authority_digest) {
      throw new TypeError(
        'Application-state readiness destination readback must match the exact store and authority.',
      );
    }
    const candidate = createRecord({
      destination: destinationFromFields(preparation),
      authority: token,
      status: 'ADOPTED',
    });
    await assertCurrent(token);
    const current = await readRecord(token.appId);
    if (current?.record_digest === candidate.record_digest) {
      await assertCurrent(token);
      return current;
    }
    if (
      !current ||
      current.record_digest !== preparation.record_digest ||
      preparation.status !== 'PREPARING'
    ) {
      throw new ApplicationStateReadinessConflictError(
        token.appId,
        'preparation is no longer retained',
      );
    }
    return await writeTransition(current, candidate, token);
  }

  /**
   * Advance an already-confirmed ADOPTED floor directly after the destination
   * has adopted the bound higher token. Avoiding an intermediate PREPARING row
   * preserves the last confirmed floor across the non-atomic control write.
   * @param {{predecessor: unknown, destinationAuthority: unknown}} input - Exact retained ADOPTED row and destination readback.
   * @returns {Promise<ApplicationStateReadinessRecord>} - Current exact ADOPTED row.
   */
  async function advanceAdopted(input) {
    const captured = exactObject(
      input,
      ['predecessor', 'destinationAuthority'],
      'application-state readiness adopted advance',
    );
    const token = requireAuthority();
    const predecessor = validateApplicationStateReadinessRecord(
      captured.predecessor,
    );
    if (predecessor.status !== 'ADOPTED') {
      throw new TypeError(
        'Application-state readiness adopted advance requires ADOPTED predecessor.',
      );
    }
    const candidate = createRecord({
      destination: destinationFromFields(predecessor),
      authority: token,
      status: 'ADOPTED',
    });
    const barrier = validateApplicationStateCoordinatorAuthorityRecord(
      captured.destinationAuthority,
    );
    if (barrier.record_digest !== candidate.destination_authority_digest) {
      throw new TypeError(
        'Application-state readiness adopted advance requires the exact current destination authority.',
      );
    }
    await assertCurrent(token);
    const current = await readRecord(token.appId);
    if (current?.record_digest === candidate.record_digest) {
      await assertCurrent(token);
      return current;
    }
    if (
      !current ||
      current.record_digest !== predecessor.record_digest ||
      token.epoch <= predecessor.epoch
    ) {
      throw new ApplicationStateReadinessConflictError(
        token.appId,
        'adopted predecessor is no longer current',
      );
    }
    return await writeTransition(current, candidate, token);
  }

  return Object.freeze({ get, prepare, markAdopted, advanceAdopted });
}
