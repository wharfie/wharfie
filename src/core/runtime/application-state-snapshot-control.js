/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- The internal evidence store keeps its complete immutable contracts inline. */

import { CONDITION_TYPE } from '../lib/db/base.js';
import {
  CoordinatorQuiescenceBarrierState,
  assertCoordinatorQuiescenceBarrierSnapshot,
  createCoordinatorQuiescenceBarrierFence,
} from '../lib/db/tables/coordinator-quiescence-barrier.js';
import {
  assertCoordinatorAuthorityToken,
  createCoordinatorAuthorityFence,
} from '../lib/db/tables/coordinator-authority.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  APPLICATION_STATE_TRANSPORT_HYDRATED_STATUS,
  APPLICATION_STATE_TRANSPORT_RETAINED_STATUS,
  assertApplicationStateSnapshotTransferId,
  normalizeApplicationStateSnapshotTransport,
} from './application-state-snapshot.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import { cloneBoundedJsonObject } from './json-value.js';

const KEY_NAME = 'run_id';
const SORT_KEY_NAME = 'sort_key';

export const APPLICATION_STATE_SNAPSHOT_CONTROL_SCHEMA_VERSION = 1;
export const APPLICATION_STATE_SNAPSHOT_PUBLICATION_KIND =
  'applicationStateSnapshotPublicationEvidence';
export const APPLICATION_STATE_SNAPSHOT_ACTIVATION_KIND =
  'applicationStateSnapshotActivationClaim';
export const APPLICATION_STATE_SNAPSHOT_PUBLICATION_RECORD_KIND =
  'application-state-snapshot-publication';
export const APPLICATION_STATE_SNAPSHOT_ACTIVATION_RECORD_KIND =
  'application-state-snapshot-activation';
export const APPLICATION_STATE_SNAPSHOT_PUBLICATION_SORT_KEY =
  'application-state-snapshot-control/v1/publication';
export const APPLICATION_STATE_SNAPSHOT_ACTIVATION_SORT_KEY =
  'application-state-snapshot-control/v1/activation';
export const APPLICATION_STATE_SNAPSHOT_CONTROL_PARTITION_DOMAIN =
  'wharfie:application-state-snapshot-control-partition:v1';
export const APPLICATION_STATE_SNAPSHOT_CONTROL_PARTITION_PREFIX = 'wascp1';
export const APPLICATION_STATE_SNAPSHOT_PUBLICATION_DOMAIN =
  'wharfie:application-state-snapshot-publication:v1';
export const APPLICATION_STATE_SNAPSHOT_PUBLICATION_PREFIX = 'wasp1';
export const APPLICATION_STATE_SNAPSHOT_ACTIVATION_DOMAIN =
  'wharfie:application-state-snapshot-activation:v1';
export const APPLICATION_STATE_SNAPSHOT_ACTIVATION_PREFIX = 'wasa1';
export const APPLICATION_STATE_SNAPSHOT_CONTROL_MAX_RECORD_BYTES = 256 * 1024;

const PUBLICATION_RECORD_KEYS = new Set([
  KEY_NAME,
  SORT_KEY_NAME,
  'schema_version',
  'record_kind',
  'app_id',
  'transfer_id',
  'snapshot_id',
  'transport',
  'source_barrier',
  'source_authority',
  'record_digest',
]);
const ACTIVATION_RECORD_KEYS = new Set([
  KEY_NAME,
  SORT_KEY_NAME,
  'schema_version',
  'record_kind',
  'app_id',
  'transfer_id',
  'snapshot_id',
  'publication_id',
  'transport',
  'replacement_authority',
  'replacement_barrier',
  'replica_id',
  'transport_status',
  'record_digest',
]);

/** Retained control evidence failed its strict immutable contract. */
export class ApplicationStateSnapshotControlRecordError extends Error {
  /** @param {string} transferId @param {string} reason @param {{cause?: unknown}} [options] */
  constructor(transferId, reason, options = {}) {
    super(
      `Application-state snapshot control record is invalid: ${transferId} (${reason})`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'ApplicationStateSnapshotControlRecordError';
    this.code = 'WHARFIE_APPLICATION_STATE_SNAPSHOT_CONTROL_RECORD_INVALID';
    this.transferId = transferId;
    this.reason = reason;
  }
}

/** One transfer already retains different publication evidence. */
export class ApplicationStateSnapshotPublicationConflictError extends Error {
  /** @param {string} transferId @param {{cause?: unknown}} [options] */
  constructor(transferId, options = {}) {
    super(
      `Application-state snapshot publication conflicts with retained evidence: ${transferId}`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'ApplicationStateSnapshotPublicationConflictError';
    this.code = 'WHARFIE_APPLICATION_STATE_SNAPSHOT_PUBLICATION_CONFLICT';
    this.transferId = transferId;
  }
}

/** Activation cannot proceed without exact immutable publication evidence. */
export class ApplicationStateSnapshotPublicationMissingError extends Error {
  /** @param {string} transferId */
  constructor(transferId) {
    super(
      `Application-state snapshot publication evidence is missing: ${transferId}`,
    );
    this.name = 'ApplicationStateSnapshotPublicationMissingError';
    this.code = 'WHARFIE_APPLICATION_STATE_SNAPSHOT_PUBLICATION_MISSING';
    this.transferId = transferId;
  }
}

/** A transfer/snapshot is already claimed by a different physical replica. */
export class ApplicationStateSnapshotActivationConflictError extends Error {
  /** @param {string} transferId @param {{cause?: unknown}} [options] */
  constructor(transferId, options = {}) {
    super(
      `Application-state snapshot activation conflicts with the retained claim: ${transferId}`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'ApplicationStateSnapshotActivationConflictError';
    this.code = 'WHARFIE_APPLICATION_STATE_SNAPSHOT_ACTIVATION_CONFLICT';
    this.transferId = transferId;
  }
}

/** A failed write and failed strong readback left its outcome unprovable. */
export class ApplicationStateSnapshotControlOutcomeUnknownError extends Error {
  /** @param {string} action @param {string} transferId @param {unknown} cause */
  constructor(action, transferId, cause) {
    super(
      `Application-state snapshot ${action} outcome is unknown: ${transferId}`,
      { cause },
    );
    this.name = 'ApplicationStateSnapshotControlOutcomeUnknownError';
    this.code = 'WHARFIE_APPLICATION_STATE_SNAPSHOT_CONTROL_OUTCOME_UNKNOWN';
    this.action = action;
    this.transferId = transferId;
  }
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

/** @param {unknown} value @param {Set<string>} keys @param {string} label */
function exactObject(value, keys, label) {
  const object = cloneBoundedJsonObject(
    value,
    APPLICATION_STATE_SNAPSHOT_CONTROL_MAX_RECORD_BYTES,
    label,
  );
  if (
    Object.keys(object).length !== keys.size ||
    Object.keys(object).some((key) => !keys.has(key))
  ) {
    throw new TypeError(`${label} has unsupported or missing fields.`);
  }
  return object;
}

/** @param {unknown} left @param {unknown} right */
function sameCanonicalValue(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/** @param {unknown} left @param {unknown} right */
function sameAuthority(left, right) {
  const first = assertCoordinatorAuthorityToken(left);
  const second = assertCoordinatorAuthorityToken(right);
  return sameCanonicalValue(first, second);
}

/** @param {unknown} error */
function isConditionalFailure(error) {
  return (
    error instanceof Error && error.name === 'ConditionalCheckFailedException'
  );
}

/**
 * Resolve the table-global partition for one transfer. The application and
 * snapshot are deliberately not part of this key: reusing a transfer ID for
 * any other scope must contend with the same immutable records.
 * @param {unknown} transferId
 */
export function getApplicationStateSnapshotControlPartitionKey(transferId) {
  assertApplicationStateSnapshotTransferId(transferId);
  return createCanonicalJsonSha256Id({
    domain: APPLICATION_STATE_SNAPSHOT_CONTROL_PARTITION_DOMAIN,
    prefix: APPLICATION_STATE_SNAPSHOT_CONTROL_PARTITION_PREFIX,
    value: {
      schemaVersion: APPLICATION_STATE_SNAPSHOT_CONTROL_SCHEMA_VERSION,
      transferId,
    },
    valuePath: 'application-state snapshot control partition',
  });
}

/** @param {ReturnType<typeof normalizeApplicationStateSnapshotTransport>} transport */
function transportScope(transport) {
  return Object.freeze({
    appId: transport.snapshot.destination.configuration.namespace,
    transferId: transport.snapshot.transferId,
    snapshotId: transport.snapshot.snapshotId,
  });
}

/** @param {Record<string, any>} value */
function publicationFields(value) {
  return deepFreeze({
    [KEY_NAME]: getApplicationStateSnapshotControlPartitionKey(
      value.transferId,
    ),
    [SORT_KEY_NAME]: APPLICATION_STATE_SNAPSHOT_PUBLICATION_SORT_KEY,
    schema_version: APPLICATION_STATE_SNAPSHOT_CONTROL_SCHEMA_VERSION,
    record_kind: APPLICATION_STATE_SNAPSHOT_PUBLICATION_RECORD_KIND,
    app_id: value.appId,
    transfer_id: value.transferId,
    snapshot_id: value.snapshotId,
    transport: value.transport,
    source_barrier: value.sourceBarrier,
    source_authority: value.sourceAuthority,
  });
}

/** @param {Record<string, any>} input */
function createPublicationEvidence(input) {
  const fields = publicationFields(input);
  const publicationId = createCanonicalJsonSha256Id({
    domain: APPLICATION_STATE_SNAPSHOT_PUBLICATION_DOMAIN,
    prefix: APPLICATION_STATE_SNAPSHOT_PUBLICATION_PREFIX,
    value: fields,
    valuePath: 'application-state snapshot publication evidence',
  });
  return deepFreeze({
    schemaVersion: APPLICATION_STATE_SNAPSHOT_CONTROL_SCHEMA_VERSION,
    kind: APPLICATION_STATE_SNAPSHOT_PUBLICATION_KIND,
    appId: input.appId,
    transferId: input.transferId,
    snapshotId: input.snapshotId,
    transport: input.transport,
    sourceBarrier: input.sourceBarrier,
    sourceAuthority: input.sourceAuthority,
    publicationId,
  });
}

/** @param {ReturnType<typeof createPublicationEvidence>} publication */
function createPublicationRecord(publication) {
  return deepFreeze({
    ...publicationFields(publication),
    record_digest: publication.publicationId,
  });
}

/** @param {unknown} value */
function normalizePublicationInput(value) {
  const input = exactObject(
    value,
    new Set(['transport', 'sourceBarrier', 'sourceAuthority']),
    'application-state snapshot publication input',
  );
  const transport = normalizeApplicationStateSnapshotTransport(input.transport);
  const scope = transportScope(transport);
  const sourceBarrier = assertCoordinatorQuiescenceBarrierSnapshot(
    input.sourceBarrier,
    'application-state snapshot publication sourceBarrier',
  );
  const sourceAuthority = assertCoordinatorAuthorityToken(
    input.sourceAuthority,
    'application-state snapshot publication sourceAuthority',
  );
  if (
    sourceBarrier.state !== CoordinatorQuiescenceBarrierState.CLOSED ||
    sourceBarrier.appId !== scope.appId ||
    sourceAuthority.appId !== scope.appId ||
    !sameAuthority(sourceBarrier.authority, sourceAuthority) ||
    !sameCanonicalValue(
      sourceBarrier,
      transport.snapshot.checkpoint.sourceBarrier,
    )
  ) {
    throw new TypeError(
      'Application-state snapshot publication must match one exact CLOSED source barrier and source authority.',
    );
  }
  return createPublicationEvidence({
    ...scope,
    transport,
    sourceBarrier,
    sourceAuthority,
  });
}

/** @param {unknown} raw @param {string} expectedTransferId */
function normalizePublicationRecord(raw, expectedTransferId) {
  try {
    const record = exactObject(
      raw,
      PUBLICATION_RECORD_KEYS,
      'application-state snapshot publication record',
    );
    assertDomainSeparatedSha256Id(
      record.record_digest,
      APPLICATION_STATE_SNAPSHOT_PUBLICATION_PREFIX,
      'application-state snapshot publication record.record_digest',
    );
    const publication = normalizePublicationInput({
      transport: record.transport,
      sourceBarrier: record.source_barrier,
      sourceAuthority: record.source_authority,
    });
    const expected = createPublicationRecord(publication);
    if (
      publication.transferId !== expectedTransferId ||
      !sameCanonicalValue(record, expected)
    ) {
      throw new TypeError(
        'application-state snapshot publication record failed verification.',
      );
    }
    return publication;
  } catch (cause) {
    if (cause instanceof ApplicationStateSnapshotControlRecordError) {
      throw cause;
    }
    throw new ApplicationStateSnapshotControlRecordError(
      expectedTransferId,
      'publication shape',
      { cause },
    );
  }
}

/** @param {Record<string, any>} value */
function activationFields(value) {
  return deepFreeze({
    [KEY_NAME]: getApplicationStateSnapshotControlPartitionKey(
      value.transferId,
    ),
    [SORT_KEY_NAME]: APPLICATION_STATE_SNAPSHOT_ACTIVATION_SORT_KEY,
    schema_version: APPLICATION_STATE_SNAPSHOT_CONTROL_SCHEMA_VERSION,
    record_kind: APPLICATION_STATE_SNAPSHOT_ACTIVATION_RECORD_KIND,
    app_id: value.appId,
    transfer_id: value.transferId,
    snapshot_id: value.snapshotId,
    publication_id: value.publicationId,
    transport: value.transport,
    replacement_authority: value.replacementAuthority,
    replacement_barrier: value.replacementBarrier,
    replica_id: value.replicaId,
    transport_status: value.transportStatus,
  });
}

/** @param {Record<string, any>} input */
function createActivationClaim(input) {
  const fields = activationFields(input);
  const activationId = createCanonicalJsonSha256Id({
    domain: APPLICATION_STATE_SNAPSHOT_ACTIVATION_DOMAIN,
    prefix: APPLICATION_STATE_SNAPSHOT_ACTIVATION_PREFIX,
    value: fields,
    valuePath: 'application-state snapshot activation claim',
  });
  return deepFreeze({
    schemaVersion: APPLICATION_STATE_SNAPSHOT_CONTROL_SCHEMA_VERSION,
    kind: APPLICATION_STATE_SNAPSHOT_ACTIVATION_KIND,
    appId: input.appId,
    transferId: input.transferId,
    snapshotId: input.snapshotId,
    publicationId: input.publicationId,
    transport: input.transport,
    replacementAuthority: input.replacementAuthority,
    replacementBarrier: input.replacementBarrier,
    replicaId: input.replicaId,
    transportStatus: input.transportStatus,
    activationId,
  });
}

/** @param {ReturnType<typeof createActivationClaim>} claim */
function createActivationRecord(claim) {
  return deepFreeze({
    ...activationFields(claim),
    record_digest: claim.activationId,
  });
}

/** @param {unknown} value @param {ReturnType<typeof createPublicationEvidence>} publication */
function normalizeActivationInput(value, publication) {
  const input = exactObject(
    value,
    new Set([
      'transport',
      'replacementAuthority',
      'replacementBarrier',
      'replicaId',
      'transportStatus',
    ]),
    'application-state snapshot activation input',
  );
  const transport = normalizeApplicationStateSnapshotTransport(input.transport);
  const scope = transportScope(transport);
  const replacementAuthority = assertCoordinatorAuthorityToken(
    input.replacementAuthority,
    'application-state snapshot activation replacementAuthority',
  );
  const replacementBarrier = assertCoordinatorQuiescenceBarrierSnapshot(
    input.replacementBarrier,
    'application-state snapshot activation replacementBarrier',
  );
  assertDomainSeparatedSha256Id(
    input.replicaId,
    'wasr1',
    'application-state snapshot activation replicaId',
  );
  const replicaId = input.replicaId;
  const transportStatus = input.transportStatus;
  if (
    replacementAuthority.appId !== scope.appId ||
    replacementAuthority.epoch <= publication.sourceAuthority.epoch ||
    replacementBarrier.state !== CoordinatorQuiescenceBarrierState.CLOSED ||
    replacementBarrier.appId !== scope.appId ||
    !sameAuthority(replacementBarrier.authority, replacementAuthority) ||
    replacementBarrier.version < publication.sourceBarrier.version ||
    (transportStatus !== APPLICATION_STATE_TRANSPORT_RETAINED_STATUS &&
      transportStatus !== APPLICATION_STATE_TRANSPORT_HYDRATED_STATUS)
  ) {
    throw new TypeError(
      'Application-state snapshot activation requires a strictly newer replacement authority in the snapshot application scope.',
    );
  }
  return createActivationClaim({
    ...scope,
    publicationId: publication.publicationId,
    transport,
    replacementAuthority,
    replacementBarrier,
    replicaId,
    transportStatus,
  });
}

/** @param {unknown} raw @param {string} expectedTransferId */
function normalizeActivationRecord(raw, expectedTransferId) {
  try {
    const record = exactObject(
      raw,
      ACTIVATION_RECORD_KEYS,
      'application-state snapshot activation record',
    );
    assertDomainSeparatedSha256Id(
      record.record_digest,
      APPLICATION_STATE_SNAPSHOT_ACTIVATION_PREFIX,
      'application-state snapshot activation record.record_digest',
    );
    assertDomainSeparatedSha256Id(
      record.publication_id,
      APPLICATION_STATE_SNAPSHOT_PUBLICATION_PREFIX,
      'application-state snapshot activation record.publication_id',
    );
    const transport = normalizeApplicationStateSnapshotTransport(
      record.transport,
    );
    const scope = transportScope(transport);
    const replacementAuthority = assertCoordinatorAuthorityToken(
      record.replacement_authority,
      'application-state snapshot activation record.replacement_authority',
    );
    const replacementBarrier = assertCoordinatorQuiescenceBarrierSnapshot(
      record.replacement_barrier,
      'application-state snapshot activation record.replacement_barrier',
    );
    assertDomainSeparatedSha256Id(
      record.replica_id,
      'wasr1',
      'application-state snapshot activation record.replica_id',
    );
    const replicaId = record.replica_id;
    const transportStatus = record.transport_status;
    if (
      scope.transferId !== expectedTransferId ||
      replacementAuthority.appId !== scope.appId ||
      replacementAuthority.epoch <=
        transport.snapshot.checkpoint.sourceBarrier.authority.epoch ||
      replacementBarrier.state !== CoordinatorQuiescenceBarrierState.CLOSED ||
      replacementBarrier.appId !== scope.appId ||
      !sameAuthority(replacementBarrier.authority, replacementAuthority) ||
      replacementBarrier.version <
        transport.snapshot.checkpoint.sourceBarrier.version ||
      (transportStatus !== APPLICATION_STATE_TRANSPORT_RETAINED_STATUS &&
        transportStatus !== APPLICATION_STATE_TRANSPORT_HYDRATED_STATUS)
    ) {
      throw new TypeError(
        'application-state snapshot activation record crosses scope.',
      );
    }
    const claim = createActivationClaim({
      ...scope,
      publicationId: record.publication_id,
      transport,
      replacementAuthority,
      replacementBarrier,
      replicaId,
      transportStatus,
    });
    if (!sameCanonicalValue(record, createActivationRecord(claim))) {
      throw new TypeError(
        'application-state snapshot activation record failed verification.',
      );
    }
    return claim;
  } catch (cause) {
    if (cause instanceof ApplicationStateSnapshotControlRecordError) {
      throw cause;
    }
    throw new ApplicationStateSnapshotControlRecordError(
      expectedTransferId,
      'activation shape',
      { cause },
    );
  }
}

/** @param {ReturnType<typeof createPublicationEvidence>} publication */
function createPublicationFence(publication) {
  return deepFreeze({
    keyName: KEY_NAME,
    keyValue: getApplicationStateSnapshotControlPartitionKey(
      publication.transferId,
    ),
    sortKeyName: SORT_KEY_NAME,
    sortKeyValue: APPLICATION_STATE_SNAPSHOT_PUBLICATION_SORT_KEY,
    conditions: [
      {
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'schema_version',
        propertyValue: APPLICATION_STATE_SNAPSHOT_CONTROL_SCHEMA_VERSION,
      },
      {
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'record_kind',
        propertyValue: APPLICATION_STATE_SNAPSHOT_PUBLICATION_RECORD_KIND,
      },
      {
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'app_id',
        propertyValue: publication.appId,
      },
      {
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'transfer_id',
        propertyValue: publication.transferId,
      },
      {
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'snapshot_id',
        propertyValue: publication.snapshotId,
      },
      {
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'record_digest',
        propertyValue: publication.publicationId,
      },
    ],
  });
}

/** @param {ReturnType<typeof createActivationClaim>} claim */
function createActivationFence(claim) {
  return deepFreeze({
    keyName: KEY_NAME,
    keyValue: getApplicationStateSnapshotControlPartitionKey(claim.transferId),
    sortKeyName: SORT_KEY_NAME,
    sortKeyValue: APPLICATION_STATE_SNAPSHOT_ACTIVATION_SORT_KEY,
    conditions: [
      {
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'schema_version',
        propertyValue: APPLICATION_STATE_SNAPSHOT_CONTROL_SCHEMA_VERSION,
      },
      {
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'record_kind',
        propertyValue: APPLICATION_STATE_SNAPSHOT_ACTIVATION_RECORD_KIND,
      },
      {
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'app_id',
        propertyValue: claim.appId,
      },
      {
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'transfer_id',
        propertyValue: claim.transferId,
      },
      {
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'snapshot_id',
        propertyValue: claim.snapshotId,
      },
      {
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'publication_id',
        propertyValue: claim.publicationId,
      },
      {
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'record_digest',
        propertyValue: claim.activationId,
      },
    ],
  });
}

/**
 * Create the internal immutable evidence store in the execution-ledger
 * control table.
 * @param {{db: import('../lib/db/base.js').DBClient, tableName: string}} options
 */
export function createApplicationStateSnapshotControlStore(options) {
  if (
    !options?.db ||
    typeof options.db.get !== 'function' ||
    typeof options.db.transactionWrite !== 'function'
  ) {
    throw new TypeError(
      'createApplicationStateSnapshotControlStore requires a DB client with get and transactionWrite.',
    );
  }
  if (typeof options.tableName !== 'string' || !options.tableName.trim()) {
    throw new TypeError(
      'createApplicationStateSnapshotControlStore requires a tableName.',
    );
  }
  const db = options.db;
  const tableName = options.tableName.trim();

  /** @param {string} transferId */
  async function readPublication(transferId) {
    const raw = await db.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: getApplicationStateSnapshotControlPartitionKey(transferId),
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: APPLICATION_STATE_SNAPSHOT_PUBLICATION_SORT_KEY,
      consistentRead: true,
    });
    return raw ? normalizePublicationRecord(raw, transferId) : null;
  }

  /** @param {string} transferId */
  async function readActivation(transferId) {
    const raw = await db.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: getApplicationStateSnapshotControlPartitionKey(transferId),
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: APPLICATION_STATE_SNAPSHOT_ACTIVATION_SORT_KEY,
      consistentRead: true,
    });
    return raw ? normalizeActivationRecord(raw, transferId) : null;
  }

  /** @param {ReturnType<typeof createPublicationEvidence> | null} retained @param {ReturnType<typeof createPublicationEvidence>} desired */
  function assertPublication(retained, desired) {
    if (retained && !sameCanonicalValue(retained, desired)) {
      throw new ApplicationStateSnapshotPublicationConflictError(
        desired.transferId,
      );
    }
    return retained;
  }

  /** @param {ReturnType<typeof createActivationClaim> | null} retained @param {ReturnType<typeof createActivationClaim>} desired */
  function assertActivation(retained, desired) {
    if (retained && !sameCanonicalValue(retained, desired)) {
      throw new ApplicationStateSnapshotActivationConflictError(
        desired.transferId,
      );
    }
    return retained;
  }

  /** @param {ReturnType<typeof createPublicationEvidence>} publication */
  async function assertPublicationReplayFences(publication) {
    try {
      await db.transactionWrite({
        tableName,
        conditionChecks: [
          createCoordinatorAuthorityFence(publication.sourceAuthority),
          createCoordinatorQuiescenceBarrierFence(publication.sourceBarrier),
          createPublicationFence(publication),
        ],
      });
    } catch (cause) {
      if (isConditionalFailure(cause)) {
        throw new ApplicationStateSnapshotPublicationConflictError(
          publication.transferId,
          { cause },
        );
      }
      throw new ApplicationStateSnapshotControlOutcomeUnknownError(
        'publication replay fence',
        publication.transferId,
        cause,
      );
    }
  }

  /** @param {ReturnType<typeof createActivationClaim>} claim @param {ReturnType<typeof createPublicationEvidence>} publication */
  async function assertActivationReplayFences(claim, publication) {
    try {
      await db.transactionWrite({
        tableName,
        conditionChecks: [
          createCoordinatorAuthorityFence(claim.replacementAuthority),
          createCoordinatorQuiescenceBarrierFence(claim.replacementBarrier),
          createPublicationFence(publication),
          createActivationFence(claim),
        ],
      });
    } catch (cause) {
      if (isConditionalFailure(cause)) {
        throw new ApplicationStateSnapshotActivationConflictError(
          claim.transferId,
          { cause },
        );
      }
      throw new ApplicationStateSnapshotControlOutcomeUnknownError(
        'activation replay fence',
        claim.transferId,
        cause,
      );
    }
  }

  /** @param {unknown} input */
  async function recordPublication(input) {
    const desired = normalizePublicationInput(input);
    const existing = assertPublication(
      await readPublication(desired.transferId),
      desired,
    );
    if (existing) {
      await assertPublicationReplayFences(desired);
      return deepFreeze({ applied: false, publication: existing });
    }

    /** @type {unknown} */
    let writeError;
    try {
      await db.transactionWrite({
        tableName,
        conditionChecks: [
          createCoordinatorAuthorityFence(desired.sourceAuthority),
          createCoordinatorQuiescenceBarrierFence(desired.sourceBarrier),
        ],
        putRequests: [
          {
            keyName: KEY_NAME,
            sortKeyName: SORT_KEY_NAME,
            record: createPublicationRecord(desired),
            conditions: [
              {
                conditionType: CONDITION_TYPE.NOT_EXISTS,
                propertyName: SORT_KEY_NAME,
              },
            ],
          },
        ],
      });
    } catch (error) {
      writeError = error;
    }
    if (writeError === undefined) {
      return deepFreeze({ applied: true, publication: desired });
    }

    /** @type {ReturnType<typeof createPublicationEvidence> | null} */
    let retained;
    try {
      retained = assertPublication(
        await readPublication(desired.transferId),
        desired,
      );
    } catch (readError) {
      if (
        readError instanceof ApplicationStateSnapshotPublicationConflictError ||
        readError instanceof ApplicationStateSnapshotControlRecordError
      ) {
        throw readError;
      }
      throw new ApplicationStateSnapshotControlOutcomeUnknownError(
        'publication',
        desired.transferId,
        new AggregateError([writeError, readError]),
      );
    }
    if (retained) {
      await assertPublicationReplayFences(retained);
      return deepFreeze({
        applied: !isConditionalFailure(writeError),
        publication: retained,
      });
    }
    if (isConditionalFailure(writeError)) {
      throw new ApplicationStateSnapshotPublicationConflictError(
        desired.transferId,
        { cause: writeError },
      );
    }
    throw new ApplicationStateSnapshotControlOutcomeUnknownError(
      'publication',
      desired.transferId,
      writeError,
    );
  }

  /** @param {unknown} input @param {{requireExisting?: boolean}} [options] */
  async function claimActivation(input, options = {}) {
    const replay = exactObject(
      options,
      new Set(
        Object.prototype.hasOwnProperty.call(options, 'requireExisting')
          ? ['requireExisting']
          : [],
      ),
      'application-state snapshot activation claim options',
    );
    if (
      Object.prototype.hasOwnProperty.call(replay, 'requireExisting') &&
      typeof replay.requireExisting !== 'boolean'
    ) {
      throw new TypeError(
        'application-state snapshot activation requireExisting must be boolean.',
      );
    }
    const requireExisting = replay.requireExisting === true;
    const candidate = exactObject(
      input,
      new Set([
        'transport',
        'replacementAuthority',
        'replacementBarrier',
        'replicaId',
        'transportStatus',
      ]),
      'application-state snapshot activation input',
    );
    const transport = normalizeApplicationStateSnapshotTransport(
      candidate.transport,
    );
    const transferId = transport.snapshot.transferId;
    const [publication, retainedBefore] = await Promise.all([
      readPublication(transferId),
      readActivation(transferId),
    ]);
    if (!publication) {
      throw new ApplicationStateSnapshotPublicationMissingError(transferId);
    }
    if (!sameCanonicalValue(publication.transport, transport)) {
      if (retainedBefore) {
        throw new ApplicationStateSnapshotActivationConflictError(transferId);
      }
      throw new ApplicationStateSnapshotPublicationConflictError(transferId);
    }
    const desired = normalizeActivationInput(candidate, publication);
    if (requireExisting && !retainedBefore) {
      throw new ApplicationStateSnapshotActivationConflictError(transferId);
    }
    if (
      retainedBefore &&
      retainedBefore.publicationId !== publication.publicationId
    ) {
      throw new ApplicationStateSnapshotControlRecordError(
        transferId,
        'activation publication link',
      );
    }
    const existing = assertActivation(retainedBefore, desired);
    if (existing) {
      await assertActivationReplayFences(desired, publication);
      return deepFreeze({ applied: false, claim: existing });
    }

    /** @type {unknown} */
    let writeError;
    try {
      await db.transactionWrite({
        tableName,
        conditionChecks: [
          createCoordinatorAuthorityFence(desired.replacementAuthority),
          createCoordinatorQuiescenceBarrierFence(desired.replacementBarrier),
          createPublicationFence(publication),
        ],
        putRequests: [
          {
            keyName: KEY_NAME,
            sortKeyName: SORT_KEY_NAME,
            record: createActivationRecord(desired),
            conditions: [
              {
                conditionType: CONDITION_TYPE.NOT_EXISTS,
                propertyName: SORT_KEY_NAME,
              },
            ],
          },
        ],
      });
    } catch (error) {
      writeError = error;
    }
    if (writeError === undefined) {
      return deepFreeze({ applied: true, claim: desired });
    }

    /** @type {ReturnType<typeof createActivationClaim> | null} */
    let retained;
    try {
      retained = assertActivation(
        await readActivation(desired.transferId),
        desired,
      );
    } catch (readError) {
      if (
        readError instanceof ApplicationStateSnapshotActivationConflictError ||
        readError instanceof ApplicationStateSnapshotControlRecordError
      ) {
        throw readError;
      }
      throw new ApplicationStateSnapshotControlOutcomeUnknownError(
        'activation',
        desired.transferId,
        new AggregateError([writeError, readError]),
      );
    }
    if (retained) {
      await assertActivationReplayFences(retained, publication);
      return deepFreeze({
        applied: !isConditionalFailure(writeError),
        claim: retained,
      });
    }
    if (isConditionalFailure(writeError)) {
      throw new ApplicationStateSnapshotActivationConflictError(
        desired.transferId,
        { cause: writeError },
      );
    }
    throw new ApplicationStateSnapshotControlOutcomeUnknownError(
      'activation',
      desired.transferId,
      writeError,
    );
  }

  /** @param {unknown} input */
  async function getPublication(input) {
    const value = exactObject(
      input,
      new Set(['transferId']),
      'applicationStateSnapshotControl.getPublication',
    );
    assertApplicationStateSnapshotTransferId(value.transferId);
    return await readPublication(value.transferId);
  }

  /** @param {unknown} input */
  async function getActivationClaim(input) {
    const value = exactObject(
      input,
      new Set(['transferId']),
      'applicationStateSnapshotControl.getActivationClaim',
    );
    assertApplicationStateSnapshotTransferId(value.transferId);
    const [publication, claim] = await Promise.all([
      readPublication(value.transferId),
      readActivation(value.transferId),
    ]);
    if (
      claim &&
      (!publication ||
        claim.publicationId !== publication.publicationId ||
        !sameCanonicalValue(claim.transport, publication.transport))
    ) {
      throw new ApplicationStateSnapshotControlRecordError(
        value.transferId,
        'activation publication link',
      );
    }
    return claim;
  }

  return Object.freeze({
    getPublication,
    recordPublication,
    getActivationClaim,
    claimActivation,
  });
}

export default createApplicationStateSnapshotControlStore;
