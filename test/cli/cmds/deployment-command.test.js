import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { createCanonicalJsonSha256Id } from '../../../src/core/runtime/content-id.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../../src/core/runtime/deployment-profile.js';
import {
  DEPLOYMENT_INSTANCE_ID_DOMAIN,
  DEPLOYMENT_INSTANCE_ID_PREFIX,
} from '../../../src/core/runtime/deployment-provider-scope.js';

const AWS_SOURCE_DEPLOYMENT_IMPORT =
  '../../../src/cli/app/aws-source-deployment.js';
const AWS_LIFECYCLE_IMPORT =
  '../../../src/core/runtime/deployment-aws-lifecycle.js';
const SOURCE_COMMAND_IMPORT = '../../../src/cli/cmds/deployment.js';
const PACKAGED_COMMAND_IMPORT =
  '../../../src/core/resources/builds/actor-system-cli/control_cmds/deployment.js';

const prepareAwsSelectedSeaPlan = jest.fn();
const applyAwsSelectedSea = jest.fn();
const applyAwsPreparedStagedPlan = jest.fn();
const destroyAwsDeployment = jest.fn();
const inspectAwsDeployment = jest.fn();
const reconcileAwsStagedDeployment = jest.fn();
const applyAwsPreparedRunningSeaPlan = jest.fn();
const applyAwsRunningSea = jest.fn();
const prepareAwsRunningSeaPlan = jest.fn();
const reconcileAwsRunningSeaDeployment = jest.fn();

jest.unstable_mockModule(AWS_SOURCE_DEPLOYMENT_IMPORT, () => ({
  applyAwsSelectedSea,
  prepareAwsSelectedSeaPlan,
}));
jest.unstable_mockModule(AWS_LIFECYCLE_IMPORT, () => ({
  applyAwsPreparedRunningSeaPlan,
  applyAwsPreparedStagedPlan,
  applyAwsRunningSea,
  destroyAwsDeployment,
  inspectAwsDeployment,
  prepareAwsRunningSeaPlan,
  reconcileAwsRunningSeaDeployment,
  reconcileAwsStagedDeployment,
}));

const { createSourceDeploymentCommand } = await import(SOURCE_COMMAND_IMPORT);
const { createPackagedDeploymentCommand } = await import(
  PACKAGED_COMMAND_IMPORT
);

const PROFILE = createDeploymentProfile({
  profile: { id: 'production' },
  appId: 'adapter-app',
  target: {
    nodeVersion: '24.13.1',
    platform: 'linux',
    architecture: 'x64',
    libc: 'glibc',
  },
  mode: { kind: 'single-node-systemd-user', version: 1 },
  provider: createAwsSingleNodeProvider('us-east-1'),
});
const DEPLOYMENT_INSTANCE_ID = createCanonicalJsonSha256Id({
  domain: DEPLOYMENT_INSTANCE_ID_DOMAIN,
  prefix: DEPLOYMENT_INSTANCE_ID_PREFIX,
  value: { appId: 'adapter-app', deployment: { id: 'production' } },
});
const PREPARED = Object.freeze({
  kind: 'testPreparedDeployment',
  deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
});
const LEAF_NAMES = Object.freeze([
  'plan',
  'apply',
  'inspect',
  'reconcile',
  'destroy',
]);
const DEFAULT_OPERATIONS = Object.freeze([
  prepareAwsSelectedSeaPlan,
  applyAwsSelectedSea,
  applyAwsPreparedStagedPlan,
  destroyAwsDeployment,
  inspectAwsDeployment,
  reconcileAwsStagedDeployment,
  applyAwsPreparedRunningSeaPlan,
  applyAwsRunningSea,
  prepareAwsRunningSeaPlan,
  reconcileAwsRunningSeaDeployment,
]);

/** @param {string} method @returns {Record<string, string>} */
function operationResult(method) {
  return { method };
}

/**
 * @returns {Record<string, jest.Mock>}
 */
function makeInjectedOperations() {
  return {
    prepare: jest.fn(async () => operationResult('prepare')),
    apply: jest.fn(async () => operationResult('apply')),
    applyPrepared: jest.fn(async () => operationResult('applyPrepared')),
    inspect: jest.fn(async () => operationResult('inspect')),
    reconcile: jest.fn(async () => operationResult('reconcile')),
    destroy: jest.fn(async () => operationResult('destroy')),
  };
}

/**
 * @param {(options?: Record<string, any>) => import('commander').Command} factory
 * @param {Record<string, any>} [operations]
 * @returns {{command: import('commander').Command, output: Record<string, jest.Mock>, processRef: {cwd: jest.Mock<() => string>, exitCode: number | undefined}, readJsonObjectFile: jest.Mock}}
 */
function makeHarness(factory, operations = undefined) {
  const output = {
    json: jest.fn(),
    table: jest.fn(),
    info: jest.fn(),
    failure: jest.fn(),
  };
  /** @type {{cwd: jest.Mock<() => string>, exitCode: number | undefined}} */
  const processRef = {
    cwd: jest.fn(() => '/workspace/default-app'),
    exitCode: undefined,
  };
  const readJsonObjectFile = jest.fn(
    async (/** @type {unknown} */ filePath) => {
      if (filePath === 'profile.json') return PROFILE;
      if (filePath === 'plan.json') return PREPARED;
      throw new Error(`Unexpected JSON document ${String(filePath)}.`);
    },
  );
  return {
    command: factory({
      ...(operations === undefined ? {} : { operations }),
      output,
      processRef,
      readJsonObjectFile,
    }),
    output,
    processRef,
    readJsonObjectFile,
  };
}

/**
 * @param {import('commander').Command} command
 * @param {string[]} argv
 * @returns {Promise<void>}
 */
async function parse(command, argv) {
  await command.parseAsync(argv, { from: 'user' });
}

/**
 * @param {import('commander').Command} parent
 * @param {string} name
 * @returns {import('commander').Command}
 */
function leaf(parent, name) {
  const command = parent.commands.find(
    (candidate) => candidate.name() === name,
  );
  if (!command) throw new Error(`Missing deployment command ${name}.`);
  return command;
}

/**
 * @param {jest.Mock} operation
 * @param {Record<string, any>} expected
 * @returns {void}
 */
function expectExactCall(operation, expected) {
  expect(operation).toHaveBeenCalledTimes(1);
  expect(operation.mock.calls[0]).toStrictEqual([expected]);
}

/**
 * @param {() => import('commander').Command} factory
 * @returns {void}
 */
function expectFreshLeaves(factory) {
  const first = factory();
  const second = factory();

  expect(first.name()).toBe('deployment');
  expect(second.name()).toBe('deployment');
  expect(
    first.commands.map((/** @type {import('commander').Command} */ command) =>
      command.name(),
    ),
  ).toStrictEqual(LEAF_NAMES);
  expect(
    second.commands.map((/** @type {import('commander').Command} */ command) =>
      command.name(),
    ),
  ).toStrictEqual(LEAF_NAMES);
  expect(second).not.toBe(first);
  for (let index = 0; index < LEAF_NAMES.length; index += 1) {
    expect(first.commands[index].parent).toBe(first);
    expect(second.commands[index].parent).toBe(second);
    expect(second.commands[index]).not.toBe(first.commands[index]);
  }
}

beforeEach(() => {
  for (const operation of DEFAULT_OPERATIONS) {
    operation.mockReset();
    operation.mockImplementation(() =>
      Promise.resolve(operationResult('default')),
    );
  }
});

describe('deployment command adapters', () => {
  it('has source and packaged factories with exactly five fresh leaves', () => {
    expect(createSourceDeploymentCommand).toEqual(expect.any(Function));
    expect(createPackagedDeploymentCommand).toEqual(expect.any(Function));
    expectFreshLeaves(createSourceDeploymentCommand);
    expectFreshLeaves(createPackagedDeploymentCommand);
  });

  it('limits source path options to source plan and direct apply', () => {
    const source = createSourceDeploymentCommand();
    const packaged = createPackagedDeploymentCommand();

    expect(leaf(source, 'plan').options.map((option) => option.long)).toEqual([
      '--profile',
      '--control-policy',
      '--json',
      '--dir',
      '--output-dir',
    ]);
    expect(leaf(source, 'apply').options.map((option) => option.long)).toEqual([
      '--profile',
      '--plan',
      '--control-policy',
      '--json',
      '--dir',
      '--output-dir',
    ]);
    expect(leaf(packaged, 'plan').options.map((option) => option.long)).toEqual(
      ['--profile', '--control-policy', '--json'],
    );
    expect(
      leaf(packaged, 'apply').options.map((option) => option.long),
    ).toEqual(['--profile', '--plan', '--control-policy', '--json']);
    for (const name of ['inspect', 'reconcile', 'destroy']) {
      expect(
        leaf(source, name).options.map((option) => option.long),
      ).not.toEqual(expect.arrayContaining(['--dir', '--output-dir']));
      expect(
        leaf(packaged, name).options.map((option) => option.long),
      ).not.toEqual(expect.arrayContaining(['--dir', '--output-dir']));
    }
  });

  it('rejects malformed partial operation overrides without invoking accessors or falling through', () => {
    for (const factory of [
      createSourceDeploymentCommand,
      createPackagedDeploymentCommand,
    ]) {
      expect(() => factory({ operations: /** @type {any} */ (false) })).toThrow(
        'deployment operation overrides must be a plain partial object.',
      );
      expect(() =>
        factory({ operations: { prepare: /** @type {any} */ (null) } }),
      ).toThrow(
        'deployment operation override prepare must be an own enumerable function.',
      );
      expect(() => factory({ operations: { unsupported: jest.fn() } })).toThrow(
        'deployment operation overrides contain an unsupported method.',
      );
      expect(() =>
        factory({
          operations: {
            [Symbol('prepare')]: jest.fn(),
          },
        }),
      ).toThrow(
        'deployment operation overrides contain an unsupported method.',
      );

      const inherited = Object.create({ prepare: jest.fn() });
      expect(() => factory({ operations: inherited })).toThrow(
        'deployment operation overrides must be a plain partial object.',
      );

      let accessorReads = 0;
      const accessor = {};
      Object.defineProperty(accessor, 'prepare', {
        enumerable: true,
        get() {
          accessorReads += 1;
          return jest.fn();
        },
      });
      expect(() => factory({ operations: accessor })).toThrow(
        'deployment operation override prepare must be an own enumerable function.',
      );
      expect(accessorReads).toBe(0);
    }
    for (const operation of DEFAULT_OPERATIONS) {
      expect(operation).not.toHaveBeenCalled();
    }
  });

  it('snapshots valid partial overrides before constructing either command tree', async () => {
    for (const factory of [
      createSourceDeploymentCommand,
      createPackagedDeploymentCommand,
    ]) {
      const original = jest.fn(async () => operationResult('original'));
      const replacement = jest.fn(async () => operationResult('replacement'));
      const overrides = { prepare: original };
      const harness = makeHarness(factory, overrides);
      overrides.prepare = replacement;

      await parse(harness.command, [
        'plan',
        'production',
        '--profile',
        'profile.json',
        '--control-policy',
        'require-active',
        '--json',
      ]);

      expect(original).toHaveBeenCalledTimes(1);
      expect(replacement).not.toHaveBeenCalled();
      expect(harness.output.failure).not.toHaveBeenCalled();
    }
  });
});

describe('source deployment command adapter', () => {
  it('maps plan source fields into the exact selected-SEA package request', async () => {
    const harness = makeHarness(createSourceDeploymentCommand);

    await parse(harness.command, [
      'plan',
      'production',
      '--profile',
      'profile.json',
      '--control-policy',
      'reconcile-existing',
      '--dir',
      './app',
      '--output-dir',
      './artifacts',
      '--json',
    ]);

    expectExactCall(prepareAwsSelectedSeaPlan, {
      packageRequest: {
        dir: './app',
        outputDir: './artifacts',
        target: PROFILE.target,
      },
      deployment: { id: 'production' },
      profile: PROFILE,
      controlPolicy: 'reconcile-existing',
    });
    expect(harness.readJsonObjectFile).toHaveBeenCalledWith(
      'profile.json',
      'deployment profile',
    );
    expect(harness.output.failure).not.toHaveBeenCalled();
  });

  it('maps direct apply to the selected SEA with cwd and no output path', async () => {
    const harness = makeHarness(createSourceDeploymentCommand);

    await parse(harness.command, [
      'apply',
      'production',
      '--profile',
      'profile.json',
      '--json',
    ]);

    expectExactCall(applyAwsSelectedSea, {
      packageRequest: {
        dir: '/workspace/default-app',
        target: PROFILE.target,
      },
      deployment: { id: 'production' },
      profile: PROFILE,
      controlPolicy: 'bootstrap',
    });
    expect(harness.processRef.cwd).toHaveBeenCalledTimes(1);
    expect(harness.output.failure).not.toHaveBeenCalled();
  });

  it.each([
    [
      'prepared apply',
      [
        'apply',
        '--plan',
        'plan.json',
        '--control-policy',
        'reconcile-existing',
        '--json',
      ],
      applyAwsPreparedStagedPlan,
      {
        prepared: PREPARED,
        controlPolicy: 'reconcile-existing',
      },
    ],
    [
      'inspect',
      ['inspect', DEPLOYMENT_INSTANCE_ID, '--region', 'us-east-1', '--json'],
      inspectAwsDeployment,
      {
        deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
        region: 'us-east-1',
        controlPolicy: 'require-active',
      },
    ],
    [
      'reconcile',
      [
        'reconcile',
        DEPLOYMENT_INSTANCE_ID,
        '--region',
        'us-east-1',
        '--control-policy',
        'bootstrap',
        '--confirm-coordinator-stopped',
        '--json',
      ],
      reconcileAwsStagedDeployment,
      {
        deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
        region: 'us-east-1',
        controlPolicy: 'bootstrap',
        confirmCoordinatorStopped: true,
      },
    ],
    [
      'destroy',
      ['destroy', DEPLOYMENT_INSTANCE_ID, '--region', 'us-east-1', '--json'],
      destroyAwsDeployment,
      {
        deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
        region: 'us-east-1',
        controlPolicy: 'require-active',
      },
    ],
  ])(
    'passes %s through to the staged lifecycle operation',
    async (_name, argv, operation, expected) => {
      const harness = makeHarness(createSourceDeploymentCommand);

      await parse(harness.command, argv);

      expectExactCall(operation, expected);
      expect(harness.output.failure).not.toHaveBeenCalled();
    },
  );
});

describe('packaged deployment command adapter', () => {
  it.each([
    [
      'plan',
      'prepare',
      [
        'plan',
        'production',
        '--profile',
        'profile.json',
        '--control-policy',
        'reconcile-existing',
        '--json',
      ],
      {
        deployment: { id: 'production' },
        profile: PROFILE,
        controlPolicy: 'reconcile-existing',
      },
    ],
    [
      'direct apply',
      'apply',
      ['apply', 'production', '--profile', 'profile.json', '--json'],
      {
        deployment: { id: 'production' },
        profile: PROFILE,
        controlPolicy: 'bootstrap',
      },
    ],
    [
      'prepared apply',
      'applyPrepared',
      ['apply', '--plan', 'plan.json', '--json'],
      {
        prepared: PREPARED,
        controlPolicy: 'require-active',
      },
    ],
    [
      'inspect',
      'inspect',
      ['inspect', DEPLOYMENT_INSTANCE_ID, '--region', 'us-east-1', '--json'],
      {
        deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
        region: 'us-east-1',
        controlPolicy: 'require-active',
      },
    ],
    [
      'reconcile',
      'reconcile',
      [
        'reconcile',
        DEPLOYMENT_INSTANCE_ID,
        '--region',
        'us-east-1',
        '--confirm-coordinator-stopped',
        '--json',
      ],
      {
        deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
        region: 'us-east-1',
        controlPolicy: 'require-active',
        confirmCoordinatorStopped: true,
      },
    ],
    [
      'destroy',
      'destroy',
      [
        'destroy',
        DEPLOYMENT_INSTANCE_ID,
        '--region',
        'us-east-1',
        '--control-policy',
        'reconcile-existing',
        '--json',
      ],
      {
        deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
        region: 'us-east-1',
        controlPolicy: 'reconcile-existing',
      },
    ],
  ])(
    'maps %s to the injected %s operation',
    async (_name, method, argv, expected) => {
      const operations = makeInjectedOperations();
      const harness = makeHarness(createPackagedDeploymentCommand, operations);

      await parse(harness.command, argv);

      expectExactCall(operations[method], expected);
      for (const [otherMethod, operation] of Object.entries(operations)) {
        if (otherMethod !== method) expect(operation).not.toHaveBeenCalled();
      }
      expect(harness.processRef.cwd).not.toHaveBeenCalled();
      expect(harness.output.failure).not.toHaveBeenCalled();
    },
  );
});
