'use strict';
const AWS = require('@aws-sdk/client-s3');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');
const BaseAWS = require('./base');
const bluebirdPromise = require('bluebird');
const { Readable } = require('stream');

const AWS_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ap-south-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ca-central-1',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'sa-east-1',
];

class S3 {
  /**
   * @param {import("@aws-sdk/client-s3").S3ClientConfig} [options] - S3 client configuration
   */
  constructor(options = {}) {
    const credentials = fromNodeProviderChain();
    this.client_config = {
      ...BaseAWS.config(),
      credentials,
      ...options,
      useArnRegion: true,
    };
    this.s3 = new AWS.S3(this.client_config);
    this.COPY_PART_SIZE_BYTES = 500000000; // ~500 MB
    this.COPY_PART_SIZE_MINIMUM_BYTES = 5242880; // 5 MB
    this._LEFT_PAD_OBJECT_NAME = '5MB_file.txt';
    this._LEFT_PAD_SIZE = 5 * 1024 * 1024;
    this._left_pad_object_checked = false;

    this.region_clients = {
      [this.s3?.config?.region.toString()]: this.s3,
    };
  }

  /**
   * @param {string} region - params for PutObject request
   * @returns {import("@aws-sdk/client-s3").S3} -
   */
  _getRegionClient(region) {
    if (!this.region_clients[region]) {
      this.region_clients[region] = new AWS.S3({
        ...this.client_config,
        region,
      });
    }
    return this.region_clients[region];
  }

  /**
   * @param {import("@aws-sdk/client-s3").PutObjectRequest} params - params for PutObject request
   * @returns {Promise<import("@aws-sdk/client-s3").PutObjectOutput>} -
   */
  async putObject(params) {
    const command = new AWS.PutObjectCommand(params);
    return await this.s3.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-s3").GetObjectRequest} params - params for GetObject request
   * @returns {Promise<string>} -
   */
  async getObject(params) {
    const command = new AWS.GetObjectCommand(params);
    const result = await this.s3.send(command);

    // TODO this increases memory usage by emptying streams but makes it easier to work with
    if (!result.Body) {
      throw new Error('No body returned from getObject');
    }

    if (result.Body.transformToString) {
      return result.Body.transformToString();
    } else {
      // workaround for mocks
      // @ts-ignore
      return result.Body;
    }
  }

  /**
   * @param {import("@aws-sdk/client-s3").HeadObjectCommandInput} params - params for HeadObject request
   * @returns {Promise<import("@aws-sdk/client-s3").HeadObjectOutput>} -
   */
  async headObject(params) {
    const command = new AWS.HeadObjectCommand(params);
    return await this.s3.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-s3").CreateBucketCommandInput} params - params for createBucket request
   * @returns {Promise<import("@aws-sdk/client-s3").CreateBucketCommandOutput>} -
   */
  async createBucket(params) {
    const command = new AWS.CreateBucketCommand(params);
    return await this.s3.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-s3").DeleteBucketCommandInput} params - params for deleteBucket request
   * @returns {Promise<import("@aws-sdk/client-s3").DeleteBucketCommandOutput>} -
   */
  async deleteBucket(params) {
    const command = new AWS.DeleteBucketCommand(params);
    return await this.s3.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-s3").ListBucketsCommandInput} params - params for listBuckets request
   * @returns {Promise<import("@aws-sdk/client-s3").ListBucketsCommandOutput>} -
   */
  async listBuckets(params) {
    const command = new AWS.ListBucketsCommand(params);
    return await this.s3.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-s3").DeleteObjectsRequest} params - params for deleteObjects request
   */
  async deleteObjects(params) {
    if (!params.Delete || !params.Delete.Objects) {
      throw new Error('Invalid params for deleteObjects');
    }
    while (params.Delete.Objects.length > 0) {
      const chunk = params.Delete.Objects.splice(0, 1000);
      const command = new AWS.DeleteObjectsCommand({
        ...params,
        Delete: {
          ...params.Delete,
          Objects: chunk,
        },
      });
      const { Errors } = await this.s3.send(command);
      if (Errors && Errors.length > 0) {
        const reruns = [];
        while (Errors.length > 0) {
          const error = Errors.pop() ?? {};
          if (error.Key) {
            reruns.push({
              Key: error.Key,
              ...(error.VersionId && { VersionId: error.VersionId }),
            });
          }
        }
        await this.deleteObjects({
          ...params,
          Delete: {
            ...params.Delete,
            Objects: reruns,
          },
        });
      }
    }
  }

  /**
   * @param {string} uri - S3 URI
   * @returns {import('../typedefs').S3Location} - S3 bucket, prefix
   */
  parseS3Uri(uri) {
    if (typeof uri !== 'string')
      throw new TypeError(`uri (${uri}) is not a string`);
    const match = uri.match(/^s3:\/\/([^/]+)\/(.+?)(\/*)$/);
    if (!match) throw new Error(uri + ' is not of form s3://bucket/key');
    const trailingSlashes = match[3];
    const key = match[2];
    return {
      bucket: match[1],
      prefix: key + trailingSlashes,
    };
  }

  /**
   * @param {import("@aws-sdk/client-s3").CopyObjectRequest} params -
   */
  async multiPartCopyObject({ Bucket, Key, CopySource }) {
    if (!CopySource) throw new Error('CopySource is required');
    const [SourceBucket, SourceKey] = CopySource.split(/\/(.+)/);
    const { ContentLength } = await this.s3.send(
      new AWS.HeadObjectCommand({
        Bucket: SourceBucket,
        Key: SourceKey,
      })
    );
    if (!ContentLength) throw new Error('failed to head object to copy');
    const { UploadId } = await this.s3.send(
      new AWS.CreateMultipartUploadCommand({
        Bucket,
        Key,
      })
    );
    if (!UploadId) throw new Error('failed to create multipart upload');
    const numOfParts = Math.floor(ContentLength / this.COPY_PART_SIZE_BYTES);
    const remainder = ContentLength % this.COPY_PART_SIZE_BYTES;
    let index, range;
    const partUploads = [];
    for (index = 0; index < numOfParts; index++) {
      const nextIndex = index + 1;
      if (
        nextIndex === numOfParts &&
        remainder < this.COPY_PART_SIZE_MINIMUM_BYTES
      ) {
        range =
          index * this.COPY_PART_SIZE_BYTES +
          '-' +
          (nextIndex * this.COPY_PART_SIZE_BYTES + remainder - 1);
      } else {
        range =
          index * this.COPY_PART_SIZE_BYTES +
          '-' +
          (nextIndex * this.COPY_PART_SIZE_BYTES - 1);
      }
      partUploads.push(
        this.s3.send(
          new AWS.UploadPartCopyCommand({
            Bucket,
            CopySource,
            CopySourceRange: 'bytes=' + range,
            Key,
            PartNumber: index + 1,
            UploadId,
          })
        )
      );
    }
    if (remainder >= this.COPY_PART_SIZE_MINIMUM_BYTES) {
      range =
        index * this.COPY_PART_SIZE_BYTES +
        '-' +
        (index * this.COPY_PART_SIZE_BYTES + remainder - 1);
      partUploads.push(
        this.s3.send(
          new AWS.UploadPartCopyCommand({
            Bucket,
            CopySource,
            CopySourceRange: 'bytes=' + range,
            Key,
            PartNumber: index + 1,
            UploadId,
          })
        )
      );
    }
    try {
      const results = await Promise.all(partUploads);
      this.s3.send(
        new AWS.CompleteMultipartUploadCommand({
          Bucket,
          Key,
          MultipartUpload: {
            Parts: results.map((r, i) => ({
              ETag: r.CopyPartResult && r.CopyPartResult.ETag,
              PartNumber: i + 1,
            })),
          },
          UploadId,
        })
      );
    } catch (err) {
      this.s3.send(
        new AWS.AbortMultipartUploadCommand({
          Bucket,
          Key,
          UploadId,
        })
      );
      throw err;
    }
  }

  /**
   * @param {import("@aws-sdk/client-s3").CopyObjectRequest} params -
   */
  async copyObjectWithMultiPartFallback(params) {
    try {
      await this.s3.send(new AWS.CopyObjectCommand(params));
    } catch (err) {
      if (
        // @ts-ignore
        !err.message ||
        // @ts-ignore
        !err.message.startsWith(
          'The specified copy source is larger than the maximum allowable size for a copy source'
        )
      )
        throw err;
      await this.multiPartCopyObject(params);
    }
  }

  /**
   * @param {import("@aws-sdk/client-s3").CopyObjectRequest[]} params -
   */
  async copyObjectsWithMultiPartFallback(params) {
    await bluebirdPromise.map(params, this.copyObjectWithMultiPartFallback, {
      concurrency: 10,
    });
  }

  /**
   * @param {import("@aws-sdk/client-s3").ListObjectsV2Request} SourceParams -
   * @param {string} DestinationBucket -
   * @param {string} DestinationPrefix -
   */
  async copyPath(SourceParams, DestinationBucket, DestinationPrefix) {
    const response = await this.s3.send(
      new AWS.ListObjectsV2Command(SourceParams)
    );
    if (!response.Contents)
      throw new Error(`No objects to copy with params: ${SourceParams}`);
    const promises = [];
    while (response.Contents.length > 0) {
      const object = response.Contents.splice(0, 1)[0];
      if (!object.Key) continue;
      promises.push(
        this.copyObjectWithMultiPartFallback({
          Bucket: DestinationBucket,
          Key: `${DestinationPrefix}${object.Key}`,
          CopySource: `${SourceParams.Bucket}/${object.Key}`,
        })
      );
    }
    await Promise.all(promises);

    if (response.NextContinuationToken) {
      await this.copyPath(
        {
          ...SourceParams,
          ContinuationToken: response.NextContinuationToken,
        },
        DestinationBucket,
        DestinationPrefix
      );
    }
  }

  /**
   * @param {import("@aws-sdk/client-s3").ListObjectsV2Request} params -
   */
  async deletePath(params) {
    const response = await this.s3.send(new AWS.ListObjectsV2Command(params));
    if (!response.Contents) return;
    if (response.Contents.length === 0) return;
    const objectsToDelete = response.Contents.filter(
      (object) => object.Key
    ).map((object) => ({
      Key: object.Key || '',
    }));
    if (objectsToDelete.length === 0) return;
    await this.deleteObjects({
      Bucket: params.Bucket,
      Delete: {
        Objects: objectsToDelete,
      },
    });

    if (response.NextContinuationToken) {
      await this.deletePath({
        ...params,
        ContinuationToken: response.NextContinuationToken,
      });
    }
  }

  /**
   * @param {import("@aws-sdk/client-s3").ListObjectsV2Request} params -
   * @param {Date} expirationDate -
   */
  async expireObjects(params, expirationDate = new Date()) {
    const response = await this.s3.send(new AWS.ListObjectsV2Command(params));
    if (!response.Contents)
      throw new Error(`No objects to delete with Params: ${params}`);
    if (response.Contents.length === 0) return;
    const objectsToDelete = response.Contents.filter(
      (object) =>
        object.Key &&
        object.LastModified &&
        object.LastModified < expirationDate
    ).map((object) => ({
      Key: object.Key || '',
    }));
    if (objectsToDelete.length === 0) return;
    await this.deleteObjects({
      Bucket: params.Bucket,
      Delete: {
        Objects: objectsToDelete,
      },
    });

    if (response.NextContinuationToken) {
      await this.expireObjects(
        {
          ...params,
          ContinuationToken: response.NextContinuationToken,
        },
        expirationDate
      );
    }
  }

  /**
   * @param {import("@aws-sdk/client-s3").ListObjectsV2Request} params - params for ListObjectV2 request
   * @param {Array<string>} prefixes - accumulator for common prefixes
   * @returns {Promise<string[]>} - common prefixes in given s3 location
   */
  async getCommonPrefixes(params, prefixes = []) {
    const response = await this.s3.send(
      new AWS.ListObjectsV2Command({
        ...params,
        Delimiter: '/',
      })
    );
    (response.CommonPrefixes || []).forEach(
      (obj) => obj.Prefix && prefixes.push(obj.Prefix)
    );

    if (response.NextContinuationToken) {
      await this.getCommonPrefixes(
        {
          ...params,
          ContinuationToken: response.NextContinuationToken,
        },
        prefixes
      );
    }
    return prefixes;
  }

  /**
   * @param {string} Bucket - S3 bucket to inspect for partitions
   * @param {string} Prefix - S3 prefix to use for partition inspection
   * @param {Array<{Name: string}>} partitionKeys - Partition keys that will exist in s3 paths
   * @param {import('../typedefs').PartitionValues} PartitionValues - accumulator for Partition values
   * @param {Array<import('../typedefs').Partition>} partitions - accumulator for Partition objects
   * @returns {Promise<import('../typedefs').Partition[]>} - list of partitions that exists in the given s3 location
   */
  async findPartitions(
    Bucket,
    Prefix,
    partitionKeys,
    PartitionValues = {},
    partitions = []
  ) {
    const prefixes = await this.getCommonPrefixes({ Bucket, Prefix });
    const promises = prefixes.map(async (prefix) => {
      const partitionValues = Object.assign(
        {
          [partitionKeys[0].Name]: prefix
            .replace(Prefix, '')
            .replace('/', '')
            .replace(`${partitionKeys[0].Name}=`, '')
            .replace(`${partitionKeys[0].Name}}%3D`, ''),
        },
        PartitionValues
      );
      // ignores kinesis firehose's failure prefix
      if (partitionValues[partitionKeys[0].Name] === 'processing_failed')
        return;
      partitionKeys.length > 1
        ? await this.findPartitions(
            Bucket,
            prefix,
            partitionKeys.slice(1),
            partitionValues,
            partitions
          )
        : partitions.push({
            partitionValues,
            location: `s3://${Bucket}/${prefix}`,
          });
    });
    await Promise.all(promises);

    return partitions;
  }

  /**
   * @param {import("@aws-sdk/client-s3").CreateMultipartUploadCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").CreateMultipartUploadCommandOutput>} -
   */
  async createMultipartUpload(params) {
    const command = new AWS.CreateMultipartUploadCommand(params);
    return await this.s3.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-s3").CompleteMultipartUploadCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").CompleteMultipartUploadCommandOutput>} -
   */
  async completeMultipartUpload(params) {
    const command = new AWS.CompleteMultipartUploadCommand(params);
    return await this.s3.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-s3").UploadPartCopyCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").UploadPartCopyCommandOutput>} -
   */
  async uploadPartCopy(params) {
    const command = new AWS.UploadPartCopyCommand(params);
    return await this.s3.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-s3").UploadPartCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").UploadPartCommandOutput>} -
   */
  async uploadPart(params) {
    const command = new AWS.UploadPartCommand(params);
    return await this.s3.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-s3").PutObjectCommandInput} params -
   * @param {Buffer} data -
   */
  async createAppendableOrAppendToObject(params, data) {
    let existingObject;
    try {
      existingObject = await this.headObject({
        Bucket: params.Bucket,
        Key: params.Key,
      });
    } catch (err) {
      // @ts-ignore
      if (err.name === 'NotFound') {
        existingObject = null;
      } else {
        throw err;
      }
    }
    const { UploadId } = await this.createMultipartUpload({
      Bucket: params.Bucket,
      Key: params.Key,
    });
    let partNumber = 1;
    const parts = [];

    if (
      (existingObject && existingObject.ContentLength) ||
      5 * 1024 * 1024 < 0
    ) {
      const { CopyPartResult } = await this.uploadPartCopy({
        Bucket: params.Bucket,
        Key: params.Key,
        CopySource: `${params.Bucket}/${params.Key}`,
        PartNumber: partNumber,
        UploadId,
      });
      if (!CopyPartResult || !CopyPartResult.ETag)
        throw new Error('No ETag for CopyPartResult');
      partNumber++;
      parts.push({
        ETag: CopyPartResult.ETag,
        PartNumber: partNumber,
      });
    }
    if (existingObject === null) {
      if (!this._left_pad_object_checked) {
        try {
          await this.headObject({
            Bucket: params.Bucket,
            Key: this._LEFT_PAD_OBJECT_NAME,
          });
        } catch (err) {
          // @ts-ignore
          if (err.name === 'NotFound') {
            const offset = ' '.repeat(this._LEFT_PAD_SIZE);
            await this.putObject({
              Bucket: params.Bucket,
              Key: this._LEFT_PAD_OBJECT_NAME,
              Body: Readable.from(offset),
              ContentLength: offset.length,
            });
          } else {
            throw err;
          }
        }
        this._left_pad_object_checked = true;
      }
      const { CopyPartResult } = await this.uploadPartCopy({
        Bucket: params.Bucket,
        Key: params.Key,
        CopySource: `${params.Bucket}/${this._LEFT_PAD_OBJECT_NAME}`,
        PartNumber: partNumber,
        UploadId,
      });
      if (!CopyPartResult || !CopyPartResult.ETag)
        throw new Error('No ETag for CopyPartResult');
      partNumber++;
      parts.push({
        ETag: CopyPartResult.ETag,
        PartNumber: partNumber,
      });
    }
    const { ETag } = await this.uploadPart({
      Bucket: params.Bucket,
      Key: params.Key,
      Body: data,
      PartNumber: partNumber,
      UploadId,
    });
    if (!ETag)
      throw new Error('No ETag for uploadPart result. Something went wrong');
    partNumber++;
    parts.push({
      ETag,
      PartNumber: partNumber,
    });
    await this.completeMultipartUpload({
      Bucket: params.Bucket,
      Key: params.Key,
      MultipartUpload: { Parts: parts },
      UploadId,
    });
  }

  /**
   * @param {import("@aws-sdk/client-s3").PutBucketNotificationConfigurationCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").PutBucketNotificationConfigurationCommandOutput>} -
   */
  async putBucketNotificationConfiguration(params) {
    const command = new AWS.PutBucketNotificationConfigurationCommand(params);
    return await this.s3.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-s3").GetBucketNotificationConfigurationCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-s3").GetBucketNotificationConfigurationCommandOutput>} -
   */
  async getBucketNotificationConfiguration(params) {
    const command = new AWS.GetBucketNotificationConfigurationCommand(params);
    return await this.s3.send(command);
  }

  /**
   * @param {string} bucketName -
   * @param {string} expectedOwnerId -
   * @returns {Promise<boolean>} -
   */
  async checkBucketOwnership(bucketName, expectedOwnerId) {
    const command = new AWS.HeadBucketCommand({
      Bucket: bucketName,
      ExpectedBucketOwner: expectedOwnerId,
    });
    try {
      await this.s3.send(command);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * @param {import("@aws-sdk/client-s3").GetBucketLocationCommandInput} params -
   * @param {string} [region] -
   * @returns {Promise<import("@aws-sdk/client-s3").GetBucketLocationCommandOutput>} -
   */
  async getBucketLocation(params, region) {
    const command = new AWS.GetBucketLocationCommand({
      ...params,
    });
    return await (region
      ? this._getRegionClient(region).send(command)
      : this.s3.send(command));
  }

  /**
   * @param {import("@aws-sdk/client-s3").GetBucketLocationCommandInput} params -
   * @returns {Promise<string>} -
   */
  async findBucketRegion(params) {
    try {
      const { LocationConstraint } = await this.getBucketLocation(params);
      // If the LocationConstraint is null or not present, the bucket is in us-east-1
      return LocationConstraint || 'us-east-1';
    } catch (error) {
      const regionPromises = AWS_REGIONS.map(async (region) => {
        const { LocationConstraint } = await this.getBucketLocation(
          params,
          region
        );
        return LocationConstraint || 'us-east-1';
      });
      return await bluebirdPromise.any(regionPromises);
    }
  }

  /**
   * @param {import("@aws-sdk/client-s3").ListObjectsV2Request} params - params for ListObjectV2 request
   * @param {string} [region] -
   * @param {Number} [byteSize] - accumulator for common prefixes
   * @returns {Promise<Number>} -
   */
  async getPrefixByteSize(params, region, byteSize = 0) {
    const listCommand = new AWS.ListObjectsV2Command({
      ...params,
    });
    const response = await (region
      ? this._getRegionClient(region).send(listCommand)
      : this.s3.send(listCommand));

    (response.Contents || []).forEach((obj) => (byteSize += obj.Size || 0));

    if (response.NextContinuationToken) {
      await this.getPrefixByteSize(
        {
          ...params,
          ContinuationToken: response.NextContinuationToken,
        },
        region,
        byteSize
      );
    }
    return byteSize;
  }
}
module.exports = S3;
