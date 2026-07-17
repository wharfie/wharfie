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
  it('keeps the raw entrypoint while exposing a bounded attempt adapter for the selected export', async () => {
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

    await fsp.writeFile(
      entryPath,
      [
        'export async function selected(input, runtime) {',
        '  return {',
        '    value: input.value,',
        "    attemptId: runtime?.invocation?.attemptId ?? 'legacy-raw',",
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

    const rawEntrypoint = runtimeGlobal[rawSymbol];
    const attemptEntrypoint = runtimeGlobal[attemptSymbol];
    expect(typeof rawEntrypoint).toBe('function');
    expect(typeof attemptEntrypoint).toBe('function');

    await expect(rawEntrypoint({ value: 'legacy' })).resolves.toEqual({
      value: 'legacy',
      attemptId: 'legacy-raw',
      caller: null,
    });

    expect(() => attemptEntrypoint(startFrame(activityId))).toThrow(
      /expects exactly \{ startFrame \}/i,
    );
    expect(() =>
      attemptEntrypoint({
        startFrame: startFrame(activityId),
        handler: () => 'caller-controlled-handler',
      }),
    ).toThrow(/expects exactly \{ startFrame \}/i);
    expect(() =>
      attemptEntrypoint({
        startFrame: startFrame('different-activity'),
      }),
    ).toThrow(/activityId to match its selected entrypoint/i);

    const evidence = await attemptEntrypoint({
      startFrame: startFrame(activityId),
    });

    expect(evidence.status).toBe('completed');
    expect(evidence.terminal).toEqual({
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type: 'completed',
      attemptId: 'attempt-1',
      sequence: 1,
      result: {
        value: 'protocol',
        attemptId: 'attempt-1',
        caller: 'trace-1',
      },
    });
  });
});
