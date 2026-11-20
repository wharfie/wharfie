/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from '@jest/globals';

import {
  createControlDBClient,
  resolveExecutionPayloadStoreId,
} from '../../src/core/lib/config/db.js';
import {
  LocalStoreHostReadError,
  LocalStoreHostedError,
  acquireLocalStoreHost,
  connectLocalStoreHost,
  findLocalStoreHost,
  isLocalStoreHostClient,
} from '../../src/core/runtime/local-store-host.js';
import { withExecutionLedger } from '../../src/core/runtime/operator/execution-ledger-store.js';

const CHILD = fileURLToPath(
  new URL('../fixtures/local-store-host-child.js', import.meta.url),
);
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const describeOnUnix = process.platform === 'win32' ? describe.skip : describe;
/** @type {Array<() => Promise<void>>} */
const cleanups = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function createRoot() {
  const root = mkdtempSync(join(tmpdir(), 'wharfie-local-store-host-unit-'));
  cleanups.push(async () => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** @param {string} storePath @param {number} [serveDelayMs] */
async function startHostChild(storePath, serveDelayMs = 0) {
  const child = spawn(
    process.execPath,
    [CHILD, storePath, String(serveDelayMs)],
    { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const exited = new Promise((resolve) => child.once('close', resolve));
  const lines = createInterface({
    input: /** @type {import('node:stream').Readable} */ (child.stdout),
  })[Symbol.asyncIterator]();
  const next = async () => {
    const line = await lines.next();
    if (line.done) throw new Error(`Host child exited: ${stderr}`);
    return JSON.parse(line.value);
  };
  const started = await next();
  const handle = {
    child,
    endpoint: /** @type {string} */ (started.endpoint),
    exited,
    stop: async () => {
      child.stdin?.write('stop\n');
      expect(await next()).toEqual({ stopped: true });
      child.stdin?.end();
      await exited;
    },
  };
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
  });
  return handle;
}

describeOnUnix('local store host', () => {
  test('serves reads with the exact semantics of a direct read-only open', async () => {
    const storePath = join(createRoot(), 'control');
    const host = await startHostChild(storePath);
    const remote = await createControlDBClient('lmdb', {
      path: storePath,
      readOnly: true,
    });
    expect(isLocalStoreHostClient(remote)).toBe(true);
    const read = async (/** @type {any} */ db) => ({
      item: await db.get({
        tableName: 'records',
        keyName: 'pk',
        keyValue: 'item',
        sortKeyName: 'sk',
        sortKeyValue: 's-a',
      }),
      missing: await db.get({
        tableName: 'records',
        keyName: 'pk',
        keyValue: 'item',
        sortKeyName: 'sk',
        sortKeyValue: 'zz',
      }),
      all: await db.query({
        tableName: 'records',
        consistentRead: true,
        keyConditions: [
          {
            keyType: 'PRIMARY',
            conditionType: 'EQUALS',
            propertyName: 'pk',
            propertyValue: 'item',
          },
        ],
      }),
      page: await db.queryPage({
        tableName: 'records',
        consistentRead: true,
        keyConditions: [
          {
            keyType: 'PRIMARY',
            conditionType: 'EQUALS',
            propertyName: 'pk',
            propertyValue: 'item',
          },
          {
            keyType: 'SORT',
            conditionType: 'BEGINS_WITH',
            propertyName: 'sk',
            propertyValue: 's-',
          },
        ],
        limit: 2,
        startAfter: 's-a',
      }),
      absentTable: await db
        .get({
          tableName: 'absent',
          keyName: 'pk',
          keyValue: 'x',
        })
        .then(
          () => 'resolved',
          (/** @type {any} */ error) => ({
            name: error.name,
            code: error.code,
            message: error.message,
          }),
        ),
      put: await db
        .put({
          tableName: 'records',
          keyName: 'pk',
          record: { pk: 'nope' },
        })
        .then(
          () => 'resolved',
          (/** @type {any} */ error) => error.message,
        ),
    });
    const hosted = await read(remote);
    await remote.close();
    await host.stop();

    expect(await findLocalStoreHost({ storePath })).toBeUndefined();
    const direct = await createControlDBClient('lmdb', {
      path: storePath,
      readOnly: true,
    });
    expect(isLocalStoreHostClient(direct)).toBe(false);
    try {
      expect(hosted).toEqual(await read(direct));
    } finally {
      await direct.close();
    }
    expect(hosted.absentTable).toMatchObject({
      code: 'WHARFIE_READ_ONLY_STORE_NOT_FOUND',
    });
    expect(hosted.put).toBe('LMDB client is read-only.');
  }, 30_000);

  test('refuses a writable ledger open while another process hosts the store', async () => {
    const root = createRoot();
    const controlPath = join(root, 'control');
    await startHostChild(controlPath);
    const payloadPath = join(root, 'payloads');
    await expect(
      withExecutionLedger(async () => 'opened', {
        configuration: {
          adapterName: 'lmdb',
          controlPath,
          tableName: 'records',
          payloadPath,
          payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
          sessionPath: join(root, 'sessions'),
        },
      }),
    ).rejects.toBeInstanceOf(LocalStoreHostedError);
  }, 30_000);

  test('waits for a host that has not started serving and fails closed after its timeout', async () => {
    const storePath = join(createRoot(), 'control');
    await startHostChild(storePath, 1_500);
    await expect(
      connectLocalStoreHost({ storePath, timeoutMs: 200 }),
    ).rejects.toBeInstanceOf(LocalStoreHostReadError);
    const client = await connectLocalStoreHost({ storePath, timeoutMs: 5_000 });
    expect(isLocalStoreHostClient(client)).toBe(true);
    await client?.close();
  }, 30_000);

  test('drops malformed and oversized frames without disturbing other clients', async () => {
    const storePath = join(createRoot(), 'control');
    const host = await startHostChild(storePath);
    for (const payload of [
      Buffer.from([0, 0, 0, 3, 0x7b, 0x7b, 0x7b]),
      Buffer.from([0xff, 0xff, 0xff, 0xff]),
      Buffer.concat([
        Buffer.from([0, 0, 0, 40]),
        Buffer.from(
          JSON.stringify({ version: 1, kind: 'open', storeRoot: '/x' }).padEnd(
            40,
          ),
        ),
      ]),
    ]) {
      const socket = net.createConnection(host.endpoint);
      socket.write(payload);
      await new Promise((resolve) => socket.once('close', resolve));
    }
    const client = await connectLocalStoreHost({ storePath });
    expect(
      await client?.get({
        tableName: 'records',
        keyName: 'pk',
        keyValue: 'item',
        sortKeyName: 'sk',
        sortKeyValue: 's-b',
      }),
    ).toEqual({ pk: 'item', sk: 's-b', n: 98 });
    await client?.close();
  }, 30_000);

  test('fails a read when its host dies and then treats the stale endpoint as absent', async () => {
    const storePath = join(createRoot(), 'control');
    const host = await startHostChild(storePath);
    const client = await connectLocalStoreHost({ storePath });
    host.child.kill('SIGKILL');
    await host.exited;
    await expect(
      client?.get({
        tableName: 'records',
        keyName: 'pk',
        keyValue: 'item',
        sortKeyName: 'sk',
        sortKeyValue: 's-a',
      }),
    ).rejects.toBeInstanceOf(LocalStoreHostReadError);
    expect(existsSync(host.endpoint)).toBe(true);
    expect(await connectLocalStoreHost({ storePath })).toBeUndefined();

    // A new host removes a dead host's endpoint only once it is old enough.
    const old = new Date(Date.now() - 60_000);
    utimesSync(host.endpoint, old, old);
    const next = await acquireLocalStoreHost({ storePath });
    try {
      expect(existsSync(host.endpoint)).toBe(false);
    } finally {
      await next?.release();
    }
    expect(existsSync(/** @type {string} */ (next?.endpoint))).toBe(false);
  }, 30_000);
});
