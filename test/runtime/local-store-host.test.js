/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  utimesSync,
} from 'node:fs';
import { once } from 'node:events';
import net from 'node:net';
import v8 from 'node:v8';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, jest, test } from '@jest/globals';

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
import { routeLocalResidentMutation } from '../../src/core/runtime/services/resident-activity-worker.js';

const CHILD = fileURLToPath(
  new URL('../fixtures/local-store-host-child.js', import.meta.url),
);
const READER = fileURLToPath(
  new URL('../fixtures/local-store-host-reader.js', import.meta.url),
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

/** @param {string} storePath @param {number} [serveDelayMs] @param {string[]} [nodeArgs] @param {number} [bulkRecords] */
async function startHostChild(
  storePath,
  serveDelayMs = 0,
  nodeArgs = [],
  bulkRecords = 0,
) {
  const child = spawn(
    process.execPath,
    [...nodeArgs, CHILD, storePath, String(serveDelayMs), String(bulkRecords)],
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
    next,
    stderr: () => stderr,
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

  test('reroutes a read whose host stops mid-operation instead of failing the command', async () => {
    const storePath = join(createRoot(), 'control');
    const first = await startHostChild(storePath);
    const client = await createControlDBClient('lmdb', {
      path: storePath,
      readOnly: true,
    });
    expect(isLocalStoreHostClient(client)).toBe(true);
    const read = async () =>
      await client.get({
        tableName: 'records',
        keyName: 'pk',
        keyValue: 'item',
        sortKeyName: 'sk',
        sortKeyValue: 's-c',
      });
    expect(await read()).toEqual({ pk: 'item', sk: 's-c', n: 99 });

    // A restarted host serves the next read through the same client.
    await first.stop();
    const second = await startHostChild(storePath);
    expect(await read()).toEqual({ pk: 'item', sk: 's-c', n: 99 });

    // With no host left, the read opens the store directly.
    await second.stop();
    expect(await findLocalStoreHost({ storePath })).toBeUndefined();
    expect(await read()).toEqual({ pk: 'item', sk: 's-c', n: 99 });
    await client.close();
  }, 30_000);

  // A host that is alive but not answering (paused in a debugger, SIGSTOP,
  // blocked event loop) still has its socket bound, so the kernel accepts a
  // connection that nobody reads. Every request to it must time out.
  // The packaged SEA verifier held a hosting `activity run` at a debugger
  // breakpoint and then read the store, which routed to that same paused
  // process: a cycle that hung CI until the job was cancelled.
  test('bounds a read that routes to a host its own caller holds paused in the debugger', async () => {
    const storePath = join(createRoot(), 'control');
    const host = await startHostChild(storePath, 0, ['--inspect=127.0.0.1:0']);
    const url = /ws:\/\/\S+/.exec(host.stderr())?.[0];
    expect(url).toBeDefined();
    const debuggerSocket = new globalThis.WebSocket(
      /** @type {string} */ (url),
    );
    await new Promise((resolve) =>
      debuggerSocket.addEventListener('open', resolve, { once: true }),
    );
    cleanups.push(async () => debuggerSocket.close());
    const paused = new Promise((resolve) =>
      debuggerSocket.addEventListener('message', (event) => {
        if (JSON.parse(String(event.data)).method === 'Debugger.paused') {
          resolve(undefined);
        }
      }),
    );
    debuggerSocket.send(JSON.stringify({ id: 1, method: 'Debugger.enable' }));
    debuggerSocket.send(JSON.stringify({ id: 2, method: 'Debugger.pause' }));

    const started = Date.now();
    const read = connectLocalStoreHost({ storePath, responseTimeoutMs: 500 });
    await paused;
    await expect(read).rejects.toMatchObject({
      name: 'LocalStoreHostReadError',
      timedOut: true,
      message: expect.stringMatching(/may be paused or stuck/),
    });
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 15_000);

  test('never falls back to a direct writable mutation while another process hosts the store', async () => {
    const root = createRoot();
    const controlPath = join(root, 'control');
    // A live host whose store has no resident owner: as during a resident's
    // startup before it claims ownership, or a host that never will.
    await startHostChild(controlPath);
    const payloadPath = join(root, 'payloads');
    /** @type {any} */
    const mutateDirect = jest.fn(async () => ({ applied: true }));
    const error = await routeLocalResidentMutation({
      appId: 'hosted-app',
      requestId: 'wlm_hosted-request',
      command: 'execution-ledger-submit',
      request: {},
      configuration: {
        adapterName: 'lmdb',
        controlPath,
        tableName: 'records',
        payloadPath,
        payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
        sessionPath: join(root, 'sessions'),
      },
      mutateDirect,
      failureMessage: 'Hosted mutation was not delivered.',
    }).then(
      () => undefined,
      (/** @type {any} */ caught) => caught,
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.message).toBe('Hosted mutation was not delivered.');
    expect(error.errors.at(-1)).toBeInstanceOf(LocalStoreHostedError);
    expect(error.errors.at(-1).message).toMatch(/did not accept the command/);
    expect(mutateDirect).not.toHaveBeenCalled();
  }, 40_000);

  /**
   * @param {string} storePath
   * @param {'read'|'close'} step
   */
  async function readerAgainstFrozenHost(storePath, step) {
    const host = await startHostChild(storePath);
    const reader = spawn(process.execPath, [READER, storePath, '500'], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    cleanups.push(async () => {
      if (reader.exitCode === null && reader.signalCode === null) {
        reader.kill('SIGKILL');
      }
    });
    const lines = createInterface({
      input: /** @type {import('node:stream').Readable} */ (reader.stdout),
    })[Symbol.asyncIterator]();
    const nextLine = async () => String((await lines.next()).value);
    expect(JSON.parse(await nextLine())).toEqual({ ready: true });
    process.kill(host.child.pid ?? 0, 'SIGSTOP');
    cleanups.push(async () => {
      process.kill(host.child.pid ?? 0, 'SIGCONT');
    });
    const started = Date.now();
    reader.stdin?.write(`${step}\n`);
    const outcome = step === 'read' ? JSON.parse(await nextLine()) : undefined;
    const [code, signal] = await once(reader, 'close');
    return { outcome, code, signal, elapsed: Date.now() - started };
  }

  test('a reader whose host freezes mid-session times out the read and exits by itself', async () => {
    const result = await readerAgainstFrozenHost(
      join(createRoot(), 'control'),
      'read',
    );
    expect(result.outcome).toEqual({
      read: 'LocalStoreHostReadError',
      timedOut: true,
    });
    expect(result).toMatchObject({ code: 0, signal: null });
    expect(result.elapsed).toBeLessThan(5_000);
  }, 20_000);

  test('a reader that closes its client against a frozen host exits by itself', async () => {
    const result = await readerAgainstFrozenHost(
      join(createRoot(), 'control'),
      'close',
    );
    expect(result).toMatchObject({ code: 0, signal: null });
    expect(result.elapsed).toBeLessThan(5_000);
  }, 20_000);

  test('a protocol mismatch fails at once with a specific error, in both directions', async () => {
    const storePath = join(createRoot(), 'control');
    const host = await startHostChild(storePath);

    // An older or newer client against this host.
    const socket = net.createConnection(host.endpoint);
    await once(socket, 'connect');
    const body = Buffer.from(
      JSON.stringify({ version: 2, kind: 'open', storeRoot: '/elsewhere' }),
    );
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.byteLength, 0);
    socket.end(Buffer.concat([header, body]));
    /** @type {Buffer[]} */
    const chunks = [];
    for await (const chunk of socket) chunks.push(chunk);
    const answer = v8.deserialize(Buffer.concat(chunks).subarray(4));
    expect(answer).toMatchObject({
      kind: 'error',
      error: { code: 'local-store-host-protocol' },
    });
    expect(answer.error.message).toMatch(
      /speaks local store host protocol 1, not 2/,
    );

    // This client against a host from another version, at the same endpoint.
    host.child.kill('SIGKILL');
    await host.exited;
    rmSync(host.endpoint, { force: true });
    /** @type {Set<import('node:net').Socket>} */
    const peers = new Set();
    const future = net.createServer((peer) => {
      peers.add(peer);
      const reply = v8.serialize({ version: 2, kind: 'opened', processId: 1 });
      const frame = Buffer.alloc(4);
      frame.writeUInt32BE(reply.byteLength, 0);
      peer.end(Buffer.concat([frame, reply]));
    });
    await new Promise((resolve) =>
      future.listen(host.endpoint, () => resolve(undefined)),
    );
    cleanups.push(async () => {
      for (const peer of peers) peer.destroy();
      await new Promise((resolve) => future.close(() => resolve(undefined)));
    });
    const started = Date.now();
    await expect(connectLocalStoreHost({ storePath })).rejects.toMatchObject({
      code: 'local-store-host-protocol',
    });
    expect(Date.now() - started).toBeLessThan(2_000);
  }, 20_000);

  test('returns a large partition through the host in linear time', async () => {
    const storePath = join(createRoot(), 'control');
    // 1,536 records of 32 KiB: a 48 MiB response, like one long run's
    // partition. Reassembling frames by concatenating on every chunk took
    // tens of seconds at this size.
    await startHostChild(storePath, 0, [], 1536);
    const client = await connectLocalStoreHost({ storePath });
    const started = Date.now();
    const items = await client?.query({
      tableName: 'records',
      consistentRead: true,
      keyConditions: [
        {
          keyType: 'PRIMARY',
          conditionType: 'EQUALS',
          propertyName: 'pk',
          propertyValue: 'bulk',
        },
      ],
    });
    const elapsed = Date.now() - started;
    await client?.close();
    expect(items).toHaveLength(1536);
    expect(elapsed).toBeLessThan(10_000);
  }, 60_000);

  test('times out the handshake with a host that has stopped answering', async () => {
    const storePath = join(createRoot(), 'control');
    const host = await startHostChild(storePath);
    process.kill(host.child.pid ?? 0, 'SIGSTOP');
    cleanups.push(async () => {
      process.kill(host.child.pid ?? 0, 'SIGCONT');
    });
    const started = Date.now();
    const error = await connectLocalStoreHost({
      storePath,
      responseTimeoutMs: 300,
    }).then(
      () => undefined,
      (/** @type {any} */ caught) => caught,
    );
    expect(error).toBeInstanceOf(LocalStoreHostReadError);
    expect(error.timedOut).toBe(true);
    expect(error.message).toMatch(
      /did not answer the read handshake within 300ms/,
    );
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 10_000);

  test('times out a read whose host stops answering mid-session without rerouting', async () => {
    const storePath = join(createRoot(), 'control');
    const host = await startHostChild(storePath);
    /** @type {any} */
    const reopen = jest.fn(async () => {
      throw new Error('A timed-out read must not be rerouted.');
    });
    const client = await connectLocalStoreHost({
      storePath,
      callTimeoutMs: 300,
      reopen,
    });
    const read = async () =>
      await client?.get({
        tableName: 'records',
        keyName: 'pk',
        keyValue: 'item',
        sortKeyName: 'sk',
        sortKeyValue: 's-d',
      });
    expect(await read()).toEqual({ pk: 'item', sk: 's-d', n: 100 });
    process.kill(host.child.pid ?? 0, 'SIGSTOP');
    cleanups.push(async () => {
      process.kill(host.child.pid ?? 0, 'SIGCONT');
    });
    await expect(read()).rejects.toMatchObject({
      name: 'LocalStoreHostReadError',
      timedOut: true,
    });
    expect(reopen).not.toHaveBeenCalled();
    await client?.close();
  }, 10_000);

  test('an operator command against a host that stopped answering exits on its own with a clear error', async () => {
    const root = createRoot();
    const controlPath = join(root, 'control');
    const host = await startHostChild(controlPath);
    process.kill(host.child.pid ?? 0, 'SIGSTOP');
    cleanups.push(async () => {
      process.kill(host.child.pid ?? 0, 'SIGCONT');
    });
    const started = Date.now();
    const result = spawnSync(
      process.execPath,
      [
        join(REPO_ROOT, 'bin', 'wharfie'),
        'ops',
        'inspect',
        '--run-id',
        'wlm_absent',
        '--json',
      ],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 40_000,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          NO_COLOR: '1',
          WHARFIE_CONTROL_ADAPTER: 'lmdb',
          WHARFIE_CONTROL_PATH: controlPath,
          WHARFIE_EXECUTION_LEDGER_TABLE: 'records',
          WHARFIE_EXECUTION_PAYLOAD_PATH: join(root, 'payloads'),
          WHARFIE_LEDGER_SERVICE_SESSION_PATH: join(root, 'sessions'),
        },
      },
    );
    // Killed by spawnSync's own timeout would mean the command hung.
    expect(result.signal).toBeNull();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(
      /did not answer the read handshake within 10000ms; it may be paused or stuck/,
    );
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 60_000);

  test('never treats a refused endpoint as free while the process that bound it is alive', async () => {
    const root = createRoot();
    const storePath = join(root, 'control');
    const host = await startHostChild(storePath);
    host.child.kill('SIGKILL');
    await host.exited;
    // The same stale endpoint, but naming a live process (this one) that was
    // running before the endpoint was bound: the original holder is alive.
    const heldEndpoint = host.endpoint.replace(
      /-\d+-([0-9a-f]+\.sock)$/,
      `-${process.pid}-$1`,
    );
    renameSync(host.endpoint, heldEndpoint);
    const now = new Date();
    utimesSync(heldEndpoint, now, now);
    cleanups.push(async () => rmSync(heldEndpoint, { force: true }));

    expect(await findLocalStoreHost({ storePath })).toBe(heldEndpoint);
    await expect(
      connectLocalStoreHost({ storePath, timeoutMs: 300 }),
    ).rejects.toBeInstanceOf(LocalStoreHostReadError);
    const payloadPath = join(root, 'payloads');
    await expect(
      withExecutionLedger(async () => 'opened', {
        configuration: {
          adapterName: 'lmdb',
          controlPath: storePath,
          tableName: 'records',
          payloadPath,
          payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
          sessionPath: join(root, 'sessions'),
        },
      }),
    ).rejects.toBeInstanceOf(LocalStoreHostedError);

    // A pid that was reused after the endpoint was bound holds nothing.
    const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    utimesSync(heldEndpoint, longAgo, longAgo);
    expect(await findLocalStoreHost({ storePath })).toBeUndefined();
    expect(await connectLocalStoreHost({ storePath })).toBeUndefined();
  }, 30_000);

  test("answers a read from the resident's own child while the resident waits for it", async () => {
    const storePath = join(createRoot(), 'control');
    const host = await startHostChild(storePath);
    host.child.stdin?.write('child-read\n');
    const reported = await host.next();
    expect(reported.childExit).toBe(0);
    expect(JSON.parse(reported.childOutput)).toEqual({
      hosted: true,
      record: { pk: 'item', sk: 's-b', n: 98 },
    });
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
