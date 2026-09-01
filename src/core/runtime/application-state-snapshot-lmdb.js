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
import { cloneBoundedJsonObject } from './json-value.js';
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
  'hydration-recovery-recorded',
  'hydration-recovery-target-removed',
  'hydration-recovery-claim-released',
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
const HYDRATION_RECOVERY_FILE_PREFIX =
  '.wharfie-application-state-snapshot-hydration-recovery';
const HYDRATION_RECOVERY_RECEIPT_FILE_PREFIX = `${HYDRATION_RECOVERY_FILE_PREFIX}-receipt`;
const HYDRATION_RECOVERY_CANDIDATE_FILE_PREFIX = `${HYDRATION_RECOVERY_FILE_PREFIX}-candidate`;
const HYDRATION_RECOVERY_RETIRED_TARGET_PREFIX = `${HYDRATION_RECOVERY_FILE_PREFIX}-retired-target`;
const HYDRATION_RECOVERY_RETIRED_CLAIM_PREFIX = `${HYDRATION_RECOVERY_FILE_PREFIX}-retired-claim`;
const HYDRATION_RECOVERY_KIND =
  'wharfie.application-state-snapshot-hydration-recovery.v1';
const HYDRATION_RECOVERY_ID_PREFIX = 'washr1';
const HYDRATION_RECOVERY_INSPECTION_KIND =
  'wharfie.application-state-snapshot-hydration-recovery-inspection.v1';
const HYDRATION_RECOVERY_INSPECTION_ID_PREFIX = 'washri1';
const HYDRATION_RECOVERY_MAX_RECORD_BYTES = 256 * 1024;
const HYDRATION_RECOVERY_MAX_RECEIPTS = 128;
const HYDRATION_RECOVERY_STATES = new Set([
  'PARTIAL_TARGET',
  'RECOVERY_RECORDED',
  'TARGET_REMOVED',
  'RECOVERED',
]);
const HYDRATION_RECOVERY_RECORD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'recoveryId',
  'transport',
  'claim',
  'replicaId',
  'filesystem',
  'replacementBarrier',
  'replacementAuthority',
]);
const HYDRATION_RECOVERY_INSPECTION_KEYS = new Set([
  'schemaVersion',
  'kind',
  'inspectionId',
  'state',
  'recovery',
]);
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

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

/** @param {unknown} value @param {Set<string>} keys @param {string} label */
function exactRecoveryObject(value, keys, label) {
  const object = cloneBoundedJsonObject(
    value,
    HYDRATION_RECOVERY_MAX_RECORD_BYTES,
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

/** @param {bigint} value @param {string} label */
function canonicalStatInteger(value, label) {
  const canonical = value.toString(10);
  if (!/^(0|[1-9][0-9]*)$/.test(canonical)) {
    throw new TypeError(`${label} is not one canonical nonnegative integer.`);
  }
  return canonical;
}

/** @param {unknown} value @param {boolean} includeSize @param {string} label */
function normalizeFilesystemIdentity(value, includeSize, label) {
  const keys = new Set(
    includeSize ? ['device', 'inode', 'size'] : ['device', 'inode'],
  );
  const identity = exactRecoveryObject(value, keys, label);
  for (const key of keys) {
    if (
      typeof identity[key] !== 'string' ||
      !/^(0|[1-9][0-9]*)$/.test(identity[key])
    ) {
      throw new TypeError(
        `${label}.${key} must be a canonical decimal integer.`,
      );
    }
  }
  return deepFreeze(sortCanonicalJsonValue(identity));
}

/** @param {import('node:fs').BigIntStats} stats @param {boolean} includeSize @param {string} label */
function filesystemIdentityFromStats(stats, includeSize, label) {
  return normalizeFilesystemIdentity(
    {
      device: canonicalStatInteger(stats.dev, `${label}.device`),
      inode: canonicalStatInteger(stats.ino, `${label}.inode`),
      ...(includeSize
        ? { size: canonicalStatInteger(stats.size, `${label}.size`) }
        : {}),
    },
    includeSize,
    label,
  );
}

/** @param {unknown} value */
function normalizeHydrationRecoveryFilesystem(value) {
  const filesystem = exactRecoveryObject(
    value,
    new Set(['storeRoot', 'claimFile', 'targetDirectory']),
    'application-state hydration recovery filesystem',
  );
  return deepFreeze(
    sortCanonicalJsonValue({
      storeRoot: normalizeFilesystemIdentity(
        filesystem.storeRoot,
        false,
        'application-state hydration recovery filesystem storeRoot',
      ),
      claimFile: normalizeFilesystemIdentity(
        filesystem.claimFile,
        true,
        'application-state hydration recovery filesystem claimFile',
      ),
      targetDirectory: normalizeFilesystemIdentity(
        filesystem.targetDirectory,
        false,
        'application-state hydration recovery filesystem targetDirectory',
      ),
    }),
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
async function readPhysicalReplicaId(storePath) {
  let rootStats;
  try {
    rootStats = await fsp.lstat(storePath);
  } catch (cause) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the configured store root is unavailable for hydration recovery',
      { cause },
    );
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the configured store root is not a non-symbolic-link directory',
    );
  }
  const value = (
    await readSmallRegularFile(
      join(storePath, REPLICA_ID_FILE),
      128,
      'physical replica identity',
    )
  )
    .toString('utf8')
    .trim();
  assertDomainSeparatedSha256Id(
    value,
    'wasr1',
    'application-state physical replica id',
  );
  return value;
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

/** @param {string} snapshotId @param {string} recoveryId */
function hydrationRecoveryName(snapshotId, recoveryId) {
  assertDomainSeparatedSha256Id(
    snapshotId,
    'wass1',
    'application-state hydration recovery snapshotId',
  );
  assertDomainSeparatedSha256Id(
    recoveryId,
    HYDRATION_RECOVERY_ID_PREFIX,
    'application-state hydration recovery recoveryId',
  );
  return `${HYDRATION_RECOVERY_RECEIPT_FILE_PREFIX}-${snapshotId}-${recoveryId}`;
}

/** @param {string} snapshotId @param {string} recoveryId */
function hydrationRecoveryRetiredTargetName(snapshotId, recoveryId) {
  hydrationRecoveryName(snapshotId, recoveryId);
  return `${HYDRATION_RECOVERY_RETIRED_TARGET_PREFIX}-${snapshotId}-${recoveryId}`;
}

/** @param {string} snapshotId @param {string} recoveryId */
function hydrationRecoveryRetiredClaimName(snapshotId, recoveryId) {
  hydrationRecoveryName(snapshotId, recoveryId);
  return `${HYDRATION_RECOVERY_RETIRED_CLAIM_PREFIX}-${snapshotId}-${recoveryId}`;
}

/** @param {{transport: unknown, claim: unknown, replicaId: unknown, filesystem: unknown, replacementBarrier: unknown, replacementAuthority: unknown}} input */
function createHydrationRecoveryRecord(input) {
  const transport = normalizeApplicationStateSnapshotTransport(input.transport);
  const claim = validateHydrationClaimRecord(input.claim);
  assertDomainSeparatedSha256Id(
    input.replicaId,
    'wasr1',
    'application-state hydration recovery replicaId',
  );
  const filesystem = normalizeHydrationRecoveryFilesystem(input.filesystem);
  const replacementBarrier = assertCoordinatorQuiescenceBarrierSnapshot(
    input.replacementBarrier,
    'application-state hydration recovery replacementBarrier',
  );
  const replacementAuthority = assertCoordinatorAuthorityToken(
    input.replacementAuthority,
    'application-state hydration recovery replacementAuthority',
  );
  const appId = transport.snapshot.destination.configuration.namespace;
  if (
    claim.snapshotId !== transport.snapshot.snapshotId ||
    replacementBarrier.state !== CoordinatorQuiescenceBarrierState.CLOSED ||
    replacementBarrier.appId !== appId ||
    replacementAuthority.appId !== appId ||
    !sameAuthority(replacementBarrier.authority, replacementAuthority) ||
    replacementBarrier.version <
      transport.snapshot.checkpoint.sourceBarrier.version
  ) {
    throw new TypeError(
      'Application-state hydration recovery record does not match its exact snapshot, CLOSED barrier, and authority.',
    );
  }
  const payload = {
    schemaVersion: 1,
    kind: HYDRATION_RECOVERY_KIND,
    transport,
    claim,
    replicaId: input.replicaId,
    filesystem,
    replacementBarrier,
    replacementAuthority,
  };
  const recoveryId = createCanonicalJsonSha256Id({
    domain: 'wharfie:application-state-snapshot-hydration-recovery:v1',
    prefix: HYDRATION_RECOVERY_ID_PREFIX,
    value: payload,
    valuePath: 'application-state hydration recovery record',
  });
  return deepFreeze(
    sortCanonicalJsonValue(
      cloneBoundedJsonObject(
        { ...payload, recoveryId },
        HYDRATION_RECOVERY_MAX_RECORD_BYTES,
        'application-state hydration recovery record',
      ),
    ),
  );
}

/** @param {unknown} value */
function validateHydrationRecoveryRecord(value) {
  const record = exactRecoveryObject(
    value,
    HYDRATION_RECOVERY_RECORD_KEYS,
    'application-state hydration recovery record',
  );
  if (record.schemaVersion !== 1 || record.kind !== HYDRATION_RECOVERY_KIND) {
    throw new TypeError(
      'Application-state hydration recovery record contract is invalid.',
    );
  }
  assertDomainSeparatedSha256Id(
    record.recoveryId,
    HYDRATION_RECOVERY_ID_PREFIX,
    'application-state hydration recovery record recoveryId',
  );
  const expected = createHydrationRecoveryRecord({
    transport: record.transport,
    claim: record.claim,
    replicaId: record.replicaId,
    filesystem: record.filesystem,
    replacementBarrier: record.replacementBarrier,
    replacementAuthority: record.replacementAuthority,
  });
  if (!sameJson(record, expected)) {
    throw new TypeError(
      'Application-state hydration recovery record integrity is invalid.',
    );
  }
  return expected;
}

/** @param {'PARTIAL_TARGET'|'RECOVERY_RECORDED'|'TARGET_REMOVED'|'RECOVERED'} state @param {ReturnType<typeof createHydrationRecoveryRecord>} recovery */
function createHydrationRecoveryInspection(state, recovery) {
  if (!HYDRATION_RECOVERY_STATES.has(state)) {
    throw new TypeError(
      'Application-state hydration recovery inspection state is invalid.',
    );
  }
  const payload = {
    schemaVersion: 1,
    kind: HYDRATION_RECOVERY_INSPECTION_KIND,
    state,
    recovery,
  };
  const inspectionId = createCanonicalJsonSha256Id({
    domain:
      'wharfie:application-state-snapshot-hydration-recovery-inspection:v1',
    prefix: HYDRATION_RECOVERY_INSPECTION_ID_PREFIX,
    value: payload,
    valuePath: 'application-state hydration recovery inspection',
  });
  return deepFreeze(
    sortCanonicalJsonValue(
      cloneBoundedJsonObject(
        { ...payload, inspectionId },
        HYDRATION_RECOVERY_MAX_RECORD_BYTES,
        'application-state hydration recovery inspection',
      ),
    ),
  );
}

/** @param {unknown} value */
function validateHydrationRecoveryInspection(value) {
  const inspection = exactRecoveryObject(
    value,
    HYDRATION_RECOVERY_INSPECTION_KEYS,
    'application-state hydration recovery inspection',
  );
  if (
    inspection.schemaVersion !== 1 ||
    inspection.kind !== HYDRATION_RECOVERY_INSPECTION_KIND ||
    !HYDRATION_RECOVERY_STATES.has(inspection.state)
  ) {
    throw new TypeError(
      'Application-state hydration recovery inspection contract is invalid.',
    );
  }
  assertDomainSeparatedSha256Id(
    inspection.inspectionId,
    HYDRATION_RECOVERY_INSPECTION_ID_PREFIX,
    'application-state hydration recovery inspection inspectionId',
  );
  const expected = createHydrationRecoveryInspection(
    inspection.state,
    validateHydrationRecoveryRecord(inspection.recovery),
  );
  if (!sameJson(inspection, expected)) {
    throw new TypeError(
      'Application-state hydration recovery inspection integrity is invalid.',
    );
  }
  return expected;
}

/** @param {string} storePath @param {string} snapshotId @param {string} recoveryId */
async function readHydrationRecoveryRecord(storePath, snapshotId, recoveryId) {
  try {
    return validateHydrationRecoveryRecord(
      JSON.parse(
        (
          await readSmallRegularFile(
            join(storePath, hydrationRecoveryName(snapshotId, recoveryId)),
            HYDRATION_RECOVERY_MAX_RECORD_BYTES,
            'hydration recovery record',
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
      'hydration recovery record failed validation',
      { cause },
    );
  }
}

/** @param {string} storePath */
async function inspectHydrationRecoveryStoreRoot(storePath) {
  let stats;
  try {
    stats = await fsp.lstat(storePath, { bigint: true });
  } catch (cause) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the configured store root is unavailable for hydration recovery',
      { cause },
    );
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the configured store root is not a non-symbolic-link directory',
    );
  }
  return filesystemIdentityFromStats(
    stats,
    false,
    'application-state hydration recovery store root',
  );
}

/** @param {string} path @param {string} label */
async function readHydrationRecoveryClaimEvidenceAtPath(path, label) {
  let before;
  try {
    before = await fsp.lstat(path, { bigint: true });
  } catch (cause) {
    if (isNotFound(cause)) return null;
    throw cause;
  }
  let claim;
  try {
    claim = validateHydrationClaimRecord(
      JSON.parse(
        (
          await readSmallRegularFile(path, 1024, `${label} hydration claim`)
        ).toString('utf8'),
      ),
    );
  } catch (cause) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      `${label} hydration claim failed validation`,
      { cause },
    );
  }
  const after = await fsp.lstat(path, { bigint: true });
  const beforeIdentity = filesystemIdentityFromStats(
    before,
    true,
    `${label} hydration claim file`,
  );
  const afterIdentity = filesystemIdentityFromStats(
    after,
    true,
    `${label} hydration claim file`,
  );
  if (!sameJson(beforeIdentity, afterIdentity)) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the hydration claim file changed while it was inspected',
    );
  }
  return Object.freeze({ claim, identity: beforeIdentity });
}

/** @param {string} storePath */
async function readHydrationRecoveryClaimEvidence(storePath) {
  return await readHydrationRecoveryClaimEvidenceAtPath(
    join(storePath, HYDRATION_CLAIM_FILE),
    'active',
  );
}

/** @param {string} target @param {string} label */
async function inspectEmptyHydrationDirectory(target, label) {
  let before;
  try {
    before = await fsp.lstat(target, { bigint: true });
  } catch (cause) {
    if (isNotFound(cause)) return null;
    throw cause;
  }
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the pre-evidence hydration target is not a non-symbolic-link directory',
    );
  }
  const entries = await fsp.readdir(target);
  const after = await fsp.lstat(target, { bigint: true });
  const beforeIdentity = filesystemIdentityFromStats(
    before,
    false,
    `${label} hydration target directory`,
  );
  const afterIdentity = filesystemIdentityFromStats(
    after,
    false,
    `${label} hydration target directory`,
  );
  if (
    entries.length !== 0 ||
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    !sameJson(beforeIdentity, afterIdentity)
  ) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the pre-evidence hydration target is not one stable empty directory',
    );
  }
  return beforeIdentity;
}

/** @param {string} storePath */
async function inspectEmptyHydrationTarget(storePath) {
  return await inspectEmptyHydrationDirectory(
    join(storePath, 'lmdb'),
    'active',
  );
}

/** @param {{configuration: ReturnType<typeof validateApplicationStateStoreConfiguration>, controlContext: ReturnType<typeof snapshotControlContext>, transport: ReturnType<typeof normalizeApplicationStateSnapshotTransport>, closedBarrier: ReturnType<typeof assertCoordinatorQuiescenceBarrierSnapshot>, authority: ReturnType<typeof assertCoordinatorAuthorityToken>}} scope */
async function assertHydrationRecoveryControlState(scope) {
  await assertCoordinatorAuthorityCurrent({
    db: scope.controlContext.db,
    tableName: scope.controlContext.tableName,
    authority: scope.authority,
  });
  await assertDurableBarrierExact(scope.controlContext, scope.closedBarrier);
  const controlStore = createApplicationStateSnapshotControlStore({
    db: scope.controlContext.db,
    tableName: scope.controlContext.tableName,
  });
  const publication = await controlStore.getPublication({
    transferId: scope.transport.snapshot.transferId,
  });
  if (!publication || !sameJson(publication.transport, scope.transport)) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'hydration recovery requires exact durable snapshot publication evidence',
    );
  }
  const activation = await controlStore.getActivationClaim({
    transferId: scope.transport.snapshot.transferId,
  });
  if (activation) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'hydration recovery is forbidden after physical replica activation',
    );
  }
}

const HYDRATION_RECOVERY_SNAPSHOT_ID_LENGTH = 'wass1_'.length + 43;
const HYDRATION_RECOVERY_ID_LENGTH =
  `${HYDRATION_RECOVERY_ID_PREFIX}_`.length + 43;
const HYDRATION_RECOVERY_TEMPORARY_SUFFIX_PATTERN =
  /^-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/u;

/** @param {string} name @param {string} prefix */
function parseHydrationRecoveryArtifactIds(name, prefix) {
  const artifactPrefix = `${prefix}-`;
  if (!name.startsWith(artifactPrefix)) return null;
  const suffix = name.slice(artifactPrefix.length);
  const snapshotId = suffix.slice(0, HYDRATION_RECOVERY_SNAPSHOT_ID_LENGTH);
  const separator = suffix[HYDRATION_RECOVERY_SNAPSHOT_ID_LENGTH];
  const recoveryId = suffix.slice(
    HYDRATION_RECOVERY_SNAPSHOT_ID_LENGTH + 1,
    HYDRATION_RECOVERY_SNAPSHOT_ID_LENGTH + 1 + HYDRATION_RECOVERY_ID_LENGTH,
  );
  const remainder = suffix.slice(
    HYDRATION_RECOVERY_SNAPSHOT_ID_LENGTH + 1 + HYDRATION_RECOVERY_ID_LENGTH,
  );
  try {
    assertDomainSeparatedSha256Id(
      snapshotId,
      'wass1',
      'hydration recovery artifact snapshotId',
    );
    assertDomainSeparatedSha256Id(
      recoveryId,
      HYDRATION_RECOVERY_ID_PREFIX,
      'hydration recovery artifact recoveryId',
    );
  } catch (cause) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'a hydration recovery registry artifact name is malformed',
      { cause },
    );
  }
  if (separator !== '-') {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'a hydration recovery registry artifact name is malformed',
    );
  }
  return Object.freeze({ snapshotId, recoveryId, remainder });
}

/** @param {string} name */
function parseHydrationRecoveryRegistryArtifact(name) {
  const temporary = parseHydrationRecoveryArtifactIds(
    name,
    HYDRATION_RECOVERY_CANDIDATE_FILE_PREFIX,
  );
  if (temporary) {
    if (
      !HYDRATION_RECOVERY_TEMPORARY_SUFFIX_PATTERN.test(temporary.remainder)
    ) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'a hydration recovery private candidate name is malformed',
      );
    }
    return Object.freeze({ ...temporary, type: 'temporary' });
  }
  const receipt = parseHydrationRecoveryArtifactIds(
    name,
    HYDRATION_RECOVERY_RECEIPT_FILE_PREFIX,
  );
  if (receipt) {
    if (receipt.remainder === '') {
      return Object.freeze({ ...receipt, type: 'receipt' });
    }
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'a hydration recovery receipt name has an unsupported suffix',
    );
  }
  const retiredTarget = parseHydrationRecoveryArtifactIds(
    name,
    HYDRATION_RECOVERY_RETIRED_TARGET_PREFIX,
  );
  if (retiredTarget) {
    if (retiredTarget.remainder !== '') {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'a retired hydration target name has an unsupported suffix',
      );
    }
    return Object.freeze({ ...retiredTarget, type: 'retired-target' });
  }
  const retiredClaim = parseHydrationRecoveryArtifactIds(
    name,
    HYDRATION_RECOVERY_RETIRED_CLAIM_PREFIX,
  );
  if (retiredClaim) {
    if (retiredClaim.remainder !== '') {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'a retired hydration claim name has an unsupported suffix',
      );
    }
    return Object.freeze({ ...retiredClaim, type: 'retired-claim' });
  }
  if (name.startsWith(HYDRATION_RECOVERY_FILE_PREFIX)) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the hydration recovery registry contains an unknown artifact',
    );
  }
  return null;
}

/** @param {ReturnType<typeof validateHydrationRecoveryRecord>} recovery @param {string} replicaId @param {Readonly<Record<string, any>>} storeRootIdentity */
function assertHydrationRecoveryRegistryIdentity(
  recovery,
  replicaId,
  storeRootIdentity,
) {
  if (
    recovery.replicaId !== replicaId ||
    !sameJson(recovery.filesystem.storeRoot, storeRootIdentity)
  ) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'a hydration recovery receipt does not match the exact replica and store root',
    );
  }
}

/** @param {string} storePath @param {string} replicaId @param {Readonly<Record<string, any>>} storeRootIdentity */
async function readHydrationRecoveryRegistry(
  storePath,
  replicaId,
  storeRootIdentity,
) {
  const artifacts = new Map();
  for (const name of await fsp.readdir(storePath)) {
    const artifact = parseHydrationRecoveryRegistryArtifact(name);
    if (!artifact || artifact.type === 'temporary') continue;
    const retained = artifacts.get(artifact.recoveryId) ?? {};
    if (
      retained.snapshotId !== undefined &&
      retained.snapshotId !== artifact.snapshotId
    ) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'one recovery identity is aliased across snapshot registry names',
      );
    }
    retained.snapshotId = artifact.snapshotId;
    if (retained[artifact.type]) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'the hydration recovery registry contains duplicate evidence',
      );
    }
    retained[artifact.type] = true;
    artifacts.set(artifact.recoveryId, retained);
  }
  const receiptIds = [...artifacts.entries()]
    .filter(([, retained]) => retained.receipt)
    .map(([recoveryId]) => recoveryId)
    .sort();
  if (receiptIds.length > HYDRATION_RECOVERY_MAX_RECEIPTS) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the hydration recovery receipt registry exceeds its exact bounded capacity',
    );
  }
  for (const [recoveryId, retained] of artifacts) {
    if (!retained.receipt) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        `hydration recovery retirement evidence is orphaned for ${recoveryId}`,
      );
    }
  }
  const entries = [];
  for (const recoveryId of receiptIds) {
    const retained = artifacts.get(recoveryId);
    const snapshotId = retained.snapshotId;
    const recovery = await readHydrationRecoveryRecord(
      storePath,
      snapshotId,
      recoveryId,
    );
    if (
      !recovery ||
      recovery.recoveryId !== recoveryId ||
      recovery.transport.snapshot.snapshotId !== snapshotId
    ) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'a hydration recovery receipt does not match its exact registry name',
      );
    }
    assertHydrationRecoveryRegistryIdentity(
      recovery,
      replicaId,
      storeRootIdentity,
    );
    const retiredTarget = retained['retired-target']
      ? await inspectEmptyHydrationDirectory(
          join(
            storePath,
            hydrationRecoveryRetiredTargetName(snapshotId, recoveryId),
          ),
          'retired',
        )
      : null;
    const retiredClaim = retained['retired-claim']
      ? await readHydrationRecoveryClaimEvidenceAtPath(
          join(
            storePath,
            hydrationRecoveryRetiredClaimName(snapshotId, recoveryId),
          ),
          'retired',
        )
      : null;
    if (
      (retained['retired-target'] && !retiredTarget) ||
      (retained['retired-claim'] && !retiredClaim)
    ) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'hydration recovery retirement evidence disappeared during registry inspection',
      );
    }
    if (
      retiredTarget &&
      !sameJson(retiredTarget, recovery.filesystem.targetDirectory)
    ) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'a retired hydration target does not have its recorded exact identity',
      );
    }
    if (
      retiredClaim &&
      (!sameJson(retiredClaim.claim, recovery.claim) ||
        !sameJson(retiredClaim.identity, recovery.filesystem.claimFile))
    ) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'a retired hydration claim does not have its recorded exact identity and content',
      );
    }
    if (retiredClaim && !retiredTarget) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'a retired hydration claim exists without its ordered retired target',
      );
    }
    entries.push(
      Object.freeze({
        recovery,
        retiredTarget: retiredTarget !== null,
        retiredClaim: retiredClaim !== null,
        complete: retiredTarget !== null && retiredClaim !== null,
      }),
    );
  }
  const incomplete = entries.filter((entry) => !entry.complete);
  if (incomplete.length > 1) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the hydration recovery registry contains multiple incomplete attempts',
    );
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    incompleteRecoveryId: incomplete[0]?.recovery.recoveryId ?? null,
  });
}

/** @param {{configuration: ReturnType<typeof validateApplicationStateStoreConfiguration>, transport: ReturnType<typeof normalizeApplicationStateSnapshotTransport>}} scope @param {string} replicaId */
async function readHydrationRecoveryFilesystem(scope, replicaId) {
  const storePath = scope.configuration.storePath;
  const storeRootIdentity = await inspectHydrationRecoveryStoreRoot(storePath);
  const registry = await readHydrationRecoveryRegistry(
    storePath,
    replicaId,
    storeRootIdentity,
  );
  const claimEvidence = await readHydrationRecoveryClaimEvidence(storePath);
  const targetIdentity = await inspectEmptyHydrationTarget(storePath);
  return Object.freeze({
    storeRootIdentity,
    registry,
    claimEvidence,
    targetIdentity,
  });
}

/** @param {Readonly<Record<string, any>>} view @param {ReturnType<typeof validateHydrationRecoveryRecord>} recovery */
function assertActiveHydrationRecoveryAttempt(view, recovery) {
  if (
    !view.claimEvidence ||
    !view.targetIdentity ||
    !sameJson(view.claimEvidence.claim, recovery.claim) ||
    !sameJson(view.claimEvidence.identity, recovery.filesystem.claimFile) ||
    !sameJson(view.targetIdentity, recovery.filesystem.targetDirectory)
  ) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the active hydration target and claim do not match the exact recovery attempt',
    );
  }
}

/** @param {Readonly<Record<string, any>>} view @param {Readonly<Record<string, any>>} entry */
function classifyRetainedHydrationRecoveryAttempt(view, entry) {
  if (entry.complete) return 'RECOVERED';
  if (!entry.retiredTarget) {
    assertActiveHydrationRecoveryAttempt(view, entry.recovery);
    return 'RECOVERY_RECORDED';
  }
  if (
    view.targetIdentity ||
    !view.claimEvidence ||
    !sameJson(view.claimEvidence.claim, entry.recovery.claim) ||
    !sameJson(view.claimEvidence.identity, entry.recovery.filesystem.claimFile)
  ) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the active hydration claim does not match the target-retired recovery attempt',
    );
  }
  return 'TARGET_REMOVED';
}

/** @param {Readonly<Record<string, any>>} view */
function assertHydrationRecoveryRegistryViewCanonical(view) {
  /** @type {Array<{recovery: ReturnType<typeof validateHydrationRecoveryRecord>, retiredTarget: boolean, retiredClaim: boolean, complete: boolean}>} */
  const registryEntries = view.registry.entries;
  if (view.registry.incompleteRecoveryId) {
    const incomplete = registryEntries.find(
      (entry) =>
        entry.recovery.recoveryId === view.registry.incompleteRecoveryId,
    );
    if (!incomplete) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'the hydration recovery registry lost its incomplete attempt',
      );
    }
    classifyRetainedHydrationRecoveryAttempt(view, incomplete);
    return;
  }
  if (Boolean(view.claimEvidence) !== Boolean(view.targetIdentity)) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'active hydration evidence is not one canonical claim and empty-target pair',
    );
  }
}

/** @param {{transport: ReturnType<typeof normalizeApplicationStateSnapshotTransport>, closedBarrier: ReturnType<typeof assertCoordinatorQuiescenceBarrierSnapshot>, authority: ReturnType<typeof assertCoordinatorAuthorityToken>}} scope @param {ReturnType<typeof validateHydrationRecoveryRecord>} recovery */
function hydrationRecoveryMatchesCurrentScope(scope, recovery) {
  const expected = createHydrationRecoveryRecord({
    transport: scope.transport,
    claim: recovery.claim,
    replicaId: recovery.replicaId,
    filesystem: recovery.filesystem,
    replacementBarrier: scope.closedBarrier,
    replacementAuthority: scope.authority,
  });
  return sameJson(recovery, expected);
}

/** @param {{configuration: ReturnType<typeof validateApplicationStateStoreConfiguration>, transport: ReturnType<typeof normalizeApplicationStateSnapshotTransport>, closedBarrier: ReturnType<typeof assertCoordinatorQuiescenceBarrierSnapshot>, authority: ReturnType<typeof assertCoordinatorAuthorityToken>}} scope @param {string} replicaId @param {Readonly<Record<string, any>>} view @param {ReturnType<typeof validateHydrationRecoveryRecord> | null} requestedRecovery */
function selectHydrationRecoveryInspection(
  scope,
  replicaId,
  view,
  requestedRecovery,
) {
  /** @type {Array<{recovery: ReturnType<typeof validateHydrationRecoveryRecord>, retiredTarget: boolean, retiredClaim: boolean, complete: boolean}>} */
  const registryEntries = view.registry.entries;
  if (requestedRecovery) {
    assertHydrationRecoveryRegistryIdentity(
      requestedRecovery,
      replicaId,
      view.storeRootIdentity,
    );
    if (!sameJson(requestedRecovery.transport, scope.transport)) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'the requested recovery receipt does not match the exact transport scope',
      );
    }
    if (!hydrationRecoveryMatchesCurrentScope(scope, requestedRecovery)) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'the requested recovery receipt does not match the exact current authority and barrier scope',
      );
    }
    const retained = registryEntries.find(
      (entry) => entry.recovery.recoveryId === requestedRecovery.recoveryId,
    );
    if (retained) {
      if (!sameJson(retained.recovery, requestedRecovery)) {
        throw new ApplicationStateSnapshotTargetCorruptionError(
          'the requested recovery receipt differs from its retained registry record',
        );
      }
      return createHydrationRecoveryInspection(
        classifyRetainedHydrationRecoveryAttempt(view, retained),
        retained.recovery,
      );
    }
    if (view.registry.incompleteRecoveryId) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'another incomplete hydration recovery attempt blocks this request',
      );
    }
    if (registryEntries.length >= HYDRATION_RECOVERY_MAX_RECEIPTS) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'the hydration recovery receipt registry is exhausted',
      );
    }
    assertActiveHydrationRecoveryAttempt(view, requestedRecovery);
    return createHydrationRecoveryInspection(
      'PARTIAL_TARGET',
      requestedRecovery,
    );
  }

  const incomplete = view.registry.incompleteRecoveryId
    ? registryEntries.find(
        (entry) =>
          entry.recovery.recoveryId === view.registry.incompleteRecoveryId,
      )
    : null;
  if (incomplete) {
    if (!sameJson(incomplete.recovery.transport, scope.transport)) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'an incomplete hydration recovery for another transport blocks this inspection',
      );
    }
    if (!hydrationRecoveryMatchesCurrentScope(scope, incomplete.recovery)) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'the incomplete hydration recovery receipt does not match the exact current authority and barrier scope',
      );
    }
    return createHydrationRecoveryInspection(
      classifyRetainedHydrationRecoveryAttempt(view, incomplete),
      incomplete.recovery,
    );
  }
  if (view.claimEvidence || view.targetIdentity) {
    if (
      !view.claimEvidence ||
      view.claimEvidence.claim.snapshotId !==
        scope.transport.snapshot.snapshotId ||
      !view.targetIdentity
    ) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'hydration recovery requires one exact claim and its empty pre-evidence target',
      );
    }
    if (registryEntries.length >= HYDRATION_RECOVERY_MAX_RECEIPTS) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'the hydration recovery receipt registry is exhausted',
      );
    }
    const recovery = createHydrationRecoveryRecord({
      transport: scope.transport,
      claim: view.claimEvidence.claim,
      replicaId,
      filesystem: {
        storeRoot: view.storeRootIdentity,
        claimFile: view.claimEvidence.identity,
        targetDirectory: view.targetIdentity,
      },
      replacementBarrier: scope.closedBarrier,
      replacementAuthority: scope.authority,
    });
    return createHydrationRecoveryInspection('PARTIAL_TARGET', recovery);
  }
  const completed = registryEntries.find(
    (entry) =>
      entry.complete &&
      sameJson(entry.recovery.transport, scope.transport) &&
      hydrationRecoveryMatchesCurrentScope(scope, entry.recovery),
  );
  if (!completed) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'hydration recovery requires exact active or completed attempt evidence',
    );
  }
  return createHydrationRecoveryInspection('RECOVERED', completed.recovery);
}

/** @param {{configuration: ReturnType<typeof validateApplicationStateStoreConfiguration>, controlContext: ReturnType<typeof snapshotControlContext>, transport: ReturnType<typeof normalizeApplicationStateSnapshotTransport>, closedBarrier: ReturnType<typeof assertCoordinatorQuiescenceBarrierSnapshot>, authority: ReturnType<typeof assertCoordinatorAuthorityToken>}} scope @param {ReturnType<typeof validateHydrationRecoveryRecord> | null} [requestedRecovery] */
async function inspectHydrationRecoveryScope(scope, requestedRecovery = null) {
  await assertHydrationRecoveryControlState(scope);
  const replicaId = await readPhysicalReplicaId(scope.configuration.storePath);
  const first = await readHydrationRecoveryFilesystem(scope, replicaId);
  const secondReplicaId = await readPhysicalReplicaId(
    scope.configuration.storePath,
  );
  const second = await readHydrationRecoveryFilesystem(scope, secondReplicaId);
  if (replicaId !== secondReplicaId || !sameJson(first, second)) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'hydration recovery evidence changed during inspection',
    );
  }
  assertHydrationRecoveryRegistryViewCanonical(first);
  await assertHydrationRecoveryControlState(scope);
  return selectHydrationRecoveryInspection(
    scope,
    replicaId,
    first,
    requestedRecovery,
  );
}

/** @param {Record<string, any>} options @param {Set<string>} allowed @param {string} label */
function normalizeHydrationRecoveryScope(options, allowed, label) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(`${label} requires options.`);
  }
  if (Object.keys(options).some((key) => !allowed.has(key))) {
    throw new TypeError(`${label} has unsupported options.`);
  }
  const configuration = validateApplicationStateStoreConfiguration(
    options.configuration,
  );
  const controlContext = snapshotControlContext(options.controlContext);
  const transport = normalizeApplicationStateSnapshotTransport(
    options.transport,
  );
  const authority = assertCoordinatorAuthorityToken(
    options.coordinatorAuthority,
    `${label} coordinatorAuthority`,
  );
  const closedBarrier = assertCoordinatorQuiescenceBarrierSnapshot(
    options.closedBarrier,
    `${label} closedBarrier`,
  );
  const appId = transport.snapshot.destination.configuration.namespace;
  if (
    closedBarrier.state !== CoordinatorQuiescenceBarrierState.CLOSED ||
    closedBarrier.appId !== appId ||
    authority.appId !== appId ||
    !sameAuthority(closedBarrier.authority, authority) ||
    closedBarrier.version < transport.snapshot.checkpoint.sourceBarrier.version
  ) {
    throw new TypeError(
      `${label} requires the exact current CLOSED replacement barrier and authority.`,
    );
  }
  scopedDestination(transport.snapshot.destination, configuration, appId);
  assertApplicationStateStoreIsolation(configuration, controlContext);
  return Object.freeze({
    configuration,
    controlContext,
    transport,
    closedBarrier,
    authority,
  });
}

/** @param {{configuration: ReturnType<typeof validateApplicationStateStoreConfiguration>, transport: ReturnType<typeof normalizeApplicationStateSnapshotTransport>}} scope @param {ReturnType<typeof createHydrationRecoveryRecord>} expected */
async function persistHydrationRecoveryRecord(scope, expected) {
  const storePath = scope.configuration.storePath;
  const snapshotId = expected.transport.snapshot.snapshotId;
  const recoveryId = expected.recoveryId;
  const path = join(storePath, hydrationRecoveryName(snapshotId, recoveryId));
  const view = await readHydrationRecoveryFilesystem(scope, expected.replicaId);
  const existing = view.registry.entries.find(
    (entry) => entry.recovery.recoveryId === recoveryId,
  )?.recovery;
  if (existing) {
    if (!sameJson(existing, expected)) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'another hydration recovery record already occupies the exact attempt scope',
      );
    }
    await syncDirectory(storePath);
    const durableExisting = await readHydrationRecoveryRecord(
      storePath,
      snapshotId,
      recoveryId,
    );
    const durableStoreRoot = await inspectHydrationRecoveryStoreRoot(storePath);
    if (
      !durableExisting ||
      !sameJson(durableExisting, expected) ||
      !sameJson(durableStoreRoot, expected.filesystem.storeRoot)
    ) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'the existing hydration recovery receipt failed durable replay verification',
      );
    }
    return durableExisting;
  }
  if (view.registry.incompleteRecoveryId) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'another incomplete hydration recovery attempt blocks receipt persistence',
    );
  }
  if (view.registry.entries.length >= HYDRATION_RECOVERY_MAX_RECEIPTS) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the hydration recovery receipt registry is exhausted',
    );
  }
  assertActiveHydrationRecoveryAttempt(view, expected);
  const temporaryPath = join(
    storePath,
    `${HYDRATION_RECOVERY_CANDIDATE_FILE_PREFIX}-${snapshotId}-${recoveryId}-${randomUUID()}.tmp`,
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
    } catch (error) {
      if (/** @type {{code?: unknown}} */ (error)?.code !== 'EEXIST') {
        throw error;
      }
    }
    await syncDirectory(storePath);
  } finally {
    try {
      await fsp.unlink(temporaryPath);
    } catch {
      // A private candidate path is never consulted as recovery evidence.
    }
  }
  const retained = await readHydrationRecoveryRecord(
    storePath,
    snapshotId,
    recoveryId,
  );
  const retainedStoreRoot = await inspectHydrationRecoveryStoreRoot(storePath);
  if (
    !retained ||
    !sameJson(retained, expected) ||
    !sameJson(retainedStoreRoot, expected.filesystem.storeRoot)
  ) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'hydration recovery record was not durably readable',
    );
  }
  return retained;
}

/** @param {string} storePath @param {ReturnType<typeof createHydrationRecoveryRecord>} recovery */
async function retireHydrationRecoveryTarget(storePath, recovery) {
  const snapshotId = recovery.transport.snapshot.snapshotId;
  const sourcePath = join(storePath, 'lmdb');
  const retiredPath = join(
    storePath,
    hydrationRecoveryRetiredTargetName(snapshotId, recovery.recoveryId),
  );
  const storeRootIdentity = await inspectHydrationRecoveryStoreRoot(storePath);
  if (!sameJson(storeRootIdentity, recovery.filesystem.storeRoot)) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the configured store root changed immediately before target retirement',
    );
  }
  const source = await inspectEmptyHydrationDirectory(sourcePath, 'active');
  const retired = await inspectEmptyHydrationDirectory(retiredPath, 'retired');
  if (source && retired) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'both active and retired hydration target paths are occupied',
    );
  }
  if (retired) {
    if (!sameJson(retired, recovery.filesystem.targetDirectory)) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'the retired hydration target does not have its exact recorded identity',
      );
    }
  } else {
    if (!source || !sameJson(source, recovery.filesystem.targetDirectory)) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'the active hydration target identity changed immediately before retirement',
      );
    }
    try {
      await fsp.rename(sourcePath, retiredPath);
    } catch (cause) {
      const replaySource = await inspectEmptyHydrationDirectory(
        sourcePath,
        'active',
      );
      const replayRetired = await inspectEmptyHydrationDirectory(
        retiredPath,
        'retired',
      );
      if (
        replaySource ||
        !replayRetired ||
        !sameJson(replayRetired, recovery.filesystem.targetDirectory)
      ) {
        throw new ApplicationStateSnapshotTargetCorruptionError(
          'the exact hydration target could not be retired',
          { cause },
        );
      }
    }
  }
  await syncDirectory(storePath);
  const finalSource = await inspectEmptyHydrationDirectory(
    sourcePath,
    'active',
  );
  const finalRetired = await inspectEmptyHydrationDirectory(
    retiredPath,
    'retired',
  );
  const finalStoreRoot = await inspectHydrationRecoveryStoreRoot(storePath);
  if (
    finalSource ||
    !finalRetired ||
    !sameJson(finalRetired, recovery.filesystem.targetDirectory) ||
    !sameJson(finalStoreRoot, recovery.filesystem.storeRoot)
  ) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the retired hydration target failed exact post-rename verification',
    );
  }
}

/** @param {string} storePath @param {ReturnType<typeof createHydrationRecoveryRecord>} recovery */
async function retireHydrationRecoveryClaim(storePath, recovery) {
  const snapshotId = recovery.transport.snapshot.snapshotId;
  const sourcePath = join(storePath, HYDRATION_CLAIM_FILE);
  const retiredPath = join(
    storePath,
    hydrationRecoveryRetiredClaimName(snapshotId, recovery.recoveryId),
  );
  const storeRootIdentity = await inspectHydrationRecoveryStoreRoot(storePath);
  if (!sameJson(storeRootIdentity, recovery.filesystem.storeRoot)) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the configured store root changed immediately before claim retirement',
    );
  }
  const source = await readHydrationRecoveryClaimEvidenceAtPath(
    sourcePath,
    'active',
  );
  const retired = await readHydrationRecoveryClaimEvidenceAtPath(
    retiredPath,
    'retired',
  );
  if (source && retired) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'both active and retired hydration claim paths are occupied',
    );
  }
  if (retired) {
    if (
      !sameJson(retired.claim, recovery.claim) ||
      !sameJson(retired.identity, recovery.filesystem.claimFile)
    ) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'the retired hydration claim does not have its exact recorded identity and content',
      );
    }
  } else {
    if (
      !source ||
      !sameJson(source.claim, recovery.claim) ||
      !sameJson(source.identity, recovery.filesystem.claimFile)
    ) {
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'the active hydration claim changed immediately before retirement',
      );
    }
    try {
      await fsp.rename(sourcePath, retiredPath);
    } catch (cause) {
      const replaySource = await readHydrationRecoveryClaimEvidenceAtPath(
        sourcePath,
        'active',
      );
      const replayRetired = await readHydrationRecoveryClaimEvidenceAtPath(
        retiredPath,
        'retired',
      );
      if (
        replaySource ||
        !replayRetired ||
        !sameJson(replayRetired.claim, recovery.claim) ||
        !sameJson(replayRetired.identity, recovery.filesystem.claimFile)
      ) {
        throw new ApplicationStateSnapshotTargetCorruptionError(
          'the exact hydration claim could not be retired',
          { cause },
        );
      }
    }
  }
  await syncDirectory(storePath);
  const finalSource = await readHydrationRecoveryClaimEvidenceAtPath(
    sourcePath,
    'active',
  );
  const finalRetired = await readHydrationRecoveryClaimEvidenceAtPath(
    retiredPath,
    'retired',
  );
  const finalStoreRoot = await inspectHydrationRecoveryStoreRoot(storePath);
  if (
    finalSource ||
    !finalRetired ||
    !sameJson(finalRetired.claim, recovery.claim) ||
    !sameJson(finalRetired.identity, recovery.filesystem.claimFile) ||
    !sameJson(finalStoreRoot, recovery.filesystem.storeRoot)
  ) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the retired hydration claim failed exact post-rename verification',
    );
  }
}

/** @param {string} storePath @param {ReturnType<typeof createHydrationRecoveryRecord>} recovery */
async function syncAndVerifyCompletedHydrationRecovery(storePath, recovery) {
  const snapshotId = recovery.transport.snapshot.snapshotId;
  await syncDirectory(storePath);
  const storeRootIdentity = await inspectHydrationRecoveryStoreRoot(storePath);
  const receipt = await readHydrationRecoveryRecord(
    storePath,
    snapshotId,
    recovery.recoveryId,
  );
  const retiredTarget = await inspectEmptyHydrationDirectory(
    join(
      storePath,
      hydrationRecoveryRetiredTargetName(snapshotId, recovery.recoveryId),
    ),
    'retired',
  );
  const retiredClaim = await readHydrationRecoveryClaimEvidenceAtPath(
    join(
      storePath,
      hydrationRecoveryRetiredClaimName(snapshotId, recovery.recoveryId),
    ),
    'retired',
  );
  if (
    !sameJson(storeRootIdentity, recovery.filesystem.storeRoot) ||
    !receipt ||
    !sameJson(receipt, recovery) ||
    !retiredTarget ||
    !sameJson(retiredTarget, recovery.filesystem.targetDirectory) ||
    !retiredClaim ||
    !sameJson(retiredClaim.claim, recovery.claim) ||
    !sameJson(retiredClaim.identity, recovery.filesystem.claimFile)
  ) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the completed hydration recovery failed its durable exact replay verification',
    );
  }
  return receipt;
}

/** @param {{controlContext: ReturnType<typeof snapshotControlContext>, closedBarrier: ReturnType<typeof assertCoordinatorQuiescenceBarrierSnapshot>, authority: ReturnType<typeof assertCoordinatorAuthorityToken>}} scope */
async function assertHydrationRecoveryCompletionAuthority(scope) {
  await assertCoordinatorAuthorityCurrent({
    db: scope.controlContext.db,
    tableName: scope.controlContext.tableName,
    authority: scope.authority,
  });
  await assertDurableBarrierExact(scope.controlContext, scope.closedBarrier);
}

/**
 * Inspect only the exact retained pre-evidence partial hydration target or an
 * exact durable recovery of it. This operation is read-only and returns one
 * reusable integrity-bound inspection document.
 * @param {{configuration: unknown, controlContext: Record<string, any>, transport: unknown, closedBarrier: unknown, coordinatorAuthority: unknown}} options
 */
export async function inspectApplicationStateSnapshotHydrationRecovery(
  options,
) {
  const scope = normalizeHydrationRecoveryScope(
    options,
    new Set([
      'configuration',
      'controlContext',
      'transport',
      'closedBarrier',
      'coordinatorAuthority',
    ]),
    'Application-state snapshot hydration recovery inspection',
  );
  return await inspectHydrationRecoveryScope(scope);
}

/**
 * Explicitly recover one exact inspected pre-evidence hydration target. A
 * durable exact-attempt receipt is retained before the empty target and claim
 * are renamed into receipt-scoped retirement paths and retained. The caller
 * must first stop and reap the hydrator that owned the retained claim.
 * @param {{configuration: unknown, controlContext: Record<string, any>, transport: unknown, closedBarrier: unknown, coordinatorAuthority: unknown, inspection: unknown, confirmPartialHydrationRecovery: boolean, observePhase?: (phase: string) => Promise<void> | void}} options
 */
export async function recoverApplicationStateSnapshotHydration(options) {
  const scope = normalizeHydrationRecoveryScope(
    options,
    new Set([
      'configuration',
      'controlContext',
      'transport',
      'closedBarrier',
      'coordinatorAuthority',
      'inspection',
      'confirmPartialHydrationRecovery',
      'observePhase',
    ]),
    'Application-state snapshot hydration recovery',
  );
  if (options.confirmPartialHydrationRecovery !== true) {
    throw new TypeError(
      'Application-state snapshot hydration recovery requires explicit inspected confirmation.',
    );
  }
  const inspection = validateHydrationRecoveryInspection(options.inspection);
  const requestedRecovery = inspection.recovery;
  const observePhase = normalizeObserver(options.observePhase);
  let current = await inspectHydrationRecoveryScope(scope, requestedRecovery);
  if (!sameJson(current.recovery, requestedRecovery)) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'hydration recovery evidence changed after the retained inspection',
    );
  }
  if (current.state === 'RECOVERED') {
    await syncAndVerifyCompletedHydrationRecovery(
      scope.configuration.storePath,
      requestedRecovery,
    );
    await assertHydrationRecoveryCompletionAuthority(scope);
    return requestedRecovery;
  }
  const expectedRecovery = createHydrationRecoveryRecord({
    transport: scope.transport,
    claim: requestedRecovery.claim,
    replicaId: requestedRecovery.replicaId,
    filesystem: requestedRecovery.filesystem,
    replacementBarrier: scope.closedBarrier,
    replacementAuthority: scope.authority,
  });
  if (!sameJson(requestedRecovery, expectedRecovery)) {
    throw new TypeError(
      'An incomplete application-state hydration recovery inspection does not match the current exact mutation scope.',
    );
  }
  if (current.state === 'PARTIAL_TARGET' && !sameJson(current, inspection)) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the fresh pre-evidence hydration inspection does not match the confirmed inspection',
    );
  }
  const recovery = await persistHydrationRecoveryRecord(
    scope,
    expectedRecovery,
  );
  await observePhase('hydration-recovery-recorded');

  current = await inspectHydrationRecoveryScope(scope, recovery);
  if (!sameJson(current.recovery, recovery)) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'hydration recovery scope changed before empty-target removal',
    );
  }
  if (current.state === 'RECOVERED') {
    await syncAndVerifyCompletedHydrationRecovery(
      scope.configuration.storePath,
      recovery,
    );
    await assertHydrationRecoveryCompletionAuthority(scope);
    return recovery;
  }
  if (
    current.state === 'RECOVERY_RECORDED' ||
    current.state === 'TARGET_REMOVED'
  ) {
    await retireHydrationRecoveryTarget(
      scope.configuration.storePath,
      recovery,
    );
  } else {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'hydration recovery did not retain a removable exact target state',
    );
  }
  await observePhase('hydration-recovery-target-removed');

  current = await inspectHydrationRecoveryScope(scope, recovery);
  if (
    !sameJson(current.recovery, recovery) ||
    !['TARGET_REMOVED', 'RECOVERED'].includes(current.state)
  ) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'hydration recovery scope changed before exact claim release',
    );
  }
  if (current.state === 'TARGET_REMOVED') {
    await retireHydrationRecoveryClaim(scope.configuration.storePath, recovery);
  } else {
    await syncAndVerifyCompletedHydrationRecovery(
      scope.configuration.storePath,
      recovery,
    );
  }
  await observePhase('hydration-recovery-claim-released');
  await syncAndVerifyCompletedHydrationRecovery(
    scope.configuration.storePath,
    recovery,
  );
  await assertHydrationRecoveryCompletionAuthority(scope);
  return recovery;
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

/** @param {string} storePath @param {string} replicaId */
async function assertHydrationRecoveryRegistryAllowsNewClaim(
  storePath,
  replicaId,
) {
  const firstRoot = await inspectHydrationRecoveryStoreRoot(storePath);
  const first = await readHydrationRecoveryRegistry(
    storePath,
    replicaId,
    firstRoot,
  );
  const secondRoot = await inspectHydrationRecoveryStoreRoot(storePath);
  const second = await readHydrationRecoveryRegistry(
    storePath,
    replicaId,
    secondRoot,
  );
  if (!sameJson(firstRoot, secondRoot) || !sameJson(first, second)) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the hydration recovery registry changed while a new claim was gated',
    );
  }
  if (first.incompleteRecoveryId) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'an incomplete hydration recovery receipt blocks a new hydration claim',
    );
  }
  if (first.entries.length >= HYDRATION_RECOVERY_MAX_RECEIPTS) {
    throw new ApplicationStateSnapshotTargetCorruptionError(
      'the hydration recovery receipt registry is exhausted',
    );
  }
}

/** @param {string} storePath @param {Buffer} bytes @param {ReturnType<typeof normalizeApplicationStateSnapshotTransport>} transport @param {string} replicaId @param {(phase: string) => Promise<void>} observePhase */
async function hydrateAbsentTarget(
  storePath,
  bytes,
  transport,
  replicaId,
  observePhase,
) {
  const snapshotId = transport.snapshot.snapshotId;
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
    await assertHydrationRecoveryRegistryAllowsNewClaim(storePath, replicaId);
    const claimed = await createHydrationClaim(storePath, snapshotId);
    if (!claimed.owned) {
      if (await waitForHydrationClaim(storePath, snapshotId)) return false;
      throw new ApplicationStateSnapshotTargetCorruptionError(
        'a concurrent hydration ended without a committed target',
      );
    }
    ownedClaim = claimed.claim;
    await assertHydrationRecoveryRegistryAllowsNewClaim(storePath, replicaId);
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
      transport,
      replicaId,
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
  inspectApplicationStateSnapshotHydrationRecovery,
  publishApplicationStateSnapshot,
  recoverApplicationStateSnapshotHydration,
  recoverRetiredApplicationStateSnapshot,
  transportApplicationStateSnapshot,
};
