/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  chownSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
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
  readLmdbHolderRecord,
  tryAcquireLmdbHolderLock,
} from '../../src/core/lib/db/lmdb-holder-lock.js';

// The holder lock is what makes "one process holds a resident store" true
// across processes, so these tests use real processes, never mocks.

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHILD = fileURLToPath(
  new URL('../fixtures/lmdb-holder-lock-child.js', import.meta.url),
);
const CLOSE_HOOK = fileURLToPath(
  new URL('../fixtures/lmdb-close-hook.cjs', import.meta.url),
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
 * @param {{nodeArgs?: string[], env?: Record<string, string>, uid?: number, gid?: number}} [options]
 */
function startChild(storePath, mode, lockWaitMs, options = {}) {
  const child = spawn(
    process.execPath,
    [...(options.nodeArgs ?? []), CHILD, storePath, mode, String(lockWaitMs)],
    {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, ...options.env },
      ...(options.uid === undefined
        ? {}
        : { uid: options.uid, gid: options.gid }),
    },
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
    // Readers leave no record, so the refusal says how to find them.
    expect(refused.message).toContain(
      `lsof ${join(store, 'lmdb', LMDB_HOLDER_LOCK_FILE)}`,
    );
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

  test('a writable open waits for a read in the same process to finish', async () => {
    // A foreground wharfie run reads its run's progress while its own worker
    // opens the store to host it; the read is short and must not fail the
    // worker.
    const store = await createStore();
    const reader = await createControlDBClient('lmdb', {
      path: store,
      readOnly: true,
    });
    const readClosed = new Promise((resolve) =>
      setTimeout(async () => {
        await reader.close();
        resolve(Date.now());
      }, 300),
    );
    const writer = await createControlDBClient('lmdb', {
      path: store,
      lockWaitMs: 5_000,
    });
    const openedAt = Date.now();
    expect(openedAt).toBeGreaterThanOrEqual(await readClosed);
    await writer.put({
      tableName: 'records',
      keyName: 'pk',
      record: { pk: 'w' },
    });
    await writer.close();
  }, 30_000);

  test('keeps the lock until the native close has completed', async () => {
    const store = await createStore();
    const gate = join(store, 'close-gate');
    const writer = startChild(store, 'write', 1_000, {
      nodeArgs: ['--require', CLOSE_HOOK],
      env: { WHARFIE_TEST_LMDB_CLOSE_GATE: gate },
    });
    expect(await writer.next()).toMatchObject({ opened: true });
    writer.close();
    const deadline = Date.now() + 10_000;
    while (!existsSync(`${gate}.waiting`)) {
      if (Date.now() > deadline) throw new Error('The close never started.');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // The native close is in progress and held: nobody may open yet.
    const early = startChild(store, 'read', 300);
    expect(await early.next()).toMatchObject({
      refused: true,
      code: 'local-store-busy',
    });
    writeFileSync(gate, '');
    expect(await writer.next()).toMatchObject({ closed: true });
    const later = startChild(store, 'read', 1_000);
    expect(await later.next()).toMatchObject({ opened: true });
    later.close();
    await later.next();
  }, 30_000);

  test('keeps the lock when the native close fails', async () => {
    const store = await createStore();
    const writer = startChild(store, 'write', 1_000, {
      nodeArgs: ['--require', CLOSE_HOOK],
      env: { WHARFIE_TEST_LMDB_CLOSE_FAIL: '1' },
    });
    expect(await writer.next()).toMatchObject({ opened: true });
    writer.close();
    expect(await writer.next()).toMatchObject({
      closeFailed: true,
      message: expect.stringContaining('injected native close failure'),
    });
    // The environment may still be open, so the lock stays with it.
    const reader = startChild(store, 'read', 300);
    expect(await reader.next()).toMatchObject({
      refused: true,
      code: 'local-store-busy',
    });
    // Waiting cannot help this process; it must be restarted.
    /** @type {any} */ (writer.child.stdin).write('reopen\n');
    const reopened = await writer.next();
    expect(reopened).toMatchObject({
      reopenRefused: true,
      code: 'local-store-lock',
    });
    expect(reopened.message).toMatch(/Restart this process/);
  }, 30_000);

  test('releases the lock when the native open fails after taking it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wharfie-holder-lock-'));
    roots.push(root);
    mkdirSync(join(root, 'lmdb'), { mode: 0o700 });
    // Nonempty and regular, so it passes the adapter's checks and fails
    // inside the native open, after the holder lock is taken.
    writeFileSync(join(root, 'lmdb', 'data.mdb'), Buffer.alloc(16384, 0x41), {
      mode: 0o600,
    });
    await expect(
      createControlDBClient('lmdb', { path: root, lockWaitMs: 100 }),
    ).rejects.toThrow(/MDB_INVALID/);
    // Another process may now take the store exclusively.
    writeFileSync(join(root, 'lmdb', 'data.mdb'), '');
    rmSync(join(root, 'lmdb', 'data.mdb'));
    const writer = startChild(root, 'write', 300);
    expect(await writer.next()).toMatchObject({ opened: true });
    writer.close();
    await writer.next();
  }, 30_000);

  test('refuses a lock file that is a symbolic link', async () => {
    const store = await createStore();
    const lockFile = join(store, 'lmdb', LMDB_HOLDER_LOCK_FILE);
    rmSync(lockFile);
    writeFileSync(join(store, 'elsewhere'), '');
    symlinkSync(join(store, 'elsewhere'), lockFile);
    await expect(
      createControlDBClient('lmdb', { path: store, readOnly: true }),
    ).rejects.toMatchObject({
      code: 'local-store-lock',
      message: expect.stringContaining('not a symbolic link'),
    });
  }, 30_000);

  (process.geteuid?.() === 0 ? test.skip : test)(
    'names the lock file, its owner and mode, and the fix when it cannot be opened',
    async () => {
      const store = await createStore();
      const lockFile = join(store, 'lmdb', LMDB_HOLDER_LOCK_FILE);
      chmodSync(lockFile, 0o000);
      try {
        const failure = await createControlDBClient('lmdb', {
          path: store,
          readOnly: true,
        }).catch((error) => error);
        expect(failure).toMatchObject({ code: 'local-store-lock' });
        expect(failure.message).toContain(lockFile);
        expect(failure.message).toContain(
          `uid ${process.geteuid?.()}, mode 0000`,
        );
        expect(failure.message).toMatch(/chown/);
      } finally {
        chmodSync(lockFile, 0o600);
      }
    },
    30_000,
  );

  test('fails closed with a specific error when Node has no built-in SQLite', async () => {
    const store = await createStore();
    const reader = startChild(store, 'read', 300, {
      nodeArgs: ['--no-experimental-sqlite'],
    });
    const refused = await reader.next();
    expect(refused).toMatchObject({ refused: true, code: 'local-store-lock' });
    expect(refused.message).toMatch(/built-in SQLite module \(node:sqlite\)/);
  }, 30_000);

  test('another open attempt in a holder never drops the holder lock', async () => {
    // POSIX drops a process's fcntl locks when it closes any descriptor of the
    // file. A second attempt here must find the file without opening it.
    const store = await createStore();
    const dbRoot = join(store, 'lmdb');
    const held = tryAcquireLmdbHolderLock(dbRoot, {
      exclusive: true,
      readOnly: false,
    });
    try {
      expect(() =>
        tryAcquireLmdbHolderLock(dbRoot, { exclusive: false, readOnly: true }),
      ).toThrow(expect.objectContaining({ code: 'local-store-busy' }));
      const reader = startChild(store, 'read', 300);
      expect(await reader.next()).toMatchObject({
        refused: true,
        code: 'local-store-busy',
      });
    } finally {
      held?.release();
    }
  }, 30_000);

  (process.geteuid?.() === 0 ? test : test.skip)(
    "a root open leaves the lock file to the store's owner",
    async () => {
      // Run as root (the Linux container run): a user's store, first opened
      // read-only by root after an upgrade, must stay usable by that user.
      const owner = { uid: 1000, gid: 1000 };
      // Not Jest's private temporary directory: the owner must reach it.
      const root = mkdtempSync('/tmp/wharfie-holder-lock-owner-');
      roots.push(root);
      chownSync(root, owner.uid, owner.gid);
      const store = join(root, 'control');
      const seed = startChild(store, 'write', 1_000, owner);
      expect(await seed.next()).toMatchObject({ opened: true });
      seed.close();
      await seed.next();
      const lockFile = join(store, 'lmdb', LMDB_HOLDER_LOCK_FILE);
      rmSync(lockFile);
      rmSync(join(store, 'lmdb', LMDB_HOLDER_RECORD_FILE), { force: true });

      const asRoot = startChild(store, 'read', 1_000);
      expect(await asRoot.next()).toMatchObject({ opened: true });
      asRoot.close();
      await asRoot.next();
      expect(lstatSync(lockFile)).toMatchObject({
        uid: owner.uid,
        gid: owner.gid,
      });

      const asOwner = startChild(store, 'write', 1_000, owner);
      expect(await asOwner.next()).toMatchObject({ opened: true });
      asOwner.close();
      await asOwner.next();
    },
    30_000,
  );

  test('writes the holder record without following any planted link', async () => {
    // The store's directory belongs to its owner, who may plant links in it
    // for a holder of another user (root) to follow. Plant the names the
    // record write used to use, and the record itself, all pointing at a
    // file outside the store.
    const store = await createStore();
    const dbRoot = join(store, 'lmdb');
    const victim = join(store, 'victim');
    writeFileSync(victim, 'untouched', { mode: 0o600 });
    rmSync(join(dbRoot, LMDB_HOLDER_RECORD_FILE), { force: true });
    symlinkSync(victim, join(dbRoot, LMDB_HOLDER_RECORD_FILE));
    const probe = spawnSync(process.execPath, ['-p', 'process.pid']);
    const nextPid = Number(String(probe.stdout).trim());
    for (let pid = nextPid; pid < nextPid + 200; pid += 1) {
      symlinkSync(
        victim,
        join(dbRoot, `${LMDB_HOLDER_RECORD_FILE}.${pid}.tmp`),
      );
    }
    const writer = startChild(store, 'write', 1_000);
    expect(await writer.next()).toMatchObject({ opened: true });
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
    // The planted record link was replaced, not written through.
    const record = lstatSync(join(dbRoot, LMDB_HOLDER_RECORD_FILE));
    expect(record.isFile()).toBe(true);
    expect(readLmdbHolderRecord(dbRoot)).toMatchObject({
      pid: writer.child.pid,
    });
    // No temporary file was left behind.
    expect(
      readdirSync(dbRoot).filter((name) =>
        name.startsWith(`.${LMDB_HOLDER_RECORD_FILE}`),
      ),
    ).toEqual([]);
    writer.close();
    await writer.next();
  }, 30_000);

  test('a holder of another user writes no record, removes a stale one, and is described truthfully', async () => {
    const store = await createStore();
    const dbRoot = join(store, 'lmdb');
    // A stale record naming a live process that does not hold the store.
    writeFileSync(
      join(dbRoot, LMDB_HOLDER_RECORD_FILE),
      JSON.stringify({ pid: process.pid, startedAt: 1, command: 'stale' }),
      { mode: 0o600 },
    );
    const victim = join(store, 'victim');
    writeFileSync(victim, 'untouched', { mode: 0o600 });
    rmSync(join(dbRoot, LMDB_HOLDER_LOCK_FILE));
    // Act as a different user from the directory's owner (root, in
    // production), without needing root here.
    const held = tryAcquireLmdbHolderLock(dbRoot, {
      exclusive: true,
      readOnly: false,
      effectiveUid: (process.geteuid?.() ?? 0) + 1,
    });
    try {
      expect(existsSync(join(dbRoot, LMDB_HOLDER_RECORD_FILE))).toBe(false);
      expect(
        readdirSync(dbRoot).filter((name) => name.includes('.tmp')),
      ).toEqual([]);
      expect(readFileSync(victim, 'utf8')).toBe('untouched');
      const reader = startChild(store, 'read', 200);
      const refused = await reader.next();
      expect(refused).toMatchObject({
        refused: true,
        code: 'local-store-busy',
      });
      expect(refused.message).toContain('left no holder record');
      expect(refused.message).not.toContain(`pid ${process.pid}`);
    } finally {
      held?.release();
    }
  }, 30_000);

  test('ignores a holder record that is a link, a FIFO, oversized, or malformed', async () => {
    const store = await createStore();
    const dbRoot = join(store, 'lmdb');
    const record = join(dbRoot, LMDB_HOLDER_RECORD_FILE);
    const valid = JSON.stringify({ pid: 1, startedAt: 1, command: 'node x' });
    // createStore's writable open recorded itself; start from no record.
    rmSync(record);
    expect(readLmdbHolderRecord(dbRoot)).toBeUndefined();

    // A link to another file's contents must not be read through.
    const elsewhere = join(store, 'elsewhere.json');
    writeFileSync(elsewhere, valid);
    symlinkSync(elsewhere, record);
    expect(readLmdbHolderRecord(dbRoot)).toBeUndefined();
    rmSync(record);

    // A FIFO must neither block nor be read.
    expect(spawnSync('mkfifo', [record]).status).toBe(0);
    expect(readLmdbHolderRecord(dbRoot)).toBeUndefined();
    rmSync(record);

    writeFileSync(record, `${valid}${' '.repeat(4096)}`);
    expect(readLmdbHolderRecord(dbRoot)).toBeUndefined();
    writeFileSync(
      record,
      JSON.stringify({ pid: 1, startedAt: 1, command: 'root:x:0:0:/root' }),
    );
    expect(readLmdbHolderRecord(dbRoot)).toBeUndefined();

    writeFileSync(record, valid);
    expect(readLmdbHolderRecord(dbRoot)).toEqual({
      pid: 1,
      startedAt: 1,
      command: 'node x',
    });
  }, 30_000);
});
