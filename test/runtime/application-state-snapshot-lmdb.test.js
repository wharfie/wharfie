/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, jest, test } from '@jest/globals';

import {
  APPLICATION_STATE_TABLE_NAME,
  createControlDBClient,
} from '../../src/core/lib/config/db.js';
import { createExecutionLedger } from '../../src/core/lib/db/tables/execution-ledger.js';
import {
  ExecutionPayloadStoreNotFoundError,
  createLocalExecutionPayloadStore,
} from '../../src/core/lib/payload-store/local.js';
import { createReplicatedExecutionPayloadStore } from '../../src/core/lib/payload-store/replicated.js';
import {
  ApplicationStateStoreRetiredError,
  createApplicationStateBusinessKey,
  createApplicationStateTable,
} from '../../src/core/lib/db/tables/application-state.js';
import {
  CoordinatorAuthorityStaleError,
  createCoordinatorAuthority,
  createCoordinatorAuthorityToken,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import { createCoordinatorQuiescenceBarrier } from '../../src/core/lib/db/tables/coordinator-quiescence-barrier.js';
import {
  ApplicationStateSnapshotIntegrityError,
  ApplicationStateSnapshotNotFoundError,
  createApplicationStateSnapshotDistribution,
} from '../../src/core/runtime/application-state-snapshot-distribution.js';
import {
  APPLICATION_STATE_SNAPSHOT_ACTIVATION_SORT_KEY,
  APPLICATION_STATE_SNAPSHOT_PUBLICATION_SORT_KEY,
  ApplicationStateSnapshotActivationConflictError,
  createApplicationStateSnapshotControlStore,
  getApplicationStateSnapshotControlPartitionKey,
} from '../../src/core/runtime/application-state-snapshot-control.js';
import applicationStateSnapshotLmdb, {
  ApplicationStateSnapshotTargetCorruptionError,
  inspectApplicationStateSnapshotHydrationRecovery,
  inspectApplicationStateSnapshotHydrationRecoveryRepair,
  publishApplicationStateSnapshot,
  recoverApplicationStateSnapshotHydration,
  recoverRetiredApplicationStateSnapshot,
  repairApplicationStateSnapshotHydrationRecovery,
  transportApplicationStateSnapshot,
} from '../../src/core/runtime/application-state-snapshot-lmdb.js';
import { openApplicationStateDB } from '../../src/core/runtime/application-state-store.js';
import { prepareApplicationStateReadiness } from '../../src/core/runtime/application-state-readiness.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  createApplicationStateSnapshotMarkerKey,
  createApplicationStateSnapshotReference,
} from '../../src/core/runtime/application-state-snapshot.js';
import { withReconstructedExecutionLedgerResidentAuthority } from '../../src/core/runtime/operator/execution-ledger-store.js';
import { createResidentReplacementInputReceipt } from '../../src/core/runtime/resident-replacement-input.js';

const APP_ID = 'application-state-snapshot-lmdb';
const SIBLING_APP_ID = 'application-state-snapshot-lmdb-sibling';
const CONTROL_TABLE = 'application-state-snapshot-control';
const HYDRATION_CLAIM_FILE =
  '.wharfie-application-state-snapshot-hydration-claim';
const HYDRATION_CLAIM_KIND =
  'wharfie.application-state-snapshot-hydration-claim.v1';
const HYDRATION_RECOVERY_FILE_PREFIX =
  '.wharfie-application-state-snapshot-hydration-recovery';
const HYDRATION_RECOVERY_RECEIPT_FILE_PREFIX = `${HYDRATION_RECOVERY_FILE_PREFIX}-receipt`;
const HYDRATION_RECOVERY_RETIRED_TARGET_PREFIX = `${HYDRATION_RECOVERY_FILE_PREFIX}-retired-target`;
const HYDRATION_RECOVERY_RETIRED_CLAIM_PREFIX = `${HYDRATION_RECOVERY_FILE_PREFIX}-retired-claim`;
const HYDRATION_RECOVERY_REPAIR_RECEIPT_PREFIX = `${HYDRATION_RECOVERY_FILE_PREFIX}-successor-repair-receipt`;
const HYDRATION_RECOVERY_REPAIR_AUTHORIZATION_PREFIX = `${HYDRATION_RECOVERY_FILE_PREFIX}-successor-repair-authorization`;
const HYDRATION_RECOVERY_REPAIR_CANDIDATE_PREFIX = `${HYDRATION_RECOVERY_FILE_PREFIX}-successor-repair-candidate`;
const HYDRATION_RECOVERY_REPAIR_AUTHORIZATION_CANDIDATE_PREFIX = `${HYDRATION_RECOVERY_FILE_PREFIX}-successor-repair-authorization-candidate`;
const HYDRATION_RECOVERY_REPAIR_RETIRED_TARGET_PREFIX = `${HYDRATION_RECOVERY_FILE_PREFIX}-successor-repair-retired-target`;
const HYDRATION_RECOVERY_REPAIR_RETIRED_CLAIM_PREFIX = `${HYDRATION_RECOVERY_FILE_PREFIX}-successor-repair-retired-claim`;
const REPLICA_ID_FILE = '.wharfie-application-state-replica-id';
const STALE_HYDRATION_RECOVERY_STATES = /** @type {const} */ ([
  'RECOVERY_RECORDED',
  'TARGET_REMOVED',
]);
const HYDRATION_RECOVERY_REPAIR_PHASES = /** @type {const} */ ([
  'hydration-recovery-successor-repair-recorded',
  'hydration-recovery-successor-repair-authorized',
  'hydration-recovery-successor-repair-target-retired',
  'hydration-recovery-successor-repair-claim-retired',
]);
const HYDRATION_RECOVERY_REPAIR_TAKEOVER_CASES =
  STALE_HYDRATION_RECOVERY_STATES.flatMap((staleState) =>
    HYDRATION_RECOVERY_REPAIR_PHASES.map((phase) =>
      Object.freeze({ staleState, phase }),
    ),
  );

/** @type {Array<() => Promise<void>>} */
let cleanups = [];

afterEach(async () => {
  const pending = cleanups;
  cleanups = [];
  const results = await Promise.allSettled(
    pending.map(async (cleanup) => await cleanup()),
  );
  const failures = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, 'snapshot LMDB test cleanup failed');
  }
});

/** @param {string} prefix @param {string} label */
function id(prefix, label) {
  return createCanonicalJsonSha256Id({
    domain: `wharfie:test:application-state-snapshot-lmdb:${prefix}`,
    prefix,
    value: { label },
  });
}

function deferred() {
  /** @type {() => void} */
  let release = () => {};
  const promise = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  return { promise, resolve: release };
}

/** @param {Promise<any>} promise @param {() => void} release */
async function settleBeforeBlockedOwnerRelease(promise, release) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timeout = setTimeout(() => {
          release();
          reject(
            new Error(
              'exact recovery replay did not establish its own durable boundary',
            ),
          );
        }, 2_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

/** @param {string} storePath @param {string} snapshotId */
function hydrationEvidencePath(storePath, snapshotId) {
  return join(
    storePath,
    'lmdb',
    `.wharfie-application-state-snapshot-hydration-${snapshotId}`,
  );
}

/** @param {string} snapshotId @param {string} label */
function hydrationClaim(snapshotId, label) {
  return {
    schemaVersion: 1,
    kind: HYDRATION_CLAIM_KIND,
    snapshotId,
    claimId: id('washc1', label),
  };
}

/** @param {string} storePath @param {Readonly<Record<string, any>>} recovery */
function hydrationRecoveryArtifacts(storePath, recovery) {
  const snapshotId = recovery.transport.snapshot.snapshotId;
  const recoveryId = recovery.recoveryId;
  return Object.freeze({
    receiptPath: join(
      storePath,
      `${HYDRATION_RECOVERY_RECEIPT_FILE_PREFIX}-${snapshotId}-${recoveryId}`,
    ),
    retiredTargetPath: join(
      storePath,
      `${HYDRATION_RECOVERY_RETIRED_TARGET_PREFIX}-${snapshotId}-${recoveryId}`,
    ),
    retiredClaimPath: join(
      storePath,
      `${HYDRATION_RECOVERY_RETIRED_CLAIM_PREFIX}-${snapshotId}-${recoveryId}`,
    ),
  });
}

/** @param {string} storePath @param {Readonly<Record<string, any>>} inspection @param {number} [authorizationSlot] */
function hydrationRecoveryRepairArtifacts(
  storePath,
  inspection,
  authorizationSlot = 0,
) {
  const repairId = inspection.repair.repairId;
  const slot = String(authorizationSlot).padStart(3, '0');
  return Object.freeze({
    receiptPath: join(
      storePath,
      `${HYDRATION_RECOVERY_REPAIR_RECEIPT_PREFIX}-${repairId}`,
    ),
    authorizationPath: join(
      storePath,
      `${HYDRATION_RECOVERY_REPAIR_AUTHORIZATION_PREFIX}-${repairId}-${slot}`,
    ),
    retiredTargetPath: join(
      storePath,
      `${HYDRATION_RECOVERY_REPAIR_RETIRED_TARGET_PREFIX}-${repairId}`,
    ),
    retiredClaimPath: join(
      storePath,
      `${HYDRATION_RECOVERY_REPAIR_RETIRED_CLAIM_PREFIX}-${repairId}`,
    ),
  });
}

/** @param {Readonly<Record<string, any>>} repair @param {string} label */
function alternateHydrationRecoveryRepair(repair, label) {
  const payload = {
    schemaVersion: 1,
    kind: repair.kind,
    staleRecovery: repair.staleRecovery,
    publicationId: id('wasp1', label),
    startingState: repair.startingState,
    filesystem: repair.filesystem,
  };
  return {
    ...payload,
    repairId: createCanonicalJsonSha256Id({
      domain:
        'wharfie:application-state-snapshot-hydration-recovery-successor-repair:v1',
      prefix: 'washrr1',
      value: payload,
    }),
  };
}

/** @param {Readonly<Record<string, any>>} repair @param {Readonly<Record<string, any>>} replacementBarrier @param {Readonly<Record<string, any>>} replacementAuthority */
function hydrationRecoveryRepairAuthorization(
  repair,
  replacementBarrier,
  replacementAuthority,
) {
  const payload = {
    schemaVersion: 1,
    kind: 'wharfie.application-state-snapshot-hydration-recovery-successor-repair-authorization.v1',
    repairId: repair.repairId,
    replacementBarrier,
    replacementAuthority,
  };
  return {
    ...payload,
    authorizationId: createCanonicalJsonSha256Id({
      domain:
        'wharfie:application-state-snapshot-hydration-recovery-successor-repair-authorization:v1',
      prefix: 'washrra1',
      value: payload,
    }),
  };
}

/** @param {Awaited<ReturnType<typeof createHarness>>} harness @param {Readonly<Record<string, any>>} transport @param {string} label */
async function createRecoverablePartialHydration(harness, transport, label) {
  const claim = hydrationClaim(transport.snapshot.snapshotId, label);
  const replicaPath = join(harness.replacementPath, REPLICA_ID_FILE);
  const retainedReplica = await readOptionalFile(replicaPath);
  const replicaId = retainedReplica
    ? retainedReplica.toString('utf8').trim()
    : id('wasr1', `recovery-replica-${label}`);
  const claimPath = join(harness.replacementPath, HYDRATION_CLAIM_FILE);
  const targetPath = join(harness.replacementPath, 'lmdb');
  await fsp.mkdir(targetPath, { recursive: true, mode: 0o700 });
  if (!retainedReplica) {
    await fsp.writeFile(replicaPath, `${replicaId}\n`, { mode: 0o600 });
  }
  await fsp.writeFile(claimPath, `${JSON.stringify(claim)}\n`, {
    mode: 0o600,
  });
  return Object.freeze({
    claim,
    replicaId,
    claimPath,
    targetPath,
    unboundRecoveryPath: join(
      harness.replacementPath,
      `${HYDRATION_RECOVERY_RECEIPT_FILE_PREFIX}-${transport.snapshot.snapshotId}-${id('washr1', `unbound-recovery-${label}`)}`,
    ),
  });
}

/** @param {Awaited<ReturnType<typeof createHarness>>} harness @param {Readonly<Record<string, any>>} transport @param {ReturnType<typeof createCoordinatorAuthorityToken>} coordinatorAuthority */
function hydrationRecoveryInput(harness, transport, coordinatorAuthority) {
  return Object.freeze({
    configuration: harness.replacementConfiguration,
    controlContext: harness.controlContext,
    transport,
    closedBarrier: harness.currentBarrier,
    coordinatorAuthority,
  });
}

/** @param {Awaited<ReturnType<typeof createHarness>>} harness @param {Readonly<Record<string, any>>} transport @param {string} label @param {'RECOVERY_RECORDED'|'TARGET_REMOVED'} staleState */
async function createStaleHydrationRecovery(
  harness,
  transport,
  label,
  staleState,
) {
  const recoveryAuthority = await harness.takeover();
  const partial = await createRecoverablePartialHydration(
    harness,
    transport,
    label,
  );
  const recoveryInput = hydrationRecoveryInput(
    harness,
    transport,
    recoveryAuthority,
  );
  const recoveryInspection =
    await inspectApplicationStateSnapshotHydrationRecovery(recoveryInput);
  const interruptedPhase =
    staleState === 'RECOVERY_RECORDED'
      ? 'hydration-recovery-recorded'
      : 'hydration-recovery-target-removed';
  const interruption = new Error(`stop with stale ${staleState}`);
  await expect(
    recoverApplicationStateSnapshotHydration({
      ...recoveryInput,
      inspection: recoveryInspection,
      confirmPartialHydrationRecovery: true,
      observePhase: (phase) => {
        if (phase === interruptedPhase) throw interruption;
      },
    }),
  ).rejects.toBe(interruption);
  const recoveryArtifacts = hydrationRecoveryArtifacts(
    harness.replacementPath,
    recoveryInspection.recovery,
  );
  const successorAuthority = await harness.supersede(
    `repair-successor-${label}`,
  );
  const repairInput = hydrationRecoveryInput(
    harness,
    transport,
    successorAuthority,
  );
  return Object.freeze({
    partial,
    staleState,
    recoveryAuthority,
    recoveryInput,
    recoveryInspection,
    recoveryArtifacts,
    successorAuthority,
    repairInput,
  });
}

/** @param {Awaited<ReturnType<typeof createHarness>>} harness @param {Readonly<Record<string, any>>} transport @param {string} label @param {'RECOVERY_RECORDED'|'TARGET_REMOVED'} [staleState] */
async function createRecordedHydrationRecoveryRepair(
  harness,
  transport,
  label,
  staleState = 'RECOVERY_RECORDED',
) {
  const stale = await createStaleHydrationRecovery(
    harness,
    transport,
    label,
    staleState,
  );
  const inspection =
    await inspectApplicationStateSnapshotHydrationRecoveryRepair(
      stale.repairInput,
    );
  const artifacts = hydrationRecoveryRepairArtifacts(
    harness.replacementPath,
    inspection,
  );
  const interruption = new Error('stop after stable repair receipt');
  await expect(
    repairApplicationStateSnapshotHydrationRecovery({
      ...stale.repairInput,
      inspection,
      confirmStaleHydrationRecoveryRepair: true,
      observePhase: (phase) => {
        if (phase === 'hydration-recovery-successor-repair-recorded') {
          throw interruption;
        }
      },
    }),
  ).rejects.toBe(interruption);
  return Object.freeze({ stale, inspection, artifacts });
}

/** @param {string} path */
async function readOptionalFile(path) {
  try {
    return await fsp.readFile(path);
  } catch (error) {
    if (/** @type {{code?: unknown}} */ (error)?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/** @param {string} path */
async function readOptionalDirectory(path) {
  try {
    return await fsp.readdir(path);
  } catch (error) {
    if (/** @type {{code?: unknown}} */ (error)?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/** @param {string} storePath */
async function readHydrationRecoveryStoreSnapshot(storePath) {
  const entries = [];
  for (const name of (await fsp.readdir(storePath)).sort()) {
    const path = join(storePath, name);
    const stats = await fsp.lstat(path, { bigint: true });
    const base = {
      name,
      device: stats.dev.toString(10),
      inode: stats.ino.toString(10),
      mode: stats.mode.toString(10),
      size: stats.size.toString(10),
    };
    if (stats.isFile() && !stats.isSymbolicLink()) {
      entries.push({
        ...base,
        type: 'file',
        bytes: (await fsp.readFile(path)).toString('base64'),
      });
    } else if (stats.isDirectory() && !stats.isSymbolicLink()) {
      entries.push({
        ...base,
        type: 'directory',
        children: (await fsp.readdir(path)).sort(),
      });
    } else {
      entries.push({
        ...base,
        type: stats.isSymbolicLink() ? 'symbolic-link' : 'other',
      });
    }
  }
  return entries;
}

function emptyLedger() {
  return Object.freeze({
    listRuns: jest.fn(async () => ({ items: [] })),
    rebuildRun: jest.fn(),
  });
}

/** @param {string} label */
function intent(label) {
  return Object.freeze({
    storeId: id('was', 'primary-store'),
    namespace: APP_ID,
    key: `key-${label}`,
    value: { label, retained: true },
    destinationEffectId: `snapshot-effect-${label}`,
    contractDigest: id('wac', `contract-${label}`),
  });
}

async function createHarness() {
  const root = await fsp.mkdtemp(
    join(tmpdir(), 'wharfie-application-state-snapshot-lmdb-'),
  );
  const sourcePath = join(root, 'source');
  const replacementPath = join(root, 'replacement');
  const controlPath = join(root, 'control');
  const controlDb = await createControlDBClient('vanilla', {
    path: controlPath,
  });
  cleanups.push(async () => {
    try {
      await controlDb.close();
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
  const authorities = createCoordinatorAuthority({
    db: controlDb,
    tableName: CONTROL_TABLE,
  });
  const acquired = await authorities.acquire({
    appId: APP_ID,
    coordinatorId: 'source-coordinator',
    requestId: 'source-acquire',
    observedAt: 1,
  });
  const sourceAuthority = createCoordinatorAuthorityToken(acquired.authority);
  const admission = createCoordinatorQuiescenceBarrier({
    db: controlDb,
    tableName: CONTROL_TABLE,
    now: () => 1,
  });
  let sourceBarrier = (
    await admission.close({
      authority: sourceAuthority,
      requestId: 'source-snapshot-close',
      predecessor: null,
      observedAt: 1,
    })
  ).barrier;
  let currentBarrier = sourceBarrier;
  const storeId = id('was', 'primary-store');
  const destination = Object.freeze({
    kind: 'application-state',
    version: 2,
    bindingId: 'primary',
    configuration: Object.freeze({
      provider: 'lmdb',
      storeId,
      tableName: APPLICATION_STATE_TABLE_NAME,
      namespace: APP_ID,
    }),
  });
  const sourceConfiguration = Object.freeze({
    adapterName: /** @type {const} */ ('lmdb'),
    storePath: sourcePath,
    tableName: APPLICATION_STATE_TABLE_NAME,
  });
  const replacementConfiguration = Object.freeze({
    ...sourceConfiguration,
    storePath: replacementPath,
  });
  const source = await openApplicationStateDB({
    configuration: sourceConfiguration,
  });
  try {
    const table = createApplicationStateTable({
      db: source.db,
      tableName: source.context.tableName,
      coordinatorAuthority: sourceAuthority,
      createStoreId: () => storeId,
    });
    await table.ensureStoreIdentity();
    await table.adoptCoordinatorAuthority({ storeId, namespace: APP_ID });
    await table.putIfAbsent(intent('seed'));
  } finally {
    await source.close();
  }

  const artifacts = new Map();
  const providerRead = jest.fn(
    async (/** @type {Record<string, any>} */ reference) => {
      const bytes = artifacts.get(reference.snapshotId);
      if (!bytes) {
        throw new ApplicationStateSnapshotNotFoundError(reference.snapshotId);
      }
      return Buffer.from(bytes);
    },
  );
  const providerPublish = jest.fn(async ({ reference, bytes }) => {
    const existing = artifacts.get(reference.snapshotId);
    if (existing && !existing.equals(bytes)) {
      throw new Error('immutable snapshot conflict');
    }
    artifacts.set(reference.snapshotId, Buffer.from(bytes));
  });
  const distribution = createApplicationStateSnapshotDistribution({
    identity: {
      kind: 'wharfie.application-state-snapshot-distribution.v1',
      distributionId: id('wasd1', 'distribution'),
      storeId,
    },
    publishImmutable: providerPublish,
    readBytes: providerRead,
  });
  const ledger = emptyLedger();
  const transferId = id('wast1', 'transfer');
  const controlContext = Object.freeze({
    db: controlDb,
    tableName: CONTROL_TABLE,
    adapterName: /** @type {const} */ ('vanilla'),
    controlPath,
  });

  async function publish(overrides = {}) {
    return await publishApplicationStateSnapshot({
      ledger,
      appId: APP_ID,
      configuration: sourceConfiguration,
      controlContext,
      destination,
      closedBarrier: sourceBarrier,
      coordinatorAuthority: sourceAuthority,
      transferId,
      distribution,
      ...overrides,
    });
  }

  async function takeover() {
    const observedAuthority = await authorities.get({ appId: APP_ID });
    const result = await authorities.takeover({
      appId: APP_ID,
      coordinatorId: 'replacement-coordinator',
      requestId: 'replacement-takeover',
      observedAuthority,
      confirmAuthorityReplacement: true,
      observedAt: 2,
    });
    const replacementAuthority = createCoordinatorAuthorityToken(
      result.authority,
    );
    currentBarrier = (
      await admission.adopt({
        authority: replacementAuthority,
        requestId: 'replacement-snapshot-adopt',
        predecessor: sourceBarrier,
        observedAt: 2,
      })
    ).barrier;
    return replacementAuthority;
  }

  async function supersede(label = 'later') {
    const observedAuthority = await authorities.get({ appId: APP_ID });
    const result = await authorities.takeover({
      appId: APP_ID,
      coordinatorId: `${label}-coordinator`,
      requestId: `${label}-takeover`,
      observedAuthority,
      confirmAuthorityReplacement: true,
      observedAt: currentBarrier.version + 1,
    });
    const laterAuthority = createCoordinatorAuthorityToken(result.authority);
    currentBarrier = (
      await admission.adopt({
        authority: laterAuthority,
        requestId: `${label}-snapshot-adopt`,
        predecessor: currentBarrier,
        observedAt: currentBarrier.version + 1,
      })
    ).barrier;
    return laterAuthority;
  }

  async function reopenSourceBarrier() {
    currentBarrier = (
      await admission.reopen({
        authority: sourceAuthority,
        requestId: `source-snapshot-reopen-${currentBarrier.version + 1}`,
        predecessor: currentBarrier,
        observedAt: currentBarrier.version + 1,
      })
    ).barrier;
    return currentBarrier;
  }

  async function closeSourceBarrier() {
    sourceBarrier = (
      await admission.close({
        authority: sourceAuthority,
        requestId: `source-snapshot-close-${currentBarrier.version + 1}`,
        predecessor: currentBarrier,
        observedAt: currentBarrier.version + 1,
      })
    ).barrier;
    currentBarrier = sourceBarrier;
    return sourceBarrier;
  }

  return {
    root,
    controlDb,
    controlPath,
    authorities,
    sourcePath,
    replacementPath,
    sourceConfiguration,
    replacementConfiguration,
    controlContext,
    destination,
    sourceAuthority,
    get sourceBarrier() {
      return sourceBarrier;
    },
    admission,
    reopenSourceBarrier,
    closeSourceBarrier,
    get currentBarrier() {
      return currentBarrier;
    },
    distribution,
    providerRead,
    providerPublish,
    artifacts,
    ledger,
    transferId,
    publish,
    takeover,
    supersede,
  };
}

/** @param {ReturnType<import('../../src/core/runtime/application-state-store.js').validateApplicationStateStoreConfiguration>} configuration @param {ReturnType<typeof createCoordinatorAuthorityToken>} authority */
async function expectSeed(configuration, authority) {
  const access = await openApplicationStateDB({ configuration });
  try {
    const table = createApplicationStateTable({
      db: access.db,
      tableName: access.context.tableName,
      coordinatorAuthority: authority,
    });
    const businessKey = createApplicationStateBusinessKey(APP_ID, 'key-seed');
    await expect(
      table.readBusinessByPhysicalKey(
        businessKey.resourceId,
        businessKey.sortKey,
      ),
    ).resolves.toMatchObject({
      value: { label: 'seed', retained: true },
    });
    await expect(
      table.readReceipt('snapshot-effect-seed'),
    ).resolves.toMatchObject({ inserted: true });
  } finally {
    await access.close();
  }
}

describe('LMDB application-state snapshot transport', () => {
  test('keeps the named repair APIs available through the default runtime export', () => {
    expect(applicationStateSnapshotLmdb).toMatchObject({
      inspectApplicationStateSnapshotHydrationRecoveryRepair,
      repairApplicationStateSnapshotHydrationRecovery,
    });
  });

  test('seals source mutations before immutable publication can succeed', async () => {
    const harness = await createHarness();
    let racingWriteError;
    const transport = await harness.publish({
      observePhase: async (/** @type {string} */ phase) => {
        if (phase !== 'snapshot-published') return;
        const access = await openApplicationStateDB({
          configuration: harness.sourceConfiguration,
        });
        try {
          const table = createApplicationStateTable({
            db: access.db,
            tableName: access.context.tableName,
            coordinatorAuthority: harness.sourceAuthority,
          });
          try {
            await table.putIfAbsent(intent('post-backup-race'));
          } catch (error) {
            racingWriteError = error;
          }
        } finally {
          await access.close();
        }
      },
    });
    expect(racingWriteError).toBeInstanceOf(ApplicationStateStoreRetiredError);

    const replacementAuthority = await harness.takeover();
    await transportApplicationStateSnapshot({
      configuration: harness.replacementConfiguration,
      controlContext: harness.controlContext,
      transport,
      history: transport.snapshot.checkpoint.history,
      closedBarrier: harness.currentBarrier,
      coordinatorAuthority: replacementAuthority,
      distribution: harness.distribution,
    });
    const access = await openApplicationStateDB({
      configuration: harness.replacementConfiguration,
    });
    try {
      const table = createApplicationStateTable({
        db: access.db,
        tableName: access.context.tableName,
      });
      const key = createApplicationStateBusinessKey(
        APP_ID,
        'key-post-backup-race',
      );
      await expect(
        table.readBusinessByPhysicalKey(key.resourceId, key.sortKey),
      ).resolves.toBeNull();
    } finally {
      await access.close();
    }
  });

  test('seals sibling namespaces that share the published physical store', async () => {
    const harness = await createHarness();
    const siblingAcquisition = await harness.authorities.acquire({
      appId: SIBLING_APP_ID,
      coordinatorId: 'sibling-source-coordinator',
      requestId: 'sibling-source-acquire',
      observedAt: 1,
    });
    const siblingAuthority = createCoordinatorAuthorityToken(
      siblingAcquisition.authority,
    );
    const source = await openApplicationStateDB({
      configuration: harness.sourceConfiguration,
    });
    let racingWriteError;
    try {
      const sibling = createApplicationStateTable({
        db: source.db,
        tableName: source.context.tableName,
        coordinatorAuthority: siblingAuthority,
      });
      const siblingScope = {
        storeId: harness.destination.configuration.storeId,
        namespace: SIBLING_APP_ID,
      };
      await sibling.adoptCoordinatorAuthority(siblingScope);
      await sibling.putIfAbsent({
        ...intent('sibling-seed'),
        ...siblingScope,
      });

      await harness.publish({
        observePhase: async (/** @type {string} */ phase) => {
          if (phase !== 'source-sealed') return;
          try {
            await sibling.putIfAbsent({
              ...intent('sibling-after-seal'),
              ...siblingScope,
            });
          } catch (error) {
            racingWriteError = error;
          }
        },
      });
    } finally {
      await source.close();
    }

    expect(racingWriteError).toBeInstanceOf(ApplicationStateStoreRetiredError);
    expect(harness.providerPublish).toHaveBeenCalledTimes(1);
  });

  test('never persists a losing checkpoint marker after store retirement', async () => {
    const harness = await createHarness();
    const losingTransferId = id('wast1', 'marker-retirement-race-loser');
    const markerWriteReached = deferred();
    const releaseMarkerWrite = deferred();
    const losingPublication = harness
      .publish({
        transferId: losingTransferId,
        observePhase: async (/** @type {string} */ phase) => {
          if (phase !== 'source-adopted') return;
          markerWriteReached.resolve();
          await releaseMarkerWrite.promise;
        },
      })
      .then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason }),
      );

    await markerWriteReached.promise;
    const winningPublication = await harness.publish().then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason }),
    );
    releaseMarkerWrite.resolve();
    const losingOutcome = await losingPublication;

    expect(winningPublication).toMatchObject({
      status: 'fulfilled',
      value: { snapshot: { transferId: harness.transferId } },
    });
    expect(losingOutcome).toMatchObject({ status: 'rejected' });

    const source = await openApplicationStateDB({
      configuration: harness.sourceConfiguration,
      readOnly: true,
    });
    try {
      const table = createApplicationStateTable({
        db: source.db,
        tableName: source.context.tableName,
      });
      await expect(
        table.readStoreRetirement({
          storeId: harness.destination.configuration.storeId,
          namespace: APP_ID,
        }),
      ).resolves.toMatchObject({ retirement_id: harness.transferId });
      const markerKey =
        createApplicationStateSnapshotMarkerKey(losingTransferId);
      await expect(
        source.db.get({
          tableName: source.context.tableName,
          keyName: 'resource_id',
          keyValue: markerKey.resourceId,
          sortKeyName: 'sort_key',
          sortKeyValue: markerKey.sortKey,
          consistentRead: true,
        }),
      ).resolves.toBeUndefined();
    } finally {
      await source.close();
    }
  });

  test('captures publication fields before an observer can mutate the caller options', async () => {
    const harness = await createHarness();
    const originalTransferId = harness.transferId;
    const driftLedger = {
      listRuns: jest.fn(async () => {
        throw new Error('mutated ledger must not be observed');
      }),
      rebuildRun: jest.fn(),
    };
    /** @type {Parameters<typeof publishApplicationStateSnapshot>[0]} */
    const options = {
      ledger: harness.ledger,
      appId: APP_ID,
      configuration: harness.sourceConfiguration,
      controlContext: harness.controlContext,
      destination: harness.destination,
      closedBarrier: harness.sourceBarrier,
      coordinatorAuthority: harness.sourceAuthority,
      transferId: originalTransferId,
      distribution: harness.distribution,
      observePhase: (/** @type {string} */ phase) => {
        if (phase !== 'source-sealed') return;
        options.transferId = 'wast1-mutated-after-validation';
        options.appId = 'redirected-application';
        options.ledger = driftLedger;
      },
    };

    const transport = await publishApplicationStateSnapshot(options);

    expect(transport.snapshot.transferId).toBe(originalTransferId);
    expect(transport.snapshot.destination).toEqual(harness.destination);
    expect(harness.ledger.listRuns).toHaveBeenCalledTimes(2);
    expect(driftLedger.listRuns).not.toHaveBeenCalled();
    await expect(
      recoverRetiredApplicationStateSnapshot({
        controlContext: harness.controlContext,
        destination: harness.destination,
        transferId: originalTransferId,
        distribution: harness.distribution,
      }),
    ).resolves.toEqual(transport);
  });

  test('rejects a malformed transfer before changing durable source state', async () => {
    const harness = await createHarness();
    const dataPath = join(harness.sourcePath, 'lmdb', 'data.mdb');
    const beforeBytes = await fsp.readFile(dataPath);
    const before = await openApplicationStateDB({
      configuration: harness.sourceConfiguration,
      readOnly: true,
    });
    let beforeAuthority;
    try {
      const table = createApplicationStateTable({
        db: before.db,
        tableName: before.context.tableName,
      });
      beforeAuthority = await table.readCoordinatorAuthority({
        storeId: harness.destination.configuration.storeId,
        namespace: APP_ID,
      });
      await expect(
        table.readStoreRetirement({
          storeId: harness.destination.configuration.storeId,
          namespace: APP_ID,
        }),
      ).resolves.toBeNull();
    } finally {
      await before.close();
    }

    await expect(
      harness.publish({ transferId: 'wast1-malformed' }),
    ).rejects.toThrow(/transferId/iu);

    expect(harness.ledger.listRuns).not.toHaveBeenCalled();
    expect(harness.providerPublish).not.toHaveBeenCalled();
    await expect(fsp.readFile(dataPath)).resolves.toEqual(beforeBytes);
    const after = await openApplicationStateDB({
      configuration: harness.sourceConfiguration,
      readOnly: true,
    });
    try {
      const table = createApplicationStateTable({
        db: after.db,
        tableName: after.context.tableName,
      });
      await expect(
        table.readCoordinatorAuthority({
          storeId: harness.destination.configuration.storeId,
          namespace: APP_ID,
        }),
      ).resolves.toEqual(beforeAuthority);
      await expect(
        table.readStoreRetirement({
          storeId: harness.destination.configuration.storeId,
          namespace: APP_ID,
        }),
      ).resolves.toBeNull();
    } finally {
      await after.close();
    }
  });

  test('rejects a stale durable barrier before sealing or publishing', async () => {
    const harness = await createHarness();
    await harness.reopenSourceBarrier();
    await expect(harness.publish()).rejects.toThrow(
      /durable coordinator admission barrier/iu,
    );
    expect(harness.providerPublish).not.toHaveBeenCalled();
    const access = await openApplicationStateDB({
      configuration: harness.sourceConfiguration,
      readOnly: true,
    });
    try {
      const table = createApplicationStateTable({
        db: access.db,
        tableName: access.context.tableName,
      });
      await expect(
        table.readStoreRetirement({
          storeId: harness.destination.configuration.storeId,
          namespace: APP_ID,
        }),
      ).resolves.toBeNull();
    } finally {
      await access.close();
    }
  });

  test('fails closed if the durable barrier reopens during capture', async () => {
    const harness = await createHarness();
    await expect(
      harness.publish({
        observePhase: async (/** @type {string} */ phase) => {
          if (phase === 'source-sealed') {
            await harness.reopenSourceBarrier();
          }
        },
      }),
    ).rejects.toThrow(/durable coordinator admission barrier/iu);
    expect(harness.providerPublish).not.toHaveBeenCalled();
    const access = await openApplicationStateDB({
      configuration: harness.sourceConfiguration,
    });
    try {
      const stale = createApplicationStateTable({
        db: access.db,
        tableName: access.context.tableName,
        coordinatorAuthority: harness.sourceAuthority,
      });
      await expect(
        stale.putIfAbsent(intent('reopened-race')),
      ).rejects.toBeInstanceOf(ApplicationStateStoreRetiredError);
    } finally {
      await access.close();
    }
  });

  test('hydrates an empty replica, preserves state, and leaves the source fenced', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const recovered = await recoverRetiredApplicationStateSnapshot({
      controlContext: harness.controlContext,
      destination: harness.destination,
      transferId: harness.transferId,
      distribution: harness.distribution,
    });
    expect(recovered).toEqual(transport);

    const replacementAuthority = await harness.takeover();
    const readiness = await transportApplicationStateSnapshot({
      configuration: harness.replacementConfiguration,
      controlContext: harness.controlContext,
      transport,
      history: transport.snapshot.checkpoint.history,
      closedBarrier: harness.currentBarrier,
      coordinatorAuthority: replacementAuthority,
      distribution: harness.distribution,
    });
    expect(readiness).toMatchObject({ status: 'HYDRATED' });
    await expectSeed(harness.replacementConfiguration, replacementAuthority);

    const source = await openApplicationStateDB({
      configuration: harness.sourceConfiguration,
    });
    try {
      const staleTable = createApplicationStateTable({
        db: source.db,
        tableName: source.context.tableName,
        coordinatorAuthority: harness.sourceAuthority,
      });
      await expect(
        staleTable.putIfAbsent(intent('stale')),
      ).rejects.toBeInstanceOf(ApplicationStateStoreRetiredError);
    } finally {
      await source.close();
    }
  });

  test('composes empty payload and application replicas through the internal reconstructed handler', async () => {
    const harness = await createHarness();
    const payloadStoreId = 'snapshot-payload-store';
    const payloadArtifacts = new Map();
    const payloadRead = jest.fn(async (/** @type {any} */ reference) => {
      const bytes = payloadArtifacts.get(reference.payloadId);
      if (!bytes)
        throw new ExecutionPayloadStoreNotFoundError(reference.payloadId);
      return Buffer.from(bytes);
    });
    const payloadPort = {
      identity: {
        kind: 'wharfie.execution-payload-distribution.v1',
        distributionId: id('wepd1', 'payload-distribution'),
        storeId: payloadStoreId,
      },
      publishImmutable: jest.fn(async ({ reference, bytes }) => {
        payloadArtifacts.set(reference.payloadId, Buffer.from(bytes));
      }),
      readBytes: payloadRead,
    };
    const sourcePayloads = createReplicatedExecutionPayloadStore({
      localStore: createLocalExecutionPayloadStore({
        path: join(harness.root, 'source-payloads'),
        storeId: payloadStoreId,
      }),
      distribution: payloadPort,
    });
    const currentRevisionId = id('wrv1', 'current-revision');
    const sourceLedger = createExecutionLedger({
      db: harness.controlDb,
      tableName: CONTROL_TABLE,
      payloadStore: sourcePayloads,
    });
    await harness.reopenSourceBarrier();
    await sourceLedger.createManualRun({
      runId: 'snapshot-reconstructed-run',
      appId: APP_ID,
      revisionId: currentRevisionId,
      invocationId: 'main',
      activityId: 'snapshot-activity',
      input: { command: 'resume', sequence: 7 },
      callerMetadata: { source: 'sealed-snapshot-e2e' },
      transitionId: 'create-snapshot-reconstructed-run',
    });
    await harness.closeSourceBarrier();
    const applicationTransport = await harness.publish({
      ledger: sourceLedger,
    });
    const replacementAuthority = await harness.takeover();
    payloadRead.mockClear();
    const replacementPayloads = createReplicatedExecutionPayloadStore({
      localStore: createLocalExecutionPayloadStore({
        path: join(harness.root, 'replacement-payloads'),
        storeId: payloadStoreId,
      }),
      distribution: payloadPort,
    });
    const ledger = createExecutionLedger({
      db: harness.controlDb,
      tableName: CONTROL_TABLE,
      payloadStore: replacementPayloads,
    });
    const tableResourceId = id('wdtr1', 'control-table');
    const replacementInput = createResidentReplacementInputReceipt({
      appId: APP_ID,
      currentRevisionId,
      control: {
        profile: 'dynamodb-rvn-v1',
        adapterName: 'dynamodb',
        region: 'us-east-2',
        tableName: CONTROL_TABLE,
        tableResourceId,
      },
      payloadStorage: {
        ...replacementPayloads.storage,
        distribution: replacementPayloads.distribution,
      },
      applicationStateDestination: harness.destination,
      applicationStateTransport: applicationTransport,
    });
    const replacementBarrier = harness.currentBarrier;
    const admission = {
      get: jest.fn(
        async () => applicationTransport.snapshot.checkpoint.sourceBarrier,
      ),
      close: jest.fn(async () => {
        throw new Error('the inherited CLOSED barrier must be adopted');
      }),
      adopt: jest.fn(async () => ({ barrier: replacementBarrier })),
      reopen: jest.fn(async () => ({
        barrier: {
          ...replacementBarrier,
          state: 'OPEN',
          version: 3,
          lastAction: 'reopen',
          lastRequestId: 'replacement-reopen-3',
          updatedAt: 3,
        },
      })),
    };
    const authoritySignal = new AbortController().signal;
    const handler = jest.fn(
      async (/** @type {any} */ boundLedger, /** @type {any} */ session) => {
        await expectSeed(
          harness.replacementConfiguration,
          replacementAuthority,
        );
        const rebuilt = await boundLedger.rebuildRun(
          'snapshot-reconstructed-run',
        );
        expect(rebuilt).toMatchObject({
          run: { runId: 'snapshot-reconstructed-run' },
          invocations: [
            expect.objectContaining({
              invocationId: 'main',
            }),
          ],
        });
        await expect(
          replacementPayloads.readJson(rebuilt.invocations[0].requestRef),
        ).resolves.toEqual({
          input: { command: 'resume', sequence: 7 },
          callerMetadata: { source: 'sealed-snapshot-e2e' },
        });
        return {
          inspectedRuns: session.reconstruction.inspectedRuns,
          transportStatus: session.applicationStateTransport.status,
          applicationStateStatus: session.applicationState.status,
        };
      },
    );
    const configuration = Object.freeze({
      adapterName: /** @type {const} */ ('dynamodb'),
      controlPath: harness.controlPath,
      tableName: CONTROL_TABLE,
      payloadPath: join(harness.root, 'replacement-payloads'),
      payloadStoreId,
      sessionPath: join(harness.root, 'sessions'),
      region: 'us-east-2',
      residentCoordinatorAuthority: Object.freeze({
        profile: /** @type {const} */ ('dynamodb-rvn-v1'),
        adapterName: /** @type {const} */ ('dynamodb'),
        region: 'us-east-2',
        tableName: CONTROL_TABLE,
        tableResourceId,
        renewalIntervalMs: 5_000,
        observationWindowMs: 15_000,
      }),
    });

    await expect(
      withReconstructedExecutionLedgerResidentAuthority(
        /** @type {any} */ ({
          appId: APP_ID,
          currentRevisionId,
          coordinatorId: 'replacement-coordinator',
          ledger,
          context: {
            db: harness.controlDb,
            adapterName: 'dynamodb',
            tableName: CONTROL_TABLE,
            readOnly: false,
            payloadStore: replacementPayloads,
          },
          configuration,
          replacementInput,
          transportApplicationState: async (
            /** @type {any} */ _boundLedger,
            /** @type {any} */ session,
          ) =>
            await transportApplicationStateSnapshot({
              configuration: harness.replacementConfiguration,
              controlContext: harness.controlContext,
              transport: session.replacementInput.applicationStateTransport,
              history: session.applicationStateHistory,
              closedBarrier: session.closedBarrier,
              coordinatorAuthority: session.coordinatorAuthority,
              distribution: harness.distribution,
              signal: session.signal,
            }),
          prepareApplicationState: async (
            /** @type {any} */ boundLedger,
            /** @type {any} */ session,
          ) =>
            await prepareApplicationStateReadiness({
              ledger: boundLedger,
              appId: APP_ID,
              controlContext: harness.controlContext,
              configuration: harness.replacementConfiguration,
              signal: session.signal,
            }),
          handler,
        }),
        /** @type {any} */ ({
          validateTopology: async () => ({ tableResourceId }),
          createProtocol: () => Object.freeze({ kind: 'test-protocol' }),
          createSupervisor: () => ({
            run: async (/** @type {any} */ { handler: supervisedHandler }) =>
              await supervisedHandler({
                authority: replacementAuthority,
                coordinatorAuthority: replacementAuthority,
                signal: authoritySignal,
              }),
          }),
          createAdmissionBarrier: () => admission,
        }),
      ),
    ).resolves.toEqual({
      inspectedRuns: 1,
      transportStatus: 'HYDRATED',
      applicationStateStatus: 'ADOPTED',
    });
    expect(payloadRead).toHaveBeenCalledTimes(1);
    expect(admission.reopen).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('reactivates the exact retained source atomically under newer authority', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    harness.providerRead.mockClear();
    const replacementAuthority = await harness.takeover();
    const readiness = await transportApplicationStateSnapshot({
      configuration: harness.sourceConfiguration,
      controlContext: harness.controlContext,
      transport,
      history: transport.snapshot.checkpoint.history,
      closedBarrier: harness.currentBarrier,
      coordinatorAuthority: replacementAuthority,
      distribution: harness.distribution,
    });
    expect(readiness).toMatchObject({ status: 'RETAINED' });
    expect(harness.providerRead).not.toHaveBeenCalled();
    await expectSeed(harness.sourceConfiguration, replacementAuthority);

    const access = await openApplicationStateDB({
      configuration: harness.sourceConfiguration,
    });
    try {
      const current = createApplicationStateTable({
        db: access.db,
        tableName: access.context.tableName,
        coordinatorAuthority: replacementAuthority,
      });
      await expect(
        current.readStoreRetirement({
          storeId: harness.destination.configuration.storeId,
          namespace: APP_ID,
        }),
      ).resolves.toBeNull();
      await expect(
        current.putIfAbsent(intent('replacement')),
      ).resolves.toMatchObject({ inserted: true });
      const stale = createApplicationStateTable({
        db: access.db,
        tableName: access.context.tableName,
        coordinatorAuthority: harness.sourceAuthority,
      });
      await expect(stale.putIfAbsent(intent('stale'))).rejects.toThrow(
        /not adopted/u,
      );
    } finally {
      await access.close();
    }
  });

  test('rejects a same-transfer retained-volume snapshot substitution', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const original = harness.artifacts.get(transport.snapshot.snapshotId);
    const substitutedBytes = Buffer.from(original);
    substitutedBytes[substitutedBytes.byteLength - 1] ^= 0xff;
    const substitutedSnapshot = createApplicationStateSnapshotReference({
      bytes: substitutedBytes,
      destination: transport.snapshot.destination,
      transferId: transport.snapshot.transferId,
      history: transport.snapshot.checkpoint.history,
      closedBarrier: transport.snapshot.checkpoint.sourceBarrier,
      sourceDestinationAuthorityDigest:
        transport.snapshot.checkpoint.sourceDestinationAuthorityDigest,
    });
    harness.artifacts.set(substitutedSnapshot.snapshotId, substitutedBytes);
    const replacementAuthority = await harness.takeover();
    await expect(
      transportApplicationStateSnapshot({
        configuration: harness.sourceConfiguration,
        controlContext: harness.controlContext,
        transport: {
          kind: transport.kind,
          distribution: transport.distribution,
          snapshot: substitutedSnapshot,
        },
        history: transport.snapshot.checkpoint.history,
        closedBarrier: harness.currentBarrier,
        coordinatorAuthority: replacementAuthority,
        distribution: harness.distribution,
      }),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
  });

  test.each([
    'source-adopted',
    'marker-persisted',
    'source-sealed',
    'backup-complete',
    'snapshot-published',
    'source-retired',
  ])(
    'retries one exact publication after %s interruption',
    async (failedPhase) => {
      const harness = await createHarness();
      const interruption = new Error(`crash at ${failedPhase}`);
      await expect(
        harness.publish({
          observePhase: (/** @type {string} */ phase) => {
            if (phase === failedPhase) throw interruption;
          },
        }),
      ).rejects.toBe(interruption);
      const transport = await harness.publish();
      await expect(
        recoverRetiredApplicationStateSnapshot({
          controlContext: harness.controlContext,
          destination: harness.destination,
          transferId: harness.transferId,
          distribution: harness.distribution,
        }),
      ).resolves.toEqual(transport);
      await expect(harness.publish()).resolves.toEqual(transport);
    },
  );

  test('keeps a provider precommit failure sealed and safely retryable', async () => {
    const harness = await createHarness();
    const providerFailure = new Error('snapshot provider unavailable');
    harness.providerPublish.mockImplementationOnce(async () => {
      throw providerFailure;
    });
    await expect(harness.publish()).rejects.toBe(providerFailure);
    await expect(
      recoverRetiredApplicationStateSnapshot({
        controlContext: harness.controlContext,
        destination: harness.destination,
        transferId: harness.transferId,
        distribution: harness.distribution,
      }),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
    const sealed = await openApplicationStateDB({
      configuration: harness.sourceConfiguration,
    });
    try {
      const table = createApplicationStateTable({
        db: sealed.db,
        tableName: sealed.context.tableName,
        coordinatorAuthority: harness.sourceAuthority,
      });
      await expect(
        table.putIfAbsent(intent('provider-failed')),
      ).rejects.toBeInstanceOf(ApplicationStateStoreRetiredError);
    } finally {
      await sealed.close();
    }
    await expect(harness.publish()).resolves.toMatchObject({
      snapshot: { transferId: harness.transferId },
    });
  });

  test('does not publish when application-state history moves across the sealed cut', async () => {
    const harness = await createHarness();
    let scans = 0;
    const movingLedger = {
      listRuns: jest.fn(async () => {
        scans += 1;
        return scans === 1
          ? { items: [] }
          : { items: [{ appId: APP_ID, runId: 'late-run' }] };
      }),
      rebuildRun: jest.fn(async () => ({
        run: {
          runId: 'late-run',
          appId: APP_ID,
          revisionId: id('wrv1', 'late-revision'),
          status: 'COMPLETED',
          trigger: { kind: 'manual' },
        },
        effects: [],
      })),
    };
    await expect(harness.publish({ ledger: movingLedger })).rejects.toThrow(
      /history changed/u,
    );
    expect(harness.providerPublish).not.toHaveBeenCalled();
  });

  test('resumes when hydration committed before its response was lost', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    harness.providerRead.mockClear();
    const replacementAuthority = await harness.takeover();
    const committedFailure = new Error('lost after hydration commit');
    const input = {
      configuration: harness.replacementConfiguration,
      controlContext: harness.controlContext,
      transport,
      history: transport.snapshot.checkpoint.history,
      closedBarrier: harness.currentBarrier,
      coordinatorAuthority: replacementAuthority,
      distribution: harness.distribution,
    };
    await expect(
      transportApplicationStateSnapshot({
        ...input,
        observePhase: (/** @type {string} */ phase) => {
          if (phase === 'hydration-committed') throw committedFailure;
        },
      }),
    ).rejects.toBe(committedFailure);
    await expect(
      transportApplicationStateSnapshot(input),
    ).resolves.toMatchObject({ status: 'HYDRATED' });
    await expectSeed(harness.replacementConfiguration, replacementAuthority);
  });

  test('cleans an interrupted hydration stage and retries from true absence', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const stagedFailure = new Error('crash before hydration claim');
    const input = {
      configuration: harness.replacementConfiguration,
      controlContext: harness.controlContext,
      transport,
      history: transport.snapshot.checkpoint.history,
      closedBarrier: harness.currentBarrier,
      coordinatorAuthority: replacementAuthority,
      distribution: harness.distribution,
    };
    await expect(
      transportApplicationStateSnapshot({
        ...input,
        observePhase: (/** @type {string} */ phase) => {
          if (phase === 'hydration-staged') throw stagedFailure;
        },
      }),
    ).rejects.toBe(stagedFailure);
    await expect(
      fsp.lstat(join(harness.replacementPath, 'lmdb')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const entries = await fsp.readdir(harness.replacementPath);
    expect(
      entries.some((entry) =>
        entry.startsWith('.wharfie-application-state-hydration-'),
      ),
    ).toBe(false);
    await expect(
      transportApplicationStateSnapshot(input),
    ).resolves.toMatchObject({ status: 'HYDRATED' });
  });

  test('cleans its exact claim and target after interruption before hydration evidence', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const targetCreatedFailure = new Error(
      'crash after exclusive hydration target creation',
    );
    const claimPath = join(harness.replacementPath, HYDRATION_CLAIM_FILE);
    let observedClaim;
    const input = {
      configuration: harness.replacementConfiguration,
      controlContext: harness.controlContext,
      transport,
      history: transport.snapshot.checkpoint.history,
      closedBarrier: harness.currentBarrier,
      coordinatorAuthority: replacementAuthority,
      distribution: harness.distribution,
    };

    await expect(
      transportApplicationStateSnapshot({
        ...input,
        observePhase: async (/** @type {string} */ phase) => {
          if (phase !== 'hydration-target-created') return;
          observedClaim = JSON.parse(await fsp.readFile(claimPath, 'utf8'));
          throw targetCreatedFailure;
        },
      }),
    ).rejects.toBe(targetCreatedFailure);

    expect(observedClaim).toMatchObject({
      kind: HYDRATION_CLAIM_KIND,
      snapshotId: transport.snapshot.snapshotId,
    });
    await expect(fsp.lstat(claimPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      fsp.lstat(join(harness.replacementPath, 'lmdb')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      transportApplicationStateSnapshot(input),
    ).resolves.toMatchObject({ status: 'HYDRATED' });
    await expectSeed(harness.replacementConfiguration, replacementAuthority);
  });

  test('recovers exact linked hydration evidence and releases its retained claim', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const evidenceLinkedFailure = new Error(
      'crash after hydration evidence link',
    );
    const claimPath = join(harness.replacementPath, HYDRATION_CLAIM_FILE);
    const evidencePath = hydrationEvidencePath(
      harness.replacementPath,
      transport.snapshot.snapshotId,
    );
    const snapshotBytes = harness.artifacts.get(transport.snapshot.snapshotId);
    if (!snapshotBytes) throw new Error('Expected published snapshot bytes.');
    let observedClaim;
    const input = {
      configuration: harness.replacementConfiguration,
      controlContext: harness.controlContext,
      transport,
      history: transport.snapshot.checkpoint.history,
      closedBarrier: harness.currentBarrier,
      coordinatorAuthority: replacementAuthority,
      distribution: harness.distribution,
    };

    await expect(
      transportApplicationStateSnapshot({
        ...input,
        observePhase: async (/** @type {string} */ phase) => {
          if (phase !== 'hydration-evidence-linked') return;
          observedClaim = JSON.parse(await fsp.readFile(claimPath, 'utf8'));
          throw evidenceLinkedFailure;
        },
      }),
    ).rejects.toBe(evidenceLinkedFailure);

    expect(observedClaim).toMatchObject({
      kind: HYDRATION_CLAIM_KIND,
      snapshotId: transport.snapshot.snapshotId,
    });
    await expect(fsp.readFile(evidencePath, 'utf8')).resolves.toBe(
      `${transport.snapshot.snapshotId}\n`,
    );
    await expect(
      fsp.readFile(join(harness.replacementPath, 'lmdb', 'data.mdb')),
    ).resolves.toEqual(snapshotBytes);
    await expect(fsp.lstat(claimPath)).resolves.toMatchObject({
      isFile: expect.any(Function),
    });

    harness.providerRead.mockClear();
    await expect(
      transportApplicationStateSnapshot(input),
    ).resolves.toMatchObject({ status: 'HYDRATED' });
    expect(harness.providerRead).not.toHaveBeenCalled();
    await expect(fsp.lstat(claimPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expectSeed(harness.replacementConfiguration, replacementAuthority);
  });

  test('explicitly recovers one inspected empty partial hydration and retains an inert replay receipt', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const partial = await createRecoverablePartialHydration(
      harness,
      transport,
      'explicit-recovery',
    );
    const input = hydrationRecoveryInput(
      harness,
      transport,
      replacementAuthority,
    );
    const inspection =
      await inspectApplicationStateSnapshotHydrationRecovery(input);
    const artifacts = hydrationRecoveryArtifacts(
      harness.replacementPath,
      inspection.recovery,
    );

    expect(Object.keys(inspection).sort()).toEqual(
      ['schemaVersion', 'kind', 'inspectionId', 'state', 'recovery'].sort(),
    );
    expect(Object.keys(inspection.recovery).sort()).toEqual(
      [
        'schemaVersion',
        'kind',
        'recoveryId',
        'transport',
        'claim',
        'replicaId',
        'filesystem',
        'replacementBarrier',
        'replacementAuthority',
      ].sort(),
    );
    expect(inspection).toMatchObject({
      schemaVersion: 1,
      kind: 'wharfie.application-state-snapshot-hydration-recovery-inspection.v1',
      inspectionId: expect.stringMatching(/^washri1_/u),
      state: 'PARTIAL_TARGET',
      recovery: {
        schemaVersion: 1,
        kind: 'wharfie.application-state-snapshot-hydration-recovery.v1',
        recoveryId: expect.stringMatching(/^washr1_/u),
        claim: partial.claim,
        replicaId: partial.replicaId,
        transport,
        replacementBarrier: harness.currentBarrier,
        replacementAuthority,
        filesystem: {
          storeRoot: {
            device: expect.stringMatching(/^(0|[1-9][0-9]*)$/u),
            inode: expect.stringMatching(/^(0|[1-9][0-9]*)$/u),
          },
          claimFile: {
            device: expect.stringMatching(/^(0|[1-9][0-9]*)$/u),
            inode: expect.stringMatching(/^(0|[1-9][0-9]*)$/u),
            size: expect.stringMatching(/^(0|[1-9][0-9]*)$/u),
          },
          targetDirectory: {
            device: expect.stringMatching(/^(0|[1-9][0-9]*)$/u),
            inode: expect.stringMatching(/^(0|[1-9][0-9]*)$/u),
          },
        },
      },
    });
    expect(Object.isFrozen(inspection)).toBe(true);
    expect(Object.isFrozen(inspection.recovery)).toBe(true);
    expect(Object.isFrozen(inspection.recovery.filesystem.claimFile)).toBe(
      true,
    );

    await expect(
      recoverApplicationStateSnapshotHydration({
        ...input,
        inspection,
        confirmPartialHydrationRecovery: false,
      }),
    ).rejects.toThrow(/explicit inspected confirmation/iu);
    await expect(readOptionalFile(artifacts.receiptPath)).resolves.toBeNull();
    await expect(readOptionalDirectory(partial.targetPath)).resolves.toEqual(
      [],
    );
    await expect(readOptionalFile(partial.claimPath)).resolves.not.toBeNull();
    const originalClaimBytes = await fsp.readFile(partial.claimPath);

    /** @type {string[]} */
    const phases = [];
    const receipt = await recoverApplicationStateSnapshotHydration({
      ...input,
      inspection,
      confirmPartialHydrationRecovery: true,
      observePhase: (phase) => {
        phases.push(phase);
      },
    });
    expect(receipt).toEqual(inspection.recovery);
    expect(phases).toEqual([
      'hydration-recovery-recorded',
      'hydration-recovery-target-removed',
      'hydration-recovery-claim-released',
    ]);
    await expect(readOptionalDirectory(partial.targetPath)).resolves.toBeNull();
    await expect(readOptionalFile(partial.claimPath)).resolves.toBeNull();
    await expect(
      readOptionalDirectory(artifacts.retiredTargetPath),
    ).resolves.toEqual([]);
    await expect(fsp.readFile(artifacts.retiredClaimPath)).resolves.toEqual(
      originalClaimBytes,
    );
    await expect(fsp.readFile(artifacts.receiptPath, 'utf8')).resolves.toBe(
      `${JSON.stringify(receipt)}\n`,
    );

    const completedInspection =
      await inspectApplicationStateSnapshotHydrationRecovery(input);
    expect(completedInspection).toMatchObject({
      state: 'RECOVERED',
      recovery: receipt,
    });
    await expect(
      recoverApplicationStateSnapshotHydration({
        ...input,
        inspection,
        confirmPartialHydrationRecovery: true,
      }),
    ).resolves.toEqual(receipt);
    await expect(
      recoverApplicationStateSnapshotHydration({
        ...input,
        inspection: completedInspection,
        confirmPartialHydrationRecovery: true,
      }),
    ).resolves.toEqual(receipt);

    await expect(
      transportApplicationStateSnapshot({
        ...input,
        history: transport.snapshot.checkpoint.history,
        distribution: harness.distribution,
      }),
    ).resolves.toMatchObject({ status: 'HYDRATED' });
    await expectSeed(harness.replacementConfiguration, replacementAuthority);
    await expect(fsp.readFile(artifacts.receiptPath, 'utf8')).resolves.toBe(
      `${JSON.stringify(receipt)}\n`,
    );
  });

  test('recovers a second crash-state attempt while the first receipt stays exact and replayable', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const input = hydrationRecoveryInput(
      harness,
      transport,
      replacementAuthority,
    );
    await createRecoverablePartialHydration(harness, transport, 'attempt-a');
    const inspectionA =
      await inspectApplicationStateSnapshotHydrationRecovery(input);
    const artifactsA = hydrationRecoveryArtifacts(
      harness.replacementPath,
      inspectionA.recovery,
    );
    await recoverApplicationStateSnapshotHydration({
      ...input,
      inspection: inspectionA,
      confirmPartialHydrationRecovery: true,
    });
    const receiptA = await fsp.readFile(artifactsA.receiptPath);
    const retiredClaimA = await fsp.readFile(artifactsA.retiredClaimPath);
    const retiredTargetStatA = await fsp.lstat(artifactsA.retiredTargetPath, {
      bigint: true,
    });
    const retiredClaimStatA = await fsp.lstat(artifactsA.retiredClaimPath, {
      bigint: true,
    });

    await createRecoverablePartialHydration(
      harness,
      transport,
      'transport-crash-attempt-b',
    );
    const inspectionB =
      await inspectApplicationStateSnapshotHydrationRecovery(input);
    expect(inspectionB).toMatchObject({ state: 'PARTIAL_TARGET' });
    expect(inspectionB.recovery.recoveryId).not.toBe(
      inspectionA.recovery.recoveryId,
    );
    const artifactsB = hydrationRecoveryArtifacts(
      harness.replacementPath,
      inspectionB.recovery,
    );
    const activeClaimB = await fsp.readFile(
      join(harness.replacementPath, HYDRATION_CLAIM_FILE),
    );
    const activeTargetStatB = await fsp.lstat(
      join(harness.replacementPath, 'lmdb'),
      { bigint: true },
    );
    await expect(
      recoverApplicationStateSnapshotHydration({
        ...input,
        inspection: inspectionA,
        confirmPartialHydrationRecovery: true,
      }),
    ).resolves.toEqual(inspectionA.recovery);
    await expect(
      fsp.readFile(join(harness.replacementPath, HYDRATION_CLAIM_FILE)),
    ).resolves.toEqual(activeClaimB);
    await expect(
      fsp.lstat(join(harness.replacementPath, 'lmdb'), { bigint: true }),
    ).resolves.toMatchObject({
      dev: activeTargetStatB.dev,
      ino: activeTargetStatB.ino,
    });
    await expect(
      recoverApplicationStateSnapshotHydration({
        ...input,
        inspection: inspectionB,
        confirmPartialHydrationRecovery: true,
      }),
    ).resolves.toEqual(inspectionB.recovery);

    await expect(fsp.readFile(artifactsA.receiptPath)).resolves.toEqual(
      receiptA,
    );
    await expect(fsp.readFile(artifactsA.retiredClaimPath)).resolves.toEqual(
      retiredClaimA,
    );
    await expect(
      fsp.lstat(artifactsA.retiredTargetPath, { bigint: true }),
    ).resolves.toMatchObject({
      dev: retiredTargetStatA.dev,
      ino: retiredTargetStatA.ino,
    });
    await expect(
      fsp.lstat(artifactsA.retiredClaimPath, { bigint: true }),
    ).resolves.toMatchObject({
      dev: retiredClaimStatA.dev,
      ino: retiredClaimStatA.ino,
      size: retiredClaimStatA.size,
    });
    await expect(
      readOptionalDirectory(artifactsB.retiredTargetPath),
    ).resolves.toEqual([]);
    await expect(
      readOptionalFile(artifactsB.retiredClaimPath),
    ).resolves.not.toBeNull();
    await expect(
      transportApplicationStateSnapshot({
        ...input,
        history: transport.snapshot.checkpoint.history,
        distribution: harness.distribution,
      }),
    ).resolves.toMatchObject({ status: 'HYDRATED' });
    await expectSeed(harness.replacementConfiguration, replacementAuthority);
    await expect(fsp.readFile(artifactsA.receiptPath)).resolves.toEqual(
      receiptA,
    );
  });

  test('a completed receipt cannot replay under a superseding authority and barrier', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const inputA = hydrationRecoveryInput(
      harness,
      transport,
      replacementAuthority,
    );
    await createRecoverablePartialHydration(
      harness,
      transport,
      'completed-before-supersede',
    );
    const inspectionA =
      await inspectApplicationStateSnapshotHydrationRecovery(inputA);
    await recoverApplicationStateSnapshotHydration({
      ...inputA,
      inspection: inspectionA,
      confirmPartialHydrationRecovery: true,
    });
    const artifacts = hydrationRecoveryArtifacts(
      harness.replacementPath,
      inspectionA.recovery,
    );
    const beforeNames = (await fsp.readdir(harness.replacementPath)).sort();
    const beforeReceipt = await fsp.readFile(artifacts.receiptPath);
    const beforeClaim = await fsp.readFile(artifacts.retiredClaimPath);
    const beforeTargetStats = await fsp.lstat(artifacts.retiredTargetPath, {
      bigint: true,
    });
    const beforeClaimStats = await fsp.lstat(artifacts.retiredClaimPath, {
      bigint: true,
    });

    const laterAuthority = await harness.supersede();
    const inputB = hydrationRecoveryInput(harness, transport, laterAuthority);
    await expect(
      inspectApplicationStateSnapshotHydrationRecovery(inputB),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
    await expect(
      recoverApplicationStateSnapshotHydration({
        ...inputB,
        inspection: inspectionA,
        confirmPartialHydrationRecovery: true,
      }),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);

    await expect(
      fsp.readdir(harness.replacementPath).then((names) => names.sort()),
    ).resolves.toEqual(beforeNames);
    await expect(fsp.readFile(artifacts.receiptPath)).resolves.toEqual(
      beforeReceipt,
    );
    await expect(fsp.readFile(artifacts.retiredClaimPath)).resolves.toEqual(
      beforeClaim,
    );
    await expect(
      fsp.lstat(artifacts.retiredTargetPath, { bigint: true }),
    ).resolves.toMatchObject({
      dev: beforeTargetStats.dev,
      ino: beforeTargetStats.ino,
    });
    await expect(
      fsp.lstat(artifacts.retiredClaimPath, { bigint: true }),
    ).resolves.toMatchObject({
      dev: beforeClaimStats.dev,
      ino: beforeClaimStats.ino,
      size: beforeClaimStats.size,
    });
  });

  test.each(['receipt link', 'target rename', 'claim rename'])(
    'exact concurrent replay establishes its own durable boundary after blocked %s',
    async (boundary) => {
      const harness = await createHarness();
      const transport = await harness.publish();
      const replacementAuthority = await harness.takeover();
      await createRecoverablePartialHydration(
        harness,
        transport,
        `concurrent-${boundary}`,
      );
      const input = hydrationRecoveryInput(
        harness,
        transport,
        replacementAuthority,
      );
      const inspection =
        await inspectApplicationStateSnapshotHydrationRecovery(input);
      const artifacts = hydrationRecoveryArtifacts(
        harness.replacementPath,
        inspection.recovery,
      );
      const syscallReached = deferred();
      const releaseOwner = deferred();
      const realLink = fsp.link.bind(fsp);
      const realRename = fsp.rename.bind(fsp);
      const realOpen = fsp.open.bind(fsp);
      let blocked = false;
      let replayActive = false;
      let replayRootSyncs = 0;
      const linkSpy = jest
        .spyOn(fsp, 'link')
        .mockImplementation(async (source, destination) => {
          const result = await realLink(source, destination);
          if (
            !blocked &&
            boundary === 'receipt link' &&
            destination === artifacts.receiptPath
          ) {
            blocked = true;
            syscallReached.resolve();
            await releaseOwner.promise;
          }
          return result;
        });
      const renameSpy = jest
        .spyOn(fsp, 'rename')
        .mockImplementation(async (source, destination) => {
          const result = await realRename(source, destination);
          const blocksTarget =
            boundary === 'target rename' &&
            source === join(harness.replacementPath, 'lmdb') &&
            destination === artifacts.retiredTargetPath;
          const blocksClaim =
            boundary === 'claim rename' &&
            source === join(harness.replacementPath, HYDRATION_CLAIM_FILE) &&
            destination === artifacts.retiredClaimPath;
          if (!blocked && (blocksTarget || blocksClaim)) {
            blocked = true;
            syscallReached.resolve();
            await releaseOwner.promise;
          }
          return result;
        });
      const openSpy = jest
        .spyOn(fsp, 'open')
        .mockImplementation(async (path, flags, mode) => {
          const handle = await realOpen(path, flags, mode);
          if (path === harness.replacementPath && flags === 'r') {
            const realSync = handle.sync.bind(handle);
            handle.sync = async () => {
              if (replayActive) replayRootSyncs += 1;
              return await realSync();
            };
          }
          return handle;
        });
      const owner = recoverApplicationStateSnapshotHydration({
        ...input,
        inspection,
        confirmPartialHydrationRecovery: true,
      });
      try {
        await Promise.race([
          syscallReached.promise,
          owner.then(
            () => {
              throw new Error('recovery owner settled before interception');
            },
            (error) => {
              throw error;
            },
          ),
        ]);
        replayActive = true;
        const replay = recoverApplicationStateSnapshotHydration({
          ...input,
          inspection,
          confirmPartialHydrationRecovery: true,
        });
        await expect(
          settleBeforeBlockedOwnerRelease(replay, releaseOwner.resolve),
        ).resolves.toEqual(inspection.recovery);
        replayActive = false;
        expect(replayRootSyncs).toBeGreaterThan(0);
      } finally {
        replayActive = false;
        releaseOwner.resolve();
        linkSpy.mockRestore();
        renameSpy.mockRestore();
        openSpy.mockRestore();
      }
      await expect(owner).resolves.toEqual(inspection.recovery);
      await expect(
        readOptionalDirectory(artifacts.retiredTargetPath),
      ).resolves.toEqual([]);
      await expect(
        readOptionalFile(artifacts.retiredClaimPath),
      ).resolves.not.toBeNull();
    },
  );

  test('a global malformed recovery receipt blocks hydration without silent cleanup', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    await fsp.mkdir(harness.replacementPath, { recursive: true, mode: 0o700 });
    const corruptPath = join(
      harness.replacementPath,
      `${HYDRATION_RECOVERY_RECEIPT_FILE_PREFIX}-${id('wass1', 'foreign-registry-snapshot')}-${id('washr1', 'foreign-corrupt-receipt')}`,
    );
    const corruptBytes = Buffer.from('{}\n');
    await fsp.writeFile(corruptPath, corruptBytes, { mode: 0o600 });

    await expect(
      transportApplicationStateSnapshot({
        ...hydrationRecoveryInput(harness, transport, replacementAuthority),
        history: transport.snapshot.checkpoint.history,
        distribution: harness.distribution,
      }),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
    await expect(fsp.readFile(corruptPath)).resolves.toEqual(corruptBytes);
    await expect(
      readOptionalFile(join(harness.replacementPath, HYDRATION_CLAIM_FILE)),
    ).resolves.toBeNull();
    await expect(
      readOptionalDirectory(join(harness.replacementPath, 'lmdb')),
    ).resolves.toBeNull();
  });

  test('orphan retirement evidence blocks inspection without cleanup', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const partial = await createRecoverablePartialHydration(
      harness,
      transport,
      'orphan-retirement-registry',
    );
    const orphanPath = join(
      harness.replacementPath,
      `${HYDRATION_RECOVERY_RETIRED_TARGET_PREFIX}-${transport.snapshot.snapshotId}-${id('washr1', 'orphan-retirement-registry')}`,
    );
    await fsp.mkdir(orphanPath, { mode: 0o700 });
    const claimBytes = await fsp.readFile(partial.claimPath);

    await expect(
      inspectApplicationStateSnapshotHydrationRecovery(
        hydrationRecoveryInput(harness, transport, replacementAuthority),
      ),
    ).rejects.toThrow(/retirement evidence is orphaned/iu);
    await expect(fsp.readFile(partial.claimPath)).resolves.toEqual(claimBytes);
    await expect(readOptionalDirectory(partial.targetPath)).resolves.toEqual(
      [],
    );
    await expect(readOptionalDirectory(orphanPath)).resolves.toEqual([]);
  });

  test('multiple incomplete receipts block inspection without cleanup', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const partial = await createRecoverablePartialHydration(
      harness,
      transport,
      'multiple-incomplete-a',
    );
    const input = hydrationRecoveryInput(
      harness,
      transport,
      replacementAuthority,
    );
    const inspection =
      await inspectApplicationStateSnapshotHydrationRecovery(input);
    const artifactsA = hydrationRecoveryArtifacts(
      harness.replacementPath,
      inspection.recovery,
    );
    const interruption = new Error('stop after first incomplete receipt');
    await expect(
      recoverApplicationStateSnapshotHydration({
        ...input,
        inspection,
        confirmPartialHydrationRecovery: true,
        observePhase: (phase) => {
          if (phase === 'hydration-recovery-recorded') throw interruption;
        },
      }),
    ).rejects.toBe(interruption);
    const secondPayload = {
      schemaVersion: inspection.recovery.schemaVersion,
      kind: inspection.recovery.kind,
      transport: inspection.recovery.transport,
      claim: hydrationClaim(
        transport.snapshot.snapshotId,
        'multiple-incomplete-b',
      ),
      replicaId: inspection.recovery.replicaId,
      filesystem: inspection.recovery.filesystem,
      replacementBarrier: inspection.recovery.replacementBarrier,
      replacementAuthority: inspection.recovery.replacementAuthority,
    };
    const secondRecovery = {
      ...secondPayload,
      recoveryId: createCanonicalJsonSha256Id({
        domain: 'wharfie:application-state-snapshot-hydration-recovery:v1',
        prefix: 'washr1',
        value: secondPayload,
      }),
    };
    const artifactsB = hydrationRecoveryArtifacts(
      harness.replacementPath,
      secondRecovery,
    );
    const receiptB = Buffer.from(`${JSON.stringify(secondRecovery)}\n`);
    await fsp.writeFile(artifactsB.receiptPath, receiptB, { mode: 0o600 });
    const receiptA = await fsp.readFile(artifactsA.receiptPath);
    const claimBytes = await fsp.readFile(partial.claimPath);

    await expect(
      inspectApplicationStateSnapshotHydrationRecovery(input),
    ).rejects.toThrow(/multiple incomplete attempts/iu);
    await expect(fsp.readFile(artifactsA.receiptPath)).resolves.toEqual(
      receiptA,
    );
    await expect(fsp.readFile(artifactsB.receiptPath)).resolves.toEqual(
      receiptB,
    );
    await expect(fsp.readFile(partial.claimPath)).resolves.toEqual(claimBytes);
    await expect(readOptionalDirectory(partial.targetPath)).resolves.toEqual(
      [],
    );
  });

  test('an incomplete receipt blocks a new claim without deleting relocated evidence', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const partial = await createRecoverablePartialHydration(
      harness,
      transport,
      'incomplete-registry-gate',
    );
    const input = hydrationRecoveryInput(
      harness,
      transport,
      replacementAuthority,
    );
    const inspection =
      await inspectApplicationStateSnapshotHydrationRecovery(input);
    const artifacts = hydrationRecoveryArtifacts(
      harness.replacementPath,
      inspection.recovery,
    );
    const claimBytes = await fsp.readFile(partial.claimPath);
    const interruption = new Error('stop after durable receipt');
    await expect(
      recoverApplicationStateSnapshotHydration({
        ...input,
        inspection,
        confirmPartialHydrationRecovery: true,
        observePhase: (phase) => {
          if (phase === 'hydration-recovery-recorded') throw interruption;
        },
      }),
    ).rejects.toBe(interruption);
    const receiptBytes = await fsp.readFile(artifacts.receiptPath);
    const heldClaimPath = join(
      harness.replacementPath,
      '.held-incomplete-recovery-claim',
    );
    const heldTargetPath = join(
      harness.replacementPath,
      '.held-incomplete-recovery-target',
    );
    await fsp.rename(partial.claimPath, heldClaimPath);
    await fsp.rename(partial.targetPath, heldTargetPath);

    await expect(
      transportApplicationStateSnapshot({
        ...input,
        history: transport.snapshot.checkpoint.history,
        distribution: harness.distribution,
      }),
    ).rejects.toThrow(/incomplete hydration recovery receipt blocks/iu);
    await expect(fsp.readFile(artifacts.receiptPath)).resolves.toEqual(
      receiptBytes,
    );
    await expect(fsp.readFile(heldClaimPath)).resolves.toEqual(claimBytes);
    await expect(readOptionalDirectory(heldTargetPath)).resolves.toEqual([]);
    await expect(readOptionalFile(partial.claimPath)).resolves.toBeNull();
    await expect(readOptionalDirectory(partial.targetPath)).resolves.toBeNull();
  }, 10_000);

  test('the 128-receipt registry remains replayable but blocks a new hydration claim', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const input = hydrationRecoveryInput(
      harness,
      transport,
      replacementAuthority,
    );
    await createRecoverablePartialHydration(
      harness,
      transport,
      'capacity-receipt-0',
    );
    const firstInspection =
      await inspectApplicationStateSnapshotHydrationRecovery(input);
    await recoverApplicationStateSnapshotHydration({
      ...input,
      inspection: firstInspection,
      confirmPartialHydrationRecovery: true,
    });
    const storeRootStats = await fsp.lstat(harness.replacementPath, {
      bigint: true,
    });
    const storeRootIdentity = {
      device: storeRootStats.dev.toString(10),
      inode: storeRootStats.ino.toString(10),
    };
    for (let index = 1; index < 128; index += 1) {
      const claim = hydrationClaim(
        transport.snapshot.snapshotId,
        `capacity-receipt-${index}`,
      );
      const temporaryTarget = join(
        harness.replacementPath,
        `.capacity-retired-target-${index}`,
      );
      const temporaryClaim = join(
        harness.replacementPath,
        `.capacity-retired-claim-${index}`,
      );
      await fsp.mkdir(temporaryTarget, { mode: 0o700 });
      await fsp.writeFile(temporaryClaim, `${JSON.stringify(claim)}\n`, {
        mode: 0o600,
      });
      const targetStats = await fsp.lstat(temporaryTarget, { bigint: true });
      const claimStats = await fsp.lstat(temporaryClaim, { bigint: true });
      const payload = {
        schemaVersion: 1,
        kind: 'wharfie.application-state-snapshot-hydration-recovery.v1',
        transport,
        claim,
        replicaId: firstInspection.recovery.replicaId,
        filesystem: {
          storeRoot: storeRootIdentity,
          claimFile: {
            device: claimStats.dev.toString(10),
            inode: claimStats.ino.toString(10),
            size: claimStats.size.toString(10),
          },
          targetDirectory: {
            device: targetStats.dev.toString(10),
            inode: targetStats.ino.toString(10),
          },
        },
        replacementBarrier: harness.currentBarrier,
        replacementAuthority,
      };
      const recoveryId = createCanonicalJsonSha256Id({
        domain: 'wharfie:application-state-snapshot-hydration-recovery:v1',
        prefix: 'washr1',
        value: payload,
      });
      const recovery = { ...payload, recoveryId };
      const artifacts = hydrationRecoveryArtifacts(
        harness.replacementPath,
        recovery,
      );
      await fsp.rename(temporaryTarget, artifacts.retiredTargetPath);
      await fsp.rename(temporaryClaim, artifacts.retiredClaimPath);
      await fsp.writeFile(
        artifacts.receiptPath,
        `${JSON.stringify(recovery)}\n`,
        { mode: 0o600 },
      );
    }
    const receiptNames = (await fsp.readdir(harness.replacementPath)).filter(
      (name) => name.startsWith(`${HYDRATION_RECOVERY_RECEIPT_FILE_PREFIX}-`),
    );
    expect(receiptNames).toHaveLength(128);
    await expect(
      recoverApplicationStateSnapshotHydration({
        ...input,
        inspection: firstInspection,
        confirmPartialHydrationRecovery: true,
      }),
    ).resolves.toEqual(firstInspection.recovery);
    await expect(
      inspectApplicationStateSnapshotHydrationRecovery(input),
    ).resolves.toMatchObject({ state: 'RECOVERED' });

    await expect(
      transportApplicationStateSnapshot({
        ...input,
        history: transport.snapshot.checkpoint.history,
        distribution: harness.distribution,
      }),
    ).rejects.toThrow(/registry is exhausted/iu);
    await expect(
      readOptionalFile(join(harness.replacementPath, HYDRATION_CLAIM_FILE)),
    ).resolves.toBeNull();
    await expect(
      readOptionalDirectory(join(harness.replacementPath, 'lmdb')),
    ).resolves.toBeNull();
    await expect(fsp.readdir(harness.replacementPath)).resolves.toEqual(
      expect.arrayContaining(receiptNames),
    );
  }, 30_000);

  test.each([
    [
      'record persistence',
      'hydration-recovery-recorded',
      'RECOVERY_RECORDED',
      true,
      true,
    ],
    [
      'target removal',
      'hydration-recovery-target-removed',
      'TARGET_REMOVED',
      false,
      true,
    ],
    [
      'claim release',
      'hydration-recovery-claim-released',
      'RECOVERED',
      false,
      false,
    ],
  ])(
    'replays idempotently after interruption following %s',
    async (
      _label,
      interruptedPhase,
      expectedState,
      targetPresent,
      claimPresent,
    ) => {
      const harness = await createHarness();
      const transport = await harness.publish();
      const replacementAuthority = await harness.takeover();
      const partial = await createRecoverablePartialHydration(
        harness,
        transport,
        interruptedPhase,
      );
      const input = hydrationRecoveryInput(
        harness,
        transport,
        replacementAuthority,
      );
      const inspection =
        await inspectApplicationStateSnapshotHydrationRecovery(input);
      const artifacts = hydrationRecoveryArtifacts(
        harness.replacementPath,
        inspection.recovery,
      );
      const originalClaimBytes = await fsp.readFile(partial.claimPath);
      const interruption = new Error(`interrupted after ${interruptedPhase}`);

      await expect(
        recoverApplicationStateSnapshotHydration({
          ...input,
          inspection,
          confirmPartialHydrationRecovery: true,
          observePhase: (phase) => {
            if (phase === interruptedPhase) throw interruption;
          },
        }),
      ).rejects.toBe(interruption);
      expect(await readOptionalDirectory(partial.targetPath)).toEqual(
        targetPresent ? [] : null,
      );
      expect(await readOptionalFile(partial.claimPath)).toEqual(
        claimPresent ? expect.any(Buffer) : null,
      );
      const markerBytes = await readOptionalFile(artifacts.receiptPath);
      expect(markerBytes).not.toBeNull();
      expect(await readOptionalDirectory(artifacts.retiredTargetPath)).toEqual(
        expectedState === 'RECOVERY_RECORDED' ? null : [],
      );
      expect(await readOptionalFile(artifacts.retiredClaimPath)).toEqual(
        expectedState === 'RECOVERED' ? originalClaimBytes : null,
      );

      const retained =
        await inspectApplicationStateSnapshotHydrationRecovery(input);
      expect(retained).toMatchObject({
        state: expectedState,
        recovery: inspection.recovery,
      });
      /** @type {string[]} */
      const replayPhases = [];
      const receipt = await recoverApplicationStateSnapshotHydration({
        ...input,
        inspection,
        confirmPartialHydrationRecovery: true,
        observePhase: (phase) => {
          replayPhases.push(phase);
        },
      });
      expect(receipt).toEqual(inspection.recovery);
      expect(replayPhases).toEqual(
        expectedState === 'RECOVERED'
          ? []
          : [
              'hydration-recovery-recorded',
              'hydration-recovery-target-removed',
              'hydration-recovery-claim-released',
            ],
      );
      await expect(
        recoverApplicationStateSnapshotHydration({
          ...input,
          inspection: retained,
          confirmPartialHydrationRecovery: true,
        }),
      ).resolves.toEqual(receipt);
      await expect(
        readOptionalDirectory(partial.targetPath),
      ).resolves.toBeNull();
      await expect(readOptionalFile(partial.claimPath)).resolves.toBeNull();
      await expect(readOptionalFile(artifacts.receiptPath)).resolves.toEqual(
        markerBytes,
      );
      await expect(
        readOptionalDirectory(artifacts.retiredTargetPath),
      ).resolves.toEqual([]);
      await expect(
        readOptionalFile(artifacts.retiredClaimPath),
      ).resolves.toEqual(originalClaimBytes);
    },
  );

  test.each(['target directory', 'claim file', 'store root'])(
    'rejects same-content %s substitution after inspection without writing recovery state',
    async (substitution) => {
      const harness = await createHarness();
      const transport = await harness.publish();
      const replacementAuthority = await harness.takeover();
      const partial = await createRecoverablePartialHydration(
        harness,
        transport,
        `substitute-${substitution}`,
      );
      const input = hydrationRecoveryInput(
        harness,
        transport,
        replacementAuthority,
      );
      const inspection =
        await inspectApplicationStateSnapshotHydrationRecovery(input);
      const artifacts = hydrationRecoveryArtifacts(
        harness.replacementPath,
        inspection.recovery,
      );
      const claimBytes = await fsp.readFile(partial.claimPath);
      const replicaBytes = await fsp.readFile(
        join(harness.replacementPath, REPLICA_ID_FILE),
      );
      let retainedPath;

      if (substitution === 'target directory') {
        retainedPath = join(harness.replacementPath, '.retained-original-lmdb');
        await fsp.rename(partial.targetPath, retainedPath);
        await fsp.mkdir(partial.targetPath, { mode: 0o700 });
      } else if (substitution === 'claim file') {
        retainedPath = join(
          harness.replacementPath,
          '.retained-original-hydration-claim',
        );
        await fsp.rename(partial.claimPath, retainedPath);
        await fsp.writeFile(partial.claimPath, claimBytes, { mode: 0o600 });
      } else {
        retainedPath = join(harness.root, '.retained-original-store-root');
        await fsp.rename(harness.replacementPath, retainedPath);
        await fsp.mkdir(harness.replacementPath, { mode: 0o700 });
        await fsp.writeFile(
          join(harness.replacementPath, REPLICA_ID_FILE),
          replicaBytes,
          { mode: 0o600 },
        );
        await fsp.writeFile(partial.claimPath, claimBytes, { mode: 0o600 });
        await fsp.mkdir(partial.targetPath, { mode: 0o700 });
      }

      await expect(
        recoverApplicationStateSnapshotHydration({
          ...input,
          inspection,
          confirmPartialHydrationRecovery: true,
        }),
      ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
      await expect(readOptionalFile(artifacts.receiptPath)).resolves.toBeNull();
      await expect(readOptionalFile(partial.claimPath)).resolves.toEqual(
        claimBytes,
      );
      await expect(readOptionalDirectory(partial.targetPath)).resolves.toEqual(
        [],
      );
      if (substitution === 'target directory') {
        await expect(readOptionalDirectory(retainedPath)).resolves.toEqual([]);
      } else if (substitution === 'claim file') {
        await expect(readOptionalFile(retainedPath)).resolves.toEqual(
          claimBytes,
        );
      } else {
        await expect(
          readOptionalDirectory(join(retainedPath, 'lmdb')),
        ).resolves.toEqual([]);
        await expect(
          readOptionalFile(join(retainedPath, HYDRATION_CLAIM_FILE)),
        ).resolves.toEqual(claimBytes);
      }
    },
  );

  test('quarantines a last-window target substitution without deleting either directory', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const partial = await createRecoverablePartialHydration(
      harness,
      transport,
      'target-substitution-after-record',
    );
    const input = hydrationRecoveryInput(
      harness,
      transport,
      replacementAuthority,
    );
    const inspection =
      await inspectApplicationStateSnapshotHydrationRecovery(input);
    const artifacts = hydrationRecoveryArtifacts(
      harness.replacementPath,
      inspection.recovery,
    );
    const claimBytes = await fsp.readFile(partial.claimPath);
    const retainedTarget = join(
      harness.replacementPath,
      '.retained-last-window-hydration-target',
    );
    const realRename = fsp.rename.bind(fsp);
    const renameSpy = jest
      .spyOn(fsp, 'rename')
      .mockImplementation(async (source, destination) => {
        if (
          source === partial.targetPath &&
          destination === artifacts.retiredTargetPath
        ) {
          await realRename(source, retainedTarget);
          await fsp.mkdir(source, { mode: 0o700 });
        }
        return await realRename(source, destination);
      });
    try {
      await expect(
        recoverApplicationStateSnapshotHydration({
          ...input,
          inspection,
          confirmPartialHydrationRecovery: true,
        }),
      ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
    } finally {
      renameSpy.mockRestore();
    }
    await expect(readOptionalDirectory(retainedTarget)).resolves.toEqual([]);
    await expect(readOptionalDirectory(partial.targetPath)).resolves.toBeNull();
    await expect(
      readOptionalDirectory(artifacts.retiredTargetPath),
    ).resolves.toEqual([]);
    await expect(readOptionalFile(partial.claimPath)).resolves.toEqual(
      claimBytes,
    );
    await expect(fsp.readFile(artifacts.receiptPath, 'utf8')).resolves.toBe(
      `${JSON.stringify(inspection.recovery)}\n`,
    );
    await expect(
      inspectApplicationStateSnapshotHydrationRecovery(input),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
    const heldClaim = join(
      harness.replacementPath,
      '.held-last-window-target-mismatch-claim',
    );
    await fsp.rename(partial.claimPath, heldClaim);
    await expect(
      transportApplicationStateSnapshot({
        ...input,
        history: transport.snapshot.checkpoint.history,
        distribution: harness.distribution,
      }),
    ).rejects.toThrow(/retired hydration target does not have/iu);
    await expect(fsp.readFile(heldClaim)).resolves.toEqual(claimBytes);
    await expect(readOptionalFile(partial.claimPath)).resolves.toBeNull();
    await expect(readOptionalDirectory(partial.targetPath)).resolves.toBeNull();
  });

  test('quarantines a last-window claim substitution without deleting either claim', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const partial = await createRecoverablePartialHydration(
      harness,
      transport,
      'claim-substitution-after-target-removal',
    );
    const input = hydrationRecoveryInput(
      harness,
      transport,
      replacementAuthority,
    );
    const inspection =
      await inspectApplicationStateSnapshotHydrationRecovery(input);
    const artifacts = hydrationRecoveryArtifacts(
      harness.replacementPath,
      inspection.recovery,
    );
    const claimBytes = await fsp.readFile(partial.claimPath);
    const retainedClaim = join(
      harness.replacementPath,
      '.retained-removed-target-hydration-claim',
    );

    const realRename = fsp.rename.bind(fsp);
    const renameSpy = jest
      .spyOn(fsp, 'rename')
      .mockImplementation(async (source, destination) => {
        if (
          source === partial.claimPath &&
          destination === artifacts.retiredClaimPath
        ) {
          await realRename(source, retainedClaim);
          await fsp.writeFile(source, claimBytes, { mode: 0o600 });
        }
        return await realRename(source, destination);
      });
    try {
      await expect(
        recoverApplicationStateSnapshotHydration({
          ...input,
          inspection,
          confirmPartialHydrationRecovery: true,
        }),
      ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
    } finally {
      renameSpy.mockRestore();
    }
    await expect(readOptionalDirectory(partial.targetPath)).resolves.toBeNull();
    await expect(
      readOptionalDirectory(artifacts.retiredTargetPath),
    ).resolves.toEqual([]);
    await expect(readOptionalFile(retainedClaim)).resolves.toEqual(claimBytes);
    await expect(readOptionalFile(partial.claimPath)).resolves.toBeNull();
    await expect(readOptionalFile(artifacts.retiredClaimPath)).resolves.toEqual(
      claimBytes,
    );
    await expect(fsp.readFile(artifacts.receiptPath, 'utf8')).resolves.toBe(
      `${JSON.stringify(inspection.recovery)}\n`,
    );
    await expect(
      inspectApplicationStateSnapshotHydrationRecovery(input),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
    await expect(
      transportApplicationStateSnapshot({
        ...input,
        history: transport.snapshot.checkpoint.history,
        distribution: harness.distribution,
      }),
    ).rejects.toThrow(/retired hydration claim does not have/iu);
    await expect(readOptionalFile(partial.claimPath)).resolves.toBeNull();
    await expect(readOptionalDirectory(partial.targetPath)).resolves.toBeNull();
    await expect(readOptionalFile(retainedClaim)).resolves.toEqual(claimBytes);
    await expect(readOptionalFile(artifacts.retiredClaimPath)).resolves.toEqual(
      claimBytes,
    );
  });

  test.each(['superseded authority', 'changed durable barrier'])(
    'rejects recovery under %s without changing retained filesystem evidence',
    async (change) => {
      const harness = await createHarness();
      const transport = await harness.publish();
      const replacementAuthority = await harness.takeover();
      const partial = await createRecoverablePartialHydration(
        harness,
        transport,
        `stale-${change}`,
      );
      const input = hydrationRecoveryInput(
        harness,
        transport,
        replacementAuthority,
      );
      const inspection =
        await inspectApplicationStateSnapshotHydrationRecovery(input);
      const artifacts = hydrationRecoveryArtifacts(
        harness.replacementPath,
        inspection.recovery,
      );
      const claimBytes = await fsp.readFile(partial.claimPath);

      if (change === 'superseded authority') {
        await harness.supersede();
      } else {
        await harness.admission.reopen({
          authority: replacementAuthority,
          requestId: 'recovery-barrier-reopened',
          predecessor: harness.currentBarrier,
          observedAt: harness.currentBarrier.version + 1,
        });
      }

      await expect(
        recoverApplicationStateSnapshotHydration({
          ...input,
          inspection,
          confirmPartialHydrationRecovery: true,
        }),
      ).rejects.toThrow();
      await expect(readOptionalFile(artifacts.receiptPath)).resolves.toBeNull();
      await expect(readOptionalFile(partial.claimPath)).resolves.toEqual(
        claimBytes,
      );
      await expect(readOptionalDirectory(partial.targetPath)).resolves.toEqual(
        [],
      );
    },
  );

  test.each([
    [
      'nonempty target',
      async (
        /** @type {{partial: Awaited<ReturnType<typeof createRecoverablePartialHydration>>}} */ {
          partial,
        },
      ) => {
        const path = join(partial.targetPath, 'data.mdb');
        const bytes = Buffer.from('retained-partial-bytes');
        await fsp.writeFile(path, bytes);
        return { path, bytes };
      },
    ],
    [
      'snapshot-scoped hydration evidence',
      async (
        /** @type {{transport: Readonly<Record<string, any>>, partial: Awaited<ReturnType<typeof createRecoverablePartialHydration>>}} */ {
          transport,
          partial,
        },
      ) => {
        const path = join(
          partial.targetPath,
          `.wharfie-application-state-snapshot-hydration-${transport.snapshot.snapshotId}`,
        );
        const bytes = Buffer.from(`${transport.snapshot.snapshotId}\n`);
        await fsp.writeFile(path, bytes);
        return { path, bytes };
      },
    ],
    [
      'foreign claim',
      async (
        /** @type {{partial: Awaited<ReturnType<typeof createRecoverablePartialHydration>>}} */ {
          partial,
        },
      ) => {
        await fsp.writeFile(
          partial.claimPath,
          `${JSON.stringify(
            hydrationClaim(id('wass1', 'foreign-recovery-snapshot'), 'foreign'),
          )}\n`,
        );
        return null;
      },
    ],
    [
      'corrupt claim',
      async (
        /** @type {{partial: Awaited<ReturnType<typeof createRecoverablePartialHydration>>}} */ {
          partial,
        },
      ) => {
        await fsp.writeFile(partial.claimPath, '{not-json}\n');
        return null;
      },
    ],
    [
      'missing claim',
      async (
        /** @type {{partial: Awaited<ReturnType<typeof createRecoverablePartialHydration>>}} */ {
          partial,
        },
      ) => {
        await fsp.unlink(partial.claimPath);
        return null;
      },
    ],
    [
      'corrupt recovery marker',
      async (
        /** @type {{partial: Awaited<ReturnType<typeof createRecoverablePartialHydration>>}} */ {
          partial,
        },
      ) => {
        await fsp.writeFile(partial.unboundRecoveryPath, '{}\n');
        return null;
      },
    ],
  ])(
    'refuses %s during read-only inspection and preserves every retained byte',
    async (_label, mutate) => {
      const harness = await createHarness();
      const transport = await harness.publish();
      const replacementAuthority = await harness.takeover();
      const partial = await createRecoverablePartialHydration(
        harness,
        transport,
        `unsafe-${_label}`,
      );
      const input = hydrationRecoveryInput(
        harness,
        transport,
        replacementAuthority,
      );
      const retainedFile = await mutate({ transport, partial });
      const beforeClaim = await readOptionalFile(partial.claimPath);
      const beforeTarget = await readOptionalDirectory(partial.targetPath);
      const beforeMarker = await readOptionalFile(partial.unboundRecoveryPath);

      await expect(
        inspectApplicationStateSnapshotHydrationRecovery(input),
      ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
      await expect(readOptionalFile(partial.claimPath)).resolves.toEqual(
        beforeClaim,
      );
      await expect(readOptionalDirectory(partial.targetPath)).resolves.toEqual(
        beforeTarget,
      );
      await expect(
        readOptionalFile(partial.unboundRecoveryPath),
      ).resolves.toEqual(beforeMarker);
      if (retainedFile) {
        await expect(fsp.readFile(retainedFile.path)).resolves.toEqual(
          retainedFile.bytes,
        );
      }
    },
  );

  test('rejects a tampered inspection and an already activated target without recovery writes', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    await createRecoverablePartialHydration(
      harness,
      transport,
      'tampered-inspection',
    );
    const input = hydrationRecoveryInput(
      harness,
      transport,
      replacementAuthority,
    );
    const inspection =
      await inspectApplicationStateSnapshotHydrationRecovery(input);
    const artifacts = hydrationRecoveryArtifacts(
      harness.replacementPath,
      inspection.recovery,
    );
    const tampered = {
      ...JSON.parse(JSON.stringify(inspection)),
      unsupported: true,
    };
    await expect(
      recoverApplicationStateSnapshotHydration({
        ...input,
        inspection: tampered,
        confirmPartialHydrationRecovery: true,
      }),
    ).rejects.toThrow(/unsupported or missing fields/iu);
    await expect(readOptionalFile(artifacts.receiptPath)).resolves.toBeNull();

    await recoverApplicationStateSnapshotHydration({
      ...input,
      inspection,
      confirmPartialHydrationRecovery: true,
    });
    await transportApplicationStateSnapshot({
      ...input,
      history: transport.snapshot.checkpoint.history,
      distribution: harness.distribution,
    });
    await expect(
      inspectApplicationStateSnapshotHydrationRecovery(input),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
  });

  test.each(['RECOVERY_RECORDED', 'TARGET_REMOVED'])(
    'explicitly repairs one exact stale %s recovery and overlays logical completion without erasing evidence',
    async (staleState) => {
      const harness = await createHarness();
      const transport = await harness.publish();
      const stale = await createStaleHydrationRecovery(
        harness,
        transport,
        `complete-${staleState.toLowerCase()}`,
        /** @type {'RECOVERY_RECORDED'|'TARGET_REMOVED'} */ (staleState),
      );
      const staleReceiptBytes = await fsp.readFile(
        stale.recoveryArtifacts.receiptPath,
      );
      const staleClaimBytes = await fsp.readFile(stale.partial.claimPath);
      const staleReceiptStats = await fsp.lstat(
        stale.recoveryArtifacts.receiptPath,
        { bigint: true },
      );
      const publication = await createApplicationStateSnapshotControlStore({
        db: harness.controlDb,
        tableName: CONTROL_TABLE,
      }).getPublication({ transferId: transport.snapshot.transferId });
      if (!publication) throw new Error('Expected retained publication.');

      const inspection =
        await inspectApplicationStateSnapshotHydrationRecoveryRepair(
          stale.repairInput,
        );
      const artifacts = hydrationRecoveryRepairArtifacts(
        harness.replacementPath,
        inspection,
      );
      expect(Object.keys(inspection).sort()).toEqual(
        [
          'schemaVersion',
          'kind',
          'inspectionId',
          'state',
          'repair',
          'authorization',
        ].sort(),
      );
      expect(Object.keys(inspection.repair).sort()).toEqual(
        [
          'schemaVersion',
          'kind',
          'repairId',
          'staleRecovery',
          'publicationId',
          'startingState',
          'filesystem',
        ].sort(),
      );
      expect(Object.keys(inspection.authorization).sort()).toEqual(
        [
          'schemaVersion',
          'kind',
          'authorizationId',
          'repairId',
          'replacementBarrier',
          'replacementAuthority',
        ].sort(),
      );
      expect(inspection).toMatchObject({
        schemaVersion: 1,
        kind: 'wharfie.application-state-snapshot-hydration-recovery-successor-repair-inspection.v1',
        inspectionId: expect.stringMatching(/^washrri1_/u),
        state: `STALE_${staleState}`,
        repair: {
          schemaVersion: 1,
          kind: 'wharfie.application-state-snapshot-hydration-recovery-successor-repair.v1',
          repairId: expect.stringMatching(/^washrr1_/u),
          staleRecovery: stale.recoveryInspection.recovery,
          publicationId: publication.publicationId,
          startingState: staleState,
          filesystem: {
            staleReceiptFile: {
              device: staleReceiptStats.dev.toString(10),
              inode: staleReceiptStats.ino.toString(10),
              size: staleReceiptStats.size.toString(10),
            },
          },
        },
        authorization: {
          schemaVersion: 1,
          kind: 'wharfie.application-state-snapshot-hydration-recovery-successor-repair-authorization.v1',
          authorizationId: expect.stringMatching(/^washrra1_/u),
          repairId: expect.stringMatching(/^washrr1_/u),
          replacementBarrier: harness.currentBarrier,
          replacementAuthority: stale.successorAuthority,
        },
      });
      expect(inspection.authorization.repairId).toBe(
        inspection.repair.repairId,
      );
      expect(Object.isFrozen(inspection)).toBe(true);
      expect(Object.isFrozen(inspection.repair)).toBe(true);
      expect(Object.isFrozen(inspection.repair.staleRecovery)).toBe(true);
      expect(Object.isFrozen(inspection.repair.filesystem)).toBe(true);
      expect(
        Object.isFrozen(inspection.repair.filesystem.staleReceiptFile),
      ).toBe(true);
      expect(Object.isFrozen(inspection.authorization)).toBe(true);
      await expect(readOptionalFile(artifacts.receiptPath)).resolves.toBeNull();
      await expect(
        readOptionalFile(artifacts.authorizationPath),
      ).resolves.toBeNull();

      await expect(
        repairApplicationStateSnapshotHydrationRecovery({
          ...stale.repairInput,
          inspection,
          confirmStaleHydrationRecoveryRepair: false,
        }),
      ).rejects.toThrow(/explicit stale-recovery confirmation/iu);
      await expect(readOptionalFile(artifacts.receiptPath)).resolves.toBeNull();
      await expect(
        readOptionalFile(artifacts.authorizationPath),
      ).resolves.toBeNull();
      await expect(
        fsp.readFile(stale.recoveryArtifacts.receiptPath),
      ).resolves.toEqual(staleReceiptBytes);
      await expect(fsp.readFile(stale.partial.claimPath)).resolves.toEqual(
        staleClaimBytes,
      );

      /** @type {string[]} */
      const phases = [];
      const repair = await repairApplicationStateSnapshotHydrationRecovery({
        ...stale.repairInput,
        inspection,
        confirmStaleHydrationRecoveryRepair: true,
        observePhase: (phase) => {
          phases.push(phase);
        },
      });
      expect(repair).toEqual(inspection.repair);
      expect(phases).toEqual([
        'hydration-recovery-successor-repair-recorded',
        'hydration-recovery-successor-repair-authorized',
        'hydration-recovery-successor-repair-target-retired',
        'hydration-recovery-successor-repair-claim-retired',
      ]);
      const repairReceiptBytes = await fsp.readFile(artifacts.receiptPath);
      const authorizationBytes = await fsp.readFile(
        artifacts.authorizationPath,
      );
      expect(repairReceiptBytes.toString('utf8')).toBe(
        `${JSON.stringify(inspection.repair)}\n`,
      );
      expect(authorizationBytes.toString('utf8')).toBe(
        `${JSON.stringify(inspection.authorization)}\n`,
      );
      await expect(
        readOptionalFile(stale.partial.claimPath),
      ).resolves.toBeNull();
      await expect(
        readOptionalDirectory(stale.partial.targetPath),
      ).resolves.toBeNull();
      await expect(
        readOptionalFile(artifacts.retiredClaimPath),
      ).resolves.toEqual(staleClaimBytes);
      await expect(
        readOptionalDirectory(artifacts.retiredTargetPath),
      ).resolves.toEqual(staleState === 'RECOVERY_RECORDED' ? [] : null);
      await expect(
        readOptionalDirectory(stale.recoveryArtifacts.retiredTargetPath),
      ).resolves.toEqual(staleState === 'TARGET_REMOVED' ? [] : null);
      await expect(
        readOptionalFile(stale.recoveryArtifacts.retiredClaimPath),
      ).resolves.toBeNull();
      await expect(
        fsp.readFile(stale.recoveryArtifacts.receiptPath),
      ).resolves.toEqual(staleReceiptBytes);

      const completed =
        await inspectApplicationStateSnapshotHydrationRecoveryRepair(
          stale.repairInput,
        );
      expect(completed).toMatchObject({
        state: 'REPAIRED',
        repair,
        authorization: inspection.authorization,
      });
      await expect(
        repairApplicationStateSnapshotHydrationRecovery({
          ...stale.repairInput,
          inspection,
          confirmStaleHydrationRecoveryRepair: true,
        }),
      ).rejects.toThrow(/state changed after the retained inspection/iu);
      await expect(
        repairApplicationStateSnapshotHydrationRecovery({
          ...stale.repairInput,
          inspection: completed,
          confirmStaleHydrationRecoveryRepair: true,
        }),
      ).resolves.toEqual(repair);

      await expect(
        transportApplicationStateSnapshot({
          ...stale.repairInput,
          history: transport.snapshot.checkpoint.history,
          distribution: harness.distribution,
        }),
      ).resolves.toMatchObject({ status: 'HYDRATED' });
      await expect(
        fsp.readFile(stale.recoveryArtifacts.receiptPath),
      ).resolves.toEqual(staleReceiptBytes);
      await expect(fsp.readFile(artifacts.receiptPath)).resolves.toEqual(
        repairReceiptBytes,
      );
      await expect(fsp.readFile(artifacts.authorizationPath)).resolves.toEqual(
        authorizationBytes,
      );
      await expect(
        readOptionalFile(artifacts.retiredClaimPath),
      ).resolves.toEqual(staleClaimBytes);
      await expectSeed(
        harness.replacementConfiguration,
        stale.successorAuthority,
      );
    },
    20_000,
  );

  test.each(HYDRATION_RECOVERY_REPAIR_TAKEOVER_CASES)(
    'rejects one same-scope stale inspection after $phase from $staleState, then completes from a fresh inspection',
    async ({ staleState, phase }) => {
      const harness = await createHarness();
      const transport = await harness.publish();
      const label = `same-scope-${staleState.toLowerCase()}-${phase.replace(
        'hydration-recovery-successor-repair-',
        '',
      )}`;
      const stale = await createStaleHydrationRecovery(
        harness,
        transport,
        label,
        staleState,
      );
      const staleInspection =
        await inspectApplicationStateSnapshotHydrationRecoveryRepair(
          stale.repairInput,
        );
      const interruption = new Error(`stop after ${phase}`);
      await expect(
        repairApplicationStateSnapshotHydrationRecovery({
          ...stale.repairInput,
          inspection: staleInspection,
          confirmStaleHydrationRecoveryRepair: true,
          observePhase: (observedPhase) => {
            if (observedPhase === phase) throw interruption;
          },
        }),
      ).rejects.toBe(interruption);
      const beforeStaleReplay = await readHydrationRecoveryStoreSnapshot(
        harness.replacementPath,
      );

      await expect(
        repairApplicationStateSnapshotHydrationRecovery({
          ...stale.repairInput,
          inspection: staleInspection,
          confirmStaleHydrationRecoveryRepair: true,
        }),
      ).rejects.toThrow(/state changed after the retained inspection/iu);
      await expect(
        readHydrationRecoveryStoreSnapshot(harness.replacementPath),
      ).resolves.toEqual(beforeStaleReplay);

      const freshInspection =
        await inspectApplicationStateSnapshotHydrationRecoveryRepair(
          stale.repairInput,
        );
      expect(freshInspection.inspectionId).not.toBe(
        staleInspection.inspectionId,
      );
      expect(freshInspection.repair).toEqual(staleInspection.repair);
      expect(freshInspection.authorization).toEqual(
        staleInspection.authorization,
      );
      await expect(
        repairApplicationStateSnapshotHydrationRecovery({
          ...stale.repairInput,
          inspection: freshInspection,
          confirmStaleHydrationRecoveryRepair: true,
        }),
      ).resolves.toEqual(staleInspection.repair);
      await expect(
        inspectApplicationStateSnapshotHydrationRecoveryRepair(
          stale.repairInput,
        ),
      ).resolves.toMatchObject({
        state: 'REPAIRED',
        repair: staleInspection.repair,
      });
    },
    20_000,
  );

  test('authorizes repair under the same exact authority only after a strictly newer CLOSED barrier', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const recoveryAuthority = await harness.takeover();
    const partial = await createRecoverablePartialHydration(
      harness,
      transport,
      'same-authority-newer-barrier',
    );
    const recoveryInput = hydrationRecoveryInput(
      harness,
      transport,
      recoveryAuthority,
    );
    const recoveryInspection =
      await inspectApplicationStateSnapshotHydrationRecovery(recoveryInput);
    const interruption = new Error('retain same-authority stale recovery');
    await expect(
      recoverApplicationStateSnapshotHydration({
        ...recoveryInput,
        inspection: recoveryInspection,
        confirmPartialHydrationRecovery: true,
        observePhase: (phase) => {
          if (phase === 'hydration-recovery-recorded') throw interruption;
        },
      }),
    ).rejects.toBe(interruption);

    const openBarrier = (
      await harness.admission.reopen({
        authority: recoveryAuthority,
        requestId: 'same-authority-repair-reopen',
        predecessor: harness.currentBarrier,
        observedAt: harness.currentBarrier.version + 1,
      })
    ).barrier;
    const newerClosedBarrier = (
      await harness.admission.close({
        authority: recoveryAuthority,
        requestId: 'same-authority-repair-close',
        predecessor: openBarrier,
        observedAt: openBarrier.version + 1,
      })
    ).barrier;
    const repairInput = Object.freeze({
      ...recoveryInput,
      closedBarrier: newerClosedBarrier,
    });
    const repairInspection =
      await inspectApplicationStateSnapshotHydrationRecoveryRepair(repairInput);
    expect(repairInspection).toMatchObject({
      state: 'STALE_RECOVERY_RECORDED',
      authorization: {
        replacementAuthority: recoveryAuthority,
        replacementBarrier: newerClosedBarrier,
      },
    });
    await expect(
      repairApplicationStateSnapshotHydrationRecovery({
        ...repairInput,
        inspection: repairInspection,
        confirmStaleHydrationRecoveryRepair: true,
      }),
    ).resolves.toEqual(repairInspection.repair);
    await expect(readOptionalFile(partial.claimPath)).resolves.toBeNull();
    await expect(readOptionalDirectory(partial.targetPath)).resolves.toBeNull();
  });

  test('writes no repair evidence when the exact CLOSED barrier changes after inspection', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const stale = await createStaleHydrationRecovery(
      harness,
      transport,
      'barrier-change-after-repair-inspection',
      'RECOVERY_RECORDED',
    );
    const staleInspection =
      await inspectApplicationStateSnapshotHydrationRecoveryRepair(
        stale.repairInput,
      );
    const beforeBarrierChange = await readHydrationRecoveryStoreSnapshot(
      harness.replacementPath,
    );
    const openBarrier = (
      await harness.admission.reopen({
        authority: stale.successorAuthority,
        requestId: 'repair-inspection-barrier-reopen',
        predecessor: harness.currentBarrier,
        observedAt: harness.currentBarrier.version + 1,
      })
    ).barrier;
    const newerClosedBarrier = (
      await harness.admission.close({
        authority: stale.successorAuthority,
        requestId: 'repair-inspection-barrier-close',
        predecessor: openBarrier,
        observedAt: openBarrier.version + 1,
      })
    ).barrier;

    await expect(
      repairApplicationStateSnapshotHydrationRecovery({
        ...stale.repairInput,
        inspection: staleInspection,
        confirmStaleHydrationRecoveryRepair: true,
      }),
    ).rejects.toThrow(/durable coordinator admission barrier/iu);
    await expect(
      readHydrationRecoveryStoreSnapshot(harness.replacementPath),
    ).resolves.toEqual(beforeBarrierChange);

    const currentInput = Object.freeze({
      ...stale.repairInput,
      closedBarrier: newerClosedBarrier,
    });
    const currentInspection =
      await inspectApplicationStateSnapshotHydrationRecoveryRepair(
        currentInput,
      );
    await expect(
      repairApplicationStateSnapshotHydrationRecovery({
        ...currentInput,
        inspection: currentInspection,
        confirmStaleHydrationRecoveryRepair: true,
      }),
    ).resolves.toEqual(currentInspection.repair);
  });

  test('refuses a current-scope recovery and an OPEN successor barrier without writing repair evidence', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const recoveryAuthority = await harness.takeover();
    const partial = await createRecoverablePartialHydration(
      harness,
      transport,
      'repair-current-scope',
    );
    const input = hydrationRecoveryInput(harness, transport, recoveryAuthority);
    const recoveryInspection =
      await inspectApplicationStateSnapshotHydrationRecovery(input);
    const interruption = new Error('retain current-scope recovery');
    await expect(
      recoverApplicationStateSnapshotHydration({
        ...input,
        inspection: recoveryInspection,
        confirmPartialHydrationRecovery: true,
        observePhase: (phase) => {
          if (phase === 'hydration-recovery-recorded') throw interruption;
        },
      }),
    ).rejects.toBe(interruption);
    const recoveryArtifacts = hydrationRecoveryArtifacts(
      harness.replacementPath,
      recoveryInspection.recovery,
    );
    const receiptBytes = await fsp.readFile(recoveryArtifacts.receiptPath);
    const claimBytes = await fsp.readFile(partial.claimPath);
    const repairNamesBefore = (
      await fsp.readdir(harness.replacementPath)
    ).filter((name) =>
      name.startsWith(`${HYDRATION_RECOVERY_FILE_PREFIX}-successor-repair-`),
    );

    await expect(
      inspectApplicationStateSnapshotHydrationRecoveryRepair(input),
    ).rejects.toThrow(/causally newer|stale incomplete|repairable/iu);
    await expect(fsp.readFile(recoveryArtifacts.receiptPath)).resolves.toEqual(
      receiptBytes,
    );
    await expect(fsp.readFile(partial.claimPath)).resolves.toEqual(claimBytes);

    const openBarrier = (
      await harness.admission.reopen({
        authority: recoveryAuthority,
        requestId: 'open-before-successor-repair',
        predecessor: harness.currentBarrier,
        observedAt: harness.currentBarrier.version + 1,
      })
    ).barrier;
    expect(openBarrier.state).toBe('OPEN');
    await expect(
      inspectApplicationStateSnapshotHydrationRecoveryRepair({
        ...input,
        closedBarrier: openBarrier,
      }),
    ).rejects.toThrow(/CLOSED|durable coordinator admission barrier/iu);
    await expect(fsp.readFile(recoveryArtifacts.receiptPath)).resolves.toEqual(
      receiptBytes,
    );
    await expect(fsp.readFile(partial.claimPath)).resolves.toEqual(claimBytes);
    expect(
      (await fsp.readdir(harness.replacementPath)).filter((name) =>
        name.startsWith(`${HYDRATION_RECOVERY_FILE_PREFIX}-successor-repair-`),
      ),
    ).toEqual(repairNamesBefore);
  });

  test('rejects tampered repair, authorization, and inspection envelopes before any mutation', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const stale = await createStaleHydrationRecovery(
      harness,
      transport,
      'tampered-repair-inspection',
      'RECOVERY_RECORDED',
    );
    const inspection =
      await inspectApplicationStateSnapshotHydrationRecoveryRepair(
        stale.repairInput,
      );
    const artifacts = hydrationRecoveryRepairArtifacts(
      harness.replacementPath,
      inspection,
    );
    const staleReceiptBytes = await fsp.readFile(
      stale.recoveryArtifacts.receiptPath,
    );
    const claimBytes = await fsp.readFile(stale.partial.claimPath);
    const cases = [
      {
        ...JSON.parse(JSON.stringify(inspection)),
        unsupported: true,
      },
      {
        ...JSON.parse(JSON.stringify(inspection)),
        repair: {
          ...inspection.repair,
          publicationId: id('wasp1', 'tampered-repair-publication'),
        },
      },
      {
        ...JSON.parse(JSON.stringify(inspection)),
        authorization: {
          ...inspection.authorization,
          replacementAuthority: stale.recoveryAuthority,
        },
      },
    ];

    for (const tampered of cases) {
      await expect(
        repairApplicationStateSnapshotHydrationRecovery({
          ...stale.repairInput,
          inspection: tampered,
          confirmStaleHydrationRecoveryRepair: true,
        }),
      ).rejects.toThrow();
      await expect(readOptionalFile(artifacts.receiptPath)).resolves.toBeNull();
      await expect(
        readOptionalFile(artifacts.authorizationPath),
      ).resolves.toBeNull();
      await expect(
        fsp.readFile(stale.recoveryArtifacts.receiptPath),
      ).resolves.toEqual(staleReceiptBytes);
      await expect(fsp.readFile(stale.partial.claimPath)).resolves.toEqual(
        claimBytes,
      );
      await expect(
        readOptionalDirectory(stale.partial.targetPath),
      ).resolves.toEqual([]);
    }
  });

  test.each([
    'malformed slot',
    'out-of-range slot',
    'slot gap',
    'orphan authorization',
    'duplicate authorization identity',
    'second repair for one stale recovery',
  ])('fails closed on a noncanonical fixed-slot %s artifact', async (fault) => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const recorded = await createRecordedHydrationRecoveryRepair(
      harness,
      transport,
      `fixed-slot-${fault.replaceAll(' ', '-')}`,
    );
    const repair = recorded.inspection.repair;
    const authorizationBytes = Buffer.from(
      `${JSON.stringify(recorded.inspection.authorization)}\n`,
    );
    const retainedRepairBytes = await fsp.readFile(
      recorded.artifacts.receiptPath,
    );
    /** @type {Array<{path: string, bytes: Buffer}>} */
    const written = [];
    if (fault === 'malformed slot') {
      written.push({
        path: join(
          harness.replacementPath,
          `${HYDRATION_RECOVERY_REPAIR_AUTHORIZATION_PREFIX}-${repair.repairId}-00`,
        ),
        bytes: authorizationBytes,
      });
    } else if (fault === 'out-of-range slot') {
      written.push({
        path: join(
          harness.replacementPath,
          `${HYDRATION_RECOVERY_REPAIR_AUTHORIZATION_PREFIX}-${repair.repairId}-128`,
        ),
        bytes: authorizationBytes,
      });
    } else if (fault === 'slot gap') {
      written.push({
        path: hydrationRecoveryRepairArtifacts(
          harness.replacementPath,
          recorded.inspection,
          1,
        ).authorizationPath,
        bytes: authorizationBytes,
      });
    } else if (fault === 'orphan authorization') {
      written.push({
        path: join(
          harness.replacementPath,
          `${HYDRATION_RECOVERY_REPAIR_AUTHORIZATION_PREFIX}-${id('washrr1', 'orphan-fixed-slot-repair')}-000`,
        ),
        bytes: authorizationBytes,
      });
    } else if (fault === 'duplicate authorization identity') {
      written.push(
        {
          path: recorded.artifacts.authorizationPath,
          bytes: authorizationBytes,
        },
        {
          path: hydrationRecoveryRepairArtifacts(
            harness.replacementPath,
            recorded.inspection,
            1,
          ).authorizationPath,
          bytes: authorizationBytes,
        },
      );
    } else {
      const secondRepair = alternateHydrationRecoveryRepair(
        repair,
        'duplicate-fixed-slot-repair-scope',
      );
      written.push({
        path: join(
          harness.replacementPath,
          `${HYDRATION_RECOVERY_REPAIR_RECEIPT_PREFIX}-${secondRepair.repairId}`,
        ),
        bytes: Buffer.from(`${JSON.stringify(secondRepair)}\n`),
      });
    }
    for (const artifact of written) {
      await fsp.writeFile(artifact.path, artifact.bytes, { mode: 0o600 });
    }

    await expect(
      inspectApplicationStateSnapshotHydrationRecoveryRepair(
        recorded.stale.repairInput,
      ),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
    await expect(fsp.readFile(recorded.artifacts.receiptPath)).resolves.toEqual(
      retainedRepairBytes,
    );
    for (const artifact of written) {
      await expect(fsp.readFile(artifact.path)).resolves.toEqual(
        artifact.bytes,
      );
    }
    await expect(
      readOptionalDirectory(recorded.stale.partial.targetPath),
    ).resolves.toEqual([]);
    await expect(
      readOptionalFile(recorded.stale.partial.claimPath),
    ).resolves.not.toBeNull();
  });

  test('ignores exact private repair candidates but rejects and retains a malformed candidate name', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const recorded = await createRecordedHydrationRecoveryRepair(
      harness,
      transport,
      'fixed-slot-private-candidates',
    );
    const repairId = recorded.inspection.repair.repairId;
    const exactCandidates = [
      join(
        harness.replacementPath,
        `${HYDRATION_RECOVERY_REPAIR_CANDIDATE_PREFIX}-${repairId}-00000000-0000-4000-8000-000000000000.tmp`,
      ),
      join(
        harness.replacementPath,
        `${HYDRATION_RECOVERY_REPAIR_AUTHORIZATION_CANDIDATE_PREFIX}-${repairId}-11111111-1111-4111-8111-111111111111.tmp`,
      ),
    ];
    const candidateBytes = Buffer.from('private-incomplete-candidate');
    for (const path of exactCandidates) {
      await fsp.writeFile(path, candidateBytes, { mode: 0o600 });
    }
    await expect(
      inspectApplicationStateSnapshotHydrationRecoveryRepair(
        recorded.stale.repairInput,
      ),
    ).resolves.toMatchObject({
      state: 'REPAIR_RECORDED',
      repair: recorded.inspection.repair,
    });

    const malformedPath = join(
      harness.replacementPath,
      `${HYDRATION_RECOVERY_REPAIR_AUTHORIZATION_CANDIDATE_PREFIX}-${repairId}-not-a-canonical-candidate.tmp`,
    );
    await fsp.writeFile(malformedPath, candidateBytes, { mode: 0o600 });
    await expect(
      inspectApplicationStateSnapshotHydrationRecoveryRepair(
        recorded.stale.repairInput,
      ),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
    for (const path of [...exactCandidates, malformedPath]) {
      await expect(fsp.readFile(path)).resolves.toEqual(candidateBytes);
    }
  });

  test('fails closed when central publication is substituted after repair inspection', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const stale = await createStaleHydrationRecovery(
      harness,
      transport,
      'repair-publication-substitution',
      'RECOVERY_RECORDED',
    );
    const inspection =
      await inspectApplicationStateSnapshotHydrationRecoveryRepair(
        stale.repairInput,
      );
    const artifacts = hydrationRecoveryRepairArtifacts(
      harness.replacementPath,
      inspection,
    );
    const staleReceiptBytes = await fsp.readFile(
      stale.recoveryArtifacts.receiptPath,
    );
    const keyValue = getApplicationStateSnapshotControlPartitionKey(
      transport.snapshot.transferId,
    );
    const raw = await harness.controlDb.get({
      tableName: CONTROL_TABLE,
      keyName: 'run_id',
      keyValue,
      sortKeyName: 'sort_key',
      sortKeyValue: APPLICATION_STATE_SNAPSHOT_PUBLICATION_SORT_KEY,
      consistentRead: true,
    });
    if (!raw) throw new Error('Expected raw publication evidence.');
    await harness.controlDb.put({
      tableName: CONTROL_TABLE,
      keyName: 'run_id',
      sortKeyName: 'sort_key',
      record: {
        ...raw,
        snapshot_id: id('wass1', 'substituted-repair-publication'),
      },
    });

    await expect(
      repairApplicationStateSnapshotHydrationRecovery({
        ...stale.repairInput,
        inspection,
        confirmStaleHydrationRecoveryRepair: true,
      }),
    ).rejects.toThrow();
    await expect(readOptionalFile(artifacts.receiptPath)).resolves.toBeNull();
    await expect(
      readOptionalFile(artifacts.authorizationPath),
    ).resolves.toBeNull();
    await expect(
      fsp.readFile(stale.recoveryArtifacts.receiptPath),
    ).resolves.toEqual(staleReceiptBytes);
    await expect(
      readOptionalFile(stale.partial.claimPath),
    ).resolves.not.toBeNull();
    await expect(
      readOptionalDirectory(stale.partial.targetPath),
    ).resolves.toEqual([]);
  });

  test('fails closed when physical replica activation appears after repair inspection', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const stale = await createStaleHydrationRecovery(
      harness,
      transport,
      'repair-activation-race',
      'RECOVERY_RECORDED',
    );
    const inspection =
      await inspectApplicationStateSnapshotHydrationRecoveryRepair(
        stale.repairInput,
      );
    const artifacts = hydrationRecoveryRepairArtifacts(
      harness.replacementPath,
      inspection,
    );
    const controlStore = createApplicationStateSnapshotControlStore({
      db: harness.controlDb,
      tableName: CONTROL_TABLE,
    });
    const activation = await controlStore.claimActivation({
      transport,
      replacementAuthority: stale.successorAuthority,
      replacementBarrier: harness.currentBarrier,
      replicaId: stale.partial.replicaId,
      transportStatus: 'RETAINED',
    });

    await expect(
      repairApplicationStateSnapshotHydrationRecovery({
        ...stale.repairInput,
        inspection,
        confirmStaleHydrationRecoveryRepair: true,
      }),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
    await expect(readOptionalFile(artifacts.receiptPath)).resolves.toBeNull();
    await expect(
      readOptionalFile(artifacts.authorizationPath),
    ).resolves.toBeNull();
    await expect(
      controlStore.getActivationClaim({
        transferId: transport.snapshot.transferId,
      }),
    ).resolves.toEqual(activation.claim);
    await expect(
      readOptionalFile(stale.partial.claimPath),
    ).resolves.not.toBeNull();
    await expect(
      readOptionalDirectory(stale.partial.targetPath),
    ).resolves.toEqual([]);
  });

  test.each([
    'stale receipt file',
    'target directory',
    'claim file',
    'replica identity',
    'store root',
  ])(
    'fails closed on a substituted %s after repair inspection',
    async (substitution) => {
      const harness = await createHarness();
      const transport = await harness.publish();
      const stale = await createStaleHydrationRecovery(
        harness,
        transport,
        `repair-substitution-${substitution.replaceAll(' ', '-')}`,
        'RECOVERY_RECORDED',
      );
      const inspection =
        await inspectApplicationStateSnapshotHydrationRecoveryRepair(
          stale.repairInput,
        );
      const artifacts = hydrationRecoveryRepairArtifacts(
        harness.replacementPath,
        inspection,
      );
      const staleReceiptBytes = await fsp.readFile(
        stale.recoveryArtifacts.receiptPath,
      );
      const claimBytes = await fsp.readFile(stale.partial.claimPath);
      const replicaPath = join(harness.replacementPath, REPLICA_ID_FILE);
      const replicaBytes = await fsp.readFile(replicaPath);
      let retainedPath;

      if (substitution === 'stale receipt file') {
        retainedPath = join(harness.replacementPath, '.retained-stale-receipt');
        await fsp.rename(stale.recoveryArtifacts.receiptPath, retainedPath);
        await fsp.writeFile(
          stale.recoveryArtifacts.receiptPath,
          staleReceiptBytes,
          { mode: 0o600 },
        );
      } else if (substitution === 'target directory') {
        retainedPath = join(harness.replacementPath, '.retained-stale-target');
        await fsp.rename(stale.partial.targetPath, retainedPath);
        await fsp.mkdir(stale.partial.targetPath, { mode: 0o700 });
      } else if (substitution === 'claim file') {
        retainedPath = join(harness.replacementPath, '.retained-stale-claim');
        await fsp.rename(stale.partial.claimPath, retainedPath);
        await fsp.writeFile(stale.partial.claimPath, claimBytes, {
          mode: 0o600,
        });
      } else if (substitution === 'replica identity') {
        retainedPath = join(harness.replacementPath, '.retained-replica-id');
        await fsp.rename(replicaPath, retainedPath);
        await fsp.writeFile(
          replicaPath,
          `${id('wasr1', 'substituted-repair-replica')}\n`,
          { mode: 0o600 },
        );
      } else {
        retainedPath = join(harness.root, '.retained-repair-store-root');
        await fsp.rename(harness.replacementPath, retainedPath);
        await fsp.cp(retainedPath, harness.replacementPath, {
          recursive: true,
          force: false,
        });
      }

      await expect(
        repairApplicationStateSnapshotHydrationRecovery({
          ...stale.repairInput,
          inspection,
          confirmStaleHydrationRecoveryRepair: true,
        }),
      ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
      await expect(readOptionalFile(artifacts.receiptPath)).resolves.toBeNull();
      await expect(
        readOptionalFile(artifacts.authorizationPath),
      ).resolves.toBeNull();
      await expect(
        readOptionalDirectory(stale.partial.targetPath),
      ).resolves.toEqual([]);
      await expect(
        readOptionalFile(stale.partial.claimPath),
      ).resolves.not.toBeNull();
      if (substitution === 'stale receipt file') {
        await expect(
          fsp.readFile(stale.recoveryArtifacts.receiptPath),
        ).resolves.toEqual(staleReceiptBytes);
        await expect(fsp.readFile(retainedPath)).resolves.toEqual(
          staleReceiptBytes,
        );
      } else if (substitution === 'target directory') {
        await expect(readOptionalDirectory(retainedPath)).resolves.toEqual([]);
      } else if (substitution === 'claim file') {
        await expect(fsp.readFile(stale.partial.claimPath)).resolves.toEqual(
          claimBytes,
        );
        await expect(fsp.readFile(retainedPath)).resolves.toEqual(claimBytes);
      } else if (substitution === 'replica identity') {
        await expect(fsp.readFile(retainedPath)).resolves.toEqual(replicaBytes);
      } else {
        await expect(
          fsp.readFile(
            join(
              retainedPath,
              stale.recoveryArtifacts.receiptPath.slice(
                harness.replacementPath.length + 1,
              ),
            ),
          ),
        ).resolves.toEqual(staleReceiptBytes);
      }
    },
  );

  test.each([
    {
      artifact: 'repair receipt',
      phase: 'hydration-recovery-successor-repair-recorded',
    },
    {
      artifact: 'repair authorization',
      phase: 'hydration-recovery-successor-repair-authorized',
    },
    {
      artifact: 'repair-retired target',
      phase: 'hydration-recovery-successor-repair-target-retired',
    },
    {
      artifact: 'repair-retired claim',
      phase: 'hydration-recovery-successor-repair-claim-retired',
    },
  ])(
    'retains and fails closed on a tampered $artifact',
    async ({ artifact, phase }) => {
      const harness = await createHarness();
      const transport = await harness.publish();
      const stale = await createStaleHydrationRecovery(
        harness,
        transport,
        `tampered-${artifact.replaceAll(' ', '-')}`,
        'RECOVERY_RECORDED',
      );
      const inspection =
        await inspectApplicationStateSnapshotHydrationRecoveryRepair(
          stale.repairInput,
        );
      const artifacts = hydrationRecoveryRepairArtifacts(
        harness.replacementPath,
        inspection,
      );
      const interruption = new Error(`stop before tampering with ${artifact}`);
      await expect(
        repairApplicationStateSnapshotHydrationRecovery({
          ...stale.repairInput,
          inspection,
          confirmStaleHydrationRecoveryRepair: true,
          observePhase: (observedPhase) => {
            if (observedPhase === phase) throw interruption;
          },
        }),
      ).rejects.toBe(interruption);
      const staleReceiptBytes = await fsp.readFile(
        stale.recoveryArtifacts.receiptPath,
      );
      let tamperedPath;
      let retainedPath = null;
      let expectedBytes = null;
      if (artifact === 'repair receipt') {
        tamperedPath = artifacts.receiptPath;
        expectedBytes = Buffer.from('{}\n');
        await fsp.writeFile(tamperedPath, expectedBytes);
      } else if (artifact === 'repair authorization') {
        tamperedPath = artifacts.authorizationPath;
        expectedBytes = Buffer.from('{}\n');
        await fsp.writeFile(tamperedPath, expectedBytes);
      } else if (artifact === 'repair-retired target') {
        tamperedPath = artifacts.retiredTargetPath;
        retainedPath = join(
          harness.replacementPath,
          '.retained-repair-retired-target',
        );
        await fsp.rename(tamperedPath, retainedPath);
        await fsp.mkdir(tamperedPath, { mode: 0o700 });
      } else {
        tamperedPath = artifacts.retiredClaimPath;
        retainedPath = join(
          harness.replacementPath,
          '.retained-repair-retired-claim',
        );
        expectedBytes = await fsp.readFile(tamperedPath);
        await fsp.rename(tamperedPath, retainedPath);
        await fsp.writeFile(tamperedPath, expectedBytes, { mode: 0o600 });
      }

      await expect(
        inspectApplicationStateSnapshotHydrationRecoveryRepair(
          stale.repairInput,
        ),
      ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
      await expect(
        fsp.readFile(stale.recoveryArtifacts.receiptPath),
      ).resolves.toEqual(staleReceiptBytes);
      if (artifact === 'repair-retired target') {
        if (!retainedPath) throw new Error('Expected retained target path.');
        await expect(readOptionalDirectory(tamperedPath)).resolves.toEqual([]);
        await expect(readOptionalDirectory(retainedPath)).resolves.toEqual([]);
      } else {
        await expect(fsp.readFile(tamperedPath)).resolves.toEqual(
          expectedBytes,
        );
        if (retainedPath) {
          await expect(fsp.readFile(retainedPath)).resolves.toEqual(
            expectedBytes,
          );
        }
      }
    },
  );

  test('atomically caps a stale/current authorization race at canonical slot 127', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const recorded = await createRecordedHydrationRecoveryRepair(
      harness,
      transport,
      'fixed-slot-capacity-race',
    );
    const firstAuthorization = recorded.inspection.authorization;
    for (
      let authorizationSlot = 0;
      authorizationSlot < 127;
      authorizationSlot += 1
    ) {
      const fillerAuthorization =
        authorizationSlot === 0
          ? firstAuthorization
          : hydrationRecoveryRepairAuthorization(
              recorded.inspection.repair,
              {
                ...firstAuthorization.replacementBarrier,
                version:
                  firstAuthorization.replacementBarrier.version +
                  authorizationSlot,
                lastRequestId: `fixed-slot-fill-${authorizationSlot}`,
                updatedAt:
                  firstAuthorization.replacementBarrier.updatedAt +
                  authorizationSlot,
              },
              firstAuthorization.replacementAuthority,
            );
      const artifacts = hydrationRecoveryRepairArtifacts(
        harness.replacementPath,
        recorded.inspection,
        authorizationSlot,
      );
      await fsp.writeFile(
        artifacts.authorizationPath,
        `${JSON.stringify(fillerAuthorization)}\n`,
        { mode: 0o600 },
      );
    }

    const staleRaceAuthority = await harness.supersede('fixed-slot-race-stale');
    const staleRaceInput = hydrationRecoveryInput(
      harness,
      transport,
      staleRaceAuthority,
    );
    const staleRaceInspection =
      await inspectApplicationStateSnapshotHydrationRecoveryRepair(
        staleRaceInput,
      );
    const finalSlotPath = hydrationRecoveryRepairArtifacts(
      harness.replacementPath,
      staleRaceInspection,
      127,
    ).authorizationPath;
    const staleAtFinalSlot = deferred();
    const releaseStale = deferred();
    const realLink = fsp.link.bind(fsp);
    let blockedStaleLink = false;
    const linkSpy = jest
      .spyOn(fsp, 'link')
      .mockImplementation(async (source, destination) => {
        if (destination === finalSlotPath && !blockedStaleLink) {
          blockedStaleLink = true;
          staleAtFinalSlot.resolve();
          await releaseStale.promise;
        }
        return await realLink(source, destination);
      });
    const staleRepair = repairApplicationStateSnapshotHydrationRecovery({
      ...staleRaceInput,
      inspection: staleRaceInspection,
      confirmStaleHydrationRecoveryRepair: true,
    });
    const staleOutcome = staleRepair.then(
      (value) => ({ status: /** @type {const} */ ('fulfilled'), value }),
      (reason) => ({ status: /** @type {const} */ ('rejected'), reason }),
    );
    try {
      await Promise.race([
        staleAtFinalSlot.promise,
        staleOutcome.then((outcome) => {
          if (outcome.status === 'fulfilled') {
            throw new Error('Stale repair settled before final-slot race.');
          }
          throw outcome.reason;
        }),
      ]);
      const currentAuthority = await harness.supersede(
        'fixed-slot-race-current',
      );
      const currentInput = hydrationRecoveryInput(
        harness,
        transport,
        currentAuthority,
      );
      const currentInspection =
        await inspectApplicationStateSnapshotHydrationRecoveryRepair(
          currentInput,
        );
      const currentInterruption = new Error(
        'stop current winner after final authorization',
      );
      await expect(
        repairApplicationStateSnapshotHydrationRecovery({
          ...currentInput,
          inspection: currentInspection,
          confirmStaleHydrationRecoveryRepair: true,
          observePhase: (phase) => {
            if (phase === 'hydration-recovery-successor-repair-authorized') {
              throw currentInterruption;
            }
          },
        }),
      ).rejects.toBe(currentInterruption);
      await expect(fsp.readFile(finalSlotPath, 'utf8')).resolves.toBe(
        `${JSON.stringify(currentInspection.authorization)}\n`,
      );

      releaseStale.resolve();
      const staleResult = await staleOutcome;
      expect(staleResult.status).toBe('rejected');
      if (staleResult.status !== 'rejected') {
        throw new Error('Stale repair unexpectedly won the final slot.');
      }
      expect(staleResult.reason).toBeInstanceOf(CoordinatorAuthorityStaleError);
      const authorizationNames = (await fsp.readdir(harness.replacementPath))
        .filter((name) =>
          name.startsWith(
            `${HYDRATION_RECOVERY_REPAIR_AUTHORIZATION_PREFIX}-${recorded.inspection.repair.repairId}-`,
          ),
        )
        .sort();
      expect(authorizationNames).toEqual(
        Array.from(
          { length: 128 },
          (_value, authorizationSlot) =>
            `${HYDRATION_RECOVERY_REPAIR_AUTHORIZATION_PREFIX}-${recorded.inspection.repair.repairId}-${String(authorizationSlot).padStart(3, '0')}`,
        ),
      );
      await expect(
        readOptionalFile(
          join(
            harness.replacementPath,
            `${HYDRATION_RECOVERY_REPAIR_AUTHORIZATION_PREFIX}-${recorded.inspection.repair.repairId}-128`,
          ),
        ),
      ).resolves.toBeNull();
      await expect(
        readOptionalDirectory(recorded.stale.partial.targetPath),
      ).resolves.toEqual([]);
      await expect(
        readOptionalFile(recorded.stale.partial.claimPath),
      ).resolves.not.toBeNull();

      const beforeExactReplay = await readHydrationRecoveryStoreSnapshot(
        harness.replacementPath,
      );
      const exactReplayInterruption = new Error(
        'stop exact replay at full authorization capacity',
      );
      await expect(
        repairApplicationStateSnapshotHydrationRecovery({
          ...currentInput,
          inspection: currentInspection,
          confirmStaleHydrationRecoveryRepair: true,
          observePhase: (phase) => {
            if (phase === 'hydration-recovery-successor-repair-authorized') {
              throw exactReplayInterruption;
            }
          },
        }),
      ).rejects.toBe(exactReplayInterruption);
      await expect(
        readHydrationRecoveryStoreSnapshot(harness.replacementPath),
      ).resolves.toEqual(beforeExactReplay);

      const exhaustedAuthority = await harness.supersede(
        'fixed-slot-race-exhausted',
      );
      const beforeExhaustedInspection =
        await readHydrationRecoveryStoreSnapshot(harness.replacementPath);
      await expect(
        inspectApplicationStateSnapshotHydrationRecoveryRepair(
          hydrationRecoveryInput(harness, transport, exhaustedAuthority),
        ),
      ).rejects.toThrow(/authorization registry is exhausted/iu);
      await expect(
        readHydrationRecoveryStoreSnapshot(harness.replacementPath),
      ).resolves.toEqual(beforeExhaustedInspection);
    } finally {
      releaseStale.resolve();
      await staleOutcome;
      linkSpy.mockRestore();
    }
  }, 60_000);

  test.each(HYDRATION_RECOVERY_REPAIR_TAKEOVER_CASES)(
    'reuses one stable repair with fresh authorization after takeover during $phase from $staleState',
    async ({ staleState, phase }) => {
      const harness = await createHarness();
      const transport = await harness.publish();
      const label = `${staleState.toLowerCase()}-${phase.replace(
        'hydration-recovery-successor-repair-',
        '',
      )}`;
      const stale = await createStaleHydrationRecovery(
        harness,
        transport,
        label,
        staleState,
      );
      const firstInspection =
        await inspectApplicationStateSnapshotHydrationRecoveryRepair(
          stale.repairInput,
        );
      const firstArtifacts = hydrationRecoveryRepairArtifacts(
        harness.replacementPath,
        firstInspection,
      );
      const staleReceiptBytes = await fsp.readFile(
        stale.recoveryArtifacts.receiptPath,
      );
      const staleClaimBytes = await fsp.readFile(stale.partial.claimPath);
      /** @type {ReturnType<typeof createCoordinatorAuthorityToken> | undefined} */
      let nextAuthority;

      await expect(
        repairApplicationStateSnapshotHydrationRecovery({
          ...stale.repairInput,
          inspection: firstInspection,
          confirmStaleHydrationRecoveryRepair: true,
          observePhase: async (observedPhase) => {
            if (observedPhase !== phase) return;
            nextAuthority = await harness.supersede(`takeover-${label}`);
          },
        }),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);
      if (!nextAuthority) {
        throw new Error(`Repair never reached takeover phase ${phase}.`);
      }
      const stableReceiptBytes = await fsp.readFile(firstArtifacts.receiptPath);
      expect(stableReceiptBytes.toString('utf8')).toBe(
        `${JSON.stringify(firstInspection.repair)}\n`,
      );
      const firstAuthorizationBytes = await readOptionalFile(
        firstArtifacts.authorizationPath,
      );
      expect(firstAuthorizationBytes).toEqual(
        phase === 'hydration-recovery-successor-repair-recorded'
          ? null
          : Buffer.from(`${JSON.stringify(firstInspection.authorization)}\n`),
      );

      const nextInput = hydrationRecoveryInput(
        harness,
        transport,
        nextAuthority,
      );
      const nextInspection =
        await inspectApplicationStateSnapshotHydrationRecoveryRepair(nextInput);
      expect(nextInspection.repair).toEqual(firstInspection.repair);
      expect(nextInspection.repair.repairId).toBe(
        firstInspection.repair.repairId,
      );
      expect(nextInspection.authorization.authorizationId).not.toBe(
        firstInspection.authorization.authorizationId,
      );
      expect(nextInspection.authorization).toMatchObject({
        repairId: firstInspection.repair.repairId,
        replacementAuthority: nextAuthority,
        replacementBarrier: harness.currentBarrier,
      });
      expect(nextInspection.state).toBe(
        phase === 'hydration-recovery-successor-repair-claim-retired'
          ? 'REPAIRED'
          : phase === 'hydration-recovery-successor-repair-target-retired' ||
              (staleState === 'TARGET_REMOVED' &&
                phase === 'hydration-recovery-successor-repair-authorized')
            ? 'TARGET_RETIRED'
            : 'REPAIR_RECORDED',
      );

      const beforeReplayNames = (
        await fsp.readdir(harness.replacementPath)
      ).sort();
      await expect(
        repairApplicationStateSnapshotHydrationRecovery({
          ...nextInput,
          inspection: nextInspection,
          confirmStaleHydrationRecoveryRepair: true,
        }),
      ).resolves.toEqual(firstInspection.repair);
      const nextArtifacts = hydrationRecoveryRepairArtifacts(
        harness.replacementPath,
        nextInspection,
        firstAuthorizationBytes ? 1 : 0,
      );
      expect(nextArtifacts.receiptPath).toBe(firstArtifacts.receiptPath);
      await expect(fsp.readFile(nextArtifacts.receiptPath)).resolves.toEqual(
        stableReceiptBytes,
      );
      const nextAuthorizationBytes = await readOptionalFile(
        nextArtifacts.authorizationPath,
      );
      expect(nextAuthorizationBytes).toEqual(
        phase === 'hydration-recovery-successor-repair-claim-retired'
          ? null
          : Buffer.from(`${JSON.stringify(nextInspection.authorization)}\n`),
      );
      if (phase === 'hydration-recovery-successor-repair-claim-retired') {
        expect((await fsp.readdir(harness.replacementPath)).sort()).toEqual(
          beforeReplayNames,
        );
      }
      if (firstAuthorizationBytes) {
        await expect(
          fsp.readFile(firstArtifacts.authorizationPath),
        ).resolves.toEqual(firstAuthorizationBytes);
      }
      await expect(
        fsp.readFile(stale.recoveryArtifacts.receiptPath),
      ).resolves.toEqual(staleReceiptBytes);
      await expect(
        readOptionalFile(stale.partial.claimPath),
      ).resolves.toBeNull();
      await expect(
        readOptionalDirectory(stale.partial.targetPath),
      ).resolves.toBeNull();
      await expect(
        readOptionalFile(nextArtifacts.retiredClaimPath),
      ).resolves.toEqual(staleClaimBytes);
      await expect(
        readOptionalDirectory(nextArtifacts.retiredTargetPath),
      ).resolves.toEqual(staleState === 'RECOVERY_RECORDED' ? [] : null);
      await expect(
        inspectApplicationStateSnapshotHydrationRecoveryRepair(nextInput),
      ).resolves.toMatchObject({
        state: 'REPAIRED',
        repair: firstInspection.repair,
        authorization: nextInspection.authorization,
      });
    },
    20_000,
  );

  test('retries idempotently after destination activation response loss', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const activationFailure = new Error('lost destination activation response');
    const input = {
      configuration: harness.replacementConfiguration,
      controlContext: harness.controlContext,
      transport,
      history: transport.snapshot.checkpoint.history,
      closedBarrier: harness.currentBarrier,
      coordinatorAuthority: replacementAuthority,
      distribution: harness.distribution,
    };
    await expect(
      transportApplicationStateSnapshot({
        ...input,
        observePhase: (/** @type {string} */ phase) => {
          if (phase === 'destination-adopted') throw activationFailure;
        },
      }),
    ).rejects.toBe(activationFailure);
    await expect(
      transportApplicationStateSnapshot(input),
    ).resolves.toMatchObject({ status: 'HYDRATED' });
    await expectSeed(harness.replacementConfiguration, replacementAuthority);
  });

  test('rejects corrupt ACTIVE data.mdb without terminating the caller', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const input = {
      configuration: harness.replacementConfiguration,
      controlContext: harness.controlContext,
      transport,
      history: transport.snapshot.checkpoint.history,
      closedBarrier: harness.currentBarrier,
      coordinatorAuthority: replacementAuthority,
      distribution: harness.distribution,
    };
    await expect(
      transportApplicationStateSnapshot(input),
    ).resolves.toMatchObject({ status: 'HYDRATED' });

    const malformedBytes = Buffer.from('not-an-lmdb-checkpoint', 'utf8');
    const dataPath = join(harness.replacementPath, 'lmdb', 'data.mdb');
    await fsp.writeFile(dataPath, malformedBytes);
    harness.providerRead.mockClear();

    await expect(
      transportApplicationStateSnapshot(input),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
    expect(harness.providerRead).not.toHaveBeenCalled();
    await expect(fsp.readFile(dataPath)).resolves.toEqual(malformedBytes);
  });

  test('does not recreate a deleted central claim for an ACTIVE target', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const input = {
      configuration: harness.replacementConfiguration,
      controlContext: harness.controlContext,
      transport,
      history: transport.snapshot.checkpoint.history,
      closedBarrier: harness.currentBarrier,
      coordinatorAuthority: replacementAuthority,
      distribution: harness.distribution,
    };
    await expect(
      transportApplicationStateSnapshot(input),
    ).resolves.toMatchObject({ status: 'HYDRATED' });

    const controlStore = createApplicationStateSnapshotControlStore({
      db: harness.controlDb,
      tableName: CONTROL_TABLE,
    });
    await harness.controlDb.remove({
      tableName: CONTROL_TABLE,
      keyName: 'run_id',
      keyValue: getApplicationStateSnapshotControlPartitionKey(
        transport.snapshot.transferId,
      ),
      sortKeyName: 'sort_key',
      sortKeyValue: APPLICATION_STATE_SNAPSHOT_ACTIVATION_SORT_KEY,
    });
    await expect(
      controlStore.getActivationClaim({
        transferId: transport.snapshot.transferId,
      }),
    ).resolves.toBeNull();

    await expect(
      transportApplicationStateSnapshot(input),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotActivationConflictError);
    await expect(
      controlStore.getActivationClaim({
        transferId: transport.snapshot.transferId,
      }),
    ).resolves.toBeNull();
  });

  test.each(['missing', 'substituted'])(
    'rejects an ACTIVE target with %s snapshot-scoped hydration evidence',
    async (evidenceMutation) => {
      const harness = await createHarness();
      const transport = await harness.publish();
      const replacementAuthority = await harness.takeover();
      const input = {
        configuration: harness.replacementConfiguration,
        controlContext: harness.controlContext,
        transport,
        history: transport.snapshot.checkpoint.history,
        closedBarrier: harness.currentBarrier,
        coordinatorAuthority: replacementAuthority,
        distribution: harness.distribution,
      };
      await expect(
        transportApplicationStateSnapshot(input),
      ).resolves.toMatchObject({ status: 'HYDRATED' });

      const evidencePath = join(
        harness.replacementPath,
        'lmdb',
        `.wharfie-application-state-snapshot-hydration-${transport.snapshot.snapshotId}`,
      );
      if (evidenceMutation === 'missing') {
        await fsp.unlink(evidencePath);
      } else {
        await fsp.writeFile(
          evidencePath,
          `${id('wass1', 'substituted-hydration-evidence')}\n`,
          'utf8',
        );
      }
      harness.providerRead.mockClear();

      await expect(
        transportApplicationStateSnapshot(input),
      ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
      expect(harness.providerRead).not.toHaveBeenCalled();
      if (evidenceMutation === 'missing') {
        await expect(fsp.lstat(evidencePath)).rejects.toMatchObject({
          code: 'ENOENT',
        });
      } else {
        await expect(fsp.readFile(evidencePath, 'utf8')).resolves.toBe(
          `${id('wass1', 'substituted-hydration-evidence')}\n`,
        );
      }
    },
  );

  test('concurrent exact hydration retries converge on one physical activation', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const input = {
      configuration: harness.replacementConfiguration,
      controlContext: harness.controlContext,
      transport,
      history: transport.snapshot.checkpoint.history,
      closedBarrier: harness.currentBarrier,
      coordinatorAuthority: replacementAuthority,
      distribution: harness.distribution,
    };
    await expect(
      Promise.all([
        transportApplicationStateSnapshot(input),
        transportApplicationStateSnapshot(input),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ status: 'HYDRATED' }),
      expect.objectContaining({ status: 'HYDRATED' }),
    ]);
    await expectSeed(harness.replacementConfiguration, replacementAuthority);
  });

  test('a concurrent two-replica activation race adopts only the central winner', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const replicas = ['alpha', 'beta'].map((label) => ({
      label,
      configuration: Object.freeze({
        ...harness.replacementConfiguration,
        storePath: join(harness.root, `activation-race-${label}`),
      }),
    }));
    const bothHydratedOrFailed = deferred();
    const releaseActivation = deferred();
    /** @type {string[]} */
    const hydrated = [];
    /** @type {string[]} */
    const destinationAdopted = [];

    const attempts = replicas.map(({ label, configuration }) =>
      transportApplicationStateSnapshot({
        configuration,
        controlContext: harness.controlContext,
        transport,
        history: transport.snapshot.checkpoint.history,
        closedBarrier: harness.currentBarrier,
        coordinatorAuthority: replacementAuthority,
        distribution: harness.distribution,
        observePhase: async (/** @type {string} */ phase) => {
          if (phase === 'hydration-committed') {
            hydrated.push(label);
            if (hydrated.length === replicas.length) {
              bothHydratedOrFailed.resolve();
            }
            await releaseActivation.promise;
          }
          if (phase === 'destination-adopted') {
            destinationAdopted.push(label);
          }
        },
      }).then(
        (value) => ({ label, status: 'fulfilled', value, reason: null }),
        (reason) => {
          bothHydratedOrFailed.resolve();
          return { label, status: 'rejected', value: null, reason };
        },
      ),
    );

    await bothHydratedOrFailed.promise;
    const replicaIds = Object.fromEntries(
      await Promise.all(
        replicas.map(async ({ label, configuration }) => [
          label,
          (await fsp.readFile(join(configuration.storePath, REPLICA_ID_FILE)))
            .toString('utf8')
            .trim(),
        ]),
      ),
    );
    const controlStore = createApplicationStateSnapshotControlStore({
      db: harness.controlDb,
      tableName: CONTROL_TABLE,
    });
    await expect(
      controlStore.getActivationClaim({ transferId: harness.transferId }),
    ).resolves.toBeNull();

    releaseActivation.resolve();
    const outcomes = await Promise.all(attempts);
    expect(hydrated.sort()).toEqual(['alpha', 'beta']);
    expect(
      outcomes.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    const winner = outcomes.find(({ status }) => status === 'fulfilled');
    const loser = outcomes.find(({ status }) => status === 'rejected');
    if (!winner || !loser) throw new Error('Expected one activation winner.');
    expect(loser.reason).toBeInstanceOf(
      ApplicationStateSnapshotActivationConflictError,
    );
    expect(destinationAdopted).toEqual([winner.label]);
    await expect(
      controlStore.getActivationClaim({ transferId: harness.transferId }),
    ).resolves.toMatchObject({
      replicaId: replicaIds[winner.label],
      transportStatus: 'HYDRATED',
    });

    for (const replica of replicas) {
      const access = await openApplicationStateDB({
        configuration: replica.configuration,
        readOnly: true,
      });
      try {
        const table = createApplicationStateTable({
          db: access.db,
          tableName: access.context.tableName,
        });
        const scope = {
          storeId: harness.destination.configuration.storeId,
          namespace: APP_ID,
        };
        if (replica.label === winner.label) {
          await expect(table.readStoreRetirement(scope)).resolves.toBeNull();
          await expect(table.readStoreActivation(scope)).resolves.toMatchObject(
            {
              replica_id: replicaIds[replica.label],
              transport_status: 'HYDRATED',
            },
          );
        } else {
          expect(replica.label).toBe(loser.label);
          await expect(table.readStoreRetirement(scope)).resolves.toMatchObject(
            {
              retirement_id: harness.transferId,
            },
          );
          await expect(table.readStoreActivation(scope)).resolves.toBeNull();
        }
      } finally {
        await access.close();
      }
    }
  });

  test('treats only true target absence as hydratable', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    harness.providerRead.mockClear();
    const replacementAuthority = await harness.takeover();
    await fsp.mkdir(join(harness.replacementPath, 'lmdb'), {
      recursive: true,
    });
    await expect(
      transportApplicationStateSnapshot({
        configuration: harness.replacementConfiguration,
        controlContext: harness.controlContext,
        transport,
        history: transport.snapshot.checkpoint.history,
        closedBarrier: harness.currentBarrier,
        coordinatorAuthority: replacementAuthority,
        distribution: harness.distribution,
      }),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
    expect(harness.providerRead).not.toHaveBeenCalled();
  });

  test('fails closed on an exact stale hydration claim with a partial target', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const claim = hydrationClaim(
      transport.snapshot.snapshotId,
      'stale-partial-hydration',
    );
    const claimPath = join(harness.replacementPath, HYDRATION_CLAIM_FILE);
    const dataPath = join(harness.replacementPath, 'lmdb', 'data.mdb');
    const evidencePath = hydrationEvidencePath(
      harness.replacementPath,
      transport.snapshot.snapshotId,
    );
    const snapshotBytes = harness.artifacts.get(transport.snapshot.snapshotId);
    if (!snapshotBytes) throw new Error('Expected published snapshot bytes.');
    await fsp.mkdir(join(harness.replacementPath, 'lmdb'), {
      recursive: true,
    });
    await fsp.writeFile(dataPath, snapshotBytes);
    await fsp.writeFile(claimPath, `${JSON.stringify(claim)}\n`, 'utf8');
    harness.providerRead.mockClear();

    await expect(
      transportApplicationStateSnapshot({
        configuration: harness.replacementConfiguration,
        controlContext: harness.controlContext,
        transport,
        history: transport.snapshot.checkpoint.history,
        closedBarrier: harness.currentBarrier,
        coordinatorAuthority: replacementAuthority,
        distribution: harness.distribution,
      }),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);

    expect(harness.providerRead).not.toHaveBeenCalled();
    await expect(fsp.readFile(claimPath, 'utf8')).resolves.toBe(
      `${JSON.stringify(claim)}\n`,
    );
    await expect(fsp.readFile(dataPath)).resolves.toEqual(snapshotBytes);
    await expect(fsp.lstat(evidencePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      createApplicationStateSnapshotControlStore({
        db: harness.controlDb,
        tableName: CONTROL_TABLE,
      }).getActivationClaim({ transferId: harness.transferId }),
    ).resolves.toBeNull();
  });

  test('does not overwrite a malformed target that wins exclusive hydration creation', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const malformedBytes = Buffer.from('not-an-lmdb-checkpoint', 'utf8');
    await expect(
      transportApplicationStateSnapshot({
        configuration: harness.replacementConfiguration,
        controlContext: harness.controlContext,
        transport,
        history: transport.snapshot.checkpoint.history,
        closedBarrier: harness.currentBarrier,
        coordinatorAuthority: replacementAuthority,
        distribution: harness.distribution,
        observePhase: async (/** @type {string} */ phase) => {
          if (phase !== 'hydration-staged') return;
          const winner = join(harness.replacementPath, 'lmdb');
          await fsp.mkdir(winner);
          await fsp.writeFile(join(winner, 'data.mdb'), malformedBytes);
        },
      }),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
    await expect(
      fsp.readFile(join(harness.replacementPath, 'lmdb', 'data.mdb')),
    ).resolves.toEqual(malformedBytes);
  });

  test('does not overwrite an empty target that wins the hydration publish race', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    await expect(
      transportApplicationStateSnapshot({
        configuration: harness.replacementConfiguration,
        controlContext: harness.controlContext,
        transport,
        history: transport.snapshot.checkpoint.history,
        closedBarrier: harness.currentBarrier,
        coordinatorAuthority: replacementAuthority,
        distribution: harness.distribution,
        observePhase: async (/** @type {string} */ phase) => {
          if (phase !== 'hydration-staged') return;
          await fsp.mkdir(join(harness.replacementPath, 'lmdb'));
        },
      }),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
    await expect(
      fsp.readdir(join(harness.replacementPath, 'lmdb')),
    ).resolves.toEqual([]);
  });

  test('centrally selects one writable physical replica across retries and later takeover', async () => {
    const harness = await createHarness();
    const transport = await harness.publish();
    const replacementAuthority = await harness.takeover();
    const firstInput = {
      configuration: harness.replacementConfiguration,
      controlContext: harness.controlContext,
      transport,
      history: transport.snapshot.checkpoint.history,
      closedBarrier: harness.currentBarrier,
      coordinatorAuthority: replacementAuthority,
      distribution: harness.distribution,
    };
    await expect(
      transportApplicationStateSnapshot(firstInput),
    ).resolves.toMatchObject({ status: 'HYDRATED' });

    const duplicateConfiguration = Object.freeze({
      ...harness.replacementConfiguration,
      storePath: join(harness.root, 'duplicate-replacement'),
    });
    const duplicateInput = {
      ...firstInput,
      configuration: duplicateConfiguration,
    };
    await expect(
      transportApplicationStateSnapshot(duplicateInput),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotActivationConflictError);
    const duplicate = await openApplicationStateDB({
      configuration: duplicateConfiguration,
    });
    try {
      const sealed = createApplicationStateTable({
        db: duplicate.db,
        tableName: duplicate.context.tableName,
        coordinatorAuthority: replacementAuthority,
      });
      await expect(
        sealed.putIfAbsent(intent('duplicate')),
      ).rejects.toBeInstanceOf(ApplicationStateStoreRetiredError);
    } finally {
      await duplicate.close();
    }

    const laterAuthority = await harness.supersede();
    const laterLedger = createExecutionLedger({
      db: harness.controlDb,
      tableName: CONTROL_TABLE,
      payloadStore: createLocalExecutionPayloadStore({
        path: join(harness.root, 'later-ledger-payloads'),
        storeId: 'later-ledger-payloads',
      }),
    }).bindCoordinatorAuthority(laterAuthority);
    await expect(
      prepareApplicationStateReadiness({
        ledger: laterLedger,
        appId: APP_ID,
        controlContext: harness.controlContext,
        configuration: harness.replacementConfiguration,
      }),
    ).resolves.toMatchObject({ status: 'ADOPTED' });
    const first = await openApplicationStateDB({
      configuration: harness.replacementConfiguration,
    });
    try {
      const stale = createApplicationStateTable({
        db: first.db,
        tableName: first.context.tableName,
        coordinatorAuthority: replacementAuthority,
      });
      await expect(stale.putIfAbsent(intent('superseded'))).rejects.toThrow(
        /not adopted/u,
      );
    } finally {
      await first.close();
    }
    await expect(
      transportApplicationStateSnapshot({
        ...duplicateInput,
        closedBarrier: harness.currentBarrier,
        coordinatorAuthority: laterAuthority,
      }),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotActivationConflictError);
  });

  test('rejects existing identity and marker substitutions without replica fallback', async () => {
    const wrongIdentity = await createHarness();
    const wrongTransport = await wrongIdentity.publish();
    const wrongTarget = await openApplicationStateDB({
      configuration: wrongIdentity.replacementConfiguration,
    });
    try {
      await createApplicationStateTable({
        db: wrongTarget.db,
        tableName: wrongTarget.context.tableName,
      }).ensureStoreIdentity();
    } finally {
      await wrongTarget.close();
    }
    const wrongAuthority = await wrongIdentity.takeover();
    wrongIdentity.providerRead.mockClear();
    await expect(
      transportApplicationStateSnapshot({
        configuration: wrongIdentity.replacementConfiguration,
        controlContext: wrongIdentity.controlContext,
        transport: wrongTransport,
        history: wrongTransport.snapshot.checkpoint.history,
        closedBarrier: wrongIdentity.currentBarrier,
        coordinatorAuthority: wrongAuthority,
        distribution: wrongIdentity.distribution,
      }),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
    expect(wrongIdentity.providerRead).not.toHaveBeenCalled();

    const missingMarker = await createHarness();
    const sameIdentityTarget = await openApplicationStateDB({
      configuration: missingMarker.replacementConfiguration,
    });
    try {
      const table = createApplicationStateTable({
        db: sameIdentityTarget.db,
        tableName: sameIdentityTarget.context.tableName,
        coordinatorAuthority: missingMarker.sourceAuthority,
        createStoreId: () => missingMarker.destination.configuration.storeId,
      });
      await table.ensureStoreIdentity();
      await table.adoptCoordinatorAuthority({
        storeId: missingMarker.destination.configuration.storeId,
        namespace: APP_ID,
      });
    } finally {
      await sameIdentityTarget.close();
    }
    const missingMarkerTransport = await missingMarker.publish();
    const missingMarkerAuthority = await missingMarker.takeover();
    missingMarker.providerRead.mockClear();
    await expect(
      transportApplicationStateSnapshot({
        configuration: missingMarker.replacementConfiguration,
        controlContext: missingMarker.controlContext,
        transport: missingMarkerTransport,
        history: missingMarkerTransport.snapshot.checkpoint.history,
        closedBarrier: missingMarker.currentBarrier,
        coordinatorAuthority: missingMarkerAuthority,
        distribution: missingMarker.distribution,
      }),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotTargetCorruptionError);
    expect(missingMarker.providerRead).not.toHaveBeenCalled();
  });

  test('fails closed for missing, corrupt, or history-substituted recovery', async () => {
    const missingHarness = await createHarness();
    const missingTransport = await missingHarness.publish();
    const missingAuthority = await missingHarness.takeover();
    missingHarness.artifacts.clear();
    const missingInput = {
      configuration: missingHarness.replacementConfiguration,
      controlContext: missingHarness.controlContext,
      transport: missingTransport,
      history: missingTransport.snapshot.checkpoint.history,
      closedBarrier: missingHarness.currentBarrier,
      coordinatorAuthority: missingAuthority,
      distribution: missingHarness.distribution,
    };
    await expect(
      transportApplicationStateSnapshot(missingInput),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotNotFoundError);
    await expect(
      fsp.lstat(join(missingHarness.replacementPath, 'lmdb')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      createApplicationStateSnapshotControlStore({
        db: missingHarness.controlDb,
        tableName: CONTROL_TABLE,
      }).getActivationClaim({ transferId: missingHarness.transferId }),
    ).resolves.toBeNull();

    const corruptHarness = await createHarness();
    const corruptTransport = await corruptHarness.publish();
    const corruptAuthority = await corruptHarness.takeover();
    corruptHarness.artifacts.set(
      corruptTransport.snapshot.snapshotId,
      Buffer.alloc(corruptTransport.snapshot.size, 0x61),
    );
    const corruptInput = {
      configuration: corruptHarness.replacementConfiguration,
      controlContext: corruptHarness.controlContext,
      transport: corruptTransport,
      history: corruptTransport.snapshot.checkpoint.history,
      closedBarrier: corruptHarness.currentBarrier,
      coordinatorAuthority: corruptAuthority,
      distribution: corruptHarness.distribution,
    };
    await expect(
      transportApplicationStateSnapshot(corruptInput),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotIntegrityError);
    await expect(
      createApplicationStateSnapshotControlStore({
        db: corruptHarness.controlDb,
        tableName: CONTROL_TABLE,
      }).getActivationClaim({ transferId: corruptHarness.transferId }),
    ).resolves.toBeNull();

    const substitutedHistory = {
      ...corruptTransport.snapshot.checkpoint.history,
      historyDigest: id('wash1', 'substituted-history'),
    };
    await expect(
      transportApplicationStateSnapshot({
        ...corruptInput,
        history: substitutedHistory,
      }),
    ).rejects.toThrow(/does not match the receipt-pinned checkpoint/u);
  });
});
