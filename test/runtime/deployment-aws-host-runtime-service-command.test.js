import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, jest } from '@jest/globals';

import {
  createApplicationRevision,
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
} from '../../src/core/runtime/application-revision.js';
import { sha256Base64Url } from '../../src/core/runtime/content-id.js';
import {
  AwsSingleNodeHostRuntimeServiceAccountError,
  AwsSingleNodeHostRuntimeServiceArtifactError,
  AwsSingleNodeHostRuntimeServiceAuthorityError,
  AwsSingleNodeHostRuntimeServiceExecutionError,
  AwsSingleNodeHostRuntimeServiceResponseError,
  createAwsSingleNodeHostRuntimeServiceCommand,
  createAwsSingleNodeHostRuntimeServiceCommandForTest,
} from '../../src/core/runtime/deployment-aws-host-runtime-service-command.js';
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_HOME,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID,
} from '../../src/core/runtime/deployment-aws-host-runtime-account.js';

const PROJECTION_ROOT = '/test/wharfie/app/v1';
const RUNTIME_UID = AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID;
const RUNTIME_GID = AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID;
const RUNTIME_HOME = AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_HOME;
const SETPRIV_PATH = '/usr/bin/setpriv';
const SYSTEMD_RUN_PATH = '/usr/bin/systemd-run';
const SYSTEMCTL_PATH = '/usr/bin/systemctl';
const TRANSIENT_LOADER_ENVIRONMENT_NAMES = [
  'GCONV_PATH',
  'GLIBC_TUNABLES',
  'LD_ASSUME_KERNEL',
  'LD_AUDIT',
  'LD_BIND_NOT',
  'LD_BIND_NOW',
  'LD_DEBUG',
  'LD_DEBUG_OUTPUT',
  'LD_DYNAMIC_WEAK',
  'LD_HWCAP_MASK',
  'LD_LIBRARY_PATH',
  'LD_ORIGIN_PATH',
  'LD_POINTER_GUARD',
  'LD_PRELOAD',
  'LD_PROFILE',
  'LD_PROFILE_OUTPUT',
  'LD_SHOW_AUXV',
  'LD_TRACE_LOADED_OBJECTS',
  'LD_TRACE_PRELINKING',
  'LD_USE_LOAD_BIAS',
  'LD_VERBOSE',
  'LD_WARN',
  'LOCPATH',
  'MALLOC_CHECK_',
  'MALLOC_PERTURB_',
  'MALLOC_TRACE',
  'NLSPATH',
];

/** @param {string} appId @returns {Readonly<Record<string, any>>} */
function createEmbeddedRevision(appId) {
  return createApplicationRevision({
    contract: {
      schemaVersion: 4,
      app: { id: appId },
      cli: {
        entrypoint: { kind: 'node', path: 'cli.js', export: 'main' },
      },
    },
    inputs: {
      source: {
        format: SOURCE_TREE_INPUT_FORMAT,
        digest: { algorithm: 'sha256', value: sha256Base64Url('source') },
      },
      dependencies: {
        format: DEPENDENCY_LOCK_INPUT_FORMAT,
        digest: {
          algorithm: 'sha256',
          value: sha256Base64Url('dependencies'),
        },
      },
      runtime: {
        format: RUNTIME_INPUT_FORMAT,
        digest: { algorithm: 'sha256', value: sha256Base64Url('runtime') },
      },
    },
  });
}

const EMBEDDED_REVISION = createEmbeddedRevision('example-app');
const EMBEDDED_RUNTIME = Object.freeze({
  schemaVersion: 1,
  kind: 'artifactRuntime',
  appId: 'example-app',
  revisionId: EMBEDDED_REVISION.revisionId,
  target: Object.freeze({
    nodeVersion: '24.13.1',
    platform: 'linux',
    architecture: 'x64',
    libc: 'glibc',
  }),
});

/** @param {string} prefix @param {string} value @returns {string} */
function identity(prefix, value) {
  return `${prefix}_${sha256Base64Url(value)}`;
}

/** @param {Buffer} bytes @param {Record<string, any>} [overrides] @returns {Record<string, any>} */
function makeInput(bytes, overrides = {}) {
  const requestId = identity('whaq1', 'request');
  const deploymentInstanceId = identity('wdi1', 'deployment');
  const digest = sha256Base64Url(bytes);
  return {
    requestId,
    intentId: identity('whai1', 'service-convergence-intent'),
    attemptGeneration: 7,
    deploymentInstanceId,
    appId: 'example-app',
    artifactId: `waf1_${digest}`,
    revisionId: EMBEDDED_REVISION.revisionId,
    targetId: 'node-v24.13.1-linux-x64-glibc',
    artifactPath: path.join(
      PROJECTION_ROOT,
      deploymentInstanceId,
      requestId,
      'app',
    ),
    contentLength: bytes.byteLength,
    byteDigest: { algorithm: 'sha256', value: digest },
    ...overrides,
  };
}

/** @param {Buffer} bytes @param {Record<string, any>} [overrides] @returns {Record<string, any>} */
function makeMetadata(bytes, overrides = {}) {
  const input = makeInput(bytes);
  return {
    artifact: {
      artifactId: input.artifactId,
      byteDigest: { ...input.byteDigest },
      size: input.contentLength,
    },
    revision: EMBEDDED_REVISION,
    runtime: EMBEDDED_RUNTIME,
    ...overrides,
  };
}

/** @param {Buffer} bytes @param {Record<string, any>} [overrides] @returns {Record<string, any>} */
function makeDesiredConvergence(bytes, overrides = {}) {
  const input = makeInput(bytes);
  return {
    schemaVersion: 1,
    kind: 'wharfie.service.desired-convergence',
    appId: input.appId,
    unit: `wharfie-${input.appId}.service`,
    desired: {
      artifactId: input.artifactId,
      revisionId: input.revisionId,
    },
    disposition: 'authorized',
    basis: 'durable-active',
    ...overrides,
  };
}

/** @param {Buffer} bytes @param {Record<string, any>} [overrides] @returns {Record<string, any>} */
function makeServiceStatus(bytes, overrides = {}) {
  const input = makeInput(bytes);
  return {
    schemaVersion: 3,
    kind: 'wharfie.service.status',
    appId: input.appId,
    unit: `wharfie-${input.appId}.service`,
    desiredConvergence: makeDesiredConvergence(bytes),
    ...overrides,
  };
}

/** @param {number} [exitCode] @param {string|Buffer} [stdout] @param {string|Buffer} [stderr] @returns {Readonly<Record<string, any>>} */
function exited(exitCode = 0, stdout = '', stderr = '') {
  return Object.freeze({
    status: 'exited',
    exitCode,
    timedOut: false,
    stdout: Buffer.isBuffer(stdout) ? Buffer.from(stdout) : Buffer.from(stdout),
    stderr: Buffer.isBuffer(stderr) ? Buffer.from(stderr) : Buffer.from(stderr),
  });
}

/** @param {boolean} [timedOut] @param {string} [raw] @returns {Readonly<Record<string, any>>} */
function ambiguous(timedOut = false, raw = '') {
  return Object.freeze({
    status: 'ambiguous',
    exitCode: null,
    timedOut,
    stdout: Buffer.from(raw),
    stderr: Buffer.from(raw),
  });
}

/** @param {Record<string, any>} [overrides] @returns {Record<string, any>} */
function makeStats(overrides = {}) {
  return {
    dev: 1,
    ino: 2,
    uid: 0,
    gid: RUNTIME_GID,
    mode: 0o100550,
    nlink: 1,
    size: 0,
    mtimeMs: 10,
    ctimeMs: 11,
    isFile: () => true,
    ...overrides,
  };
}

/**
 * @param {Buffer} bytes
 * @param {{stats?: Record<string, any>|Record<string, any>[], account?: Record<string, any>, metadataOutcomes?: Readonly<Record<string, any>>[], serviceOutcomes?: Readonly<Record<string, any>>[], cleanupShows?: Readonly<Record<string, any>>[], cleanupStop?: Readonly<Record<string, any>>, projectionRoot?: string, wait?: jest.Mock}} [options]
 * @returns {{ports: Record<string, any>, processCalls: any[], openCalls: any[], events: string[], wait: jest.Mock}}
 */
function makePorts(bytes, options = {}) {
  const account = {
    selectedPasswd: `wharfie-runtime:x:${RUNTIME_UID}:${RUNTIME_GID}::${RUNTIME_HOME}:/usr/sbin/nologin\n`,
    selectedGroup: `wharfie-runtime:x:${RUNTIME_GID}:\n`,
    numericPasswd: `wharfie-runtime:x:${RUNTIME_UID}:${RUNTIME_GID}::${RUNTIME_HOME}:/usr/sbin/nologin\n`,
    numericGroup: `wharfie-runtime:x:${RUNTIME_GID}:\n`,
    idUid: `${RUNTIME_UID}\n`,
    idGid: `${RUNTIME_GID}\n`,
    idGroups: `${RUNTIME_GID}\n`,
    ...options.account,
  };
  const serviceOutcomes = [
    ...(options.serviceOutcomes ?? [
      exited(0, `${JSON.stringify(makeServiceStatus(bytes))}\n`),
    ]),
  ];
  const defaultMetadataOutcome = exited(
    0,
    `${JSON.stringify(makeMetadata(bytes))}\n`,
  );
  const metadataOutcomes = [...(options.metadataOutcomes ?? [])];
  const cleanupShows = [...(options.cleanupShows ?? [])];
  /** @type {any[][]} */
  const processCalls = [];
  /** @type {any[][]} */
  const openCalls = [];
  /** @type {string[]} */
  const events = [];
  const wait = options.wait ?? jest.fn(async () => undefined);
  const configuredStats = Array.isArray(options.stats)
    ? options.stats
    : [options.stats ?? makeStats({ size: bytes.byteLength })];

  const ports = {
    projectionRoot: options.projectionRoot ?? PROJECTION_ROOT,
    platform: jest.fn(() => 'linux'),
    getuid: jest.fn(() => 0),
    geteuid: jest.fn(() => 0),
    openArtifact: jest.fn(
      /** @param {string} artifactPath @param {number} flags */
      async (artifactPath, flags) => {
        openCalls.push([artifactPath, flags]);
        events.push('artifact-open');
        let statIndex = 0;
        return {
          async stat() {
            const selected =
              configuredStats[Math.min(statIndex, configuredStats.length - 1)];
            statIndex += 1;
            return selected;
          },
          /** @param {Buffer} buffer @param {number} offset @param {number} length @param {number} position */
          async read(buffer, offset, length, position) {
            if (position >= bytes.byteLength) return { bytesRead: 0 };
            const bytesRead = Math.min(length, bytes.byteLength - position);
            bytes.copy(buffer, offset, position, position + bytesRead);
            return { bytesRead };
          },
          async close() {
            events.push('artifact-close');
          },
        };
      },
    ),
    runProcess: jest.fn(
      /** @param {string} command @param {readonly string[]} args @param {Readonly<Record<string, number>>} processOptions */
      async (command, args, processOptions) => {
        processCalls.push([command, [...args], processOptions]);
        if (command === '/usr/bin/getent') {
          if (args[0] === 'passwd' && args[1] === String(RUNTIME_UID)) {
            return exited(0, account.numericPasswd);
          }
          if (args[0] === 'group' && args[1] === String(RUNTIME_GID)) {
            return exited(0, account.numericGroup);
          }
          if (args[0] === 'passwd' && args.length === 2) {
            return exited(0, account.selectedPasswd);
          }
          if (args[0] === 'group' && args.length === 2) {
            return exited(0, account.selectedGroup);
          }
        }
        if (command === '/usr/bin/id') {
          if (args[0] === '-u') return exited(0, account.idUid);
          if (args[0] === '-g') return exited(0, account.idGid);
          if (args[0] === '-G') return exited(0, account.idGroups);
        }
        if (command === SETPRIV_PATH && args.includes(SYSTEMD_RUN_PATH)) {
          if (args.includes('metadata')) {
            events.push('metadata-launcher');
            return metadataOutcomes.shift() ?? defaultMetadataOutcome;
          }
          events.push('service-launcher');
          return serviceOutcomes.shift() ?? exited(1);
        }
        if (
          command === SETPRIV_PATH &&
          args.includes(SYSTEMCTL_PATH) &&
          args.includes('stop')
        ) {
          events.push('cleanup-stop');
          return options.cleanupStop ?? exited();
        }
        if (
          command === SETPRIV_PATH &&
          args.includes(SYSTEMCTL_PATH) &&
          args.includes('show')
        ) {
          events.push('cleanup-show');
          return (
            cleanupShows.shift() ??
            exited(0, 'LoadState=loaded\nActiveState=active\n')
          );
        }
        throw new Error('unexpected process');
      },
    ),
    wait,
  };
  return { ports, processCalls, openCalls, events, wait };
}

/** @param {Record<string, any>} value @returns {void} */
function expectDeepFrozen(value) {
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') {
      expectDeepFrozen(child);
    }
  }
}

describe('AWS single-node host runtime service command', () => {
  it('exposes only the two frozen exact command methods and accepts no production options', () => {
    const bytes = Buffer.from('artifact');
    const { ports } = makePorts(bytes);
    const command = createAwsSingleNodeHostRuntimeServiceCommandForTest(ports);

    expect(Object.keys(command)).toEqual([
      'inspectExactService',
      'convergeExactService',
    ]);
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(command.inspectExactService)).toBe(true);
    expect(Object.isFrozen(command.convergeExactService)).toBe(true);
    expect(() => createAwsSingleNodeHostRuntimeServiceCommand({})).toThrow(
      /does not accept options/i,
    );
  });

  it('snapshots every test port method and projection root against later replacement', async () => {
    const bytes = Buffer.from('artifact snapshot');
    const fixture = makePorts(bytes);
    const originalRunProcess = fixture.ports.runProcess;
    const originalOpenArtifact = fixture.ports.openArtifact;
    const originalPlatform = fixture.ports.platform;
    const command = createAwsSingleNodeHostRuntimeServiceCommandForTest(
      fixture.ports,
    );
    fixture.ports.projectionRoot = '/replacement';
    fixture.ports.runProcess = jest.fn(() => {
      throw new Error('replacement process must not run');
    });
    fixture.ports.openArtifact = jest.fn(() => {
      throw new Error('replacement open must not run');
    });
    fixture.ports.platform = jest.fn(() => 'darwin');

    await expect(
      command.inspectExactService(makeInput(bytes)),
    ).resolves.toEqual(makeServiceStatus(bytes));
    expect(originalRunProcess).toHaveBeenCalled();
    expect(originalOpenArtifact).toHaveBeenCalledTimes(2);
    expect(originalPlatform).toHaveBeenCalledTimes(1);
    expect(fixture.ports.runProcess).not.toHaveBeenCalled();
    expect(fixture.ports.openArtifact).not.toHaveBeenCalled();
    expect(fixture.ports.platform).not.toHaveBeenCalled();
  });

  it('resolves against keyed-only NSS, verifies through O_NOFOLLOW, and launches fixed clean argv after close', async () => {
    const bytes = Buffer.from('exact projected sea bytes');
    const fixture = makePorts(bytes);
    const command = createAwsSingleNodeHostRuntimeServiceCommandForTest(
      fixture.ports,
    );
    const input = makeInput(bytes);

    const status = await command.inspectExactService(input);

    expect(status).toEqual(makeServiceStatus(bytes));
    expectDeepFrozen(status);
    const expectedOpen = [
      input.artifactPath,
      fsConstants.O_RDONLY |
        (fsConstants.O_NOFOLLOW || 0) |
        (fsConstants.O_NONBLOCK || 0),
    ];
    expect(fixture.openCalls).toEqual([expectedOpen, expectedOpen]);
    expect(fixture.events.indexOf('artifact-close')).toBeLessThan(
      fixture.events.indexOf('metadata-launcher'),
    );
    expect(fixture.events.lastIndexOf('artifact-close')).toBeLessThan(
      fixture.events.indexOf('service-launcher'),
    );
    const accountCalls = fixture.processCalls.filter(
      ([commandPath]) =>
        commandPath === '/usr/bin/getent' || commandPath === '/usr/bin/id',
    );
    expect(
      accountCalls.map(([commandPath, args]) => [commandPath, args]),
    ).toEqual(
      expect.arrayContaining([
        ['/usr/bin/getent', ['passwd', 'wharfie-runtime']],
        ['/usr/bin/getent', ['group', 'wharfie-runtime']],
        ['/usr/bin/getent', ['passwd', String(RUNTIME_UID)]],
        ['/usr/bin/getent', ['group', String(RUNTIME_GID)]],
        ['/usr/bin/id', ['-u', 'wharfie-runtime']],
        ['/usr/bin/id', ['-g', 'wharfie-runtime']],
        ['/usr/bin/id', ['-G', 'wharfie-runtime']],
      ]),
    );
    expect(accountCalls).toHaveLength(7);
    expect(
      accountCalls.some(
        ([commandPath, args]) =>
          commandPath === '/usr/bin/getent' && args.length !== 2,
      ),
    ).toBe(false);

    const launcher = fixture.processCalls.find(
      ([commandPath, args]) =>
        commandPath === SETPRIV_PATH &&
        args.includes(SYSTEMD_RUN_PATH) &&
        args.includes('service'),
    );
    expect(launcher).toBeDefined();
    const [, args, processOptions] = launcher;
    const unitArgument = args.find((/** @type {string} */ argument) =>
      argument.startsWith('--unit='),
    );
    expect(unitArgument).toMatch(
      new RegExp(
        `^--unit=wharfie-host-runtime-service-${input.appId}-[a-f0-9]{64}\\.service$`,
        'u',
      ),
    );
    const environment = [
      `HOME=${RUNTIME_HOME}`,
      'USER=wharfie-runtime',
      'LOGNAME=wharfie-runtime',
      `XDG_CONFIG_HOME=${RUNTIME_HOME}/.config`,
      `XDG_DATA_HOME=${RUNTIME_HOME}/.local/share`,
      `XDG_RUNTIME_DIR=/run/user/${RUNTIME_UID}`,
      `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${RUNTIME_UID}/bus`,
      'LANG=C.UTF-8',
      'LC_ALL=C.UTF-8',
      'PATH=/usr/bin:/bin',
      `TMPDIR=${RUNTIME_HOME}/tmp`,
    ];
    expect(args).toEqual([
      '--reuid',
      `+${RUNTIME_UID}`,
      '--regid',
      `+${RUNTIME_GID}`,
      '--clear-groups',
      '--bounding-set=-all',
      '--inh-caps=-all',
      '--ambient-caps=-all',
      '--no-new-privs',
      '/usr/bin/env',
      '-i',
      ...environment,
      SYSTEMD_RUN_PATH,
      '--user',
      '--quiet',
      '--wait',
      '--pipe',
      '--collect',
      unitArgument,
      `--working-directory=${RUNTIME_HOME}`,
      '--property=Type=exec',
      '--property=NoNewPrivileges=yes',
      '--property=UMask=0077',
      '--property=KillMode=control-group',
      `--property=UnsetEnvironment=${TRANSIENT_LOADER_ENVIRONMENT_NAMES.join(
        ' ',
      )}`,
      '--property=RuntimeMaxSec=300s',
      '--property=TimeoutStopSec=30s',
      '--',
      '/usr/bin/env',
      '-i',
      ...environment,
      input.artifactPath,
      'wharfie',
      'service',
      'status',
      '--json',
    ]);
    expect(args).not.toContain('--expand-environment=no');
    expect(processOptions).toEqual({
      timeoutMilliseconds: 345_000,
      maxOutputBytes: 1024 * 1024,
    });
    expect(Object.isFrozen(processOptions)).toBe(true);
    const metadataLauncher = fixture.processCalls.find(
      ([commandPath, metadataArgs]) =>
        commandPath === SETPRIV_PATH &&
        metadataArgs.includes(SYSTEMD_RUN_PATH) &&
        metadataArgs.includes('metadata'),
    );
    const metadataUnitArgument = metadataLauncher[1].find(
      (/** @type {string} */ argument) => argument.startsWith('--unit='),
    );
    expect(metadataUnitArgument).toMatch(
      new RegExp(
        `^--unit=wharfie-host-runtime-metadata-${input.appId}-[a-f0-9]{64}\\.service$`,
        'u',
      ),
    );
    expect(metadataUnitArgument).not.toBe(unitArgument);
    expect(metadataLauncher[1]).toContain(
      `--working-directory=${RUNTIME_HOME}`,
    );
    expect(metadataLauncher[1].slice(-4)).toEqual([
      'wharfie',
      'metadata',
      '--json',
      '--no-pretty',
    ]);
  });

  it.each([
    ['authorized physical absence', 'authorized', 'physical-absence'],
    ['authorized install', 'authorized', 'durable-install'],
    ['authorized change', 'authorized', 'durable-change'],
    ['authorized active state', 'authorized', 'durable-active'],
    ['explicit conflict', 'conflict', null],
    ['explicit uncertainty', 'unknown', null],
  ])(
    'accepts an exact status-V3 desired-convergence decision for %s',
    async (_label, disposition, basis) => {
      const bytes = Buffer.from(`status decision ${String(_label)}`);
      const status = makeServiceStatus(bytes, {
        desiredConvergence: makeDesiredConvergence(bytes, {
          disposition,
          basis,
        }),
      });
      const fixture = makePorts(bytes, {
        serviceOutcomes: [exited(0, `${JSON.stringify(status)}\n`)],
      });

      await expect(
        createAwsSingleNodeHostRuntimeServiceCommandForTest(
          fixture.ports,
        ).inspectExactService(makeInput(bytes)),
      ).resolves.toEqual(status);
    },
  );

  it.each([
    [
      'status schema',
      (/** @type {Record<string, any>} */ status) => {
        status.schemaVersion = 2;
      },
    ],
    [
      'status kind',
      (/** @type {Record<string, any>} */ status) => {
        status.kind = 'wharfie.service.result';
      },
    ],
    [
      'status app',
      (/** @type {Record<string, any>} */ status) => {
        status.appId = 'different-app';
      },
    ],
    [
      'status unit',
      (/** @type {Record<string, any>} */ status) => {
        status.unit = 'wharfie-different-app.service';
      },
    ],
    [
      'missing proof',
      (/** @type {Record<string, any>} */ status) => {
        delete status.desiredConvergence;
      },
    ],
    [
      'proof schema',
      (/** @type {Record<string, any>} */ status) => {
        status.desiredConvergence.schemaVersion = 2;
      },
    ],
    [
      'proof kind',
      (/** @type {Record<string, any>} */ status) => {
        status.desiredConvergence.kind = 'wharfie.service.status';
      },
    ],
    [
      'proof app',
      (/** @type {Record<string, any>} */ status) => {
        status.desiredConvergence.appId = 'different-app';
      },
    ],
    [
      'proof unit',
      (/** @type {Record<string, any>} */ status) => {
        status.desiredConvergence.unit = 'wharfie-different-app.service';
      },
    ],
    [
      'proof extra field',
      (/** @type {Record<string, any>} */ status) => {
        status.desiredConvergence.argv = [];
      },
    ],
    [
      'proof missing field',
      (/** @type {Record<string, any>} */ status) => {
        delete status.desiredConvergence.disposition;
      },
    ],
    [
      'desired extra field',
      (/** @type {Record<string, any>} */ status) => {
        status.desiredConvergence.desired.path = '/forged';
      },
    ],
    [
      'desired missing field',
      (/** @type {Record<string, any>} */ status) => {
        delete status.desiredConvergence.desired.revisionId;
      },
    ],
    [
      'desired artifact identity',
      (/** @type {Record<string, any>} */ status) => {
        status.desiredConvergence.desired.artifactId = identity(
          'waf1',
          'different artifact',
        );
      },
    ],
    [
      'desired revision identity',
      (/** @type {Record<string, any>} */ status) => {
        status.desiredConvergence.desired.revisionId = identity(
          'wrv1',
          'different revision',
        );
      },
    ],
    [
      'malformed desired artifact identity',
      (/** @type {Record<string, any>} */ status) => {
        status.desiredConvergence.desired.artifactId = 'not-an-artifact';
      },
    ],
    [
      'unsupported disposition',
      (/** @type {Record<string, any>} */ status) => {
        status.desiredConvergence.disposition = 'ready';
      },
    ],
    [
      'authorized null basis',
      (/** @type {Record<string, any>} */ status) => {
        status.desiredConvergence.basis = null;
      },
    ],
    [
      'authorized unsupported basis',
      (/** @type {Record<string, any>} */ status) => {
        status.desiredConvergence.basis = 'manager-said-so';
      },
    ],
    [
      'conflict authorized basis',
      (/** @type {Record<string, any>} */ status) => {
        status.desiredConvergence.disposition = 'conflict';
      },
    ],
    [
      'unknown authorized basis',
      (/** @type {Record<string, any>} */ status) => {
        status.desiredConvergence.disposition = 'unknown';
      },
    ],
  ])(
    'rejects a status response with a mismatched %s decision',
    async (_label, mutate) => {
      const bytes = Buffer.from(`invalid status decision ${String(_label)}`);
      const status = makeServiceStatus(bytes);
      mutate(status);
      const fixture = makePorts(bytes, {
        serviceOutcomes: [exited(0, `${JSON.stringify(status)}\n`)],
      });

      await expect(
        createAwsSingleNodeHostRuntimeServiceCommandForTest(
          fixture.ports,
        ).inspectExactService(makeInput(bytes)),
      ).rejects.toBeInstanceOf(AwsSingleNodeHostRuntimeServiceResponseError);
      expect(fixture.events).toContain('service-launcher');
    },
  );

  it('requires an exact embedded metadata pair and byte observation before either service action', async () => {
    const bytes = Buffer.from('metadata-bound artifact');
    const otherRevision = createEmbeddedRevision('other-app');
    const cases = [
      {
        ...makeMetadata(bytes),
        artifact: {
          ...makeMetadata(bytes).artifact,
          size: bytes.byteLength + 1,
        },
      },
      {
        ...makeMetadata(bytes),
        runtime: {
          ...EMBEDDED_RUNTIME,
          target: { ...EMBEDDED_RUNTIME.target, architecture: 'arm64' },
        },
      },
      {
        ...makeMetadata(bytes),
        revision: otherRevision,
        runtime: {
          ...EMBEDDED_RUNTIME,
          appId: 'other-app',
          revisionId: otherRevision.revisionId,
        },
      },
    ];

    for (const metadata of cases) {
      const fixture = makePorts(bytes, {
        metadataOutcomes: [exited(0, `${JSON.stringify(metadata)}\n`)],
      });
      const command = createAwsSingleNodeHostRuntimeServiceCommandForTest(
        fixture.ports,
      );

      await expect(
        command.inspectExactService(makeInput(bytes)),
      ).rejects.toBeInstanceOf(AwsSingleNodeHostRuntimeServiceArtifactError);
      expect(fixture.events).toEqual([
        'artifact-open',
        'artifact-close',
        'metadata-launcher',
      ]);
      expect(fixture.events).not.toContain('service-launcher');
    }
  });

  it('uses non-reused invocation units while retaining fixed metadata and service namespaces', async () => {
    const bytes = Buffer.from('stable unit');
    const status = makeServiceStatus(bytes);
    const result = {
      schemaVersion: 1,
      kind: 'wharfie.service.result',
      requestStatus: 'fulfilled',
    };
    const fixture = makePorts(bytes, {
      serviceOutcomes: [
        exited(0, `${JSON.stringify(status)}\n`),
        exited(0, `${JSON.stringify(status)}\n`),
        exited(0, `${JSON.stringify(result)}\n`),
      ],
    });
    const command = createAwsSingleNodeHostRuntimeServiceCommandForTest(
      fixture.ports,
    );
    const base = makeInput(bytes);

    await command.inspectExactService({ ...base, attemptGeneration: 1 });
    await command.inspectExactService({
      ...base,
      intentId: identity('whai1', 'replacement service intent'),
      attemptGeneration: 99,
    });
    await command.convergeExactService({ ...base, attemptGeneration: 2 });

    const launchers = fixture.processCalls.filter(
      ([commandPath, args]) =>
        commandPath === SETPRIV_PATH &&
        args.includes(SYSTEMD_RUN_PATH) &&
        args.includes('service'),
    );
    const units = launchers.map(([, args]) =>
      args.find((/** @type {string} */ argument) =>
        argument.startsWith('--unit='),
      ),
    );
    expect(new Set(units).size).toBe(3);
    for (const unit of units) {
      expect(unit).toMatch(
        new RegExp(
          `^--unit=wharfie-host-runtime-service-${base.appId}-[a-f0-9]{64}\\.service$`,
          'u',
        ),
      );
    }
    expect(launchers[2][1].slice(-4)).toEqual([
      'wharfie',
      'service',
      'converge',
      '--json',
    ]);
  });

  it.each([
    [
      'fixed group membership',
      {
        selectedGroup: `wharfie-runtime:x:${RUNTIME_GID}:alias\n`,
        numericGroup: `wharfie-runtime:x:${RUNTIME_GID}:alias\n`,
      },
    ],
    ['supplementary id group', { idGroups: `${RUNTIME_GID} 10\n` }],
    [
      'nobody uid',
      {
        selectedPasswd: `wharfie-runtime:x:65534:${RUNTIME_GID}::${RUNTIME_HOME}:/usr/sbin/nologin\n`,
      },
    ],
    [
      'usable but substituted uid',
      {
        selectedPasswd: `wharfie-runtime:x:${RUNTIME_UID + 1}:${RUNTIME_GID}::${RUNTIME_HOME}:/usr/sbin/nologin\n`,
      },
    ],
    [
      'usable but substituted gid',
      {
        selectedGroup: `wharfie-runtime:x:${RUNTIME_GID + 1}:\n`,
      },
    ],
    [
      'numeric uid lookup alias',
      {
        numericPasswd: `alias:x:${RUNTIME_UID}:${RUNTIME_GID}::/var/empty:/usr/sbin/nologin\n`,
      },
    ],
    [
      'numeric gid lookup alias',
      {
        numericGroup: `alias:x:${RUNTIME_GID}:\n`,
      },
    ],
    [
      'wrong shell',
      {
        selectedPasswd: `wharfie-runtime:x:${RUNTIME_UID}:${RUNTIME_GID}::${RUNTIME_HOME}:/bin/bash\n`,
      },
    ],
    [
      'nonempty GECOS',
      {
        selectedPasswd: `wharfie-runtime:x:${RUNTIME_UID}:${RUNTIME_GID}:Wharfie:${RUNTIME_HOME}:/usr/sbin/nologin\n`,
        numericPasswd: `wharfie-runtime:x:${RUNTIME_UID}:${RUNTIME_GID}:Wharfie:${RUNTIME_HOME}:/usr/sbin/nologin\n`,
      },
    ],
  ])('rejects an invalid runtime account: %s', async (_label, account) => {
    const bytes = Buffer.from('account rejected');
    const fixture = makePorts(bytes, { account });
    const command = createAwsSingleNodeHostRuntimeServiceCommandForTest(
      fixture.ports,
    );

    await expect(
      command.inspectExactService(makeInput(bytes)),
    ).rejects.toBeInstanceOf(AwsSingleNodeHostRuntimeServiceAccountError);
    expect(fixture.openCalls).toHaveLength(0);
    expect(fixture.events).not.toContain('metadata-launcher');
    expect(fixture.events).not.toContain('service-launcher');
  });

  it.each([
    ['non-root owner', { uid: 1 }],
    ['wrong group', { gid: RUNTIME_GID + 1 }],
    ['write-enabled mode', { mode: 0o100750 }],
    ['set-id mode', { mode: 0o104550 }],
    ['linked file', { nlink: 2 }],
    ['non-regular file', { isFile: () => false }],
  ])('rejects the projected artifact envelope: %s', async (_label, change) => {
    const bytes = Buffer.from('artifact rejected');
    const fixture = makePorts(bytes, {
      stats: makeStats({ size: bytes.byteLength, ...change }),
    });
    const command = createAwsSingleNodeHostRuntimeServiceCommandForTest(
      fixture.ports,
    );

    await expect(
      command.inspectExactService(makeInput(bytes)),
    ).rejects.toBeInstanceOf(AwsSingleNodeHostRuntimeServiceArtifactError);
    expect(fixture.events).not.toContain('metadata-launcher');
    expect(fixture.events).not.toContain('service-launcher');
    expect(fixture.events).toContain('artifact-close');
  });

  it('rejects a changed descriptor, wrong bytes, and any path outside the exact projection', async () => {
    const bytes = Buffer.from('artifact changed');
    const changed = makePorts(bytes, {
      stats: [
        makeStats({ size: bytes.byteLength }),
        makeStats({ size: bytes.byteLength, ctimeMs: 12 }),
      ],
    });
    await expect(
      createAwsSingleNodeHostRuntimeServiceCommandForTest(
        changed.ports,
      ).inspectExactService(makeInput(bytes)),
    ).rejects.toBeInstanceOf(AwsSingleNodeHostRuntimeServiceArtifactError);
    expect(changed.events).not.toContain('metadata-launcher');
    expect(changed.events).not.toContain('service-launcher');

    const wrongBytes = Buffer.from('wrong bytes');
    const wrong = makePorts(wrongBytes);
    await expect(
      createAwsSingleNodeHostRuntimeServiceCommandForTest(
        wrong.ports,
      ).inspectExactService(
        makeInput(Buffer.from('expected bytes'), {
          contentLength: wrongBytes.byteLength,
        }),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeHostRuntimeServiceArtifactError);
    expect(wrong.events).not.toContain('metadata-launcher');
    expect(wrong.events).not.toContain('service-launcher');

    const outside = makePorts(bytes);
    await expect(
      createAwsSingleNodeHostRuntimeServiceCommandForTest(
        outside.ports,
      ).inspectExactService(
        makeInput(bytes, { artifactPath: '/tmp/unbound-app' }),
      ),
    ).rejects.toBeInstanceOf(AwsSingleNodeHostRuntimeServiceArtifactError);
    expect(outside.processCalls).toHaveLength(0);
  });

  it('validates the exact input and root authority before privileged account or artifact I/O', async () => {
    const bytes = Buffer.from('input authority');
    const extra = makePorts(bytes);
    await expect(
      createAwsSingleNodeHostRuntimeServiceCommandForTest(
        extra.ports,
      ).inspectExactService({ ...makeInput(bytes), extra: true }),
    ).rejects.toThrow(/exact keys/i);
    expect(extra.processCalls).toHaveLength(0);

    const digest = makePorts(bytes);
    await expect(
      createAwsSingleNodeHostRuntimeServiceCommandForTest(
        digest.ports,
      ).inspectExactService(
        makeInput(bytes, {
          artifactId: identity('waf1', 'other artifact'),
        }),
      ),
    ).rejects.toThrow(/exact byteDigest/i);
    expect(digest.processCalls).toHaveLength(0);

    const generation = makePorts(bytes);
    await expect(
      createAwsSingleNodeHostRuntimeServiceCommandForTest(
        generation.ports,
      ).convergeExactService(makeInput(bytes, { attemptGeneration: 0 })),
    ).rejects.toThrow(/positive attemptGeneration/i);
    expect(generation.processCalls).toHaveLength(0);

    const authority = makePorts(bytes);
    authority.ports.geteuid = jest.fn(() => 1);
    await expect(
      createAwsSingleNodeHostRuntimeServiceCommandForTest(
        authority.ports,
      ).inspectExactService(makeInput(bytes)),
    ).rejects.toBeInstanceOf(AwsSingleNodeHostRuntimeServiceAuthorityError);
    expect(authority.processCalls).toHaveLength(0);
  });

  it.each([
    ['leading whitespace', ` {"ok":true}\n`, ''],
    ['missing newline', '{"ok":true}', ''],
    ['array response', '[]\n', ''],
    ['nonempty stderr', '{"ok":true}\n', 'sensitive stderr'],
  ])(
    'rejects a noncanonical finite response without exposing raw bytes: %s',
    async (_label, stdout, stderr) => {
      const bytes = Buffer.from('response rejected');
      const fixture = makePorts(bytes, {
        serviceOutcomes: [exited(0, stdout, stderr)],
      });
      const command = createAwsSingleNodeHostRuntimeServiceCommandForTest(
        fixture.ports,
      );

      let failure;
      try {
        await command.inspectExactService(makeInput(bytes));
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(
        AwsSingleNodeHostRuntimeServiceResponseError,
      );
      expect(String(failure)).not.toContain('sensitive stderr');
    },
  );

  it('accepts a canonical finite nonzero converge receipt as parsed diagnostics but rejects nonzero inspect', async () => {
    const bytes = Buffer.from('finite nonzero');
    const diagnostics = {
      schemaVersion: 1,
      kind: 'wharfie.service.result',
      requestStatus: 'failed',
    };
    const converge = makePorts(bytes, {
      serviceOutcomes: [exited(1, `${JSON.stringify(diagnostics)}\n`)],
      cleanupShows: [exited(0, 'LoadState=loaded\nActiveState=inactive\n')],
    });
    await expect(
      createAwsSingleNodeHostRuntimeServiceCommandForTest(
        converge.ports,
      ).convergeExactService(makeInput(bytes)),
    ).resolves.toEqual(diagnostics);
    expect(converge.events.slice(-3)).toEqual([
      'service-launcher',
      'cleanup-stop',
      'cleanup-show',
    ]);

    const inspect = makePorts(bytes, {
      serviceOutcomes: [exited(1, `${JSON.stringify(diagnostics)}\n`)],
      cleanupShows: [exited(0, 'LoadState=loaded\nActiveState=inactive\n')],
    });
    await expect(
      createAwsSingleNodeHostRuntimeServiceCommandForTest(
        inspect.ports,
      ).inspectExactService(makeInput(bytes)),
    ).rejects.toBeInstanceOf(AwsSingleNodeHostRuntimeServiceResponseError);
    expect(inspect.events.slice(-3)).toEqual([
      'service-launcher',
      'cleanup-stop',
      'cleanup-show',
    ]);
  });

  it('contains its separate metadata unit before rejecting a failed metadata launch', async () => {
    const bytes = Buffer.from('predecessor app-wide fence');
    const fixture = makePorts(bytes, {
      metadataOutcomes: [exited(1)],
      cleanupShows: [exited(0, 'LoadState=loaded\nActiveState=inactive\n')],
    });
    const command = createAwsSingleNodeHostRuntimeServiceCommandForTest(
      fixture.ports,
    );

    await expect(
      command.inspectExactService(makeInput(bytes)),
    ).rejects.toBeInstanceOf(AwsSingleNodeHostRuntimeServiceResponseError);
    expect(fixture.events).toEqual([
      'artifact-open',
      'artifact-close',
      'metadata-launcher',
      'cleanup-stop',
      'cleanup-show',
    ]);
    const cleanupStop = fixture.processCalls.find(
      ([commandPath, args]) =>
        commandPath === SETPRIV_PATH &&
        args.includes(SYSTEMCTL_PATH) &&
        args.includes('stop'),
    );
    const metadataLaunch = fixture.processCalls.find(
      ([commandPath, args]) =>
        commandPath === SETPRIV_PATH &&
        args.includes(SYSTEMD_RUN_PATH) &&
        args.includes('metadata'),
    );
    expect(cleanupStop[1].at(-1)).toBe(
      metadataLaunch[1]
        .find((/** @type {string} */ argument) =>
          argument.startsWith('--unit='),
        )
        .slice('--unit='.length),
    );
  });

  it('stops and polls a timed-out transient unit until terminal before throwing a redacted timeout', async () => {
    const bytes = Buffer.from('ambiguous timeout');
    const secret = 'sensitive ambiguous process output';
    const fixture = makePorts(bytes, {
      serviceOutcomes: [ambiguous(true, secret)],
      cleanupShows: [
        exited(0, 'LoadState=loaded\nActiveState=deactivating\n'),
        exited(0, 'LoadState=loaded\nActiveState=inactive\n'),
      ],
    });
    const command = createAwsSingleNodeHostRuntimeServiceCommandForTest(
      fixture.ports,
    );

    /** @type {any} */
    let failure;
    try {
      await command.convergeExactService(makeInput(bytes));
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(
      AwsSingleNodeHostRuntimeServiceExecutionError,
    );
    expect(failure.timedOut).toBe(true);
    expect(String(failure)).not.toContain(secret);
    expect(fixture.events).toEqual([
      'artifact-open',
      'artifact-close',
      'metadata-launcher',
      'artifact-open',
      'artifact-close',
      'service-launcher',
      'cleanup-stop',
      'cleanup-show',
      'cleanup-show',
    ]);
    expect(fixture.wait).toHaveBeenCalledTimes(1);
    const cleanupCalls = fixture.processCalls.filter(
      ([commandPath, args]) =>
        commandPath === SETPRIV_PATH && args.includes(SYSTEMCTL_PATH),
    );
    const serviceLaunch = fixture.processCalls.find(
      ([commandPath, args]) =>
        commandPath === SETPRIV_PATH &&
        args.includes(SYSTEMD_RUN_PATH) &&
        args.includes('service'),
    );
    const stableUnit = serviceLaunch[1]
      .find((/** @type {string} */ argument) => argument.startsWith('--unit='))
      .slice('--unit='.length);
    expect(cleanupCalls[0][1].slice(-4)).toEqual([
      SYSTEMCTL_PATH,
      '--user',
      'stop',
      stableUnit,
    ]);
    expect(cleanupCalls[1][1].slice(-6)).toEqual([
      SYSTEMCTL_PATH,
      '--user',
      'show',
      '--property=LoadState',
      '--property=ActiveState',
      stableUnit,
    ]);
  });

  it('never settles while cleanup cannot prove terminality', async () => {
    const bytes = Buffer.from('never terminal');
    const wait = jest.fn(() => new Promise(() => {}));
    const fixture = makePorts(bytes, {
      serviceOutcomes: [ambiguous(false, 'secret output')],
      wait,
    });
    const command = createAwsSingleNodeHostRuntimeServiceCommandForTest(
      fixture.ports,
    );
    let settled = false;
    command.convergeExactService(makeInput(bytes)).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(settled).toBe(false);
    expect(
      fixture.events.filter((event) => event === 'cleanup-show'),
    ).toHaveLength(1);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('does not treat a failed unit state as proof that its process is gone', async () => {
    const bytes = Buffer.from('failed can retain processes');
    const wait = jest.fn(() => new Promise(() => {}));
    const fixture = makePorts(bytes, {
      serviceOutcomes: [ambiguous(false, 'secret output')],
      cleanupShows: [exited(0, 'LoadState=loaded\nActiveState=failed\n')],
      wait,
    });
    const command = createAwsSingleNodeHostRuntimeServiceCommandForTest(
      fixture.ports,
    );
    let settled = false;
    command.convergeExactService(makeInput(bytes)).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(settled).toBe(false);
    expect(
      fixture.events.filter((event) => event === 'cleanup-show'),
    ).toHaveLength(1);
    expect(wait).toHaveBeenCalledTimes(1);
  });
});
