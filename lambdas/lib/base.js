'use strict';
const logging = require('./logging');
const daemon_log = logging.getDaemonLogger();
class BaseAWS {
  /**
   *
   * @returns {import("@aws-sdk/client-sts").STSClientConfig} - sdk options
   */
  static config() {
    // const backoff = (
    //   /** @type {number} */ retryCount,
    //   /** @type {any} */ error
    // ) => {
    //   if (error)
    //     daemon_log.info(
    //       `[${error.statusCode} ${error.hostname} ${error.region} ${retryCount}] ${error.name} - ${error.message}`
    //     );
    //   return Math.floor(
    //     Math.random() * Math.min(5000, 1 * Math.pow(2, retryCount))
    //   );
    // };

    const logger = {
      debug: (/** @type {any[]} */ ...content) => {
        const joined_content = content
          .map((value) => {
            if (typeof value === 'object') {
              try {
                return JSON.stringify(value);
              } catch (e) {
                // Converting circular structure to JSON\n --> starting at object with constructor 'TLSSocket'\n | property 'parser' -> object with constructor 'HTTPParser'\n --- property 'socket' closes the circle\n at JSON.stringify (<anonymous>)\n at value (/lambdas/lib/base.js:42:27)
                return String(value);
              }
            }
            return String(value);
          })
          .join(' ');
        daemon_log.debug(
          joined_content.substring(0, Math.min(1000, joined_content.length))
        );
      },
      info: (/** @type {any[]} */ ...content) => {
        const joined_content = content
          .map((value) => {
            if (typeof value === 'object') {
              try {
                return JSON.stringify(value);
              } catch (e) {
                return String(value);
              }
            }
            return String(value);
          })
          .join(' ');
        daemon_log.debug(
          joined_content.substring(0, Math.min(1000, joined_content.length))
        );
      },
      warn: (/** @type {any[]} */ ...content) => {
        const joined_content = content
          .map((value) => {
            if (typeof value === 'object') {
              try {
                return JSON.stringify(value);
              } catch (e) {
                return String(value);
              }
            }
            return String(value);
          })
          .join(' ');
        daemon_log.warn(
          joined_content.substring(0, Math.min(1000, joined_content.length))
        );
      },
      error: (/** @type {any[]} */ ...content) => {
        const joined_content = content
          .map((value) => {
            if (typeof value === 'object') {
              try {
                return JSON.stringify(value);
              } catch (e) {
                return String(value);
              }
            }
            return String(value);
          })
          .join(' ');
        daemon_log.error(
          joined_content.substring(0, Math.min(1000, joined_content.length))
        );
      },
    };
    return {
      maxAttempts: 20,
      retryMode: 'adaptive',
      // @ts-ignore
      logger,
    };
  }
}

module.exports = BaseAWS;
