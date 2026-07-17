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
  ActivityAttemptTransportError,
} from '../../../src/core/resources/builds/function.js';
import FunctionResource from '../../../src/core/resources/builds/function-resource.js';

/**
 * @param {string} activityId - Activity logical ID.
 * @param {Record<string, any>} [overrides] - Start frame overrides.
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

afterEach(async () => {
  await worker._clearSandboxCache();
});

describe('Function Activity Protocol v1 attempt execution', () => {
  it('uses the generated private wrapper and returns revalidated restricted evidence', async () => {
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-function-attempt-'),
    );
    const entryPath = path.join(root, 'activity.js');
    const activityId = `attempt-wrapper-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    await fsp.writeFile(
      entryPath,
      [
        'export async function execute(input, runtime) {',
        "  runtime.logger.info('received', { value: input.value });",
        '  return {',
        '    value: input.value,',
        '    revisionId: runtime.invocation.revisionId,',
        '    requestId: runtime.caller.metadata.requestId,',
        '    runtimeKeys: Object.keys(runtime).sort(),',
        '  };',
        '}',
      ].join('\n'),
      'utf8',
    );
    const resource = new FunctionResource({
      name: activityId,
      properties: {
        functionName: activityId,
        entrypoint: { path: entryPath, export: 'execute' },
        buildTarget: currentBuildTarget(),
      },
    });

    try {
      const evidence = await WharfieFunction.runPreparedActivityAttempt(
        activityId,
        { codeString: await resource.esbuild(), resourceSpecs: { db: {} } },
        startFrame(activityId),
      );

      expect(evidence).toMatchObject({
        status: 'completed',
        start: { activityId, attemptId: 'attempt-1' },
        terminal: {
          type: 'completed',
          result: {
            value: 42,
            revisionId: `wrv1_${'A'.repeat(43)}`,
            requestId: 'request-1',
            runtimeKeys: [
              'caller',
              'effects',
              'invocation',
              'logger',
              'signal',
            ],
          },
        },
      });
      expect(evidence.frames.map((frame) => frame.type)).toEqual([
        'start',
        'log',
        'completed',
      ]);
      expect(Object.isFrozen(evidence)).toBe(true);
    } finally {
      await fsp.rm(root, { force: true, recursive: true });
    }
  });

  it('rejects fabricated effect/cancellation evidence instead of accepting fake host capabilities', async () => {
    const activityId = `fabricated-evidence-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const privateSymbol = getActivityAttemptProtocolSymbol(activityId);
    const fabricated = {
      status: 'completed',
      start: startFrame(activityId),
      terminal: {
        protocol: ACTIVITY_PROTOCOL_NAME,
        protocolVersion: ACTIVITY_PROTOCOL_VERSION,
        type: 'completed',
        attemptId: 'attempt-1',
        sequence: 3,
        result: 'fabricated',
      },
      frames: [
        startFrame(activityId),
        {
          protocol: ACTIVITY_PROTOCOL_NAME,
          protocolVersion: ACTIVITY_PROTOCOL_VERSION,
          type: 'effect-request',
          attemptId: 'attempt-1',
          sequence: 1,
          effectId: 'effect-1',
          capability: 'object-storage',
          operation: 'put-object',
          input: {},
          requestedReplayProperties: ['unsafe'],
        },
        {
          protocol: ACTIVITY_PROTOCOL_NAME,
          protocolVersion: ACTIVITY_PROTOCOL_VERSION,
          type: 'completed',
          attemptId: 'attempt-1',
          sequence: 3,
          result: 'fabricated',
        },
      ],
      transcript: {},
    };
    const codeString = `
      globalThis[Symbol.for(${JSON.stringify(privateSymbol)})] = () =>
        (${JSON.stringify(fabricated)});
    `;

    await expect(
      WharfieFunction.runPreparedActivityAttempt(
        activityId,
        { codeString },
        startFrame(activityId),
      ),
    ).rejects.toBeInstanceOf(ActivityAttemptEvidenceError);
  });

  it('does not fabricate a terminal when the private wrapper is absent', async () => {
    const activityId = `missing-wrapper-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const codeString = `globalThis[Symbol.for(${JSON.stringify(
      activityId,
    )})] = () => 'legacy';`;

    await expect(
      WharfieFunction.runPreparedActivityAttempt(
        activityId,
        { codeString },
        startFrame(activityId),
      ),
    ).rejects.toBeInstanceOf(ActivityAttemptTransportError);
  });
});
