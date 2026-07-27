/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getActivityAttemptProtocolSymbol } from '../../../src/core/runtime/activity-attempt.js';
import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
} from '../../../src/core/runtime/activity-protocol.js';
import worker from '../../../src/core/lib/code-execution/worker.js';
import WharfieFunction, {
  ActivityAttemptEvidenceError,
} from '../../../src/core/resources/builds/function.js';
import FunctionResource from '../../../src/core/resources/builds/function-resource.js';

/** @type {string[]} */
const temporaryRoots = [];

/**
 * @param {string} activityId - Activity logical ID.
 * @param {Record<string, any>} [overrides] - Start-frame overrides.
 * @returns {Record<string, any>} - Valid Activity Protocol start frame.
 */
function startFrame(activityId, overrides = {}) {
  return {
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
    type: 'start',
    revisionId: `wrv1_${'A'.repeat(43)}`,
    activityId,
    runId: 'run-1',
    invocationId: 'invocation-1',
    attemptId: 'attempt-1',
    fencingToken: 'fence-1',
    input: { value: 42 },
    caller: { metadata: { requestId: 'request-1' } },
    ...overrides,
  };
}

/**
 * @returns {{nodeVersion: string, platform: import('node:process')['platform'], architecture: import('node:process')['arch'], libc?: 'glibc'}} - Host target.
 */
function currentBuildTarget() {
  return {
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
  };
}

/**
 * @param {string} activityId - Activity logical ID.
 * @param {string} source - Selected activity module source.
 * @returns {Promise<{codeString: string, entryPath: string}>} - Built bundle.
 */
async function buildPreparedActivity(activityId, source) {
  const root = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-managed-effect-transport-'),
  );
  temporaryRoots.push(root);
  const entryPath = path.join(root, 'activity.js');
  await fsp.writeFile(entryPath, source, 'utf8');
  const resource = new FunctionResource({
    name: activityId,
    properties: {
      functionName: activityId,
      entrypoint: { path: entryPath, export: 'execute' },
      buildTarget: currentBuildTarget(),
    },
  });
  return { codeString: await resource.esbuild(), entryPath };
}

/**
 * @param {Readonly<Record<string, any>>} request - Accepted effect request.
 * @param {any} result - JSON result value.
 * @param {Record<string, any>} [evidence] - Adapter evidence.
 * @returns {Record<string, any>} - Valid successful effect result.
 */
function successfulEffectResult(request, result, evidence = {}) {
  return {
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
    type: 'effect-result',
    attemptId: request.attemptId,
    effectId: request.effectId,
    ok: true,
    result,
    substantiatedReplayProperties: ['idempotent'],
    evidence,
  };
}

/**
 * @returns {{promise: Promise<void>, resolve: () => void}} - Deferred gate.
 */
function deferred() {
  /** @type {() => void} */
  let release = () => {};
  /** @type {Promise<void>} */
  const promise = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  return { promise, resolve: release };
}

afterEach(async () => {
  await worker._clearSandboxCache();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fsp.rm(root, { force: true, recursive: true })),
  );
});

describe('Function managed-effect worker transport', () => {
  it('forwards the generated wrapper effect request through host-owned evidence', async () => {
    const activityId = `managed-effect-success-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const bundle = await buildPreparedActivity(
      activityId,
      [
        'export async function execute(input, runtime) {',
        '  const stored = await runtime.effects.request({',
        "    effectId: 'store-value',",
        "    capability: 'test-store',",
        "    operation: 'put',",
        '    input: { value: input.value },',
        "    requestedReplayProperties: ['idempotent'],",
        '  });',
        '  return { stored };',
        '}',
      ].join('\n'),
    );
    /** @type {Readonly<Record<string, any>> | null} */
    let observedRequest = null;
    /** @type {AbortSignal | null} */
    let observedSignal = null;

    const evidence = await WharfieFunction.runPreparedActivityAttempt(
      activityId,
      bundle,
      startFrame(activityId),
      {
        handleEffect: (request, options) => {
          observedRequest = request;
          observedSignal = options.signal;
          return successfulEffectResult(
            request,
            { key: 'stored-42' },
            { receipt: 'receipt-1' },
          );
        },
      },
    );

    expect(observedRequest).toMatchObject({
      type: 'effect-request',
      attemptId: 'attempt-1',
      effectId: 'store-value',
      capability: 'test-store',
      operation: 'put',
      input: { value: 42 },
    });
    expect(Object.isFrozen(observedRequest)).toBe(true);
    expect(observedSignal).toBeInstanceOf(AbortSignal);
    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'effect-request',
      'effect-result',
      'completed',
    ]);
    expect(evidence).toMatchObject({
      status: 'completed',
      terminal: { result: { stored: { key: 'stored-42' } } },
      transcript: { pendingEffectIds: [], terminalType: 'completed' },
    });
  });

  it('does not start a host effect before its component sink acknowledges the request', async () => {
    const activityId = `managed-effect-sink-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const bundle = await buildPreparedActivity(
      activityId,
      [
        'export async function execute(_input, runtime) {',
        '  return await runtime.effects.request({',
        "    effectId: 'sink-gated-effect',",
        "    capability: 'test-store',",
        "    operation: 'get',",
        '    input: { key: 1 },',
        "    requestedReplayProperties: ['idempotent'],",
        '  });',
        '}',
      ].join('\n'),
    );
    const sinkGate = deferred();
    const effectFrameStarted = deferred();
    let handlerCalls = 0;

    const attempt = WharfieFunction.runPreparedActivityAttempt(
      activityId,
      bundle,
      startFrame(activityId),
      {
        onComponentFrame: async (frame) => {
          if (frame.type !== 'effect-request') return;
          effectFrameStarted.resolve();
          await sinkGate.promise;
        },
        handleEffect: (request) => {
          handlerCalls += 1;
          return successfulEffectResult(request, { acknowledged: true });
        },
      },
    );

    try {
      await effectFrameStarted.promise;
      await new Promise((resolve) => setImmediate(resolve));
      expect(handlerCalls).toBe(0);

      sinkGate.resolve();
      const evidence = await attempt;

      expect(handlerCalls).toBe(1);
      expect(evidence.terminal.result).toEqual({ acknowledged: true });
    } finally {
      sinkGate.resolve();
    }
  });

  it('does not start a sink-gated effect after host cancellation wins', async () => {
    const activityId = `managed-effect-sink-cancel-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const bundle = await buildPreparedActivity(
      activityId,
      [
        'export async function execute(_input, runtime) {',
        '  return await runtime.effects.request({',
        "    effectId: 'cancelled-sink-effect',",
        "    capability: 'test-store',",
        "    operation: 'get',",
        '    input: { key: 1 },',
        "    requestedReplayProperties: ['idempotent'],",
        '  });',
        '}',
      ].join('\n'),
    );
    const controller = new AbortController();
    const sinkGate = deferred();
    const effectFrameStarted = deferred();
    let handlerCalls = 0;

    const attempt = WharfieFunction.runPreparedActivityAttempt(
      activityId,
      bundle,
      startFrame(activityId),
      {
        signal: controller.signal,
        cancellationGraceMs: 500,
        onComponentFrame: async (frame) => {
          if (frame.type !== 'effect-request') return;
          effectFrameStarted.resolve();
          await sinkGate.promise;
        },
        handleEffect: (request) => {
          handlerCalls += 1;
          return successfulEffectResult(request, { shouldNotRun: true });
        },
      },
    );

    try {
      await effectFrameStarted.promise;
      controller.abort(new Error('cancel before component ACK'));
      sinkGate.resolve();

      const evidence = await attempt;

      expect(handlerCalls).toBe(0);
      expect(evidence.status).toBe('cancelled');
      expect(evidence.frames.map((frame) => frame.type)).toEqual([
        'start',
        'effect-request',
        'cancel',
        'cancelled',
      ]);
    } finally {
      sinkGate.resolve();
    }
  });

  it('fails closed when a terminal overtakes one sink-gated effect frame', async () => {
    const activityId = `managed-effect-sink-overtake-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const privateSymbol = getActivityAttemptProtocolSymbol(activityId);
    const codeString = `
      globalThis[Symbol.for(${JSON.stringify(privateSymbol)})] =
        async ({ startFrame, transport }) => {
          const effect = transport.onComponentFrame({
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'effect-request',
            attemptId: startFrame.attemptId,
            sequence: 1,
            effectId: 'overtaken-effect',
            capability: 'test-store',
            operation: 'get',
            input: { key: 1 },
            requestedReplayProperties: ['idempotent'],
          });
          const terminal = transport.onComponentFrame({
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'completed',
            attemptId: startFrame.attemptId,
            sequence: 2,
            result: { shouldNotComplete: true },
          });
          await Promise.allSettled([effect, terminal]);
        };
    `;
    const sinkGate = deferred();
    const sinkStarted = deferred();
    /** @type {number[]} */
    const delivered = [];
    let handlerCalls = 0;

    const attempt = WharfieFunction.runPreparedActivityAttempt(
      activityId,
      { codeString },
      startFrame(activityId),
      {
        onComponentFrame: async (frame) => {
          delivered.push(frame.sequence);
          sinkStarted.resolve();
          await sinkGate.promise;
        },
        handleEffect: (request) => {
          handlerCalls += 1;
          return successfulEffectResult(request, { shouldNotRun: true });
        },
      },
    );

    try {
      await sinkStarted.promise;
      await expect(attempt).rejects.toBeInstanceOf(
        ActivityAttemptEvidenceError,
      );
      sinkGate.resolve();
      await new Promise((resolve) => setImmediate(resolve));

      expect(delivered).toEqual([1]);
      expect(handlerCalls).toBe(0);
    } finally {
      sinkGate.resolve();
    }
  });

  it('returns ordinary failed evidence when the host has no managed-effect handler', async () => {
    const activityId = `managed-effect-unavailable-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const bundle = await buildPreparedActivity(
      activityId,
      [
        'export async function execute(_input, runtime) {',
        '  await runtime.effects.request({',
        "    effectId: 'unavailable-effect',",
        "    capability: 'test-store',",
        "    operation: 'put',",
        '    input: { value: 42 },',
        "    requestedReplayProperties: ['idempotent'],",
        '  });',
        '}',
      ].join('\n'),
    );

    const evidence = await WharfieFunction.runPreparedActivityAttempt(
      activityId,
      bundle,
      startFrame(activityId),
    );

    expect(evidence.status).toBe('failed');
    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'failed',
    ]);
    expect(evidence.terminal).toMatchObject({
      type: 'failed',
      sequence: 1,
      error: {
        name: 'ActivityEffectUnavailableError',
        code: 'effect-handler-unavailable',
        details: {},
      },
    });
  });

  it('rejects a forged effect frame when the host advertised no handler', async () => {
    const activityId = `managed-effect-forged-unavailable-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const privateSymbol = getActivityAttemptProtocolSymbol(activityId);
    const codeString = `
      globalThis[Symbol.for(${JSON.stringify(privateSymbol)})] =
        async ({ startFrame, transport }) => {
          await transport.onComponentFrame({
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'effect-request',
            attemptId: startFrame.attemptId,
            sequence: 1,
            effectId: 'forged-effect',
            capability: 'test-store',
            operation: 'put',
            input: { value: 42 },
            requestedReplayProperties: ['idempotent'],
          });
        };
    `;

    await expect(
      WharfieFunction.runPreparedActivityAttempt(
        activityId,
        { codeString },
        startFrame(activityId),
      ),
    ).rejects.toBeInstanceOf(ActivityAttemptEvidenceError);
  });

  it('allows a durable host effect to outlive the transport ACK timeout', async () => {
    const activityId = `managed-effect-slow-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const bundle = await buildPreparedActivity(
      activityId,
      [
        'export async function execute(_input, runtime) {',
        '  void runtime.effects.request({',
        "    effectId: 'slow-effect',",
        "    capability: 'test-store',",
        "    operation: 'put',",
        '    input: { value: 42 },',
        "    requestedReplayProperties: ['idempotent'],",
        '  });',
        "  return 'component-returned-before-effect';",
        '}',
      ].join('\n'),
    );

    const evidence = await WharfieFunction.runPreparedActivityAttempt(
      activityId,
      bundle,
      startFrame(activityId),
      {
        handleEffect: async (request) => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return successfulEffectResult(request, { retained: true });
        },
      },
    );

    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'effect-request',
      'effect-result',
      'completed',
    ]);
    expect(evidence.terminal.result).toBe('component-returned-before-effect');
  });

  it('returns a structured failed effect result to catchable activity code', async () => {
    const activityId = `managed-effect-failure-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const bundle = await buildPreparedActivity(
      activityId,
      [
        'export async function execute(_input, runtime) {',
        '  try {',
        '    await runtime.effects.request({',
        "      effectId: 'quota-check',",
        "      capability: 'test-store',",
        "      operation: 'put',",
        '      input: { value: 42 },',
        "      requestedReplayProperties: ['idempotent'],",
        '    });',
        '  } catch (error) {',
        '    return {',
        '      name: error.name,',
        '      code: error.code,',
        '      message: error.message,',
        '      effectId: error.effectId,',
        '    };',
        '  }',
        '}',
      ].join('\n'),
    );

    const evidence = await WharfieFunction.runPreparedActivityAttempt(
      activityId,
      bundle,
      startFrame(activityId),
      {
        handleEffect: (request) => ({
          protocol: ACTIVITY_PROTOCOL_NAME,
          protocolVersion: ACTIVITY_PROTOCOL_VERSION,
          type: 'effect-result',
          attemptId: request.attemptId,
          effectId: request.effectId,
          ok: false,
          error: {
            code: 'quota-exceeded',
            name: 'QuotaExceededError',
            message: 'No write capacity remains.',
            details: { retryable: false },
          },
          substantiatedReplayProperties: ['unsafe'],
          evidence: { receipt: 'rejected-1' },
        }),
      },
    );

    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'effect-request',
      'effect-result',
      'completed',
    ]);
    expect(evidence.terminal.result).toEqual({
      name: 'QuotaExceededError',
      code: 'quota-exceeded',
      message: 'No write capacity remains.',
      effectId: 'quota-check',
    });
  });

  it('correlates concurrent effects that settle out of request order', async () => {
    const activityId = `managed-effect-concurrency-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const bundle = await buildPreparedActivity(
      activityId,
      [
        'export async function execute(_input, runtime) {',
        '  const request = (effectId) => runtime.effects.request({',
        '    effectId,',
        "    capability: 'test-store',",
        "    operation: 'get',",
        '    input: { effectId },',
        "    requestedReplayProperties: ['idempotent'],",
        '  });',
        '  const values = await Promise.all([',
        "    request('effect-1'),",
        "    request('effect-2'),",
        '  ]);',
        '  return { values };',
        '}',
      ].join('\n'),
    );
    /** @type {() => void} */
    let releaseFirst = () => {};
    const firstGate = new Promise((resolve) => {
      releaseFirst = () => resolve(undefined);
    });
    /** @type {string[]} */
    const handlerOrder = [];

    const evidence = await WharfieFunction.runPreparedActivityAttempt(
      activityId,
      bundle,
      startFrame(activityId),
      {
        handleEffect: async (request) => {
          handlerOrder.push(request.effectId);
          if (request.effectId === 'effect-1') {
            await firstGate;
            await new Promise((resolve) => setTimeout(resolve, 20));
          } else {
            releaseFirst();
          }
          return successfulEffectResult(request, {
            value: `result-${request.effectId}`,
          });
        },
      },
    );

    expect(handlerOrder).toEqual(['effect-1', 'effect-2']);
    expect(
      evidence.frames
        .filter((frame) => frame.type === 'effect-result')
        .map((frame) => frame.effectId),
    ).toEqual(['effect-2', 'effect-1']);
    expect(evidence.terminal.result).toEqual({
      values: [{ value: 'result-effect-1' }, { value: 'result-effect-2' }],
    });
  });

  it('aborts and awaits an in-flight host handler before publishing cancellation evidence', async () => {
    const activityId = `managed-effect-cancel-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const bundle = await buildPreparedActivity(
      activityId,
      [
        'export async function execute(_input, runtime) {',
        '  const value = await runtime.effects.request({',
        "    effectId: 'cancelled-effect',",
        "    capability: 'test-store',",
        "    operation: 'put',",
        '    input: { value: 42 },',
        "    requestedReplayProperties: ['idempotent'],",
        '  });',
        '  return { value };',
        '}',
      ].join('\n'),
    );
    const controller = new AbortController();
    /** @type {() => void} */
    let markHandlerStarted = () => {};
    const handlerStarted = new Promise((resolve) => {
      markHandlerStarted = () => resolve(undefined);
    });
    /** @type {() => void} */
    let releaseHandler = () => {};
    const handlerGate = new Promise((resolve) => {
      releaseHandler = () => resolve(undefined);
    });
    /** @type {AbortSignal | null} */
    let effectSignal = null;
    let handlerSettled = false;

    const attempt = WharfieFunction.runPreparedActivityAttempt(
      activityId,
      bundle,
      startFrame(activityId),
      {
        signal: controller.signal,
        cancellationGraceMs: 250,
        handleEffect: async (request, options) => {
          effectSignal = options.signal;
          markHandlerStarted();
          if (!options.signal.aborted) {
            await new Promise((resolve) =>
              options.signal.addEventListener('abort', resolve, { once: true }),
            );
          }
          await handlerGate;
          handlerSettled = true;
          return successfulEffectResult(request, { ignored: true });
        },
      },
    );
    await handlerStarted;
    const reason = new Error('cancel managed effect');
    Object.assign(reason, { code: 'managed-effect-cancelled', details: {} });
    let attemptSettled = false;
    attempt.then(
      () => {
        attemptSettled = true;
      },
      () => {
        attemptSettled = true;
      },
    );
    controller.abort(reason);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const settledEffectSignal = /** @type {AbortSignal} */ (
      /** @type {unknown} */ (effectSignal)
    );
    expect(settledEffectSignal.aborted).toBe(true);
    expect(settledEffectSignal.reason).toMatchObject({
      code: 'managed-effect-cancelled',
    });
    expect(handlerSettled).toBe(false);
    expect(attemptSettled).toBe(false);

    releaseHandler();

    const evidence = await attempt;

    expect(handlerSettled).toBe(true);
    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'effect-request',
      'cancel',
      'effect-result',
      'cancelled',
    ]);
    expect(evidence.status).toBe('cancelled');
  });

  it('turns a rejected host handler into protocol-failed evidence', async () => {
    const activityId = `managed-effect-handler-rejection-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const bundle = await buildPreparedActivity(
      activityId,
      [
        'export async function execute(_input, runtime) {',
        '  await runtime.effects.request({',
        "    effectId: 'rejected-effect',",
        "    capability: 'test-store',",
        "    operation: 'put',",
        '    input: { value: 42 },',
        "    requestedReplayProperties: ['idempotent'],",
        '  });',
        '}',
      ].join('\n'),
    );

    const evidence = await WharfieFunction.runPreparedActivityAttempt(
      activityId,
      bundle,
      startFrame(activityId),
      {
        handleEffect: async () => {
          throw new Error('adapter unavailable');
        },
      },
    );

    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'effect-request',
      'protocol-failed',
    ]);
    expect(evidence.terminal).toMatchObject({
      type: 'protocol-failed',
      error: { code: 'effect-handler-failed' },
    });
  });

  it('turns an uncorrelated worker handler result into protocol-failed evidence', async () => {
    const activityId = `managed-effect-uncorrelated-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const bundle = await buildPreparedActivity(
      activityId,
      [
        'export async function execute(_input, runtime) {',
        '  await runtime.effects.request({',
        "    effectId: 'expected-effect',",
        "    capability: 'test-store',",
        "    operation: 'put',",
        '    input: { value: 42 },',
        "    requestedReplayProperties: ['idempotent'],",
        '  });',
        '}',
      ].join('\n'),
    );

    const evidence = await WharfieFunction.runPreparedActivityAttempt(
      activityId,
      bundle,
      startFrame(activityId),
      {
        handleEffect: (request) =>
          successfulEffectResult(
            { ...request, effectId: 'different-effect' },
            { ignored: true },
          ),
      },
    );

    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'effect-request',
      'protocol-failed',
    ]);
    expect(evidence.terminal).toMatchObject({
      type: 'protocol-failed',
      error: { code: 'effect-handler-failed' },
    });
  });

  it('closes host effect admission after the first adapter rejection', async () => {
    const activityId = `managed-effect-admission-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const privateSymbol = getActivityAttemptProtocolSymbol(activityId);
    const codeString = `
      globalThis[Symbol.for(${JSON.stringify(privateSymbol)})] =
        async ({ startFrame, transport }) => {
          for (const [index, effectId] of ['first-effect', 'second-effect'].entries()) {
            const request = {
              protocol: 'wharfie.activity',
              protocolVersion: 1,
              type: 'effect-request',
              attemptId: startFrame.attemptId,
              sequence: index + 1,
              effectId,
              capability: 'test-store',
              operation: 'put',
              input: { index },
              requestedReplayProperties: ['idempotent'],
            };
            await transport.onComponentFrame(request);
            try {
              await transport.handleEffect(request);
            } catch {}
          }
          await transport.onComponentFrame({
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'protocol-failed',
            attemptId: startFrame.attemptId,
            sequence: 3,
            error: {
              code: 'effect-handler-failed',
              name: 'ActivityAttemptProtocolError',
              message: 'The host effect adapter rejected the request.',
              details: {},
            },
          });
        };
    `;
    let handlerCalls = 0;

    const evidence = await WharfieFunction.runPreparedActivityAttempt(
      activityId,
      { codeString },
      startFrame(activityId),
      {
        handleEffect: async () => {
          handlerCalls += 1;
          throw new Error('adapter failed');
        },
      },
    );

    expect(handlerCalls).toBe(1);
    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'effect-request',
      'effect-request',
      'protocol-failed',
    ]);
  });

  it('accepts only the signed control snapshot across local and port delivery', async () => {
    const activityId = `managed-effect-control-integrity-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const privateSymbol = getActivityAttemptProtocolSymbol(activityId);
    const codeString = `
      const { parentPort, MessagePort } = require('node:worker_threads');
      const discoveredPort = require('node:process')
        ._getActiveHandles()
        .find((handle) => handle instanceof MessagePort && handle !== parentPort);
      const originalBufferFrom = Buffer.from;
      Buffer.from = function(value, encoding, ...rest) {
        if (typeof value === 'string' && encoding === 'utf8') {
          return originalBufferFrom('same-bytes', 'utf8');
        }
        return originalBufferFrom(value, encoding, ...rest);
      };
      let attemptedInjection = false;
      discoveredPort.on('message', (control) => {
        if (
          attemptedInjection ||
          !control ||
          control.kind !== 'activity-attempt-host-frame' ||
          control.frame?.type !== 'start'
        ) return;
        attemptedInjection = true;
        // Port delivery travels to the host endpoint; local event delivery
        // reaches the runner listener. Neither may reuse a signed snapshot for
        // a different sequence or payload.
        discoveredPort.postMessage(control);
        discoveredPort.emit('message', control);
        const alteredControl = {
          kind: 'activity-attempt-host-frame',
          id: control.id,
          controlSequence: control.controlSequence + 1,
          transportAuth: control.transportAuth,
          frame: {
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'effect-result',
            attemptId: control.frame.attemptId,
            effectId: 'authenticated-effect',
            ok: true,
            result: { source: 'forged' },
            substantiatedReplayProperties: ['idempotent'],
            evidence: { altered: true },
          },
        };
        discoveredPort.postMessage(alteredControl);
        discoveredPort.emit('message', alteredControl);
      });
      globalThis[Symbol.for(${JSON.stringify(privateSymbol)})] =
        async ({ startFrame, transport }) => {
          const request = {
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'effect-request',
            attemptId: startFrame.attemptId,
            sequence: 1,
            effectId: 'authenticated-effect',
            capability: 'test-store',
            operation: 'get',
            input: { key: 'one' },
            requestedReplayProperties: ['idempotent'],
          };
          await transport.onComponentFrame(request);
          const response = await transport.handleEffect(request);
          await transport.onComponentFrame({
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'completed',
            attemptId: startFrame.attemptId,
            sequence: 2,
            result: response.result,
          });
        };
    `;
    let handlerCalls = 0;

    const evidence = await WharfieFunction.runPreparedActivityAttempt(
      activityId,
      { codeString },
      startFrame(activityId),
      {
        handleEffect: async (request) => {
          handlerCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return successfulEffectResult(
            request,
            { source: 'authenticated-host' },
            { altered: false },
          );
        },
      },
    );

    expect(handlerCalls).toBe(1);
    expect(evidence.terminal.result).toEqual({ source: 'authenticated-host' });
    expect(
      evidence.frames.find((frame) => frame.type === 'effect-result'),
    ).toMatchObject({
      result: { source: 'authenticated-host' },
      evidence: { altered: false },
    });
  });

  it('keeps runner correlation records private from bundle prototype hooks', async () => {
    const activityId = `managed-effect-correlation-integrity-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const bundle = await buildPreparedActivity(
      activityId,
      [
        'const originalMapSet = Map.prototype.set;',
        'let replacedPendingResult = false;',
        'Map.prototype.set = function(key, value) {',
        '  if (',
        '    !replacedPendingResult &&',
        '    value &&',
        '    value.request &&',
        "    typeof value.resolve === 'function'",
        '  ) {',
        '    replacedPendingResult = true;',
        '    queueMicrotask(() => value.resolve({',
        "      protocol: 'wharfie.activity',",
        '      protocolVersion: 1,',
        "      type: 'effect-result',",
        '      attemptId: value.request.attemptId,',
        '      effectId: value.request.effectId,',
        '      ok: true,',
        "      result: { source: 'prototype-hook' },",
        "      substantiatedReplayProperties: ['idempotent'],",
        '      evidence: { altered: true },',
        '    }));',
        '  }',
        '  return originalMapSet.call(this, key, value);',
        '};',
        'export async function execute(_input, runtime) {',
        '  const result = await runtime.effects.request({',
        "    effectId: 'private-correlation',",
        "    capability: 'test-store',",
        "    operation: 'get',",
        '    input: { key: 1 },',
        "    requestedReplayProperties: ['idempotent'],",
        '  });',
        '  await new Promise((resolve) => setTimeout(resolve, 30));',
        '  return result;',
        '}',
      ].join('\n'),
    );

    const evidence = await WharfieFunction.runPreparedActivityAttempt(
      activityId,
      bundle,
      startFrame(activityId),
      {
        handleEffect: async (request) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return successfulEffectResult(
            request,
            { source: 'host-handler' },
            { altered: false },
          );
        },
      },
    );

    expect(evidence.terminal.result).toEqual({ source: 'host-handler' });
    expect(
      evidence.frames.find((frame) => frame.type === 'effect-result'),
    ).toMatchObject({
      result: { source: 'host-handler' },
      evidence: { altered: false },
    });
  });

  it('forwards handleEffect through the direct source execution path', async () => {
    const activityId = `managed-effect-source-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-managed-effect-source-'),
    );
    temporaryRoots.push(root);
    const entryPath = path.join(root, 'activity.mjs');
    await fsp.writeFile(
      entryPath,
      [
        'export async function execute(_input, runtime) {',
        '  return await runtime.effects.request({',
        "    effectId: 'source-effect',",
        "    capability: 'test-store',",
        "    operation: 'get',",
        '    input: { key: 1 },',
        "    requestedReplayProperties: ['idempotent'],",
        '  });',
        '}',
      ].join('\n'),
      'utf8',
    );
    const activity = new WharfieFunction({
      name: activityId,
      entrypoint: { path: entryPath, export: 'execute' },
    });
    let calls = 0;

    const evidence = await activity.runActivityAttempt(startFrame(activityId), {
      handleEffect: (request) => {
        calls += 1;
        return successfulEffectResult(request, { direct: true });
      },
    });

    expect(calls).toBe(1);
    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'effect-request',
      'effect-result',
      'completed',
    ]);
    expect(evidence.terminal.result).toEqual({ direct: true });
  });
});
