/**
 * Promise utilities using native Node.js promises.
 *
 * This module centralizes small helpers the codebase needs that are not part of
 * the built-in Promise API (e.g., concurrency-limited mapping).
 *
 * Node 24+ already provides modern primitives like Promise.any and
 * Promise.allSettled; we only implement what isn't built-in.
 */

/**
 * Concurrent async map with stable result ordering.
 * @template T, U
 * @param {Iterable<T> | ArrayLike<T>} iterable - Input values.
 * @param {(value: T, index: number, items: T[]) => (U | Promise<U>)} mapper - Mapping function.
 * @param {{ concurrency?: number }} [options] - Options.
 * @returns {Promise<U[]>} Results in the same order as the input.
 */
export async function map(iterable, mapper, options = {}) {
  if (iterable == null) {
    throw new TypeError('map() expects an iterable input');
  }
  if (typeof mapper !== 'function') {
    throw new TypeError('map() expects a mapper function');
  }

  /** @type {T[]} */
  const items = Array.isArray(iterable) ? iterable : Array.from(iterable);

  // Normalize concurrency (default: unlimited).
  let concurrency =
    options.concurrency === undefined || options.concurrency === null
      ? Infinity
      : Number(options.concurrency);

  if (concurrency === Infinity || concurrency >= items.length) {
    // Fast path: no concurrency limiting required.
    return await Promise.all(
      items.map((value, index) => mapper(value, index, items)),
    );
  }

  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new RangeError(
      `map() concurrency must be a positive finite number, got: ${options.concurrency}`,
    );
  }

  concurrency = Math.floor(concurrency);
  const results = new Array(items.length);

  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  const workers = new Array(workerCount);
  for (let w = 0; w < workerCount; w += 1) {
    workers[w] = (async () => {
      while (true) {
        const idx = nextIndex;
        nextIndex += 1;
        if (idx >= items.length) return;

        results[idx] = await mapper(items[idx], idx, items);
      }
    })();
  }

  await Promise.all(workers);
  return results;
}
