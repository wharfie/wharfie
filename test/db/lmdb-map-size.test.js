/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

// Every native open goes through getLmdbModule(). Wrap the real module so the
// test sees each open's options and can shrink the map to force growth.
const realLmdb = createRequire(import.meta.url)('lmdb');
/** @type {Array<Record<string, any>>} */
const opens = [];
/** @type {number | undefined} */
let mapSizeOverride;
const wrappedLmdb = {
  ...realLmdb,
  open(/** @type {Record<string, any>} */ options) {
    opens.push({ ...options });
    return realLmdb.open(
      mapSizeOverride === undefined
        ? options
        : { ...options, mapSize: mapSizeOverride },
    );
  },
};
jest.unstable_mockModule('../../src/core/lib/lmdb-module.js', () => ({
  getLmdbModule: () => wrappedLmdb,
  default: () => wrappedLmdb,
}));

const { default: createLMDB, LMDB_MAP_SIZE_BYTES } =
  await import('../../src/core/lib/db/adapters/lmdb.js');

const TABLE = 'map-size';
const PAD = 'x'.repeat(2000);
/** @type {string[]} */
const temporaryDirectories = [];

afterEach(() => {
  mapSizeOverride = undefined;
  opens.length = 0;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function temporaryStore() {
  const directory = mkdtempSync(join(tmpdir(), 'wharfie-lmdb-map-size-'));
  temporaryDirectories.push(directory);
  return directory;
}

/** @param {any} db @param {number} from @param {number} to */
async function putRange(db, from, to) {
  for (let i = from; i < to; i++) {
    await db.put({
      tableName: TABLE,
      keyName: 'id',
      record: { id: `k${String(i).padStart(5, '0')}`, i, pad: PAD },
    });
  }
}

/** @param {any} db @param {number} i */
async function read(db, i) {
  return (
    await db.get({
      tableName: TABLE,
      keyName: 'id',
      keyValue: `k${String(i).padStart(5, '0')}`,
    })
  )?.i;
}

describe('LMDB map size', () => {
  it('opens every native environment with one fixed 1 GiB map', async () => {
    expect(LMDB_MAP_SIZE_BYTES).toBe(1024 * 1024 * 1024);
    const path = temporaryStore();
    const writer = createLMDB({ path, holderLock: true });
    await putRange(writer, 0, 1);
    await writer.close();
    const reader = createLMDB({ path, readOnly: true, holderLock: true });
    expect(await read(reader, 0)).toBe(0);
    await reader.close();

    expect(
      opens.map(({ readOnly, mapSize }) => ({ readOnly, mapSize })),
    ).toEqual([
      { readOnly: false, mapSize: LMDB_MAP_SIZE_BYTES },
      { readOnly: true, mapSize: LMDB_MAP_SIZE_BYTES },
    ]);
    // Address space only: the data file is not extended to the map size.
    expect(statSync(join(path, 'lmdb', 'data.mdb')).size).toBeLessThan(
      LMDB_MAP_SIZE_BYTES / 64,
    );
  });

  it('grows past the map, and reopens a data file larger than the map', async () => {
    const tinyMap = 64 * 1024;
    mapSizeOverride = tinyMap;
    const path = temporaryStore();

    const writer = createLMDB({ path, holderLock: true });
    await putRange(writer, 0, 1500);
    expect(await read(writer, 0)).toBe(0);
    expect(await read(writer, 1499)).toBe(1499);
    await writer.close();
    const grown = statSync(join(path, 'lmdb', 'data.mdb')).size;
    expect(grown).toBeGreaterThan(tinyMap * 16);

    const reopened = createLMDB({ path, holderLock: true });
    expect(await read(reopened, 0)).toBe(0);
    await putRange(reopened, 1500, 2000);
    expect(await read(reopened, 1999)).toBe(1999);
    await reopened.close();

    const reader = createLMDB({ path, readOnly: true, holderLock: true });
    expect(await read(reader, 0)).toBe(0);
    expect(await read(reader, 1999)).toBe(1999);
    await reader.close();
    expect(opens.every(({ mapSize }) => mapSize === LMDB_MAP_SIZE_BYTES)).toBe(
      true,
    );
  });
});
