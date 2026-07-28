import { Buffer } from 'node:buffer';

const UNSAFE_TERMINAL_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/gu;

/**
 * Render one Unicode scalar as terminal-inert JSON escape text.
 * @param {string} value - One matched code point.
 * @returns {string} - One or two lowercase JSON Unicode escapes.
 */
function escapeUnicodeCodePoint(value) {
  const codePoint = value.codePointAt(0);
  if (codePoint === undefined) {
    throw new TypeError('Terminal-safe JSON received an empty code point.');
  }
  if (codePoint <= 0xffff) {
    return `\\u${codePoint.toString(16).padStart(4, '0')}`;
  }
  const scalar = codePoint - 0x10000;
  const high = 0xd800 + (scalar >> 10);
  const low = 0xdc00 + (scalar & 0x3ff);
  return `\\u${high.toString(16).padStart(4, '0')}\\u${low
    .toString(16)
    .padStart(4, '0')}`;
}

/**
 * JSON-render one value without leaving terminal controls active. Escaping
 * serialized text preserves the exact value recovered by JSON.parse.
 * @param {unknown} value - Strict JSON value.
 * @returns {string} - Terminal-inert JSON text.
 */
export function renderTerminalSafeJson(value) {
  const json = JSON.stringify(value);
  if (typeof json !== 'string') {
    throw new TypeError('Terminal-safe JSON requires a serializable value.');
  }
  return json.replace(UNSAFE_TERMINAL_CHARACTER, escapeUnicodeCodePoint);
}

/**
 * Render terminal-inert JSON and bound the actual escaped transport bytes.
 * Raw JSON byte limits are insufficient because one Unicode control scalar
 * can expand into one or two six-byte escape units.
 * @param {unknown} value - Strict JSON value.
 * @param {number} maxBytes - Maximum terminal-safe UTF-8 byte length.
 * @param {string} [label] - Human-readable value name.
 * @returns {string} - Bounded terminal-inert JSON text.
 */
export function renderBoundedTerminalSafeJson(
  value,
  maxBytes,
  label = 'Terminal-safe JSON',
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError(`${label} byte limit must be a positive safe integer.`);
  }
  const rendered = renderTerminalSafeJson(value);
  if (Buffer.byteLength(rendered, 'utf8') > maxBytes) {
    throw new TypeError(`${label} exceeds its encoded byte limit.`);
  }
  return rendered;
}

export default renderTerminalSafeJson;
