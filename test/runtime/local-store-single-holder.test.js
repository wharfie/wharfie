/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from '@jest/globals';

import { createControlDBClient } from '../../src/core/lib/config/db.js';
import { createCoordinatorAuthority } from '../../src/core/lib/db/tables/coordinator-authority.js';
import { takeoverCoordinatorAuthority } from '../../src/core/runtime/operator/coordinator-authority-command.js';

// At most one process holds a local store's LMDB environment. Every other
// process reads through it, or is refused before any native open. These
// races only exist between processes, so every case runs real ones.

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HOST_CHILD = fileURLToPath(
  new URL('../fixtures/local-store-host-child.js', import.meta.url),
);
const DIRECT_CHILD = fileURLToPath(
  new URL('../fixtures/lmdb-holder-lock-child.js', import.meta.url),
);
const RECORDER = fileURLToPath(
  new URL('../fixtures/lmdb-open-recorder.cjs', import.meta.url),
);
const COORDINATOR_CHILD = fileURLToPath(
  new URL('../fixtures/coordinator-takeover-child.js', import.meta.url),
);
const MESSAGE_TIMEOUT_MS = 20_000;
const describeOnUnix = process.platform === 'win32' ? describe.skip : describe;

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

function createRoot() {
  const root = mkdtempSync(join(tmpdir(), 'wharfie-single-holder-'));
  roots.push(root);
  return {
    storePath: join(root, 'control'),
    openLog: join(root, 'lmdb-opens.jsonl'),
  };
}

/**
 * @param {string} script
 * @param {string[]} args
 * @param {string} openLog
 */
function start(script, args, openLog) {
  const child = spawn(
    process.execPath,
    ['--require', RECORDER, script, ...args],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, WHARFIE_TEST_LMDB_OPEN_LOG: openLog },
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  );
  children.push(child);
  /** @type {Record<string, any>[]} */
  const queue = [];
  /** @type {Array<() => void>} */
  const waiters = [];
  createInterface({ input: /** @type {any} */ (child.stdout) }).on(
    'line',
    (line) => {
      queue.push(JSON.parse(line));
      for (const wake of waiters.splice(0)) wake();
    },
  );
  child.once('exit', () => {
    for (const wake of waiters.splice(0)) wake();
  });
  /** @returns {Promise<Record<string, any>>} */
  const next = async () => {
    const deadline = Date.now() + MESSAGE_TIMEOUT_MS;
    while (queue.length === 0) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`child ${child.pid} exited without a message`);
      }
      if (Date.now() >= deadline) {
        throw new Error(`child ${child.pid} sent no message in time`);
      }
      await new Promise((resolve) => {
        waiters.push(() => resolve(undefined));
        setTimeout(resolve, 100);
      });
    }
    return /** @type {Record<string, any>} */ (queue.shift());
  };
  return {
    child,
    next,
    pending: () => queue.length,
    send: (/** @type {string} */ line) =>
      /** @type {any} */ (child.stdin).write(`${line}\n`),
  };
}

/** @param {ReturnType<typeof createRoot>} root @param {string[]} [extra] */
function startHost(root, extra = []) {
  return start(HOST_CHILD, [root.storePath, '0', '0', ...extra], root.openLog);
}

/** @param {ReturnType<typeof createRoot>} root @param {number | undefined} pid */
function nativeOpensBy(root, pid) {
  if (!existsSync(root.openLog)) return [];
  return readFileSync(root.openLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.pid === pid);
}

describeOnUnix('one holder per local store', () => {
  test('a second host beside a live one is refused before it opens the store, every time', async () => {
    const root = createRoot();
    const holder = startHost(root);
    expect(await holder.next()).toMatchObject({ ready: true });

    // The shape of a foreground `wharfie run` following a live resident: it
    // retries hosting, and each retry must stay away from the store.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const follower = startHost(root);
      const refused = await follower.next();
      expect(refused).toMatchObject({
        refused: true,
        name: 'LocalServiceSessionActiveError',
        code: 'local-store-held',
      });
      expect(refused.message).toContain(`pid ${holder.child.pid}`);
      expect(nativeOpensBy(root, follower.child.pid)).toEqual([]);
    }
    expect(holder.child.exitCode).toBeNull();
    holder.send('stop');
    expect(await holder.next()).toMatchObject({ stopped: true });
  }, 60_000);

  test('of two hosts that start together, exactly one holds the store', async () => {
    for (let round = 0; round < 6; round += 1) {
      const root = createRoot();
      const pair = [startHost(root), startHost(root)];
      const outcomes = await Promise.all(pair.map((host) => host.next()));
      const ready = outcomes.filter((outcome) => outcome.ready === true);
      const refused = outcomes.filter((outcome) => outcome.refused === true);
      expect({ round, ready: ready.length, refused: refused.length }).toEqual({
        round,
        ready: 1,
        refused: 1,
      });
      expect(refused[0].name).toBe('LocalServiceSessionActiveError');
      expect(refused[0].message).toContain(`pid ${ready[0].pid}`);
      const winner = pair.find((host) => host.child.pid === ready[0].pid);
      winner?.send('stop');
      expect(await winner?.next()).toMatchObject({ stopped: true });
    }
  }, 120_000);

  test('a waiting host gives up after its bound, naming the holder, and takes over once it is released', async () => {
    const root = createRoot();
    const holder = startHost(root);
    expect(await holder.next()).toMatchObject({ ready: true });

    const started = Date.now();
    const impatient = startHost(root, ['wait', '1000']);
    const refused = await impatient.next();
    expect(refused).toMatchObject({ refused: true, code: 'local-store-held' });
    expect(refused.message).toContain(`pid ${holder.child.pid}`);
    expect(refused.message).toContain('Waited 1000ms');
    expect(refused.at - started).toBeGreaterThanOrEqual(1000);
    expect(nativeOpensBy(root, impatient.child.pid)).toEqual([]);

    const successor = startHost(root, ['wait', '15000']);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(successor.pending()).toBe(0);
    const stopRequestedAt = Date.now();
    holder.send('stop');
    expect(await holder.next()).toMatchObject({ stopped: true });
    const ready = await successor.next();
    expect(ready).toMatchObject({ ready: true });
    expect(ready.openedAt).toBeGreaterThanOrEqual(stopRequestedAt);
    successor.send('stop');
    await successor.next();
  }, 60_000);

  test('a host does not open the store while a direct reader is still inside it', async () => {
    const root = createRoot();
    const seed = await createControlDBClient('lmdb', { path: root.storePath });
    await seed.put({
      tableName: 'records',
      keyName: 'pk',
      record: { pk: 'x' },
    });
    await seed.close();

    // A reader that found no host and opened the store directly, just before
    // a resident started. The resident must wait for it to leave.
    const reader = start(
      DIRECT_CHILD,
      [root.storePath, 'read', '1000'],
      root.openLog,
    );
    expect(await reader.next()).toMatchObject({ opened: true });
    const host = startHost(root);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(host.pending()).toBe(0);
    expect(nativeOpensBy(root, host.child.pid)).toEqual([]);

    reader.send('close');
    const closed = await reader.next();
    const ready = await host.next();
    expect(ready).toMatchObject({ ready: true });
    expect(ready.openedAt).toBeGreaterThanOrEqual(closed.after);
    host.send('stop');
    await host.next();
  }, 60_000);

  test('a coordinator takeover while the store is held writes through the holder, and replays the same receipt', async () => {
    const root = createRoot();
    const tableName = 'execution-ledger';
    const seed = await createControlDBClient('lmdb', { path: root.storePath });
    const predecessor = await createCoordinatorAuthority({
      db: seed,
      tableName,
    }).acquire({
      appId: 'held-app',
      coordinatorId: 'predecessor',
      requestId: 'predecessor-acquire',
    });
    await seed.close();
    expect(predecessor.authority.status).toBe('ACTIVE');

    const holder = startHost(root);
    expect(await holder.next()).toMatchObject({ ready: true });
    const operator = start(
      COORDINATOR_CHILD,
      [root.storePath, tableName, 'held-app'],
      root.openLog,
    );
    const outcome = await operator.next();
    expect(outcome.error).toBeUndefined();
    expect(outcome.inspection.observedAuthority).toEqual(predecessor.authority);
    expect(outcome.applied).toMatchObject({
      applied: true,
      takeoverAuthority: { coordinatorId: 'successor', epoch: 2 },
      resultAuthority: { status: 'RELEASED' },
    });
    expect(outcome.replayed).toEqual({ ...outcome.applied, applied: false });
    // The takeover changed the held store without opening it.
    expect(nativeOpensBy(root, operator.child.pid)).toEqual([]);
    expect(holder.child.exitCode).toBeNull();

    holder.send('stop');
    expect(await holder.next()).toMatchObject({ stopped: true });
    // With nobody holding the store, the same replay opens it directly.
    const replayed = await takeoverCoordinatorAuthority({
      appId: 'held-app',
      coordinatorId: 'successor',
      requestId: 'successor-takeover',
      inspection: outcome.inspection,
      confirmAuthorityReplacement: true,
      configuration: {
        adapterName: 'lmdb',
        controlPath: root.storePath,
        tableName,
        payloadPath: join(root.storePath, '..', 'payloads'),
        payloadStoreId: 'held-app-payloads',
        sessionPath: join(root.storePath, '..', 'sessions'),
      },
    });
    expect(replayed).toEqual(outcome.replayed);
  }, 60_000);
});
