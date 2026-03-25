/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import sandboxWorker from '../../../src/core/lib/code-execution/worker.js';

/**
 * @param {string} prefix - prefix.
 * @returns {string} - Result.
 */
function makeName(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

afterEach(async () => {
  await sandboxWorker._destroyWorker();
  sandboxWorker._clearSandboxCache();
  jest.restoreAllMocks();
});

describe('runner.worker edge cases', () => {
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
  ])('blocks %s inside the sandbox', async (_label, event, expectedMessage) => {
    const fnName = makeName('worker-guard-rails');
    const codeString = `
      global[Symbol.for(${JSON.stringify(fnName)})] = async (payload) => {
        if (payload.kind === 'exit') process.exit(payload.code || 0);
        if (payload.kind === 'abort') process.abort();
        if (payload.kind === 'kill') process.kill(process.pid, 'SIGTERM');
      };
    `;

    await expect(
      sandboxWorker.runInSandbox(fnName, codeString, [event]),
    ).rejects.toThrow(expectedMessage);
  });

  it('fails cleanly when the requested symbol was never registered', async () => {
    const fnName = makeName('worker-missing-symbol');
    const codeString = `
      global[Symbol.for('some-other-function')] = async () => {};
    `;

    await expect(
      sandboxWorker.runInSandbox(fnName, codeString, [{ ok: true }]),
    ).rejects.toThrow(`Global entrypoint ${fnName} is not a function`);
  });

  it('completes host RPC calls successfully', async () => {
    const fnName = makeName('worker-rpc-success');
    const sum = jest.fn(async (...args) => Number(args[0]) + Number(args[1]));
    const codeString = `
      global[Symbol.for(${JSON.stringify(fnName)})] = async (event, context) => {
        const total = await context.resources.math.sum(event.left, event.right);
        if (total !== event.expected) {
          throw new Error('Unexpected RPC result: ' + total);
        }
      };
    `;

    await expect(
      sandboxWorker.runInSandbox(
        fnName,
        codeString,
        [{ left: 19, right: 23, expected: 42 }, { resources: {} }],
        {
          rpc: {
            resources: {
              math: { sum },
            },
          },
        },
      ),
    ).resolves.toBeUndefined();

    expect(sum).toHaveBeenCalledWith(19, 23);
  });

  it('surfaces host RPC failures back to the caller', async () => {
    const fnName = makeName('worker-rpc-error');
    const explode = jest.fn(async () => {
      throw new Error('host rpc exploded');
    });
    const codeString = `
      global[Symbol.for(${JSON.stringify(fnName)})] = async (_event, context) => {
        await context.resources.math.explode();
      };
    `;

    await expect(
      sandboxWorker.runInSandbox(fnName, codeString, [{}, { resources: {} }], {
        rpc: {
          resources: {
            math: { explode },
          },
        },
      }),
    ).rejects.toThrow(/host rpc exploded/);

    expect(explode).toHaveBeenCalledTimes(1);
  });

  it('runs the bundle initialization only once per worker lifetime', async () => {
    const fnName = makeName('worker-bundle-init-once');
    const codeString = `
      global.__wharfieBundleInitCount = (global.__wharfieBundleInitCount || 0) + 1;
      global[Symbol.for(${JSON.stringify(fnName)})] = async (event) => {
        if (global.__wharfieBundleInitCount !== event.expectedInitCount) {
          throw new Error(
            'bundle initialized ' + global.__wharfieBundleInitCount + ' times',
          );
        }
      };
    `;

    await sandboxWorker.runInSandbox(fnName, codeString, [
      { expectedInitCount: 1 },
    ]);
    await sandboxWorker.runInSandbox(fnName, codeString, [
      { expectedInitCount: 1 },
    ]);
  });
});
