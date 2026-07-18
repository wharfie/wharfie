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

import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import { resolveExecutionPayloadStoreId } from '../../src/core/lib/config/db.js';
import {
  AttemptStatus,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
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
} from '../../src/core/runtime/operator/execution-ledger-operator.js';
import { createExecutionLedgerOperatorView } from '../../src/core/runtime/operator/execution-ledger-view.js';

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
      schemaVersion: 2,
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
