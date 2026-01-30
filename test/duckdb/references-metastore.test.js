import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import ReferencesMetastore from '../../lambdas/lib/metastore/references.js';

describe('ReferencesMetastore', () => {
  /** @type {string} */
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wharfie-metastore-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads/writes the unpartitioned root manifest', async () => {
    const referencesUri = path.join(tmpDir, 'references');
    const ms = new ReferencesMetastore({ referencesUri });

    const manifestPath = path.join(referencesUri, 'files');
    await ms.writeFiles(manifestPath, ['/a.parquet', '/b.parquet']);

    const manifests = await ms.listManifestUris();
    expect(manifests).toEqual([manifestPath]);

    const files = await ms.readFiles(manifestPath);
    expect(files).toEqual(['/a.parquet', '/b.parquet']);

    const all = await ms.getAllReferencedFiles();
    expect(all.sort()).toEqual(['/a.parquet', '/b.parquet']);
  });

  it('discovers partition manifests and parses partition values', async () => {
    const referencesUri = path.join(tmpDir, 'references');
    const ms = new ReferencesMetastore({
      referencesUri,
      partitionKeys: ['dt', 'country'],
    });

    const usManifest = path.join(
      referencesUri,
      'dt=2026-01-01',
      'country=US',
      'files',
    );
    const caManifest = path.join(
      referencesUri,
      'dt=2026-01-01',
      'country=CA',
      'files',
    );

    await ms.writeFiles(usManifest, ['/data/us1.parquet']);
    await ms.writeFiles(caManifest, ['/data/ca1.parquet']);

    const parts = await ms.listPartitions();

    const vals = parts.map((p) => p.partitionValues);
    expect(vals).toEqual(
      expect.arrayContaining([
        { dt: '2026-01-01', country: 'US' },
        { dt: '2026-01-01', country: 'CA' },
      ]),
    );

    const allFiles = await ms.getAllReferencedFiles();
    expect(allFiles.sort()).toEqual(['/data/ca1.parquet', '/data/us1.parquet']);
  });

  it('can rewrite manifests from a data snapshot directory', async () => {
    const referencesUri = path.join(tmpDir, 'references');
    const dataSnapshotUri = path.join(tmpDir, 'data', 'snap1');

    // Fake partitioned parquet output
    await fs.mkdir(path.join(dataSnapshotUri, 'dt=2026-01-01', 'country=US'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(
        dataSnapshotUri,
        'dt=2026-01-01',
        'country=US',
        'part-0.parquet',
      ),
      'not-a-real-parquet-file',
      'utf8',
    );

    const ms = new ReferencesMetastore({
      referencesUri,
      partitionKeys: ['dt', 'country'],
    });

    await ms.updateFromDataSnapshot({ dataSnapshotUri });

    const parts = await ms.listPartitions();
    expect(parts).toHaveLength(1);
    expect(parts[0].partitionValues).toEqual({
      dt: '2026-01-01',
      country: 'US',
    });

    const manifestPath = path.join(
      referencesUri,
      'dt=2026-01-01',
      'country=US',
      'files',
    );
    const files = await ms.readFiles(manifestPath);
    expect(files).toEqual([
      path.join(
        dataSnapshotUri,
        'dt=2026-01-01',
        'country=US',
        'part-0.parquet',
      ),
    ]);
  });

  it('replaceAll deletes stale manifests', async () => {
    const referencesUri = path.join(tmpDir, 'references');

    const ms = new ReferencesMetastore({
      referencesUri,
      partitionKeys: ['dt'],
    });

    // Existing manifests for two partitions
    await ms.writeFiles(path.join(referencesUri, 'dt=2026-01-01', 'files'), [
      '/old/a.parquet',
    ]);
    await ms.writeFiles(path.join(referencesUri, 'dt=2026-01-02', 'files'), [
      '/old/b.parquet',
    ]);

    // New snapshot only contains dt=2026-01-01
    const dataSnapshotUri = path.join(tmpDir, 'data', 'snap_replace');
    await fs.mkdir(path.join(dataSnapshotUri, 'dt=2026-01-01'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(dataSnapshotUri, 'dt=2026-01-01', 'new.parquet'),
      'not-a-real-parquet-file',
      'utf8',
    );

    await ms.updateFromDataSnapshot({ dataSnapshotUri, replaceAll: true });

    const manifests = await ms.listManifestUris();
    expect(manifests).toEqual([
      path.join(referencesUri, 'dt=2026-01-01', 'files'),
    ]);

    const files = await ms.getAllReferencedFiles();
    expect(files).toEqual([
      path.join(dataSnapshotUri, 'dt=2026-01-01', 'new.parquet'),
    ]);
  });
});
