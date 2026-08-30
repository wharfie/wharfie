/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from '@jest/globals';

import { APPLICATION_STATE_TABLE_NAME } from '../../src/core/lib/config/db.js';
import {
  ResidentReplacementInputStoreIntegrityError,
  ResidentReplacementInputStoreNotFoundError,
  createLocalResidentReplacementInputStore,
} from '../../src/core/lib/replacement-input-store/local.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  createResidentReplacementInputReceipt,
  encodeResidentReplacementInputReceipt,
} from '../../src/core/runtime/resident-replacement-input.js';

const APP_ID = 'replacement-store-app';
const PAYLOAD_STORE_ID = 'replacement-store-payloads';

/** @param {string} prefix @param {string} label @returns {string} */
function id(prefix, label) {
  return createCanonicalJsonSha256Id({
    domain: `wharfie:test:replacement-input-store:${prefix}`,
    prefix,
    value: { label },
  });
}

/**
 * @param {string} [label]
 * @returns {ReturnType<typeof createResidentReplacementInputReceipt>}
 */
function receipt(label = 'primary') {
  return createResidentReplacementInputReceipt({
    appId: APP_ID,
    currentRevisionId: id('wrv1', `revision-${label}`),
    control: {
      profile: 'dynamodb-rvn-v1',
      adapterName: 'dynamodb',
      region: 'us-east-2',
      tableName: 'wharfie-execution-ledger-v10',
      tableResourceId: id('wdtr1', `table-${label}`),
    },
    payloadStorage: {
      kind: 'wharfie.local-content-addressed.v1',
      storeId: PAYLOAD_STORE_ID,
      distribution: {
        kind: 'wharfie.execution-payload-distribution.v1',
        distributionId: id('wepd1', `distribution-${label}`),
        storeId: PAYLOAD_STORE_ID,
      },
    },
    applicationStateDestination: {
      kind: 'application-state',
      version: 2,
      bindingId: 'primary',
      configuration: {
        provider: 'lmdb',
        storeId: id('was', `application-state-${label}`),
        tableName: APPLICATION_STATE_TABLE_NAME,
        namespace: APP_ID,
      },
    },
  });
}

/**
 * @param {(root: string) => Promise<void>} body
 * @returns {Promise<void>}
 */
async function withRoot(body) {
  const outer = await fsp.mkdtemp(
    join(tmpdir(), 'wharfie-replacement-input-store-'),
  );
  try {
    await body(outer);
  } finally {
    await fsp.rm(outer, { recursive: true, force: true });
  }
}

describe('local resident replacement input store', () => {
  it('durably publishes one immutable receipt and replays concurrent exact puts', async () => {
    await withRoot(async (outer) => {
      const root = join(outer, 'new', 'nested', 'handoff');
      const store = createLocalResidentReplacementInputStore({ path: root });
      const expected = receipt();
      const [first, second] = await Promise.all([
        store.put(expected),
        store.put(expected),
      ]);

      expect(first).toEqual(expected);
      expect(second).toEqual(expected);
      await expect(store.read(expected.receiptId)).resolves.toEqual(expected);
      await expect(store.readBytes(expected.receiptId)).resolves.toEqual(
        encodeResidentReplacementInputReceipt(expected),
      );
      const stats = await fsp.lstat(store.getPath(expected.receiptId));
      expect(stats.isFile()).toBe(true);
      expect(stats.mode & 0o777).toBe(0o600);
      expect(
        (await fsp.readdir(dirname(store.getPath(expected.receiptId)))).sort(),
      ).toEqual([`${expected.receiptId}.json`]);
    });
  });

  it('copies the exact artifact into a fresh root without changing its receipt', async () => {
    await withRoot(async (outer) => {
      const source = createLocalResidentReplacementInputStore({
        path: join(outer, 'source'),
      });
      const replacement = createLocalResidentReplacementInputStore({
        path: join(outer, 'fresh-replacement'),
      });
      const expected = receipt();
      await source.put(expected);

      const copied = await replacement.putBytes(
        await source.readBytes(expected.receiptId),
      );
      expect(copied).toEqual(expected);
      expect(replacement.getPath(expected.receiptId)).not.toBe(
        source.getPath(expected.receiptId),
      );
      await expect(replacement.read(expected.receiptId)).resolves.toEqual(
        expected,
      );
      await expect(replacement.readBytes(expected.receiptId)).resolves.toEqual(
        await source.readBytes(expected.receiptId),
      );
    });
  });

  it('fails read-only on absence without materializing a handoff root', async () => {
    await withRoot(async (outer) => {
      const root = join(outer, 'missing', 'handoff');
      const store = createLocalResidentReplacementInputStore({ path: root });
      const expected = receipt();
      await expect(store.read(expected.receiptId)).rejects.toBeInstanceOf(
        ResidentReplacementInputStoreNotFoundError,
      );
      await expect(fsp.lstat(root)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('detects same-length tampering and never repairs an immutable path', async () => {
    await withRoot(async (outer) => {
      const store = createLocalResidentReplacementInputStore({
        path: join(outer, 'handoff'),
      });
      const expected = receipt();
      await store.put(expected);
      const artifactPath = store.getPath(expected.receiptId);
      const original = await fsp.readFile(artifactPath);
      const tampered = Buffer.from(original);
      const marker = Buffer.from(expected.currentRevisionId, 'utf8');
      const replacement = Buffer.from(id('wrv1', 'tampered-revision'), 'utf8');
      expect(replacement.byteLength).toBe(marker.byteLength);
      const offset = tampered.indexOf(marker);
      expect(offset).toBeGreaterThanOrEqual(0);
      replacement.copy(tampered, offset);
      expect(tampered.byteLength).toBe(original.byteLength);
      await fsp.writeFile(artifactPath, tampered);

      await expect(store.read(expected.receiptId)).rejects.toBeInstanceOf(
        ResidentReplacementInputStoreIntegrityError,
      );
      await expect(store.put(expected)).rejects.toBeInstanceOf(
        ResidentReplacementInputStoreIntegrityError,
      );
      await expect(fsp.readFile(artifactPath)).resolves.toEqual(tampered);
    });
  });

  it('rejects noncanonical copied bytes before creating a fresh root', async () => {
    await withRoot(async (outer) => {
      const root = join(outer, 'fresh');
      const store = createLocalResidentReplacementInputStore({ path: root });
      const pretty = Buffer.from(JSON.stringify(receipt(), null, 2), 'utf8');
      await expect(store.putBytes(pretty)).rejects.toThrow(
        /canonical compact JSON/u,
      );
      await expect(fsp.lstat(root)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('refuses a symlink or directory at an immutable receipt path', async () => {
    await withRoot(async (outer) => {
      const store = createLocalResidentReplacementInputStore({
        path: join(outer, 'handoff'),
      });
      const expected = receipt();
      const artifactPath = store.getPath(expected.receiptId);
      await fsp.mkdir(dirname(artifactPath), { recursive: true });
      await fsp.mkdir(artifactPath);
      await expect(store.read(expected.receiptId)).rejects.toBeInstanceOf(
        ResidentReplacementInputStoreIntegrityError,
      );
      await expect(store.put(expected)).rejects.toBeInstanceOf(
        ResidentReplacementInputStoreIntegrityError,
      );
      expect((await fsp.lstat(artifactPath)).isDirectory()).toBe(true);

      const linked = receipt('symlink');
      const linkedPath = store.getPath(linked.receiptId);
      await fsp.symlink('unpublished-target.json', linkedPath);
      await expect(store.read(linked.receiptId)).rejects.toBeInstanceOf(
        ResidentReplacementInputStoreIntegrityError,
      );
      await expect(store.put(linked)).rejects.toBeInstanceOf(
        ResidentReplacementInputStoreIntegrityError,
      );
      expect((await fsp.lstat(linkedPath)).isSymbolicLink()).toBe(true);
    });
  });

  it('requires one exact canonical store option and receipt identity', async () => {
    expect(() =>
      createLocalResidentReplacementInputStore({ path: 'relative' }),
    ).toThrow(/canonical absolute path/u);
    expect(() =>
      createLocalResidentReplacementInputStore({
        path: '/tmp/replacement-inputs/',
      }),
    ).toThrow(/canonical absolute path/u);
    expect(() =>
      createLocalResidentReplacementInputStore(
        /** @type {any} */ ({
          path: '/tmp/replacement-inputs',
          readOnly: true,
        }),
      ),
    ).toThrow(/exactly path/u);

    await withRoot(async (outer) => {
      const store = createLocalResidentReplacementInputStore({
        path: join(outer, 'handoff'),
      });
      expect(() => store.getPath('not-a-receipt')).toThrow(/wrri1/u);
    });
  });
});
