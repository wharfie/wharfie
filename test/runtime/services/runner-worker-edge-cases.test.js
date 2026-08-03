/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sandboxWorker from '../../../src/core/lib/code-execution/worker.js';
import { getActivityAttemptProtocolSymbol } from '../../../src/core/runtime/activity-attempt.js';
import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
} from '../../../src/core/runtime/activity-protocol.js';

function makeName(/** @type {string} */ prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function startFrame(
  /** @type {string} */ activityId,
  /** @type {Record<string, any>} */ input = {},
) {
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
    input,
    caller: { metadata: {} },
  };
}

afterEach(async () => {
  await sandboxWorker._clearSandboxCache();
});

describe('framed activity runner edge cases', () => {
  it.each([
    [
      'process.exit',
      { kind: 'exit', code: 7 },
      /process\.exit\(7\) called in sandbox/,
    ],
    [
      'process.abort',
      { kind: 'abort' },
      /process\.abort\(\) called in sandbox/,
    ],
    ['process.kill', { kind: 'kill' }, /process\.kill\(\) called in sandbox/],
  ])('blocks %s inside the sandbox', async (_label, input, expectedMessage) => {
    const activityId = makeName('worker-guard-rails');
    const entrypointSymbol = getActivityAttemptProtocolSymbol(activityId);
    const codeString = `
      globalThis[Symbol.for(${JSON.stringify(entrypointSymbol)})] =
        async ({ startFrame }) => {
          const payload = startFrame.input;
          if (payload.kind === 'exit') process.exit(payload.code || 0);
          if (payload.kind === 'abort') process.abort();
          if (payload.kind === 'kill') process.kill(process.pid, 'SIGTERM');
        };
    `;

    await expect(
      sandboxWorker.runActivityAttemptInSandbox(
        activityId,
        codeString,
        startFrame(activityId, input),
        { entrypointSymbol },
      ),
    ).rejects.toThrow(expectedMessage);
  });

  it('fails cleanly when the private protocol symbol was never registered', async () => {
    const activityId = makeName('worker-missing-symbol');
    const entrypointSymbol = getActivityAttemptProtocolSymbol(activityId);
    const codeString = `
      globalThis[Symbol.for('some-other-function')] = async () => {};
    `;

    await expect(
      sandboxWorker.runActivityAttemptInSandbox(
        activityId,
        codeString,
        startFrame(activityId),
        { entrypointSymbol },
      ),
    ).rejects.toThrow(
      `Global Activity Protocol entrypoint ${entrypointSymbol} is not a function`,
    );
  });

  it('resolves runner.worker.js independently from process.cwd()', async () => {
    const previousCwd = process.cwd();
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-worker-cwd-'),
    );
    const activityId = makeName('worker-cwd-independent');
    const entrypointSymbol = getActivityAttemptProtocolSymbol(activityId);
    const codeString = `
      globalThis[Symbol.for(${JSON.stringify(entrypointSymbol)})] =
        async ({ startFrame, transport }) => {
          await transport.onComponentFrame({
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'completed',
            attemptId: startFrame.attemptId,
            sequence: 1,
            result: startFrame.input.value,
          });
        };
    `;

    try {
      process.chdir(tmpRoot);
      const evidence = await sandboxWorker.runActivityAttemptInSandbox(
        activityId,
        codeString,
        startFrame(activityId, { value: 42 }),
        { entrypointSymbol },
      );
      expect(evidence.terminal.result).toBe(42);
    } finally {
      process.chdir(previousCwd);
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('strips host bootstrap options without dropping ambient environment', async () => {
    const activityId = makeName('worker-bootstrap-isolation');
    const entrypointSymbol = getActivityAttemptProtocolSymbol(activityId);
    const codeString = `
      globalThis[Symbol.for(${JSON.stringify(entrypointSymbol)})] =
        async ({ startFrame, transport }) => {
          await transport.onComponentFrame({
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'completed',
            attemptId: startFrame.attemptId,
            sequence: 1,
            result: {
              nodeOptions: process.env.NODE_OPTIONS ?? null,
              ambientEnvironment:
                process.env.WHARFIE_WORKER_ENV_SENTINEL ?? null,
              execArgv: process.execArgv,
            },
          });
        };
    `;
    const previousNodeOptions = process.env.NODE_OPTIONS;
    const previousSentinel = process.env.WHARFIE_WORKER_ENV_SENTINEL;
    process.env.NODE_OPTIONS = '--require=wharfie-deliberately-missing-preload';
    process.env.WHARFIE_WORKER_ENV_SENTINEL = 'preserved';

    try {
      const evidence = await sandboxWorker.runActivityAttemptInSandbox(
        activityId,
        codeString,
        startFrame(activityId),
        { entrypointSymbol },
      );
      expect(evidence.terminal.result).toEqual({
        nodeOptions: null,
        ambientEnvironment: 'preserved',
        execArgv: [],
      });
    } finally {
      if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previousNodeOptions;
      if (previousSentinel === undefined) {
        delete process.env.WHARFIE_WORKER_ENV_SENTINEL;
      } else {
        process.env.WHARFIE_WORKER_ENV_SENTINEL = previousSentinel;
      }
    }
  });
});
