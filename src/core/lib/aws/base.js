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
   * @param {BaseAWSConfig} options - Retry configuration.
   * @param {import('../../runtime/aws-provider-module.js').AwsSdkBindings} bindings - Fixed provider bindings.
   * @returns {{ retryStrategy: any }} - AWS SDK client configuration.
   */
  static config(options = {}, bindings) {
    const ConfiguredRetryStrategy =
      bindings?.utilRetry?.ConfiguredRetryStrategy;
    if (typeof ConfiguredRetryStrategy !== 'function') {
      throw new TypeError('AWS provider retry binding is invalid.');
    }
    const configuredAttempts = Number(options.maxAttempts);
    const maxAttempts =
      Number.isSafeInteger(configuredAttempts) && configuredAttempts > 0
        ? configuredAttempts
        : 20;

    return {
      retryStrategy: new ConfiguredRetryStrategy(
        maxAttempts,
        (/** @type {number} */ attempt) =>
          Math.floor(Math.random() * Math.min(20, Math.pow(2, attempt))),
      ),
    };
  }
}

export default BaseAWS;
