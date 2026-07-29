import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { createApplicationRevision } from '../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../src/core/runtime/artifact-record.js';
import {
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from '../../../src/core/runtime/content-id.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../../src/core/runtime/deployment-profile.js';
import {
  DEPLOYMENT_INSTANCE_ID_DOMAIN,
  DEPLOYMENT_INSTANCE_ID_PREFIX,
} from '../../../src/core/runtime/deployment-provider-scope.js';
import {
  SINGLE_NODE_ACCESS_KIND,
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createHetznerSingleNodeDeploymentProvider,
  createSingleNodeDeploymentIntent,
} from '../../../src/core/runtime/single-node-deployment-intent.js';
import { createSingleNodeDeploymentDesired } from '../../../src/core/runtime/single-node-deployment-desired.js';
import { getSingleNodeDeploymentInstanceId } from '../../../src/core/runtime/single-node-deployment-identity.js';
import {
  HETZNER_SINGLE_NODE_APPLY_RESULT_KIND,
  HETZNER_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION,
} from '../../../src/core/runtime/providers/hetzner/single-node-apply.js';
import {
  HETZNER_SINGLE_NODE_DESTROY_RESULT_KIND,
  HETZNER_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION,
} from '../../../src/core/runtime/providers/hetzner/single-node-destroy.js';

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
const SOURCE_LEAF_NAMES = Object.freeze([
  'plan',
  'apply',
  'inspect',
  'reconcile',
  'destroy',
]);
const PACKAGED_LEAF_NAMES = Object.freeze(['apply', 'destroy']);
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

/** @param {string|Buffer} value @returns {{algorithm: 'sha256', value: string}} */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

const EMBEDDED_REVISION = createApplicationRevision({
  contract: {
    schemaVersion: 4,
    app: { id: 'adapter-app' },
    cli: {
      entrypoint: {
        kind: 'node',
        path: 'src/cli.js',
        export: 'main',
      },
    },
  },
  inputs: {
    source: {
      format: 'wharfie-source-tree-v1',
      digest: digest('packaged-deployment-source'),
    },
    dependencies: {
      format: 'wharfie-npm-package-lock-v3-closure-v1',
      digest: digest('packaged-deployment-lock'),
    },
    runtime: {
      format: 'wharfie-runtime-v1',
      digest: digest('packaged-deployment-runtime'),
    },
  },
});
const EMBEDDED_ARTIFACT_RECORD = createArtifactRecord({
  bytes: Buffer.from('embedded-linux-sea', 'utf8'),
  revision: EMBEDDED_REVISION,
  target: PROFILE.target,
  provenance: {
    schemaVersion: 1,
    builder: {
      name: '@wharfie/wharfie',
      version: '0.0.15',
      runtimeDigest: EMBEDDED_REVISION.inputs.runtime.digest,
      toolchainDigest: digest('packaged-deployment-toolchain'),
    },
    node: {
      version: PROFILE.target.nodeVersion,
      binary: { digest: digest('packaged-deployment-node') },
    },
    dependencies: {
      lock: EMBEDDED_REVISION.inputs.dependencies,
      digest: digest('packaged-deployment-dependencies'),
    },
    signing: { mode: 'unsigned' },
  },
});
const EMBEDDED_OBSERVATION = Object.freeze({
  artifactId: EMBEDDED_ARTIFACT_RECORD.artifactId,
  byteDigest: EMBEDDED_ARTIFACT_RECORD.byteDigest,
  size: EMBEDDED_ARTIFACT_RECORD.size,
});
const EMBEDDED_PAIR = Object.freeze({
  revision: EMBEDDED_REVISION,
  runtime: Object.freeze({
    appId: 'adapter-app',
    revisionId: EMBEDDED_REVISION.revisionId,
    target: PROFILE.target,
  }),
});
const ACTIVATION_EVIDENCE_ID = `wsne1_${'A'.repeat(43)}`;
const PACKAGED_DEPLOYMENT_INSTANCE_ID = getSingleNodeDeploymentInstanceId(
  createSingleNodeDeploymentIntent({
    deployment: { id: 'production' },
    appId: 'adapter-app',
    target: EMBEDDED_ARTIFACT_RECORD.target,
    mode: SINGLE_NODE_DEPLOYMENT_MODE,
    machine: SINGLE_NODE_MACHINE,
    access: {
      kind: SINGLE_NODE_ACCESS_KIND,
      allowedIpv4: ['198.51.100.9/32'],
    },
    provider: createHetznerSingleNodeDeploymentProvider('ash'),
  }),
);

/** @param {string} method @returns {Record<string, string>} */
function operationResult(method) {
  return { method };
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
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function makePackagedHarness(overrides = {}) {
  const source = {
    observation: EMBEDDED_OBSERVATION,
    createReadStream: jest.fn(),
    verifyUnchanged: jest.fn(),
    close: jest.fn(async () => undefined),
  };
  const readRevisionRuntimePair = jest.fn(async () => EMBEDDED_PAIR);
  const readDeploymentPayload = jest.fn(async () => ({
    manifest: { kind: 'singleNodeDeploymentPayload' },
    artifactRecord: EMBEDDED_ARTIFACT_RECORD,
    source,
  }));
  const apply = jest.fn(async (/** @type {Record<string, any>} */ request) => {
    const desired = createSingleNodeDeploymentDesired({
      intent: request.intent,
      revision: request.revision,
      artifactRecord: request.artifactRecord,
      observation: request.observation,
    });
    return {
      schemaVersion: HETZNER_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION,
      kind: HETZNER_SINGLE_NODE_APPLY_RESULT_KIND,
      provider: 'hetzner',
      status: 'active',
      deploymentInstanceId: desired.deploymentInstanceId,
      desiredRevisionId: desired.desiredRevisionId,
      artifactId: desired.artifact.artifactId,
      activationEvidenceId: ACTIVATION_EVIDENCE_ID,
      publicIpv4: '203.0.113.41',
      credential: 'must-not-be-projected',
    };
  });
  const createApplyCoordinator = jest.fn(() => ({ apply }));
  const destroy = jest.fn(
    async (/** @type {Record<string, any>} */ request) => ({
      schemaVersion: HETZNER_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION,
      kind: HETZNER_SINGLE_NODE_DESTROY_RESULT_KIND,
      provider: 'hetzner',
      status: 'destroyed',
      appId: request.appId,
      deploymentInstanceId: request.deploymentInstanceId,
      credential: 'must-not-be-projected',
    }),
  );
  const createDestroyCoordinator = jest.fn(() => ({ destroy }));
  const resolveDataRoot = jest.fn(() => '/stable/wharfie-data');
  const output = {
    json: jest.fn(),
    line: jest.fn(),
    failure: jest.fn(),
  };
  const processRef = { exitCode: undefined };
  const dependencies = {
    readRevisionRuntimePair,
    readDeploymentPayload,
    createApplyCoordinator,
    createDestroyCoordinator,
    resolveDataRoot,
    output,
    processRef,
    ...overrides,
  };
  return {
    command: createPackagedDeploymentCommand(dependencies),
    source,
    readRevisionRuntimePair,
    readDeploymentPayload,
    apply,
    createApplyCoordinator,
    destroy,
    createDestroyCoordinator,
    resolveDataRoot,
    output,
    processRef,
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
 * @param {ReadonlyArray<string>} names
 * @returns {void}
 */
function expectFreshLeaves(factory, names) {
  const first = factory();
  const second = factory();

  expect(first.name()).toBe('deployment');
  expect(second.name()).toBe('deployment');
  expect(
    first.commands.map((/** @type {import('commander').Command} */ command) =>
      command.name(),
    ),
  ).toStrictEqual(names);
  expect(
    second.commands.map((/** @type {import('commander').Command} */ command) =>
      command.name(),
    ),
  ).toStrictEqual(names);
  expect(second).not.toBe(first);
  for (let index = 0; index < names.length; index += 1) {
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
  it('keeps the source lifecycle and narrows packaged deployment to apply and destroy', () => {
    expect(createSourceDeploymentCommand).toEqual(expect.any(Function));
    expect(createPackagedDeploymentCommand).toEqual(expect.any(Function));
    expectFreshLeaves(createSourceDeploymentCommand, SOURCE_LEAF_NAMES);
    expectFreshLeaves(createPackagedDeploymentCommand, PACKAGED_LEAF_NAMES);
  });

  it('exposes only the exact source and packaged selectors', () => {
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
    expect(
      leaf(packaged, 'apply').options.map((option) => option.long),
    ).toEqual([
      '--deployment',
      '--provider',
      '--location',
      '--allow-ssh-from',
      '--data-root',
      '--json',
    ]);
    expect(
      leaf(packaged, 'destroy').options.map((option) => option.long),
    ).toEqual(['--deployment-instance', '--provider', '--data-root', '--json']);
    for (const name of ['inspect', 'reconcile', 'destroy']) {
      expect(
        leaf(source, name).options.map((option) => option.long),
      ).not.toEqual(expect.arrayContaining(['--dir', '--output-dir']));
    }
  });

  it('keeps strict source lifecycle operation overrides', () => {
    expect(() =>
      createSourceDeploymentCommand({
        operations: /** @type {any} */ (false),
      }),
    ).toThrow('deployment operation overrides must be a plain partial object.');
    expect(() =>
      createSourceDeploymentCommand({
        operations: { prepare: /** @type {any} */ (null) },
      }),
    ).toThrow(
      'deployment operation override prepare must be an own enumerable function.',
    );
    expect(() =>
      createSourceDeploymentCommand({
        operations: { unsupported: jest.fn() },
      }),
    ).toThrow('deployment operation overrides contain an unsupported method.');
    for (const operation of DEFAULT_OPERATIONS) {
      expect(operation).not.toHaveBeenCalled();
    }
  });

  it('snapshots valid source overrides before constructing its command tree', async () => {
    const original = jest.fn(async () => operationResult('original'));
    const replacement = jest.fn(async () => operationResult('replacement'));
    const overrides = { prepare: original };
    const harness = makeHarness(createSourceDeploymentCommand, overrides);
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
      'apply --deployment',
      'apply',
      [
        '--deployment',
        'production',
        '--deployment',
        'preview',
        '--provider',
        'hetzner',
        '--location',
        'ash',
        '--allow-ssh-from',
        '198.51.100.9/32',
      ],
      '--deployment',
    ],
    [
      'apply --provider',
      'apply',
      [
        '--deployment',
        'production',
        '--provider',
        'hetzner',
        '--provider',
        'hetzner',
        '--location',
        'ash',
        '--allow-ssh-from',
        '198.51.100.9/32',
      ],
      '--provider',
    ],
    [
      'apply --location',
      'apply',
      [
        '--deployment',
        'production',
        '--provider',
        'hetzner',
        '--location',
        'ash',
        '--location',
        'nbg1',
        '--allow-ssh-from',
        '198.51.100.9/32',
      ],
      '--location',
    ],
    [
      'apply --data-root',
      'apply',
      [
        '--deployment',
        'production',
        '--provider',
        'hetzner',
        '--location',
        'ash',
        '--allow-ssh-from',
        '198.51.100.9/32',
        '--data-root',
        '/operator/one',
        '--data-root',
        '/operator/two',
      ],
      '--data-root',
    ],
    [
      'destroy --deployment-instance',
      'destroy',
      [
        '--deployment-instance',
        PACKAGED_DEPLOYMENT_INSTANCE_ID,
        '--deployment-instance',
        PACKAGED_DEPLOYMENT_INSTANCE_ID,
        '--provider',
        'hetzner',
      ],
      '--deployment-instance',
    ],
    [
      'destroy --provider',
      'destroy',
      [
        '--deployment-instance',
        PACKAGED_DEPLOYMENT_INSTANCE_ID,
        '--provider',
        'hetzner',
        '--provider',
        'hetzner',
      ],
      '--provider',
    ],
    [
      'destroy --data-root',
      'destroy',
      [
        '--deployment-instance',
        PACKAGED_DEPLOYMENT_INSTANCE_ID,
        '--provider',
        'hetzner',
        '--data-root',
        '/operator/one',
        '--data-root',
        '/operator/two',
      ],
      '--data-root',
    ],
  ])(
    'rejects repeated scalar authority for %s',
    async (_name, commandName, argv, optionName) => {
      const harness = makePackagedHarness();
      const command = leaf(harness.command, commandName);
      command.exitOverride();
      command.configureOutput({ writeErr: jest.fn() });

      await expect(
        parse(harness.command, [commandName, ...argv]),
      ).rejects.toThrow(`${optionName} may be specified only once.`);

      expect(harness.readRevisionRuntimePair).not.toHaveBeenCalled();
      expect(harness.apply).not.toHaveBeenCalled();
      expect(harness.destroy).not.toHaveBeenCalled();
    },
  );

  it('maps exact embedded authority into one Hetzner apply request', async () => {
    const harness = makePackagedHarness();

    await parse(harness.command, [
      'apply',
      '--deployment',
      'production',
      '--provider',
      'hetzner',
      '--location',
      'ash',
      '--allow-ssh-from',
      '198.51.100.9/32',
      '--allow-ssh-from',
      '192.0.2.4/32',
      '--json',
    ]);

    const intent = createSingleNodeDeploymentIntent({
      deployment: { id: 'production' },
      appId: 'adapter-app',
      target: EMBEDDED_ARTIFACT_RECORD.target,
      mode: SINGLE_NODE_DEPLOYMENT_MODE,
      machine: SINGLE_NODE_MACHINE,
      access: {
        kind: SINGLE_NODE_ACCESS_KIND,
        allowedIpv4: ['198.51.100.9/32', '192.0.2.4/32'],
      },
      provider: createHetznerSingleNodeDeploymentProvider('ash'),
    });
    const desired = createSingleNodeDeploymentDesired({
      intent,
      revision: EMBEDDED_REVISION,
      artifactRecord: EMBEDDED_ARTIFACT_RECORD,
      observation: EMBEDDED_OBSERVATION,
    });
    expect(harness.readRevisionRuntimePair).toHaveBeenCalledWith();
    expect(harness.readDeploymentPayload).toHaveBeenCalledWith({
      revision: EMBEDDED_REVISION,
    });
    expect(harness.createApplyCoordinator).toHaveBeenCalledWith();
    expectExactCall(harness.apply, {
      intent,
      revision: EMBEDDED_REVISION,
      artifactRecord: EMBEDDED_ARTIFACT_RECORD,
      observation: EMBEDDED_OBSERVATION,
      artifactSource: harness.source,
      dataRoot: '/stable/wharfie-data',
    });
    expect(harness.resolveDataRoot).toHaveBeenCalledWith();
    expect(harness.source.close).toHaveBeenCalledTimes(1);
    expect(harness.output.json).toHaveBeenCalledWith({
      schemaVersion: 1,
      kind: 'wharfie.deployment.apply',
      provider: 'hetzner',
      status: 'active',
      deploymentId: 'production',
      appId: 'adapter-app',
      revisionId: EMBEDDED_REVISION.revisionId,
      artifactId: EMBEDDED_ARTIFACT_RECORD.artifactId,
      deploymentInstanceId: desired.deploymentInstanceId,
      publicIpv4: '203.0.113.41',
    });
    expect(JSON.stringify(harness.output.json.mock.calls[0][0])).not.toContain(
      'must-not-be-projected',
    );
    expect(harness.output.line).not.toHaveBeenCalled();
    expect(harness.output.failure).not.toHaveBeenCalled();
    expect(harness.processRef.exitCode).toBeUndefined();
  });

  it('uses an explicit durable root and emits one compact human result', async () => {
    const harness = makePackagedHarness();

    await parse(harness.command, [
      'apply',
      '--deployment',
      'preview',
      '--provider',
      'hetzner',
      '--location',
      'nbg1',
      '--allow-ssh-from',
      '192.0.2.8/32',
      '--data-root',
      '/operator/wharfie',
    ]);

    expect(harness.apply.mock.calls[0][0].dataRoot).toBe('/operator/wharfie');
    expect(harness.resolveDataRoot).not.toHaveBeenCalled();
    expect(harness.output.line).toHaveBeenCalledWith(
      expect.stringMatching(
        /^preview is active at 203\.0\.113\.41 \(wsnd1_[A-Za-z0-9_-]{43}\)$/u,
      ),
    );
    expect(harness.output.json).not.toHaveBeenCalled();
    expect(harness.output.failure).not.toHaveBeenCalled();
  });

  it('closes held payload authority when setup fails before coordinator apply', async () => {
    const setupFailure = new Error('coordinator setup failed');
    const createApplyCoordinator = jest.fn(() => {
      throw setupFailure;
    });
    const harness = makePackagedHarness({ createApplyCoordinator });

    await parse(harness.command, [
      'apply',
      '--deployment',
      'production',
      '--provider',
      'hetzner',
      '--location',
      'ash',
      '--allow-ssh-from',
      '198.51.100.9/32',
      '--json',
    ]);

    expect(harness.source.close).toHaveBeenCalledTimes(1);
    expect(harness.apply).not.toHaveBeenCalled();
    expect(harness.output.failure).toHaveBeenCalledWith(setupFailure);
    expect(harness.output.json).not.toHaveBeenCalled();
    expect(harness.processRef.exitCode).toBe(1);
  });

  it('refuses a coordinator result outside exact embedded authority', async () => {
    const apply = jest.fn(
      async (/** @type {Record<string, any>} */ request) => {
        const desired = createSingleNodeDeploymentDesired({
          intent: request.intent,
          revision: request.revision,
          artifactRecord: request.artifactRecord,
          observation: request.observation,
        });
        return {
          schemaVersion: HETZNER_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION,
          kind: HETZNER_SINGLE_NODE_APPLY_RESULT_KIND,
          provider: 'hetzner',
          status: 'active',
          deploymentInstanceId: desired.deploymentInstanceId,
          desiredRevisionId: `${desired.desiredRevisionId}-wrong`,
          artifactId: desired.artifact.artifactId,
          activationEvidenceId: ACTIVATION_EVIDENCE_ID,
          publicIpv4: '203.0.113.41',
        };
      },
    );
    const harness = makePackagedHarness({
      createApplyCoordinator: jest.fn(() => ({ apply })),
    });

    await parse(harness.command, [
      'apply',
      '--deployment',
      'production',
      '--provider',
      'hetzner',
      '--location',
      'ash',
      '--allow-ssh-from',
      '198.51.100.9/32',
      '--json',
    ]);

    expect(harness.source.close).toHaveBeenCalledTimes(1);
    expect(harness.output.failure).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Hetzner apply result does not match the exact desired revision.',
      }),
    );
    expect(harness.output.json).not.toHaveBeenCalled();
    expect(harness.processRef.exitCode).toBe(1);
  });

  it('destroys from embedded app identity without reading the deployment payload', async () => {
    const harness = makePackagedHarness();

    await parse(harness.command, [
      'destroy',
      '--deployment-instance',
      PACKAGED_DEPLOYMENT_INSTANCE_ID,
      '--provider',
      'hetzner',
      '--json',
    ]);

    expect(harness.readRevisionRuntimePair).toHaveBeenCalledWith();
    expect(harness.readDeploymentPayload).not.toHaveBeenCalled();
    expect(harness.createDestroyCoordinator).toHaveBeenCalledWith();
    expectExactCall(harness.destroy, {
      appId: 'adapter-app',
      deploymentInstanceId: PACKAGED_DEPLOYMENT_INSTANCE_ID,
      dataRoot: '/stable/wharfie-data',
    });
    expect(harness.resolveDataRoot).toHaveBeenCalledWith();
    expect(harness.source.close).not.toHaveBeenCalled();
    expect(harness.output.json).toHaveBeenCalledWith({
      schemaVersion: 1,
      kind: 'wharfie.deployment.destroy',
      provider: 'hetzner',
      status: 'destroyed',
      appId: 'adapter-app',
      deploymentInstanceId: PACKAGED_DEPLOYMENT_INSTANCE_ID,
    });
    expect(JSON.stringify(harness.output.json.mock.calls[0][0])).not.toContain(
      'must-not-be-projected',
    );
    expect(harness.output.line).not.toHaveBeenCalled();
    expect(harness.output.failure).not.toHaveBeenCalled();
    expect(harness.processRef.exitCode).toBeUndefined();
  });

  it('uses explicit destroy state and emits one compact human result', async () => {
    const harness = makePackagedHarness();

    await parse(harness.command, [
      'destroy',
      '--deployment-instance',
      PACKAGED_DEPLOYMENT_INSTANCE_ID,
      '--provider',
      'hetzner',
      '--data-root',
      '/operator/wharfie',
    ]);

    expect(harness.destroy.mock.calls[0][0].dataRoot).toBe('/operator/wharfie');
    expect(harness.resolveDataRoot).not.toHaveBeenCalled();
    expect(harness.output.line).toHaveBeenCalledWith(
      `${PACKAGED_DEPLOYMENT_INSTANCE_ID} is destroyed for adapter-app`,
    );
    expect(harness.output.json).not.toHaveBeenCalled();
    expect(harness.output.failure).not.toHaveBeenCalled();
  });

  it('refuses destroy output outside the embedded app authority', async () => {
    const destroy = jest.fn(async () => ({
      schemaVersion: HETZNER_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION,
      kind: HETZNER_SINGLE_NODE_DESTROY_RESULT_KIND,
      provider: 'hetzner',
      status: 'destroyed',
      appId: 'foreign-app',
      deploymentInstanceId: PACKAGED_DEPLOYMENT_INSTANCE_ID,
    }));
    const harness = makePackagedHarness({
      createDestroyCoordinator: jest.fn(() => ({ destroy })),
    });

    await parse(harness.command, [
      'destroy',
      '--deployment-instance',
      PACKAGED_DEPLOYMENT_INSTANCE_ID,
      '--provider',
      'hetzner',
      '--json',
    ]);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(harness.readDeploymentPayload).not.toHaveBeenCalled();
    expect(harness.output.failure).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Hetzner destroy result does not match the exact deployment authority.',
      }),
    );
    expect(harness.output.json).not.toHaveBeenCalled();
    expect(harness.processRef.exitCode).toBe(1);
  });
});
