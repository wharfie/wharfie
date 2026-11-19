/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

/** @type {string[]} */
const temporaryDirectories = [];

/**
 * Open an invalid local volume in a fresh process so a native crash is
 * observed as the child's exit signal instead of taking down the test runner.
 * @param {string} directory @param {boolean} readOnly
 */
function runInvalidVolumeOpenProbe(directory, readOnly) {
  const adapter = new URL(
    '../../src/core/lib/db/adapters/lmdb.js',
    import.meta.url,
  ).href;
  const script = `
    import { mkdtempSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    const {default:createLMDB} = await import(${JSON.stringify(adapter)});
    let message;
    try {
      createLMDB({path: process.argv[1], readOnly: process.argv[2] === 'true'});
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    const healthy = createLMDB({path: mkdtempSync(join(tmpdir(), 'wharfie-lmdb-after-failure-'))});
    await healthy.put({tableName:'probe',keyName:'id',record:{id:'one'}});
    const record = await healthy.get({tableName:'probe',keyName:'id',keyValue:'one'});
    await healthy.close();
    process.stdout.write(JSON.stringify({message, record}));
  `;
  return spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script, directory, String(readOnly)],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 },
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('LMDB failed native open', () => {
  it.each([false, true])(
    'reports an invalid data file as an error and keeps the process usable (readOnly: %s)',
    (readOnly) => {
      const root = mkdtempSync(join(tmpdir(), 'wharfie-lmdb-invalid-volume-'));
      temporaryDirectories.push(root);
      mkdirSync(join(root, 'lmdb'), { mode: 0o700 });
      // Nonempty and regular, so it passes the adapter's own checks and the
      // failure happens inside native open after the lock file is opened.
      writeFileSync(join(root, 'lmdb', 'data.mdb'), Buffer.alloc(16384, 0x41), {
        mode: 0o600,
      });

      const result = runInvalidVolumeOpenProbe(root, readOnly);

      expect({ status: result.status, signal: result.signal }).toEqual({
        status: 0,
        signal: null,
      });
      expect(JSON.parse(result.stdout)).toEqual({
        message: expect.stringMatching(/MDB_INVALID/),
        record: { id: 'one' },
      });
    },
  );
});
