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
              switch (process.env.LOGGING_FORMAT) {
                case 'json':
                  aws_sdk_log.debug(value);
                  break;
                case 'cli':
                  aws_sdk_log.debug(JSON.stringify(value));
                  break;
                default:
                  aws_sdk_log.debug(value);
                  break;
              }
            } catch (e) {
              daemon_log.debug(`[aws-log] ${String(value)}`);
            }
          } else {
            daemon_log.debug(`[aws-log] ${String(value)}`);
          }
        });
      },
      info: (/** @type {any[]} */ ...content) => {
        content.forEach((value) => {
          if (typeof value === 'object') {
            try {
              switch (process.env.LOGGING_FORMAT) {
                case 'json':
                  aws_sdk_log.info(value);
                  break;
                case 'cli':
                  aws_sdk_log.info(JSON.stringify(value));
                  break;
                default:
                  aws_sdk_log.info(value);
                  break;
              }
            } catch (e) {
              daemon_log.info(`[aws-log] ${String(value)}`);
            }
          } else {
            daemon_log.info(`[aws-log] ${String(value)}`);
          }
        });
      },
      warn: (/** @type {any[]} */ ...content) => {
        content.forEach((value) => {
          if (typeof value === 'object') {
            try {
              switch (process.env.LOGGING_FORMAT) {
                case 'json':
                  aws_sdk_log.warn(value);
                  break;
                case 'cli':
                  aws_sdk_log.warn(JSON.stringify(value));
                  break;
                default:
                  aws_sdk_log.warn(value);
                  break;
              }
            } catch (e) {
              daemon_log.warn(`[aws-log] ${String(value)}`);
            }
          } else {
            daemon_log.warn(`[aws-log] ${String(value)}`);
          }
        });
      },
      error: (/** @type {any[]} */ ...content) => {
        content.forEach((value) => {
          if (typeof value === 'object') {
            try {
              switch (process.env.LOGGING_FORMAT) {
                case 'json':
                  aws_sdk_log.error(value);
                  break;
                case 'cli':
                  aws_sdk_log.error(JSON.stringify(value));
                  break;
                default:
                  aws_sdk_log.error(value);
                  break;
              }
            } catch (e) {
              daemon_log.error(`[aws-log] ${String(value)}`);
            }
          } else {
            daemon_log.error(`[aws-log] ${String(value)}`);
          }
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
