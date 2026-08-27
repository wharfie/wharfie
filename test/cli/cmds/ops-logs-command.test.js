/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import createVanillaDB from '../../../src/core/lib/db/adapters/vanilla.js';
import { resolveExecutionPayloadStoreId } from '../../../src/core/lib/config/db.js';
import { createExecutionLedger } from '../../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../../src/core/lib/payload-store/local.js';

const REPOSITORY_ROOT = path.resolve(
  fileURLToPath(new URL('../../..', import.meta.url)),
);
const BIN_PATH = path.join(REPOSITORY_ROOT, 'bin', 'wharfie');
const APP_ID = 'source-activity-log-demo';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const RUN_ID = 'source-activity-log-run';
const INVOCATION_ID = 'main';
const ACTIVITY_ID = 'rebuild-index';
const FENCING_TOKEN = 'source-activity-log-fence';
const TABLE_NAME = 'source-activity-log-command-test';
const SAFE_FAILURE =
  'Sensitive durable activity logs could not be read safely. No partial page was emitted.';
const CLI_TIMEOUT_MS = 15_000;
const SEEDED_COMMAND_TEST_TIMEOUT_MS = 45_000;

/**
 * @param {string} label
 * @returns {string}
 */
function createTemporaryRoot(label) {
  return mkdtempSync(path.join(os.tmpdir(), label));
}

/**
 * @param {string} controlRoot
 * @returns {ReturnType<typeof createLocalExecutionPayloadStore>}
 */
function createPayloadStore(controlRoot) {
  const payloadPath = path.join(controlRoot, 'execution-payloads');
  return createLocalExecutionPayloadStore({
    path: payloadPath,
    storeId: resolveExecutionPayloadStoreId(payloadPath),
  });
}

/**
 * @param {string} root
 * @returns {Record<string, string>}
 */
function snapshotDirectory(root) {
  /** @type {Record<string, string>} */
  const snapshot = {};
  /** @param {string} directory */
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        snapshot[path.relative(root, absolutePath)] =
          readFileSync(absolutePath).toString('base64');
      }
    }
  }
  visit(root);
  return snapshot;
}

/**
 * @param {string} controlRoot
 * @returns {Promise<{attemptId: string, generation: number, coordinatorEpoch: number}>}
 */
async function seedStartedAttempt(controlRoot) {
  const db = createVanillaDB({ path: controlRoot });
  let observedAt = 1_700_000_000_000;
  const ledger = createExecutionLedger({
    db,
    tableName: TABLE_NAME,
    payloadStore: createPayloadStore(controlRoot),
    now: () => {
      observedAt += 1;
      return observedAt;
    },
  });
  try {
    const created = await ledger.createManualRun({
      appId: APP_ID,
      revisionId: REVISION_ID,
      runId: RUN_ID,
      invocationId: INVOCATION_ID,
      activityId: ACTIVITY_ID,
      input: { credential: 'request-secret' },
      callerMetadata: { credential: 'caller-secret' },
      transitionId: 'create',
      actor: { kind: 'local', id: 'source-logs-fixture' },
    });
    const claimed = await ledger.claimInvocation({
      runId: RUN_ID,
      invocationId: INVOCATION_ID,
      fencingToken: FENCING_TOKEN,
      expectedGeneration: 0,
      expectedVersion: created.run.version,
      transitionId: 'claim',
      actor: { kind: 'local', id: 'source-logs-fixture' },
    });
    const started = await ledger.markAttemptStarted({
      runId: RUN_ID,
      invocationId: INVOCATION_ID,
      attemptId: claimed.attempt.attemptId,
      fencingToken: claimed.attempt.fencingToken,
      generation: claimed.attempt.generation,
      coordinatorEpoch: claimed.attempt.coordinatorEpoch,
      expectedVersion: claimed.run.version,
      transitionId: 'start',
      actor: { kind: 'local', id: 'source-logs-fixture' },
    });
    for (const [index, level] of ['info', 'warn', 'error'].entries()) {
      const sequence = index + 1;
      await ledger.appendActivityAttemptLog({
        appId: APP_ID,
        revisionId: REVISION_ID,
        activityId: ACTIVITY_ID,
        runId: RUN_ID,
        invocationId: INVOCATION_ID,
        attemptId: started.attempt.attemptId,
        fencingToken: started.attempt.fencingToken,
        generation: started.attempt.generation,
        coordinatorEpoch: started.attempt.coordinatorEpoch,
        frame: {
          protocol: 'wharfie.activity',
          protocolVersion: 1,
          type: 'log',
          attemptId: started.attempt.attemptId,
          sequence,
          level,
          message: `raw source log ${sequence}`,
          fields: {
            sequence,
            credential: `unredacted-log-secret-${sequence}`,
          },
        },
      });
    }
    return {
      attemptId: started.attempt.attemptId,
      generation: started.attempt.generation,
      coordinatorEpoch: started.attempt.coordinatorEpoch,
    };
  } finally {
    await db.close();
  }
}

/**
 * @param {string} root
 * @returns {string}
 */
function createAuthoredAppTrap(root) {
  const directory = path.join(root, 'authored-app');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, 'wharfie.app.js'),
    'throw new Error("source application must not be loaded");\n',
  );
  return directory;
}

/**
 * @param {string} root
 * @param {string} controlRoot
 * @param {string} cwd
 * @param {string[]} args
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
function runLogs(root, controlRoot, cwd, args) {
  return spawnSync(process.execPath, [BIN_PATH, 'ops', 'logs', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: CLI_TIMEOUT_MS,
    env: {
      PATH: process.env.PATH,
      HOME: root,
      TMPDIR: root,
      XDG_CONFIG_HOME: path.join(root, 'xdg-config'),
      XDG_DATA_HOME: path.join(root, 'xdg-data'),
      LANG: 'C',
      LC_ALL: 'C',
      NODE_ENV: 'development',
      NO_COLOR: '1',
      WHARFIE_DISABLE_UPDATE_CHECK: '1',
      WHARFIE_CONTROL_ADAPTER: 'vanilla',
      WHARFIE_CONTROL_PATH: controlRoot,
      WHARFIE_EXECUTION_LEDGER_TABLE: TABLE_NAME,
      WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(
        controlRoot,
        'execution-payloads',
      ),
    },
  });
}

/**
 * @param {{attemptId: string, generation: number, coordinatorEpoch: number}} attempt
 * @returns {Record<string, any>}
 */
function exactScope(attempt) {
  return {
    appId: APP_ID,
    revisionId: REVISION_ID,
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    activityId: ACTIVITY_ID,
    attemptId: attempt.attemptId,
    generation: attempt.generation,
    coordinatorEpoch: attempt.coordinatorEpoch,
  };
}

/**
 * @param {number} sequence
 * @param {'trace'|'debug'|'info'|'warn'|'error'} level
 * @returns {Record<string, any>}
 */
function logItem(sequence, level) {
  return {
    sequence,
    acceptedAt: expect.any(Number),
    level,
    message: `raw source log ${sequence}`,
    fields: {
      sequence,
      credential: `unredacted-log-secret-${sequence}`,
    },
  };
}

describe('source sensitive activity-log command', () => {
  it(
    'reads actual retained logs in frozen JSON pages without loading app source or mutating durable bytes',
    async () => {
      const root = createTemporaryRoot('wharfie-ops-logs-');
      try {
        const controlRoot = path.join(root, 'control');
        const authoredApp = createAuthoredAppTrap(root);
        const attempt = await seedStartedAttempt(controlRoot);
        const durableBefore = snapshotDirectory(controlRoot);
        const commonArguments = [
          '--app-id',
          APP_ID,
          '--run-id',
          RUN_ID,
          '--attempt-id',
          attempt.attemptId,
          '--limit',
          '2',
          '--confirm-sensitive-output',
          '--json',
        ];

        const first = runLogs(root, controlRoot, authoredApp, commonArguments);

        expect(first.status).toBe(0);
        expect(first.stderr).toBe('');
        const firstPage = /** @type {Record<string, any>} */ (
          JSON.parse(first.stdout)
        );
        expect(firstPage).toEqual({
          schemaVersion: 1,
          kind: 'wharfie.execution-ledger.activity-log-page',
          authority: 'none',
          authoritative: false,
          disclosure: 'application-sensitive-unredacted',
          integrity: { verified: true },
          scope: exactScope(attempt),
          snapshot: {
            entryCount: 3,
            cumulativePayloadBytes: expect.any(Number),
            lastSequence: 3,
          },
          items: [logItem(1, 'info'), logItem(2, 'warn')],
          nextCursor: expect.any(String),
        });
        expect(first.stdout).toContain('unredacted-log-secret-1');
        expect(first.stdout).not.toContain(FENCING_TOKEN);

        const second = runLogs(root, controlRoot, authoredApp, [
          ...commonArguments,
          '--cursor',
          firstPage.nextCursor,
        ]);

        expect(second.status).toBe(0);
        expect(second.stderr).toBe('');
        expect(JSON.parse(second.stdout)).toEqual({
          schemaVersion: 1,
          kind: 'wharfie.execution-ledger.activity-log-page',
          authority: 'none',
          authoritative: false,
          disclosure: 'application-sensitive-unredacted',
          integrity: { verified: true },
          scope: exactScope(attempt),
          snapshot: firstPage.snapshot,
          items: [logItem(3, 'error')],
          nextCursor: null,
        });
        expect(snapshotDirectory(controlRoot)).toEqual(durableBefore);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    SEEDED_COMMAND_TEST_TIMEOUT_MS,
  );

  it('emits only the fixed safe failure and does not create a missing store', () => {
    const root = createTemporaryRoot('wharfie-ops-logs-missing-');
    try {
      const controlRoot = path.join(root, 'missing-control');
      const authoredApp = createAuthoredAppTrap(root);

      const result = runLogs(root, controlRoot, authoredApp, [
        '--app-id',
        APP_ID,
        '--run-id',
        RUN_ID,
        '--attempt-id',
        'missing-attempt',
        '--confirm-sensitive-output',
        '--json',
      ]);

      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(`${SAFE_FAILURE}\n`);
      expect(existsSync(controlRoot)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
