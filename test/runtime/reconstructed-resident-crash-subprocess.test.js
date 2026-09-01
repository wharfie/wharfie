/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { promises as fsp, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

import { loadPreparedDurableExecution } from '../../src/cli/app/load-durable-execution.js';
import { APPLICATION_STATE_TABLE_NAME } from '../../src/core/lib/config/db.js';
import {
  AttemptStatus,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import {
  CoordinatorAuthorityStaleError,
  CoordinatorAuthorityStatus,
  createCoordinatorAuthority,
  createCoordinatorAuthorityToken,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import {
  CoordinatorQuiescenceBarrierState,
  createCoordinatorQuiescenceBarrier,
} from '../../src/core/lib/db/tables/coordinator-quiescence-barrier.js';
import { createApplicationStateTable } from '../../src/core/lib/db/tables/application-state.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { createReplicatedExecutionPayloadStore } from '../../src/core/lib/payload-store/replicated.js';
import { resolveManifestActivityExecutionIdentity } from '../../src/core/runtime/app-runs.js';
import { openApplicationStateDB } from '../../src/core/runtime/application-state-store.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import { createManualLedgerRunId } from '../../src/core/runtime/manual-ledger-run.js';
import { validateResidentReplacementInputReceipt } from '../../src/core/runtime/resident-replacement-input.js';
import { ResidentExecutionReconstructionPolicy } from '../../src/core/runtime/services/resident-execution-reconstruction.js';
import { createFilesystemExecutionPayloadDistribution } from '../helpers/execution-payload-filesystem-distribution.js';
import {
  cleanupIsolatedAuthoredAppFixtures,
  createIsolatedAuthoredAppFixture,
} from '../helpers/isolated-authored-app.js';
import { createPersistentDynamoDBAuthorityTestClient } from '../helpers/persistent-dynamodb-authority-test-client.js';
import {
  cleanupCrashChild,
  killCrashChild,
  spawnCrashChild,
  waitForCrashChildExit,
  waitForCrashChildMessage,
} from '../helpers/real-sigkill-subprocess.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHILD_PATH = fileURLToPath(
  new URL('../fixtures/reconstructed-resident-crash-child.js', import.meta.url),
);
const AUTHORED_APP_PATH = fileURLToPath(
  new URL('../fixtures/apps/resident-authored-crash/', import.meta.url),
);
const APP_ID = 'resident-authored-crash';
const ACTIVITY_ID = 'crash-task';
const TABLE_NAME = 'reconstructed-resident-crash';
const REGION = 'us-east-2';
const RENEWAL_INTERVAL_MS = 20;
const OBSERVATION_WINDOW_MS = 80;
const WAIT_TIMEOUT_MS = 30_000;
const testOnUnix = process.platform === 'win32' ? test.skip : test;

/** @typedef {Record<string, any>} Fixture */
/** @typedef {Record<string, any>} CrashMessage */
/** @typedef {typeof CASES[number]} CaseDefinition */
/** @typedef {ReturnType<typeof spawnCrashChild>} CrashHandle */

const CASES = Object.freeze([
  Object.freeze({
    scenario: 'authored-running',
    inputMode: 'hang',
    policy: ResidentExecutionReconstructionPolicy.STARTED_OUTCOME_UNKNOWN,
  }),
  Object.freeze({
    scenario: 'final-terminal-loss',
    inputMode: 'complete',
    policy: ResidentExecutionReconstructionPolicy.TERMINAL,
  }),
]);

/** @param {string} prefix @param {string} label */
function id(prefix, label) {
  return createCanonicalJsonSha256Id({
    domain: `wharfie:test:reconstructed-resident-crash:${prefix}`,
    prefix,
    value: { label },
  });
}

/** @param {any} left @param {any} right */
function sameAuthority(left, right) {
  return (
    left?.schemaVersion === right?.schemaVersion &&
    left?.appId === right?.appId &&
    left?.coordinatorId === right?.coordinatorId &&
    left?.authorityId === right?.authorityId &&
    left?.epoch === right?.epoch
  );
}

/** @param {Fixture} fixture */
function markerEntries(fixture) {
  try {
    return readFileSync(fixture.markerPath, 'utf8').split('\n').filter(Boolean);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return [];
    }
    throw error;
  }
}

/** @param {CrashHandle} handle @param {string} command */
async function sendCommand(handle, command) {
  await new Promise((resolve, reject) => {
    handle.child.send({ kind: 'command', command }, (error) => {
      if (error) reject(error);
      else resolve(undefined);
    });
  });
}

/** @param {Fixture} fixture @param {string} localPath */
function createPayloadStore(fixture, localPath) {
  const distribution = createFilesystemExecutionPayloadDistribution({
    identity: fixture.payloadDistributionIdentity,
    root: fixture.payloadDistributionRoot,
  });
  return createReplicatedExecutionPayloadStore({
    localStore: createLocalExecutionPayloadStore({
      path: localPath,
      storeId: distribution.identity.storeId,
    }),
    distribution,
  });
}

/** @param {CaseDefinition} caseDefinition @returns {Promise<Fixture>} */
async function createFixture(caseDefinition) {
  const authoredApp = createIsolatedAuthoredAppFixture(AUTHORED_APP_PATH, {
    prefix: 'wharfie-reconstructed-resident-crash-app-',
  });
  let root;
  try {
    root = await fsp.mkdtemp(
      join(tmpdir(), 'wharfie-reconstructed-resident-crash-'),
    );
  } catch (error) {
    authoredApp.cleanup();
    throw error;
  }
  try {
    const loaded = await loadPreparedDurableExecution({
      dir: authoredApp.appDir,
      activity: ACTIVITY_ID,
    });
    let identity;
    try {
      identity = resolveManifestActivityExecutionIdentity(loaded.execution);
    } finally {
      await loaded.cleanup?.();
    }
    if (identity.appId !== APP_ID) {
      throw new Error('Integrated crash fixture loaded the wrong application.');
    }
    const token = `${caseDefinition.scenario}-generation-1`;
    const markerPath = join(root, 'authored-entry.log');
    const proof = Object.freeze({
      exact: 'retained-integrated-terminal',
      nested: Object.freeze({ committed: true, sequence: 1 }),
    });
    const input = Object.freeze({
      markerPath,
      mode: caseDefinition.inputMode,
      token,
      ...(caseDefinition.inputMode === 'complete' ? { proof } : {}),
    });
    const actor = Object.freeze({ kind: 'resident-test', id: APP_ID });
    const callerMetadata = Object.freeze({
      source: 'reconstructed-resident-crash',
      scenario: caseDefinition.scenario,
    });
    const fixture = {
      root,
      authoredApp,
      appDir: authoredApp.appDir,
      appId: identity.appId,
      revisionId: identity.revisionId,
      runId: createManualLedgerRunId({
        appId: APP_ID,
        idempotencyKey: caseDefinition.scenario,
      }),
      markerPath,
      marker: `entry:${token}`,
      input,
      actor,
      callerMetadata,
      scenario: caseDefinition.scenario,
      policy: caseDefinition.policy,
      controlPath: join(root, 'control'),
      payloadDistributionRoot: join(root, 'distributed-payloads'),
      payloadDistributionIdentity: Object.freeze({
        kind: 'wharfie.execution-payload-distribution.v1',
        distributionId: id('wepd1', `${caseDefinition.scenario}-payloads`),
        storeId: 'reconstructed-resident-crash-payloads',
      }),
      sourceApplicationStateConfiguration: Object.freeze({
        adapterName: /** @type {const} */ ('lmdb'),
        storePath: join(root, 'source-application-state'),
        tableName: APPLICATION_STATE_TABLE_NAME,
      }),
      replacementApplicationStateConfiguration: Object.freeze({
        adapterName: /** @type {const} */ ('lmdb'),
        storePath: join(root, 'replacement-application-state'),
        tableName: APPLICATION_STATE_TABLE_NAME,
      }),
      snapshotDistributionRoot: join(root, 'distributed-snapshots'),
      snapshotDistributionId: id(
        'wasd1',
        `${caseDefinition.scenario}-snapshots`,
      ),
      snapshotTransferId: id('wast1', `${caseDefinition.scenario}-transfer`),
      sessionPath: join(root, 'sessions'),
      tableResourceId: id('wdtr1', `${caseDefinition.scenario}-table`),
    };

    const db = createPersistentDynamoDBAuthorityTestClient({
      path: fixture.controlPath,
    });
    try {
      const authorities = createCoordinatorAuthority({
        db,
        tableName: TABLE_NAME,
      });
      const acquired = await authorities.acquire({
        appId: APP_ID,
        coordinatorId: 'integrated-provisioner',
        requestId: `integrated-provision:${caseDefinition.scenario}`,
        observedAt: 1,
      });
      const authority = createCoordinatorAuthorityToken(acquired.authority);
      const payloadStore = createPayloadStore(
        fixture,
        join(root, 'provisioning-payloads'),
      );
      const ledger = createExecutionLedger({
        db,
        tableName: TABLE_NAME,
        payloadStore,
      }).bindCoordinatorAuthority(authority);
      const created = await ledger.createManualRun({
        runId: fixture.runId,
        appId: APP_ID,
        revisionId: fixture.revisionId,
        invocationId: 'manual',
        activityId: ACTIVITY_ID,
        input,
        callerMetadata,
        transitionId: 'create',
        actor,
        observedAt: 2,
      });
      if (!created.applied)
        throw new Error('Crash run was not newly provisioned.');
      await authorities.release({
        authority: acquired.authority,
        requestId: `integrated-provision-release:${caseDefinition.scenario}`,
        observedAt: 3,
      });
    } finally {
      await db.close();
    }
    return fixture;
  } catch (error) {
    const cleanups = await Promise.allSettled([
      fsp.rm(root, { recursive: true, force: true }),
      Promise.resolve().then(() => authoredApp.cleanup()),
    ]);
    const failures = cleanups
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(
        [error, ...failures],
        'Integrated crash fixture setup and cleanup both failed.',
      );
    }
    throw error;
  }
}

/** @param {Fixture} fixture @param {'predecessor'|'successor'} mode @param {Record<string, any>} [extra] */
function childOptions(fixture, mode, extra = {}) {
  return {
    mode,
    scenario: fixture.scenario,
    appDir: fixture.appDir,
    appId: APP_ID,
    revisionId: fixture.revisionId,
    runId: fixture.runId,
    markerPath: fixture.markerPath,
    marker: fixture.marker,
    input: fixture.input,
    actor: fixture.actor,
    callerMetadata: fixture.callerMetadata,
    controlPath: fixture.controlPath,
    tableName: TABLE_NAME,
    localPayloadPath: join(fixture.root, `${mode}-payloads`),
    payloadDistributionRoot: fixture.payloadDistributionRoot,
    payloadDistributionIdentity: fixture.payloadDistributionIdentity,
    applicationStateConfiguration: fixture.sourceApplicationStateConfiguration,
    sessionPath: fixture.sessionPath,
    region: REGION,
    tableResourceId: fixture.tableResourceId,
    renewalIntervalMs: RENEWAL_INTERVAL_MS,
    observationWindowMs: OBSERVATION_WINDOW_MS,
    snapshotDistributionRoot: fixture.snapshotDistributionRoot,
    snapshotDistributionId: fixture.snapshotDistributionId,
    snapshotTransferId: fixture.snapshotTransferId,
    ...extra,
  };
}

/** @param {Fixture} fixture @param {CrashMessage} crashBoundary */
async function publishReplacementInput(fixture, crashBoundary) {
  const db = createPersistentDynamoDBAuthorityTestClient({
    path: fixture.controlPath,
  });
  try {
    const retainedAuthority = await createCoordinatorAuthority({
      db,
      tableName: TABLE_NAME,
    }).get({ appId: APP_ID });
    expect(retainedAuthority).toMatchObject({
      status: CoordinatorAuthorityStatus.ACTIVE,
      coordinatorId: 'integrated-predecessor',
    });
    if (!retainedAuthority) {
      throw new Error(
        'Predecessor authority is unavailable after process death.',
      );
    }
    expect(
      sameAuthority(retainedAuthority, crashBoundary.coordinatorAuthority),
    ).toBe(true);
    const barrier = await createCoordinatorQuiescenceBarrier({
      db,
      tableName: TABLE_NAME,
    }).get({ appId: APP_ID });
    expect(barrier).toEqual(crashBoundary.closedBarrier);
    expect(barrier).toMatchObject({
      state: CoordinatorQuiescenceBarrierState.CLOSED,
      authority: crashBoundary.coordinatorAuthority,
    });
    if (!barrier) throw new Error('Predecessor CLOSED barrier is unavailable.');
    const replacementInput = validateResidentReplacementInputReceipt(
      crashBoundary.replacementInput,
    );
    expect(replacementInput.applicationStateTransport).toEqual(
      crashBoundary.applicationStateTransport,
    );
    expect(
      replacementInput.applicationStateTransport.snapshot.checkpoint
        .sourceBarrier,
    ).toEqual(barrier);
    return {
      barrier,
      predecessorAuthority: crashBoundary.coordinatorAuthority,
      predecessorRecord: retainedAuthority,
      storeId: crashBoundary.readiness.store_id,
      replacementInput,
    };
  } finally {
    await db.close();
  }
}

/** @param {Fixture} fixture @param {ReturnType<typeof createCoordinatorAuthorityToken>} predecessorAuthority */
async function proveStalePredecessor(fixture, predecessorAuthority) {
  const db = createPersistentDynamoDBAuthorityTestClient({
    path: fixture.controlPath,
  });
  try {
    const payloadStore = createPayloadStore(
      fixture,
      join(fixture.root, 'stale-payloads'),
    );
    const baseLedger = createExecutionLedger({
      db,
      tableName: TABLE_NAME,
      payloadStore,
    });
    const staleLedger =
      baseLedger.bindCoordinatorAuthority(predecessorAuthority);
    const staleRunId = `${fixture.runId}-delayed-predecessor`;
    let rejected;
    try {
      await staleLedger.createManualRun({
        runId: staleRunId,
        appId: APP_ID,
        revisionId: fixture.revisionId,
        invocationId: 'manual',
        activityId: ACTIVITY_ID,
        input: fixture.input,
        callerMetadata: fixture.callerMetadata,
        transitionId: 'create',
        actor: fixture.actor,
      });
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBeInstanceOf(CoordinatorAuthorityStaleError);
    await expect(baseLedger.rebuildRun(staleRunId)).resolves.toBeNull();
  } finally {
    await db.close();
  }
}

/** @param {Fixture} fixture @param {ReturnType<typeof createCoordinatorAuthorityToken>} successorAuthority @param {string} storeId */
async function reopenDurableState(fixture, successorAuthority, storeId) {
  const db = createPersistentDynamoDBAuthorityTestClient({
    path: fixture.controlPath,
    readOnly: true,
  });
  try {
    const payloadStore = createPayloadStore(
      fixture,
      join(fixture.root, 'reopen-payloads'),
    );
    const ledger = createExecutionLedger({
      db,
      tableName: TABLE_NAME,
      payloadStore,
    });
    const [authority, barrier, view, ready, output] = await Promise.all([
      createCoordinatorAuthority({ db, tableName: TABLE_NAME }).get({
        appId: APP_ID,
      }),
      createCoordinatorQuiescenceBarrier({ db, tableName: TABLE_NAME }).get({
        appId: APP_ID,
      }),
      ledger.rebuildRun(fixture.runId),
      ledger.listReadyWork({
        appId: APP_ID,
        revisionId: fixture.revisionId,
        observedAt: Number.MAX_SAFE_INTEGER,
        limit: 100,
      }),
      ledger.readRunOutput({ appId: APP_ID, runId: fixture.runId }),
    ]);
    expect(authority).toMatchObject({
      status: CoordinatorAuthorityStatus.RELEASED,
      coordinatorId: 'integrated-successor',
    });
    expect(sameAuthority(authority, successorAuthority)).toBe(true);
    expect(barrier).toMatchObject({
      state: CoordinatorQuiescenceBarrierState.OPEN,
      authority: successorAuthority,
    });
    expect(ready.items).toEqual([]);
    if (!view) throw new Error('Reopened crash run is unavailable.');
    return { authority, barrier, view, output };
  } finally {
    await db.close();
    const applicationState = await openApplicationStateDB({
      configuration: fixture.replacementApplicationStateConfiguration,
    });
    try {
      const table = createApplicationStateTable({
        db: applicationState.db,
        tableName: applicationState.context.tableName,
        coordinatorAuthority: successorAuthority,
      });
      await expect(table.assertStoreIdentity(storeId)).resolves.toMatchObject({
        store_id: storeId,
      });
    } finally {
      await applicationState.close();
    }
  }
}

/** @param {Fixture} fixture @param {CrashHandle[]} handles */
async function cleanupFixture(fixture, handles) {
  const childResults = await Promise.allSettled(
    handles.map(async (handle) => await cleanupCrashChild(handle)),
  );
  const childFailures = childResults
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (childFailures.length > 0) {
    throw new AggregateError(
      childFailures,
      `Integrated crash children were not reaped; retained diagnostics at ${fixture.root} and ${fixture.authoredApp.root}.`,
    );
  }
  const resourceResults = await Promise.allSettled([
    fsp.rm(fixture.root, { recursive: true, force: true }),
    Promise.resolve().then(() =>
      cleanupIsolatedAuthoredAppFixtures([fixture.authoredApp]),
    ),
  ]);
  const failures = resourceResults
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      'Integrated crash fixture cleanup did not reap every owned resource.',
    );
  }
}

describe('reconstructed resident real-process crash matrix', () => {
  for (const caseDefinition of CASES) {
    testOnUnix(
      `${caseDefinition.scenario} crosses renewal, takeover, reconstruction, state transport, and worker admission without duplicate dispatch`,
      async () => {
        const fixture = await createFixture(caseDefinition);
        /** @type {Array<ReturnType<typeof spawnCrashChild>>} */
        const handles = [];
        try {
          const predecessor = spawnCrashChild({
            childPath: CHILD_PATH,
            cwd: REPO_ROOT,
            options: childOptions(fixture, 'predecessor'),
          });
          handles.push(predecessor);
          const renewal = await waitForCrashChildMessage(
            predecessor,
            (message) => message.kind === 'authority-renewed',
            'predecessor renewal',
            WAIT_TIMEOUT_MS,
          );
          const crashBoundary = await waitForCrashChildMessage(
            predecessor,
            (message) =>
              message.kind === 'crash-boundary' &&
              message.boundary === fixture.scenario,
            fixture.scenario,
            WAIT_TIMEOUT_MS,
          );
          expect(renewal.authority.recordVersion).toBeGreaterThan(
            renewal.predecessor.recordVersion,
          );
          expect(crashBoundary.closedBarrier).toMatchObject({
            state: CoordinatorQuiescenceBarrierState.CLOSED,
            authority: crashBoundary.coordinatorAuthority,
          });
          expect(crashBoundary.detail.attempt).toMatchObject({
            status:
              fixture.scenario === 'authored-running'
                ? AttemptStatus.STARTED
                : AttemptStatus.COMPLETED,
            generation: 1,
          });
          expect(markerEntries(fixture)).toEqual([fixture.marker]);
          await expect(killCrashChild(predecessor)).resolves.toEqual({
            code: null,
            signal: 'SIGKILL',
          });

          const handoff = await publishReplacementInput(fixture, crashBoundary);
          expect(handoff.predecessorRecord).toEqual(renewal.authority);
          const successor = spawnCrashChild({
            childPath: CHILD_PATH,
            cwd: REPO_ROOT,
            options: childOptions(fixture, 'successor', {
              replacementInput: handoff.replacementInput,
              snapshotDistributionRoot: fixture.snapshotDistributionRoot,
              replacementApplicationStateConfiguration:
                fixture.replacementApplicationStateConfiguration,
            }),
          });
          handles.push(successor);

          await waitForCrashChildMessage(
            successor,
            (message) => message.kind === 'authority-acquire-conflict',
            'successor acquisition conflict',
            WAIT_TIMEOUT_MS,
          );
          const observation = await waitForCrashChildMessage(
            successor,
            (message) => message.kind === 'authority-observation-stable',
            'stable RVN observation',
            WAIT_TIMEOUT_MS,
          );
          expect(observation.observation).toMatchObject({
            schemaVersion: 1,
            kind: 'dynamodb-coordinator-authority-rvn-observation',
            tableName: TABLE_NAME,
            appId: APP_ID,
            observationWindowMs: OBSERVATION_WINDOW_MS,
            recordVersion: handoff.predecessorRecord.recordVersion,
            authority: handoff.predecessorRecord,
          });
          expect(
            BigInt(observation.observation.elapsedNanoseconds),
          ).toBeGreaterThanOrEqual(BigInt(OBSERVATION_WINDOW_MS) * 1_000_000n);
          const takeover = await waitForCrashChildMessage(
            successor,
            (message) => message.kind === 'authority-taken-over',
            'successor takeover',
            WAIT_TIMEOUT_MS,
          );
          expect(takeover.observation).toEqual(observation.observation);
          expect(takeover.authority).toMatchObject({
            status: CoordinatorAuthorityStatus.ACTIVE,
            coordinatorId: 'integrated-successor',
            epoch: handoff.predecessorAuthority.epoch + 1,
            recordVersion: handoff.predecessorRecord.recordVersion + 1,
          });
          const successorAuthority = createCoordinatorAuthorityToken(
            takeover.authority,
          );

          const adopted = await waitForCrashChildMessage(
            successor,
            (message) =>
              message.kind === 'barrier-phase' && message.phase === 'adopted',
            'adopted barrier checkpoint',
            WAIT_TIMEOUT_MS,
          );
          expect(adopted.barrier).toMatchObject({
            state: CoordinatorQuiescenceBarrierState.CLOSED,
            authority: successorAuthority,
            version: handoff.barrier.version + 1,
          });
          const phases = [
            'execution-reconstruction-before',
            'execution-reconstruction-after',
            'application-state-transport-before',
            'application-state-transport-after',
            'application-state-readiness-before',
            'application-state-readiness-after',
          ];
          for (const phase of phases) {
            const checkpoint = await waitForCrashChildMessage(
              successor,
              (message) =>
                message.kind === 'barrier-phase' && message.phase === phase,
              `${phase} barrier checkpoint`,
              WAIT_TIMEOUT_MS,
            );
            expect(checkpoint.barrier).toEqual(adopted.barrier);
          }
          const reconstruction = await waitForCrashChildMessage(
            successor,
            (message) => message.kind === 'execution-reconstruction',
            'execution reconstruction',
            WAIT_TIMEOUT_MS,
          );
          expect(reconstruction.reconstruction).toMatchObject({
            inspectedRuns: 1,
            policyCounts: { [fixture.policy]: 1 },
          });
          const reopenedCheckpoint = await waitForCrashChildMessage(
            successor,
            (message) =>
              message.kind === 'barrier-phase' && message.phase === 'reopened',
            'reopened barrier checkpoint',
            WAIT_TIMEOUT_MS,
          );
          expect(reopenedCheckpoint.barrier).toMatchObject({
            state: CoordinatorQuiescenceBarrierState.OPEN,
            authority: successorAuthority,
            version: adopted.barrier.version + 1,
          });
          const ready = await waitForCrashChildMessage(
            successor,
            (message) => message.kind === 'resident-ready',
            'successor resident admission',
            WAIT_TIMEOUT_MS,
          );
          expect(ready.closedBarrier).toEqual(adopted.barrier);
          expect(ready.barrier).toEqual(reopenedCheckpoint.barrier);
          expect(ready.applicationStateTransport).toMatchObject({
            status: 'HYDRATED',
          });
          expect(ready.applicationState).toMatchObject({ status: 'ADOPTED' });
          await waitForCrashChildMessage(
            successor,
            (message) =>
              message.kind === 'authority-renewed' &&
              sameAuthority(message.authority, successorAuthority),
            'successor renewal',
            WAIT_TIMEOUT_MS,
          );

          await proveStalePredecessor(fixture, handoff.predecessorAuthority);
          await sendCommand(successor, 'continue-after-stale-proof');
          const settled = await waitForCrashChildMessage(
            successor,
            (message) => message.kind === 'resident-settled',
            'successor settlement',
            WAIT_TIMEOUT_MS,
          );
          expect(settled.result.dispatchCalls).toBe(0);
          if (fixture.scenario === 'authored-running') {
            expect(settled.result).toMatchObject({
              recoveryCalls: 1,
              worker: { processed: 0 },
            });
          } else {
            expect(settled.result).toMatchObject({
              recoveryCalls: 0,
              worker: { processed: 0 },
            });
            expect(settled.result.replay).toEqual({
              disposition: 'completed',
              reused: true,
              run: crashBoundary.detail.run,
              invocation: crashBoundary.detail.invocation,
              attempt: crashBoundary.detail.attempt,
              terminalSummary: crashBoundary.detail.attempt.terminal,
              evidenceRef: crashBoundary.detail.attempt.evidenceRef,
            });
          }
          const released = await waitForCrashChildMessage(
            successor,
            (message) => message.kind === 'authority-released',
            'successor release',
            WAIT_TIMEOUT_MS,
          );
          expect(released.authority).toMatchObject({
            status: CoordinatorAuthorityStatus.RELEASED,
          });
          await expect(
            waitForCrashChildExit(successor, 15_000),
          ).resolves.toEqual({
            code: 0,
            signal: null,
          });
          expect(
            predecessor.messages.filter(
              (message) =>
                message.kind === 'barrier-phase' &&
                message.phase === 'reopened',
            ),
          ).toEqual([]);
          expect(
            successor.messages.filter(
              (message) =>
                message.kind === 'barrier-phase' &&
                message.phase === 'reopened',
            ),
          ).toEqual([reopenedCheckpoint]);

          const durableState = await reopenDurableState(
            fixture,
            successorAuthority,
            handoff.storeId,
          );
          expect(durableState.authority).toEqual(released.authority);
          expect(durableState.barrier).toEqual(reopenedCheckpoint.barrier);
          expect(durableState.view.attempts).toHaveLength(1);
          expect(
            durableState.view.events.filter(
              (/** @type {Record<string, any>} */ event) =>
                event.type === 'attempt-started',
            ),
          ).toHaveLength(1);
          expect(markerEntries(fixture)).toEqual([fixture.marker]);
          if (fixture.scenario === 'authored-running') {
            expect(durableState.view).toMatchObject({
              run: { status: RunStatus.BLOCKED },
              invocations: [
                expect.objectContaining({
                  status: InvocationStatus.UNCERTAIN,
                  generation: 1,
                }),
              ],
              attempts: [
                expect.objectContaining({
                  status: AttemptStatus.ABANDONED,
                  generation: 1,
                }),
              ],
            });
            expect(
              durableState.view.events.filter(
                (/** @type {Record<string, any>} */ event) =>
                  event.type === 'attempt-terminal',
              ),
            ).toEqual([]);
            expect(durableState.output).toMatchObject({
              snapshot: { status: RunStatus.BLOCKED },
            });
          } else {
            expect(durableState.view).toMatchObject({
              run: { status: RunStatus.COMPLETED },
              invocations: [
                expect.objectContaining({
                  status: InvocationStatus.COMPLETED,
                  generation: 1,
                }),
              ],
              attempts: [
                expect.objectContaining({
                  status: AttemptStatus.COMPLETED,
                  generation: 1,
                }),
              ],
            });
            expect(
              durableState.view.events.filter(
                (/** @type {Record<string, any>} */ event) =>
                  event.type === 'attempt-terminal',
              ),
            ).toHaveLength(1);
            expect(durableState.output).toMatchObject({
              snapshot: { status: RunStatus.COMPLETED },
              terminal: {
                type: 'completed',
                result: fixture.input.proof
                  ? { token: fixture.input.token, proof: fixture.input.proof }
                  : undefined,
              },
            });
          }
        } finally {
          await cleanupFixture(fixture, handles);
        }
      },
      120_000,
    );
  }
});
