/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { createHash } from 'node:crypto';
import { describe, expect, it, jest } from '@jest/globals';

import {
  ApplicationStateSnapshotIntegrityError,
  ApplicationStateSnapshotNotFoundError,
  assertApplicationStateSnapshotDistribution,
  createApplicationStateSnapshotDistribution,
} from '../../src/core/runtime/application-state-snapshot-distribution.js';
import { createApplicationStateCoordinatorAuthorityRecord } from '../../src/core/lib/db/tables/application-state-authority.js';
import {
  APPLICATION_STATE_SNAPSHOT_DISTRIBUTION_KIND,
  createApplicationStateSnapshotReference,
} from '../../src/core/runtime/application-state-snapshot.js';
import {
  APPLICATION_STATE_HISTORY_CHECKPOINT_KIND,
  APPLICATION_STATE_HISTORY_CHECKPOINT_SCHEMA_VERSION,
} from '../../src/core/runtime/application-state-history-checkpoint.js';

/** @param {string} prefix @param {string} seed */
function id(prefix, seed) {
  return `${prefix}_${createHash('sha256')
    .update(seed, 'utf8')
    .digest('base64url')}`;
}

const APP_ID = 'snapshot-app';
const STORE_ID = id('was', 'snapshot-store');
const FOREIGN_STORE_ID = id('was', 'foreign-snapshot-store');
const DISTRIBUTION_ID = id('wasd1', 'snapshot-distribution');
const AUTHORITY = Object.freeze({
  schemaVersion: 1,
  appId: APP_ID,
  coordinatorId: 'coordinator-a',
  authorityId: id('wca1', 'snapshot-authority'),
  epoch: 7,
});

function destination(storeId = STORE_ID) {
  return {
    kind: 'application-state',
    version: 2,
    bindingId: 'primary',
    configuration: {
      provider: 'lmdb',
      storeId,
      tableName: 'wharfie-application-state-v2',
      namespace: APP_ID,
    },
  };
}

const HISTORY = Object.freeze({
  schemaVersion: APPLICATION_STATE_HISTORY_CHECKPOINT_SCHEMA_VERSION,
  kind: APPLICATION_STATE_HISTORY_CHECKPOINT_KIND,
  appId: APP_ID,
  historyDigest: id('wash1', 'settled-snapshot-history'),
  visitedRuns: 0,
  applicationStateEffects: 0,
  unsettledEffects: 0,
});

const CLOSED_BARRIER = Object.freeze({
  schemaVersion: 1,
  appId: APP_ID,
  state: 'CLOSED',
  version: 4,
  authority: AUTHORITY,
  lastAction: 'close',
  lastRequestId: 'close-for-snapshot',
  updatedAt: 100,
});

function identity(storeId = STORE_ID) {
  return {
    kind: APPLICATION_STATE_SNAPSHOT_DISTRIBUTION_KIND,
    distributionId: DISTRIBUTION_ID,
    storeId,
  };
}

function snapshot(
  bytes = Buffer.from('exact application-state snapshot'),
  storeId = STORE_ID,
  transferSeed = 'snapshot-transfer',
) {
  const sourceDestinationAuthorityDigest =
    createApplicationStateCoordinatorAuthorityRecord({
      storeId,
      namespace: APP_ID,
      authority: AUTHORITY,
    }).record_digest;
  return {
    bytes,
    reference: createApplicationStateSnapshotReference({
      bytes,
      destination: destination(storeId),
      transferId: id('wast1', transferSeed),
      history: HISTORY,
      closedBarrier: CLOSED_BARRIER,
      sourceDestinationAuthorityDigest,
    }),
  };
}

function memoryPort() {
  const objects = new Map();
  const counters = { publishes: 0, reads: 0 };
  const port = {
    identity: identity(),
    async publishImmutable(
      /** @type {{reference: any, bytes: Buffer}} */ input,
    ) {
      const { reference, bytes } = input;
      counters.publishes += 1;
      const retained = objects.get(reference.snapshotId);
      if (retained && !retained.equals(bytes)) {
        throw new ApplicationStateSnapshotIntegrityError(
          reference.snapshotId,
          'immutable distribution conflict',
        );
      }
      objects.set(reference.snapshotId, Buffer.from(bytes));
    },
    async readBytes(/** @type {any} */ reference) {
      counters.reads += 1;
      const retained = objects.get(reference.snapshotId);
      if (!retained) {
        throw new ApplicationStateSnapshotNotFoundError(reference.snapshotId);
      }
      return Buffer.from(retained);
    },
  };
  return { counters, objects, port };
}

describe('application-state snapshot distribution', () => {
  it('publishes only after verified readback and returns independent verified reads', async () => {
    const { bytes, reference } = snapshot();
    const fixture = memoryPort();
    const distribution = createApplicationStateSnapshotDistribution(
      fixture.port,
    );

    await expect(
      distribution.publishImmutable({ reference, bytes }),
    ).resolves.toEqual(reference);
    expect(fixture.counters).toEqual({ publishes: 1, reads: 1 });
    const observed = await distribution.readBytes(reference);
    expect(observed).toEqual(bytes);
    expect(observed).not.toBe(bytes);
    observed.fill(0);
    await expect(distribution.readBytes(reference)).resolves.toEqual(bytes);
    expect(fixture.counters).toEqual({ publishes: 1, reads: 3 });

    expect(distribution.identity).toEqual(identity());
    expect(Object.isFrozen(distribution)).toBe(true);
    expect(Object.isFrozen(distribution.identity)).toBe(true);
    expect(() =>
      assertApplicationStateSnapshotDistribution(distribution),
    ).not.toThrow();
    expect(() =>
      assertApplicationStateSnapshotDistribution({ ...distribution }),
    ).toThrow(/constructed by createApplicationStateSnapshotDistribution/u);
  });

  it('settles response-lost immutable publication through exact readback', async () => {
    const { bytes, reference } = snapshot();
    const objects = new Map();
    const lostResponse = new Error('publication response lost');
    const publishImmutable = jest.fn(async (/** @type {any} */ input) => {
      objects.set(input.reference.snapshotId, Buffer.from(input.bytes));
      throw lostResponse;
    });
    const readBytes = jest.fn(async (/** @type {any} */ candidate) =>
      Buffer.from(objects.get(candidate.snapshotId)),
    );
    const distribution = createApplicationStateSnapshotDistribution({
      identity: identity(),
      publishImmutable,
      readBytes,
    });

    await expect(
      distribution.publishImmutable({ reference, bytes }),
    ).resolves.toEqual(reference);
    await expect(
      distribution.publishImmutable({ reference, bytes }),
    ).resolves.toEqual(reference);
    expect(publishImmutable).toHaveBeenCalledTimes(2);
    expect(readBytes).toHaveBeenCalledTimes(2);
  });

  it('preserves a precommit publication failure when readback proves nothing', async () => {
    const { bytes, reference } = snapshot();
    const precommitFailure = new Error('provider rejected publication');
    const readBytes = jest.fn(async () => {
      throw new ApplicationStateSnapshotNotFoundError(reference.snapshotId);
    });
    const distribution = createApplicationStateSnapshotDistribution({
      identity: identity(),
      async publishImmutable() {
        throw precommitFailure;
      },
      readBytes,
    });

    await expect(
      distribution.publishImmutable({ reference, bytes }),
    ).rejects.toBe(precommitFailure);
    expect(readBytes).toHaveBeenCalledTimes(1);
  });

  it('preserves exact typed absence without classifying it as integrity', async () => {
    const { reference } = snapshot();
    const missing = new ApplicationStateSnapshotNotFoundError(
      reference.snapshotId,
    );
    const distribution = createApplicationStateSnapshotDistribution({
      identity: identity(),
      async publishImmutable() {},
      async readBytes() {
        throw missing;
      },
    });

    await expect(distribution.readBytes(reference)).rejects.toBe(missing);
    expect(missing.snapshotId).toBe(reference.snapshotId);
    expect(missing).not.toBeInstanceOf(ApplicationStateSnapshotIntegrityError);
  });

  it.each([
    ['substituted', Buffer.from('other application-state snapshot')],
    ['truncated', Buffer.from('exact application-state')],
    ['non-byte', 'exact application-state snapshot'],
  ])(
    'rejects %s distributed bytes as integrity failure',
    async (_label, value) => {
      const { reference } = snapshot();
      const distribution = createApplicationStateSnapshotDistribution({
        identity: identity(),
        async publishImmutable() {},
        async readBytes() {
          return value;
        },
      });

      await expect(distribution.readBytes(reference)).rejects.toBeInstanceOf(
        ApplicationStateSnapshotIntegrityError,
      );
    },
  );

  it('verifies publication bytes before invoking the provider', async () => {
    const { bytes, reference } = snapshot();
    const publishImmutable = jest.fn(async () => {});
    const distribution = createApplicationStateSnapshotDistribution({
      identity: identity(),
      publishImmutable,
      async readBytes() {
        return bytes;
      },
    });
    const substituted = Buffer.from(bytes);
    substituted[0] ^= 0xff;

    await expect(
      distribution.publishImmutable({
        reference,
        bytes: substituted,
      }),
    ).rejects.toBeInstanceOf(ApplicationStateSnapshotIntegrityError);
    expect(publishImmutable).not.toHaveBeenCalled();
  });

  it('captures provider methods and identity against later mutation', async () => {
    const { bytes, reference } = snapshot();
    const fixture = memoryPort();
    const distribution = createApplicationStateSnapshotDistribution(
      fixture.port,
    );
    fixture.port.identity.storeId = FOREIGN_STORE_ID;
    fixture.port.publishImmutable = async () => {
      throw new Error('mutated publish method ran');
    };
    fixture.port.readBytes = async () => {
      throw new Error('mutated read method ran');
    };

    await expect(
      distribution.publishImmutable({ reference, bytes }),
    ).resolves.toEqual(reference);
    await expect(distribution.readBytes(reference)).resolves.toEqual(bytes);
    expect(distribution.identity.storeId).toBe(STORE_ID);
    expect(fixture.counters).toEqual({ publishes: 1, reads: 2 });
  });

  it('rejects references from a different snapshot store before provider access', async () => {
    const bytes = Buffer.from('foreign snapshot bytes');
    const { reference } = snapshot(
      bytes,
      FOREIGN_STORE_ID,
      'foreign-snapshot-transfer',
    );
    const publishImmutable = jest.fn(async () => {});
    const readBytes = jest.fn(async () => Buffer.alloc(0));
    const distribution = createApplicationStateSnapshotDistribution({
      identity: identity(),
      publishImmutable,
      readBytes,
    });

    await expect(distribution.readBytes(reference)).rejects.toThrow(
      /different distribution store/u,
    );
    await expect(
      distribution.publishImmutable({ reference, bytes }),
    ).rejects.toThrow(/different distribution store/u);
    expect(publishImmutable).not.toHaveBeenCalled();
    expect(readBytes).not.toHaveBeenCalled();
  });

  it('fails closed when successful publication cannot be read back', async () => {
    const { bytes, reference } = snapshot();
    const readbackFailure = new Error('distribution readback unavailable');
    const distribution = createApplicationStateSnapshotDistribution({
      identity: identity(),
      async publishImmutable() {},
      async readBytes() {
        throw readbackFailure;
      },
    });

    await expect(
      distribution.publishImmutable({ reference, bytes }),
    ).rejects.toBe(readbackFailure);
  });
});
