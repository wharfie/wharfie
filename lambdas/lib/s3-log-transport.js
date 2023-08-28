const Transport = require('winston-transport');
const AWS = require('@aws-sdk/client-s3');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

const FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME;
const BUCKET = process.env.WHARFIE_ARTIFACT_BUCKET;
const DEPLOYMENT_NAME = process.env.STACK_NAME;

module.exports = class S3LogTransport extends Transport {
  /**
   * @param {import("winston-transport").TransportStreamOptions} [opts] -
   */
  constructor(opts = {}) {
    super(opts);
    const credentials = fromNodeProviderChain();
    this.s3 = new AWS.S3({
      credentials,
      region: process.env.AWS_REGION,
      maxAttempts: 20,
      retryMode: 'adaptive',
      useArnRegion: true,
    });

    const currentDateTime = new Date();
    const year = currentDateTime.getUTCFullYear();
    const month = String(currentDateTime.getUTCMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const day = String(currentDateTime.getUTCDate()).padStart(2, '0');
    const currentHourUTC = currentDateTime.getUTCHours();

    const formattedDate = `${year}-${month}-${day}`;
    this.dt = formattedDate;
    this.hr = currentHourUTC;

    this._LEFT_PAD_OBJECT_NAME = `${DEPLOYMENT_NAME}/5MB_file.txt`;
    this._LEFT_PAD_SIZE = 5 * 1024 * 1024;
    this._left_pad_object_checked = false;
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
            await this.putObject({
              Bucket: params.Bucket,
              Key: this._LEFT_PAD_OBJECT_NAME,
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
   * @param {any} info -
   * @param {any} callback -
   */
  async log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });
    // TODO: this could make fewer head requests
    await this.createAppendableOrAppendToObject(
      {
        Bucket: BUCKET,
        Key: `${DEPLOYMENT_NAME}/dt=${this.dt}/hr=${this.hr}/lambda=${FUNCTION_NAME}/lambda.log`,
      },
      Buffer.from(JSON.stringify(info))
    );
    // Perform the writing to the remote service
    callback();
  }

  close() {}
};
