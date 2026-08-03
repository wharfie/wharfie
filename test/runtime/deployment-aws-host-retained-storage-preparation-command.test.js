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
  createAwsSingleNodeHostRetainedStoragePreparationCommand,
  createAwsSingleNodeHostRetainedStoragePreparationCommandForTest,
} from '../../src/core/runtime/deployment-aws-host-retained-storage-preparation-command.js';
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
  makeFixture,
  makeReconcileFixture,
} from './fixtures/deployment-aws-host-activation.js';

/** @typedef {Record<string, any>} AnyRecord */

const PROFILE_FEATURES = Object.freeze(
  '64bit dir_index dir_nlink ext_attr extent extra_isize filetype flex_bg has_journal huge_file large_file metadata_csum sparse_super'.split(
    ' ',
  ),
);

/** @type {Readonly<AnyRecord>} */
let desired;
/** @type {string} */
let intentId;
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

/** @param {Readonly<AnyRecord>} request @returns {Readonly<AnyRecord>} */
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

/** @param {Readonly<AnyRecord>} request @returns {Promise<Readonly<AnyRecord>>} */
async function captureDesired(request) {
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
      request,
      step: {
        intentId: getAwsSingleNodeHostActivationIntentId(
          request,
          'application-storage',
        ),
        kind: 'application-storage',
        attemptGeneration: 0,
      },
      priorEvidence: { 'runtime-identity': runtimeEvidence(request) },
    }),
  );
  if (captured === undefined) throw new Error('desired state was not captured');
  return captured;
}

/** @param {Readonly<AnyRecord>} desiredValue @returns {Readonly<AnyRecord>} */
function blankProof(desiredValue) {
  return createAwsSingleNodeHostRetainedStorageBlankFormatProof({
    desired: desiredValue,
    device: {
      path: '/dev/nvme1n1',
      major: 259,
      minor: 1,
      nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
      nvmeSerialVolumeId: desiredValue.volumeProviderResourceId,
      byIdPath: getAwsSingleNodeHostRetainedStorageByIdPath(
        desiredValue.volumeProviderResourceId,
      ),
      byIdTarget: '../../nvme1n1',
    },
    mountNamespace: 'mnt:[4026531841]',
  });
}

/** @param {Readonly<AnyRecord>} desiredValue @returns {Readonly<AnyRecord>} */
function profileProof(desiredValue) {
  const target = getAwsSingleNodeHostRetainedStorageFormatTarget(desiredValue);
  return createAwsSingleNodeHostRetainedStorageExactProfileFormatProof({
    desired: desiredValue,
    device: blankProof(desiredValue).device,
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
        features: [...PROFILE_FEATURES],
      },
      journal: { kind: 'internal', inode: 8, sizeBytes: 134_217_728 },
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

/** @param {Readonly<AnyRecord>} desiredValue @param {string} stepIntentId @param {number} [generation] @returns {Readonly<AnyRecord>} */
function prepared(desiredValue, stepIntentId, generation = 0) {
  return createAwsSingleNodeHostRetainedStoragePreparedFormatJournal({
    desired: desiredValue,
    intentId: stepIntentId,
    attemptGeneration: generation,
    blankProof: blankProof(desiredValue),
  });
}

/** @param {Readonly<AnyRecord>} [desiredValue] @param {string} [stepIntentId] @param {number} [generation] @returns {Readonly<AnyRecord>} */
function convergeInput(
  desiredValue = desired,
  stepIntentId = intentId,
  generation = 0,
) {
  return deepFreeze({
    desired: desiredValue,
    intentId: stepIntentId,
    attemptGeneration: generation,
  });
}

/**
 * @param {{
 *   initialJournal?: Readonly<AnyRecord>|null,
 *   inspect?: (desired: Readonly<AnyRecord>) => unknown,
 *   observe?: (desired: Readonly<AnyRecord>) => unknown|Promise<unknown>,
 *   cas?: (input: Readonly<AnyRecord>, state: AnyRecord) => unknown|Promise<unknown>,
 * }} [options]
 * @returns {Readonly<AnyRecord>}
 */
function harness(options = {}) {
  /** @type {string[]} */
  const events = [];
  /** @type {AnyRecord[]} */
  const receivers = [];
  /** @type {AnyRecord} */
  const state = { durable: options.initialJournal ?? null };
  const coarse = Object.freeze({ status: 'ready' });
  const observer = {
    inspect: jest.fn(
      /**
       * @this {AnyRecord}
       * @param {Readonly<AnyRecord>} candidate
       */
      function (candidate) {
        receivers.push(this);
        events.push('inspect');
        return options.inspect === undefined
          ? coarse
          : options.inspect(candidate);
      },
    ),
    inspectBlankFormat: jest.fn(
      /**
       * @this {AnyRecord}
       * @param {Readonly<AnyRecord>} candidate
       */
      async function (candidate) {
        receivers.push(this);
        events.push('observe');
        return options.observe === undefined
          ? deepFreeze({ status: 'blank', proof: blankProof(candidate) })
          : await options.observe(candidate);
      },
    ),
  };
  const journalStore = {
    readRetainedStorageFormatJournal: jest.fn(
      /** @this {AnyRecord} */
      async function () {
        receivers.push(this);
        events.push('read');
        return state.durable;
      },
    ),
    compareAndSetRetainedStorageFormatJournal: jest.fn(
      /**
       * @this {AnyRecord}
       * @param {Readonly<AnyRecord>} input
       */
      async function (input) {
        receivers.push(this);
        events.push('cas');
        if (options.cas !== undefined) return await options.cas(input, state);
        state.durable = input.nextJournal;
        return true;
      },
    ),
  };
  return Object.freeze({
    command: createAwsSingleNodeHostRetainedStoragePreparationCommandForTest({
      observer,
      journalStore,
    }),
    observer,
    journalStore,
    state,
    events,
    receivers,
    coarse,
  });
}

beforeAll(async () => {
  const fixture = makeFixture();
  const request = createAwsSingleNodeHostActivationRequest(
    fixture.requestContext,
  );
  const reconcileRequest = createAwsSingleNodeHostActivationRequest(
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

describe('AWS retained-storage preparation command', () => {
  it('is an exact frozen facade that snapshots methods and preserves receivers', async () => {
    const fixture = harness();

    expect(Object.keys(fixture.command)).toEqual(['inspect', 'converge']);
    expect(Object.isFrozen(fixture.command)).toBe(true);
    expect(fixture.command).not.toHaveProperty('prepare');
    expect(fixture.command).not.toHaveProperty('format');
    expect(fixture.command.inspect(desired)).toBe(fixture.coarse);

    fixture.observer.inspect = () => {
      throw new Error('replacement inspect must not run');
    };
    fixture.observer.inspectBlankFormat = () => {
      throw new Error('replacement blank observer must not run');
    };
    fixture.journalStore.readRetainedStorageFormatJournal = () => {
      throw new Error('replacement read must not run');
    };
    fixture.journalStore.compareAndSetRetainedStorageFormatJournal = () => {
      throw new Error('replacement CAS must not run');
    };

    await expect(fixture.command.converge(convergeInput())).resolves.toBe(
      undefined,
    );
    expect(fixture.events).toEqual([
      'inspect',
      'read',
      'observe',
      'cas',
      'read',
    ]);
    expect(fixture.receivers).toEqual([
      fixture.observer,
      fixture.journalStore,
      fixture.observer,
      fixture.journalStore,
      fixture.journalStore,
    ]);
    expect(fixture.command).not.toHaveProperty('winner');
    expect(fixture.command).not.toHaveProperty('settled');
  });

  it.each(['unknown', 'conflict'])(
    'discards a %s preparation outcome without publishing',
    async (status) => {
      const fixture = harness({
        observe: async () => Object.freeze({ status }),
      });

      await expect(fixture.command.converge(convergeInput())).resolves.toBe(
        undefined,
      );
      expect(fixture.events).toEqual(['read', 'observe']);
      expect(
        fixture.journalStore.compareAndSetRetainedStorageFormatJournal,
      ).not.toHaveBeenCalled();
      expect(fixture.state.durable).toBeNull();
    },
  );

  it('skips blank observation and CAS for prepared, formatted, and adopted histories', async () => {
    const priorPrepared = prepared(desired, intentId, 4);
    const formatted = advanceAwsSingleNodeHostRetainedStorageFormatJournal({
      journal: prepared(desired, intentId),
      profileProof: profileProof(desired),
    });
    const adopted = createAwsSingleNodeHostRetainedStorageAdoptedFormatJournal({
      desired,
      intentId,
      attemptGeneration: 0,
      profileProof: profileProof(desired),
    });

    for (const journal of [priorPrepared, formatted, adopted]) {
      const fixture = harness({ initialJournal: journal });
      await expect(fixture.command.converge(convergeInput())).resolves.toBe(
        undefined,
      );
      expect(fixture.events).toEqual(['read']);
      expect(fixture.observer.inspectBlankFormat).not.toHaveBeenCalled();
      expect(
        fixture.journalStore.compareAndSetRetainedStorageFormatJournal,
      ).not.toHaveBeenCalled();
    }
  });

  it.each(['throw', 'false', 'nonboolean'])(
    'recovers ambiguous %s publication only through durable readback',
    async (mode) => {
      const fixture = harness({
        cas: async (input, state) => {
          state.durable = input.nextJournal;
          if (mode === 'throw') throw new Error('lost publication response');
          if (mode === 'false') return false;
          return 'true';
        },
      });

      await expect(fixture.command.converge(convergeInput())).resolves.toBe(
        undefined,
      );
      expect(fixture.events).toEqual(['read', 'observe', 'cas', 'read']);
      expect(fixture.state.durable).toMatchObject({ phase: 'prepared' });
    },
  );

  it('reuses stable-target history across request churn', async () => {
    const prior = prepared(desired, intentId, 3);
    const fixture = harness({ initialJournal: prior });

    await expect(
      fixture.command.converge(
        convergeInput(reconcileDesired, reconcileIntentId, 9),
      ),
    ).resolves.toBe(undefined);
    expect(
      getAwsSingleNodeHostRetainedStorageFormatTarget(reconcileDesired),
    ).toEqual(getAwsSingleNodeHostRetainedStorageFormatTarget(desired));
    expect(fixture.events).toEqual(['read']);
    expect(fixture.state.durable).toBe(prior);
  });

  it('delegates malformed convergence input before any asynchronous port', async () => {
    const fixture = harness();
    const accessor = { intentId, attemptGeneration: 0 };
    Object.defineProperty(accessor, 'desired', {
      enumerable: true,
      get() {
        throw new Error('input accessor must not run');
      },
    });

    await expect(fixture.command.converge(accessor)).rejects.toThrow(
      'AWS single-node host retained-storage format preparation input is invalid.',
    );
    expect(fixture.events).toEqual([]);
  });

  it('rejects non-exact options and ports without invoking accessors', () => {
    const valid = harness();
    const observer = {
      inspect() {},
      inspectBlankFormat() {
        return { status: 'unknown' };
      },
    };
    const journalStore = {
      readRetainedStorageFormatJournal() {
        return null;
      },
      compareAndSetRetainedStorageFormatJournal() {
        return false;
      },
    };
    const accessorOptions = { journalStore };
    Object.defineProperty(accessorOptions, 'observer', {
      enumerable: true,
      get() {
        throw new Error('option accessor must not run');
      },
    });
    const accessorObserver = {
      inspectBlankFormat: observer.inspectBlankFormat,
    };
    Object.defineProperty(accessorObserver, 'inspect', {
      enumerable: true,
      get() {
        throw new Error('port accessor must not run');
      },
    });

    expect(() =>
      createAwsSingleNodeHostRetainedStoragePreparationCommand({
        journalStore,
        observer,
      }),
    ).toThrow(
      'AWS single-node host retained-storage preparation command options are invalid.',
    );
    expect(() =>
      createAwsSingleNodeHostRetainedStoragePreparationCommandForTest(
        accessorOptions,
      ),
    ).toThrow(
      'AWS single-node host retained-storage preparation command test options are invalid.',
    );
    expect(() =>
      createAwsSingleNodeHostRetainedStoragePreparationCommandForTest({
        observer: accessorObserver,
        journalStore,
      }),
    ).toThrow(
      'AWS single-node host retained-storage preparation command observer is invalid.',
    );
    expect(() =>
      createAwsSingleNodeHostRetainedStoragePreparationCommandForTest({
        observer,
        journalStore: { ...journalStore, extra: true },
      }),
    ).toThrow(
      'AWS single-node host retained-storage preparation command journal store is invalid.',
    );
    expect(valid.command).toEqual({
      inspect: expect.any(Function),
      converge: expect.any(Function),
    });
  });
});
