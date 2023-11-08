const Transport = require('winston-transport');
const AWS = require('@aws-sdk/client-firehose');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

/**
 * @typedef FirehoseLogTransportOptions
 * @property {string} [logDeliveryStreamName] -
 * @property {number} [flushInterval] -
 */

class FirehoseLogTransport extends Transport {
  /**
   * @param {import("winston-transport").TransportStreamOptions} [options] -
   * @param {FirehoseLogTransportOptions} [firehoseOptions] -
   */
  constructor(options = {}, firehoseOptions = {}) {
    super(options);
    const credentials = fromNodeProviderChain();
    this.firehose = new AWS.Firehose({
      credentials,
      region: process.env.AWS_REGION,
      maxAttempts: 20,
      retryMode: 'adaptive',
    });

    this._FLUSH_INTERVAL = firehoseOptions.flushInterval || 10000;

    this._LOG_DELIVERY_STREAM_NAME = firehoseOptions.logDeliveryStreamName;

    /**
     * @type {string[]}
     */
    this.buffer_records = [];
    /**
     * @type {Object<number, number>}
     */
    this.buffer_record_size_map = {};
    this.buffer_records_size = 0;

    if (this._FLUSH_INTERVAL > 0) {
      this._FLUSH_INTERVAL_ID = setInterval(
        this.flushBuffer.bind(this),
        this._FLUSH_INTERVAL
      );
    }
  }

  /**
   * @param {import("@aws-sdk/client-firehose").PutRecordBatchCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-firehose").PutRecordBatchCommandOutput>} -
   */
  async putRecordsBatch(params) {
    const command = new AWS.PutRecordBatchCommand(params);
    return await this.firehose.send(command);
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
    let record = JSON.stringify(info) + '\n';
    if (record.length >= FirehoseLogTransport._MAX_BIN_SIZE) {
      info.message =
        'TRUNCATED' +
        info.message.slice(
          0,
          FirehoseLogTransport._MAX_BIN_SIZE -
            (record.length + 'TRUNCATED'.length)
        );
      record =
        JSON.stringify(info).slice(0, FirehoseLogTransport._MAX_BIN_SIZE - 1) +
        '\n';
    }
    if (
      this.buffer_records_size + record.length >=
        FirehoseLogTransport._MAX_BUFFER_SIZE ||
      this.buffer_records.length + 1 >= FirehoseLogTransport._MAX_BINS
    ) {
      await this.flushBuffer();
    }
    this.buffer_records_size += record.length;
    this.buffer_records.push(record);
    this.buffer_record_size_map[this.buffer_records.length - 1] = record.length;
    callback();
  }

  /**
   * Naively bin packs records into bins minimizing unused _BIN_COST_INCREMENT
   * @returns {string[]} -
   */
  naiveBinPackBufferRecords() {
    const bins = [];
    let bin_record_index = 0;
    const buffer_record_metadatas = [];
    const packedRecords = new Set();
    while (bin_record_index < this.buffer_records.length) {
      const record_size = this.buffer_record_size_map[bin_record_index];
      const remainder = record_size % FirehoseLogTransport._BIN_COST_INCREMENT;
      buffer_record_metadatas.push({
        remainder,
        bin_record_index,
        record_size,
      });
      bin_record_index++;
    }
    for (let i = 0; i < buffer_record_metadatas.length; i++) {
      const buffer_record_metadata = buffer_record_metadatas[i];
      if (packedRecords.has(buffer_record_metadata.bin_record_index)) continue;
      let bin = this.buffer_records[buffer_record_metadata.bin_record_index];
      packedRecords.add(buffer_record_metadata.bin_record_index);
      let current_remainder = buffer_record_metadata.remainder;
      let valid_bin_fill_records = buffer_record_metadatas.filter(
        (r) =>
          r.remainder + current_remainder <=
            FirehoseLogTransport._BIN_COST_INCREMENT &&
          r.record_size + bin.length <= FirehoseLogTransport._MAX_BIN_SIZE &&
          !packedRecords.has(r.bin_record_index)
      );
      while (valid_bin_fill_records.length >= 0) {
        const remainder_fill = valid_bin_fill_records.shift();
        if (!remainder_fill) break;
        if (packedRecords.has(remainder_fill.bin_record_index)) continue;
        bin += this.buffer_records[remainder_fill.bin_record_index];
        packedRecords.add(remainder_fill.bin_record_index);
        current_remainder += remainder_fill.remainder;
        valid_bin_fill_records = buffer_record_metadatas.filter(
          (r) =>
            r.remainder + current_remainder <=
              FirehoseLogTransport._BIN_COST_INCREMENT &&
            r.record_size + bin.length <= FirehoseLogTransport._MAX_BIN_SIZE &&
            !packedRecords.has(r.bin_record_index)
        );
      }
      bins.push(bin);
    }
    return bins;
  }

  async flushBuffer() {
    if (this.buffer_records.length === 0) return;
    await this.putRecordsBatch({
      DeliveryStreamName: this._LOG_DELIVERY_STREAM_NAME,
      Records: this.naiveBinPackBufferRecords().map((record) => ({
        Data: Buffer.from(record),
      })),
    });
    this.buffer_records_size = 0;
    this.buffer_record_size_map = {};
    this.buffer_records = [];
  }

  async close() {
    if (this._FLUSH_INTERVAL_ID) {
      clearInterval(this._FLUSH_INTERVAL_ID);
    }
    this.flushBuffer();
  }
}

// https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-firehose/classes/putrecordbatchcommand.html
FirehoseLogTransport._MAX_BUFFER_SIZE = 4 * 1024 * 1024;
FirehoseLogTransport._MAX_BINS = 500;
FirehoseLogTransport._MAX_BIN_SIZE = 1000 * 1024;
FirehoseLogTransport._BIN_COST_INCREMENT = 5 * 1024;

module.exports = FirehoseLogTransport;
