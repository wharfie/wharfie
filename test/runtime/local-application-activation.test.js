/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';

import {
  LOCAL_APPLICATION_ACTIVATION_SORT_KEY,
  LocalApplicationActivationAction,
  LocalApplicationActivationDestination,
  LocalApplicationActivationOutcome,
  LocalApplicationActivationPhase,
  LocalApplicationActivationConflictError,
  LocalApplicationActivationRecordError,
  LocalApplicationAdmissionClosedError,
  createLocalApplicationActivation,
  createLocalApplicationActivationTransitionId,
  getLocalApplicationActivationPartitionKey,
  getLocalApplicationRunCreationFence,
  getLocalApplicationServiceStartFence,
} from '../../src/core/lib/db/tables/local-application-activation.js';
import { getAdapterMatrix } from '../helpers/db-adapters.js';

/** @typedef {import('../../src/core/lib/db/base.js').DBClient} DBClient */
/** @typedef {import('../../src/core/lib/db/base.js').TransactionConditionCheck} TransactionConditionCheck */
/** @typedef {Readonly<{artifactId: string, revisionId: string}>} Release */

const TABLE_NAME = 'local-application-activation-test';
const APP_ID = 'local-activation-app';
const OTHER_APP_ID = 'other-local-activation-app';
const RELEASE_A = Object.freeze({
  artifactId: `waf1_${'A'.repeat(43)}`,
  revisionId: `wrv1_${'A'.repeat(43)}`,
});
const RELEASE_B = Object.freeze({
  artifactId: `waf1_${'B'.repeat(42)}A`,
  revisionId: `wrv1_${'B'.repeat(42)}A`,
});
const RELEASE_C = Object.freeze({
  artifactId: `waf1_${'C'.repeat(42)}A`,
  revisionId: `wrv1_${'C'.repeat(42)}A`,
});

function activationKey(appId = APP_ID) {
  return {
    tableName: TABLE_NAME,
    keyName: 'run_id',
    keyValue: getLocalApplicationActivationPartitionKey(appId),
    sortKeyName: 'sort_key',
    sortKeyValue: LOCAL_APPLICATION_ACTIVATION_SORT_KEY,
    consistentRead: true,
  };
}

/** @param {string} sortKey */
function probeKey(sortKey) {
  return {
    tableName: TABLE_NAME,
    keyName: 'run_id',
    keyValue: 'local-activation-admission-probe',
    sortKeyName: 'sort_key',
    sortKeyValue: sortKey,
  };
}

/** @param {DBClient} db @param {Readonly<TransactionConditionCheck>} fence @param {string} sortKey */
async function writeAdmissionProbe(db, fence, sortKey) {
  await db.transactionWrite({
    tableName: TABLE_NAME,
    conditionChecks: [fence],
    putRequests: [
      {
        keyName: 'run_id',
        sortKeyName: 'sort_key',
        record: {
          run_id: 'local-activation-admission-probe',
          sort_key: sortKey,
          record_kind: 'admission-probe',
        },
      },
    ],
  });
}

/** @param {ReturnType<typeof createLocalApplicationActivation>} activation @param {string} appId @param {Release} release @param {number} [observedAt] */
async function installAndActivate(
  activation,
  appId,
  release,
  observedAt = 100,
) {
  let result = await activation.beginInstall({
    appId,
    target: release,
    observedAt,
  });
  const transitionId = result.activation.transition.transitionId;
  result = await activation.markQuiescent({
    appId,
    transitionId,
    observedAt: observedAt + 1,
  });
  result = await activation.markSelected({
    appId,
    transitionId,
    destination: LocalApplicationActivationDestination.TARGET,
    observedAt: observedAt + 2,
  });
  result = await activation.markActivating({
    appId,
    transitionId,
    observedAt: observedAt + 3,
  });
  return await activation.completeActivation({
    appId,
    transitionId,
    observedAt: observedAt + 4,
  });
}

describe('local application activation identities', () => {
  test('derives deterministic application and transition identities', () => {
    const partition = getLocalApplicationActivationPartitionKey(APP_ID);
    expect(partition).toMatch(/^wlap_[A-Za-z0-9_-]{43}$/);
    expect(getLocalApplicationActivationPartitionKey(APP_ID)).toBe(partition);
    expect(getLocalApplicationActivationPartitionKey(OTHER_APP_ID)).not.toBe(
      partition,
    );

    const transition = createLocalApplicationActivationTransitionId({
      appId: APP_ID,
      action: LocalApplicationActivationAction.UPDATE,
      source: RELEASE_A,
      target: RELEASE_B,
      sourceRecordVersion: 9,
      sourceSelectionGeneration: 3,
    });
    expect(transition).toMatch(/^wlat_[A-Za-z0-9_-]{43}$/);
    expect(
      createLocalApplicationActivationTransitionId({
        appId: APP_ID,
        action: LocalApplicationActivationAction.UPDATE,
        source: RELEASE_A,
        target: RELEASE_B,
        sourceRecordVersion: 9,
        sourceSelectionGeneration: 3,
      }),
    ).toBe(transition);
    expect(
      createLocalApplicationActivationTransitionId({
        appId: APP_ID,
        action: LocalApplicationActivationAction.UPDATE,
        source: RELEASE_A,
        target: RELEASE_B,
        sourceRecordVersion: 9,
        sourceSelectionGeneration: 4,
      }),
    ).not.toBe(transition);
  });
});

for (const adapter of getAdapterMatrix()) {
  describe(`${adapter.name} local application activation`, () => {
    test('runs install, update, rollback, and source restoration durably', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const activation = createLocalApplicationActivation({
          db,
          tableName: TABLE_NAME,
          now: () => 100,
        });

        const absentRunFence = await getLocalApplicationRunCreationFence({
          db,
          tableName: TABLE_NAME,
          appId: APP_ID,
          revisionId: RELEASE_A.revisionId,
        });
        const absentServiceFence = await getLocalApplicationServiceStartFence({
          db,
          tableName: TABLE_NAME,
          appId: APP_ID,
          revisionId: RELEASE_A.revisionId,
        });
        expect(absentRunFence.conditions).toEqual([
          {
            conditionType: 'NOT_EXISTS',
            propertyName: 'sort_key',
          },
        ]);
        expect(absentServiceFence).toEqual(absentRunFence);
        expect(Object.isFrozen(absentRunFence)).toBe(true);
        expect(Object.isFrozen(absentRunFence.conditions)).toBe(true);
        expect(Object.isFrozen(absentRunFence.conditions[0])).toBe(true);

        let result = await activation.beginInstall({
          appId: APP_ID,
          target: RELEASE_A,
          observedAt: 100,
        });
        const installId = result.activation.transition.transitionId;
        expect(result).toMatchObject({
          applied: true,
          activation: {
            phase: LocalApplicationActivationPhase.QUIESCING,
            recordVersion: 1,
            selectionGeneration: 0,
            selected: null,
            desired: RELEASE_A,
          },
        });
        expect(Object.isFrozen(result.activation)).toBe(true);
        expect(Object.isFrozen(result.activation.desired)).toBe(true);
        await expect(
          activation.beginInstall({ appId: APP_ID, target: RELEASE_A }),
        ).resolves.toMatchObject({ applied: false });
        await expect(
          getLocalApplicationRunCreationFence({
            db,
            tableName: TABLE_NAME,
            appId: APP_ID,
            revisionId: RELEASE_A.revisionId,
          }),
        ).rejects.toBeInstanceOf(LocalApplicationAdmissionClosedError);
        await expect(
          getLocalApplicationServiceStartFence({
            db,
            tableName: TABLE_NAME,
            appId: APP_ID,
            artifactId: RELEASE_A.artifactId,
            revisionId: RELEASE_A.revisionId,
          }),
        ).rejects.toBeInstanceOf(LocalApplicationAdmissionClosedError);

        result = await activation.markQuiescent({
          appId: APP_ID,
          transitionId: installId,
          observedAt: 101,
        });
        expect(result.activation).toMatchObject({
          phase: LocalApplicationActivationPhase.QUIESCENT,
          recordVersion: 2,
          selectionGeneration: 0,
        });
        await expect(
          activation.markQuiescent({ appId: APP_ID, transitionId: installId }),
        ).resolves.toMatchObject({ applied: false });

        result = await activation.markSelected({
          appId: APP_ID,
          transitionId: installId,
          destination: LocalApplicationActivationDestination.TARGET,
          observedAt: 102,
        });
        expect(result.activation).toMatchObject({
          phase: LocalApplicationActivationPhase.SELECTED,
          recordVersion: 3,
          selectionGeneration: 1,
          selected: RELEASE_A,
        });
        await expect(
          activation.markSelected({
            appId: APP_ID,
            transitionId: installId,
            destination: LocalApplicationActivationDestination.TARGET,
          }),
        ).resolves.toMatchObject({ applied: false });

        result = await activation.markActivating({
          appId: APP_ID,
          transitionId: installId,
          observedAt: 103,
        });
        expect(result.activation).toMatchObject({
          phase: LocalApplicationActivationPhase.ACTIVATING,
          recordVersion: 4,
        });
        await expect(
          getLocalApplicationServiceStartFence({
            db,
            tableName: TABLE_NAME,
            appId: APP_ID,
            artifactId: RELEASE_A.artifactId,
            revisionId: RELEASE_A.revisionId,
          }),
        ).resolves.toMatchObject({
          conditions: expect.arrayContaining([
            expect.objectContaining({
              propertyName: 'phase',
              propertyValue: LocalApplicationActivationPhase.ACTIVATING,
            }),
          ]),
        });
        await expect(
          getLocalApplicationRunCreationFence({
            db,
            tableName: TABLE_NAME,
            appId: APP_ID,
            revisionId: RELEASE_A.revisionId,
          }),
        ).rejects.toBeInstanceOf(LocalApplicationAdmissionClosedError);

        result = await activation.completeActivation({
          appId: APP_ID,
          transitionId: installId,
          observedAt: 104,
        });
        expect(result.activation).toMatchObject({
          phase: LocalApplicationActivationPhase.ACTIVE,
          recordVersion: 5,
          selectionGeneration: 1,
          selected: RELEASE_A,
          desired: RELEASE_A,
          rollbackCandidate: null,
          transition: null,
          lastTransition: {
            transitionId: installId,
            outcome: LocalApplicationActivationOutcome.TARGET_ACTIVE,
          },
        });
        await expect(
          activation.completeActivation({
            appId: APP_ID,
            transitionId: installId,
          }),
        ).resolves.toMatchObject({ applied: false });
        await expect(
          getLocalApplicationRunCreationFence({
            db,
            tableName: TABLE_NAME,
            appId: APP_ID,
            revisionId: RELEASE_A.revisionId,
          }),
        ).resolves.toBeDefined();
        await expect(
          getLocalApplicationServiceStartFence({
            db,
            tableName: TABLE_NAME,
            appId: APP_ID,
            artifactId: RELEASE_A.artifactId,
            revisionId: RELEASE_A.revisionId,
          }),
        ).resolves.toBeDefined();
        await expect(
          getLocalApplicationServiceStartFence({
            db,
            tableName: TABLE_NAME,
            appId: APP_ID,
            revisionId: RELEASE_A.revisionId,
          }),
        ).rejects.toBeInstanceOf(LocalApplicationAdmissionClosedError);

        result = await activation.beginChange({
          appId: APP_ID,
          action: LocalApplicationActivationAction.UPDATE,
          source: RELEASE_A,
          target: RELEASE_B,
          observedAt: 105,
        });
        const updateId = result.activation.transition.transitionId;
        expect(result.activation).toMatchObject({
          phase: LocalApplicationActivationPhase.QUIESCING,
          recordVersion: 6,
          selected: RELEASE_A,
          desired: RELEASE_B,
        });
        await expect(
          getLocalApplicationServiceStartFence({
            db,
            tableName: TABLE_NAME,
            appId: APP_ID,
            artifactId: RELEASE_A.artifactId,
            revisionId: RELEASE_A.revisionId,
          }),
        ).resolves.toBeDefined();
        await expect(
          getLocalApplicationServiceStartFence({
            db,
            tableName: TABLE_NAME,
            appId: APP_ID,
            artifactId: RELEASE_B.artifactId,
            revisionId: RELEASE_B.revisionId,
          }),
        ).rejects.toBeInstanceOf(LocalApplicationAdmissionClosedError);
        await expect(
          activation.beginChange({
            appId: APP_ID,
            action: LocalApplicationActivationAction.UPDATE,
            source: RELEASE_A,
            target: RELEASE_B,
          }),
        ).resolves.toMatchObject({ applied: false });
        result = await activation.markQuiescent({
          appId: APP_ID,
          transitionId: updateId,
          observedAt: 106,
        });
        result = await activation.markSelected({
          appId: APP_ID,
          transitionId: updateId,
          destination: LocalApplicationActivationDestination.TARGET,
          observedAt: 107,
        });
        expect(result.activation).toMatchObject({
          phase: LocalApplicationActivationPhase.SELECTED,
          recordVersion: 8,
          selectionGeneration: 2,
          selected: RELEASE_B,
        });
        await expect(
          getLocalApplicationServiceStartFence({
            db,
            tableName: TABLE_NAME,
            appId: APP_ID,
            artifactId: RELEASE_B.artifactId,
            revisionId: RELEASE_B.revisionId,
          }),
        ).rejects.toBeInstanceOf(LocalApplicationAdmissionClosedError);
        result = await activation.markActivating({
          appId: APP_ID,
          transitionId: updateId,
          observedAt: 108,
        });
        await expect(
          getLocalApplicationServiceStartFence({
            db,
            tableName: TABLE_NAME,
            appId: APP_ID,
            artifactId: RELEASE_B.artifactId,
            revisionId: RELEASE_B.revisionId,
          }),
        ).resolves.toBeDefined();
        await expect(
          getLocalApplicationServiceStartFence({
            db,
            tableName: TABLE_NAME,
            appId: APP_ID,
            artifactId: RELEASE_A.artifactId,
            revisionId: RELEASE_A.revisionId,
          }),
        ).rejects.toBeInstanceOf(LocalApplicationAdmissionClosedError);
        result = await activation.completeActivation({
          appId: APP_ID,
          transitionId: updateId,
          observedAt: 109,
        });
        expect(result.activation).toMatchObject({
          phase: LocalApplicationActivationPhase.ACTIVE,
          recordVersion: 10,
          selectionGeneration: 2,
          selected: RELEASE_B,
          rollbackCandidate: RELEASE_A,
        });

        result = await activation.beginChange({
          appId: APP_ID,
          action: LocalApplicationActivationAction.ROLLBACK,
          source: RELEASE_B,
          target: RELEASE_A,
          observedAt: 110,
        });
        const rollbackId = result.activation.transition.transitionId;
        result = await activation.markQuiescent({
          appId: APP_ID,
          transitionId: rollbackId,
          observedAt: 111,
        });
        result = await activation.markSelected({
          appId: APP_ID,
          transitionId: rollbackId,
          destination: LocalApplicationActivationDestination.TARGET,
          observedAt: 112,
        });
        result = await activation.markActivating({
          appId: APP_ID,
          transitionId: rollbackId,
          observedAt: 113,
        });
        result = await activation.completeActivation({
          appId: APP_ID,
          transitionId: rollbackId,
          observedAt: 114,
        });
        expect(result.activation).toMatchObject({
          phase: LocalApplicationActivationPhase.ACTIVE,
          recordVersion: 15,
          selectionGeneration: 3,
          selected: RELEASE_A,
          rollbackCandidate: RELEASE_B,
        });

        result = await activation.beginChange({
          appId: APP_ID,
          action: LocalApplicationActivationAction.UPDATE,
          source: RELEASE_A,
          target: RELEASE_C,
          observedAt: 115,
        });
        const failedUpdateId = result.activation.transition.transitionId;
        result = await activation.markQuiescent({
          appId: APP_ID,
          transitionId: failedUpdateId,
          observedAt: 116,
        });
        result = await activation.markSelected({
          appId: APP_ID,
          transitionId: failedUpdateId,
          destination: LocalApplicationActivationDestination.TARGET,
          observedAt: 117,
        });
        result = await activation.markActivating({
          appId: APP_ID,
          transitionId: failedUpdateId,
          observedAt: 118,
        });
        result = await activation.beginSourceRestore({
          appId: APP_ID,
          transitionId: failedUpdateId,
          observedAt: 119,
        });
        expect(result.activation).toMatchObject({
          phase: LocalApplicationActivationPhase.QUIESCING,
          recordVersion: 20,
          selected: RELEASE_C,
          desired: RELEASE_A,
          rollbackCandidate: RELEASE_B,
        });
        await expect(
          activation.beginSourceRestore({
            appId: APP_ID,
            transitionId: failedUpdateId,
          }),
        ).resolves.toMatchObject({ applied: false });
        result = await activation.markQuiescent({
          appId: APP_ID,
          transitionId: failedUpdateId,
          observedAt: 120,
        });
        result = await activation.markSelected({
          appId: APP_ID,
          transitionId: failedUpdateId,
          destination: LocalApplicationActivationDestination.SOURCE,
          observedAt: 121,
        });
        expect(result.activation).toMatchObject({
          recordVersion: 22,
          selectionGeneration: 5,
          selected: RELEASE_A,
        });
        result = await activation.markActivating({
          appId: APP_ID,
          transitionId: failedUpdateId,
          observedAt: 122,
        });
        result = await activation.completeActivation({
          appId: APP_ID,
          transitionId: failedUpdateId,
          observedAt: 123,
        });
        expect(result.activation).toMatchObject({
          phase: LocalApplicationActivationPhase.ACTIVE,
          recordVersion: 24,
          selectionGeneration: 5,
          selected: RELEASE_A,
          desired: RELEASE_A,
          rollbackCandidate: RELEASE_B,
          lastTransition: {
            transitionId: failedUpdateId,
            outcome: LocalApplicationActivationOutcome.SOURCE_RESTORED,
          },
          updatedAt: 123,
        });

        result = await activation.beginChange({
          appId: APP_ID,
          action: LocalApplicationActivationAction.UPDATE,
          source: RELEASE_A,
          target: RELEASE_C,
          observedAt: 1,
        });
        expect(result.activation.updatedAt).toBe(123);
        const refusedTransitionId = result.activation.transition.transitionId;
        result = await activation.abortChange({
          appId: APP_ID,
          transitionId: refusedTransitionId,
          observedAt: 0,
        });
        expect(result.activation).toMatchObject({
          phase: LocalApplicationActivationPhase.ACTIVE,
          recordVersion: 26,
          selectionGeneration: 5,
          selected: RELEASE_A,
          desired: RELEASE_A,
          rollbackCandidate: RELEASE_B,
          transition: null,
          lastTransition: {
            transitionId: refusedTransitionId,
            outcome: LocalApplicationActivationOutcome.SOURCE_RETAINED,
          },
          updatedAt: 123,
        });
        await expect(
          activation.abortChange({
            appId: APP_ID,
            transitionId: refusedTransitionId,
          }),
        ).resolves.toMatchObject({ applied: false });
      } finally {
        await cleanup();
      }
    });

    test('recovers failed installs and cannot reuse stale transition commands', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const activation = createLocalApplicationActivation({
          db,
          tableName: TABLE_NAME,
          now: () => 200,
        });
        let result = await activation.beginInstall({
          appId: APP_ID,
          target: RELEASE_A,
        });
        const failedInstallId = result.activation.transition.transitionId;
        result = await activation.markQuiescent({
          appId: APP_ID,
          transitionId: failedInstallId,
        });
        result = await activation.markSelected({
          appId: APP_ID,
          transitionId: failedInstallId,
          destination: LocalApplicationActivationDestination.TARGET,
        });
        result = await activation.markActivating({
          appId: APP_ID,
          transitionId: failedInstallId,
        });
        const failedInstallVersion = result.activation.recordVersion;

        await expect(
          activation.beginInstall({ appId: APP_ID, target: RELEASE_B }),
        ).rejects.toBeInstanceOf(LocalApplicationActivationConflictError);
        result = await activation.replaceInstall({
          appId: APP_ID,
          transitionId: failedInstallId,
          recordVersion: failedInstallVersion,
          target: RELEASE_B,
        });
        const replacementId = result.activation.transition.transitionId;
        expect(replacementId).not.toBe(failedInstallId);
        expect(result.activation).toMatchObject({
          phase: LocalApplicationActivationPhase.QUIESCING,
          selected: RELEASE_A,
          desired: RELEASE_B,
          rollbackCandidate: null,
        });
        await expect(
          activation.replaceInstall({
            appId: APP_ID,
            transitionId: failedInstallId,
            recordVersion: failedInstallVersion,
            target: RELEASE_B,
          }),
        ).resolves.toMatchObject({ applied: false });
        await expect(
          activation.replaceInstall({
            appId: APP_ID,
            transitionId: failedInstallId,
            recordVersion: failedInstallVersion,
            target: RELEASE_C,
          }),
        ).rejects.toBeInstanceOf(LocalApplicationActivationConflictError);
        await expect(
          activation.markQuiescent({
            appId: APP_ID,
            transitionId: failedInstallId,
          }),
        ).rejects.toBeInstanceOf(LocalApplicationActivationConflictError);

        result = await activation.markQuiescent({
          appId: APP_ID,
          transitionId: replacementId,
        });
        result = await activation.markSelected({
          appId: APP_ID,
          transitionId: replacementId,
          destination: LocalApplicationActivationDestination.TARGET,
        });
        result = await activation.markActivating({
          appId: APP_ID,
          transitionId: replacementId,
        });
        result = await activation.completeActivation({
          appId: APP_ID,
          transitionId: replacementId,
        });
        expect(result.activation).toMatchObject({
          phase: LocalApplicationActivationPhase.ACTIVE,
          selected: RELEASE_B,
          rollbackCandidate: null,
        });

        result = await activation.beginChange({
          appId: APP_ID,
          action: LocalApplicationActivationAction.UPDATE,
          source: RELEASE_B,
          target: RELEASE_C,
        });
        const abandonedChangeId = result.activation.transition.transitionId;
        await expect(
          activation.beginSourceRestore({
            appId: APP_ID,
            transitionId: abandonedChangeId,
          }),
        ).rejects.toBeInstanceOf(LocalApplicationActivationConflictError);
        result = await activation.markQuiescent({
          appId: APP_ID,
          transitionId: abandonedChangeId,
        });
        await expect(
          activation.beginSourceRestore({
            appId: APP_ID,
            transitionId: abandonedChangeId,
          }),
        ).rejects.toBeInstanceOf(LocalApplicationActivationConflictError);
        result = await activation.markSelected({
          appId: APP_ID,
          transitionId: abandonedChangeId,
          destination: LocalApplicationActivationDestination.TARGET,
        });
        await expect(
          activation.beginSourceRestore({
            appId: APP_ID,
            transitionId: abandonedChangeId,
          }),
        ).rejects.toBeInstanceOf(LocalApplicationActivationConflictError);
        result = await activation.markActivating({
          appId: APP_ID,
          transitionId: abandonedChangeId,
        });
        result = await activation.beginSourceRestore({
          appId: APP_ID,
          transitionId: abandonedChangeId,
        });
        result = await activation.markQuiescent({
          appId: APP_ID,
          transitionId: abandonedChangeId,
        });
        await expect(
          activation.beginSourceRestore({
            appId: APP_ID,
            transitionId: abandonedChangeId,
          }),
        ).resolves.toMatchObject({
          applied: false,
          activation: { phase: LocalApplicationActivationPhase.QUIESCENT },
        });
        await expect(
          activation.beginChange({
            appId: APP_ID,
            action: LocalApplicationActivationAction.UPDATE,
            source: RELEASE_B,
            target: RELEASE_C,
          }),
        ).rejects.toBeInstanceOf(LocalApplicationActivationConflictError);
        result = await activation.markSelected({
          appId: APP_ID,
          transitionId: abandonedChangeId,
          destination: LocalApplicationActivationDestination.SOURCE,
        });
        result = await activation.markActivating({
          appId: APP_ID,
          transitionId: abandonedChangeId,
        });
        await expect(
          activation.beginSourceRestore({
            appId: APP_ID,
            transitionId: abandonedChangeId,
          }),
        ).resolves.toMatchObject({
          applied: false,
          activation: { phase: LocalApplicationActivationPhase.ACTIVATING },
        });
        result = await activation.completeActivation({
          appId: APP_ID,
          transitionId: abandonedChangeId,
        });
        expect(result.activation).toMatchObject({
          phase: LocalApplicationActivationPhase.ACTIVE,
          selected: RELEASE_B,
          lastTransition: {
            outcome: LocalApplicationActivationOutcome.SOURCE_RESTORED,
          },
        });

        result = await activation.beginChange({
          appId: APP_ID,
          action: LocalApplicationActivationAction.UPDATE,
          source: RELEASE_B,
          target: RELEASE_C,
        });
        expect(result.activation.transition.transitionId).not.toBe(
          abandonedChangeId,
        );
        const newChangeId = result.activation.transition.transitionId;
        await activation.markQuiescent({
          appId: APP_ID,
          transitionId: newChangeId,
        });
        await expect(
          activation.abortChange({
            appId: APP_ID,
            transitionId: newChangeId,
          }),
        ).rejects.toBeInstanceOf(LocalApplicationActivationConflictError);
      } finally {
        await cleanup();
      }
    });

    test('fails stale admission fences atomically', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const activation = createLocalApplicationActivation({
          db,
          tableName: TABLE_NAME,
        });
        const absentFence = await getLocalApplicationRunCreationFence({
          db,
          tableName: TABLE_NAME,
          appId: APP_ID,
          revisionId: RELEASE_A.revisionId,
        });
        await activation.beginInstall({ appId: APP_ID, target: RELEASE_A });
        await expect(
          writeAdmissionProbe(db, absentFence, 'absent-fence'),
        ).rejects.toMatchObject({
          name: 'ConditionalCheckFailedException',
        });
        await expect(db.get(probeKey('absent-fence'))).resolves.toBeUndefined();

        const begun = await activation.get({ appId: APP_ID });
        const installId = begun.transition.transitionId;
        await activation.markQuiescent({
          appId: APP_ID,
          transitionId: installId,
        });
        await activation.markSelected({
          appId: APP_ID,
          transitionId: installId,
          destination: LocalApplicationActivationDestination.TARGET,
        });
        await activation.markActivating({
          appId: APP_ID,
          transitionId: installId,
        });
        await activation.completeActivation({
          appId: APP_ID,
          transitionId: installId,
        });

        const activeFence = await getLocalApplicationRunCreationFence({
          db,
          tableName: TABLE_NAME,
          appId: APP_ID,
          revisionId: RELEASE_A.revisionId,
        });
        await activation.beginChange({
          appId: APP_ID,
          action: LocalApplicationActivationAction.UPDATE,
          source: RELEASE_A,
          target: RELEASE_B,
        });
        await expect(
          writeAdmissionProbe(db, activeFence, 'active-fence'),
        ).rejects.toMatchObject({
          name: 'ConditionalCheckFailedException',
        });
        await expect(db.get(probeKey('active-fence'))).resolves.toBeUndefined();
      } finally {
        await cleanup();
      }
    });

    test('maps stale state writes to a typed conflict', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const activation = createLocalApplicationActivation({
          db,
          tableName: TABLE_NAME,
        });
        const begun = await activation.beginInstall({
          appId: APP_ID,
          target: RELEASE_A,
        });
        const transitionId = begun.activation.transition.transitionId;
        let injectWinner = true;
        const racingDb = /** @type {DBClient} */ (
          /** @type {any} */ ({
            get: db.get.bind(db),
            /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params */
            async transactionWrite(params) {
              if (injectWinner) {
                injectWinner = false;
                await activation.markQuiescent({ appId: APP_ID, transitionId });
              }
              return await db.transactionWrite(params);
            },
          })
        );
        const racingActivation = createLocalApplicationActivation({
          db: racingDb,
          tableName: TABLE_NAME,
        });
        await expect(
          racingActivation.markQuiescent({ appId: APP_ID, transitionId }),
        ).rejects.toBeInstanceOf(LocalApplicationActivationConflictError);
        await expect(activation.get({ appId: APP_ID })).resolves.toMatchObject({
          phase: LocalApplicationActivationPhase.QUIESCENT,
          recordVersion: 2,
        });
      } finally {
        await cleanup();
      }
    });

    test('fails closed on corrupted durable state', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const activation = createLocalApplicationActivation({
          db,
          tableName: TABLE_NAME,
        });
        await installAndActivate(activation, APP_ID, RELEASE_A);
        const raw = await db.get(activationKey());
        if (!raw) throw new Error('Expected a durable activation row.');
        await db.transactionWrite({
          tableName: TABLE_NAME,
          putRequests: [
            {
              keyName: 'run_id',
              sortKeyName: 'sort_key',
              record: { ...raw, phase: 'CORRUPTED' },
            },
          ],
        });
        await expect(activation.get({ appId: APP_ID })).rejects.toBeInstanceOf(
          LocalApplicationActivationRecordError,
        );
        await expect(
          getLocalApplicationRunCreationFence({
            db,
            tableName: TABLE_NAME,
            appId: APP_ID,
            revisionId: RELEASE_A.revisionId,
          }),
        ).rejects.toBeInstanceOf(LocalApplicationActivationRecordError);

        await db.transactionWrite({
          tableName: TABLE_NAME,
          putRequests: [
            {
              keyName: 'run_id',
              sortKeyName: 'sort_key',
              record: {
                ...raw,
                last_transition_id: null,
                last_transition_outcome: null,
              },
            },
          ],
        });
        await expect(activation.get({ appId: APP_ID })).rejects.toBeInstanceOf(
          LocalApplicationActivationRecordError,
        );

        await db.transactionWrite({
          tableName: TABLE_NAME,
          putRequests: [
            {
              keyName: 'run_id',
              sortKeyName: 'sort_key',
              record: {
                ...raw,
                rollback_artifact_id: RELEASE_A.artifactId,
                rollback_revision_id: RELEASE_A.revisionId,
              },
            },
          ],
        });
        await expect(activation.get({ appId: APP_ID })).rejects.toBeInstanceOf(
          LocalApplicationActivationRecordError,
        );

        await db.transactionWrite({
          tableName: TABLE_NAME,
          putRequests: [
            {
              keyName: 'run_id',
              sortKeyName: 'sort_key',
              record: raw,
            },
          ],
        });
        let result = await activation.beginChange({
          appId: APP_ID,
          action: LocalApplicationActivationAction.UPDATE,
          source: RELEASE_A,
          target: RELEASE_B,
        });
        const transitionId = result.activation.transition.transitionId;
        const changingRaw = await db.get(activationKey());
        if (!changingRaw)
          throw new Error('Expected an updating activation row.');
        await db.transactionWrite({
          tableName: TABLE_NAME,
          putRequests: [
            {
              keyName: 'run_id',
              sortKeyName: 'sort_key',
              record: {
                ...changingRaw,
                selection_generation: changingRaw.selection_generation + 3,
              },
            },
          ],
        });
        await expect(activation.get({ appId: APP_ID })).rejects.toBeInstanceOf(
          LocalApplicationActivationRecordError,
        );

        await db.transactionWrite({
          tableName: TABLE_NAME,
          putRequests: [
            {
              keyName: 'run_id',
              sortKeyName: 'sort_key',
              record: changingRaw,
            },
          ],
        });
        result = await activation.markQuiescent({
          appId: APP_ID,
          transitionId,
        });
        result = await activation.markSelected({
          appId: APP_ID,
          transitionId,
          destination: LocalApplicationActivationDestination.TARGET,
        });
        const selectedRaw = await db.get(activationKey());
        if (!selectedRaw)
          throw new Error('Expected a selected activation row.');
        await db.transactionWrite({
          tableName: TABLE_NAME,
          putRequests: [
            {
              keyName: 'run_id',
              sortKeyName: 'sort_key',
              record: {
                ...selectedRaw,
                phase: LocalApplicationActivationPhase.QUIESCENT,
              },
            },
          ],
        });
        await expect(activation.get({ appId: APP_ID })).rejects.toBeInstanceOf(
          LocalApplicationActivationRecordError,
        );
      } finally {
        await cleanup();
      }
    });
  });
}
