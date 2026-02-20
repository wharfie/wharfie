import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import DuckDBQueryEngine from '../../lambdas/lib/duckdb/index.js';
import ReferencesMetastore from '../../lambdas/lib/metastore/references.js';

describe('DuckDBQueryEngine + ReferencesMetastore integration', () => {
  /** @type {string} */
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wharfie-duckdb-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes partitioned parquet snapshots and queries via references manifests', async () => {
    const engine = new DuckDBQueryEngine({ databasePath: ':memory:' });

    const dataSnap1 = path.join(tmpDir, 'data', 'snap1');
    const referencesUri = path.join(tmpDir, 'references');

    await engine.run('CREATE TABLE src(id INTEGER, dt DATE, val INTEGER);');
    await engine.run(
      "INSERT INTO src VALUES (1, DATE '2026-01-01', 10), (2, DATE '2026-01-01', 20), (3, DATE '2026-01-02', 30);",
    );

    // Export as partitioned parquet
    await engine.copyToParquet({
      selectSql: 'SELECT * FROM src',
      outputUri: dataSnap1,
      partitionBy: ['dt'],
    });

    // Build references/**/files
    const metastore = new ReferencesMetastore({
      referencesUri,
      partitionKeys: ['dt'],
    });
    await metastore.updateFromDataSnapshot({ dataSnapshotUri: dataSnap1 });

    // Register a view from references and query it
    await engine.registerTableFromReferences({
      schema: 'db',
      table: 'tbl',
      referencesUri,
      partitionKeys: ['dt'],
    });

    const rows1 = await engine.all(
      'SELECT CAST(dt AS VARCHAR) AS dt, SUM(val) AS total FROM db.tbl GROUP BY 1 ORDER BY 1;',
    );

    expect(rows1).toEqual([
      { dt: '2026-01-01', total: 30 },
      { dt: '2026-01-02', total: 30 },
    ]);

    // New snapshot only for dt=2026-01-01 (partition replacement)
    const dataSnap2 = path.join(tmpDir, 'data', 'snap2');
    await engine.run('CREATE TABLE src_new(id INTEGER, dt DATE, val INTEGER);');
    await engine.run(
      "INSERT INTO src_new VALUES (10, DATE '2026-01-01', 999);",
    );

    await engine.copyToParquet({
      selectSql: "SELECT * FROM src_new WHERE dt = DATE '2026-01-01'",
      outputUri: dataSnap2,
      partitionBy: ['dt'],
    });

    // Update manifests for the partition present in snap2.
    await metastore.updateFromDataSnapshot({ dataSnapshotUri: dataSnap2 });

    // Re-register to refresh view file list.
    await engine.registerTableFromReferences({
      schema: 'db',
      table: 'tbl',
      referencesUri,
      partitionKeys: ['dt'],
    });

    const rows2 = await engine.all(
      'SELECT CAST(dt AS VARCHAR) AS dt, SUM(val) AS total FROM db.tbl GROUP BY 1 ORDER BY 1;',
    );

    expect(rows2).toEqual([
      { dt: '2026-01-01', total: 999 },
      { dt: '2026-01-02', total: 30 },
    ]);

    await engine.close();
  });
});
