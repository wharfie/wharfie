/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from '@jest/globals';

import { createControlDBClient } from '../../src/core/lib/config/db.js';
import {
  LMDB_HOLDER_LOCK_FILE,
  LMDB_HOLDER_RECORD_FILE,
} from '../../src/core/lib/db/lmdb-holder-lock.js';

// The holder lock is what makes "one process holds a resident store" true
// across processes, so these tests use real processes, never mocks.

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHILD = fileURLToPath(
  new URL('../fixtures/lmdb-holder-lock-child.js', import.meta.url),
);

/** @type {string[]} */
const roots = [];
/** @type {import('node:child_process').ChildProcess[]} */
const children = [];

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

async function createStore() {
  const root = mkdtempSync(join(tmpdir(), 'wharfie-holder-lock-'));
  roots.push(root);
  const db = await createControlDBClient('lmdb', { path: root });
  await db.put({
    tableName: 'records',
    keyName: 'pk',
    record: { pk: 'seed' },
  });
  await db.close();
  return root;
}

/**
 * @param {string} storePath
 * @param {'read'|'write'} mode
 * @param {number} lockWaitMs
 */
function startChild(storePath, mode, lockWaitMs) {
  const child = spawn(
    process.execPath,
    [CHILD, storePath, mode, String(lockWaitMs)],
    { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'inherit'] },
  );
  children.push(child);
  const lines = createInterface({ input: /** @type {any} */ (child.stdout) })[
    Symbol.asyncIterator
  ]();
  return {
    child,
    next: async () => {
      const { value, done } = await lines.next();
      if (done) throw new Error(`child ${child.pid} exited without output`);
      return JSON.parse(value);
    },
    close: () => /** @type {any} */ (child.stdin).write('close\n'),
  };
}

describe('LMDB holder lock across processes', () => {
  test('lets direct readers share a store while nobody writes it', async () => {
    const store = await createStore();
    const first = startChild(store, 'read', 1_000);
    const second = startChild(store, 'read', 1_000);
    expect(await first.next()).toMatchObject({ opened: true });
    expect(await second.next()).toMatchObject({ opened: true });
    first.close();
    second.close();
    expect(await first.next()).toMatchObject({ closed: true });
    expect(await second.next()).toMatchObject({ closed: true });
  }, 30_000);

  test('refuses a reader beside a writer after its bounded wait, naming the writer', async () => {
    const store = await createStore();
    const writer = startChild(store, 'write', 1_000);
    const opened = await writer.next();
    expect(opened).toMatchObject({ opened: true });

    const started = Date.now();
    const reader = startChild(store, 'read', 300);
    const refused = await reader.next();
    expect(refused).toMatchObject({
      refused: true,
      code: 'local-store-busy',
    });
    expect(refused.message).toContain(`pid ${writer.child.pid}`);
    expect(refused.message).toContain('Waited 300ms');
    expect(refused.at - started).toBeGreaterThanOrEqual(300);
    writer.close();
    await writer.next();
  }, 30_000);

  test('refuses a writer beside a direct reader, saying readers hold it', async () => {
    const store = await createStore();
    const reader = startChild(store, 'read', 1_000);
    expect(await reader.next()).toMatchObject({ opened: true });
    const writer = startChild(store, 'write', 200);
    const refused = await writer.next();
    expect(refused).toMatchObject({ refused: true, code: 'local-store-busy' });
    expect(refused.message).toMatch(/reading this local store directly/);
    reader.close();
    await reader.next();
  }, 30_000);

  test('a waiting writer opens only after the reader inside has closed', async () => {
    const store = await createStore();
    const reader = startChild(store, 'read', 1_000);
    expect(await reader.next()).toMatchObject({ opened: true });
    const writer = startChild(store, 'write', 10_000);
    // Give the writer time to start waiting before the reader leaves.
    await new Promise((resolve) => setTimeout(resolve, 500));
    reader.close();
    const closed = await reader.next();
    const opened = await writer.next();
    expect(opened).toMatchObject({ opened: true });
    expect(opened.at).toBeGreaterThanOrEqual(closed.after);
    writer.close();
    await writer.next();
  }, 30_000);

  test('the kernel releases a killed holder at once', async () => {
    const store = await createStore();
    const writer = startChild(store, 'write', 1_000);
    expect(await writer.next()).toMatchObject({ opened: true });
    writer.child.kill('SIGKILL');
    await once(writer.child, 'exit');

    const successor = startChild(store, 'write', 1_000);
    expect(await successor.next()).toMatchObject({ opened: true });
    successor.close();
    await successor.next();
  }, 30_000);

  test('names a recorded holder that has exited as stale', async () => {
    const store = await createStore();
    const writer = startChild(store, 'write', 1_000);
    expect(await writer.next()).toMatchObject({ opened: true });
    const record = JSON.parse(
      readFileSync(join(store, 'lmdb', LMDB_HOLDER_RECORD_FILE), 'utf8'),
    );
    expect(record).toMatchObject({ pid: writer.child.pid });
    expect(typeof record.command).toBe('string');
    writer.child.kill('SIGKILL');
    await once(writer.child, 'exit');

    // A new holder overwrites the record; a reader blocked by it names it.
    const successor = startChild(store, 'write', 1_000);
    expect(await successor.next()).toMatchObject({ opened: true });
    const reader = startChild(store, 'read', 100);
    const refused = await reader.next();
    expect(refused.message).toContain(`pid ${successor.child.pid}`);
    successor.close();
    await successor.next();
  }, 30_000);

  test('keeps the lock in the LMDB directory and leaves no SQLite side files', async () => {
    const store = await createStore();
    const writer = startChild(store, 'write', 1_000);
    expect(await writer.next()).toMatchObject({ opened: true });
    writer.child.kill('SIGKILL');
    await once(writer.child, 'exit');
    expect(existsSync(join(store, 'lmdb', LMDB_HOLDER_LOCK_FILE))).toBe(true);
    expect(readdirSync(join(store, 'lmdb')).sort()).toEqual(
      [
        'data.mdb',
        'lock.mdb',
        LMDB_HOLDER_LOCK_FILE,
        LMDB_HOLDER_RECORD_FILE,
      ].sort(),
    );
  }, 30_000);
});
