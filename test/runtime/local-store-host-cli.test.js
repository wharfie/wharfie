/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, test } from '@jest/globals';

import { resolveExecutionPayloadStoreId } from '../../src/core/lib/config/db.js';
import {
  createLedgerServiceId,
  createLedgerServiceLifecycle,
  LedgerServiceLifecycleStatus,
} from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { createManualLedgerRunId } from '../../src/core/runtime/manual-ledger-run.js';
import { withExecutionLedger } from '../../src/core/runtime/operator/execution-ledger-store.js';
import { findLocalStoreHost } from '../../src/core/runtime/local-store-host.js';
import {
  cleanupIsolatedAuthoredAppFixtures,
  createIsolatedAuthoredAppFixture,
} from '../helpers/isolated-authored-app.js';

// lmdb-js #370: another process opening and closing a store while a resident
// writes it can lose or corrupt the resident's transactions. The symptom needs
// minutes of 5 ms open/close cycles against a busy writer, so this asserts its
// trigger deterministically instead: while a resident runs, operator commands
// and a high-rate observer must perform zero native opens of its store.

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BIN_PATH = join(REPO_ROOT, 'bin', 'wharfie');
const RECORDER = fileURLToPath(
  new URL('../fixtures/lmdb-open-recorder.cjs', import.meta.url),
);
const DIRECT_WRITER = fileURLToPath(
  new URL('../fixtures/lmdb-holder-lock-child.js', import.meta.url),
);
const OBSERVER = fileURLToPath(
  new URL('../fixtures/local-store-host-observer.js', import.meta.url),
);
const AUTHORED_APP_PATH = fileURLToPath(
  new URL('../fixtures/apps/resident-authored-crash/', import.meta.url),
);
const APP_ID = 'resident-authored-crash';
const ACTIVITY_ID = 'crash-task';
const WAIT_TIMEOUT_MS = 30_000;
const testOnUnix = process.platform === 'win32' ? test.skip : test;
/** @type {Array<ReturnType<typeof createIsolatedAuthoredAppFixture>>} */
const authoredAppFixtures = [];

afterAll(() => {
  cleanupIsolatedAuthoredAppFixtures(authoredAppFixtures);
});

function createFixture() {
  const authoredApp = createIsolatedAuthoredAppFixture(AUTHORED_APP_PATH, {
    prefix: 'wharfie-local-store-host-app-',
  });
  authoredAppFixtures.push(authoredApp);
  const root = mkdtempSync(join(tmpdir(), 'wharfie-local-store-host-'));
  const controlPath = join(root, 'control');
  const payloadPath = join(root, 'payloads');
  const sessionPath = join(root, 'sessions');
  const tableName = 'local-store-host-cli';
  return {
    root,
    appDir: authoredApp.appDir,
    controlPath,
    tableName,
    markerPath: join(root, 'entries.log'),
    openLog: join(root, 'lmdb-opens.jsonl'),
    configuration: {
      adapterName: /** @type {const} */ ('lmdb'),
      controlPath,
      tableName,
      payloadPath,
      payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
      sessionPath,
    },
    env: {
      ...process.env,
      NODE_ENV: 'development',
      NO_COLOR: '1',
      WHARFIE_ARTIFACT_BUCKET: 'local-store-host-bucket',
      WHARFIE_DB_ADAPTER: 'lmdb',
      WHARFIE_DB_PATH: join(root, 'general'),
      WHARFIE_CONTROL_ADAPTER: 'lmdb',
      WHARFIE_CONTROL_PATH: controlPath,
      WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
      WHARFIE_EXECUTION_PAYLOAD_PATH: payloadPath,
      WHARFIE_LEDGER_SERVICE_SESSION_PATH: sessionPath,
      WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
      WHARFIE_APPLICATION_STATE_PATH: join(root, 'application-state'),
    },
  };
}

/** @param {ReturnType<typeof createFixture>} fixture @param {string[]} args */
function runCli(fixture, args) {
  const result = spawnSync(
    process.execPath,
    ['--require', RECORDER, BIN_PATH, ...args],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...fixture.env, WHARFIE_TEST_LMDB_OPEN_LOG: fixture.openLog },
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `wharfie ${args.join(' ')} failed with status=${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  return JSON.parse(result.stdout.trim());
}

/** @param {ReturnType<typeof createFixture>} fixture @returns {Array<{pid: number, path: string, readOnly: boolean}>} */
function controlStoreOpens(fixture) {
  if (!existsSync(fixture.openLog)) return [];
  const lmdbRoot = join(realpathSync(fixture.controlPath), 'lmdb');
  return readFileSync(fixture.openLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter(
      (entry) =>
        entry.path === lmdbRoot ||
        entry.path === join(fixture.controlPath, 'lmdb'),
    );
}

/** @param {ReturnType<typeof createFixture>} fixture @param {string} key */
function submit(fixture, key) {
  return runCli(fixture, [
    'ops',
    'submit',
    '--activity',
    ACTIVITY_ID,
    '--idempotency-key',
    key,
    '--dir',
    fixture.appDir,
    '--input',
    JSON.stringify({
      markerPath: fixture.markerPath,
      mode: 'complete',
      token: key,
      proof: { key },
    }),
    '--json',
  ]);
}

/** @param {ReturnType<typeof createFixture>} fixture */
function startWorker(fixture) {
  const child = spawn(
    process.execPath,
    [BIN_PATH, 'ops', 'worker', '--dir', fixture.appDir],
    { cwd: REPO_ROOT, env: fixture.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });
  child.stdout?.resume();
  return {
    child,
    exited: once(child, 'close').then(([code, signal]) => ({
      code,
      signal,
      stderr,
    })),
    stderr: () => stderr,
  };
}

/** @template T @param {() => Promise<T | undefined>} probe @param {string} label @param {ReturnType<typeof startWorker>} worker @returns {Promise<T>} */
async function waitFor(probe, label, worker) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
      throw new Error(
        `Resident exited while waiting for ${label}: ${worker.stderr()}`,
      );
    }
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

describe('operator reads while a resident hosts its control store', () => {
  testOnUnix(
    'route through the resident without opening the store and match direct output',
    async () => {
      const fixture = createFixture();
      const worker = startWorker(fixture);
      try {
        // Only proceed through the host: the test process must not race the
        // resident's startup with its own native open.
        await waitFor(
          async () =>
            await findLocalStoreHost({ storePath: fixture.controlPath }),
          'the resident store host',
          worker,
        );
        const serviceId = createLedgerServiceId({ appId: APP_ID });
        await waitFor(
          async () =>
            await withExecutionLedger(
              async (_ledger, context) => {
                const lifecycle = await createLedgerServiceLifecycle({
                  db: context.db,
                  tableName: context.tableName,
                }).get({ serviceId });
                return lifecycle?.status === LedgerServiceLifecycleStatus.READY
                  ? true
                  : undefined;
              },
              { readOnly: true, configuration: fixture.configuration },
            ).catch(() => undefined),
          'resident READY',
          worker,
        );
        const residentPid = worker.child.pid;

        const accepted = submit(fixture, 'hosted-first');
        const runId = createManualLedgerRunId({
          appId: APP_ID,
          idempotencyKey: 'hosted-first',
        });
        expect(accepted).toMatchObject({ appId: APP_ID, runId });
        const completed = await waitFor(
          async () => {
            const view = runCli(fixture, [
              'ops',
              'inspect',
              '--run-id',
              runId,
              '--json',
            ]);
            return view?.run?.status === 'COMPLETED' ? view : undefined;
          },
          'the submitted run to complete',
          worker,
        );

        for (let round = 0; round < 2; round += 1) {
          expect(
            runCli(fixture, ['ops', 'inspect', '--run-id', runId, '--json']),
          ).toEqual(completed);
          runCli(fixture, ['ops', 'list', '--dir', fixture.appDir, '--json']);
          runCli(fixture, [
            'ops',
            'output',
            '--app-id',
            APP_ID,
            '--run-id',
            runId,
            '--confirm-sensitive-output',
            '--json',
          ]);
          submit(fixture, `hosted-round-${round}`);
        }

        const observer = spawnSync(
          process.execPath,
          [
            '--require',
            RECORDER,
            OBSERVER,
            fixture.controlPath,
            fixture.tableName,
            serviceId,
            '3000',
            '5',
          ],
          {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            env: {
              ...fixture.env,
              WHARFIE_TEST_LMDB_OPEN_LOG: fixture.openLog,
            },
          },
        );
        expect(observer.status).toBe(0);
        const observed = JSON.parse(observer.stdout.trim());
        expect(observed.errors).toEqual([]);
        expect(observed.reads).toBeGreaterThan(50);
        expect(observed.statuses).toEqual({
          [LedgerServiceLifecycleStatus.READY]: observed.reads,
        });

        // The trigger of the defect: any native open here is an open and
        // close of the resident's store by another process during its writes.
        expect(controlStoreOpens(fixture)).toEqual([]);
        expect(worker.child.exitCode).toBeNull();
        expect(worker.child.pid).toBe(residentPid);

        worker.child.kill('SIGTERM');
        expect(await worker.exited).toMatchObject({ code: 0, signal: null });

        // With no resident, the same command opens the store itself and
        // prints the same view.
        expect(
          runCli(fixture, ['ops', 'inspect', '--run-id', runId, '--json']),
        ).toEqual(completed);
        expect(controlStoreOpens(fixture).length).toBeGreaterThan(0);
      } finally {
        if (
          worker.child.exitCode === null &&
          worker.child.signalCode === null
        ) {
          worker.child.kill('SIGKILL');
        }
        await worker.exited.catch(() => undefined);
        rmSync(fixture.root, { recursive: true, force: true });
      }
    },
    120_000,
  );

  testOnUnix(
    'refuse a second resident before it opens the store, naming the live one',
    async () => {
      const fixture = createFixture();
      const worker = startWorker(fixture);
      try {
        await waitFor(
          async () =>
            await findLocalStoreHost({ storePath: fixture.controlPath }),
          'the resident store host',
          worker,
        );
        // Each retry of a foreground run that follows a live resident takes
        // this path: it must be refused without opening the store.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const second = spawnSync(
            process.execPath,
            [
              '--require',
              RECORDER,
              BIN_PATH,
              'ops',
              'worker',
              '--dir',
              fixture.appDir,
            ],
            {
              cwd: REPO_ROOT,
              encoding: 'utf8',
              timeout: WAIT_TIMEOUT_MS,
              env: {
                ...fixture.env,
                WHARFIE_TEST_LMDB_OPEN_LOG: fixture.openLog,
              },
            },
          );
          // The defect itself: any native open here opened and closed the
          // live resident's store from another process.
          expect(controlStoreOpens(fixture)).toEqual([]);
          expect(second.status).toBe(1);
          expect(second.stderr).toContain(
            'Local service session is already active',
          );
          expect(second.stderr).toContain(`pid ${worker.child.pid}`);
        }
        expect(worker.child.exitCode).toBeNull();
        worker.child.kill('SIGTERM');
        expect(await worker.exited).toMatchObject({ code: 0, signal: null });
      } finally {
        if (
          worker.child.exitCode === null &&
          worker.child.signalCode === null
        ) {
          worker.child.kill('SIGKILL');
        }
        await worker.exited.catch(() => undefined);
        rmSync(fixture.root, { recursive: true, force: true });
      }
    },
    120_000,
  );

  testOnUnix(
    'refuse an inspect beside a direct writer after a bounded wait, naming it',
    async () => {
      const fixture = createFixture();
      // No resident: the store is created by a direct submit, then held
      // exclusively by a direct writer (as `ops recover` would hold it).
      const accepted = submit(fixture, 'direct-writer-held');
      const writer = spawn(
        process.execPath,
        [DIRECT_WRITER, fixture.controlPath, 'write', '10000'],
        {
          cwd: REPO_ROOT,
          env: fixture.env,
          stdio: ['pipe', 'pipe', 'inherit'],
        },
      );
      try {
        const [line] = await once(
          /** @type {import('node:stream').Readable} */ (writer.stdout),
          'data',
        );
        expect(JSON.parse(String(line))).toMatchObject({ opened: true });
        const started = Date.now();
        const inspect = spawnSync(
          process.execPath,
          [
            '--require',
            RECORDER,
            BIN_PATH,
            'ops',
            'inspect',
            '--run-id',
            accepted.runId,
            '--json',
          ],
          {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            timeout: WAIT_TIMEOUT_MS,
            env: {
              ...fixture.env,
              WHARFIE_TEST_LMDB_OPEN_LOG: fixture.openLog,
            },
          },
        );
        const elapsed = Date.now() - started;
        expect(inspect.status).toBe(1);
        expect(inspect.stderr).toContain(`held by pid ${writer.pid}`);
        expect(inspect.stderr).toContain('Waited 10000ms');
        expect(elapsed).toBeGreaterThanOrEqual(10_000);
        expect(
          controlStoreOpens(fixture).filter(
            (entry) => entry.pid === inspect.pid,
          ),
        ).toEqual([]);
      } finally {
        writer.kill('SIGKILL');
        await once(writer, 'close').catch(() => undefined);
        rmSync(fixture.root, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
