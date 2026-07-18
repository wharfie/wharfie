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
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import {
  APPLICATION_STATE_ADAPTER_DESCRIPTOR,
  APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS,
} from '../../src/core/runtime/effects/application-state.js';
import { createBuiltinManagedEffectCatalog } from '../../src/core/runtime/effects/builtin-catalog.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
} from '../../src/core/runtime/manual-ledger-run.js';
import {
  ExecutionLedgerOperatorScopeError,
  EXECUTION_LEDGER_RECONCILIATION_EVIDENCE_FILE_MAX_BYTES,
  inspectExecutionLedgerRun,
  readExecutionLedgerReconciliationEvidenceFile,
  reconcileExecutionLedgerRun,
  recoverExecutionLedgerRun,
  recoverStoppedManagedEffectsAtOperatorBoundary,
} from '../../src/core/runtime/operator/execution-ledger-operator.js';
import {
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
      schemaVersion: 4,
      run: {
        cancellationRequest: {
          requestId: 'cancel-request-1',
          requestedAt,
        },
      },
      history: [{ type: 'manual-cancellation-requested' }],
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
        schemaVersion: 4,
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
            version: 1,
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
      expect(existsSync(root)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
