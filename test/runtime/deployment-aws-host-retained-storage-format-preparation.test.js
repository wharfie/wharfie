import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import { createAwsSingleNodeHostActivationRequest } from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import { getAwsSingleNodeHostActivationIntentId } from '../../src/core/runtime/deployment-aws-host-activation.js';
import {
  advanceAwsSingleNodeHostRetainedStorageFormatJournal,
  createAwsSingleNodeHostRetainedStorageAdoptedFormatJournal,
  createAwsSingleNodeHostRetainedStorageBlankFormatProof,
  createAwsSingleNodeHostRetainedStorageExactProfileFormatProof,
  createAwsSingleNodeHostRetainedStoragePreparedFormatJournal,
  getAwsSingleNodeHostRetainedStorageFormatTarget,
  getAwsSingleNodeHostRetainedStorageProfileMarkerId,
} from '../../src/core/runtime/deployment-aws-host-retained-storage-format-journal.js';
import {
  AwsSingleNodeHostRetainedStorageFormatPreparationUnknownError,
  createAwsSingleNodeHostRetainedStorageFormatPreparation,
} from '../../src/core/runtime/deployment-aws-host-retained-storage-format-preparation.js';
import {
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
  createAwsSingleNodeHostApplicationStorageAdapter,
} from '../../src/core/runtime/deployment-aws-host-retained-storage.js';
import { getAwsSingleNodeHostRetainedStorageByIdPath } from '../../src/core/runtime/deployment-aws-host-retained-storage-projection.js';
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID,
} from '../../src/core/runtime/deployment-aws-host-runtime-account.js';
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
} from '../../src/core/runtime/deployment-aws-host-runtime-identity.js';
import {
  clone,
  expectDeepFrozen,
  makeFixture,
  makeReconcileFixture,
} from './fixtures/deployment-aws-host-activation.js';

/** @typedef {Record<string, any>} AnyRecord */

const EXPECTED_PROFILE_FEATURES = Object.freeze([
  '64bit',
  'dir_index',
  'dir_nlink',
  'ext_attr',
  'extent',
  'extra_isize',
  'filetype',
  'flex_bg',
  'has_journal',
  'huge_file',
  'large_file',
  'metadata_csum',
  'sparse_super',
]);

/** @type {Readonly<AnyRecord>} */
let request;
/** @type {Readonly<AnyRecord>} */
let desired;
/** @type {string} */
let intentId;
/** @type {Readonly<AnyRecord>} */
let reconcileRequest;
/** @type {Readonly<AnyRecord>} */
let reconcileDesired;
/** @type {string} */
let reconcileIntentId;

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @returns {{promise: Promise<void>, resolve: () => void}} */
function deferred() {
  /** @type {() => void} */
  let settlePromise = () => {};
  const promise = new Promise((resolve) => {
    settlePromise = () => resolve(undefined);
  });
  return { promise, resolve: settlePromise };
}

/** @param {Readonly<AnyRecord>} requestValue @returns {Readonly<AnyRecord>} */
function runtimeEvidence(requestValue) {
  return deepFreeze({
    schemaVersion:
      AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
    requestId: requestValue.requestId,
    accountId: requestValue.providerScope.accountId,
    userId: `${requestValue.runtimeRoleId}:${requestValue.nodeProviderResourceId}`,
    arn: `arn:${requestValue.providerScope.partition}:sts::${requestValue.providerScope.accountId}:assumed-role/${requestValue.runtimeRoleName}/${requestValue.nodeProviderResourceId}`,
  });
}

/**
 * Capture the adapter-owned desired document instead of duplicating its schema.
 * @param {Readonly<AnyRecord>} requestValue - Exact activation request.
 * @returns {Promise<Readonly<AnyRecord>>} - Canonical desired state.
 */
async function captureDesired(requestValue) {
  /** @type {Readonly<AnyRecord>|undefined} */
  let captured;
  const adapter = createAwsSingleNodeHostApplicationStorageAdapter({
    command: {
      inspect(/** @type {Readonly<AnyRecord>} */ candidate) {
        captured = candidate;
        return { status: 'ready' };
      },
      converge() {
        throw new Error('desired capture must not converge');
      },
    },
  });
  await adapter.observe(
    deepFreeze({
      request: requestValue,
      step: {
        intentId: getAwsSingleNodeHostActivationIntentId(
          requestValue,
          'application-storage',
        ),
        kind: 'application-storage',
        attemptGeneration: 0,
      },
      priorEvidence: {
        'runtime-identity': runtimeEvidence(requestValue),
      },
    }),
  );
  if (captured === undefined) throw new Error('desired state was not captured');
  return captured;
}

/**
 * @param {Readonly<AnyRecord>} desiredValue - Exact desired state.
 * @param {number} [minor] - Synthetic NVMe minor.
 * @returns {Readonly<AnyRecord>} - Closed blank proof fixture.
 */
function createBlankProof(desiredValue, minor = 1) {
  return createAwsSingleNodeHostRetainedStorageBlankFormatProof({
    desired: desiredValue,
    device: {
      path: `/dev/nvme${minor}n1`,
      major: 259,
      minor,
      nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
      nvmeSerialVolumeId: desiredValue.volumeProviderResourceId,
      byIdPath: getAwsSingleNodeHostRetainedStorageByIdPath(
        desiredValue.volumeProviderResourceId,
      ),
      byIdTarget: `../../nvme${minor}n1`,
    },
    mountNamespace: 'mnt:[4026531841]',
  });
}

/**
 * @param {Readonly<AnyRecord>} desiredValue - Exact desired state.
 * @param {number} [minor] - Synthetic NVMe minor.
 * @returns {Readonly<AnyRecord>} - Closed exact-profile proof fixture.
 */
function createProfileProof(desiredValue, minor = 1) {
  const target = getAwsSingleNodeHostRetainedStorageFormatTarget(desiredValue);
  return createAwsSingleNodeHostRetainedStorageExactProfileFormatProof({
    desired: desiredValue,
    device: {
      path: `/dev/nvme${minor}n1`,
      major: 259,
      minor,
      nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
      nvmeSerialVolumeId: desiredValue.volumeProviderResourceId,
      byIdPath: getAwsSingleNodeHostRetainedStorageByIdPath(
        desiredValue.volumeProviderResourceId,
      ),
      byIdTarget: `../../nvme${minor}n1`,
    },
    mountNamespace: 'mnt:[4026531841]',
    profile: {
      profileId: 'wharfie-ext4-v1',
      markerId: getAwsSingleNodeHostRetainedStorageProfileMarkerId(target),
      filesystem: {
        type: 'ext4',
        uuid: target.filesystem.uuid,
        label: 'wharfie-v1',
        blockSizeBytes: 4096,
        inodeSizeBytes: 256,
        reservedBlockCount: 0,
        creatorOs: 'Linux',
        revision: 'dynamic',
        errorsBehavior: 'remount-ro',
        defaultMountOptions: [],
        directoryHashAlgorithm: 'half_md4',
        directoryHashSeed: target.filesystem.uuid,
        features: [...EXPECTED_PROFILE_FEATURES],
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
    },
  });
}

/**
 * @param {Readonly<AnyRecord>} desiredValue - Exact desired state.
 * @param {string} stepIntentId - Exact current intent.
 * @param {number} [attemptGeneration] - Attempt generation.
 * @param {number} [minor] - Synthetic NVMe minor.
 * @returns {Readonly<AnyRecord>} - Prepared journal.
 */
function createPrepared(
  desiredValue,
  stepIntentId,
  attemptGeneration = 0,
  minor = 1,
) {
  return createAwsSingleNodeHostRetainedStoragePreparedFormatJournal({
    desired: desiredValue,
    intentId: stepIntentId,
    attemptGeneration,
    blankProof: createBlankProof(desiredValue, minor),
  });
}

/**
 * @param {Readonly<AnyRecord>} desiredValue - Exact desired state.
 * @param {string} stepIntentId - Exact current intent.
 * @returns {Readonly<AnyRecord>} - Terminal formatted journal.
 */
function createFormatted(desiredValue, stepIntentId) {
  return advanceAwsSingleNodeHostRetainedStorageFormatJournal({
    journal: createPrepared(desiredValue, stepIntentId),
    profileProof: createProfileProof(desiredValue),
  });
}

/**
 * @param {Readonly<AnyRecord>} desiredValue - Exact desired state.
 * @param {string} stepIntentId - Exact current intent.
 * @returns {Readonly<AnyRecord>} - Terminal adopted-profile journal.
 */
function createAdopted(desiredValue, stepIntentId) {
  return createAwsSingleNodeHostRetainedStorageAdoptedFormatJournal({
    desired: desiredValue,
    intentId: stepIntentId,
    attemptGeneration: 0,
    profileProof: createProfileProof(desiredValue),
  });
}

/**
 * @param {{
 *   initialJournal?: unknown,
 *   observe?: (desired: Readonly<AnyRecord>) => unknown|Promise<unknown>,
 *   read?: (desired: Readonly<AnyRecord>, state: AnyRecord) => unknown|Promise<unknown>,
 *   cas?: (input: Readonly<AnyRecord>, state: AnyRecord) => unknown|Promise<unknown>,
 *   events?: string[],
 * }} [options]
 * @returns {Readonly<AnyRecord>} - Preparation and synthetic port harness.
 */
function createHarness(options = {}) {
  /** @type {AnyRecord} */
  const state = {
    durable: options.initialJournal ?? null,
    readCount: 0,
  };
  /** @type {string[]} */
  const events = options.events ?? [];
  const inspect = jest.fn();
  const inspectBlankFormat = jest.fn(
    async (/** @type {Readonly<AnyRecord>} */ candidate) => {
      events.push('observe');
      return options.observe === undefined
        ? deepFreeze({
            status: 'blank',
            proof: createBlankProof(candidate),
          })
        : await options.observe(candidate);
    },
  );
  const readRetainedStorageFormatJournal = jest.fn(
    async (/** @type {Readonly<AnyRecord>} */ candidate) => {
      events.push('read');
      state.readCount += 1;
      return options.read === undefined
        ? state.durable
        : await options.read(candidate, state);
    },
  );
  const compareAndSetRetainedStorageFormatJournal = jest.fn(
    async (/** @type {Readonly<AnyRecord>} */ input) => {
      events.push('cas');
      if (options.cas !== undefined) return await options.cas(input, state);
      state.durable = input.nextJournal;
      return true;
    },
  );
  const observer = Object.freeze({ inspect, inspectBlankFormat });
  const journalStore = Object.freeze({
    readRetainedStorageFormatJournal,
    compareAndSetRetainedStorageFormatJournal,
  });
  return Object.freeze({
    preparation: createAwsSingleNodeHostRetainedStorageFormatPreparation({
      observer,
      journalStore,
    }),
    observer,
    journalStore,
    state,
    events,
  });
}

/** @param {Readonly<AnyRecord>} [desiredValue] @param {string} [stepIntentId] @param {number} [attemptGeneration] @returns {AnyRecord} */
function prepareInput(
  desiredValue = desired,
  stepIntentId = intentId,
  attemptGeneration = 0,
) {
  return {
    desired: desiredValue,
    intentId: stepIntentId,
    attemptGeneration,
  };
}

beforeAll(async () => {
  const fixture = makeFixture();
  request = createAwsSingleNodeHostActivationRequest(fixture.requestContext);
  reconcileRequest = createAwsSingleNodeHostActivationRequest(
    makeReconcileFixture(fixture).requestContext,
  );
  desired = await captureDesired(request);
  reconcileDesired = await captureDesired(reconcileRequest);
  intentId = getAwsSingleNodeHostActivationIntentId(
    request,
    'application-storage',
  );
  reconcileIntentId = getAwsSingleNodeHostActivationIntentId(
    reconcileRequest,
    'application-storage',
  );
});

describe('AWS single-node retained-storage format preparation', () => {
  it('publishes blank preparation and settles only from exact durable readback', async () => {
    /** @type {string[]} */
    const events = [];
    const harness = createHarness({ events });

    const result = await harness.preparation.prepare(prepareInput());

    expect(events).toEqual(['read', 'observe', 'cas', 'read']);
    expect(result).toEqual({
      status: 'prepared',
      journal: harness.state.durable,
    });
    expect(result).not.toHaveProperty('won');
    expect(result.journal).toMatchObject({
      phase: 'prepared',
      origin: 'blank-format',
      attempt: {
        requestId: desired.requestId,
        intentId,
        attemptGeneration: 0,
      },
    });
    expectDeepFrozen(result);
    expect(harness.observer.inspect).not.toHaveBeenCalled();
    expect(harness.observer.inspectBlankFormat).toHaveBeenCalledWith(desired);
    expect(
      harness.journalStore.compareAndSetRetainedStorageFormatJournal,
    ).toHaveBeenCalledWith({
      desired,
      expectedJournalId: null,
      nextJournal: result.journal,
    });
  });

  it.each(['unknown', 'conflict'])(
    'returns closed %s observation without publishing',
    async (status) => {
      const harness = createHarness({
        observe: async () => Object.freeze({ status }),
      });

      const result = await harness.preparation.prepare(prepareInput());

      expect(result).toEqual({ status });
      expectDeepFrozen(result);
      expect(
        harness.journalStore.compareAndSetRetainedStorageFormatJournal,
      ).not.toHaveBeenCalled();
      expect(
        harness.journalStore.readRetainedStorageFormatJournal,
      ).toHaveBeenCalledTimes(1);
    },
  );

  it('returns immutable prepared and terminal journals without observing or writing', async () => {
    const prepared = createPrepared(desired, intentId, 4);
    const formatted = createFormatted(desired, intentId);
    const adopted = createAdopted(desired, intentId);

    for (const journal of [prepared, formatted, adopted]) {
      const harness = createHarness({ initialJournal: journal });
      const result = await harness.preparation.prepare(prepareInput());

      expect(result).toEqual({ status: journal.phase, journal });
      expectDeepFrozen(result);
      expect(harness.observer.inspectBlankFormat).not.toHaveBeenCalled();
      expect(
        harness.journalStore.compareAndSetRetainedStorageFormatJournal,
      ).not.toHaveBeenCalled();
      expect(
        harness.journalStore.readRetainedStorageFormatJournal,
      ).toHaveBeenCalledTimes(1);
    }
  });

  it('reuses stable target truth across volatile request churn', async () => {
    const prior = createPrepared(desired, intentId, 3);
    const harness = createHarness({ initialJournal: prior });

    const result = await harness.preparation.prepare(
      prepareInput(reconcileDesired, reconcileIntentId, 9),
    );

    expect(result).toEqual({ status: 'prepared', journal: prior });
    expect(result.journal.attempt).toEqual(prior.attempt);
    expect(
      getAwsSingleNodeHostRetainedStorageFormatTarget(reconcileDesired),
    ).toEqual(getAwsSingleNodeHostRetainedStorageFormatTarget(desired));
    expect(harness.observer.inspectBlankFormat).not.toHaveBeenCalled();
    expect(
      harness.journalStore.compareAndSetRetainedStorageFormatJournal,
    ).not.toHaveBeenCalled();
  });

  it('returns a concurrent durable journal after losing the null CAS', async () => {
    const concurrent = createPrepared(desired, intentId, 7, 2);
    /** @type {Readonly<AnyRecord>|undefined} */
    let localCandidate;
    const harness = createHarness({
      cas: async (input, state) => {
        localCandidate = input.nextJournal;
        state.durable = concurrent;
        return false;
      },
    });

    const result = await harness.preparation.prepare(prepareInput());

    expect(result).toEqual({ status: 'prepared', journal: concurrent });
    expect(result.journal.journalId).not.toBe(localCandidate?.journalId);
    expect(
      harness.journalStore.readRetainedStorageFormatJournal,
    ).toHaveBeenCalledTimes(2);
  });

  it('recovers a thrown CAS response only through validated durable truth', async () => {
    const responseLoss = new Error('simulated publication response loss');
    const harness = createHarness({
      cas: async (input, state) => {
        state.durable = input.nextJournal;
        throw responseLoss;
      },
    });

    const result = await harness.preparation.prepare(prepareInput());

    expect(result).toEqual({
      status: 'prepared',
      journal: harness.state.durable,
    });
    expect(
      harness.journalStore.compareAndSetRetainedStorageFormatJournal,
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.journalStore.readRetainedStorageFormatJournal,
    ).toHaveBeenCalledTimes(2);
  });

  it('rethrows a failed CAS when exact readback proves absence', async () => {
    const responseLoss = new Error('simulated publication failure');
    const harness = createHarness({
      cas: async () => {
        throw responseLoss;
      },
    });

    await expect(harness.preparation.prepare(prepareInput())).rejects.toBe(
      responseLoss,
    );
    expect(
      harness.journalStore.readRetainedStorageFormatJournal,
    ).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])(
    'fails closed when CAS returns %s but durable readback is absent',
    async (applied) => {
      const harness = createHarness({ cas: async () => applied });

      await expect(
        harness.preparation.prepare(prepareInput()),
      ).rejects.toBeInstanceOf(
        AwsSingleNodeHostRetainedStorageFormatPreparationUnknownError,
      );
      expect(
        harness.journalStore.readRetainedStorageFormatJournal,
      ).toHaveBeenCalledTimes(2);
    },
  );

  it('ignores a non-boolean CAS response when durable readback succeeds', async () => {
    const harness = createHarness({
      cas: async (input, state) => {
        state.durable = input.nextJournal;
        return 'true';
      },
    });

    const result = await harness.preparation.prepare(prepareInput());
    expect(result).toEqual({
      status: 'prepared',
      journal: harness.state.durable,
    });
    expect(
      harness.journalStore.readRetainedStorageFormatJournal,
    ).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-boolean CAS response when durable readback is absent', async () => {
    const harness = createHarness({ cas: async () => 'true' });

    await expect(harness.preparation.prepare(prepareInput())).rejects.toThrow(
      'compareAndSetRetainedStorageFormatJournal must return a boolean.',
    );
    expect(
      harness.journalStore.readRetainedStorageFormatJournal,
    ).toHaveBeenCalledTimes(2);
  });

  it('propagates exact readback corruption even after a thrown CAS', async () => {
    const responseLoss = new Error('simulated publication response loss');
    const harness = createHarness({
      cas: async (_input, state) => {
        state.durable = {};
        throw responseLoss;
      },
    });

    await expect(harness.preparation.prepare(prepareInput())).rejects.not.toBe(
      responseLoss,
    );
    expect(
      harness.journalStore.readRetainedStorageFormatJournal,
    ).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed or mismatched observations without writing', async () => {
    const wrongDesired = /** @type {AnyRecord} */ (clone(desired));
    wrongDesired.sizeBytes += 1;
    const malformed = [
      { status: 'ready' },
      { status: 'blank' },
      { status: 'unknown', proof: null },
      { status: 'blank', proof: createBlankProof(desired), extra: true },
      {
        status: 'blank',
        proof: createBlankProof(wrongDesired),
      },
    ];

    for (const observation of malformed) {
      const harness = createHarness({ observe: async () => observation });
      await expect(
        harness.preparation.prepare(prepareInput()),
      ).rejects.toThrow();
      expect(
        harness.journalStore.compareAndSetRetainedStorageFormatJournal,
      ).not.toHaveBeenCalled();
    }

    const accessor = {};
    Object.defineProperty(accessor, 'status', {
      enumerable: true,
      get() {
        throw new Error('must not invoke observation accessor');
      },
    });
    const harness = createHarness({ observe: async () => accessor });
    await expect(harness.preparation.prepare(prepareInput())).rejects.toThrow(
      'AWS single-node host retained-storage blank observation is invalid.',
    );
    expect(
      harness.journalStore.compareAndSetRetainedStorageFormatJournal,
    ).not.toHaveBeenCalled();
  });

  it('snapshots the entire request before the first await', async () => {
    const entered = deferred();
    const release = deferred();
    const originalDesired = clone(desired);
    const input = prepareInput(originalDesired);
    const harness = createHarness({
      read: async (_candidate, state) => {
        if (state.readCount === 1) {
          entered.resolve();
          await release.promise;
          return null;
        }
        return state.durable;
      },
    });

    const preparing = harness.preparation.prepare(input);
    await entered.promise;
    input.desired.sizeBytes += 1;
    input.intentId = 'changed-after-call';
    input.attemptGeneration = 91;
    release.resolve();

    const result = await preparing;
    expect(result.status).toBe('prepared');
    expect(result.journal.target).toEqual(
      getAwsSingleNodeHostRetainedStorageFormatTarget(desired),
    );
    expect(result.journal.attempt).toEqual({
      requestId: desired.requestId,
      intentId,
      attemptGeneration: 0,
    });
    expect(harness.observer.inspectBlankFormat).toHaveBeenCalledWith(desired);
  });

  it('rejects invalid exact input before calling any asynchronous port', async () => {
    const invalid = [
      { desired, intentId },
      { desired, intentId, attemptGeneration: -1 },
      { desired, intentId, attemptGeneration: 0, extra: true },
      {
        desired,
        intentId: reconcileIntentId,
        attemptGeneration: 0,
      },
    ];
    for (const input of invalid) {
      const harness = createHarness();
      await expect(harness.preparation.prepare(input)).rejects.toThrow(
        'AWS single-node host retained-storage format preparation input is invalid.',
      );
      expect(
        harness.journalStore.readRetainedStorageFormatJournal,
      ).not.toHaveBeenCalled();
      expect(harness.observer.inspectBlankFormat).not.toHaveBeenCalled();
    }

    const accessor = {
      intentId,
      attemptGeneration: 0,
    };
    Object.defineProperty(accessor, 'desired', {
      enumerable: true,
      get() {
        throw new Error('must not invoke prepare accessor');
      },
    });
    const harness = createHarness();
    await expect(harness.preparation.prepare(accessor)).rejects.toThrow(
      'AWS single-node host retained-storage format preparation input is invalid.',
    );
    expect(
      harness.journalStore.readRetainedStorageFormatJournal,
    ).not.toHaveBeenCalled();
  });

  it('captures exact port methods once and preserves their receivers', async () => {
    /** @type {AnyRecord|null} */
    let durable = null;
    const observer = {
      inspect() {},
      async inspectBlankFormat(/** @type {Readonly<AnyRecord>} */ candidate) {
        expect(this).toBe(observer);
        return deepFreeze({
          status: 'blank',
          proof: createBlankProof(candidate),
        });
      },
    };
    const journalStore = {
      async readRetainedStorageFormatJournal() {
        expect(this).toBe(journalStore);
        return durable;
      },
      async compareAndSetRetainedStorageFormatJournal(
        /** @type {Readonly<AnyRecord>} */ input,
      ) {
        expect(this).toBe(journalStore);
        durable = input.nextJournal;
        return true;
      },
    };
    const preparation = createAwsSingleNodeHostRetainedStorageFormatPreparation(
      {
        observer,
        journalStore,
      },
    );
    observer.inspectBlankFormat = async () => {
      throw new Error('replacement observer method must not run');
    };
    journalStore.readRetainedStorageFormatJournal = async () => {
      throw new Error('replacement read method must not run');
    };
    journalStore.compareAndSetRetainedStorageFormatJournal = async () => {
      throw new Error('replacement CAS method must not run');
    };

    await expect(preparation.prepare(prepareInput())).resolves.toEqual({
      status: 'prepared',
      journal: expect.objectContaining({ phase: 'prepared' }),
    });
    expect(Object.isFrozen(preparation)).toBe(true);
  });

  it('rejects non-exact factory ports without invoking accessors', () => {
    const read = async () => null;
    const cas = async () => false;
    const observer = {
      inspect() {},
      inspectBlankFormat() {
        return { status: 'unknown' };
      },
    };
    const journalStore = {
      readRetainedStorageFormatJournal: read,
      compareAndSetRetainedStorageFormatJournal: cas,
    };

    expect(() =>
      createAwsSingleNodeHostRetainedStorageFormatPreparation({
        observer: { ...observer, extra() {} },
        journalStore,
      }),
    ).toThrow(
      'AWS single-node host retained-storage format preparation observer is invalid.',
    );
    expect(() =>
      createAwsSingleNodeHostRetainedStorageFormatPreparation({
        observer,
        journalStore: {
          ...journalStore,
          compareAndSetRetainedStorageFormatJournal: false,
        },
      }),
    ).toThrow(
      'AWS single-node host retained-storage format preparation journal store is invalid.',
    );

    const accessor = { observer };
    Object.defineProperty(accessor, 'journalStore', {
      enumerable: true,
      get() {
        throw new Error('must not invoke options accessor');
      },
    });
    expect(() =>
      createAwsSingleNodeHostRetainedStorageFormatPreparation(accessor),
    ).toThrow(
      'AWS single-node host retained-storage format preparation options are invalid.',
    );
  });
});
