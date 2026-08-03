/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import createLMDB from '../../../src/core/lib/db/adapters/lmdb.js';
import { resolveExecutionPayloadStoreId } from '../../../src/core/lib/config/db.js';
import { createExecutionLedger } from '../../../src/core/lib/db/tables/execution-ledger.js';
import { createWorkflowRunId } from '../../../src/core/lib/ledger/workflow-execution-contract.js';
import { createLocalExecutionPayloadStore } from '../../../src/core/lib/payload-store/local.js';
import {
  cleanupIsolatedAuthoredAppFixtures,
  createIsolatedAuthoredAppFixture,
} from '../../helpers/isolated-authored-app.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const binPath = path.join(repoRoot, 'bin', 'wharfie');
const authoredHelloWorldDir = path.join(
  repoRoot,
  'scratch',
  'examples',
  'apps',
  'hello-world',
);
const APP_ID = 'hello-world-demo';
const WORKFLOW_ID = 'echo-twice';
const FIRST_STEP_ID = 'echo-first';
/** @type {Array<ReturnType<typeof createIsolatedAuthoredAppFixture>>} */
const authoredAppFixtures = [];

afterEach(() => {
  cleanupIsolatedAuthoredAppFixtures(authoredAppFixtures);
});

/** @returns {string} - Fresh copy of the tracked authored application. */
function createHelloWorldDirectory() {
  const fixture = createIsolatedAuthoredAppFixture(authoredHelloWorldDir, {
    prefix: 'wharfie-ops-workflow-start-app-',
  });
  authoredAppFixtures.push(fixture);
  return fixture.appDir;
}

/**
 * @param {string[]} args - Source CLI arguments.
 * @param {Record<string, string | undefined>} env - Isolated child environment.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} - Child result.
 */
function runCli(args, env) {
  return /** @type {import('node:child_process').SpawnSyncReturns<string>} */ (
    spawnSync(process.execPath, [binPath, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      env,
    })
  );
}

/**
 * @param {import('node:child_process').SpawnSyncReturns<string>} result - Successful JSON command.
 * @param {string} label - Failure context.
 * @returns {Record<string, any>} - Parsed JSON object.
 */
function parseSuccessfulJson(result, label) {
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

/**
 * @param {string} controlPath - Durable control root.
 * @param {string} tableName - Isolated ledger table.
 * @param {string} runId - Exact durable workflow run.
 * @param {string} revisionId - Exact source revision.
 * @returns {Promise<Record<string, any>>} - Durable state relevant to replay safety.
 */
async function readDurableState(controlPath, tableName, runId, revisionId) {
  const db = createLMDB({ path: controlPath, readOnly: true });
  const payloadPath = path.join(controlPath, 'execution-payloads');
  const ledger = createExecutionLedger({
    db,
    tableName,
    payloadStore: createLocalExecutionPayloadStore({
      path: payloadPath,
      storeId: resolveExecutionPayloadStoreId(payloadPath),
    }),
  });
  try {
    return {
      view: await ledger.rebuildRun(runId),
      events: await ledger.getEvents(runId),
      ready: await ledger.listReadyWork({
        appId: APP_ID,
        revisionId,
        observedAt: Number.MAX_SAFE_INTEGER,
        limit: 100,
      }),
    };
  } finally {
    await db.close();
  }
}

/**
 * @param {string} controlPath - Durable control root.
 * @param {string} tableName - Isolated ledger table.
 * @returns {Record<string, string | undefined>} - Complete local CLI environment.
 */
function commandEnvironment(controlPath, tableName) {
  return {
    ...process.env,
    NODE_ENV: 'development',
    WHARFIE_ARTIFACT_BUCKET: 'workflow-start-test-bucket',
    WHARFIE_DB_ADAPTER: 'lmdb',
    WHARFIE_DB_PATH: controlPath,
    WHARFIE_CONTROL_ADAPTER: 'lmdb',
    WHARFIE_CONTROL_PATH: controlPath,
    WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
    WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(
      controlPath,
      'execution-payloads',
    ),
    WHARFIE_LEDGER_SERVICE_SESSION_PATH: path.join(
      controlPath,
      'ledger-service-sessions',
    ),
  };
}

describe('wharfie ops start', () => {
  it('starts, inspects, and exactly replays one all-activity workflow without duplicate work', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-workflow-start-'),
    );
    const helloWorldDir = createHelloWorldDirectory();
    const controlPath = path.join(root, 'control');
    const tableName = 'source-workflow-start';
    const idempotencyKey = 'source-workflow-start-proof';
    const runId = createWorkflowRunId({
      appId: APP_ID,
      idempotencyKey,
    });
    const env = commandEnvironment(controlPath, tableName);
    const startArgs = [
      'ops',
      'start',
      '--workflow',
      WORKFLOW_ID,
      '--idempotency-key',
      idempotencyKey,
      '--dir',
      helloWorldDir,
      '--input',
      '{"message":"workflow-input-secret"}',
      '--caller-metadata',
      '{"requestId":"workflow-caller-secret"}',
      '--json',
    ];

    try {
      const first = parseSuccessfulJson(runCli(startArgs, env), 'ops start');
      expect(first).toEqual({
        schemaVersion: 1,
        kind: 'wharfie.execution-ledger.workflow-start',
        appId: APP_ID,
        runId,
        revisionId: expect.stringMatching(/^wrv1_[A-Za-z0-9_-]{43}$/),
        workflowId: WORKFLOW_ID,
        idempotencyKey,
        reused: false,
        runStatus: 'RUNNING',
        cursor: {
          disposition: 'ACTIVITY_RUNNABLE',
          stepId: FIRST_STEP_ID,
          stepIndex: 0,
        },
        nextActivation: {
          kind: 'activity',
          status: 'RUNNABLE',
        },
      });
      expect(JSON.stringify(first)).not.toContain('workflow-input-secret');
      expect(JSON.stringify(first)).not.toContain('workflow-caller-secret');

      const inspected = parseSuccessfulJson(
        runCli(['ops', 'inspect', '--run-id', runId, '--json'], env),
        'ops inspect',
      );
      expect(inspected).toMatchObject({
        schemaVersion: 8,
        kind: 'wharfie.execution-ledger.run',
        integrity: { verified: true },
        run: {
          runId,
          appId: APP_ID,
          revisionId: first.revisionId,
          trigger: {
            kind: 'workflow',
            workflowId: WORKFLOW_ID,
            planId: expect.any(String),
          },
          status: 'RUNNING',
          version: 1,
          lastSequence: 1,
        },
        invocations: [
          {
            invocationId: expect.any(String),
            activityId: 'echo-event',
            status: 'RUNNABLE',
            generation: 0,
            version: 1,
            lastSequence: 1,
            createdAt: expect.any(Number),
            updatedAt: expect.any(Number),
            workflow: {
              workflowId: WORKFLOW_ID,
              planId: expect.any(String),
              continuationId: expect.any(String),
              stepId: FIRST_STEP_ID,
              stepIndex: 0,
            },
          },
        ],
        attempts: [],
        effects: [],
        history: [
          {
            sequence: 1,
            type: 'workflow-run-created',
            observedAt: expect.any(Number),
            actor: {
              kind: 'workflow-operator',
              id: first.revisionId,
            },
          },
        ],
        workflowCursor: {
          runId,
          appId: APP_ID,
          revisionId: first.revisionId,
          workflowId: WORKFLOW_ID,
          planId: expect.any(String),
          stepId: FIRST_STEP_ID,
          stepIndex: 0,
          continuationId: expect.any(String),
          invocationId: expect.any(String),
          disposition: 'ACTIVITY_RUNNABLE',
          outputs: [],
          version: 1,
          lastSequence: 1,
          createdAt: expect.any(Number),
          updatedAt: expect.any(Number),
        },
      });
      expect(inspected.run.trigger.planId).toBe(
        inspected.workflowCursor.planId,
      );
      expect(inspected.invocations[0].workflow.planId).toBe(
        inspected.workflowCursor.planId,
      );
      expect(inspected.invocations[0].invocationId).toBe(
        inspected.workflowCursor.invocationId,
      );
      const serializedInspection = JSON.stringify(inspected);
      expect(serializedInspection).not.toContain('workflow-input-secret');
      expect(serializedInspection).not.toContain('workflow-caller-secret');
      expect(serializedInspection).not.toContain('planRef');
      expect(serializedInspection).not.toContain('startRef');
      expect(serializedInspection).not.toContain('requestRef');

      const durableBeforeRetry = await readDurableState(
        controlPath,
        tableName,
        runId,
        first.revisionId,
      );
      expect(durableBeforeRetry.view).toMatchObject({
        run: { runId, status: 'RUNNING', version: 1 },
        workflowCursor: {
          stepId: FIRST_STEP_ID,
          stepIndex: 0,
          disposition: 'ACTIVITY_RUNNABLE',
        },
        invocations: [{ status: 'RUNNABLE' }],
        attempts: [],
      });
      expect(durableBeforeRetry.events).toHaveLength(1);
      expect(durableBeforeRetry.ready.items).toEqual([
        expect.objectContaining({
          appId: APP_ID,
          revisionId: first.revisionId,
          runId,
          kind: 'ACTIVITY',
          runVersion: 1,
          lastSequence: 1,
          stepId: FIRST_STEP_ID,
          stepIndex: 0,
          cursorVersion: 1,
        }),
      ]);

      const retry = parseSuccessfulJson(
        runCli(startArgs, env),
        'exact ops start retry',
      );
      expect(retry).toEqual({ ...first, reused: true });
      await expect(
        readDurableState(controlPath, tableName, runId, first.revisionId),
      ).resolves.toEqual(durableBeforeRetry);

      const conflicting = runCli(
        startArgs.map((value) =>
          value === '{"message":"workflow-input-secret"}'
            ? '{"message":"changed-workflow-input"}'
            : value,
        ),
        env,
      );
      expect(conflicting.status).toBe(1);
      expect(conflicting.stdout).toBe('');
      expect(conflicting.stderr).toMatch(
        /already exists|conflict|different|does not match|immutable/i,
      );
      await expect(
        readDurableState(controlPath, tableName, runId, first.revisionId),
      ).resolves.toEqual(durableBeforeRetry);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  it('rejects an unknown workflow before creating the configured control root', () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-workflow-missing-'),
    );
    const helloWorldDir = createHelloWorldDirectory();
    const controlPath = path.join(root, 'must-not-exist');
    const env = commandEnvironment(controlPath, 'missing-workflow');
    try {
      const result = runCli(
        [
          'ops',
          'start',
          '--workflow',
          'not-declared',
          '--idempotency-key',
          'missing-workflow-proof',
          '--dir',
          helloWorldDir,
          '--json',
        ],
        env,
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain("Workflow 'not-declared' was not found");
      expect(result.stderr).toContain(`Available workflows: ${WORKFLOW_ID}`);
      expect(existsSync(controlPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 10000);
});
