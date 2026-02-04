/**
 * S3-like object storage interface used by the pluggable object-storage adapters.
 *
 * This mirrors the public interface of `lambdas/lib/s3.js` (optionally plus any
 * adapter-specific helper methods that do not affect compatibility).
 *
 * Notes:
 * - The interface is intentionally S3-shaped because multiple providers (AWS S3,
 *   Cloudflare R2, Backblaze B2) expose S3-compatible APIs.
 * - Adapters should implement the same behavior as `lambdas/lib/s3.js` for the
 *   methods below. Parameter support only needs to cover what is used in this
 *   repository (or what is straightforward/obvious).
 */

/**
 * @typedef {import("@aws-sdk/client-s3").PutObjectCommandInput} PutObjectCommandInput
 * @typedef {import("@aws-sdk/client-s3").PutObjectCommandOutput} PutObjectCommandOutput
 * @typedef {import("@aws-sdk/client-s3").GetObjectCommandInput} GetObjectCommandInput
 * @typedef {import("@aws-sdk/client-s3").HeadObjectCommandInput} HeadObjectCommandInput
 * @typedef {import("@aws-sdk/client-s3").HeadObjectCommandOutput} HeadObjectCommandOutput
 * @typedef {import("@aws-sdk/client-s3").CreateBucketCommandInput} CreateBucketCommandInput
 * @typedef {import("@aws-sdk/client-s3").CreateBucketCommandOutput} CreateBucketCommandOutput
 * @typedef {import("@aws-sdk/client-s3").DeleteBucketCommandInput} DeleteBucketCommandInput
 * @typedef {import("@aws-sdk/client-s3").DeleteBucketCommandOutput} DeleteBucketCommandOutput
 * @typedef {import("@aws-sdk/client-s3").ListBucketsCommandInput} ListBucketsCommandInput
 * @typedef {import("@aws-sdk/client-s3").ListBucketsCommandOutput} ListBucketsCommandOutput
 * @typedef {import("@aws-sdk/client-s3").DeleteObjectsCommandInput} DeleteObjectsCommandInput
 * @typedef {import("@aws-sdk/client-s3").CopyObjectCommandInput} CopyObjectCommandInput
 * @typedef {import("@aws-sdk/client-s3").ListObjectsV2CommandInput} ListObjectsV2CommandInput
 * @typedef {import("@aws-sdk/client-s3").CreateMultipartUploadCommandInput} CreateMultipartUploadCommandInput
 * @typedef {import("@aws-sdk/client-s3").CreateMultipartUploadCommandOutput} CreateMultipartUploadCommandOutput
 * @typedef {import("@aws-sdk/client-s3").CompleteMultipartUploadCommandInput} CompleteMultipartUploadCommandInput
 * @typedef {import("@aws-sdk/client-s3").CompleteMultipartUploadCommandOutput} CompleteMultipartUploadCommandOutput
 * @typedef {import("@aws-sdk/client-s3").UploadPartCopyCommandInput} UploadPartCopyCommandInput
 * @typedef {import("@aws-sdk/client-s3").UploadPartCopyCommandOutput} UploadPartCopyCommandOutput
 * @typedef {import("@aws-sdk/client-s3").UploadPartCommandInput} UploadPartCommandInput
 * @typedef {import("@aws-sdk/client-s3").UploadPartCommandOutput} UploadPartCommandOutput
 * @typedef {import("@aws-sdk/client-s3").PutBucketNotificationConfigurationCommandInput} PutBucketNotificationConfigurationCommandInput
 * @typedef {import("@aws-sdk/client-s3").PutBucketNotificationConfigurationCommandOutput} PutBucketNotificationConfigurationCommandOutput
 * @typedef {import("@aws-sdk/client-s3").GetBucketNotificationConfigurationCommandInput} GetBucketNotificationConfigurationCommandInput
 * @typedef {import("@aws-sdk/client-s3").GetBucketNotificationConfigurationCommandOutput} GetBucketNotificationConfigurationCommandOutput
 * @typedef {import("@aws-sdk/client-s3").PutBucketLifecycleConfigurationCommandInput} PutBucketLifecycleConfigurationCommandInput
 * @typedef {import("@aws-sdk/client-s3").PutBucketLifecycleConfigurationCommandOutput} PutBucketLifecycleConfigurationCommandOutput
 * @typedef {import("@aws-sdk/client-s3").GetBucketLifecycleConfigurationCommandInput} GetBucketLifecycleConfigurationCommandInput
 * @typedef {import("@aws-sdk/client-s3").GetBucketLifecycleConfigurationCommandOutput} GetBucketLifecycleConfigurationCommandOutput
 * @typedef {import("@aws-sdk/client-s3").HeadBucketCommandInput} HeadBucketCommandInput
 * @typedef {import("@aws-sdk/client-s3").GetBucketLocationCommandInput} GetBucketLocationCommandInput
 * @typedef {import("@aws-sdk/client-s3").GetBucketLocationCommandOutput} GetBucketLocationCommandOutput
 * @typedef {import("@aws-sdk/client-s3").PutBucketTaggingCommandInput} PutBucketTaggingCommandInput
 * @typedef {import("@aws-sdk/client-s3").PutBucketTaggingCommandOutput} PutBucketTaggingCommandOutput
 * @typedef {import("@aws-sdk/client-s3").GetBucketTaggingCommandInput} GetBucketTaggingCommandInput
 * @typedef {import("@aws-sdk/client-s3").GetBucketTaggingCommandOutput} GetBucketTaggingCommandOutput
 * @typedef {import("@aws-sdk/client-s3").DeleteBucketTaggingCommandInput} DeleteBucketTaggingCommandInput
 * @typedef {import("@aws-sdk/client-s3").DeleteBucketTaggingCommandOutput} DeleteBucketTaggingCommandOutput
 */

/**
 * @typedef {import("../typedefs.js").S3Location} S3Location
 * @typedef {import("../typedefs.js").Partition} Partition
 */

/**
 * @typedef {Object} ObjectStorageClient
 * @property {(params: PutObjectCommandInput) => Promise<PutObjectCommandOutput>} putObject
 * @property {(params: GetObjectCommandInput) => Promise<string>} getObject
 * @property {(params: HeadObjectCommandInput) => Promise<HeadObjectCommandOutput>} headObject
 * @property {(params: CreateBucketCommandInput) => Promise<CreateBucketCommandOutput>} createBucket
 * @property {(params: DeleteBucketCommandInput) => Promise<DeleteBucketCommandOutput>} deleteBucket
 * @property {(params: ListBucketsCommandInput) => Promise<ListBucketsCommandOutput>} listBuckets
 * @property {(params: DeleteObjectsCommandInput) => Promise<void>} deleteObjects
 * @property {(uri: string) => S3Location} parseS3Uri
 * @property {(params: CopyObjectCommandInput) => Promise<void>} multiPartCopyObject
 * @property {(params: CopyObjectCommandInput) => Promise<void>} copyObjectWithMultiPartFallback
 * @property {(params: CopyObjectCommandInput[]) => Promise<void>} copyObjectsWithMultiPartFallback
 * @property {(SourceParams: ListObjectsV2CommandInput, DestinationBucket: string, DestinationPrefix: string) => Promise<void>} copyPath
 * @property {(params: ListObjectsV2CommandInput) => Promise<void>} deletePath
 * @property {(params: ListObjectsV2CommandInput, expirationDate?: Date) => Promise<void>} expireObjects
 * @property {(params: ListObjectsV2CommandInput) => Promise<string[]>} getCommonPrefixes
 * @property {(Bucket: string, Prefix: string, partitionKeys: any[]) => Promise<Partition[]>} findPartitions
 * @property {(params: CreateMultipartUploadCommandInput) => Promise<CreateMultipartUploadCommandOutput>} createMultipartUpload
 * @property {(params: CompleteMultipartUploadCommandInput) => Promise<CompleteMultipartUploadCommandOutput>} completeMultipartUpload
 * @property {(params: UploadPartCopyCommandInput) => Promise<UploadPartCopyCommandOutput>} uploadPartCopy
 * @property {(params: UploadPartCommandInput) => Promise<UploadPartCommandOutput>} uploadPart
 * @property {(params: HeadObjectCommandInput, data: any) => Promise<void>} createAppendableOrAppendToObject
 * @property {(params: PutBucketNotificationConfigurationCommandInput) => Promise<PutBucketNotificationConfigurationCommandOutput>} putBucketNotificationConfiguration
 * @property {(params: GetBucketNotificationConfigurationCommandInput) => Promise<GetBucketNotificationConfigurationCommandOutput>} getBucketNotificationConfiguration
 * @property {(params: PutBucketLifecycleConfigurationCommandInput) => Promise<PutBucketLifecycleConfigurationCommandOutput>} putBucketLifecycleConfigutation
 * @property {(params: GetBucketLifecycleConfigurationCommandInput) => Promise<GetBucketLifecycleConfigurationCommandOutput>} getBucketLifecycleConfigutation
 * @property {(bucketName: string, expectedOwnerId: string) => Promise<boolean>} checkBucketOwnership
 * @property {(params: GetBucketLocationCommandInput, region?: string) => Promise<GetBucketLocationCommandOutput>} getBucketLocation
 * @property {(params: GetBucketLocationCommandInput) => Promise<string>} findBucketRegion
 * @property {(params: ListObjectsV2CommandInput, region?: string, byteSize?: number) => Promise<number>} getPrefixByteSize
 * @property {(params: PutBucketTaggingCommandInput) => Promise<PutBucketTaggingCommandOutput>} putBucketTagging
 * @property {(params: GetBucketTaggingCommandInput) => Promise<GetBucketTaggingCommandOutput>} getBucketTagging
 * @property {(params: DeleteBucketTaggingCommandInput) => Promise<DeleteBucketTaggingCommandOutput>} deleteBucketTagging
 */

/**
 * @param {PutObjectCommandInput} _params -
 * @returns {Promise<PutObjectCommandOutput>} -
 */
async function putObject(_params) {
  return /** @type {any} */ ({});
}

/**
 * @param {GetObjectCommandInput} _params -
 * @returns {Promise<string>} -
 */
async function getObject(_params) {
  return '';
}

/**
 * @param {HeadObjectCommandInput} _params -
 * @returns {Promise<HeadObjectCommandOutput>} -
 */
async function headObject(_params) {
  return /** @type {any} */ ({});
}

/**
 * @param {CreateBucketCommandInput} _params -
 * @returns {Promise<CreateBucketCommandOutput>} -
 */
async function createBucket(_params) {
  return /** @type {any} */ ({});
}

/**
 * @param {DeleteBucketCommandInput} _params -
 * @returns {Promise<DeleteBucketCommandOutput>} -
 */
async function deleteBucket(_params) {
  return /** @type {any} */ ({});
}

/**
 * @param {ListBucketsCommandInput} _params -
 * @returns {Promise<ListBucketsCommandOutput>} -
 */
async function listBuckets(_params) {
  return /** @type {any} */ ({ Buckets: [] });
}

/**
 * @param {DeleteObjectsCommandInput} _params -
 * @returns {Promise<void>} -
 */
async function deleteObjects(_params) {}

/**
 * @param {string} uri -
 * @returns {S3Location} -
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
 * @param {CopyObjectCommandInput} _params -
 * @returns {Promise<void>} -
 */
async function multiPartCopyObject(_params) {}

/**
 * @param {CopyObjectCommandInput} _params -
 * @returns {Promise<void>} -
 */
async function copyObjectWithMultiPartFallback(_params) {}

/**
 * @param {CopyObjectCommandInput[]} _params -
 * @returns {Promise<void>} -
 */
async function copyObjectsWithMultiPartFallback(_params) {}

/**
 * @param {ListObjectsV2CommandInput} _SourceParams -
 * @param {string} _DestinationBucket -
 * @param {string} _DestinationPrefix -
 * @returns {Promise<void>} -
 */
async function copyPath(
  _SourceParams,
  _DestinationBucket,
  _DestinationPrefix,
) {}

/**
 * @param {ListObjectsV2CommandInput} _params -
 * @returns {Promise<void>} -
 */
async function deletePath(_params) {}

/**
 * @param {ListObjectsV2CommandInput} _params -
 * @param {Date} [_expirationDate] -
 * @returns {Promise<void>} -
 */
async function expireObjects(_params, _expirationDate = new Date()) {}

/**
 * @param {ListObjectsV2CommandInput} _params -
 * @returns {Promise<string[]>} -
 */
async function getCommonPrefixes(_params) {
  return [];
}

/**
 * @param {string} _Bucket -
 * @param {string} _Prefix -
 * @param {any[]} _partitionKeys -
 * @returns {Promise<Partition[]>} -
 */
async function findPartitions(_Bucket, _Prefix, _partitionKeys) {
  return [];
}

/**
 * @param {CreateMultipartUploadCommandInput} _params -
 * @returns {Promise<CreateMultipartUploadCommandOutput>} -
 */
async function createMultipartUpload(_params) {
  return /** @type {any} */ ({ UploadId: '' });
}

/**
 * @param {CompleteMultipartUploadCommandInput} _params -
 * @returns {Promise<CompleteMultipartUploadCommandOutput>} -
 */
async function completeMultipartUpload(_params) {
  return /** @type {any} */ ({});
}

/**
 * @param {UploadPartCopyCommandInput} _params -
 * @returns {Promise<UploadPartCopyCommandOutput>} -
 */
async function uploadPartCopy(_params) {
  return /** @type {any} */ ({ CopyPartResult: { ETag: '' } });
}

/**
 * @param {UploadPartCommandInput} _params -
 * @returns {Promise<UploadPartCommandOutput>} -
 */
async function uploadPart(_params) {
  return /** @type {any} */ ({ ETag: '' });
}

/**
 * @param {HeadObjectCommandInput} _params -
 * @param {any} _data -
 * @returns {Promise<void>} -
 */
async function createAppendableOrAppendToObject(_params, _data) {}

/**
 * @param {PutBucketNotificationConfigurationCommandInput} _params -
 * @returns {Promise<PutBucketNotificationConfigurationCommandOutput>} -
 */
async function putBucketNotificationConfiguration(_params) {
  return /** @type {any} */ ({});
}

/**
 * @param {GetBucketNotificationConfigurationCommandInput} _params -
 * @returns {Promise<GetBucketNotificationConfigurationCommandOutput>} -
 */
async function getBucketNotificationConfiguration(_params) {
  return /** @type {any} */ ({ QueueConfigurations: [] });
}

/**
 * NOTE: intentionally matches the misspelling in `lambdas/lib/s3.js`:
 * `putBucketLifecycleConfigutation` (not Configuration).
 * @param {PutBucketLifecycleConfigurationCommandInput} _params -
 * @returns {Promise<PutBucketLifecycleConfigurationCommandOutput>} -
 */
async function putBucketLifecycleConfigutation(_params) {
  return /** @type {any} */ ({});
}

/**
 * NOTE: intentionally matches the misspelling in `lambdas/lib/s3.js`:
 * `getBucketLifecycleConfigutation` (not Configuration).
 * @param {GetBucketLifecycleConfigurationCommandInput} _params -
 * @returns {Promise<GetBucketLifecycleConfigurationCommandOutput>} -
 */
async function getBucketLifecycleConfigutation(_params) {
  return /** @type {any} */ ({ Rules: [] });
}

/**
 * @param {string} _bucketName -
 * @param {string} _expectedOwnerId -
 * @returns {Promise<boolean>} -
 */
async function checkBucketOwnership(_bucketName, _expectedOwnerId) {
  return true;
}

/**
 * @param {GetBucketLocationCommandInput} _params -
 * @param {string} [_region] -
 * @returns {Promise<GetBucketLocationCommandOutput>} -
 */
async function getBucketLocation(_params, _region) {
  return /** @type {any} */ ({ LocationConstraint: 'us-east-1' });
}

/**
 * @param {GetBucketLocationCommandInput} _params -
 * @returns {Promise<string>} -
 */
async function findBucketRegion(_params) {
  return 'us-east-1';
}

/**
 * @param {ListObjectsV2CommandInput} _params -
 * @param {string} [_region] -
 * @param {number} [_byteSize] -
 * @returns {Promise<number>} -
 */
async function getPrefixByteSize(_params, _region, _byteSize = 0) {
  return 0;
}

/**
 * @param {PutBucketTaggingCommandInput} _params -
 * @returns {Promise<PutBucketTaggingCommandOutput>} -
 */
async function putBucketTagging(_params) {
  return /** @type {any} */ ({});
}

/**
 * @param {GetBucketTaggingCommandInput} _params -
 * @returns {Promise<GetBucketTaggingCommandOutput>} -
 */
async function getBucketTagging(_params) {
  return /** @type {any} */ ({ TagSet: [] });
}

/**
 * @param {DeleteBucketTaggingCommandInput} _params -
 * @returns {Promise<DeleteBucketTaggingCommandOutput>} -
 */
async function deleteBucketTagging(_params) {
  return /** @type {any} */ ({});
}

/**
 * Factory function that creates an object-storage client exposing the base methods.
 * Adapters should return an implementation of {@link ObjectStorageClient}.
 * @returns {ObjectStorageClient} -
 */
export default function createObjectStorage() {
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
  };
}
