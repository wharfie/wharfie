/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import createLMDB from '../../../src/core/lib/db/adapters/lmdb.js';
import createVanillaDB from '../../../src/core/lib/db/adapters/vanilla.js';
import {
  createApplicationStateDBClient,
  resolveExecutionPayloadStoreId,
} from '../../../src/core/lib/config/db.js';
import {
  AttemptStatus,
  EffectStatus,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../../src/core/lib/db/tables/execution-ledger.js';
import { createLedgerServiceOwnership } from '../../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { createLocalExecutionPayloadStore } from '../../../src/core/lib/payload-store/local.js';
import { ActivityProtocolTranscriptValidator } from '../../../src/core/runtime/activity-protocol.js';
import {
  APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS,
  APPLICATION_STATE_RECONCILIATION_VERIFIER_DESCRIPTOR,
} from '../../../src/core/runtime/effects/application-state.js';
import {
  createBuiltinManagedEffectCatalog,
  createBuiltinManagedEffectReconciliationCatalog,
} from '../../../src/core/runtime/effects/builtin-catalog.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
} from '../../../src/core/runtime/manual-ledger-run.js';
import { acquireLocalLedgerServiceSession } from '../../../src/core/runtime/services/ledger-service.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const binPath = path.join(repoRoot, 'bin', 'wharfie');
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const SOURCE_EFFECT_ID = 'remember-source-setting';

/**
 * @param {string} dbPath - Shared local control-store root.
 * @returns {ReturnType<typeof createLocalExecutionPayloadStore>} - Matching CLI payload store.
 */
function createPayloadStore(dbPath) {
  const payloadPath = path.join(dbPath, 'execution-payloads');
  return createLocalExecutionPayloadStore({
    path: payloadPath,
    storeId: resolveExecutionPayloadStoreId(payloadPath),
  });
}

/**
 * @param {string[]} args - CLI arguments.
 * @param {Record<string, string | undefined>} env - Child environment.
 * @param {string} cwd - Child working directory.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} - Child result.
 */
function runCli(args, env, cwd) {
  return /** @type {import('node:child_process').SpawnSyncReturns<string>} */ (
    spawnSync(process.execPath, [binPath, ...args], {
      cwd,
      encoding: 'utf8',
      env,
    })
  );
}

/**
 * @param {Readonly<Record<string, any>>} start - Exact durable start frame.
 * @param {any} result - Secret-bearing completed terminal result.
 * @returns {Record<string, any>} - Valid terminal evidence.
 */
function completedEvidence(start, result) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId: start.attemptId,
    sequence: 1,
    result,
  });
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, terminal],
    transcript: transcript.snapshot(),
  };
}

/**
 * @param {string} attemptId - Durable source attempt ID.
 * @returns {Record<string, any>} - The finite application-state V2 request eligible for successor retry.
 */
function applicationStateEffectRequest(attemptId) {
  return {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'effect-request',
    attemptId,
    sequence: 1,
    effectId: SOURCE_EFFECT_ID,
    capability: 'application-state',
    operation: 'put-if-absent',
    input: {
      key: 'settings/source-cli-proof',
      value: { credential: 'source-cli-state-secret' },
    },
    requestedReplayProperties: ['idempotent', 'transactional'],
  };
}

/**
 * Seed the exact retained NOT_APPLIED source state accepted by retry-effect.
 * @param {string} dbPath - Durable LMDB control root.
 * @param {string} applicationStatePath - Separate durable application-state root.
 * @param {string} tableName - Execution-ledger table name.
 * @returns {Promise<{appId: string, runId: string, effectId: string, destinationEffectId: string}>} - Retryable source identity.
 */
async function createRetryableApplicationStateEffect(
  dbPath,
  applicationStatePath,
  tableName,
) {
  const appId = 'source-cli-effect-successor';
  const runId = createManualLedgerRunId({
    appId,
    idempotencyKey: 'public-retry-effect-proof',
  });
  const actor = { kind: 'local', id: 'source-cli-fixture' };
  const db = createLMDB({ path: dbPath });
  const applicationDb = await createApplicationStateDBClient('lmdb', {
    path: applicationStatePath,
  });
  const ledger = createExecutionLedger({
    db,
    tableName,
    payloadStore: createPayloadStore(dbPath),
    effectEvidenceVerifiers: [...APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS],
  });
  try {
    const catalog = await createBuiltinManagedEffectCatalog({
      db: applicationDb,
      appId,
      adapterName: 'lmdb',
    });
    const reconciliationCatalog =
      await createBuiltinManagedEffectReconciliationCatalog({
        db: applicationDb,
        appId,
        adapterName: 'lmdb',
      });
    const created = await ledger.createManualRun({
      runId,
      appId,
      revisionId: REVISION_ID,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      activityId: 'source-handler-must-not-replay',
      input: { credential: 'source-cli-input-secret' },
      callerMetadata: { credential: 'source-cli-caller-secret' },
      transitionId: 'create',
      actor,
    });
    const claimed = await ledger.claimInvocation({
      runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      fencingToken: 'source-cli-fence-secret',
      expectedGeneration: 0,
      expectedVersion: created.run.version,
      transitionId: 'claim',
      actor,
    });
    const started = await ledger.markAttemptStarted({
      runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      attemptId: claimed.attempt.attemptId,
      fencingToken: claimed.attempt.fencingToken,
      generation: claimed.attempt.generation,
      expectedVersion: claimed.run.version,
      transitionId: 'start',
      actor,
    });
    const request = applicationStateEffectRequest(started.attempt.attemptId);
    const adapter = catalog.resolve(request);
    const requested = await ledger.recordManagedEffectRequest({
      runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      attemptId: started.attempt.attemptId,
      fencingToken: started.attempt.fencingToken,
      generation: started.attempt.generation,
      expectedVersion: started.run.version,
      transitionId: 'effect-request',
      request,
      adapter: adapter.descriptor,
      destination: adapter.destination,
      verifier: adapter.verifier,
      substantiatedReplayProperties: adapter.substantiatedReplayProperties,
      actor,
    });
    const effectStarted = await ledger.markManagedEffectStarted({
      runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      attemptId: started.attempt.attemptId,
      effectId: SOURCE_EFFECT_ID,
      fencingToken: started.attempt.fencingToken,
      generation: started.attempt.generation,
      expectedVersion: requested.run.version,
      expectedEffectVersion: requested.effect.version,
      transitionId: 'effect-start',
      actor,
    });
    const uncertain = await ledger.markManagedEffectUncertain({
      runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      attemptId: started.attempt.attemptId,
      effectId: SOURCE_EFFECT_ID,
      fencingToken: started.attempt.fencingToken,
      generation: started.attempt.generation,
      expectedVersion: effectStarted.run.version,
      expectedEffectVersion: effectStarted.effect.version,
      transitionId: 'effect-uncertain',
      reason: {
        kind: 'source-cli-test-uncertain',
        credential: 'source-cli-uncertainty-secret',
      },
      actor,
    });
    const destination = await reconciliationCatalog.reconcileEffect({
      destinationEffectId: uncertain.effect.destinationEffectId,
      destination: uncertain.effect.destination,
      identity: {
        runId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        effectId: SOURCE_EFFECT_ID,
      },
      request,
    });
    if (destination.kind !== 'not-applied') {
      throw new Error('Expected a permanent not-applied source decision.');
    }
    const reconciled = await ledger.reconcileUncertainManagedEffect({
      runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      attemptId: uncertain.attempt.attemptId,
      effectId: SOURCE_EFFECT_ID,
      fencingToken: uncertain.attempt.fencingToken,
      generation: uncertain.attempt.generation,
      coordinatorEpoch: uncertain.attempt.coordinatorEpoch,
      expectedVersion: uncertain.run.version,
      expectedEffectVersion: uncertain.effect.version,
      uncertaintyEventId: uncertain.receipt.event_id,
      uncertaintySequence: uncertain.receipt.sequence,
      transitionId: 'effect-not-applied',
      reconciliationId: 'source-cli-not-applied',
      reason: {
        kind: 'source-cli-test-not-applied',
        credential: 'source-cli-reconciliation-secret',
      },
      resolution: {
        kind: 'not-applied',
        verifier: APPLICATION_STATE_RECONCILIATION_VERIFIER_DESCRIPTOR,
        evidence: destination.evidence,
      },
      actor,
    });
    if (reconciled.effect.status !== EffectStatus.NOT_APPLIED) {
      throw new Error('Expected a retryable NOT_APPLIED source effect.');
    }
    return {
      appId,
      runId,
      effectId: SOURCE_EFFECT_ID,
      destinationEffectId: reconciled.effect.destinationEffectId,
    };
  } finally {
    await applicationDb.close();
    await db.close();
  }
}

/**
 * @param {string} dbPath - Control-store directory.
 * @param {string} tableName - Ledger table name.
 * @param {{appId: string, idempotencyKey: string, started?: boolean, completed?: boolean, uncertain?: boolean}} options - Persisted run shape.
 * @param {(options: {path: string}) => import('../../../src/core/lib/db/base.js').DBClient} [createDB] - Local test adapter factory.
 * @returns {Promise<{runId: string, attemptId: string, evidence?: Record<string, any>}>} - Durable run identity and optional reconciliation evidence.
 */
async function createManualRun(
  dbPath,
  tableName,
  options,
  createDB = createVanillaDB,
) {
  const db = createDB({ path: dbPath });
  const ledger = createExecutionLedger({
    db,
    tableName,
    payloadStore: createPayloadStore(dbPath),
  });
  const runId = createManualLedgerRunId({
    appId: options.appId,
    idempotencyKey: options.idempotencyKey,
  });
  try {
    await ledger.createManualRun({
      runId,
      appId: options.appId,
      revisionId: REVISION_ID,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      activityId: 'work',
      input: { credential: 'input-secret' },
      callerMetadata: { credential: 'caller-secret' },
      transitionId: 'create',
      actor: { kind: 'local', id: 'cli' },
    });
    const claim = await ledger.claimInvocation({
      runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      fencingToken: 'fence-secret',
      expectedGeneration: 0,
      expectedVersion: 1,
      transitionId: 'claim:1',
      actor: { kind: 'local', id: 'cli' },
    });
    if (!claim.attempt) throw new Error('Expected durable manual attempt');
    if (options.started === true) {
      const started = await ledger.markAttemptStarted({
        runId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        attemptId: claim.attempt.attemptId,
        fencingToken: 'fence-secret',
        generation: claim.attempt.generation,
        expectedVersion: claim.run.version,
        transitionId: `start:${claim.attempt.attemptId}`,
        actor: { kind: 'local', id: 'cli' },
      });
      if (options.completed === true) {
        await ledger.commitVerifiedAttemptTerminal({
          runId,
          invocationId: MANUAL_LEDGER_INVOCATION_ID,
          attemptId: claim.attempt.attemptId,
          fencingToken: 'fence-secret',
          generation: claim.attempt.generation,
          expectedVersion: started.run.version,
          transitionId: `terminal:${claim.attempt.attemptId}`,
          actor: { kind: 'local', id: 'cli' },
          evidence: completedEvidence(started.startFrame, {
            credential: 'terminal-secret',
          }),
        });
      }
      if (options.uncertain === true) {
        const evidence = completedEvidence(started.startFrame, {
          credential: 'reconciliation-terminal-secret',
        });
        await ledger.markAttemptUncertain({
          runId,
          invocationId: MANUAL_LEDGER_INVOCATION_ID,
          attemptId: claim.attempt.attemptId,
          fencingToken: 'fence-secret',
          generation: claim.attempt.generation,
          expectedVersion: started.run.version,
          transitionId: `uncertain:${claim.attempt.attemptId}`,
          actor: { kind: 'local', id: 'cli' },
          coordinatorEpoch: 0,
          reason: {
            kind: 'test-uncertain-attempt',
            credential: 'uncertainty-secret',
          },
        });
        return { runId, attemptId: claim.attempt.attemptId, evidence };
      }
    }
    return { runId, attemptId: claim.attempt.attemptId };
  } finally {
    await db.close();
  }
}

/**
 * @param {string} dbPath - Control-store directory.
 * @param {string} tableName - Ledger table name.
 * @param {string} runId - Durable run ID.
 * @param {(options: {path: string}) => import('../../../src/core/lib/db/base.js').DBClient} [createDB] - Local test adapter factory.
 * @returns {Promise<Record<string, any> | null>} - Verified current view.
 */
async function readRun(dbPath, tableName, runId, createDB = createVanillaDB) {
  const db = createDB({ path: dbPath });
  try {
    return await createExecutionLedger({
      db,
      tableName,
      payloadStore: createPayloadStore(dbPath),
      effectEvidenceVerifiers: [...APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS],
    }).rebuildRun(runId);
  } finally {
    await db.close();
  }
}

describe('ledger-native operator commands', () => {
  it('refuses a recovery mutation while its application resident session is active', async () => {
    const dbPath = mkdtempSync(path.join(os.tmpdir(), 'wharfie-ops-owner-'));
    const emptyDir = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-owner-no-manifest-'),
    );
    const tableName = 'operator-owner-test';
    const appId = 'source-free-owner-operator';
    const sessionRoot = path.join(dbPath, 'ledger-service-sessions');
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
      WHARFIE_CONTROL_ADAPTER: 'lmdb',
      WHARFIE_CONTROL_PATH: dbPath,
      WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(dbPath, 'execution-payloads'),
      WHARFIE_LEDGER_SERVICE_SESSION_PATH: sessionRoot,
    };
    const { runId } = await createManualRun(
      dbPath,
      tableName,
      {
        appId,
        idempotencyKey: 'blocked-recovery',
      },
      createLMDB,
    );
    const ownerDb = createLMDB({ path: dbPath });
    const ownership = createLedgerServiceOwnership({ db: ownerDb, tableName });
    const owner = await acquireLocalLedgerServiceSession({
      appId,
      ownership,
      ownerKind: 'resident',
      sessionRoot,
    });

    try {
      const result = runCli(
        ['ops', 'recover', '--run-id', runId, '--confirm-runner-stopped'],
        env,
        emptyDir,
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'Local service session is already active',
      );
      await expect(
        createExecutionLedger({
          db: ownerDb,
          tableName,
          payloadStore: createPayloadStore(dbPath),
        }).rebuildRun(runId),
      ).resolves.toMatchObject({
        attempts: [expect.objectContaining({ status: AttemptStatus.CLAIMED })],
      });
    } finally {
      await owner.release();
      await ownerDb.close();
      rmSync(dbPath, { recursive: true, force: true });
      rmSync(emptyDir, { recursive: true, force: true });
    }
  }, 20000);

  it('refuses evidence reconciliation while its application resident session is active', async () => {
    const dbPath = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-reconcile-owner-'),
    );
    const emptyDir = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-reconcile-owner-no-manifest-'),
    );
    const tableName = 'operator-reconcile-owner-test';
    const appId = 'source-free-reconcile-owner-operator';
    const sessionRoot = path.join(dbPath, 'ledger-service-sessions');
    const evidenceFile = path.join(emptyDir, 'host-evidence.json');
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
      WHARFIE_CONTROL_ADAPTER: 'lmdb',
      WHARFIE_CONTROL_PATH: dbPath,
      WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(dbPath, 'execution-payloads'),
      WHARFIE_LEDGER_SERVICE_SESSION_PATH: sessionRoot,
    };
    const { runId, evidence } = await createManualRun(
      dbPath,
      tableName,
      {
        appId,
        idempotencyKey: 'blocked-reconciliation',
        started: true,
        uncertain: true,
      },
      createLMDB,
    );
    writeFileSync(evidenceFile, JSON.stringify(evidence), 'utf8');
    const ownerDb = createLMDB({ path: dbPath });
    const ownership = createLedgerServiceOwnership({ db: ownerDb, tableName });
    const owner = await acquireLocalLedgerServiceSession({
      appId,
      ownership,
      ownerKind: 'resident',
      sessionRoot,
    });

    try {
      const result = runCli(
        [
          'ops',
          'reconcile',
          '--run-id',
          runId,
          '--reconciliation-id',
          'blocked-owner-reconciliation',
          '--evidence-file',
          evidenceFile,
          '--confirm-runner-stopped',
        ],
        env,
        emptyDir,
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'Local service session is already active',
      );
      await expect(
        createExecutionLedger({
          db: ownerDb,
          tableName,
          payloadStore: createPayloadStore(dbPath),
        }).rebuildRun(runId),
      ).resolves.toMatchObject({
        run: { status: RunStatus.BLOCKED },
        invocations: [
          expect.objectContaining({ status: InvocationStatus.UNCERTAIN }),
        ],
        attempts: [
          expect.objectContaining({ status: AttemptStatus.ABANDONED }),
        ],
      });
    } finally {
      await owner.release();
      await ownerDb.close();
      rmSync(dbPath, { recursive: true, force: true });
      rmSync(emptyDir, { recursive: true, force: true });
    }
  }, 20000);

  it('inspects and releases a claimed run without a manifest while redacting payloads', async () => {
    const dbPath = mkdtempSync(path.join(os.tmpdir(), 'wharfie-ops-ledger-'));
    const emptyDir = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-no-manifest-'),
    );
    const tableName = 'operator-ledger-test';
    const appId = 'source-free-operator';
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
      WHARFIE_CONTROL_ADAPTER: 'vanilla',
      WHARFIE_CONTROL_PATH: dbPath,
      WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(dbPath, 'execution-payloads'),
    };

    try {
      const { runId } = await createManualRun(dbPath, tableName, {
        appId,
        idempotencyKey: 'claimed-run',
      });

      const inspected = runCli(
        ['ops', 'inspect', '--run-id', runId, '--json'],
        env,
        emptyDir,
      );
      expect(inspected.status).toBe(0);
      expect(inspected.stderr).toBe('');
      const inspection = JSON.parse(inspected.stdout);
      expect(inspection).toMatchObject({
        schemaVersion: 5,
        kind: 'wharfie.execution-ledger.run',
        integrity: { verified: true },
        run: { runId, appId, status: RunStatus.RUNNING },
        invocations: [
          {
            invocationId: MANUAL_LEDGER_INVOCATION_ID,
            activityId: 'work',
            status: InvocationStatus.RUNNING,
          },
        ],
        attempts: [{ status: AttemptStatus.CLAIMED, generation: 1 }],
        history: [{ type: 'manual-run-created' }, { type: 'attempt-claimed' }],
      });
      const serialized = JSON.stringify(inspection);
      expect(serialized).not.toContain('input-secret');
      expect(serialized).not.toContain('caller-secret');
      expect(serialized).not.toContain('fence-secret');
      expect(serialized).not.toContain('payload');
      expect(serialized).not.toContain('evidence');

      const missingConfirmation = runCli(
        ['ops', 'recover', '--run-id', runId],
        env,
        emptyDir,
      );
      expect(missingConfirmation.status).toBe(1);
      expect(missingConfirmation.stderr).toContain('confirm-runner-stopped');
      const stillClaimed = await readRun(dbPath, tableName, runId);
      expect(stillClaimed?.attempts).toEqual([
        expect.objectContaining({ status: AttemptStatus.CLAIMED }),
      ]);

      const recovered = runCli(
        [
          'ops',
          'recover',
          '--run-id',
          runId,
          '--confirm-runner-stopped',
          '--json',
        ],
        env,
        emptyDir,
      );
      expect(recovered.status).toBe(0);
      expect(recovered.stderr).toBe('');
      expect(JSON.parse(recovered.stdout)).toMatchObject({
        schemaVersion: 5,
        kind: 'wharfie.execution-ledger.recovery',
        recovery: { action: 'released-unstarted-claim', changed: true },
        run: { runId, status: RunStatus.RUNNING },
        invocations: [
          expect.objectContaining({ status: InvocationStatus.RUNNABLE }),
        ],
        attempts: [
          expect.objectContaining({ status: AttemptStatus.ABANDONED }),
        ],
      });

      const repeated = runCli(
        [
          'ops',
          'recover',
          '--run-id',
          runId,
          '--confirm-runner-stopped',
          '--json',
        ],
        env,
        emptyDir,
      );
      expect(repeated.status).toBe(0);
      expect(JSON.parse(repeated.stdout)).toMatchObject({
        recovery: { action: 'none', changed: false },
        invocations: [
          expect.objectContaining({ status: InvocationStatus.RUNNABLE }),
        ],
      });
    } finally {
      rmSync(dbPath, { recursive: true, force: true });
      rmSync(emptyDir, { recursive: true, force: true });
    }
  }, 20000);

  it('redacts completed terminal evidence from inspection and recovery views', async () => {
    const dbPath = mkdtempSync(path.join(os.tmpdir(), 'wharfie-ops-ledger-'));
    const emptyDir = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-no-manifest-'),
    );
    const tableName = 'operator-terminal-ledger-test';
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
      WHARFIE_CONTROL_ADAPTER: 'vanilla',
      WHARFIE_CONTROL_PATH: dbPath,
      WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(dbPath, 'execution-payloads'),
    };

    try {
      const { runId } = await createManualRun(dbPath, tableName, {
        appId: 'source-free-terminal-operator',
        idempotencyKey: 'terminal-run',
        started: true,
        completed: true,
      });

      for (const args of [
        ['ops', 'inspect', '--run-id', runId, '--json'],
        [
          'ops',
          'recover',
          '--run-id',
          runId,
          '--confirm-runner-stopped',
          '--json',
        ],
      ]) {
        const result = runCli(args, env, emptyDir);
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        const view = JSON.parse(result.stdout);
        expect(view.run).toMatchObject({ runId, status: RunStatus.COMPLETED });
        if (view.kind === 'wharfie.execution-ledger.recovery') {
          expect(view.recovery).toEqual({ action: 'none', changed: false });
        }
        const serialized = JSON.stringify(view);
        expect(serialized).not.toContain('input-secret');
        expect(serialized).not.toContain('caller-secret');
        expect(serialized).not.toContain('terminal-secret');
        expect(serialized).not.toContain('fence-secret');
        expect(serialized).not.toContain('transcript');
        expect(serialized).not.toContain('evidence');
      }
    } finally {
      rmSync(dbPath, { recursive: true, force: true });
      rmSync(emptyDir, { recursive: true, force: true });
    }
  }, 20000);

  it('marks a source-free started run uncertain without dispatching application code', async () => {
    const dbPath = mkdtempSync(path.join(os.tmpdir(), 'wharfie-ops-ledger-'));
    const emptyDir = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-no-manifest-'),
    );
    const tableName = 'operator-started-ledger-test';
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
      WHARFIE_CONTROL_ADAPTER: 'vanilla',
      WHARFIE_CONTROL_PATH: dbPath,
      WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(dbPath, 'execution-payloads'),
    };

    try {
      const { runId } = await createManualRun(dbPath, tableName, {
        appId: 'source-free-started-operator',
        idempotencyKey: 'started-run',
        started: true,
      });
      const recovered = runCli(
        [
          'ops',
          'recover',
          '--run-id',
          runId,
          '--confirm-runner-stopped',
          '--json',
        ],
        env,
        emptyDir,
      );
      expect(recovered.status).toBe(0);
      expect(recovered.stderr).toBe('');
      expect(JSON.parse(recovered.stdout)).toMatchObject({
        recovery: { action: 'marked-started-uncertain', changed: true },
        run: { status: RunStatus.BLOCKED },
        invocations: [
          expect.objectContaining({ status: InvocationStatus.UNCERTAIN }),
        ],
        attempts: [
          expect.objectContaining({ status: AttemptStatus.ABANDONED }),
        ],
      });
      const view = await readRun(dbPath, tableName, runId);
      expect(
        view?.events.map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
      ).toEqual([
        'manual-run-created',
        'attempt-claimed',
        'attempt-started',
        'attempt-became-uncertain',
      ]);
    } finally {
      rmSync(dbPath, { recursive: true, force: true });
      rmSync(emptyDir, { recursive: true, force: true });
    }
  }, 20000);

  it('reconciles a source-free uncertain run from a bounded evidence file without leaking it', async () => {
    const dbPath = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-reconcile-'),
    );
    const emptyDir = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-reconcile-no-manifest-'),
    );
    const tableName = 'operator-reconcile-ledger-test';
    const appId = 'source-free-reconciliation-operator';
    const evidenceFile = path.join(emptyDir, 'host-evidence.json');
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
      WHARFIE_CONTROL_ADAPTER: 'vanilla',
      WHARFIE_CONTROL_PATH: dbPath,
      WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(dbPath, 'execution-payloads'),
    };

    try {
      const { runId, evidence } = await createManualRun(dbPath, tableName, {
        appId,
        idempotencyKey: 'reconcile-uncertain-run',
        started: true,
        uncertain: true,
      });
      expect(evidence).toBeDefined();
      writeFileSync(evidenceFile, JSON.stringify(evidence), 'utf8');

      const missingConfirmation = runCli(
        [
          'ops',
          'reconcile',
          '--run-id',
          runId,
          '--reconciliation-id',
          'source-free-reconciliation-1',
          '--evidence-file',
          path.join(emptyDir, 'does-not-need-to-exist.json'),
        ],
        env,
        emptyDir,
      );
      expect(missingConfirmation.status).toBe(1);
      expect(missingConfirmation.stderr).toContain('confirm-runner-stopped');
      await expect(readRun(dbPath, tableName, runId)).resolves.toMatchObject({
        run: { status: RunStatus.BLOCKED },
        invocations: [
          expect.objectContaining({ status: InvocationStatus.UNCERTAIN }),
        ],
      });

      const first = runCli(
        [
          'ops',
          'reconcile',
          '--run-id',
          runId,
          '--reconciliation-id',
          'source-free-reconciliation-1',
          '--evidence-file',
          evidenceFile,
          '--confirm-runner-stopped',
          '--reason',
          'private-reconciliation-reason',
          '--json',
        ],
        env,
        emptyDir,
      );
      expect(first.status).toBe(0);
      expect(first.stderr).toBe('');
      const firstView = JSON.parse(first.stdout);
      expect(firstView).toMatchObject({
        schemaVersion: 5,
        kind: 'wharfie.execution-ledger.reconciliation',
        reconciliation: {
          reconciliationId: 'source-free-reconciliation-1',
          changed: true,
        },
        run: { runId, appId, status: RunStatus.COMPLETED },
        invocations: [
          expect.objectContaining({ status: InvocationStatus.COMPLETED }),
        ],
        attempts: [
          expect.objectContaining({ status: AttemptStatus.ABANDONED }),
        ],
        history: expect.arrayContaining([
          expect.objectContaining({ type: 'uncertain-attempt-reconciled' }),
        ]),
      });
      const serialized = JSON.stringify(firstView);
      expect(serialized).not.toContain('input-secret');
      expect(serialized).not.toContain('caller-secret');
      expect(serialized).not.toContain('fence-secret');
      expect(serialized).not.toContain('uncertainty-secret');
      expect(serialized).not.toContain('reconciliation-terminal-secret');
      expect(serialized).not.toContain('private-reconciliation-reason');
      expect(serialized).not.toContain('evidenceRef');

      const durable = await readRun(dbPath, tableName, runId);
      expect(durable).toMatchObject({
        run: { status: RunStatus.COMPLETED },
        invocations: [
          expect.objectContaining({ status: InvocationStatus.COMPLETED }),
        ],
        attempts: [
          expect.objectContaining({ status: AttemptStatus.ABANDONED }),
        ],
      });
      expect(
        durable?.events.map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
      ).toEqual([
        'manual-run-created',
        'attempt-claimed',
        'attempt-started',
        'attempt-became-uncertain',
        'uncertain-attempt-reconciled',
      ]);

      const replay = runCli(
        [
          'ops',
          'reconcile',
          '--run-id',
          runId,
          '--reconciliation-id',
          'source-free-reconciliation-1',
          '--evidence-file',
          evidenceFile,
          '--confirm-runner-stopped',
          '--reason',
          'private-reconciliation-reason',
          '--json',
        ],
        env,
        emptyDir,
      );
      expect(replay.status).toBe(0);
      expect(JSON.parse(replay.stdout)).toMatchObject({
        kind: 'wharfie.execution-ledger.reconciliation',
        reconciliation: {
          reconciliationId: 'source-free-reconciliation-1',
          changed: false,
        },
        run: { status: RunStatus.COMPLETED },
      });

      const competing = runCli(
        [
          'ops',
          'reconcile',
          '--run-id',
          runId,
          '--reconciliation-id',
          'source-free-reconciliation-2',
          '--evidence-file',
          evidenceFile,
          '--confirm-runner-stopped',
          '--reason',
          'private-reconciliation-reason',
        ],
        env,
        emptyDir,
      );
      expect(competing.status).toBe(1);
      expect(competing.stderr).toMatch(
        /conflict|stale run version|not the retained uncertain attempt/i,
      );
      await expect(readRun(dbPath, tableName, runId)).resolves.toMatchObject({
        run: { status: RunStatus.COMPLETED },
        events: expect.arrayContaining([
          expect.objectContaining({ type: 'uncertain-attempt-reconciled' }),
        ]),
      });
    } finally {
      rmSync(dbPath, { recursive: true, force: true });
      rmSync(emptyDir, { recursive: true, force: true });
    }
  }, 20000);

  it('executes public retry-effect from the source CLI and replays a lost response without executing again', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-effect-successor-'),
    );
    const emptyDir = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-effect-successor-no-manifest-'),
    );
    const dbPath = path.join(root, 'control');
    const applicationStatePath = path.join(root, 'application-state');
    const payloadPath = path.join(dbPath, 'execution-payloads');
    const tableName = 'operator-source-cli-effect-successor';
    const successorId = 'source-cli-successor-1';
    const retryReason = 'source-cli-private-retry-reason';
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
      WHARFIE_CONTROL_ADAPTER: 'lmdb',
      WHARFIE_CONTROL_PATH: dbPath,
      WHARFIE_EXECUTION_PAYLOAD_PATH: payloadPath,
      WHARFIE_LEDGER_SERVICE_SESSION_PATH: path.join(root, 'sessions'),
      WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
      WHARFIE_APPLICATION_STATE_PATH: applicationStatePath,
    };

    try {
      const fixture = await createRetryableApplicationStateEffect(
        dbPath,
        applicationStatePath,
        tableName,
      );
      await expect(
        readRun(dbPath, tableName, fixture.runId, createLMDB),
      ).resolves.toMatchObject({
        run: { appId: fixture.appId, status: RunStatus.BLOCKED },
        invocations: [
          expect.objectContaining({ status: InvocationStatus.UNCERTAIN }),
        ],
        attempts: [
          expect.objectContaining({ status: AttemptStatus.ABANDONED }),
        ],
        effects: [
          expect.objectContaining({
            effectId: fixture.effectId,
            status: EffectStatus.NOT_APPLIED,
          }),
        ],
      });

      const retryArgs = [
        'ops',
        'retry-effect',
        '--run-id',
        fixture.runId,
        '--effect-id',
        fixture.effectId,
        '--successor-id',
        successorId,
        '--confirm-runner-stopped',
        '--reason',
        retryReason,
        '--json',
      ];
      const first = runCli(retryArgs, env, emptyDir);
      expect(first.status).toBe(0);
      expect(first.stderr).toBe('');
      const firstView = JSON.parse(first.stdout);
      expect(firstView).toMatchObject({
        schemaVersion: 5,
        kind: 'wharfie.execution-ledger.effect-successor',
        integrity: { verified: true },
        effectSuccessor: {
          successorId,
          intent: 'retry',
          authorizationApplied: true,
          source: {
            runId: fixture.runId,
            effectId: fixture.effectId,
            status: RunStatus.BLOCKED,
          },
          target: {
            runId: expect.any(String),
            effectId: expect.any(String),
            status: RunStatus.COMPLETED,
            disposition: 'completed',
          },
        },
        source: {
          run: { runId: fixture.runId, status: RunStatus.BLOCKED },
          effects: [
            expect.objectContaining({ status: EffectStatus.NOT_APPLIED }),
          ],
          history: expect.arrayContaining([
            expect.objectContaining({ type: 'effect-successor-authorized' }),
          ]),
        },
        target: {
          run: { status: RunStatus.COMPLETED },
          invocations: [
            expect.objectContaining({ status: InvocationStatus.COMPLETED }),
          ],
          attempts: [
            expect.objectContaining({ status: AttemptStatus.COMPLETED }),
          ],
          effects: [
            expect.objectContaining({ status: EffectStatus.COMPLETED }),
          ],
          history: [
            expect.objectContaining({ type: 'effect-successor-run-created' }),
            expect.objectContaining({ type: 'effect-successor-started' }),
            expect.objectContaining({ type: 'effect-successor-terminal' }),
          ],
        },
      });
      expect(firstView.effectSuccessor.target.runId).not.toBe(fixture.runId);
      expect(firstView.effectSuccessor.target.effectId).not.toBe(
        fixture.effectId,
      );
      for (const secret of [
        'source-cli-input-secret',
        'source-cli-caller-secret',
        'source-cli-fence-secret',
        'source-cli-state-secret',
        'source-cli-uncertainty-secret',
        'source-cli-reconciliation-secret',
        retryReason,
        fixture.destinationEffectId,
        applicationStatePath,
        'destinationEffectId',
        'fencingToken',
        'requestDigest',
        'evidenceRef',
      ]) {
        expect(first.stdout).not.toContain(secret);
      }

      const targetRunId = firstView.effectSuccessor.target.runId;
      const durableSource = await readRun(
        dbPath,
        tableName,
        fixture.runId,
        createLMDB,
      );
      const durableTarget = await readRun(
        dbPath,
        tableName,
        targetRunId,
        createLMDB,
      );
      expect(durableSource).not.toBeNull();
      expect(durableTarget).not.toBeNull();

      // A response-loss replay of a terminal successor must be answered from
      // retained control state. Removing the destination proves that the
      // public source command neither reopens nor re-executes the effect.
      rmSync(applicationStatePath, { recursive: true, force: true });
      const replay = runCli(retryArgs, env, emptyDir);
      expect(replay.status).toBe(0);
      expect(replay.stderr).toBe('');
      const replayView = JSON.parse(replay.stdout);
      expect(replayView).toEqual({
        ...firstView,
        effectSuccessor: {
          ...firstView.effectSuccessor,
          authorizationApplied: false,
        },
      });
      expect(existsSync(applicationStatePath)).toBe(false);
      await expect(
        readRun(dbPath, tableName, fixture.runId, createLMDB),
      ).resolves.toEqual(durableSource);
      await expect(
        readRun(dbPath, tableName, targetRunId, createLMDB),
      ).resolves.toEqual(durableTarget);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(emptyDir, { recursive: true, force: true });
    }
  }, 30000);

  it('exposes the supported ledger operator surface and removes legacy list', () => {
    const env = { ...process.env, NODE_ENV: 'development' };
    const help = runCli(['ops', '--help'], env, repoRoot);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('inspect');
    expect(help.stdout).toContain('recover');
    expect(help.stdout).toContain('reconcile');
    expect(help.stdout).toContain('reconcile-effect');
    expect(help.stdout).toContain('retry-effect');
    expect(help.stdout).toContain('cancel');
    expect(help.stdout).toContain('run');
    expect(help.stdout).not.toContain('list');

    const reconcileEffectHelp = runCli(
      ['ops', 'reconcile-effect', '--help'],
      env,
      repoRoot,
    );
    expect(reconcileEffectHelp.status).toBe(0);
    expect(reconcileEffectHelp.stdout).toContain('--effect-id');
    expect(reconcileEffectHelp.stdout).toContain('--reconciliation-id');
    expect(reconcileEffectHelp.stdout).toContain('--confirm-runner-stopped');

    const retryEffectHelp = runCli(
      ['ops', 'retry-effect', '--help'],
      env,
      repoRoot,
    );
    expect(retryEffectHelp.status).toBe(0);
    expect(retryEffectHelp.stdout).toContain('--run-id');
    expect(retryEffectHelp.stdout).toContain('--effect-id');
    expect(retryEffectHelp.stdout).toContain('--successor-id');
    expect(retryEffectHelp.stdout).toContain('--confirm-runner-stopped');

    const list = runCli(['ops', 'list'], env, repoRoot);
    expect(list.status).toBe(1);
    expect(list.stderr).toMatch(/unknown command/i);

    const cancel = runCli(
      ['ops', 'cancel', '--request-id', 'missing-run-id-request'],
      env,
      repoRoot,
    );
    expect(cancel.status).toBe(1);
    expect(cancel.stderr).toMatch(/cancel requires --run-id/i);

    const reconcile = runCli(
      [
        'ops',
        'reconcile',
        '--reconciliation-id',
        'missing-run-id-reconciliation',
        '--evidence-file',
        'unused.json',
        '--confirm-runner-stopped',
      ],
      env,
      repoRoot,
    );
    expect(reconcile.status).toBe(1);
    expect(reconcile.stderr).toMatch(/reconcile requires --run-id/i);

    const missingEffectConfirmation = runCli(
      [
        'ops',
        'reconcile-effect',
        '--run-id',
        'private-confirmation-run',
        '--effect-id',
        'private-confirmation-effect',
        '--reconciliation-id',
        'private-confirmation-reconciliation',
      ],
      env,
      repoRoot,
    );
    expect(missingEffectConfirmation.status).toBe(1);
    expect(missingEffectConfirmation.stderr).toContain(
      'reconcile-effect requires --confirm-runner-stopped',
    );

    const reconcileEffect = runCli(
      [
        'ops',
        'reconcile-effect',
        '--effect-id',
        'missing-effect',
        '--reconciliation-id',
        'missing-run-effect-reconciliation',
        '--confirm-runner-stopped',
      ],
      env,
      repoRoot,
    );
    expect(reconcileEffect.status).toBe(1);
    expect(reconcileEffect.stderr).toMatch(
      /reconcile-effect requires --run-id/i,
    );
    expect(reconcileEffect.stderr).not.toContain('missing-effect');
    expect(reconcileEffect.stderr).not.toContain(
      'missing-run-effect-reconciliation',
    );

    const retryEffect = runCli(
      [
        'ops',
        'retry-effect',
        '--run-id',
        'private-confirmation-run',
        '--effect-id',
        'private-confirmation-effect',
        '--successor-id',
        'private-confirmation-successor',
      ],
      env,
      repoRoot,
    );
    expect(retryEffect.status).toBe(1);
    expect(retryEffect.stderr).toContain(
      'retry-effect requires --confirm-runner-stopped',
    );

    const legacyRecovery = runCli(['ops', 'run', '--recover'], env, repoRoot);
    expect(legacyRecovery.status).toBe(1);
    expect(legacyRecovery.stderr).toMatch(/unknown option.*recover/i);
  }, 20000);

  it('fails closed for missing runs without creating durable state', async () => {
    const dbPath = mkdtempSync(path.join(os.tmpdir(), 'wharfie-ops-ledger-'));
    const emptyDir = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-no-manifest-'),
    );
    const tableName = 'operator-missing-ledger-test';
    const missingRunId = createManualLedgerRunId({
      appId: 'source-free-missing-operator',
      idempotencyKey: 'missing-run',
    });
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
      WHARFIE_CONTROL_ADAPTER: 'lmdb',
      WHARFIE_CONTROL_PATH: dbPath,
      WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(dbPath, 'execution-payloads'),
    };

    try {
      const inspection = runCli(
        ['ops', 'inspect', '--run-id', missingRunId],
        env,
        emptyDir,
      );
      expect(inspection.status).toBe(1);
      expect(inspection.stderr).toContain('No durable execution-ledger run');

      const recovery = runCli(
        [
          'ops',
          'recover',
          '--run-id',
          missingRunId,
          '--confirm-runner-stopped',
        ],
        env,
        emptyDir,
      );
      expect(recovery.status).toBe(1);
      expect(recovery.stderr).toContain('recovery refuses to create work');

      const cancellation = runCli(
        [
          'ops',
          'cancel',
          '--run-id',
          missingRunId,
          '--request-id',
          'missing-cancellation-request',
        ],
        env,
        emptyDir,
      );
      expect(cancellation.status).toBe(1);
      expect(cancellation.stderr).toContain(
        'cancellation refuses to create work',
      );

      const privateEffectId = 'private-missing-run-effect';
      const privateReconciliationId =
        'private-missing-run-effect-reconciliation';
      const effectReconciliation = runCli(
        [
          'ops',
          'reconcile-effect',
          '--run-id',
          missingRunId,
          '--effect-id',
          privateEffectId,
          '--reconciliation-id',
          privateReconciliationId,
          '--confirm-runner-stopped',
        ],
        env,
        emptyDir,
      );
      expect(effectReconciliation.status).toBe(1);
      expect(effectReconciliation.stderr).toContain(
        'Managed-effect reconciliation could not report a safe result.',
      );
      for (const privateIdentifier of [
        missingRunId,
        privateEffectId,
        privateReconciliationId,
      ]) {
        expect(effectReconciliation.stderr).not.toContain(privateIdentifier);
      }
      expect(
        await readRun(dbPath, tableName, missingRunId, createLMDB),
      ).toBeNull();
    } finally {
      rmSync(dbPath, { recursive: true, force: true });
      rmSync(emptyDir, { recursive: true, force: true });
    }
  }, 20000);
});
