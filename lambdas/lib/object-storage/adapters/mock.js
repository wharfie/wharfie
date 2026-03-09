// eslint-disable-next-line n/no-unpublished-import
import { jest } from '@jest/globals';

/**
 * Mock object-storage adapter.
 *
 * Intended for unit tests that only need spies and do not require real S3-like
 * semantics. For a local, semantics-correct implementation use the vanilla
 * adapter.
 * @returns {import('../base.js').ObjectStorageClient & { close?: () => Promise<void> }} -
 */
export default function createMockObjectStorage() {
  return {
    putObject: jest.fn(async (/** @type {any} */ _params) => {
      return /** @type {any} */ ({});
    }),
    getObject: jest.fn(async (/** @type {any} */ _params) => {
      return '';
    }),
    headObject: jest.fn(async (/** @type {any} */ _params) => {
      return /** @type {any} */ ({ ContentLength: 0 });
    }),
    createBucket: jest.fn(async (/** @type {any} */ _params) => {
      return /** @type {any} */ ({});
    }),
    deleteBucket: jest.fn(async (/** @type {any} */ _params) => {
      return /** @type {any} */ ({});
    }),
    listBuckets: jest.fn(async (/** @type {any} */ _params) => {
      return /** @type {any} */ ({ Buckets: [] });
    }),
    deleteObjects: jest.fn(async (/** @type {any} */ _params) => {
      // no-op
    }),
    parseS3Uri: jest.fn((/** @type {string} */ uri) => {
      if (typeof uri !== 'string') throw new TypeError('uri is not a string');
      const match = uri.match(/^s3:\/\/([^/]+)\/(.+?)*(\/*)$/);
      if (!match)
        throw new Error(
          uri + ' is not of form s3://bucket/key or s3://bucket/',
        );
      const parts = uri.split('//')[1].split('/');
      return {
        uri,
        arn: `arn:aws:s3:::${parts[0]}/${parts.slice(1).join('/')}`,
        bucket: parts[0],
        prefix: parts.slice(1).join('/'),
      };
    }),
    multiPartCopyObject: jest.fn(async (/** @type {any} */ _params) => {
      // no-op
    }),
    copyObjectWithMultiPartFallback: jest.fn(
      async (/** @type {any} */ _params) => {
        // no-op
      },
    ),
    copyObjectsWithMultiPartFallback: jest.fn(
      async (/** @type {any} */ _params) => {
        // no-op
      },
    ),
    copyPath: jest.fn(
      async (
        /** @type {any} */ _SourceParams,
        /** @type {any} */ _DestinationBucket,
        /** @type {any} */ _DestinationPrefix,
      ) => {
        // no-op
      },
    ),
    deletePath: jest.fn(async (/** @type {any} */ _params) => {
      // no-op
    }),
    expireObjects: jest.fn(
      async (
        /** @type {any} */ _params,
        /** @type {any} */ _expirationDate,
      ) => {
        // no-op
      },
    ),
    getCommonPrefixes: jest.fn(async (/** @type {any} */ _params) => {
      return [];
    }),
    findPartitions: jest.fn(
      async (
        /** @type {any} */ _Bucket,
        /** @type {any} */ _Prefix,
        /** @type {any} */ _partitionKeys,
      ) => {
        return [];
      },
    ),
    createMultipartUpload: jest.fn(async (/** @type {any} */ _params) => {
      return /** @type {any} */ ({ UploadId: 'mock-upload' });
    }),
    completeMultipartUpload: jest.fn(async (/** @type {any} */ _params) => {
      return /** @type {any} */ ({});
    }),
    uploadPartCopy: jest.fn(async (/** @type {any} */ _params) => {
      return /** @type {any} */ ({ CopyPartResult: { ETag: 'etag' } });
    }),
    uploadPart: jest.fn(async (/** @type {any} */ _params) => {
      return /** @type {any} */ ({ ETag: 'etag' });
    }),
    createAppendableOrAppendToObject: jest.fn(
      async (/** @type {any} */ _params, /** @type {any} */ _data) => {
        // no-op
      },
    ),
    putBucketNotificationConfiguration: jest.fn(
      async (/** @type {any} */ _params) => {
        return /** @type {any} */ ({});
      },
    ),
    getBucketNotificationConfiguration: jest.fn(
      async (/** @type {any} */ _params) => {
        return /** @type {any} */ ({ QueueConfigurations: [] });
      },
    ),
    putBucketLifecycleConfigutation: jest.fn(
      async (/** @type {any} */ _params) => {
        return /** @type {any} */ ({});
      },
    ),
    getBucketLifecycleConfigutation: jest.fn(
      async (/** @type {any} */ _params) => {
        return /** @type {any} */ ({ Rules: [] });
      },
    ),
    checkBucketOwnership: jest.fn(
      async (
        /** @type {any} */ _bucketName,
        /** @type {any} */ _expectedOwnerId,
      ) => {
        return true;
      },
    ),
    getBucketLocation: jest.fn(
      async (/** @type {any} */ _params, /** @type {any} */ _region) => {
        return /** @type {any} */ ({ LocationConstraint: 'us-east-1' });
      },
    ),
    findBucketRegion: jest.fn(async (/** @type {any} */ _params) => {
      return 'us-east-1';
    }),
    getPrefixByteSize: jest.fn(
      async (
        /** @type {any} */ _params,
        /** @type {any} */ _region,
        /** @type {number} */ _byteSize = 0,
      ) => {
        return 0;
      },
    ),
    putBucketTagging: jest.fn(async (/** @type {any} */ _params) => {
      return /** @type {any} */ ({});
    }),
    getBucketTagging: jest.fn(async (/** @type {any} */ _params) => {
      return /** @type {any} */ ({ TagSet: [] });
    }),
    deleteBucketTagging: jest.fn(async (/** @type {any} */ _params) => {
      return /** @type {any} */ ({});
    }),
    close: jest.fn(async () => {
      // no-op
    }),
  };
}
