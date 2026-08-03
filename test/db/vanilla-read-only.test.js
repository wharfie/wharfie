/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB, {
  VANILLA_DATABASE_INTEGRITY_ERROR_CODE,
  VanillaDatabaseIntegrityError,
} from '../../src/core/lib/db/adapters/vanilla.js';

/** @type {string[]} */
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} bytes - Exact snapshot bytes.
 * @param {string} mode - Fixture label.
 * @returns {{root: string, snapshotPath: string}} - Written fixture.
 */
function writeSnapshot(bytes, mode) {
  const root = mkdtempSync(join(tmpdir(), `wharfie-vanilla-${mode}-`));
  temporaryDirectories.push(root);
  const snapshotPath = join(root, 'database.json');
  writeFileSync(snapshotPath, bytes, 'utf8');
  return { root, snapshotPath };
}

/**
 * @param {string} bytes - Invalid exact snapshot bytes.
 * @returns {void}
 */
function expectInvalidSnapshotPreserved(bytes) {
  for (const readOnly of [false, true]) {
    const mode = readOnly ? 'read-only' : 'writable';
    const { root, snapshotPath } = writeSnapshot(bytes, mode);
    const before = readFileSync(snapshotPath, 'utf8');

    /** @type {unknown} */
    let error;
    try {
      createVanillaDB({ path: root, readOnly });
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(VanillaDatabaseIntegrityError);
    expect(error).toMatchObject({
      name: 'VanillaDatabaseIntegrityError',
      code: VANILLA_DATABASE_INTEGRITY_ERROR_CODE,
      message: expect.stringMatching(
        /could not load existing snapshot.*malformed JSON or invalid persisted layout/i,
      ),
    });
    expect(readFileSync(snapshotPath, 'utf8')).toBe(before);
  }
}

describe('vanilla read-only observer mode', () => {
  it('does not create a missing snapshot', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'wharfie-vanilla-read-only-'));
    temporaryDirectories.push(parent);
    const root = join(parent, 'missing');
    const db = createVanillaDB({ path: root, readOnly: true });

    await expect(
      db.get({ tableName: 'runs', keyName: 'id', keyValue: 'missing' }),
    ).resolves.toBeUndefined();
    await db.close();
    expect(existsSync(root)).toBe(false);
  });

  it('reads an existing snapshot but rejects and never persists mutation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wharfie-vanilla-read-only-'));
    temporaryDirectories.push(root);
    const writer = createVanillaDB({ path: root });
    await writer.put({
      tableName: 'runs',
      keyName: 'id',
      record: { id: 'run-a', status: 'ready' },
    });
    await writer.close();
    const snapshotPath = join(root, 'database.json');
    const before = readFileSync(snapshotPath, 'utf8');

    const reader = createVanillaDB({ path: root, readOnly: true });
    await expect(
      reader.get({ tableName: 'runs', keyName: 'id', keyValue: 'run-a' }),
    ).resolves.toEqual({ id: 'run-a', status: 'ready' });
    await expect(
      reader.put({
        tableName: 'runs',
        keyName: 'id',
        record: { id: 'run-b' },
      }),
    ).rejects.toThrow(/read-only/i);
    await reader.close();
    expect(readFileSync(snapshotPath, 'utf8')).toBe(before);
  });

  it.each([
    ['malformed JSON', '{not-json\n'],
    ['a null root', 'null'],
    ['an array root', '[]'],
    ['a primitive root', '"database"'],
    ['a null table map', '{"runs":null}'],
    ['an array table map', '{"runs":[]}'],
    ['a primitive table map', '{"runs":3}'],
    ['a null primary-key bucket', '{"runs":{"id=run-a":null}}'],
    ['an array primary-key bucket', '{"runs":{"id=run-a":[]}}'],
    ['a primitive primary-key bucket', '{"runs":{"id=run-a":false}}'],
    ['a null sort-key record', '{"runs":{"id=run-a":{"__no_sort__":null}}}'],
    ['an array sort-key record', '{"runs":{"id=run-a":{"__no_sort__":[]}}}'],
    [
      'a primitive sort-key record',
      '{"runs":{"id=run-a":{"__no_sort__":"record"}}}',
    ],
  ])(
    'fails closed on %s in writable and read-only modes without changing bytes',
    (_label, bytes) => {
      expect.hasAssertions();
      expectInvalidSnapshotPreserved(bytes);
    },
  );

  it('allows arbitrary nested JSON values inside a record', async () => {
    const record = {
      id: 'run-a',
      nested: {
        values: [null, false, 0, 'value', { deeper: [1, 2, 3] }],
      },
    };
    const bytes = JSON.stringify({
      runs: {
        'id=run-a': {
          __no_sort__: record,
        },
      },
    });

    for (const readOnly of [false, true]) {
      const mode = readOnly ? 'read-only-valid' : 'writable-valid';
      const { root } = writeSnapshot(bytes, mode);
      const db = createVanillaDB({ path: root, readOnly });
      await expect(
        db.get({ tableName: 'runs', keyName: 'id', keyValue: 'run-a' }),
      ).resolves.toEqual(record);
      await db.close();
    }
  });
});
