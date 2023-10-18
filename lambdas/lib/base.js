'use strict';
const logging = require('./logging');
const aws_sdk_log = logging.getAWSSDKLogger();
const daemon_log = logging.getDaemonLogger();
class BaseAWS {
  /**
   * @returns {import("@aws-sdk/client-sts").ClientDefaults} - sdk options
   */
  static config() {
    const logger = {
      debug: (/** @type {any[]} */ ...content) => {
        content.forEach((value) => {
          if (typeof value === 'object') {
            try {
              aws_sdk_log.debug(value);
            } catch (e) {
              daemon_log.debug(`[aws-log] ${String(value)}`);
            }
          }
          daemon_log.debug(`[aws-log] ${String(value)}`);
        });
      },
      info: (/** @type {any[]} */ ...content) => {
        content.forEach((value) => {
          if (typeof value === 'object') {
            try {
              aws_sdk_log.info(value);
            } catch (e) {
              daemon_log.info(`[aws-log] ${String(value)}`);
            }
          }
          daemon_log.info(`[aws-log] ${String(value)}`);
        });
      },
      warn: (/** @type {any[]} */ ...content) => {
        content.forEach((value) => {
          if (typeof value === 'object') {
            try {
              aws_sdk_log.warn(value);
            } catch (e) {
              daemon_log.warn(`[aws-log] ${String(value)}`);
            }
          }
          daemon_log.warn(`[aws-log] ${String(value)}`);
        });
      },
      error: (/** @type {any[]} */ ...content) => {
        content.forEach((value) => {
          if (typeof value === 'object') {
            try {
              aws_sdk_log.error(value);
            } catch (e) {
              daemon_log.error(`[aws-log] ${String(value)}`);
            }
          }
          daemon_log.error(`[aws-log] ${String(value)}`);
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
