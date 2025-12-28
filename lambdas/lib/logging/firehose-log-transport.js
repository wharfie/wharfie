import { Writable } from 'stream';

import { Firehose, PutRecordBatchCommand } from '@aws-sdk/client-firehose';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

/**
 * @typedef FirehoseLogTransportOptions
 * @property {string} [logDeliveryStreamName] -
 * @property {number} [flushInterval] -
 */

class FirehoseLogTransport extends Writable {
  /**
   * @param {FirehoseLogTransportOptions} [options] -a
   */
  constructor(options = {}) {
    super();
    const credentials = fromNodeProviderChain();
    this.firehose = new Firehose({
      credentials,
      region: process.env.AWS_REGION,
      maxAttempts: 20,
      retryMode: 'adaptive',
    });

    this._FLUSH_INTERVAL = options.flushInterval || 10000;

    this._LOG_DELIVERY_STREAM_NAME = options.logDeliveryStreamName;

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
        this.flush.bind(this),
        this._FLUSH_INTERVAL,
      );
    }
  }

  /**
   * @param {import("@aws-sdk/client-firehose").PutRecordBatchCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-firehose").PutRecordBatchCommandOutput>} -
   */
  async putRecordsBatch(params) {
    const command = new PutRecordBatchCommand(params);
    return await this.firehose.send(command);
  }

  /**
   * @param {string} record -
   * @returns {Promise<void>} -
   */
  async log(record) {
    if (record.length >= FirehoseLogTransport._MAX_BIN_SIZE) {
      record =
        'TRUNCATED' +
        record.slice(
          0,
          FirehoseLogTransport._MAX_BIN_SIZE - 'TRUNCATED'.length,
        );
    }
    if (
      this.buffer_records_size + record.length >=
        FirehoseLogTransport._MAX_BUFFER_SIZE ||
      this.buffer_records.length + 1 >= FirehoseLogTransport._MAX_BINS
    ) {
      await this.flush();
    }
    this.buffer_records_size += record.length;
    this.buffer_records.push(record);
    this.buffer_record_size_map[this.buffer_records.length - 1] = record.length;
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
          !packedRecords.has(r.bin_record_index),
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
            !packedRecords.has(r.bin_record_index),
        );
      }
      bins.push(bin);
    }
    return bins;
  }

  async flush() {
    if (this.buffer_records.length === 0) return;
    await new Promise((resolve, reject) =>
      process.nextTick(async () => {
        const { FailedPutCount, RequestResponses } = await this.putRecordsBatch(
          {
            DeliveryStreamName: this._LOG_DELIVERY_STREAM_NAME,
            Records: this.naiveBinPackBufferRecords().map((record) => ({
              Data: Buffer.from(record),
            })),
          },
        );
        if (FailedPutCount && FailedPutCount > 0) {
          reject(
            new Error(
              `Failed to send ${FailedPutCount} records to Firehose ${JSON.stringify(
                RequestResponses,
              )}`,
            ),
          );
        }
        this.buffer_records_size = 0;
        this.buffer_record_size_map = {};
        this.buffer_records = [];
        resolve(null);
      }),
    );
  }

  async close() {
    if (this._FLUSH_INTERVAL_ID) {
      clearInterval(this._FLUSH_INTERVAL_ID);
    }
    await this.flush();
  }

  /**
   * @param {(error: Error | null | undefined) => void} callback -
   */
  async _final(callback) {
    try {
      await this.close();
      callback(null);
    } catch (err) {
      if (err instanceof Error) {
        callback(err);
      } else {
        callback(new Error(`Unknown error: ${err}`));
      }
    }
  }

  /**
   * @param {any} chunk -
   * @param {string} _encoding -
   * @param {(error: Error | null | undefined) => void} callback -
   */
  async _write(chunk, _encoding, callback) {
    try {
      const message = chunk.toString();
      await this.log(message);
      callback(null);
    } catch (err) {
      if (err instanceof Error) {
        callback(err);
      } else {
        callback(new Error(`Unknown error: ${err}`));
      }
    }
  }
}

// https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-firehose/classes/putrecordbatchcommand.html
FirehoseLogTransport._MAX_BUFFER_SIZE = 4 * 1024 * 1024;
FirehoseLogTransport._MAX_BINS = 500;
FirehoseLogTransport._MAX_BIN_SIZE = 1000 * 1024;
FirehoseLogTransport._BIN_COST_INCREMENT = 5 * 1024;

export default FirehoseLogTransport;
