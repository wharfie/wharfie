/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
} from '../../../src/core/runtime/activity-protocol.js';
import FunctionResource from '../../../src/core/resources/builds/function-resource.js';

const ACTIVITY_ATTEMPT_PROTOCOL_SYMBOL_PREFIX = 'wharfie.activity-attempt.v1/';

/** @type {typeof globalThis & Record<symbol, any>} */
const runtimeGlobal = globalThis;

/** @type {Array<{path: string, rawSymbol: symbol, rawDescriptor?: PropertyDescriptor, attemptSymbol: symbol, attemptDescriptor?: PropertyDescriptor}>} */
const builtBundles = [];

afterEach(async () => {
  for (const bundle of builtBundles.splice(0)) {
    if (bundle.rawDescriptor) {
      Object.defineProperty(globalThis, bundle.rawSymbol, bundle.rawDescriptor);
    } else {
      Reflect.deleteProperty(runtimeGlobal, bundle.rawSymbol);
    }
    if (bundle.attemptDescriptor) {
      Object.defineProperty(
        runtimeGlobal,
        bundle.attemptSymbol,
        bundle.attemptDescriptor,
      );
    } else {
      Reflect.deleteProperty(runtimeGlobal, bundle.attemptSymbol);
    }
    await fsp.rm(bundle.path, { recursive: true, force: true });
  }
});

/**
 * @param {string} activityId - Activity logical ID.
 * @param {Record<string, any>} [overrides] - Start-frame field overrides.
 * @returns {Record<string, any>} - Valid Activity Protocol v1 start frame.
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
    input: { value: 'protocol' },
    caller: { metadata: { traceId: 'trace-1' } },
    ...overrides,
  };
}

/**
 * @returns {{nodeVersion: string, platform: import('node:process')['platform'], architecture: import('node:process')['arch'], libc?: 'glibc'}} - Host build target for a local bundle.
 */
function currentBuildTarget() {
  return {
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
  };
}

describe('FunctionResource Activity Protocol v1 bundle wrapper', () => {
  it('exposes only a bounded attempt adapter for the selected export', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-function-attempt-wrapper-'),
    );
    const entryPath = path.join(tmp, 'handler.js');
    const activityId = `protocol-wrapper-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const rawSymbol = Symbol.for(activityId);
    const attemptSymbol = Symbol.for(
      `${ACTIVITY_ATTEMPT_PROTOCOL_SYMBOL_PREFIX}${activityId}`,
    );
    builtBundles.push({
      path: tmp,
      rawSymbol,
      rawDescriptor: Object.getOwnPropertyDescriptor(runtimeGlobal, rawSymbol),
      attemptSymbol,
      attemptDescriptor: Object.getOwnPropertyDescriptor(
        runtimeGlobal,
        attemptSymbol,
      ),
    });
    const rawEntrypointSentinel = () => 'preexisting-raw-symbol';
    runtimeGlobal[rawSymbol] = rawEntrypointSentinel;

    await fsp.writeFile(
      entryPath,
      [
        'export async function selected(input, runtime) {',
        "  runtime?.logger?.info('selected', { value: input.value });",
        '  return {',
        '    value: input.value,',
        '    attemptId: runtime.invocation.attemptId,',
        '    caller: runtime?.caller?.metadata?.traceId ?? null,',
        '  };',
        '}',
        "export const ignored = () => 'wrong-export';",
      ].join('\n'),
      'utf8',
    );

    const resource = new FunctionResource({
      name: activityId,
      properties: {
        functionName: activityId,
        entrypoint: { path: entryPath, export: 'selected' },
        buildTarget: currentBuildTarget(),
      },
    });
    const code = await resource.esbuild();
    // eslint-disable-next-line no-new-func
    const runBundle = new Function(
      'require',
      '__filename',
      '__dirname',
      'process',
      `"use strict";\n${code}`,
    );
    runBundle(createRequire(import.meta.url), entryPath, tmp, process);

    const attemptEntrypoint = runtimeGlobal[attemptSymbol];
    expect(runtimeGlobal[rawSymbol]).toBe(rawEntrypointSentinel);
    expect(typeof attemptEntrypoint).toBe('function');

    const newTransport = () => ({
      onComponentFrame: () => {},
      signal: new AbortController().signal,
      forceTerminate: () => {},
    });

    expect(() => attemptEntrypoint(startFrame(activityId))).toThrow(
      /expects exactly \{ startFrame, transport \}/i,
    );
    for (const forbiddenField of ['handler', 'export', 'resources']) {
      expect(() =>
        attemptEntrypoint({
          startFrame: startFrame(activityId),
          transport: newTransport(),
          [forbiddenField]: 'caller-controlled',
        }),
      ).toThrow(/expects exactly \{ startFrame, transport \}/i);
    }
    expect(() =>
      attemptEntrypoint({
        startFrame: startFrame('different-activity'),
        transport: newTransport(),
      }),
    ).toThrow(/activityId to match its selected entrypoint/i);

    for (const transport of [
      {},
      {
        signal: new AbortController().signal,
        forceTerminate: () => {},
      },
      {
        onComponentFrame: () => {},
        forceTerminate: () => {},
      },
      {
        onComponentFrame: () => {},
        signal: new AbortController().signal,
      },
      {
        ...newTransport(),
        handler: () => 'caller-controlled-handler',
      },
      new Date(0),
    ]) {
      expect(() =>
        attemptEntrypoint({
          startFrame: startFrame(activityId),
          transport,
        }),
      ).toThrow(/runner-owned transport with exactly/i);
    }
    for (const transport of [
      {
        ...newTransport(),
        onComponentFrame: 'not-a-function',
      },
      {
        ...newTransport(),
        signal: {},
      },
      {
        ...newTransport(),
        forceTerminate: false,
      },
    ]) {
      expect(() =>
        attemptEntrypoint({
          startFrame: startFrame(activityId),
          transport,
        }),
      ).toThrow(/AbortSignal-like transport.signal/i);
    }

    /** @type {Record<string, any>[]} */
    const componentFrames = [];
    let forceTerminateCalls = 0;

    const evidence = await attemptEntrypoint({
      startFrame: startFrame(activityId),
      transport: {
        onComponentFrame: (/** @type {Record<string, any>} */ frame) =>
          componentFrames.push(frame),
        signal: new AbortController().signal,
        forceTerminate: () => {
          forceTerminateCalls += 1;
        },
      },
    });

    expect(evidence.status).toBe('completed');
    expect(evidence.terminal).toEqual({
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type: 'completed',
      attemptId: 'attempt-1',
      sequence: 2,
      result: {
        value: 'protocol',
        attemptId: 'attempt-1',
        caller: 'trace-1',
      },
    });
    expect(componentFrames.map((frame) => frame.type)).toEqual([
      'log',
      'completed',
    ]);
    expect(componentFrames[0]).toMatchObject({
      sequence: 1,
      level: 'info',
      message: 'selected',
      fields: { value: 'protocol' },
    });
    expect(componentFrames[1]).toMatchObject({ sequence: 2 });
    expect(forceTerminateCalls).toBe(0);
  });
});
