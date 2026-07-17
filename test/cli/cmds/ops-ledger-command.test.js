/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import createVanillaDB from '../../../src/core/lib/db/adapters/vanilla.js';
import {
  AttemptStatus,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../../src/core/lib/db/tables/execution-ledger.js';
import { ActivityProtocolTranscriptValidator } from '../../../src/core/runtime/activity-protocol.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
} from '../../../src/core/runtime/manual-ledger-run.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const binPath = path.join(repoRoot, 'bin', 'wharfie');
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;

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
 * @param {string} dbPath - Vanilla control-store directory.
 * @param {string} tableName - Ledger table name.
 * @param {{appId: string, operationId: string, started?: boolean, completed?: boolean}} options - Persisted run shape.
 * @returns {Promise<{runId: string, attemptId: string}>} - Durable run identity.
 */
async function createManualRun(dbPath, tableName, options) {
  const db = createVanillaDB({ path: dbPath });
  const ledger = createExecutionLedger({ db, tableName });
  const runId = createManualLedgerRunId({
    appId: options.appId,
    operationId: options.operationId,
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
    }
    return { runId, attemptId: claim.attempt.attemptId };
  } finally {
    await db.close();
  }
}

/**
 * @param {string} dbPath - Vanilla control-store directory.
 * @param {string} tableName - Ledger table name.
 * @param {string} runId - Durable run ID.
 * @returns {Promise<Record<string, any> | null>} - Verified current view.
 */
async function readRun(dbPath, tableName, runId) {
  const db = createVanillaDB({ path: dbPath });
  try {
    return await createExecutionLedger({ db, tableName }).rebuildRun(runId);
  } finally {
    await db.close();
  }
}

describe('ledger-native operator commands', () => {
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
    };

    try {
      const { runId } = await createManualRun(dbPath, tableName, {
        appId,
        operationId: 'claimed-run',
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
        schemaVersion: 1,
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
        schemaVersion: 1,
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
    };

    try {
      const { runId } = await createManualRun(dbPath, tableName, {
        appId: 'source-free-terminal-operator',
        operationId: 'terminal-run',
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
    };

    try {
      const { runId } = await createManualRun(dbPath, tableName, {
        appId: 'source-free-started-operator',
        operationId: 'started-run',
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

  it('removes legacy list and cancel commands from the public operator surface', () => {
    const env = { ...process.env, NODE_ENV: 'development' };
    const help = runCli(['ops', '--help'], env, repoRoot);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('inspect');
    expect(help.stdout).toContain('recover');
    expect(help.stdout).toContain('run');
    expect(help.stdout).not.toContain('list');
    expect(help.stdout).not.toContain('cancel');

    for (const command of ['list', 'cancel']) {
      const result = runCli(['ops', command], env, repoRoot);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/unknown command/i);
    }

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
      operationId: 'missing-run',
    });
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
      WHARFIE_CONTROL_ADAPTER: 'vanilla',
      WHARFIE_CONTROL_PATH: dbPath,
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
      expect(await readRun(dbPath, tableName, missingRunId)).toBeNull();
    } finally {
      rmSync(dbPath, { recursive: true, force: true });
      rmSync(emptyDir, { recursive: true, force: true });
    }
  }, 20000);
});
