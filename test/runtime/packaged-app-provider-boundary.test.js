/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { runPackagedApp } from '../../src/core/resources/builds/packaged-app-entry.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
  jest.restoreAllMocks();
});

describe('packaged AWS provider admission', () => {
  it.each(['plan', 'apply', 'inspect', 'reconcile', 'destroy'])(
    'fails deployment %s before runtime preparation or dispatch',
    async (operation) => {
      const providerError = new Error('provider unavailable');
      const requireAwsProvider = jest.fn(async () => {
        throw providerError;
      });
      const prepareRuntime = jest.fn(async () => undefined);
      const dispatch = jest.fn(async () => undefined);
      delete process.env.WHARFIE_RUNTIME_COMMAND;

      await expect(
        runPackagedApp({
          argv: ['node', 'wharfie-app', 'wharfie', 'deployment', operation],
          prepareRuntime,
          requireAwsProvider,
          runtimeModules: { operatorCli: dispatch },
        }),
      ).rejects.toBe(providerError);

      expect(requireAwsProvider).toHaveBeenCalledTimes(1);
      expect(prepareRuntime).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['parent help', ['deployment', '--help']],
    ['leaf help', ['deployment', 'inspect', '--help']],
    ['short leaf help', ['deployment', 'inspect', '-h']],
    ['omitted leaf', ['deployment']],
  ])('keeps packaged deployment %s provider-free', async (_label, args) => {
    const requireAwsProvider = jest.fn(async () => {
      throw new Error('help must not load the provider');
    });
    const prepareRuntime = jest.fn(async () => undefined);
    const dispatch = jest.fn(
      /** @param {string[]} _argv @param {unknown} _context */ async (
        _argv,
        _context,
      ) => undefined,
    );
    delete process.env.WHARFIE_RUNTIME_COMMAND;

    await runPackagedApp({
      argv: ['node', 'wharfie-app', 'wharfie', ...args],
      prepareRuntime,
      requireAwsProvider,
      runtimeModules: { operatorCli: dispatch },
    });

    expect(requireAwsProvider).not.toHaveBeenCalled();
    expect(prepareRuntime).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(['node', 'wharfie-app', ...args], {
      loadDeveloperCliModule: undefined,
    });
  });
});
