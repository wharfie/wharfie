'use strict';
const logging = require('./logging');
const aws_sdk_log = logging.getAWSSDKLogger();
const daemon_log = logging.getDaemonLogger();
class BaseAWS {
  /**
   * '$' is not allowed in the name of a property in the JSON format and breaks querying
   * @param {any} log -
   * @returns {any} -
   */
  static formatJsonLog(log) {
    if (log.message && log.message.error) {
      if (log.message.error.$fault) {
        log.message.error.fault = log.message.error.$fault;
        delete log.message.error.$fault;
      }
      if (log.message.error.$metadata) {
        log.message.error.metadata = log.message.error.$metadata;
        delete log.message.error.$metadata;
      }
    }
    return log;
  }

  /**
   * @returns {import("@aws-sdk/client-sts").ClientDefaults} - sdk options
   */
  static config() {
    const logger = {
      debug: (/** @type {any[]} */ ...content) => {
        content.forEach((value) => {
          if (typeof value === 'object') {
            if (value.input) {
              const stringifiedInput = JSON.stringify(value.input);
              if (stringifiedInput.length > 1000) {
                value.input = `TRUNCATED: ${stringifiedInput.slice(
                  0,
                  1000
                )}...`;
              }
            }
            try {
              switch (process.env.LOGGING_FORMAT || 'json') {
                case 'json':
                  aws_sdk_log.debug(this.formatJsonLog(value));
                  break;
                case 'cli':
                  aws_sdk_log.debug(JSON.stringify(value));
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
            if (value.input) {
              const stringifiedInput = JSON.stringify(value.input);
              if (stringifiedInput.length > 1000) {
                value.input = `TRUNCATED: ${stringifiedInput.slice(
                  0,
                  1000
                )}...`;
              }
            }
            try {
              switch (process.env.LOGGING_FORMAT || 'json') {
                case 'json':
                  aws_sdk_log.info(this.formatJsonLog(value));
                  break;
                case 'cli':
                  aws_sdk_log.info(JSON.stringify(value));
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
            if (value.input) {
              const stringifiedInput = JSON.stringify(value.input);
              if (stringifiedInput.length > 1000) {
                value.input = `TRUNCATED: ${stringifiedInput.slice(
                  0,
                  1000
                )}...`;
              }
            }
            try {
              switch (process.env.LOGGING_FORMAT || 'json') {
                case 'json':
                  aws_sdk_log.warn(this.formatJsonLog(value));
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
            if (value.input) {
              const stringifiedInput = JSON.stringify(value.input);
              if (stringifiedInput.length > 1000) {
                value.input = `TRUNCATED: ${stringifiedInput.slice(
                  0,
                  1000
                )}...`;
              }
            }
            try {
              switch (process.env.LOGGING_FORMAT || 'json') {
                case 'json':
                  aws_sdk_log.error(this.formatJsonLog(value));
                  break;
                case 'cli':
                  aws_sdk_log.error(JSON.stringify(value));
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
