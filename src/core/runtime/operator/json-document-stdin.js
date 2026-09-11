export const OPERATOR_JSON_STDIN_TIMEOUT_MILLISECONDS = 10_000;

/**
 * Read one bounded JSON object from noninteractive stdin. EOF is required so a
 * valid prefix cannot hide additional input, and a stalled sender cannot keep
 * an operator waiting indefinitely. The caller owns the stream; only this
 * reader's listeners and timer are removed when it settles.
 * @param {number} maximumBytes - Maximum encoded document size.
 * @param {string} label - Safe document label.
 * @param {{input?: import('node:stream').Readable & {isTTY?: boolean}, timeoutMilliseconds?: number}} [options] - Stream and deadline test seams.
 * @returns {Promise<Record<string, any>>} - One decoded JSON object.
 */
export async function readOperatorJsonObjectStdin(
  maximumBytes,
  label,
  options = {},
) {
  const input = options.input ?? process.stdin;
  const timeoutMilliseconds =
    options.timeoutMilliseconds ?? OPERATOR_JSON_STDIN_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError('JSON stdin maximumBytes must be a positive integer.');
  }
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1 ||
    timeoutMilliseconds > OPERATOR_JSON_STDIN_TIMEOUT_MILLISECONDS
  ) {
    throw new TypeError('JSON stdin deadline must be between 1 and 10000 ms.');
  }
  if (input.isTTY === true) {
    throw new Error(`${label} stdin must be a noninteractive byte stream.`);
  }
  if (
    input.destroyed ||
    input.readableEnded ||
    input.readableEncoding !== null
  ) {
    throw new Error(`${label} stdin must be an unread byte stream.`);
  }

  return await new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => {
      fail(new Error(`${label} stdin did not reach EOF before its deadline.`));
    }, timeoutMilliseconds);

    /** @returns {void} - Release only this reader's resources. */
    function cleanup() {
      settled = true;
      clearTimeout(timer);
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
      input.removeListener('close', onClose);
      input.pause();
    }

    /** @param {Error} error - Safe failure. @returns {void} - Reject once. */
    function fail(error) {
      if (settled) return;
      cleanup();
      chunks.length = 0;
      reject(error);
    }

    /** @param {unknown} chunk - Received bytes. @returns {void} - Retain bounded bytes. */
    function onData(chunk) {
      if (settled) return;
      if (!(chunk instanceof Uint8Array)) {
        fail(new Error(`${label} stdin must contain raw bytes.`));
        return;
      }
      if (chunk.byteLength > maximumBytes - size) {
        fail(
          new RangeError(
            `${label} stdin must not exceed ${maximumBytes} bytes.`,
          ),
        );
        return;
      }
      size += chunk.byteLength;
      chunks.push(Buffer.from(chunk));
    }

    /** @returns {void} - Decode only after complete input. */
    function onEnd() {
      if (settled) return;
      let document;
      try {
        document = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            Buffer.concat(chunks, size),
          ),
        );
      } catch {
        fail(new Error(`${label} stdin must contain valid UTF-8 JSON.`));
        return;
      }
      if (
        document === null ||
        typeof document !== 'object' ||
        Array.isArray(document)
      ) {
        fail(new TypeError(`${label} stdin must contain one JSON object.`));
        return;
      }
      cleanup();
      chunks.length = 0;
      resolve(document);
    }

    /** @returns {void} - Hide sender error details. */
    function onError() {
      fail(new Error(`${label} stdin could not be read.`));
    }

    /** @returns {void} - Reject a close without the required EOF. */
    function onClose() {
      fail(new Error(`${label} stdin closed before EOF.`));
    }

    input.on('data', onData);
    input.on('end', onEnd);
    input.on('error', onError);
    input.on('close', onClose);
    input.resume();
  });
}
