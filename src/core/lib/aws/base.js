import { ConfiguredRetryStrategy } from '@smithy/util-retry';

/**
 * @typedef BaseAWSConfig
 * @property {number} [maxAttempts] - Maximum SDK attempts.
 */

/**
 * Shared AWS SDK client configuration used by the supported resource adapters.
 * Logging belongs to the host application, so constructing an adapter has no
 * logging side effects.
 */
class BaseAWS {
  /**
   * @param {BaseAWSConfig} [options] - Retry configuration.
   * @returns {{ retryStrategy: ConfiguredRetryStrategy }} - AWS SDK client configuration.
   */
  static config(options = {}) {
    const configuredAttempts = Number(options.maxAttempts);
    const maxAttempts =
      Number.isSafeInteger(configuredAttempts) && configuredAttempts > 0
        ? configuredAttempts
        : 20;

    return {
      retryStrategy: new ConfiguredRetryStrategy(maxAttempts, (attempt) =>
        Math.floor(Math.random() * Math.min(20, Math.pow(2, attempt))),
      ),
    };
  }
}

export default BaseAWS;
