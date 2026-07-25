import { describe, expect, it, jest } from '@jest/globals';

import { createCanonicalJsonSha256Id } from '../../../src/core/runtime/content-id.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../../src/core/runtime/deployment-profile.js';
import {
  DEPLOYMENT_INSTANCE_ID_DOMAIN,
  DEPLOYMENT_INSTANCE_ID_PREFIX,
} from '../../../src/core/runtime/deployment-provider-scope.js';
import { createDeploymentCommand } from '../../../src/core/runtime/operator/deployment-command.js';

const PROFILE = createDeploymentProfile({
  profile: { id: 'production' },
  appId: 'command-app',
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
  value: { appId: 'command-app', deployment: { id: 'production' } },
});

/** @param {string} method @returns {Record<string, any>} */
function operationResult(method) {
  return Object.freeze({
    method,
    phase: method === 'destroy' ? 'DESTROYED' : 'READY',
    deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
  });
}

/**
 * @param {Partial<Record<string, (...args: any[]) => any>>} [overrides] - Method overrides.
 * @returns {Record<string, jest.Mock>} - Exact operation owner.
 */
function makeOperations(overrides = {}) {
  /** @type {Record<string, jest.Mock>} */
  const operations = {};
  for (const method of [
    'prepare',
    'apply',
    'applyPrepared',
    'inspect',
    'reconcile',
    'destroy',
  ]) {
    const implementation =
      overrides[method] ??
      function defaultOperation() {
        return Promise.resolve(operationResult(method));
      };
    operations[method] = jest.fn(
      /** @type {(...args: any[]) => any} */ (implementation),
    );
  }
  return operations;
}

/**
 * @param {{source?: boolean, operations?: Record<string, any>, readJsonObjectFile?: jest.Mock<(filePath: unknown, label?: string) => Promise<Record<string, any>>>, cwd?: string}} [options] - Harness options.
 * @returns {{command: import('commander').Command, operations: Record<string, jest.Mock>, readJsonObjectFile: jest.Mock<(filePath: unknown, label?: string) => Promise<Record<string, any>>>, output: Record<string, jest.Mock>, processRef: {cwd: jest.Mock<() => string>, exitCode: number | undefined}}} - Command harness.
 */
function makeHarness(options = {}) {
  const operations = options.operations ?? makeOperations();
  const readJsonObjectFile =
    options.readJsonObjectFile ??
    jest.fn(async (/** @type {unknown} */ filePath, _label = undefined) =>
      filePath === 'profile.json' ? PROFILE : { prepared: true },
    );
  const output = {
    json: jest.fn(),
    table: jest.fn(),
    info: jest.fn(),
    failure: jest.fn(),
  };
  /** @type {{cwd: jest.Mock<() => string>, exitCode: number | undefined}} */
  const processRef = {
    cwd: jest.fn(() => options.cwd ?? '/workspace/source-app'),
    exitCode: undefined,
  };
  return {
    command: createDeploymentCommand({
      operations,
      includeSourceOptions: options.source === true,
      readJsonObjectFile,
      output,
      processRef,
    }),
    operations,
    readJsonObjectFile,
    output,
    processRef,
  };
}

/**
 * @param {import('commander').Command} command - Parent command.
 * @param {string[]} argv - User arguments.
 * @returns {Promise<void>} - Completed parse.
 */
async function parse(command, argv) {
  await command.parseAsync(argv, { from: 'user' });
}

/** @param {import('commander').Command} command @param {string} name */
function leaf(command, name) {
  const found = command.commands.find((candidate) => candidate.name() === name);
  if (!found) throw new Error(`Missing command ${name}.`);
  return found;
}

describe('shared deployment command surface', () => {
  it('creates exactly five fresh leaves for every parent', () => {
    const first = makeHarness().command;
    const second = makeHarness().command;

    expect(first.name()).toBe('deployment');
    expect(first.commands.map((command) => command.name())).toEqual([
      'plan',
      'apply',
      'inspect',
      'reconcile',
      'destroy',
    ]);
    expect(second.commands.map((command) => command.name())).toEqual([
      'plan',
      'apply',
      'inspect',
      'reconcile',
      'destroy',
    ]);
    expect(second).not.toBe(first);
    for (let index = 0; index < first.commands.length; index += 1) {
      expect(second.commands[index]).not.toBe(first.commands[index]);
      expect(first.commands[index].parent).toBe(first);
      expect(second.commands[index].parent).toBe(second);
    }
  });

  it('adds directory and package-output options only to source plan and apply', () => {
    const source = makeHarness({ source: true }).command;
    const packaged = makeHarness().command;

    for (const name of ['plan', 'apply']) {
      expect(leaf(source, name).options.map((option) => option.long)).toEqual(
        expect.arrayContaining(['--dir', '--output-dir']),
      );
      expect(
        leaf(packaged, name).options.map((option) => option.long),
      ).not.toEqual(expect.arrayContaining(['--dir', '--output-dir']));
    }
    for (const name of ['inspect', 'reconcile', 'destroy']) {
      expect(
        leaf(source, name).options.map((option) => option.long),
      ).not.toEqual(expect.arrayContaining(['--dir', '--output-dir']));
      expect(
        leaf(packaged, name).options.map((option) => option.long),
      ).not.toEqual(expect.arrayContaining(['--dir', '--output-dir']));
    }
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
    expect(
      leaf(source, 'plan').options.find(
        (option) => option.long === '--control-policy',
      )?.mandatory,
    ).toBe(true);
    expect(
      leaf(source, 'apply').options.find(
        (option) => option.long === '--control-policy',
      )?.mandatory,
    ).toBe(false);
  });

  it('requires the complete six-method operation port at construction', () => {
    const operations = makeOperations();
    delete operations.destroy;

    expect(() => createDeploymentCommand({ operations })).toThrow(
      'deployment command operations.destroy is required.',
    );
    expect(() =>
      createDeploymentCommand({
        operations: makeOperations(),
        readJsonObjectFile: /** @type {any} */ ('not-a-reader'),
      }),
    ).toThrow('createDeploymentCommand readJsonObjectFile must be a function.');
    for (const readJsonObjectFile of [null, false, '']) {
      expect(() =>
        createDeploymentCommand(
          /** @type {any} */ ({
            operations: makeOperations(),
            readJsonObjectFile,
          }),
        ),
      ).toThrow(
        'createDeploymentCommand readJsonObjectFile must be a function.',
      );
    }
    expect(() =>
      createDeploymentCommand({
        operations: makeOperations(),
        output: { json: /** @type {any} */ (null) },
      }),
    ).toThrow(
      'deployment command output.json must be an own enumerable function.',
    );
    expect(() =>
      createDeploymentCommand({
        operations: makeOperations(),
        processRef: /** @type {any} */ (false),
      }),
    ).toThrow('deployment command processRef must be a plain process object.');
    expect(() =>
      createDeploymentCommand({
        operations: makeOperations(),
        includeSourceOptions: true,
        processRef: { exitCode: undefined },
      }),
    ).toThrow('source deployment command processRef.cwd is required.');
    expect(() =>
      createDeploymentCommand({
        operations: makeOperations(),
        processRef: process,
      }),
    ).not.toThrow();
    expect(() =>
      createDeploymentCommand({
        operations: makeOperations(),
        includeSourceOptions: true,
        processRef: process,
      }),
    ).not.toThrow();
  });

  it('warns in plan help that source planning and bootstrap can have side effects', () => {
    const plan = leaf(makeHarness().command, 'plan');

    expect(plan.helpInformation()).toContain('source mode stages a SEA');
    expect(plan.helpInformation()).toMatch(
      /bootstrap may create\s+control state/,
    );
  });
});

describe('deployment plan and apply dispatch', () => {
  it('lets Commander reject a plan without an explicit control policy', async () => {
    const harness = makeHarness();
    const plan = leaf(harness.command, 'plan');
    plan.exitOverride();
    plan.configureOutput({ writeErr: jest.fn() });

    await expect(
      parse(harness.command, [
        'plan',
        'production',
        '--profile',
        'profile.json',
      ]),
    ).rejects.toMatchObject({
      code: 'commander.missingMandatoryOptionValue',
      message: expect.stringContaining(
        "required option '--control-policy <policy>' not specified",
      ),
    });
    expect(harness.readJsonObjectFile).not.toHaveBeenCalled();
    expect(harness.operations.prepare).not.toHaveBeenCalled();
  });

  it.each([
    [
      'plan profile',
      [
        'plan',
        'production',
        '--profile',
        'first.json',
        '--profile',
        'second.json',
        '--control-policy',
        'bootstrap',
      ],
      '--profile',
    ],
    [
      'apply plan',
      ['apply', '--plan', 'first.json', '--plan', 'second.json'],
      '--plan',
    ],
    [
      'inspect region',
      [
        'inspect',
        DEPLOYMENT_INSTANCE_ID,
        '--region',
        'us-east-1',
        '--region',
        'us-west-2',
      ],
      '--region',
    ],
    [
      'apply control policy',
      [
        'apply',
        'production',
        '--profile',
        'profile.json',
        '--control-policy',
        'require-active',
        '--control-policy',
        'bootstrap',
      ],
      '--control-policy',
    ],
  ])(
    'rejects repeated %s authority before file or lifecycle I/O',
    async (_label, argv, optionName) => {
      const harness = makeHarness({ source: true });
      const command = leaf(harness.command, argv[0]);
      command.exitOverride();
      command.configureOutput({ writeErr: jest.fn() });

      await expect(parse(harness.command, argv)).rejects.toThrow(
        `${optionName} may be specified only once.`,
      );

      expect(harness.readJsonObjectFile).not.toHaveBeenCalled();
      for (const operation of Object.values(harness.operations)) {
        expect(operation).not.toHaveBeenCalled();
      }
    },
  );

  it('reads and validates a profile before receiver-preserving source preparation', async () => {
    const prepared = Object.freeze({
      plan: Object.freeze({
        kind: 'deploymentPlan',
        operation: 'apply',
        deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
        planId: 'wpl3_plan',
        deploymentRevision: Object.freeze({
          deploymentRevisionId: 'wdr1_revision',
        }),
        actions: Object.freeze([{}, {}]),
      }),
      profile: PROFILE,
      artifactStage: Object.freeze({ staged: true }),
    });
    const operations = makeOperations({
      prepare: function prepare() {
        return Promise.resolve(prepared);
      },
    });
    const harness = makeHarness({ source: true, operations });

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

    expect(harness.readJsonObjectFile).toHaveBeenCalledWith(
      'profile.json',
      'deployment profile',
    );
    expect(operations.prepare).toHaveBeenCalledWith({
      deployment: { id: 'production' },
      profile: PROFILE,
      controlPolicy: 'reconcile-existing',
      dir: './app',
      outputDir: './artifacts',
    });
    expect(operations.prepare.mock.contexts[0]).toBe(operations);
    expect(harness.output.json).toHaveBeenCalledWith(prepared);
    expect(harness.output.table).not.toHaveBeenCalled();
    expect(harness.output.info).not.toHaveBeenCalled();
    expect(harness.output.failure).not.toHaveBeenCalled();
    expect(harness.processRef.exitCode).toBeUndefined();
  });

  it('uses the source cwd and bootstrap policy for direct apply', async () => {
    const result = operationResult('apply');
    const operations = makeOperations({
      apply: function apply() {
        return Promise.resolve(result);
      },
    });
    const harness = makeHarness({
      source: true,
      operations,
      cwd: '/default/source',
    });

    await parse(harness.command, [
      'apply',
      'production',
      '--profile',
      'profile.json',
      '--json',
    ]);

    expect(harness.processRef.cwd).toHaveBeenCalledTimes(1);
    expect(operations.apply).toHaveBeenCalledWith({
      deployment: { id: 'production' },
      profile: PROFILE,
      controlPolicy: 'bootstrap',
      dir: '/default/source',
    });
    expect(operations.apply.mock.contexts[0]).toBe(operations);
    expect(operations.applyPrepared).not.toHaveBeenCalled();
    expect(harness.output.json).toHaveBeenCalledWith(result);
  });

  it('reads a prepared plan and dispatches it without profile or source options', async () => {
    const prepared = Object.freeze({
      plan: Object.freeze({ kind: 'deploymentPlan' }),
      profile: PROFILE,
      artifactStage: Object.freeze({ staged: true }),
    });
    const result = operationResult('applyPrepared');
    /** @type {jest.Mock<(filePath: unknown, label?: string) => Promise<Record<string, any>>>} */
    const readJsonObjectFile = jest.fn(
      async (_filePath, _label = undefined) => prepared,
    );
    const operations = makeOperations({
      applyPrepared: function applyPrepared() {
        return Promise.resolve(result);
      },
    });
    const harness = makeHarness({
      source: true,
      operations,
      readJsonObjectFile,
    });

    await parse(harness.command, [
      'apply',
      '--plan',
      'prepared.json',
      '--control-policy',
      'bootstrap',
      '--json',
    ]);

    expect(readJsonObjectFile).toHaveBeenCalledWith(
      'prepared.json',
      'deployment plan',
    );
    expect(operations.applyPrepared).toHaveBeenCalledWith({
      prepared,
      controlPolicy: 'bootstrap',
    });
    expect(operations.applyPrepared.mock.contexts[0]).toBe(operations);
    expect(operations.apply).not.toHaveBeenCalled();
    expect(harness.processRef.cwd).not.toHaveBeenCalled();
    expect(harness.output.json).toHaveBeenCalledWith(result);
  });

  it('defaults prepared apply to require-active control', async () => {
    const prepared = Object.freeze({ prepared: true });
    const harness = makeHarness({
      readJsonObjectFile: jest.fn(async () => prepared),
    });

    await parse(harness.command, ['apply', '--plan', 'prepared.json']);

    expect(harness.operations.applyPrepared).toHaveBeenCalledWith({
      prepared,
      controlPolicy: 'require-active',
    });
  });

  it.each([
    ['--dir', './ignored-source'],
    ['--output-dir', './ignored-output'],
  ])(
    'rejects prepared apply combined with source option %s before reading the plan',
    async (option, value) => {
      const harness = makeHarness({ source: true });

      await parse(harness.command, [
        'apply',
        '--plan',
        'prepared.json',
        option,
        value,
      ]);

      expect(harness.output.failure).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'deployment apply --plan cannot be combined with --dir or --output-dir.',
        }),
      );
      expect(harness.processRef.exitCode).toBe(1);
      expect(harness.readJsonObjectFile).not.toHaveBeenCalled();
      expect(harness.operations.applyPrepared).not.toHaveBeenCalled();
    },
  );
});

describe('deployment inspect, reconcile, and destroy dispatch', () => {
  it.each([
    [
      'inspect',
      ['--control-policy', 'reconcile-existing'],
      {
        deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
        region: 'us-east-1',
        controlPolicy: 'reconcile-existing',
      },
    ],
    [
      'reconcile',
      ['--control-policy', 'bootstrap'],
      {
        deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
        region: 'us-east-1',
        controlPolicy: 'bootstrap',
        confirmCoordinatorStopped: false,
      },
    ],
    [
      'destroy',
      [],
      {
        deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
        region: 'us-east-1',
        controlPolicy: 'require-active',
      },
    ],
  ])(
    'maps %s to its exact receiver-preserving lifecycle input',
    async (method, extraArgs, expectedInput) => {
      const result = operationResult(method);
      const operations = makeOperations({
        [method]: function operation() {
          return Promise.resolve(result);
        },
      });
      const harness = makeHarness({ operations });

      await parse(harness.command, [
        method,
        DEPLOYMENT_INSTANCE_ID,
        '--region',
        'us-east-1',
        ...extraArgs,
        '--json',
      ]);

      expect(operations[method]).toHaveBeenCalledWith(expectedInput);
      expect(operations[method].mock.contexts[0]).toBe(operations);
      for (const other of [
        'prepare',
        'apply',
        'applyPrepared',
        'inspect',
        'reconcile',
        'destroy',
      ]) {
        expect(operations[other]).toHaveBeenCalledTimes(
          other === method ? 1 : 0,
        );
      }
      expect(harness.output.json).toHaveBeenCalledWith(result);
      expect(harness.processRef.exitCode).toBeUndefined();
    },
  );

  it.each([
    [[], false],
    [['--confirm-coordinator-stopped'], true],
  ])(
    'forwards explicit coordinator-stop recovery authority as %s',
    async (extraArgs, expectedConfirmation) => {
      const harness = makeHarness();

      await parse(harness.command, [
        'reconcile',
        DEPLOYMENT_INSTANCE_ID,
        '--region',
        'us-west-2',
        ...extraArgs,
      ]);

      expect(harness.operations.reconcile).toHaveBeenCalledWith({
        deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
        region: 'us-west-2',
        controlPolicy: 'require-active',
        confirmCoordinatorStopped: expectedConfirmation,
      });
    },
  );
});

describe('deployment command presentation and failures', () => {
  it('renders one compact human plan row and explains portable JSON output', async () => {
    const prepared = {
      plan: {
        kind: 'deploymentPlan',
        operation: 'apply',
        deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
        planId: 'wpl3_preview',
        deploymentRevision: { deploymentRevisionId: 'wdr1_target' },
        actions: [{}, {}, {}],
      },
      profile: PROFILE,
      artifactStage: { staged: true },
    };
    const operations = makeOperations({
      prepare: () => Promise.resolve(prepared),
    });
    const harness = makeHarness({ operations });

    await parse(harness.command, [
      'plan',
      'production',
      '--profile',
      'profile.json',
      '--control-policy',
      'require-active',
    ]);

    expect(harness.output.table).toHaveBeenCalledWith([
      {
        operation: 'apply',
        deployment_instance: DEPLOYMENT_INSTANCE_ID,
        plan: 'wpl3_preview',
        revision: 'wdr1_target',
        actions: 3,
      },
    ]);
    expect(harness.output.info).toHaveBeenCalledWith(
      'Use --json to write the complete reusable plan document.',
    );
    expect(harness.output.json).not.toHaveBeenCalled();
  });

  it('writes the complete inspection object only in JSON mode', async () => {
    const inspection = Object.freeze({
      schemaVersion: 1,
      kind: 'deploymentControllerInspection',
      deploymentInstanceId: DEPLOYMENT_INSTANCE_ID,
      status: 'absent',
      head: null,
    });
    const operations = makeOperations({
      inspect: () => Promise.resolve(inspection),
    });
    const harness = makeHarness({ operations });

    await parse(harness.command, [
      'inspect',
      DEPLOYMENT_INSTANCE_ID,
      '--region',
      'us-east-1',
      '--json',
    ]);

    expect(harness.output.json).toHaveBeenCalledWith(inspection);
    expect(harness.output.table).not.toHaveBeenCalled();
    expect(harness.output.info).not.toHaveBeenCalled();
  });

  it.each([
    [
      'invalid deployment id',
      ['apply', 'not valid', '--profile', 'profile.json'],
      'apply',
    ],
    [
      'invalid control policy',
      [
        'apply',
        'production',
        '--profile',
        'profile.json',
        '--control-policy',
        'automatic',
      ],
      'apply',
    ],
    [
      'invalid prepared control policy',
      ['apply', '--plan', 'prepared.json', '--control-policy', 'automatic'],
      'applyPrepared',
    ],
    [
      'invalid region',
      ['inspect', DEPLOYMENT_INSTANCE_ID, '--region', ' US-East-1'],
      'inspect',
    ],
    [
      'conflicting prepared and direct inputs',
      [
        'apply',
        'production',
        '--profile',
        'profile.json',
        '--plan',
        'prepared.json',
      ],
      'applyPrepared',
    ],
  ])(
    'reports %s, sets a failing exit, and performs no lifecycle work',
    async (_label, argv, relevantMethod) => {
      const harness = makeHarness();

      await parse(harness.command, argv);

      expect(harness.output.failure).toHaveBeenCalledTimes(1);
      expect(harness.processRef.exitCode).toBe(1);
      expect(harness.readJsonObjectFile).not.toHaveBeenCalled();
      expect(harness.operations[relevantMethod]).not.toHaveBeenCalled();
      expect(harness.output.json).not.toHaveBeenCalled();
      expect(harness.output.table).not.toHaveBeenCalled();
    },
  );

  it('reports profile reader or validation failure without dispatching', async () => {
    const readerError = new Error('bounded profile read failed');
    const harness = makeHarness({
      readJsonObjectFile: jest.fn(async () => {
        throw readerError;
      }),
    });

    await parse(harness.command, [
      'plan',
      'production',
      '--profile',
      'profile.json',
      '--control-policy',
      'require-active',
      '--json',
    ]);

    expect(harness.output.failure).toHaveBeenCalledWith(readerError);
    expect(harness.processRef.exitCode).toBe(1);
    expect(harness.operations.prepare).not.toHaveBeenCalled();
    expect(harness.output.json).not.toHaveBeenCalled();
  });

  it('preserves a non-Error operation rejection at the failure port', async () => {
    const thrown = Object.freeze({ code: 'operation-refused' });
    const operations = makeOperations({
      destroy: () => Promise.reject(thrown),
    });
    const harness = makeHarness({ operations });

    await parse(harness.command, [
      'destroy',
      DEPLOYMENT_INSTANCE_ID,
      '--region',
      'us-east-1',
    ]);

    expect(harness.output.failure).toHaveBeenCalledWith(thrown);
    expect(harness.processRef.exitCode).toBe(1);
  });
});
