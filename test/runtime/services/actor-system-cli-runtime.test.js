/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';

const ACTOR_SYSTEM_CLI_IMPORT =
  '../../../src/core/resources/builds/actor-system-cli/index.js';
const PACKAGED_APP_ENTRY_IMPORT =
  '../../../src/core/resources/builds/packaged-app-entry.js';

const originalArgv = process.argv;
const originalEnvironment = { ...process.env };

function clearRuntimeEnvironment() {
  delete process.env.WHARFIE_BOOTSTRAP_MODE;
  delete process.env.WHARFIE_BOOTSTRAP_ARGS;
  delete process.env.WHARFIE_RUNTIME_COMMAND;
  delete process.env.WHARFIE_RUNTIME_ARGS;
}

afterEach(() => {
  process.argv = originalArgv;
  process.env = { ...originalEnvironment };
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('packaged application dispatch', () => {
  it('invokes a manifest-selected named developer CLI export', async () => {
    const { runDeveloperCli } = await import(PACKAGED_APP_ENTRY_IMPORT);
    const launch = jest.fn(async (_argv) => undefined);
    const argv = ['node', 'packaged-app', 'sync', '--json'];

    await runDeveloperCli({ launch }, { cliExportName: 'launch', argv });

    expect(launch).toHaveBeenCalledWith(argv);
  });

  it('fails when an explicitly selected developer CLI export is missing', async () => {
    const { runDeveloperCli } = await import(PACKAGED_APP_ENTRY_IMPORT);
    const fallback = jest.fn(async (_argv) => undefined);

    await expect(
      runDeveloperCli(
        { default: fallback },
        {
          cliExportName: 'misspelledLaunch',
          argv: ['node', 'packaged-app'],
        },
      ),
    ).rejects.toThrow(/cli\.export 'misspelledLaunch'.*not a callable/i);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('exposes only honest packaged-app operator commands', async () => {
    /** @type {string[]} */
    const writes = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const { default: entrypoint } = await import(ACTOR_SYSTEM_CLI_IMPORT);

    await entrypoint(['node', 'wharfie-artifact']);

    const help = writes.join('');
    expect(help).toContain('manifest');
    expect(help).toContain('metadata');
    expect(help).toMatch(/\brun\b/);
    expect(help).toContain('inspect');
    expect(help).toContain('recover');
    expect(help).toContain('reconcile');
    expect(help).toContain('reconcile-effect');
    expect(help).toContain('cancel');
    expect(help).not.toMatch(/\blist\b/);
    expect(help).not.toMatch(/\bfunc\b/);
    expect(help).not.toMatch(/\binfra\b/);
    expect(help).not.toMatch(/\bctl\b/);
  });

  it('honors the private ledger-service runtime command and arguments', async () => {
    const { runPackagedApp } = await import(PACKAGED_APP_ENTRY_IMPORT);
    const parseAsync = jest.fn(async (_argv, _options) => undefined);
    const loadDeveloperCliModule = jest.fn(async () => ({
      default: jest.fn(),
    }));
    clearRuntimeEnvironment();
    process.env.WHARFIE_RUNTIME_COMMAND = 'ledger-service';
    process.env.WHARFIE_RUNTIME_ARGS = JSON.stringify(['--once']);

    await runPackagedApp({
      loadDeveloperCliModule,
      runtimeModules: {
        'ledger-service': { parseAsync },
      },
      argv: ['node', 'wharfie-artifact'],
    });

    expect(parseAsync).toHaveBeenCalledWith(
      ['node', 'ledger-service', '--once'],
      { from: 'node' },
    );
    expect(loadDeveloperCliModule).not.toHaveBeenCalled();
  });

  it('does not let retired bootstrap variables hijack application argv', async () => {
    const { runPackagedApp } = await import(PACKAGED_APP_ENTRY_IMPORT);
    const developerCli = jest.fn(async (_argv) => undefined);
    const argv = ['node', 'wharfie-artifact', 'serve'];
    clearRuntimeEnvironment();
    process.env.WHARFIE_BOOTSTRAP_MODE = 'state-start';
    process.env.WHARFIE_BOOTSTRAP_ARGS = JSON.stringify(['--role', 'leader']);

    await runPackagedApp({
      developerCliModule: { default: developerCli },
      argv,
    });

    expect(developerCli).toHaveBeenCalledWith(argv);
  });

  it('does not enter private runtime dispatch from arguments alone', async () => {
    const { runPackagedApp } = await import(PACKAGED_APP_ENTRY_IMPORT);
    const developerCli = jest.fn(async (_argv) => undefined);
    const argv = ['node', 'wharfie-artifact'];
    clearRuntimeEnvironment();
    process.env.WHARFIE_RUNTIME_ARGS = JSON.stringify(['--once']);

    await runPackagedApp({
      developerCliModule: { default: developerCli },
      argv,
    });

    expect(developerCli).toHaveBeenCalledWith(argv);
  });

  it('rejects malformed private runtime arguments', async () => {
    const { runPackagedApp } = await import(PACKAGED_APP_ENTRY_IMPORT);
    clearRuntimeEnvironment();
    process.env.WHARFIE_RUNTIME_COMMAND = 'ledger-service';
    process.env.WHARFIE_RUNTIME_ARGS = JSON.stringify({ once: true });

    await expect(
      runPackagedApp({
        runtimeModules: {
          'ledger-service': { parseAsync: jest.fn() },
        },
      }),
    ).rejects.toThrow(/WHARFIE_RUNTIME_ARGS must be a JSON array of strings/);
  });

  it('rejects non-string private runtime arguments', async () => {
    const { runPackagedApp } = await import(PACKAGED_APP_ENTRY_IMPORT);
    clearRuntimeEnvironment();
    process.env.WHARFIE_RUNTIME_COMMAND = 'ledger-service';
    process.env.WHARFIE_RUNTIME_ARGS = JSON.stringify(['--limit', 1]);

    await expect(
      runPackagedApp({
        runtimeModules: {
          'ledger-service': { parseAsync: jest.fn() },
        },
      }),
    ).rejects.toThrow(/WHARFIE_RUNTIME_ARGS must be a JSON array of strings/);
  });

  it('fails closed for an unknown private runtime command', async () => {
    const { runPackagedApp } = await import(PACKAGED_APP_ENTRY_IMPORT);
    clearRuntimeEnvironment();
    process.env.WHARFIE_RUNTIME_COMMAND = 'retired-service';

    await expect(
      runPackagedApp({
        runtimeModules: {
          'ledger-service': { parseAsync: jest.fn() },
        },
      }),
    ).rejects.toThrow(
      /Unknown packaged runtime command 'retired-service'.*ledger-service/,
    );
  });

  it.each([
    ['ctl', ['state', 'start']],
    ['func', ['hello']],
    ['infra', ['deploy']],
  ])(
    'keeps packaged %s argv on the developer CLI surface',
    async (internalCommand, argvSuffix) => {
      const { runPackagedApp } = await import(PACKAGED_APP_ENTRY_IMPORT);
      const developerCli = jest.fn(async (_argv) => undefined);
      const operatorCli = jest.fn(async (_argv) => undefined);
      const argv = ['node', 'wharfie-artifact', internalCommand, ...argvSuffix];
      clearRuntimeEnvironment();

      await runPackagedApp({
        developerCliModule: { default: developerCli },
        runtimeModules: { operatorCli },
        argv,
      });

      expect(developerCli).toHaveBeenCalledWith(argv);
      expect(operatorCli).not.toHaveBeenCalled();
    },
  );

  it('routes the reserved namespace to the bundled operator CLI', async () => {
    const { runPackagedApp } = await import(PACKAGED_APP_ENTRY_IMPORT);
    const developerCli = jest.fn(async (_argv) => undefined);
    const loadDeveloperCliModule = jest.fn(async () => ({
      default: developerCli,
    }));
    const operatorCli = jest.fn(async (_argv) => undefined);
    clearRuntimeEnvironment();

    await runPackagedApp({
      loadDeveloperCliModule,
      runtimeModules: { operatorCli },
      argv: ['node', 'wharfie-artifact', 'wharfie', 'manifest'],
    });

    expect(loadDeveloperCliModule).not.toHaveBeenCalled();
    expect(developerCli).not.toHaveBeenCalled();
    expect(operatorCli).toHaveBeenCalledWith([
      'node',
      'wharfie-artifact',
      'manifest',
    ]);
  });

  it('loads the developer CLI once only when developer argv is dispatched', async () => {
    const { runPackagedApp } = await import(PACKAGED_APP_ENTRY_IMPORT);
    const developerCli = jest.fn(async (_argv) => undefined);
    const loadDeveloperCliModule = jest.fn(async () => ({
      default: developerCli,
    }));
    const argv = ['node', 'wharfie-artifact', 'serve'];
    clearRuntimeEnvironment();

    await runPackagedApp({ loadDeveloperCliModule, argv });

    expect(loadDeveloperCliModule).toHaveBeenCalledTimes(1);
    expect(developerCli).toHaveBeenCalledWith(argv);
  });

  it('isolates developer CLI loader failures from runtime and operator dispatch', async () => {
    const { runPackagedApp } = await import(PACKAGED_APP_ENTRY_IMPORT);
    const loadDeveloperCliModule = jest.fn(async () => {
      throw new Error('developer CLI import failed');
    });
    const operatorCli = jest.fn(async (_argv) => undefined);
    const runtimeCli = {
      parseAsync: jest.fn(async (_argv, _options) => undefined),
    };
    clearRuntimeEnvironment();

    await runPackagedApp({
      loadDeveloperCliModule,
      runtimeModules: { operatorCli },
      argv: ['node', 'wharfie-artifact', 'wharfie', 'manifest'],
    });
    expect(loadDeveloperCliModule).not.toHaveBeenCalled();

    process.env.WHARFIE_RUNTIME_COMMAND = 'ledger-service';
    await runPackagedApp({
      loadDeveloperCliModule,
      runtimeModules: { 'ledger-service': runtimeCli },
      argv: ['node', 'wharfie-artifact'],
    });
    expect(loadDeveloperCliModule).not.toHaveBeenCalled();

    clearRuntimeEnvironment();
    await expect(
      runPackagedApp({
        loadDeveloperCliModule,
        argv: ['node', 'wharfie-artifact', 'serve'],
      }),
    ).rejects.toThrow('developer CLI import failed');
    expect(loadDeveloperCliModule).toHaveBeenCalledTimes(1);
  });

  it('fails clearly when the reserved namespace has no operator CLI', async () => {
    const { runPackagedApp } = await import(PACKAGED_APP_ENTRY_IMPORT);
    clearRuntimeEnvironment();

    await expect(
      runPackagedApp({
        developerCliModule: { default: jest.fn() },
        argv: ['node', 'wharfie-artifact', 'wharfie', 'status'],
      }),
    ).rejects.toThrow(
      "does not include the Wharfie operator CLI requested by 'wharfie'",
    );
  });

  it('does not expose the operator CLI as an implicit fallback', async () => {
    const { runPackagedApp } = await import(PACKAGED_APP_ENTRY_IMPORT);
    const operatorCli = jest.fn(async (_argv) => undefined);
    clearRuntimeEnvironment();

    await expect(
      runPackagedApp({
        runtimeModules: { operatorCli },
        argv: ['node', 'wharfie-artifact', 'ctl', 'manifest'],
      }),
    ).rejects.toThrow(
      "Wharfie operator commands must be invoked as '<app> wharfie <command>'",
    );
    expect(operatorCli).not.toHaveBeenCalled();
  });
});
