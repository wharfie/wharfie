/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';

import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_CLI_PATH,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_CORE_PATH,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_KIND,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_SAFETY_CLASS,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_SCHEMA_VERSION,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_TOOLING_PATHS,
  createAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessInspector,
  parseAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessArguments,
  stringifyAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessReport,
} from '../../scripts/aws-host-retained-storage-host-preflight-sea-linux-docker-readiness.js';
import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
import { sha256Base64Url } from '../../src/core/runtime/content-id.js';
import { assertManifestIsSecretFree } from '../../src/core/runtime/manifest-security.js';

const IMAGE_ID = `sha256:${'a'.repeat(64)}`;
const OTHER_IMAGE_ID = `sha256:${'b'.repeat(64)}`;
const SOURCE_COMMIT = 'c'.repeat(40);
const OTHER_SOURCE_COMMIT = 'd'.repeat(40);
const CONTAINER_ID = 'e'.repeat(64);
const OUTPUT_ROOT = '/private/tmp/wharfie-v84-proof-receipts';
const OBSERVED_AT = '2026-07-27T17:18:19.123Z';
const MIB = 1024 * 1024;

/**
 * @typedef {{
 *   toolingIndex?: number,
 *   toolingState?: string,
 *   commit?: string,
 *   worktree?: string
 * }} RepositoryObservationOptions
 */

/**
 * @typedef {{
 *   architecture?: string,
 *   executionMode?: string,
 *   operatingSystem?: string,
 *   cpuCount?: number,
 *   memoryBytes?: string,
 *   serverVersion?: string
 * }} DaemonObservationOptions
 */

/**
 * @typedef {{
 *   id?: string,
 *   operatingSystem?: string,
 *   architecture?: string,
 *   rootfsDigest?: Record<string, any>
 * }} ImageObservationOptions
 */

/**
 * @typedef {{
 *   writable?: boolean,
 *   device?: string,
 *   availableBytes?: string
 * }} HostTempObservationOptions
 */

/**
 * @typedef {{
 *   rootState?: string,
 *   proofCommitPath?: string,
 *   writable?: boolean,
 *   device?: string,
 *   availableBytes?: string
 * }} OutputObservationOptions
 */

/**
 * @typedef {{
 *   observedAt?: string,
 *   repositorySequence?: any[],
 *   imageSequence?: any[],
 *   endpoint?: any,
 *   daemon?: any,
 *   container?: any,
 *   hostTemp?: any,
 *   output?: any
 * }} SemanticPortOptions
 */

const DEFAULT_ADVISORIES = Object.freeze([
  'DOCKER_BACKING_STORE_CAPACITY_UNOBSERVED',
  'POINT_IN_TIME_ONLY',
  'UNRESTRICTED_FUTURE_NETWORK',
]);

const EXPECTED_LIMITATIONS = Object.freeze([
  'This point-in-time report reserves no resources and authorizes no mutation.',
  'The bounded proof driver repeats its own clean-head, image, container, cleanup, and publication checks.',
  'Docker backing-store free capacity is not exposed by this portable read-only observation.',
  'Docker socket and context access remain privileged caller-controlled trust boundaries.',
  'PATH-selected Git and Docker executable bytes plus local repository and Docker configuration are caller-controlled trusted-local inputs.',
  'A unix:// endpoint establishes local transport, not daemon identity; its socket can proxy or be replaced.',
  'Stopped-container labels are forgeable cleanup eligibility, not authenticated ownership.',
  'Access and statfs observations do not cover inode, quota, thin-provisioning, or backing-store exhaustion.',
  'Image provenance, signature, bootstrap Node behavior, emulation, registry, TLS, DNS, dependency installation, build success, and proof execution are not verified.',
  'Host access, statfs, repository, image, container, and output-path state can change immediately after observation.',
  'A later bounded proof uses unrestricted bridge networking and can contact external services.',
]);

const INPUT = Object.freeze({
  imageId: IMAGE_ID,
  outputRoot: OUTPUT_ROOT,
});

/** @param {string} label */
function bytes(label) {
  return {
    byteDigest: {
      algorithm: 'sha256',
      value: sha256Base64Url(label),
    },
    size: Buffer.byteLength(label, 'utf8'),
  };
}

/** @param {string} logicalPath @param {string} [state] */
function toolingObservation(logicalPath, state = 'matching') {
  const committedBytes = bytes(`committed:${logicalPath}`);
  if (state === 'invalid-tree') {
    return {
      logicalPath,
      treeEntry: 'invalid',
      liveFile: 'safe-regular',
      committedBytes: null,
      liveBytes: committedBytes,
      matchesHead: false,
    };
  }
  if (state === 'unsafe-live') {
    return {
      logicalPath,
      treeEntry: 'regular-blob',
      liveFile: 'unsafe',
      committedBytes,
      liveBytes: null,
      matchesHead: false,
    };
  }
  if (state === 'mismatch') {
    return {
      logicalPath,
      treeEntry: 'regular-blob',
      liveFile: 'safe-regular',
      committedBytes,
      liveBytes: bytes(`changed:${logicalPath}`),
      matchesHead: false,
    };
  }
  return {
    logicalPath,
    treeEntry: 'regular-blob',
    liveFile: 'safe-regular',
    committedBytes,
    liveBytes: committedBytes,
    matchesHead: true,
  };
}

/** @param {RepositoryObservationOptions} [options] */
function repositoryObservation(options = {}) {
  const tooling =
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_TOOLING_PATHS.map(
      (logicalPath, index) =>
        toolingObservation(
          logicalPath,
          index === (options.toolingIndex ?? -1)
            ? options.toolingState
            : 'matching',
        ),
    );
  return {
    state: 'observed',
    commit: options.commit ?? SOURCE_COMMIT,
    worktree: options.worktree ?? 'clean',
    tooling,
  };
}

/** @param {DaemonObservationOptions} [options] */
function daemonObservation(options = {}) {
  const architecture = options.architecture ?? 'amd64';
  const executionMode =
    options.executionMode ??
    (['amd64', 'x86_64'].includes(architecture)
      ? 'native'
      : ['arm64', 'aarch64'].includes(architecture)
        ? 'emulated'
        : 'unsupported');
  return {
    state: 'observed',
    operatingSystem: options.operatingSystem ?? 'linux',
    architecture,
    executionMode,
    cpuCount: options.cpuCount ?? 4,
    memoryBytes: options.memoryBytes ?? String(6 * 1024 * 1024 * 1024),
    serverVersion: options.serverVersion ?? '28.3.2',
  };
}

/** @param {ImageObservationOptions} [options] */
function imageObservation(options = {}) {
  return {
    state: 'observed',
    id: options.id ?? IMAGE_ID,
    operatingSystem: options.operatingSystem ?? 'linux',
    architecture: options.architecture ?? 'amd64',
    rootfsDigest: options.rootfsDigest ?? {
      algorithm: 'sha256',
      value: sha256Base64Url('fixed local image rootfs'),
    },
  };
}

/** @param {string} [collisionClass] */
function containerObservation(collisionClass = 'absent') {
  if (collisionClass === 'absent' || collisionClass === 'unobservable') {
    return { state: collisionClass };
  }
  return {
    state: 'observed',
    containerId: CONTAINER_ID,
    runtimeState:
      collisionClass === 'stopped-owned-reconcilable' ? 'stopped' : 'running',
    collisionClass,
  };
}

/** @param {HostTempObservationOptions} [options] */
function hostTempObservation(options = {}) {
  return {
    state: 'observed',
    writable: options.writable ?? true,
    device: options.device ?? '101',
    availableBytes: options.availableBytes ?? String(512 * MIB),
  };
}

/** @param {OutputObservationOptions} [options] */
function outputObservation(options = {}) {
  return {
    state: 'observed',
    rootState: options.rootState ?? 'existing',
    proofCommitPath: options.proofCommitPath ?? 'absent',
    writable: options.writable ?? true,
    device: options.device ?? '202',
    availableBytes: options.availableBytes ?? String(16 * MIB),
  };
}

/**
 * @template T
 * @param {T[]} sequence
 * @param {number} index
 * @returns {T}
 */
function next(sequence, index) {
  return sequence[Math.min(index, sequence.length - 1)];
}

/** @param {SemanticPortOptions} [options] */
function createSemanticPorts(options = {}) {
  /** @type {Array<{operation: string, input: any}>} */
  const calls = [];
  /** @type {any[]} */
  const receivers = [];
  const repositories = options.repositorySequence ?? [repositoryObservation()];
  const images = options.imageSequence ?? [imageObservation()];
  let repositoryIndex = 0;
  let imageIndex = 0;
  /** @param {any} receiver @param {string} operation @param {any} [input] */
  const record = (receiver, operation, input) => {
    calls.push({ operation, input });
    receivers.push(receiver);
  };

  const ports = {
    async readObservedAt() {
      record(this, 'readObservedAt');
      return options.observedAt ?? OBSERVED_AT;
    },
    async observeRepository() {
      record(this, 'observeRepository');
      const value = next(repositories, repositoryIndex);
      repositoryIndex += 1;
      return value;
    },
    async observeDockerEndpoint() {
      record(this, 'observeDockerEndpoint');
      return (
        options.endpoint ?? {
          state: 'observed',
          locality: 'local-unix',
        }
      );
    },
    async observeDockerDaemon() {
      record(this, 'observeDockerDaemon');
      return options.daemon ?? daemonObservation();
    },
    /** @param {Record<string, any>} input */
    async observeDockerImage(input) {
      record(this, 'observeDockerImage', input);
      const value = next(images, imageIndex);
      imageIndex += 1;
      return value;
    },
    /** @param {Record<string, any>} input */
    async observeDockerContainer(input) {
      record(this, 'observeDockerContainer', input);
      return options.container ?? containerObservation();
    },
    async observeHostTemp() {
      record(this, 'observeHostTemp');
      return options.hostTemp ?? hostTempObservation();
    },
    /** @param {Record<string, any>} input */
    async observeOutput(input) {
      record(this, 'observeOutput', input);
      return options.output ?? outputObservation();
    },
  };
  return { calls, ports, receivers };
}

/** @param {SemanticPortOptions} [options] */
function createFixture(options = {}) {
  const semantics = createSemanticPorts(options);
  return {
    ...semantics,
    inspector:
      createAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessInspector({
        ports: semantics.ports,
      }),
  };
}

/** @param {any} value */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

function expectedReadyReport() {
  const repository = repositoryObservation();
  const image = imageObservation();
  return sortCanonicalJsonValue({
    schemaVersion:
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_SCHEMA_VERSION,
    kind: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_KIND,
    safetyClass:
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_SAFETY_CLASS,
    authority: 'none',
    authoritative: false,
    observedAt: OBSERVED_AT,
    freshness: 'point-in-time-only',
    subject: {
      sourceCommit: SOURCE_COMMIT,
      toolingCommit: SOURCE_COMMIT,
      imageId: IMAGE_ID,
      outputRootDigest: {
        algorithm: 'sha256',
        value: sha256Base64Url(OUTPUT_ROOT),
      },
      containerName: `wharfie-sea-proof-${SOURCE_COMMIT}`,
    },
    requirements: {
      imagePlatform: 'linux/amd64',
      daemonMemoryBytes: '6442450944',
      requestedCpuCount: 4,
      pidsLimit: 512,
      workTmpfsBytes: '4294967296',
      tempTmpfsBytes: '536870912',
      wallClockLimitMilliseconds: 1_800_000,
      gitBundleMaximumBytes: '134217728',
      toolingExportMaximumBytes: '6291456',
      hostTempMinimumAvailableBytes: '167772160',
      outputMinimumAvailableBytes: '2097152',
    },
    observations: {
      repository: {
        initial: repository,
        final: repository,
        stable: true,
      },
      dockerEndpoint: {
        state: 'observed',
        locality: 'local-unix',
      },
      daemon: daemonObservation(),
      image: {
        initial: image,
        final: image,
        stable: true,
      },
      containerName: { state: 'absent' },
      hostTemp: {
        state: 'observed',
        writable: true,
        availableBytes: '536870912',
      },
      output: {
        state: 'observed',
        rootState: 'existing',
        proofCommitPath: 'absent',
        writable: true,
        availableBytes: '16777216',
      },
      filesystemTopology: 'distinct',
    },
    readyForBoundedAttempt: true,
    blockers: [],
    advisories: [...DEFAULT_ADVISORIES],
    limitations: [...EXPECTED_LIMITATIONS],
  });
}

describe('AWS retained-storage host-preflight SEA Linux Docker readiness core', () => {
  it('parses only exact immutable-image and canonical-output argv', () => {
    expect(
      parseAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessArguments([
        'node',
        'readiness.js',
        IMAGE_ID,
        OUTPUT_ROOT,
      ]),
    ).toEqual(INPUT);

    for (const argv of [
      ['node', 'readiness.js', 'node:24-bookworm', OUTPUT_ROOT],
      ['node', 'readiness.js', IMAGE_ID, 'relative'],
      ['node', 'readiness.js', IMAGE_ID, '/'],
      ['node', 'readiness.js', IMAGE_ID, `${OUTPUT_ROOT}/../other`],
      ['node', 'readiness.js', IMAGE_ID],
      ['node', 'readiness.js', IMAGE_ID, OUTPUT_ROOT, 'extra'],
    ]) {
      expect(() =>
        parseAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessArguments(
          argv,
        ),
      ).toThrow();
    }
  });

  it('rejects accessor, symbol, and named-property argv expansion without invoking an accessor', () => {
    let accessorInvoked = false;
    const accessorArgv = ['node', 'readiness.js', IMAGE_ID, OUTPUT_ROOT];
    Object.defineProperty(accessorArgv, 2, {
      enumerable: true,
      get() {
        accessorInvoked = true;
        return IMAGE_ID;
      },
    });
    expect(() =>
      parseAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessArguments(
        accessorArgv,
      ),
    ).toThrow();
    expect(accessorInvoked).toBe(false);

    const named = ['node', 'readiness.js', IMAGE_ID, OUTPUT_ROOT];
    /** @type {any} */ (named).extra = true;
    expect(() =>
      parseAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessArguments(
        named,
      ),
    ).toThrow();

    const symbol = ['node', 'readiness.js', IMAGE_ID, OUTPUT_ROOT];
    /** @type {any} */ (symbol)[Symbol('extra')] = true;
    expect(() =>
      parseAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessArguments(
        symbol,
      ),
    ).toThrow();
  });

  it('rejects malformed exact input before any semantic port call', async () => {
    const fixture = createFixture();
    const invalidInputs = [
      null,
      [],
      { imageId: IMAGE_ID },
      { outputRoot: OUTPUT_ROOT },
      { ...INPUT, extra: true },
      { ...INPUT, imageId: OTHER_IMAGE_ID.toUpperCase() },
      { ...INPUT, outputRoot: `${OUTPUT_ROOT}\n` },
    ];
    for (const input of invalidInputs) {
      await expect(fixture.inspector.inspect(input)).rejects.toThrow();
      expect(fixture.calls).toHaveLength(0);
    }

    let accessorInvoked = false;
    const accessorInput = { outputRoot: OUTPUT_ROOT };
    Object.defineProperty(accessorInput, 'imageId', {
      enumerable: true,
      get() {
        accessorInvoked = true;
        return IMAGE_ID;
      },
    });
    await expect(fixture.inspector.inspect(accessorInput)).rejects.toThrow();
    expect(accessorInvoked).toBe(false);
    expect(fixture.calls).toHaveLength(0);

    const symbolInput = { ...INPUT };
    /** @type {any} */ (symbolInput)[Symbol('extra')] = true;
    await expect(fixture.inspector.inspect(symbolInput)).rejects.toThrow();
    expect(fixture.calls).toHaveLength(0);
  });

  it('accepts only exact own-data options and semantic read-only ports', () => {
    const { ports } = createSemanticPorts();
    expect(() =>
      createAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessInspector({
        ports,
      }),
    ).not.toThrow();

    for (const options of [
      null,
      {},
      { ports, extra: true },
      { ports: { ...ports, observeOutput: undefined } },
      { ports: { ...ports, removeContainer() {} } },
    ]) {
      expect(() =>
        createAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessInspector(
          options,
        ),
      ).toThrow();
    }

    const symbolOptions = { ports };
    /** @type {any} */ (symbolOptions)[Symbol('extra')] = true;
    expect(() =>
      createAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessInspector(
        symbolOptions,
      ),
    ).toThrow();

    const symbolPorts = { ...ports };
    /** @type {any} */ (symbolPorts)[Symbol('writeFile')] = () => {};
    expect(() =>
      createAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessInspector({
        ports: symbolPorts,
      }),
    ).toThrow();
  });

  it('rejects option and port accessors without invoking them', () => {
    const { ports } = createSemanticPorts();
    let optionAccessorInvoked = false;
    const options = {};
    Object.defineProperty(options, 'ports', {
      enumerable: true,
      get() {
        optionAccessorInvoked = true;
        return ports;
      },
    });
    expect(() =>
      createAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessInspector(
        options,
      ),
    ).toThrow();
    expect(optionAccessorInvoked).toBe(false);

    let portAccessorInvoked = false;
    const accessorPorts = { ...ports };
    Object.defineProperty(accessorPorts, 'observeOutput', {
      enumerable: true,
      get() {
        portAccessorInvoked = true;
        return ports.observeOutput;
      },
    });
    expect(() =>
      createAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessInspector({
        ports: accessorPorts,
      }),
    ).toThrow();
    expect(portAccessorInvoked).toBe(false);
  });

  it('captures semantic ports with their receiver and ignores later replacement', async () => {
    const fixture = createFixture();
    const mutablePorts =
      /** @type {Record<string, (...args: any[]) => any>} */ (fixture.ports);
    for (const key of Object.keys(fixture.ports)) {
      mutablePorts[key] = () => {
        throw new Error(`replacement ${key} must not run`);
      };
    }

    const report = await fixture.inspector.inspect(INPUT);

    expect(report.readyForBoundedAttempt).toBe(true);
    expect(fixture.receivers).toHaveLength(10);
    expect(
      fixture.receivers.every((receiver) => receiver === fixture.ports),
    ).toBe(true);
  });

  it('returns the complete canonical deeply frozen golden ready report', async () => {
    const fixture = createFixture();

    const report = await fixture.inspector.inspect(INPUT);

    expect(report).toEqual(expectedReadyReport());
    expect(fixture.calls).toEqual([
      { operation: 'readObservedAt', input: undefined },
      { operation: 'observeRepository', input: undefined },
      { operation: 'observeDockerEndpoint', input: undefined },
      { operation: 'observeDockerDaemon', input: undefined },
      {
        operation: 'observeDockerImage',
        input: { imageId: IMAGE_ID },
      },
      {
        operation: 'observeDockerContainer',
        input: {
          imageId: IMAGE_ID,
          sourceCommit: SOURCE_COMMIT,
          toolingCommit: SOURCE_COMMIT,
          containerName: `wharfie-sea-proof-${SOURCE_COMMIT}`,
        },
      },
      { operation: 'observeHostTemp', input: undefined },
      {
        operation: 'observeOutput',
        input: {
          outputRoot: OUTPUT_ROOT,
          sourceCommit: SOURCE_COMMIT,
        },
      },
      {
        operation: 'observeDockerImage',
        input: { imageId: IMAGE_ID },
      },
      { operation: 'observeRepository', input: undefined },
    ]);
    for (const call of fixture.calls.filter(({ input }) => input)) {
      expectDeepFrozen(call.input);
    }
    expectDeepFrozen(report);
  });

  it('serializes the golden report as one canonical newline-terminated frame', async () => {
    const report = await createFixture().inspector.inspect(INPUT);
    const expected = `${JSON.stringify(sortCanonicalJsonValue(expectedReadyReport()))}\n`;

    const encoded =
      stringifyAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessReport(
        report,
      );

    expect(encoded).toBe(expected);
    expect(encoded.endsWith('\n')).toBe(true);
    expect(encoded.slice(0, -1)).not.toContain('\n');
    expect(JSON.parse(encoded)).toEqual(report);
  });

  it('rejects expanded, duplicated, or unsorted serialized decision surfaces', async () => {
    const report = await createFixture().inspector.inspect(INPUT);
    const expanded = JSON.parse(JSON.stringify(report));
    expanded.extra = true;
    expect(() =>
      stringifyAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessReport(
        expanded,
      ),
    ).toThrow();

    const duplicated = JSON.parse(JSON.stringify(report));
    duplicated.advisories.push(duplicated.advisories[0]);
    expect(() =>
      stringifyAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessReport(
        duplicated,
      ),
    ).toThrow();

    const unsorted = JSON.parse(JSON.stringify(report));
    unsorted.advisories.reverse();
    expect(() =>
      stringifyAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessReport(
        unsorted,
      ),
    ).toThrow();
  });

  it('classifies a dirty repository without exposing dirty paths', async () => {
    const dirty = repositoryObservation({ worktree: 'dirty' });
    const report = await createFixture({
      repositorySequence: [dirty],
    }).inspector.inspect(INPUT);

    expect(report.readyForBoundedAttempt).toBe(false);
    expect(report.blockers).toEqual(['REPOSITORY_DIRTY']);
    expect(JSON.stringify(report)).not.toContain('/Users/private');
    expect(JSON.stringify(report)).not.toContain('.env');
  });

  it('blocks when the repository changes between its two observations', async () => {
    const report = await createFixture({
      repositorySequence: [
        repositoryObservation(),
        repositoryObservation({ commit: OTHER_SOURCE_COMMIT }),
      ],
    }).inspector.inspect(INPUT);

    expect(report.subject.sourceCommit).toBe(SOURCE_COMMIT);
    expect(report.observations.repository.stable).toBe(false);
    expect(report.blockers).toEqual(['REPOSITORY_CHANGED_DURING_ASSESSMENT']);
  });

  it.each([
    ['invalid-tree', ['TOOLING_BYTES_MISMATCH', 'TOOLING_TREE_ENTRY_INVALID']],
    ['unsafe-live', ['TOOLING_BYTES_MISMATCH', 'TOOLING_LIVE_FILE_UNSAFE']],
    ['mismatch', ['TOOLING_BYTES_MISMATCH']],
  ])(
    'classifies %s tooling without weakening exact byte agreement',
    async (toolingState, blockers) => {
      const repository = repositoryObservation({
        toolingIndex: 2,
        toolingState,
      });
      const report = await createFixture({
        repositorySequence: [repository],
      }).inspector.inspect(INPUT);

      expect(report.readyForBoundedAttempt).toBe(false);
      expect(report.blockers).toEqual(blockers);
    },
  );

  it('fails closed on semantically inconsistent tooling evidence', async () => {
    const repository = repositoryObservation();
    repository.tooling[0].matchesHead = false;
    const fixture = createFixture({
      repositorySequence: [repository],
    });

    await expect(fixture.inspector.inspect(INPUT)).rejects.toThrow(
      /inconsistent byte evidence/u,
    );
    expect(
      fixture.calls.some(
        ({ operation }) => operation === 'observeDockerEndpoint',
      ),
    ).toBe(false);
  });

  it.each([
    [
      { state: 'unobservable' },
      [
        'CONTAINER_COLLISION_UNOBSERVABLE',
        'DOCKER_DAEMON_UNOBSERVABLE',
        'DOCKER_ENDPOINT_UNOBSERVABLE',
        'IMAGE_NOT_OBSERVED_LOCAL',
      ],
    ],
    [
      { state: 'observed', locality: 'remote-or-unsupported' },
      [
        'CONTAINER_COLLISION_UNOBSERVABLE',
        'DOCKER_DAEMON_UNOBSERVABLE',
        'DOCKER_ENDPOINT_NOT_LOCAL',
        'IMAGE_NOT_OBSERVED_LOCAL',
      ],
    ],
  ])(
    'reports an endpoint state without touching remote Docker semantics',
    async (endpoint, blockers) => {
      const fixture = createFixture({ endpoint });
      const report = await fixture.inspector.inspect(INPUT);

      expect(report.readyForBoundedAttempt).toBe(false);
      expect(report.blockers).toEqual(blockers);
      expect(
        fixture.calls.some(
          ({ operation }) => operation === 'observeDockerDaemon',
        ),
      ).toBe(false);
      expect(
        fixture.calls.some(
          ({ operation }) => operation === 'observeDockerImage',
        ),
      ).toBe(false);
      expect(
        fixture.calls.some(
          ({ operation }) => operation === 'observeDockerContainer',
        ),
      ).toBe(false);
    },
  );

  it.each([
    [
      daemonObservation({ operatingSystem: 'darwin' }),
      ['DOCKER_DAEMON_OS_UNSUPPORTED'],
      [],
    ],
    [
      daemonObservation({ architecture: 'riscv64' }),
      ['DOCKER_DAEMON_ARCHITECTURE_UNSUPPORTED'],
      [],
    ],
    [
      daemonObservation({ memoryBytes: String(6 * 1024 * 1024 * 1024 - 1) }),
      ['DOCKER_DAEMON_MEMORY_INSUFFICIENT'],
      [],
    ],
    [
      daemonObservation({ cpuCount: 3 }),
      [],
      ['DAEMON_CPU_BELOW_REQUESTED_CAP'],
    ],
    [
      daemonObservation({ architecture: 'arm64' }),
      [],
      ['EMULATED_AMD64_EXECUTION'],
    ],
  ])(
    'classifies Docker daemon compatibility and advisory capacity',
    async (daemon, blockers, extraAdvisories) => {
      const report = await createFixture({ daemon }).inspector.inspect(INPUT);

      expect(report.blockers).toEqual(blockers);
      expect(report.advisories).toEqual(
        [...DEFAULT_ADVISORIES, ...extraAdvisories].sort(),
      );
      expect(report.readyForBoundedAttempt).toBe(blockers.length === 0);
    },
  );

  it('blocks when the local Docker daemon is unobservable', async () => {
    const report = await createFixture({
      daemon: { state: 'unobservable' },
    }).inspector.inspect(INPUT);

    expect(report.blockers).toEqual(['DOCKER_DAEMON_UNOBSERVABLE']);
  });

  it.each([
    [[{ state: 'unobservable' }], ['IMAGE_NOT_OBSERVED_LOCAL'], 'unobservable'],
    [
      [imageObservation({ id: OTHER_IMAGE_ID })],
      ['IMAGE_ID_MISMATCH'],
      'observed',
    ],
    [
      [imageObservation({ operatingSystem: 'darwin', architecture: 'arm64' })],
      ['IMAGE_PLATFORM_UNSUPPORTED'],
      'observed',
    ],
  ])(
    'classifies absent, mismatched, and unsupported local images',
    async (imageSequence, blockers, state) => {
      const report = await createFixture({
        imageSequence,
      }).inspector.inspect(INPUT);

      expect(report.observations.image.initial.state).toBe(state);
      expect(report.blockers).toEqual(blockers);
      expect(report.readyForBoundedAttempt).toBe(false);
    },
  );

  it('blocks when the selected image changes during assessment', async () => {
    const changedRootfs = {
      algorithm: 'sha256',
      value: sha256Base64Url('changed local image rootfs'),
    };
    const report = await createFixture({
      imageSequence: [
        imageObservation(),
        imageObservation({ rootfsDigest: changedRootfs }),
      ],
    }).inspector.inspect(INPUT);

    expect(report.observations.image.stable).toBe(false);
    expect(report.blockers).toEqual(['IMAGE_CHANGED_DURING_ASSESSMENT']);
  });

  it.each([
    ['absent', [], []],
    ['running-owned', ['CONCURRENT_PROOF_RUNNING'], []],
    ['stopped-owned-reconcilable', [], ['OWNED_STOPPED_RESIDUE_RECONCILABLE']],
    ['foreign', ['FOREIGN_CONTAINER_NAME_COLLISION'], []],
    ['unobservable', ['CONTAINER_COLLISION_UNOBSERVABLE'], []],
  ])(
    'classifies %s deterministic container-name state without mutation',
    async (collisionClass, blockers, extraAdvisories) => {
      const report = await createFixture({
        container: containerObservation(collisionClass),
      }).inspector.inspect(INPUT);

      expect(report.blockers).toEqual(blockers);
      expect(report.advisories).toEqual(
        [...DEFAULT_ADVISORIES, ...extraAdvisories].sort(),
      );
      expect(report.readyForBoundedAttempt).toBe(blockers.length === 0);
    },
  );

  it.each([
    [{ hostTemp: { state: 'unsafe' } }, ['HOST_TEMP_PATH_UNSAFE']],
    [
      { hostTemp: { state: 'unobservable' } },
      ['HOST_TEMP_FILESYSTEM_UNOBSERVABLE'],
    ],
    [
      { hostTemp: hostTempObservation({ writable: false }) },
      ['HOST_TEMP_NOT_WRITABLE'],
    ],
    [{ output: { state: 'unsafe' } }, ['OUTPUT_PATH_UNSAFE']],
    [{ output: { state: 'unobservable' } }, ['OUTPUT_FILESYSTEM_UNOBSERVABLE']],
    [
      { output: outputObservation({ writable: false }) },
      ['OUTPUT_PARENT_NOT_WRITABLE'],
    ],
    [
      { output: outputObservation({ proofCommitPath: 'present' }) },
      ['OUTPUT_COMMIT_COLLISION'],
    ],
  ])(
    'fails closed on unsafe, unobservable, unwritable, or colliding host/output state',
    async (options, blockers) => {
      const report = await createFixture(options).inspector.inspect(INPUT);

      expect(report.blockers).toEqual(blockers);
      expect(report.readyForBoundedAttempt).toBe(false);
    },
  );

  it('reports that an absent safe output root will be created by a later proof', async () => {
    const report = await createFixture({
      output: outputObservation({ rootState: 'absent' }),
    }).inspector.inspect(INPUT);

    expect(report.readyForBoundedAttempt).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.advisories).toEqual(
      [...DEFAULT_ADVISORIES, 'OUTPUT_ROOT_WILL_BE_CREATED'].sort(),
    );
  });

  it('assesses distinct host and output filesystem capacity independently', async () => {
    const report = await createFixture({
      hostTemp: hostTempObservation({
        availableBytes: String(160 * MIB - 1),
      }),
      output: outputObservation({
        availableBytes: String(2 * MIB - 1),
      }),
    }).inspector.inspect(INPUT);

    expect(report.observations.filesystemTopology).toBe('distinct');
    expect(report.blockers).toEqual([
      'HOST_TEMP_SPACE_INSUFFICIENT',
      'OUTPUT_SPACE_INSUFFICIENT',
    ]);
  });

  it('uses the combined minimum budget when host temp and output share a filesystem', async () => {
    const insufficient = await createFixture({
      hostTemp: hostTempObservation({
        device: '303',
        availableBytes: String(162 * MIB - 1),
      }),
      output: outputObservation({
        device: '303',
        availableBytes: String(162 * MIB - 1),
      }),
    }).inspector.inspect(INPUT);
    expect(insufficient.observations.filesystemTopology).toBe('shared');
    expect(insufficient.blockers).toEqual([
      'SHARED_HOST_FILESYSTEM_SPACE_INSUFFICIENT',
    ]);

    const exactBoundary = await createFixture({
      hostTemp: hostTempObservation({
        device: '303',
        availableBytes: String(162 * MIB),
      }),
      output: outputObservation({
        device: '303',
        availableBytes: String(162 * MIB),
      }),
    }).inspector.inspect(INPUT);
    expect(exactBoundary.readyForBoundedAttempt).toBe(true);
    expect(exactBoundary.blockers).toEqual([]);
  });

  it('publishes unique sorted blocker and advisory decisions', async () => {
    const report = await createFixture({
      repositorySequence: [repositoryObservation({ worktree: 'dirty' })],
      daemon: daemonObservation({
        operatingSystem: 'darwin',
        architecture: 'riscv64',
        cpuCount: 2,
        memoryBytes: '1',
      }),
      imageSequence: [
        imageObservation({
          id: OTHER_IMAGE_ID,
          operatingSystem: 'darwin',
          architecture: 'arm64',
        }),
      ],
      container: containerObservation('running-owned'),
      hostTemp: hostTempObservation({
        writable: false,
        availableBytes: '1',
      }),
      output: outputObservation({
        writable: false,
        proofCommitPath: 'present',
        availableBytes: '1',
      }),
    }).inspector.inspect(INPUT);

    expect(report.blockers).toEqual([...new Set(report.blockers)].sort());
    expect(report.advisories).toEqual([...new Set(report.advisories)].sort());
    expect(report.blockers).toEqual([
      'CONCURRENT_PROOF_RUNNING',
      'DOCKER_DAEMON_ARCHITECTURE_UNSUPPORTED',
      'DOCKER_DAEMON_MEMORY_INSUFFICIENT',
      'DOCKER_DAEMON_OS_UNSUPPORTED',
      'HOST_TEMP_NOT_WRITABLE',
      'HOST_TEMP_SPACE_INSUFFICIENT',
      'IMAGE_ID_MISMATCH',
      'IMAGE_PLATFORM_UNSUPPORTED',
      'OUTPUT_COMMIT_COLLISION',
      'OUTPUT_PARENT_NOT_WRITABLE',
      'OUTPUT_SPACE_INSUFFICIENT',
      'REPOSITORY_DIRTY',
    ]);
    expect(report.advisories).toEqual([
      'DAEMON_CPU_BELOW_REQUESTED_CAP',
      ...DEFAULT_ADVISORIES,
    ]);
  });

  it('returns a path-free, secret-free report that exposes only an output-root digest', async () => {
    const secretOutputRoot =
      '/private/tmp/AWS_SECRET_ACCESS_KEY_AKIAIOSFODNN7EXAMPLE';
    const fixture = createFixture();
    const report = await fixture.inspector.inspect({
      imageId: IMAGE_ID,
      outputRoot: secretOutputRoot,
    });
    const encoded = JSON.stringify(report);

    expect(report.subject.outputRootDigest).toEqual({
      algorithm: 'sha256',
      value: sha256Base64Url(secretOutputRoot),
    });
    expect(encoded).not.toContain(secretOutputRoot);
    expect(encoded).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(encoded).not.toContain('/private/tmp');
    expect(() =>
      assertManifestIsSecretFree(report, 'readiness test report'),
    ).not.toThrow();
    expectDeepFrozen(report);
  });

  it('snapshots semantic port results and rejects accessor-backed results without invoking them', async () => {
    let accessorInvoked = false;
    const repository = { ...repositoryObservation() };
    Object.defineProperty(repository, 'commit', {
      enumerable: true,
      get() {
        accessorInvoked = true;
        return SOURCE_COMMIT;
      },
    });
    const fixture = createFixture({
      repositorySequence: [repository],
    });

    await expect(fixture.inspector.inspect(INPUT)).rejects.toThrow();
    expect(accessorInvoked).toBe(false);
    expect(
      fixture.calls.some(
        ({ operation }) => operation === 'observeDockerEndpoint',
      ),
    ).toBe(false);
  });

  it('uses fixed repository tooling path order including the readiness core and CLI', () => {
    expect(
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_TOOLING_PATHS,
    ).toEqual([
      'scripts/run-aws-host-retained-storage-host-preflight-sea-linux-docker.js',
      'scripts/verify-aws-host-retained-storage-host-preflight-sea-linux.js',
      'scripts/aws-host-retained-storage-host-preflight-sea-linux-proof.js',
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_CORE_PATH,
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_CLI_PATH,
    ]);
    expect(
      Object.isFrozen(
        AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_TOOLING_PATHS,
      ),
    ).toBe(true);
  });
});
