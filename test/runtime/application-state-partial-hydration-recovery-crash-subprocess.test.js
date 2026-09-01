/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import createLMDB from '../../src/core/lib/db/adapters/lmdb.js';
import { APPLICATION_STATE_TABLE_NAME } from '../../src/core/lib/config/db.js';
import { createApplicationStateCoordinatorAuthorityRecord } from '../../src/core/lib/db/tables/application-state-authority.js';
import {
  createApplicationStateBusinessKey,
  createApplicationStateTable,
} from '../../src/core/lib/db/tables/application-state.js';
import {
  CoordinatorAuthorityStaleError,
  createCoordinatorAuthority,
  createCoordinatorAuthorityToken,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import {
  CoordinatorQuiescenceBarrierState,
  createCoordinatorQuiescenceBarrier,
} from '../../src/core/lib/db/tables/coordinator-quiescence-barrier.js';
import {
  ApplicationStateSnapshotActivationConflictError,
  createApplicationStateSnapshotControlStore,
} from '../../src/core/runtime/application-state-snapshot-control.js';
import {
  ApplicationStateSnapshotTargetCorruptionError,
  inspectApplicationStateSnapshotHydrationRecovery,
  publishApplicationStateSnapshot,
  recoverApplicationStateSnapshotHydration,
  transportApplicationStateSnapshot,
} from '../../src/core/runtime/application-state-snapshot-lmdb.js';
import { openApplicationStateDB } from '../../src/core/runtime/application-state-store.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../../src/core/runtime/content-id.js';
import { createFilesystemApplicationStateSnapshotDistribution } from '../helpers/application-state-snapshot-filesystem-distribution.js';
import {
  cleanupCrashChild,
  killCrashChild,
  spawnCrashChild,
  waitForCrashChildMessage,
} from '../helpers/real-sigkill-subprocess.js';

/** @typedef {import('../fixtures/application-state-partial-hydration-recovery-crash-child.js').CrashBoundary} CrashBoundary */
/** @typedef {ReturnType<typeof spawnCrashChild>} CrashChild */

const TRANSPORT_CHILD_PATH = fileURLToPath(
  new URL(
    '../fixtures/application-state-snapshot-transport-crash-child.js',
    import.meta.url,
  ),
);
const RECOVERY_CHILD_PATH = fileURLToPath(
  new URL(
    '../fixtures/application-state-partial-hydration-recovery-crash-child.js',
    import.meta.url,
  ),
);
const APP_ID = 'application-state-partial-hydration-recovery-crash';
const CONTROL_TABLE =
  'application-state-partial-hydration-recovery-crash-control';
const HYDRATION_CLAIM_FILE =
  '.wharfie-application-state-snapshot-hydration-claim';
const HYDRATION_RECOVERY_FILE_PREFIX =
  '.wharfie-application-state-snapshot-hydration-recovery';
const HYDRATION_RECOVERY_RECEIPT_FILE_PREFIX = `${HYDRATION_RECOVERY_FILE_PREFIX}-receipt`;
const HYDRATION_RECOVERY_RETIRED_TARGET_PREFIX = `${HYDRATION_RECOVERY_FILE_PREFIX}-retired-target`;
const HYDRATION_RECOVERY_RETIRED_CLAIM_PREFIX = `${HYDRATION_RECOVERY_FILE_PREFIX}-retired-claim`;
const REPLICA_ID_FILE = '.wharfie-application-state-replica-id';
const HYDRATION_STAGE_PREFIX = '.wharfie-application-state-hydration-';
const testOnUnix = process.platform === 'win32' ? test.skip : test;
const RECOVERY_CASES = /** @type {const} */ ([
  {
    boundary: 'hydration-recovery-recorded',
    state: 'RECOVERY_RECORDED',
    target: true,
    claim: true,
    retiredTarget: false,
    retiredClaim: false,
  },
  {
    boundary: 'hydration-recovery-target-removed',
    state: 'TARGET_REMOVED',
    target: false,
    claim: true,
    retiredTarget: true,
    retiredClaim: false,
  },
  {
    boundary: 'hydration-recovery-claim-released',
    state: 'RECOVERED',
    target: false,
    claim: false,
    retiredTarget: true,
    retiredClaim: true,
  },
]);
const STALE_CASES = /** @type {const} */ ([
  {
    label: 'recovery record persistence',
    priorBoundary: null,
  },
  {
    label: 'partial target removal',
    priorBoundary: 'hydration-recovery-recorded',
  },
  {
    label: 'hydration claim release',
    priorBoundary: 'hydration-recovery-target-removed',
  },
]);

/** @param {string} prefix @param {string} label */
function id(prefix, label) {
  return createCanonicalJsonSha256Id({
    domain: `wharfie:test:partial-hydration-recovery-crash:${prefix}`,
    prefix,
    value: { label },
  });
}

/** @param {Readonly<Record<string, any>>} recovery */
function recoveryArtifactPaths(recovery) {
  const snapshotId = recovery.transport.snapshot.snapshotId;
  const recoveryId = recovery.recoveryId;
  return Object.freeze({
    receipt: `${HYDRATION_RECOVERY_RECEIPT_FILE_PREFIX}-${snapshotId}-${recoveryId}`,
    retiredTarget: `${HYDRATION_RECOVERY_RETIRED_TARGET_PREFIX}-${snapshotId}-${recoveryId}`,
    retiredClaim: `${HYDRATION_RECOVERY_RETIRED_CLAIM_PREFIX}-${snapshotId}-${recoveryId}`,
  });
}

function emptyLedger() {
  return Object.freeze({
    listRuns: async () => ({ items: [] }),
    rebuildRun: async () => {
      throw new Error('Empty recovery crash history cannot rebuild a run.');
    },
  });
}

/** @param {string} storeId */
function seedIntent(storeId) {
  return Object.freeze({
    storeId,
    namespace: APP_ID,
    key: 'retained-before-recovery',
    value: { retained: 'across-recovery-sigkill' },
    destinationEffectId: 'partial-hydration-recovery-retained-effect',
    contractDigest: id('wac', 'retained-contract'),
  });
}

/** @param {string} root */
async function createFixture(root) {
  const controlPath = join(root, 'control');
  const sourcePath = join(root, 'source');
  const replacementPath = join(root, 'replacement');
  const alternatePath = join(root, 'alternate-replacement');
  const distributionRoot = join(root, 'distribution');
  const controlDb = createLMDB({ path: controlPath });
  try {
    const authorities = createCoordinatorAuthority({
      db: controlDb,
      tableName: CONTROL_TABLE,
    });
    const sourceAcquisition = await authorities.acquire({
      appId: APP_ID,
      coordinatorId: 'recovery-source',
      requestId: 'recovery-source-acquire',
      observedAt: 1,
    });
    const sourceAuthority = createCoordinatorAuthorityToken(
      sourceAcquisition.authority,
    );
    const admission = createCoordinatorQuiescenceBarrier({
      db: controlDb,
      tableName: CONTROL_TABLE,
      now: () => 1,
    });
    const sourceBarrier = (
      await admission.close({
        authority: sourceAuthority,
        requestId: 'recovery-source-close',
        predecessor: null,
        observedAt: 1,
      })
    ).barrier;
    const storeId = id('was', 'recovery-store');
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
        createStoreId: () => storeId,
      });
      await table.ensureStoreIdentity();
      await table.putIfAbsent(seedIntent(storeId));
    } finally {
      await source.close();
    }
    const distributionIdentity = Object.freeze({
      kind: 'wharfie.application-state-snapshot-distribution.v1',
      distributionId: id('wasd1', 'recovery-distribution'),
      storeId,
    });
    const distribution = createFilesystemApplicationStateSnapshotDistribution({
      identity: distributionIdentity,
      root: distributionRoot,
    });
    const controlContext = {
      db: controlDb,
      tableName: CONTROL_TABLE,
      adapterName: /** @type {const} */ ('lmdb'),
      controlPath,
    };
    const transport = await publishApplicationStateSnapshot({
      ledger: emptyLedger(),
      appId: APP_ID,
      configuration: sourceConfiguration,
      controlContext,
      destination,
      closedBarrier: sourceBarrier,
      coordinatorAuthority: sourceAuthority,
      transferId: id('wast1', 'recovery-transfer'),
      distribution,
    });
    const observed = await authorities.get({ appId: APP_ID });
    const replacementAcquisition = await authorities.takeover({
      appId: APP_ID,
      coordinatorId: 'recovery-replacement',
      requestId: 'recovery-replacement-takeover',
      observedAuthority: observed,
      confirmAuthorityReplacement: true,
      observedAt: 2,
    });
    const replacementAuthority = createCoordinatorAuthorityToken(
      replacementAcquisition.authority,
    );
    const replacementBarrier = (
      await admission.adopt({
        authority: replacementAuthority,
        requestId: 'recovery-replacement-adopt',
        predecessor: sourceBarrier,
        observedAt: 2,
      })
    ).barrier;
    return Object.freeze({
      root,
      controlPath,
      controlTableName: CONTROL_TABLE,
      sourceConfiguration,
      replacementConfiguration,
      alternateConfiguration: Object.freeze({
        ...sourceConfiguration,
        storePath: alternatePath,
      }),
      destination,
      distributionIdentity,
      distributionRoot,
      transport,
      sourceAuthority,
      replacementAuthority,
      replacementBarrier,
      storeId,
    });
  } finally {
    await controlDb.close();
  }
}

/** @typedef {Awaited<ReturnType<typeof createFixture>>} Fixture */

/** @param {Fixture} fixture @param {boolean} [readOnly] */
function openControl(fixture, readOnly = true) {
  const db = createLMDB({ path: fixture.controlPath, readOnly });
  return {
    db,
    context: {
      db,
      tableName: fixture.controlTableName,
      adapterName: /** @type {const} */ ('lmdb'),
      controlPath: fixture.controlPath,
    },
    authorities: createCoordinatorAuthority({
      db,
      tableName: fixture.controlTableName,
    }),
    admission: createCoordinatorQuiescenceBarrier({
      db,
      tableName: fixture.controlTableName,
    }),
    snapshots: createApplicationStateSnapshotControlStore({
      db,
      tableName: fixture.controlTableName,
    }),
  };
}

/** @param {Fixture} fixture */
function distribution(fixture) {
  return createFilesystemApplicationStateSnapshotDistribution({
    identity: fixture.distributionIdentity,
    root: fixture.distributionRoot,
  });
}

/** @param {Fixture} fixture */
async function readControlState(fixture) {
  const control = openControl(fixture);
  try {
    return Object.freeze({
      authority: await control.authorities.get({ appId: APP_ID }),
      barrier: await control.admission.get({ appId: APP_ID }),
      publication: await control.snapshots.getPublication({
        transferId: fixture.transport.snapshot.transferId,
      }),
      activation: await control.snapshots.getActivationClaim({
        transferId: fixture.transport.snapshot.transferId,
      }),
    });
  } finally {
    await control.db.close();
  }
}

/** @param {Fixture} fixture */
async function inspectRecovery(fixture) {
  const control = openControl(fixture);
  try {
    return await inspectApplicationStateSnapshotHydrationRecovery({
      configuration: fixture.replacementConfiguration,
      controlContext: control.context,
      transport: fixture.transport,
      closedBarrier: fixture.replacementBarrier,
      coordinatorAuthority: fixture.replacementAuthority,
    });
  } finally {
    await control.db.close();
  }
}

/** @param {Fixture} fixture @param {Record<string, any>} inspection */
async function runRecovery(fixture, inspection) {
  const control = openControl(fixture, false);
  try {
    return await recoverApplicationStateSnapshotHydration({
      configuration: fixture.replacementConfiguration,
      controlContext: control.context,
      transport: fixture.transport,
      closedBarrier: fixture.replacementBarrier,
      coordinatorAuthority: fixture.replacementAuthority,
      inspection,
      confirmPartialHydrationRecovery: true,
    });
  } finally {
    await control.db.close();
  }
}

/** @param {Fixture} fixture @param {Record<string, any>} configuration */
async function runTransport(fixture, configuration) {
  const control = openControl(fixture, false);
  try {
    return await transportApplicationStateSnapshot({
      configuration,
      controlContext: control.context,
      transport: fixture.transport,
      history: fixture.transport.snapshot.checkpoint.history,
      closedBarrier: fixture.replacementBarrier,
      coordinatorAuthority: fixture.replacementAuthority,
      distribution: distribution(fixture),
    });
  } finally {
    await control.db.close();
  }
}

/** @param {Fixture} fixture @param {Fixture['sourceConfiguration']} configuration */
async function readDestinationState(fixture, configuration) {
  const applicationState = await openApplicationStateDB({
    configuration,
    readOnly: true,
  });
  try {
    const table = createApplicationStateTable({
      db: applicationState.db,
      tableName: applicationState.context.tableName,
    });
    const businessKey = createApplicationStateBusinessKey(
      APP_ID,
      'retained-before-recovery',
    );
    return Object.freeze({
      authority: await table.readCoordinatorAuthority({
        storeId: fixture.storeId,
        namespace: APP_ID,
      }),
      retirement: await table.readStoreRetirement({
        storeId: fixture.storeId,
        namespace: APP_ID,
      }),
      activation: await table.readStoreActivation({
        storeId: fixture.storeId,
        namespace: APP_ID,
      }),
      business: await table.readBusinessByPhysicalKey(
        businessKey.resourceId,
        businessKey.sortKey,
      ),
    });
  } finally {
    await applicationState.close();
  }
}

/** @param {unknown} error @param {string} code */
function hasErrorCode(error, code) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code
  );
}

/** @param {string} root */
async function readTreeState(root) {
  /** @type {Record<string, any>[]} */
  const entries = [];
  /** @param {string} path @param {string} relative */
  const visit = async (path, relative) => {
    let stats;
    try {
      stats = await fsp.lstat(path);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT') && relative === '.') return;
      throw error;
    }
    const base = Object.freeze({
      path: relative,
      device: stats.dev,
      inode: stats.ino,
      mode: stats.mode,
    });
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      const names = (await fsp.readdir(path)).sort();
      entries.push(Object.freeze({ ...base, type: 'directory', names }));
      for (const name of names) {
        await visit(
          join(path, name),
          relative === '.' ? name : join(relative, name),
        );
      }
      return;
    }
    if (stats.isFile() && !stats.isSymbolicLink()) {
      const handle = await fsp.open(
        path,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
      try {
        const opened = await handle.stat();
        const bytes = await handle.readFile();
        if (opened.dev !== stats.dev || opened.ino !== stats.ino) {
          throw new Error(`Recovery crash path changed while read: ${path}`);
        }
        entries.push(
          Object.freeze({
            ...base,
            type: 'file',
            size: opened.size,
            bytes: bytes.toString('base64'),
          }),
        );
      } finally {
        await handle.close();
      }
      return;
    }
    entries.push(
      Object.freeze({
        ...base,
        type: stats.isSymbolicLink() ? 'symlink' : 'other',
      }),
    );
  };
  await visit(root, '.');
  return Object.freeze(entries);
}

/** @param {Readonly<Record<string, any>[]>} tree @param {string} path */
function treeEntry(tree, path) {
  return tree.find((entry) => entry.path === path) || null;
}

/** @param {Readonly<Record<string, any>[]>} tree */
function partialState(tree) {
  const root = treeEntry(tree, '.');
  const claim = treeEntry(tree, HYDRATION_CLAIM_FILE);
  const replica = treeEntry(tree, REPLICA_ID_FILE);
  const target = treeEntry(tree, 'lmdb');
  const stages = tree.filter(
    (entry) =>
      entry.type === 'directory' &&
      entry.path.startsWith(HYDRATION_STAGE_PREFIX),
  );
  return Object.freeze({ root, claim, replica, target, stages });
}

/** @param {Readonly<Record<string, any>[]>} before @param {Readonly<Record<string, any>[]>} after */
function addedRecoveryEntries(before, after) {
  const beforePaths = new Set(before.map((entry) => entry.path));
  return after.filter((entry) => !beforePaths.has(entry.path));
}

/** @param {string} path @param {Buffer} bytes */
async function writeAndSync(path, bytes) {
  const file = await fsp.open(path, 'wx', 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
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

/** @param {Fixture} fixture @param {'hydration-target-created' | 'hydration-evidence-linked'} boundary @param {CrashChild[]} children */
async function prepareTransportCrash(fixture, boundary, children) {
  const child = spawnCrashChild({
    childPath: TRANSPORT_CHILD_PATH,
    cwd: fixture.root,
    options: {
      boundary,
      configuration: fixture.replacementConfiguration,
      control: {
        path: fixture.controlPath,
        tableName: fixture.controlTableName,
      },
      transport: fixture.transport,
      history: fixture.transport.snapshot.checkpoint.history,
      closedBarrier: fixture.replacementBarrier,
      coordinatorAuthority: fixture.replacementAuthority,
      distribution: {
        identity: fixture.distributionIdentity,
        root: fixture.distributionRoot,
      },
    },
  });
  children.push(child);
  const message = await waitForCrashChildMessage(
    child,
    (candidate) => candidate.kind === 'boundary',
    `snapshot transport boundary ${boundary}`,
  );
  expect(message).toEqual({ kind: 'boundary', boundary });
  expect(await killCrashChild(child)).toEqual({
    code: null,
    signal: 'SIGKILL',
  });
  expect(child.stdout).toBe('');
  expect(child.stderr).toBe('');
}

/** @param {Fixture} fixture @param {CrashBoundary} boundary @param {Record<string, any>} inspection @param {CrashChild[]} children */
async function prepareRecoveryCrash(fixture, boundary, inspection, children) {
  const child = spawnCrashChild({
    childPath: RECOVERY_CHILD_PATH,
    cwd: fixture.root,
    options: {
      boundary,
      configuration: fixture.replacementConfiguration,
      control: {
        path: fixture.controlPath,
        tableName: fixture.controlTableName,
      },
      transport: fixture.transport,
      closedBarrier: fixture.replacementBarrier,
      coordinatorAuthority: fixture.replacementAuthority,
      inspection,
    },
  });
  children.push(child);
  const message = await waitForCrashChildMessage(
    child,
    (candidate) => candidate.kind === 'boundary',
    `hydration recovery boundary ${boundary}`,
  );
  expect(message).toEqual({ kind: 'boundary', boundary });
  expect(await killCrashChild(child)).toEqual({
    code: null,
    signal: 'SIGKILL',
  });
  expect(child.stdout).toBe('');
  expect(child.stderr).toBe('');
}

/** @param {Fixture} fixture @param {string} label */
async function rotateAuthority(fixture, label) {
  const control = openControl(fixture, false);
  try {
    const observed = await control.authorities.get({ appId: APP_ID });
    const transition = await control.authorities.takeover({
      appId: APP_ID,
      coordinatorId: `stale-successor-${label}`,
      requestId: `stale-successor-takeover-${label}`,
      observedAuthority: observed,
      confirmAuthorityReplacement: true,
      observedAt: 3,
    });
    const authority = createCoordinatorAuthorityToken(transition.authority);
    const barrier = (
      await control.admission.adopt({
        authority,
        requestId: `stale-successor-adopt-${label}`,
        predecessor: fixture.replacementBarrier,
        observedAt: 3,
      })
    ).barrier;
    return Object.freeze({ authority, barrier });
  } finally {
    await control.db.close();
  }
}

/** @param {Fixture} fixture @param {CrashChild[]} children */
async function cleanupFixture(fixture, children) {
  /** @type {unknown[]} */
  const failures = [];
  for (const child of children) {
    try {
      await cleanupCrashChild(child);
    } catch (error) {
      failures.push(error);
    }
  }
  if (children.every((child) => child.exit)) {
    try {
      await fsp.rm(fixture.root, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
  } else {
    failures.push(
      new Error(`Unreaped recovery crash child; retaining ${fixture.root}`),
    );
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      'Partial hydration recovery crash cleanup failed.',
    );
  }
}

/** @param {Fixture} fixture */
async function expectClosedUnactivatedControl(fixture) {
  const state = await readControlState(fixture);
  expect(createCoordinatorAuthorityToken(state.authority)).toEqual(
    fixture.replacementAuthority,
  );
  expect(state.barrier).toEqual(fixture.replacementBarrier);
  expect(state.barrier?.state).toBe(CoordinatorQuiescenceBarrierState.CLOSED);
  expect(state.publication?.transport).toEqual(fixture.transport);
  expect(state.activation).toBeNull();
  return state;
}

describe('real SIGKILL partial application-state hydration recovery', () => {
  testOnUnix.each(RECOVERY_CASES)(
    'replays exact recovery after $boundary process loss',
    async ({ boundary, state, target, claim, retiredTarget, retiredClaim }) => {
      const root = await fsp.mkdtemp(
        join(tmpdir(), 'wharfie-partial-hydration-recovery-crash-'),
      );
      const fixture = await createFixture(root);
      /** @type {CrashChild[]} */
      const children = [];
      try {
        await prepareTransportCrash(
          fixture,
          'hydration-target-created',
          children,
        );
        const initialTree = await readTreeState(
          fixture.replacementConfiguration.storePath,
        );
        const initial = partialState(initialTree);
        expect(initial.root?.type).toBe('directory');
        expect(initial.target).toMatchObject({
          type: 'directory',
          names: [],
        });
        expect(initial.claim?.type).toBe('file');
        expect(initial.replica?.type).toBe('file');
        expect(initial.stages).toHaveLength(1);
        if (!initial.replica) {
          throw new Error('Partial hydration lost its physical replica ID.');
        }
        const replicaId = Buffer.from(initial.replica.bytes, 'base64')
          .toString('utf8')
          .trim();
        assertDomainSeparatedSha256Id(
          replicaId,
          'wasr1',
          'recovery crash physical replica id',
        );
        const beforeControl = await expectClosedUnactivatedControl(fixture);
        const sealedSource = await readDestinationState(
          fixture,
          fixture.sourceConfiguration,
        );
        expect(sealedSource).toMatchObject({
          authority: createApplicationStateCoordinatorAuthorityRecord({
            storeId: fixture.storeId,
            namespace: APP_ID,
            authority: fixture.sourceAuthority,
          }),
          retirement: {
            retirement_id: fixture.transport.snapshot.transferId,
          },
          activation: null,
          business: { value: { retained: 'across-recovery-sigkill' } },
        });
        const inspection = await inspectRecovery(fixture);
        expect(Object.keys(inspection).sort()).toEqual(
          ['schemaVersion', 'kind', 'inspectionId', 'state', 'recovery'].sort(),
        );
        expect(inspection).toMatchObject({
          schemaVersion: 1,
          kind: 'wharfie.application-state-snapshot-hydration-recovery-inspection.v1',
          state: 'PARTIAL_TARGET',
          recovery: {
            schemaVersion: 1,
            kind: 'wharfie.application-state-snapshot-hydration-recovery.v1',
            transport: fixture.transport,
            replicaId,
            replacementBarrier: fixture.replacementBarrier,
            replacementAuthority: fixture.replacementAuthority,
            filesystem: {
              storeRoot: {
                device: expect.any(String),
                inode: expect.any(String),
              },
              claimFile: {
                device: expect.any(String),
                inode: expect.any(String),
                size: expect.any(String),
              },
              targetDirectory: {
                device: expect.any(String),
                inode: expect.any(String),
              },
            },
          },
        });
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
        assertDomainSeparatedSha256Id(
          inspection.inspectionId,
          'washri1',
          'recovery crash inspection id',
        );
        assertDomainSeparatedSha256Id(
          inspection.recovery.recoveryId,
          'washr1',
          'recovery crash receipt id',
        );
        const artifacts = recoveryArtifactPaths(inspection.recovery);

        await prepareRecoveryCrash(fixture, boundary, inspection, children);

        const killedTree = await readTreeState(
          fixture.replacementConfiguration.storePath,
        );
        const killed = partialState(killedTree);
        expect(killed.target !== null).toBe(target);
        expect(killed.claim !== null).toBe(claim);
        expect(killed.replica).toEqual(initial.replica);
        expect(killed.stages).toEqual(initial.stages);
        const recoveryEntries = addedRecoveryEntries(initialTree, killedTree);
        expect(recoveryEntries).toHaveLength(
          1 + Number(retiredTarget) + Number(retiredClaim),
        );
        const receiptEntry = treeEntry(killedTree, artifacts.receipt);
        expect(receiptEntry).toMatchObject({ type: 'file' });
        if (!receiptEntry || receiptEntry.type !== 'file') {
          throw new Error('Recovery crash did not retain its receipt file.');
        }
        const retainedReceipt = JSON.parse(
          Buffer.from(receiptEntry.bytes, 'base64').toString('utf8'),
        );
        expect(retainedReceipt).toEqual(inspection.recovery);
        const killedRetiredTarget = treeEntry(
          killedTree,
          artifacts.retiredTarget,
        );
        const killedRetiredClaim = treeEntry(
          killedTree,
          artifacts.retiredClaim,
        );
        expect(killedRetiredTarget !== null).toBe(retiredTarget);
        expect(killedRetiredClaim !== null).toBe(retiredClaim);
        if (retiredTarget) {
          expect(killedRetiredTarget).toMatchObject({
            type: 'directory',
            names: [],
            device: initial.target?.device,
            inode: initial.target?.inode,
          });
        }
        if (retiredClaim) {
          expect(killedRetiredClaim).toMatchObject({
            type: 'file',
            device: initial.claim?.device,
            inode: initial.claim?.inode,
            bytes: initial.claim?.bytes,
          });
        }
        const killedControl = await expectClosedUnactivatedControl(fixture);
        expect(killedControl).toEqual(beforeControl);
        await expect(inspectRecovery(fixture)).resolves.toEqual({
          ...inspection,
          state,
          inspectionId: expect.any(String),
        });
        await expect(
          readDestinationState(fixture, fixture.sourceConfiguration),
        ).resolves.toEqual(sealedSource);

        const receipt = await runRecovery(fixture, inspection);
        expect(receipt).toEqual(retainedReceipt);
        await expect(runRecovery(fixture, inspection)).resolves.toEqual(
          receipt,
        );
        const recoveredTree = await readTreeState(
          fixture.replacementConfiguration.storePath,
        );
        const recovered = partialState(recoveredTree);
        expect(recovered.target).toBeNull();
        expect(recovered.claim).toBeNull();
        expect(recovered.replica).toEqual(initial.replica);
        expect(treeEntry(recoveredTree, artifacts.receipt)).toEqual(
          receiptEntry,
        );
        expect(treeEntry(recoveredTree, artifacts.retiredTarget)).toMatchObject(
          {
            type: 'directory',
            names: [],
            device: initial.target?.device,
            inode: initial.target?.inode,
          },
        );
        expect(treeEntry(recoveredTree, artifacts.retiredClaim)).toMatchObject({
          type: 'file',
          device: initial.claim?.device,
          inode: initial.claim?.inode,
          bytes: initial.claim?.bytes,
        });
        const recoveredControl = await expectClosedUnactivatedControl(fixture);
        expect(recoveredControl).toEqual(beforeControl);
        await expect(
          readDestinationState(fixture, fixture.sourceConfiguration),
        ).resolves.toEqual(sealedSource);

        await prepareTransportCrash(
          fixture,
          'hydration-target-created',
          children,
        );
        const secondCrashTree = await readTreeState(
          fixture.replacementConfiguration.storePath,
        );
        const secondPartial = partialState(secondCrashTree);
        expect(secondPartial.target).toMatchObject({
          type: 'directory',
          names: [],
        });
        expect(secondPartial.claim?.type).toBe('file');
        expect(secondPartial.replica).toEqual(initial.replica);
        expect(secondPartial.stages).toHaveLength(initial.stages.length + 1);
        expect(treeEntry(secondCrashTree, artifacts.receipt)).toEqual(
          receiptEntry,
        );
        expect(treeEntry(secondCrashTree, artifacts.retiredTarget)).toEqual(
          treeEntry(recoveredTree, artifacts.retiredTarget),
        );
        expect(treeEntry(secondCrashTree, artifacts.retiredClaim)).toEqual(
          treeEntry(recoveredTree, artifacts.retiredClaim),
        );
        const secondInspection = await inspectRecovery(fixture);
        expect(secondInspection.state).toBe('PARTIAL_TARGET');
        expect(secondInspection.recovery.recoveryId).not.toBe(
          inspection.recovery.recoveryId,
        );
        await expect(runRecovery(fixture, inspection)).resolves.toEqual(
          inspection.recovery,
        );
        await expect(
          readTreeState(fixture.replacementConfiguration.storePath),
        ).resolves.toEqual(secondCrashTree);
        await expect(runRecovery(fixture, secondInspection)).resolves.toEqual(
          secondInspection.recovery,
        );
        const secondArtifacts = recoveryArtifactPaths(
          secondInspection.recovery,
        );
        const twiceRecoveredTree = await readTreeState(
          fixture.replacementConfiguration.storePath,
        );
        expect(treeEntry(twiceRecoveredTree, artifacts.receipt)).toEqual(
          receiptEntry,
        );
        expect(treeEntry(twiceRecoveredTree, artifacts.retiredTarget)).toEqual(
          treeEntry(recoveredTree, artifacts.retiredTarget),
        );
        expect(treeEntry(twiceRecoveredTree, artifacts.retiredClaim)).toEqual(
          treeEntry(recoveredTree, artifacts.retiredClaim),
        );
        expect(
          treeEntry(twiceRecoveredTree, secondArtifacts.receipt),
        ).toMatchObject({ type: 'file' });
        expect(
          treeEntry(twiceRecoveredTree, secondArtifacts.retiredTarget),
        ).toMatchObject({ type: 'directory', names: [] });
        expect(
          treeEntry(twiceRecoveredTree, secondArtifacts.retiredClaim),
        ).toMatchObject({ type: 'file' });

        const readiness = await runTransport(
          fixture,
          fixture.replacementConfiguration,
        );
        expect(readiness).toMatchObject({
          status: 'HYDRATED',
          destination: fixture.destination,
          transport: fixture.transport,
        });
        await expect(
          runTransport(fixture, fixture.replacementConfiguration),
        ).resolves.toEqual(readiness);
        const activatedTree = await readTreeState(
          fixture.replacementConfiguration.storePath,
        );
        expect(treeEntry(activatedTree, REPLICA_ID_FILE)).toEqual(
          initial.replica,
        );
        expect(treeEntry(activatedTree, artifacts.receipt)).toEqual(
          receiptEntry,
        );
        expect(treeEntry(activatedTree, artifacts.retiredTarget)).toEqual(
          treeEntry(recoveredTree, artifacts.retiredTarget),
        );
        expect(treeEntry(activatedTree, artifacts.retiredClaim)).toEqual(
          treeEntry(recoveredTree, artifacts.retiredClaim),
        );
        expect(treeEntry(activatedTree, secondArtifacts.receipt)).toEqual(
          treeEntry(twiceRecoveredTree, secondArtifacts.receipt),
        );
        expect(treeEntry(activatedTree, secondArtifacts.retiredTarget)).toEqual(
          treeEntry(twiceRecoveredTree, secondArtifacts.retiredTarget),
        );
        expect(treeEntry(activatedTree, secondArtifacts.retiredClaim)).toEqual(
          treeEntry(twiceRecoveredTree, secondArtifacts.retiredClaim),
        );
        const activatedControl = await readControlState(fixture);
        expect(activatedControl.barrier).toEqual(fixture.replacementBarrier);
        expect(activatedControl.barrier?.state).toBe(
          CoordinatorQuiescenceBarrierState.CLOSED,
        );
        expect(activatedControl.activation).toMatchObject({ replicaId });
        const destination = await readDestinationState(
          fixture,
          fixture.replacementConfiguration,
        );
        expect(destination).toMatchObject({
          authority: createApplicationStateCoordinatorAuthorityRecord({
            storeId: fixture.storeId,
            namespace: APP_ID,
            authority: fixture.replacementAuthority,
          }),
          retirement: null,
          activation: { replica_id: replicaId },
          business: { value: { retained: 'across-recovery-sigkill' } },
        });

        await expect(
          runTransport(fixture, fixture.alternateConfiguration),
        ).rejects.toBeInstanceOf(
          ApplicationStateSnapshotActivationConflictError,
        );
        const afterConflict = await readControlState(fixture);
        expect(afterConflict).toEqual(activatedControl);
        await expect(
          readDestinationState(fixture, fixture.sourceConfiguration),
        ).resolves.toEqual(sealedSource);
        const alternate = await readDestinationState(
          fixture,
          fixture.alternateConfiguration,
        );
        expect(alternate.activation).toBeNull();
        expect(alternate.retirement).not.toBeNull();
      } finally {
        await cleanupFixture(fixture, children);
      }
    },
    30_000,
  );

  testOnUnix.each(STALE_CASES)(
    'stale authority cannot perform $label',
    async ({ label, priorBoundary }) => {
      const root = await fsp.mkdtemp(
        join(tmpdir(), 'wharfie-partial-hydration-stale-crash-'),
      );
      const fixture = await createFixture(root);
      /** @type {CrashChild[]} */
      const children = [];
      try {
        await prepareTransportCrash(
          fixture,
          'hydration-target-created',
          children,
        );
        const inspection = await inspectRecovery(fixture);
        if (priorBoundary) {
          await prepareRecoveryCrash(
            fixture,
            priorBoundary,
            inspection,
            children,
          );
        }
        const successor = await rotateAuthority(
          fixture,
          label.replaceAll(' ', '-'),
        );
        const beforeTree = await readTreeState(
          fixture.replacementConfiguration.storePath,
        );
        const beforeControl = await readControlState(fixture);
        expect(
          createCoordinatorAuthorityToken(beforeControl.authority),
        ).toEqual(successor.authority);
        expect(beforeControl.barrier).toEqual(successor.barrier);
        expect(beforeControl.barrier?.state).toBe(
          CoordinatorQuiescenceBarrierState.CLOSED,
        );

        await expect(runRecovery(fixture, inspection)).rejects.toBeInstanceOf(
          CoordinatorAuthorityStaleError,
        );
        await expect(
          readTreeState(fixture.replacementConfiguration.storePath),
        ).resolves.toEqual(beforeTree);
        await expect(readControlState(fixture)).resolves.toEqual(beforeControl);
      } finally {
        await cleanupFixture(fixture, children);
      }
    },
    20_000,
  );

  testOnUnix(
    'does not remove an evidence-bearing target',
    async () => {
      const root = await fsp.mkdtemp(
        join(tmpdir(), 'wharfie-hydration-recovery-evidence-crash-'),
      );
      const fixture = await createFixture(root);
      /** @type {CrashChild[]} */
      const children = [];
      try {
        await prepareTransportCrash(
          fixture,
          'hydration-evidence-linked',
          children,
        );
        const beforeTree = await readTreeState(
          fixture.replacementConfiguration.storePath,
        );
        const beforeControl = await expectClosedUnactivatedControl(fixture);
        await expect(inspectRecovery(fixture)).rejects.toBeInstanceOf(
          ApplicationStateSnapshotTargetCorruptionError,
        );
        await expect(
          readTreeState(fixture.replacementConfiguration.storePath),
        ).resolves.toEqual(beforeTree);
        await expect(readControlState(fixture)).resolves.toEqual(beforeControl);
      } finally {
        await cleanupFixture(fixture, children);
      }
    },
    20_000,
  );

  testOnUnix(
    'does not remove a nonempty pre-evidence target',
    async () => {
      const root = await fsp.mkdtemp(
        join(tmpdir(), 'wharfie-hydration-recovery-nonempty-crash-'),
      );
      const fixture = await createFixture(root);
      /** @type {CrashChild[]} */
      const children = [];
      try {
        await prepareTransportCrash(
          fixture,
          'hydration-target-created',
          children,
        );
        const target = join(fixture.replacementConfiguration.storePath, 'lmdb');
        await writeAndSync(join(target, 'foreign.bin'), Buffer.from('foreign'));
        await syncDirectory(target);
        const beforeTree = await readTreeState(
          fixture.replacementConfiguration.storePath,
        );
        const beforeControl = await expectClosedUnactivatedControl(fixture);
        await expect(inspectRecovery(fixture)).rejects.toBeInstanceOf(
          ApplicationStateSnapshotTargetCorruptionError,
        );
        await expect(
          readTreeState(fixture.replacementConfiguration.storePath),
        ).resolves.toEqual(beforeTree);
        await expect(readControlState(fixture)).resolves.toEqual(beforeControl);
      } finally {
        await cleanupFixture(fixture, children);
      }
    },
    20_000,
  );

  testOnUnix(
    'does not remove an empty target substituted after inspection',
    async () => {
      const root = await fsp.mkdtemp(
        join(tmpdir(), 'wharfie-hydration-recovery-foreign-crash-'),
      );
      const fixture = await createFixture(root);
      /** @type {CrashChild[]} */
      const children = [];
      try {
        await prepareTransportCrash(
          fixture,
          'hydration-target-created',
          children,
        );
        const inspection = await inspectRecovery(fixture);
        const storePath = fixture.replacementConfiguration.storePath;
        const target = join(storePath, 'lmdb');
        await fsp.rename(target, join(storePath, 'lmdb-inspected'));
        await fsp.mkdir(target, { mode: 0o700 });
        await syncDirectory(storePath);
        const beforeTree = await readTreeState(storePath);
        const beforeControl = await expectClosedUnactivatedControl(fixture);

        await expect(runRecovery(fixture, inspection)).rejects.toBeInstanceOf(
          ApplicationStateSnapshotTargetCorruptionError,
        );
        await expect(readTreeState(storePath)).resolves.toEqual(beforeTree);
        await expect(readControlState(fixture)).resolves.toEqual(beforeControl);
      } finally {
        await cleanupFixture(fixture, children);
      }
    },
    20_000,
  );
});
