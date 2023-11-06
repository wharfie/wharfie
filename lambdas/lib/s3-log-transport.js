const Transport = require('winston-transport');
const AWS = require('@aws-sdk/client-s3');
const cuid = require('cuid');
// const zlib = require('zlib');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

/**
 * @typedef S3LogTransportOptions
 * @property {string} [logObjectKeyPrefix] -
 * @property {string} [logBucket] -
 * @property {number} [flushInterval] -
 * @property {number} [maxBufferSize] -
 */

module.exports = class S3LogTransport extends Transport {
  /**
   * @param {import("winston-transport").TransportStreamOptions} [opts] -
   * @param {S3LogTransportOptions} [s3opts] -
   */
  constructor(opts = {}, s3opts = {}) {
    super(opts);
    const credentials = fromNodeProviderChain();
    this.s3 = new AWS.S3({
      credentials,
      region: process.env.AWS_REGION,
      maxAttempts: 20,
      retryMode: 'adaptive',
      useArnRegion: true,
    });

    this.buffer = '';
    this._MAX_BUFFER_SIZE = s3opts.maxBufferSize || 5 * 1024 * 1024;
    this._FLUSH_INTERVAL = s3opts.flushInterval || 5000;

    this._LEFT_PAD_OBJECT_KEY = `5MB_file.txt`;
    this._LEFT_PAD_SIZE = 5 * 1024 * 1024;
    this._left_pad_object_checked = false;
    this._LOG_BUCKET = s3opts.logBucket;
    this._LOG_KEY_PREFIX = s3opts.logObjectKeyPrefix;

    if (this._FLUSH_INTERVAL > 0) {
      this._FLUSH_INTERVAL_ID = setInterval(
        this.flushBuffer.bind(this),
        this._FLUSH_INTERVAL
      );
    }
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
   * @param {import("@aws-sdk/client-s3").HeadObjectCommandInput} params - params for HeadObject request
   * @returns {Promise<import("@aws-sdk/client-s3").HeadObjectOutput>} -
   */
  async headObject(params) {
    const command = new AWS.HeadObjectCommand(params);
    return await this.s3.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-s3").CopyObjectCommandInput} params - params for HeadObject request
   * @returns {Promise<import("@aws-sdk/client-s3").CopyObjectCommandOutput>} -
   */
  async copyObject(params) {
    const command = new AWS.CopyObjectCommand(params);
    return await this.s3.send(command);
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
      existingObject &&
      existingObject.ContentLength &&
      existingObject.ContentLength >= 5 * 1024 * 1024
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
      parts.push({
        ETag: CopyPartResult.ETag.split('"').join(''),
        PartNumber: partNumber,
      });
      partNumber++;
    }
    if (existingObject === null) {
      if (!this._left_pad_object_checked) {
        try {
          await this.headObject({
            Bucket: params.Bucket,
            Key: this._LEFT_PAD_OBJECT_KEY,
          });
        } catch (err) {
          // @ts-ignore
          if (err.name === 'NotFound') {
            await this.putObject({
              Bucket: params.Bucket,
              Key: this._LEFT_PAD_OBJECT_KEY,
              Body: ' '.repeat(this._LEFT_PAD_SIZE),
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
        CopySource: `${params.Bucket}/${this._LEFT_PAD_OBJECT_KEY}`,
        PartNumber: partNumber,
        UploadId,
      });
      if (!CopyPartResult || !CopyPartResult.ETag)
        throw new Error('No ETag for CopyPartResult');
      parts.push({
        ETag: CopyPartResult.ETag.split('"').join(''),
        PartNumber: partNumber,
      });
      partNumber++;
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
    parts.push({
      ETag: ETag.split('"').join(''),
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
   * @param {any} info -
   * @param {any} callback -
   * @returns {Promise<void>} -
   */
  async log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });
    this.buffer += JSON.stringify(info) + '\n';
    if (this.buffer.length < this._MAX_BUFFER_SIZE) return callback();
    await this.flushBuffer();
    callback();
  }

  async flushBuffer() {
    if (this.buffer.length === 0) return;
    await this.putObject({
      Bucket: this._LOG_BUCKET,
      // Key: `${this._LOG_KEY_PREFIX}-${cuid()}.log.gzip`,
      Key: `${this._LOG_KEY_PREFIX}-${cuid()}.log`,
      // Body: zlib.deflateSync(Buffer.from(this.buffer)),
      Body: Buffer.from(this.buffer),
      // ContentEncoding: 'gzip',
    });
    this.buffer = '';
  }

  /**
   * @param {import("@aws-sdk/client-s3").GetObjectCommandInput} params -
   */
  async compactAppendableObject(params) {
    const existingObject = await this.headObject({
      Bucket: params.Bucket,
      Key: params.Key,
    });
    if (!existingObject || !existingObject.ContentLength) return;
    const { UploadId } = await this.createMultipartUpload({
      Bucket: params.Bucket,
      Key: params.Key,
    });
    const partNumber = 1;
    const parts = [];
    const { CopyPartResult } = await this.uploadPartCopy({
      Bucket: params.Bucket,
      Key: params.Key,
      CopySource: `${params.Bucket}/${params.Key}`,
      PartNumber: partNumber,
      CopySourceRange: `bytes=${this._LEFT_PAD_SIZE}-${
        existingObject.ContentLength - 1
      }`,
      UploadId,
    });
    if (!CopyPartResult || !CopyPartResult.ETag)
      throw new Error('No ETag for CopyPartResult');
    parts.push({
      ETag: CopyPartResult.ETag.split('"').join(''),
      PartNumber: partNumber,
    });
    await this.completeMultipartUpload({
      Bucket: params.Bucket,
      Key: params.Key,
      MultipartUpload: { Parts: parts },
      UploadId,
    });
  }

  async close() {
    if (this._FLUSH_INTERVAL_ID) {
      clearInterval(this._FLUSH_INTERVAL_ID);
    }
    this.flushBuffer();
  }
};
