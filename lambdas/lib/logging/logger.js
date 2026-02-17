import ConsoleLogTransport from './console-log-transport.js';

/**
 * @typedef LoggerOptions
 * @property {string} [level] - level.
 * @property {(import('./console-log-transport.js').default|import('./firehose-log-transport.js').default)[]} [transports] - transports.
 * @property {boolean} [jsonFormat] - jsonFormat.
 * @property {Object} [base] - base.
 */

/**
 * @typedef LoggerChildOptions
 * @property {string} [level] - level.
 * @property {Object} [metadata] - metadata.
 */

class Logger {
  /**
   * @param {LoggerOptions} options - options.
   */
  constructor(options = {}) {
    this.level = options.level || 'info';
    /** @type {{ [key: string]: number }} */
    this.levels = {
      debug: 1,
      info: 2,
      warn: 3,
      error: 4,
    };
    this.transports = options.transports || [new ConsoleLogTransport()];
    this.jsonFormat = options.jsonFormat || false;
    this.base = options.base || {};
  }

  /**
   * @param {string} level - level.
   * @param {string | Object} message - message.
   * @param {Object} [metadata] - metadata.
   * @returns {void} - Result.
   */
  log(level, message, metadata = {}) {
    if (this.levels[level] < this.levels[this.level]) {
      return;
    }
    const timestamp = new Date().toISOString();
    const logData = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...this.base,
      ...metadata,
    };
    const formattedMessage = this.jsonFormat
      ? JSON.stringify(logData)
      : `[${logData.timestamp}] [${logData.level}] ${
          logData.message instanceof Object
            ? JSON.stringify(logData.message)
            : logData.message
        }`;

    this.transports.forEach((transport) => {
      transport.write(formattedMessage + '\n');
    });
  }

  /**
   * @param {string | Object} message - message.
   * @param {Object} [metadata] - metadata.
   * @returns {void} - Result.
   */
  debug(message, metadata = {}) {
    this.log('debug', message, metadata);
  }

  /**
   * @param {string | Object} message - message.
   * @param {Object} [metadata] - metadata.
   * @returns {void} - Result.
   */
  info(message, metadata = {}) {
    this.log('info', message, metadata);
  }

  /**
   * @param {string | Object} message - message.
   * @param {Object} [metadata] - metadata.
   * @returns {void} - Result.
   */
  warn(message, metadata = {}) {
    this.log('warn', message, metadata);
  }

  /**
   * @param {string | Object} message - message.
   * @param {Object} [metadata] - metadata.
   * @returns {void} - Result.
   */
  error(message, metadata = {}) {
    this.log('error', message, metadata);
  }

  /**
   * @param {LoggerChildOptions} options - options.
   * @returns {Logger} - Result.
   */
  child(options = {}) {
    return new Logger({
      level: options.level || this.level,
      jsonFormat: this.jsonFormat,
      transports: this.transports,
      base: { ...this.base, ...(options.metadata || {}) },
    });
  }

  async flush() {
    await Promise.all(this.transports.map((t) => t.flush()));
  }

  async close() {
    await Promise.all(
      this.transports.map(
        (transport) =>
          new Promise((resolve) => {
            transport.on('close', resolve);
            transport.end();
          }),
      ),
    );
  }
}

export default Logger;
