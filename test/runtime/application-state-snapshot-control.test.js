/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { APPLICATION_STATE_TABLE_NAME } from '../../src/core/lib/config/db.js';
import {
  createCoordinatorAuthority,
  createCoordinatorAuthorityToken,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import {
  createCoordinatorQuiescenceBarrier,
  createCoordinatorQuiescenceBarrierFence,
} from '../../src/core/lib/db/tables/coordinator-quiescence-barrier.js';
import {
  APPLICATION_STATE_SNAPSHOT_ACTIVATION_SORT_KEY,
  APPLICATION_STATE_SNAPSHOT_PUBLICATION_SORT_KEY,
  ApplicationStateSnapshotActivationConflictError,
  ApplicationStateSnapshotControlRecordError,
  ApplicationStateSnapshotPublicationConflictError,
  ApplicationStateSnapshotPublicationMissingError,
  createApplicationStateSnapshotControlStore,
  getApplicationStateSnapshotControlPartitionKey,
} from '../../src/core/runtime/application-state-snapshot-control.js';
import {
  APPLICATION_STATE_SNAPSHOT_TRANSPORT_KIND,
  createApplicationStateSnapshotReference,
  normalizeApplicationStateSnapshotTransport,
} from '../../src/core/runtime/application-state-snapshot.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import { createTestApplicationStateTransport } from '../helpers/application-state-snapshot.js';
import {
  createMockedDynamoDB,
  createVanillaDB,
} from '../helpers/db-adapters.js';

const TABLE_NAME = 'application-state-snapshot-control';

/** @type {Array<() => Promise<void>>} */
let cleanups = [];

afterEach(async () => {
  const pending = cleanups;
  cleanups = [];
  const results = await Promise.allSettled(
    pending.map(async (cleanup) => await cleanup()),
  );
  const failures = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, 'snapshot control cleanup failed');
  }
});

/** @typedef {{name: string, create: () => Promise<{db: import('../../src/core/lib/db/base.js').DBClient, cleanup: () => Promise<void>}>}} AdapterCase */

/** @type {AdapterCase[]} */
const adapterCases = [
  {
    name: 'vanilla',
    async create() {
      const path = mkdtempSync(join(tmpdir(), 'wharfie-snapshot-control-'));
      const db = await createVanillaDB(path);
      return {
        db,
        async cleanup() {
          await db.close();
          rmSync(path, { recursive: true, force: true });
        },
      };
    },
  },
  {
    name: 'mocked DynamoDB',
    async create() {
      const { db } = await createMockedDynamoDB({
        tableSchemas: { [TABLE_NAME]: ['run_id', 'sort_key'] },
      });
      return {
        db,
        async cleanup() {
          await db.close();
        },
      };
    },
  },
];

/** @param {AdapterCase} adapterCase */
async function createAdapter(adapterCase) {
  const result = await adapterCase.create();
  cleanups.push(result.cleanup);
  return result.db;
}

/** @param {string} prefix @param {string} label */
function id(prefix, label) {
  return createCanonicalJsonSha256Id({
    domain: `wharfie:test:application-state-snapshot-control:${prefix}`,
    prefix,
    value: { label },
  });
}

/** @param {string} appId @param {string} label */
function destination(appId, label) {
  return Object.freeze({
    kind: 'application-state',
    version: 2,
    bindingId: 'primary',
    configuration: Object.freeze({
      provider: 'lmdb',
      storeId: id('was', `store-${label}`),
      tableName: APPLICATION_STATE_TABLE_NAME,
      namespace: appId,
    }),
  });
}

/** @param {unknown} value */
function expectDeepFrozen(value) {
  expect(Object.isFrozen(value)).toBe(true);
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) expectDeepFrozen(nested);
  }
}

/**
 * @param {import('../../src/core/lib/db/base.js').DBClient} db
 * @param {string} appId
 * @param {string} label
 */
async function createSource(db, appId, label) {
  const authorities = createCoordinatorAuthority({
    db,
    tableName: TABLE_NAME,
  });
  const barriers = createCoordinatorQuiescenceBarrier({
    db,
    tableName: TABLE_NAME,
  });
  const acquired = await authorities.acquire({
    appId,
    coordinatorId: `source-${label}`,
    requestId: `acquire-${label}`,
    observedAt: 1,
  });
  const sourceAuthority = createCoordinatorAuthorityToken(acquired.authority);
  const closed = await barriers.close({
    authority: sourceAuthority,
    requestId: `close-${label}`,
    predecessor: null,
    observedAt: 2,
  });
  const transport = createTestApplicationStateTransport({
    destination: destination(appId, label),
    authority: sourceAuthority,
    barrier: closed.barrier,
    label,
  });
  return {
    authorities,
    barriers,
    acquired: acquired.authority,
    sourceAuthority,
    sourceBarrier: closed.barrier,
    transport,
  };
}

/** @param {ReturnType<typeof createTestApplicationStateTransport>} transport */
function alternateTransport(transport) {
  const snapshot = createApplicationStateSnapshotReference({
    bytes: Buffer.from('different immutable snapshot bytes', 'utf8'),
    destination: transport.snapshot.destination,
    transferId: transport.snapshot.transferId,
    history: transport.snapshot.checkpoint.history,
    closedBarrier: transport.snapshot.checkpoint.sourceBarrier,
    sourceDestinationAuthorityDigest:
      transport.snapshot.checkpoint.sourceDestinationAuthorityDigest,
  });
  return normalizeApplicationStateSnapshotTransport({
    kind: APPLICATION_STATE_SNAPSHOT_TRANSPORT_KIND,
    distribution: transport.distribution,
    snapshot,
  });
}

describe.each(adapterCases)(
  'application-state snapshot control over $name',
  (adapterCase) => {
    test('retains exact immutable publication evidence and resolves response loss by readback', async () => {
      const db = await createAdapter(adapterCase);
      const source = await createSource(
        db,
        'snapshot-control-publication',
        'publication',
      );
      let loseResponse = true;
      const instrumented = {
        ...db,
        async transactionWrite(
          /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
        ) {
          await db.transactionWrite(params);
          if (loseResponse) {
            loseResponse = false;
            throw new Error('publication response lost after commit');
          }
        },
      };
      const store = createApplicationStateSnapshotControlStore({
        db: instrumented,
        tableName: TABLE_NAME,
      });
      const input = {
        transport: source.transport,
        sourceBarrier: source.sourceBarrier,
        sourceAuthority: source.sourceAuthority,
      };

      const first = await store.recordPublication(input);
      expect(first).toMatchObject({
        applied: true,
        publication: {
          kind: 'applicationStateSnapshotPublicationEvidence',
          appId: 'snapshot-control-publication',
          transferId: source.transport.snapshot.transferId,
          snapshotId: source.transport.snapshot.snapshotId,
          transport: source.transport,
          sourceBarrier: source.sourceBarrier,
          sourceAuthority: source.sourceAuthority,
        },
      });
      expectDeepFrozen(first);
      await expect(store.recordPublication(input)).resolves.toEqual({
        applied: false,
        publication: first.publication,
      });
      await expect(
        store.getPublication({
          transferId: source.transport.snapshot.transferId,
        }),
      ).resolves.toEqual(first.publication);
      await expect(
        store.getActivationClaim({
          transferId: source.transport.snapshot.transferId,
        }),
      ).resolves.toBeNull();

      const raw = await db.get({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        keyValue: getApplicationStateSnapshotControlPartitionKey(
          source.transport.snapshot.transferId,
        ),
        sortKeyName: 'sort_key',
        sortKeyValue: APPLICATION_STATE_SNAPSHOT_PUBLICATION_SORT_KEY,
        consistentRead: true,
      });
      expect(raw).toMatchObject({
        run_id: getApplicationStateSnapshotControlPartitionKey(
          source.transport.snapshot.transferId,
        ),
        sort_key: APPLICATION_STATE_SNAPSHOT_PUBLICATION_SORT_KEY,
        record_kind: 'application-state-snapshot-publication',
        transport: source.transport,
      });
    });

    test('publication linearizes against both the exact authority and exact CLOSED barrier', async () => {
      const db = await createAdapter(adapterCase);
      const reopened = await createSource(
        db,
        'snapshot-control-reopened',
        'reopened',
      );
      const exactFence = createCoordinatorQuiescenceBarrierFence(
        reopened.sourceBarrier,
      );
      expectDeepFrozen(exactFence);
      await reopened.barriers.reopen({
        authority: reopened.sourceAuthority,
        requestId: 'reopen-before-publication',
        predecessor: reopened.sourceBarrier,
        observedAt: 3,
      });
      const store = createApplicationStateSnapshotControlStore({
        db,
        tableName: TABLE_NAME,
      });
      await expect(
        store.recordPublication({
          transport: reopened.transport,
          sourceBarrier: reopened.sourceBarrier,
          sourceAuthority: reopened.sourceAuthority,
        }),
      ).rejects.toBeInstanceOf(
        ApplicationStateSnapshotPublicationConflictError,
      );

      const stale = await createSource(db, 'snapshot-control-stale', 'stale');
      await stale.authorities.takeover({
        appId: 'snapshot-control-stale',
        coordinatorId: 'replacement-stale',
        requestId: 'takeover-before-publication',
        observedAuthority: stale.acquired,
        confirmAuthorityReplacement: true,
        observedAt: 3,
      });
      await expect(
        store.recordPublication({
          transport: stale.transport,
          sourceBarrier: stale.sourceBarrier,
          sourceAuthority: stale.sourceAuthority,
        }),
      ).rejects.toBeInstanceOf(
        ApplicationStateSnapshotPublicationConflictError,
      );
      await expect(
        store.getPublication({
          transferId: stale.transport.snapshot.transferId,
        }),
      ).resolves.toBeNull();
    });

    test('rejects exact publication replay after its CLOSED source barrier is reopened', async () => {
      const db = await createAdapter(adapterCase);
      const source = await createSource(
        db,
        'snapshot-control-publication-replay-barrier',
        'publication-replay-barrier',
      );
      const store = createApplicationStateSnapshotControlStore({
        db,
        tableName: TABLE_NAME,
      });
      const input = {
        transport: source.transport,
        sourceBarrier: source.sourceBarrier,
        sourceAuthority: source.sourceAuthority,
      };
      const retained = await store.recordPublication(input);
      await source.barriers.reopen({
        authority: source.sourceAuthority,
        requestId: 'reopen-before-publication-replay',
        predecessor: source.sourceBarrier,
        observedAt: 3,
      });

      await expect(store.recordPublication(input)).rejects.toBeInstanceOf(
        ApplicationStateSnapshotPublicationConflictError,
      );
      await expect(
        store.getPublication({
          transferId: source.transport.snapshot.transferId,
        }),
      ).resolves.toEqual(retained.publication);
    });

    test('permits one global physical activation and makes only an exact retry idempotent', async () => {
      const db = await createAdapter(adapterCase);
      const source = await createSource(
        db,
        'snapshot-control-activation',
        'activation',
      );
      const store = createApplicationStateSnapshotControlStore({
        db,
        tableName: TABLE_NAME,
      });
      const publication = await store.recordPublication({
        transport: source.transport,
        sourceBarrier: source.sourceBarrier,
        sourceAuthority: source.sourceAuthority,
      });
      const replacement = await source.authorities.takeover({
        appId: 'snapshot-control-activation',
        coordinatorId: 'replacement-activation',
        requestId: 'takeover-for-activation',
        observedAuthority: source.acquired,
        confirmAuthorityReplacement: true,
        observedAt: 3,
      });
      const replacementAuthority = createCoordinatorAuthorityToken(
        replacement.authority,
      );
      const replacementBarrier = (
        await source.barriers.adopt({
          authority: replacementAuthority,
          requestId: 'adopt-for-activation',
          predecessor: source.sourceBarrier,
          observedAt: 4,
        })
      ).barrier;
      const replicaId = id('wasr1', 'physical-volume-alpha');
      const input = {
        transport: source.transport,
        replacementAuthority,
        replacementBarrier,
        replicaId,
        transportStatus: 'RETAINED',
      };

      const first = await store.claimActivation(input);
      expect(first).toMatchObject({
        applied: true,
        claim: {
          kind: 'applicationStateSnapshotActivationClaim',
          publicationId: publication.publication.publicationId,
          transport: source.transport,
          replacementAuthority,
          replacementBarrier,
          replicaId,
          transportStatus: 'RETAINED',
        },
      });
      expectDeepFrozen(first);
      await expect(store.claimActivation(input)).resolves.toEqual({
        applied: false,
        claim: first.claim,
      });
      await expect(
        store.getActivationClaim({
          transferId: source.transport.snapshot.transferId,
        }),
      ).resolves.toEqual(first.claim);

      await expect(
        store.claimActivation({
          ...input,
          replicaId: id('wasr1', 'physical-volume-beta'),
        }),
      ).rejects.toBeInstanceOf(ApplicationStateSnapshotActivationConflictError);
      const later = await source.authorities.takeover({
        appId: 'snapshot-control-activation',
        coordinatorId: 'different-replacement',
        requestId: 'takeover-different-replacement',
        observedAuthority: replacement.authority,
        confirmAuthorityReplacement: true,
        observedAt: 5,
      });
      const laterAuthority = createCoordinatorAuthorityToken(later.authority);
      const laterBarrier = (
        await source.barriers.adopt({
          authority: laterAuthority,
          requestId: 'adopt-different-replacement',
          predecessor: replacementBarrier,
          observedAt: 6,
        })
      ).barrier;
      await expect(
        store.claimActivation({
          ...input,
          replacementAuthority: laterAuthority,
          replacementBarrier: laterBarrier,
        }),
      ).rejects.toBeInstanceOf(ApplicationStateSnapshotActivationConflictError);
      await expect(
        store.claimActivation({
          ...input,
          transportStatus: 'HYDRATED',
        }),
      ).rejects.toBeInstanceOf(ApplicationStateSnapshotActivationConflictError);
      await expect(
        store.claimActivation({
          ...input,
          transport: alternateTransport(source.transport),
        }),
      ).rejects.toBeInstanceOf(ApplicationStateSnapshotActivationConflictError);

      const raw = await db.get({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        keyValue: getApplicationStateSnapshotControlPartitionKey(
          source.transport.snapshot.transferId,
        ),
        sortKeyName: 'sort_key',
        sortKeyValue: APPLICATION_STATE_SNAPSHOT_ACTIVATION_SORT_KEY,
        consistentRead: true,
      });
      expect(raw).toMatchObject({
        sort_key: APPLICATION_STATE_SNAPSHOT_ACTIVATION_SORT_KEY,
        replica_id: replicaId,
        replacement_authority: replacementAuthority,
        replacement_barrier: replacementBarrier,
        transport_status: 'RETAINED',
      });
    });

    test('linearizes activation against the exact current CLOSED replacement barrier', async () => {
      const db = await createAdapter(adapterCase);
      const source = await createSource(
        db,
        'snapshot-control-activation-barrier',
        'activation-barrier',
      );
      const store = createApplicationStateSnapshotControlStore({
        db,
        tableName: TABLE_NAME,
      });
      await store.recordPublication({
        transport: source.transport,
        sourceBarrier: source.sourceBarrier,
        sourceAuthority: source.sourceAuthority,
      });
      const replacement = await source.authorities.takeover({
        appId: 'snapshot-control-activation-barrier',
        coordinatorId: 'replacement-activation-barrier',
        requestId: 'takeover-activation-barrier',
        observedAuthority: source.acquired,
        confirmAuthorityReplacement: true,
        observedAt: 3,
      });
      const replacementAuthority = createCoordinatorAuthorityToken(
        replacement.authority,
      );
      const replacementBarrier = (
        await source.barriers.adopt({
          authority: replacementAuthority,
          requestId: 'adopt-activation-barrier',
          predecessor: source.sourceBarrier,
          observedAt: 4,
        })
      ).barrier;
      await source.barriers.reopen({
        authority: replacementAuthority,
        requestId: 'reopen-before-activation-claim',
        predecessor: replacementBarrier,
        observedAt: 5,
      });

      await expect(
        store.claimActivation({
          transport: source.transport,
          replacementAuthority,
          replacementBarrier,
          replicaId: id('wasr1', 'barrier-volume'),
          transportStatus: 'HYDRATED',
        }),
      ).rejects.toBeInstanceOf(ApplicationStateSnapshotActivationConflictError);
      await expect(
        store.getActivationClaim({
          transferId: source.transport.snapshot.transferId,
        }),
      ).resolves.toBeNull();
    });

    test('rejects exact activation replay after its CLOSED replacement barrier is reopened', async () => {
      const db = await createAdapter(adapterCase);
      const source = await createSource(
        db,
        'snapshot-control-activation-replay-barrier',
        'activation-replay-barrier',
      );
      const store = createApplicationStateSnapshotControlStore({
        db,
        tableName: TABLE_NAME,
      });
      await store.recordPublication({
        transport: source.transport,
        sourceBarrier: source.sourceBarrier,
        sourceAuthority: source.sourceAuthority,
      });
      const replacement = await source.authorities.takeover({
        appId: 'snapshot-control-activation-replay-barrier',
        coordinatorId: 'replacement-activation-replay-barrier',
        requestId: 'takeover-activation-replay-barrier',
        observedAuthority: source.acquired,
        confirmAuthorityReplacement: true,
        observedAt: 3,
      });
      const replacementAuthority = createCoordinatorAuthorityToken(
        replacement.authority,
      );
      const replacementBarrier = (
        await source.barriers.adopt({
          authority: replacementAuthority,
          requestId: 'adopt-activation-replay-barrier',
          predecessor: source.sourceBarrier,
          observedAt: 4,
        })
      ).barrier;
      const input = {
        transport: source.transport,
        replacementAuthority,
        replacementBarrier,
        replicaId: id('wasr1', 'activation-replay-barrier-volume'),
        transportStatus: 'RETAINED',
      };
      const retained = await store.claimActivation(input);
      await source.barriers.reopen({
        authority: replacementAuthority,
        requestId: 'reopen-before-activation-replay',
        predecessor: replacementBarrier,
        observedAt: 5,
      });

      await expect(store.claimActivation(input)).rejects.toBeInstanceOf(
        ApplicationStateSnapshotActivationConflictError,
      );
      await expect(
        store.getActivationClaim({
          transferId: source.transport.snapshot.transferId,
        }),
      ).resolves.toEqual(retained.claim);
    });

    test('fails closed without exact publication evidence and on malformed retained bytes', async () => {
      const db = await createAdapter(adapterCase);
      const source = await createSource(
        db,
        'snapshot-control-integrity',
        'integrity',
      );
      const store = createApplicationStateSnapshotControlStore({
        db,
        tableName: TABLE_NAME,
      });
      await expect(
        store.claimActivation({
          transport: source.transport,
          replacementAuthority: source.sourceAuthority,
          replacementBarrier: source.sourceBarrier,
          replicaId: id('wasr1', 'physical-volume-integrity'),
          transportStatus: 'RETAINED',
        }),
      ).rejects.toBeInstanceOf(ApplicationStateSnapshotPublicationMissingError);

      const publication = await store.recordPublication({
        transport: source.transport,
        sourceBarrier: source.sourceBarrier,
        sourceAuthority: source.sourceAuthority,
      });
      await source.authorities.takeover({
        appId: 'snapshot-control-integrity',
        coordinatorId: 'replacement-integrity',
        requestId: 'takeover-integrity',
        observedAuthority: source.acquired,
        confirmAuthorityReplacement: true,
        observedAt: 3,
      });
      const keyValue = getApplicationStateSnapshotControlPartitionKey(
        source.transport.snapshot.transferId,
      );
      const raw = await db.get({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        keyValue,
        sortKeyName: 'sort_key',
        sortKeyValue: APPLICATION_STATE_SNAPSHOT_PUBLICATION_SORT_KEY,
        consistentRead: true,
      });
      if (!raw) throw new Error('Expected publication evidence.');
      await db.put({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        sortKeyName: 'sort_key',
        record: {
          ...raw,
          snapshot_id: `${publication.publication.snapshotId}-corrupt`,
        },
      });
      await expect(
        store.getPublication({
          transferId: source.transport.snapshot.transferId,
        }),
      ).rejects.toBeInstanceOf(ApplicationStateSnapshotControlRecordError);
    });
  },
);

test('constructor and exact input boundaries reject ambiguous values', async () => {
  expect(() =>
    createApplicationStateSnapshotControlStore(
      /** @type {any} */ ({ db: {}, tableName: TABLE_NAME }),
    ),
  ).toThrow(/requires a DB client/);
  const db = await createAdapter(adapterCases[0]);
  const store = createApplicationStateSnapshotControlStore({
    db,
    tableName: TABLE_NAME,
  });
  await expect(
    store.getPublication(
      /** @type {any} */ ({ transferId: id('wast1', 'unused'), extra: true }),
    ),
  ).rejects.toThrow(/unsupported or missing fields/);
});
