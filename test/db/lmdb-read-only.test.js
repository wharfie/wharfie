/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import createLMDB from '../../src/core/lib/db/adapters/lmdb.js';

/** @type {string[]} */
const temporaryDirectories = [];
const supportsDefaultAclProbe =
  process.platform === 'linux' &&
  spawnSync('setfacl', ['--version'], {
    timeout: 5000,
    maxBuffer: 4096,
  }).status === 0;

/** @param {string} directory @param {boolean} readOnly */
function runFreshNativeModeProbe(directory, readOnly) {
  const adapter = new URL(
    '../../src/core/lib/db/adapters/lmdb.js',
    import.meta.url,
  ).href;
  const script = `
    import assert from 'node:assert/strict';
    import {existsSync,statSync} from 'node:fs';
    import {join} from 'node:path';
    process.umask(0o002);
    const {default:createLMDB} = await import(${JSON.stringify(adapter)});
    const path = process.argv[1];
    const readOnly = process.argv[2] === 'true';
    const db = createLMDB({path, readOnly});
    assert.equal(process.umask(), 0o002);
    try {
      if (!readOnly) await db.put({tableName:'probe',keyName:'id',record:{id:'one',value:true}});
      assert.deepEqual(await db.get({tableName:'probe',keyName:'id',keyValue:'one'}), {id:'one',value:true});
    } finally { await db.close(); }
    process.stdout.write(JSON.stringify(['data.mdb','lock.mdb'].map(name=>existsSync(join(path,'lmdb',name)) ? statSync(join(path,'lmdb',name)).mode & 0o777 : null)));
  `;
  return JSON.parse(
    execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script, directory, String(readOnly)],
      {
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 64 * 1024,
      },
    ),
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('LMDB read-only observer mode', () => {
  it('keeps first-load writers and read-only missing-lock reopen private in fresh processes', () => {
    const root = mkdtempSync(join(tmpdir(), 'wharfie-lmdb-first-load-'));
    temporaryDirectories.push(root);
    expect(runFreshNativeModeProbe(root, false)).toEqual([0o600, 0o600]);
    const data = readFileSync(join(root, 'lmdb', 'data.mdb'));
    unlinkSync(join(root, 'lmdb', 'lock.mdb'));
    expect(runFreshNativeModeProbe(root, true)).toEqual([0o600, 0o600]);
    expect(readFileSync(join(root, 'lmdb', 'data.mdb'))).toEqual(data);
  });

  (supportsDefaultAclProbe ? it : it.skip)(
    'bounds inherited Linux default ACLs with explicit native file modes',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'wharfie-lmdb-default-acl-'));
      temporaryDirectories.push(root);
      execFileSync('setfacl', ['-m', 'd:u::rwx,d:g::rwx,d:o::rwx', root], {
        timeout: 5000,
        maxBuffer: 4096,
      });
      const reference = join(root, 'native-default-mode');
      const previousUmask = process.umask(0o077);
      try {
        writeFileSync(reference, 'default ACL reference', {
          mode: 0o664,
          flag: 'wx',
        });
      } finally {
        process.umask(previousUmask);
      }
      // Prove this fixture defeats an umask-only native open before testing the fix.
      expect(statSync(reference).mode & 0o777).toBe(0o664);
      const control = join(root, 'control');
      expect(runFreshNativeModeProbe(control, false)).toEqual([0o600, 0o600]);
      unlinkSync(join(control, 'lmdb', 'lock.mdb'));
      expect(runFreshNativeModeProbe(control, true)).toEqual([0o600, 0o600]);
    },
  );

  it('does not create a data volume or lock file in an existing empty read-only root', () => {
    const root = mkdtempSync(join(tmpdir(), 'wharfie-lmdb-empty-read-only-'));
    temporaryDirectories.push(root);
    mkdirSync(join(root, 'lmdb'), { mode: 0o700 });
    expect(() => createLMDB({ path: root, readOnly: true })).toThrow(
      /existing data file/i,
    );
    expect(existsSync(join(root, 'lmdb', 'data.mdb'))).toBe(false);
    expect(existsSync(join(root, 'lmdb', 'lock.mdb'))).toBe(false);
  });

  it('does not turn an empty data file into a volume or create its lock during read-only open', () => {
    const root = mkdtempSync(join(tmpdir(), 'wharfie-lmdb-empty-data-'));
    temporaryDirectories.push(root);
    mkdirSync(join(root, 'lmdb'), { mode: 0o700 });
    const data = join(root, 'lmdb', 'data.mdb');
    writeFileSync(data, '', { mode: 0o600 });
    expect(() => createLMDB({ path: root, readOnly: true })).toThrow(
      /nonempty regular data file/i,
    );
    expect(statSync(data).size).toBe(0);
    expect(existsSync(join(root, 'lmdb', 'lock.mdb'))).toBe(false);
  });

  it('preserves existing native file modes and data when opening a read-only observer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wharfie-lmdb-existing-modes-'));
    temporaryDirectories.push(root);
    runFreshNativeModeProbe(root, false);
    const dataPath = join(root, 'lmdb', 'data.mdb');
    const lockPath = join(root, 'lmdb', 'lock.mdb');
    chmodSync(dataPath, 0o640);
    chmodSync(lockPath, 0o640);
    const data = readFileSync(dataPath);
    const inodes = [statSync(dataPath).ino, statSync(lockPath).ino];
    expect(runFreshNativeModeProbe(root, true)).toEqual([0o640, 0o640]);
    expect([statSync(dataPath).ino, statSync(lockPath).ino]).toEqual(inodes);
    expect(readFileSync(dataPath)).toEqual(data);
  });

  (process.platform !== 'win32' && process.getuid?.() !== 0 ? it : it.skip)(
    'preserves native read-only inspection when a non-writable volume cannot create a lock file',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'wharfie-lmdb-no-write-reader-'));
      temporaryDirectories.push(root);
      expect(runFreshNativeModeProbe(root, false)).toEqual([0o600, 0o600]);
      const volume = join(root, 'lmdb');
      const dataPath = join(volume, 'data.mdb');
      const data = readFileSync(dataPath);
      const inode = statSync(dataPath).ino;
      unlinkSync(join(volume, 'lock.mdb'));
      chmodSync(volume, 0o500);
      try {
        expect(runFreshNativeModeProbe(root, true)).toEqual([0o600, null]);
        expect(existsSync(join(volume, 'lock.mdb'))).toBe(false);
        expect(readFileSync(dataPath)).toEqual(data);
        expect(statSync(dataPath).ino).toBe(inode);
      } finally {
        chmodSync(volume, 0o700);
      }
    },
  );

  it.each(['data.mdb', 'lock.mdb'])(
    'refuses an existing writable %s symlink without changing its target',
    (name) => {
      const root = mkdtempSync(join(tmpdir(), 'wharfie-lmdb-symlink-'));
      temporaryDirectories.push(root);
      const control = join(root, 'control');
      mkdirSync(join(control, 'lmdb'), { recursive: true, mode: 0o700 });
      const foreign = join(root, 'foreign');
      writeFileSync(foreign, 'unchanged', { mode: 0o640 });
      const link = join(control, 'lmdb', name);
      symlinkSync(foreign, link);
      const originalUmask = process.umask();
      expect(() => createLMDB({ path: control })).toThrow(
        /non-symbolic-link regular files/i,
      );
      expect(process.umask()).toBe(originalUmask);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readFileSync(foreign, 'utf8')).toBe('unchanged');
      expect(statSync(foreign).mode & 0o777).toBe(0o640);
    },
  );

  it('refuses a read-only lock symlink without rewriting another file', () => {
    const root = mkdtempSync(join(tmpdir(), 'wharfie-lmdb-reader-symlink-'));
    temporaryDirectories.push(root);
    runFreshNativeModeProbe(root, false);
    const foreign = join(root, 'foreign');
    writeFileSync(foreign, 'unchanged', { mode: 0o640 });
    const lock = join(root, 'lmdb', 'lock.mdb');
    unlinkSync(lock);
    symlinkSync(foreign, lock);
    expect(() => createLMDB({ path: root, readOnly: true })).toThrow(
      /non-symbolic-link regular files/i,
    );
    expect(lstatSync(lock).isSymbolicLink()).toBe(true);
    expect(readFileSync(foreign, 'utf8')).toBe('unchanged');
    expect(statSync(foreign).mode & 0o777).toBe(0o640);
  });

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
