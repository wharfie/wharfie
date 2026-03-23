import EventEmitter from 'node:events';

/**
 * @typedef {(eventName: string, payload: any) => void} TelemetryEmitHandler
 */

/**
 * @typedef RuntimeTelemetryAdapter
 * @property {import('node:events').EventEmitter} [emitter] - Optional backing emitter.
 * @property {TelemetryEmitHandler} [emit] - Optional emit callback.
 * @property {(eventName: string, listener: (...args: any[]) => void) => any} [on] - Optional subscription function.
 */

/**
 * @typedef {import('node:events').EventEmitter | TelemetryEmitHandler | RuntimeTelemetryAdapter} RuntimeTelemetryConfig
 */

/**
 * @typedef WharfieRuntimeConfig
 * @property {any} [stateStore] - Scoped runtime state store.
 * @property {RuntimeTelemetryConfig} [telemetry] - Scoped runtime telemetry.
 */

/**
 * @param {unknown} value - value.
 * @returns {value is import('node:events').EventEmitter} - Result.
 */
function isEventEmitter(value) {
  return (
    value instanceof EventEmitter ||
    (isTelemetryAdapter(value) &&
      typeof value.emit === 'function' &&
      typeof value.on === 'function')
  );
}

/**
 * @param {unknown} value - value.
 * @returns {value is RuntimeTelemetryAdapter} - Result.
 */
function isTelemetryAdapter(value) {
  return !!value && typeof value === 'object';
}

/**
 * @param {TelemetryEmitHandler | undefined} emit - emit.
 * @param {import('node:events').EventEmitter | undefined} emitter - emitter.
 * @returns {import('node:events').EventEmitter | undefined} - Result.
 */
function createTelemetryEmitter(emit, emitter) {
  if (typeof emit !== 'function' && !isEventEmitter(emitter)) {
    return undefined;
  }

  if (typeof emit !== 'function' && isEventEmitter(emitter)) {
    return emitter;
  }

  const telemetryEmitter = new EventEmitter();
  const baseEmit = telemetryEmitter.emit.bind(telemetryEmitter);
  telemetryEmitter.emit = function emitWithForwarding(eventName, ...args) {
    if (typeof emit === 'function') {
      emit(String(eventName), args[0]);
    }
    if (isEventEmitter(emitter)) {
      emitter.emit(eventName, ...args);
    }
    return baseEmit(eventName, ...args);
  };

  return telemetryEmitter;
}

/**
 * @param {unknown} telemetry - telemetry.
 * @returns {import('node:events').EventEmitter | undefined} - Result.
 */
export function normalizeTelemetryEmitter(telemetry) {
  if (isEventEmitter(telemetry)) {
    return telemetry;
  }

  if (typeof telemetry === 'function') {
    return createTelemetryEmitter(
      /** @type {TelemetryEmitHandler} */ (telemetry),
      undefined,
    );
  }

  if (!isTelemetryAdapter(telemetry)) {
    return undefined;
  }

  const emit =
    typeof telemetry.emit === 'function'
      ? /** @type {TelemetryEmitHandler} */ (telemetry.emit).bind(telemetry)
      : undefined;
  const emitter = isEventEmitter(telemetry.emitter)
    ? telemetry.emitter
    : undefined;

  return createTelemetryEmitter(emit, emitter);
}

/**
 * @param {{
 *   runtime?: WharfieRuntimeConfig | undefined,
 *   stateDB?: any,
 *   emitter?: import('node:events').EventEmitter | undefined,
 *   scope?: import('./resource-scope.js').ResourceScope | undefined,
 *   defaultEmitter?: import('node:events').EventEmitter | undefined,
 * }} options - options.
 * @returns {{ stateStore: any, telemetry: import('node:events').EventEmitter }} - Result.
 */
export function normalizeRuntimeConfig({
  runtime,
  stateDB,
  emitter,
  scope,
  defaultEmitter,
}) {
  const stateStore =
    runtime?.stateStore ??
    scope?.runtime?.stateStore ??
    scope?.stateStore ??
    scope?.stateDB ??
    stateDB;

  const telemetry =
    normalizeTelemetryEmitter(
      runtime?.telemetry ??
        scope?.runtime?.telemetry ??
        scope?.telemetry ??
        scope?.emitter ??
        emitter,
    ) ??
    defaultEmitter ??
    new EventEmitter();

  return {
    stateStore,
    telemetry,
  };
}

/**
 * @param {{ stateStore: any, telemetry: import('node:events').EventEmitter }} runtimeConfig - runtimeConfig.
 * @returns {import('./resource-scope.js').ResourceScope} - Result.
 */
export function createResourceScope(runtimeConfig) {
  return {
    runtime: runtimeConfig,
    stateStore: runtimeConfig.stateStore,
    stateDB: runtimeConfig.stateStore,
    telemetry: runtimeConfig.telemetry,
    emitter: runtimeConfig.telemetry,
  };
}

export default {
  normalizeTelemetryEmitter,
  normalizeRuntimeConfig,
  createResourceScope,
};
