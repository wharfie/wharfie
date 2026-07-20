import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();
const LAYOUT_KEYS = Object.freeze([
  'appId',
  'dataRoot',
  'appRoot',
  'stateRoot',
  'controlPath',
  'payloadPath',
  'applicationStatePath',
  'sessionPath',
  'executionLedgerTable',
]);

/**
 * Run one packaged application inside its immutable local-storage authority.
 * Async context keeps the routing decision explicit and process-local without
 * publishing hidden environment variables or leaking configuration between
 * independent application invocations in tests.
 * @template T
 * @param {Readonly<Record<string, string>>} layout - Validated app-scoped storage layout.
 * @param {() => T} handler - Packaged application bootstrap.
 * @returns {T} - Handler result.
 */
export function withLocalAppStorageLayout(layout, handler) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
    throw new TypeError('Local app storage layout must be an object.');
  }
  if (!Object.isFrozen(layout)) {
    throw new TypeError('Local app storage layout must be immutable.');
  }
  const actualKeys = Object.keys(layout);
  if (
    actualKeys.length !== LAYOUT_KEYS.length ||
    actualKeys.some((key) => !LAYOUT_KEYS.includes(key)) ||
    LAYOUT_KEYS.some(
      (key) => typeof layout[key] !== 'string' || !layout[key].length,
    )
  ) {
    throw new TypeError('Local app storage layout is malformed.');
  }
  if (typeof handler !== 'function') {
    throw new TypeError('Local app storage handler must be a function.');
  }
  return storage.run(layout, handler);
}

/**
 * @returns {Readonly<Record<string, string>> | undefined} - Current packaged application storage authority.
 */
export function getLocalAppStorageLayout() {
  return storage.getStore();
}

export default withLocalAppStorageLayout;
