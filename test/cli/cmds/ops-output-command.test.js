/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
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
import { ActivityProtocolTranscriptValidator } from '../../../src/core/runtime/activity-protocol.js';

const REPOSITORY_ROOT = path.resolve(
  fileURLToPath(new URL('../../..', import.meta.url)),
);
const BIN_PATH = path.join(REPOSITORY_ROOT, 'bin', 'wharfie');
const APP_ID = 'source-run-output-demo';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const RUN_ID = 'source-run-output-run';
const INVOCATION_ID = 'main';
const ACTIVITY_ID = 'render-report';
const FENCING_TOKEN = 'source-run-output-fence';
const TABLE_NAME = 'source-run-output-command-test';
const SAFE_FAILURE =
  'Sensitive durable run output could not be read safely. No partial output was emitted.';
const SENSITIVE_RESULT = {
  credential: 'unredacted-run-output-secret',
  message:
    '\u001b]8;;https://attacker.invalid\u0007label\u001b]8;;\u0007\n\u009b31m\u202e',
  nested: { complete: true },
};

/** @type {Set<string>} */
const temporaryDirectories = new Set();

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

/**
 * @param {string} label
 * @returns {string}
 */
function createTemporaryRoot(label) {
  const root = mkdtempSync(path.join(os.tmpdir(), label));
  temporaryDirectories.add(root);
  return root;
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
 * @param {Readonly<Record<string, any>>} start
 * @returns {Record<string, any>}
 */
function completedEvidence(start) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId: start.attemptId,
    sequence: 1,
    result: SENSITIVE_RESULT,
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
 * @param {string} controlRoot
 * @returns {Promise<{version: number, lastSequence: number}>}
 */
async function seedCompletedRun(controlRoot) {
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
      actor: { kind: 'local', id: 'source-output-fixture' },
    });
    const claimed = await ledger.claimInvocation({
      runId: RUN_ID,
      invocationId: INVOCATION_ID,
      fencingToken: FENCING_TOKEN,
      expectedGeneration: 0,
      expectedVersion: created.run.version,
      transitionId: 'claim',
      actor: { kind: 'local', id: 'source-output-fixture' },
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
      actor: { kind: 'local', id: 'source-output-fixture' },
    });
    const completed = await ledger.commitVerifiedAttemptTerminal({
      runId: RUN_ID,
      invocationId: INVOCATION_ID,
      attemptId: started.attempt.attemptId,
      fencingToken: started.attempt.fencingToken,
      generation: started.attempt.generation,
      coordinatorEpoch: started.attempt.coordinatorEpoch,
      expectedVersion: started.run.version,
      transitionId: 'terminal',
      evidence: completedEvidence(started.startFrame),
      actor: { kind: 'local', id: 'source-output-fixture' },
    });
    return {
      version: completed.run.version,
      lastSequence: completed.run.lastSequence,
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
function runOutput(root, controlRoot, cwd, args) {
  return spawnSync(process.execPath, [BIN_PATH, 'ops', 'output', ...args], {
    cwd,
    encoding: 'utf8',
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

describe('source sensitive run-output command', () => {
  it('reads exact verified output without loading app source or mutating durable bytes', async () => {
    const root = createTemporaryRoot('wharfie-ops-output-');
    const controlRoot = path.join(root, 'control');
    const authoredApp = createAuthoredAppTrap(root);
    const snapshot = await seedCompletedRun(controlRoot);
    const durableBefore = snapshotDirectory(controlRoot);

    const result = runOutput(root, controlRoot, authoredApp, [
      '--app-id',
      APP_ID,
      '--run-id',
      RUN_ID,
      '--confirm-sensitive-output',
      '--json',
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      schemaVersion: 1,
      kind: 'wharfie.execution-ledger.run-output',
      authority: 'none',
      authoritative: false,
      disclosure: 'application-sensitive-unredacted',
      integrity: { verified: true },
      scope: {
        appId: APP_ID,
        revisionId: REVISION_ID,
        runId: RUN_ID,
      },
      snapshot: {
        runKind: 'manual',
        status: 'COMPLETED',
        version: snapshot.version,
        lastSequence: snapshot.lastSequence,
      },
      outputs: [],
      terminal: {
        type: 'completed',
        result: SENSITIVE_RESULT,
      },
    });
    expect(result.stdout).toContain('unredacted-run-output-secret');
    expect(result.stdout).toContain('\\u001b');
    expect(result.stdout).toContain('\\u009b');
    expect(result.stdout).toContain('\\u202e');
    expect(result.stdout).not.toContain('\u001b');
    expect(result.stdout).not.toContain('\u009b');
    expect(result.stdout).not.toContain('\u202e');
    expect(result.stdout).not.toContain(FENCING_TOKEN);
    expect(snapshotDirectory(controlRoot)).toEqual(durableBefore);
  });

  it('emits only the fixed safe failure and does not create a missing store', () => {
    const root = createTemporaryRoot('wharfie-ops-output-missing-');
    const controlRoot = path.join(root, 'missing-control');
    const authoredApp = createAuthoredAppTrap(root);

    const result = runOutput(root, controlRoot, authoredApp, [
      '--app-id',
      APP_ID,
      '--run-id',
      RUN_ID,
      '--confirm-sensitive-output',
      '--json',
    ]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${SAFE_FAILURE}\n`);
    expect(existsSync(controlRoot)).toBe(false);
  });
});
