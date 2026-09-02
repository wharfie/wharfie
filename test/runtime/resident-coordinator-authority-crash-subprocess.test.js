/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { APPLICATION_STATE_TABLE_NAME } from '../../src/core/lib/config/db.js';
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
import { createExecutionLedger } from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { createResidentReplacementInputReceipt } from '../../src/core/runtime/resident-replacement-input.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  createTestApplicationStateHistory,
  createTestApplicationStateTransport,
  createTestClosedBarrier,
  createTestCoordinatorAuthority,
} from '../helpers/application-state-snapshot.js';
import {
  cleanupCrashChild,
  killCrashChild,
  spawnCrashChild,
  waitForCrashChildExit,
  waitForCrashChildMessage,
} from '../helpers/real-sigkill-subprocess.js';
import { createPersistentDynamoDBAuthorityTestClient } from '../helpers/persistent-dynamodb-authority-test-client.js';

const CHILD_PATH = fileURLToPath(
  new URL(
    '../fixtures/resident-coordinator-authority-crash-child.js',
    import.meta.url,
  ),
);
const APP_ID = 'resident-coordinator-process-crash';
const TABLE_NAME = 'resident-coordinator-process-crash-control';
const REGION = 'us-east-2';
const OBSERVATION_WINDOW_MS = 120;
const RENEWAL_INTERVAL_MS = 75;
const CURRENT_REVISION_ID = createCanonicalJsonSha256Id({
  domain: 'wharfie:test:resident-coordinator-process-crash:revision',
  prefix: 'wrv1',
  value: { revision: 'current' },
});
const TABLE_RESOURCE_ID = createCanonicalJsonSha256Id({
  domain: 'wharfie:test:resident-coordinator-process-crash:table-resource',
  prefix: 'wdtr1',
  value: { table: TABLE_NAME, region: REGION },
});
const APPLICATION_STATE_STORE_ID = createCanonicalJsonSha256Id({
  domain: 'wharfie:test:resident-coordinator-process-crash:state-store',
  prefix: 'was',
  value: { appId: APP_ID },
});
const PAYLOAD_DISTRIBUTION_ID = createCanonicalJsonSha256Id({
  domain: 'wharfie:test:resident-coordinator-process-crash:payloads',
  prefix: 'wepd1',
  value: { appId: APP_ID },
});
const PAYLOAD_STORE_ID = 'resident-coordinator-process-crash-payloads';
const APPLICATION_STATE_DESTINATION = Object.freeze({
  kind: 'application-state',
  version: 2,
  bindingId: 'primary',
  configuration: Object.freeze({
    provider: 'lmdb',
    storeId: APPLICATION_STATE_STORE_ID,
    tableName: APPLICATION_STATE_TABLE_NAME,
    namespace: APP_ID,
  }),
});
const APPLICATION_STATE_HISTORY = createTestApplicationStateHistory({
  appId: APP_ID,
  label: 'empty-reconstructed-history',
});
const testOnUnix = process.platform === 'win32' ? test.skip : test;

/** @typedef {ReturnType<typeof spawnCrashChild>} CrashChild */

/** @param {Record<string, any>} sourceBarrier @param {string} label */
function replacementInput(sourceBarrier, label) {
  const applicationStateTransport = createTestApplicationStateTransport({
    destination: APPLICATION_STATE_DESTINATION,
    label,
    history: APPLICATION_STATE_HISTORY,
    barrier: sourceBarrier,
  });
  return createResidentReplacementInputReceipt({
    appId: APP_ID,
    currentRevisionId: CURRENT_REVISION_ID,
    control: {
      profile: 'dynamodb-rvn-v1',
      adapterName: 'dynamodb',
      region: REGION,
      tableName: TABLE_NAME,
      tableResourceId: TABLE_RESOURCE_ID,
    },
    payloadStorage: {
      kind: 'wharfie.local-content-addressed.v1',
      storeId: PAYLOAD_STORE_ID,
      distribution: {
        kind: 'wharfie.execution-payload-distribution.v1',
        distributionId: PAYLOAD_DISTRIBUTION_ID,
        storeId: PAYLOAD_STORE_ID,
      },
    },
    applicationStateDestination: APPLICATION_STATE_DESTINATION,
    applicationStateTransport,
  });
}

/**
 * @param {string} root
 * @param {'predecessor'|'successor'} mode
 * @param {string} coordinatorId
 * @param {Record<string, any>} receipt
 */
function childOptions(root, mode, coordinatorId, receipt) {
  return {
    mode,
    appId: APP_ID,
    currentRevisionId: CURRENT_REVISION_ID,
    coordinatorId,
    controlPath: join(root, 'control'),
    tableName: TABLE_NAME,
    payloadPath: join(root, `${mode}-payloads`),
    payloadDistributionPath: join(root, 'distributed-payloads'),
    sessionPath: join(root, `${mode}-sessions`),
    region: REGION,
    tableResourceId: TABLE_RESOURCE_ID,
    renewalIntervalMs: RENEWAL_INTERVAL_MS,
    observationWindowMs: OBSERVATION_WINDOW_MS,
    replacementInput: receipt,
  };
}

/** @param {CrashChild} child @param {string} command */
async function sendCommand(child, command) {
  await new Promise((resolve, reject) => {
    child.child.send({ kind: 'command', command }, (error) => {
      if (error) reject(error);
      else resolve(undefined);
    });
  });
}

/** @param {Record<string, any>} left @param {Record<string, any>} right */
function sameStableAuthority(left, right) {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.appId === right.appId &&
    left.coordinatorId === right.coordinatorId &&
    left.authorityId === right.authorityId &&
    left.epoch === right.epoch
  );
}

/** @param {Record<string, any>} authority */
function delayedRunRequest(authority) {
  return Object.freeze({
    runId: 'delayed-predecessor-mutation',
    appId: APP_ID,
    revisionId: CURRENT_REVISION_ID,
    invocationId: 'main',
    activityId: 'crash-proof-activity',
    input: { retainedAuthorityId: authority.authorityId },
    callerMetadata: { source: 'resident-coordinator-crash-proof' },
    transitionId: 'delayed-create-after-process-crash',
    observedAt: 1_000,
  });
}

describe('resident coordinator authority process crash', () => {
  test('persistent provider close fences new work and drains an operation already waiting for its lock', async () => {
    const root = mkdtempSync(
      join(tmpdir(), 'wharfie-persistent-authority-close-'),
    );
    const lockPath = join(root, '.persistent-dynamodb-authority.lock');
    mkdirSync(lockPath, { mode: 0o700 });
    const db = createPersistentDynamoDBAuthorityTestClient({ path: root });
    /** @type {Promise<unknown> | undefined} */
    let operation;
    try {
      operation = db.get({
        tableName: TABLE_NAME,
        keyName: 'app_id',
        keyValue: APP_ID,
      });
      let closeSettled = false;
      const closing = db.close().then(() => {
        closeSettled = true;
      });

      await delay(25);
      expect(closeSettled).toBe(false);
      await expect(
        db.get({
          tableName: TABLE_NAME,
          keyName: 'app_id',
          keyValue: APP_ID,
        }),
      ).rejects.toThrow('Persistent DynamoDB authority test client is closed.');

      rmSync(lockPath, { recursive: true, force: true });
      await expect(operation).resolves.toBeUndefined();
      await expect(closing).resolves.toBeUndefined();
    } finally {
      rmSync(lockPath, { recursive: true, force: true });
      await Promise.allSettled([operation, db.close()]);
      rmSync(root, { recursive: true, force: true });
    }
  });

  testOnUnix(
    'renews, survives SIGKILL, observes an exact RVN, reconstructs under takeover, and releases the successor',
    async () => {
      const root = mkdtempSync(
        join(tmpdir(), 'wharfie-resident-coordinator-crash-'),
      );
      /** @type {CrashChild | undefined} */
      let predecessor;
      /** @type {CrashChild | undefined} */
      let successor;
      /** @type {import('../../src/core/lib/db/base.js').DBClient | undefined} */
      let heldDb;
      let retainFixture = false;
      try {
        const syntheticSourceBarrier = createTestClosedBarrier({
          appId: APP_ID,
          authority: createTestCoordinatorAuthority({
            appId: APP_ID,
            label: 'synthetic-source',
          }),
          label: 'synthetic-source',
          version: 1,
        });
        predecessor = spawnCrashChild({
          childPath: CHILD_PATH,
          cwd: process.cwd(),
          options: childOptions(
            root,
            'predecessor',
            'coordinator-before-crash',
            replacementInput(syntheticSourceBarrier, 'predecessor-startup'),
          ),
        });

        const predecessorAcquisition = await waitForCrashChildMessage(
          predecessor,
          (message) => message.kind === 'authority-acquired',
          'predecessor authority acquisition',
        );
        const predecessorReconstruction = await waitForCrashChildMessage(
          predecessor,
          (message) => message.kind === 'execution-reconstruction',
          'predecessor closed reconstruction boundary',
        );
        const predecessorRenewal = await waitForCrashChildMessage(
          predecessor,
          (message) =>
            message.kind === 'authority-renewed' &&
            message.authority?.coordinatorId === 'coordinator-before-crash',
          'predecessor automatic renewal',
        );

        // The child cannot return from this first renew wrapper. The real
        // protocol mutation has already closed and released its adapter lock,
        // so SIGKILL below cannot strand this or a subsequent DB operation.
        expect(
          existsSync(
            join(root, 'control', '.persistent-dynamodb-authority.lock'),
          ),
        ).toBe(false);

        expect(predecessorReconstruction.barrier).toMatchObject({
          appId: APP_ID,
          state: CoordinatorQuiescenceBarrierState.CLOSED,
          version: 1,
          lastAction: 'close',
          authority: predecessorReconstruction.coordinatorAuthority,
        });
        expect(
          sameStableAuthority(
            predecessorAcquisition.authority,
            predecessorRenewal.authority,
          ),
        ).toBe(true);
        expect(predecessorRenewal.authority.recordVersion).toBeGreaterThan(
          predecessorAcquisition.authority.recordVersion,
        );
        expect(predecessorRenewal.predecessor).toEqual(
          predecessorAcquisition.authority,
        );

        await expect(killCrashChild(predecessor)).resolves.toEqual({
          code: null,
          signal: 'SIGKILL',
        });

        // This independently opened client is intentionally retained across
        // the successor takeover. The delayed mutation below is therefore
        // built from the exact durable predecessor bytes before replacement.
        heldDb = createPersistentDynamoDBAuthorityTestClient({
          path: join(root, 'control'),
        });
        const authorities = createCoordinatorAuthority({
          db: heldDb,
          tableName: TABLE_NAME,
        });
        const barriers = createCoordinatorQuiescenceBarrier({
          db: heldDb,
          tableName: TABLE_NAME,
        });
        const crashedAuthority = await authorities.get({ appId: APP_ID });
        const inheritedBarrier = await barriers.get({ appId: APP_ID });
        if (!crashedAuthority || !inheritedBarrier) {
          throw new Error(
            'SIGKILL did not retain the predecessor authority and CLOSED barrier.',
          );
        }
        expect(crashedAuthority).toMatchObject({
          status: CoordinatorAuthorityStatus.ACTIVE,
          coordinatorId: 'coordinator-before-crash',
          epoch: 1,
        });
        expect(
          sameStableAuthority(crashedAuthority, predecessorRenewal.authority),
        ).toBe(true);
        expect(crashedAuthority.recordVersion).toBeGreaterThanOrEqual(
          predecessorRenewal.authority.recordVersion,
        );
        expect(inheritedBarrier).toEqual(predecessorReconstruction.barrier);

        const delayedPayloads = createLocalExecutionPayloadStore({
          path: join(root, 'delayed-mutation-payloads'),
          storeId: 'resident-coordinator-delayed-mutation-payloads',
        });
        const delayedPredecessorLedger = createExecutionLedger({
          db: heldDb,
          tableName: TABLE_NAME,
          payloadStore: delayedPayloads,
          coordinatorAuthority:
            createCoordinatorAuthorityToken(crashedAuthority),
        });
        const delayedMutation = delayedRunRequest(crashedAuthority);

        successor = spawnCrashChild({
          childPath: CHILD_PATH,
          cwd: process.cwd(),
          options: childOptions(
            root,
            'successor',
            'coordinator-after-crash',
            replacementInput(inheritedBarrier, 'successor-startup'),
          ),
        });

        const acquireConflict = await waitForCrashChildMessage(
          successor,
          (message) => message.kind === 'authority-acquire-conflict',
          'successor acquire conflict',
        );
        const stableObservation = await waitForCrashChildMessage(
          successor,
          (message) => message.kind === 'authority-observation-stable',
          'successor stable RVN observation',
        );
        const takeover = await waitForCrashChildMessage(
          successor,
          (message) => message.kind === 'authority-taken-over',
          'successor exact-CAS takeover',
        );
        const successorReconstruction = await waitForCrashChildMessage(
          successor,
          (message) => message.kind === 'execution-reconstruction',
          'successor reconstruction boundary',
        );

        expect(acquireConflict.intent).toMatchObject({
          appId: APP_ID,
          coordinatorId: 'coordinator-after-crash',
        });
        expect(stableObservation.observation).toMatchObject({
          schemaVersion: 1,
          kind: 'dynamodb-coordinator-authority-rvn-observation',
          tableName: TABLE_NAME,
          appId: APP_ID,
          observationWindowMs: OBSERVATION_WINDOW_MS,
          recordVersion: crashedAuthority.recordVersion,
          authority: crashedAuthority,
        });
        expect(
          BigInt(stableObservation.observation.elapsedNanoseconds),
        ).toBeGreaterThanOrEqual(BigInt(OBSERVATION_WINDOW_MS) * 1_000_000n);
        expect(takeover.observation).toEqual(stableObservation.observation);
        expect(takeover.authority).toMatchObject({
          status: CoordinatorAuthorityStatus.ACTIVE,
          coordinatorId: 'coordinator-after-crash',
          epoch: crashedAuthority.epoch + 1,
          recordVersion: crashedAuthority.recordVersion + 1,
          acquisitionRequestId: takeover.intent.requestId,
          lastRequestId: takeover.intent.requestId,
        });
        expect(takeover.authority.authorityId).not.toBe(
          crashedAuthority.authorityId,
        );
        const successorToken = createCoordinatorAuthorityToken(
          takeover.authority,
        );
        expect(successorReconstruction.coordinatorAuthority).toEqual(
          successorToken,
        );
        expect(successorReconstruction.barrier).toMatchObject({
          appId: APP_ID,
          state: CoordinatorQuiescenceBarrierState.CLOSED,
          version: inheritedBarrier.version + 1,
          lastAction: 'adopt',
          authority: successorToken,
        });
        expect(
          createCoordinatorAuthorityToken(successorReconstruction.authority),
        ).toEqual(successorToken);
        expect(
          successorReconstruction.authority.recordVersion,
        ).toBeGreaterThanOrEqual(takeover.authority.recordVersion);
        await expect(barriers.get({ appId: APP_ID })).resolves.toEqual(
          successorReconstruction.barrier,
        );

        await sendCommand(successor, 'continue-reconstruction');
        const inventory = await waitForCrashChildMessage(
          successor,
          (message) => message.kind === 'application-state-inventory',
          'successor application-state inventory',
        );
        const transport = await waitForCrashChildMessage(
          successor,
          (message) => message.kind === 'application-state-transport',
          'successor application-state transport',
        );
        const statePrepared = await waitForCrashChildMessage(
          successor,
          (message) => message.kind === 'application-state-prepared',
          'successor application-state preparation',
        );
        for (const boundary of [inventory, transport, statePrepared]) {
          expect(boundary.barrier).toEqual(successorReconstruction.barrier);
        }
        expect(statePrepared.readiness).toMatchObject({
          app_id: APP_ID,
          status: 'ADOPTED',
          authority_id: successorToken.authorityId,
          epoch: successorToken.epoch,
        });
        await expect(barriers.get({ appId: APP_ID })).resolves.toEqual(
          successorReconstruction.barrier,
        );

        await sendCommand(successor, 'continue-after-state-preparation');
        const ready = await waitForCrashChildMessage(
          successor,
          (message) => message.kind === 'resident-ready',
          'successor resident readiness',
        );
        expect(ready.coordinatorAuthority).toEqual(successorToken);
        expect(ready.barrier).toMatchObject({
          appId: APP_ID,
          state: CoordinatorQuiescenceBarrierState.OPEN,
          version: successorReconstruction.barrier.version + 1,
          lastAction: 'reopen',
          authority: successorToken,
        });
        await expect(barriers.get({ appId: APP_ID })).resolves.toEqual(
          ready.barrier,
        );

        await expect(
          delayedPredecessorLedger.createManualRun(delayedMutation),
        ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);
        await expect(
          delayedPredecessorLedger.getRun(delayedMutation.runId),
        ).resolves.toBeNull();

        const successorLedger = createExecutionLedger({
          db: heldDb,
          tableName: TABLE_NAME,
          payloadStore: delayedPayloads,
          coordinatorAuthority: successorToken,
        });
        await expect(
          successorLedger.createManualRun(delayedMutation),
        ).resolves.toMatchObject({
          applied: true,
          coordinatorAuthority: successorToken,
          run: { runId: delayedMutation.runId, appId: APP_ID },
        });
        await expect(
          successorLedger.createManualRun(delayedMutation),
        ).resolves.toMatchObject({ applied: false });
        await expect(
          successorLedger.getEvents(delayedMutation.runId),
        ).resolves.toEqual([
          expect.objectContaining({ type: 'manual-run-created' }),
        ]);

        const successorRenewal = await waitForCrashChildMessage(
          successor,
          (message) =>
            message.kind === 'authority-renewed' &&
            message.authority?.coordinatorId === 'coordinator-after-crash',
          'successor automatic renewal',
        );
        expect(
          sameStableAuthority(successorRenewal.authority, takeover.authority),
        ).toBe(true);
        expect(successorRenewal.authority.recordVersion).toBeGreaterThan(
          takeover.authority.recordVersion,
        );

        await sendCommand(successor, 'stop');
        const released = await waitForCrashChildMessage(
          successor,
          (message) =>
            message.kind === 'authority-released' &&
            message.authority?.coordinatorId === 'coordinator-after-crash',
          'successor owned authority release',
        );
        await waitForCrashChildMessage(
          successor,
          (message) => message.kind === 'resident-settled',
          'successor resident settlement',
        );
        await expect(waitForCrashChildExit(successor)).resolves.toEqual({
          code: 0,
          signal: null,
        });
        expect(released.authority).toMatchObject({
          status: CoordinatorAuthorityStatus.RELEASED,
          coordinatorId: 'coordinator-after-crash',
          authorityId: successorToken.authorityId,
          epoch: successorToken.epoch,
          recordVersion: released.predecessor.recordVersion + 1,
        });

        await heldDb.close();
        heldDb = undefined;
        const reopened = createPersistentDynamoDBAuthorityTestClient({
          path: join(root, 'control'),
        });
        try {
          const reopenedAuthorities = createCoordinatorAuthority({
            db: reopened,
            tableName: TABLE_NAME,
          });
          const reopenedBarriers = createCoordinatorQuiescenceBarrier({
            db: reopened,
            tableName: TABLE_NAME,
          });
          await expect(
            reopenedAuthorities.get({ appId: APP_ID }),
          ).resolves.toEqual(released.authority);
          await expect(
            reopenedBarriers.get({ appId: APP_ID }),
          ).resolves.toEqual(ready.barrier);
          const reopenedLedger = createExecutionLedger({
            db: reopened,
            tableName: TABLE_NAME,
            payloadStore: delayedPayloads,
          });
          await expect(
            reopenedLedger.getEvents(delayedMutation.runId),
          ).resolves.toEqual([
            expect.objectContaining({ type: 'manual-run-created' }),
          ]);
        } finally {
          await reopened.close();
        }

        const successorCoreTrace = successor.messages
          .map((message) => message.kind)
          .filter((kind) =>
            new Set([
              'authority-acquire-conflict',
              'authority-observation-stable',
              'authority-taken-over',
              'execution-reconstruction',
              'application-state-inventory',
              'application-state-transport',
              'application-state-prepared',
              'resident-ready',
              'authority-released',
              'resident-settled',
            ]).has(kind),
          );
        expect(successorCoreTrace).toEqual([
          'authority-acquire-conflict',
          'authority-observation-stable',
          'authority-taken-over',
          'execution-reconstruction',
          'application-state-inventory',
          'application-state-transport',
          'application-state-prepared',
          'resident-ready',
          'authority-released',
          'resident-settled',
        ]);
      } catch (error) {
        retainFixture = true;
        throw error;
      } finally {
        /** @type {unknown[]} */
        const cleanupFailures = [];
        for (const child of [successor, predecessor]) {
          if (!child) continue;
          try {
            await cleanupCrashChild(child);
          } catch (error) {
            cleanupFailures.push(error);
          }
        }
        try {
          await heldDb?.close();
        } catch (error) {
          cleanupFailures.push(error);
        }
        if (cleanupFailures.length === 0 && !retainFixture) {
          rmSync(root, { recursive: true, force: true });
        }
        if (cleanupFailures.length > 0) {
          // eslint-disable-next-line no-unsafe-finally -- Unreaped children are a stronger failure and the retained path is required for diagnosis.
          throw new AggregateError(
            cleanupFailures,
            `Resident coordinator crash cleanup failed; retaining ${root}`,
          );
        }
      }
    },
    30_000,
  );
});
