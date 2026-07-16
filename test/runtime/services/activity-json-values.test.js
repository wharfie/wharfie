/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { runInNewContext } from 'node:vm';

import {
  cloneJsonObject,
  cloneJsonValue,
} from '../../../src/core/runtime/json-value.js';

const APP_RUNS_IMPORT = '../../../src/core/runtime/app-runs.js';
const FUNCTION_IMPORT = '../../../src/core/resources/builds/function.js';
const RUNTIME_RESOURCES_IMPORT = '../../../src/core/runtime/resources.js';

/** @type {{ mode: string, event: any, context: any, resources: any }[]} */
const invocationCalls = [];
/** @type {any[]} */
const rawResults = [];
/** @type {(event: any, context: any) => any} */
let resultFactory = (event, context) => ({ event, context });

/**
 * @param {string} mode - Execution path.
 * @param {any} event - Activity event.
 * @param {any} context - Activity context.
 * @param {any} resources - Runtime resources.
 * @returns {Promise<any>} - Activity result.
 */
async function executeActivity(mode, event, context, resources) {
  invocationCalls.push({ mode, event, context, resources });
  const result = await resultFactory(event, context);
  rawResults.push(result);
  return result;
}

class MockWharfieFunction {
  /** @param {any} _options - Function options. */
  constructor(_options) {}

  /**
   * @param {any} event - Activity event.
   * @param {any} context - Activity context.
   * @param {any} options - Invocation options.
   * @returns {Promise<any>} - Activity result.
   */
  async fn(event, context, options) {
    return await executeActivity(
      'source',
      event,
      context,
      options.baseResources,
    );
  }

  async closeRuntimeResources() {}

  /**
   * @param {string} _name - Activity name.
   * @param {any} event - Activity event.
   * @param {any} context - Activity context.
   * @param {any} options - Invocation options.
   * @returns {Promise<any>} - Activity result.
   */
  static async run(_name, event, context, options) {
    return await executeActivity('embedded', event, context, options.resources);
  }
}

const createActorSystemResources = jest.fn(async () => ({
  resources: { boundaryTestResource: true },
  close: jest.fn(async () => {}),
}));

jest.unstable_mockModule(FUNCTION_IMPORT, () => ({
  default: MockWharfieFunction,
}));
jest.unstable_mockModule(RUNTIME_RESOURCES_IMPORT, () => ({
  createActorSystemResources,
}));

const activityManifest = {
  app: { name: 'json-boundary-test' },
  activities: {
    echo: {
      entrypoint: { path: '/unused/echo.js', export: 'echo' },
    },
  },
};

beforeEach(() => {
  invocationCalls.length = 0;
  rawResults.length = 0;
  resultFactory = (event, context) => ({ event, context });
  createActorSystemResources.mockClear();
});

describe('JSON activity values', () => {
  it('clones valid JSON values without retaining caller references', () => {
    const shared = { count: 1 };
    const value = {
      left: shared,
      right: shared,
      array: [null, true, 'value', 4.5],
    };

    const clone = cloneJsonValue(value);

    expect(clone).toEqual(value);
    expect(clone).not.toBe(value);
    expect(clone.left).not.toBe(shared);
    expect(clone.right).not.toBe(shared);
    expect(clone.left).not.toBe(clone.right);
    expect(clone.array).not.toBe(value.array);

    const nullPrototype = Object.assign(Object.create(null), { ok: true });
    expect(cloneJsonObject(nullPrototype)).toEqual({ ok: true });

    const crossRealm = runInNewContext('({ nested: [1, 2, 3] })');
    expect(cloneJsonValue(crossRealm)).toEqual({ nested: [1, 2, 3] });
  });

  it.each([
    ['undefined', { invalid: undefined }],
    ['bigint', { invalid: 1n }],
    ['function', { invalid: () => {} }],
    ['symbol', { invalid: Symbol('invalid') }],
    ['non-finite number', { invalid: Number.POSITIVE_INFINITY }],
    ['sparse array', Array(1)],
    ['non-plain object', { invalid: new Date(0) }],
  ])('rejects %s values instead of coercing them', (_name, value) => {
    expect(() => cloneJsonValue(value, 'Test value')).toThrow(TypeError);
  });

  it('rejects reference cycles but permits repeated acyclic references', () => {
    /** @type {Record<string, any>} */
    const cyclic = {};
    cyclic.self = cyclic;
    const shared = { valid: true };

    expect(() => cloneJsonValue(cyclic)).toThrow(/cycle/i);
    expect(cloneJsonValue({ first: shared, second: shared })).toEqual({
      first: { valid: true },
      second: { valid: true },
    });
  });

  it('uses identical cloned event, context, and result semantics in source and embedded modes', async () => {
    const { invokeManifestActivity } = await import(APP_RUNS_IMPORT);
    const event = { nested: { count: 1 } };
    const context = { trace: { id: 'trace-1' } };
    resultFactory = (receivedEvent, receivedContext) => {
      receivedEvent.nested.count += 1;
      receivedContext.trace.seen = true;
      return {
        event: receivedEvent,
        context: receivedContext,
      };
    };

    const sourceResult = await invokeManifestActivity({
      manifest: activityManifest,
      publicManifest: activityManifest,
      activityName: 'echo',
      event,
      context,
      executionMode: 'source',
    });
    const embeddedResult = await invokeManifestActivity({
      manifest: activityManifest,
      publicManifest: activityManifest,
      activityName: 'echo',
      event,
      context,
      executionMode: 'embedded',
    });

    expect(sourceResult).toEqual(embeddedResult);
    expect(event).toEqual({ nested: { count: 1 } });
    expect(context).toEqual({ trace: { id: 'trace-1' } });
    expect(invocationCalls.map(({ mode }) => mode)).toEqual([
      'source',
      'embedded',
    ]);
    expect(invocationCalls[0].event).not.toBe(event);
    expect(invocationCalls[0].context).not.toBe(context);
    expect(invocationCalls[0].event).not.toBe(invocationCalls[1].event);
    expect(sourceResult).not.toBe(rawResults[0]);
    expect(embeddedResult).not.toBe(rawResults[1]);
  });

  it.each(['source', 'embedded'])(
    'enforces event, context, and result validation in %s mode',
    async (executionMode) => {
      const { invokeManifestActivity } = await import(APP_RUNS_IMPORT);
      const invoke = (overrides = {}) =>
        invokeManifestActivity({
          manifest: activityManifest,
          publicManifest: activityManifest,
          activityName: 'echo',
          event: {},
          context: {},
          executionMode,
          ...overrides,
        });

      await expect(invoke({ event: { invalid: 1n } })).rejects.toThrow(
        /activity event/i,
      );
      await expect(invoke({ context: [] })).rejects.toThrow(
        /activity context.*JSON object/i,
      );

      resultFactory = () => undefined;
      await expect(invoke()).rejects.toThrow(/activity result/i);
    },
  );
});
