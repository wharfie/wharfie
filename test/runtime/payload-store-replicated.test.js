/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from '@jest/globals';

import {
  ExecutionPayloadStoreIntegrityError,
  ExecutionPayloadStoreNotFoundError,
  createLocalExecutionPayloadStore,
} from '../../src/core/lib/payload-store/local.js';
import {
  EXECUTION_PAYLOAD_DISTRIBUTION_ID_PREFIX,
  EXECUTION_PAYLOAD_DISTRIBUTION_KIND,
  assertExecutionPayloadDistributionId,
  assertReplicatedExecutionPayloadStore,
  createReplicatedExecutionPayloadStore,
  normalizeExecutionPayloadDistributionIdentity,
} from '../../src/core/lib/payload-store/replicated.js';

const PAYLOAD_SCHEMA = 'wharfie.execution.activity-evidence.v1';
const STORE_ID = 'shared-execution-payloads';

/** @param {string} seed */
function distributionId(seed) {
  return `${EXECUTION_PAYLOAD_DISTRIBUTION_ID_PREFIX}_${createHash('sha256')
    .update(seed, 'utf8')
    .digest('base64url')}`;
}

function createDistributionIdentity(
  storeId = STORE_ID,
  id = distributionId('shared-distribution'),
) {
  return Object.freeze({
    kind: EXECUTION_PAYLOAD_DISTRIBUTION_KIND,
    distributionId: id,
    storeId,
  });
}

/**
 * Adapt a second local CAS to the deliberately tiny distribution port. The
 * replica wrapper has no filesystem knowledge and receives only immutable
 * references plus exact bytes.
 * @param {ReturnType<typeof createLocalExecutionPayloadStore>} store
 * @param {{publishes: number, reads: number}} [counters]
 */
function createLocalDistribution(store, counters = { publishes: 0, reads: 0 }) {
  return Object.freeze({
    identity: createDistributionIdentity(store.storage.storeId),
    async publishImmutable(/** @type {any} */ input) {
      counters.publishes += 1;
      await store.importBytes(input);
    },
    async readBytes(/** @type {any} */ reference) {
      counters.reads += 1;
      return await store.readBytes(reference);
    },
  });
}

/** @param {(root: string) => Promise<void>} body */
async function withStoreRoot(body) {
  const root = await fsp.mkdtemp(join(tmpdir(), 'wharfie-replicated-payload-'));
  try {
    await body(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

describe('replicated execution payload store', () => {
  it('requires one strict provider-neutral distribution identity', async () => {
    const identity = normalizeExecutionPayloadDistributionIdentity(
      createDistributionIdentity(),
    );
    expect(identity).toEqual({
      kind: 'wharfie.execution-payload-distribution.v1',
      distributionId: distributionId('shared-distribution'),
      storeId: STORE_ID,
    });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(() =>
      assertExecutionPayloadDistributionId(identity.distributionId),
    ).not.toThrow();
    expect(() =>
      assertExecutionPayloadDistributionId(
        identity.distributionId.replace(/^wepd1_/u, 'wpd1_'),
      ),
    ).toThrow(/wepd1_/i);
    expect(() =>
      normalizeExecutionPayloadDistributionIdentity({
        ...identity,
        provider: 's3',
      }),
    ).toThrow(/provider is not supported/i);
    expect(() =>
      normalizeExecutionPayloadDistributionIdentity({
        ...identity,
        kind: 'wharfie.provider-specific.v1',
      }),
    ).toThrow(/kind must be/i);

    await withStoreRoot(async (root) => {
      const localStore = createLocalExecutionPayloadStore({
        path: join(root, 'local'),
        storeId: STORE_ID,
      });
      const distributionStore = createLocalExecutionPayloadStore({
        path: join(root, 'distribution'),
        storeId: 'another-store',
      });
      expect(() =>
        createReplicatedExecutionPayloadStore({
          localStore,
          distribution: createLocalDistribution(distributionStore),
        }),
      ).toThrow(/storeId must match/i);
    });
  });

  it('publishes with verified readback and hydrates an independently empty replica', async () => {
    await withStoreRoot(async (root) => {
      const counters = { publishes: 0, reads: 0 };
      const distributionStore = createLocalExecutionPayloadStore({
        path: join(root, 'distribution'),
        storeId: STORE_ID,
      });
      const distribution = createLocalDistribution(distributionStore, counters);
      const sourceLocal = createLocalExecutionPayloadStore({
        path: join(root, 'source'),
        storeId: STORE_ID,
      });
      const source = createReplicatedExecutionPayloadStore({
        localStore: sourceLocal,
        distribution,
      });
      expect(() => assertReplicatedExecutionPayloadStore(source)).not.toThrow();
      expect(() =>
        assertReplicatedExecutionPayloadStore({ ...source }),
      ).toThrow(/constructed by createReplicatedExecutionPayloadStore/u);
      const reference = await source.putJson({
        payloadSchema: PAYLOAD_SCHEMA,
        value: { z: 1, a: { exact: true } },
      });

      expect(source.distribution).toEqual(distribution.identity);
      expect(counters).toEqual({ publishes: 1, reads: 1 });
      await expect(distributionStore.readJson(reference)).resolves.toEqual({
        a: { exact: true },
        z: 1,
      });

      const replacementLocal = createLocalExecutionPayloadStore({
        path: join(root, 'replacement'),
        storeId: STORE_ID,
      });
      const replacement = createReplicatedExecutionPayloadStore({
        localStore: replacementLocal,
        distribution,
      });
      await expect(replacementLocal.readJson(reference)).rejects.toBeInstanceOf(
        ExecutionPayloadStoreNotFoundError,
      );
      await expect(replacement.readJson(reference)).resolves.toEqual({
        a: { exact: true },
        z: 1,
      });
      expect(counters).toEqual({ publishes: 1, reads: 2 });
      await expect(replacementLocal.verify(reference)).resolves.toEqual(
        reference,
      );

      // A successful distributed fetch is hydrated locally. Losing the test
      // distribution afterward must not trigger a second remote read.
      await fsp.rm(distributionStore.getPath(reference));
      await expect(replacement.readJson(reference)).resolves.toEqual({
        a: { exact: true },
        z: 1,
      });
      expect(counters).toEqual({ publishes: 1, reads: 2 });
    });
  });

  it.each([
    [
      'substituted bytes',
      Buffer.from('{"available":null}'),
      ExecutionPayloadStoreIntegrityError,
    ],
    [
      'truncated bytes',
      Buffer.from('{"available":'),
      ExecutionPayloadStoreIntegrityError,
    ],
    [
      'missing readback',
      new ExecutionPayloadStoreNotFoundError('readback-missing'),
      ExecutionPayloadStoreNotFoundError,
    ],
  ])(
    'rejects publication when distribution readback has %s',
    async (_label, readback, ErrorType) => {
      await withStoreRoot(async (root) => {
        const localStore = createLocalExecutionPayloadStore({
          path: join(root, 'local'),
          storeId: STORE_ID,
        });
        const distribution = Object.freeze({
          identity: createDistributionIdentity(),
          async publishImmutable() {},
          async readBytes() {
            if (readback instanceof Error) throw readback;
            return readback;
          },
        });
        const store = createReplicatedExecutionPayloadStore({
          localStore,
          distribution,
        });

        await expect(
          store.putJson({
            payloadSchema: PAYLOAD_SCHEMA,
            value: { available: true },
          }),
        ).rejects.toBeInstanceOf(ErrorType);

        // Publication failure may leave a safe unreachable local orphan, but
        // does not rewrite or weaken that locally verified content.
        const localReference = await localStore.putJson({
          payloadSchema: PAYLOAD_SCHEMA,
          value: { available: true },
        });
        await expect(localStore.readJson(localReference)).resolves.toEqual({
          available: true,
        });
      });
    },
  );

  it('fails closed on local corruption and falls back only after true absence', async () => {
    await withStoreRoot(async (root) => {
      const counters = { publishes: 0, reads: 0 };
      const distributionStore = createLocalExecutionPayloadStore({
        path: join(root, 'distribution'),
        storeId: STORE_ID,
      });
      const distribution = createLocalDistribution(distributionStore, counters);
      const source = createReplicatedExecutionPayloadStore({
        localStore: createLocalExecutionPayloadStore({
          path: join(root, 'source'),
          storeId: STORE_ID,
        }),
        distribution,
      });
      const reference = await source.putJson({
        payloadSchema: PAYLOAD_SCHEMA,
        value: { retained: true },
      });
      const replacementLocal = createLocalExecutionPayloadStore({
        path: join(root, 'replacement'),
        storeId: STORE_ID,
      });
      const replacement = createReplicatedExecutionPayloadStore({
        localStore: replacementLocal,
        distribution,
      });
      await replacement.readBytes(reference);
      expect(counters).toEqual({ publishes: 1, reads: 2 });

      const sameLengthTamper = Buffer.from('{"retained":null}');
      expect(sameLengthTamper.byteLength).toBe(reference.size);
      await fsp.writeFile(
        replacementLocal.getPath(reference),
        sameLengthTamper,
      );
      await expect(replacement.readBytes(reference)).rejects.toBeInstanceOf(
        ExecutionPayloadStoreIntegrityError,
      );
      expect(counters).toEqual({ publishes: 1, reads: 2 });

      await fsp.rm(replacementLocal.getPath(reference));
      await expect(replacement.readJson(reference)).resolves.toEqual({
        retained: true,
      });
      expect(counters).toEqual({ publishes: 1, reads: 3 });
    });
  });

  it('rejects corrupt distributed bytes before hydrating a fresh replica', async () => {
    await withStoreRoot(async (root) => {
      const source = createLocalExecutionPayloadStore({
        path: join(root, 'source'),
        storeId: STORE_ID,
      });
      const reference = await source.putJson({
        payloadSchema: PAYLOAD_SCHEMA,
        value: { retained: true },
      });
      const distributionStore = createLocalExecutionPayloadStore({
        path: join(root, 'distribution'),
        storeId: STORE_ID,
      });
      await distributionStore.importBytes({
        reference,
        bytes: await source.readBytes(reference),
      });
      await fsp.writeFile(
        distributionStore.getPath(reference),
        Buffer.from('{"retained":null}'),
      );

      const counters = { publishes: 0, reads: 0 };
      const replacementLocal = createLocalExecutionPayloadStore({
        path: join(root, 'replacement'),
        storeId: STORE_ID,
      });
      const replacement = createReplicatedExecutionPayloadStore({
        localStore: replacementLocal,
        distribution: createLocalDistribution(distributionStore, counters),
      });
      await expect(replacement.readBytes(reference)).rejects.toBeInstanceOf(
        ExecutionPayloadStoreIntegrityError,
      );
      expect(counters).toEqual({ publishes: 0, reads: 1 });
      await expect(
        replacementLocal.readBytes(reference),
      ).rejects.toBeInstanceOf(ExecutionPayloadStoreNotFoundError);

      const foreign = createLocalExecutionPayloadStore({
        path: join(root, 'foreign'),
        storeId: 'foreign-execution-payloads',
      });
      const foreignReference = await foreign.putJson({
        payloadSchema: PAYLOAD_SCHEMA,
        value: { retained: true },
      });
      await expect(replacement.readBytes(foreignReference)).rejects.toThrow(
        /different replicated payload store/i,
      );
      expect(counters).toEqual({ publishes: 0, reads: 1 });
    });
  });

  it('falls back only for the requested absence and verifies durable local hydration', async () => {
    await withStoreRoot(async (root) => {
      const distributionStore = createLocalExecutionPayloadStore({
        path: join(root, 'distribution'),
        storeId: STORE_ID,
      });
      const source = createLocalExecutionPayloadStore({
        path: join(root, 'source'),
        storeId: STORE_ID,
      });
      const reference = await source.putJson({
        payloadSchema: PAYLOAD_SCHEMA,
        value: { retained: true },
      });
      await distributionStore.importBytes({
        reference,
        bytes: await source.readBytes(reference),
      });

      const counters = { publishes: 0, reads: 0 };
      const wrongAbsence = new ExecutionPayloadStoreNotFoundError(
        'another-payload',
      );
      const confused = createReplicatedExecutionPayloadStore({
        localStore: {
          storage: source.storage,
          putJson: source.putJson,
          importBytes: source.importBytes,
          async readBytes() {
            throw wrongAbsence;
          },
        },
        distribution: createLocalDistribution(distributionStore, counters),
      });
      await expect(confused.readBytes(reference)).rejects.toBe(wrongAbsence);
      expect(counters.reads).toBe(0);

      const emptyLocal = createLocalExecutionPayloadStore({
        path: join(root, 'empty'),
        storeId: STORE_ID,
      });
      const noOpHydration = createReplicatedExecutionPayloadStore({
        localStore: {
          storage: emptyLocal.storage,
          putJson: emptyLocal.putJson,
          async importBytes(/** @type {{reference: any}} */ input) {
            return input.reference;
          },
          readBytes: emptyLocal.readBytes,
        },
        distribution: createLocalDistribution(distributionStore, counters),
      });
      await expect(noOpHydration.readBytes(reference)).rejects.toBeInstanceOf(
        ExecutionPayloadStoreNotFoundError,
      );
      expect(counters.reads).toBe(1);
    });
  });

  it('never overwrites conflicting content already retained by the distribution', async () => {
    await withStoreRoot(async (root) => {
      const sourceLocal = createLocalExecutionPayloadStore({
        path: join(root, 'source'),
        storeId: STORE_ID,
      });
      const reference = await sourceLocal.putJson({
        payloadSchema: PAYLOAD_SCHEMA,
        value: { retained: true },
      });
      const distributionStore = createLocalExecutionPayloadStore({
        path: join(root, 'distribution'),
        storeId: STORE_ID,
      });
      const distributionPath = distributionStore.getPath(reference);
      const sameLengthTamper = Buffer.from('{"retained":null}');
      await fsp.mkdir(dirname(distributionPath), { recursive: true });
      await fsp.writeFile(distributionPath, sameLengthTamper);
      const source = createReplicatedExecutionPayloadStore({
        localStore: sourceLocal,
        distribution: createLocalDistribution(distributionStore),
      });

      await expect(
        source.putJson({
          payloadSchema: PAYLOAD_SCHEMA,
          value: { retained: true },
        }),
      ).rejects.toBeInstanceOf(ExecutionPayloadStoreIntegrityError);
      await expect(fsp.readFile(distributionPath)).resolves.toEqual(
        sameLengthTamper,
      );
    });
  });
});
