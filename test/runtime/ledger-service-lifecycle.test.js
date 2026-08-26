/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import { APPLICATION_STATE_TABLE_NAME } from '../../src/core/lib/config/db.js';
import { createApplicationStateCoordinatorAuthorityRecord } from '../../src/core/lib/db/tables/application-state-authority.js';
import {
  createApplicationStateReadinessFence,
  createApplicationStateReadinessStore,
} from '../../src/core/lib/db/tables/application-state-readiness.js';
import {
  CoordinatorAuthorityStaleError,
  createCoordinatorAuthority,
  createCoordinatorAuthorityFence,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import {
  LocalApplicationActivationDestination,
  LocalApplicationAdmissionClosedError,
  createLocalApplicationActivation,
} from '../../src/core/lib/db/tables/local-application-activation.js';
import {
  LEDGER_SERVICE_LIFECYCLE_RECORD_KIND,
  LEDGER_SERVICE_LIFECYCLE_SCHEMA_VERSION,
  LEDGER_SERVICE_LIFECYCLE_SORT_KEY,
  LEDGER_SERVICE_OWNERSHIP_RECORD_KIND,
  LEDGER_SERVICE_OWNERSHIP_SORT_KEY,
  LedgerServiceLifecycleConflictError,
  LedgerServiceLifecycleStatus,
  LedgerServiceOwnerKind,
  createLedgerServiceId,
  createLedgerServiceLifecycle,
  createLedgerServiceOwnership,
  createLedgerServiceSessionId,
  getLedgerServiceLifecyclePartitionKey,
} from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import { normalizeApplicationStateDestination } from '../../src/core/runtime/effects/application-state.js';
import { createMockedDynamoDB } from '../helpers/db-adapters.js';

const APP_ID = 'demo';
const TABLE_NAME = 'execution-ledger-v3';
const ARTIFACT_A = `waf1_${'A'.repeat(43)}`;
const ARTIFACT_B = `waf1_${'B'.repeat(42)}A`;
const REVISION_A = `wrv1_${'A'.repeat(43)}`;
const REVISION_B = `wrv1_${'B'.repeat(42)}A`;
const SCOPE_ID = 'local-session-root';
const OTHER_SCOPE_ID = 'other-session-root';
const PRINCIPAL_ID = 'developer';
const OTHER_PRINCIPAL_ID = 'other-developer';
/** @type {Array<'vanilla' | 'mocked DynamoDB'>} */
const READINESS_ADAPTERS = ['vanilla', 'mocked DynamoDB'];

/** @typedef {Awaited<ReturnType<typeof createReadinessHarness>>} ReadinessHarness */
/** @typedef {{beforeGet?: (input: import('../../src/core/lib/db/base.js').GetParams) => Promise<void>, beforeTransaction?: (input: import('../../src/core/lib/db/base.js').TransactionWriteParams) => Promise<void>, applicationStateReadiness?: unknown}} ReadinessObservationOptions */

/** @type {Array<() => Promise<void>>} */
const cleanups = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    // Each resource is independent, but release in reverse creation order.
    // eslint-disable-next-line no-await-in-loop
    await cleanups.pop()?.();
  }
});

function createStore() {
  const path = mkdtempSync(join(tmpdir(), 'wharfie-ledger-service-lifecycle-'));
  const db = createVanillaDB({ path });
  cleanups.push(async () => {
    await db.close();
    rmSync(path, { recursive: true, force: true });
  });
  return {
    db,
    store: createLedgerServiceLifecycle({
      db,
      tableName: 'execution-ledger-v3',
    }),
    ownership: createLedgerServiceOwnership({
      db,
      tableName: 'execution-ledger-v3',
    }),
  };
}

function createStartInput(overrides = {}) {
  return {
    serviceId: createLedgerServiceId({ appId: APP_ID }),
    appId: APP_ID,
    revisionId: REVISION_A,
    sessionId: createLedgerServiceSessionId(),
    observedAt: 100,
    ...overrides,
  };
}

/** @param {import('../../src/core/lib/db/base.js').DBClient} db */
async function installThroughActivating(db) {
  const activation = createLocalApplicationActivation({
    db,
    tableName: 'execution-ledger-v3',
  });
  const installing = await activation.beginInstall({
    appId: APP_ID,
    target: { artifactId: ARTIFACT_A, revisionId: REVISION_A },
    observedAt: 10,
  });
  const transitionId = installing.activation.transition.transitionId;
  await activation.markQuiescent({
    appId: APP_ID,
    transitionId,
    observedAt: 11,
  });
  await activation.markSelected({
    appId: APP_ID,
    transitionId,
    destination: LocalApplicationActivationDestination.TARGET,
    observedAt: 12,
  });
  await activation.markActivating({
    appId: APP_ID,
    transitionId,
    observedAt: 13,
  });
  return { activation, transitionId };
}

function createOwnershipClaim(overrides = {}) {
  return {
    serviceId: createLedgerServiceId({ appId: APP_ID }),
    appId: APP_ID,
    scopeId: SCOPE_ID,
    principalId: PRINCIPAL_ID,
    sessionId: createLedgerServiceSessionId(),
    ownerKind: LedgerServiceOwnerKind.RESIDENT,
    expected: null,
    claimedAt: 100,
    ...overrides,
  };
}

function deferred() {
  /** @type {() => void} */
  let complete = () => {};
  const promise = new Promise((resolve) => {
    complete = () => resolve(undefined);
  });
  return { promise, resolve: complete };
}

/** @param {'vanilla' | 'mocked DynamoDB'} adapterName @param {string} [appId] */
async function createReadinessHarness(adapterName, appId = APP_ID) {
  const db =
    adapterName === 'vanilla'
      ? createStore().db
      : (
          await createMockedDynamoDB({
            tableSchemas: { [TABLE_NAME]: ['run_id', 'sort_key'] },
          })
        ).db;
  if (adapterName !== 'vanilla') cleanups.push(async () => await db.close());
  const input = createStartInput({
    appId,
    serviceId: createLedgerServiceId({ appId }),
  });
  const authorityStore = createCoordinatorAuthority({
    db,
    tableName: TABLE_NAME,
  });
  const { authority } = await authorityStore.acquire({
    appId,
    coordinatorId: input.sessionId,
    requestId: `readiness-acquire:${input.sessionId}`,
    observedAt: 50,
  });
  const storeId = createCanonicalJsonSha256Id({
    domain: 'wharfie:test:ledger-service-readiness:store',
    prefix: 'was',
    value: { appId },
  });
  const destination = normalizeApplicationStateDestination({
    kind: 'application-state',
    version: 2,
    bindingId: 'primary',
    configuration: {
      provider: 'lmdb',
      storeId,
      tableName: APPLICATION_STATE_TABLE_NAME,
      namespace: appId,
    },
  });
  const readinessStore = createApplicationStateReadinessStore({
    db,
    tableName: TABLE_NAME,
    coordinatorAuthority: authority,
  });
  const preparation = await readinessStore.prepare({ destination });
  const readiness = await readinessStore.markAdopted({
    preparation,
    destinationAuthority: createApplicationStateCoordinatorAuthorityRecord({
      storeId,
      namespace: appId,
      authority,
    }),
  });
  return {
    db,
    input,
    authorityStore,
    authority,
    readinessStore,
    preparation,
    readiness,
    store: createLedgerServiceLifecycle({
      db,
      tableName: TABLE_NAME,
      applicationStateReadiness: readiness,
    }),
  };
}

/** @param {ReadinessHarness} harness */
async function startReadinessLifecycle(harness) {
  const { lifecycle } = await harness.store.start(harness.input);
  return {
    serviceId: lifecycle.serviceId,
    sessionId: lifecycle.sessionId,
    generation: lifecycle.generation,
  };
}

/** @param {ReadinessHarness} harness @param {ReadinessObservationOptions} [options] */
function observeReadinessLifecycle(harness, options = {}) {
  const db = {
    ...harness.db,
    get: jest.fn(
      async (
        /** @type {import('../../src/core/lib/db/base.js').GetParams} */ input,
      ) => {
        await options.beforeGet?.(input);
        return await harness.db.get(input);
      },
    ),
    transactionWrite: jest.fn(
      async (
        /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ input,
      ) => {
        await options.beforeTransaction?.(input);
        return await harness.db.transactionWrite(input);
      },
    ),
  };
  return {
    db,
    store: createLedgerServiceLifecycle({
      db,
      tableName: TABLE_NAME,
      applicationStateReadiness:
        options.applicationStateReadiness ?? harness.readiness,
    }),
  };
}

/** @param {ReadinessHarness} harness */
async function takeOverReadinessAuthority(harness) {
  return await harness.authorityStore.takeover({
    appId: harness.input.appId,
    coordinatorId: createLedgerServiceSessionId(),
    requestId: 'readiness-takeover',
    observedAuthority: await harness.authorityStore.get({
      appId: harness.input.appId,
    }),
    confirmAuthorityReplacement: true,
    observedAt: 200,
  });
}

/** @param {ReadinessHarness} harness */
async function restoreReadinessPreparation(harness) {
  // Fault injection reuses the real kernel's valid prior record, never an
  // invented readiness schema or a forged ADOPTED acknowledgement.
  const fence = createApplicationStateReadinessFence(harness.readiness);
  await harness.db.put({
    tableName: TABLE_NAME,
    keyName: fence.keyName,
    sortKeyName: fence.sortKeyName,
    record: harness.preparation,
  });
}

/** @param {ReadinessHarness} harness */
async function removeReadinessRecord(harness) {
  const fence = createApplicationStateReadinessFence(harness.readiness);
  await harness.db.remove({
    tableName: TABLE_NAME,
    keyName: fence.keyName,
    keyValue: fence.keyValue,
    sortKeyName: fence.sortKeyName,
    sortKeyValue: fence.sortKeyValue,
  });
}

describe('ledger service lifecycle', () => {
  test('uses one stable application service identity and distinct reserved partition', () => {
    const serviceId = createLedgerServiceId({ appId: APP_ID });

    expect(serviceId).toMatch(/^wls_[A-Za-z0-9_-]{43}$/);
    expect(createLedgerServiceId({ appId: APP_ID })).toBe(serviceId);
    expect(getLedgerServiceLifecyclePartitionKey(serviceId)).toMatch(
      /^wlsp_[A-Za-z0-9_-]{43}$/,
    );
    expect(createLedgerServiceSessionId()).toMatch(/^wss_[A-Za-z0-9_-]{43}$/);
    expect(createLedgerServiceSessionId()).not.toBe(
      createLedgerServiceSessionId(),
    );
  });

  test('persists the direct lifecycle state machine in an isolated ledger namespace', async () => {
    const { db, store } = createStore();
    const started = await store.start(createStartInput());

    expect(started).toEqual({
      applied: true,
      lifecycle: {
        schemaVersion: LEDGER_SERVICE_LIFECYCLE_SCHEMA_VERSION,
        serviceId: createLedgerServiceId({ appId: APP_ID }),
        appId: APP_ID,
        revisionId: REVISION_A,
        artifactId: null,
        sessionId: expect.stringMatching(/^wss_[A-Za-z0-9_-]{43}$/),
        generation: 1,
        status: LedgerServiceLifecycleStatus.STARTING,
        startedAt: 100,
        updatedAt: 100,
      },
    });
    expect(Object.isFrozen(started.lifecycle)).toBe(true);

    await expect(
      store.start({
        serviceId: started.lifecycle.serviceId,
        appId: APP_ID,
        revisionId: REVISION_A,
        sessionId: started.lifecycle.sessionId,
        observedAt: 101,
      }),
    ).resolves.toEqual({ applied: false, lifecycle: started.lifecycle });

    await expect(
      store.markReady({
        serviceId: started.lifecycle.serviceId,
        sessionId: started.lifecycle.sessionId,
        generation: started.lifecycle.generation,
        observedAt: 110,
      }),
    ).resolves.toMatchObject({
      applied: true,
      lifecycle: {
        status: LedgerServiceLifecycleStatus.READY,
        updatedAt: 110,
      },
    });
    await expect(
      store.markReady({
        serviceId: started.lifecycle.serviceId,
        sessionId: started.lifecycle.sessionId,
        generation: started.lifecycle.generation,
        observedAt: 111,
      }),
    ).resolves.toMatchObject({
      applied: false,
      lifecycle: {
        status: LedgerServiceLifecycleStatus.READY,
        updatedAt: 110,
      },
    });

    await store.markStopping({
      serviceId: started.lifecycle.serviceId,
      sessionId: started.lifecycle.sessionId,
      generation: started.lifecycle.generation,
      observedAt: 120,
    });
    const stopped = await store.markStopped({
      serviceId: started.lifecycle.serviceId,
      sessionId: started.lifecycle.sessionId,
      generation: started.lifecycle.generation,
      observedAt: 130,
    });
    expect(stopped).toMatchObject({
      applied: true,
      lifecycle: {
        status: LedgerServiceLifecycleStatus.STOPPED,
        updatedAt: 130,
      },
    });
    await expect(
      store.get({ serviceId: started.lifecycle.serviceId }),
    ).resolves.toEqual(stopped.lifecycle);

    const raw = await db.get({
      tableName: 'execution-ledger-v3',
      keyName: 'run_id',
      keyValue: getLedgerServiceLifecyclePartitionKey(
        started.lifecycle.serviceId,
      ),
      sortKeyName: 'sort_key',
      sortKeyValue: LEDGER_SERVICE_LIFECYCLE_SORT_KEY,
      consistentRead: true,
    });
    expect(raw).toMatchObject({
      run_id: getLedgerServiceLifecyclePartitionKey(
        started.lifecycle.serviceId,
      ),
      sort_key: LEDGER_SERVICE_LIFECYCLE_SORT_KEY,
      record_kind: LEDGER_SERVICE_LIFECYCLE_RECORD_KIND,
      schema_version: LEDGER_SERVICE_LIFECYCLE_SCHEMA_VERSION,
      app_id: APP_ID,
      revision_id: REVISION_A,
      artifact_id: null,
      status: LedgerServiceLifecycleStatus.STOPPED,
    });
  });

  test('fences stale lifecycle calls and lets a separately owned successor bind a new revision', async () => {
    const { store } = createStore();
    const first = await store.start(createStartInput());
    const firstFence = {
      serviceId: first.lifecycle.serviceId,
      sessionId: first.lifecycle.sessionId,
      generation: first.lifecycle.generation,
    };
    await store.markReady({ ...firstFence, observedAt: 110 });

    await expect(
      store.markStopping({
        ...firstFence,
        sessionId: createLedgerServiceSessionId(),
        observedAt: 111,
      }),
    ).rejects.toMatchObject({
      name: 'LedgerServiceLifecycleConflictError',
      reason: 'stale session',
    });
    await expect(
      store.markStopping({
        ...firstFence,
        generation: firstFence.generation + 1,
        observedAt: 112,
      }),
    ).rejects.toMatchObject({
      name: 'LedgerServiceLifecycleConflictError',
      reason: 'stale generation',
    });
    await expect(
      store.markStopped({ ...firstFence, observedAt: 113 }),
    ).rejects.toMatchObject({
      name: 'LedgerServiceLifecycleConflictError',
      reason: expect.stringContaining('expected STOPPING'),
    });

    const successorSessionId = createLedgerServiceSessionId();
    const successor = await store.start(
      createStartInput({
        revisionId: REVISION_B,
        sessionId: successorSessionId,
        observedAt: 200,
      }),
    );
    expect(successor).toMatchObject({
      applied: true,
      lifecycle: {
        appId: APP_ID,
        revisionId: REVISION_B,
        sessionId: successorSessionId,
        generation: 2,
        status: LedgerServiceLifecycleStatus.STARTING,
      },
    });
    await expect(
      store.markReady({ ...firstFence, observedAt: 201 }),
    ).rejects.toBeInstanceOf(LedgerServiceLifecycleConflictError);

    const stopping = await store.markStopping({
      serviceId: successor.lifecycle.serviceId,
      sessionId: successor.lifecycle.sessionId,
      generation: successor.lifecycle.generation,
      observedAt: 210,
    });
    expect(stopping.lifecycle.status).toBe(
      LedgerServiceLifecycleStatus.STOPPING,
    );
    await expect(
      store.markStopped({
        serviceId: successor.lifecycle.serviceId,
        sessionId: successor.lifecycle.sessionId,
        generation: successor.lifecycle.generation,
        observedAt: 220,
      }),
    ).resolves.toMatchObject({
      lifecycle: { status: LedgerServiceLifecycleStatus.STOPPED },
    });
  });

  test('admits a selected service only with its exact artifact and revision', async () => {
    const { db, store } = createStore();
    await installThroughActivating(db);

    await expect(store.start(createStartInput())).rejects.toBeInstanceOf(
      LocalApplicationAdmissionClosedError,
    );
    await expect(
      store.start(createStartInput({ artifactId: ARTIFACT_B })),
    ).rejects.toBeInstanceOf(LocalApplicationAdmissionClosedError);

    const admittedInput = createStartInput({ artifactId: ARTIFACT_A });
    const admitted = await store.start(admittedInput);
    expect(admitted).toMatchObject({
      applied: true,
      lifecycle: {
        appId: APP_ID,
        revisionId: REVISION_A,
        artifactId: ARTIFACT_A,
        status: LedgerServiceLifecycleStatus.STARTING,
      },
    });
    await expect(store.start(admittedInput)).resolves.toEqual({
      applied: false,
      lifecycle: admitted.lifecycle,
    });
    await expect(
      store.start({ ...admittedInput, artifactId: ARTIFACT_B }),
    ).rejects.toMatchObject({
      name: 'LedgerServiceLifecycleConflictError',
      reason: 'session already advanced',
    });
    const fence = {
      serviceId: admitted.lifecycle.serviceId,
      sessionId: admitted.lifecycle.sessionId,
      generation: admitted.lifecycle.generation,
    };
    await expect(store.markReady(fence)).resolves.toMatchObject({
      lifecycle: { artifactId: ARTIFACT_A },
    });
    await expect(store.markStopping(fence)).resolves.toMatchObject({
      lifecycle: { artifactId: ARTIFACT_A },
    });
    await expect(store.markStopped(fence)).resolves.toMatchObject({
      lifecycle: { artifactId: ARTIFACT_A },
    });
    await expect(
      store.get({ serviceId: admitted.lifecycle.serviceId }),
    ).resolves.toMatchObject({ artifactId: ARTIFACT_A });
  });

  test('admits only the selected source while a forward change drains', async () => {
    const { db, store } = createStore();
    const { activation, transitionId } = await installThroughActivating(db);
    await activation.completeActivation({ appId: APP_ID, transitionId });
    await activation.beginChange({
      appId: APP_ID,
      action: 'update',
      source: { artifactId: ARTIFACT_A, revisionId: REVISION_A },
      target: { artifactId: ARTIFACT_B, revisionId: REVISION_B },
    });

    await expect(
      store.start(createStartInput({ artifactId: ARTIFACT_A })),
    ).resolves.toMatchObject({
      applied: true,
      lifecycle: {
        artifactId: ARTIFACT_A,
        status: LedgerServiceLifecycleStatus.STARTING,
      },
    });
    await expect(
      store.start(
        createStartInput({
          artifactId: ARTIFACT_B,
          revisionId: REVISION_B,
        }),
      ),
    ).rejects.toBeInstanceOf(LocalApplicationAdmissionClosedError);
  });

  test('replays an exact starting session before consulting a newly closed admission fence', async () => {
    const { db, store } = createStore();
    const input = createStartInput();
    const started = await store.start(input);
    const activation = createLocalApplicationActivation({
      db,
      tableName: 'execution-ledger-v3',
    });
    await activation.beginInstall({
      appId: APP_ID,
      target: { artifactId: ARTIFACT_A, revisionId: REVISION_A },
      observedAt: 110,
    });

    await expect(store.start(input)).resolves.toEqual({
      applied: false,
      lifecycle: started.lifecycle,
    });
    await expect(
      store.start(
        createStartInput({
          artifactId: ARTIFACT_A,
          sessionId: createLedgerServiceSessionId(),
          observedAt: 111,
        }),
      ),
    ).rejects.toBeInstanceOf(LocalApplicationAdmissionClosedError);
  });

  test('classifies an activation race before falling back to a lifecycle conflict', async () => {
    const { db } = createStore();
    const activation = createLocalApplicationActivation({
      db,
      tableName: 'execution-ledger-v3',
    });
    let closeAdmission = true;
    const racingDb = {
      get: db.get.bind(db),
      transactionWrite: jest.fn(
        async (
          /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
        ) => {
          if (closeAdmission) {
            closeAdmission = false;
            await activation.beginInstall({
              appId: APP_ID,
              target: { artifactId: ARTIFACT_A, revisionId: REVISION_A },
              observedAt: 10,
            });
          }
          return await db.transactionWrite(params);
        },
      ),
    };
    const racingStore = createLedgerServiceLifecycle({
      db: /** @type {any} */ (racingDb),
      tableName: 'execution-ledger-v3',
    });

    await expect(
      racingStore.start(createStartInput({ artifactId: ARTIFACT_A })),
    ).rejects.toMatchObject({
      name: 'LocalApplicationAdmissionClosedError',
      operation: 'service-start',
    });
    await expect(
      racingStore.get({ serviceId: createLedgerServiceId({ appId: APP_ID }) }),
    ).resolves.toBeNull();
  });

  test('rejects weak session strings and translates a conditional create race', async () => {
    const serviceId = createLedgerServiceId({ appId: APP_ID });
    const { store } = createStore();
    await expect(
      store.start({
        serviceId,
        appId: APP_ID,
        revisionId: REVISION_A,
        sessionId: 'not-a-random-session',
      }),
    ).rejects.toThrow(/sessionId/i);

    const conditionalError = new Error('ConditionalCheckFailedException');
    conditionalError.name = 'ConditionalCheckFailedException';
    const racingDb = {
      get: jest.fn(async (_params) => null),
      transactionWrite: jest.fn(async (_params) => {
        throw conditionalError;
      }),
    };
    const racingStore = createLedgerServiceLifecycle({
      db: /** @type {any} */ (racingDb),
      tableName: 'execution-ledger-v3',
    });
    await expect(racingStore.start(createStartInput())).rejects.toMatchObject({
      name: 'LedgerServiceLifecycleConflictError',
      reason: 'concurrent lifecycle update',
    });
    expect(racingDb.transactionWrite).toHaveBeenCalledWith({
      tableName: 'execution-ledger-v3',
      conditionChecks: [
        {
          keyName: 'run_id',
          keyValue: expect.stringMatching(/^wlap_[A-Za-z0-9_-]{43}$/),
          sortKeyName: 'sort_key',
          sortKeyValue: 'local-application/v1/activation',
          conditions: [
            {
              conditionType: 'NOT_EXISTS',
              propertyName: 'sort_key',
            },
          ],
        },
      ],
      putRequests: [
        expect.objectContaining({
          keyName: 'run_id',
          sortKeyName: 'sort_key',
          conditions: [
            {
              conditionType: 'NOT_EXISTS',
              propertyName: 'sort_key',
            },
          ],
        }),
      ],
    });
  });

  test('claims and releases a separate direct ownership record with an explicit vacant fence', async () => {
    const { db, ownership } = createStore();
    await expect(
      ownership.getOwnership({
        serviceId: createLedgerServiceId({ appId: APP_ID }),
      }),
    ).resolves.toBeNull();

    const claimed = await ownership.claimOwnership(createOwnershipClaim());
    expect(claimed).toEqual({
      applied: true,
      ownership: {
        schemaVersion: 1,
        serviceId: createLedgerServiceId({ appId: APP_ID }),
        appId: APP_ID,
        scopeId: SCOPE_ID,
        principalId: PRINCIPAL_ID,
        sessionId: expect.stringMatching(/^wss_[A-Za-z0-9_-]{43}$/),
        ownerKind: LedgerServiceOwnerKind.RESIDENT,
        generation: 1,
        claimedAt: 100,
        updatedAt: 100,
      },
    });
    expect(Object.isFrozen(claimed.ownership)).toBe(true);

    await expect(
      ownership.claimOwnership(
        createOwnershipClaim({
          sessionId: claimed.ownership.sessionId,
          expected: claimed.ownership,
          claimedAt: 101,
        }),
      ),
    ).resolves.toEqual({ applied: false, ownership: claimed.ownership });

    const raw = await db.get({
      tableName: 'execution-ledger-v3',
      keyName: 'run_id',
      keyValue: getLedgerServiceLifecyclePartitionKey(
        claimed.ownership.serviceId,
      ),
      sortKeyName: 'sort_key',
      sortKeyValue: LEDGER_SERVICE_OWNERSHIP_SORT_KEY,
      consistentRead: true,
    });
    expect(raw).toMatchObject({
      run_id: getLedgerServiceLifecyclePartitionKey(
        claimed.ownership.serviceId,
      ),
      sort_key: LEDGER_SERVICE_OWNERSHIP_SORT_KEY,
      record_kind: LEDGER_SERVICE_OWNERSHIP_RECORD_KIND,
      app_id: APP_ID,
      scope_id: SCOPE_ID,
      principal_id: PRINCIPAL_ID,
      owner_kind: LedgerServiceOwnerKind.RESIDENT,
      generation: 1,
    });

    await expect(
      ownership.releaseOwnership({
        serviceId: claimed.ownership.serviceId,
        scopeId: SCOPE_ID,
        principalId: PRINCIPAL_ID,
        sessionId: claimed.ownership.sessionId,
        generation: claimed.ownership.generation,
      }),
    ).resolves.toEqual({ applied: true, ownership: claimed.ownership });
    await expect(
      ownership.getOwnership({ serviceId: claimed.ownership.serviceId }),
    ).resolves.toBeNull();
  });

  test('requires an exact observed owner for takeover and fences stale releases', async () => {
    const { ownership } = createStore();
    const first = await ownership.claimOwnership(createOwnershipClaim());
    const missingExpected = createOwnershipClaim({ claimedAt: 110 });
    Reflect.deleteProperty(missingExpected, 'expected');

    await expect(ownership.claimOwnership(missingExpected)).rejects.toThrow(
      /expected/i,
    );
    await expect(
      ownership.claimOwnership(
        createOwnershipClaim({
          sessionId: createLedgerServiceSessionId(),
          expected: null,
          claimedAt: 111,
        }),
      ),
    ).rejects.toMatchObject({
      name: 'LedgerServiceOwnershipConflictError',
      reason: 'expected no ownership',
    });

    const observed = await ownership.getOwnership({
      serviceId: first.ownership.serviceId,
    });
    const successor = await ownership.claimOwnership(
      createOwnershipClaim({
        sessionId: createLedgerServiceSessionId(),
        expected: observed,
        ownerKind: LedgerServiceOwnerKind.MANUAL,
        claimedAt: 200,
      }),
    );
    expect(successor).toMatchObject({
      applied: true,
      ownership: {
        generation: 2,
        ownerKind: LedgerServiceOwnerKind.MANUAL,
        claimedAt: 200,
      },
    });
    await expect(
      ownership.releaseOwnership({
        serviceId: first.ownership.serviceId,
        scopeId: SCOPE_ID,
        principalId: PRINCIPAL_ID,
        sessionId: first.ownership.sessionId,
        generation: first.ownership.generation,
      }),
    ).rejects.toMatchObject({
      name: 'LedgerServiceOwnershipConflictError',
      reason: 'stale session',
    });
    await expect(
      ownership.claimOwnership(
        createOwnershipClaim({
          sessionId: createLedgerServiceSessionId(),
          expected: observed,
          claimedAt: 210,
        }),
      ),
    ).rejects.toMatchObject({
      name: 'LedgerServiceOwnershipConflictError',
      reason: 'expected ownership changed',
    });
  });

  test('fails closed when an observed owner belongs to another scope or principal', async () => {
    const { ownership } = createStore();
    const claimed = await ownership.claimOwnership(createOwnershipClaim());
    const observed = await ownership.getOwnership({
      serviceId: claimed.ownership.serviceId,
    });

    await expect(
      ownership.claimOwnership(
        createOwnershipClaim({
          sessionId: createLedgerServiceSessionId(),
          scopeId: OTHER_SCOPE_ID,
          expected: observed,
          claimedAt: 200,
        }),
      ),
    ).rejects.toMatchObject({
      name: 'LedgerServiceOwnershipConflictError',
      reason: 'ownership scope or principal mismatch',
    });
    await expect(
      ownership.releaseOwnership({
        serviceId: claimed.ownership.serviceId,
        scopeId: SCOPE_ID,
        principalId: OTHER_PRINCIPAL_ID,
        sessionId: claimed.ownership.sessionId,
        generation: claimed.ownership.generation,
      }),
    ).rejects.toMatchObject({
      name: 'LedgerServiceOwnershipConflictError',
      reason: 'ownership scope or principal mismatch',
    });
  });

  test('maps a concurrent ownership conditional write to its distinct conflict error', async () => {
    const conditionalError = new Error('ConditionalCheckFailedException');
    conditionalError.name = 'ConditionalCheckFailedException';
    const racingDb = {
      get: jest.fn(async (_params) => null),
      transactionWrite: jest.fn(async (_params) => {
        throw conditionalError;
      }),
    };
    const ownership = createLedgerServiceOwnership({
      db: /** @type {any} */ (racingDb),
      tableName: 'execution-ledger-v3',
    });

    await expect(
      ownership.claimOwnership(createOwnershipClaim()),
    ).rejects.toMatchObject({
      name: 'LedgerServiceOwnershipConflictError',
      reason: 'concurrent ownership update',
    });
    expect(racingDb.transactionWrite).toHaveBeenCalledWith({
      tableName: 'execution-ledger-v3',
      putRequests: [
        expect.objectContaining({
          keyName: 'run_id',
          sortKeyName: 'sort_key',
          conditions: [
            {
              conditionType: 'NOT_EXISTS',
              propertyName: 'sort_key',
            },
          ],
        }),
      ],
    });
  });
});

for (const adapterName of READINESS_ADAPTERS) {
  describe(`application-state-ready lifecycle (${adapterName})`, () => {
    test('publishes READY with both exact fences and replays only after strong current-state reads', async () => {
      const harness = await createReadinessHarness(adapterName);
      const owner = await startReadinessLifecycle(harness);
      const observed = observeReadinessLifecycle(harness);
      const readinessFence = createApplicationStateReadinessFence(
        harness.readiness,
      );
      const authorityFence = createCoordinatorAuthorityFence(harness.authority);

      const ready = await observed.store.markReady({
        ...owner,
        observedAt: 110,
      });
      expect(ready).toMatchObject({
        applied: true,
        lifecycle: {
          ...owner,
          status: LedgerServiceLifecycleStatus.READY,
          updatedAt: 110,
        },
      });
      expect(observed.db.transactionWrite).toHaveBeenCalledTimes(1);
      const [transaction] = observed.db.transactionWrite.mock.calls[0];
      expect(transaction.conditionChecks).toHaveLength(2);
      expect(transaction.conditionChecks).toEqual(
        expect.arrayContaining([readinessFence, authorityFence]),
      );
      expect(transaction.putRequests).toEqual([
        expect.objectContaining({
          record: expect.objectContaining({
            status: LedgerServiceLifecycleStatus.READY,
          }),
          conditions: expect.arrayContaining([
            {
              conditionType: 'EQUALS',
              propertyName: 'session_id',
              propertyValue: owner.sessionId,
            },
            {
              conditionType: 'EQUALS',
              propertyName: 'generation',
              propertyValue: owner.generation,
            },
            {
              conditionType: 'EQUALS',
              propertyName: 'status',
              propertyValue: LedgerServiceLifecycleStatus.STARTING,
            },
          ]),
        }),
      ]);

      observed.db.get.mockClear();
      await expect(
        observed.store.markReady({ ...owner, observedAt: 111 }),
      ).resolves.toEqual({ applied: false, lifecycle: ready.lifecycle });
      expect(observed.db.transactionWrite).toHaveBeenCalledTimes(1);
      for (const fence of [readinessFence, authorityFence]) {
        expect(observed.db.get).toHaveBeenCalledWith({
          tableName: TABLE_NAME,
          keyName: fence.keyName,
          keyValue: fence.keyValue,
          sortKeyName: fence.sortKeyName,
          sortKeyValue: fence.sortKeyValue,
          consistentRead: true,
        });
      }
      expect(await harness.readinessStore.get({ appId: APP_ID })).toEqual(
        harness.readiness,
      );
    });

    test.each([false, true])(
      'rejects delayed READY after takeover, prioritizing stale authority when readiness also changes: %s',
      async (changeReadiness) => {
        const harness = await createReadinessHarness(adapterName);
        const owner = await startReadinessLifecycle(harness);
        const observed = observeReadinessLifecycle(harness, {
          beforeTransaction: async () => {
            await takeOverReadinessAuthority(harness);
            if (changeReadiness) await restoreReadinessPreparation(harness);
          },
        });

        await expect(observed.store.markReady(owner)).rejects.toBeInstanceOf(
          CoordinatorAuthorityStaleError,
        );
        expect(observed.db.transactionWrite).toHaveBeenCalledTimes(1);
        await expect(
          harness.store.get({ serviceId: owner.serviceId }),
        ).resolves.toMatchObject({
          ...owner,
          status: LedgerServiceLifecycleStatus.STARTING,
        });
      },
    );

    test('rejects a changed exact readiness record at the READY commit while control authority remains current', async () => {
      const harness = await createReadinessHarness(adapterName);
      const owner = await startReadinessLifecycle(harness);
      const observed = observeReadinessLifecycle(harness, {
        beforeTransaction: async () =>
          await restoreReadinessPreparation(harness),
      });

      await expect(observed.store.markReady(owner)).rejects.toMatchObject({
        name: 'LedgerServiceLifecycleConflictError',
        reason: 'application-state readiness changed',
      });
      expect(observed.db.transactionWrite).toHaveBeenCalledTimes(1);
      await expect(
        harness.authorityStore.get({ appId: APP_ID }),
      ).resolves.toEqual(harness.authority);
      await expect(
        harness.store.get({ serviceId: owner.serviceId }),
      ).resolves.toMatchObject({
        ...owner,
        status: LedgerServiceLifecycleStatus.STARTING,
      });
    });

    test.each(['missing', 'PREPARING'])(
      'refuses READY replay with %s readiness without another lifecycle write',
      async (state) => {
        const harness = await createReadinessHarness(adapterName);
        const owner = await startReadinessLifecycle(harness);
        const ready = await harness.store.markReady(owner);
        if (state === 'missing') await removeReadinessRecord(harness);
        else await restoreReadinessPreparation(harness);
        const observed = observeReadinessLifecycle(harness);

        await expect(observed.store.markReady(owner)).rejects.toMatchObject({
          name: 'LedgerServiceLifecycleConflictError',
          reason: 'application-state readiness changed',
        });
        expect(observed.db.transactionWrite).not.toHaveBeenCalled();
        expect(
          observed.db.get.mock.calls.every(
            (
              /** @type {[import('../../src/core/lib/db/base.js').GetParams]} */ call,
            ) => call[0].consistentRead === true,
          ),
        ).toBe(true);
        await expect(
          harness.store.get({ serviceId: owner.serviceId }),
        ).resolves.toEqual(ready.lifecycle);
      },
    );

    test.each(['takeover', 'release'])(
      'refuses READY replay after authority %s without changing retained lifecycle or readiness',
      async (change) => {
        const harness = await createReadinessHarness(adapterName);
        const owner = await startReadinessLifecycle(harness);
        const ready = await harness.store.markReady(owner);
        if (change === 'takeover') await takeOverReadinessAuthority(harness);
        else {
          await harness.authorityStore.release({
            authority: harness.authority,
            requestId: 'readiness-release',
            observedAt: 200,
          });
        }
        const observed = observeReadinessLifecycle(harness);

        await expect(observed.store.markReady(owner)).rejects.toBeInstanceOf(
          CoordinatorAuthorityStaleError,
        );
        expect(observed.db.transactionWrite).not.toHaveBeenCalled();
        await expect(
          harness.store.get({ serviceId: owner.serviceId }),
        ).resolves.toEqual(ready.lifecycle);
        await expect(
          harness.readinessStore.get({ appId: APP_ID }),
        ).resolves.toEqual(harness.readiness);
      },
    );

    test.each(['application', 'session'])(
      'rejects a valid readiness record for a different %s before database reads',
      async (scope) => {
        const harness = await createReadinessHarness(
          adapterName,
          scope === 'application' ? 'other-readiness-app' : APP_ID,
        );
        const owner = await startReadinessLifecycle(harness);
        const observed = observeReadinessLifecycle(harness);
        const input = {
          ...owner,
          ...(scope === 'application'
            ? { serviceId: createLedgerServiceId({ appId: APP_ID }) }
            : { sessionId: createLedgerServiceSessionId() }),
        };

        await expect(observed.store.markReady(input)).rejects.toBeInstanceOf(
          TypeError,
        );
        expect(observed.db.get).not.toHaveBeenCalled();
        expect(observed.db.transactionWrite).not.toHaveBeenCalled();
      },
    );

    test('snapshots caller readiness and READY identity before the first awaited database read', async () => {
      const harness = await createReadinessHarness(adapterName);
      const owner = await startReadinessLifecycle(harness);
      const entered = deferred();
      const resume = deferred();
      const readiness = JSON.parse(JSON.stringify(harness.readiness));
      let paused = false;
      const observed = observeReadinessLifecycle(harness, {
        applicationStateReadiness: readiness,
        beforeGet: async () => {
          if (paused) return;
          paused = true;
          entered.resolve();
          await resume.promise;
        },
      });
      const input = { ...owner, observedAt: 110 };
      const settled = observed.store.markReady(input).then(
        (result) => ({ result, error: undefined }),
        (error) => ({ result: undefined, error }),
      );

      try {
        await Promise.race([
          entered.promise,
          settled.then(({ error }) => {
            throw (
              error ?? new Error('READY never reached its first database read.')
            );
          }),
        ]);
        readiness.app_id = 'mutated-readiness-app';
        readiness.epoch += 1;
        readiness.status = 'PREPARING';
        input.serviceId = createLedgerServiceId({
          appId: 'mutated-target-app',
        });
        input.sessionId = createLedgerServiceSessionId();
        input.generation += 1;
        input.observedAt = 999;
        resume.resolve();

        const outcome = await settled;
        expect(outcome.error).toBeUndefined();
        expect(outcome.result).toMatchObject({
          applied: true,
          lifecycle: {
            ...owner,
            status: LedgerServiceLifecycleStatus.READY,
            updatedAt: 110,
          },
        });
        expect(observed.db.transactionWrite).toHaveBeenCalledTimes(1);
        expect(
          observed.db.transactionWrite.mock.calls[0][0].conditionChecks,
        ).toEqual(
          expect.arrayContaining([
            createApplicationStateReadinessFence(harness.readiness),
            createCoordinatorAuthorityFence(harness.authority),
          ]),
        );
      } finally {
        resume.resolve();
        await settled;
      }
    });

    test('keeps STARTING and shutdown writable after takeover without applying READY fences', async () => {
      const harness = await createReadinessHarness(adapterName);
      await takeOverReadinessAuthority(harness);
      const observed = observeReadinessLifecycle(harness);
      const started = await observed.store.start(harness.input);
      expect(started).toMatchObject({
        applied: true,
        lifecycle: { status: LedgerServiceLifecycleStatus.STARTING },
      });
      const owner = {
        serviceId: started.lifecycle.serviceId,
        sessionId: started.lifecycle.sessionId,
        generation: started.lifecycle.generation,
      };
      const [startTransaction] = observed.db.transactionWrite.mock.calls[0];
      expect(startTransaction.conditionChecks).not.toContainEqual(
        createApplicationStateReadinessFence(harness.readiness),
      );
      expect(startTransaction.conditionChecks).not.toContainEqual(
        createCoordinatorAuthorityFence(harness.authority),
      );
      await expect(observed.store.markReady(owner)).rejects.toBeInstanceOf(
        CoordinatorAuthorityStaleError,
      );

      observed.db.transactionWrite.mockClear();
      await expect(observed.store.markStopping(owner)).resolves.toMatchObject({
        applied: true,
        lifecycle: { status: LedgerServiceLifecycleStatus.STOPPING },
      });
      const stopped = await observed.store.markStopped(owner);
      expect(stopped).toMatchObject({
        applied: true,
        lifecycle: { status: LedgerServiceLifecycleStatus.STOPPED },
      });
      await expect(observed.store.markStopped(owner)).resolves.toEqual({
        applied: false,
        lifecycle: stopped.lifecycle,
      });
      expect(observed.db.transactionWrite).toHaveBeenCalledTimes(2);
      for (const [transaction] of observed.db.transactionWrite.mock.calls) {
        expect(transaction.conditionChecks ?? []).toEqual([]);
      }
      await expect(
        harness.readinessStore.get({ appId: APP_ID }),
      ).resolves.toEqual(harness.readiness);
    });
  });
}

describe('application-state lifecycle readiness validation', () => {
  test.each([
    'PREPARING',
    'null',
    'array',
    'missing app',
    'mixed app',
    'mixed token',
    'extra field',
  ])('refuses %s construction before database I/O', async (kind) => {
    const harness = await createReadinessHarness('vanilla');
    const candidate = JSON.parse(JSON.stringify(harness.readiness));
    if (kind === 'missing app') Reflect.deleteProperty(candidate, 'app_id');
    if (kind === 'mixed app') candidate.app_id = 'different-app';
    if (kind === 'mixed token') candidate.epoch += 1;
    if (kind === 'extra field') candidate.untrustedAuthority = true;
    const db = {
      ...harness.db,
      get: jest.fn(harness.db.get),
      transactionWrite: jest.fn(harness.db.transactionWrite),
    };
    const applicationStateReadiness =
      kind === 'PREPARING'
        ? harness.preparation
        : kind === 'null'
          ? null
          : kind === 'array'
            ? []
            : candidate;

    expect(() =>
      createLedgerServiceLifecycle({
        db,
        tableName: TABLE_NAME,
        applicationStateReadiness,
      }),
    ).toThrow();
    expect(db.get).not.toHaveBeenCalled();
    expect(db.transactionWrite).not.toHaveBeenCalled();
  });
});
