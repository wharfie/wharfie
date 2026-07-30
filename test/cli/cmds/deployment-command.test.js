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
  createAwsSingleNodeDeploymentProvider,
  createHetznerSingleNodeDeploymentProvider,
  createSingleNodeDeploymentIntent,
} from '../../../src/core/runtime/single-node-deployment-intent.js';
import { createSingleNodeDeploymentDesired } from '../../../src/core/runtime/single-node-deployment-desired.js';
import { getSingleNodeDeploymentInstanceId } from '../../../src/core/runtime/single-node-deployment-identity.js';
import { validateSingleNodeDeploymentPreview } from '../../../src/core/runtime/single-node-deployment-preview.js';
import {
  AWS_SINGLE_NODE_APPLY_RESULT_KIND,
  AWS_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION,
} from '../../../src/core/runtime/providers/aws/single-node-apply.js';
import {
  AWS_SINGLE_NODE_DESTROY_RESULT_KIND,
  AWS_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION,
} from '../../../src/core/runtime/providers/aws/single-node-destroy.js';
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
const PACKAGED_LEAF_NAMES = Object.freeze(['preview', 'apply', 'destroy']);
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
 * @param {Readonly<Record<string, any>>} desired
 * @returns {Readonly<Record<string, any>>}
 */
function createTestPreviewProviderSpec(desired) {
  if (desired.intent.provider.kind === 'aws') {
    return {
      kind: 'aws',
      scope: {
        partition: 'aws',
        accountId: '123456789012',
        region: desired.intent.provider.region,
      },
      machineType: 't3.micro',
      image: {
        id: 'ami-0123456789abcdef0',
        name: 'ubuntu-24.04',
        ownerAccountId: '099720109477',
        creationDate: '2026-01-01T00:00:00.000Z',
        architecture: 'x86_64',
        rootDeviceType: 'ebs',
        virtualizationType: 'hvm',
        enaSupport: true,
        rootDeviceName: '/dev/sda1',
        rootBlockDevice: {
          snapshotId: 'snap-0123456789abcdef0',
          volumeType: 'gp3',
          sizeGiB: 8,
          sourceEncrypted: true,
          encrypted: true,
          deleteOnTermination: true,
        },
      },
      network: {
        vpcId: 'vpc-0123456789abcdef0',
        subnet: {
          id: 'subnet-0123456789abcdef0',
          availabilityZone: 'us-east-1a',
          availabilityZoneId: 'use1-az1',
          mapPublicIpOnLaunch: true,
          assignIpv6AddressOnCreation: false,
        },
        networkAcl: {
          id: 'acl-0123456789abcdef0',
          associationId: 'aclassoc-0123456789abcdef0',
          ipv4Ingress: {
            allowRuleNumber: 100,
            terminalDenyRuleNumber: 32767,
          },
          ipv4Egress: {
            allowRuleNumber: 100,
            terminalDenyRuleNumber: 32767,
          },
        },
        routeTable: {
          id: 'rtb-0123456789abcdef0',
          destinationCidrBlock: '0.0.0.0/0',
        },
        internetGatewayId: 'igw-0123456789abcdef0',
      },
    };
  }
  return {
    kind: 'hetzner',
    location: { id: '1', name: desired.intent.provider.location },
    machineType: { id: '2', name: 'cx22' },
    image: { id: '3', name: 'ubuntu-24.04' },
    network: { kind: 'public' },
  };
}

/**
 * @param {Readonly<Record<string, any>>} desired
 * @param {Readonly<Record<string, any>>|null} journal
 * @returns {Readonly<Record<string, any>>[]}
 */
function createTestManagedResources(desired, journal) {
  const roles =
    desired.intent.provider.kind === 'aws'
      ? ['instance', 'root-volume', 'security-group']
      : ['firewall', 'primary-ip', 'server'];
  /** @type {Readonly<Record<string, string>>} */
  const ids =
    desired.intent.provider.kind === 'aws'
      ? {
          instance: 'i-0123456789abcdef0',
          'root-volume': 'vol-0123456789abcdef0',
          'security-group': 'sg-0123456789abcdef0',
        }
      : {
          firewall: '101',
          'primary-ip': '102',
          server: '103',
        };
  return roles.map((role) => ({
    role,
    id: journal === null ? null : ids[role],
    state: journal === null ? 'planned' : 'present',
  }));
}

/**
 * @param {Readonly<Record<string, any>>} desired
 * @returns {Readonly<Record<string, string>>[]}
 */
function createTestReferencedResources(desired) {
  return desired.intent.provider.kind === 'aws'
    ? [
        { role: 'image', id: 'ami-0123456789abcdef0' },
        {
          role: 'internet-gateway',
          id: 'igw-0123456789abcdef0',
        },
        { role: 'network-acl', id: 'acl-0123456789abcdef0' },
        { role: 'route-table', id: 'rtb-0123456789abcdef0' },
        { role: 'subnet', id: 'subnet-0123456789abcdef0' },
        { role: 'vpc', id: 'vpc-0123456789abcdef0' },
      ]
    : [
        { role: 'image', id: '3' },
        { role: 'location', id: '1' },
        { role: 'machine-type', id: '2' },
      ];
}

/**
 * @param {{desired: Readonly<Record<string, any>>, providerPlan: Readonly<Record<string, any>>, journal: Readonly<Record<string, any>>|null}} request
 * @returns {Readonly<Record<string, any>>}
 */
function createTestPreviewReceipt(request) {
  const { desired, providerPlan, journal } = request;
  return Object.freeze({
    schemaVersion: 1,
    kind: 'wharfie.single-node-deployment.preview',
    provider: desired.intent.provider.kind,
    status: journal === null ? providerPlan.status : 'recovery-required',
    blockedReason: journal === null ? providerPlan.blockedReason : null,
    deployment: Object.freeze({
      appId: desired.intent.appId,
      deploymentId: desired.intent.deployment.id,
      deploymentInstanceId: desired.deploymentInstanceId,
      revisionId: desired.artifact.revisionId,
      desiredRevisionId: desired.desiredRevisionId,
      artifact: Object.freeze({
        artifactId: desired.artifact.artifactId,
        byteDigest: desired.artifact.byteDigest,
        size: desired.artifact.size,
        target: desired.intent.target,
      }),
      mode: desired.intent.mode,
      machine: desired.intent.machine,
      access: desired.intent.access,
    }),
    journal:
      journal === null
        ? Object.freeze({
            state: 'absent',
            phase: null,
            desiredMatches: null,
          })
        : Object.freeze({
            state: 'present',
            phase: journal.phase,
            desiredMatches: true,
          }),
    providerSpec: createTestPreviewProviderSpec(desired),
    resources: Object.freeze({
      referenced: Object.freeze(createTestReferencedResources(desired)),
      managed: Object.freeze(createTestManagedResources(desired, journal)),
    }),
    actions: Object.freeze(
      (journal === null
        ? providerPlan.actions
        : [
            { kind: 'verify-managed-node' },
            { kind: 'verify-or-repair-application' },
          ]
      ).map((/** @type {Record<string, any>} */ action) =>
        Object.freeze({ kind: action.kind }),
      ),
    ),
  });
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
  const preview = jest.fn(
    async (/** @type {Record<string, any>} */ request) => ({
      schemaVersion: 1,
      kind: 'hetznerSingleNodeDeploymentPlan',
      providerSpec: { kind: 'testHetznerProviderSpec' },
      inspection: {
        status: 'absent',
        observedOwnedResourceCount: 0,
      },
      status: 'actionable',
      blockedReason: null,
      actions: [
        {
          actionId: 'test-provision',
          kind: 'provision-managed-node',
          dependsOn: [],
        },
        {
          actionId: 'test-activate',
          kind: 'activate-application',
          dependsOn: ['test-provision'],
        },
      ],
      desired: request.desired,
      credential: 'must-not-be-projected',
    }),
  );
  const awsPreview = jest.fn(
    async (/** @type {Record<string, any>} */ request) => ({
      schemaVersion: 1,
      kind: 'awsSingleNodeDeploymentPlan',
      providerSpec: { kind: 'testAwsProviderSpec' },
      inspection: {
        status: 'absent',
        observedOwnedResourceCount: 0,
      },
      status: 'actionable',
      blockedReason: null,
      actions: [
        {
          actionId: 'test-provision',
          kind: 'provision-managed-node',
          dependsOn: [],
        },
        {
          actionId: 'test-activate',
          kind: 'activate-application',
          dependsOn: ['test-provision'],
        },
      ],
      desired: request.desired,
      credential: 'must-not-be-projected',
    }),
  );
  const readJournal = jest.fn(async () => null);
  const prepareJournalStorage = jest.fn();
  const initializeJournal = jest.fn();
  const commitJournal = jest.fn();
  const journalStore = Object.freeze({
    read: readJournal,
    prepareStorage: prepareJournalStorage,
    initialize: initializeJournal,
    commit: commitJournal,
  });
  const createJournalStore =
    overrides.createJournalStore ?? jest.fn(() => journalStore);
  const createPreviewReceipt =
    overrides.createPreviewReceipt ?? jest.fn(createTestPreviewReceipt);
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
  const createApplyCoordinator =
    overrides.createApplyCoordinator ?? jest.fn(() => ({ apply }));
  const awsApply = jest.fn(
    async (/** @type {Record<string, any>} */ request) => {
      const desired = createSingleNodeDeploymentDesired({
        intent: request.intent,
        revision: request.revision,
        artifactRecord: request.artifactRecord,
        observation: request.observation,
      });
      return {
        schemaVersion: AWS_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION,
        kind: AWS_SINGLE_NODE_APPLY_RESULT_KIND,
        provider: 'aws',
        status: 'active',
        deploymentInstanceId: desired.deploymentInstanceId,
        desiredRevisionId: desired.desiredRevisionId,
        artifactId: desired.artifact.artifactId,
        activationEvidenceId: ACTIVATION_EVIDENCE_ID,
        publicIpv4: '203.0.113.42',
        credential: 'must-not-be-projected',
      };
    },
  );
  const createAwsApplyCoordinator = jest.fn(() => ({ apply: awsApply }));
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
  const createDestroyCoordinator =
    overrides.createDestroyCoordinator ?? jest.fn(() => ({ destroy }));
  const awsDestroy = jest.fn(
    async (/** @type {Record<string, any>} */ request) => ({
      schemaVersion: AWS_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_DESTROY_RESULT_KIND,
      provider: 'aws',
      status: 'destroyed',
      appId: request.appId,
      deploymentInstanceId: request.deploymentInstanceId,
      credential: 'must-not-be-projected',
    }),
  );
  const createAwsDestroyCoordinator = jest.fn(() => ({
    destroy: awsDestroy,
  }));
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
    createPreviewByProvider: {
      aws: overrides.createPreviewByProvider?.aws ?? awsPreview,
      hetzner: overrides.createPreviewByProvider?.hetzner ?? preview,
    },
    createJournalStore,
    createPreviewReceipt,
    createApplyCoordinator,
    createDestroyCoordinator,
    createApplyCoordinatorByProvider: {
      aws: createAwsApplyCoordinator,
      hetzner: createApplyCoordinator,
    },
    createDestroyCoordinatorByProvider: {
      aws: createAwsDestroyCoordinator,
      hetzner: createDestroyCoordinator,
    },
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
    preview,
    awsPreview,
    readJournal,
    prepareJournalStorage,
    initializeJournal,
    commitJournal,
    journalStore,
    createJournalStore,
    createPreviewReceipt,
    apply,
    createApplyCoordinator,
    awsApply,
    createAwsApplyCoordinator,
    destroy,
    createDestroyCoordinator,
    awsDestroy,
    createAwsDestroyCoordinator,
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
  it('keeps the source lifecycle and narrows packaged deployment to preview, apply, and destroy', () => {
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
      leaf(packaged, 'preview').options.map((option) => option.long),
    ).toEqual([
      '--deployment',
      '--provider',
      '--location',
      '--region',
      '--allow-ssh-from',
      '--data-root',
      '--json',
    ]);
    expect(
      leaf(packaged, 'apply').options.map((option) => option.long),
    ).toEqual([
      '--deployment',
      '--provider',
      '--location',
      '--region',
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
      'preview --provider',
      'preview',
      [
        '--deployment',
        'production',
        '--provider',
        'hetzner',
        '--provider',
        'aws',
        '--location',
        'ash',
        '--allow-ssh-from',
        '198.51.100.9/32',
      ],
      '--provider',
    ],
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
      'apply --region',
      'apply',
      [
        '--deployment',
        'production',
        '--provider',
        'aws',
        '--region',
        'us-east-1',
        '--region',
        'us-east-2',
        '--allow-ssh-from',
        '198.51.100.9/32',
      ],
      '--region',
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
      expect(harness.preview).not.toHaveBeenCalled();
      expect(harness.awsPreview).not.toHaveBeenCalled();
      expect(harness.apply).not.toHaveBeenCalled();
      expect(harness.awsApply).not.toHaveBeenCalled();
      expect(harness.destroy).not.toHaveBeenCalled();
      expect(harness.awsDestroy).not.toHaveBeenCalled();
    },
  );

  it('rejects mutable provider selectors on journal-bound destroy', async () => {
    const harness = makePackagedHarness();
    const command = leaf(harness.command, 'destroy');
    command.exitOverride();
    command.configureOutput({ writeErr: jest.fn() });

    await expect(
      parse(harness.command, [
        'destroy',
        '--deployment-instance',
        PACKAGED_DEPLOYMENT_INSTANCE_ID,
        '--provider',
        'aws',
        '--region',
        'us-east-1',
      ]),
    ).rejects.toThrow("unknown option '--region'");

    expect(harness.readRevisionRuntimePair).not.toHaveBeenCalled();
    expect(harness.createAwsDestroyCoordinator).not.toHaveBeenCalled();
    expect(harness.awsDestroy).not.toHaveBeenCalled();
  });

  it.each([
    [
      'AWS preview without a region',
      'preview',
      [
        '--deployment',
        'production',
        '--provider',
        'aws',
        '--allow-ssh-from',
        '198.51.100.9/32',
      ],
      'AWS packaged deployment preview requires --region.',
    ],
    [
      'Hetzner preview with an AWS region',
      'preview',
      [
        '--deployment',
        'production',
        '--provider',
        'hetzner',
        '--location',
        'ash',
        '--region',
        'us-east-1',
        '--allow-ssh-from',
        '198.51.100.9/32',
      ],
      'Hetzner packaged deployment preview does not accept --region.',
    ],
    [
      'an unsupported apply provider',
      'apply',
      [
        '--deployment',
        'production',
        '--provider',
        'digitalocean',
        '--location',
        'ash',
        '--allow-ssh-from',
        '198.51.100.9/32',
      ],
      "Packaged deployment provider must be 'aws' or 'hetzner'.",
    ],
    [
      'AWS apply without a region',
      'apply',
      [
        '--deployment',
        'production',
        '--provider',
        'aws',
        '--allow-ssh-from',
        '198.51.100.9/32',
      ],
      'AWS packaged deployment apply requires --region.',
    ],
    [
      'AWS apply with a Hetzner location',
      'apply',
      [
        '--deployment',
        'production',
        '--provider',
        'aws',
        '--region',
        'us-east-1',
        '--location',
        'ash',
        '--allow-ssh-from',
        '198.51.100.9/32',
      ],
      'AWS packaged deployment apply does not accept --location.',
    ],
    [
      'Hetzner apply without a location',
      'apply',
      [
        '--deployment',
        'production',
        '--provider',
        'hetzner',
        '--allow-ssh-from',
        '198.51.100.9/32',
      ],
      'Hetzner packaged deployment apply requires --location.',
    ],
    [
      'Hetzner apply with an AWS region',
      'apply',
      [
        '--deployment',
        'production',
        '--provider',
        'hetzner',
        '--location',
        'ash',
        '--region',
        'us-east-1',
        '--allow-ssh-from',
        '198.51.100.9/32',
      ],
      'Hetzner packaged deployment apply does not accept --region.',
    ],
  ])(
    'rejects %s before reading embedded authority',
    async (_name, commandName, argv, message) => {
      const harness = makePackagedHarness();

      await parse(harness.command, [commandName, ...argv]);

      expect(harness.output.failure).toHaveBeenCalledWith(
        expect.objectContaining({ message }),
      );
      expect(harness.processRef.exitCode).toBe(1);
      expect(harness.readRevisionRuntimePair).not.toHaveBeenCalled();
      expect(harness.readDeploymentPayload).not.toHaveBeenCalled();
      expect(harness.preview).not.toHaveBeenCalled();
      expect(harness.awsPreview).not.toHaveBeenCalled();
      expect(harness.createApplyCoordinator).not.toHaveBeenCalled();
      expect(harness.createAwsApplyCoordinator).not.toHaveBeenCalled();
      expect(harness.createDestroyCoordinator).not.toHaveBeenCalled();
      expect(harness.createAwsDestroyCoordinator).not.toHaveBeenCalled();
    },
  );

  it('maps exact embedded authority and a read-only journal lookup into one Hetzner preview receipt', async () => {
    const harness = makePackagedHarness();

    await parse(harness.command, [
      'preview',
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

    expectExactCall(harness.preview, { desired });
    expect(harness.awsPreview).not.toHaveBeenCalled();
    expectExactCall(harness.createJournalStore, {
      appId: 'adapter-app',
      deploymentInstanceId: desired.deploymentInstanceId,
      dataRoot: '/stable/wharfie-data',
    });
    expect(harness.readJournal).toHaveBeenCalledTimes(1);
    expect(harness.prepareJournalStorage).not.toHaveBeenCalled();
    expect(harness.initializeJournal).not.toHaveBeenCalled();
    expect(harness.commitJournal).not.toHaveBeenCalled();
    const providerPlan = await harness.preview.mock.results[0].value;
    expectExactCall(harness.createPreviewReceipt, {
      desired,
      providerPlan,
      journal: null,
    });
    const receipt = harness.createPreviewReceipt.mock.results[0].value;
    const validatedReceipt = validateSingleNodeDeploymentPreview(receipt);
    expect(harness.output.json).toHaveBeenCalledWith(validatedReceipt);
    expect(JSON.stringify(validatedReceipt)).not.toContain(
      'must-not-be-projected',
    );
    expect(harness.source.close).toHaveBeenCalledTimes(1);
    expect(harness.createApplyCoordinator).not.toHaveBeenCalled();
    expect(harness.createAwsApplyCoordinator).not.toHaveBeenCalled();
    expect(harness.createDestroyCoordinator).not.toHaveBeenCalled();
    expect(harness.createAwsDestroyCoordinator).not.toHaveBeenCalled();
    expect(harness.output.line).not.toHaveBeenCalled();
    expect(harness.output.failure).not.toHaveBeenCalled();
    expect(harness.processRef.exitCode).toBeUndefined();
  });

  it('uses explicit local authority and emits a compact AWS preview summary', async () => {
    const harness = makePackagedHarness();
    harness.readJournal.mockResolvedValueOnce({
      phase: 'active',
      generation: 7,
    });

    await parse(harness.command, [
      'preview',
      '--deployment',
      'production',
      '--provider',
      'aws',
      '--region',
      'us-east-1',
      '--allow-ssh-from',
      '198.51.100.9/32',
      '--data-root',
      '/operator/wharfie',
    ]);

    expect(harness.awsPreview).toHaveBeenCalledTimes(1);
    expect(harness.preview).not.toHaveBeenCalled();
    expect(harness.createJournalStore).toHaveBeenCalledWith(
      expect.objectContaining({ dataRoot: '/operator/wharfie' }),
    );
    expect(harness.resolveDataRoot).not.toHaveBeenCalled();
    const desired = harness.awsPreview.mock.calls[0][0].desired;
    expect(harness.output.line).toHaveBeenCalledWith(
      `production preview is recovery-required on aws/us-east-1 with t3.micro; 3 managed roles, 6 references; journal active; 2 semantic actions (${desired.deploymentInstanceId})`,
    );
    expect(harness.output.json).not.toHaveBeenCalled();
    expect(harness.output.failure).not.toHaveBeenCalled();
    expect(harness.source.close).toHaveBeenCalledTimes(1);
  });

  it('emits selected Hetzner placement and machine in the human preview summary', async () => {
    const harness = makePackagedHarness();

    await parse(harness.command, [
      'preview',
      '--deployment',
      'production',
      '--provider',
      'hetzner',
      '--location',
      'ash',
      '--allow-ssh-from',
      '198.51.100.9/32',
    ]);

    const desired = harness.preview.mock.calls[0][0].desired;
    expect(harness.output.line).toHaveBeenCalledWith(
      `production preview is actionable on hetzner/ash with cx22; 3 managed roles, 3 references; journal absent; 2 semantic actions (${desired.deploymentInstanceId})`,
    );
    expect(harness.output.json).not.toHaveBeenCalled();
    expect(harness.output.failure).not.toHaveBeenCalled();
    expect(harness.source.close).toHaveBeenCalledTimes(1);
  });

  it('closes held payload authority when provider preview fails', async () => {
    const previewFailure = new Error('provider preview failed');
    const preview = jest.fn(async () => {
      throw previewFailure;
    });
    const harness = makePackagedHarness({
      createPreviewByProvider: {
        hetzner: preview,
      },
    });

    await parse(harness.command, [
      'preview',
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

    expect(preview).toHaveBeenCalledTimes(1);
    expect(harness.readJournal).toHaveBeenCalledTimes(1);
    expect(harness.source.close).toHaveBeenCalledTimes(1);
    expect(harness.createPreviewReceipt).not.toHaveBeenCalled();
    expect(harness.output.failure).toHaveBeenCalledWith(previewFailure);
    expect(harness.output.json).not.toHaveBeenCalled();
    expect(harness.processRef.exitCode).toBe(1);
  });

  it('refuses a validated preview receipt outside exact embedded authority', async () => {
    const createPreviewReceipt = jest.fn(
      (
        /** @type {{desired: Readonly<Record<string, any>>, providerPlan: Readonly<Record<string, any>>, journal: Readonly<Record<string, any>>|null}} */ request,
      ) => {
        const receipt = createTestPreviewReceipt(request);
        const foreignIntent = createSingleNodeDeploymentIntent({
          deployment: request.desired.intent.deployment,
          appId: 'foreign-app',
          target: request.desired.intent.target,
          mode: request.desired.intent.mode,
          machine: request.desired.intent.machine,
          access: request.desired.intent.access,
          provider: request.desired.intent.provider,
        });
        return {
          ...receipt,
          deployment: {
            ...receipt.deployment,
            appId: 'foreign-app',
            deploymentInstanceId:
              getSingleNodeDeploymentInstanceId(foreignIntent),
          },
        };
      },
    );
    const harness = makePackagedHarness({ createPreviewReceipt });

    await parse(harness.command, [
      'preview',
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

    expect(harness.output.failure).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Packaged deployment preview result does not match the exact embedded authority.',
      }),
    );
    expect(harness.output.json).not.toHaveBeenCalled();
    expect(harness.source.close).toHaveBeenCalledTimes(1);
    expect(harness.processRef.exitCode).toBe(1);
  });

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

  it('maps exact embedded authority into one AWS apply request', async () => {
    const harness = makePackagedHarness();

    await parse(harness.command, [
      'apply',
      '--deployment',
      'production',
      '--provider',
      'aws',
      '--region',
      'us-east-1',
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
      provider: createAwsSingleNodeDeploymentProvider('us-east-1'),
    });
    const desired = createSingleNodeDeploymentDesired({
      intent,
      revision: EMBEDDED_REVISION,
      artifactRecord: EMBEDDED_ARTIFACT_RECORD,
      observation: EMBEDDED_OBSERVATION,
    });
    expect(harness.createAwsApplyCoordinator).toHaveBeenCalledWith();
    expect(harness.createApplyCoordinator).not.toHaveBeenCalled();
    expectExactCall(harness.awsApply, {
      intent,
      revision: EMBEDDED_REVISION,
      artifactRecord: EMBEDDED_ARTIFACT_RECORD,
      observation: EMBEDDED_OBSERVATION,
      artifactSource: harness.source,
      dataRoot: '/stable/wharfie-data',
    });
    expect(harness.source.close).toHaveBeenCalledTimes(1);
    expect(harness.output.json).toHaveBeenCalledWith({
      schemaVersion: 1,
      kind: 'wharfie.deployment.apply',
      provider: 'aws',
      status: 'active',
      deploymentId: 'production',
      appId: 'adapter-app',
      revisionId: EMBEDDED_REVISION.revisionId,
      artifactId: EMBEDDED_ARTIFACT_RECORD.artifactId,
      deploymentInstanceId: desired.deploymentInstanceId,
      publicIpv4: '203.0.113.42',
    });
    expect(JSON.stringify(harness.output.json.mock.calls[0][0])).not.toContain(
      'must-not-be-projected',
    );
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
          'Packaged deployment apply result does not match the exact desired revision.',
      }),
    );
    expect(harness.output.json).not.toHaveBeenCalled();
    expect(harness.processRef.exitCode).toBe(1);
  });

  it('refuses an AWS apply result outside exact embedded authority', async () => {
    const awsApply = jest.fn(
      async (/** @type {Record<string, any>} */ request) => {
        const desired = createSingleNodeDeploymentDesired({
          intent: request.intent,
          revision: request.revision,
          artifactRecord: request.artifactRecord,
          observation: request.observation,
        });
        return {
          schemaVersion: AWS_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION,
          kind: AWS_SINGLE_NODE_APPLY_RESULT_KIND,
          provider: 'aws',
          status: 'active',
          deploymentInstanceId: desired.deploymentInstanceId,
          desiredRevisionId: `${desired.desiredRevisionId}-wrong`,
          artifactId: desired.artifact.artifactId,
          activationEvidenceId: ACTIVATION_EVIDENCE_ID,
          publicIpv4: '203.0.113.42',
        };
      },
    );
    const harness = makePackagedHarness({
      createApplyCoordinatorByProvider: {
        aws: jest.fn(() => ({ apply: awsApply })),
      },
    });

    await parse(harness.command, [
      'apply',
      '--deployment',
      'production',
      '--provider',
      'aws',
      '--region',
      'us-east-1',
      '--allow-ssh-from',
      '198.51.100.9/32',
      '--json',
    ]);

    expect(awsApply).toHaveBeenCalledTimes(1);
    expect(harness.source.close).toHaveBeenCalledTimes(1);
    expect(harness.output.failure).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Packaged deployment apply result does not match the exact desired revision.',
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

  it('dispatches AWS destroy from journal-bound deployment authority', async () => {
    const harness = makePackagedHarness();

    await parse(harness.command, [
      'destroy',
      '--deployment-instance',
      PACKAGED_DEPLOYMENT_INSTANCE_ID,
      '--provider',
      'aws',
      '--json',
    ]);

    expect(harness.readRevisionRuntimePair).toHaveBeenCalledWith();
    expect(harness.readDeploymentPayload).not.toHaveBeenCalled();
    expect(harness.createAwsDestroyCoordinator).toHaveBeenCalledWith();
    expect(harness.createDestroyCoordinator).not.toHaveBeenCalled();
    expectExactCall(harness.awsDestroy, {
      appId: 'adapter-app',
      deploymentInstanceId: PACKAGED_DEPLOYMENT_INSTANCE_ID,
      dataRoot: '/stable/wharfie-data',
    });
    expect(harness.output.json).toHaveBeenCalledWith({
      schemaVersion: 1,
      kind: 'wharfie.deployment.destroy',
      provider: 'aws',
      status: 'destroyed',
      appId: 'adapter-app',
      deploymentInstanceId: PACKAGED_DEPLOYMENT_INSTANCE_ID,
    });
    expect(JSON.stringify(harness.output.json.mock.calls[0][0])).not.toContain(
      'must-not-be-projected',
    );
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
          'Packaged deployment destroy result does not match the exact deployment authority.',
      }),
    );
    expect(harness.output.json).not.toHaveBeenCalled();
    expect(harness.processRef.exitCode).toBe(1);
  });

  it('refuses AWS destroy output outside the embedded app authority', async () => {
    const awsDestroy = jest.fn(async () => ({
      schemaVersion: AWS_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_DESTROY_RESULT_KIND,
      provider: 'aws',
      status: 'destroyed',
      appId: 'foreign-app',
      deploymentInstanceId: PACKAGED_DEPLOYMENT_INSTANCE_ID,
    }));
    const harness = makePackagedHarness({
      createDestroyCoordinatorByProvider: {
        aws: jest.fn(() => ({ destroy: awsDestroy })),
      },
    });

    await parse(harness.command, [
      'destroy',
      '--deployment-instance',
      PACKAGED_DEPLOYMENT_INSTANCE_ID,
      '--provider',
      'aws',
      '--json',
    ]);

    expect(awsDestroy).toHaveBeenCalledTimes(1);
    expect(harness.output.failure).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Packaged deployment destroy result does not match the exact deployment authority.',
      }),
    );
    expect(harness.output.json).not.toHaveBeenCalled();
    expect(harness.processRef.exitCode).toBe(1);
  });
});
