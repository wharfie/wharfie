'use strict';
const logging = require('./logging');
const aws_sdk_log = logging.getAWSSDKLogger();
class BaseAWS {
  /**
   * @returns {import("@aws-sdk/client-sts").ClientDefaults} - sdk options
   */
  static config() {
    const logger = {
      debug: (/** @type {any[]} */ ...content) => {
        content.forEach((record) => {
          if (record.input) {
            record.input = JSON.stringify(record.input);
          }
          if (record.output) {
            record.output = JSON.stringify(record.output);
          }
          aws_sdk_log.debug(record);
        });
      },
      info: (/** @type {any[]} */ ...content) => {
        content.forEach((record) => {
          if (record.input) {
            record.input = JSON.stringify(record.input);
          }
          if (record.output) {
            record.output = JSON.stringify(record.output);
          }
          aws_sdk_log.info(record);
        });
      },
      warn: (/** @type {any[]} */ ...content) => {
        content.forEach((record) => {
          if (record.input) {
            record.input = JSON.stringify(record.input);
          }
          if (record.output) {
            record.output = JSON.stringify(record.output);
          }
          aws_sdk_log.warn(record);
        });
      },
      error: (/** @type {any[]} */ ...content) => {
        content.forEach((record) => {
          if (record.input) {
            record.input = JSON.stringify(record.input);
          }
          if (record.output) {
            record.output = JSON.stringify(record.output);
          }
          aws_sdk_log.error(record);
        });
      },
    };
    return {
      maxAttempts: 20,
      retryMode: 'adaptive',
      logger,
    };
  }
}

module.exports = BaseAWS;
