import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ListObjectsV2Command } from '@aws-sdk/client-s3';

/**
 * @typedef {Object} ReferencesMetastoreOptions
 * @property {string} referencesUri - Root references directory (contains `files` manifests).
 * @property {string[]} [partitionKeys] - Partition keys (in order) for partitioned datasets.
 * @property {any} [s3] - Optional instance of `lambdas/lib/s3.js` for s3:// access.
 */

/**
 * `references/files` metastore.
 *
 * - Each partition has a `files` manifest containing newline-separated parquet URIs.
 * - Unpartitioned tables use a single manifest at `<referencesUri>/files`.
 *
 * This class is intentionally dumb/naive: it treats the manifests as the source of truth and
 * does not integrate with Glue, Hive metastore APIs, etc.
 */
class ReferencesMetastore {
  /**
   * @param {Partial<ReferencesMetastoreOptions>} [options] -
   */
  constructor({ referencesUri, partitionKeys = [], s3 } = {}) {
    if (!referencesUri) throw new Error('referencesUri is required');
    this.referencesUri =
      ReferencesMetastore._ensureTrailingSlash(referencesUri);
    this.partitionKeys = partitionKeys;
    this.s3 = s3;
  }

  /**
   * @param {string} uri -
   * @returns {boolean} -
   */
  static _isS3Uri(uri) {
    return uri.startsWith('s3://');
  }

  /**
   * @param {string} uri -
   * @returns {boolean} -
   */
  static _isFileUri(uri) {
    return uri.startsWith('file://');
  }

  /**
   * @param {string} uri -
   * @returns {string} -
   */
  static _ensureTrailingSlash(uri) {
    return uri.endsWith('/') ? uri : `${uri}/`;
  }

  /**
   * @param {string} s3Uri -
   * @returns {{ bucket: string, key: string }} -
   */
  static _parseS3Uri(s3Uri) {
    const match = s3Uri.match(/^s3:\/\/([^/]+)\/(.*)$/);
    if (!match) throw new Error(`invalid s3 uri: ${s3Uri}`);
    return { bucket: match[1], key: match[2] || '' };
  }

  /**
   * @param {string} uri -
   * @returns {string} -
   */
  static _toLocalPath(uri) {
    if (ReferencesMetastore._isFileUri(uri)) return fileURLToPath(uri);
    return uri;
  }

  /**
   * @param {string} baseUri -
   * @param {string} childPath -
   * @returns {string} -
   */
  static _joinUri(baseUri, childPath) {
    if (ReferencesMetastore._isS3Uri(baseUri)) {
      const { bucket, key } = ReferencesMetastore._parseS3Uri(baseUri);
      const joinedKey = path.posix.join(key, childPath);
      return `s3://${bucket}/${joinedKey}`;
    }
    const basePath = ReferencesMetastore._toLocalPath(baseUri);
    return path.join(basePath, childPath);
  }

  /**
   * Read a manifest.
   * @param {string} manifestUri -
   * @returns {Promise<string[]>} -
   */
  async readFiles(manifestUri) {
    if (ReferencesMetastore._isS3Uri(manifestUri)) {
      if (!this.s3)
        throw new Error('s3 client is required to read s3:// manifests');
      const { bucket, key } = ReferencesMetastore._parseS3Uri(manifestUri);
      const body = await this.s3.getObject({ Bucket: bucket, Key: key });
      return String(body)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    }

    const filePath = ReferencesMetastore._toLocalPath(manifestUri);
    const body = await fs.readFile(filePath, 'utf8');
    return body
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  /**
   * Write a manifest (newline-separated).
   * @param {string} manifestUri -
   * @param {string[]} files -
   */
  async writeFiles(manifestUri, files) {
    const body = `${files.join('\n')}\n`;
    if (ReferencesMetastore._isS3Uri(manifestUri)) {
      if (!this.s3)
        throw new Error('s3 client is required to write s3:// manifests');
      const { bucket, key } = ReferencesMetastore._parseS3Uri(manifestUri);
      await this.s3.putObject({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentLength: body.length,
      });
      return;
    }

    const filePath = ReferencesMetastore._toLocalPath(manifestUri);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body, 'utf8');
  }

  /**
   * Delete a manifest.
   * @param {string} manifestUri -
   */
  async deleteManifest(manifestUri) {
    if (ReferencesMetastore._isS3Uri(manifestUri)) {
      if (!this.s3)
        throw new Error('s3 client is required to delete s3:// manifests');
      const { bucket, key } = ReferencesMetastore._parseS3Uri(manifestUri);
      await this.s3.deleteObject({ Bucket: bucket, Key: key });
      return;
    }

    const filePath = ReferencesMetastore._toLocalPath(manifestUri);
    await fs.rm(filePath, { force: true });
  }

  /**
   * Lists all manifest URIs under the references root.
   * For partitioned datasets, this will include manifests per partition.
   * @returns {Promise<string[]>} -
   */
  async listManifestUris() {
    if (ReferencesMetastore._isS3Uri(this.referencesUri)) {
      if (!this.s3)
        throw new Error('s3 client is required to list s3:// manifests');
      const { bucket, key } = ReferencesMetastore._parseS3Uri(
        this.referencesUri,
      );
      const keys = await this._listAllS3Keys(bucket, key);
      return keys
        .filter((k) => path.posix.basename(k) === 'files')
        .map((k) => `s3://${bucket}/${k}`);
    }

    const root = ReferencesMetastore._toLocalPath(this.referencesUri);
    /** @type {string[]} */
    const manifests = [];

    /** @param {string} dir */
    const walk = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const ent of entries) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          await walk(p);
        } else if (ent.isFile() && ent.name === 'files') {
          manifests.push(p);
        }
      }
    };

    try {
      await walk(root);
    } catch (e) {
      // Non-existent references root -> no manifests.
      return [];
    }

    return manifests;
  }

  /**
   * Lists current partitions discovered from manifest locations.
   * @returns {Promise<Array<{ partitionValues: Record<string, string>, manifestUri: string }>>} -
   */
  async listPartitions() {
    const manifests = await this.listManifestUris();
    return manifests.map((manifestUri) => ({
      partitionValues: this._parsePartitionValuesFromManifest(manifestUri),
      manifestUri,
    }));
  }

  /**
   * Returns the union of all parquet files referenced by all manifests.
   * @returns {Promise<string[]>} -
   */
  async getAllReferencedFiles() {
    const manifests = await this.listManifestUris();
    const lists = await Promise.all(manifests.map((m) => this.readFiles(m)));
    const set = new Set(lists.flat());
    return Array.from(set);
  }

  /**
   * Updates the references manifests to point at a new snapshot.
   *
   * This scans the snapshot directory for parquet files and rewrites the relevant manifests.
   * By default this is *incremental* (write-only): it updates manifests for partitions present
   * in the snapshot and does not delete any others.
   * @param {Object} params -
   * @param {string} params.dataSnapshotUri - Root of the snapshot (ex: .../data/<storage_id>/).
   * @param {boolean} [params.replaceAll] - If true, deletes any stale manifests not present in the snapshot.
   */
  async updateFromDataSnapshot({ dataSnapshotUri, replaceAll = false }) {
    const parquetFiles = await this._listParquetFiles(dataSnapshotUri);

    /** @type {Map<string, string[]>} */
    const manifestToFiles = new Map();

    if (this.partitionKeys.length === 0) {
      const manifestUri = ReferencesMetastore._joinUri(
        this.referencesUri,
        'files',
      );
      manifestToFiles.set(manifestUri, parquetFiles.sort());
    } else {
      /** @type {Map<string, string[]>} */
      const partitionToFiles = new Map();
      for (const fileUri of parquetFiles) {
        const rel = this._relativeTo(dataSnapshotUri, fileUri);
        const segments = rel.split('/').filter(Boolean);

        // Expect: <k1=v1>/<k2=v2>/.../<file>
        const partSegs = segments.slice(0, this.partitionKeys.length);
        if (partSegs.length !== this.partitionKeys.length) continue;

        const partitionPath = partSegs.join('/') + '/';
        const arr = partitionToFiles.get(partitionPath) || [];
        arr.push(fileUri);
        partitionToFiles.set(partitionPath, arr);
      }

      for (const [partitionPath, files] of partitionToFiles.entries()) {
        const manifestUri = ReferencesMetastore._joinUri(
          this.referencesUri,
          path.posix.join(partitionPath, 'files'),
        );
        manifestToFiles.set(manifestUri, files.sort());
      }
    }

    if (replaceAll) {
      const existing = await this.listManifestUris();
      const keep = new Set(manifestToFiles.keys());
      const stale = existing.filter((m) => !keep.has(m));
      await Promise.all(stale.map((m) => this.deleteManifest(m)));
    }

    for (const [manifestUri, files] of manifestToFiles.entries()) {
      await this.writeFiles(manifestUri, files);
    }
  }

  /**
   * Updates a specific partition's manifest.
   * @param {Object} params -
   * @param {Record<string, string>} params.partitionValues -
   * @param {string[]} params.files -
   */
  async updatePartition({ partitionValues, files }) {
    const partitionPath = this.partitionKeys
      .map((k) => `${k}=${partitionValues[k]}`)
      .join('/');
    const manifestUri = ReferencesMetastore._joinUri(
      this.referencesUri,
      path.posix.join(partitionPath, 'files'),
    );
    await this.writeFiles(manifestUri, files);
  }

  /**
   * @param {string} manifestUri -
   * @returns {Record<string, string>} -
   */
  _parsePartitionValuesFromManifest(manifestUri) {
    /** @type {Record<string, string>} */
    const out = {};
    const rel = this._relativeTo(this.referencesUri, manifestUri);
    const segments = rel.split('/').filter(Boolean);

    // root files -> {}
    if (segments.length === 1 && segments[0] === 'files') return out;

    for (const seg of segments) {
      if (seg === 'files') break;
      const [k, ...rest] = seg.split('=');
      if (!k || rest.length === 0) continue;
      if (this.partitionKeys.length > 0 && !this.partitionKeys.includes(k))
        continue;
      out[k] = rest.join('=');
    }
    return out;
  }

  /**
   * @param {string} baseUri -
   * @param {string} fullUri -
   * @returns {string} -
   */
  _relativeTo(baseUri, fullUri) {
    if (ReferencesMetastore._isS3Uri(baseUri)) {
      const { bucket: b1, key: k1 } = ReferencesMetastore._parseS3Uri(
        ReferencesMetastore._ensureTrailingSlash(baseUri),
      );
      const { bucket: b2, key: k2 } = ReferencesMetastore._parseS3Uri(fullUri);
      if (b1 !== b2) throw new Error(`uri is not within base: ${fullUri}`);
      return k2.startsWith(k1) ? k2.slice(k1.length) : k2;
    }

    const basePath = ReferencesMetastore._toLocalPath(
      ReferencesMetastore._ensureTrailingSlash(baseUri),
    );
    const fullPath = ReferencesMetastore._toLocalPath(fullUri);
    return path.relative(basePath, fullPath).split(path.sep).join('/');
  }

  /**
   * List all parquet files under a snapshot directory.
   * @param {string} dataSnapshotUri -
   * @returns {Promise<string[]>} -
   */
  async _listParquetFiles(dataSnapshotUri) {
    if (ReferencesMetastore._isS3Uri(dataSnapshotUri)) {
      if (!this.s3)
        throw new Error('s3 client is required to scan s3:// snapshots');
      const { bucket, key } = ReferencesMetastore._parseS3Uri(
        ReferencesMetastore._ensureTrailingSlash(dataSnapshotUri),
      );
      const keys = await this._listAllS3Keys(bucket, key);
      return keys
        .filter((k) => k.endsWith('.parquet'))
        .map((k) => `s3://${bucket}/${k}`);
    }

    const root = ReferencesMetastore._toLocalPath(
      ReferencesMetastore._ensureTrailingSlash(dataSnapshotUri),
    );
    /** @type {string[]} */
    const files = [];

    /** @param {string} dir */
    const walk = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const ent of entries) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) await walk(p);
        else if (ent.isFile() && ent.name.endsWith('.parquet')) files.push(p);
      }
    };

    await walk(root);
    return files;
  }

  /**
   * @param {string} bucket -
   * @param {string} prefix -
   * @returns {Promise<string[]>} -
   */
  async _listAllS3Keys(bucket, prefix) {
    if (!this.s3) throw new Error('s3 client is required');
    if (!this.s3.s3 || !this.s3.s3.send) {
      throw new Error('invalid s3 client: expected lambdas/lib/s3.js instance');
    }

    /** @type {string[]} */
    const out = [];
    let token;

    // NOTE: We intentionally do not use Delimiter='/' to avoid missing nested paths.
    while (true) {
      /** @type {import('@aws-sdk/client-s3').ListObjectsV2CommandOutput} */
      const resp = await this.s3.s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ...(token ? { ContinuationToken: token } : {}),
        }),
      );

      (resp.Contents || []).forEach((obj) => {
        if (obj.Key) out.push(obj.Key);
      });

      if (!resp.NextContinuationToken) break;
      token = resp.NextContinuationToken;
    }

    return out;
  }
}

export default ReferencesMetastore;
