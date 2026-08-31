/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APPLICATION_STATE_TABLE_NAME,
  createApplicationStateDBClient,
  createControlDBClient,
} from '../../src/core/lib/config/db.js';
import {
  applicationStateCoordinatorRecordConditions,
  createApplicationStateCoordinatorAuthorityKey,
  createApplicationStateCoordinatorAuthorityRecord,
} from '../../src/core/lib/db/tables/application-state-authority.js';
import {
  APPLICATION_STATE_READINESS_SORT_KEY,
  applicationStateReadinessAuthority,
  applicationStateReadinessDestination,
  createApplicationStateReadinessStore,
} from '../../src/core/lib/db/tables/application-state-readiness.js';
import {
  APPLICATION_STATE_KEY_NAME,
  APPLICATION_STATE_SORT_KEY_NAME,
  APPLICATION_STATE_STORE_RESOURCE_ID,
  APPLICATION_STATE_STORE_SORT_KEY,
  ApplicationStateCoordinatorAuthorityStaleError,
  createApplicationStateRetirementAbsenceFence,
  createApplicationStateTable,
} from '../../src/core/lib/db/tables/application-state.js';
import {
  CoordinatorAuthorityStaleError,
  createCoordinatorAuthority,
  createCoordinatorAuthorityToken,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import { createExecutionLedger } from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import { APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS } from '../../src/core/runtime/effects/application-state.js';
import { createBuiltinManagedEffectCatalog } from '../../src/core/runtime/effects/builtin-catalog.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
} from '../../src/core/runtime/manual-ledger-run.js';

/** @typedef {import('../../src/core/lib/db/base.js').DBClient} DBClient */
/** @typedef {import('../../src/core/lib/db/base.js').TransactionWriteParams} Transaction */
/** @typedef {import('../../src/core/lib/db/tables/coordinator-authority.js').CoordinatorAuthorityToken} Authority */

const APP_ID = 'application-state-readiness-handoff';
const CONTROL_TABLE_NAME = 'application-state-readiness-handoff-control';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const EFFECT_ID = 'retained-positive-effect';
const ACTOR = Object.freeze({ kind: 'test', id: 'readiness-handoff' });
const STORE_ID = fixtureId('was', 'retained-store');
const OTHER_STORE_ID = fixtureId('was', 'replacement-store');
const APPLICATION_STATE_STORE_IMPORT =
  '../../src/core/runtime/application-state-store.js';

/** @type {Array<() => Promise<void>>} */
let cleanups = [];
/** @type {Array<{close: ReturnType<typeof jest.fn>, cleanup: () => Promise<void>}>} */
let openedDestinations = [];
/** @type {((params: Transaction, commit: () => Promise<void>) => Promise<void>) | undefined} */
let destinationWrite;

const realApplicationStateStore = await import(APPLICATION_STATE_STORE_IMPORT);
const destinationTransactions = jest.fn(
  async (/** @type {Transaction} */ params, /** @type {DBClient} */ db) => {
    if (destinationWrite) {
      return await destinationWrite(params, async () => {
        await db.transactionWrite(params);
      });
    }
    await db.transactionWrite(params);
  },
);
const openApplicationStateDB = jest.fn(
  async (
    /** @type {Parameters<typeof realApplicationStateStore.openApplicationStateDB>[0]} */
    options,
  ) => {
    const access =
      await realApplicationStateStore.openApplicationStateDB(options);
    const close = jest.fn(async () => await access.close());
    openedDestinations.push({ close, cleanup: access.close });
    return Object.freeze({
      ...access,
      db: {
        ...access.db,
        async transactionWrite(/** @type {Transaction} */ params) {
          await destinationTransactions(params, access.db);
        },
      },
      close,
    });
  },
);
jest.unstable_mockModule(APPLICATION_STATE_STORE_IMPORT, () => ({
  ...realApplicationStateStore,
  openApplicationStateDB,
}));
const { prepareApplicationStateReadiness } =
  await import('../../src/core/runtime/application-state-readiness.js');

afterEach(async () => {
  const scopes = openedDestinations;
  const pending = cleanups;
  openedDestinations = [];
  cleanups = [];
  destinationWrite = undefined;
  /** @type {unknown[]} */
  const failures = [];
  for (const scope of scopes) {
    try {
      await scope.cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  for (const cleanup of pending.reverse()) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  destinationTransactions.mockClear();
  openApplicationStateDB.mockClear();
  if (failures.length > 0) {
    throw new AggregateError(failures, 'readiness handoff cleanup failed');
  }
});

/** @param {string} prefix @param {string} value */
function fixtureId(prefix, value) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:test:application-state-readiness-handoff:v1',
    prefix,
    value,
  });
}

function deferred() {
  let release = () => {};
  const promise = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  return { promise, resolve: release };
}

/** @param {Transaction} params */
function isDestinationAdoption(params) {
  return (
    params.putRequests?.some(
      ({ record }) =>
        record.record_kind === 'application-state-coordinator-authority',
    ) === true
  );
}

/** @param {Transaction} params */
function isDestinationMutation(params) {
  return [
    params.putRequests,
    params.updateRequests,
    params.deleteRequests,
  ].some((requests) => requests !== undefined && requests.length > 0);
}

function destinationMutationCount() {
  return destinationTransactions.mock.calls.filter(([params]) =>
    isDestinationMutation(params),
  ).length;
}

/**
 * @param {Transaction} transaction
 * @param {Readonly<Record<string, any>> | null} identity
 * @param {Readonly<Record<string, any>>} authority
 */
function expectExactReplayFence(transaction, identity, authority) {
  expect(identity).not.toBeNull();
  if (!identity) throw new Error('Replay fence requires store identity.');
  const authorityKey = createApplicationStateCoordinatorAuthorityKey(APP_ID);
  expect(transaction).toEqual({
    tableName: APPLICATION_STATE_TABLE_NAME,
    conditionChecks: [
      {
        keyName: APPLICATION_STATE_KEY_NAME,
        keyValue: APPLICATION_STATE_STORE_RESOURCE_ID,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        sortKeyValue: APPLICATION_STATE_STORE_SORT_KEY,
        conditions: [
          {
            conditionType: 'EQUALS',
            propertyName: 'store_id',
            propertyValue: identity.store_id,
          },
          {
            conditionType: 'EQUALS',
            propertyName: 'identity_digest',
            propertyValue: identity.identity_digest,
          },
        ],
      },
      createApplicationStateRetirementAbsenceFence(identity.store_id),
      {
        keyName: APPLICATION_STATE_KEY_NAME,
        keyValue: authorityKey.resourceId,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        sortKeyValue: authorityKey.sortKey,
        conditions: applicationStateCoordinatorRecordConditions(authority),
      },
    ],
  });
}

/** @param {Transaction} params @param {'PREPARING' | 'ADOPTED'} status */
function isReadinessWrite(params, status) {
  return (
    params.putRequests?.some(
      ({ record }) => record.status === status && record.store_id === STORE_ID,
    ) === true
  );
}

/** @param {DBClient} db @param {(params: Transaction, commit: () => Promise<void>) => Promise<void>} [intercept] */
function instrumentControl(db, intercept) {
  const transactionWrite = jest.fn(
    async (/** @type {Transaction} */ params) => {
      if (intercept) {
        return await intercept(params, async () => {
          await db.transactionWrite(params);
        });
      }
      await db.transactionWrite(params);
    },
  );
  return { db: { ...db, transactionWrite }, transactionWrite };
}

/** @param {{withHistory?: boolean}} [options] */
async function createHarness(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wharfie-readiness-handoff-'));
  const controlPath = join(root, 'control');
  const applicationPath = join(root, 'application');
  const configuration = Object.freeze({
    adapterName: /** @type {const} */ ('lmdb'),
    storePath: applicationPath,
    tableName: APPLICATION_STATE_TABLE_NAME,
  });
  const controlDb = await createControlDBClient('lmdb', { path: controlPath });
  cleanups.push(async () => {
    try {
      await controlDb.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  const ledger = createExecutionLedger({
    db: controlDb,
    tableName: CONTROL_TABLE_NAME,
    payloadStore: createLocalExecutionPayloadStore({
      path: join(root, 'payloads'),
      storeId: 'readiness-handoff-payloads',
    }),
    effectEvidenceVerifiers: [...APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS],
  });
  const applicationDb = await createApplicationStateDBClient('lmdb', {
    path: applicationPath,
  });
  let destination;
  let retained;
  try {
    const catalog = await createBuiltinManagedEffectCatalog({
      db: applicationDb,
      adapterName: 'lmdb',
      appId: APP_ID,
      createStoreId: () => STORE_ID,
    });
    destination = catalog.destination;
    if (options.withHistory !== false) {
      retained = await seedRetainedEffect(ledger, catalog);
    }
  } finally {
    await applicationDb.close();
  }
  const authorityStore = createCoordinatorAuthority({
    db: controlDb,
    tableName: CONTROL_TABLE_NAME,
  });
  const acquired = await authorityStore.acquire({
    appId: APP_ID,
    coordinatorId: 'coordinator-a',
    requestId: 'acquire-a',
  });
  const authority = createCoordinatorAuthorityToken(acquired.authority);
  return {
    root,
    controlPath,
    applicationPath,
    configuration,
    controlDb,
    ledger,
    authorityStore,
    authority,
    destination,
    retained,
  };
}

/** @param {ReturnType<typeof createExecutionLedger>} ledger @param {Awaited<ReturnType<typeof createBuiltinManagedEffectCatalog>>} catalog */
async function seedRetainedEffect(ledger, catalog) {
  const runId = createManualLedgerRunId({
    appId: APP_ID,
    idempotencyKey: 'historical-effect',
  });
  const created = await ledger.createManualRun({
    runId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    activityId: 'historical-activity',
    input: { historical: true },
    callerMetadata: { fixture: APP_ID },
    transitionId: 'create',
    actor: ACTOR,
  });
  const claimed = await ledger.claimInvocation({
    runId,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    fencingToken: 'historical-fence',
    expectedGeneration: 0,
    expectedVersion: created.run.version,
    transitionId: 'claim',
    actor: ACTOR,
  });
  const started = await ledger.markAttemptStarted({
    runId,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    attemptId: claimed.attempt.attemptId,
    fencingToken: claimed.attempt.fencingToken,
    generation: claimed.attempt.generation,
    expectedVersion: claimed.run.version,
    transitionId: 'start',
    actor: ACTOR,
  });
  const request = {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'effect-request',
    attemptId: started.attempt.attemptId,
    sequence: 1,
    effectId: EFFECT_ID,
    capability: 'application-state',
    operation: 'put-if-absent',
    input: { key: 'retained-value', value: { answer: 42 } },
    requestedReplayProperties: ['idempotent', 'transactional'],
  };
  const adapter = catalog.resolve(request);
  const requested = await ledger.recordManagedEffectRequest({
    runId,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    attemptId: started.attempt.attemptId,
    fencingToken: started.attempt.fencingToken,
    generation: started.attempt.generation,
    expectedVersion: started.run.version,
    transitionId: 'effect-request',
    request,
    adapter: adapter.descriptor,
    destination: adapter.destination,
    verifier: adapter.verifier,
    substantiatedReplayProperties: adapter.substantiatedReplayProperties,
    actor: ACTOR,
  });
  const effectStarted = await ledger.markManagedEffectStarted({
    runId,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    attemptId: started.attempt.attemptId,
    effectId: EFFECT_ID,
    fencingToken: started.attempt.fencingToken,
    generation: started.attempt.generation,
    expectedVersion: requested.run.version,
    expectedEffectVersion: requested.effect.version,
    transitionId: 'effect-start',
    actor: ACTOR,
  });
  const outcome = await adapter.execute({
    destinationEffectId: effectStarted.effect.destinationEffectId,
    destination: adapter.destination,
    identity: {
      runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      attemptId: started.attempt.attemptId,
      effectId: EFFECT_ID,
    },
    request,
  });
  await ledger.commitManagedEffectOutcome({
    runId,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    attemptId: started.attempt.attemptId,
    effectId: EFFECT_ID,
    fencingToken: started.attempt.fencingToken,
    generation: started.attempt.generation,
    expectedVersion: effectStarted.run.version,
    expectedEffectVersion: effectStarted.effect.version,
    transitionId: 'effect-outcome',
    outcome,
    actor: ACTOR,
  });
  return {
    runId,
    destinationEffectId: effectStarted.effect.destinationEffectId,
    view: await ledger.rebuildRun(runId),
    receipt: await catalog.readReceipt(
      effectStarted.effect.destinationEffectId,
    ),
  };
}

/** @typedef {Awaited<ReturnType<typeof createHarness>>} Harness */

/** @param {Harness} harness @param {Authority} [authority] @param {DBClient} [db] */
async function prepare(
  harness,
  authority = harness.authority,
  db = harness.controlDb,
) {
  return await prepareApplicationStateReadiness({
    appId: APP_ID,
    ledger: harness.ledger.bindCoordinatorAuthority(authority),
    controlContext: {
      db,
      tableName: CONTROL_TABLE_NAME,
      adapterName: 'lmdb',
      controlPath: harness.controlPath,
    },
    configuration: harness.configuration,
  });
}

/** @param {Harness} harness */
async function readReadiness(harness) {
  return await createApplicationStateReadinessStore({
    db: harness.controlDb,
    tableName: CONTROL_TABLE_NAME,
  }).get({ appId: APP_ID });
}

/** @param {Harness} harness @param {string} [storeId] */
async function readDestination(harness, storeId = STORE_ID) {
  const access = await realApplicationStateStore.openApplicationStateDB({
    configuration: harness.configuration,
    readOnly: true,
  });
  try {
    const table = createApplicationStateTable({
      db: access.db,
      tableName: APPLICATION_STATE_TABLE_NAME,
    });
    return {
      identity: await table.readStoreIdentity(),
      barrier: await table.readCoordinatorAuthority({
        storeId,
        namespace: APP_ID,
      }),
      receipt: harness.retained
        ? await table.readReceipt(harness.retained.destinationEffectId)
        : null,
    };
  } finally {
    await access.close();
  }
}

/** @param {Harness} harness */
async function expectHistoryUnchanged(harness) {
  if (!harness.retained)
    throw new Error('This proof requires retained history.');
  expect(await harness.ledger.rebuildRun(harness.retained.runId)).toEqual(
    harness.retained.view,
  );
  expect((await readDestination(harness)).receipt).toEqual(
    harness.retained.receipt,
  );
}

/** @param {Harness} harness @param {Authority} authority */
function expectedBarrier(harness, authority) {
  return createApplicationStateCoordinatorAuthorityRecord({
    storeId: harness.destination.configuration.storeId,
    namespace: APP_ID,
    authority,
  });
}

function expectOwnedHandlesClosed() {
  expect(openedDestinations.length).toBeGreaterThan(0);
  for (const opened of openedDestinations) {
    expect(opened.close).toHaveBeenCalledTimes(1);
  }
}

/** @param {Harness} harness @param {Authority} [predecessor] @param {string} [label] */
async function acquireFreshSuccessor(
  harness,
  predecessor = harness.authority,
  label = 'b',
) {
  const observed = await harness.authorityStore.get({ appId: APP_ID });
  expect(observed).toMatchObject({ ...predecessor, status: 'ACTIVE' });
  const takeover = await harness.authorityStore.takeover({
    appId: APP_ID,
    coordinatorId: `explicit-handoff-${label}`,
    requestId: `explicit-handoff-${label}-request`,
    observedAuthority: observed,
    confirmAuthorityReplacement: true,
  });
  const released = await harness.authorityStore.release({
    authority: takeover.authority,
    requestId: `release-explicit-handoff-${label}`,
  });
  expect(released.authority.status).toBe('RELEASED');
  const successor = await harness.authorityStore.acquire({
    appId: APP_ID,
    coordinatorId: `coordinator-${label}`,
    requestId: `acquire-${label}`,
  });
  const token = createCoordinatorAuthorityToken(successor.authority);
  expect(token.epoch).toBe(predecessor.epoch + 2);
  expect(token.authorityId).not.toBe(predecessor.authorityId);
  return token;
}

/** @param {Harness} harness @param {Readonly<Record<string, any>> | null} barrier */
async function replaceDestinationBarrier(harness, barrier) {
  const db = await createApplicationStateDBClient('lmdb', {
    path: harness.applicationPath,
  });
  try {
    const key = createApplicationStateCoordinatorAuthorityKey(APP_ID);
    if (barrier === null) {
      await db.remove({
        tableName: APPLICATION_STATE_TABLE_NAME,
        keyName: APPLICATION_STATE_KEY_NAME,
        keyValue: key.resourceId,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        sortKeyValue: key.sortKey,
      });
    } else {
      await db.put({
        tableName: APPLICATION_STATE_TABLE_NAME,
        keyName: APPLICATION_STATE_KEY_NAME,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        record: barrier,
      });
    }
  } finally {
    await db.close();
  }
}

describe('application-state readiness handoff over real separate LMDB stores', () => {
  test('pins and adopts the retained destination, closes handles, and replays without rewriting history or readiness', async () => {
    const harness = await createHarness();
    const control = instrumentControl(harness.controlDb);
    const adopted = await prepare(harness, harness.authority, control.db);
    expect(adopted).toMatchObject({ status: 'ADOPTED', store_id: STORE_ID });
    expect(applicationStateReadinessAuthority(adopted)).toEqual(
      harness.authority,
    );
    expect(applicationStateReadinessDestination(adopted)).toEqual(
      harness.destination,
    );
    const destination = await readDestination(harness);
    const barrier = expectedBarrier(harness, harness.authority);
    expect(destination.barrier).toEqual(barrier);
    await expectHistoryUnchanged(harness);
    const controlWrites = control.transactionWrite.mock.calls.length;
    const destinationTransactionCount =
      destinationTransactions.mock.calls.length;
    const destinationMutations = destinationMutationCount();
    expect(controlWrites).toBeGreaterThan(0);
    expect(destinationMutations).toBeGreaterThan(0);

    await expect(
      prepare(harness, harness.authority, control.db),
    ).resolves.toEqual(adopted);
    expect(control.transactionWrite).toHaveBeenCalledTimes(controlWrites);
    expect(destinationMutationCount()).toBe(destinationMutations);
    const replayTransactions = destinationTransactions.mock.calls.slice(
      destinationTransactionCount,
    );
    expect(replayTransactions).toHaveLength(1);
    expectExactReplayFence(
      replayTransactions[0][0],
      destination.identity,
      barrier,
    );
    await expect(readReadiness(harness)).resolves.toEqual(adopted);
    await expectHistoryUnchanged(harness);
    expectOwnedHandlesClosed();
  });

  test('refuses a deleted ADOPTED barrier under both the same and a higher token without mutating either store', async () => {
    const harness = await createHarness();
    const adopted = await prepare(harness);
    await replaceDestinationBarrier(harness, null);
    const control = instrumentControl(harness.controlDb);
    const destinationWrites = destinationTransactions.mock.calls.length;

    await expect(
      prepare(harness, harness.authority, control.db),
    ).rejects.toBeInstanceOf(ApplicationStateCoordinatorAuthorityStaleError);
    expect(control.transactionWrite).not.toHaveBeenCalled();
    expect(destinationTransactions).toHaveBeenCalledTimes(destinationWrites);
    await expect(readReadiness(harness)).resolves.toEqual(adopted);
    expect((await readDestination(harness)).barrier).toBeNull();

    const successor = await acquireFreshSuccessor(harness);
    await expect(
      prepare(harness, successor, control.db),
    ).rejects.toBeInstanceOf(ApplicationStateCoordinatorAuthorityStaleError);
    expect(control.transactionWrite).not.toHaveBeenCalled();
    expect(destinationTransactions).toHaveBeenCalledTimes(destinationWrites);
    await expect(readReadiness(harness)).resolves.toEqual(adopted);
    expect((await readDestination(harness)).barrier).toBeNull();
    await expectHistoryUnchanged(harness);
    expectOwnedHandlesClosed();
  });

  test('refuses an older valid barrier under both the retained token and a higher token without erasing ADOPTED', async () => {
    const harness = await createHarness();
    await prepare(harness);
    const oldBarrier = expectedBarrier(harness, harness.authority);
    const successor = await acquireFreshSuccessor(harness);
    const adopted = await prepare(harness, successor);
    await replaceDestinationBarrier(harness, oldBarrier);
    const control = instrumentControl(harness.controlDb);
    const destinationWrites = destinationTransactions.mock.calls.length;

    await expect(
      prepare(harness, successor, control.db),
    ).rejects.toBeInstanceOf(ApplicationStateCoordinatorAuthorityStaleError);
    expect(control.transactionWrite).not.toHaveBeenCalled();
    expect(destinationTransactions).toHaveBeenCalledTimes(destinationWrites);
    await expect(readReadiness(harness)).resolves.toEqual(adopted);
    expect((await readDestination(harness)).barrier).toEqual(oldBarrier);

    const next = await acquireFreshSuccessor(harness, successor, 'c');
    await expect(prepare(harness, next, control.db)).rejects.toBeInstanceOf(
      ApplicationStateCoordinatorAuthorityStaleError,
    );
    expect(control.transactionWrite).not.toHaveBeenCalled();
    expect(destinationTransactions).toHaveBeenCalledTimes(destinationWrites);
    await expect(readReadiness(harness)).resolves.toEqual(adopted);
    expect((await readDestination(harness)).barrier).toEqual(oldBarrier);
    await expectHistoryUnchanged(harness);
    expectOwnedHandlesClosed();
  });

  test('retains PREPARING after an interrupted pre-adoption write and resumes under the same still-current token', async () => {
    const harness = await createHarness();
    const interrupted = new Error('interrupted before destination adoption');
    let armed = true;
    destinationWrite = async (params, commit) => {
      if (armed && isDestinationAdoption(params)) {
        armed = false;
        throw interrupted;
      }
      await commit();
    };

    await expect(prepare(harness)).rejects.toThrow(interrupted.message);
    const preparing = await readReadiness(harness);
    expect(preparing).toMatchObject({
      status: 'PREPARING',
      store_id: STORE_ID,
    });
    expect(applicationStateReadinessAuthority(preparing)).toEqual(
      harness.authority,
    );
    expect((await readDestination(harness)).barrier).toBeNull();
    await expectHistoryUnchanged(harness);
    expectOwnedHandlesClosed();

    const adopted = await prepare(harness);
    expect(adopted).toMatchObject({
      status: 'ADOPTED',
      epoch: harness.authority.epoch,
    });
    expect((await readDestination(harness)).barrier).toEqual(
      expectedBarrier(harness, harness.authority),
    );
    await expectHistoryUnchanged(harness);
    expectOwnedHandlesClosed();
  });

  test('a stale PREPARING snapshot honors ADOPTED returned by same-token replay and does not repair a deleted barrier', async () => {
    const harness = await createHarness();
    const interrupted = new Error('interrupted before destination adoption');
    let armed = true;
    destinationWrite = async (params, commit) => {
      if (armed && isDestinationAdoption(params)) {
        armed = false;
        throw interrupted;
      }
      await commit();
    };
    await expect(prepare(harness)).rejects.toBe(interrupted);
    destinationWrite = undefined;
    const preparing = await readReadiness(harness);
    expect(preparing).toMatchObject({
      status: 'PREPARING',
      store_id: STORE_ID,
    });

    const snapshotRead = deferred();
    const resume = deferred();
    let paused = false;
    const staleControlDb = {
      ...harness.controlDb,
      async get(
        /** @type {import('../../src/core/lib/db/base.js').GetParams} */ params,
      ) {
        const retained = await harness.controlDb.get(params);
        if (
          !paused &&
          params.sortKeyValue === APPLICATION_STATE_READINESS_SORT_KEY
        ) {
          paused = true;
          snapshotRead.resolve();
          await resume.promise;
        }
        return retained;
      },
    };
    const stale = prepare(harness, harness.authority, staleControlDb).then(
      (value) => ({ value, error: undefined }),
      (error) => ({ value: undefined, error }),
    );
    try {
      await snapshotRead.promise;
      const adopted = await prepare(harness);
      expect(adopted).toMatchObject({ status: 'ADOPTED', store_id: STORE_ID });
      await replaceDestinationBarrier(harness, null);
      const destinationWrites = destinationTransactions.mock.calls.length;

      resume.resolve();
      const result = await stale;
      expect(result.value).toBeUndefined();
      expect(result.error).toBeInstanceOf(
        ApplicationStateCoordinatorAuthorityStaleError,
      );
      expect(destinationTransactions).toHaveBeenCalledTimes(destinationWrites);
      await expect(readReadiness(harness)).resolves.toEqual(adopted);
      expect((await readDestination(harness)).barrier).toBeNull();
      await expectHistoryUnchanged(harness);
      expectOwnedHandlesClosed();
    } finally {
      resume.resolve();
      await stale;
    }
  });

  test.each(['before destination adoption', 'after destination commit'])(
    'resumes interruption %s with a fresh token after explicit takeover and release',
    async (boundary) => {
      const harness = await createHarness();
      const interrupted = new Error(`interrupted ${boundary}`);
      let armed = true;
      destinationWrite = async (params, commit) => {
        if (
          boundary === 'before destination adoption' &&
          armed &&
          isDestinationAdoption(params)
        ) {
          armed = false;
          throw interrupted;
        }
        await commit();
      };
      const control = instrumentControl(
        harness.controlDb,
        async (params, commit) => {
          if (
            boundary === 'after destination commit' &&
            armed &&
            isReadinessWrite(params, 'ADOPTED')
          ) {
            armed = false;
            throw interrupted;
          }
          await commit();
        },
      );

      await expect(
        prepare(harness, harness.authority, control.db),
      ).rejects.toThrow(interrupted.message);
      const before = await readReadiness(harness);
      expect(before).toMatchObject({ status: 'PREPARING', store_id: STORE_ID });
      const partialBarrier = (await readDestination(harness)).barrier;
      expect(partialBarrier).toEqual(
        boundary === 'after destination commit'
          ? expectedBarrier(harness, harness.authority)
          : null,
      );
      await expectHistoryUnchanged(harness);
      expectOwnedHandlesClosed();

      const successor = await acquireFreshSuccessor(harness);
      // The explicit control-only handoff neither repairs nor rolls back the
      // separate destination. The fresh startup must perform its own adoption.
      expect((await readDestination(harness)).barrier).toEqual(partialBarrier);
      await expect(readReadiness(harness)).resolves.toEqual(before);
      const adopted = await prepare(harness, successor);
      expect(adopted).toMatchObject({ status: 'ADOPTED', store_id: STORE_ID });
      expect(applicationStateReadinessAuthority(adopted)).toEqual(successor);
      expect((await readDestination(harness)).barrier).toEqual(
        expectedBarrier(harness, successor),
      );
      await expectHistoryUnchanged(harness);
      expectOwnedHandlesClosed();
    },
  );

  test.each(['destination adoption', 'control acknowledgement'])(
    'rejects a stale predecessor paused before %s after the successor becomes adopted',
    async (boundary) => {
      const harness = await createHarness();
      const entered = deferred();
      const resume = deferred();
      let armed = true;
      destinationWrite = async (params, commit) => {
        if (
          boundary === 'destination adoption' &&
          armed &&
          isDestinationAdoption(params)
        ) {
          armed = false;
          entered.resolve();
          await resume.promise;
        }
        await commit();
      };
      const control = instrumentControl(
        harness.controlDb,
        async (params, commit) => {
          if (
            boundary === 'control acknowledgement' &&
            armed &&
            isReadinessWrite(params, 'ADOPTED')
          ) {
            armed = false;
            entered.resolve();
            await resume.promise;
          }
          await commit();
        },
      );
      const pending = prepare(harness, harness.authority, control.db).then(
        (value) => ({ value, error: undefined }),
        (error) => ({ value: undefined, error }),
      );
      try {
        await Promise.race([
          entered.promise,
          pending.then(({ error }) => {
            throw error ?? new Error(`Predecessor never reached ${boundary}.`);
          }),
        ]);
        expect(await readReadiness(harness)).toMatchObject({
          status: 'PREPARING',
        });
        expect((await readDestination(harness)).barrier).toEqual(
          boundary === 'destination adoption'
            ? null
            : expectedBarrier(harness, harness.authority),
        );
        const successor = await acquireFreshSuccessor(harness);
        const adopted = await prepare(harness, successor);
        resume.resolve();
        const stale = await pending;
        expect(stale.value).toBeUndefined();
        expect(stale.error).toBeInstanceOf(
          boundary === 'destination adoption'
            ? ApplicationStateCoordinatorAuthorityStaleError
            : CoordinatorAuthorityStaleError,
        );
        await expect(readReadiness(harness)).resolves.toEqual(adopted);
        expect((await readDestination(harness)).barrier).toEqual(
          expectedBarrier(harness, successor),
        );
        await expectHistoryUnchanged(harness);
        expectOwnedHandlesClosed();
      } finally {
        resume.resolve();
        await pending;
      }
    },
  );

  test.each(['destination adoption', 'control acknowledgement'])(
    'recovers a lost %s response and retries the exact token without another write',
    async (boundary) => {
      const harness = await createHarness();
      let armed = true;
      destinationWrite = async (params, commit) => {
        await commit();
        if (
          boundary === 'destination adoption' &&
          armed &&
          isDestinationAdoption(params)
        ) {
          armed = false;
          throw new Error('destination committed but response lost');
        }
      };
      const control = instrumentControl(
        harness.controlDb,
        async (params, commit) => {
          await commit();
          if (
            boundary === 'control acknowledgement' &&
            armed &&
            isReadinessWrite(params, 'ADOPTED')
          ) {
            armed = false;
            throw new Error('acknowledgement committed but response lost');
          }
        },
      );
      const adopted = await prepare(harness, harness.authority, control.db);
      expect(armed).toBe(false);
      expect(adopted).toMatchObject({ status: 'ADOPTED', store_id: STORE_ID });
      const destination = await readDestination(harness);
      const barrier = expectedBarrier(harness, harness.authority);
      expect(destination.barrier).toEqual(barrier);
      const controlWrites = control.transactionWrite.mock.calls.length;
      const destinationTransactionCount =
        destinationTransactions.mock.calls.length;
      const destinationMutations = destinationMutationCount();
      await expect(
        prepare(harness, harness.authority, control.db),
      ).resolves.toEqual(adopted);
      expect(control.transactionWrite).toHaveBeenCalledTimes(controlWrites);
      expect(destinationMutationCount()).toBe(destinationMutations);
      const replayTransactions = destinationTransactions.mock.calls.slice(
        destinationTransactionCount,
      );
      expect(replayTransactions).toHaveLength(1);
      expectExactReplayFence(
        replayTransactions[0][0],
        destination.identity,
        barrier,
      );
      await expectHistoryUnchanged(harness);
      expectOwnedHandlesClosed();
    },
  );

  describe.each(['missing', 'replaced'])('%s destination', (state) => {
    test('does not recreate or adopt a pinned store even without historical effects', async () => {
      const harness = await createHarness({ withHistory: false });
      const adopted = await prepare(harness);
      expectOwnedHandlesClosed();
      await displaceDestination(harness, state);
      const control = instrumentControl(harness.controlDb);
      const writesBefore = destinationTransactions.mock.calls.length;

      await expect(
        prepare(harness, harness.authority, control.db),
      ).rejects.toThrow();
      expect(control.transactionWrite).not.toHaveBeenCalled();
      expect(destinationTransactions).toHaveBeenCalledTimes(writesBefore);
      await expect(readReadiness(harness)).resolves.toEqual(adopted);
      expect(existsSync(harness.applicationPath)).toBe(state === 'replaced');
      if (state === 'replaced') {
        const replacement = await readDestination(harness, OTHER_STORE_ID);
        expect(replacement.identity?.store_id).toBe(OTHER_STORE_ID);
        expect(replacement.barrier).toBeNull();
      }
      expectOwnedHandlesClosed();
    });

    test('refuses a historical destination mismatch before creating its first readiness record', async () => {
      const harness = await createHarness();
      if (!harness.retained)
        throw new Error('This proof requires retained history.');
      await displaceDestination(harness, state);
      const control = instrumentControl(harness.controlDb);
      await expect(
        prepare(harness, harness.authority, control.db),
      ).rejects.toThrow();
      expect(control.transactionWrite).not.toHaveBeenCalled();
      expect(destinationTransactions).not.toHaveBeenCalled();
      await expect(readReadiness(harness)).resolves.toBeNull();
      expect(existsSync(harness.applicationPath)).toBe(state === 'replaced');
      expect(await harness.ledger.rebuildRun(harness.retained.runId)).toEqual(
        harness.retained.view,
      );
      if (state === 'replaced') {
        expect(
          (await readDestination(harness, OTHER_STORE_ID)).barrier,
        ).toBeNull();
      }
    });
  });
});

/** @param {Harness} harness @param {string} state */
async function displaceDestination(harness, state) {
  // Preserve the original generated store so this models routing to an absent
  // or foreign volume, not a fixture that deletes its high-water barrier.
  renameSync(
    harness.applicationPath,
    join(harness.root, 'retained-application'),
  );
  if (state !== 'replaced') return;
  const db = await createApplicationStateDBClient('lmdb', {
    path: harness.applicationPath,
  });
  try {
    await createApplicationStateTable({
      db,
      tableName: APPLICATION_STATE_TABLE_NAME,
      createStoreId: () => OTHER_STORE_ID,
    }).ensureStoreIdentity();
  } finally {
    await db.close();
  }
}
