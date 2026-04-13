/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';

const PROCESS_RUNNER_IMPORT =
  '../../../src/core/resources/builds/actor-system-cli/lib/process-runner.js';
const START_IMPORT =
  '../../../src/core/resources/builds/actor-system-cli/start.js';
const DB_CMD_IMPORT =
  '../../../src/core/resources/builds/actor-system-cli/serve_cmds/db.js';
const QUEUE_CMD_IMPORT =
  '../../../src/core/resources/builds/actor-system-cli/serve_cmds/queue.js';
const LAMBDA_CMD_IMPORT =
  '../../../src/core/resources/builds/actor-system-cli/serve_cmds/lambda.js';
const NODE_AGENT_IMPORT = '../../../src/core/runtime/services/node-agent.js';
const RESOURCE_UTIL_IMPORT =
  '../../../src/core/resources/builds/actor-system-cli/control_cmds/state_cmds/util/resources.js';
const SPAWN_SELF_IMPORT =
  '../../../src/core/resources/builds/actor-system-cli/control_cmds/state_cmds/util/spawn-self.js';
const DB_SERVICE_IMPORT = '../../../src/core/runtime/services/db-service.js';
const QUEUE_SERVICE_IMPORT =
  '../../../src/core/runtime/services/queue-service.js';
const FUNCTION_IMPORT = '../../../src/core/resources/builds/function.js';
const RUNTIME_RESOURCES_IMPORT = '../../../src/core/runtime/resources.js';
const RPC_GRPC_IMPORT = '../../../src/core/runtime/services/rpc-grpc.js';
const LAMBDA_SERVICE_IMPORT =
  '../../../src/core/runtime/services/lambda-service.js';

/**
 * @returns {Promise<void>} - Result.
 */
async function flushTurn() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

/**
 * @returns {{ listeners: Map<string, (...args: any[]) => any>, restore: () => void }} - Result.
 */
function captureSignals() {
  /** @type {Map<string, (...args: any[]) => any>} */
  const listeners = new Map();
  const processOn = jest
    .spyOn(process, 'on')
    .mockImplementation((eventName, handler) => {
      listeners.set(String(eventName), handler);
      return process;
    });

  return {
    listeners,
    restore: () => {
      processOn.mockRestore();
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('actor-system CLI runtime surfaces', () => {
  it('captures stdout/stderr for successful process runs', async () => {
    const { runProcess } = await import(PROCESS_RUNNER_IMPORT);

    const result = await runProcess(
      process.execPath,
      [
        '-e',
        "process.stdout.write(process.env.WHARFIE_TEST_VALUE); process.stderr.write('warn');",
      ],
      {
        env: { WHARFIE_TEST_VALUE: 'ok' },
      },
    );

    expect(result).toEqual({
      code: 0,
      stdout: 'ok',
      stderr: 'warn',
    });
  });

  it('turns non-zero child exits into deterministic errors', async () => {
    const { runProcess } = await import(PROCESS_RUNNER_IMPORT);

    await expect(
      runProcess(process.execPath, [
        '-e',
        "process.stderr.write('boom'); process.exit(5);",
      ]),
    ).rejects.toThrow(/failed with 5: boom/);
  });

  it('wires the start command into NodeAgent with parsed options', async () => {
    const agentStart = jest.fn(async () => {});
    const agentStop = jest.fn(async () => {});
    const agentWaitForever = jest.fn(async () => {});
    const NodeAgent = jest.fn().mockImplementation(function (options) {
      this.options = options;
      this.start = agentStart;
      this.stop = agentStop;
      this.waitForever = agentWaitForever;
    });
    const loadResourcesSpec = jest.fn((opts) => ({
      queue: { adapter: 'memory', options: { path: '.wharfie/queue' } },
    }));
    const getSelfSpawnCommand = jest.fn(() => ({
      cmd: '/fake/node',
      prefixArgs: ['/fake/cli'],
    }));

    await jest.unstable_mockModule(NODE_AGENT_IMPORT, () => ({
      default: NodeAgent,
    }));
    await jest.unstable_mockModule(RESOURCE_UTIL_IMPORT, () => ({
      loadResourcesSpec,
    }));
    await jest.unstable_mockModule(SPAWN_SELF_IMPORT, () => ({
      getSelfSpawnCommand,
    }));
    await jest.unstable_mockModule('node:crypto', () => ({
      randomUUID: () => 'node-123',
    }));

    const processOn = jest
      .spyOn(process, 'on')
      .mockImplementation(() => process);

    const { default: startCmd } = await import(START_IMPORT);

    await startCmd.parseAsync(
      [
        'node',
        'start',
        '--role',
        'worker',
        '--lambda-host',
        '127.0.0.1',
        '--lambda-port',
        '9001',
        '--db-address',
        'db.remote:1111',
        '--queue-address',
        'queue.remote:2222',
        '--poll-queue-url',
        'queue://one',
        '--poll-queue-url',
        'queue://two',
      ],
      { from: 'node' },
    );

    expect(loadResourcesSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'worker',
        lambdaHost: '127.0.0.1',
        lambdaPort: 9001,
        dbAddress: 'db.remote:1111',
        queueAddress: 'queue.remote:2222',
        pollQueueUrl: ['queue://one', 'queue://two'],
      }),
    );
    expect(NodeAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'node-123',
        role: 'worker',
        resourcesSpec: {
          queue: { adapter: 'memory', options: { path: '.wharfie/queue' } },
        },
        cmd: '/fake/node',
        prefixArgs: ['/fake/cli'],
        lambdaHost: '127.0.0.1',
        lambdaPort: 9001,
        dbAddressOverride: 'db.remote:1111',
        queueAddressOverride: 'queue.remote:2222',
        pollQueueUrls: ['queue://one', 'queue://two'],
      }),
    );
    expect(agentStart).toHaveBeenCalledTimes(1);
    expect(agentWaitForever).toHaveBeenCalledTimes(1);
    expect(processOn).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(processOn).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  });

  it('rejects invalid roles before constructing the node agent', async () => {
    const NodeAgent = jest.fn();

    await jest.unstable_mockModule(NODE_AGENT_IMPORT, () => ({
      default: NodeAgent,
    }));
    await jest.unstable_mockModule(RESOURCE_UTIL_IMPORT, () => ({
      loadResourcesSpec: () => ({ db: { adapter: 'memory' } }),
    }));
    await jest.unstable_mockModule(SPAWN_SELF_IMPORT, () => ({
      getSelfSpawnCommand: () => ({ cmd: '/fake/node', prefixArgs: [] }),
    }));
    await jest.unstable_mockModule('node:crypto', () => ({
      randomUUID: () => 'node-123',
    }));

    const { default: startCmd } = await import(START_IMPORT);

    await expect(
      startCmd.parseAsync(['node', 'start', '--role', 'broken'], {
        from: 'node',
      }),
    ).rejects.toThrow(/Invalid --role: broken/);

    expect(NodeAgent).not.toHaveBeenCalled();
  });

  it('starts and stops the DB serve command using the resolved resources spec', async () => {
    const close = jest.fn(async () => {});
    const loadResourcesSpec = jest.fn((opts) => ({
      db: { adapter: 'vanilla', options: { path: '.wharfie/db' } },
    }));
    const startDbService = jest.fn(async (opts) => ({
      address: '127.0.0.1:9101',
      close,
    }));

    await jest.unstable_mockModule(RESOURCE_UTIL_IMPORT, () => ({
      loadResourcesSpec,
    }));
    await jest.unstable_mockModule(DB_SERVICE_IMPORT, () => ({
      startDbService,
    }));

    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const { listeners, restore } = captureSignals();
    const { default: dbCmd } = await import(DB_CMD_IMPORT);

    try {
      const parsePromise = dbCmd.parseAsync(
        ['node', 'db', '--host', '127.0.0.1', '--port', '9101'],
        { from: 'node' },
      );

      await flushTurn();

      await listeners.get('SIGTERM')?.();
      await parsePromise;
    } finally {
      restore();
    }

    expect(loadResourcesSpec).toHaveBeenCalledWith(
      expect.objectContaining({ host: '127.0.0.1', port: 9101 }),
    );
    expect(startDbService).toHaveBeenCalledWith(
      expect.objectContaining({
        dbSpec: { adapter: 'vanilla', options: { path: '.wharfie/db' } },
        host: '127.0.0.1',
        port: 9101,
        log: expect.any(Function),
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('fails cleanly when the DB serve command has no db spec', async () => {
    await jest.unstable_mockModule(RESOURCE_UTIL_IMPORT, () => ({
      loadResourcesSpec: () => ({}),
    }));
    await jest.unstable_mockModule(DB_SERVICE_IMPORT, () => ({
      startDbService: jest.fn(),
    }));

    const { default: dbCmd } = await import(DB_CMD_IMPORT);

    await expect(
      dbCmd.parseAsync(['node', 'db'], { from: 'node' }),
    ).rejects.toThrow(/DB service requires resources\.db/);
  });

  it('starts and stops the Queue serve command using the resolved resources spec', async () => {
    const close = jest.fn(async () => {});
    const loadResourcesSpec = jest.fn((opts) => ({
      queue: { adapter: 'vanilla', options: { path: '.wharfie/queue' } },
    }));
    const startQueueService = jest.fn(async (opts) => ({
      address: '127.0.0.1:9102',
      close,
    }));

    await jest.unstable_mockModule(RESOURCE_UTIL_IMPORT, () => ({
      loadResourcesSpec,
    }));
    await jest.unstable_mockModule(QUEUE_SERVICE_IMPORT, () => ({
      startQueueService,
    }));

    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const { listeners, restore } = captureSignals();
    const { default: queueCmd } = await import(QUEUE_CMD_IMPORT);

    try {
      const parsePromise = queueCmd.parseAsync(
        ['node', 'queue', '--host', '127.0.0.1', '--port', '9102'],
        { from: 'node' },
      );

      await flushTurn();

      await listeners.get('SIGINT')?.();
      await parsePromise;
    } finally {
      restore();
    }

    expect(loadResourcesSpec).toHaveBeenCalledWith(
      expect.objectContaining({ host: '127.0.0.1', port: 9102 }),
    );
    expect(startQueueService).toHaveBeenCalledWith(
      expect.objectContaining({
        queueSpec: { adapter: 'vanilla', options: { path: '.wharfie/queue' } },
        host: '127.0.0.1',
        port: 9102,
        log: expect.any(Function),
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('wires the Lambda serve command, queue polling, and shutdown hooks', async () => {
    const functionRun = jest.fn(async (..._args) => {});
    const dbClient = {
      __wharfie_closeTransport: jest.fn(),
    };
    const queueClient = {
      __wharfie_closeTransport: jest.fn(),
    };
    const objectStorage = { adapter: 'memory' };
    const closeLocal = jest.fn(async () => {});
    const closeLambdaService = jest.fn(async () => {});
    /** @type {any} */
    let lambdaOptions;

    await jest.unstable_mockModule(RESOURCE_UTIL_IMPORT, () => ({
      loadResourcesSpec: () => ({
        objectStorage: {
          adapter: 'vanilla',
          options: { path: '.wharfie/object-storage' },
        },
      }),
    }));
    await jest.unstable_mockModule(FUNCTION_IMPORT, () => ({
      default: {
        run: functionRun,
      },
    }));
    await jest.unstable_mockModule(RUNTIME_RESOURCES_IMPORT, () => ({
      createActorSystemResources: jest.fn(async (spec) => ({
        resources: { objectStorage },
        close: closeLocal,
      })),
    }));
    await jest.unstable_mockModule(RPC_GRPC_IMPORT, () => ({
      createGrpcRpcClient: jest.fn().mockImplementation((...args) => {
        const [options] = /** @type {any[]} */ (args);
        return options.address === 'db.remote:9100' ? dbClient : queueClient;
      }),
    }));
    await jest.unstable_mockModule(LAMBDA_SERVICE_IMPORT, () => ({
      startLambdaService: jest.fn(async (options) => {
        lambdaOptions = options;
        return {
          address: '127.0.0.1:9103',
          close: closeLambdaService,
        };
      }),
    }));

    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const { listeners, restore } = captureSignals();
    const { default: lambdaCmd } = await import(LAMBDA_CMD_IMPORT);
    const { createActorSystemResources } = await import(
      RUNTIME_RESOURCES_IMPORT
    );
    const { createGrpcRpcClient } = await import(RPC_GRPC_IMPORT);
    const { startLambdaService } = await import(LAMBDA_SERVICE_IMPORT);

    try {
      const parsePromise = lambdaCmd.parseAsync(
        [
          'node',
          'lambda',
          '--host',
          '127.0.0.1',
          '--port',
          '9103',
          '--db-address',
          'db.remote:9100',
          '--queue-address',
          'queue.remote:9200',
          '--poll-queue-url',
          'queue://one',
          '--poll-queue-url',
          'queue://two',
          '--poll-wait-seconds',
          '3',
          '--poll-max-messages',
          '4',
          '--poll-visibility-timeout',
          '45',
        ],
        { from: 'node' },
      );

      await flushTurn();

      await lambdaOptions.execute({
        functionName: 'alpha',
        event: { ok: true },
        context: null,
      });

      await listeners.get('SIGTERM')?.();
      await parsePromise;

      expect(createActorSystemResources).toHaveBeenCalledWith({
        objectStorage: {
          adapter: 'vanilla',
          options: { path: '.wharfie/object-storage' },
        },
      });
      expect(createGrpcRpcClient).toHaveBeenCalledTimes(2);
      expect(createGrpcRpcClient).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          address: 'db.remote:9100',
          log: expect.any(Function),
        }),
      );
      expect(createGrpcRpcClient).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          address: 'queue.remote:9200',
          log: expect.any(Function),
        }),
      );
      expect(startLambdaService).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '127.0.0.1',
          port: 9103,
          log: expect.any(Function),
          poll: expect.objectContaining({
            queue: queueClient,
            queueUrls: ['queue://one', 'queue://two'],
            waitTimeSeconds: 3,
            maxNumberOfMessages: 4,
            visibilityTimeout: 45,
            log: expect.any(Function),
          }),
          execute: expect.any(Function),
        }),
      );
      expect(functionRun).toHaveBeenCalledWith(
        'alpha',
        { ok: true },
        {},
        {
          resources: {
            db: dbClient,
            queue: queueClient,
            objectStorage,
          },
        },
      );
      expect(closeLambdaService).toHaveBeenCalledTimes(1);
      expect(closeLocal).toHaveBeenCalledTimes(1);
      expect(dbClient.__wharfie_closeTransport).toHaveBeenCalledTimes(1);
      expect(queueClient.__wharfie_closeTransport).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it('treats missing Lambda state addresses as a commander parse failure', async () => {
    const { default: lambdaCmd } = await import(LAMBDA_CMD_IMPORT);

    lambdaCmd.exitOverride();
    lambdaCmd.configureOutput({
      writeOut: () => {},
      writeErr: () => {},
    });

    await expect(
      lambdaCmd.parseAsync(['node', 'lambda'], { from: 'node' }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/--db-address/),
    });
  });
});
