/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  chownSync,
  renameSync,
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
  assertMayCreateLocalStore,
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

/** @param {string} directory Every entry's identity, owner, mode, size and mtime. */
function snapshotDirectory(directory) {
  return readdirSync(directory)
    .sort()
    .map((name) => {
      const stats = lstatSync(join(directory, name));
      return {
        name,
        ino: stats.ino,
        uid: stats.uid,
        mode: stats.mode,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      };
    });
}

const testUnlessRoot = process.geteuid?.() === 0 ? test.skip : test;

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
    "root is refused on a user's store and changes nothing in it",
    async () => {
      // Run as root (the Linux container run): a user's store must not be
      // opened, created in, or changed by root at all.
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
      rmSync(join(store, 'lmdb', LMDB_HOLDER_LOCK_FILE));
      const before = snapshotDirectory(join(store, 'lmdb'));

      for (const mode of /** @type {const} */ (['read', 'write'])) {
        const asRoot = startChild(store, mode, 1_000);
        const refused = await asRoot.next();
        expect(refused).toMatchObject({
          refused: true,
          code: 'local-store-lock',
        });
        expect(refused.message).toContain(`belongs to uid ${owner.uid}`);
      }
      expect(snapshotDirectory(join(store, 'lmdb'))).toEqual(before);

      // A store that does not exist yet: root creates nothing in the tree,
      // neither the store's directory nor any missing parent of it.
      const missing = join(root, 'not-yet', 'control');
      const rootBefore = snapshotDirectory(root);
      const creating = startChild(missing, 'write', 1_000);
      const refusedCreate = await creating.next();
      expect(refusedCreate).toMatchObject({
        refused: true,
        code: 'local-store-lock',
      });
      expect(refusedCreate.message).toContain(`belongs to uid ${owner.uid}`);
      expect(refusedCreate.message).toContain('Nothing was created');
      expect(snapshotDirectory(root)).toEqual(rootBefore);

      const asOwner = startChild(store, 'write', 1_000, owner);
      expect(await asOwner.next()).toMatchObject({ opened: true });
      asOwner.close();
      await asOwner.next();
    },
    30_000,
  );

  // As a non-root owner acting as another user: run as root, the store is
  // root's, which the root-only test covers.
  testUnlessRoot(
    "another user is refused before a missing store is created in the owner's tree",
    async () => {
      const parent = mkdtempSync(join(tmpdir(), 'wharfie-holder-lock-create-'));
      roots.push(parent);
      const ownerUid = lstatSync(parent).uid;
      const before = snapshotDirectory(parent);
      for (const dbRoot of [
        join(parent, 'lmdb'),
        join(parent, 'deeper', 'control', 'lmdb'),
      ]) {
        expect(() =>
          assertMayCreateLocalStore(dbRoot, { effectiveUid: ownerUid + 1 }),
        ).toThrow(
          expect.objectContaining({
            code: 'local-store-lock',
            message: expect.stringContaining(
              `${parent}, belongs to uid ${ownerUid}`,
            ),
          }),
        );
        // The owner, and the tree's root-owned ancestors, may create it.
        expect(() =>
          assertMayCreateLocalStore(dbRoot, { effectiveUid: ownerUid }),
        ).not.toThrow();
      }
      expect(snapshotDirectory(parent)).toEqual(before);
      // Root-owned ancestors only: anyone may create a store under them.
      expect(() =>
        assertMayCreateLocalStore('/wharfie-missing-test-root/control/lmdb', {
          effectiveUid: ownerUid + 1,
        }),
      ).not.toThrow();
      // A link on the way counts its own owner too: root acting through a
      // user's link is refused.
      const link = join(parent, 'link-to-root');
      symlinkSync('/', link);
      expect(() =>
        assertMayCreateLocalStore(join(link, 'wharfie-missing-test', 'lmdb'), {
          effectiveUid: 0,
        }),
      ).toThrow(expect.objectContaining({ code: 'local-store-lock' }));
    },
    30_000,
  );

  test('a root-owned store directory is refused without suggesting to run as root', async () => {
    const failure = (() => {
      try {
        // /usr is root-owned on every supported platform; this process is
        // not root, or acts as another uid if it is.
        tryAcquireLmdbHolderLock('/usr', {
          exclusive: false,
          readOnly: true,
          effectiveUid: 4242,
        });
      } catch (error) {
        return /** @type {Error & {code?: string}} */ (error);
      }
      return undefined;
    })();
    expect(failure).toMatchObject({ code: 'local-store-lock' });
    expect(failure?.message).toContain('belongs to root (uid 0)');
    expect(failure?.message).toContain('move root');
    expect(failure?.message).not.toContain("'#0'");
  }, 30_000);

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

  // As a non-root owner acting as another user: run as root, the store is
  // root's, which the root-only test covers.
  testUnlessRoot(
    'another user is refused before anything in the store is created, opened, removed or changed',
    async () => {
      const store = await createStore();
      const dbRoot = join(store, 'lmdb');
      // No lock file yet, so a create would show; a stale record, so a removal
      // would show.
      rmSync(join(dbRoot, LMDB_HOLDER_LOCK_FILE));
      writeFileSync(
        join(dbRoot, LMDB_HOLDER_RECORD_FILE),
        JSON.stringify({ pid: process.pid, startedAt: 1, command: 'stale' }),
        { mode: 0o600 },
      );
      const before = snapshotDirectory(dbRoot);
      const ownerUid = lstatSync(dbRoot).uid;
      for (const exclusive of [true, false]) {
        let refusal;
        try {
          // Act as a user who does not own the directory (root, in
          // production), without needing root here.
          tryAcquireLmdbHolderLock(dbRoot, {
            exclusive,
            readOnly: !exclusive,
            effectiveUid: ownerUid + 1,
          });
        } catch (error) {
          refusal = error;
        }
        expect(refusal).toMatchObject({ code: 'local-store-lock' });
        expect(/** @type {Error} */ (refusal).message).toContain(
          `belongs to uid ${ownerUid}, and this process runs as uid ${ownerUid + 1}`,
        );
        expect(/** @type {Error} */ (refusal).message).toContain(
          `sudo -u '#${ownerUid}'`,
        );
      }
      expect(snapshotDirectory(dbRoot)).toEqual(before);
    },
    30_000,
  );

  test('refuses a store whose LMDB directory is a symbolic link, creating nothing through it', async () => {
    const store = await createStore();
    const dbRoot = join(store, 'lmdb');
    const real = join(store, 'lmdb.real');
    renameSync(dbRoot, real);
    rmSync(join(real, LMDB_HOLDER_LOCK_FILE));
    symlinkSync(real, dbRoot);
    const before = snapshotDirectory(real);
    // A writable open (the read-only adapter path refuses a linked volume
    // itself, before the lock).
    await expect(
      createControlDBClient('lmdb', { path: store, lockWaitMs: 100 }),
    ).rejects.toMatchObject({
      code: 'local-store-lock',
      message: expect.stringContaining(
        'must be a directory, not a symbolic link',
      ),
    });
    expect(snapshotDirectory(real)).toEqual(before);
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
