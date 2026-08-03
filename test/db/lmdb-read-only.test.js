/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import createLMDB from '../../src/core/lib/db/adapters/lmdb.js';

/** @type {string[]} */
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('LMDB read-only observer mode', () => {
  it('creates every missing writable path privately under a group-writable umask', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wharfie-lmdb-private-'));
    temporaryDirectories.push(root);
    const controlPath = join(root, 'nested', 'control');
    const previousUmask = process.umask(0o002);
    let writer;
    try {
      writer = createLMDB({ path: controlPath });
    } finally {
      process.umask(previousUmask);
    }

    try {
      for (const directory of [
        join(root, 'nested'),
        controlPath,
        join(controlPath, 'lmdb'),
      ]) {
        expect(statSync(directory).mode & 0o777).toBe(0o700);
      }
      for (const file of ['data.mdb', 'lock.mdb']) {
        expect(statSync(join(controlPath, 'lmdb', file)).mode & 0o777).toBe(
          0o600,
        );
      }
    } finally {
      await writer?.close();
    }
  });

  it('does not create a missing durable local volume', () => {
    const controlPath = mkdtempSync(join(tmpdir(), 'wharfie-lmdb-read-only-'));
    temporaryDirectories.push(controlPath);
    const dbRoot = join(controlPath, 'lmdb');

    expect(() => createLMDB({ path: controlPath, readOnly: true })).toThrow(
      /read-only local volume does not exist/i,
    );
    expect(existsSync(dbRoot)).toBe(false);
  });

  it('shares a live writer safely with a read-only facade and releases each in either order', async () => {
    const controlPath = mkdtempSync(join(tmpdir(), 'wharfie-lmdb-read-only-'));
    temporaryDirectories.push(controlPath);
    const writer = createLMDB({ path: controlPath });
    /** @type {import('../../src/core/lib/db/base.js').DBClient | undefined} */
    let reader;
    try {
      await writer.put({
        tableName: 'runs',
        keyName: 'id',
        record: { id: 'run-a', status: 'ready' },
      });
      reader = createLMDB({ path: controlPath, readOnly: true });
      await expect(
        reader.get({ tableName: 'runs', keyName: 'id', keyValue: 'run-a' }),
      ).resolves.toEqual({ id: 'run-a', status: 'ready' });

      const mutations = [
        reader.put({
          tableName: 'runs',
          keyName: 'id',
          record: { id: 'run-b', status: 'new' },
        }),
        reader.update({
          tableName: 'runs',
          keyName: 'id',
          keyValue: 'run-a',
          updates: [{ property: ['status'], propertyValue: 'updated' }],
        }),
        reader.remove({ tableName: 'runs', keyName: 'id', keyValue: 'run-a' }),
        reader.batchWrite({
          tableName: 'runs',
          putRequests: [
            {
              keyName: 'id',
              record: { id: 'run-c', status: 'new' },
            },
          ],
        }),
        reader.transactionWrite({
          tableName: 'runs',
          putRequests: [
            {
              keyName: 'id',
              record: { id: 'run-d', status: 'new' },
            },
          ],
        }),
      ];
      await Promise.all(
        mutations.map((mutation) =>
          expect(mutation).rejects.toThrow('LMDB client is read-only.'),
        ),
      );

      await reader.close();
      await expect(
        writer.get({ tableName: 'runs', keyName: 'id', keyValue: 'run-a' }),
      ).resolves.toEqual({ id: 'run-a', status: 'ready' });
      await writer.close();

      const reopened = createLMDB({ path: controlPath });
      try {
        await expect(
          reopened.get({
            tableName: 'runs',
            keyName: 'id',
            keyValue: 'run-a',
          }),
        ).resolves.toEqual({ id: 'run-a', status: 'ready' });
      } finally {
        await reopened.close();
      }
    } finally {
      await reader?.close();
      await writer.close();
    }
  });

  it('keeps a reader usable after its writer facade releases first', async () => {
    const controlPath = mkdtempSync(join(tmpdir(), 'wharfie-lmdb-read-only-'));
    temporaryDirectories.push(controlPath);
    const writer = createLMDB({ path: controlPath });
    /** @type {import('../../src/core/lib/db/base.js').DBClient | undefined} */
    let reader;
    try {
      await writer.put({
        tableName: 'runs',
        keyName: 'id',
        record: { id: 'run-a', status: 'ready' },
      });
      reader = createLMDB({ path: controlPath, readOnly: true });
      await writer.close();
      await expect(
        reader.get({ tableName: 'runs', keyName: 'id', keyValue: 'run-a' }),
      ).resolves.toEqual({ id: 'run-a', status: 'ready' });
    } finally {
      await reader?.close();
      await writer.close();
    }
  });
});
