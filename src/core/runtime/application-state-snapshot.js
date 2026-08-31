/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- Strict checkpoint records keep their exact shapes inline. */

import {
  CoordinatorQuiescenceBarrierState,
  assertCoordinatorQuiescenceBarrierSnapshot,
} from '../lib/db/tables/coordinator-quiescence-barrier.js';
import { createApplicationStateCoordinatorAuthorityRecord } from '../lib/db/tables/application-state-authority.js';
import { assertCoordinatorAuthorityToken } from '../lib/db/tables/coordinator-authority.js';
import {
  assertDomainSeparatedSha256Id,
  assertSha256Base64Url,
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from './content-id.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import { normalizeApplicationStateDestination } from './effects/application-state.js';
import {
  assertSettledApplicationStateHistory,
  validateApplicationStateHistoryCheckpoint,
} from './application-state-history-checkpoint.js';
import { cloneBoundedJsonObject, cloneJsonObject } from './json-value.js';

export const APPLICATION_STATE_SNAPSHOT_REFERENCE_SCHEMA_VERSION = 1;
export const APPLICATION_STATE_SNAPSHOT_REFERENCE_KIND =
  'applicationStateSnapshotReference';
export const APPLICATION_STATE_SNAPSHOT_FORMAT = 'lmdb-data-mdb-v1';
export const APPLICATION_STATE_SNAPSHOT_ID_DOMAIN =
  'wharfie:application-state-snapshot:v1';
export const APPLICATION_STATE_SNAPSHOT_ID_PREFIX = 'wass1';
export const APPLICATION_STATE_SNAPSHOT_MAX_BYTES = 512 * 1024 * 1024;
export const APPLICATION_STATE_SNAPSHOT_TRANSFER_ID_PREFIX = 'wast1';
export const APPLICATION_STATE_SNAPSHOT_DISTRIBUTION_KIND =
  'wharfie.application-state-snapshot-distribution.v1';
export const APPLICATION_STATE_SNAPSHOT_DISTRIBUTION_ID_PREFIX = 'wasd1';
export const APPLICATION_STATE_SNAPSHOT_TRANSPORT_KIND =
  'wharfie.application-state-snapshot-transport.v1';
export const APPLICATION_STATE_SNAPSHOT_SOURCE_SEAL_KIND =
  'wharfie.application-state-snapshot-source-seal.v1';
export const APPLICATION_STATE_TRANSPORT_READINESS_SCHEMA_VERSION = 1;
export const APPLICATION_STATE_TRANSPORT_READINESS_KIND =
  'applicationStateTransportReadiness';
export const APPLICATION_STATE_TRANSPORT_RETAINED_STATUS = 'RETAINED';
export const APPLICATION_STATE_TRANSPORT_HYDRATED_STATUS = 'HYDRATED';

export const APPLICATION_STATE_SNAPSHOT_MARKER_RECORD_KIND =
  'application-state-snapshot-marker';
export const APPLICATION_STATE_SNAPSHOT_MARKER_SORT_KEY = 'checkpoint/v1';

const SNAPSHOT_REFERENCE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'snapshotId',
  'format',
  'destination',
  'transferId',
  'checkpoint',
  'digest',
  'size',
]);
const CHECKPOINT_KEYS = new Set([
  'history',
  'sourceBarrier',
  'sourceDestinationAuthorityDigest',
]);
const DIGEST_KEYS = new Set(['algorithm', 'value']);
const DISTRIBUTION_KEYS = new Set(['kind', 'distributionId', 'storeId']);
const TRANSPORT_KEYS = new Set(['kind', 'distribution', 'snapshot']);
const SOURCE_SEAL_KEYS = new Set([
  'schemaVersion',
  'kind',
  'distribution',
  'destination',
  'transferId',
  'checkpoint',
]);
const READINESS_KEYS = new Set([
  'schemaVersion',
  'kind',
  'status',
  'destination',
  'transport',
  'coordinatorAuthority',
  'destinationAuthorityDigest',
]);
const MARKER_KEYS = new Set([
  'resource_id',
  'sort_key',
  'record_kind',
  'schema_version',
  'store_id',
  'namespace',
  'transfer_id',
  'history_digest',
  'barrier_version',
  'barrier_authority_id',
  'destination_authority_digest',
  'record_digest',
]);

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} label */
function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value);
  if (actual.length !== keys.size || actual.some((key) => !keys.has(key))) {
    throw new TypeError(`${label} has unsupported or missing fields.`);
  }
}

/** @param {unknown} value @param {string} label @returns {Buffer} */
function copySnapshotBytes(value, label) {
  let byteLength;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    byteLength = value.byteLength;
  } else if (value instanceof ArrayBuffer) {
    byteLength = value.byteLength;
  } else {
    throw new TypeError(`${label} must be exact bytes.`);
  }
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 1 ||
    byteLength > APPLICATION_STATE_SNAPSHOT_MAX_BYTES
  ) {
    throw new RangeError(
      `${label} must contain between 1 and ${APPLICATION_STATE_SNAPSHOT_MAX_BYTES} bytes.`,
    );
  }
  return value instanceof ArrayBuffer
    ? Buffer.from(new Uint8Array(value))
    : Buffer.from(value);
}

/** @param {unknown} value @param {string} label */
function normalizeDigest(value, label) {
  const digest = cloneJsonObject(value, label);
  assertExactKeys(digest, DIGEST_KEYS, label);
  if (digest.algorithm !== 'sha256') {
    throw new TypeError(`${label}.algorithm must be 'sha256'.`);
  }
  assertSha256Base64Url(digest.value, `${label}.value`);
  return Object.freeze({ algorithm: 'sha256', value: digest.value });
}

/** @param {unknown} value @param {string} label */
function normalizeAuthority(value, label) {
  const authority = assertCoordinatorAuthorityToken(value, label);
  return Object.freeze({
    schemaVersion: authority.schemaVersion,
    appId: authority.appId,
    coordinatorId: authority.coordinatorId,
    authorityId: authority.authorityId,
    epoch: authority.epoch,
  });
}

/** @param {unknown} value @param {string} [label] */
export function assertApplicationStateSnapshotTransferId(
  value,
  label = 'application-state snapshot transferId',
) {
  return assertDomainSeparatedSha256Id(
    value,
    APPLICATION_STATE_SNAPSHOT_TRANSFER_ID_PREFIX,
    label,
  );
}

/** @param {unknown} value @param {string} [label] */
export function assertApplicationStateSnapshotDistributionId(
  value,
  label = 'application-state snapshot distributionId',
) {
  return assertDomainSeparatedSha256Id(
    value,
    APPLICATION_STATE_SNAPSHOT_DISTRIBUTION_ID_PREFIX,
    label,
  );
}

/**
 * @param {unknown} value
 * @param {string} [label]
 * @returns {Readonly<{kind: 'wharfie.application-state-snapshot-distribution.v1', distributionId: string, storeId: string}>}
 */
export function normalizeApplicationStateSnapshotDistributionIdentity(
  value,
  label = 'application-state snapshot distribution identity',
) {
  const identity = cloneJsonObject(value, label);
  assertExactKeys(identity, DISTRIBUTION_KEYS, label);
  if (identity.kind !== APPLICATION_STATE_SNAPSHOT_DISTRIBUTION_KIND) {
    throw new TypeError(
      `${label}.kind must be '${APPLICATION_STATE_SNAPSHOT_DISTRIBUTION_KIND}'.`,
    );
  }
  assertApplicationStateSnapshotDistributionId(
    identity.distributionId,
    `${label}.distributionId`,
  );
  assertDomainSeparatedSha256Id(identity.storeId, 'was', `${label}.storeId`);
  return Object.freeze({
    kind: APPLICATION_STATE_SNAPSHOT_DISTRIBUTION_KIND,
    distributionId: identity.distributionId,
    storeId: identity.storeId,
  });
}

/** @param {unknown} value @param {string} label */
function normalizeCheckpoint(value, label) {
  const checkpoint = cloneJsonObject(value, label);
  assertExactKeys(checkpoint, CHECKPOINT_KEYS, label);
  const history = validateApplicationStateHistoryCheckpoint(
    checkpoint.history,
    `${label}.history`,
  );
  assertSettledApplicationStateHistory(history);
  const sourceBarrier = assertCoordinatorQuiescenceBarrierSnapshot(
    checkpoint.sourceBarrier,
    `${label}.sourceBarrier`,
  );
  if (sourceBarrier.state !== CoordinatorQuiescenceBarrierState.CLOSED) {
    throw new TypeError(`${label}.sourceBarrier must be CLOSED.`);
  }
  assertDomainSeparatedSha256Id(
    checkpoint.sourceDestinationAuthorityDigest,
    'waaf1',
    `${label}.sourceDestinationAuthorityDigest`,
  );
  return deepFreeze({
    history,
    sourceBarrier,
    sourceDestinationAuthorityDigest:
      checkpoint.sourceDestinationAuthorityDigest,
  });
}

/** @param {Readonly<Record<string, any>>} descriptor */
function createSnapshotId(descriptor) {
  return createCanonicalJsonSha256Id({
    domain: APPLICATION_STATE_SNAPSHOT_ID_DOMAIN,
    prefix: APPLICATION_STATE_SNAPSHOT_ID_PREFIX,
    value: descriptor,
    valuePath: 'application-state snapshot descriptor',
  });
}

/**
 * @param {{bytes: unknown, destination: unknown, transferId: unknown, history: unknown, closedBarrier: unknown, sourceDestinationAuthorityDigest: unknown}} options
 */
export function createApplicationStateSnapshotReference(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Application-state snapshot options must be an object.',
    );
  }
  const candidate = /** @type {Record<string, unknown>} */ (options);
  assertExactKeys(
    candidate,
    new Set([
      'bytes',
      'destination',
      'transferId',
      'history',
      'closedBarrier',
      'sourceDestinationAuthorityDigest',
    ]),
    'application-state snapshot options',
  );
  const bytes = copySnapshotBytes(
    candidate.bytes,
    'application-state snapshot',
  );
  const destination = normalizeApplicationStateDestination(
    candidate.destination,
  );
  if (destination.configuration.provider !== 'lmdb') {
    throw new TypeError(
      'Application-state snapshots require an LMDB destination.',
    );
  }
  assertApplicationStateSnapshotTransferId(candidate.transferId);
  const checkpoint = normalizeCheckpoint(
    {
      history: candidate.history,
      sourceBarrier: candidate.closedBarrier,
      sourceDestinationAuthorityDigest:
        candidate.sourceDestinationAuthorityDigest,
    },
    'application-state snapshot checkpoint',
  );
  if (
    checkpoint.history.appId !== destination.configuration.namespace ||
    checkpoint.sourceBarrier.appId !== destination.configuration.namespace
  ) {
    throw new TypeError(
      'Application-state snapshot history, barrier, and destination must share one application scope.',
    );
  }
  const expectedSourceAuthority =
    createApplicationStateCoordinatorAuthorityRecord({
      storeId: destination.configuration.storeId,
      namespace: destination.configuration.namespace,
      authority: checkpoint.sourceBarrier.authority,
    });
  if (
    checkpoint.sourceDestinationAuthorityDigest !==
    expectedSourceAuthority.record_digest
  ) {
    throw new TypeError(
      'Application-state snapshot source authority digest does not match its closed barrier.',
    );
  }
  const digest = Object.freeze({
    algorithm: 'sha256',
    value: sha256Base64Url(bytes, 'application-state snapshot'),
  });
  const descriptor = deepFreeze({
    schemaVersion: APPLICATION_STATE_SNAPSHOT_REFERENCE_SCHEMA_VERSION,
    kind: APPLICATION_STATE_SNAPSHOT_REFERENCE_KIND,
    format: APPLICATION_STATE_SNAPSHOT_FORMAT,
    destination,
    transferId: candidate.transferId,
    checkpoint,
    digest,
    size: bytes.byteLength,
  });
  return deepFreeze({
    ...descriptor,
    snapshotId: createSnapshotId(descriptor),
  });
}

/** @param {unknown} value @param {string} [label] */
export function validateApplicationStateSnapshotReference(
  value,
  label = 'application-state snapshot reference',
) {
  const reference = cloneBoundedJsonObject(value, 128 * 1024, label);
  assertExactKeys(reference, SNAPSHOT_REFERENCE_KEYS, label);
  if (
    reference.schemaVersion !==
      APPLICATION_STATE_SNAPSHOT_REFERENCE_SCHEMA_VERSION ||
    reference.kind !== APPLICATION_STATE_SNAPSHOT_REFERENCE_KIND ||
    reference.format !== APPLICATION_STATE_SNAPSHOT_FORMAT
  ) {
    throw new TypeError(`${label} has an unsupported schema, kind, or format.`);
  }
  assertDomainSeparatedSha256Id(
    reference.snapshotId,
    APPLICATION_STATE_SNAPSHOT_ID_PREFIX,
    `${label}.snapshotId`,
  );
  const destination = normalizeApplicationStateDestination(
    reference.destination,
  );
  if (destination.configuration.provider !== 'lmdb') {
    throw new TypeError(`${label}.destination must use LMDB.`);
  }
  assertApplicationStateSnapshotTransferId(
    reference.transferId,
    `${label}.transferId`,
  );
  const checkpoint = normalizeCheckpoint(
    reference.checkpoint,
    `${label}.checkpoint`,
  );
  if (
    checkpoint.history.appId !== destination.configuration.namespace ||
    checkpoint.sourceBarrier.appId !== destination.configuration.namespace
  ) {
    throw new TypeError(`${label} crosses application scope.`);
  }
  const expectedSourceAuthority =
    createApplicationStateCoordinatorAuthorityRecord({
      storeId: destination.configuration.storeId,
      namespace: destination.configuration.namespace,
      authority: checkpoint.sourceBarrier.authority,
    });
  if (
    checkpoint.sourceDestinationAuthorityDigest !==
    expectedSourceAuthority.record_digest
  ) {
    throw new TypeError(`${label} source authority digest is invalid.`);
  }
  const digest = normalizeDigest(reference.digest, `${label}.digest`);
  if (
    !Number.isSafeInteger(reference.size) ||
    reference.size < 1 ||
    reference.size > APPLICATION_STATE_SNAPSHOT_MAX_BYTES
  ) {
    throw new RangeError(`${label}.size is outside the supported byte range.`);
  }
  const descriptor = deepFreeze({
    schemaVersion: APPLICATION_STATE_SNAPSHOT_REFERENCE_SCHEMA_VERSION,
    kind: APPLICATION_STATE_SNAPSHOT_REFERENCE_KIND,
    format: APPLICATION_STATE_SNAPSHOT_FORMAT,
    destination,
    transferId: reference.transferId,
    checkpoint,
    digest,
    size: reference.size,
  });
  if (reference.snapshotId !== createSnapshotId(descriptor)) {
    throw new Error(`${label}.snapshotId does not match its exact descriptor.`);
  }
  return deepFreeze({ ...descriptor, snapshotId: reference.snapshotId });
}

/** @param {unknown} referenceValue @param {unknown} bytesValue @param {string} [label] */
export function verifyApplicationStateSnapshotReference(
  referenceValue,
  bytesValue,
  label = 'application-state snapshot',
) {
  const reference = validateApplicationStateSnapshotReference(referenceValue);
  const bytes = copySnapshotBytes(bytesValue, label);
  if (
    bytes.byteLength !== reference.size ||
    sha256Base64Url(bytes, label) !== reference.digest.value
  ) {
    throw new Error(
      `${label} bytes do not match the pinned snapshot reference.`,
    );
  }
  return reference;
}

/** @param {unknown} value @param {string} [label] */
export function normalizeApplicationStateSnapshotTransport(
  value,
  label = 'application-state snapshot transport',
) {
  const transport = cloneJsonObject(value, label);
  assertExactKeys(transport, TRANSPORT_KEYS, label);
  if (transport.kind !== APPLICATION_STATE_SNAPSHOT_TRANSPORT_KIND) {
    throw new TypeError(
      `${label}.kind must be '${APPLICATION_STATE_SNAPSHOT_TRANSPORT_KIND}'.`,
    );
  }
  const distribution = normalizeApplicationStateSnapshotDistributionIdentity(
    transport.distribution,
    `${label}.distribution`,
  );
  const snapshot = validateApplicationStateSnapshotReference(
    transport.snapshot,
    `${label}.snapshot`,
  );
  if (distribution.storeId !== snapshot.destination.configuration.storeId) {
    throw new TypeError(
      `${label}.distribution.storeId must match the snapshot destination storeId.`,
    );
  }
  return deepFreeze({
    kind: APPLICATION_STATE_SNAPSHOT_TRANSPORT_KIND,
    distribution,
    snapshot,
  });
}

/**
 * Create the exact pre-backup evidence persisted by the source-local mutation
 * fence. It intentionally contains no snapshot digest: the source is sealed
 * before those bytes may be read.
 * @param {{distribution: unknown, destination: unknown, transferId: unknown, checkpoint: unknown}} value
 */
export function createApplicationStateSnapshotSourceSeal(value) {
  return normalizeApplicationStateSnapshotSourceSeal({
    schemaVersion: 1,
    kind: APPLICATION_STATE_SNAPSHOT_SOURCE_SEAL_KIND,
    distribution: value?.distribution,
    destination: value?.destination,
    transferId: value?.transferId,
    checkpoint: value?.checkpoint,
  });
}

/** @param {unknown} value @param {string} [label] */
export function normalizeApplicationStateSnapshotSourceSeal(
  value,
  label = 'application-state snapshot source seal',
) {
  const seal = cloneBoundedJsonObject(value, 192 * 1024, label);
  assertExactKeys(seal, SOURCE_SEAL_KEYS, label);
  if (
    seal.schemaVersion !== 1 ||
    seal.kind !== APPLICATION_STATE_SNAPSHOT_SOURCE_SEAL_KIND
  ) {
    throw new TypeError(`${label} has an unsupported schema or kind.`);
  }
  const distribution = normalizeApplicationStateSnapshotDistributionIdentity(
    seal.distribution,
    `${label}.distribution`,
  );
  const destination = normalizeApplicationStateDestination(seal.destination);
  if (destination.configuration.provider !== 'lmdb') {
    throw new TypeError(`${label}.destination must use LMDB.`);
  }
  assertApplicationStateSnapshotTransferId(
    seal.transferId,
    `${label}.transferId`,
  );
  const checkpoint = normalizeCheckpoint(
    seal.checkpoint,
    `${label}.checkpoint`,
  );
  const { storeId, namespace } = destination.configuration;
  if (
    distribution.storeId !== storeId ||
    checkpoint.history.appId !== namespace ||
    checkpoint.sourceBarrier.appId !== namespace
  ) {
    throw new TypeError(`${label} crosses distribution or application scope.`);
  }
  const expectedSourceAuthority =
    createApplicationStateCoordinatorAuthorityRecord({
      storeId,
      namespace,
      authority: checkpoint.sourceBarrier.authority,
    });
  if (
    checkpoint.sourceDestinationAuthorityDigest !==
    expectedSourceAuthority.record_digest
  ) {
    throw new TypeError(`${label} source authority digest is invalid.`);
  }
  return deepFreeze({
    schemaVersion: 1,
    kind: APPLICATION_STATE_SNAPSHOT_SOURCE_SEAL_KIND,
    distribution,
    destination,
    transferId: seal.transferId,
    checkpoint,
  });
}

/** @param {unknown} left @param {unknown} right */
export function applicationStateSnapshotTransportMatches(left, right) {
  const first = normalizeApplicationStateSnapshotTransport(left);
  const second = normalizeApplicationStateSnapshotTransport(right);
  return (
    JSON.stringify(sortCanonicalJsonValue(first)) ===
    JSON.stringify(sortCanonicalJsonValue(second))
  );
}

/**
 * @param {{status: unknown, destination: unknown, transport: unknown, coordinatorAuthority: unknown}} value
 */
export function createApplicationStateTransportReadiness(value) {
  const status = value?.status;
  if (
    status !== APPLICATION_STATE_TRANSPORT_RETAINED_STATUS &&
    status !== APPLICATION_STATE_TRANSPORT_HYDRATED_STATUS
  ) {
    throw new TypeError(
      'Application-state transport readiness status must be RETAINED or HYDRATED.',
    );
  }
  const destination = normalizeApplicationStateDestination(value.destination);
  const transport = normalizeApplicationStateSnapshotTransport(value.transport);
  const coordinatorAuthority = normalizeAuthority(
    value.coordinatorAuthority,
    'application-state transport readiness coordinatorAuthority',
  );
  if (
    JSON.stringify(sortCanonicalJsonValue(destination)) !==
      JSON.stringify(sortCanonicalJsonValue(transport.snapshot.destination)) ||
    coordinatorAuthority.appId !== destination.configuration.namespace
  ) {
    throw new TypeError(
      'Application-state transport readiness scope does not match its destination, snapshot, and authority.',
    );
  }
  const destinationAuthorityDigest =
    createApplicationStateCoordinatorAuthorityRecord({
      storeId: destination.configuration.storeId,
      namespace: destination.configuration.namespace,
      authority: coordinatorAuthority,
    }).record_digest;
  return deepFreeze({
    schemaVersion: APPLICATION_STATE_TRANSPORT_READINESS_SCHEMA_VERSION,
    kind: APPLICATION_STATE_TRANSPORT_READINESS_KIND,
    status,
    destination,
    transport,
    coordinatorAuthority,
    destinationAuthorityDigest,
  });
}

/** @param {unknown} value @param {string} [label] */
export function validateApplicationStateTransportReadiness(
  value,
  label = 'application-state transport readiness',
) {
  const readiness = cloneBoundedJsonObject(value, 192 * 1024, label);
  assertExactKeys(readiness, READINESS_KEYS, label);
  if (
    readiness.schemaVersion !==
      APPLICATION_STATE_TRANSPORT_READINESS_SCHEMA_VERSION ||
    readiness.kind !== APPLICATION_STATE_TRANSPORT_READINESS_KIND
  ) {
    throw new TypeError(`${label} has an unsupported schema or kind.`);
  }
  const normalized = createApplicationStateTransportReadiness({
    status: readiness.status,
    destination: readiness.destination,
    transport: readiness.transport,
    coordinatorAuthority: readiness.coordinatorAuthority,
  });
  if (
    readiness.destinationAuthorityDigest !==
    normalized.destinationAuthorityDigest
  ) {
    throw new TypeError(`${label}.destinationAuthorityDigest is invalid.`);
  }
  return normalized;
}

/** @param {unknown} transferId */
export function createApplicationStateSnapshotMarkerKey(transferId) {
  assertApplicationStateSnapshotTransferId(transferId);
  return Object.freeze({
    resourceId: `application-state/v2/snapshot/${transferId}`,
    sortKey: APPLICATION_STATE_SNAPSHOT_MARKER_SORT_KEY,
  });
}

/** @param {{destination: unknown, transferId: unknown, checkpoint: unknown}} input */
export function createApplicationStateSnapshotMarkerRecord(input) {
  const destination = normalizeApplicationStateDestination(input.destination);
  if (destination.configuration.provider !== 'lmdb') {
    throw new TypeError('Application-state snapshot marker requires LMDB.');
  }
  assertApplicationStateSnapshotTransferId(input.transferId);
  const checkpoint = normalizeCheckpoint(
    input.checkpoint,
    'application-state snapshot marker checkpoint',
  );
  const { storeId, namespace } = destination.configuration;
  if (
    checkpoint.history.appId !== namespace ||
    checkpoint.sourceBarrier.appId !== namespace
  ) {
    throw new TypeError(
      'Application-state snapshot marker crosses application scope.',
    );
  }
  const expectedSourceAuthority =
    createApplicationStateCoordinatorAuthorityRecord({
      storeId,
      namespace,
      authority: checkpoint.sourceBarrier.authority,
    });
  if (
    checkpoint.sourceDestinationAuthorityDigest !==
    expectedSourceAuthority.record_digest
  ) {
    throw new TypeError(
      'Application-state snapshot marker authority is invalid.',
    );
  }
  const key = createApplicationStateSnapshotMarkerKey(input.transferId);
  const fields = {
    resource_id: key.resourceId,
    sort_key: key.sortKey,
    record_kind: APPLICATION_STATE_SNAPSHOT_MARKER_RECORD_KIND,
    schema_version: 1,
    store_id: storeId,
    namespace,
    transfer_id: input.transferId,
    history_digest: checkpoint.history.historyDigest,
    barrier_version: checkpoint.sourceBarrier.version,
    barrier_authority_id: checkpoint.sourceBarrier.authority.authorityId,
    destination_authority_digest: checkpoint.sourceDestinationAuthorityDigest,
  };
  return deepFreeze({
    ...fields,
    record_digest: createCanonicalJsonSha256Id({
      domain: 'wharfie:application-state-snapshot-marker:v1',
      prefix: 'wasm1',
      value: fields,
      valuePath: 'application-state snapshot marker',
    }),
  });
}

/** @param {unknown} value */
export function validateApplicationStateSnapshotMarkerRecord(value) {
  const record = cloneBoundedJsonObject(
    value,
    64 * 1024,
    'application-state snapshot marker',
  );
  assertExactKeys(record, MARKER_KEYS, 'application-state snapshot marker');
  assertDomainSeparatedSha256Id(
    record.record_digest,
    'wasm1',
    'application-state snapshot marker.record_digest',
  );
  const fields = { ...record };
  delete fields.record_digest;
  const expectedDigest = createCanonicalJsonSha256Id({
    domain: 'wharfie:application-state-snapshot-marker:v1',
    prefix: 'wasm1',
    value: fields,
    valuePath: 'application-state snapshot marker',
  });
  if (
    record.record_kind !== APPLICATION_STATE_SNAPSHOT_MARKER_RECORD_KIND ||
    record.schema_version !== 1 ||
    record.sort_key !== APPLICATION_STATE_SNAPSHOT_MARKER_SORT_KEY ||
    record.resource_id !==
      createApplicationStateSnapshotMarkerKey(record.transfer_id).resourceId ||
    record.record_digest !== expectedDigest
  ) {
    throw new TypeError(
      'Application-state snapshot marker failed verification.',
    );
  }
  assertDomainSeparatedSha256Id(
    record.store_id,
    'was',
    'application-state snapshot marker.store_id',
  );
  assertDomainSeparatedSha256Id(
    record.history_digest,
    'wash1',
    'application-state snapshot marker.history_digest',
  );
  assertDomainSeparatedSha256Id(
    record.destination_authority_digest,
    'waaf1',
    'application-state snapshot marker.destination_authority_digest',
  );
  if (
    typeof record.namespace !== 'string' ||
    !record.namespace ||
    !Number.isSafeInteger(record.barrier_version) ||
    record.barrier_version < 1 ||
    typeof record.barrier_authority_id !== 'string' ||
    !record.barrier_authority_id
  ) {
    throw new TypeError('Application-state snapshot marker scope is invalid.');
  }
  return deepFreeze(record);
}

/** @param {unknown} markerValue @param {unknown} transportValue */
export function assertApplicationStateSnapshotMarkerMatchesTransport(
  markerValue,
  transportValue,
) {
  const marker = validateApplicationStateSnapshotMarkerRecord(markerValue);
  const transport = normalizeApplicationStateSnapshotTransport(transportValue);
  const expected = createApplicationStateSnapshotMarkerRecord({
    destination: transport.snapshot.destination,
    transferId: transport.snapshot.transferId,
    checkpoint: transport.snapshot.checkpoint,
  });
  if (Object.keys(expected).some((key) => expected[key] !== marker[key])) {
    throw new TypeError(
      'Application-state snapshot marker does not match the pinned transport.',
    );
  }
  return marker;
}

export default {
  APPLICATION_STATE_SNAPSHOT_DISTRIBUTION_KIND,
  APPLICATION_STATE_SNAPSHOT_FORMAT,
  APPLICATION_STATE_SNAPSHOT_REFERENCE_KIND,
  APPLICATION_STATE_SNAPSHOT_TRANSPORT_KIND,
  assertApplicationStateSnapshotMarkerMatchesTransport,
  createApplicationStateSnapshotMarkerRecord,
  createApplicationStateSnapshotReference,
  createApplicationStateSnapshotSourceSeal,
  createApplicationStateTransportReadiness,
  normalizeApplicationStateSnapshotTransport,
  normalizeApplicationStateSnapshotSourceSeal,
  validateApplicationStateSnapshotReference,
  validateApplicationStateTransportReadiness,
  verifyApplicationStateSnapshotReference,
};
