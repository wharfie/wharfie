/**
 * @typedef {typeof import('node:sea')} NodeSeaModule
 */

/**
 * Resolve `node:sea` lazily without top-level await so the module can still be
 * bundled into CommonJS SEA artifacts. Older Node.js releases that lack either
 * `process.getBuiltinModule()` or the `node:sea` builtin fall back to `null`.
 *
 * `undefined` means the module has not been resolved yet.
 * @type {NodeSeaModule | null | undefined}
 */
let nodeSeaModule;

/**
 * @returns {NodeSeaModule | null} - Result.
 */
function resolveNodeSeaModule() {
  if (nodeSeaModule !== undefined) {
    return nodeSeaModule;
  }

  if (typeof process.getBuiltinModule !== 'function') {
    nodeSeaModule = null;
    return nodeSeaModule;
  }

  try {
    nodeSeaModule =
      /** @type {NodeSeaModule | undefined} */ (
        process.getBuiltinModule('node:sea')
      ) || null;
  } catch {
    nodeSeaModule = null;
  }

  return nodeSeaModule;
}

/**
 * @param {string} name - SEA asset name.
 * @param {string} [encoding] - Optional asset encoding.
 * @returns {any} - Asset contents.
 */
export function getAsset(name, encoding) {
  const resolvedNodeSeaModule = resolveNodeSeaModule();

  if (typeof resolvedNodeSeaModule?.getAsset !== 'function') {
    throw new Error('node:sea is unavailable in this Node.js runtime');
  }

  return typeof encoding === 'string'
    ? resolvedNodeSeaModule.getAsset(name, encoding)
    : resolvedNodeSeaModule.getAsset(name);
}

/**
 * @returns {boolean} - Whether the current runtime is a SEA binary.
 */
export function isSea() {
  const resolvedNodeSeaModule = resolveNodeSeaModule();

  return typeof resolvedNodeSeaModule?.isSea === 'function'
    ? resolvedNodeSeaModule.isSea()
    : false;
}

export default {
  getAsset,
  isSea,
};
