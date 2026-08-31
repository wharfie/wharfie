/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns -- Internal snapshot ports use strict inline shapes. */

import { promises as fsp } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONDITION_TYPE } from '../lib/db/base.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  ApplicationStateStoreIdentityError,
  createApplicationStateActivationRecord,
  createApplicationStateRetirementAbsenceFence,
  createApplicationStateTable,
  validateApplicationStateActivationRecord,
} from '../lib/db/tables/application-state.js';
import {
  createApplicationStateCoordinatorAuthorityRecord,
  createApplicationStateCoordinatorAuthorityFence,
} from '../lib/db/tables/application-state-authority.js';
import {
  CoordinatorQuiescenceBarrierState,
  assertCoordinatorQuiescenceBarrierSnapshot,
  createCoordinatorQuiescenceBarrier,
} from '../lib/db/tables/coordinator-quiescence-barrier.js';
import {
  assertCoordinatorAuthorityCurrent,
  assertCoordinatorAuthorityToken,
} from '../lib/db/tables/coordinator-authority.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import { assertApplicationStateSnapshotDistribution } from './application-state-snapshot-distribution.js';
import { createApplicationStateSnapshotControlStore } from './application-state-snapshot-control.js';
import {
  assertSettledApplicationStateHistory,
  inventoryApplicationStateHistory,
  validateApplicationStateHistoryCheckpoint,
} from './application-state-history-checkpoint.js';
import {
  APPLICATION_STATE_SNAPSHOT_TRANSPORT_KIND,
  APPLICATION_STATE_SNAPSHOT_MAX_BYTES,
  APPLICATION_STATE_TRANSPORT_HYDRATED_STATUS,
  APPLICATION_STATE_TRANSPORT_RETAINED_STATUS,
  assertApplicationStateSnapshotMarkerMatchesTransport,
  assertApplicationStateSnapshotTransferId,
  createApplicationStateSnapshotMarkerRecord,
  createApplicationStateSnapshotReference,
  createApplicationStateSnapshotSourceSeal,
  createApplicationStateTransportReadiness,
  normalizeApplicationStateSnapshotSourceSeal,
  normalizeApplicationStateSnapshotTransport,
  validateApplicationStateSnapshotMarkerRecord,
  verifyApplicationStateSnapshotReference,
} from './application-state-snapshot.js';
import {
  assertApplicationStateStoreIsolation,
  openApplicationStateDB,
  validateApplicationStateStoreConfiguration,
} from './application-state-store.js';
import { normalizeApplicationStateDestination } from './effects/application-state.js';

const PHASES = new Set([
  'source-adopted',
  'marker-persisted',
  'source-sealed',
  'backup-complete',
  'snapshot-published',
  'source-retired',
  'hydration-staged',
  'hydration-target-created',
  'hydration-evidence-linked',
  'hydration-committed',
  'destination-adopted',
]);

const REPLICA_ID_FILE = '.wharfie-application-state-replica-id';
const HYDRATION_EVIDENCE_FILE_PREFIX =
  '.wharfie-application-state-snapshot-hydration';
const ACTIVATION_INTENT_FILE_PREFIX =
  '.wharfie-application-state-snapshot-activation-intent';
const HYDRATION_CLAIM_FILE =
  '.wharfie-application-state-snapshot-hydration-claim';
const HYDRATION_CLAIM_KIND =
  'wharfie.application-state-snapshot-hydration-claim.v1';
const HYDRATION_CLAIM_ID_PREFIX = 'washc1';
const HYDRATION_CLAIM_WAIT_ATTEMPTS = 200;
const HYDRATION_CLAIM_WAIT_MS = 10;
const TARGET_PROBE_ARGUMENT = '--wharfie-application-state-target-probe';
const TARGET_PROBE_MAX_OUTPUT_BYTES = 128 * 1024;
const TARGET_PROBE_TIMEOUT_MS = 15_000;

/** An existing target is malformed, incomplete, or does not match the pin. */
export class ApplicationStateSnapshotTargetCorruptionError extends Error {
  /** @param {string} reason @param {{cause?: unknown}} [options] */
  constructor(reason, options = {}) {
    super(`Application-state snapshot target is invalid: ${reason}`, {
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = 'ApplicationStateSnapshotTargetCorruptionError';
    this.code = 'WHARFIE_APPLICATION_STATE_SNAPSHOT_TARGET_INVALID';
    this.reason = reason;
  }
}

/** @param {unknown} error */
function isNotFound(error) {
  return (
    !!error &&
    typeof error === 'object' &&
    /** @type {{code?: unknown}} */ (error).code === 'ENOENT'
  );
}

/** @param {unknown} left @param {unknown} right */
function sameJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/** @param {unknown} left @param {unknown} right */
function sameAuthority(left, right) {
  const first = assertCoordinatorAuthorityToken(left);
  const second = assertCoordinatorAuthorityToken(right);
  return (
    first.schemaVersion === second.schemaVersion &&
    first.appId === second.appId &&
    first.coordinatorId === second.coordinatorId &&
    first.authorityId === second.authorityId &&
    first.epoch === second.epoch
  );
}

/** @param {AbortSignal | undefined} signal */
function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw (
    signal.reason ?? new Error('Application-state snapshot operation aborted.')
  );
}

/** @param {unknown} callback */
function normalizeObserver(callback) {
  if (callback === undefined) return async () => {};
  if (typeof callback !== 'function') {
    throw new TypeError(
      'Application-state snapshot observePhase must be a function.',
    );
  }
  const captured = callback;
  return async (/** @type {string} */ phase) => {
    if (!PHASES.has(phase)) {
      throw new TypeError(
        `Unsupported application-state snapshot phase: ${phase}`,
      );
    }
    await captured(phase);
  };
}

/** @param {string} directory */
async function syncDirectory(directory) {
  const handle = await fsp.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** @param {string} path @param {Buffer} bytes */
async function writeAndSync(path, bytes) {
  const handle = await fsp.open(path, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** @param {string} path @param {number} maxBytes @param {string} label */
async function readSmallRegularFile(path, maxBytes, label) {
  const before = await fsp.lstat(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size < 1 ||
    before.size > maxBytes
  ) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      `${label} is not one bounded non-symbolic-link regular file`,
    );
  }
  const bytes = await fsp.readFile(path);
  const after = await fsp.lstat(path);
  if (
    after.isSymbolicLink() ||
    !after.isFile() ||
    after.size !== before.size ||
    bytes.byteLength !== before.size
  ) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      `${label} changed while it was read`,
    );
  }
  return bytes;
}

/** @param {string} path */
async function removePrivateStaging(path) {
  try {
    await fsp.rm(path, { force: true, recursive: true });
  } catch {
    // An unreachable private staging directory never becomes a target store.
  }
}

/** @param {string} dbRoot */
async function assertExistingLmdbRoot(dbRoot) {
  let rootStats;
  try {
    rootStats = await fsp.lstat(dbRoot);
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the LMDB root is not a non-symbolic-link directory',
    );
  }
  let dataStats;
  try {
    dataStats = await fsp.lstat(join(dbRoot, 'data.mdb'));
  } catch (error) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'an existing LMDB root does not contain data.mdb',
      { cause: error },
    );
  }
  if (!dataStats.isFile() || dataStats.isSymbolicLink() || dataStats.size < 1) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'data.mdb is not one nonempty regular file',
    );
  }
  return true;
}

/** @param {string} dbRoot */
async function readSealedLmdbData(dbRoot) {
  await assertExistingLmdbRoot(dbRoot);
  const dataPath = join(dbRoot, 'data.mdb');
  const handle = await fsp.open(dataPath, 'r');
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.size < 1 ||
      before.size > APPLICATION_STATE_SNAPSHOT_MAX_BYTES
    ) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        `sealed data.mdb must contain between 1 and ${APPLICATION_STATE_SNAPSHOT_MAX_BYTES} bytes`,
      );
    }
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      );
      if (bytesRead < 1) {
        throw new ApplicationStateSnapshotTargetCorruptionError(
          'sealed data.mdb ended before its observed size',
        );
      }
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== before.size) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'sealed data.mdb changed while it was read',
      );
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

/** @param {{db: import('../lib/db/base.js').DBClient, tableName: string}} controlContext @param {Readonly<Record<string, any>>} expected */
async function assertDurableBarrierExact(controlContext, expected) {
  const retained = await createCoordinatorQuiescenceBarrier({
    db: controlContext.db,
    tableName: controlContext.tableName,
  }).get({ appId: expected.appId });
  if (!retained || !sameJson(retained, expected)) {
    throw new Error(
      'Durable coordinator admission barrier does not match the supplied CLOSED checkpoint.',
    );
  }
  return retained;
}

/** @param {string} storePath */
async function ensurePhysicalReplicaId(storePath) {
  await fsp.mkdir(storePath, { recursive: true, mode: 0o700 });
  const stats = await fsp.lstat(storePath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the configured store root is not a non-symbolic-link directory',
    );
  }
  const path = join(storePath, REPLICA_ID_FILE);
  const read = async () => {
    const value = (
      await readSmallRegularFile(path, 128, 'physical replica identity')
    )
      .toString('utf8')
      .trim();
    assertDomainSeparatedSha256Id(
      value,
      'wasr1',
      'application-state physical replica id',
    );
    return value;
  };
  /** @param {string} observed */
  const stabilizeRead = async (observed) => {
    await syncDirectory(storePath);
    const retained = await read();
    if (retained !== observed) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'physical replica identity changed across directory synchronization',
      );
    }
    return retained;
  };
  let existing;
  try {
    existing = await read();
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  if (existing !== undefined) return await stabilizeRead(existing);
  const candidate = createCanonicalJsonSha256Id({
    domain: 'wharfie:application-state:physical-replica:v1',
    prefix: 'wasr1',
    value: { entropy: randomUUID() },
    valuePath: 'application-state physical replica identity',
  });
  const temporaryPath = join(
    storePath,
    `.wharfie-application-state-replica-id-${randomUUID()}.tmp`,
  );
  try {
    await writeAndSync(temporaryPath, Buffer.from(`${candidate}\n`, 'utf8'));
    try {
      await fsp.link(temporaryPath, path);
      await syncDirectory(storePath);
      return candidate;
    } catch (error) {
      if (/** @type {{code?: unknown}} */ (error)?.code !== 'EEXIST') {
        throw error;
      }
      return await stabilizeRead(await read());
    }
  } finally {
    try {
      await fsp.unlink(temporaryPath);
    } catch {
      // A private candidate path is never consulted as authoritative identity.
    }
  }
}

/** @param {string} snapshotId */
function hydrationEvidenceName(snapshotId) {
  assertDomainSeparatedSha256Id(
    snapshotId,
    'wass1',
    'application-state hydration snapshotId',
  );
  return `${HYDRATION_EVIDENCE_FILE_PREFIX}-${snapshotId}`;
}

/** @param {string} storePath @param {string} snapshotId */
async function readHydrationStatus(storePath, snapshotId) {
  try {
    const retained = (
      await readSmallRegularFile(
        join(storePath, 'lmdb', hydrationEvidenceName(snapshotId)),
        128,
        'hydration evidence',
      )
    )
      .toString('utf8')
      .trim();
    if (retained !== snapshotId) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'hydration evidence does not match the pinned snapshot',
      );
    }
    return APPLICATION_STATE_TRANSPORT_HYDRATED_STATUS;
  } catch (error) {
    if (isNotFound(error)) return APPLICATION_STATE_TRANSPORT_RETAINED_STATUS;
    throw error;
  }
}

/** @param {number} milliseconds */
async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** @param {string} snapshotId @param {string} claimId */
function createHydrationClaimRecord(snapshotId, claimId) {
  assertDomainSeparatedSha256Id(
    snapshotId,
    'wass1',
    'application-state hydration claim snapshotId',
  );
  assertDomainSeparatedSha256Id(
    claimId,
    HYDRATION_CLAIM_ID_PREFIX,
    'application-state hydration claim claimId',
  );
  return Object.freeze({
    schemaVersion: 1,
    kind: HYDRATION_CLAIM_KIND,
    snapshotId,
    claimId,
  });
}

/** @param {unknown} value */
function validateHydrationClaimRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('hydration claim must be an object');
  }
  const record = /** @type {Record<string, any>} */ (value);
  const keys = Object.keys(record);
  if (
    keys.length !== 4 ||
    keys.some(
      (key) =>
        !['schemaVersion', 'kind', 'snapshotId', 'claimId'].includes(key),
    ) ||
    record.schemaVersion !== 1 ||
    record.kind !== HYDRATION_CLAIM_KIND
  ) {
    throw new TypeError('hydration claim has an unsupported shape');
  }
  return createHydrationClaimRecord(record.snapshotId, record.claimId);
}

/** @param {string} storePath */
async function readHydrationClaim(storePath) {
  try {
    return validateHydrationClaimRecord(
      JSON.parse(
        (
          await readSmallRegularFile(
            join(storePath, HYDRATION_CLAIM_FILE),
            1024,
            'hydration claim',
          )
        ).toString('utf8'),
      ),
    );
  } catch (cause) {
    if (isNotFound(cause)) return null;
    if (cause instanceof ApplicationStateSnapshotTargetCorruptionError) {
      throw cause;
    }
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'hydration claim failed validation',
      { cause },
    );
  }
}

/** @param {string} storePath @param {string} snapshotId */
async function createHydrationClaim(storePath, snapshotId) {
  const claim = createHydrationClaimRecord(
    snapshotId,
    createCanonicalJsonSha256Id({
      domain: 'wharfie:application-state:hydration-claim:v1',
      prefix: HYDRATION_CLAIM_ID_PREFIX,
      value: { entropy: randomUUID() },
      valuePath: 'application-state hydration claim',
    }),
  );
  const path = join(storePath, HYDRATION_CLAIM_FILE);
  const temporaryPath = join(
    storePath,
    `${HYDRATION_CLAIM_FILE}-${randomUUID()}.tmp`,
  );
  try {
    await writeAndSync(
      temporaryPath,
      Buffer.from(`${JSON.stringify(claim)}\n`, 'utf8'),
    );
    try {
      await fsp.link(temporaryPath, path);
      await syncDirectory(storePath);
      return Object.freeze({ owned: true, claim });
    } catch (error) {
      if (/** @type {{code?: unknown}} */ (error)?.code !== 'EEXIST') {
        throw error;
      }
      const retained = await readHydrationClaim(storePath);
      if (!retained) {
        if (
          (await readHydrationStatus(storePath, snapshotId)) ===
          APPLICATION_STATE_TRANSPORT_HYDRATED_STATUS
        ) {
          await assertExistingLmdbRoot(join(storePath, 'lmdb'));
          return Object.freeze({ owned: false, claim });
        }
        throw new ApplicationStateSnapshotTargetCorruptionError(
          'a hydration claim disappeared without a committed target',
        );
      }
      if (retained.snapshotId !== snapshotId) {
        throw new ApplicationStateSnapshotTargetCorruptionError(
          'another hydration claim targets different snapshot state',
        );
      }
      await syncDirectory(storePath);
      return Object.freeze({ owned: false, claim: retained });
    }
  } finally {
    try {
      await fsp.unlink(temporaryPath);
    } catch {
      // A private candidate path is never consulted as a hydration claim.
    }
  }
}

/** @param {string} storePath @param {Readonly<Record<string, any>>} expected */
async function releaseHydrationClaim(storePath, expected) {
  const retained = await readHydrationClaim(storePath);
  if (!retained) return;
  if (!sameJson(retained, expected)) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'hydration claim changed before release',
    );
  }
  try {
    await fsp.unlink(join(storePath, HYDRATION_CLAIM_FILE));
  } catch (error) {
    if (!isNotFound(error)) throw error;
    // Another exact committer may have removed the same claim after the
    // verified read. The completed target prevents a new hydration claimant.
  }
  await syncDirectory(storePath);
}

/** @param {string} storePath @param {string} snapshotId */
async function waitForHydrationClaim(storePath, snapshotId) {
  for (let attempt = 0; attempt < HYDRATION_CLAIM_WAIT_ATTEMPTS; attempt += 1) {
    const claim = await readHydrationClaim(storePath);
    if (!claim) {
      if (
        (await readHydrationStatus(storePath, snapshotId)) ===
        APPLICATION_STATE_TRANSPORT_HYDRATED_STATUS
      ) {
        await assertExistingLmdbRoot(join(storePath, 'lmdb'));
        return true;
      }
      return false;
    }
    if (claim.snapshotId !== snapshotId) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'an in-progress hydration claim targets another snapshot',
      );
    }
    if (
      (await readHydrationStatus(storePath, snapshotId)) ===
      APPLICATION_STATE_TRANSPORT_HYDRATED_STATUS
    ) {
      const target = join(storePath, 'lmdb');
      await assertExistingLmdbRoot(target);
      // The evidence hard link is the logical commit. If its owner stopped
      // before acknowledging or releasing the claim, an exact contender can
      // finish the directory durability steps without replacing any path.
      await syncDirectory(target);
      await syncDirectory(storePath);
      await releaseHydrationClaim(storePath, claim);
      return true;
    }
    await delay(HYDRATION_CLAIM_WAIT_MS);
  }
  throw new ApplicationStateSnapshotTargetCorruptionError(
    'an exact hydration claim did not reach its durable commit',
  );
}

/** @param {string} snapshotId */
function activationIntentName(snapshotId) {
  assertDomainSeparatedSha256Id(
    snapshotId,
    'wass1',
    'application-state activation-intent snapshotId',
  );
  return `${ACTIVATION_INTENT_FILE_PREFIX}-${snapshotId}`;
}

/** @param {{configuration: ReturnType<typeof validateApplicationStateStoreConfiguration>, transport: ReturnType<typeof normalizeApplicationStateSnapshotTransport>, authority: ReturnType<typeof assertCoordinatorAuthorityToken>, replicaId: string, status: 'RETAINED'|'HYDRATED'}} input */
function createLocalActivationIntent(input) {
  const destination = input.transport.snapshot.destination;
  return createApplicationStateActivationRecord({
    storeId: destination.configuration.storeId,
    namespace: destination.configuration.namespace,
    transferId: input.transport.snapshot.transferId,
    snapshotId: input.transport.snapshot.snapshotId,
    distributionId: input.transport.distribution.distributionId,
    replicaId: input.replicaId,
    transportStatus: input.status,
    authority: input.authority,
  });
}

/** @param {{configuration: ReturnType<typeof validateApplicationStateStoreConfiguration>, transport: ReturnType<typeof normalizeApplicationStateSnapshotTransport>, authority: ReturnType<typeof assertCoordinatorAuthorityToken>, replicaId: string}} input */
async function readLocalActivationIntent(input) {
  const path = join(
    input.configuration.storePath,
    'lmdb',
    activationIntentName(input.transport.snapshot.snapshotId),
  );
  try {
    const raw = await readSmallRegularFile(
      path,
      64 * 1024,
      'local activation intent',
    );
    const record = validateApplicationStateActivationRecord(
      JSON.parse(raw.toString('utf8')),
    );
    const expected = createLocalActivationIntent({
      ...input,
      status: record.transport_status,
    });
    if (!sameJson(record, expected)) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'local activation intent does not match the pinned snapshot and replica',
      );
    }
    return record;
  } catch (cause) {
    if (isNotFound(cause)) return null;
    if (cause instanceof ApplicationStateSnapshotTargetCorruptionError) {
      throw cause;
    }
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'local activation intent failed validation',
      { cause },
    );
  }
}

/** @param {{configuration: ReturnType<typeof validateApplicationStateStoreConfiguration>, transport: ReturnType<typeof normalizeApplicationStateSnapshotTransport>, authority: ReturnType<typeof assertCoordinatorAuthorityToken>, replicaId: string, status: 'RETAINED'|'HYDRATED'}} input */
async function persistLocalActivationIntent(input) {
  const expected = createLocalActivationIntent(input);
  const directory = join(input.configuration.storePath, 'lmdb');
  const path = join(
    directory,
    activationIntentName(input.transport.snapshot.snapshotId),
  );
  const temporaryPath = join(
    directory,
    `${activationIntentName(input.transport.snapshot.snapshotId)}-${randomUUID()}.tmp`,
  );
  try {
    await writeAndSync(
      temporaryPath,
      Buffer.from(
        `${JSON.stringify(sortCanonicalJsonValue(expected))}\n`,
        'utf8',
      ),
    );
    try {
      await fsp.link(temporaryPath, path);
      await syncDirectory(directory);
    } catch (error) {
      if (/** @type {{code?: unknown}} */ (error)?.code !== 'EEXIST') {
        throw error;
      }
    }
  } finally {
    try {
      await fsp.unlink(temporaryPath);
    } catch {
      // A private candidate path is never consulted as activation evidence.
    }
  }
  await syncDirectory(directory);
  const retained = await readLocalActivationIntent(input);
  if (!retained || !sameJson(retained, expected)) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'local activation intent was not durably readable',
    );
  }
  return retained;
}

/** @param {Record<string, any>} context */
function snapshotControlContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new TypeError(
      'Application-state snapshot controlContext is required.',
    );
  }
  return Object.freeze({
    db: context.db,
    tableName: context.tableName,
    adapterName: context.adapterName,
    controlPath: context.controlPath,
  });
}

/** @param {unknown} destinationValue @param {ReturnType<typeof validateApplicationStateStoreConfiguration>} configuration @param {string} appId */
function scopedDestination(destinationValue, configuration, appId) {
  const destination = normalizeApplicationStateDestination(destinationValue);
  if (
    configuration.adapterName !== 'lmdb' ||
    destination.configuration.provider !== 'lmdb' ||
    destination.configuration.tableName !== configuration.tableName ||
    destination.configuration.namespace !== appId
  ) {
    throw new TypeError(
      'Application-state snapshot destination does not match the exact LMDB configuration and application.',
    );
  }
  return destination;
}

/** @param {import('../lib/db/base.js').DBClient} db @param {string} tableName @param {string} resourceId @param {string} sortKey */
async function readMarker(db, tableName, resourceId, sortKey) {
  return (
    (await db.get({
      tableName,
      keyName: 'resource_id',
      keyValue: resourceId,
      sortKeyName: 'sort_key',
      sortKeyValue: sortKey,
      consistentRead: true,
    })) || null
  );
}

/** @param {import('../lib/db/base.js').DBClient} db @param {string} tableName @param {Readonly<Record<string, any>>} marker @param {import('../lib/db/base.js').TransactionConditionCheck} authorityFence @param {import('../lib/db/base.js').TransactionConditionCheck} retirementFence */
async function persistMarker(
  db,
  tableName,
  marker,
  authorityFence,
  retirementFence,
) {
  try {
    await db.transactionWrite({
      tableName,
      conditionChecks: [authorityFence, retirementFence],
      putRequests: [
        {
          keyName: 'resource_id',
          sortKeyName: 'sort_key',
          record: marker,
          conditions: [
            {
              conditionType: CONDITION_TYPE.NOT_EXISTS,
              propertyName: 'resource_id',
            },
            {
              conditionType: CONDITION_TYPE.NOT_EXISTS,
              propertyName: 'sort_key',
            },
          ],
        },
      ],
    });
  } catch (error) {
    const retained = await readMarker(
      db,
      tableName,
      marker.resource_id,
      marker.sort_key,
    );
    if (
      !retained ||
      !sameJson(validateApplicationStateSnapshotMarkerRecord(retained), marker)
    ) {
      throw error;
    }
  }
  const retained = await readMarker(
    db,
    tableName,
    marker.resource_id,
    marker.sort_key,
  );
  if (
    !retained ||
    !sameJson(validateApplicationStateSnapshotMarkerRecord(retained), marker)
  ) {
    throw new Error(
      'Application-state snapshot marker was not durably readable.',
    );
  }
}

/**
 * Seal one quiesced LMDB application store and publish a verified immutable
 * data.mdb artifact. The two history inventories deliberately expose the
 * lack of cross-store atomicity: any control-history movement rejects the cut.
 * @param {{ledger: any, appId: string, configuration: unknown, controlContext: Record<string, any>, destination: unknown, closedBarrier: unknown, coordinatorAuthority: unknown, transferId: string, distribution: unknown, signal?: AbortSignal, observePhase?: (phase: string) => Promise<void> | void}} options
 */
export async function publishApplicationStateSnapshot(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Application-state snapshot publication requires options.',
    );
  }
  const allowed = new Set([
    'ledger',
    'appId',
    'configuration',
    'controlContext',
    'destination',
    'closedBarrier',
    'coordinatorAuthority',
    'transferId',
    'distribution',
    'signal',
    'observePhase',
  ]);
  if (Object.keys(options).some((key) => !allowed.has(key))) {
    throw new TypeError(
      'Application-state snapshot publication has unsupported options.',
    );
  }
  const ledger = options.ledger;
  const appId = options.appId;
  const configurationValue = options.configuration;
  const controlContextValue = options.controlContext;
  const destinationValue = options.destination;
  const closedBarrierValue = options.closedBarrier;
  const coordinatorAuthorityValue = options.coordinatorAuthority;
  const transferId = options.transferId;
  const distributionValue = options.distribution;
  const signal = options.signal;
  const observePhaseValue = options.observePhase;
  assertApplicationStateSnapshotTransferId(transferId);
  const configuration =
    validateApplicationStateStoreConfiguration(configurationValue);
  const controlContext = snapshotControlContext(controlContextValue);
  const destination = scopedDestination(destinationValue, configuration, appId);
  const authority = assertCoordinatorAuthorityToken(
    coordinatorAuthorityValue,
    'application-state snapshot coordinatorAuthority',
  );
  const closedBarrier = assertCoordinatorQuiescenceBarrierSnapshot(
    closedBarrierValue,
    'application-state snapshot closedBarrier',
  );
  if (
    closedBarrier.state !== CoordinatorQuiescenceBarrierState.CLOSED ||
    closedBarrier.appId !== appId ||
    !sameAuthority(closedBarrier.authority, authority)
  ) {
    throw new TypeError(
      'Application-state snapshot requires the exact current CLOSED admission barrier.',
    );
  }
  assertApplicationStateSnapshotDistribution(distributionValue);
  const distribution = distributionValue;
  if (distribution.identity.storeId !== destination.configuration.storeId) {
    throw new TypeError(
      'Application-state snapshot distribution does not match the destination store.',
    );
  }
  const observePhase = normalizeObserver(observePhaseValue);
  assertApplicationStateStoreIsolation(configuration, controlContext);
  throwIfAborted(signal);
  await assertCoordinatorAuthorityCurrent({
    db: controlContext.db,
    tableName: controlContext.tableName,
    authority,
  });
  await assertDurableBarrierExact(controlContext, closedBarrier);
  const firstHistory = await inventoryApplicationStateHistory({
    ledger,
    appId,
    ...(signal === undefined ? {} : { signal }),
  });
  assertSettledApplicationStateHistory(firstHistory);
  throwIfAborted(signal);

  let sourceSeal;
  const applicationState = await openApplicationStateDB({ configuration });
  try {
    const table = createApplicationStateTable({
      db: applicationState.db,
      tableName: applicationState.context.tableName,
      coordinatorAuthority: authority,
    });
    await table.assertStoreIdentity(destination.configuration.storeId);
    const existingRetirement = await table.readStoreRetirement({
      storeId: destination.configuration.storeId,
      namespace: destination.configuration.namespace,
    });
    if (existingRetirement) {
      if (existingRetirement.retirement_id !== transferId) {
        throw new ApplicationStateSnapshotTargetCorruptionError(
          'the source was retired by a different transfer',
        );
      }
      let parsedArtifact;
      try {
        parsedArtifact = JSON.parse(existingRetirement.retirement_artifact);
      } catch (cause) {
        throw new ApplicationStateSnapshotTargetCorruptionError(
          'the source retirement artifact is not valid JSON',
          { cause },
        );
      }
      sourceSeal = normalizeApplicationStateSnapshotSourceSeal(parsedArtifact);
      if (
        !sameJson(sourceSeal.distribution, distribution.identity) ||
        !sameJson(sourceSeal.destination, destination) ||
        !sameJson(sourceSeal.checkpoint.history, firstHistory) ||
        !sameJson(sourceSeal.checkpoint.sourceBarrier, closedBarrier) ||
        existingRetirement.authority_id !== authority.authorityId ||
        existingRetirement.coordinator_id !== authority.coordinatorId ||
        existingRetirement.epoch !== authority.epoch
      ) {
        throw new ApplicationStateSnapshotTargetCorruptionError(
          'the source seal does not match this publication',
        );
      }
      const expectedMarker = createApplicationStateSnapshotMarkerRecord({
        destination,
        transferId,
        checkpoint: sourceSeal.checkpoint,
      });
      const retainedMarker = await readMarker(
        applicationState.db,
        applicationState.context.tableName,
        expectedMarker.resource_id,
        expectedMarker.sort_key,
      );
      if (
        !retainedMarker ||
        !sameJson(
          validateApplicationStateSnapshotMarkerRecord(retainedMarker),
          expectedMarker,
        )
      ) {
        throw new ApplicationStateSnapshotTargetCorruptionError(
          'the sealed source checkpoint marker is missing or mismatched',
        );
      }
    } else {
      const destinationAuthority = await table.adoptCoordinatorAuthority({
        storeId: destination.configuration.storeId,
        namespace: destination.configuration.namespace,
      });
      await observePhase('source-adopted');
      throwIfAborted(signal);
      const checkpoint = Object.freeze({
        history: firstHistory,
        sourceBarrier: closedBarrier,
        sourceDestinationAuthorityDigest: destinationAuthority.record_digest,
      });
      const marker = createApplicationStateSnapshotMarkerRecord({
        destination,
        transferId,
        checkpoint,
      });
      await persistMarker(
        applicationState.db,
        applicationState.context.tableName,
        marker,
        createApplicationStateCoordinatorAuthorityFence({
          storeId: destination.configuration.storeId,
          namespace: destination.configuration.namespace,
          authority,
        }),
        createApplicationStateRetirementAbsenceFence(
          destination.configuration.storeId,
        ),
      );
      await observePhase('marker-persisted');
      throwIfAborted(signal);
      sourceSeal = createApplicationStateSnapshotSourceSeal({
        distribution: distribution.identity,
        destination,
        transferId,
        checkpoint,
      });
      await table.retireStore({
        storeId: destination.configuration.storeId,
        namespace: destination.configuration.namespace,
        retirementId: transferId,
        artifact: JSON.stringify(sortCanonicalJsonValue(sourceSeal)),
      });
      await observePhase('source-sealed');
    }
  } finally {
    await applicationState.close();
  }
  throwIfAborted(signal);
  if (!sourceSeal) {
    throw new Error(
      'Application-state snapshot source was not durably sealed.',
    );
  }
  await assertDurableBarrierExact(controlContext, closedBarrier);

  const dbRoot = resolve(configuration.storePath, 'lmdb');
  const bytes = await readSealedLmdbData(dbRoot);
  await observePhase('backup-complete');
  throwIfAborted(signal);
  const secondHistory = await inventoryApplicationStateHistory({
    ledger,
    appId,
    ...(signal === undefined ? {} : { signal }),
  });
  assertSettledApplicationStateHistory(secondHistory);
  if (!sameJson(firstHistory, secondHistory)) {
    throw new Error(
      'Application-state history changed while the LMDB checkpoint was captured.',
    );
  }
  await assertCoordinatorAuthorityCurrent({
    db: controlContext.db,
    tableName: controlContext.tableName,
    authority,
  });
  await assertDurableBarrierExact(controlContext, closedBarrier);
  throwIfAborted(signal);
  const snapshot = createApplicationStateSnapshotReference({
    bytes,
    destination,
    transferId,
    history: firstHistory,
    closedBarrier,
    sourceDestinationAuthorityDigest:
      sourceSeal.checkpoint.sourceDestinationAuthorityDigest,
  });
  await distribution.publishImmutable({ reference: snapshot, bytes });
  await observePhase('snapshot-published');
  const transport = normalizeApplicationStateSnapshotTransport({
    kind: APPLICATION_STATE_SNAPSHOT_TRANSPORT_KIND,
    distribution: distribution.identity,
    snapshot,
  });
  throwIfAborted(signal);
  await assertCoordinatorAuthorityCurrent({
    db: controlContext.db,
    tableName: controlContext.tableName,
    authority,
  });
  await assertDurableBarrierExact(controlContext, closedBarrier);
  await createApplicationStateSnapshotControlStore({
    db: controlContext.db,
    tableName: controlContext.tableName,
  }).recordPublication({
    transport,
    sourceBarrier: closedBarrier,
    sourceAuthority: authority,
  });
  await observePhase('source-retired');
  await assertCoordinatorAuthorityCurrent({
    db: controlContext.db,
    tableName: controlContext.tableName,
    authority,
  });
  throwIfAborted(signal);
  return transport;
}

/**
 * Recover the exact published transport after a process stops between source
 * retirement and handing the receipt to provisioning. This is read-only and
 * returns only evidence already sealed in the control store after immutable
 * provider readback. The source volume is not required for recovery.
 * @param {{controlContext: Record<string, any>, destination: unknown, transferId: string, distribution: unknown}} options - Exact published-source lookup.
 * @returns {Promise<ReturnType<typeof normalizeApplicationStateSnapshotTransport>>} - Verified immutable transport.
 */
export async function recoverRetiredApplicationStateSnapshot(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Application-state snapshot retirement recovery requires options.',
    );
  }
  const allowed = new Set([
    'controlContext',
    'destination',
    'transferId',
    'distribution',
  ]);
  if (Object.keys(options).some((key) => !allowed.has(key))) {
    throw new TypeError(
      'Application-state snapshot retirement recovery has unsupported options.',
    );
  }
  const controlContextValue = options.controlContext;
  const destinationValue = options.destination;
  const transferId = options.transferId;
  const distributionValue = options.distribution;
  assertApplicationStateSnapshotTransferId(transferId);
  const controlContext = snapshotControlContext(controlContextValue);
  const destination = normalizeApplicationStateDestination(destinationValue);
  if (destination.configuration.provider !== 'lmdb') {
    throw new TypeError(
      'Application-state snapshot recovery requires an LMDB destination.',
    );
  }
  assertApplicationStateSnapshotDistribution(distributionValue);
  const distribution = distributionValue;
  const publication = await createApplicationStateSnapshotControlStore({
    db: controlContext.db,
    tableName: controlContext.tableName,
  }).getPublication({
    transferId,
  });
  if (!publication) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the exact published snapshot transfer is not present',
    );
  }
  const transport = publication.transport;
  if (
    !sameJson(transport.distribution, distribution.identity) ||
    !sameJson(transport.snapshot.destination, destination) ||
    transport.snapshot.transferId !== transferId
  ) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the retired snapshot artifact does not match the requested scope',
    );
  }
  await distribution.readBytes(transport.snapshot);
  return transport;
}

/** @param {string} storePath @param {Buffer} bytes @param {string} snapshotId @param {(phase: string) => Promise<void>} observePhase */
async function hydrateAbsentTarget(storePath, bytes, snapshotId, observePhase) {
  await fsp.mkdir(storePath, { recursive: true, mode: 0o700 });
  const rootStats = await fsp.lstat(storePath);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the configured store root is not a non-symbolic-link directory',
    );
  }
  const staging = await fsp.mkdtemp(
    join(storePath, '.wharfie-application-state-hydration-'),
  );
  await fsp.chmod(staging, 0o700);
  let committed = false;
  let durabilityComplete = false;
  let destinationCreated = false;
  let incompleteTargetRemoved = true;
  /** @type {Readonly<Record<string, any>> | null} */
  let ownedClaim = null;
  try {
    await writeAndSync(join(staging, 'data.mdb'), bytes);
    await writeAndSync(
      join(staging, hydrationEvidenceName(snapshotId)),
      Buffer.from(`${snapshotId}\n`, 'utf8'),
    );
    await syncDirectory(staging);
    await syncDirectory(storePath);
    await observePhase('hydration-staged');
    const claimed = await createHydrationClaim(storePath, snapshotId);
    if (!claimed.owned) {
      if (await waitForHydrationClaim(storePath, snapshotId)) return false;
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'a concurrent hydration ended without a committed target',
      );
    }
    ownedClaim = claimed.claim;
    const destination = join(storePath, 'lmdb');
    try {
      await fsp.mkdir(destination, { mode: 0o700 });
      destinationCreated = true;
      incompleteTargetRemoved = false;
    } catch (error) {
      if (/** @type {{code?: unknown}} */ (error)?.code === 'EEXIST') {
        return false;
      }
      throw error;
    }
    await syncDirectory(storePath);
    await observePhase('hydration-target-created');
    await fsp.link(join(staging, 'data.mdb'), join(destination, 'data.mdb'));
    await syncDirectory(destination);
    await fsp.link(
      join(staging, hydrationEvidenceName(snapshotId)),
      join(destination, hydrationEvidenceName(snapshotId)),
    );
    // From this atomic link onward the visible target is recoverable and must
    // never be removed by caught cleanup. Directory syncs below, or an exact
    // contender observing the retained claim, finish its durable commit.
    committed = true;
    await observePhase('hydration-evidence-linked');
    await syncDirectory(destination);
    await syncDirectory(storePath);
    durabilityComplete = true;
    await releaseHydrationClaim(storePath, ownedClaim);
    ownedClaim = null;
  } finally {
    if (!committed && destinationCreated) {
      try {
        await fsp.rm(join(storePath, 'lmdb'), {
          force: true,
          recursive: true,
        });
        await syncDirectory(storePath);
        incompleteTargetRemoved = true;
      } catch {
        // Keep the durable claim when visible incomplete state could not be
        // removed. A retry then fails closed instead of reclassifying it.
      }
    }
    await removePrivateStaging(staging);
    if (
      ownedClaim &&
      ((!committed && incompleteTargetRemoved) || durabilityComplete)
    ) {
      try {
        await releaseHydrationClaim(storePath, ownedClaim);
      } catch {
        // A stale exact claim keeps later readers fail-closed.
      }
    }
  }
  return committed;
}

/** @param {unknown} value */
function normalizeTargetInspectionInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('application-state target inspection requires input');
  }
  const input = /** @type {Record<string, any>} */ (value);
  const keys = Object.keys(input);
  if (
    keys.length !== 6 ||
    keys.some(
      (key) =>
        ![
          'configuration',
          'transport',
          'authority',
          'replicaId',
          'bytesMatch',
          'hydrationStatus',
        ].includes(key),
    )
  ) {
    throw new TypeError(
      'application-state target inspection has unsupported fields',
    );
  }
  const configuration = validateApplicationStateStoreConfiguration(
    input.configuration,
  );
  const transport = normalizeApplicationStateSnapshotTransport(input.transport);
  const authority = assertCoordinatorAuthorityToken(
    input.authority,
    'application-state target inspection authority',
  );
  scopedDestination(
    transport.snapshot.destination,
    configuration,
    authority.appId,
  );
  assertDomainSeparatedSha256Id(
    input.replicaId,
    'wasr1',
    'application-state target inspection replicaId',
  );
  if (
    typeof input.bytesMatch !== 'boolean' ||
    (input.hydrationStatus !== APPLICATION_STATE_TRANSPORT_RETAINED_STATUS &&
      input.hydrationStatus !== APPLICATION_STATE_TRANSPORT_HYDRATED_STATUS)
  ) {
    throw new TypeError(
      'application-state target inspection status is invalid',
    );
  }
  return Object.freeze({
    configuration,
    transport,
    authority,
    replicaId: input.replicaId,
    bytesMatch: input.bytesMatch,
    hydrationStatus: input.hydrationStatus,
  });
}

/** @param {ReturnType<typeof normalizeTargetInspectionInput>} input */
async function inspectTargetLocally(input) {
  const { configuration, transport, authority, replicaId } = input;
  const destination = transport.snapshot.destination;
  const retainedHydrationStatus = await readHydrationStatus(
    configuration.storePath,
    transport.snapshot.snapshotId,
  );
  if (retainedHydrationStatus !== input.hydrationStatus) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'hydration evidence changed before target inspection',
    );
  }
  const activationIntent = input.bytesMatch
    ? null
    : await readLocalActivationIntent({
        configuration,
        transport,
        authority,
        replicaId,
      });
  if (!input.bytesMatch && !activationIntent) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'local data differs from the immutable snapshot without exact activation provenance',
    );
  }
  try {
    const applicationState = await openApplicationStateDB({
      configuration,
      readOnly: true,
    });
    try {
      const table = createApplicationStateTable({
        db: applicationState.db,
        tableName: applicationState.context.tableName,
      });
      await table.assertStoreIdentity(destination.configuration.storeId);
      const markerKey = createApplicationStateSnapshotMarkerRecord({
        destination,
        transferId: transport.snapshot.transferId,
        checkpoint: transport.snapshot.checkpoint,
      });
      const marker = await readMarker(
        applicationState.db,
        applicationState.context.tableName,
        markerKey.resource_id,
        markerKey.sort_key,
      );
      if (!marker) {
        throw new ApplicationStateSnapshotTargetCorruptionError(
          'the pinned checkpoint marker is missing',
        );
      }
      assertApplicationStateSnapshotMarkerMatchesTransport(marker, transport);
      const retirement = await table.readStoreRetirement({
        storeId: destination.configuration.storeId,
        namespace: destination.configuration.namespace,
      });
      if (retirement) {
        if (retirement.retirement_id !== transport.snapshot.transferId) {
          throw new ApplicationStateSnapshotTargetCorruptionError(
            'the retained source was retired by another transfer',
          );
        }
        let seal;
        try {
          seal = normalizeApplicationStateSnapshotSourceSeal(
            JSON.parse(retirement.retirement_artifact),
          );
        } catch (cause) {
          throw new ApplicationStateSnapshotTargetCorruptionError(
            'the local source seal failed validation',
            { cause },
          );
        }
        const expectedSeal = createApplicationStateSnapshotSourceSeal({
          distribution: transport.distribution,
          destination,
          transferId: transport.snapshot.transferId,
          checkpoint: transport.snapshot.checkpoint,
        });
        if (!sameJson(seal, expectedSeal) || !input.bytesMatch) {
          throw new ApplicationStateSnapshotTargetCorruptionError(
            'the sealed local data does not exactly match the receipt snapshot',
          );
        }
        return Object.freeze({ state: 'SEALED' });
      }
      const activation = await table.readStoreActivation({
        storeId: destination.configuration.storeId,
        namespace: destination.configuration.namespace,
      });
      if (!activation) {
        throw new ApplicationStateSnapshotTargetCorruptionError(
          'an unsealed target has no receipt-pinned activation evidence',
        );
      }
      const expectedActivation = createApplicationStateActivationRecord({
        storeId: destination.configuration.storeId,
        namespace: destination.configuration.namespace,
        transferId: transport.snapshot.transferId,
        snapshotId: transport.snapshot.snapshotId,
        distributionId: transport.distribution.distributionId,
        replicaId,
        transportStatus: input.hydrationStatus,
        authority,
      });
      const current = await table.readCoordinatorAuthority({
        storeId: destination.configuration.storeId,
        namespace: destination.configuration.namespace,
      });
      const expectedAuthority =
        createApplicationStateCoordinatorAuthorityRecord({
          storeId: destination.configuration.storeId,
          namespace: destination.configuration.namespace,
          authority,
        });
      if (
        activation.record_digest !== expectedActivation.record_digest ||
        current?.record_digest !== expectedAuthority.record_digest ||
        activation.transport_status !== input.hydrationStatus ||
        (activationIntent &&
          activation.transport_status !== activationIntent.transport_status)
      ) {
        throw new ApplicationStateSnapshotTargetCorruptionError(
          'active target evidence does not match the receipt, replica, and current authority',
        );
      }
      return Object.freeze({
        state: 'ACTIVE',
        status: activation.transport_status,
      });
    } finally {
      await applicationState.close();
    }
  } catch (cause) {
    if (cause instanceof ApplicationStateSnapshotTargetCorruptionError) {
      throw cause;
    }
    if (cause instanceof ApplicationStateStoreIdentityError) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'the retained store identity does not match the receipt',
        { cause },
      );
    }
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the local LMDB target could not be verified',
      { cause },
    );
  }
}

/** @param {ReturnType<typeof normalizeTargetInspectionInput>} input */
async function inspectTargetInIsolatedProcess(input) {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), TARGET_PROBE_ARGUMENT],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '';
    let outputBytes = 0;
    let settled = false;
    /** @param {() => void} callback */
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() =>
        reject(
          new ApplicationStateSnapshotTargetCorruptionError(
            'isolated LMDB target inspection timed out',
          ),
        ),
      );
    }, TARGET_PROBE_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      outputBytes += Buffer.byteLength(chunk, 'utf8');
      if (outputBytes > TARGET_PROBE_MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(() =>
          reject(
            new ApplicationStateSnapshotTargetCorruptionError(
              'isolated LMDB target inspection exceeded its output bound',
            ),
          ),
        );
        return;
      }
      output += chunk;
    });
    child.stderr.resume();
    child.once('error', (cause) => {
      finish(() =>
        reject(
          new ApplicationStateSnapshotTargetCorruptionError(
            'isolated LMDB target inspection could not start',
            { cause },
          ),
        ),
      );
    });
    child.once('close', (code, signal) => {
      finish(() => {
        if (code !== 0) {
          reject(
            new ApplicationStateSnapshotTargetCorruptionError(
              `isolated LMDB target inspection failed (${signal || code})`,
            ),
          );
          return;
        }
        try {
          const response = JSON.parse(output);
          if (
            !response ||
            response.ok !== true ||
            !response.result ||
            !['SEALED', 'ACTIVE'].includes(response.result.state)
          ) {
            throw new TypeError('invalid target-probe response');
          }
          resolve(Object.freeze(response.result));
        } catch (cause) {
          reject(
            new ApplicationStateSnapshotTargetCorruptionError(
              'isolated LMDB target inspection returned invalid evidence',
              { cause },
            ),
          );
        }
      });
    });
    child.stdin.end(JSON.stringify(input));
  });
}

/** @param {{configuration: ReturnType<typeof validateApplicationStateStoreConfiguration>, transport: ReturnType<typeof normalizeApplicationStateSnapshotTransport>, authority: ReturnType<typeof assertCoordinatorAuthorityToken>, replicaId: string, bytesMatch: boolean, hydrationStatus: 'RETAINED'|'HYDRATED'}} input */
async function inspectTarget(input) {
  const normalized = normalizeTargetInspectionInput(input);
  return normalized.bytesMatch
    ? await inspectTargetLocally(normalized)
    : await inspectTargetInIsolatedProcess(normalized);
}

/** @param {{configuration: ReturnType<typeof validateApplicationStateStoreConfiguration>, transport: ReturnType<typeof normalizeApplicationStateSnapshotTransport>, authority: ReturnType<typeof assertCoordinatorAuthorityToken>, replicaId: string, status: 'RETAINED'|'HYDRATED', observePhase: (phase: string) => Promise<void>}} input */
async function activateSealedTarget(input) {
  const destination = input.transport.snapshot.destination;
  const applicationState = await openApplicationStateDB({
    configuration: input.configuration,
  });
  try {
    const table = createApplicationStateTable({
      db: applicationState.db,
      tableName: applicationState.context.tableName,
      coordinatorAuthority: input.authority,
    });
    await table.reactivateRetiredStore({
      storeId: destination.configuration.storeId,
      namespace: destination.configuration.namespace,
      retirementId: input.transport.snapshot.transferId,
      snapshotId: input.transport.snapshot.snapshotId,
      distributionId: input.transport.distribution.distributionId,
      replicaId: input.replicaId,
      transportStatus: input.status,
    });
    await input.observePhase('destination-adopted');
  } finally {
    await applicationState.close();
  }
}

/**
 * Keep a valid retained LMDB volume or hydrate a genuinely absent one from
 * the receipt-pinned immutable artifact. Existing corruption is never hidden
 * by a replica fallback.
 * @param {{configuration: unknown, controlContext: Record<string, any>, transport: unknown, history: unknown, closedBarrier: unknown, coordinatorAuthority: unknown, distribution: unknown, signal?: AbortSignal, observePhase?: (phase: string) => Promise<void> | void}} options
 */
export async function transportApplicationStateSnapshot(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Application-state snapshot transport requires options.',
    );
  }
  const allowed = new Set([
    'configuration',
    'controlContext',
    'transport',
    'history',
    'closedBarrier',
    'coordinatorAuthority',
    'distribution',
    'signal',
    'observePhase',
  ]);
  if (Object.keys(options).some((key) => !allowed.has(key))) {
    throw new TypeError(
      'Application-state snapshot transport has unsupported options.',
    );
  }
  const configuration = validateApplicationStateStoreConfiguration(
    options.configuration,
  );
  const controlContext = snapshotControlContext(options.controlContext);
  const transport = normalizeApplicationStateSnapshotTransport(
    options.transport,
  );
  const history = validateApplicationStateHistoryCheckpoint(options.history);
  assertSettledApplicationStateHistory(history);
  if (!sameJson(history, transport.snapshot.checkpoint.history)) {
    throw new Error(
      'Current application-state history does not match the receipt-pinned checkpoint.',
    );
  }
  const authority = assertCoordinatorAuthorityToken(
    options.coordinatorAuthority,
    'application-state snapshot replacement authority',
  );
  const closedBarrier = assertCoordinatorQuiescenceBarrierSnapshot(
    options.closedBarrier,
    'application-state snapshot replacement closedBarrier',
  );
  if (
    closedBarrier.state !== CoordinatorQuiescenceBarrierState.CLOSED ||
    closedBarrier.appId !== history.appId ||
    !sameAuthority(closedBarrier.authority, authority) ||
    closedBarrier.version < transport.snapshot.checkpoint.sourceBarrier.version
  ) {
    throw new TypeError(
      'Application-state snapshot transport requires a current CLOSED barrier covering the source checkpoint.',
    );
  }
  const destination = scopedDestination(
    transport.snapshot.destination,
    configuration,
    history.appId,
  );
  assertApplicationStateStoreIsolation(configuration, controlContext);
  assertApplicationStateSnapshotDistribution(options.distribution);
  const distribution = options.distribution;
  if (!sameJson(distribution.identity, transport.distribution)) {
    throw new TypeError(
      'Application-state snapshot distribution capability does not match the receipt.',
    );
  }
  const observePhase = normalizeObserver(options.observePhase);
  const signal = options.signal;
  throwIfAborted(signal);
  await assertCoordinatorAuthorityCurrent({
    db: controlContext.db,
    tableName: controlContext.tableName,
    authority,
  });
  await assertDurableBarrierExact(controlContext, closedBarrier);
  const replicaId = await ensurePhysicalReplicaId(configuration.storePath);
  const dbRoot = resolve(configuration.storePath, 'lmdb');
  await waitForHydrationClaim(
    configuration.storePath,
    transport.snapshot.snapshotId,
  );
  const retained = await assertExistingLmdbRoot(dbRoot);
  if (!retained) {
    const bytes = await distribution.readBytes(transport.snapshot);
    verifyApplicationStateSnapshotReference(transport.snapshot, bytes);
    throwIfAborted(signal);
    const committed = await hydrateAbsentTarget(
      configuration.storePath,
      bytes,
      transport.snapshot.snapshotId,
      observePhase,
    );
    if (committed) await observePhase('hydration-committed');
  }
  throwIfAborted(signal);
  if (!(await assertExistingLmdbRoot(dbRoot))) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'hydration did not publish an LMDB target',
    );
  }
  let bytesMatch = false;
  const localBytes = await readSealedLmdbData(dbRoot);
  try {
    verifyApplicationStateSnapshotReference(
      transport.snapshot,
      localBytes,
      'local application-state snapshot',
    );
    bytesMatch = true;
  } catch {
    // An activated target has local authority/evidence writes after the
    // immutable bytes. Its native inspection runs only in an isolated child.
  }
  const hydrationStatus = await readHydrationStatus(
    configuration.storePath,
    transport.snapshot.snapshotId,
  );
  const inspected = await inspectTarget({
    configuration,
    transport,
    authority,
    replicaId,
    bytesMatch,
    hydrationStatus,
  });
  const controlStore = createApplicationStateSnapshotControlStore({
    db: controlContext.db,
    tableName: controlContext.tableName,
  });
  const publication = await controlStore.getPublication({
    transferId: transport.snapshot.transferId,
  });
  if (!publication || !sameJson(publication.transport, transport)) {
    throw new Error(
      'Application-state snapshot has no matching durable publication evidence.',
    );
  }
  const status = hydrationStatus;
  await controlStore.claimActivation(
    {
      transport,
      replacementAuthority: authority,
      replacementBarrier: closedBarrier,
      replicaId,
      transportStatus: status,
    },
    { requireExisting: inspected.state === 'ACTIVE' },
  );
  if (inspected.state === 'SEALED') {
    await persistLocalActivationIntent({
      configuration,
      transport,
      authority,
      replicaId,
      status,
    });
    await activateSealedTarget({
      configuration,
      transport,
      authority,
      replicaId,
      status,
      observePhase,
    });
  }
  const activated = await inspectTarget({
    configuration,
    transport,
    authority,
    replicaId,
    bytesMatch: false,
    hydrationStatus,
  });
  if (activated.state !== 'ACTIVE' || activated.status !== status) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'destination activation evidence was not durably readable',
    );
  }
  const readiness = createApplicationStateTransportReadiness({
    status,
    destination,
    transport,
    coordinatorAuthority: authority,
  });
  await assertCoordinatorAuthorityCurrent({
    db: controlContext.db,
    tableName: controlContext.tableName,
    authority,
  });
  await assertDurableBarrierExact(controlContext, closedBarrier);
  throwIfAborted(signal);
  // Retain the normalized destination as a final exact-scope assertion.
  if (!sameJson(readiness.destination, destination)) {
    throw new Error(
      'Application-state transport readiness changed destination.',
    );
  }
  return readiness;
}

/** Run the bounded child-only native target inspection protocol. */
async function runTargetProbeProcess() {
  try {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > TARGET_PROBE_MAX_OUTPUT_BYTES) {
        throw new RangeError('target-probe input exceeded its bound');
      }
      chunks.push(bytes);
    }
    const input = normalizeTargetInspectionInput(
      JSON.parse(Buffer.concat(chunks).toString('utf8')),
    );
    const result = await inspectTargetLocally(input);
    process.stdout.write(JSON.stringify({ ok: true, result }));
  } catch {
    process.stdout.write(JSON.stringify({ ok: false }));
    process.exitCode = 1;
  }
}

if (process.argv[2] === TARGET_PROBE_ARGUMENT) {
  await runTargetProbeProcess();
}

export default {
  publishApplicationStateSnapshot,
  recoverRetiredApplicationStateSnapshot,
  transportApplicationStateSnapshot,
};
