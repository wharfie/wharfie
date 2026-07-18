/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';

/** @type {string[]} */
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

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

  it('surfaces a malformed existing snapshot instead of treating it as empty', () => {
    const root = mkdtempSync(join(tmpdir(), 'wharfie-vanilla-read-only-'));
    temporaryDirectories.push(root);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'database.json'), '{not-json', 'utf8');

    expect(() => createVanillaDB({ path: root, readOnly: true })).toThrow(
      /could not load/i,
    );
  });
});
