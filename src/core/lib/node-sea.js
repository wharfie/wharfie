/**
 * @typedef {typeof import('node:sea')} NodeSeaModule
 */

/**
 * Resolve `node:sea` lazily so the repo can still be linted and tested on Node
 * runtimes older than the SEA builtin, while preserving native behavior on
 * supported Node releases.
 * @type {NodeSeaModule | null}
 */
let nodeSeaModule = null;

try {
  // eslint-disable-next-line import/no-unresolved
  nodeSeaModule = await import('node:sea');
} catch {
  nodeSeaModule = null;
}

/**
 * @param {string} name - SEA asset name.
 * @param {string} [encoding] - Optional asset encoding.
 * @returns {any} - Asset contents.
 */
export function getAsset(name, encoding) {
  if (typeof nodeSeaModule?.getAsset !== 'function') {
    throw new Error('node:sea is unavailable in this Node.js runtime');
  }

  return typeof encoding === 'string'
    ? nodeSeaModule.getAsset(name, encoding)
    : nodeSeaModule.getAsset(name);
}

/**
 * @returns {boolean} - Whether the current runtime is a SEA binary.
 */
export function isSea() {
  return typeof nodeSeaModule?.isSea === 'function'
    ? nodeSeaModule.isSea()
    : false;
}

export default {
  getAsset,
  isSea,
};
