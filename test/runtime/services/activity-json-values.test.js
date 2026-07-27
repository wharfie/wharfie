/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

import {
  cloneBoundedJsonObject,
  cloneBoundedJsonValue,
  cloneJsonObject,
  cloneJsonValue,
} from '../../../src/core/runtime/json-value.js';
import {
  createApplicationRevision,
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
} from '../../../src/core/runtime/application-revision.js';
import {
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
} from '../../../src/core/resources/builds/lib/revision-runtime-assets.js';

const APP_RUNS_IMPORT = '../../../src/core/runtime/app-runs.js';
const FUNCTION_IMPORT = '../../../src/core/resources/builds/function.js';

/** @type {{ mode: string, input: any, runtime: any }[]} */
const invocationCalls = [];
/** @type {Record<string, any>[]} */
const attemptOptions = [];
/** @type {any[]} */
const rawResults = [];
/** @type {(input: any, runtime: any) => any} */
let resultFactory = (input, runtime) => ({ input, runtime });

/**
 * @param {string} mode - Execution path.
 * @param {Readonly<Record<string, any>>} start - Start frame.
 * @returns {Promise<any>} - Activity result.
 */
async function executeActivity(mode, start) {
  const runtime = {
    invocation: {
      revisionId: start.revisionId,
      activityId: start.activityId,
      runId: start.runId,
      invocationId: start.invocationId,
      attemptId: start.attemptId,
      fencingToken: start.fencingToken,
    },
    caller: start.caller,
  };
  invocationCalls.push({ mode, input: start.input, runtime });
  const result = await resultFactory(start.input, runtime);
  rawResults.push(result);
  const terminal = {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId: start.attemptId,
    sequence: 1,
    result,
  };
  return {
    status: 'completed',
    start,
    terminal,
    frames: [start, terminal],
    transcript: {
      started: true,
      attemptId: start.attemptId,
      nextComponentSequence: 2,
      cancelRequested: false,
      pendingEffectIds: [],
      terminalType: 'completed',
    },
  };
}

class MockWharfieFunction {
  /**
   * @param {Readonly<Record<string, any>>} start - Start frame.
   * @returns {Promise<any>} - Activity evidence.
   */
  async runActivityAttempt(start, options = {}) {
    attemptOptions.push(options);
    return await executeActivity('source', start);
  }

  /**
   * @param {string} _name - Activity name.
   * @param {Readonly<Record<string, any>>} start - Start frame.
   * @returns {Promise<any>} - Activity evidence.
   */
  static async runActivityAttempt(_name, start, options = {}) {
    attemptOptions.push(options);
    return await executeActivity('embedded', start);
  }
}

jest.unstable_mockModule(FUNCTION_IMPORT, () => ({
  default: MockWharfieFunction,
}));

const activityManifest = {
  schemaVersion: 3,
  app: { id: 'json-boundary-test' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: 'cli.js',
      export: 'default',
    },
  },
  activities: {
    echo: {
      entrypoint: {
        kind: 'node',
        path: 'activities/echo.js',
        export: 'echo',
      },
    },
  },
};

/** @param {string} value */
function digest(value) {
  return {
    algorithm: /** @type {const} */ ('sha256'),
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

function revisionForManifest() {
  return createApplicationRevision({
    contract: activityManifest,
    inputs: {
      source: { format: SOURCE_TREE_INPUT_FORMAT, digest: digest('source') },
      dependencies: {
        format: DEPENDENCY_LOCK_INPUT_FORMAT,
        digest: digest('dependencies'),
      },
      runtime: { format: RUNTIME_INPUT_FORMAT, digest: digest('runtime') },
    },
  });
}

/**
 * @param {{ verifyRuntime?: () => Promise<void> }} [options] - Source verification override.
 */
function sourceExecution(options = {}) {
  const revision = revisionForManifest();
  return {
    kind: 'prepared-source',
    prepared: {
      revision,
      appDir: process.cwd(),
      manifest: activityManifest,
      assets: {},
      dependencyLock: {
        path: '/tmp/wharfie-json-boundary-package-lock.json',
        input: revision.inputs.dependencies,
      },
      verifyRuntime: options.verifyRuntime || (async () => {}),
      cleanup: async () => {},
    },
  };
}

function embeddedExecution() {
  const revision = revisionForManifest();
  return {
    kind: 'embedded',
    manifest: activityManifest,
    embeddedRevision: {
      revision,
      runtime: {
        schemaVersion: ARTIFACT_RUNTIME_SCHEMA_VERSION,
        kind: ARTIFACT_RUNTIME_KIND,
        appId: activityManifest.app.id,
        revisionId: revision.revisionId,
        target: {
          nodeVersion: process.versions.node,
          platform: process.platform,
          architecture: process.arch,
          ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
        },
      },
    },
  };
}

beforeEach(() => {
  invocationCalls.length = 0;
  attemptOptions.length = 0;
  rawResults.length = 0;
  resultFactory = (input, runtime) => ({ input, runtime });
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
    ['negative zero', { invalid: -0 }],
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

  it('enforces an exact UTF-8 JSON budget while cloning', () => {
    for (const text of ['é\n"', '\b\t\n\f\r\u0000', '😀', '\ud800', '\udc00']) {
      const value = { text };
      const encodedBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
      expect(
        cloneBoundedJsonValue(value, encodedBytes, 'Bounded value'),
      ).toEqual(value);
      expect(() =>
        cloneBoundedJsonValue(value, encodedBytes - 1, 'Bounded value'),
      ).toThrow(RangeError);
    }
    expect(() =>
      cloneBoundedJsonObject(['not-an-object'], 100, 'Bounded object'),
    ).toThrow(TypeError);
    expect(() => cloneBoundedJsonValue({}, -1, 'Bounded value')).toThrow(
      TypeError,
    );
  });

  it('uses identical cloned input, caller metadata, and result semantics in source and embedded modes', async () => {
    const { invokeManifestActivity } = await import(APP_RUNS_IMPORT);
    const input = { nested: { count: 1 } };
    const callerMetadata = {
      trace: { id: 'trace-1' },
      resources: { note: 'ordinary caller metadata' },
    };
    resultFactory = (receivedInput, runtime) => {
      expect(Object.isFrozen(receivedInput)).toBe(true);
      expect(Object.isFrozen(runtime.caller.metadata)).toBe(true);
      return {
        input: receivedInput,
        callerMetadata: runtime.caller.metadata,
      };
    };

    const sourceResult = await invokeManifestActivity({
      activityName: 'echo',
      input,
      callerMetadata,
      execution: sourceExecution(),
    });
    const embeddedResult = await invokeManifestActivity({
      activityName: 'echo',
      input,
      callerMetadata,
      execution: embeddedExecution(),
    });

    expect(sourceResult).toEqual(embeddedResult);
    expect(input).toEqual({ nested: { count: 1 } });
    expect(callerMetadata).toEqual({
      trace: { id: 'trace-1' },
      resources: { note: 'ordinary caller metadata' },
    });
    expect(sourceResult.callerMetadata.resources).toEqual({
      note: 'ordinary caller metadata',
    });
    expect(invocationCalls.map(({ mode }) => mode)).toEqual([
      'source',
      'embedded',
    ]);
    expect(invocationCalls[0].input).not.toBe(input);
    expect(invocationCalls[0].runtime.caller.metadata).not.toBe(callerMetadata);
    expect(invocationCalls[0].input).not.toBe(invocationCalls[1].input);
    expect(sourceResult).not.toBe(rawResults[0]);
    expect(embeddedResult).not.toBe(rawResults[1]);
  });

  it.each(['source', 'embedded'])(
    'enforces input, caller metadata, and result validation in %s mode',
    async (executionMode) => {
      const { invokeManifestActivity } = await import(APP_RUNS_IMPORT);
      const invoke = (overrides = {}) =>
        invokeManifestActivity({
          activityName: 'echo',
          input: {},
          callerMetadata: {},
          execution:
            executionMode === 'source'
              ? sourceExecution()
              : embeddedExecution(),
          ...overrides,
        });

      await expect(invoke({ input: { invalid: 1n } })).rejects.toThrow(
        /activity input/i,
      );
      await expect(invoke({ callerMetadata: [] })).rejects.toThrow(
        /activity caller metadata.*JSON object/i,
      );

      resultFactory = () => undefined;
      await expect(invoke()).rejects.toThrow(/result/i);
    },
  );

  it('allocates fresh local attempt identity while binding every source attempt to its prepared revision', async () => {
    const { invokeManifestActivityAttempt } = await import(APP_RUNS_IMPORT);
    const execution = sourceExecution();

    const [first, second] = await Promise.all([
      invokeManifestActivityAttempt({
        activityName: 'echo',
        input: { call: 1 },
        execution,
      }),
      invokeManifestActivityAttempt({
        activityName: 'echo',
        input: { call: 2 },
        execution,
      }),
    ]);

    expect(first.start.revisionId).toBe(execution.prepared.revision.revisionId);
    expect(second.start.revisionId).toBe(
      execution.prepared.revision.revisionId,
    );
    expect(first.start.runId).not.toBe(second.start.runId);
    expect(first.start.invocationId).not.toBe(second.start.invocationId);
    expect(first.start.attemptId).not.toBe(second.start.attemptId);
    expect(first.start.fencingToken).not.toBe(second.start.fencingToken);
  });

  it('dispatches a scheduler-owned start frame without regenerating durable identity', async () => {
    const { invokeManifestActivityAttemptWithStart } = await import(
      APP_RUNS_IMPORT
    );
    const execution = sourceExecution();
    const startFrame = {
      protocol: 'wharfie.activity',
      protocolVersion: 1,
      type: 'start',
      revisionId: execution.prepared.revision.revisionId,
      activityId: 'echo',
      runId: 'durable-run-1',
      invocationId: 'manual',
      attemptId: 'durable-attempt-1',
      fencingToken: 'durable-fence-1',
      input: { durable: true },
      caller: { metadata: { source: 'scheduler' } },
    };

    const controller = new AbortController();
    const handleEffect = () => {
      throw new Error('Effect execution is not expected in this seam test.');
    };
    const onComponentFrame = () => {};
    const evidence = await invokeManifestActivityAttemptWithStart({
      activityName: 'echo',
      startFrame,
      execution,
      signal: controller.signal,
      handleEffect,
      onComponentFrame,
    });

    expect(evidence.start).toEqual(startFrame);
    expect(attemptOptions).toEqual([
      { signal: controller.signal, handleEffect, onComponentFrame },
    ]);
    expect(invocationCalls).toHaveLength(1);
    expect(invocationCalls[0].runtime.invocation).toEqual({
      revisionId: startFrame.revisionId,
      activityId: startFrame.activityId,
      runId: startFrame.runId,
      invocationId: startFrame.invocationId,
      attemptId: startFrame.attemptId,
      fencingToken: startFrame.fencingToken,
    });

    await expect(
      invokeManifestActivityAttemptWithStart({
        activityName: 'echo',
        startFrame: { ...startFrame, revisionId: `wrv1_${'A'.repeat(43)}` },
        execution,
      }),
    ).rejects.toThrow(/does not match execution revision/i);
    expect(invocationCalls).toHaveLength(1);

    await expect(
      invokeManifestActivityAttemptWithStart({
        activityName: 'echo',
        startFrame,
        execution,
        signal: /** @type {any} */ ({}),
      }),
    ).rejects.toThrow(/must be an AbortSignal/i);
    expect(invocationCalls).toHaveLength(1);

    await expect(
      invokeManifestActivityAttemptWithStart({
        activityName: 'echo',
        startFrame,
        execution,
        handleEffect: /** @type {any} */ ({}),
      }),
    ).rejects.toThrow(/handleEffect must be a function/i);
    expect(invocationCalls).toHaveLength(1);

    await expect(
      invokeManifestActivityAttemptWithStart({
        activityName: 'echo',
        startFrame,
        execution,
        onComponentFrame: /** @type {any} */ ({}),
      }),
    ).rejects.toThrow(/onComponentFrame must be a function/i);
    expect(invocationCalls).toHaveLength(1);
  });

  it('forwards a trusted effect handler through the embedded packaged seam', async () => {
    const { invokeManifestActivityAttemptWithStart } = await import(
      APP_RUNS_IMPORT
    );
    const execution = embeddedExecution();
    const startFrame = {
      protocol: 'wharfie.activity',
      protocolVersion: 1,
      type: 'start',
      revisionId: execution.embeddedRevision.revision.revisionId,
      activityId: 'echo',
      runId: 'embedded-run-1',
      invocationId: 'embedded-invocation-1',
      attemptId: 'embedded-attempt-1',
      fencingToken: 'embedded-fence-1',
      input: { packaged: true },
      caller: { metadata: { source: 'scheduler' } },
    };
    const handleEffect = () => {
      throw new Error('Effect execution is not expected in this seam test.');
    };

    const evidence = await invokeManifestActivityAttemptWithStart({
      activityName: 'echo',
      startFrame,
      execution,
      handleEffect,
    });

    expect(evidence.start).toEqual(startFrame);
    expect(attemptOptions).toEqual([{ handleEffect }]);
    expect(invocationCalls.map(({ mode }) => mode)).toEqual(['embedded']);
  });

  it('keeps ephemeral attempts on the effects-unavailable path', async () => {
    const { invokeManifestActivityAttempt } = await import(APP_RUNS_IMPORT);
    const execution = sourceExecution();

    await invokeManifestActivityAttempt({
      activityName: 'echo',
      input: { ephemeral: true },
      execution,
    });

    expect(attemptOptions).toEqual([{}]);
    await expect(
      invokeManifestActivityAttempt({
        activityName: 'echo',
        input: { ephemeral: true },
        execution,
        handleEffect: () => {},
      }),
    ).rejects.toThrow(/handleEffect is not supported/i);
    expect(attemptOptions).toEqual([{}]);
  });

  it('does not accept a source outcome when the prepared revision changes while it runs', async () => {
    const { invokeManifestActivity } = await import(APP_RUNS_IMPORT);
    let verificationCount = 0;
    const verifyRuntime = jest.fn(async () => {
      verificationCount += 1;
      if (verificationCount === 2) {
        throw new Error('sealed source changed');
      }
    });

    await expect(
      invokeManifestActivity({
        activityName: 'echo',
        input: { value: 'drift' },
        execution: sourceExecution({ verifyRuntime }),
      }),
    ).rejects.toThrow('sealed source changed');

    expect(verifyRuntime).toHaveBeenCalledTimes(2);
    expect(invocationCalls).toHaveLength(1);
  });

  it('turns genuine failed terminals into structured outcome errors', async () => {
    const { ActivityAttemptOutcomeError, unwrapCompletedActivityAttempt } =
      await import(APP_RUNS_IMPORT);
    const evidence = {
      status: 'failed',
      terminal: {
        protocol: 'wharfie.activity',
        protocolVersion: 1,
        type: 'failed',
        attemptId: 'failed-attempt',
        sequence: 1,
        error: {
          code: 'application-failed',
          name: 'ApplicationFailure',
          message: 'expected failure',
          details: { reason: 'test' },
        },
      },
      frames: [],
      transcript: {},
    };

    try {
      unwrapCompletedActivityAttempt(evidence);
      throw new Error('Expected an ActivityAttemptOutcomeError.');
    } catch (error) {
      expect(error).toBeInstanceOf(ActivityAttemptOutcomeError);
      expect(error).toMatchObject({
        name: 'ApplicationFailure',
        code: 'application-failed',
        terminalType: 'failed',
        details: { reason: 'test' },
      });
      const outcome = /** @type {any} */ (error);
      expect(Object.isFrozen(outcome.evidence)).toBe(true);
      expect(Object.isFrozen(outcome.evidence.terminal.error)).toBe(true);
    }
  });
});
