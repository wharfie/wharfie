'use strict';

const cuid = require('cuid');

class S3Mock {
  __setMockState(s3ObjectMap) {
    S3Mock.__state = {};
    Object.keys(s3ObjectMap).forEach((s3Key) => {
      const { bucket, prefix } = this._parseS3Uri(s3Key);
      if (!S3Mock.__state[bucket]) {
        S3Mock.__state[bucket] = {};
      }
      S3Mock.__state[bucket][prefix] = s3ObjectMap[s3Key];
    });
  }

  __getMockState() {
    return S3Mock.__state;
  }

  _parseS3Uri(uri) {
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

  async send(command) {
    switch (command.constructor.name) {
      case 'PutObjectCommand':
        return await this.putObject(command.input);
      case 'GetObjectCommand':
        return await this.getObject(command.input);
      case 'HeadObjectCommand':
        return await this.headObject(command.input);
      case 'DeleteObjectsCommand':
        return await this.deleteObjects(command.input);
      case 'CopyObjectCommand':
        return await this.copyObject(command.input);
      case 'ListObjectsV2Command':
        return await this.listObjectsV2(command.input);
      case 'CreateMultipartUploadCommand':
        return await this.createMultiPartUpload(command.input);
      case 'CompleteMultipartUploadCommand':
        return await this.completeMultiPartUpload(command.input);
      case 'UploadPartCommand':
        return await this.uploadPart(command.input);
      case 'UploadPartCopyCommand':
        return await this.uploadPartCopy(command.input);
    }
  }

  async putObject(params) {
    if (!S3Mock.__state[params.Bucket]) {
      S3Mock.__state[params.Bucket] = {};
    }
    S3Mock.__state[params.Bucket][params.Key] = params.Body;
  }

  async getObject(params) {
    if (!S3Mock.__state[params.Bucket][params.Key]) {
      const error = new Error(
        `object does not exist: ${params.Bucket}/${params.Key}`
      );
      error.name = 'NoSuchKey';
      throw error;
    }
    return {
      Body: S3Mock.__state[params.Bucket][params.Key],
    };
  }

  async headObject(params) {
    if (!S3Mock.__state[params.Bucket][params.Key]) {
      const err = new Error(
        `object does not exist: ${params.Bucket}/${params.Key}`
      );
      err.name = 'NotFound';
      throw err;
    }
    return {
      ContentLength: S3Mock.__state[params.Bucket][params.Key].length,
    };
  }

  async deleteObjects(params) {
    params.Delete.Objects.forEach((_delete) => {
      delete S3Mock.__state[params.Bucket][_delete.Key];
    });
    return {
      Errors: [],
    };
  }

  async copyObject(params) {
    const { bucket, prefix } = this._parseS3Uri(`s3://${params.CopySource}`);
    if (!S3Mock.__state[bucket][prefix])
      throw new Error('copy source does not exist');
    S3Mock.__state[params.Bucket][params.Key] = S3Mock.__state[bucket][prefix];
  }

  async listObjectsV2(params) {
    if (!params.Prefix) params.Prefix = '';
    if (!S3Mock.__state[params.Bucket])
      throw new Error('bucket does not exist');
    const matchingKeys = Object.keys(S3Mock.__state[params.Bucket]).filter(
      (key) => key.startsWith(params.Prefix)
    );

    if (params.Delimiter) {
      return {
        CommonPrefixes: [
          ...new Set(
            matchingKeys.map((key) => {
              const parts = key.slice(params.Prefix.length).split('/');

              return `${params.Prefix}${parts[0] ? '' : '/'}${
                parts[0] || parts[1]
              }`;
            })
          ),
        ].map((prefix) => ({
          Prefix: prefix,
        })),
      };
    } else {
      return {
        Bucket: params.Bucket,
        Contents: matchingKeys.map((key) => ({
          Key: key,
          LastModified: new Date(1970, 0, 1, 0, 0, 0, 0),
        })),
      };
    }
  }

  async createMultiPartUpload(params) {
    if (!S3Mock.__state.__MULTIPART_UPLOADS__) {
      S3Mock.__state.__MULTIPART_UPLOADS__ = {};
    }
    const uploadId = cuid();

    S3Mock.__state.__MULTIPART_UPLOADS__[uploadId] = {
      Bucket: params.Bucket,
      Key: params.Key,
      Parts: [],
    };

    return {
      UploadId: uploadId,
    };
  }

  async completeMultiPartUpload(params) {
    const upload = S3Mock.__state.__MULTIPART_UPLOADS__[params.UploadId];
    const body = upload.Parts.sort((a, b) => a.PartNumber - b.PartNumber)
      .map((part) => {
        if (part.Body) return part.Body;
        const { bucket, prefix } = this._parseS3Uri(`s3://${part.CopySource}`);
        return S3Mock.__state[bucket][prefix];
      })
      .join('');

    await this.putObject({
      Bucket: upload.Bucket,
      Key: upload.Key,
      Body: body,
    });

    delete S3Mock.__state.__MULTIPART_UPLOADS__[params.UploadId];
  }

  async uploadPart(params) {
    const upload = S3Mock.__state.__MULTIPART_UPLOADS__[params.UploadId];
    upload.Parts.push({
      PartNumber: params.PartNumber,
      Body: params.Body,
    });
    return {
      ETag: 'etag',
    };
  }

  async uploadPartCopy(params) {
    const { bucket, prefix } = this._parseS3Uri(`s3://${params.CopySource}`);
    if (!S3Mock.__state[bucket][prefix])
      throw new Error('copy source does not exist');
    const upload = S3Mock.__state.__MULTIPART_UPLOADS__[params.UploadId];
    upload.Parts.push({
      PartNumber: params.PartNumber,
      CopySource: params.CopySource,
    });
    return {
      CopyPartResult: {
        ETag: 'etag',
      },
    };
  }
}

S3Mock.__state = {};

module.exports = S3Mock;
