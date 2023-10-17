'use strict';
const logging = require('./logging');
const aws_sdk_log = logging.getAWSSDKLogger();
class BaseAWS {
  /**
   * @returns {import("@aws-sdk/client-sts").ClientDefaults} - sdk options
   */
  static config() {
    const logger = {
      debug: aws_sdk_log.debug,
      info: aws_sdk_log.info,
      warn: aws_sdk_log.warn,
      error: aws_sdk_log.error,
    };
    return {
      maxAttempts: 20,
      retryMode: 'adaptive',
      logger,
    };
  }
}

module.exports = BaseAWS;
