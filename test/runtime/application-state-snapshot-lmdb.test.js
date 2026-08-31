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
  ApplicationStateSnapshotActivationConflictError,
  createApplicationStateSnapshotControlStore,
  getApplicationStateSnapshotControlPartitionKey,
} from '../../src/core/runtime/application-state-snapshot-control.js';
import {
  ApplicationStateSnapshotTargetCorruptionError,
  publishApplicationStateSnapshot,
  recoverRetiredApplicationStateSnapshot,
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
const REPLICA_ID_FILE = '.wharfie-application-state-replica-id';

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

  async function supersede() {
    const observedAuthority = await authorities.get({ appId: APP_ID });
    const result = await authorities.takeover({
      appId: APP_ID,
      coordinatorId: 'later-coordinator',
      requestId: 'later-takeover',
      observedAuthority,
      confirmAuthorityReplacement: true,
      observedAt: currentBarrier.version + 1,
    });
    const laterAuthority = createCoordinatorAuthorityToken(result.authority);
    currentBarrier = (
      await admission.adopt({
        authority: laterAuthority,
        requestId: 'later-snapshot-adopt',
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
