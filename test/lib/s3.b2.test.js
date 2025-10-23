/* eslint-disable jest/no-hooks */
'use strict';

const crypto = require('crypto');
const path = require('path');

// IMPORTANT: import the SDK module *before* your wrapper so we can restore mocks if needed
const AWS = require('@aws-sdk/client-s3');

// If the repo globally loads "aws-sdk-client-mock-jest", its monkey-patch will be active here.
// Try to restore the real client if present.
if (AWS.S3Mock && typeof AWS.S3Mock.restore === 'function') {
  // eslint-disable-next-line no-console
  console.warn(
    '[B2 live] Detected aws-sdk-client-mock-jest; restoring real S3Client...'
  );
  AWS.S3Mock.restore(); // unpatches S3Client.prototype.send
}

// Now load your wrapper (it will see the real client)
const S3 = require('../../lambdas/lib/s3');

// ---- Backblaze credentials ---------------------------------------------------

const B2_KEY_ID = process.env.B2_KEY_ID;
const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY;
const B2_REGION = process.env.B2_REGION || 'us-east-005';

if (!B2_KEY_ID || !B2_APPLICATION_KEY) {
  throw new Error(
    'Set B2_KEY_ID and B2_APPLICATION_KEY to run Backblaze live tests.'
  );
}

jest.setTimeout(120_000);

function rand(n = 6) {
  return crypto.randomBytes(n).toString('hex');
}

function makeClient() {
  return new S3({
    provider: 'b2',
    providerOptions: {
      region: B2_REGION,
      credentials: {
        accessKeyId: B2_KEY_ID,
        secretAccessKey: B2_APPLICATION_KEY,
      },
    },
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** List all object keys under a prefix (handles pagination). */
async function listAllKeys(s3, Bucket, Prefix) {
  const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
  let keys = [];
  let ContinuationToken;
  do {
    const page = await s3.s3.send(
      new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken })
    );
    const contents = (page && page.Contents) || [];
    for (const o of contents) if (o && o.Key) keys.push(o.Key);
    ContinuationToken = page && page.NextContinuationToken;
  } while (ContinuationToken);
  return keys;
}

/** Purge *everything*, including all versions and delete markers (B2 is versioned by default). */
async function purgeBucket(s3, Bucket) {
  const {
    ListObjectsV2Command,
    ListObjectVersionsCommand,
    DeleteObjectsCommand,
  } = require('@aws-sdk/client-s3');

  // 1) Delete current keys (if any)
  let cont;
  do {
    const page = await s3.s3.send(
      new ListObjectsV2Command({ Bucket, ContinuationToken: cont })
    );
    const Objects = ((page && page.Contents) || [])
      .filter((o) => o.Key)
      .map((o) => ({ Key: o.Key }));
    if (Objects.length) {
      await s3.s3.send(
        new DeleteObjectsCommand({ Bucket, Delete: { Objects } })
      );
    }
    cont = page && page.NextContinuationToken;
  } while (cont);

  // 2) Delete all versions + delete markers (required to truly empty a versioned bucket)
  let keyMarker;
  let versionIdMarker;
  do {
    const page = await s3.s3.send(
      new ListObjectVersionsCommand({
        Bucket,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      })
    );

    const versionObjs =
      ((page && page.Versions) || [])
        .filter((v) => v.Key && v.VersionId)
        .map((v) => ({ Key: v.Key, VersionId: v.VersionId })) || [];

    const markerObjs =
      ((page && page.DeleteMarkers) || [])
        .filter((m) => m.Key && m.VersionId)
        .map((m) => ({ Key: m.Key, VersionId: m.VersionId })) || [];

    const Objects = [...versionObjs, ...markerObjs];

    if (Objects.length) {
      await s3.s3.send(
        new DeleteObjectsCommand({ Bucket, Delete: { Objects } })
      );
    }

    keyMarker = page && page.NextKeyMarker;
    versionIdMarker = page && page.NextVersionIdMarker;
  } while (keyMarker || versionIdMarker);
}

/** Create bucket if absent; ignore 409. */
async function ensureBucket(s3, Bucket) {
  try {
    await s3.createBucket({ Bucket });
    await sleep(750);
  } catch (err) {
    if (err?.$metadata?.httpStatusCode !== 409) throw err;
  }
}

/** Delete bucket (must be empty). */
async function dropBucket(s3, Bucket) {
  await purgeBucket(s3, Bucket);
  await s3.deleteBucket({ Bucket });
}

describe('S3 wrapper – Backblaze B2 live tests (no mocks)', () => {
  const s3 = makeClient();
  const BUCKET = `it-${Date.now()}-${rand(3)}`;
  const BASE_PREFIX = `it-${rand(3)}/`;

  beforeAll(async () => {
    await ensureBucket(s3, BUCKET);
  });

  afterEach(async () => {
    // Best-effort: clear test scope, then global purge (handles B2 versions)
    await s3.deletePath({ Bucket: BUCKET, Prefix: BASE_PREFIX });
    await purgeBucket(s3, BUCKET);
  });

  afterAll(async () => {
    await dropBucket(s3, BUCKET);
    if (AWS.S3Mock && typeof AWS.S3Mock.restore === 'function') {
      AWS.S3Mock.restore();
    }
  });

  it('putObject → getObject → headObject', async () => {
    expect.assertions(3);

    const Key = `${BASE_PREFIX}key/path.json`;
    const Body = JSON.stringify({ ok: true, t: Date.now() });

    await s3.putObject({ Bucket: BUCKET, Key, Body });
    await sleep(100);

    const data = await s3.getObject({ Bucket: BUCKET, Key });
    expect(data).toBe(Body);

    const head = await s3.headObject({ Bucket: BUCKET, Key });
    expect(typeof head.ContentLength).toBe('number');
    expect(head.ContentLength).toBe(Buffer.byteLength(Body));
  });

  it('deleteObjects removes the specified keys', async () => {
    expect.assertions(2);

    const Key1 = `${BASE_PREFIX}delete/a.json`;
    const Key2 = `${BASE_PREFIX}delete/b.json`;

    await s3.putObject({ Bucket: BUCKET, Key: Key1, Body: '1' });
    await s3.putObject({ Bucket: BUCKET, Key: Key2, Body: '2' });

    await s3.deleteObjects({
      Bucket: BUCKET,
      Delete: { Objects: [{ Key: Key1 }, { Key: Key2 }], Quiet: false },
    });

    const keys = await listAllKeys(s3, BUCKET, `${BASE_PREFIX}delete/`);
    expect(keys).toEqual([]);
    expect(keys.length).toBe(0);
  });

  it('copyPath copies all objects from source prefix to destination prefix', async () => {
    expect.assertions(2);

    const srcPrefix = `${BASE_PREFIX}copy/src/`;
    const dstPrefix = `${BASE_PREFIX}copy/dst/`;

    await s3.putObject({
      Bucket: BUCKET,
      Key: `${srcPrefix}source_database/source_table/123.json`,
      Body: '123',
    });
    await s3.putObject({
      Bucket: BUCKET,
      Key: `${srcPrefix}source_database/source_table/456.json`,
      Body: '456',
    });

    await s3.copyPath({ Bucket: BUCKET, Prefix: srcPrefix }, BUCKET, dstPrefix);

    const dstKeys = await listAllKeys(s3, BUCKET, dstPrefix);
    // Your wrapper prefixes DestinationPrefix + full source key (no stripping)
    expect(dstKeys.sort()).toEqual(
      [
        `${dstPrefix}${srcPrefix}source_database/source_table/123.json`,
        `${dstPrefix}${srcPrefix}source_database/source_table/456.json`,
      ].sort()
    );

    const content = await s3.getObject({
      Bucket: BUCKET,
      Key: `${dstPrefix}${srcPrefix}source_database/source_table/123.json`,
    });
    expect(content).toBe('123');
  });

  it('parseS3Uri throws on non-string uri', () => {
    expect.assertions(1);
    const local = makeClient();
    expect(() => local.parseS3Uri(123)).toThrow('uri (123) is not a string');
  });

  it('parseS3Uri throws on unterminated bucket uri', () => {
    expect.assertions(1);
    const local = makeClient();
    expect(() => local.parseS3Uri('s3://example-bucket')).toThrow(
      's3://example-bucket is not of form s3://bucket/key or s3://bucket/'
    );
  });

  it('parseS3Uri works with bucket only', () => {
    expect.assertions(1);
    const local = makeClient();
    const result = local.parseS3Uri('s3://example-bucket/');
    expect(result).toStrictEqual({
      bucket: 'example-bucket',
      prefix: '',
      arn: 'arn:aws:s3:::example-bucket/',
    });
  });

  it('deletePath deletes all objects under prefix (paginated)', async () => {
    expect.assertions(2);

    const delPrefix = `${BASE_PREFIX}deletePath/test/prefix/`;
    const keys = [
      `${delPrefix}some_key/wharfie-temp-files/source_table/123.json`,
      `${delPrefix}wharfie-temp-files/source_table/456.json`,
      `${delPrefix}some_key/wharfie-temp-files/source_table/789.json`,
    ];
    await Promise.all(
      keys.map((Key) => s3.putObject({ Bucket: BUCKET, Key, Body: 'x' }))
    );

    await s3.deletePath({ Bucket: BUCKET, Prefix: delPrefix });

    const remaining = await listAllKeys(s3, BUCKET, delPrefix);
    expect(remaining).toEqual([]);
    expect(remaining.length).toBe(0);
  });

  it('getCommonPrefixes returns folder-like prefixes under a path', async () => {
    expect.assertions(2);

    const base = `${BASE_PREFIX}common/prefix/`;
    await s3.putObject({
      Bucket: BUCKET,
      Key: `${base}first_prefix/a.txt`,
      Body: 'a',
    });
    await s3.putObject({
      Bucket: BUCKET,
      Key: `${base}second_prefix/b.txt`,
      Body: 'b',
    });

    const result = await s3.getCommonPrefixes({ Bucket: BUCKET, Prefix: base });

    // Wrapper returns full prefixes incl. the provided Prefix
    expect(result.sort()).toEqual(
      [`${base}first_prefix/`, `${base}second_prefix/`].sort()
    );
    expect(Array.isArray(result)).toBe(true);
  });

  it('findPartitions walks month/day partitions and ignores processing_failed', async () => {
    expect.assertions(1);

    const base = `${BASE_PREFIX}partitions/test/prefix/`;
    await s3.putObject({
      Bucket: BUCKET,
      Key: `${base}02/day=01/file1`,
      Body: '1',
    });
    await s3.putObject({
      Bucket: BUCKET,
      Key: `${base}02/day=02/file2`,
      Body: '2',
    });
    await s3.putObject({
      Bucket: BUCKET,
      Key: `${base}02/day=03/file3`,
      Body: '3',
    });
    await s3.putObject({
      Bucket: BUCKET,
      Key: `${base}02/processing_failed/fileX`,
      Body: 'x',
    });

    const res = await s3.findPartitions(
      BUCKET,
      base,
      [{ name: 'month' }, { name: 'day' }],
      {},
      []
    );

    expect(res.sort((a, b) => a.location.localeCompare(b.location))).toEqual(
      [
        {
          location: `s3://${BUCKET}/${base}02/day=01/`,
          partitionValues: { month: '02', day: '01' },
        },
        {
          location: `s3://${BUCKET}/${base}02/day=02/`,
          partitionValues: { month: '02', day: '02' },
        },
        {
          location: `s3://${BUCKET}/${base}02/day=03/`,
          partitionValues: { month: '02', day: '03' },
        },
      ].sort((a, b) => a.location.localeCompare(b.location))
    );
  });
});
