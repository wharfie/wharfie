/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import createVanillaDB from '../../../src/core/lib/db/adapters/vanilla.js';
import { createExecutionLedger } from '../../../src/core/lib/db/tables/execution-ledger.js';
import { resolveExecutionPayloadStoreId } from '../../../src/core/lib/config/db.js';
import { createLocalExecutionPayloadStore } from '../../../src/core/lib/payload-store/local.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
} from '../../../src/core/runtime/manual-ledger-run.js';

const REPOSITORY_ROOT = path.resolve(
  fileURLToPath(new URL('../../..', import.meta.url)),
);
const BIN_PATH = path.join(REPOSITORY_ROOT, 'bin', 'wharfie');
const APP_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  'scratch/examples/apps/hello-world',
);
const APP_ID = 'hello-world-demo';
const REVISION_A = `wrv1_${'A'.repeat(43)}`;
const REVISION_B = `wrv1_${'Q'.repeat(43)}`;

/** @type {Set<string>} */
const temporaryDirectories = new Set();

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

/**
 * @param {string} label - Temporary-directory prefix.
 * @returns {string} - Created root.
 */
function createTemporaryRoot(label) {
  const root = mkdtempSync(path.join(os.tmpdir(), label));
  temporaryDirectories.add(root);
  return root;
}

/**
 * @param {string} controlRoot - Durable control root.
 * @returns {ReturnType<typeof createLocalExecutionPayloadStore>} - Local payload store.
 */
function createPayloadStore(controlRoot) {
  const payloadPath = path.join(controlRoot, 'execution-payloads');
  return createLocalExecutionPayloadStore({
    path: payloadPath,
    storeId: resolveExecutionPayloadStoreId(payloadPath),
  });
}

/**
 * @param {ReturnType<typeof createExecutionLedger>} ledger - Seed ledger.
 * @param {{appId: string, revisionId: string, idempotencyKey: string}} input - Run identity.
 * @returns {Promise<string>} - Durable run ID.
 */
async function seedRun(ledger, input) {
  const runId = createManualLedgerRunId({
    appId: input.appId,
    idempotencyKey: input.idempotencyKey,
  });
  await ledger.createManualRun({
    runId,
    appId: input.appId,
    revisionId: input.revisionId,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    activityId: 'echo-event',
    input: { credential: `${input.idempotencyKey}-input-secret` },
    callerMetadata: {
      credential: `${input.idempotencyKey}-caller-secret`,
    },
    transitionId: `create:${input.idempotencyKey}`,
    actor: { kind: 'local', id: 'history-test' },
  });
  return runId;
}

/**
 * @param {string} root - Isolated process root.
 * @param {string} controlRoot - Durable control root.
 * @param {string} tableName - Ledger table.
 * @param {string[]} args - List-specific CLI arguments.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} - Completed CLI process.
 */
function runList(root, controlRoot, tableName, args) {
  const xdgConfig = path.join(root, 'xdg-config');
  const xdgData = path.join(root, 'xdg-data');
  return spawnSync(
    process.execPath,
    [BIN_PATH, 'ops', 'list', '--dir', APP_DIRECTORY, ...args],
    {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: root,
        TMPDIR: root,
        XDG_CONFIG_HOME: xdgConfig,
        XDG_DATA_HOME: xdgData,
        LANG: 'C',
        LC_ALL: 'C',
        NODE_ENV: 'development',
        NO_COLOR: '1',
        WHARFIE_DISABLE_UPDATE_CHECK: '1',
        WHARFIE_CONTROL_ADAPTER: 'vanilla',
        WHARFIE_CONTROL_PATH: controlRoot,
        WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
        WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(
          controlRoot,
          'execution-payloads',
        ),
      },
    },
  );
}

describe('source run-history command', () => {
  it('lists verified app-wide history newest-first without changing durable bytes', async () => {
    const root = createTemporaryRoot('wharfie-ops-list-');
    const controlRoot = path.join(root, 'control');
    const tableName = 'ops-list-history';
    const db = createVanillaDB({ path: controlRoot });
    let observedAt = 1_000;
    const ledger = createExecutionLedger({
      db,
      tableName,
      payloadStore: createPayloadStore(controlRoot),
      now: () => observedAt,
    });
    const olderRunId = await seedRun(ledger, {
      appId: APP_ID,
      revisionId: REVISION_A,
      idempotencyKey: 'older',
    });
    observedAt = 2_000;
    const newerRunId = await seedRun(ledger, {
      appId: APP_ID,
      revisionId: REVISION_B,
      idempotencyKey: 'newer',
    });
    observedAt = 3_000;
    await seedRun(ledger, {
      appId: 'foreign-history-app',
      revisionId: REVISION_B,
      idempotencyKey: 'foreign',
    });
    await db.close();
    const snapshotPath = path.join(controlRoot, 'database.json');
    const durableBytes = readFileSync(snapshotPath);

    const first = runList(root, controlRoot, tableName, [
      '--limit',
      '1',
      '--json',
    ]);

    expect(first.status).toBe(0);
    expect(first.stderr).toBe('');
    const firstPage = JSON.parse(first.stdout);
    expect(firstPage).toEqual({
      schemaVersion: 1,
      kind: 'wharfie.execution-ledger.run-page',
      authority: 'none',
      authoritative: false,
      integrity: { verified: true },
      scope: { appId: APP_ID },
      items: [
        {
          runId: newerRunId,
          revisionId: REVISION_B,
          kind: 'manual',
          status: 'RUNNING',
          version: 1,
          lastSequence: 1,
          createdAt: 2_000,
          updatedAt: 2_000,
        },
      ],
      nextCursor: expect.any(String),
    });
    for (const secret of [
      'newer-input-secret',
      'newer-caller-secret',
      'foreign',
      'payload',
      'fencing',
    ]) {
      expect(first.stdout).not.toContain(secret);
    }

    const second = runList(root, controlRoot, tableName, [
      '--limit',
      '1',
      '--cursor',
      firstPage.nextCursor,
      '--json',
    ]);
    expect(second.status).toBe(0);
    expect(second.stderr).toBe('');
    expect(JSON.parse(second.stdout)).toEqual({
      schemaVersion: 1,
      kind: 'wharfie.execution-ledger.run-page',
      authority: 'none',
      authoritative: false,
      integrity: { verified: true },
      scope: { appId: APP_ID },
      items: [
        {
          runId: olderRunId,
          revisionId: REVISION_A,
          kind: 'manual',
          status: 'RUNNING',
          version: 1,
          lastSequence: 1,
          createdAt: 1_000,
          updatedAt: 1_000,
        },
      ],
      nextCursor: null,
    });
    expect(readFileSync(snapshotPath)).toEqual(durableBytes);
  });

  it('returns an honest empty page without creating a missing control root', () => {
    const root = createTemporaryRoot('wharfie-ops-list-empty-');
    const controlRoot = path.join(root, 'missing-control');

    const result = runList(root, controlRoot, 'ops-list-empty', ['--json']);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      schemaVersion: 1,
      kind: 'wharfie.execution-ledger.run-page',
      authority: 'none',
      authoritative: false,
      integrity: { verified: true },
      scope: { appId: APP_ID },
      items: [],
      nextCursor: null,
    });
    expect(existsSync(controlRoot)).toBe(false);
  });
});
