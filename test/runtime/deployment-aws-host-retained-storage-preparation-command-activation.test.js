import { EventEmitter } from 'node:events';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { createAwsSingleNodeHostActivationKernel } from '../../src/core/runtime/deployment-aws-host-activation.js';
import { createAwsSingleNodeHostActivationRequest } from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import {
  AwsSingleNodeHostActivationPersistenceOperationError,
  createAwsSingleNodeHostActivationPersistence,
} from '../../src/core/runtime/deployment-aws-host-activation-persistence.js';
import {
  createAwsSingleNodeHostRetainedStorageBlankFormatProof,
  getAwsSingleNodeHostRetainedStorageFormatTarget,
} from '../../src/core/runtime/deployment-aws-host-retained-storage-format-journal.js';
import { createAwsSingleNodeHostRetainedStoragePreparationCommandForTest } from '../../src/core/runtime/deployment-aws-host-retained-storage-preparation-command.js';
import {
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
  createAwsSingleNodeHostApplicationStorageAdapter,
} from '../../src/core/runtime/deployment-aws-host-retained-storage.js';
import { getAwsSingleNodeHostRetainedStorageByIdPath } from '../../src/core/runtime/deployment-aws-host-retained-storage-projection.js';
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
  validateAwsSingleNodeHostRuntimeIdentityEvidence,
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

/**
 * @param {Readonly<AnyRecord>} request - Exact activation request.
 * @returns {Readonly<AnyRecord>} - Canonical runtime evidence.
 */
function runtimeEvidence(request) {
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
 * @param {'settled'|'unknown'} status - Runtime observation mode.
 * @returns {Readonly<AnyRecord>} - Runtime adapter.
 */
function createRuntimeAdapter(status) {
  return Object.freeze({
    async observe(/** @type {Readonly<AnyRecord>} */ context) {
      if (status === 'unknown') return Object.freeze({ status: 'unknown' });
      return deepFreeze({
        status: 'settled',
        evidence: validateAwsSingleNodeHostRuntimeIdentityEvidence(
          runtimeEvidence(context.request),
          context,
        ),
      });
    },
    validateEvidence(
      /** @type {unknown} */ value,
      /** @type {unknown} */ context,
    ) {
      return validateAwsSingleNodeHostRuntimeIdentityEvidence(value, context);
    },
  });
}

/**
 * @param {string} name - Step name.
 * @returns {Readonly<{adapter: Readonly<AnyRecord>, observe: ReturnType<typeof jest.fn>, converge: ReturnType<typeof jest.fn>, validateEvidence: ReturnType<typeof jest.fn>}>} - Forbidden downstream adapter.
 */
function createForbiddenAdapter(name) {
  const observe = jest.fn(async () => {
    throw new Error(`${name} observation must not run`);
  });
  const converge = jest.fn(async () => {
    throw new Error(`${name} convergence must not run`);
  });
  const validateEvidence = jest.fn(() => {
    throw new Error(`${name} evidence validation must not run`);
  });
  return Object.freeze({
    adapter: Object.freeze({ observe, converge, validateEvidence }),
    observe,
    converge,
    validateEvidence,
  });
}

/**
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
 * @param {AnyRecord[]} events - Ordered integration events.
 * @param {'ready'|'conflict'} [coarseStatus] - Coarse observation result.
 * @returns {Readonly<AnyRecord>} - Closed synthetic observer harness.
 */
function createObserverHarness(events, coarseStatus = 'ready') {
  const inspect = jest.fn(
    async (/** @type {Readonly<AnyRecord>} */ desired) => {
      events.push({
        type: 'coarse-inspect',
        requestId: desired.requestId,
        status: coarseStatus,
      });
      return Object.freeze({ status: coarseStatus });
    },
  );
  const inspectBlankFormat = jest.fn(
    async (/** @type {Readonly<AnyRecord>} */ desired) => {
      events.push({
        type: 'blank-inspect',
        requestId: desired.requestId,
      });
      return deepFreeze({
        status: 'blank',
        proof: createBlankProof(desired),
      });
    },
  );
  return Object.freeze({
    observer: Object.freeze({ inspect, inspectBlankFormat }),
    inspect,
    inspectBlankFormat,
  });
}

/**
 * Open real activation and format-journal persistence with recording delegates.
 * @param {string} deploymentInstanceId - Exact deployment.
 * @param {AnyRecord[]} events - Ordered integration events.
 * @returns {Promise<Readonly<AnyRecord>>} - Real persistence harness.
 */
async function openPersistenceHarness(deploymentInstanceId, events) {
  const rootDirectory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-preparation-command-activation-'),
  );
  temporaryDirectories.push(rootDirectory);
  const registry = createAbstractServerRegistry();
  let token = 0;
  const persistence = await createAwsSingleNodeHostActivationPersistence({
    deploymentInstanceId,
    stateDirectory: path.join(rootDirectory, 'deployment'),
    expectedUid: currentUid(),
    fsOps: fsp,
    createServer: registry.createServer,
    createToken() {
      token += 1;
      return `preparation-activation-${token}`;
    },
    retainedSupersededStates: 8,
  });
  persistenceOwners.push(persistence);

  const rawStore = persistence.store;
  const store = Object.freeze({
    async readActivationFence(/** @type {string} */ identity) {
      const value = await Reflect.apply(
        rawStore.readActivationFence,
        rawStore,
        [identity],
      );
      events.push({
        type: 'fence-read',
        requestId: value?.requestId ?? null,
      });
      return value;
    },
    async compareAndSetActivationFence(
      /** @type {Readonly<AnyRecord>} */ input,
    ) {
      const applied = await Reflect.apply(
        rawStore.compareAndSetActivationFence,
        rawStore,
        [input],
      );
      events.push({
        type: 'fence-cas',
        applied,
        requestId: input.nextFence.requestId,
      });
      return applied;
    },
    async readActivationState(/** @type {string} */ requestId) {
      return await Reflect.apply(rawStore.readActivationState, rawStore, [
        requestId,
      ]);
    },
    async compareAndSetActivationState(
      /** @type {Readonly<AnyRecord>} */ input,
    ) {
      const applied = await Reflect.apply(
        rawStore.compareAndSetActivationState,
        rawStore,
        [input],
      );
      events.push({
        type: 'state-cas',
        applied,
        requestId: input.requestId,
        applicationStatus: input.nextState.steps[1].status,
        applicationAttemptGeneration:
          input.nextState.steps[1].attemptGeneration,
      });
      return applied;
    },
  });

  const rawJournalStore = persistence.retainedStorageFormatJournalStore;
  /** @type {Readonly<AnyRecord>[]} */
  const journalWrites = [];
  const journalStore = Object.freeze({
    async readRetainedStorageFormatJournal(
      /** @type {Readonly<AnyRecord>} */ desired,
    ) {
      events.push({
        type: 'journal-read',
        requestId: desired.requestId,
      });
      return await Reflect.apply(
        rawJournalStore.readRetainedStorageFormatJournal,
        rawJournalStore,
        [desired],
      );
    },
    async compareAndSetRetainedStorageFormatJournal(
      /** @type {Readonly<AnyRecord>} */ input,
    ) {
      const applied = await Reflect.apply(
        rawJournalStore.compareAndSetRetainedStorageFormatJournal,
        rawJournalStore,
        [input],
      );
      journalWrites.push(input.nextJournal);
      events.push({
        type: 'journal-cas',
        applied,
        phase: input.nextJournal.phase,
        requestId: input.desired.requestId,
      });
      return applied;
    },
  });

  async function withHostLock(
    /** @type {Readonly<AnyRecord>} */ identity,
    /** @type {() => Promise<any>} */ operation,
  ) {
    return await persistence.withHostLock(identity, async () => {
      events.push({ type: 'lock-enter' });
      try {
        return await operation();
      } finally {
        events.push({ type: 'lock-exit' });
      }
    });
  }

  return Object.freeze({
    persistence,
    store,
    journalStore,
    journalWrites,
    withHostLock,
  });
}

/**
 * @param {AnyRecord[]} events - Ordered integration events.
 * @param {(input: Readonly<AnyRecord>) => boolean} decision - Authority policy.
 * @returns {Readonly<{authorizeRequest: Function, calls: Readonly<AnyRecord>[]}>} - Authority harness.
 */
function createAuthorityHarness(events, decision) {
  /** @type {Readonly<AnyRecord>[]} */
  const calls = [];
  async function authorizeRequest(/** @type {Readonly<AnyRecord>} */ input) {
    const allowed = decision(input);
    calls.push(input);
    events.push({
      type: 'authority',
      allowed,
      purpose: input.purpose,
      requestId: input.request.requestId,
      step: input.step,
    });
    return allowed;
  }
  return Object.freeze({ authorizeRequest, calls });
}

/**
 * @param {Readonly<AnyRecord>} persistenceHarness - Real persistence delegates.
 * @param {Readonly<AnyRecord>} observerHarness - Closed observer harness.
 * @param {Readonly<AnyRecord>} authorityHarness - Authority harness.
 * @param {'settled'|'unknown'} runtimeStatus - Runtime observation mode.
 * @returns {Readonly<AnyRecord>} - Kernel and forbidden downstream surfaces.
 */
function createKernelHarness(
  persistenceHarness,
  observerHarness,
  authorityHarness,
  runtimeStatus = 'settled',
) {
  const command =
    createAwsSingleNodeHostRetainedStoragePreparationCommandForTest({
      observer: observerHarness.observer,
      journalStore: persistenceHarness.journalStore,
    });
  const applicationStorage = createAwsSingleNodeHostApplicationStorageAdapter({
    command,
  });
  const controlStorage = createForbiddenAdapter('control-storage');
  const artifactProjection = createForbiddenAdapter('artifact-projection');
  const serviceConvergence = createForbiddenAdapter('service-convergence');
  const healthPublication = createForbiddenAdapter('health-publication');
  const kernel = createAwsSingleNodeHostActivationKernel({
    store: persistenceHarness.store,
    withHostLock: persistenceHarness.withHostLock,
    authorizeRequest: authorityHarness.authorizeRequest,
    steps: {
      runtimeIdentity: createRuntimeAdapter(runtimeStatus),
      applicationStorage,
      controlStorage: controlStorage.adapter,
      artifactProjection: artifactProjection.adapter,
      serviceConvergence: serviceConvergence.adapter,
      healthPublication: healthPublication.adapter,
    },
  });
  return Object.freeze({
    kernel,
    command,
    downstream: Object.freeze([
      controlStorage,
      artifactProjection,
      serviceConvergence,
      healthPublication,
    ]),
  });
}

/** @param {Readonly<AnyRecord>[]} downstream - Forbidden surfaces. */
function expectNoDownstreamCalls(downstream) {
  for (const surface of downstream) {
    expect(surface.observe).not.toHaveBeenCalled();
    expect(surface.converge).not.toHaveBeenCalled();
    expect(surface.validateEvidence).not.toHaveBeenCalled();
  }
}

/** @param {AnyRecord[]} events @param {(event: AnyRecord) => boolean} predicate @returns {number} */
function eventIndex(events, predicate) {
  return events.findIndex(predicate);
}

describe('retained-storage preparation command through real activation', () => {
  it('prepares only after definite authorized fenced dispatch and reuses it on replay and request churn', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const reconcileRequest = createAwsSingleNodeHostActivationRequest(
      makeReconcileFixture(fixture).requestContext,
    );
    /** @type {AnyRecord[]} */
    const events = [];
    const persistence = await openPersistenceHarness(
      request.deploymentInstanceId,
      events,
    );
    const observer = createObserverHarness(events);
    const authority = createAuthorityHarness(events, (input) =>
      [request.requestId, reconcileRequest.requestId].includes(
        input.request.requestId,
      ),
    );
    const harness = createKernelHarness(persistence, observer, authority);

    const result = await harness.kernel.converge(request);
    const state = await harness.kernel.inspect({
      requestId: request.requestId,
    });

    expect(result).toMatchObject({
      status: 'pending',
      step: 'application-storage',
    });
    expect(state.steps[0]).toMatchObject({
      kind: 'runtime-identity',
      status: 'settled',
    });
    expect(state.steps[1]).toMatchObject({
      kind: 'application-storage',
      status: 'intended',
      attemptGeneration: 1,
    });
    expect(
      state.steps
        .slice(2)
        .every((/** @type {AnyRecord} */ step) => step.status === 'pending'),
    ).toBe(true);
    expect(persistence.journalWrites).toHaveLength(1);
    expect(persistence.journalWrites[0]).toMatchObject({
      phase: 'prepared',
      attempt: {
        requestId: request.requestId,
        attemptGeneration: 1,
      },
    });
    expectNoDownstreamCalls(harness.downstream);

    const lockEnter = eventIndex(
      events,
      (event) => event.type === 'lock-enter',
    );
    const definiteAttempt = eventIndex(
      events,
      (event) =>
        event.type === 'state-cas' &&
        event.requestId === request.requestId &&
        event.applicationStatus === 'intended' &&
        event.applicationAttemptGeneration === 1 &&
        event.applied === true,
    );
    const dispatch = eventIndex(
      events,
      (event) =>
        event.type === 'authority' &&
        event.requestId === request.requestId &&
        event.purpose === 'dispatch' &&
        event.step === 'application-storage' &&
        event.allowed === true,
    );
    const currentFence = events.findIndex(
      (event, index) =>
        index > dispatch &&
        event.type === 'fence-read' &&
        event.requestId === request.requestId,
    );
    const initialJournalRead = events.findIndex(
      (event, index) =>
        index > currentFence &&
        event.type === 'journal-read' &&
        event.requestId === request.requestId,
    );
    const blank = eventIndex(
      events,
      (event) =>
        event.type === 'blank-inspect' && event.requestId === request.requestId,
    );
    const journalCas = eventIndex(
      events,
      (event) =>
        event.type === 'journal-cas' &&
        event.requestId === request.requestId &&
        event.phase === 'prepared' &&
        event.applied === true,
    );
    const durableJournalReadback = events.findIndex(
      (event, index) =>
        index > journalCas &&
        event.type === 'journal-read' &&
        event.requestId === request.requestId,
    );
    const postObservation = events.findIndex(
      (event, index) =>
        index > durableJournalReadback &&
        event.type === 'coarse-inspect' &&
        event.requestId === request.requestId,
    );
    const lockExit = eventIndex(events, (event) => event.type === 'lock-exit');
    expect(lockEnter).toBeGreaterThanOrEqual(0);
    expect(definiteAttempt).toBeGreaterThan(lockEnter);
    expect(dispatch).toBeGreaterThan(definiteAttempt);
    expect(currentFence).toBeGreaterThan(dispatch);
    expect(initialJournalRead).toBeGreaterThan(currentFence);
    expect(blank).toBeGreaterThan(initialJournalRead);
    expect(journalCas).toBeGreaterThan(blank);
    expect(durableJournalReadback).toBeGreaterThan(journalCas);
    expect(postObservation).toBeGreaterThan(durableJournalReadback);
    expect(lockExit).toBeGreaterThan(postObservation);

    const resumeEventStart = events.length;
    await expect(
      harness.kernel.resume({ requestId: request.requestId }),
    ).resolves.toMatchObject({
      status: 'pending',
      step: 'application-storage',
    });
    const resumeEvents = events.slice(resumeEventStart);
    const resumeDispatch = eventIndex(
      resumeEvents,
      (event) =>
        event.type === 'authority' &&
        event.requestId === request.requestId &&
        event.purpose === 'dispatch' &&
        event.step === 'application-storage' &&
        event.allowed === true,
    );
    const resumeJournalRead = resumeEvents.findIndex(
      (event, index) =>
        index > resumeDispatch &&
        event.type === 'journal-read' &&
        event.requestId === request.requestId,
    );
    expect(resumeDispatch).toBeGreaterThanOrEqual(0);
    expect(resumeJournalRead).toBeGreaterThan(resumeDispatch);
    expect(
      resumeEvents.some(
        (event) =>
          event.type === 'blank-inspect' || event.type === 'journal-cas',
      ),
    ).toBe(false);

    const reconcileEventStart = events.length;
    await expect(
      harness.kernel.converge(reconcileRequest),
    ).resolves.toMatchObject({
      status: 'pending',
      step: 'application-storage',
    });
    const reconcileEvents = events.slice(reconcileEventStart);
    const reconcileDispatch = eventIndex(
      reconcileEvents,
      (event) =>
        event.type === 'authority' &&
        event.requestId === reconcileRequest.requestId &&
        event.purpose === 'dispatch' &&
        event.step === 'application-storage' &&
        event.allowed === true,
    );
    const reconcileJournalRead = reconcileEvents.findIndex(
      (event, index) =>
        index > reconcileDispatch &&
        event.type === 'journal-read' &&
        event.requestId === reconcileRequest.requestId,
    );
    expect(reconcileDispatch).toBeGreaterThanOrEqual(0);
    expect(reconcileJournalRead).toBeGreaterThan(reconcileDispatch);
    expect(
      reconcileEvents.some(
        (event) =>
          event.type === 'blank-inspect' || event.type === 'journal-cas',
      ),
    ).toBe(false);
    expect(observer.inspectBlankFormat).toHaveBeenCalledTimes(1);
    expect(persistence.journalWrites).toHaveLength(1);
    expectNoDownstreamCalls(harness.downstream);

    const firstDesired = observer.inspect.mock.calls[0][0];
    const churnDesired =
      observer.inspect.mock.calls[observer.inspect.mock.calls.length - 1][0];
    expect(churnDesired.requestId).toBe(reconcileRequest.requestId);
    expect(
      getAwsSingleNodeHostRetainedStorageFormatTarget(churnDesired),
    ).toEqual(getAwsSingleNodeHostRetainedStorageFormatTarget(firstDesired));
    await persistence.persistence.withHostLock(
      Object.freeze({
        deploymentInstanceId: request.deploymentInstanceId,
      }),
      async () => {
        await expect(
          persistence.persistence.retainedStorageFormatJournalStore.readRetainedStorageFormatJournal(
            churnDesired,
          ),
        ).resolves.toEqual(persistence.journalWrites[0]);
      },
    );
  });

  it('allows coarse inspection but denies blank proof and publication when dispatch authorization fails', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    /** @type {AnyRecord[]} */
    const events = [];
    const persistence = await openPersistenceHarness(
      request.deploymentInstanceId,
      events,
    );
    const observer = createObserverHarness(events);
    const authority = createAuthorityHarness(
      events,
      (input) =>
        input.request.requestId === request.requestId &&
        !(input.purpose === 'dispatch' && input.step === 'application-storage'),
    );
    const harness = createKernelHarness(persistence, observer, authority);

    // The real persistence boundary deliberately converts an error escaping
    // its admitted callback into one fixed host-safe operation error.
    await expect(harness.kernel.converge(request)).rejects.toBeInstanceOf(
      AwsSingleNodeHostActivationPersistenceOperationError,
    );
    const state = await harness.kernel.inspect({
      requestId: request.requestId,
    });

    expect(observer.inspect).toHaveBeenCalledTimes(1);
    expect(observer.inspectBlankFormat).not.toHaveBeenCalled();
    expect(
      events.some(
        (event) =>
          event.type === 'journal-read' || event.type === 'journal-cas',
      ),
    ).toBe(false);
    expect(persistence.journalWrites).toHaveLength(0);
    expect(state.steps[1]).toMatchObject({
      status: 'intended',
      attemptGeneration: 1,
    });
    const deniedDispatch = eventIndex(
      events,
      (event) =>
        event.type === 'authority' &&
        event.purpose === 'dispatch' &&
        event.step === 'application-storage' &&
        event.allowed === false,
    );
    expect(deniedDispatch).toBeGreaterThanOrEqual(0);
    expect(
      events
        .slice(deniedDispatch + 1)
        .some((event) => event.type === 'fence-read'),
    ).toBe(false);
    expectNoDownstreamCalls(harness.downstream);
  });

  it('blocks coarse conflict before dispatch, blank proof, journal access, or downstream work', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    /** @type {AnyRecord[]} */
    const events = [];
    const persistence = await openPersistenceHarness(
      request.deploymentInstanceId,
      events,
    );
    const observer = createObserverHarness(events, 'conflict');
    const authority = createAuthorityHarness(
      events,
      (input) => input.request.requestId === request.requestId,
    );
    const harness = createKernelHarness(persistence, observer, authority);

    await expect(harness.kernel.converge(request)).resolves.toMatchObject({
      status: 'blocked',
      step: 'application-storage',
    });
    const state = await harness.kernel.inspect({
      requestId: request.requestId,
    });

    expect(state).toMatchObject({
      status: 'blocked',
      block: {
        reason: 'observation-conflict',
        step: 'application-storage',
      },
    });
    expect(state.steps[1]).toMatchObject({
      status: 'intended',
      attemptGeneration: 0,
    });
    expect(observer.inspect).toHaveBeenCalledTimes(1);
    expect(observer.inspectBlankFormat).not.toHaveBeenCalled();
    expect(
      events.some(
        (event) => event.type === 'authority' && event.purpose === 'dispatch',
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === 'journal-read' || event.type === 'journal-cas',
      ),
    ).toBe(false);
    expect(persistence.journalWrites).toHaveLength(0);
    expectNoDownstreamCalls(harness.downstream);
  });

  it('rejects claim-level unauthorized work before command observation or journal access', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    /** @type {AnyRecord[]} */
    const events = [];
    const persistence = await openPersistenceHarness(
      request.deploymentInstanceId,
      events,
    );
    const observer = createObserverHarness(events);
    const authority = createAuthorityHarness(events, () => false);
    const harness = createKernelHarness(persistence, observer, authority);

    await expect(harness.kernel.converge(request)).rejects.toBeInstanceOf(
      AwsSingleNodeHostActivationPersistenceOperationError,
    );
    await expect(
      harness.kernel.inspect({ requestId: request.requestId }),
    ).resolves.toBeNull();
    expect(observer.inspect).not.toHaveBeenCalled();
    expect(observer.inspectBlankFormat).not.toHaveBeenCalled();
    expect(
      events.some(
        (event) =>
          event.type === 'journal-read' || event.type === 'journal-cas',
      ),
    ).toBe(false);
    expect(events.filter((event) => event.type === 'authority')).toEqual([
      expect.objectContaining({
        allowed: false,
        purpose: 'claim',
        requestId: request.requestId,
        step: null,
      }),
    ]);
    expect(persistence.journalWrites).toHaveLength(0);
    expectNoDownstreamCalls(harness.downstream);
  });

  it('rejects a superseded stale request before command observation or journal access', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const successorRequest = createAwsSingleNodeHostActivationRequest(
      makeReconcileFixture(fixture).requestContext,
    );
    /** @type {AnyRecord[]} */
    const events = [];
    const persistence = await openPersistenceHarness(
      request.deploymentInstanceId,
      events,
    );
    const observer = createObserverHarness(events);
    const authority = createAuthorityHarness(events, (input) =>
      [request.requestId, successorRequest.requestId].includes(
        input.request.requestId,
      ),
    );
    const harness = createKernelHarness(
      persistence,
      observer,
      authority,
      'unknown',
    );

    await expect(harness.kernel.converge(request)).resolves.toMatchObject({
      status: 'pending',
      step: 'runtime-identity',
    });
    await expect(
      harness.kernel.converge(successorRequest),
    ).resolves.toMatchObject({
      status: 'pending',
      step: 'runtime-identity',
    });
    await expect(
      harness.kernel.resume({ requestId: request.requestId }),
    ).rejects.toBeInstanceOf(
      AwsSingleNodeHostActivationPersistenceOperationError,
    );

    expect(observer.inspect).not.toHaveBeenCalled();
    expect(observer.inspectBlankFormat).not.toHaveBeenCalled();
    expect(
      events.some(
        (event) =>
          event.type === 'journal-read' || event.type === 'journal-cas',
      ),
    ).toBe(false);
    expect(persistence.journalWrites).toHaveLength(0);
    const staleClaim = events.findLastIndex(
      (event) =>
        event.type === 'authority' &&
        event.allowed === true &&
        event.purpose === 'claim' &&
        event.requestId === request.requestId,
    );
    const successorFenceRead = events.findIndex(
      (event, index) =>
        index > staleClaim &&
        event.type === 'fence-read' &&
        event.requestId === successorRequest.requestId,
    );
    expect(staleClaim).toBeGreaterThanOrEqual(0);
    expect(successorFenceRead).toBeGreaterThan(staleClaim);
    await expect(
      persistence.persistence.store.readActivationFence(
        request.deploymentInstanceId,
      ),
    ).resolves.toMatchObject({ requestId: successorRequest.requestId });
    expectNoDownstreamCalls(harness.downstream);
  });
});
