/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VANILLA_OBJECT_STORAGE_IMPORT =
  '../../../lambdas/lib/object-storage/adapters/vanilla.js';
const S3_OBJECT_STORAGE_IMPORT =
  '../../../lambdas/lib/object-storage/adapters/s3.js';
const R2_OBJECT_STORAGE_IMPORT =
  '../../../lambdas/lib/object-storage/adapters/r2.js';
const B2_OBJECT_STORAGE_IMPORT =
  '../../../lambdas/lib/object-storage/adapters/b2.js';
const AWS_S3_IMPORT = '../../../lambdas/lib/aws/s3.js';

/**
 * @returns {string} - Result.
 */
function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'wharfie-object-storage-contract-'));
}

/**
 * @param {string} tmpDir - tmpDir.
 * @returns {Promise<import('../../../lambdas/lib/object-storage/base.js').ObjectStorageClient & { close?: () => Promise<void> }>} - Result.
 */
async function createVanillaObjectStorage(tmpDir) {
  jest.resetModules();
  const mod = await import(VANILLA_OBJECT_STORAGE_IMPORT);
  return mod.default({ path: tmpDir, region: 'us-west-2' });
}

describe('vanilla object storage adapter contract', () => {
  /** @type {string} */
  let tmpDir = '';
  /** @type {(import('../../../lambdas/lib/object-storage/base.js').ObjectStorageClient & { close?: () => Promise<void> }) | undefined} */
  let storage;

  afterEach(async () => {
    if (storage && typeof storage.close === 'function') {
      await storage.close();
      storage = undefined;
    }

    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = '';
    }
  });

  it('supports createBucket/listBuckets/putObject/getObject/headObject/deleteObjects', async () => {
    tmpDir = makeTmpDir();
    storage = await createVanillaObjectStorage(tmpDir);

    await storage.createBucket({
      Bucket: 'alpha',
      CreateBucketConfiguration: { LocationConstraint: 'us-west-2' },
    });
    await storage.createBucket({
      Bucket: 'bravo',
      CreateBucketConfiguration: { LocationConstraint: 'us-east-2' },
    });

    const buckets = await storage.listBuckets({});

    expect((buckets.Buckets || []).map((bucket) => bucket.Name)).toEqual([
      'alpha',
      'bravo',
    ]);

    await storage.putObject({
      Bucket: 'alpha',
      Key: 'folder/hello.txt',
      Body: 'hello world',
    });
    await storage.putObject({
      Bucket: 'alpha',
      Key: 'folder/other.txt',
      Body: 'goodbye',
    });

    const head = await storage.headObject({
      Bucket: 'alpha',
      Key: 'folder/hello.txt',
    });

    expect(head.ContentLength).toBe(Buffer.byteLength('hello world'));

    const body = await storage.getObject({
      Bucket: 'alpha',
      Key: 'folder/hello.txt',
    });

    expect(body).toBe('hello world');

    const parsed = storage.parseS3Uri('s3://alpha/folder/hello.txt');

    expect(parsed).toEqual({
      uri: 's3://alpha/folder/hello.txt',
      arn: 'arn:aws:s3:::alpha/folder/hello.txt',
      bucket: 'alpha',
      prefix: 'folder/hello.txt',
    });

    await storage.deleteObjects({
      Bucket: 'alpha',
      Delete: {
        Objects: [{ Key: 'folder/hello.txt' }],
      },
    });

    await expect(
      storage.getObject({
        Bucket: 'alpha',
        Key: 'folder/hello.txt',
      }),
    ).rejects.toThrow(/NoSuchKey/i);

    await expect(
      storage.getObject({
        Bucket: 'alpha',
        Key: 'folder/other.txt',
      }),
    ).resolves.toBe('goodbye');
  });
});

describe('cloud object storage adapter wiring', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('s3 adapter forwards provider and region config without network access', async () => {
    jest.resetModules();
    jest.unstable_mockModule(AWS_S3_IMPORT, () => ({
      default: class FakeS3 {
        /**
         * @param {Record<string, any>} options - options.
         */
        constructor(options) {
          this.options = options;
        }

        /**
         * @returns {Promise<void>} - Result.
         */
        async close() {}
      },
    }));

    const mod = await import(S3_OBJECT_STORAGE_IMPORT);
    const store = mod.default({ region: 'us-east-1' });

    expect(store.options).toMatchObject({
      provider: 'aws',
      region: 'us-east-1',
    });

    await store.close();
  });

  it('r2 adapter forwards provider-specific config without network access', async () => {
    jest.resetModules();
    jest.unstable_mockModule(AWS_S3_IMPORT, () => ({
      default: class FakeS3 {
        /**
         * @param {Record<string, any>} options - options.
         */
        constructor(options) {
          this.options = options;
        }

        /**
         * @returns {Promise<void>} - Result.
         */
        async close() {}
      },
    }));

    const mod = await import(R2_OBJECT_STORAGE_IMPORT);
    const store = mod.default({
      accountId: 'acct-123',
      region: 'auto',
      credentials: {
        accessKeyId: 'key',
        secretAccessKey: 'secret',
      },
    });

    expect(store.options).toMatchObject({
      provider: 'r2',
      providerOptions: {
        accountId: 'acct-123',
        region: 'auto',
        credentials: {
          accessKeyId: 'key',
          secretAccessKey: 'secret',
        },
      },
    });

    await store.close();
  });

  it('b2 adapter forwards provider-specific config without network access', async () => {
    jest.resetModules();
    jest.unstable_mockModule(AWS_S3_IMPORT, () => ({
      default: class FakeS3 {
        /**
         * @param {Record<string, any>} options - options.
         */
        constructor(options) {
          this.options = options;
        }

        /**
         * @returns {Promise<void>} - Result.
         */
        async close() {}
      },
    }));

    const mod = await import(B2_OBJECT_STORAGE_IMPORT);
    const store = mod.default({
      region: 'us-west-004',
      endpoint: 'https://s3.us-west-004.backblazeb2.com',
      credentials: {
        accessKeyId: 'key',
        secretAccessKey: 'secret',
      },
    });

    expect(store.options).toMatchObject({
      provider: 'b2',
      providerOptions: {
        region: 'us-west-004',
        endpoint: 'https://s3.us-west-004.backblazeb2.com',
        credentials: {
          accessKeyId: 'key',
          secretAccessKey: 'secret',
        },
      },
    });

    await store.close();
  });
});
