import { inspect, isDeepStrictEqual } from 'node:util';
import * as Diff from 'diff';

/**
 * @typedef JsonDelta
 * @property {any} oldValue - Previous value.
 * @property {any} newValue - Next value.
 */

/**
 * @param {any} value - value.
 * @returns {string} - Result.
 */
function inspectValue(value) {
  return inspect(value, {
    depth: Number.POSITIVE_INFINITY,
    colors: false,
    compact: false,
    sorted: true,
    breakLength: 80,
  });
}

/**
 * @param {{ added?: boolean, removed?: boolean, value: string }} chunk - chunk.
 * @returns {string[]} - Result.
 */
function formatChunk(chunk) {
  const prefix = chunk.added ? '+' : chunk.removed ? '-' : ' ';

  return chunk.value
    .split('\n')
    .filter(
      (line, index, lines) => !(index === lines.length - 1 && line === ''),
    )
    .map((line) => `${prefix} ${line}`);
}

/**
 * @param {any} oldValue - oldValue.
 * @param {any} newValue - newValue.
 * @returns {JsonDelta | undefined} - Result.
 */
export function diff(oldValue, newValue) {
  if (isDeepStrictEqual(oldValue, newValue)) {
    return undefined;
  }

  return {
    oldValue,
    newValue,
  };
}

/**
 * @param {JsonDelta | undefined} delta - delta.
 * @returns {string} - Result.
 */
export function formatConsoleDelta(delta) {
  if (!delta) {
    return '';
  }

  const oldValue = `${inspectValue(delta.oldValue)}\n`;
  const newValue = `${inspectValue(delta.newValue)}\n`;

  return Diff.diffLines(oldValue, newValue)
    .flatMap((chunk) => formatChunk(chunk))
    .join('\n');
}
