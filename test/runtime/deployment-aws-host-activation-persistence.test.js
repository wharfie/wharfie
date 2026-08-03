import { execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeAll, describe, expect, it } from '@jest/globals';

import { sortCanonicalJsonValue } from '../../src/core/runtime/canonical-order.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_KIND,
  AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_KIND,
  AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_ACTIVATION_STEP_KINDS,
  createAwsSingleNodeHostActivationKernel,
  getAwsSingleNodeHostActivationIntentId,
  validateAwsSingleNodeHostActivationFence,
  validateAwsSingleNodeHostActivationState,
} from '../../src/core/runtime/deployment-aws-host-activation.js';
import {
  AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
  createAwsSingleNodeHostActivationRequest,
  validateAwsSingleNodeHostActivationRequest,
} from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import {
  AWS_SINGLE_NODE_HOST_ACTIVATION_MAX_STATE_DIRECTORY_ENTRIES,
  AwsSingleNodeHostActivationPersistenceCloseError,
  AwsSingleNodeHostActivationPersistenceClosedError,
  AwsSingleNodeHostActivationPersistenceCorruptError,
  AwsSingleNodeHostActivationPersistenceInitializationError,
  AwsSingleNodeHostActivationPersistenceLockBusyError,
  AwsSingleNodeHostActivationPersistenceOperationError,
  createAwsSingleNodeHostActivationPersistence,
} from '../../src/core/runtime/deployment-aws-host-activation-persistence.js';
import {
  advanceAwsSingleNodeHostRetainedStorageFormatJournal,
  createAwsSingleNodeHostRetainedStorageAdoptedFormatJournal,
  createAwsSingleNodeHostRetainedStorageBlankFormatProof,
  createAwsSingleNodeHostRetainedStorageExactProfileFormatProof,
  createAwsSingleNodeHostRetainedStoragePreparedFormatJournal,
  getAwsSingleNodeHostRetainedStorageFormatTarget,
  getAwsSingleNodeHostRetainedStorageProfileMarkerId,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_FEATURES,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_LABEL,
} from '../../src/core/runtime/deployment-aws-host-retained-storage-format-journal.js';
import {
  AWS_SINGLE_NODE_HOST_APPLICATION_STORAGE_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EVIDENCE_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
  createAwsSingleNodeHostApplicationStorageAdapter,
  createAwsSingleNodeHostControlStorageAdapter,
} from '../../src/core/runtime/deployment-aws-host-retained-storage.js';
import { getAwsSingleNodeHostRetainedStorageByIdPath } from '../../src/core/runtime/deployment-aws-host-retained-storage-projection.js';
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
} from '../../src/core/runtime/deployment-aws-host-runtime-identity.js';
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID,
} from '../../src/core/runtime/deployment-aws-host-runtime-account.js';
import {
  LinuxAbstractOperationLockBusyError,
  acquireLinuxAbstractOperationLock,
} from '../../src/core/runtime/linux-abstract-operation-lock.js';
import {
  clone,
  expectDeepFrozen,
  makeFixture,
} from './fixtures/deployment-aws-host-activation.js';

/** @typedef {Record<string, any>} AnyRecord */

const execFileAsync = promisify(execFile);
const CHILD_FIXTURE_PATH = fileURLToPath(
  new URL(
    './fixtures/deployment-aws-host-activation-persistence-child.js',
    import.meta.url,
  ),
);
const itPosix = process.platform === 'win32' ? it.skip : it;
const itLinux = process.platform === 'linux' ? it : it.skip;
/** @type {Readonly<AnyRecord>} */
let baseRequest;
/** @type {Readonly<AnyRecord>} */
let applicationStorageDesired;
/** @type {Readonly<AnyRecord>} */
let controlStorageDesired;
/** @type {string[]} */
const temporaryDirectories = [];

beforeAll(async () => {
  const fixture = makeFixture();
  baseRequest = createAwsSingleNodeHostActivationRequest(
    fixture.requestContext,
  );
  applicationStorageDesired =
    await captureApplicationStorageDesired(baseRequest);
  const applicationEvidence = createApplicationStorageEvidence(
    applicationStorageDesired,
  );
  controlStorageDesired = await captureControlStorageDesired(
    baseRequest,
    applicationEvidence,
  );
});

afterEach(async () => {
  const directories = temporaryDirectories.splice(
    0,
    temporaryDirectories.length,
  );
  await Promise.all(
    directories.map((directory) =>
      fsp.rm(directory, { recursive: true, force: true }),
    ),
  );
});

/**
 * Model Linux abstract AF_UNIX bind ownership without asking macOS to support
 * Linux's leading-NUL address namespace.
 * @returns {{createServer: typeof import('node:net').createServer, boundCount: () => number}}
 */
function createAbstractServerRegistry() {
  /** @type {Map<string, FakeServer>} */
  const owners = new Map();

  class FakeServer extends EventEmitter {
    constructor() {
      super();
      this.listening = false;
      this.boundAddress = null;
      this.unreferenced = false;
    }

    /** @param {string} address @returns {FakeServer} */
    listen(address) {
      queueMicrotask(() => {
        if (owners.has(address)) {
          const error = new Error('simulated abstract address collision');
          Object.defineProperty(error, 'code', {
            value: 'EADDRINUSE',
            enumerable: true,
          });
          this.emit('error', error);
          return;
        }
        owners.set(address, this);
        this.boundAddress = address;
        this.listening = true;
        this.emit('listening');
      });
      return this;
    }

    /** @param {(error?: Error) => void} [callback] @returns {FakeServer} */
    close(callback) {
      if (!this.listening || this.boundAddress === null) {
        const error = new Error('simulated server is not running');
        Object.defineProperty(error, 'code', {
          value: 'ERR_SERVER_NOT_RUNNING',
          enumerable: true,
        });
        throw error;
      }
      if (owners.get(this.boundAddress) === this) {
        owners.delete(this.boundAddress);
      }
      this.boundAddress = null;
      this.listening = false;
      queueMicrotask(() => callback?.());
      return this;
    }

    /** @returns {FakeServer} */
    unref() {
      this.unreferenced = true;
      return this;
    }
  }

  const createServer = /** @type {typeof import('node:net').createServer} */ (
    /** @type {unknown} */ (() => new FakeServer())
  );
  return {
    createServer,
    boundCount() {
      return owners.size;
    },
  };
}

/** @returns {Promise<{rootDirectory: string, stateDirectory: string}>} */
async function createStateDirectory() {
  const rootDirectory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-host-activation-persistence-'),
  );
  temporaryDirectories.push(rootDirectory);
  return {
    rootDirectory,
    stateDirectory: path.join(rootDirectory, 'deployment'),
  };
}

/** @returns {number} */
function currentUid() {
  if (typeof process.getuid !== 'function') {
    throw new Error('Focused persistence tests require a numeric process UID.');
  }
  return process.getuid();
}

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {Readonly<AnyRecord>} request @returns {Readonly<AnyRecord>} */
function runtimeIdentityEvidence(request) {
  return deepFreeze({
    schemaVersion:
      AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
    requestId: request.requestId,
    accountId: request.providerScope.accountId,
    userId: `${request.runtimeRoleId}:${request.nodeProviderResourceId}`,
    arn: `arn:${request.providerScope.partition}:sts::${request.providerScope.accountId}:assumed-role/${request.runtimeRoleName}/${request.nodeProviderResourceId}`,
  });
}

/** @param {Readonly<AnyRecord>} request @returns {Promise<Readonly<AnyRecord>>} */
async function captureApplicationStorageDesired(request) {
  /** @type {Readonly<AnyRecord>|undefined} */
  let captured;
  const adapter = createAwsSingleNodeHostApplicationStorageAdapter({
    command: {
      inspect(/** @type {Readonly<AnyRecord>} */ desired) {
        captured = desired;
        return { status: 'ready' };
      },
      converge() {
        throw new Error('desired capture must not converge');
      },
    },
  });
  await adapter.observe(
    deepFreeze({
      request,
      step: {
        intentId: getAwsSingleNodeHostActivationIntentId(
          request,
          'application-storage',
        ),
        kind: 'application-storage',
        attemptGeneration: 0,
      },
      priorEvidence: {
        'runtime-identity': runtimeIdentityEvidence(request),
      },
    }),
  );
  if (captured === undefined) {
    throw new Error('application storage desired state was not captured');
  }
  return captured;
}

/** @param {Readonly<AnyRecord>} desired @returns {Readonly<AnyRecord>} */
function createApplicationStorageEvidence(desired) {
  const device = {
    nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
    nvmeSerialVolumeId: desired.volumeProviderResourceId,
    path: '/dev/nvme1n1',
    major: 259,
    minor: 1,
  };
  return deepFreeze(
    sortCanonicalJsonValue({
      ...desired,
      schemaVersion:
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EVIDENCE_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_APPLICATION_STORAGE_EVIDENCE_KIND,
      device,
      mount: {
        ...desired.mount,
        sourcePath: device.path,
        mounted: true,
      },
    }),
  );
}

/**
 * @param {Readonly<AnyRecord>} request
 * @param {Readonly<AnyRecord>} applicationEvidence
 * @returns {Promise<Readonly<AnyRecord>>}
 */
async function captureControlStorageDesired(request, applicationEvidence) {
  /** @type {Readonly<AnyRecord>|undefined} */
  let captured;
  const adapter = createAwsSingleNodeHostControlStorageAdapter({
    command: {
      inspect(/** @type {Readonly<AnyRecord>} */ desired) {
        captured = desired;
        return { status: 'ready' };
      },
      converge() {
        throw new Error('desired capture must not converge');
      },
    },
  });
  await adapter.observe(
    deepFreeze({
      request,
      step: {
        intentId: getAwsSingleNodeHostActivationIntentId(
          request,
          'control-storage',
        ),
        kind: 'control-storage',
        attemptGeneration: 0,
      },
      priorEvidence: {
        'runtime-identity': runtimeIdentityEvidence(request),
        'application-storage': applicationEvidence,
      },
    }),
  );
  if (captured === undefined) {
    throw new Error('control storage desired state was not captured');
  }
  return captured;
}

/** @param {Readonly<AnyRecord>} desired @returns {Readonly<AnyRecord>} */
function formatProofDevice(desired) {
  const controller = desired.capabilityKind === 'application-state' ? 1 : 2;
  return deepFreeze({
    path: `/dev/nvme${controller}n1`,
    major: 259,
    minor: controller,
    nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
    nvmeSerialVolumeId: desired.volumeProviderResourceId,
    byIdPath: getAwsSingleNodeHostRetainedStorageByIdPath(
      desired.volumeProviderResourceId,
    ),
    byIdTarget: `../../nvme${controller}n1`,
  });
}

/** @param {Readonly<AnyRecord>} desired @returns {Readonly<AnyRecord>} */
function exactFormatProfile(desired) {
  const target = getAwsSingleNodeHostRetainedStorageFormatTarget(desired);
  return deepFreeze({
    profileId: 'wharfie-ext4-v1',
    markerId: getAwsSingleNodeHostRetainedStorageProfileMarkerId(target),
    filesystem: {
      type: 'ext4',
      uuid: target.filesystem.uuid,
      label: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_LABEL,
      blockSizeBytes: 4096,
      inodeSizeBytes: 256,
      reservedBlockCount: 0,
      creatorOs: 'Linux',
      revision: 'dynamic',
      errorsBehavior: 'remount-ro',
      defaultMountOptions: [],
      directoryHashAlgorithm: 'half_md4',
      directoryHashSeed: target.filesystem.uuid,
      features: [...AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_FEATURES],
    },
    journal: {
      kind: 'internal',
      inode: 8,
      sizeBytes: 134_217_728,
    },
    root: {
      inode: 2,
      type: 'directory',
      uid: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID,
      gid: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID,
      mode: 0o700,
    },
    initialization: {
      filesystemState: 'clean',
      fullReadOnlyCheck: 'clean',
      completionMarkerXattr: 'trusted.wharfie.profile',
    },
  });
}

/** @param {Readonly<AnyRecord>} desired @returns {Readonly<AnyRecord>} */
function createBlankFormatProof(desired) {
  return createAwsSingleNodeHostRetainedStorageBlankFormatProof({
    desired,
    device: formatProofDevice(desired),
    mountNamespace: 'mnt:[4026531841]',
  });
}

/** @param {Readonly<AnyRecord>} desired @returns {Readonly<AnyRecord>} */
function createExactProfileFormatProof(desired) {
  return createAwsSingleNodeHostRetainedStorageExactProfileFormatProof({
    desired,
    device: formatProofDevice(desired),
    mountNamespace: 'mnt:[4026531841]',
    profile: exactFormatProfile(desired),
  });
}

/**
 * @param {Readonly<AnyRecord>} request
 * @param {Readonly<AnyRecord>} desired
 * @returns {string}
 */
function retainedStorageIntentId(request, desired) {
  return getAwsSingleNodeHostActivationIntentId(
    request,
    desired.capabilityKind === 'application-state'
      ? 'application-storage'
      : 'control-storage',
  );
}

/**
 * @param {Readonly<AnyRecord>} request
 * @param {Readonly<AnyRecord>} desired
 * @returns {Readonly<AnyRecord>}
 */
function createPreparedFormatJournal(request, desired) {
  return createAwsSingleNodeHostRetainedStoragePreparedFormatJournal({
    desired,
    intentId: retainedStorageIntentId(request, desired),
    attemptGeneration: 0,
    blankProof: createBlankFormatProof(desired),
  });
}

/**
 * @param {Readonly<AnyRecord>} request
 * @param {Readonly<AnyRecord>} desired
 * @returns {Readonly<AnyRecord>}
 */
function createAdoptedFormatJournal(request, desired) {
  return createAwsSingleNodeHostRetainedStorageAdoptedFormatJournal({
    desired,
    intentId: retainedStorageIntentId(request, desired),
    attemptGeneration: 0,
    profileProof: createExactProfileFormatProof(desired),
  });
}

/**
 * @param {Readonly<AnyRecord>} request
 * @param {number} generation
 * @param {string} [variant]
 * @returns {Readonly<AnyRecord>}
 */
function makeRequest(request, generation, variant = 'default') {
  const payload = /** @type {AnyRecord} */ (clone(request));
  delete payload.requestId;
  payload.authorizedHeadGeneration = generation;
  payload.artifact.versionId = `artifact-version-${generation}-${variant}`;
  const canonicalPayload = sortCanonicalJsonValue(payload);
  return validateAwsSingleNodeHostActivationRequest({
    ...canonicalPayload,
    requestId: createCanonicalJsonSha256Id({
      domain: AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_DOMAIN,
      prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
      value: canonicalPayload,
    }),
  });
}

/**
 * @param {Readonly<AnyRecord>} request
 * @param {number} [recordVersion]
 * @returns {Readonly<AnyRecord>}
 */
function makeState(request, recordVersion = 1) {
  const payload = sortCanonicalJsonValue({
    schemaVersion: AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_KIND,
    request,
    recordVersion,
    status: 'running',
    steps: AWS_SINGLE_NODE_HOST_ACTIVATION_STEP_KINDS.map((kind) => ({
      intentId: getAwsSingleNodeHostActivationIntentId(request, kind),
      kind,
      status: 'pending',
      attemptGeneration: 0,
      evidence: null,
    })),
    block: null,
    receipt: null,
  });
  return validateAwsSingleNodeHostActivationState({
    ...payload,
    stateId: createCanonicalJsonSha256Id({
      domain: AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_DOMAIN,
      prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_PREFIX,
      value: payload,
    }),
  });
}

/**
 * @param {Readonly<AnyRecord>} request
 * @param {number} [recordVersion]
 * @returns {Readonly<AnyRecord>}
 */
function makeFence(request, recordVersion = 1) {
  const payload = sortCanonicalJsonValue({
    schemaVersion: AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_KIND,
    deploymentInstanceId: request.deploymentInstanceId,
    incarnationId: request.incarnationId,
    nodeProviderResourceId: request.nodeProviderResourceId,
    requestId: request.requestId,
    authorizedHeadGeneration: request.authorizedHeadGeneration,
    recordVersion,
  });
  return validateAwsSingleNodeHostActivationFence({
    ...payload,
    fenceId: createCanonicalJsonSha256Id({
      domain: AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_ID_DOMAIN,
      prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_ID_PREFIX,
      value: payload,
    }),
  });
}

/**
 * @param {{stateDirectory: string, registry?: ReturnType<typeof createAbstractServerRegistry>, retainedSupersededStates?: number, fsOps?: typeof fsp}} options
 * @returns {Promise<{persistence: Awaited<ReturnType<typeof createAwsSingleNodeHostActivationPersistence>>, registry: ReturnType<typeof createAbstractServerRegistry>, stateDirectory: string}>}
 */
async function createTestPersistence(options) {
  const { stateDirectory } = options;
  const registry = options.registry ?? createAbstractServerRegistry();
  let token = 0;
  const persistence = await createAwsSingleNodeHostActivationPersistence({
    deploymentInstanceId: baseRequest.deploymentInstanceId,
    stateDirectory,
    expectedUid: currentUid(),
    fsOps: options.fsOps ?? fsp,
    createServer: registry.createServer,
    createToken() {
      token += 1;
      return `test-token-${token}`;
    },
    retainedSupersededStates: options.retainedSupersededStates ?? 8,
  });
  return { persistence, registry, stateDirectory };
}

/**
 * @param {{registry?: ReturnType<typeof createAbstractServerRegistry>, retainedSupersededStates?: number, fsOps?: typeof fsp}} [options]
 * @returns {Promise<{persistence: Awaited<ReturnType<typeof createAwsSingleNodeHostActivationPersistence>>, registry: ReturnType<typeof createAbstractServerRegistry>, stateDirectory: string}>}
 */
async function openTestPersistence(options = {}) {
  const { stateDirectory } = await createStateDirectory();
  return createTestPersistence({ ...options, stateDirectory });
}

/** @returns {{promise: Promise<void>, resolve: () => void}} */
function deferred() {
  /** @type {() => void} */
  let settle = () => undefined;
  const promise = new Promise((resolve) => {
    settle = () => resolve(undefined);
  });
  return { promise, resolve: settle };
}

/**
 * @param {import('node:child_process').ChildProcessWithoutNullStreams} child
 * @param {string} expected
 * @returns {Promise<void>}
 */
function waitForChildOutput(child, expected) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Child did not emit '${expected}' before timeout.`));
    }, 3_000);
    /** @returns {void} */
    function cleanup() {
      clearTimeout(timeout);
      child.stdout.removeListener('data', onStdout);
      child.stderr.removeListener('data', onStderr);
      child.removeListener('exit', onExit);
    }
    /** @param {Buffer} chunk @returns {void} */
    function onStdout(chunk) {
      stdout += chunk.toString('utf8');
      if (stdout.includes(expected)) {
        cleanup();
        resolve(undefined);
      }
    }
    /** @param {Buffer} chunk @returns {void} */
    function onStderr(chunk) {
      stderr += chunk.toString('utf8');
    }
    /** @param {number|null} code @param {NodeJS.Signals|null} signal @returns {void} */
    function onExit(code, signal) {
      cleanup();
      reject(
        new Error(
          `Child exited before '${expected}' (code=${String(code)}, signal=${String(signal)}): ${stderr}`,
        ),
      );
    }
    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.once('exit', onExit);
  });
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @returns {Promise<{code: number|null, signal: NodeJS.Signals|null}>}
 */
function waitForChildExit(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Child did not exit before timeout.'));
    }, 3_000);
    /** @returns {void} */
    function cleanup() {
      clearTimeout(timeout);
      child.removeListener('exit', onExit);
    }
    /** @param {number|null} code @param {NodeJS.Signals|null} signal @returns {void} */
    function onExit(code, signal) {
      cleanup();
      resolve({ code, signal });
    }
    child.once('exit', onExit);
  });
}

/** @returns {Readonly<AnyRecord>} */
function createUnknownRuntimeSteps() {
  const runtimeIdentity = Object.freeze({
    async observe() {
      return Object.freeze({ status: 'unknown' });
    },
    validateEvidence(/** @type {unknown} */ value) {
      return value;
    },
  });
  const effectful = () =>
    Object.freeze({
      async observe() {
        return Object.freeze({ status: 'unknown' });
      },
      async converge() {
        throw new Error(
          'An effect must not run behind unknown runtime identity.',
        );
      },
      validateEvidence(/** @type {unknown} */ value) {
        return value;
      },
    });
  return Object.freeze({
    runtimeIdentity,
    applicationStorage: effectful(),
    controlStorage: effectful(),
    artifactProjection: effectful(),
    serviceConvergence: effectful(),
    healthPublication: effectful(),
  });
}

describe('Linux abstract operation lock', () => {
  it('atomically excludes the same domain and scope, then releases idempotently', async () => {
    const registry = createAbstractServerRegistry();
    const options = {
      domain: 'wharfie:test-operation-lock:v1',
      scope: 'deployment-1',
      createServer: registry.createServer,
    };
    const release = await acquireLinuxAbstractOperationLock(options);

    await expect(
      acquireLinuxAbstractOperationLock(options),
    ).rejects.toBeInstanceOf(LinuxAbstractOperationLockBusyError);
    expect(registry.boundCount()).toBe(1);

    const firstRelease = release();
    const secondRelease = release();
    expect(secondRelease).toBe(firstRelease);
    await firstRelease;
    expect(registry.boundCount()).toBe(0);

    const releaseAgain = await acquireLinuxAbstractOperationLock(options);
    expect(registry.boundCount()).toBe(1);
    await releaseAgain();
    expect(registry.boundCount()).toBe(0);
  });

  it('domain-separates and scope-separates otherwise identical locks', async () => {
    const registry = createAbstractServerRegistry();
    const releases = await Promise.all([
      acquireLinuxAbstractOperationLock({
        domain: 'wharfie:test-operation-lock:v1',
        scope: 'deployment-1',
        createServer: registry.createServer,
      }),
      acquireLinuxAbstractOperationLock({
        domain: 'wharfie:test-operation-lock:v1',
        scope: 'deployment-2',
        createServer: registry.createServer,
      }),
      acquireLinuxAbstractOperationLock({
        domain: 'wharfie:test-other-operation-lock:v1',
        scope: 'deployment-1',
        createServer: registry.createServer,
      }),
    ]);
    expect(registry.boundCount()).toBe(3);
    await Promise.all(releases.map((release) => release()));
    expect(registry.boundCount()).toBe(0);
  });

  itLinux(
    'releases a real Linux abstract lock when its owner is killed',
    async () => {
      const domain = 'wharfie:test-crash-release-lock:v1';
      const scope = `deployment-${process.pid}`;
      const child = spawn(
        process.execPath,
        [CHILD_FIXTURE_PATH, 'hold-real-lock', domain, scope],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      try {
        await waitForChildOutput(child, 'locked\n');
        const exited = waitForChildExit(child);
        expect(child.kill('SIGKILL')).toBe(true);
        await expect(exited).resolves.toEqual({
          code: null,
          signal: 'SIGKILL',
        });

        const release = await acquireLinuxAbstractOperationLock({
          domain,
          scope,
        });
        await release();
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }
    },
  );
});

describe('AWS single-node host activation persistence', () => {
  it('persists distinct application/control journals and only their legal CAS transitions', async () => {
    const { persistence, stateDirectory } = await openTestPersistence();
    const journalStore = persistence.retainedStorageFormatJournalStore;
    const applicationPrepared = createPreparedFormatJournal(
      baseRequest,
      applicationStorageDesired,
    );
    const applicationFormatted =
      advanceAwsSingleNodeHostRetainedStorageFormatJournal({
        journal: applicationPrepared,
        profileProof: createExactProfileFormatProof(applicationStorageDesired),
      });
    const controlAdopted = createAdoptedFormatJournal(
      baseRequest,
      controlStorageDesired,
    );
    const applicationTarget = getAwsSingleNodeHostRetainedStorageFormatTarget(
      applicationStorageDesired,
    );
    const controlTarget = getAwsSingleNodeHostRetainedStorageFormatTarget(
      controlStorageDesired,
    );

    expect(Object.isFrozen(journalStore)).toBe(true);
    expect(Object.keys(persistence.store).sort()).toEqual([
      'compareAndSetActivationFence',
      'compareAndSetActivationState',
      'readActivationFence',
      'readActivationState',
    ]);
    expect(applicationTarget.filesystem.uuid).not.toBe(
      controlTarget.filesystem.uuid,
    );

    await persistence.withHostLock(
      { deploymentInstanceId: baseRequest.deploymentInstanceId },
      async () => {
        await expect(
          journalStore.readRetainedStorageFormatJournal(
            applicationStorageDesired,
          ),
        ).resolves.toBeNull();
        await expect(
          journalStore.readRetainedStorageFormatJournal(controlStorageDesired),
        ).resolves.toBeNull();
        await expect(
          journalStore.compareAndSetRetainedStorageFormatJournal({
            desired: applicationStorageDesired,
            expectedJournalId: null,
            nextJournal: applicationPrepared,
          }),
        ).resolves.toBe(true);
        await expect(
          journalStore.compareAndSetRetainedStorageFormatJournal({
            desired: applicationStorageDesired,
            expectedJournalId: applicationPrepared.journalId,
            nextJournal: applicationPrepared,
          }),
        ).resolves.toBe(false);
        await expect(
          journalStore.compareAndSetRetainedStorageFormatJournal({
            desired: applicationStorageDesired,
            expectedJournalId: null,
            nextJournal: applicationFormatted,
          }),
        ).resolves.toBe(false);
        await expect(
          journalStore.compareAndSetRetainedStorageFormatJournal({
            desired: applicationStorageDesired,
            expectedJournalId: applicationPrepared.journalId,
            nextJournal: applicationFormatted,
          }),
        ).resolves.toBe(true);
        await expect(
          journalStore.compareAndSetRetainedStorageFormatJournal({
            desired: applicationStorageDesired,
            expectedJournalId: applicationFormatted.journalId,
            nextJournal: applicationFormatted,
          }),
        ).resolves.toBe(false);
        await expect(
          journalStore.compareAndSetRetainedStorageFormatJournal({
            desired: controlStorageDesired,
            expectedJournalId: null,
            nextJournal: controlAdopted,
          }),
        ).resolves.toBe(true);
        await expect(
          journalStore.readRetainedStorageFormatJournal(
            applicationStorageDesired,
          ),
        ).resolves.toEqual(applicationFormatted);
        await expect(
          journalStore.readRetainedStorageFormatJournal(controlStorageDesired),
        ).resolves.toEqual(controlAdopted);
      },
    );

    const formatDirectory = path.join(stateDirectory, 'format-journals');
    const applicationPath = path.join(
      formatDirectory,
      `${applicationTarget.filesystem.uuid}.json`,
    );
    const controlPath = path.join(
      formatDirectory,
      `${controlTarget.filesystem.uuid}.json`,
    );
    expect((await fsp.lstat(formatDirectory)).mode & 0o777).toBe(0o700);
    expect((await fsp.lstat(applicationPath)).mode & 0o777).toBe(0o600);
    expect((await fsp.lstat(controlPath)).mode & 0o777).toBe(0o600);
    expect(await fsp.readFile(applicationPath, 'utf8')).toBe(
      `${JSON.stringify(applicationFormatted)}\n`,
    );
    expect(await fsp.readFile(controlPath, 'utf8')).toBe(
      `${JSON.stringify(controlAdopted)}\n`,
    );
    await persistence.close();
  });

  it('requires live host-lock admission, rebinds request churn, and fails closed on target drift', async () => {
    const { persistence } = await openTestPersistence();
    const journalStore = persistence.retainedStorageFormatJournalStore;
    const prepared = createPreparedFormatJournal(
      baseRequest,
      applicationStorageDesired,
    );

    expect(() =>
      journalStore.readRetainedStorageFormatJournal(applicationStorageDesired),
    ).toThrow(AwsSingleNodeHostActivationPersistenceOperationError);
    expect(() =>
      journalStore.compareAndSetRetainedStorageFormatJournal({
        desired: applicationStorageDesired,
        expectedJournalId: null,
        nextJournal: prepared,
      }),
    ).toThrow(AwsSingleNodeHostActivationPersistenceOperationError);

    const churnRequest = makeRequest(baseRequest, 50, 'journal-churn');
    const churnDesired = await captureApplicationStorageDesired(churnRequest);
    expect(
      getAwsSingleNodeHostRetainedStorageFormatTarget(churnDesired),
    ).toEqual(
      getAwsSingleNodeHostRetainedStorageFormatTarget(
        applicationStorageDesired,
      ),
    );
    const driftedDesired = /** @type {AnyRecord} */ (clone(churnDesired));
    driftedDesired.sizeBytes += 1;

    await persistence.withHostLock(
      { deploymentInstanceId: baseRequest.deploymentInstanceId },
      async () => {
        await expect(
          journalStore.compareAndSetRetainedStorageFormatJournal({
            desired: applicationStorageDesired,
            expectedJournalId: null,
            nextJournal: prepared,
          }),
        ).resolves.toBe(true);
        await expect(
          journalStore.readRetainedStorageFormatJournal(churnDesired),
        ).resolves.toEqual(prepared);
        await expect(
          journalStore.readRetainedStorageFormatJournal(driftedDesired),
        ).rejects.toBeInstanceOf(
          AwsSingleNodeHostActivationPersistenceOperationError,
        );
      },
    );
    await persistence.close();
  });

  it('snapshots queued journal inputs before waiting for the transaction lock', async () => {
    let formatDirectory = '';
    /** @type {{entered: ReturnType<typeof deferred>, release: ReturnType<typeof deferred>}|null} */
    let journalScanGate = null;
    const gatedFs = Object.create(fsp);
    gatedFs.opendir = async (
      /** @type {import('node:fs').PathLike} */ target,
      /** @type {import('node:fs').OpenDirOptions|undefined} */ options,
    ) => {
      if (journalScanGate !== null && String(target) === formatDirectory) {
        const activeGate = journalScanGate;
        journalScanGate = null;
        activeGate.entered.resolve();
        await activeGate.release.promise;
      }
      return fsp.opendir(target, options);
    };
    const { persistence, stateDirectory } = await openTestPersistence({
      fsOps: gatedFs,
    });
    formatDirectory = path.join(stateDirectory, 'format-journals');
    const journalStore = persistence.retainedStorageFormatJournalStore;
    const prepared = createPreparedFormatJournal(
      baseRequest,
      applicationStorageDesired,
    );
    const formatted = advanceAwsSingleNodeHostRetainedStorageFormatJournal({
      journal: prepared,
      profileProof: createExactProfileFormatProof(applicationStorageDesired),
    });
    const controlAdopted = createAdoptedFormatJournal(
      baseRequest,
      controlStorageDesired,
    );

    await persistence.withHostLock(
      { deploymentInstanceId: baseRequest.deploymentInstanceId },
      async () => {
        await journalStore.compareAndSetRetainedStorageFormatJournal({
          desired: applicationStorageDesired,
          expectedJournalId: null,
          nextJournal: prepared,
        });

        const readGate = {
          entered: deferred(),
          release: deferred(),
        };
        journalScanGate = readGate;
        const blockingRead = journalStore.readRetainedStorageFormatJournal(
          controlStorageDesired,
        );
        await readGate.entered.promise;
        const mutableReadDesired = /** @type {AnyRecord} */ (
          clone(applicationStorageDesired)
        );
        const queuedRead =
          journalStore.readRetainedStorageFormatJournal(mutableReadDesired);
        mutableReadDesired.sizeBytes += 1;
        readGate.release.resolve();
        await expect(blockingRead).resolves.toBeNull();
        await expect(queuedRead).resolves.toEqual(prepared);

        const casGate = {
          entered: deferred(),
          release: deferred(),
        };
        journalScanGate = casGate;
        const secondBlockingRead =
          journalStore.readRetainedStorageFormatJournal(controlStorageDesired);
        await casGate.entered.promise;
        const casInput = {
          desired: clone(applicationStorageDesired),
          expectedJournalId: prepared.journalId,
          nextJournal: clone(formatted),
        };
        const queuedCas =
          journalStore.compareAndSetRetainedStorageFormatJournal(casInput);
        casInput.desired = clone(controlStorageDesired);
        casInput.expectedJournalId = null;
        casInput.nextJournal = clone(controlAdopted);
        casGate.release.resolve();
        await expect(secondBlockingRead).resolves.toBeNull();
        await expect(queuedCas).resolves.toBe(true);
        await expect(
          journalStore.readRetainedStorageFormatJournal(
            applicationStorageDesired,
          ),
        ).resolves.toEqual(formatted);
        await expect(
          journalStore.readRetainedStorageFormatJournal(controlStorageDesired),
        ).resolves.toBeNull();
      },
    );
    await persistence.close();
  });

  it('reopens durable journals and removes only exact stale journal temporaries', async () => {
    const { stateDirectory } = await createStateDirectory();
    const registry = createAbstractServerRegistry();
    const first = (await createTestPersistence({ stateDirectory, registry }))
      .persistence;
    const prepared = createPreparedFormatJournal(
      baseRequest,
      applicationStorageDesired,
    );
    const target = getAwsSingleNodeHostRetainedStorageFormatTarget(
      applicationStorageDesired,
    );
    await first.withHostLock(
      { deploymentInstanceId: baseRequest.deploymentInstanceId },
      async () => {
        await expect(
          first.retainedStorageFormatJournalStore.compareAndSetRetainedStorageFormatJournal(
            {
              desired: applicationStorageDesired,
              expectedJournalId: null,
              nextJournal: prepared,
            },
          ),
        ).resolves.toBe(true);
      },
    );
    await first.close();

    const temporaryPath = path.join(
      stateDirectory,
      'format-journals',
      `.format-journal.${target.filesystem.uuid}.stale-token.tmp`,
    );
    await fsp.writeFile(temporaryPath, 'stale\n', {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });

    const reopened = (await createTestPersistence({ stateDirectory, registry }))
      .persistence;
    await expect(fsp.lstat(temporaryPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await reopened.withHostLock(
      { deploymentInstanceId: baseRequest.deploymentInstanceId },
      async () => {
        await expect(
          reopened.retainedStorageFormatJournalStore.readRetainedStorageFormatJournal(
            applicationStorageDesired,
          ),
        ).resolves.toEqual(prepared);
      },
    );
    await reopened.close();
  });

  it('makes a response-lost journal publication discoverable without claiming the retry won', async () => {
    let loseResponseFor = '';
    const responseLosingFs = Object.create(fsp);
    responseLosingFs.rename = async (
      /** @type {import('node:fs').PathLike} */ source,
      /** @type {import('node:fs').PathLike} */ destination,
    ) => {
      await fsp.rename(source, destination);
      if (String(destination).endsWith(loseResponseFor)) {
        loseResponseFor = '';
        throw new Error('simulated response loss after journal rename');
      }
    };
    const { persistence } = await openTestPersistence({
      fsOps: responseLosingFs,
    });
    const prepared = createPreparedFormatJournal(
      baseRequest,
      applicationStorageDesired,
    );
    const target = getAwsSingleNodeHostRetainedStorageFormatTarget(
      applicationStorageDesired,
    );

    await persistence.withHostLock(
      { deploymentInstanceId: baseRequest.deploymentInstanceId },
      async () => {
        loseResponseFor = `${target.filesystem.uuid}.json`;
        await expect(
          persistence.retainedStorageFormatJournalStore.compareAndSetRetainedStorageFormatJournal(
            {
              desired: applicationStorageDesired,
              expectedJournalId: null,
              nextJournal: prepared,
            },
          ),
        ).rejects.toBeInstanceOf(
          AwsSingleNodeHostActivationPersistenceOperationError,
        );
        await expect(
          persistence.retainedStorageFormatJournalStore.readRetainedStorageFormatJournal(
            applicationStorageDesired,
          ),
        ).resolves.toEqual(prepared);
        await expect(
          persistence.retainedStorageFormatJournalStore.compareAndSetRetainedStorageFormatJournal(
            {
              desired: applicationStorageDesired,
              expectedJournalId: null,
              nextJournal: prepared,
            },
          ),
        ).resolves.toBe(false);
      },
    );
    await persistence.close();
  });

  it.each([
    'unknown-entry',
    'symlink',
    'hard-link',
    'group-writable',
    'oversized',
    'noncanonical',
    'cross-key',
  ])('rejects %s corruption in the format-journal namespace', async (kind) => {
    const { persistence, stateDirectory, registry } =
      await openTestPersistence();
    const prepared = createPreparedFormatJournal(
      baseRequest,
      applicationStorageDesired,
    );
    const applicationTarget = getAwsSingleNodeHostRetainedStorageFormatTarget(
      applicationStorageDesired,
    );
    const controlTarget = getAwsSingleNodeHostRetainedStorageFormatTarget(
      controlStorageDesired,
    );
    await persistence.withHostLock(
      { deploymentInstanceId: baseRequest.deploymentInstanceId },
      async () => {
        await persistence.retainedStorageFormatJournalStore.compareAndSetRetainedStorageFormatJournal(
          {
            desired: applicationStorageDesired,
            expectedJournalId: null,
            nextJournal: prepared,
          },
        );
      },
    );
    await persistence.close();

    const formatDirectory = path.join(stateDirectory, 'format-journals');
    const journalPath = path.join(
      formatDirectory,
      `${applicationTarget.filesystem.uuid}.json`,
    );
    if (kind === 'unknown-entry') {
      await fsp.writeFile(path.join(formatDirectory, 'unexpected'), 'x\n', {
        mode: 0o600,
      });
    } else if (kind === 'symlink') {
      const targetPath = path.join(
        path.dirname(stateDirectory),
        'journal-target',
      );
      await fsp.rename(journalPath, targetPath);
      await fsp.symlink(targetPath, journalPath);
    } else if (kind === 'hard-link') {
      await fsp.link(
        journalPath,
        path.join(path.dirname(stateDirectory), 'journal-hard-link'),
      );
    } else if (kind === 'group-writable') {
      await fsp.chmod(journalPath, 0o620);
    } else if (kind === 'oversized') {
      await fsp.writeFile(journalPath, 'x'.repeat(40 * 1024), 'utf8');
    } else if (kind === 'noncanonical') {
      await fsp.writeFile(journalPath, JSON.stringify(prepared), 'utf8');
    } else {
      await fsp.rename(
        journalPath,
        path.join(formatDirectory, `${controlTarget.filesystem.uuid}.json`),
      );
    }

    await expect(
      createTestPersistence({ stateDirectory, registry }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeHostActivationPersistenceCorruptError,
    );
  });

  it('implements exact state and fence CAS with durable readback', async () => {
    const { persistence } = await openTestPersistence();
    const firstRequest = makeRequest(baseRequest, 10);
    const firstState = makeState(firstRequest);
    const firstStateSuccessor = makeState(firstRequest, 2);
    const unrelatedExpectedState = makeState(firstRequest, 7);

    expect(
      await persistence.store.compareAndSetActivationState({
        requestId: firstRequest.requestId,
        expectedStateId: null,
        nextState: firstState,
      }),
    ).toBe(true);
    expect(
      await persistence.store.compareAndSetActivationState({
        requestId: firstRequest.requestId,
        expectedStateId: null,
        nextState: firstState,
      }),
    ).toBe(false);
    expect(
      await persistence.store.compareAndSetActivationState({
        requestId: firstRequest.requestId,
        expectedStateId: unrelatedExpectedState.stateId,
        nextState: firstStateSuccessor,
      }),
    ).toBe(false);
    expect(
      await persistence.store.compareAndSetActivationState({
        requestId: firstRequest.requestId,
        expectedStateId: firstState.stateId,
        nextState: firstStateSuccessor,
      }),
    ).toBe(true);
    expect(
      await persistence.store.compareAndSetActivationState({
        requestId: firstRequest.requestId,
        expectedStateId: firstState.stateId,
        nextState: firstStateSuccessor,
      }),
    ).toBe(false);
    expect(
      await persistence.store.readActivationState(firstRequest.requestId),
    ).toEqual(firstStateSuccessor);

    const firstFence = makeFence(firstRequest);
    expect(
      await persistence.store.compareAndSetActivationFence({
        deploymentInstanceId: firstRequest.deploymentInstanceId,
        expectedFenceId: null,
        nextFence: firstFence,
      }),
    ).toBe(true);
    expect(
      await persistence.store.compareAndSetActivationFence({
        deploymentInstanceId: firstRequest.deploymentInstanceId,
        expectedFenceId: null,
        nextFence: firstFence,
      }),
    ).toBe(false);
    expect(
      await persistence.store.readActivationFence(
        firstRequest.deploymentInstanceId,
      ),
    ).toEqual(firstFence);

    const secondRequest = makeRequest(baseRequest, 11);
    const secondState = makeState(secondRequest);
    const secondFence = makeFence(secondRequest, 2);
    await persistence.store.compareAndSetActivationState({
      requestId: secondRequest.requestId,
      expectedStateId: null,
      nextState: secondState,
    });
    expect(
      await persistence.store.compareAndSetActivationFence({
        deploymentInstanceId: secondRequest.deploymentInstanceId,
        expectedFenceId: firstFence.fenceId,
        nextFence: secondFence,
      }),
    ).toBe(true);
    expect(
      await persistence.store.compareAndSetActivationFence({
        deploymentInstanceId: secondRequest.deploymentInstanceId,
        expectedFenceId: firstFence.fenceId,
        nextFence: secondFence,
      }),
    ).toBe(false);
    expect(
      await persistence.store.readActivationFence(
        secondRequest.deploymentInstanceId,
      ),
    ).toEqual(secondFence);

    await persistence.close();
  });

  it.each(['symlink', 'group-writable'])(
    'writes a private canonical envelope and rejects a %s state record on reopen',
    async (corruption) => {
      const { persistence, stateDirectory, registry } =
        await openTestPersistence();
      const request = makeRequest(baseRequest, 19, corruption);
      const state = makeState(request);
      expect(
        await persistence.store.compareAndSetActivationState({
          requestId: request.requestId,
          expectedStateId: null,
          nextState: state,
        }),
      ).toBe(true);
      expect(
        await persistence.store.compareAndSetActivationFence({
          deploymentInstanceId: request.deploymentInstanceId,
          expectedFenceId: null,
          nextFence: makeFence(request),
        }),
      ).toBe(true);
      const statePath = path.join(
        stateDirectory,
        'states',
        `${request.requestId}.json`,
      );
      const statesDirectory = path.dirname(statePath);
      const fencePath = path.join(stateDirectory, 'fence.json');
      expect((await fsp.lstat(stateDirectory)).mode & 0o777).toBe(0o700);
      expect((await fsp.lstat(stateDirectory)).isDirectory()).toBe(true);
      expect((await fsp.lstat(statesDirectory)).mode & 0o777).toBe(0o700);
      expect((await fsp.lstat(statesDirectory)).isDirectory()).toBe(true);
      expect((await fsp.lstat(statePath)).mode & 0o777).toBe(0o600);
      expect((await fsp.lstat(statePath)).isFile()).toBe(true);
      expect((await fsp.lstat(fencePath)).mode & 0o777).toBe(0o600);
      expect((await fsp.lstat(fencePath)).isFile()).toBe(true);
      await persistence.close();

      if (corruption === 'symlink') {
        const target = path.join(path.dirname(stateDirectory), 'state-target');
        await fsp.rename(statePath, target);
        await fsp.symlink(target, statePath);
      } else {
        await fsp.chmod(statePath, 0o620);
      }
      await expect(
        createTestPersistence({ stateDirectory, registry }),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeHostActivationPersistenceCorruptError,
      );
    },
  );

  it('makes an acknowledged filesystem publication discoverable after simulated response loss', async () => {
    let loseResponseFor = '';
    const responseLosingFs = Object.create(fsp);
    responseLosingFs.rename = async (
      /** @type {import('node:fs').PathLike} */ source,
      /** @type {import('node:fs').PathLike} */ destination,
    ) => {
      await fsp.rename(source, destination);
      if (String(destination).endsWith(loseResponseFor)) {
        loseResponseFor = '';
        throw new Error('simulated response loss after rename');
      }
    };
    const { persistence } = await openTestPersistence({
      fsOps: responseLosingFs,
    });
    const request = makeRequest(baseRequest, 20);
    const state = makeState(request);

    loseResponseFor = `${request.requestId}.json`;
    await expect(
      persistence.store.compareAndSetActivationState({
        requestId: request.requestId,
        expectedStateId: null,
        nextState: state,
      }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeHostActivationPersistenceOperationError,
    );
    expect(
      await persistence.store.readActivationState(request.requestId),
    ).toEqual(state);
    expect(
      await persistence.store.compareAndSetActivationState({
        requestId: request.requestId,
        expectedStateId: null,
        nextState: state,
      }),
    ).toBe(false);

    const fence = makeFence(request);
    loseResponseFor = 'fence.json';
    await expect(
      persistence.store.compareAndSetActivationFence({
        deploymentInstanceId: request.deploymentInstanceId,
        expectedFenceId: null,
        nextFence: fence,
      }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeHostActivationPersistenceOperationError,
    );
    expect(
      await persistence.store.readActivationFence(request.deploymentInstanceId),
    ).toEqual(fence);
    expect(
      await persistence.store.compareAndSetActivationFence({
        deploymentInstanceId: request.deploymentInstanceId,
        expectedFenceId: null,
        nextFence: fence,
      }),
    ).toBe(false);

    await persistence.close();
  });

  it('poisons rename ambiguity until a recreated handle durably recovers its state directory', async () => {
    /** @type {string|null} */
    let failDirectorySyncFor = null;
    const durabilityFailingFs = Object.create(fsp);
    durabilityFailingFs.open = async (
      /** @type {import('node:fs').PathLike} */ target,
      /** @type {string|number} */ flags,
      /** @type {string|number|undefined} */ mode,
    ) => {
      const handle = await fsp.open(target, flags, mode);
      if (String(target) !== failDirectorySyncFor) return handle;
      return {
        async sync() {
          throw new Error('simulated directory fsync failure');
        },
        async close() {
          await handle.close();
        },
      };
    };
    durabilityFailingFs.rename = async (
      /** @type {import('node:fs').PathLike} */ source,
      /** @type {import('node:fs').PathLike} */ destination,
    ) => {
      await fsp.rename(source, destination);
      failDirectorySyncFor = path.dirname(String(destination));
      throw new Error('simulated response loss after rename');
    };
    const { persistence, registry, stateDirectory } = await openTestPersistence(
      {
        fsOps: durabilityFailingFs,
      },
    );
    const request = makeRequest(baseRequest, 21);
    const state = makeState(request);

    await expect(
      persistence.store.compareAndSetActivationState({
        requestId: request.requestId,
        expectedStateId: null,
        nextState: state,
      }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeHostActivationPersistenceCorruptError,
    );
    expect(() =>
      persistence.store.readActivationState(request.requestId),
    ).toThrow(AwsSingleNodeHostActivationPersistenceCorruptError);
    expect(() =>
      persistence.store.compareAndSetActivationState({
        requestId: request.requestId,
        expectedStateId: null,
        nextState: state,
      }),
    ).toThrow(AwsSingleNodeHostActivationPersistenceCorruptError);
    expect(() =>
      persistence.withHostLock(
        { deploymentInstanceId: request.deploymentInstanceId },
        async () => undefined,
      ),
    ).toThrow(AwsSingleNodeHostActivationPersistenceCorruptError);

    await persistence.close();

    await expect(
      createTestPersistence({
        stateDirectory,
        registry,
        fsOps: durabilityFailingFs,
      }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeHostActivationPersistenceInitializationError,
    );

    const statesDirectory = path.join(stateDirectory, 'states');
    let authenticatedStatesDirectory = false;
    let syncedStatesDirectory = false;
    const recoveryFs = Object.create(fsp);
    recoveryFs.lstat = async (
      /** @type {import('node:fs').PathLike} */ target,
    ) => {
      const stats = await fsp.lstat(target);
      if (String(target) === statesDirectory) {
        authenticatedStatesDirectory = true;
      }
      return stats;
    };
    recoveryFs.open = async (
      /** @type {import('node:fs').PathLike} */ target,
      /** @type {string|number} */ flags,
      /** @type {string|number|undefined} */ mode,
    ) => {
      const handle = await fsp.open(target, flags, mode);
      if (String(target) !== statesDirectory) return handle;
      if (!authenticatedStatesDirectory) {
        await handle.close();
        throw new Error('state directory sync preceded authentication');
      }
      return {
        async sync() {
          await handle.sync();
          syncedStatesDirectory = true;
        },
        async close() {
          await handle.close();
        },
      };
    };
    recoveryFs.opendir = async (
      /** @type {import('node:fs').PathLike} */ target,
      /** @type {import('node:fs').OpenDirOptions|undefined} */ options,
    ) => {
      if (String(target) === statesDirectory && !syncedStatesDirectory) {
        throw new Error('state directory was read before restart durability');
      }
      return fsp.opendir(target, options);
    };

    const reopened = (
      await createTestPersistence({
        stateDirectory,
        registry,
        fsOps: recoveryFs,
      })
    ).persistence;
    expect(authenticatedStatesDirectory).toBe(true);
    expect(syncedStatesDirectory).toBe(true);
    await expect(
      reopened.store.readActivationState(request.requestId),
    ).resolves.toEqual(state);
    await reopened.close();
  });

  itPosix.each(['fence', 'state', 'format-journal'])(
    'rejects a FIFO at the %s record path in a bounded child',
    async (recordKind) => {
      const { persistence, stateDirectory } = await openTestPersistence();
      await persistence.close();
      const fifoPath =
        recordKind === 'fence'
          ? path.join(stateDirectory, 'fence.json')
          : recordKind === 'state'
            ? path.join(
                stateDirectory,
                'states',
                `${baseRequest.requestId}.json`,
              )
            : path.join(
                stateDirectory,
                'format-journals',
                `${
                  getAwsSingleNodeHostRetainedStorageFormatTarget(
                    applicationStorageDesired,
                  ).filesystem.uuid
                }.json`,
              );
      await execFileAsync('mkfifo', [fifoPath], { timeout: 2_000 });
      await fsp.chmod(fifoPath, 0o600);

      const result = await execFileAsync(
        process.execPath,
        [
          CHILD_FIXTURE_PATH,
          'probe-corrupt-persistence',
          baseRequest.deploymentInstanceId,
          stateDirectory,
          String(currentUid()),
        ],
        { timeout: 3_000 },
      );
      expect(result.stdout.trim()).toBe(
        'WHARFIE_AWS_HOST_ACTIVATION_PERSISTENCE_INVALID',
      );
      expect(result.stderr).toBe('');
    },
  );

  it('reopens and resumes a real V66 state-before-fence record from disk', async () => {
    const { stateDirectory } = await createStateDirectory();
    const registry = createAbstractServerRegistry();
    const first = (await createTestPersistence({ stateDirectory, registry }))
      .persistence;
    const failFenceStore = Object.freeze({
      readActivationFence: first.store.readActivationFence,
      async compareAndSetActivationFence() {
        throw new Error('simulated fence failure before commit');
      },
      readActivationState: first.store.readActivationState,
      compareAndSetActivationState: first.store.compareAndSetActivationState,
    });
    const firstKernel = createAwsSingleNodeHostActivationKernel({
      store: failFenceStore,
      withHostLock: first.withHostLock,
      async authorizeRequest() {
        return true;
      },
      steps: createUnknownRuntimeSteps(),
    });

    await expect(firstKernel.converge(baseRequest)).rejects.toBeInstanceOf(
      AwsSingleNodeHostActivationPersistenceOperationError,
    );
    const stateBeforeFence = await first.store.readActivationState(
      baseRequest.requestId,
    );
    expect(stateBeforeFence).toMatchObject({
      request: baseRequest,
      recordVersion: 1,
      status: 'running',
    });
    expect(
      await first.store.readActivationFence(baseRequest.deploymentInstanceId),
    ).toBeNull();
    await first.close();

    const reopened = (await createTestPersistence({ stateDirectory, registry }))
      .persistence;
    const resumedKernel = createAwsSingleNodeHostActivationKernel({
      store: reopened.store,
      withHostLock: reopened.withHostLock,
      async authorizeRequest() {
        return true;
      },
      steps: createUnknownRuntimeSteps(),
    });
    const resumed = await resumedKernel.resume({
      requestId: baseRequest.requestId,
    });
    expect(resumed).toMatchObject({
      status: 'pending',
      requestId: baseRequest.requestId,
      recordVersion: 2,
      step: 'runtime-identity',
    });
    expect(
      await reopened.store.readActivationFence(
        baseRequest.deploymentInstanceId,
      ),
    ).toMatchObject({ requestId: baseRequest.requestId, recordVersion: 1 });
    expect(
      await reopened.store.readActivationState(baseRequest.requestId),
    ).toMatchObject({
      stateId: resumed.stateId,
      recordVersion: 2,
      request: baseRequest,
    });
    await reopened.close();
  });

  it('classifies current, superseded, unclaimed, and ambiguous durable states', async () => {
    const { persistence } = await openTestPersistence();
    const requests = {
      superseded: makeRequest(baseRequest, 29),
      current: makeRequest(baseRequest, 30, 'current'),
      ambiguous: makeRequest(baseRequest, 30, 'ambiguous'),
      unclaimed: makeRequest(baseRequest, 31),
    };
    for (const request of Object.values(requests)) {
      const state = makeState(request);
      expect(
        await persistence.store.compareAndSetActivationState({
          requestId: request.requestId,
          expectedStateId: null,
          nextState: state,
        }),
      ).toBe(true);
    }
    const fence = makeFence(requests.current);
    expect(
      await persistence.store.compareAndSetActivationFence({
        deploymentInstanceId: baseRequest.deploymentInstanceId,
        expectedFenceId: null,
        nextFence: fence,
      }),
    ).toBe(true);

    for (const [authority, request] of Object.entries(requests)) {
      const inspection = await persistence.inspectActivation({
        requestId: request.requestId,
      });
      expect(inspection).toMatchObject({
        authority,
        fence,
        state: { request },
      });
      expectDeepFrozen(inspection);
    }

    await persistence.close();
  });

  it('retains only the newest bounded superseded history without pruning current or future states', async () => {
    const { persistence } = await openTestPersistence({
      retainedSupersededStates: 2,
    });
    /** @type {Map<number, Readonly<AnyRecord>>} */
    const requests = new Map();
    for (let generation = 1; generation <= 12; generation += 1) {
      const request = makeRequest(baseRequest, generation);
      requests.set(generation, request);
      expect(
        await persistence.store.compareAndSetActivationState({
          requestId: request.requestId,
          expectedStateId: null,
          nextState: makeState(request),
        }),
      ).toBe(true);
    }
    const current = /** @type {Readonly<AnyRecord>} */ (requests.get(10));
    expect(
      await persistence.store.compareAndSetActivationFence({
        deploymentInstanceId: current.deploymentInstanceId,
        expectedFenceId: null,
        nextFence: makeFence(current),
      }),
    ).toBe(true);

    for (let generation = 1; generation <= 12; generation += 1) {
      const request = /** @type {Readonly<AnyRecord>} */ (
        requests.get(generation)
      );
      const retained = await persistence.store.readActivationState(
        request.requestId,
      );
      expect(retained === null).toBe(generation <= 7);
    }

    await persistence.close();
  });

  it('recovers one stale temp beside the full 128-state durable capacity', async () => {
    const { stateDirectory } = await createStateDirectory();
    const registry = createAbstractServerRegistry();
    const first = (await createTestPersistence({ stateDirectory, registry }))
      .persistence;
    /** @type {Readonly<AnyRecord>[]} */
    const requests = [];
    for (
      let generation = 1;
      generation <= AWS_SINGLE_NODE_HOST_ACTIVATION_MAX_STATE_DIRECTORY_ENTRIES;
      generation += 1
    ) {
      const request = makeRequest(baseRequest, generation, 'full-capacity');
      requests.push(request);
      expect(
        await first.store.compareAndSetActivationState({
          requestId: request.requestId,
          expectedStateId: null,
          nextState: makeState(request),
        }),
      ).toBe(true);
    }
    const statesDirectory = path.join(stateDirectory, 'states');
    const staleTempName = `.state.${requests[0].requestId}.stale-token.tmp`;
    const staleTempPath = path.join(statesDirectory, staleTempName);
    await fsp.writeFile(staleTempPath, 'stale\n', {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    expect((await fsp.lstat(staleTempPath)).mode & 0o777).toBe(0o600);
    expect(await fsp.readdir(statesDirectory)).toHaveLength(
      AWS_SINGLE_NODE_HOST_ACTIVATION_MAX_STATE_DIRECTORY_ENTRIES + 1,
    );
    await first.close();

    const reopened = (await createTestPersistence({ stateDirectory, registry }))
      .persistence;
    const expectedNames = requests
      .map((request) => `${request.requestId}.json`)
      .sort();
    expect((await fsp.readdir(statesDirectory)).sort()).toEqual(expectedNames);
    await expect(fsp.lstat(staleTempPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(
      await reopened.store.readActivationState(requests[0].requestId),
    ).toMatchObject({ request: requests[0] });
    expect(
      await reopened.store.readActivationState(
        requests[requests.length - 1].requestId,
      ),
    ).toMatchObject({ request: requests[requests.length - 1] });
    await reopened.close();
  }, 30_000);

  it('excludes concurrent host work and releases after callback completion', async () => {
    const registry = createAbstractServerRegistry();
    const { stateDirectory } = await createStateDirectory();
    let token = 0;
    const createPersistence = () =>
      createAwsSingleNodeHostActivationPersistence({
        deploymentInstanceId: baseRequest.deploymentInstanceId,
        stateDirectory,
        expectedUid: currentUid(),
        fsOps: fsp,
        createServer: registry.createServer,
        createToken() {
          token += 1;
          return `shared-token-${token}`;
        },
        retainedSupersededStates: 8,
      });
    const first = await createPersistence();
    const second = await createPersistence();
    const entered = deferred();
    const releaseCallback = deferred();
    const firstRun = first.withHostLock(
      { deploymentInstanceId: baseRequest.deploymentInstanceId },
      async () => {
        entered.resolve();
        await releaseCallback.promise;
        return 'first-complete';
      },
    );
    await entered.promise;

    await expect(
      second.withHostLock(
        { deploymentInstanceId: baseRequest.deploymentInstanceId },
        async () => 'unexpected',
      ),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeHostActivationPersistenceLockBusyError,
    );

    releaseCallback.resolve();
    await expect(firstRun).resolves.toBe('first-complete');
    await expect(
      second.withHostLock(
        { deploymentInstanceId: baseRequest.deploymentInstanceId },
        async () => 'second-complete',
      ),
    ).resolves.toBe('second-complete');

    await Promise.all([first.close(), second.close()]);
    expect(registry.boundCount()).toBe(0);
  });

  it('revokes detached AsyncLocal descendants when their host callback completes', async () => {
    const { persistence } = await openTestPersistence();
    const beginDetached = deferred();
    /** @type {Promise<{storeError: unknown, closeError: unknown}>} */
    let detachedTask = Promise.resolve({
      storeError: undefined,
      closeError: undefined,
    });

    await expect(
      persistence.withHostLock(
        { deploymentInstanceId: baseRequest.deploymentInstanceId },
        async () => {
          detachedTask = (async () => {
            await beginDetached.promise;
            /** @type {unknown} */
            let storeError;
            /** @type {unknown} */
            let closeError;
            try {
              await persistence.store.readActivationFence(
                baseRequest.deploymentInstanceId,
              );
            } catch (error) {
              storeError = error;
            }
            try {
              await persistence.close();
            } catch (error) {
              closeError = error;
            }
            return { storeError, closeError };
          })();
          return 'callback-complete';
        },
      ),
    ).resolves.toBe('callback-complete');

    beginDetached.resolve();
    const detached = await detachedTask;
    expect(detached.storeError).toBeInstanceOf(
      AwsSingleNodeHostActivationPersistenceOperationError,
    );
    expect(detached.closeError).toBeInstanceOf(
      AwsSingleNodeHostActivationPersistenceCloseError,
    );
    await persistence.close();
  });

  it('rejects inherited close promptly while an external close drains the callback', async () => {
    const { persistence } = await openTestPersistence();
    const entered = deferred();
    const attemptInheritedClose = deferred();
    const hostRun = persistence.withHostLock(
      { deploymentInstanceId: baseRequest.deploymentInstanceId },
      async () => {
        entered.resolve();
        await attemptInheritedClose.promise;
        const inheritedResult = await Promise.race([
          persistence.close().then(
            () => ({ status: 'resolved', error: null }),
            (error) => ({ status: 'rejected', error }),
          ),
          new Promise((resolve) =>
            setImmediate(() =>
              resolve({ status: 'still-pending', error: null }),
            ),
          ),
        ]);
        expect(inheritedResult).toMatchObject({ status: 'rejected' });
        expect(inheritedResult.error).toBeInstanceOf(
          AwsSingleNodeHostActivationPersistenceCloseError,
        );
        return 'callback-released';
      },
    );
    await entered.promise;

    const externalClose = persistence.close();
    await expect(
      Promise.race([
        externalClose.then(() => 'closed'),
        Promise.resolve('still-draining'),
      ]),
    ).resolves.toBe('still-draining');
    attemptInheritedClose.resolve();
    await expect(hostRun).resolves.toBe('callback-released');
    await expect(externalClose).resolves.toBeUndefined();
  });

  it('fences new work on close while draining admitted host-lock work', async () => {
    const { persistence, registry } = await openTestPersistence();
    const entered = deferred();
    const continueCallback = deferred();
    const hostRun = persistence.withHostLock(
      { deploymentInstanceId: baseRequest.deploymentInstanceId },
      async () => {
        entered.resolve();
        await continueCallback.promise;
        expect(
          await persistence.store.readActivationFence(
            baseRequest.deploymentInstanceId,
          ),
        ).toBeNull();
        return 'drained';
      },
    );
    await entered.promise;

    const firstClose = persistence.close();
    const secondClose = persistence.close();
    expect(secondClose).toBe(firstClose);
    await expect(
      Promise.race([
        firstClose.then(() => 'closed'),
        Promise.resolve('still-draining'),
      ]),
    ).resolves.toBe('still-draining');
    expect(() =>
      persistence.store.readActivationFence(baseRequest.deploymentInstanceId),
    ).toThrow(AwsSingleNodeHostActivationPersistenceClosedError);

    continueCallback.resolve();
    await expect(hostRun).resolves.toBe('drained');
    await expect(firstClose).resolves.toBeUndefined();
    expect(registry.boundCount()).toBe(0);
    expect(() =>
      persistence.inspectActivation({ requestId: baseRequest.requestId }),
    ).toThrow(AwsSingleNodeHostActivationPersistenceClosedError);
  });
});
