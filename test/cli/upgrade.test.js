/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';
import { EventEmitter } from 'node:events';

import {
  UPDATE_CHECK_DISABLE_ENV_VAR,
  checkForNewRelease,
  getLatestRelease,
} from '../../cli/upgrade.js';

describe('cLI release checks', () => {
  it('skips the GitHub release check when disabled via env', async () => {
    /** @type {(options?: { timeoutMs?: number }) => Promise<{ tag_name: string }> } */
    const getLatestReleaseFn = jest.fn(async () => ({ tag_name: 'v9.9.9' }));

    const didWarn = await checkForNewRelease({
      env: {
        [UPDATE_CHECK_DISABLE_ENV_VAR]: '1',
      },
      getLatestReleaseFn,
    });

    expect(didWarn).toBe(false);
    expect(getLatestReleaseFn).not.toHaveBeenCalled();
  });

  it('warns when a newer release is available', async () => {
    const warn = jest.fn();

    const didWarn = await checkForNewRelease({
      currentVersion: '0.0.14',
      env: {},
      warn,
      getLatestReleaseFn: async () => ({ tag_name: 'v0.0.15' }),
    });

    expect(didWarn).toBe(true);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls.flat().join('\n')).toMatch(/0\.0\.15/);
  });

  it('returns false when the release check fails', async () => {
    const warn = jest.fn();

    const didWarn = await checkForNewRelease({
      currentVersion: '0.0.14',
      env: {},
      warn,
      getLatestReleaseFn: async () => {
        throw new Error('boom');
      },
    });

    expect(didWarn).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('applies a timeout to the GitHub request', async () => {
    /** @type {typeof import('node:https').get} */
    const request = /** @type {any} */ (
      () => {
        /** @type {any} */
        const req = new EventEmitter();
        req.setTimeout = (
          /** @type {number} */ _timeoutMs,
          /** @type {() => void} */ onTimeout,
        ) => {
          setImmediate(onTimeout);
          return req;
        };
        req.destroy = () => {};
        return req;
      }
    );

    await expect(getLatestRelease({ timeoutMs: 1, request })).rejects.toThrow(
      /timed out after 1ms/i,
    );
  });

  it('parses the latest release response body', async () => {
    /** @type {typeof import('node:https').get} */
    const request = /** @type {any} */ (
      (
        /** @type {unknown} */ _options,
        /** @type {(res: unknown) => void} */ onResponse,
      ) => {
        /** @type {any} */
        const req = new EventEmitter();
        req.setTimeout = () => req;
        req.destroy = () => {};

        /** @type {any} */
        const res = new EventEmitter();
        res.statusCode = 200;
        res.resume = () => {};

        setImmediate(() => {
          onResponse(res);
          res.emit('data', JSON.stringify({ tag_name: 'v1.2.3' }));
          res.emit('end');
        });

        return req;
      }
    );

    await expect(getLatestRelease({ request })).resolves.toEqual({
      tag_name: 'v1.2.3',
    });
  });
});
