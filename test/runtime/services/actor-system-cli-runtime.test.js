/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ACTOR_SYSTEM_CLI_IMPORT =
  '../../../src/core/resources/builds/actor-system-cli/index.js';
const SOURCE_OPS_CLI_IMPORT = '../../../src/cli/cmds/ops.js';
const PACKAGED_APP_ENTRY_IMPORT =
  '../../../src/core/resources/builds/packaged-app-entry.js';

const originalArgv = process.argv;
const originalEnvironment = { ...process.env };
const originalExitCode = process.exitCode;

function clearRuntimeEnvironment() {
  delete process.env.WHARFIE_BOOTSTRAP_MODE;
  delete process.env.WHARFIE_BOOTSTRAP_ARGS;
  delete process.env.WHARFIE_RUNTIME_COMMAND;
  delete process.env.WHARFIE_RUNTIME_ARGS;
}

/**
 * @param {import('commander').Command} root - Command-tree root.
 * @returns {import('commander').Command[]} - Root and every descendant.
 */
function collectCommandTree(root) {
  return [
    root,
    ...root.commands.flatMap((command) => collectCommandTree(command)),
  ];
}

/**
 * @param {import('commander').Command} root - Command-tree root.
 * @returns {void}
 */
function expectExactCommandParents(root) {
  for (const child of root.commands) {
    expect(child.parent).toBe(root);
    expectExactCommandParents(child);
  }
}

afterEach(() => {
  process.argv = originalArgv;
  process.env = { ...originalEnvironment };
  process.exitCode = originalExitCode;
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
    expect(help).toContain('submit');
    expect(help).toContain('start');
    expect(help).toContain('worker');
    expect(help).toContain('list');
    expect(help).toContain('output');
    expect(help).toContain('inspect');
    expect(help).toContain('recover');
    expect(help).toContain('reconcile');
    expect(help).toContain('reconcile-effect');
    expect(help).toContain('retry-effect');
    expect(help).toContain('cancel');
    expect(help).toContain('deployment');
    expect(help).not.toMatch(/\bfunc\b/);
    expect(help).not.toMatch(/\binfra\b/);
    expect(help).not.toMatch(/\bctl\b/);
  });

  it('mounts only self-deployable deployment commands without replacing flat ledger commands', async () => {
    const { createProgram } = await import(ACTOR_SYSTEM_CLI_IMPORT);
    const program = createProgram();
    const deployment = program.commands.find(
      /** @param {import('commander').Command} command */
      (command) => command.name() === 'deployment',
    );

    expect(deployment).toBeDefined();
    expect(
      deployment?.commands.map(
        /** @param {import('commander').Command} command */
        (command) => command.name(),
      ),
    ).toEqual([
      'preview',
      'apply',
      'status',
      'update',
      'recover',
      'exec',
      'destroy',
    ]);
    expect(
      program.commands.filter(
        /** @param {import('commander').Command} command */
        (command) => command.name() === 'inspect',
      ),
    ).toHaveLength(1);
    expect(
      program.commands.filter(
        /** @param {import('commander').Command} command */
        (command) => command.name() === 'reconcile',
      ),
    ).toHaveLength(1);
  });

  it('owns one fresh complete command tree in every packaged program', async () => {
    const { createProgram } = await import(ACTOR_SYSTEM_CLI_IMPORT);
    const first = createProgram();
    const second = createProgram();
    const firstTree = collectCommandTree(first);
    const firstCommands = new Set(firstTree);
    const secondTree = collectCommandTree(second);
    const firstManifest = first.commands.find(
      /** @param {import('commander').Command} command */
      (command) => command.name() === 'manifest',
    );
    const secondManifest = second.commands.find(
      /** @param {import('commander').Command} command */
      (command) => command.name() === 'manifest',
    );
    const firstMetadata = first.commands.find(
      /** @param {import('commander').Command} command */
      (command) => command.name() === 'metadata',
    );
    const secondMetadata = second.commands.find(
      /** @param {import('commander').Command} command */
      (command) => command.name() === 'metadata',
    );

    expect(firstManifest).toBeDefined();
    expect(firstMetadata).toBeDefined();
    expect(secondTree.map((command) => command.name())).toEqual(
      firstTree.map((command) => command.name()),
    );
    expect(secondTree.every((command) => !firstCommands.has(command))).toBe(
      true,
    );
    expectExactCommandParents(first);
    expectExactCommandParents(second);
    expect(secondManifest).not.toBe(firstManifest);
    expect(secondMetadata).not.toBe(firstMetadata);
    expect(firstManifest?.parent).toBe(first);
    expect(firstMetadata?.parent).toBe(first);
    expect(secondManifest?.parent).toBe(second);
    expect(secondMetadata?.parent).toBe(second);

    firstManifest?.description('first-program-only manifest');
    expect(secondManifest?.description()).toBe(
      'Print the packaged Wharfie app manifest for this artifact',
    );
  });

  it('forwards the packaged process seam to deployment command failures', async () => {
    const { createProgram } = await import(ACTOR_SYSTEM_CLI_IMPORT);
    const processRef = { exitCode: undefined };
    const globalExitCode = process.exitCode;
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const program = createProgram({ processRef });

    await program.parseAsync(
      [
        'deployment',
        'apply',
        '--deployment',
        'preview',
        '--provider',
        'aws',
        '--location',
        'ash',
        '--allow-ssh-from',
        '192.0.2.8/32',
      ],
      { from: 'user' },
    );

    expect(processRef.exitCode).toBe(1);
    expect(process.exitCode).toBe(globalExitCode);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('mounts the same public retry-effect command in source and packaged parents', async () => {
    const { createProgram } = await import(ACTOR_SYSTEM_CLI_IMPORT);
    const { createSourceOpsCommand } = await import(SOURCE_OPS_CLI_IMPORT);
    const sourceOps = createSourceOpsCommand();
    const packaged = createProgram();
    const sourceRetry = sourceOps.commands.find(
      /** @param {import('commander').Command} command */
      (command) => command.name() === 'retry-effect',
    );
    const packagedRetry = packaged.commands.find(
      /** @param {import('commander').Command} command */
      (command) => command.name() === 'retry-effect',
    );

    expect(sourceRetry).toBeDefined();
    expect(packagedRetry).toBeDefined();
    expect(packagedRetry?.description()).toBe(sourceRetry?.description());
    expect(
      packagedRetry?.options.map(
        /** @param {import('commander').Option} option */
        (option) => option.flags,
      ),
    ).toEqual(
      sourceRetry?.options.map(
        /** @param {import('commander').Option} option */
        (option) => option.flags,
      ),
    );
    expect(sourceOps.helpInformation()).toContain('retry-effect');
    expect(packaged.helpInformation()).toContain('retry-effect');
  });

  it('mounts app-scoped run history with only the source directory option', async () => {
    const { createProgram } = await import(ACTOR_SYSTEM_CLI_IMPORT);
    const { createSourceOpsCommand } = await import(SOURCE_OPS_CLI_IMPORT);
    const sourceOps = createSourceOpsCommand();
    const packaged = createProgram();
    const sourceList = sourceOps.commands.find(
      /** @param {import('commander').Command} command */
      (command) => command.name() === 'list',
    );
    const packagedList = packaged.commands.find(
      /** @param {import('commander').Command} command */
      (command) => command.name() === 'list',
    );

    expect(sourceList).toBeDefined();
    expect(packagedList).toBeDefined();
    expect(packagedList?.description()).toBe(sourceList?.description());
    expect(
      sourceList?.options.map(
        /** @param {import('commander').Option} option */
        (option) => option.long,
      ),
    ).toEqual(
      expect.arrayContaining(['--dir', '--limit', '--cursor', '--json']),
    );
    expect(
      packagedList?.options.map(
        /** @param {import('commander').Option} option */
        (option) => option.long,
      ),
    ).toEqual(expect.arrayContaining(['--limit', '--cursor', '--json']));
    expect(
      packagedList?.options.map(
        /** @param {import('commander').Option} option */
        (option) => option.long,
      ),
    ).not.toContain('--dir');
    expect(sourceOps.helpInformation()).toContain('list');
    expect(packaged.helpInformation()).toContain('list');
  });

  it('mounts the shared sensitive-log command with only the source application override', async () => {
    const { createProgram } = await import(ACTOR_SYSTEM_CLI_IMPORT);
    const { createSourceOpsCommand } = await import(SOURCE_OPS_CLI_IMPORT);
    const sourceOps = createSourceOpsCommand();
    const packaged = createProgram();
    const sourceLogs = sourceOps.commands.find(
      /** @param {import('commander').Command} command */
      (command) => command.name() === 'logs',
    );
    const packagedLogs = packaged.commands.find(
      /** @param {import('commander').Command} command */
      (command) => command.name() === 'logs',
    );

    expect(sourceLogs).toBeDefined();
    expect(packagedLogs).toBeDefined();
    expect(packagedLogs?.description()).toBe(sourceLogs?.description());
    expect(
      sourceLogs?.options.map(
        /** @param {import('commander').Option} option */
        (option) => option.long,
      ),
    ).toEqual([
      '--app-id',
      '--run-id',
      '--attempt-id',
      '--limit',
      '--cursor',
      '--confirm-sensitive-output',
      '--json',
    ]);
    expect(
      packagedLogs?.options.map(
        /** @param {import('commander').Option} option */
        (option) => option.long,
      ),
    ).toEqual([
      '--run-id',
      '--attempt-id',
      '--limit',
      '--cursor',
      '--confirm-sensitive-output',
      '--json',
    ]);
    expect(sourceLogs?.helpInformation()).toContain('--app-id <appId>');
    expect(packagedLogs?.helpInformation()).not.toContain('--app-id');
    expect(sourceOps.helpInformation()).toContain('logs');
    expect(packaged.helpInformation()).toContain('logs');
  });

  it('mounts the shared sensitive run-output command with only the source application override', async () => {
    const { createProgram } = await import(ACTOR_SYSTEM_CLI_IMPORT);
    const { createSourceOpsCommand } = await import(SOURCE_OPS_CLI_IMPORT);
    const sourceOps = createSourceOpsCommand();
    const packaged = createProgram();
    const sourceOutput = sourceOps.commands.find(
      /** @param {import('commander').Command} command */
      (command) => command.name() === 'output',
    );
    const packagedOutput = packaged.commands.find(
      /** @param {import('commander').Command} command */
      (command) => command.name() === 'output',
    );

    expect(sourceOutput).toBeDefined();
    expect(packagedOutput).toBeDefined();
    expect(packagedOutput?.description()).toBe(sourceOutput?.description());
    expect(
      sourceOutput?.options.map(
        /** @param {import('commander').Option} option */
        (option) => option.long,
      ),
    ).toEqual(['--app-id', '--run-id', '--confirm-sensitive-output', '--json']);
    expect(
      packagedOutput?.options.map(
        /** @param {import('commander').Option} option */
        (option) => option.long,
      ),
    ).toEqual(['--run-id', '--confirm-sensitive-output', '--json']);
    expect(sourceOutput?.helpInformation()).toContain('--app-id <appId>');
    expect(packagedOutput?.helpInformation()).not.toContain('--app-id');
    expect(sourceOps.helpInformation()).toContain('output');
    expect(packaged.helpInformation()).toContain('output');
  });

  it('gates packaged run output before identity and reads only through embedded app scope', async () => {
    const { createProgram } = await import(ACTOR_SYSTEM_CLI_IMPORT);
    const appId = 'packaged-run-output-demo';
    const runId = 'packaged-run-output-run';
    const persistedRevisionId = `wrv1_${'A'.repeat(43)}`;
    const embeddedRevisionId = `wrv1_${'B'.repeat(43)}`;
    const missingResolve = jest.fn(async () => ({
      appId,
      revisionId: embeddedRevisionId,
    }));
    const missingRead = jest.fn(
      async (/** @type {{appId: string, runId: string}} */ _request) => null,
    );
    const missingOutput = {
      json: jest.fn(),
      table: jest.fn(),
      failure: jest.fn(),
    };
    const unconfirmed = createProgram({
      resolveExpectedIdentity: missingResolve,
      readRunOutput: missingRead,
      runOutputOutput: missingOutput,
    });

    await unconfirmed.parseAsync(['output', '--run-id', runId, '--json'], {
      from: 'user',
    });

    expect(missingResolve).not.toHaveBeenCalled();
    expect(missingRead).not.toHaveBeenCalled();
    expect(missingOutput.json).not.toHaveBeenCalled();
    expect(missingOutput.table).not.toHaveBeenCalled();
    expect(missingOutput.failure).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('--confirm-sensitive-output'),
      }),
    );
    expect(process.exitCode).toBe(1);

    process.exitCode = originalExitCode;
    const resolveExpectedIdentity = jest.fn(async () => ({
      appId,
      revisionId: embeddedRevisionId,
    }));
    const readRunOutput = jest.fn(
      async (/** @type {{appId: string, runId: string}} */ request) => ({
        scope: {
          appId: request.appId,
          revisionId: persistedRevisionId,
          runId: request.runId,
        },
        snapshot: {
          runKind: 'manual',
          status: 'RUNNING',
          version: 1,
          lastSequence: 1,
        },
        outputs: [],
        terminal: null,
      }),
    );
    const output = {
      json: jest.fn(),
      table: jest.fn(),
      failure: jest.fn(),
    };
    const confirmed = createProgram({
      resolveExpectedIdentity,
      readRunOutput,
      runOutputOutput: output,
    });

    await confirmed.parseAsync(
      ['output', '--run-id', runId, '--confirm-sensitive-output', '--json'],
      { from: 'user' },
    );

    expect(resolveExpectedIdentity).toHaveBeenCalledTimes(1);
    expect(readRunOutput).toHaveBeenCalledWith({ appId, runId });
    expect(readRunOutput.mock.calls[0][0]).not.toHaveProperty('revisionId');
    expect(output.json).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { appId, revisionId: persistedRevisionId, runId },
      }),
      expect.any(String),
    );
    expect(output.table).not.toHaveBeenCalled();
    expect(output.failure).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(originalExitCode);
  });

  it('narrows packaged revision authority to app-scoped history at action time', async () => {
    const { createProgram } = await import(ACTOR_SYSTEM_CLI_IMPORT);
    const root = mkdtempSync(join(tmpdir(), 'wharfie-packaged-history-'));
    const controlRoot = join(root, 'missing-control');
    try {
      process.env.WHARFIE_CONTROL_ADAPTER = 'vanilla';
      process.env.WHARFIE_CONTROL_PATH = controlRoot;
      const consoleLog = jest
        .spyOn(console, 'log')
        .mockImplementation(() => undefined);
      const consoleError = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const resolveExpectedIdentity = jest.fn(async () => ({
        appId: 'packaged-history-demo',
        revisionId: `wrv1_${'A'.repeat(43)}`,
      }));
      const packaged = createProgram({ resolveExpectedIdentity });

      await packaged.parseAsync(['list', '--json'], { from: 'user' });

      expect(resolveExpectedIdentity).toHaveBeenCalledTimes(1);
      expect(consoleError).not.toHaveBeenCalled();
      expect(consoleLog).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(consoleLog.mock.calls[0][0]))).toEqual(
        expect.objectContaining({
          scope: { appId: 'packaged-history-demo' },
          items: [],
          nextCursor: null,
        }),
      );
      expect(existsSync(controlRoot)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('mounts the flat public workflow-start command with the expected source-only directory option', async () => {
    const { createProgram } = await import(ACTOR_SYSTEM_CLI_IMPORT);
    const { createSourceOpsCommand } = await import(SOURCE_OPS_CLI_IMPORT);
    const sourceOps = createSourceOpsCommand();
    const packaged = createProgram();
    const sourceStart = sourceOps.commands.find(
      /** @param {import('commander').Command} command */
      (command) => command.name() === 'start',
    );
    const packagedStart = packaged.commands.find(
      /** @param {import('commander').Command} command */
      (command) => command.name() === 'start',
    );

    expect(sourceStart).toBeDefined();
    expect(packagedStart).toBeDefined();
    expect(packagedStart?.description()).toBe(sourceStart?.description());
    expect(
      sourceStart?.options.map(
        /** @param {import('commander').Option} option */
        (option) => option.long,
      ),
    ).toEqual(
      expect.arrayContaining([
        '--workflow',
        '--idempotency-key',
        '--dir',
        '--input',
        '--caller-metadata',
        '--json',
      ]),
    );
    expect(
      packagedStart?.options.map(
        /** @param {import('commander').Option} option */
        (option) => option.long,
      ),
    ).toEqual(
      expect.arrayContaining([
        '--workflow',
        '--idempotency-key',
        '--input',
        '--caller-metadata',
        '--json',
      ]),
    );
    expect(
      packagedStart?.options.map(
        /** @param {import('commander').Option} option */
        (option) => option.long,
      ),
    ).not.toContain('--dir');
    expect(
      sourceStart?.registeredArguments.map(
        /** @param {import('commander').Argument} argument */
        (argument) => ({
          name: argument.name(),
          required: argument.required,
          variadic: argument.variadic,
        }),
      ),
    ).toEqual([{ name: 'appArgs', required: false, variadic: true }]);
    expect(
      packagedStart?.registeredArguments.map(
        /** @param {import('commander').Argument} argument */
        (argument) => ({
          name: argument.name(),
          required: argument.required,
          variadic: argument.variadic,
        }),
      ),
    ).toEqual([{ name: 'appArgs', required: false, variadic: true }]);
    expect(sourceOps.helpInformation()).toContain('start');
    expect(packaged.helpInformation()).toContain('start');
  });

  it('honors the private ledger-service runtime command and arguments', async () => {
    const { runPackagedApp } = await import(PACKAGED_APP_ENTRY_IMPORT);
    const parseAsync = jest.fn(async (_argv, _options) => undefined);
    const prepareRuntime = jest.fn(async () => undefined);
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
      prepareRuntime,
      argv: ['node', 'wharfie-artifact'],
    });

    expect(parseAsync).toHaveBeenCalledWith(
      ['node', 'ledger-service', '--once'],
      { from: 'node' },
    );
    expect(loadDeveloperCliModule).not.toHaveBeenCalled();
    expect(prepareRuntime).toHaveBeenCalledTimes(1);
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

  it.each([
    ['manifest', ['manifest']],
    ['help', []],
  ])(
    'passes the lazy developer loader to packaged operator %s without loading it',
    async (_label, operatorArgv) => {
      const { runPackagedApp } = await import(PACKAGED_APP_ENTRY_IMPORT);
      const developerCli = jest.fn(async (_argv) => undefined);
      const loadDeveloperCliModule = jest.fn(async () => ({
        default: developerCli,
      }));
      const operatorCli = jest.fn(async (_argv, _context) => undefined);
      clearRuntimeEnvironment();

      await runPackagedApp({
        loadDeveloperCliModule,
        runtimeModules: { operatorCli },
        argv: ['node', 'wharfie-artifact', 'wharfie', ...operatorArgv],
      });

      expect(loadDeveloperCliModule).not.toHaveBeenCalled();
      expect(developerCli).not.toHaveBeenCalled();
      expect(operatorCli).toHaveBeenCalledWith(
        ['node', 'wharfie-artifact', ...operatorArgv],
        { loadDeveloperCliModule },
      );
    },
  );

  it('loads the developer CLI once only when developer argv is dispatched', async () => {
    const { runPackagedApp } = await import(PACKAGED_APP_ENTRY_IMPORT);
    const developerCli = jest.fn(async (_argv) => undefined);
    const loadDeveloperCliModule = jest.fn(async () => ({
      default: developerCli,
    }));
    const prepareRuntime = jest.fn(async () => undefined);
    const argv = ['node', 'wharfie-artifact', 'serve'];
    clearRuntimeEnvironment();

    await runPackagedApp({ loadDeveloperCliModule, prepareRuntime, argv });

    expect(loadDeveloperCliModule).toHaveBeenCalledTimes(1);
    expect(developerCli).toHaveBeenCalledWith(argv);
    expect(prepareRuntime).not.toHaveBeenCalled();
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
