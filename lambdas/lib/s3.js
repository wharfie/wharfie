'use strict';
const AWS = require('@aws-sdk/client-s3');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');
const { Readable } = require('stream');
const BaseAWS = require('./base');

class S3 {
  /**
   * @param {import("@aws-sdk/client-s3").S3ClientConfig} options - S3 client configuration
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.s3 = new AWS.S3({
      ...BaseAWS.config(),
      credentials,
      ...options,
      useArnRegion: true,
    });
    this.COPY_PART_SIZE_BYTES = 500000000; // ~500 MB
    this.COPY_PART_SIZE_MINIMUM_BYTES = 5242880; // 5 MB
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
   * @returns {Promise<import("@aws-sdk/client-s3").GetObjectOutput>} -
   */
  async getObject(params) {
    const command = new AWS.GetObjectCommand(params);
    const result = await this.s3.send(command);

    // TODO this increases memory usage by emptying streams but makes it easier to work with
    if (!result.Body) {
      throw new Error('No body returned from getObject');
    }
    let body = '';
    if (result.Body instanceof Readable) {
      for await (const chunk of result.Body) {
        body += chunk;
      }
    } else {
      body = result.Body.toString();
    }
    return {
      ...result,
      Body: body,
    };
  }

  /**
   * @param {import("@aws-sdk/client-s3").HeadObjectRequest} params - params for HeadObject request
   * @returns {Promise<import("@aws-sdk/client-s3").HeadObjectOutput>} -
   */
  async headObject(params) {
    const command = new AWS.HeadObjectCommand(params);
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
    if (typeof uri !== 'string') throw new TypeError('uri is not a string');
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
   * @param {import("@aws-sdk/client-s3").ListObjectsV2Request} SourceParams -
   * @param {string} SourceTableName -
   * @param {string} SourceDatabaseName -
   * @param {string} DestinationBucket -
   * @param {string} DestinationPrefix -
   */
  async copyPath(
    SourceParams,
    SourceTableName,
    SourceDatabaseName,
    DestinationBucket,
    DestinationPrefix
  ) {
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
          Key: `${DestinationPrefix}${object.Key.replace(
            `${SourceTableName}/`,
            ''
          ).replace(`${SourceDatabaseName}/`, '')}`,
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
        SourceTableName,
        SourceDatabaseName,
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
    if (!response.Contents)
      throw new Error(`No objects to delete with Params: ${params}`);
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
    if (!response.CommonPrefixes)
      throw new Error(
        `Failed to ListObjects with params: ${JSON.stringify(params)}`
      );
    response.CommonPrefixes.forEach(
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
}

module.exports = S3;
