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
  ApplicationStateStoreRetiredError,
  createApplicationStateActivationRecord,
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
import {
  APPLICATION_STATE_SNAPSHOT_ACTIVATION_KIND,
  APPLICATION_STATE_SNAPSHOT_ACTIVATION_PREFIX,
  APPLICATION_STATE_SNAPSHOT_CONTROL_SCHEMA_VERSION,
  ApplicationStateSnapshotActivationConflictError,
  createApplicationStateSnapshotControlStore,
} from '../../src/core/runtime/application-state-snapshot-control.js';
import {
  ApplicationStateSnapshotTargetCorruptionError,
  publishApplicationStateSnapshot,
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

/** @typedef {import('../fixtures/application-state-snapshot-transport-crash-child.js').CrashBoundary} CrashBoundary */

const CHILD_PATH = fileURLToPath(
  new URL(
    '../fixtures/application-state-snapshot-transport-crash-child.js',
    import.meta.url,
  ),
);
const APP_ID = 'application-state-snapshot-transport-crash';
const CONTROL_TABLE = 'application-state-snapshot-transport-crash-control';
const HYDRATION_CLAIM_FILE =
  '.wharfie-application-state-snapshot-hydration-claim';
const REPLICA_ID_FILE = '.wharfie-application-state-replica-id';
const testOnUnix = process.platform === 'win32' ? test.skip : test;
const CASES = /** @type {const} */ ([
  {
    boundary: 'hydration-staged',
    target: false,
    claim: false,
    data: false,
    evidence: false,
    activation: false,
    stages: 1,
    resumes: true,
  },
  {
    boundary: 'hydration-target-created',
    target: true,
    claim: true,
    data: false,
    evidence: false,
    activation: false,
    stages: 1,
    resumes: false,
  },
  {
    boundary: 'hydration-evidence-linked',
    target: true,
    claim: true,
    data: true,
    evidence: true,
    activation: false,
    stages: 1,
    resumes: true,
  },
  {
    boundary: 'hydration-committed',
    target: true,
    claim: false,
    data: true,
    evidence: true,
    activation: false,
    stages: 0,
    resumes: true,
  },
  {
    boundary: 'destination-adopted',
    target: true,
    claim: false,
    data: true,
    evidence: true,
    activation: true,
    stages: 0,
    resumes: true,
  },
]);

/** @param {string} prefix @param {string} label */
function id(prefix, label) {
  return createCanonicalJsonSha256Id({
    domain: `wharfie:test:snapshot-transport-crash:${prefix}`,
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

/** @param {string} storeId */
function seedIntent(storeId) {
  return Object.freeze({
    storeId,
    namespace: APP_ID,
    key: 'retained-before-transport',
    value: { retained: 'across-real-sigkill' },
    destinationEffectId: 'snapshot-transport-retained-effect',
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
      coordinatorId: 'snapshot-source',
      requestId: 'snapshot-source-acquire',
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
        requestId: 'snapshot-source-close',
        predecessor: null,
        observedAt: 1,
      })
    ).barrier;
    const storeId = id('was', 'transport-store');
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
      distributionId: id('wasd1', 'transport-distribution'),
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
      transferId: id('wast1', 'transport-transfer'),
      distribution,
    });
    const observed = await authorities.get({ appId: APP_ID });
    const replacementAcquisition = await authorities.takeover({
      appId: APP_ID,
      coordinatorId: 'snapshot-replacement',
      requestId: 'snapshot-replacement-takeover',
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
        requestId: 'snapshot-replacement-adopt',
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

/** @param {unknown} error @param {string} code */
function hasErrorCode(error, code) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code
  );
}

/** @param {string} path */
async function readOptionalFileState(path) {
  try {
    const pathStats = await fsp.lstat(path);
    if (!pathStats.isFile() || pathStats.isSymbolicLink()) {
      throw new Error(`Crash-state path is not a regular file: ${path}`);
    }
    const file = await fsp.open(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
      const stats = await file.stat();
      const bytes = await file.readFile();
      const retained = await fsp.lstat(path);
      if (
        !stats.isFile() ||
        !retained.isFile() ||
        retained.isSymbolicLink() ||
        retained.dev !== stats.dev ||
        retained.ino !== stats.ino
      ) {
        throw new Error(`Crash-state path changed during inspection: ${path}`);
      }
      return Object.freeze({
        bytes,
        regularFile: true,
        device: stats.dev,
        inode: stats.ino,
        links: stats.nlink,
        size: stats.size,
      });
    } finally {
      await file.close();
    }
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  }
}

/** @param {string} path */
async function readOptionalDirectoryState(path) {
  try {
    const stats = await fsp.lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`Crash-state path is not a directory: ${path}`);
    }
    const entries = (await fsp.readdir(path)).sort();
    const retained = await fsp.lstat(path);
    if (
      !retained.isDirectory() ||
      retained.isSymbolicLink() ||
      retained.dev !== stats.dev ||
      retained.ino !== stats.ino
    ) {
      throw new Error(`Crash-state directory changed during read: ${path}`);
    }
    return Object.freeze({
      entries,
      directory: true,
      device: stats.dev,
      inode: stats.ino,
    });
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  }
}

/** @param {Awaited<ReturnType<typeof readOptionalFileState>>} file */
function parseFileJson(file) {
  return file ? JSON.parse(file.bytes.toString('utf8')) : null;
}

/** @param {Fixture} fixture @param {string} storePath */
async function readPathState(fixture, storePath) {
  const snapshotId = fixture.transport.snapshot.snapshotId;
  const target = join(storePath, 'lmdb');
  const rootDirectory = await readOptionalDirectoryState(storePath);
  const targetDirectory = await readOptionalDirectoryState(target);
  const rootEntries = rootDirectory?.entries || [];
  const targetEntries = targetDirectory?.entries || [];
  const evidenceName = `.wharfie-application-state-snapshot-hydration-${snapshotId}`;
  const activationIntentName = `.wharfie-application-state-snapshot-activation-intent-${snapshotId}`;
  const stageNames = rootEntries.filter((entry) =>
    entry.startsWith('.wharfie-application-state-hydration-'),
  );
  const stageStates = await Promise.all(
    stageNames.map(async (name) => {
      const path = join(storePath, name);
      const directory = await readOptionalDirectoryState(path);
      if (!directory) {
        throw new Error(`Crash-state stage disappeared during read: ${path}`);
      }
      return Object.freeze({
        name,
        directory,
        entries: directory.entries,
        dataFile: await readOptionalFileState(join(path, 'data.mdb')),
        evidenceFile: await readOptionalFileState(join(path, evidenceName)),
      });
    }),
  );
  const replicaFile = await readOptionalFileState(
    join(storePath, REPLICA_ID_FILE),
  );
  const claimFile = await readOptionalFileState(
    join(storePath, HYDRATION_CLAIM_FILE),
  );
  const dataFile = await readOptionalFileState(join(target, 'data.mdb'));
  const evidenceFile = await readOptionalFileState(join(target, evidenceName));
  const activationIntentFile = await readOptionalFileState(
    join(target, activationIntentName),
  );
  return Object.freeze({
    rootDirectory,
    rootEntries,
    targetDirectory,
    targetEntries,
    replica: replicaFile !== null,
    replicaId: replicaFile ? replicaFile.bytes.toString('utf8').trim() : null,
    replicaFile,
    stages: stageStates.length,
    stageStates,
    claim: claimFile !== null,
    claimFile,
    claimRecord: parseFileJson(claimFile),
    target: targetDirectory !== null,
    data: dataFile !== null,
    dataFile,
    evidence: evidenceFile !== null,
    evidenceFile,
    activationIntent: activationIntentFile !== null,
    activationIntentFile,
    activationIntentRecord: parseFileJson(activationIntentFile),
  });
}

/** @param {Fixture} fixture @param {Record<string, any>} pathState @param {Buffer} snapshotBytes */
function expectExactPathEvidence(fixture, pathState, snapshotBytes) {
  const snapshotId = fixture.transport.snapshot.snapshotId;
  expect(pathState.rootDirectory?.directory).toBe(true);
  expect(pathState.targetDirectory?.directory || false).toBe(pathState.target);
  expect(pathState.replicaId).not.toBeNull();
  assertDomainSeparatedSha256Id(
    pathState.replicaId,
    'wasr1',
    'test physical replica id',
  );
  expect(pathState.replicaFile?.bytes.toString('utf8')).toBe(
    `${pathState.replicaId}\n`,
  );
  expect(pathState.replicaFile?.regularFile).toBe(true);
  for (const stage of pathState.stageStates) {
    expect(stage.directory.directory).toBe(true);
    expect(stage.entries).toEqual([
      `.wharfie-application-state-snapshot-hydration-${snapshotId}`,
      'data.mdb',
    ]);
    expect(stage.dataFile?.bytes).toEqual(snapshotBytes);
    expect(stage.dataFile?.regularFile).toBe(true);
    expect(stage.evidenceFile?.bytes.toString('utf8')).toBe(`${snapshotId}\n`);
    expect(stage.evidenceFile?.regularFile).toBe(true);
  }
  if (pathState.claim) {
    expect(Object.keys(pathState.claimRecord).sort()).toEqual(
      ['claimId', 'kind', 'schemaVersion', 'snapshotId'].sort(),
    );
    expect(pathState.claimRecord).toMatchObject({
      schemaVersion: 1,
      kind: 'wharfie.application-state-snapshot-hydration-claim.v1',
      snapshotId,
    });
    assertDomainSeparatedSha256Id(
      pathState.claimRecord.claimId,
      'washc1',
      'test hydration claim id',
    );
    expect(pathState.claimFile?.bytes.toString('utf8')).toBe(
      `${JSON.stringify(pathState.claimRecord)}\n`,
    );
  } else {
    expect(pathState.claimFile).toBeNull();
    expect(pathState.claimRecord).toBeNull();
  }
  if (pathState.data && !pathState.activationIntent) {
    expect(pathState.dataFile?.bytes).toEqual(snapshotBytes);
    expect(pathState.dataFile?.regularFile).toBe(true);
  }
  if (pathState.evidence) {
    expect(pathState.evidenceFile?.regularFile).toBe(true);
    expect(pathState.evidenceFile?.bytes.toString('utf8')).toBe(
      `${snapshotId}\n`,
    );
  }
  if (pathState.activationIntent) {
    expect(pathState.activationIntentFile?.regularFile).toBe(true);
    expect(pathState.activationIntentRecord).toEqual(
      createApplicationStateActivationRecord({
        storeId: fixture.storeId,
        namespace: APP_ID,
        transferId: fixture.transport.snapshot.transferId,
        snapshotId,
        distributionId: fixture.transport.distribution.distributionId,
        replicaId: pathState.replicaId,
        transportStatus: 'HYDRATED',
        authority: fixture.replacementAuthority,
      }),
    );
  } else {
    expect(pathState.activationIntentFile).toBeNull();
    expect(pathState.activationIntentRecord).toBeNull();
  }
}

/** @param {Fixture} fixture @param {Record<string, any>} publication @param {Record<string, any>} activation @param {string} replicaId */
function expectExactCentralActivation(
  fixture,
  publication,
  activation,
  replicaId,
) {
  expect(Object.keys(activation).sort()).toEqual(
    [
      'schemaVersion',
      'kind',
      'appId',
      'transferId',
      'snapshotId',
      'publicationId',
      'transport',
      'replacementAuthority',
      'replacementBarrier',
      'replicaId',
      'transportStatus',
      'activationId',
    ].sort(),
  );
  expect(activation).toMatchObject({
    schemaVersion: APPLICATION_STATE_SNAPSHOT_CONTROL_SCHEMA_VERSION,
    kind: APPLICATION_STATE_SNAPSHOT_ACTIVATION_KIND,
    appId: APP_ID,
    transferId: fixture.transport.snapshot.transferId,
    snapshotId: fixture.transport.snapshot.snapshotId,
    publicationId: publication.publicationId,
    transport: fixture.transport,
    replacementAuthority: fixture.replacementAuthority,
    replacementBarrier: fixture.replacementBarrier,
    replicaId,
    transportStatus: 'HYDRATED',
  });
  assertDomainSeparatedSha256Id(
    activation.activationId,
    APPLICATION_STATE_SNAPSHOT_ACTIVATION_PREFIX,
    'test central activation id',
  );
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

/** @param {Fixture} fixture @param {Fixture['replacementConfiguration']} configuration */
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
      'retained-before-transport',
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

/** @param {Fixture} fixture @param {Fixture['replacementConfiguration']} configuration @param {string} label */
async function expectDestinationRemainsSealed(fixture, configuration, label) {
  const applicationState = await openApplicationStateDB({ configuration });
  try {
    const table = createApplicationStateTable({
      db: applicationState.db,
      tableName: applicationState.context.tableName,
      coordinatorAuthority: fixture.replacementAuthority,
    });
    await expect(
      table.putIfAbsent({
        ...seedIntent(fixture.storeId),
        key: `rejected-${label}`,
        destinationEffectId: `snapshot-transport-${label}`,
        contractDigest: id('wac', label),
      }),
    ).rejects.toBeInstanceOf(ApplicationStateStoreRetiredError);
  } finally {
    await applicationState.close();
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
      'Snapshot transport crash cleanup failed.',
    );
  }
}

describe('real SIGKILL application-state snapshot transport', () => {
  testOnUnix.each(CASES)(
    'recovers or fails closed after $boundary',
    async ({
      boundary,
      target,
      claim,
      data,
      evidence,
      activation,
      stages,
      resumes,
    }) => {
      const root = await fsp.mkdtemp(
        join(tmpdir(), 'wharfie-snapshot-transport-crash-'),
      );
      /** @type {ReturnType<typeof spawnCrashChild> | undefined} */
      let cleanupChild;
      try {
        const fixture = await createFixture(root);
        const before = await readControlState(fixture);
        expect(before.authority).toMatchObject({
          appId: APP_ID,
          status: 'ACTIVE',
        });
        expect(createCoordinatorAuthorityToken(before.authority)).toEqual(
          fixture.replacementAuthority,
        );
        expect(before.barrier).toEqual(fixture.replacementBarrier);
        expect(before.publication?.transport).toEqual(fixture.transport);
        expect(before.activation).toBeNull();
        const snapshotBytes = await distribution(fixture).readBytes(
          fixture.transport.snapshot,
        );
        const sealedSource = await readDestinationState(
          fixture,
          fixture.sourceConfiguration,
        );
        expect(sealedSource.authority).toEqual(
          createApplicationStateCoordinatorAuthorityRecord({
            storeId: fixture.storeId,
            namespace: APP_ID,
            authority: fixture.sourceAuthority,
          }),
        );
        expect(sealedSource.retirement).toMatchObject({
          retirement_id: fixture.transport.snapshot.transferId,
        });
        expect(sealedSource.activation).toBeNull();
        expect(sealedSource.business).toMatchObject({
          value: { retained: 'across-real-sigkill' },
        });

        const child = spawnCrashChild({
          childPath: CHILD_PATH,
          cwd: root,
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
        cleanupChild = child;
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

        const killedPaths = await readPathState(
          fixture,
          fixture.replacementConfiguration.storePath,
        );
        expect(killedPaths.replica).toBe(true);
        expect(killedPaths.target).toBe(target);
        expect(killedPaths.claim).toBe(claim);
        expect(killedPaths.data).toBe(data);
        expect(killedPaths.evidence).toBe(evidence);
        expect(killedPaths.activationIntent).toBe(activation);
        expect(killedPaths.stages).toBe(stages);
        expectExactPathEvidence(fixture, killedPaths, snapshotBytes);
        if (!killedPaths.replicaId) {
          throw new Error('Killed transport has no physical replica identity.');
        }
        if (boundary === 'hydration-evidence-linked') {
          expect(killedPaths.stageStates).toHaveLength(1);
          expect(killedPaths.dataFile).toMatchObject({
            device: killedPaths.stageStates[0].dataFile?.device,
            inode: killedPaths.stageStates[0].dataFile?.inode,
          });
          expect(killedPaths.evidenceFile).toMatchObject({
            device: killedPaths.stageStates[0].evidenceFile?.device,
            inode: killedPaths.stageStates[0].evidenceFile?.inode,
          });
        }

        const killedControl = await readControlState(fixture);
        expect(killedControl.authority).toEqual(before.authority);
        expect(killedControl.barrier).toEqual(before.barrier);
        expect(killedControl.barrier?.state).toBe(
          CoordinatorQuiescenceBarrierState.CLOSED,
        );
        expect(killedControl.publication).toEqual(before.publication);
        expect(killedControl.activation !== null).toBe(activation);
        if (activation) {
          if (!killedControl.publication || !killedControl.activation) {
            throw new Error('Activated kill lost exact central evidence.');
          }
          expectExactCentralActivation(
            fixture,
            killedControl.publication,
            killedControl.activation,
            killedPaths.replicaId,
          );
        } else {
          expect(killedControl.activation).toBeNull();
        }

        if (evidence) {
          const killedDestination = await readDestinationState(
            fixture,
            fixture.replacementConfiguration,
          );
          if (activation) {
            expect(killedDestination).toEqual({
              authority: createApplicationStateCoordinatorAuthorityRecord({
                storeId: fixture.storeId,
                namespace: APP_ID,
                authority: fixture.replacementAuthority,
              }),
              retirement: null,
              activation: createApplicationStateActivationRecord({
                storeId: fixture.storeId,
                namespace: APP_ID,
                transferId: fixture.transport.snapshot.transferId,
                snapshotId: fixture.transport.snapshot.snapshotId,
                distributionId: fixture.transport.distribution.distributionId,
                replicaId: killedPaths.replicaId,
                transportStatus: 'HYDRATED',
                authority: fixture.replacementAuthority,
              }),
              business: sealedSource.business,
            });
          } else {
            expect(killedDestination).toEqual(sealedSource);
          }
        }

        if (!resumes) {
          await expect(
            runTransport(fixture, fixture.replacementConfiguration),
          ).rejects.toBeInstanceOf(
            ApplicationStateSnapshotTargetCorruptionError,
          );
          const failedPaths = await readPathState(
            fixture,
            fixture.replacementConfiguration.storePath,
          );
          expect(failedPaths).toEqual(killedPaths);
          const failedControl = await readControlState(fixture);
          expect(failedControl).toEqual(killedControl);
          return;
        }

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

        const recoveredPaths = await readPathState(
          fixture,
          fixture.replacementConfiguration.storePath,
        );
        expect(recoveredPaths).toMatchObject({
          replica: true,
          target: true,
          claim: false,
          data: true,
          evidence: true,
          activationIntent: true,
        });
        expect(recoveredPaths.replicaId).toBe(killedPaths.replicaId);
        expect(recoveredPaths.claimFile).toBeNull();
        expect(recoveredPaths.evidenceFile?.bytes.toString('utf8')).toBe(
          `${fixture.transport.snapshot.snapshotId}\n`,
        );
        expect(recoveredPaths.activationIntentRecord).toEqual(
          createApplicationStateActivationRecord({
            storeId: fixture.storeId,
            namespace: APP_ID,
            transferId: fixture.transport.snapshot.transferId,
            snapshotId: fixture.transport.snapshot.snapshotId,
            distributionId: fixture.transport.distribution.distributionId,
            replicaId: killedPaths.replicaId,
            transportStatus: 'HYDRATED',
            authority: fixture.replacementAuthority,
          }),
        );
        if (killedPaths.dataFile) {
          expect(recoveredPaths.dataFile).toMatchObject({
            device: killedPaths.dataFile.device,
            inode: killedPaths.dataFile.inode,
          });
        }
        if (killedPaths.evidenceFile) {
          expect(recoveredPaths.evidenceFile).toMatchObject({
            device: killedPaths.evidenceFile.device,
            inode: killedPaths.evidenceFile.inode,
          });
        }
        if (boundary === 'hydration-staged') {
          const killedStage = killedPaths.stageStates[0];
          expect([
            recoveredPaths.dataFile?.device,
            recoveredPaths.dataFile?.inode,
          ]).not.toEqual([
            killedStage.dataFile?.device,
            killedStage.dataFile?.inode,
          ]);
          expect([
            recoveredPaths.evidenceFile?.device,
            recoveredPaths.evidenceFile?.inode,
          ]).not.toEqual([
            killedStage.evidenceFile?.device,
            killedStage.evidenceFile?.inode,
          ]);
        }
        const recoveredControl = await readControlState(fixture);
        expect(recoveredControl.authority).toEqual(before.authority);
        expect(recoveredControl.barrier).toEqual(before.barrier);
        expect(recoveredControl.publication).toEqual(before.publication);
        if (!recoveredControl.publication || !recoveredControl.activation) {
          throw new Error('Recovered transport lost exact central evidence.');
        }
        expectExactCentralActivation(
          fixture,
          recoveredControl.publication,
          recoveredControl.activation,
          killedPaths.replicaId,
        );
        const destinationState = await readDestinationState(
          fixture,
          fixture.replacementConfiguration,
        );
        expect(destinationState.authority).toEqual(
          createApplicationStateCoordinatorAuthorityRecord({
            storeId: fixture.storeId,
            namespace: APP_ID,
            authority: fixture.replacementAuthority,
          }),
        );
        expect(destinationState.retirement).toBeNull();
        expect(destinationState.activation).toEqual(
          createApplicationStateActivationRecord({
            storeId: fixture.storeId,
            namespace: APP_ID,
            transferId: fixture.transport.snapshot.transferId,
            snapshotId: fixture.transport.snapshot.snapshotId,
            distributionId: fixture.transport.distribution.distributionId,
            replicaId: killedPaths.replicaId,
            transportStatus: 'HYDRATED',
            authority: fixture.replacementAuthority,
          }),
        );
        expect(destinationState.business).toEqual(sealedSource.business);

        if (boundary === 'destination-adopted') {
          await expect(
            runTransport(fixture, fixture.alternateConfiguration),
          ).rejects.toBeInstanceOf(
            ApplicationStateSnapshotActivationConflictError,
          );
          const losingReplica = await readPathState(
            fixture,
            fixture.alternateConfiguration.storePath,
          );
          expect(losingReplica).toMatchObject({
            replica: true,
            target: true,
            claim: false,
            data: true,
            evidence: true,
            activationIntent: false,
          });
          expectExactPathEvidence(fixture, losingReplica, snapshotBytes);
          const losingState = await readDestinationState(
            fixture,
            fixture.alternateConfiguration,
          );
          expect(losingState).toEqual(sealedSource);
          await expectDestinationRemainsSealed(
            fixture,
            fixture.alternateConfiguration,
            'alternate-after-central-conflict',
          );
          await expect(
            readDestinationState(fixture, fixture.alternateConfiguration),
          ).resolves.toEqual(sealedSource);
          const afterConflict = await readControlState(fixture);
          expect(afterConflict).toEqual(recoveredControl);
        }
      } finally {
        await cleanupFixture(root, cleanupChild);
      }
    },
    15_000,
  );
});
