/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
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

/**
 * @param {string} filePath - File created by a sandboxed activity.
 * @param {number} [timeoutMs] - Maximum observation time.
 * @returns {Promise<void>} - Resolves once the path exists.
 */
async function waitForPath(filePath, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fsp.access(filePath);
      return;
    } catch {}
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for activity marker ${filePath}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(async () => {
  await worker._clearSandboxCache();
  jest.restoreAllMocks();
});

describe('Function Activity Protocol v1 attempt execution', () => {
  it('rejects prepared external archive drift before opening a worker', async () => {
    const activityId = `prepared-archive-drift-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const runActivityAttemptInSandbox = jest.spyOn(
      worker,
      'runActivityAttemptInSandbox',
    );
    const externalsTar = Buffer.from('prepared external archive bytes');
    const differentArchiveDigest = {
      algorithm: /** @type {const} */ ('sha256'),
      value: createHash('sha256')
        .update('different external archive bytes')
        .digest('base64url'),
    };

    await expect(
      WharfieFunction.runPreparedActivityAttempt(
        activityId,
        {
          codeString: 'throw new Error("worker must not start");',
          externalsTar,
          externalArchiveDigest: differentArchiveDigest,
        },
        startFrame(activityId),
      ),
    ).rejects.toThrow(
      /bundled external archive does not match its embedded build digest/i,
    );
    expect(runActivityAttemptInSandbox).not.toHaveBeenCalled();
  });

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
        { codeString: await resource.esbuild() },
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

  it('rejects malformed component frames instead of accepting bundle-supplied aggregate evidence', async () => {
    const activityId = `fabricated-evidence-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const privateSymbol = getActivityAttemptProtocolSymbol(activityId);
    const codeString = `
      globalThis[Symbol.for(${JSON.stringify(privateSymbol)})] =
        async ({ startFrame, transport }) => {
          await transport.onComponentFrame({
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'log',
            attemptId: 'fabricated-other-attempt',
            sequence: 1,
            level: 'info',
            message: 'fabricated',
            fields: {},
          });
          return { startFrame };
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

  it('rejects lifecycle frames that bypass the authenticated runner closure', async () => {
    const activityId = `authenticated-transport-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const privateSymbol = getActivityAttemptProtocolSymbol(activityId);
    const codeString = `
      const { parentPort, MessagePort } = require('node:worker_threads');
      const originalPostMessage = MessagePort.prototype.postMessage;
      const originalMapGet = Map.prototype.get;
      let observedTransportAuth = null;
      let capturedSend = null;
      MessagePort.prototype.postMessage = function(message, ...args) {
        if (
          message &&
          typeof message === 'object' &&
          typeof message.transportAuth === 'string'
        ) {
          observedTransportAuth = message.transportAuth;
        }
        return originalPostMessage.call(this, message, ...args);
      };
      Map.prototype.get = function(...args) {
        for (const candidate of this.values()) {
          if (
            candidate &&
            candidate.transport &&
            typeof candidate.transport.send === 'function'
          ) {
            capturedSend = candidate.transport.send;
          }
        }
        return originalMapGet.call(this, ...args);
      };
      const discoveredPort = require('node:process')
        ._getActiveHandles()
        .find((handle) => handle instanceof MessagePort && handle !== parentPort);
      globalThis[Symbol.for(${JSON.stringify(privateSymbol)})] =
        async ({ startFrame }) => {
          if (!discoveredPort) {
            throw new Error('Expected to discover the private MessagePort.');
          }
          if (capturedSend) {
            capturedSend({
              kind: 'activity-attempt-component-frame',
              frame: {
                protocol: 'wharfie.activity',
                protocolVersion: 1,
                type: 'completed',
                attemptId: startFrame.attemptId,
                sequence: 1,
                result: { forgedThroughSession: true },
              },
            });
          }
          for (let id = 1; id <= 512; id += 1) {
            const forgedMessage = {
              kind: 'activity-attempt-component-frame',
              id,
              ...(observedTransportAuth
                ? { transportAuth: observedTransportAuth }
                : {}),
              frame: {
                protocol: 'wharfie.activity',
                protocolVersion: 1,
                type: 'completed',
                attemptId: startFrame.attemptId,
                sequence: 1,
                result: { forged: true },
              },
            };
            // The app can reach the runner's parentPort directly as well as a
            // discovered private MessagePort. Neither path can bypass the
            // host's authenticated framed transport.
            parentPort.postMessage(forgedMessage);
            discoveredPort.postMessage(forgedMessage);
          }
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

  it('bounds a bundle that never reports private wrapper readiness', async () => {
    const activityId = `never-ready-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;

    await expect(
      WharfieFunction.runPreparedActivityAttempt(
        activityId,
        { codeString: 'while (true) {}' },
        startFrame(activityId),
        { readyTimeoutMs: 25 },
      ),
    ).rejects.toBeInstanceOf(ActivityAttemptTransportError);
  });

  it('records a host cancellation frame and returns only a verified cancelled terminal', async () => {
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-function-attempt-cancel-'),
    );
    const entryPath = path.join(root, 'activity.js');
    const activityId = `cancelled-attempt-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    await fsp.writeFile(
      entryPath,
      [
        'export async function execute(_input, runtime) {',
        "  runtime.logger.info('waiting for cancellation');",
        '  await new Promise((resolve) => {',
        "    runtime.signal.addEventListener('abort', resolve, { once: true });",
        '  });',
        '  return { shouldNotBeCompleted: true };',
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
    const controller = new AbortController();
    const abortTimer = setTimeout(() => {
      const error = new Error('requested by test');
      Object.assign(error, {
        code: 'test-cancelled',
        details: { source: 'function-activity-attempt.test.js' },
      });
      controller.abort(error);
    }, 25);

    try {
      const evidence = await WharfieFunction.runPreparedActivityAttempt(
        activityId,
        { codeString: await resource.esbuild() },
        startFrame(activityId),
        { signal: controller.signal, cancellationGraceMs: 250 },
      );

      expect(evidence.status).toBe('cancelled');
      expect(evidence.frames[0].type).toBe('start');
      expect(evidence.frames.some((frame) => frame.type === 'cancel')).toBe(
        true,
      );
      expect(evidence.terminal).toMatchObject({
        type: 'cancelled',
        error: {
          code: 'test-cancelled',
          message: 'requested by test',
        },
      });
      expect(evidence.frames[evidence.frames.length - 1]).toEqual(
        evidence.terminal,
      );
      expect(evidence.transcript.cancelRequested).toBe(true);
    } finally {
      clearTimeout(abortTimer);
      await fsp.rm(root, { force: true, recursive: true });
    }
  });

  it('does not enter the activity handler when cancellation predates runner readiness', async () => {
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-function-attempt-pre-cancel-'),
    );
    const entryPath = path.join(root, 'activity.js');
    const activityId = `pre-cancelled-attempt-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    await fsp.writeFile(
      entryPath,
      [
        'export async function execute(_input, runtime) {',
        "  runtime.logger.error('user code entered');",
        '  return { shouldNotBeCompleted: true };',
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
    const controller = new AbortController();
    const error = new Error('cancel before worker startup');
    Object.assign(error, { code: 'pre-cancelled', details: {} });
    controller.abort(error);

    try {
      const evidence = await WharfieFunction.runPreparedActivityAttempt(
        activityId,
        { codeString: await resource.esbuild() },
        startFrame(activityId),
        { signal: controller.signal, cancellationGraceMs: 250 },
      );

      expect(evidence.status).toBe('cancelled');
      expect(evidence.frames.map((frame) => frame.type)).toEqual([
        'start',
        'cancel',
        'cancelled',
      ]);
      expect(evidence.terminal.error.code).toBe('pre-cancelled');
    } finally {
      await fsp.rm(root, { force: true, recursive: true });
    }
  });

  it('enforces a host deadline and returns a verified deadline-exceeded terminal', async () => {
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-function-attempt-deadline-'),
    );
    const entryPath = path.join(root, 'activity.js');
    const activityId = `deadline-attempt-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    await fsp.writeFile(
      entryPath,
      [
        'export async function execute(_input, runtime) {',
        '  await new Promise((resolve) => {',
        "    runtime.signal.addEventListener('abort', resolve, { once: true });",
        '  });',
        '  return { shouldNotBeCompleted: true };',
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
        { codeString: await resource.esbuild() },
        startFrame(activityId, { deadlineUnixMs: Date.now() + 100 }),
        { cancellationGraceMs: 250 },
      );

      expect(evidence.status).toBe('deadline-exceeded');
      expect(evidence.terminal).toMatchObject({
        type: 'deadline-exceeded',
        error: { code: 'deadline-exceeded' },
      });
      expect(evidence.frames[evidence.frames.length - 1]).toEqual(
        evidence.terminal,
      );
    } finally {
      await fsp.rm(root, { force: true, recursive: true });
    }
  });

  it('rejects a deadline terminal emitted before the host deadline', async () => {
    const activityId = `early-deadline-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const privateSymbol = getActivityAttemptProtocolSymbol(activityId);
    const codeString = `
      globalThis[Symbol.for(${JSON.stringify(privateSymbol)})] =
        async ({ startFrame, transport }) => {
          await transport.onComponentFrame({
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'deadline-exceeded',
            attemptId: startFrame.attemptId,
            sequence: 1,
            error: {
              code: 'deadline-exceeded',
              name: 'ActivityDeadlineError',
              message: 'forged early deadline',
              details: {},
            },
          });
        };
    `;

    await expect(
      WharfieFunction.runPreparedActivityAttempt(
        activityId,
        { codeString },
        startFrame(activityId, { deadlineUnixMs: Date.now() + 10_000 }),
      ),
    ).rejects.toBeInstanceOf(ActivityAttemptEvidenceError);
  });

  it('keeps a cancellation accepted before the deadline ahead of a late cancelled terminal', async () => {
    const activityId = `cancel-before-deadline-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const privateSymbol = getActivityAttemptProtocolSymbol(activityId);
    const controller = new AbortController();
    const error = new Error('cancelled before deadline');
    Object.assign(error, { code: 'predeadline-cancel', details: {} });
    controller.abort(error);
    const codeString = `
      globalThis[Symbol.for(${JSON.stringify(privateSymbol)})] =
        async ({ startFrame, transport }) => {
          const until = startFrame.deadlineUnixMs + 25;
          while (Date.now() < until) {}
          await transport.onComponentFrame({
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'cancelled',
            attemptId: startFrame.attemptId,
            sequence: 1,
            error: {
              code: 'predeadline-cancel',
              name: 'Error',
              message: 'cancelled before deadline',
              details: {},
            },
          });
        };
    `;

    const evidence = await WharfieFunction.runPreparedActivityAttempt(
      activityId,
      { codeString },
      startFrame(activityId, { deadlineUnixMs: Date.now() + 300 }),
      { signal: controller.signal, cancellationGraceMs: 2_000 },
    );

    expect(evidence.status).toBe('cancelled');
    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'cancel',
      'cancelled',
    ]);
  });

  it('rejects a CPU-bound completion that crosses the host deadline', async () => {
    const activityId = `deadline-fence-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const privateSymbol = getActivityAttemptProtocolSymbol(activityId);
    const codeString = `
      globalThis[Symbol.for(${JSON.stringify(privateSymbol)})] =
        async ({ startFrame, transport }) => {
          const until = startFrame.deadlineUnixMs + 25;
          while (Date.now() < until) {}
          await transport.onComponentFrame({
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'completed',
            attemptId: startFrame.attemptId,
            sequence: 1,
            result: { shouldNotBeAccepted: true },
          });
        };
    `;

    await expect(
      WharfieFunction.runPreparedActivityAttempt(
        activityId,
        { codeString },
        startFrame(activityId, { deadlineUnixMs: Date.now() + 500 }),
        { cancellationGraceMs: 1_000 },
      ),
    ).rejects.toBeInstanceOf(ActivityAttemptEvidenceError);
  });

  it('treats a terminal without runner closure as transport uncertainty', async () => {
    const activityId = `terminal-without-close-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    const privateSymbol = getActivityAttemptProtocolSymbol(activityId);
    const codeString = `
      globalThis[Symbol.for(${JSON.stringify(privateSymbol)})] =
        async ({ startFrame, transport }) => {
          await transport.onComponentFrame({
            protocol: 'wharfie.activity',
            protocolVersion: 1,
            type: 'completed',
            attemptId: startFrame.attemptId,
            sequence: 1,
            result: { prematurelyReported: true },
          });
          await new Promise(() => {});
        };
    `;

    await expect(
      WharfieFunction.runPreparedActivityAttempt(
        activityId,
        { codeString },
        startFrame(activityId),
      ),
    ).rejects.toBeInstanceOf(ActivityAttemptTransportError);
  });

  it('terminates an uncooperative one-shot worker without affecting a concurrent attempt', async () => {
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-function-attempt-termination-'),
    );
    const entryPath = path.join(root, 'activity.js');
    const activityId = `termination-attempt-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;
    await fsp.writeFile(
      entryPath,
      [
        "import { writeFileSync } from 'node:fs';",
        'export async function execute(input) {',
        '  if (input.block) {',
        "    writeFileSync(input.markerPath, 'entered', 'utf8');",
        '    await new Promise(() => {});',
        '  }',
        '  return { ok: true, value: input.value };',
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
    const controller = new AbortController();
    const markerPath = path.join(root, 'blocked-entered');

    try {
      const codeString = await resource.esbuild();
      const blocked = WharfieFunction.runPreparedActivityAttempt(
        activityId,
        { codeString },
        startFrame(activityId, {
          input: { block: true, markerPath, value: 'blocked' },
        }),
        { signal: controller.signal, cancellationGraceMs: 50 },
      );
      const blockedExpectation = expect(blocked).rejects.toBeInstanceOf(
        ActivityAttemptTransportError,
      );
      await waitForPath(markerPath);
      controller.abort(new Error('stop'));
      const completed = WharfieFunction.runPreparedActivityAttempt(
        activityId,
        { codeString },
        startFrame(activityId, { input: { block: false, value: 'completed' } }),
      );

      await expect(completed).resolves.toMatchObject({
        status: 'completed',
        terminal: { result: { ok: true, value: 'completed' } },
      });
      await blockedExpectation;
    } finally {
      await fsp.rm(root, { force: true, recursive: true });
    }
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
