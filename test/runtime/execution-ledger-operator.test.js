/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import createLMDB from '../../src/core/lib/db/adapters/lmdb.js';
import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import {
  APPLICATION_STATE_TABLE_NAME,
  createApplicationStateDBClient,
  resolveExecutionPayloadStoreId,
} from '../../src/core/lib/config/db.js';
import {
  AttemptStatus,
  EffectStatus,
  ExecutionLedgerTransitionConflictError,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import {
  APPLICATION_STATE_ADAPTER_DESCRIPTOR,
  APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS,
} from '../../src/core/runtime/effects/application-state.js';
import {
  createBuiltinManagedEffectCatalog,
  createBuiltinManagedEffectReconciliationCatalog,
} from '../../src/core/runtime/effects/builtin-catalog.js';
import { executeManagedEffectSuccessorRun } from '../../src/core/runtime/managed-effect-successor.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
  reconcileManualLedgerActivity,
} from '../../src/core/runtime/manual-ledger-run.js';
import { ActivityProtocolTranscriptValidator } from '../../src/core/runtime/activity-protocol.js';
import {
  ExecutionLedgerOperatorScopeError,
  EXECUTION_LEDGER_RECONCILIATION_EVIDENCE_FILE_MAX_BYTES,
  cancelExecutionLedgerRun,
  inspectExecutionLedgerRun,
  readExecutionLedgerReconciliationEvidenceFile,
  reconcileExecutionLedgerEffect,
  reconcileExecutionLedgerRun,
  reconcileUncertainManagedEffectAtOperatorBoundary,
  recoverExecutionLedgerRun,
  recoverStoppedManagedEffectsAtOperatorBoundary,
  retryExecutionLedgerEffect,
} from '../../src/core/runtime/operator/execution-ledger-operator.js';
import {
  createExecutionLedgerEffectReconciliationOperatorView,
  createExecutionLedgerEffectSuccessorOperatorView,
  createExecutionLedgerOperatorView,
  createExecutionLedgerRecoveryOperatorView,
} from '../../src/core/runtime/operator/execution-ledger-view.js';

const RUN_REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const OPERATOR_REVISION_ID = `wrv1_${'B'.repeat(43)}`;

/** @typedef {{adapterName: 'vanilla', controlPath: string, tableName: string, payloadPath: string, payloadStoreId: string, sessionPath: string}} OperatorConfiguration */

/**
 * @param {string} root
 * @param {string} tableName
 * @returns {Readonly<OperatorConfiguration>}
 */
function createConfiguration(root, tableName) {
  const payloadPath = path.join(root, 'execution-payloads');
  return Object.freeze({
    adapterName: 'vanilla',
    controlPath: root,
    tableName,
    payloadPath,
    payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
    sessionPath: path.join(root, 'ledger-service-sessions'),
  });
}

/**
 * @param {string} root
 * @param {string} tableName
 */
function createLmdbConfiguration(root, tableName) {
  const controlPath = path.join(root, 'control');
  const payloadPath = path.join(root, 'execution-payloads');
  return Object.freeze({
    adapterName: /** @type {const} */ ('lmdb'),
    controlPath,
    tableName,
    payloadPath,
    payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
    sessionPath: path.join(root, 'ledger-service-sessions'),
  });
}

/**
 * @param {ReturnType<typeof createLmdbConfiguration>} configuration
 * @param {{readOnly?: boolean}} [options]
 */
function createLmdbLedger(configuration, options = {}) {
  const db = createLMDB({ path: configuration.controlPath, ...options });
  return {
    db,
    ledger: createExecutionLedger({
      db,
      tableName: configuration.tableName,
      payloadStore: createLocalExecutionPayloadStore({
        path: configuration.payloadPath,
        storeId: configuration.payloadStoreId,
      }),
      effectEvidenceVerifiers: [...APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS],
    }),
  };
}

/** @param {string} attemptId @param {string} effectId @param {number} sequence */
function applicationStateEffectRequest(attemptId, effectId, sequence) {
  return {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'effect-request',
    attemptId,
    sequence,
    effectId,
    capability: 'application-state',
    operation: 'put-if-absent',
    input: {
      key: `key-${effectId}`,
      value: { credential: `state-secret-${effectId}` },
    },
    requestedReplayProperties: ['idempotent', 'transactional'],
  };
}

/**
 * @param {string} root
 * @param {{effectStates?: Array<'PENDING'|'STARTED'>, commitReceipt?: boolean, receiptIndexes?: number[], overridePendingContract?: boolean, overrideStartedContract?: boolean}} [options]
 */
async function seedApplicationStateRecoveryRun(root, options = {}) {
  const appId = 'application-state-recovery-operator';
  const configuration = createLmdbConfiguration(
    root,
    'operator-application-state-recovery',
  );
  const applicationStateConfiguration = Object.freeze({
    adapterName: /** @type {const} */ ('lmdb'),
    storePath: path.join(root, 'application-state'),
    tableName: APPLICATION_STATE_TABLE_NAME,
  });
  const { db, ledger } = createLmdbLedger(configuration);
  const applicationDb = await createApplicationStateDBClient('lmdb', {
    path: applicationStateConfiguration.storePath,
  });
  try {
    const catalog = await createBuiltinManagedEffectCatalog({
      db: applicationDb,
      appId,
      adapterName: 'lmdb',
    });
    const runId = createManualLedgerRunId({
      appId,
      idempotencyKey: `recover-${options.effectStates?.join('-') || 'started'}-${
        options.commitReceipt === true ? 'receipt' : 'absent'
      }`,
    });
    await ledger.createManualRun({
      runId,
      appId,
      revisionId: RUN_REVISION_ID,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      activityId: 'work',
      input: { credential: 'input-secret' },
      callerMetadata: { credential: 'caller-secret' },
      transitionId: 'create',
    });
    const claimed = await ledger.claimInvocation({
      runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      fencingToken: 'recovery-fence-secret',
      expectedGeneration: 0,
      expectedVersion: 1,
      transitionId: 'claim:1',
    });
    const started = await ledger.markAttemptStarted({
      runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      attemptId: claimed.attempt.attemptId,
      fencingToken: claimed.attempt.fencingToken,
      generation: claimed.attempt.generation,
      expectedVersion: claimed.run.version,
      transitionId: `start:${claimed.attempt.attemptId}`,
    });

    const effectStates = options.effectStates || ['STARTED'];
    /** @type {string[]} */
    const effectIds = [];
    for (let index = 0; index < effectStates.length; index += 1) {
      const effectId =
        index === 0 ? 'remember-value' : `remember-value-${index + 1}`;
      effectIds.push(effectId);
      const request = applicationStateEffectRequest(
        started.attempt.attemptId,
        effectId,
        index + 1,
      );
      const adapter = catalog.resolve(request);
      const beforeRequest = await ledger.rebuildRun(runId);
      if (!beforeRequest) throw new Error('Expected seeded recovery run.');
      const requested = await ledger.recordManagedEffectRequest({
        runId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        attemptId: started.attempt.attemptId,
        fencingToken: started.attempt.fencingToken,
        generation: started.attempt.generation,
        expectedVersion: beforeRequest.run.version,
        transitionId: `request:${effectId}`,
        request,
        adapter:
          (options.overridePendingContract &&
            effectStates[index] === 'PENDING') ||
          (options.overrideStartedContract && effectStates[index] === 'STARTED')
            ? { id: 'unsupported-managed-adapter', version: 7 }
            : adapter.descriptor,
        destination:
          options.overridePendingContract && effectStates[index] === 'PENDING'
            ? {
                kind: 'unsupported-store',
                version: 3,
                bindingId: 'foreign',
                configuration: { provider: 'unavailable' },
              }
            : adapter.destination,
        verifier: adapter.verifier,
        substantiatedReplayProperties: adapter.substantiatedReplayProperties,
      });
      if (effectStates[index] === 'STARTED') {
        const effectStarted = await ledger.markManagedEffectStarted({
          runId,
          invocationId: MANUAL_LEDGER_INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          effectId,
          fencingToken: started.attempt.fencingToken,
          generation: started.attempt.generation,
          expectedVersion: requested.run.version,
          expectedEffectVersion: requested.effect.version,
          transitionId: `effect-start:${effectId}`,
        });
        const receiptIndexes =
          options.receiptIndexes || (options.commitReceipt === true ? [0] : []);
        if (receiptIndexes.includes(index)) {
          await adapter.execute({
            destinationEffectId: effectStarted.effect.destinationEffectId,
            destination: adapter.destination,
            identity: {
              runId,
              invocationId: MANUAL_LEDGER_INVOCATION_ID,
              attemptId: started.attempt.attemptId,
              effectId,
            },
            request,
          });
        }
      }
    }
    return {
      appId,
      runId,
      effectIds,
      storeId: catalog.storeId,
      configuration,
      applicationStateConfiguration,
    };
  } finally {
    await applicationDb.close();
    await db.close();
  }
}

/**
 * @param {ReturnType<typeof createLmdbConfiguration>} configuration
 * @param {string} runId
 */
async function readLmdbRun(configuration, runId) {
  const { db, ledger } = createLmdbLedger(configuration, { readOnly: true });
  try {
    return await ledger.rebuildRun(runId);
  } finally {
    await db.close();
  }
}

/**
 * @param {string} root
 * @param {OperatorConfiguration} configuration
 * @param {{readOnly?: boolean}} [options]
 */
function createLedger(root, configuration, options = {}) {
  const db = createVanillaDB({ path: root, ...options });
  return {
    db,
    ledger: createExecutionLedger({
      db,
      tableName: configuration.tableName,
      payloadStore: createLocalExecutionPayloadStore({
        path: configuration.payloadPath,
        storeId: configuration.payloadStoreId,
      }),
    }),
  };
}

/**
 * @param {string} root
 * @param {OperatorConfiguration} configuration
 * @param {string} appId
 * @param {string} key
 */
async function seedClaimedRun(root, configuration, appId, key) {
  const { db, ledger } = createLedger(root, configuration);
  const runId = createManualLedgerRunId({ appId, idempotencyKey: key });
  try {
    await ledger.createManualRun({
      runId,
      appId,
      revisionId: RUN_REVISION_ID,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      activityId: 'work',
      input: { credential: 'input-secret' },
      callerMetadata: { credential: 'caller-secret' },
      transitionId: 'create',
      actor: { kind: 'local', id: 'test' },
    });
    await ledger.claimInvocation({
      runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      fencingToken: 'fence-secret',
      expectedGeneration: 0,
      expectedVersion: 1,
      transitionId: 'claim:1',
      actor: { kind: 'local', id: 'test' },
    });
    return runId;
  } finally {
    await db.close();
  }
}

/**
 * @param {string} root
 * @param {OperatorConfiguration} configuration
 * @param {string} runId
 */
async function readRun(root, configuration, runId) {
  const { db, ledger } = createLedger(root, configuration, { readOnly: true });
  try {
    return await ledger.rebuildRun(runId);
  } finally {
    await db.close();
  }
}

describe('shared execution-ledger operator boundary', () => {
  it('reads only a bounded regular JSON evidence file', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-operator-evidence-file-'),
    );
    const evidenceFile = path.join(root, 'evidence.json');
    const oversizedFile = path.join(root, 'oversized.json');
    try {
      const evidence = {
        protocol: 'wharfie.activity',
        transcript: { terminal: 'completed' },
      };
      writeFileSync(evidenceFile, JSON.stringify(evidence), 'utf8');
      await expect(
        readExecutionLedgerReconciliationEvidenceFile(evidenceFile),
      ).resolves.toEqual(evidence);

      writeFileSync(evidenceFile, '{not-json', 'utf8');
      await expect(
        readExecutionLedgerReconciliationEvidenceFile(evidenceFile),
      ).rejects.toThrow(/valid UTF-8 JSON evidence/i);

      writeFileSync(oversizedFile, '', 'utf8');
      truncateSync(
        oversizedFile,
        EXECUTION_LEDGER_RECONCILIATION_EVIDENCE_FILE_MAX_BYTES + 1,
      );
      await expect(
        readExecutionLedgerReconciliationEvidenceFile(oversizedFile),
      ).rejects.toThrow(/must not exceed/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exposes cancellation ordering while redacting its reason', () => {
    const requestedAt = 1_700_000_000_000;
    const view = createExecutionLedgerOperatorView({
      run: {
        runId: 'run-with-cancellation',
        appId: 'application-a',
        revisionId: RUN_REVISION_ID,
        status: 'RUNNING',
        version: 4,
        lastSequence: 4,
        createdAt: requestedAt - 3,
        updatedAt: requestedAt,
        cancellationRequest: {
          requestId: 'cancel-request-1',
          requestedAt,
          actor: { kind: 'local', id: 'operator' },
          reason: {
            code: 'operator-cancel-requested',
            name: 'CancellationRequested',
            message: 'reason-secret',
            details: { credential: 'reason-details-secret' },
          },
        },
      },
      invocations: [],
      attempts: [],
      events: [
        {
          sequence: 4,
          type: 'manual-cancellation-requested',
          observed_at: requestedAt,
          actor: { kind: 'local', id: 'operator' },
          fence: { coordinatorEpoch: 0, invocationGeneration: 1 },
        },
      ],
    });

    expect(view).toMatchObject({
      schemaVersion: 5,
      run: {
        cancellationRequest: {
          requestId: 'cancel-request-1',
          requestedAt,
        },
      },
      history: [{ type: 'manual-cancellation-requested' }],
    });
    expect(view.history[0]).toEqual({
      sequence: 4,
      type: 'manual-cancellation-requested',
      observedAt: requestedAt,
      actor: { kind: 'local', id: 'operator' },
    });
    expect(JSON.stringify(view)).not.toContain('reason-secret');
    expect(JSON.stringify(view)).not.toContain('reason-details-secret');
  });

  it('rejects cross-app inspection, recovery, and reconciliation before changing the run', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'wharfie-operator-scope-'));
    const configuration = createConfiguration(root, 'operator-scope');
    try {
      const runId = await seedClaimedRun(
        root,
        configuration,
        'application-b',
        'cross-app',
      );
      const before = await readRun(root, configuration, runId);

      await expect(
        inspectExecutionLedgerRun({
          runId,
          expectedAppId: 'application-a',
          configuration,
        }),
      ).rejects.toBeInstanceOf(ExecutionLedgerOperatorScopeError);
      await expect(
        recoverExecutionLedgerRun({
          runId,
          expectedAppId: 'application-a',
          configuration,
        }),
      ).rejects.toBeInstanceOf(ExecutionLedgerOperatorScopeError);
      await expect(
        reconcileExecutionLedgerRun({
          runId,
          reconciliationId: 'cross-app-reconciliation',
          evidence: { credential: 'must-not-be-persisted' },
          expectedAppId: 'application-a',
          configuration,
        }),
      ).rejects.toBeInstanceOf(ExecutionLedgerOperatorScopeError);

      const after = await readRun(root, configuration, runId);
      expect(after).toEqual(before);
      expect(after?.attempts).toEqual([
        expect.objectContaining({ status: AttemptStatus.CLAIMED }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lets a successor artifact recover an older same-app run without relabelling it', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-operator-revision-'),
    );
    const configuration = createConfiguration(root, 'operator-revision');
    try {
      const runId = await seedClaimedRun(
        root,
        configuration,
        'application-a',
        'older-revision',
      );
      const result = await recoverExecutionLedgerRun({
        runId,
        expectedAppId: 'application-a',
        actor: {
          kind: 'packaged-operator',
          id: OPERATOR_REVISION_ID,
        },
        configuration,
      });

      expect(result).toMatchObject({
        recovery: { action: 'released-unstarted-claim', changed: true },
        view: {
          run: { runId, revisionId: RUN_REVISION_ID },
          attempts: [
            expect.objectContaining({ status: AttemptStatus.ABANDONED }),
          ],
        },
      });
      expect(result?.view.events.at(-1)).toMatchObject({
        actor: {
          kind: 'packaged-operator',
          id: OPERATOR_REVISION_ID,
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('settles a PENDING-only set without opening application state', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-operator-effect-pending-'),
    );
    try {
      const fixture = await seedApplicationStateRecoveryRun(root, {
        effectStates: ['PENDING'],
        overridePendingContract: true,
      });
      const missingStorePath = path.join(root, 'must-remain-absent');
      const before = await readLmdbRun(fixture.configuration, fixture.runId);
      const result = await recoverExecutionLedgerRun({
        runId: fixture.runId,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: Object.freeze({
          ...fixture.applicationStateConfiguration,
          storePath: missingStorePath,
        }),
      });

      expect(existsSync(missingStorePath)).toBe(false);
      expect(result).toMatchObject({
        recovery: {
          action: 'settled-managed-effect-set',
          changed: true,
          managedEffects: [
            {
              effectId: fixture.effectIds[0],
              action: 'cancelled-before-start',
              status: EffectStatus.CANCELLED,
            },
          ],
        },
        view: {
          run: { status: RunStatus.BLOCKED },
          invocations: [
            expect.objectContaining({ status: InvocationStatus.UNCERTAIN }),
          ],
          attempts: [
            expect.objectContaining({ status: AttemptStatus.ABANDONED }),
          ],
          effects: [
            expect.objectContaining({ status: EffectStatus.CANCELLED }),
          ],
        },
      });
      expect(result?.view.events).toHaveLength(
        (before?.events.length || 0) + 1,
      );
      expect(result?.view.events.at(-1)).toMatchObject({
        type: 'attempt-became-uncertain',
        actor: { kind: 'local', id: 'cli' },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it('reports a competing stopped-effect settlement as generic authoritative state', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-operator-effect-competing-settlement-'),
    );
    const competitor = Object.freeze({
      kind: 'packaged-operator',
      id: OPERATOR_REVISION_ID,
    });
    try {
      const fixture = await seedApplicationStateRecoveryRun(root, {
        effectStates: ['PENDING'],
      });
      const { db, ledger } = createLmdbLedger(fixture.configuration);
      try {
        const before = await ledger.rebuildRun(fixture.runId);
        if (!before) throw new Error('Expected competing recovery run.');
        const invocation = before.invocations.find(
          (/** @type {Record<string, any>} */ candidate) =>
            candidate.invocationId === MANUAL_LEDGER_INVOCATION_ID,
        );
        const attempt = before.attempts.find(
          (/** @type {Record<string, any>} */ candidate) =>
            candidate.invocationId === MANUAL_LEDGER_INVOCATION_ID &&
            candidate.generation === invocation?.generation,
        );
        if (!attempt) throw new Error('Expected competing recovery attempt.');
        const target = {
          invocationId: MANUAL_LEDGER_INVOCATION_ID,
          attemptId: attempt.attemptId,
          effects: before.effects,
        };
        const competingLedger = {
          ...ledger,
          async settleStoppedAttemptManagedEffects(
            /** @type {Record<string, any>} */ options,
          ) {
            await ledger.settleStoppedAttemptManagedEffects({
              ...options,
              transitionId: 'competing-stopped-effect-settlement',
              actor: competitor,
            });
            throw new Error('operator settlement lost to competing authority');
          },
        };

        await expect(
          recoverStoppedManagedEffectsAtOperatorBoundary({
            ledger: /** @type {any} */ (competingLedger),
            runId: fixture.runId,
            target,
            actor: { kind: 'local', id: 'cli' },
          }),
        ).resolves.toMatchObject({
          found: true,
          mayExecute: false,
          action: 'none',
          changed: false,
          outcome: {
            disposition: 'blocked',
            reused: true,
            run: { status: RunStatus.BLOCKED },
            invocation: { status: InvocationStatus.UNCERTAIN },
            attempt: { status: AttemptStatus.ABANDONED },
          },
        });
        const after = await ledger.rebuildRun(fixture.runId);
        expect(after?.events).toHaveLength(before.events.length + 1);
        expect(after?.events.at(-1)).toMatchObject({
          transition_id: 'competing-stopped-effect-settlement',
          type: 'attempt-became-uncertain',
          actor: competitor,
        });
      } finally {
        await db.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it('rethrows a stopped-effect recovery failure while its set remains active', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-operator-effect-active-failure-'),
    );
    try {
      const fixture = await seedApplicationStateRecoveryRun(root, {
        effectStates: ['PENDING'],
      });
      const { db, ledger } = createLmdbLedger(fixture.configuration);
      try {
        const before = await ledger.rebuildRun(fixture.runId);
        if (!before) throw new Error('Expected active recovery run.');
        const invocation = before.invocations.find(
          (/** @type {Record<string, any>} */ candidate) =>
            candidate.invocationId === MANUAL_LEDGER_INVOCATION_ID,
        );
        const attempt = before.attempts.find(
          (/** @type {Record<string, any>} */ candidate) =>
            candidate.invocationId === MANUAL_LEDGER_INVOCATION_ID &&
            candidate.generation === invocation?.generation,
        );
        if (!attempt) throw new Error('Expected active recovery attempt.');
        const failedLedger = {
          ...ledger,
          async settleStoppedAttemptManagedEffects() {
            throw new Error('uncommitted stopped-effect settlement failure');
          },
        };

        await expect(
          recoverStoppedManagedEffectsAtOperatorBoundary({
            ledger: /** @type {any} */ (failedLedger),
            runId: fixture.runId,
            target: {
              invocationId: MANUAL_LEDGER_INVOCATION_ID,
              attemptId: attempt.attemptId,
              effects: before.effects,
            },
            actor: { kind: 'local', id: 'cli' },
          }),
        ).rejects.toThrow('uncommitted stopped-effect settlement failure');
        await expect(ledger.rebuildRun(fixture.runId)).resolves.toEqual(before);
      } finally {
        await db.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it('settles a mixed PENDING/receipt/null set in one redacted transition', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-operator-effect-mixed-'),
    );
    try {
      const fixture = await seedApplicationStateRecoveryRun(root, {
        effectStates: ['PENDING', 'STARTED', 'STARTED'],
        receiptIndexes: [1],
      });
      const before = await readLmdbRun(fixture.configuration, fixture.runId);
      const result = await recoverExecutionLedgerRun({
        runId: fixture.runId,
        expectedAppId: fixture.appId,
        actor: { kind: 'packaged-operator', id: OPERATOR_REVISION_ID },
        configuration: fixture.configuration,
        applicationStateConfiguration: fixture.applicationStateConfiguration,
      });
      if (!result) throw new Error('Expected managed-effect recovery result.');

      expect(result.recovery).toEqual({
        found: true,
        mayExecute: false,
        action: 'settled-managed-effect-set',
        changed: true,
        managedEffects: [
          {
            effectId: fixture.effectIds[0],
            action: 'cancelled-before-start',
            status: EffectStatus.CANCELLED,
          },
          {
            effectId: fixture.effectIds[1],
            action: 'outcome-recovered',
            status: EffectStatus.COMPLETED,
          },
          {
            effectId: fixture.effectIds[2],
            action: 'outcome-uncertain',
            status: EffectStatus.UNCERTAIN,
          },
        ],
      });
      expect(
        result.view.effects.map(
          (/** @type {Record<string, any>} */ effect) => effect.status,
        ),
      ).toEqual([
        EffectStatus.CANCELLED,
        EffectStatus.COMPLETED,
        EffectStatus.UNCERTAIN,
      ]);
      expect(result.view.events).toHaveLength((before?.events.length || 0) + 1);
      expect(result.view.events.at(-1)).toMatchObject({
        type: 'attempt-became-uncertain',
        actor: { kind: 'packaged-operator', id: OPERATOR_REVISION_ID },
        payload: { effects: expect.any(Array) },
      });

      const operatorView = createExecutionLedgerRecoveryOperatorView(
        /** @type {{action: string, changed: boolean, managedEffects: Array<{effectId: string, action: string, status: string}>}} */ ({
          ...result.recovery,
          managedEffects: [...result.recovery.managedEffects].reverse(),
        }),
        result.view,
      );
      expect(operatorView).toMatchObject({
        schemaVersion: 5,
        recovery: {
          action: 'settled-managed-effect-set',
          changed: true,
          managedEffects: result.recovery.managedEffects,
        },
        effects: fixture.effectIds.map((effectId, index) => ({
          invocationId: MANUAL_LEDGER_INVOCATION_ID,
          effectId,
          status: [
            EffectStatus.CANCELLED,
            EffectStatus.COMPLETED,
            EffectStatus.UNCERTAIN,
          ][index],
          adapter: {
            id: APPLICATION_STATE_ADAPTER_DESCRIPTOR.id,
            version: APPLICATION_STATE_ADAPTER_DESCRIPTOR.version,
          },
        })),
      });
      const serialized = JSON.stringify(operatorView);
      for (const secret of [
        fixture.storeId,
        'state-secret',
        'recovery-fence-secret',
        'destinationEffectId',
        'evidence',
      ]) {
        expect(serialized).not.toContain(secret);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it('replays a destination not-applied resolution after the ledger append is lost', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-operator-effect-resolution-loss-'),
    );
    const reconciliationId = 'not-applied-after-ledger-loss';
    try {
      const fixture = await seedApplicationStateRecoveryRun(root, {
        effectStates: ['STARTED'],
      });
      const recovered = await recoverExecutionLedgerRun({
        runId: fixture.runId,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: fixture.applicationStateConfiguration,
      });
      if (!recovered) throw new Error('Expected uncertain recovery result.');
      const before = recovered.view;
      const targetEffect = before.effects[0];
      const targetAttempt = before.attempts[0];
      expect(targetEffect.status).toBe(EffectStatus.UNCERTAIN);

      const { db, ledger } = createLmdbLedger(fixture.configuration);
      const applicationDb = await createApplicationStateDBClient('lmdb', {
        path: fixture.applicationStateConfiguration.storePath,
      });
      try {
        const catalog = await createBuiltinManagedEffectReconciliationCatalog({
          db: applicationDb,
          appId: fixture.appId,
          adapterName: 'lmdb',
        });
        const failedLedger = {
          ...ledger,
          async reconcileUncertainManagedEffect() {
            throw new Error('simulated control-ledger append loss');
          },
        };
        await expect(
          reconcileUncertainManagedEffectAtOperatorBoundary({
            ledger: /** @type {any} */ (failedLedger),
            runId: fixture.runId,
            effectId: targetEffect.effectId,
            reconciliationId,
            reconcileEffect: catalog.reconcileEffect,
            actor: { kind: 'local', id: 'test' },
            reason: {
              kind: 'operator-managed-effect-reconciliation',
              reconciliationId,
            },
          }),
        ).rejects.toThrow('simulated control-ledger append loss');
        await expect(ledger.rebuildRun(fixture.runId)).resolves.toEqual(before);

        const delivery = await ledger.readManagedEffectDelivery(
          fixture.runId,
          targetEffect.invocationId,
          targetEffect.effectId,
        );
        if (!delivery) throw new Error('Expected retained effect delivery.');
        const request = applicationStateEffectRequest(
          targetAttempt.attemptId,
          targetEffect.effectId,
          targetEffect.requestedBy.protocolSequence,
        );
        await expect(
          catalog.reconcileEffect({
            destinationEffectId: targetEffect.destinationEffectId,
            destination: targetEffect.destination,
            identity: {
              runId: fixture.runId,
              invocationId: targetEffect.invocationId,
              effectId: targetEffect.effectId,
            },
            request,
          }),
        ).resolves.toMatchObject({ kind: 'not-applied' });
      } finally {
        await applicationDb.close();
        await db.close();
      }

      const result = await reconcileExecutionLedgerEffect({
        runId: fixture.runId,
        effectId: targetEffect.effectId,
        reconciliationId,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: fixture.applicationStateConfiguration,
      });
      if (!result) throw new Error('Expected effect reconciliation result.');
      expect(result.reconciliation).toEqual({
        reconciliationId,
        effectId: targetEffect.effectId,
        status: EffectStatus.NOT_APPLIED,
        changed: true,
      });
      expect(result.view.run).toMatchObject({
        status: RunStatus.BLOCKED,
        version: before.run.version + 1,
        lastSequence: before.run.lastSequence + 1,
      });
      expect(result.view.invocations[0]).toMatchObject({
        status: InvocationStatus.UNCERTAIN,
        version: before.invocations[0].version + 1,
        lastSequence: before.run.lastSequence + 1,
      });
      expect(result.view.attempts).toEqual(before.attempts);
      expect(result.view.effects[0]).toMatchObject({
        status: EffectStatus.NOT_APPLIED,
        version: targetEffect.version + 1,
        lastSequence: before.run.lastSequence + 1,
      });
      expect(result.view.events.at(-1)).toMatchObject({
        type: 'uncertain-effect-reconciled',
        payload: {
          reconciliation: {
            reconciliationId,
            resolutionStatus: EffectStatus.NOT_APPLIED,
          },
        },
      });

      const replayStorePath = path.join(root, 'replay-must-remain-absent');
      const replayApplicationStateConfiguration = Object.freeze({
        ...fixture.applicationStateConfiguration,
        storePath: replayStorePath,
      });
      const repeated = await reconcileExecutionLedgerEffect({
        runId: fixture.runId,
        effectId: targetEffect.effectId,
        reconciliationId,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: replayApplicationStateConfiguration,
      });
      expect(repeated).toEqual({
        reconciliation: {
          reconciliationId,
          effectId: targetEffect.effectId,
          status: EffectStatus.NOT_APPLIED,
          changed: false,
        },
        view: result.view,
      });
      expect(existsSync(replayStorePath)).toBe(false);
      await expect(
        reconcileExecutionLedgerEffect({
          runId: fixture.runId,
          effectId: targetEffect.effectId,
          reconciliationId: 'different-reconciliation-id',
          expectedAppId: fixture.appId,
          configuration: fixture.configuration,
          applicationStateConfiguration: replayApplicationStateConfiguration,
        }),
      ).rejects.toThrow(/already reconciled.*reuse that reconciliation ID/i);
      await expect(
        reconcileExecutionLedgerEffect({
          runId: fixture.runId,
          effectId: targetEffect.effectId,
          reconciliationId,
          reason: 'changed replay reason',
          expectedAppId: fixture.appId,
          configuration: fixture.configuration,
          applicationStateConfiguration: replayApplicationStateConfiguration,
        }),
      ).rejects.toThrow(/does not match its retained durable request/i);
      expect(existsSync(replayStorePath)).toBe(false);
      await expect(
        readLmdbRun(fixture.configuration, fixture.runId),
      ).resolves.toEqual(result.view);

      const transcript = new ActivityProtocolTranscriptValidator();
      const acceptedStart = transcript.acceptHostFrame({
        protocol: 'wharfie.activity',
        protocolVersion: 1,
        type: 'start',
        revisionId: RUN_REVISION_ID,
        activityId: 'work',
        runId: fixture.runId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        attemptId: targetAttempt.attemptId,
        fencingToken: targetAttempt.fencingToken,
        input: { credential: 'input-secret' },
        caller: { metadata: { credential: 'caller-secret' } },
      });
      const acceptedRequest = transcript.acceptComponentFrame(
        applicationStateEffectRequest(
          targetAttempt.attemptId,
          targetEffect.effectId,
          targetEffect.requestedBy.protocolSequence,
        ),
      );
      const acceptedTerminal = transcript.acceptComponentFrame({
        protocol: 'wharfie.activity',
        protocolVersion: 1,
        type: 'failed',
        attemptId: targetAttempt.attemptId,
        sequence: 2,
        error: {
          code: 'activity-failed-after-effect-loss',
          name: 'ActivityError',
          message: 'The activity failed after its effect response was lost.',
          details: {},
        },
      });
      const { db: terminalDb, ledger: terminalLedger } = createLmdbLedger(
        fixture.configuration,
      );
      let terminalized;
      try {
        terminalized = await reconcileManualLedgerActivity({
          ledger: terminalLedger,
          runId: fixture.runId,
          reconciliationId: 'terminal-after-effect-reconciliation',
          evidence: {
            status: acceptedTerminal.type,
            start: acceptedStart,
            terminal: acceptedTerminal,
            frames: [acceptedStart, acceptedRequest, acceptedTerminal],
            transcript: transcript.snapshot(),
          },
        });
      } finally {
        await terminalDb.close();
      }
      expect(terminalized).toMatchObject({
        found: true,
        changed: true,
        view: {
          run: { status: RunStatus.FAILED },
          invocations: [{ status: InvocationStatus.FAILED }],
          attempts: [targetAttempt],
          effects: [
            expect.objectContaining({ status: EffectStatus.NOT_APPLIED }),
          ],
        },
      });

      const replayAfterTerminal = await reconcileExecutionLedgerEffect({
        runId: fixture.runId,
        effectId: targetEffect.effectId,
        reconciliationId,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: replayApplicationStateConfiguration,
      });
      expect(replayAfterTerminal).toEqual({
        reconciliation: {
          reconciliationId,
          effectId: targetEffect.effectId,
          status: EffectStatus.NOT_APPLIED,
          changed: false,
        },
        view: terminalized.view,
      });
      expect(existsSync(replayStorePath)).toBe(false);

      const verifyApplicationDb = await createApplicationStateDBClient('lmdb', {
        path: fixture.applicationStateConfiguration.storePath,
      });
      const { db: verifyDb, ledger: verifyLedger } = createLmdbLedger(
        fixture.configuration,
        {
          readOnly: true,
        },
      );
      try {
        const catalog = await createBuiltinManagedEffectCatalog({
          db: verifyApplicationDb,
          appId: fixture.appId,
          adapterName: 'lmdb',
        });
        const delivery = await verifyLedger.readManagedEffectDelivery(
          fixture.runId,
          targetEffect.invocationId,
          targetEffect.effectId,
        );
        if (!delivery) throw new Error('Expected reconciled effect delivery.');
        const request = applicationStateEffectRequest(
          targetAttempt.attemptId,
          targetEffect.effectId,
          targetEffect.requestedBy.protocolSequence,
        );
        await expect(
          catalog.resolve(request).execute({
            destinationEffectId: targetEffect.destinationEffectId,
            destination: targetEffect.destination,
            identity: {
              runId: fixture.runId,
              invocationId: targetEffect.invocationId,
              attemptId: targetAttempt.attemptId,
              effectId: targetEffect.effectId,
            },
            request,
          }),
        ).rejects.toThrow(/permanently resolved as not applied/i);
      } finally {
        await verifyDb.close();
        await verifyApplicationDb.close();
      }

      const operatorView =
        createExecutionLedgerEffectReconciliationOperatorView(
          result.reconciliation,
          result.view,
        );
      expect(operatorView).toMatchObject({
        schemaVersion: 5,
        kind: 'wharfie.execution-ledger.effect-reconciliation',
        effectReconciliation: result.reconciliation,
        run: { status: RunStatus.BLOCKED },
        effects: [
          expect.objectContaining({ status: EffectStatus.NOT_APPLIED }),
        ],
      });
      const serialized = JSON.stringify(operatorView);
      expect(operatorView.attempts[0]).not.toHaveProperty('coordinatorEpoch');
      for (const event of operatorView.history) {
        expect(event).not.toHaveProperty('fence');
      }
      for (const secret of [
        fixture.storeId,
        'state-secret',
        'recovery-fence-secret',
        'coordinatorEpoch',
        'fencingToken',
        'resolutionDigest',
        'businessObservation',
        'evidenceRef',
      ]) {
        expect(serialized).not.toContain(secret);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  it('runs a not-applied managed effect as a fresh framework-owned successor and redacts both runs', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-operator-effect-successor-'),
    );
    const reconciliationId = 'successor-source-reconciliation';
    const successorId = 'remember-value-successor-1';
    const actor = {
      kind: 'packaged-operator',
      id: OPERATOR_REVISION_ID,
    };
    try {
      const fixture = await seedApplicationStateRecoveryRun(root, {
        effectStates: ['STARTED'],
      });
      const recovered = await recoverExecutionLedgerRun({
        runId: fixture.runId,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: fixture.applicationStateConfiguration,
      });
      if (!recovered) throw new Error('Expected uncertain recovery result.');
      const sourceEffect = recovered.view.effects[0];
      const reconciled = await reconcileExecutionLedgerEffect({
        runId: fixture.runId,
        effectId: sourceEffect.effectId,
        reconciliationId,
        actor,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: fixture.applicationStateConfiguration,
      });
      if (!reconciled) {
        throw new Error('Expected not-applied source reconciliation.');
      }
      expect(reconciled.reconciliation.status).toBe(EffectStatus.NOT_APPLIED);
      const sourceBefore = reconciled.view;

      const result = await retryExecutionLedgerEffect({
        runId: fixture.runId,
        effectId: sourceEffect.effectId,
        successorId,
        reason: 'private-successor-reason',
        actor,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: fixture.applicationStateConfiguration,
      });
      if (!result) throw new Error('Expected managed-effect successor result.');

      expect(result.successor).toMatchObject({
        successorId,
        intent: 'retry',
        authorizationApplied: true,
        sourceEffectId: sourceEffect.effectId,
        targetDisposition: 'completed',
      });
      expect(result.successor.targetEffectId).not.toBe(sourceEffect.effectId);
      expect(result.sourceView.run).toMatchObject({
        runId: fixture.runId,
        status: RunStatus.BLOCKED,
        version: sourceBefore.run.version + 1,
      });
      expect(result.sourceView.attempts).toEqual(sourceBefore.attempts);
      expect(result.sourceView.effects).toEqual(sourceBefore.effects);
      expect(result.sourceView.events).toHaveLength(
        sourceBefore.events.length + 1,
      );
      expect(result.sourceView.events.at(-1)).toMatchObject({
        type: 'effect-successor-authorized',
        actor,
      });
      expect(result.targetView).toMatchObject({
        run: { status: RunStatus.COMPLETED },
        invocations: [{ status: InvocationStatus.COMPLETED }],
        effects: [
          expect.objectContaining({
            effectId: result.successor.targetEffectId,
            status: EffectStatus.COMPLETED,
          }),
        ],
      });

      const operatorView = createExecutionLedgerEffectSuccessorOperatorView(
        result.successor,
        result.sourceView,
        result.targetView,
      );
      expect(operatorView).toMatchObject({
        schemaVersion: 5,
        kind: 'wharfie.execution-ledger.effect-successor',
        effectSuccessor: {
          successorId,
          authorizationApplied: true,
          source: {
            runId: fixture.runId,
            effectId: sourceEffect.effectId,
            status: RunStatus.BLOCKED,
          },
          target: {
            runId: result.targetView.run.runId,
            effectId: result.successor.targetEffectId,
            status: RunStatus.COMPLETED,
            disposition: 'completed',
          },
        },
      });
      const serialized = JSON.stringify(operatorView);
      for (const secret of [
        fixture.storeId,
        'state-secret-remember-value',
        'private-successor-reason',
        'destinationEffectId',
        'fencingToken',
      ]) {
        expect(serialized).not.toContain(secret);
      }

      rmSync(fixture.applicationStateConfiguration.storePath, {
        recursive: true,
        force: true,
      });
      const replay = await retryExecutionLedgerEffect({
        runId: fixture.runId,
        effectId: sourceEffect.effectId,
        successorId,
        reason: 'private-successor-reason',
        actor,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: fixture.applicationStateConfiguration,
      });
      expect(replay).toMatchObject({
        successor: {
          successorId,
          authorizationApplied: false,
        },
        sourceView: result.sourceView,
        targetView: result.targetView,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  it('makes successor authorization first-wins and admits only its dedicated atomic lifecycle', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-operator-effect-successor-contract-'),
    );
    const actor = {
      kind: 'packaged-operator',
      id: OPERATOR_REVISION_ID,
    };
    try {
      const fixture = await seedApplicationStateRecoveryRun(root, {
        effectStates: ['STARTED'],
      });
      const recovered = await recoverExecutionLedgerRun({
        runId: fixture.runId,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: fixture.applicationStateConfiguration,
      });
      if (!recovered) throw new Error('Expected uncertain recovery result.');
      const sourceEffect = recovered.view.effects[0];
      const reconciled = await reconcileExecutionLedgerEffect({
        runId: fixture.runId,
        effectId: sourceEffect.effectId,
        reconciliationId: 'successor-contract-reconciliation',
        actor,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: fixture.applicationStateConfiguration,
      });
      if (!reconciled) throw new Error('Expected source reconciliation.');

      const { db, ledger } = createLmdbLedger(fixture.configuration);
      try {
        const request = {
          sourceRunId: fixture.runId,
          sourceEffectId: sourceEffect.effectId,
          successorId: 'sole-effect-successor',
          reason: { kind: 'contract-test' },
          actor,
        };
        const handoff =
          await ledger.authorizeManagedEffectSuccessorRetry(request);
        expect(handoff.applied).toBe(true);
        const runnableBeforeCancellation = await ledger.rebuildRun(
          handoff.authorization.target.runId,
        );
        await expect(
          cancelExecutionLedgerRun({
            runId: handoff.authorization.target.runId,
            requestId: 'cancel-successor-before-start',
            expectedAppId: fixture.appId,
            configuration: fixture.configuration,
          }),
        ).rejects.toThrow(
          /cancellation is not supported for a managed-effect successor/i,
        );
        await expect(
          ledger.rebuildRun(handoff.authorization.target.runId),
        ).resolves.toEqual(runnableBeforeCancellation);
        await expect(
          ledger.authorizeManagedEffectSuccessorRetry(request),
        ).resolves.toMatchObject({ applied: false });
        await expect(
          ledger.authorizeManagedEffectSuccessorRetry({
            ...request,
            successorId: 'competing-successor',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);
        await expect(
          ledger.authorizeManagedEffectSuccessorRetry({
            ...request,
            reason: { kind: 'different-work' },
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);

        const aborted = new AbortController();
        aborted.abort(new Error('do not consume the successor slot'));
        await expect(
          executeManagedEffectSuccessorRun(
            /** @type {any} */ ({
              ledger,
              authorization: handoff.authorization,
              request: handoff.request,
              signal: aborted.signal,
            }),
          ),
        ).rejects.toThrow(/does not support cancellation/i);

        const cancellationReason = {
          code: 'operator-requested-cancellation',
          name: 'CancellationError',
          message: 'Successor cancellation is intentionally unsupported.',
          details: { requestId: 'cancel-successor-before-claim' },
        };
        await expect(
          ledger.requestManualRunCancellation({
            runId: handoff.authorization.target.runId,
            invocationId: handoff.authorization.target.invocationId,
            expectedGeneration: 0,
            expectedVersion: handoff.targetRun.version,
            transitionId: 'cancel:successor-before-claim',
            requestId: 'cancel-successor-before-claim',
            reason: cancellationReason,
          }),
        ).rejects.toThrow(/cannot cancel a managed-effect successor/i);

        await expect(
          ledger.claimInvocation({
            runId: handoff.authorization.target.runId,
            invocationId: handoff.authorization.target.invocationId,
            fencingToken: 'successor-contract-fence',
            expectedGeneration: 0,
            expectedVersion: handoff.targetRun.version,
            transitionId: 'claim:successor-contract',
          }),
        ).rejects.toThrow(/not authorized for a managed-effect successor/i);

        const started = await ledger.startManagedEffectSuccessor({
          runId: handoff.authorization.target.runId,
          fencingToken: 'successor-contract-fence',
          expectedVersion: handoff.targetRun.version,
          transitionId: 'start:successor-contract',
          actor,
        });
        expect(started).toMatchObject({
          applied: true,
          dispatchAuthorized: true,
          run: { status: RunStatus.RUNNING },
          invocation: { status: InvocationStatus.RUNNING, generation: 1 },
          attempt: { status: AttemptStatus.STARTED, generation: 1 },
          effect: {
            effectId: handoff.authorization.target.effectId,
            status: EffectStatus.STARTED,
          },
        });
        const startedBeforeCancellation = await ledger.rebuildRun(
          handoff.authorization.target.runId,
        );
        await expect(
          cancelExecutionLedgerRun({
            runId: handoff.authorization.target.runId,
            requestId: 'cancel-successor-after-start',
            expectedAppId: fixture.appId,
            configuration: fixture.configuration,
          }),
        ).rejects.toThrow(
          /cancellation is not supported for a managed-effect successor/i,
        );
        await expect(
          ledger.rebuildRun(handoff.authorization.target.runId),
        ).resolves.toEqual(startedBeforeCancellation);
        await expect(
          ledger.markAttemptUncertain({
            runId: handoff.authorization.target.runId,
            invocationId: handoff.authorization.target.invocationId,
            attemptId: started.attempt.attemptId,
            fencingToken: started.attempt.fencingToken,
            generation: started.attempt.generation,
            expectedVersion: started.run.version,
            transitionId: 'uncertain:successor-contract',
            reason: { kind: 'ordinary-lifecycle-must-not-run' },
            actor,
          }),
        ).rejects.toThrow(/not authorized for a managed-effect successor/i);
        await expect(
          ledger.recordManagedEffectRequest({
            runId: handoff.authorization.target.runId,
            invocationId: handoff.authorization.target.invocationId,
            attemptId: started.attempt.attemptId,
            fencingToken: started.attempt.fencingToken,
            generation: started.attempt.generation,
            expectedVersion: started.run.version,
            transitionId: 'request:successor-contract',
            request: {
              protocol: 'wharfie.activity',
              protocolVersion: 1,
              type: 'effect-request',
              attemptId: started.attempt.attemptId,
              sequence: 1,
              effectId: handoff.authorization.target.effectId,
              capability: handoff.request.capability,
              operation: handoff.request.operation,
              input: handoff.request.input,
              requestedReplayProperties:
                handoff.request.requestedReplayProperties,
            },
            adapter: handoff.authorization.contract.adapter,
            destination: handoff.authorization.contract.destination,
            verifier: handoff.authorization.contract.verifier,
            substantiatedReplayProperties:
              handoff.authorization.contract.substantiatedReplayProperties,
            actor,
          }),
        ).rejects.toThrow(/not authorized for a managed-effect successor/i);
        const replayedStart = await ledger.startManagedEffectSuccessor({
          runId: handoff.authorization.target.runId,
          fencingToken: 'successor-contract-fence',
          expectedVersion: handoff.targetRun.version,
          transitionId: 'start:successor-contract',
          actor,
        });
        expect(replayedStart).toMatchObject({
          applied: false,
          dispatchAuthorized: false,
          attempt: { attemptId: started.attempt.attemptId },
          effect: { effectId: started.effect.effectId },
        });
        const target = await ledger.rebuildRun(
          handoff.authorization.target.runId,
        );
        expect(target).toMatchObject({
          events: [
            expect.objectContaining({ type: 'effect-successor-run-created' }),
            expect.objectContaining({ type: 'effect-successor-started' }),
          ],
        });
        expect(target?.attempts).toHaveLength(1);
        expect(target?.effects).toHaveLength(1);
      } finally {
        await db.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  it('authorizes S1 -> S2 only after the first successor is permanently reconciled', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-operator-effect-successor-chain-'),
    );
    const actor = {
      kind: 'packaged-operator',
      id: OPERATOR_REVISION_ID,
    };
    try {
      const fixture = await seedApplicationStateRecoveryRun(root, {
        effectStates: ['STARTED'],
      });
      const recovered = await recoverExecutionLedgerRun({
        runId: fixture.runId,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: fixture.applicationStateConfiguration,
      });
      if (!recovered) throw new Error('Expected uncertain source recovery.');
      const sourceEffect = recovered.view.effects[0];
      const sourceReconciled = await reconcileExecutionLedgerEffect({
        runId: fixture.runId,
        effectId: sourceEffect.effectId,
        reconciliationId: 'successor-chain-source-not-applied',
        actor,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: fixture.applicationStateConfiguration,
      });
      if (!sourceReconciled) {
        throw new Error('Expected not-applied source reconciliation.');
      }

      /** @type {Record<string, any> | undefined} */
      let firstHandoff;
      /** @type {Record<string, any> | null | undefined} */
      let firstBlocked;
      const { db, ledger } = createLmdbLedger(fixture.configuration);
      const applicationDb = await createApplicationStateDBClient('lmdb', {
        path: fixture.applicationStateConfiguration.storePath,
      });
      try {
        const catalog = await createBuiltinManagedEffectCatalog({
          db: applicationDb,
          appId: fixture.appId,
          adapterName: 'lmdb',
        });
        const handoff = await ledger.authorizeManagedEffectSuccessorRetry({
          sourceRunId: fixture.runId,
          sourceEffectId: sourceEffect.effectId,
          successorId: 'successor-chain-one',
          reason: { kind: 'successor-chain-test' },
          actor,
        });
        firstHandoff = handoff;
        let adapterCalls = 0;
        const failingCatalog = {
          ...catalog,
          /** @param {Record<string, any>} frame */
          resolve(frame) {
            const adapter = catalog.resolve(frame);
            return Object.freeze({
              ...adapter,
              async execute() {
                adapterCalls += 1;
                throw new Error('simulated first-successor adapter failure');
              },
            });
          },
        };
        const firstExecution = await executeManagedEffectSuccessorRun({
          ledger,
          authorization: handoff.authorization,
          request: handoff.request,
          catalog: failingCatalog,
          actor,
          createFencingToken: () => 'successor-chain-one-fence',
        });
        expect(firstExecution.outcome).toMatchObject({
          disposition: 'blocked',
        });
        expect(adapterCalls).toBe(1);
        const blocked = await ledger.rebuildRun(
          handoff.authorization.target.runId,
        );
        if (!blocked) {
          throw new Error('Expected a blocked first managed-effect successor.');
        }
        firstBlocked = blocked;
        expect(firstBlocked).toMatchObject({
          run: { status: RunStatus.BLOCKED },
          invocations: [
            expect.objectContaining({ status: InvocationStatus.UNCERTAIN }),
          ],
          attempts: [
            expect.objectContaining({ status: AttemptStatus.ABANDONED }),
          ],
          effects: [
            expect.objectContaining({ status: EffectStatus.UNCERTAIN }),
          ],
        });
      } finally {
        await applicationDb.close();
        await db.close();
      }
      if (!firstHandoff || !firstBlocked) {
        throw new Error('Expected a blocked first managed-effect successor.');
      }

      const firstReconciled = await reconcileExecutionLedgerEffect({
        runId: firstHandoff.authorization.target.runId,
        effectId: firstHandoff.authorization.target.effectId,
        reconciliationId: 'successor-chain-one-not-applied',
        actor,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: fixture.applicationStateConfiguration,
      });
      if (!firstReconciled) {
        throw new Error('Expected first-successor destination reconciliation.');
      }
      expect(firstReconciled).toMatchObject({
        reconciliation: { status: EffectStatus.NOT_APPLIED },
        view: {
          run: { status: RunStatus.FAILED },
          invocations: [
            expect.objectContaining({ status: InvocationStatus.FAILED }),
          ],
          attempts: [
            expect.objectContaining({ status: AttemptStatus.ABANDONED }),
          ],
          effects: [
            expect.objectContaining({ status: EffectStatus.NOT_APPLIED }),
          ],
        },
      });

      const second = await retryExecutionLedgerEffect({
        runId: firstHandoff.authorization.target.runId,
        effectId: firstHandoff.authorization.target.effectId,
        successorId: 'successor-chain-two',
        reason: 'second successor after permanent first not-applied decision',
        actor,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: fixture.applicationStateConfiguration,
      });
      if (!second) throw new Error('Expected second managed-effect successor.');
      expect(second).toMatchObject({
        successor: {
          successorId: 'successor-chain-two',
          authorizationApplied: true,
          sourceEffectId: firstHandoff.authorization.target.effectId,
          targetDisposition: 'completed',
        },
        sourceView: {
          run: { status: RunStatus.FAILED },
          attempts: [
            expect.objectContaining({ status: AttemptStatus.ABANDONED }),
          ],
          effects: [
            expect.objectContaining({ status: EffectStatus.NOT_APPLIED }),
          ],
        },
        targetView: {
          run: { status: RunStatus.COMPLETED },
          invocations: [
            expect.objectContaining({ status: InvocationStatus.COMPLETED }),
          ],
          effects: [
            expect.objectContaining({ status: EffectStatus.COMPLETED }),
          ],
        },
      });
      expect(second.sourceView.attempts).toEqual(firstReconciled.view.attempts);
      expect(second.sourceView.effects).toEqual(firstReconciled.view.effects);
      expect(second.targetView.run.trigger).toMatchObject({
        kind: 'effect-successor',
        source: {
          runId: firstHandoff.authorization.target.runId,
          effectId: firstHandoff.authorization.target.effectId,
          reconciliationId: 'successor-chain-one-not-applied',
          disposition: EffectStatus.NOT_APPLIED,
        },
      });

      const replay = await retryExecutionLedgerEffect({
        runId: firstHandoff.authorization.target.runId,
        effectId: firstHandoff.authorization.target.effectId,
        successorId: 'successor-chain-two',
        reason: 'second successor after permanent first not-applied decision',
        actor,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: fixture.applicationStateConfiguration,
      });
      expect(replay).toMatchObject({
        successor: {
          successorId: 'successor-chain-two',
          authorizationApplied: false,
          targetDisposition: 'completed',
        },
        sourceView: second.sourceView,
        targetView: second.targetView,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  it('reconciles an uncertain effect from a late permanent receipt without resolving its attempt', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-operator-effect-late-receipt-'),
    );
    const reconciliationId = 'late-receipt-reconciliation';
    try {
      const fixture = await seedApplicationStateRecoveryRun(root, {
        effectStates: ['STARTED'],
      });
      const recovered = await recoverExecutionLedgerRun({
        runId: fixture.runId,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: fixture.applicationStateConfiguration,
      });
      if (!recovered) throw new Error('Expected uncertain recovery result.');
      const before = recovered.view;
      const effect = before.effects[0];
      const attempt = before.attempts[0];

      const { db, ledger } = createLmdbLedger(fixture.configuration, {
        readOnly: true,
      });
      const applicationDb = await createApplicationStateDBClient('lmdb', {
        path: fixture.applicationStateConfiguration.storePath,
      });
      try {
        const delivery = await ledger.readManagedEffectDelivery(
          fixture.runId,
          effect.invocationId,
          effect.effectId,
        );
        if (!delivery) throw new Error('Expected uncertain effect delivery.');
        const request = applicationStateEffectRequest(
          attempt.attemptId,
          effect.effectId,
          effect.requestedBy.protocolSequence,
        );
        const catalog = await createBuiltinManagedEffectCatalog({
          db: applicationDb,
          appId: fixture.appId,
          adapterName: 'lmdb',
        });
        await expect(
          catalog.resolve(request).execute({
            destinationEffectId: effect.destinationEffectId,
            destination: effect.destination,
            identity: {
              runId: fixture.runId,
              invocationId: effect.invocationId,
              attemptId: attempt.attemptId,
              effectId: effect.effectId,
            },
            request,
          }),
        ).resolves.toMatchObject({ ok: true, result: { inserted: true } });
      } finally {
        await db.close();
        await applicationDb.close();
      }

      const result = await reconcileExecutionLedgerEffect({
        runId: fixture.runId,
        effectId: effect.effectId,
        reconciliationId,
        actor: { kind: 'packaged-operator', id: OPERATOR_REVISION_ID },
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: fixture.applicationStateConfiguration,
      });
      if (!result) throw new Error('Expected late-receipt reconciliation.');
      expect(result.reconciliation).toEqual({
        reconciliationId,
        effectId: effect.effectId,
        status: EffectStatus.COMPLETED,
        changed: true,
      });
      expect(result.view.run.status).toBe(RunStatus.BLOCKED);
      expect(result.view.invocations[0].status).toBe(
        InvocationStatus.UNCERTAIN,
      );
      expect(result.view.attempts).toEqual(before.attempts);
      expect(result.view.effects[0]).toMatchObject({
        status: EffectStatus.COMPLETED,
        terminal: { ok: true },
        reconciliation: {
          reconciliationId,
          resolutionStatus: EffectStatus.COMPLETED,
        },
      });
      expect(result.view.events.at(-1)).toMatchObject({
        type: 'uncertain-effect-reconciled',
        actor: { kind: 'packaged-operator', id: OPERATOR_REVISION_ID },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  it('refuses an unsupported STARTED effect during read-only preflight', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-operator-effect-unsupported-started-'),
    );
    try {
      const fixture = await seedApplicationStateRecoveryRun(root, {
        effectStates: ['STARTED'],
        overrideStartedContract: true,
      });
      const missingStorePath = path.join(root, 'must-remain-absent');
      const before = await readLmdbRun(fixture.configuration, fixture.runId);
      await expect(
        recoverExecutionLedgerRun({
          runId: fixture.runId,
          expectedAppId: fixture.appId,
          configuration: fixture.configuration,
          applicationStateConfiguration: Object.freeze({
            ...fixture.applicationStateConfiguration,
            storePath: missingStorePath,
          }),
        }),
      ).rejects.toThrow(/not the exact built-in LMDB application-state/i);
      expect(existsSync(missingStorePath)).toBe(false);
      await expect(
        readLmdbRun(fixture.configuration, fixture.runId),
      ).resolves.toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it('leaves a STARTED effect unchanged when the configured application-state store is missing', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-operator-effect-missing-store-'),
    );
    try {
      const fixture = await seedApplicationStateRecoveryRun(root, {
        commitReceipt: true,
      });
      const missingStorePath = path.join(root, 'missing-application-state');
      const before = await readLmdbRun(fixture.configuration, fixture.runId);
      await expect(
        recoverExecutionLedgerRun({
          runId: fixture.runId,
          configuration: fixture.configuration,
          applicationStateConfiguration: Object.freeze({
            ...fixture.applicationStateConfiguration,
            storePath: missingStorePath,
          }),
        }),
      ).rejects.toThrow(/read-only local volume does not exist/i);
      expect(existsSync(missingStorePath)).toBe(false);
      await expect(
        readLmdbRun(fixture.configuration, fixture.runId),
      ).resolves.toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it('does not materialize a missing application-state store while reconciling an uncertain effect', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-operator-reconcile-missing-store-'),
    );
    try {
      const fixture = await seedApplicationStateRecoveryRun(root, {
        effectStates: ['STARTED'],
      });
      const recovered = await recoverExecutionLedgerRun({
        runId: fixture.runId,
        expectedAppId: fixture.appId,
        configuration: fixture.configuration,
        applicationStateConfiguration: fixture.applicationStateConfiguration,
      });
      if (!recovered) throw new Error('Expected uncertain recovery result.');
      expect(recovered.view.effects[0].status).toBe(EffectStatus.UNCERTAIN);

      const missingStorePath = path.join(root, 'missing-reconciliation-store');
      const before = await readLmdbRun(fixture.configuration, fixture.runId);
      await expect(
        reconcileExecutionLedgerEffect({
          runId: fixture.runId,
          effectId: recovered.view.effects[0].effectId,
          reconciliationId: 'missing-store-reconciliation',
          expectedAppId: fixture.appId,
          configuration: fixture.configuration,
          applicationStateConfiguration: Object.freeze({
            ...fixture.applicationStateConfiguration,
            storePath: missingStorePath,
          }),
        }),
      ).rejects.toThrow(/read-only local volume does not exist/i);
      expect(existsSync(missingStorePath)).toBe(false);
      await expect(
        readLmdbRun(fixture.configuration, fixture.runId),
      ).resolves.toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it('does not materialize a missing local store during inspection, recovery, or reconciliation', async () => {
    const parent = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-operator-missing-'),
    );
    const root = path.join(parent, 'absent-control-store');
    const configuration = createConfiguration(root, 'operator-missing');
    const runId = createManualLedgerRunId({
      appId: 'application-a',
      idempotencyKey: 'missing-run',
    });
    try {
      await expect(
        inspectExecutionLedgerRun({ runId, configuration }),
      ).resolves.toBeNull();
      await expect(
        recoverExecutionLedgerRun({ runId, configuration }),
      ).resolves.toBeNull();
      await expect(
        reconcileExecutionLedgerRun({
          runId,
          reconciliationId: 'missing-run-reconciliation',
          evidence: {},
          configuration,
        }),
      ).resolves.toBeNull();
      expect(existsSync(root)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('does not let packaged recovery or reconciliation downgrade to an unfenced adapter', async () => {
    const parent = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-operator-adapter-'),
    );
    const root = path.join(parent, 'absent-control-store');
    const configuration = createConfiguration(root, 'operator-adapter');
    const runId = createManualLedgerRunId({
      appId: 'application-a',
      idempotencyKey: 'unfenced-adapter',
    });
    try {
      await expect(
        recoverExecutionLedgerRun({
          runId,
          requireLocalOwnership: true,
          configuration,
        }),
      ).rejects.toThrow(/requires the LMDB control adapter/i);
      await expect(
        reconcileExecutionLedgerRun({
          runId,
          reconciliationId: 'unfenced-adapter-reconciliation',
          evidence: {},
          requireLocalOwnership: true,
          configuration,
        }),
      ).rejects.toThrow(/requires the LMDB control adapter/i);
      await expect(
        retryExecutionLedgerEffect({
          runId,
          effectId: 'effect-1',
          successorId: 'successor-1',
          configuration,
        }),
      ).rejects.toThrow(/requires the LMDB local-owner protocol/i);
      expect(existsSync(root)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
