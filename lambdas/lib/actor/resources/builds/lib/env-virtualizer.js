// env-virtualizer.js
'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

/**
 * @typedef {Partial<Record<string, string>>} EnvOverrides
 */

/**
 * @typedef {{
 *   overrides: EnvOverrides
 * }} Store
 */

const als = new AsyncLocalStorage();

/** Keep a base snapshot of host env */
const baseEnv = { ...process.env };

/**
 * Proxy for env, checks ALS store first.
 */
const envProxy = new Proxy(baseEnv, {
  get(target, prop) {
    if (typeof prop !== 'string') return Reflect.get(target, prop);
    const store = /** @type {Store|undefined} */ (als.getStore());
    if (
      store?.overrides &&
      Object.prototype.hasOwnProperty.call(store.overrides, prop)
    ) {
      return store.overrides[prop];
    }
    return Reflect.get(target, prop);
  },
  set(target, prop, value) {
    if (typeof prop !== 'string') return Reflect.set(target, prop, value);
    const store = /** @type {Store|undefined} */ (als.getStore());
    if (
      store?.overrides &&
      Object.prototype.hasOwnProperty.call(store.overrides, prop)
    ) {
      store.overrides[prop] = String(value);
      return true;
    }
    target[prop] = String(value);
    return true;
  },
  has(target, prop) {
    if (typeof prop !== 'string') return Reflect.has(target, prop);
    const store = /** @type {Store|undefined} */ (als.getStore());
    return (
      (store?.overrides &&
        Object.prototype.hasOwnProperty.call(store.overrides, prop)) ||
      Reflect.has(target, prop)
    );
  },
  ownKeys(target) {
    const store = /** @type {Store|undefined} */ (als.getStore());
    const overrideKeys = store?.overrides ? Object.keys(store.overrides) : [];
    return Array.from(new Set([...Reflect.ownKeys(target), ...overrideKeys]));
  },
  getOwnPropertyDescriptor(target, prop) {
    if (typeof prop !== 'string')
      return Reflect.getOwnPropertyDescriptor(target, prop);
    const store = /** @type {Store|undefined} */ (als.getStore());
    let value;
    if (
      store?.overrides &&
      Object.prototype.hasOwnProperty.call(store.overrides, prop)
    ) {
      value = store.overrides[prop];
    } else {
      value = Reflect.get(target, prop);
    }
    if (typeof value === 'undefined') return undefined;
    return { value, writable: true, enumerable: true, configurable: true };
  },
});

/**
 * Proxy for process: only virtualize .env
 */
const processProxy = new Proxy(process, {
  get(target, prop, receiver) {
    if (prop === 'env') return envProxy;
    // Per-task platform/arch virtualization
    if (prop === 'platform' || prop === 'arch') {
      const store = /** @type {Store|undefined} */ (als.getStore());
      // explicit overrides take precedence
      const explicit =
        store?.overrides &&
        (prop === 'platform'
          ? store.overrides.__platform
          : store.overrides.__arch);
      if (explicit) return explicit;
      // fallback to npm_config_* if provided
      const fromEnv =
        prop === 'platform'
          ? envProxy.npm_config_platform || envProxy.npm_config_os
          : envProxy.npm_config_arch || envProxy.npm_config_cpu;
      if (fromEnv) return fromEnv;
      return Reflect.get(target, prop, receiver);
    }
    return Reflect.get(target, prop, receiver);
  },
  set(target, prop, value, receiver) {
    if (prop === 'env') return true; // ignore attempts to replace env
    return Reflect.set(target, prop, value, receiver);
  },
  has(target, prop) {
    if (prop === 'env') return true;
    return Reflect.has(target, prop);
  },
  getOwnPropertyDescriptor(target, prop) {
    if (prop === 'env') {
      return {
        value: envProxy,
        writable: true,
        enumerable: true,
        configurable: true,
      };
    }
    return Reflect.getOwnPropertyDescriptor(target, prop);
  },
});

/** Swap process.env and global.process (env-only virtualization) */
Object.defineProperty(process, 'env', {
  value: envProxy,
  writable: true,
  enumerable: true,
  configurable: true,
});
global.process = /** @type {any} */ (processProxy);

/**
 * Run a function with task-local env overrides.
 *
 * @template T
 * @param {EnvOverrides} overrides
 * @param {() => Promise<T>|T} fn
 * @returns {Promise<T>|T}
 */
function runWithVirtualEnv(overrides, fn) {
  const store = /** @type {Store} */ ({
    overrides: { ...overrides },
  });
  return als.run(store, fn);
}

module.exports = { runWithVirtualEnv };
