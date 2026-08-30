/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';

import {
  ExecutionPayloadStoreIntegrityError,
  ExecutionPayloadStoreNotFoundError,
  createLocalExecutionPayloadStore,
} from '../../src/core/lib/payload-store/local.js';

const PAYLOAD_SCHEMA = 'wharfie.execution.activity-evidence.v1';

/**
 * @param {(root: string) => Promise<void>} body
 * @returns {Promise<void>}
 */
async function withStoreRoot(body) {
  const root = await fsp.mkdtemp(join(tmpdir(), 'wharfie-payload-store-'));
  try {
    await body(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

describe('local execution payload store', () => {
  it('persists and reuses canonical JSON through immutable content references', async () => {
    await withStoreRoot(async (root) => {
      const store = createLocalExecutionPayloadStore({
        path: root,
        storeId: 'local-control',
      });
      const [first, second] = await Promise.all([
        store.putJson({
          payloadSchema: PAYLOAD_SCHEMA,
          value: { z: 1, a: { second: 2, first: 1 } },
        }),
        store.putJson({
          payloadSchema: PAYLOAD_SCHEMA,
          value: { a: { first: 1, second: 2 }, z: 1 },
        }),
      ]);

      expect(second).toEqual(first);
      expect(await fsp.readFile(store.getPath(first), 'utf8')).toBe(
        '{"a":{"first":1,"second":2},"z":1}',
      );
      await expect(store.readBytes(first)).resolves.toEqual(
        Buffer.from('{"a":{"first":1,"second":2},"z":1}'),
      );
      await expect(store.readJson(first)).resolves.toEqual({
        a: { first: 1, second: 2 },
        z: 1,
      });
      await expect(store.readVerified(first)).resolves.toEqual({
        reference: first,
        value: { a: { first: 1, second: 2 }, z: 1 },
      });
      await expect(store.verify(first)).resolves.toEqual(first);

      const reopened = createLocalExecutionPayloadStore({
        path: root,
        storeId: 'local-control',
      });
      await expect(reopened.readJson(first)).resolves.toEqual({
        a: { first: 1, second: 2 },
        z: 1,
      });
    });
  });

  it('fails closed on a missing or tampered payload and never repairs it by overwrite', async () => {
    await withStoreRoot(async (root) => {
      const store = createLocalExecutionPayloadStore({
        path: root,
        storeId: 'local-control',
      });
      const reference = await store.putJson({
        payloadSchema: PAYLOAD_SCHEMA,
        value: { retained: true },
      });
      const payloadPath = store.getPath(reference);

      const sameLengthTamper = '{"retained":null}';
      expect(Buffer.byteLength(sameLengthTamper)).toBe(reference.size);
      await fsp.writeFile(payloadPath, sameLengthTamper, 'utf8');
      await expect(store.readBytes(reference)).resolves.toEqual(
        Buffer.from(sameLengthTamper),
      );
      await expect(store.readVerified(reference)).rejects.toThrow(
        /does not match its exact bytes/i,
      );
      await expect(store.readJson(reference)).rejects.toBeInstanceOf(
        ExecutionPayloadStoreIntegrityError,
      );
      await expect(
        store.putJson({
          payloadSchema: PAYLOAD_SCHEMA,
          value: { retained: true },
        }),
      ).rejects.toBeInstanceOf(ExecutionPayloadStoreIntegrityError);
      await expect(fsp.readFile(payloadPath, 'utf8')).resolves.toBe(
        sameLengthTamper,
      );

      await fsp.rm(payloadPath);
      await expect(store.readJson(reference)).rejects.toBeInstanceOf(
        ExecutionPayloadStoreNotFoundError,
      );

      await fsp.mkdir(payloadPath);
      await expect(store.readJson(reference)).rejects.toBeInstanceOf(
        ExecutionPayloadStoreIntegrityError,
      );
    });
  });

  it('refuses references from another storage identity', async () => {
    await withStoreRoot(async (root) => {
      const first = createLocalExecutionPayloadStore({
        path: root,
        storeId: 'first-control',
      });
      const second = createLocalExecutionPayloadStore({
        path: root,
        storeId: 'second-control',
      });
      const reference = await first.putJson({
        payloadSchema: PAYLOAD_SCHEMA,
        value: { isolated: true },
      });

      await expect(second.readJson(reference)).rejects.toThrow(
        /different local payload store/i,
      );
      expect(Object.prototype.hasOwnProperty.call(first, 'delete')).toBe(false);
    });
  });

  it('idempotently imports exact referenced bytes without overwriting a conflict', async () => {
    await withStoreRoot(async (root) => {
      const source = createLocalExecutionPayloadStore({
        path: join(root, 'new', 'nested', 'source'),
        storeId: 'shared-control',
      });
      const replica = createLocalExecutionPayloadStore({
        path: join(root, 'another', 'nested', 'replica'),
        storeId: 'shared-control',
      });
      const reference = await source.putJson({
        payloadSchema: PAYLOAD_SCHEMA,
        value: { retained: true },
      });
      const bytes = await source.readBytes(reference);

      const [first, second] = await Promise.all([
        replica.importBytes({ reference, bytes }),
        replica.importBytes({ reference, bytes: Uint8Array.from(bytes) }),
      ]);
      expect(first).toEqual(reference);
      expect(second).toEqual(reference);
      await expect(replica.readJson(reference)).resolves.toEqual({
        retained: true,
      });

      const payloadPath = replica.getPath(reference);
      const sameLengthTamper = Buffer.from('{"retained":null}');
      expect(sameLengthTamper.byteLength).toBe(reference.size);
      await fsp.writeFile(payloadPath, sameLengthTamper);
      await expect(
        replica.importBytes({ reference, bytes }),
      ).rejects.toBeInstanceOf(ExecutionPayloadStoreIntegrityError);
      await expect(fsp.readFile(payloadPath)).resolves.toEqual(
        sameLengthTamper,
      );

      await expect(
        replica.importBytes({
          reference,
          bytes: Buffer.from('{"retained":false}'),
        }),
      ).rejects.toBeInstanceOf(ExecutionPayloadStoreIntegrityError);
      await expect(
        replica.importBytes(
          /** @type {any} */ ({ reference, bytes, extra: true }),
        ),
      ).rejects.toThrow(/extra is not supported/i);
    });
  });
});
