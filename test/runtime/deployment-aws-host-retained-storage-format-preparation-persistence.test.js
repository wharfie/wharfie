import { EventEmitter } from 'node:events';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { getAwsSingleNodeHostActivationIntentId } from '../../src/core/runtime/deployment-aws-host-activation.js';
import { createAwsSingleNodeHostActivationRequest } from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import {
  AwsSingleNodeHostActivationPersistenceOperationError,
  createAwsSingleNodeHostActivationPersistence,
} from '../../src/core/runtime/deployment-aws-host-activation-persistence.js';
import { createAwsSingleNodeHostRetainedStorageBlankFormatProof } from '../../src/core/runtime/deployment-aws-host-retained-storage-format-journal.js';
import { createAwsSingleNodeHostRetainedStorageFormatPreparation } from '../../src/core/runtime/deployment-aws-host-retained-storage-format-preparation.js';
import {
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
  createAwsSingleNodeHostApplicationStorageAdapter,
} from '../../src/core/runtime/deployment-aws-host-retained-storage.js';
import { getAwsSingleNodeHostRetainedStorageByIdPath } from '../../src/core/runtime/deployment-aws-host-retained-storage-projection.js';
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
} from '../../src/core/runtime/deployment-aws-host-runtime-identity.js';
import {
  makeFixture,
  makeReconcileFixture,
} from './fixtures/deployment-aws-host-activation.js';

/** @typedef {Record<string, any>} AnyRecord */

/** @type {string[]} */
const temporaryDirectories = [];
/** @type {AnyRecord[]} */
const persistenceOwners = [];

afterEach(async () => {
  const owners = persistenceOwners.splice(0, persistenceOwners.length);
  await Promise.allSettled(owners.map((owner) => owner.close()));
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

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @returns {number} */
function currentUid() {
  if (typeof process.getuid !== 'function') {
    throw new Error('Focused persistence tests require a numeric process UID.');
  }
  return process.getuid();
}

/**
 * Model Linux abstract-socket ownership without native platform dependence.
 * @returns {{createServer: typeof import('node:net').createServer}}
 */
function createAbstractServerRegistry() {
  /** @type {Map<string, FakeServer>} */
  const owners = new Map();

  class FakeServer extends EventEmitter {
    constructor() {
      super();
      this.listening = false;
      /** @type {string|null} */
      this.boundAddress = null;
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
      return this;
    }
  }

  return {
    createServer: /** @type {typeof import('node:net').createServer} */ (
      /** @type {unknown} */ (() => new FakeServer())
    ),
  };
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

/**
 * Capture the production adapter's desired document without duplicating it.
 * @param {Readonly<AnyRecord>} request - Exact activation request.
 * @returns {Promise<Readonly<AnyRecord>>} - Canonical application desired.
 */
async function captureApplicationDesired(request) {
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
  if (captured === undefined) throw new Error('desired state was not captured');
  return captured;
}

/**
 * Create one canonical proof without invoking native observer tools.
 * @param {Readonly<AnyRecord>} desired - Exact desired media.
 * @returns {Readonly<AnyRecord>} - Canonical blank proof.
 */
function createBlankProof(desired) {
  return createAwsSingleNodeHostRetainedStorageBlankFormatProof({
    desired,
    device: {
      path: '/dev/nvme1n1',
      major: 259,
      minor: 1,
      nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
      nvmeSerialVolumeId: desired.volumeProviderResourceId,
      byIdPath: getAwsSingleNodeHostRetainedStorageByIdPath(
        desired.volumeProviderResourceId,
      ),
      byIdTarget: '../../nvme1n1',
    },
    mountNamespace: 'mnt:[4026531841]',
  });
}

/**
 * Open actual filesystem persistence over a fake abstract-socket registry.
 * @param {string} stateDirectory - Isolated state root.
 * @param {ReturnType<typeof createAbstractServerRegistry>} registry - Lock registry.
 * @param {string} deploymentInstanceId - Exact deployment.
 * @returns {Promise<AnyRecord>} - Concrete persistence owner.
 */
async function openPersistence(stateDirectory, registry, deploymentInstanceId) {
  let token = 0;
  const persistence = await createAwsSingleNodeHostActivationPersistence({
    deploymentInstanceId,
    stateDirectory,
    expectedUid: currentUid(),
    fsOps: fsp,
    createServer: registry.createServer,
    createToken() {
      token += 1;
      return `format-preparation-${token}`;
    },
    retainedSupersededStates: 8,
  });
  persistenceOwners.push(persistence);
  return persistence;
}

describe('AWS retained-storage preparation with real persistence', () => {
  it('requires lock admission and reuses durable target truth after reopen and request churn', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const reconcileRequest = createAwsSingleNodeHostActivationRequest(
      makeReconcileFixture(fixture).requestContext,
    );
    const desired = await captureApplicationDesired(request);
    const reconcileDesired = await captureApplicationDesired(reconcileRequest);
    const intentId = getAwsSingleNodeHostActivationIntentId(
      request,
      'application-storage',
    );
    const reconcileIntentId = getAwsSingleNodeHostActivationIntentId(
      reconcileRequest,
      'application-storage',
    );
    const rootDirectory = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-format-preparation-persistence-'),
    );
    temporaryDirectories.push(rootDirectory);
    const stateDirectory = path.join(rootDirectory, 'deployment');
    const registry = createAbstractServerRegistry();
    const inspectBlankFormat = jest.fn(
      async (/** @type {Readonly<AnyRecord>} */ candidate) =>
        deepFreeze({
          status: 'blank',
          proof: createBlankProof(candidate),
        }),
    );
    const observer = Object.freeze({
      inspect: jest.fn(),
      inspectBlankFormat,
    });
    const identity = Object.freeze({
      deploymentInstanceId: request.deploymentInstanceId,
    });

    const first = await openPersistence(
      stateDirectory,
      registry,
      request.deploymentInstanceId,
    );
    const firstPreparation =
      createAwsSingleNodeHostRetainedStorageFormatPreparation({
        observer,
        journalStore: first.retainedStorageFormatJournalStore,
      });
    const input = Object.freeze({
      desired,
      intentId,
      attemptGeneration: 0,
    });

    await expect(firstPreparation.prepare(input)).rejects.toBeInstanceOf(
      AwsSingleNodeHostActivationPersistenceOperationError,
    );
    expect(inspectBlankFormat).not.toHaveBeenCalled();

    /** @type {Readonly<AnyRecord>|undefined} */
    let published;
    await first.withHostLock(identity, async () => {
      await expect(
        first.retainedStorageFormatJournalStore.readRetainedStorageFormatJournal(
          desired,
        ),
      ).resolves.toBeNull();
      published = await firstPreparation.prepare(input);
      expect(published).toMatchObject({
        status: 'prepared',
        journal: { phase: 'prepared' },
      });
    });
    expect(inspectBlankFormat).toHaveBeenCalledTimes(1);
    await first.close();

    const reopened = await openPersistence(
      stateDirectory,
      registry,
      request.deploymentInstanceId,
    );
    const reopenedPreparation =
      createAwsSingleNodeHostRetainedStorageFormatPreparation({
        observer,
        journalStore: reopened.retainedStorageFormatJournalStore,
      });
    await reopened.withHostLock(identity, async () => {
      await expect(reopenedPreparation.prepare(input)).resolves.toEqual(
        published,
      );
      await expect(
        reopenedPreparation.prepare({
          desired: reconcileDesired,
          intentId: reconcileIntentId,
          attemptGeneration: 9,
        }),
      ).resolves.toEqual(published);
    });
    expect(inspectBlankFormat).toHaveBeenCalledTimes(1);
    await reopened.close();
  }, 30_000);
});
