/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { createControlDBClient } from '../../src/core/lib/config/db.js';
import * as adapterModule from '../../src/core/lib/db/adapters/lmdb.js';
import { openInstalledStore } from '../../scripts/installed-store-open.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHILD = fileURLToPath(
  new URL('../fixtures/lmdb-holder-lock-child.js', import.meta.url),
);
const describeOnUnix = process.platform === 'win32' ? describe.skip : describe;

/** @type {Array<() => Promise<void> | void>} */
const cleanups = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function heldStore() {
  const root = mkdtempSync(join(tmpdir(), 'wharfie-installed-store-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const seed = await createControlDBClient('lmdb', { path: root });
  await seed.put({ tableName: 'records', keyName: 'pk', record: { pk: 'x' } });
  await seed.close();
  const holder = spawn(process.execPath, [CHILD, root, 'write', '1000'], {
    cwd: REPO_ROOT,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  cleanups.push(() => {
    holder.kill('SIGKILL');
  });
  const lines = createInterface({
    input: /** @type {import('node:stream').Readable} */ (holder.stdout),
  })[Symbol.asyncIterator]();
  const first = await lines.next();
  expect(JSON.parse(String(first.value))).toMatchObject({ opened: true });
  return { root, holder, holderPid: /** @type {number} */ (holder.pid) };
}

describeOnUnix("a verifier's direct open of an installed store", () => {
  test('reads without the lock only beside the holder it holds paused', async () => {
    const { root, holderPid } = await heldStore();
    const db = await openInstalledStore(adapterModule, root, true, {
      isPausedHere: (processId) => processId === holderPid,
    });
    expect(
      await db.get({ tableName: 'records', keyName: 'pk', keyValue: 'x' }),
    ).toEqual({ pk: 'x' });
    await db.close();
  }, 30_000);

  test('is refused beside a live holder even while some other process is paused', async () => {
    const { root } = await heldStore();
    await expect(
      openInstalledStore(adapterModule, root, true, {
        isPausedHere: (processId) => processId === 1,
        waitMs: 300,
      }),
    ).rejects.toMatchObject({ code: 'local-store-busy' });
  }, 30_000);

  test('reads a store with no read host beside its holder only when told to, and reports it', async () => {
    const { root } = await heldStore();
    const onUnhostedRead = jest.fn();
    const started = Date.now();
    const db = await openInstalledStore(adapterModule, root, true, {
      isPausedHere: () => false,
      unhostedStore: true,
      onUnhostedRead,
      unhostedGraceMs: 300,
    });
    // Only after the grace period: a holder that stays is counted.
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(onUnhostedRead).toHaveBeenCalledTimes(1);
    await db.close();
  }, 30_000);

  test('waits out a holder that leaves within the grace period instead of counting it', async () => {
    const { root, holder } = await heldStore();
    setTimeout(() => holder.kill('SIGKILL'), 200);
    const onUnhostedRead = jest.fn();
    const db = await openInstalledStore(adapterModule, root, true, {
      isPausedHere: () => false,
      unhostedStore: true,
      onUnhostedRead,
      unhostedGraceMs: 5_000,
    });
    expect(onUnhostedRead).not.toHaveBeenCalled();
    await db.close();
  }, 30_000);
});
