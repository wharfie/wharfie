import { Writable } from 'stream';

/**
 * @typedef ConsoleLogTransportOptions
 * @property {number} [flushInterval] -
 */

class ConsoleLogTransport extends Writable {
  /**
   * @param {ConsoleLogTransportOptions} [options] -a
   */
  constructor(options = {}) {
    super();
  }

  /**
   * @param {(error: Error | null | undefined) => void} callback -
   */
  async _final(callback) {
    try {
      callback(null);
    } catch (err) {
      if (err instanceof Error) {
        callback(err);
      } else {
        callback(new Error(`Unknown error: ${err}`));
      }
    }
  }

  /**
   * @param {any} chunk -
   * @param {string} _encoding -
   * @param {(error: Error | null | undefined) => void} callback -
   */
  async _write(chunk, _encoding, callback) {
    try {
      console.log(chunk.toString());
      callback(null);
    } catch (err) {
      if (err instanceof Error) {
        callback(err);
      } else {
        callback(new Error(`Unknown error: ${err}`));
      }
    }
  }

  async flush() {}
}

export default ConsoleLogTransport;
