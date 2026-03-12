/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';

const ORIGINAL_ARGV = process.argv;
const ORIGINAL_EXIT_CODE = process.exitCode;
const ORIGINAL_STDIN_IS_TTY = process.stdin.isTTY;
const PATHS_MODULE = '../../lambdas/lib/paths.js';
const LOAD_APP_MODULE = '../../cli/app/load-app.js';
const CONFIG_MODULE = '../../cli/config.js';
const ENTRY_MODULE = '../../cli/entry.js';

describe('cli/entry main', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    process.argv = ORIGINAL_ARGV;
    process.exitCode = ORIGINAL_EXIT_CODE;
    Object.defineProperty(process.stdin, 'isTTY', {
      value: ORIGINAL_STDIN_IS_TTY,
      configurable: true,
    });
  });

  it('awaits async preAction hooks and async command actions before resolving', async () => {
    /** @type {string[]} */
    const events = [];

    /** @type {() => void} */
    let resolveCreateWharfiePaths = () => {
      throw new Error('createWharfiePaths resolver was not initialized');
    };
    /** @type {() => void} */
    let resolveLoadApp = () => {
      throw new Error('loadApp resolver was not initialized');
    };

    /** @type {Promise<void>} */
    const createWharfiePathsPromise = new Promise((resolve) => {
      resolveCreateWharfiePaths = () => {
        events.push('preAction:end');
        resolve();
      };
    });

    /** @type {Promise<{ manifest: { app: { name: string } } }>} */
    const loadAppPromise = new Promise((resolve) => {
      resolveLoadApp = () => {
        events.push('action:end');
        resolve({ manifest: { app: { name: 'test-app' } } });
      };
    });

    await jest.unstable_mockModule(PATHS_MODULE, () => ({
      default: {
        config: '/tmp/wharfie-config',
        data: '/tmp/wharfie-data',
        temp: '/tmp/wharfie-temp',
        createWharfiePaths: async () => {
          events.push('preAction:start');
          await createWharfiePathsPromise;
        },
      },
    }));

    await jest.unstable_mockModule(LOAD_APP_MODULE, () => ({
      loadApp: async () => {
        events.push('action:start');
        return loadAppPromise;
      },
    }));

    await jest.unstable_mockModule(CONFIG_MODULE, () => ({
      default: {
        setConfig: () => {},
        setEnvironment: () => {},
        validate: async () => {},
      },
      setConfig: () => {},
      setEnvironment: () => {},
      validate: async () => {},
    }));

    const stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });

    const { main } = await import(ENTRY_MODULE);

    const argv = ['node', 'wharfie', 'app', 'manifest'];
    process.argv = argv;

    let resolved = false;
    const mainPromise = main(argv).then(() => {
      resolved = true;
      events.push('main:resolved');
    });

    await Promise.resolve();

    expect(events).toEqual(['preAction:start']);
    expect(resolved).toBe(false);

    resolveCreateWharfiePaths();
    await new Promise((resolve) => setImmediate(resolve));

    expect(events).toEqual([
      'preAction:start',
      'preAction:end',
      'action:start',
    ]);
    expect(resolved).toBe(false);

    resolveLoadApp();
    await mainPromise;

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalled();
    expect(events).toEqual([
      'preAction:start',
      'preAction:end',
      'action:start',
      'action:end',
      'main:resolved',
    ]);
  });
});
