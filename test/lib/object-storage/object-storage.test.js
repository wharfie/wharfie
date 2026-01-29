import { jest } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PATHS_IMPORT = '../../../lambdas/lib/paths.js';
const VANILLA_ADAPTER_IMPORT =
  '../../../lambdas/lib/object-storage/adapters/vanilla.js';
const MOCK_ADAPTER_IMPORT =
  '../../../lambdas/lib/object-storage/adapters/mock.js';
const S3_ADAPTER_IMPORT = '../../../lambdas/lib/object-storage/adapters/s3.js';
const R2_ADAPTER_IMPORT = '../../../lambdas/lib/object-storage/adapters/r2.js';
const B2_ADAPTER_IMPORT = '../../../lambdas/lib/object-storage/adapters/b2.js';

/**
 * @returns {string} -
 */
function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'wharfie-object-storage-test-'));
}

/**
 * Minimal, in-memory S3 implementation compatible with what `lambdas/lib/s3.js`
 * uses in this repository.
 *
 * @returns {any} -
 */
function createFakeS3Module() {
  /**
   * Buckets state:
   *   {
   *     [bucketName]: {
   *       region: string,
   *       objects: { [key]: { Body: Buffer, LastModified: Date } },
   *       tags: Array<{Key,Value}> | null,
   *       notificationConfiguration: any,
   *       lifecycleConfiguration: any,
   *     }
   *   }
   */
  const state = {
    buckets: /** @type {Record<string, any>} */ ({}),
    multipart: /** @type {Record<string, any>} */ ({}),
    nextUploadId: 1,
  };

  class NoSuchBucket extends Error {
    constructor(bucket) {
      super(`NoSuchBucket: ${bucket}`);
      this.name = 'NoSuchBucket';
    }
  }

  class BucketNotEmpty extends Error {
    constructor(bucket) {
      super(`BucketNotEmpty: ${bucket}`);
      this.name = 'BucketNotEmpty';
    }
  }

  class NoSuchKey extends Error {
    constructor(bucket, key) {
      super(`NoSuchKey: ${bucket}/${key}`);
      this.name = 'NoSuchKey';
    }
  }

  class NotFound extends Error {
    constructor(bucket, key) {
      super(`NotFound: ${bucket}/${key}`);
      this.name = 'NotFound';
    }
  }

  class NoSuchTagSet extends Error {
    constructor(bucket) {
      super(`NoSuchTagSet: ${bucket}`);
      this.name = 'NoSuchTagSet';
    }
  }

  class PutObjectCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class GetObjectCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class HeadObjectCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class CreateBucketCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class DeleteBucketCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class ListBucketsCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class DeleteObjectsCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class CreateMultipartUploadCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class UploadPartCopyCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class CompleteMultipartUploadCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class AbortMultipartUploadCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class CopyObjectCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class ListObjectsV2Command {
    constructor(input) {
      this.input = input;
    }
  }
  class UploadPartCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class PutBucketNotificationConfigurationCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class GetBucketNotificationConfigurationCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class PutBucketLifecycleConfigurationCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class GetBucketLifecycleConfigurationCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class HeadBucketCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class GetBucketLocationCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class PutBucketTaggingCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class GetBucketTaggingCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class DeleteBucketTaggingCommand {
    constructor(input) {
      this.input = input;
    }
  }

  /**
   * @param {string} copySource -
   * @returns {{ Bucket: string, Key: string }} -
   */
  function parseCopySource(copySource) {
    const s = copySource.startsWith('/') ? copySource.slice(1) : copySource;
    const idx = s.indexOf('/');
    if (idx < 0) return { Bucket: s, Key: '' };
    return { Bucket: s.slice(0, idx), Key: s.slice(idx + 1) };
  }

  class S3 {
    constructor(config = {}) {
      this.config = config;
    }

    destroy() {}

    /**
     * @param {any} cmd -
     * @returns {Promise<any>} -
     */
    async send(cmd) {
      const name = cmd?.constructor?.name;
      const input = cmd?.input || {};

      switch (name) {
        case 'CreateBucketCommand': {
          const bucket = input.Bucket;
          if (!bucket) throw new Error('Bucket is required');

          if (state.buckets[bucket]) {
            // AWS would return BucketAlreadyOwnedByYou / BucketAlreadyExists.
            const err = new Error(`BucketAlreadyExists: ${bucket}`);
            err.name = 'BucketAlreadyExists';
            throw err;
          }

          state.buckets[bucket] = {
            region:
              input?.CreateBucketConfiguration?.LocationConstraint ||
              'us-east-1',
            objects: {},
            tags: null,
            notificationConfiguration: undefined,
            lifecycleConfiguration: undefined,
            createdAt: new Date(),
          };
          return {};
        }

        case 'DeleteBucketCommand': {
          const bucket = input.Bucket;
          const b = state.buckets[bucket];
          if (!b) throw new NoSuchBucket(bucket);

          const keys = Object.keys(b.objects);
          if (keys.length > 0) throw new BucketNotEmpty(bucket);

          delete state.buckets[bucket];
          return {};
        }

        case 'ListBucketsCommand': {
          return {
            Buckets: Object.entries(state.buckets).map(([Name, b]) => ({
              Name,
              CreationDate: b.createdAt,
            })),
          };
        }

        case 'PutObjectCommand': {
          const bucket = input.Bucket;
          const key = input.Key;
          const b = state.buckets[bucket];
          if (!b) throw new NoSuchBucket(bucket);

          const Body =
            input.Body == null
              ? Buffer.from('')
              : Buffer.isBuffer(input.Body)
                ? input.Body
                : input.Body instanceof Uint8Array
                  ? Buffer.from(input.Body)
                  : Buffer.from(String(input.Body), 'utf8');

          b.objects[key] = {
            Body,
            LastModified: new Date(),
          };

          return {};
        }

        case 'GetObjectCommand': {
          const bucket = input.Bucket;
          const key = input.Key;
          const b = state.buckets[bucket];
          if (!b) throw new NoSuchBucket(bucket);

          const o = b.objects[key];
          if (!o) throw new NoSuchKey(bucket, key);

          return {
            Body: {
              transformToString: async () => o.Body.toString('utf8'),
            },
          };
        }

        case 'HeadObjectCommand': {
          const bucket = input.Bucket;
          const key = input.Key;
          const b = state.buckets[bucket];
          if (!b) throw new NoSuchBucket(bucket);

          const o = b.objects[key];
          if (!o) throw new NotFound(bucket, key);

          return { ContentLength: o.Body.length };
        }

        case 'CopyObjectCommand': {
          const bucket = input.Bucket;
          const key = input.Key;
          const b = state.buckets[bucket];
          if (!b) throw new NoSuchBucket(bucket);

          const { Bucket: srcBucket, Key: srcKey } = parseCopySource(
            input.CopySource,
          );
          const src = state.buckets[srcBucket];
          if (!src) throw new NoSuchBucket(srcBucket);
          const srcObj = src.objects[srcKey];
          if (!srcObj) throw new NoSuchKey(srcBucket, srcKey);

          b.objects[key] = {
            Body: Buffer.from(srcObj.Body),
            LastModified: new Date(),
          };
          return {};
        }

        case 'DeleteObjectsCommand': {
          const bucket = input.Bucket;
          const b = state.buckets[bucket];
          if (!b) throw new NoSuchBucket(bucket);

          const objs = input?.Delete?.Objects || [];
          for (const o of objs) delete b.objects[o.Key];
          return { Errors: [] };
        }

        case 'ListObjectsV2Command': {
          const bucket = input.Bucket;
          const b = state.buckets[bucket];
          if (!b) throw new NoSuchBucket(bucket);

          const Prefix = input.Prefix || '';
          const Delimiter = input.Delimiter;

          const keys = Object.keys(b.objects).filter((k) =>
            k.startsWith(Prefix),
          );
          keys.sort((a, b) => a.localeCompare(b));

          if (Delimiter) {
            const base =
              Prefix && Prefix.endsWith(Delimiter)
                ? Prefix
                : Prefix
                  ? `${Prefix}${Delimiter}`
                  : '';
            const prefixes = new Set();

            for (const k of keys) {
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

          return {
            Contents: keys.map((Key) => ({
              Key,
              LastModified: b.objects[Key].LastModified,
              Size: b.objects[Key].Body.length,
            })),
          };
        }

        case 'CreateMultipartUploadCommand': {
          const bucket = input.Bucket;
          const key = input.Key;
          const b = state.buckets[bucket];
          if (!b) throw new NoSuchBucket(bucket);

          const uploadId = `upload-${state.nextUploadId++}`;
          state.multipart[uploadId] = {
            Bucket: bucket,
            Key: key,
            Parts: [],
          };

          return { UploadId: uploadId };
        }

        case 'UploadPartCommand': {
          const uploadId = input.UploadId;
          const upload = state.multipart[uploadId];
          if (!upload) throw new Error(`InvalidUploadId: ${uploadId}`);

          const Body =
            input.Body == null
              ? Buffer.from('')
              : Buffer.isBuffer(input.Body)
                ? input.Body
                : input.Body instanceof Uint8Array
                  ? Buffer.from(input.Body)
                  : Buffer.from(String(input.Body), 'utf8');

          upload.Parts.push({
            PartNumber: input.PartNumber,
            Body,
          });

          return { ETag: 'etag' };
        }

        case 'UploadPartCopyCommand': {
          const uploadId = input.UploadId;
          const upload = state.multipart[uploadId];
          if (!upload) throw new Error(`InvalidUploadId: ${uploadId}`);

          upload.Parts.push({
            PartNumber: input.PartNumber,
            CopySource: input.CopySource,
          });

          return { CopyPartResult: { ETag: 'etag' } };
        }

        case 'CompleteMultipartUploadCommand': {
          const uploadId = input.UploadId;
          const upload = state.multipart[uploadId];
          if (!upload) throw new Error(`InvalidUploadId: ${uploadId}`);

          const b = state.buckets[upload.Bucket];
          if (!b) throw new NoSuchBucket(upload.Bucket);

          const parts = upload.Parts.sort(
            (a, b) => a.PartNumber - b.PartNumber,
          );

          const buffers = [];
          for (const p of parts) {
            if (p.Body) buffers.push(p.Body);
            else if (p.CopySource) {
              const { Bucket: srcBucket, Key: srcKey } = parseCopySource(
                p.CopySource,
              );
              const src = state.buckets[srcBucket];
              if (!src) throw new NoSuchBucket(srcBucket);
              const srcObj = src.objects[srcKey];
              if (!srcObj) throw new NoSuchKey(srcBucket, srcKey);
              buffers.push(srcObj.Body);
            } else buffers.push(Buffer.from(''));
          }

          b.objects[upload.Key] = {
            Body: Buffer.concat(buffers),
            LastModified: new Date(),
          };

          delete state.multipart[uploadId];
          return {};
        }

        case 'AbortMultipartUploadCommand': {
          const uploadId = input.UploadId;
          delete state.multipart[uploadId];
          return {};
        }

        case 'HeadBucketCommand': {
          const bucket = input.Bucket;
          const b = state.buckets[bucket];
          if (!b) throw new NoSuchBucket(bucket);
          return {};
        }

        case 'GetBucketLocationCommand': {
          const bucket = input.Bucket;
          const b = state.buckets[bucket];
          if (!b) throw new NoSuchBucket(bucket);
          return {
            LocationConstraint: b.region === 'us-east-1' ? null : b.region,
          };
        }

        case 'PutBucketNotificationConfigurationCommand': {
          const bucket = input.Bucket;
          const b = state.buckets[bucket];
          if (!b) throw new NoSuchBucket(bucket);
          b.notificationConfiguration = input.NotificationConfiguration;
          return {};
        }

        case 'GetBucketNotificationConfigurationCommand': {
          const bucket = input.Bucket;
          const b = state.buckets[bucket];
          if (!b) throw new NoSuchBucket(bucket);
          return b.notificationConfiguration || { QueueConfigurations: [] };
        }

        case 'PutBucketLifecycleConfigurationCommand': {
          const bucket = input.Bucket;
          const b = state.buckets[bucket];
          if (!b) throw new NoSuchBucket(bucket);
          b.lifecycleConfiguration = input.LifecycleConfiguration;
          return {};
        }

        case 'GetBucketLifecycleConfigurationCommand': {
          const bucket = input.Bucket;
          const b = state.buckets[bucket];
          if (!b) throw new NoSuchBucket(bucket);
          return b.lifecycleConfiguration || { Rules: [] };
        }

        case 'PutBucketTaggingCommand': {
          const bucket = input.Bucket;
          const b = state.buckets[bucket];
          if (!b) throw new NoSuchBucket(bucket);
          b.tags = input.Tagging?.TagSet || [];
          return {};
        }

        case 'GetBucketTaggingCommand': {
          const bucket = input.Bucket;
          const b = state.buckets[bucket];
          if (!b) throw new NoSuchBucket(bucket);
          if (!b.tags) throw new NoSuchTagSet(bucket);
          return { TagSet: b.tags };
        }

        case 'DeleteBucketTaggingCommand': {
          const bucket = input.Bucket;
          const b = state.buckets[bucket];
          if (!b) throw new NoSuchBucket(bucket);
          b.tags = null;
          return {};
        }

        default:
          throw new Error(`Unsupported command: ${name}`);
      }
    }
  }

  return {
    S3,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    CreateBucketCommand,
    DeleteBucketCommand,
    ListBucketsCommand,
    DeleteObjectsCommand,
    CreateMultipartUploadCommand,
    UploadPartCopyCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
    CopyObjectCommand,
    ListObjectsV2Command,
    UploadPartCommand,
    PutBucketNotificationConfigurationCommand,
    GetBucketNotificationConfigurationCommand,
    PutBucketLifecycleConfigurationCommand,
    GetBucketLifecycleConfigurationCommand,
    HeadBucketCommand,
    GetBucketLocationCommand,
    PutBucketTaggingCommand,
    GetBucketTaggingCommand,
    DeleteBucketTaggingCommand,

    // expose errors for completeness (the main wrapper checks err.name)
    NoSuchBucket,
    NoSuchKey,
    NotFound,
    NoSuchTagSet,
  };
}

/**
 * @param {{ name: string, create: () => Promise<any>, cleanup?: () => Promise<void> }} adapter -
 */
function runContract(adapter) {
  describe(`${adapter.name} adapter`, () => {
    let store;

    const bucketA = 'wharfie-contract-a';
    const bucketB = 'wharfie-contract-b';

    beforeEach(async () => {
      store = await adapter.create();
      await store.createBucket({ Bucket: bucketA });
      await store.createBucket({ Bucket: bucketB });
    });

    afterEach(async () => {
      if (store?.close) await store.close();
      if (adapter.cleanup) await adapter.cleanup();
    });

    test('createBucket/listBuckets/deleteBucket roundtrip', async () => {
      const bucketC = 'wharfie-contract-c';
      await store.createBucket({ Bucket: bucketC });

      const listed = await store.listBuckets({});
      const names = (listed.Buckets || []).map((b) => b.Name).sort();
      expect(names).toEqual([bucketA, bucketB, bucketC].sort());

      await store.putObject({ Bucket: bucketC, Key: 'x', Body: '1' });
      await expect(store.deleteBucket({ Bucket: bucketC })).rejects.toThrow();

      await store.deleteObjects({
        Bucket: bucketC,
        Delete: { Objects: [{ Key: 'x' }] },
      });
      await store.deleteBucket({ Bucket: bucketC });

      const listed2 = await store.listBuckets({});
      const names2 = (listed2.Buckets || []).map((b) => b.Name).sort();
      expect(names2).toEqual([bucketA, bucketB].sort());
    });

    test('putObject/getObject/headObject roundtrip', async () => {
      await store.putObject({
        Bucket: bucketA,
        Key: 'path/file.txt',
        Body: 'hello',
      });

      await expect(
        store.getObject({ Bucket: bucketA, Key: 'path/file.txt' }),
      ).resolves.toBe('hello');

      const head = await store.headObject({
        Bucket: bucketA,
        Key: 'path/file.txt',
      });
      expect(head.ContentLength).toBe(5);

      await store.putObject({
        Bucket: bucketA,
        Key: 'path/file.txt',
        Body: 'hello2',
      });

      const head2 = await store.headObject({
        Bucket: bucketA,
        Key: 'path/file.txt',
      });
      expect(head2.ContentLength).toBe(6);
      await expect(
        store.getObject({ Bucket: bucketA, Key: 'path/file.txt' }),
      ).resolves.toBe('hello2');
    });

    test('deleteObjects is idempotent', async () => {
      await store.putObject({ Bucket: bucketA, Key: 'a', Body: '1' });
      await store.putObject({ Bucket: bucketA, Key: 'b', Body: '2' });

      await store.deleteObjects({
        Bucket: bucketA,
        Delete: { Objects: [{ Key: 'a' }, { Key: 'b' }, { Key: 'c' }] },
      });

      await expect(
        store.getObject({ Bucket: bucketA, Key: 'a' }),
      ).rejects.toThrow();
      await expect(
        store.getObject({ Bucket: bucketA, Key: 'b' }),
      ).rejects.toThrow();
    });

    test('copyObjectWithMultiPartFallback copies objects', async () => {
      await store.putObject({
        Bucket: bucketA,
        Key: 'src.txt',
        Body: 'copy-me',
      });

      await store.copyObjectWithMultiPartFallback({
        Bucket: bucketB,
        Key: 'dst.txt',
        CopySource: `${bucketA}/src.txt`,
      });

      await expect(
        store.getObject({ Bucket: bucketB, Key: 'dst.txt' }),
      ).resolves.toBe('copy-me');

      await store.copyObjectsWithMultiPartFallback([
        {
          Bucket: bucketB,
          Key: 'dst2.txt',
          CopySource: `${bucketA}/src.txt`,
        },
        {
          Bucket: bucketB,
          Key: 'dst3.txt',
          CopySource: `${bucketA}/src.txt`,
        },
      ]);

      await expect(
        store.getObject({ Bucket: bucketB, Key: 'dst2.txt' }),
      ).resolves.toBe('copy-me');
      await expect(
        store.getObject({ Bucket: bucketB, Key: 'dst3.txt' }),
      ).resolves.toBe('copy-me');
    });

    test('copyPath copies all objects under prefix', async () => {
      await store.putObject({ Bucket: bucketA, Key: 'p/a.txt', Body: 'A' });
      await store.putObject({ Bucket: bucketA, Key: 'p/b.txt', Body: 'B' });
      await store.putObject({ Bucket: bucketA, Key: 'q/c.txt', Body: 'C' });

      await store.copyPath(
        { Bucket: bucketA, Prefix: 'p/' },
        bucketB,
        'copied/',
      );

      // copyPath uses DestinationPrefix + object.Key (full key, including source prefix)
      await expect(
        store.getObject({ Bucket: bucketB, Key: 'copied/p/a.txt' }),
      ).resolves.toBe('A');
      await expect(
        store.getObject({ Bucket: bucketB, Key: 'copied/p/b.txt' }),
      ).resolves.toBe('B');
      await expect(
        store.getObject({ Bucket: bucketB, Key: 'copied/q/c.txt' }),
      ).rejects.toThrow();
    });

    test('deletePath removes all objects under prefix', async () => {
      await store.putObject({ Bucket: bucketA, Key: 'del/a.txt', Body: 'A' });
      await store.putObject({ Bucket: bucketA, Key: 'del/b.txt', Body: 'B' });
      await store.putObject({ Bucket: bucketA, Key: 'keep/c.txt', Body: 'C' });

      await store.deletePath({ Bucket: bucketA, Prefix: 'del/' });

      await expect(
        store.getObject({ Bucket: bucketA, Key: 'del/a.txt' }),
      ).rejects.toThrow();
      await expect(
        store.getObject({ Bucket: bucketA, Key: 'del/b.txt' }),
      ).rejects.toThrow();
      await expect(
        store.getObject({ Bucket: bucketA, Key: 'keep/c.txt' }),
      ).resolves.toBe('C');
    });

    test('expireObjects deletes objects older than the provided date', async () => {
      await store.putObject({ Bucket: bucketA, Key: 'exp/a.txt', Body: 'A' });
      await store.putObject({ Bucket: bucketA, Key: 'exp/b.txt', Body: 'B' });

      // Future date: everything is "older than" it, so everything should be deleted.
      await store.expireObjects(
        { Bucket: bucketA, Prefix: 'exp/' },
        new Date('9999-01-01'),
      );

      await expect(
        store.getObject({ Bucket: bucketA, Key: 'exp/a.txt' }),
      ).rejects.toThrow();
      await expect(
        store.getObject({ Bucket: bucketA, Key: 'exp/b.txt' }),
      ).rejects.toThrow();
    });

    test('getCommonPrefixes + findPartitions', async () => {
      await store.putObject({
        Bucket: bucketA,
        Key: 'parts/dt=2021-01-20/hr=10/a.json',
        Body: 'a',
      });
      await store.putObject({
        Bucket: bucketA,
        Key: 'parts/dt=2021-01-20/hr=11/b.json',
        Body: 'b',
      });
      await store.putObject({
        Bucket: bucketA,
        Key: 'parts/dt=2021-01-21/hr=10/c.json',
        Body: 'c',
      });

      const prefixes = await store.getCommonPrefixes({
        Bucket: bucketA,
        Prefix: 'parts/',
      });

      expect(prefixes.sort()).toEqual(
        ['parts/dt=2021-01-20/', 'parts/dt=2021-01-21/'].sort(),
      );

      const partitions = await store.findPartitions(bucketA, 'parts/', [
        { name: 'dt' },
        { name: 'hr' },
      ]);

      // Sort for stable assertions
      partitions.sort((a, b) => a.location.localeCompare(b.location));

      expect(partitions).toEqual([
        {
          partitionValues: { dt: '2021-01-20', hr: '10' },
          location: `s3://${bucketA}/parts/dt=2021-01-20/hr=10/`,
        },
        {
          partitionValues: { dt: '2021-01-20', hr: '11' },
          location: `s3://${bucketA}/parts/dt=2021-01-20/hr=11/`,
        },
        {
          partitionValues: { dt: '2021-01-21', hr: '10' },
          location: `s3://${bucketA}/parts/dt=2021-01-21/hr=10/`,
        },
      ]);
    });

    test('getPrefixByteSize sums sizes under prefix', async () => {
      await store.putObject({
        Bucket: bucketA,
        Key: 'size/a.txt',
        Body: 'aaaa',
      }); // 4
      await store.putObject({
        Bucket: bucketA,
        Key: 'size/b.txt',
        Body: 'bbb',
      }); // 3
      await store.putObject({
        Bucket: bucketA,
        Key: 'other/c.txt',
        Body: 'cccccccc',
      }); // ignored

      const bytes = await store.getPrefixByteSize({
        Bucket: bucketA,
        Prefix: 'size/',
      });

      expect(bytes).toBe(7);
    });

    test('bucket tagging roundtrip', async () => {
      const before = await store.getBucketTagging({ Bucket: bucketA });
      expect(before.TagSet || []).toEqual([]);

      await store.putBucketTagging({
        Bucket: bucketA,
        Tagging: { TagSet: [{ Key: 'env', Value: 'test' }] },
      });

      const afterPut = await store.getBucketTagging({ Bucket: bucketA });
      expect(afterPut.TagSet).toEqual([{ Key: 'env', Value: 'test' }]);

      await store.deleteBucketTagging({ Bucket: bucketA });

      const afterDelete = await store.getBucketTagging({ Bucket: bucketA });
      expect(afterDelete.TagSet || []).toEqual([]);
    });

    test('bucket notification + lifecycle configuration roundtrip', async () => {
      await store.putBucketNotificationConfiguration({
        Bucket: bucketA,
        NotificationConfiguration: {
          QueueConfigurations: [
            {
              QueueArn: 'arn:aws:sqs:us-east-1:123456789012:test',
              Events: ['s3:ObjectCreated:*'],
            },
          ],
        },
      });

      const notif = await store.getBucketNotificationConfiguration({
        Bucket: bucketA,
      });

      expect(notif.QueueConfigurations).toEqual([
        {
          QueueArn: 'arn:aws:sqs:us-east-1:123456789012:test',
          Events: ['s3:ObjectCreated:*'],
        },
      ]);

      await store.putBucketLifecycleConfigutation({
        Bucket: bucketA,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: 'expire',
              Status: 'Enabled',
              Expiration: { Days: 1 },
              Filter: { Prefix: '' },
            },
          ],
        },
      });

      const lc = await store.getBucketLifecycleConfigutation({
        Bucket: bucketA,
      });
      expect(lc.Rules).toEqual([
        {
          ID: 'expire',
          Status: 'Enabled',
          Expiration: { Days: 1 },
          Filter: { Prefix: '' },
        },
      ]);
    });

    test('getBucketLocation + findBucketRegion', async () => {
      const loc = await store.getBucketLocation({ Bucket: bucketA });
      const region = await store.findBucketRegion({ Bucket: bucketA });

      // AWS S3 may return null for us-east-1 in LocationConstraint.
      expect(region).toBe(
        typeof loc.LocationConstraint === 'string'
          ? loc.LocationConstraint
          : 'us-east-1',
      );
    });

    test('parseS3Uri', async () => {
      const parsed = store.parseS3Uri(`s3://${bucketA}/a/b/c`);
      expect(parsed.bucket).toBe(bucketA);
      expect(parsed.prefix).toBe('a/b/c');
      expect(parsed.arn).toBe(`arn:aws:s3:::${bucketA}/a/b/c`);
    });
  });
}

describe('Object storage adapters', () => {
  let tmpDataDir = '';

  beforeEach(() => {
    tmpDataDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDataDir, { recursive: true, force: true });
  });

  test('mock adapter provides jest spies', async () => {
    jest.resetModules();
    const mod = await import(MOCK_ADAPTER_IMPORT);
    const store = mod.default();

    expect(typeof store.putObject).toBe('function');
    await store.putObject({ Bucket: 'b', Key: 'k', Body: 'x' });
    expect(store.putObject).toHaveBeenCalledTimes(1);
  });

  runContract({
    name: 'vanilla',
    create: async () => {
      jest.resetModules();
      await jest.unstable_mockModule(PATHS_IMPORT, () => ({
        default: {
          data: tmpDataDir,
        },
      }));
      const mod = await import(VANILLA_ADAPTER_IMPORT);
      return mod.default({ path: tmpDataDir });
    },
  });

  runContract({
    name: 'aws-s3',
    create: async () => {
      jest.resetModules();
      await jest.unstable_mockModule('@aws-sdk/credential-providers', () => ({
        fromNodeProviderChain: () => ({
          accessKeyId: 'x',
          secretAccessKey: 'y',
        }),
      }));
      await jest.unstable_mockModule('@aws-sdk/client-s3', () =>
        createFakeS3Module(),
      );
      const mod = await import(S3_ADAPTER_IMPORT);
      return mod.default({ region: 'us-east-1' });
    },
  });

  runContract({
    name: 'cloudflare-r2',
    create: async () => {
      jest.resetModules();
      await jest.unstable_mockModule('@aws-sdk/credential-providers', () => ({
        fromNodeProviderChain: () => ({
          accessKeyId: 'x',
          secretAccessKey: 'y',
        }),
      }));
      await jest.unstable_mockModule('@aws-sdk/client-s3', () =>
        createFakeS3Module(),
      );
      const mod = await import(R2_ADAPTER_IMPORT);
      const store = mod.default({
        accountId: 'test-account',
        credentials: { accessKeyId: 'x', secretAccessKey: 'y' },
      });

      // adapter-specific sanity check: endpoint should be r2
      expect(store.client_config.endpoint).toContain(
        '.r2.cloudflarestorage.com',
      );

      return store;
    },
  });

  runContract({
    name: 'backblaze-b2',
    create: async () => {
      jest.resetModules();
      await jest.unstable_mockModule('@aws-sdk/credential-providers', () => ({
        fromNodeProviderChain: () => ({
          accessKeyId: 'x',
          secretAccessKey: 'y',
        }),
      }));
      await jest.unstable_mockModule('@aws-sdk/client-s3', () =>
        createFakeS3Module(),
      );
      const mod = await import(B2_ADAPTER_IMPORT);
      const store = mod.default({
        region: 'us-west-004',
        credentials: { accessKeyId: 'x', secretAccessKey: 'y' },
      });

      // adapter-specific sanity check: endpoint should be backblaze
      expect(store.client_config.endpoint).toContain('backblazeb2.com');

      return store;
    },
  });
});
