import { promises as fsp, existsSync } from 'node:fs';
import { join, dirname, basename, resolve, sep, relative } from 'node:path';
import { Readable } from 'node:stream';

import paths from '../../paths.js';
import { createId } from '../../id.js';

/**
 * @typedef VanillaBucketMeta
 * @property {string} [region]
 * @property {Array<{ Key: string, Value: string }>} [tags]
 * @property {any} [notificationConfiguration]
 * @property {any} [lifecycleConfiguration]
 * @property {string} [createdAt]
 */

/**
 * @typedef CreateVanillaObjectStorageOptions
 * @property {string} [path] - Base directory for persisted state. Defaults to `paths.data`. [object_storage_path]
 * @property {string} [region] - Default region returned from getBucketLocation/findBucketRegion when not specified.
 */

/**
 * Vanilla local object storage adapter.
 *
 * Goals:
 * - Provide an S3-shaped API surface (compatible with `lambdas/lib/s3.js` callsites)
 * - Persist objects + bucket metadata to disk (so local runs survive process restarts)
 *
 * Storage layout:
 *   <root>/buckets/<bucket>/objects/<key...>
 *   <root>/buckets/<bucket>/bucket.json
 *
 * Notes:
 * - This adapter intentionally does NOT try to emulate all S3 edge cases.
 * - It does implement the subset used in this repository with straightforward behavior.
 *
 * @param {CreateVanillaObjectStorageOptions} [options] -
 * @returns {import('../base.js').ObjectStorageClient & { close?: () => Promise<void> }} -
 */
export default function createVanillaObjectStorage(options = {}) {
  const rootDir = options.path
    ? join(options.path, 'object-storage')
    : join(paths.data, 'object-storage');

  const bucketsDir = join(rootDir, 'buckets');

  /** @type {Map<string, VanillaBucketMeta>} */
  const metaCache = new Map();

  /** @type {Map<string, { Bucket: string, Key: string, Parts: Array<any> }>} */
  const multipartUploads = new Map();

  /**
   * @returns {Promise<void>} -
   */
  async function ensureRoot() {
    await fsp.mkdir(bucketsDir, { recursive: true });
  }

  /**
   * @param {string} Bucket -
   * @returns {string} -
   */
  function bucketDir(Bucket) {
    return join(bucketsDir, Bucket);
  }

  /**
   * @param {string} Bucket -
   * @returns {string} -
   */
  function bucketObjectsDir(Bucket) {
    return join(bucketDir(Bucket), 'objects');
  }

  /**
   * @param {string} Bucket -
   * @returns {string} -
   */
  function bucketMetaPath(Bucket) {
    return join(bucketDir(Bucket), 'bucket.json');
  }

  /**
   * @param {string} Key -
   * @returns {string} -
   */
  function normalizeKey(Key) {
    if (typeof Key !== 'string') throw new TypeError('Key must be a string');
    return Key.startsWith('/') ? Key.slice(1) : Key;
  }

  /**
   * Prevent path traversal via keys like "../../etc/passwd".
   * @param {string} base -
   * @param {string} candidate -
   * @returns {string} -
   */
  function assertWithin(base, candidate) {
    const b = resolve(base);
    const c = resolve(candidate);
    if (c === b) return c;
    if (!c.startsWith(b + sep)) {
      throw new Error(`Refusing to access path outside base dir: ${candidate}`);
    }
    return c;
  }

  /**
   * @param {string} Bucket -
   * @param {string} Key -
   * @returns {string} -
   */
  function objectFilePath(Bucket, Key) {
    const safeKey = normalizeKey(Key);
    const objectsBase = bucketObjectsDir(Bucket);
    const candidate = resolve(objectsBase, safeKey);
    return assertWithin(objectsBase, candidate);
  }

  /**
   * @param {string} path -
   * @param {Uint8Array|string} data -
   * @returns {Promise<void>} -
   */
  async function writeFileAtomic(path, data) {
    await fsp.mkdir(dirname(path), { recursive: true });

    const tmp = join(
      dirname(path),
      `.tmp-${basename(path)}-${process.pid}-${Date.now()}-${createId()}`,
    );

    const handle = await fsp.open(tmp, 'w', 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }

    await fsp.rename(tmp, path);

    // Best-effort directory fsync to improve durability
    try {
      const dh = await fsp.open(dirname(path), 'r');
      try {
        await dh.sync();
      } finally {
        await dh.close();
      }
    } catch {
      // ignore
    }
  }

  /**
   * @param {any} Body -
   * @returns {Promise<Buffer>} -
   */
  async function bodyToBuffer(Body) {
    if (Body == null) return Buffer.from('');
    if (Buffer.isBuffer(Body)) return Body;
    if (Body instanceof Uint8Array) return Buffer.from(Body);
    if (typeof Body === 'string') return Buffer.from(Body, 'utf8');

    if (Body instanceof Readable || typeof Body?.on === 'function') {
      const chunks = [];
      for await (const chunk of Body) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    }

    // Fallback: string coerce (useful for tests)
    return Buffer.from(String(Body), 'utf8');
  }

  /**
   * @param {string} Bucket -
   * @returns {Promise<boolean>} -
   */
  async function bucketExists(Bucket) {
    await ensureRoot();
    try {
      const st = await fsp.stat(bucketDir(Bucket));
      return st.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * @param {string} Bucket -
   * @returns {Promise<VanillaBucketMeta>} -
   */
  async function readBucketMeta(Bucket) {
    if (metaCache.has(Bucket)) return metaCache.get(Bucket);

    const metaFile = bucketMetaPath(Bucket);
    /** @type {VanillaBucketMeta} */
    let meta = {};
    if (existsSync(metaFile)) {
      try {
        meta = JSON.parse(await fsp.readFile(metaFile, 'utf8')) || {};
      } catch {
        meta = {};
      }
    }

    // Defaults
    if (!meta.region) meta.region = options.region || 'us-east-1';
    if (!Array.isArray(meta.tags)) meta.tags = [];
    if (!meta.createdAt) meta.createdAt = new Date().toISOString();

    metaCache.set(Bucket, meta);
    return meta;
  }

  /**
   * @param {string} Bucket -
   * @param {VanillaBucketMeta} meta -
   * @returns {Promise<void>} -
   */
  async function writeBucketMeta(Bucket, meta) {
    metaCache.set(Bucket, meta);
    await writeFileAtomic(bucketMetaPath(Bucket), JSON.stringify(meta));
  }

  /**
   * @param {string} Bucket -
   * @returns {Promise<void>} -
   */
  async function assertBucketExists(Bucket) {
    if (!(await bucketExists(Bucket))) {
      const err = new Error(`NoSuchBucket: ${Bucket}`);
      err.name = 'NoSuchBucket';
      throw err;
    }
  }

  /**
   * Recursively list all object keys under a bucket.
   *
   * @param {string} Bucket -
   * @returns {Promise<string[]>} -
   */
  async function listAllKeys(Bucket) {
    await assertBucketExists(Bucket);
    const base = bucketObjectsDir(Bucket);

    /** @type {string[]} */
    const keys = [];

    /**
     * @param {string} dir -
     * @returns {Promise<void>} -
     */
    async function walk(dir) {
      let entries = [];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const ent of entries) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) {
          await walk(p);
        } else if (ent.isFile()) {
          const rel = relative(base, p);
          const key = rel.split(sep).join('/');
          keys.push(key);
        }
      }
    }

    await walk(base);

    keys.sort((a, b) => a.localeCompare(b));
    return keys;
  }

  /**
   * Internal ListObjectsV2-like helper.
   *
   * @param {import("@aws-sdk/client-s3").ListObjectsV2CommandInput} params -
   * @returns {Promise<any>} -
   */
  async function listObjectsV2Internal(params) {
    await assertBucketExists(params.Bucket);

    const Prefix = params.Prefix || '';
    const Delimiter = params.Delimiter;

    const keys = await listAllKeys(params.Bucket);
    const matching = keys.filter((k) => k.startsWith(Prefix));

    if (Delimiter) {
      const base = Prefix
        ? Prefix.endsWith(Delimiter)
          ? Prefix
          : `${Prefix}${Delimiter}`
        : '';
      const prefixes = new Set();

      for (const k of matching) {
        let rem = k.slice(Prefix.length);
        if (rem.startsWith(Delimiter)) rem = rem.slice(Delimiter.length);

        const idx = rem.indexOf(Delimiter);
        if (idx < 0) continue;

        const seg = rem.slice(0, idx + Delimiter.length);
        prefixes.add(`${base}${seg}`);
      }

      return {
        CommonPrefixes: Array.from(prefixes)
          .sort((a, b) => a.localeCompare(b))
          .map((p) => ({ Prefix: p })),
      };
    }

    const contents = [];
    for (const k of matching) {
      const p = objectFilePath(params.Bucket, k);
      const st = await fsp.stat(p);
      contents.push({
        Key: k,
        LastModified: st.mtime,
        Size: st.size,
      });
    }

    contents.sort((a, b) => a.Key.localeCompare(b.Key));

    return {
      Bucket: params.Bucket,
      Contents: contents,
    };
  }

  /**
   * @param {import("@aws-sdk/client-s3").CreateBucketCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").CreateBucketCommandOutput>} -
   */
  async function createBucket(params) {
    await ensureRoot();
    if (!params?.Bucket) throw new Error('Bucket is required');

    if (await bucketExists(params.Bucket)) {
      const err = new Error(`BucketAlreadyExists: ${params.Bucket}`);
      err.name = 'BucketAlreadyExists';
      throw err;
    }

    await fsp.mkdir(bucketObjectsDir(params.Bucket), { recursive: true });

    const region =
      params?.CreateBucketConfiguration?.LocationConstraint ||
      options.region ||
      'us-east-1';

    await writeBucketMeta(params.Bucket, {
      region,
      tags: [],
      notificationConfiguration: undefined,
      lifecycleConfiguration: undefined,
      createdAt: new Date().toISOString(),
    });

    return /** @type {any} */ ({});
  }

  /**
   * @param {import("@aws-sdk/client-s3").DeleteBucketCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").DeleteBucketCommandOutput>} -
   */
  async function deleteBucket(params) {
    await assertBucketExists(params.Bucket);

    const keys = await listAllKeys(params.Bucket);
    if (keys.length > 0) {
      const err = new Error(
        `BucketNotEmpty: ${params.Bucket} (${keys.length} objects)`,
      );
      err.name = 'BucketNotEmpty';
      throw err;
    }

    await fsp.rm(bucketDir(params.Bucket), { recursive: true, force: true });
    metaCache.delete(params.Bucket);
    return /** @type {any} */ ({});
  }

  /**
   * @param {import("@aws-sdk/client-s3").ListBucketsCommandInput} _params -
   * @returns {Promise<import("@aws-sdk/client-s3").ListBucketsCommandOutput>} -
   */
  async function listBuckets(_params) {
    await ensureRoot();
    let entries = [];
    try {
      entries = await fsp.readdir(bucketsDir, { withFileTypes: true });
    } catch {
      entries = [];
    }

    const Buckets = await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map(async (e) => {
          const Bucket = e.name;
          const meta = await readBucketMeta(Bucket);
          return {
            Name: Bucket,
            CreationDate: meta.createdAt
              ? new Date(meta.createdAt)
              : new Date(0),
          };
        }),
    );

    Buckets.sort((a, b) => a.Name.localeCompare(b.Name));

    return /** @type {any} */ ({ Buckets });
  }

  /**
   * @param {import("@aws-sdk/client-s3").PutObjectCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").PutObjectCommandOutput>} -
   */
  async function putObject(params) {
    await assertBucketExists(params.Bucket);
    const key = normalizeKey(params.Key);

    const body = await bodyToBuffer(params.Body);
    await writeFileAtomic(objectFilePath(params.Bucket, key), body);

    return /** @type {any} */ ({});
  }

  /**
   * @param {import("@aws-sdk/client-s3").GetObjectCommandInput} params -
   * @returns {Promise<string>} -
   */
  async function getObject(params) {
    await assertBucketExists(params.Bucket);
    const key = normalizeKey(params.Key);

    const p = objectFilePath(params.Bucket, key);
    try {
      const buf = await fsp.readFile(p);
      return buf.toString('utf8');
    } catch {
      const err = new Error(`NoSuchKey: ${params.Bucket}/${key}`);
      err.name = 'NoSuchKey';
      throw err;
    }
  }

  /**
   * @param {import("@aws-sdk/client-s3").HeadObjectCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").HeadObjectCommandOutput>} -
   */
  async function headObject(params) {
    await assertBucketExists(params.Bucket);
    const key = normalizeKey(params.Key);

    const p = objectFilePath(params.Bucket, key);
    try {
      const st = await fsp.stat(p);
      return /** @type {any} */ ({ ContentLength: st.size });
    } catch {
      const err = new Error(`NotFound: ${params.Bucket}/${key}`);
      err.name = 'NotFound';
      throw err;
    }
  }

  /**
   * @param {import("@aws-sdk/client-s3").DeleteObjectsCommandInput} params -
   * @returns {Promise<void>} -
   */
  async function deleteObjects(params) {
    await assertBucketExists(params.Bucket);

    const objs = params?.Delete?.Objects || [];
    await Promise.all(
      objs.map(async (o) => {
        const key = normalizeKey(o.Key);
        const p = objectFilePath(params.Bucket, key);
        try {
          await fsp.rm(p, { force: true });
        } catch {
          // ignore
        }
      }),
    );
  }

  /**
   * @param {string} uri -
   * @returns {import("../../typedefs.js").S3Location} -
   */
  function parseS3Uri(uri) {
    if (typeof uri !== 'string') throw new TypeError('uri is not a string');
    const match = uri.match(/^s3:\/\/([^/]+)\/(.+?)*(\/*)$/);
    if (!match)
      throw new Error(uri + ' is not of form s3://bucket/key or s3://bucket/');
    const parts = uri.split('//')[1].split('/');
    return {
      uri,
      arn: `arn:aws:s3:::${parts[0]}/${parts.slice(1).join('/')}`,
      bucket: parts[0],
      prefix: parts.slice(1).join('/'),
    };
  }

  /**
   * @param {string} CopySource -
   * @returns {{ Bucket: string, Key: string }} -
   */
  function parseCopySource(CopySource) {
    if (typeof CopySource !== 'string')
      throw new TypeError('CopySource must be a string');
    const s = CopySource.startsWith('/') ? CopySource.slice(1) : CopySource;
    const idx = s.indexOf('/');
    if (idx < 0) return { Bucket: s, Key: '' };
    return { Bucket: s.slice(0, idx), Key: s.slice(idx + 1) };
  }

  /**
   * @param {import("@aws-sdk/client-s3").CopyObjectCommandInput} params -
   * @returns {Promise<void>} -
   */
  async function copyObjectWithMultiPartFallback(params) {
    await assertBucketExists(params.Bucket);

    const { Bucket: srcBucket, Key: srcKey } = parseCopySource(
      params.CopySource,
    );
    await assertBucketExists(srcBucket);

    const srcPath = objectFilePath(srcBucket, srcKey);
    const body = await fsp.readFile(srcPath);

    await writeFileAtomic(objectFilePath(params.Bucket, params.Key), body);
  }

  /**
   * @param {import("@aws-sdk/client-s3").CopyObjectCommandInput} params -
   * @returns {Promise<void>} -
   */
  async function multiPartCopyObject(params) {
    // Local adapter does not have S3's 5GB single-copy limit, so a normal copy is sufficient.
    await copyObjectWithMultiPartFallback(params);
  }

  /**
   * @param {import("@aws-sdk/client-s3").CopyObjectCommandInput[]} params -
   * @returns {Promise<void>} -
   */
  async function copyObjectsWithMultiPartFallback(params) {
    await Promise.all(params.map((p) => copyObjectWithMultiPartFallback(p)));
  }

  /**
   * @param {import("@aws-sdk/client-s3").ListObjectsV2CommandInput} SourceParams -
   * @param {string} DestinationBucket -
   * @param {string} DestinationPrefix -
   * @returns {Promise<void>} -
   */
  async function copyPath(SourceParams, DestinationBucket, DestinationPrefix) {
    const response = await listObjectsV2Internal(SourceParams);
    if (!response.Contents) throw new Error('No Contents returned');

    while (response.Contents.length > 0) {
      const object = response.Contents.splice(0, 1)[0];
      await copyObjectWithMultiPartFallback({
        CopySource: `${SourceParams.Bucket}/${object.Key}`,
        Bucket: DestinationBucket,
        Key: `${DestinationPrefix}${object.Key}`,
      });
    }
  }

  /**
   * @param {import("@aws-sdk/client-s3").ListObjectsV2CommandInput} params -
   * @returns {Promise<void>} -
   */
  async function deletePath(params) {
    const response = await listObjectsV2Internal(params);
    if (!response.Contents) throw new Error('No Contents returned');

    const objectsToDelete = response.Contents.map((o) => ({ Key: o.Key }));
    if (objectsToDelete.length === 0) return;

    await deleteObjects({
      Bucket: params.Bucket,
      Delete: {
        Objects: objectsToDelete,
      },
    });
  }

  /**
   * @param {import("@aws-sdk/client-s3").ListObjectsV2CommandInput} params -
   * @param {Date} [expirationDate] -
   * @returns {Promise<void>} -
   */
  async function expireObjects(params, expirationDate = new Date()) {
    const response = await listObjectsV2Internal(params);
    if (!response.Contents) throw new Error('No Contents returned');

    const objectsToDelete = response.Contents.filter(
      (o) => o.LastModified < expirationDate,
    ).map((o) => ({ Key: o.Key }));

    if (objectsToDelete.length === 0) return;

    await deleteObjects({
      Bucket: params.Bucket,
      Delete: {
        Objects: objectsToDelete,
      },
    });
  }

  /**
   * @param {import("@aws-sdk/client-s3").ListObjectsV2CommandInput} params -
   * @returns {Promise<string[]>} -
   */
  async function getCommonPrefixes(params) {
    const response = await listObjectsV2Internal({
      Bucket: params.Bucket,
      Prefix: params.Prefix,
      Delimiter: '/',
    });

    const prefixes = (response.CommonPrefixes || []).map((p) => p.Prefix);
    prefixes.sort((a, b) => a.localeCompare(b));
    return prefixes;
  }

  /**
   * @param {string} Bucket -
   * @param {string} Prefix -
   * @param {Array<{ name: string }>} partitionKeys -
   * @returns {Promise<import("../../typedefs.js").Partition[]>} -
   */
  async function findPartitions(Bucket, Prefix, partitionKeys) {
    if (partitionKeys.length === 0) return [];

    const prefixes = await getCommonPrefixes({ Bucket, Prefix });
    /** @type {import("../../typedefs.js").Partition[]} */
    const partitions = [];

    await Promise.all(
      prefixes.map(async (prefix) => {
        const partitionValues = {};
        partitionValues[partitionKeys[0].name] = prefix
          .replace(Prefix, '')
          .replace('/', '')
          .replace(`${partitionKeys[0].name}=`, '')
          .replace(`${partitionKeys[0].name}}%3D`, '');

        if (partitionKeys.length === 1) {
          partitions.push({
            partitionValues,
            location: `s3://${Bucket}/${prefix}`,
          });
          return;
        }

        const childPartitions = await findPartitions(
          Bucket,
          prefix,
          partitionKeys.slice(1),
        );

        childPartitions.forEach((childPartition) => {
          partitions.push({
            partitionValues: {
              ...partitionValues,
              ...childPartition.partitionValues,
            },
            location: childPartition.location,
          });
        });
      }),
    );

    partitions.sort((a, b) => a.location.localeCompare(b.location));
    return partitions;
  }

  /**
   * @param {import("@aws-sdk/client-s3").CreateMultipartUploadCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").CreateMultipartUploadCommandOutput>} -
   */
  async function createMultipartUpload(params) {
    await assertBucketExists(params.Bucket);

    const uploadId = createId();
    multipartUploads.set(uploadId, {
      Bucket: params.Bucket,
      Key: normalizeKey(params.Key),
      Parts: [],
    });

    return /** @type {any} */ ({ UploadId: uploadId });
  }

  /**
   * @param {import("@aws-sdk/client-s3").UploadPartCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").UploadPartCommandOutput>} -
   */
  async function uploadPart(params) {
    const upload = multipartUploads.get(params.UploadId);
    if (!upload) throw new Error(`InvalidUploadId: ${params.UploadId}`);

    upload.Parts.push({
      PartNumber: params.PartNumber,
      Body: await bodyToBuffer(params.Body),
    });

    return /** @type {any} */ ({ ETag: 'etag' });
  }

  /**
   * @param {import("@aws-sdk/client-s3").UploadPartCopyCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").UploadPartCopyCommandOutput>} -
   */
  async function uploadPartCopy(params) {
    const upload = multipartUploads.get(params.UploadId);
    if (!upload) throw new Error(`InvalidUploadId: ${params.UploadId}`);

    upload.Parts.push({
      PartNumber: params.PartNumber,
      CopySource: params.CopySource,
    });

    return /** @type {any} */ ({ CopyPartResult: { ETag: 'etag' } });
  }

  /**
   * @param {import("@aws-sdk/client-s3").CompleteMultipartUploadCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").CompleteMultipartUploadCommandOutput>} -
   */
  async function completeMultipartUpload(params) {
    const upload = multipartUploads.get(params.UploadId);
    if (!upload) throw new Error(`InvalidUploadId: ${params.UploadId}`);

    /** @type {Array<{ PartNumber: number, Body?: Buffer, CopySource?: string }>} */
    const parts = upload.Parts.sort((a, b) => a.PartNumber - b.PartNumber);

    const buffers = [];
    for (const part of parts) {
      if (part.Body) {
        buffers.push(part.Body);
        continue;
      }

      if (part.CopySource) {
        const { Bucket: srcBucket, Key: srcKey } = parseCopySource(
          part.CopySource,
        );
        await assertBucketExists(srcBucket);
        const b = await fsp.readFile(objectFilePath(srcBucket, srcKey));
        buffers.push(b);
        continue;
      }

      buffers.push(Buffer.from(''));
    }

    await putObject({
      Bucket: upload.Bucket,
      Key: upload.Key,
      Body: Buffer.concat(buffers),
    });

    multipartUploads.delete(params.UploadId);
    return /** @type {any} */ ({});
  }

  /**
   * Local adapter implementation: append bytes to an object.
   *
   * Unlike S3, we do not need multipart gymnastics for small files.
   *
   * @param {import("@aws-sdk/client-s3").HeadObjectCommandInput} params -
   * @param {any} data -
   * @returns {Promise<void>} -
   */
  async function createAppendableOrAppendToObject(params, data) {
    await assertBucketExists(params.Bucket);

    const key = normalizeKey(params.Key);
    let existing = '';
    try {
      existing = await getObject({ Bucket: params.Bucket, Key: key });
    } catch {
      existing = '';
    }

    const next =
      existing + (Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
    await putObject({ Bucket: params.Bucket, Key: key, Body: next });
  }

  /**
   * @param {import("@aws-sdk/client-s3").PutBucketNotificationConfigurationCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").PutBucketNotificationConfigurationCommandOutput>} -
   */
  async function putBucketNotificationConfiguration(params) {
    await assertBucketExists(params.Bucket);
    const meta = await readBucketMeta(params.Bucket);
    meta.notificationConfiguration = params.NotificationConfiguration;
    await writeBucketMeta(params.Bucket, meta);
    return /** @type {any} */ ({});
  }

  /**
   * @param {import("@aws-sdk/client-s3").GetBucketNotificationConfigurationCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").GetBucketNotificationConfigurationCommandOutput>} -
   */
  async function getBucketNotificationConfiguration(params) {
    await assertBucketExists(params.Bucket);
    const meta = await readBucketMeta(params.Bucket);
    const cfg = meta.notificationConfiguration || {};
    return /** @type {any} */ ({
      ...(cfg || {}),
      QueueConfigurations: cfg.QueueConfigurations || [],
    });
  }

  /**
   * NOTE: intentionally matches the misspelling in `lambdas/lib/s3.js`:
   * `putBucketLifecycleConfigutation` (not Configuration).
   * @param {import("@aws-sdk/client-s3").PutBucketLifecycleConfigurationCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").PutBucketLifecycleConfigurationCommandOutput>} -
   */
  async function putBucketLifecycleConfigutation(params) {
    await assertBucketExists(params.Bucket);
    const meta = await readBucketMeta(params.Bucket);
    meta.lifecycleConfiguration = params.LifecycleConfiguration;
    await writeBucketMeta(params.Bucket, meta);
    return /** @type {any} */ ({});
  }

  /**
   * NOTE: intentionally matches the misspelling in `lambdas/lib/s3.js`:
   * `getBucketLifecycleConfigutation` (not Configuration).
   * @param {import("@aws-sdk/client-s3").GetBucketLifecycleConfigurationCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").GetBucketLifecycleConfigurationCommandOutput>} -
   */
  async function getBucketLifecycleConfigutation(params) {
    await assertBucketExists(params.Bucket);
    const meta = await readBucketMeta(params.Bucket);
    return /** @type {any} */ ({
      Rules: meta.lifecycleConfiguration?.Rules || [],
    });
  }

  /**
   * @param {string} bucketName -
   * @param {string} _expectedOwnerId -
   * @returns {Promise<boolean>} -
   */
  async function checkBucketOwnership(bucketName, _expectedOwnerId) {
    return await bucketExists(bucketName);
  }

  /**
   * @param {import("@aws-sdk/client-s3").GetBucketLocationCommandInput} params -
   * @param {string} [_region] -
   * @returns {Promise<import("@aws-sdk/client-s3").GetBucketLocationCommandOutput>} -
   */
  async function getBucketLocation(params, _region) {
    await assertBucketExists(params.Bucket);
    const meta = await readBucketMeta(params.Bucket);
    return /** @type {any} */ ({
      LocationConstraint: meta.region || 'us-east-1',
    });
  }

  /**
   * @param {import("@aws-sdk/client-s3").GetBucketLocationCommandInput} params -
   * @returns {Promise<string>} -
   */
  async function findBucketRegion(params) {
    const loc = await getBucketLocation(params);
    return loc.LocationConstraint || 'us-east-1';
  }

  /**
   * @param {import("@aws-sdk/client-s3").ListObjectsV2CommandInput} params -
   * @param {string} [_region] -
   * @param {number} [byteSize] -
   * @returns {Promise<number>} -
   */
  async function getPrefixByteSize(params, _region, byteSize = 0) {
    const response = await listObjectsV2Internal(params);
    if (!response.Contents) throw new Error('No Contents returned');
    response.Contents.forEach((obj) => {
      byteSize += Number(obj.Size || 0);
    });
    return byteSize;
  }

  /**
   * @param {import("@aws-sdk/client-s3").PutBucketTaggingCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").PutBucketTaggingCommandOutput>} -
   */
  async function putBucketTagging(params) {
    await assertBucketExists(params.Bucket);
    const meta = await readBucketMeta(params.Bucket);
    meta.tags = params.Tagging?.TagSet || [];
    await writeBucketMeta(params.Bucket, meta);
    return /** @type {any} */ ({});
  }

  /**
   * @param {import("@aws-sdk/client-s3").GetBucketTaggingCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").GetBucketTaggingCommandOutput>} -
   */
  async function getBucketTagging(params) {
    await assertBucketExists(params.Bucket);
    const meta = await readBucketMeta(params.Bucket);
    return /** @type {any} */ ({ TagSet: meta.tags || [] });
  }

  /**
   * @param {import("@aws-sdk/client-s3").DeleteBucketTaggingCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").DeleteBucketTaggingCommandOutput>} -
   */
  async function deleteBucketTagging(params) {
    await assertBucketExists(params.Bucket);
    const meta = await readBucketMeta(params.Bucket);
    meta.tags = [];
    await writeBucketMeta(params.Bucket, meta);
    return /** @type {any} */ ({});
  }

  /**
   * Best-effort close (noop for vanilla).
   * @returns {Promise<void>} -
   */
  async function close() {
    // All writes are persisted immediately; nothing to flush.
  }

  return {
    putObject,
    getObject,
    headObject,
    createBucket,
    deleteBucket,
    listBuckets,
    deleteObjects,
    parseS3Uri,
    multiPartCopyObject,
    copyObjectWithMultiPartFallback,
    copyObjectsWithMultiPartFallback,
    copyPath,
    deletePath,
    expireObjects,
    getCommonPrefixes,
    findPartitions,
    createMultipartUpload,
    completeMultipartUpload,
    uploadPartCopy,
    uploadPart,
    createAppendableOrAppendToObject,
    putBucketNotificationConfiguration,
    getBucketNotificationConfiguration,
    putBucketLifecycleConfigutation,
    getBucketLifecycleConfigutation,
    checkBucketOwnership,
    getBucketLocation,
    findBucketRegion,
    getPrefixByteSize,
    putBucketTagging,
    getBucketTagging,
    deleteBucketTagging,
    close,
  };
}
