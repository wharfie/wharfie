/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
  it('does not create a missing durable control volume', () => {
    const controlPath = mkdtempSync(join(tmpdir(), 'wharfie-lmdb-read-only-'));
    temporaryDirectories.push(controlPath);
    const dbRoot = join(controlPath, 'lmdb');

    expect(() => createLMDB({ path: controlPath, readOnly: true })).toThrow(
      /read-only control volume does not exist/i,
    );
    expect(existsSync(dbRoot)).toBe(false);
  });
});
