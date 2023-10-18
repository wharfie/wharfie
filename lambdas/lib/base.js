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
        content.forEach(aws_sdk_log.debug);
      },
      info: (/** @type {any[]} */ ...content) => {
        content.forEach(aws_sdk_log.info);
      },
      warn: (/** @type {any[]} */ ...content) => {
        content.forEach(aws_sdk_log.warn);
      },
      error: (/** @type {any[]} */ ...content) => {
        content.forEach(aws_sdk_log.error);
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
