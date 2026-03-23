/**
 * @typedef ResourceScope
 * @property {any} [stateStore] - Scoped runtime state store.
 * @property {any} [stateDB] - Compatibility alias for the scoped state store.
 * @property {import('node:events').EventEmitter} [telemetry] - Scoped telemetry emitter.
 * @property {import('node:events').EventEmitter} [emitter] - Compatibility alias for the scoped telemetry emitter.
 * @property {import('./runtime-config.js').WharfieRuntimeConfig} [runtime] - Structured runtime configuration.
 */

/** @type {ResourceScope[]} */
const scopeStack = [];

/**
 * Run a synchronous callback with a temporary resource scope.
 *
 * Child resources created inside the callback inherit the scoped runtime
 * configuration unless they are configured explicitly.
 * @template T
 * @param {ResourceScope} scope - scope.
 * @param {() => T} fn - fn.
 * @returns {T} - Result.
 */
export function withResourceScope(scope, fn) {
  scopeStack.push(scope);
  try {
    return fn();
  } finally {
    scopeStack.pop();
  }
}

/**
 * @returns {ResourceScope | undefined} - Result.
 */
export function getCurrentResourceScope() {
  return scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined;
}

export default {
  withResourceScope,
  getCurrentResourceScope,
};
