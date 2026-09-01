/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import createLMDB from '../../src/core/lib/db/adapters/lmdb.js';
import { APPLICATION_STATE_TABLE_NAME } from '../../src/core/lib/config/db.js';
import { createApplicationStateCoordinatorAuthorityRecord } from '../../src/core/lib/db/tables/application-state-authority.js';
import {
  ApplicationStateStoreRetiredError,
  createApplicationStateBusinessKey,
  createApplicationStateTable,
} from '../../src/core/lib/db/tables/application-state.js';
import {
  createCoordinatorAuthority,
  createCoordinatorAuthorityToken,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import {
  CoordinatorQuiescenceBarrierState,
  createCoordinatorQuiescenceBarrier,
} from '../../src/core/lib/db/tables/coordinator-quiescence-barrier.js';
import { createApplicationStateSnapshotControlStore } from '../../src/core/runtime/application-state-snapshot-control.js';
import {
  ApplicationStateSnapshotTargetCorruptionError,
  publishApplicationStateSnapshot,
  recoverRetiredApplicationStateSnapshot,
} from '../../src/core/runtime/application-state-snapshot-lmdb.js';
import {
  createApplicationStateSnapshotMarkerKey,
  validateApplicationStateSnapshotMarkerRecord,
} from '../../src/core/runtime/application-state-snapshot.js';
import { openApplicationStateDB } from '../../src/core/runtime/application-state-store.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import { createFilesystemApplicationStateSnapshotDistribution } from '../helpers/application-state-snapshot-filesystem-distribution.js';
import {
  cleanupCrashChild,
  killCrashChild,
  spawnCrashChild,
  waitForCrashChildMessage,
} from '../helpers/real-sigkill-subprocess.js';

/** @typedef {import('../fixtures/application-state-snapshot-publication-crash-child.js').PublicationCrashPhase} PublicationCrashPhase */

const CHILD_PATH = fileURLToPath(
  new URL(
    '../fixtures/application-state-snapshot-publication-crash-child.js',
    import.meta.url,
  ),
);
const APP_ID = 'application-state-snapshot-publication-crash';
const CONTROL_TABLE = 'application-state-snapshot-publication-crash-control';
const BUSINESS_KEY = 'retained-before-publication';
const testOnUnix = process.platform === 'win32' ? test.skip : test;
const CASES = /** @type {const} */ ([
  {
    phase: 'source-adopted',
    marker: false,
    sealed: false,
    artifact: false,
    publication: false,
  },
  {
    phase: 'marker-persisted',
    marker: true,
    sealed: false,
    artifact: false,
    publication: false,
  },
  {
    phase: 'source-sealed',
    marker: true,
    sealed: true,
    artifact: false,
    publication: false,
  },
  {
    phase: 'backup-complete',
    marker: true,
    sealed: true,
    artifact: false,
    publication: false,
  },
  {
    phase: 'snapshot-published',
    marker: true,
    sealed: true,
    artifact: true,
    publication: false,
  },
  {
    phase: 'source-retired',
    marker: true,
    sealed: true,
    artifact: true,
    publication: true,
  },
]);

/** @param {unknown} error @param {string} code */
function hasErrorCode(error, code) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code
  );
}

/** @param {string} prefix @param {string} label */
function id(prefix, label) {
  return createCanonicalJsonSha256Id({
    domain: `wharfie:test:snapshot-publication-crash:${prefix}`,
    prefix,
    value: { label },
  });
}

function emptyLedger() {
  return Object.freeze({
    listRuns: async () => ({ items: [] }),
    rebuildRun: async () => {
      throw new Error('Empty crash-proof history cannot rebuild a run.');
    },
  });
}

/** @param {string} storeId @param {string} label */
function intent(storeId, label) {
  return Object.freeze({
    storeId,
    namespace: APP_ID,
    key: `key-${label}`,
    value: { label, retained: true },
    destinationEffectId: `snapshot-publication-${label}`,
    contractDigest: id('wac', `contract-${label}`),
  });
}

/** @param {string} root */
async function createFixture(root) {
  const controlPath = join(root, 'control');
  const sourcePath = join(root, 'source');
  const distributionRoot = join(root, 'distribution');
  const controlDb = createLMDB({ path: controlPath });
  try {
    const authorities = createCoordinatorAuthority({
      db: controlDb,
      tableName: CONTROL_TABLE,
    });
    const acquired = await authorities.acquire({
      appId: APP_ID,
      coordinatorId: 'publication-source',
      requestId: 'publication-source-acquire',
      observedAt: 1,
    });
    const coordinatorAuthority = createCoordinatorAuthorityToken(
      acquired.authority,
    );
    const admission = createCoordinatorQuiescenceBarrier({
      db: controlDb,
      tableName: CONTROL_TABLE,
      now: () => 1,
    });
    const closedBarrier = (
      await admission.close({
        authority: coordinatorAuthority,
        requestId: 'publication-source-close',
        predecessor: null,
        observedAt: 1,
      })
    ).barrier;
    const storeId = id('was', 'publication-source-store');
    const sourceConfiguration = Object.freeze({
      adapterName: /** @type {const} */ ('lmdb'),
      storePath: sourcePath,
      tableName: APPLICATION_STATE_TABLE_NAME,
    });
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
      await table.putIfAbsent(intent(storeId, BUSINESS_KEY));
    } finally {
      await source.close();
    }
    const transferId = id('wast1', 'publication-transfer');
    const distributionIdentity = Object.freeze({
      kind: 'wharfie.application-state-snapshot-distribution.v1',
      distributionId: id('wasd1', 'publication-distribution'),
      storeId,
    });
    return Object.freeze({
      root,
      controlPath,
      controlTableName: CONTROL_TABLE,
      sourceConfiguration,
      destination,
      closedBarrier,
      coordinatorAuthority,
      transferId,
      distributionIdentity,
      distributionRoot,
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
async function artifactFiles(fixture) {
  try {
    return (await fsp.readdir(fixture.distributionRoot)).sort();
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return [];
    throw error;
  }
}

/** @param {Fixture} fixture */
async function readDurableState(fixture) {
  const control = openControl(fixture);
  const source = await openApplicationStateDB({
    configuration: fixture.sourceConfiguration,
    readOnly: true,
  });
  try {
    const table = createApplicationStateTable({
      db: source.db,
      tableName: source.context.tableName,
    });
    const markerKey = createApplicationStateSnapshotMarkerKey(
      fixture.transferId,
    );
    const marker = await source.db.get({
      tableName: source.context.tableName,
      keyName: 'resource_id',
      keyValue: markerKey.resourceId,
      sortKeyName: 'sort_key',
      sortKeyValue: markerKey.sortKey,
      consistentRead: true,
    });
    const businessKey = createApplicationStateBusinessKey(
      APP_ID,
      `key-${BUSINESS_KEY}`,
    );
    return {
      authority: await control.authorities.get({ appId: APP_ID }),
      barrier: await control.admission.get({ appId: APP_ID }),
      publication: await control.snapshots.getPublication({
        transferId: fixture.transferId,
      }),
      marker:
        marker === null || marker === undefined
          ? null
          : validateApplicationStateSnapshotMarkerRecord(marker),
      destinationAuthority: await table.readCoordinatorAuthority({
        storeId: fixture.storeId,
        namespace: APP_ID,
      }),
      retirement: await table.readStoreRetirement({
        storeId: fixture.storeId,
        namespace: APP_ID,
      }),
      business: await table.readBusinessByPhysicalKey(
        businessKey.resourceId,
        businessKey.sortKey,
      ),
      artifacts: await artifactFiles(fixture),
    };
  } finally {
    await Promise.allSettled([source.close(), control.db.close()]).then(
      (results) => {
        const failures = results
          .filter((result) => result.status === 'rejected')
          .map((result) => result.reason);
        if (failures.length > 0) {
          throw new AggregateError(
            failures,
            'Durable state read cleanup failed.',
          );
        }
      },
    );
  }
}

/** @param {Fixture} fixture @param {boolean} shouldExist */
async function recoverBeforeRetry(fixture, shouldExist) {
  const control = openControl(fixture);
  try {
    const result = recoverRetiredApplicationStateSnapshot({
      controlContext: control.context,
      destination: fixture.destination,
      transferId: fixture.transferId,
      distribution: distribution(fixture),
    });
    if (shouldExist) {
      await expect(result).resolves.toEqual(
        expect.objectContaining({
          snapshot: expect.objectContaining({ transferId: fixture.transferId }),
        }),
      );
    } else {
      await expect(result).rejects.toBeInstanceOf(
        ApplicationStateSnapshotTargetCorruptionError,
      );
    }
  } finally {
    await control.db.close();
  }
}

/** @param {Fixture} fixture */
async function retryPublication(fixture) {
  const control = openControl(fixture, false);
  try {
    const snapshotDistribution = distribution(fixture);
    const input = {
      ledger: emptyLedger(),
      appId: APP_ID,
      configuration: fixture.sourceConfiguration,
      controlContext: control.context,
      destination: fixture.destination,
      closedBarrier: fixture.closedBarrier,
      coordinatorAuthority: fixture.coordinatorAuthority,
      transferId: fixture.transferId,
      distribution: snapshotDistribution,
    };
    const transport = await publishApplicationStateSnapshot(input);
    await expect(publishApplicationStateSnapshot(input)).resolves.toEqual(
      transport,
    );
    await expect(
      recoverRetiredApplicationStateSnapshot({
        controlContext: control.context,
        destination: fixture.destination,
        transferId: fixture.transferId,
        distribution: snapshotDistribution,
      }),
    ).resolves.toEqual(transport);
    return transport;
  } finally {
    await control.db.close();
  }
}

/** @param {Fixture} fixture @param {string} label */
async function expectSourceRemainsSealed(fixture, label) {
  const source = await openApplicationStateDB({
    configuration: fixture.sourceConfiguration,
  });
  try {
    const table = createApplicationStateTable({
      db: source.db,
      tableName: source.context.tableName,
      coordinatorAuthority: fixture.coordinatorAuthority,
    });
    await expect(
      table.putIfAbsent(intent(fixture.storeId, label)),
    ).rejects.toBeInstanceOf(ApplicationStateStoreRetiredError);
  } finally {
    await source.close();
  }
}

/** @param {string} root @param {ReturnType<typeof spawnCrashChild> | undefined} child */
async function cleanupFixture(root, child) {
  /** @type {unknown[]} */
  const failures = [];
  if (child) {
    try {
      await cleanupCrashChild(child);
    } catch (error) {
      failures.push(error);
    }
  }
  if (!child || child.exit) {
    try {
      await fsp.rm(root, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
  } else {
    failures.push(new Error(`Unreaped crash child; retaining fixture ${root}`));
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      'Snapshot publication crash cleanup failed.',
    );
  }
}

describe('real SIGKILL application-state snapshot publication', () => {
  testOnUnix.each(CASES)(
    'reopens and exactly retries after $phase',
    async ({ phase, marker, sealed, artifact, publication }) => {
      const root = await fsp.mkdtemp(
        join(tmpdir(), 'wharfie-snapshot-publication-crash-'),
      );
      /** @type {ReturnType<typeof spawnCrashChild> | undefined} */
      let cleanupChild;
      try {
        const fixture = await createFixture(root);
        const seeded = await readDurableState(fixture);
        expect(seeded.destinationAuthority).toBeNull();
        expect(seeded.marker).toBeNull();
        expect(seeded.retirement).toBeNull();
        expect(seeded.publication).toBeNull();
        expect(seeded.artifacts).toEqual([]);
        const child = spawnCrashChild({
          childPath: CHILD_PATH,
          cwd: root,
          options: {
            phase,
            appId: APP_ID,
            controlPath: fixture.controlPath,
            controlTableName: fixture.controlTableName,
            sourceConfiguration: fixture.sourceConfiguration,
            destination: fixture.destination,
            closedBarrier: fixture.closedBarrier,
            coordinatorAuthority: fixture.coordinatorAuthority,
            transferId: fixture.transferId,
            distributionIdentity: fixture.distributionIdentity,
            distributionRoot: fixture.distributionRoot,
          },
        });
        cleanupChild = child;
        const message = await waitForCrashChildMessage(
          child,
          (candidate) => candidate.kind === 'phase',
          `snapshot publication phase ${phase}`,
        );
        expect(message).toEqual({ kind: 'phase', phase });
        expect(await killCrashChild(child)).toEqual({
          code: null,
          signal: 'SIGKILL',
        });
        expect(child.stdout).toBe('');
        expect(child.stderr).toBe('');

        const killed = await readDurableState(fixture);
        expect(killed.authority).toMatchObject({
          appId: APP_ID,
          status: 'ACTIVE',
        });
        expect(createCoordinatorAuthorityToken(killed.authority)).toEqual(
          fixture.coordinatorAuthority,
        );
        expect(killed.barrier).toEqual(fixture.closedBarrier);
        expect(killed.barrier?.state).toBe(
          CoordinatorQuiescenceBarrierState.CLOSED,
        );
        expect(killed.marker !== null).toBe(marker);
        expect(killed.destinationAuthority).toEqual(
          createApplicationStateCoordinatorAuthorityRecord({
            storeId: fixture.storeId,
            namespace: APP_ID,
            authority: fixture.coordinatorAuthority,
          }),
        );
        expect(killed.retirement !== null).toBe(sealed);
        expect(killed.publication !== null).toBe(publication);
        expect(killed.artifacts).toHaveLength(artifact ? 1 : 0);
        if (marker) {
          expect(killed.marker).toMatchObject({
            transfer_id: fixture.transferId,
            store_id: fixture.storeId,
            namespace: APP_ID,
          });
        }
        if (sealed) {
          expect(killed.retirement).toMatchObject({
            retirement_id: fixture.transferId,
            store_id: fixture.storeId,
            namespace: APP_ID,
          });
        }
        if (publication) {
          expect(killed.publication).toMatchObject({
            transferId: fixture.transferId,
            sourceBarrier: fixture.closedBarrier,
            sourceAuthority: fixture.coordinatorAuthority,
          });
        }
        expect(killed.business).toMatchObject({
          value: { label: BUSINESS_KEY, retained: true },
        });
        if (sealed) {
          await expectSourceRemainsSealed(fixture, `after-${phase}-kill`);
        }

        // Provider bytes alone are not recovery evidence. Only the final
        // authority-and-barrier-fenced control record may make recovery succeed.
        await recoverBeforeRetry(fixture, publication);
        const transport = await retryPublication(fixture);
        expect(transport).toMatchObject({
          snapshot: {
            transferId: fixture.transferId,
            destination: fixture.destination,
          },
          distribution: fixture.distributionIdentity,
        });

        const recovered = await readDurableState(fixture);
        expect(recovered.authority).toEqual(killed.authority);
        expect(recovered.barrier).toEqual(killed.barrier);
        expect(recovered.marker).not.toBeNull();
        expect(recovered.destinationAuthority).toEqual(
          killed.destinationAuthority,
        );
        expect(recovered.retirement).not.toBeNull();
        expect(recovered.publication?.transport).toEqual(transport);
        expect(recovered.artifacts).toEqual([
          `${transport.snapshot.snapshotId}.snapshot`,
        ]);
        expect(recovered.business).toEqual(killed.business);
        await expectSourceRemainsSealed(fixture, 'after-publication-retry');
      } finally {
        await cleanupFixture(root, cleanupChild);
      }
    },
    15_000,
  );
});
