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

  if (typeof resolvedNodeSeaModule?.getAsset === 'function') {
    return typeof encoding === 'string'
      ? resolvedNodeSeaModule.getAsset(name, encoding)
      : resolvedNodeSeaModule.getAsset(name);
  }

  throw new Error('node:sea is unavailable in this Node.js runtime');
}

/**
 * Read a SEA asset without copying its bytes.
 *
 * Node owns the returned ArrayBuffer for the lifetime of the executable. Callers
 * must therefore treat it as immutable and keep the SEA process alive while a
 * derived view or stream is in use.
 * @param {string} name - SEA asset name.
 * @returns {ArrayBuffer} - Node-owned asset bytes.
 */
export function getRawAsset(name) {
  const resolvedNodeSeaModule = resolveNodeSeaModule();

  if (typeof resolvedNodeSeaModule?.getRawAsset === 'function') {
    return resolvedNodeSeaModule.getRawAsset(name);
  }

  throw new Error('node:sea raw asset access is unavailable in this runtime');
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
  getRawAsset,
  isSea,
};
