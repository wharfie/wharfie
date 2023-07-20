'use strict';

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
    if (!S3Mock.__state[params.Bucket][params.Key])
      throw new Error(`object does not exist: ${params.Bucket}/${params.Key}`);
    return {
      ContentLength: 100,
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
    const { bucket, prefix } = this._parseS3Uri(params.CopySource);
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
}

S3Mock.__state = {};

module.exports = S3Mock;
