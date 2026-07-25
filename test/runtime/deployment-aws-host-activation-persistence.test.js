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
/** @type {string[]} */
const temporaryDirectories = [];

beforeAll(() => {
  const fixture = makeFixture();
  baseRequest = createAwsSingleNodeHostActivationRequest(
    fixture.requestContext,
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

  itPosix.each(['fence', 'state'])(
    'rejects a FIFO at the %s record path in a bounded child',
    async (recordKind) => {
      const { persistence, stateDirectory } = await openTestPersistence();
      await persistence.close();
      const fifoPath =
        recordKind === 'fence'
          ? path.join(stateDirectory, 'fence.json')
          : path.join(
              stateDirectory,
              'states',
              `${baseRequest.requestId}.json`,
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
  });

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
