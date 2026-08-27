/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  APPLICATION_STATE_TABLE_NAME,
  createControlDBClient,
  resolveExecutionPayloadStoreId,
} from '../../../src/core/lib/config/db.js';
import { createApplicationStateCoordinatorAuthorityRecord } from '../../../src/core/lib/db/tables/application-state-authority.js';
import {
  applicationStateReadinessAuthority,
  applicationStateReadinessDestination,
  createApplicationStateReadinessStore,
} from '../../../src/core/lib/db/tables/application-state-readiness.js';
import { createApplicationStateTable } from '../../../src/core/lib/db/tables/application-state.js';
import {
  CoordinatorAuthorityStatus,
  createCoordinatorAuthority,
  createCoordinatorAuthorityToken,
} from '../../../src/core/lib/db/tables/coordinator-authority.js';
import {
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
} from '../../../src/core/resources/builds/lib/revision-runtime-assets.js';
import {
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
  createApplicationRevision,
} from '../../../src/core/runtime/application-revision.js';
import { createCanonicalJsonSha256Id } from '../../../src/core/runtime/content-id.js';
import {
  getLocalServiceSessionEndpoint,
  getLocalServiceSessionOwnerCommandEndpoint,
} from '../../../src/core/runtime/local-service-session.js';

/** @typedef {import('../../../src/core/lib/db/base.js').TransactionWriteParams} Transaction */
/** @typedef {{value: Readonly<{processed: number}>, error?: undefined} | {value?: undefined, error: unknown}} ServiceOutcome */
/** @typedef {{shutdown: AbortController, done: Promise<ServiceOutcome>}} RunningService */

const APPLICATION_STATE_STORE_IMPORT =
  '../../../src/core/runtime/application-state-store.js';
const LIFECYCLE_IMPORT =
  '../../../src/core/lib/db/tables/ledger-service-lifecycle.js';
const SCHEDULE_OBSERVER_IMPORT =
  '../../../src/core/runtime/services/resident-schedule-observer.js';
const OWNER_COMMAND_IMPORT =
  '../../../src/core/runtime/operator/local-owner-command.js';
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});
const STORE_ID = fixtureId('retained-store');
const OTHER_STORE_ID = fixtureId('replacement-store');
const testOnUnix = process.platform === 'win32' ? test.skip : test;

/** @type {Array<() => Promise<void>>} */
let cleanups = [];
/** @type {Array<{close: ReturnType<typeof jest.fn>, cleanup: () => Promise<void>}>} */
let openedDestinations = [];
/** @type {((params: Transaction, commit: () => Promise<void>) => Promise<void>) | undefined} */
let destinationWrite;

// Forward every operation to the real implementation. Only the exact native
// adoption transaction can be paused; no readiness or ownership is fabricated.
const realApplicationStateStore = await import(APPLICATION_STATE_STORE_IMPORT);
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
          if (destinationWrite) {
            return await destinationWrite(params, async () => {
              await access.db.transactionWrite(params);
            });
          }
          await access.db.transactionWrite(params);
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

const realLifecycle = await import(LIFECYCLE_IMPORT);
const markReady = jest.fn(
  async (
    /** @type {Parameters<typeof realLifecycle.createLedgerServiceLifecycle>[0]} */
    options,
    /** @type {Parameters<ReturnType<typeof realLifecycle.createLedgerServiceLifecycle>['markReady']>[0]} */
    input,
  ) =>
    await realLifecycle.createLedgerServiceLifecycle(options).markReady(input),
);
jest.unstable_mockModule(LIFECYCLE_IMPORT, () => ({
  ...realLifecycle,
  createLedgerServiceLifecycle(
    /** @type {Parameters<typeof realLifecycle.createLedgerServiceLifecycle>[0]} */
    options,
  ) {
    const store = realLifecycle.createLedgerServiceLifecycle(options);
    return {
      ...store,
      markReady: async (
        /** @type {Parameters<typeof store.markReady>[0]} */ input,
      ) => await markReady(options, input),
    };
  },
}));

const realScheduleObserver = await import(SCHEDULE_OBSERVER_IMPORT);
const runResidentScheduleObserver = jest.fn(
  realScheduleObserver.runResidentScheduleObserver,
);
jest.unstable_mockModule(SCHEDULE_OBSERVER_IMPORT, () => ({
  ...realScheduleObserver,
  runResidentScheduleObserver,
}));
const realOwnerCommand = await import(OWNER_COMMAND_IMPORT);
const createLocalOwnerCommandServer = jest.fn(
  realOwnerCommand.createLocalOwnerCommandServer,
);
jest.unstable_mockModule(OWNER_COMMAND_IMPORT, () => ({
  ...realOwnerCommand,
  createLocalOwnerCommandServer,
}));
const { runLocalResidentActivityService } =
  await import('../../../src/core/runtime/services/resident-activity-worker.js');
const { LedgerServiceLifecycleStatus, createLedgerServiceId } = realLifecycle;

afterEach(async () => {
  const pending = cleanups;
  cleanups = [];
  destinationWrite = undefined;
  /** @type {unknown[]} */
  const failures = [];
  for (const cleanup of pending.reverse()) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  openedDestinations = [];
  openApplicationStateDB.mockClear();
  markReady.mockClear();
  runResidentScheduleObserver.mockClear();
  createLocalOwnerCommandServer.mockClear();
  if (failures.length > 0) {
    throw new AggregateError(failures, 'resident readiness cleanup failed');
  }
});

/** @param {string} value */
function fixtureId(value) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:test:resident-application-state-readiness:v1',
    prefix: 'was',
    value,
  });
}

/** @param {string} value @returns {{algorithm: 'sha256', value: string}} */
function digest(value) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/** @param {string} appId @returns {import('../../../src/core/runtime/durable-activity-host.js').ManifestActivityExecution} */
function makeEmbeddedExecution(appId) {
  const contract = {
    schemaVersion: 4,
    app: { id: appId },
    cli: { entrypoint: { kind: 'node', path: 'cli.js', export: 'main' } },
    activities: {
      greet: {
        entrypoint: {
          kind: 'node',
          path: 'activities/greet.js',
          export: 'greet',
        },
      },
    },
  };
  const revision = createApplicationRevision({
    contract,
    inputs: {
      source: {
        format: SOURCE_TREE_INPUT_FORMAT,
        digest: digest(`${appId}:source`),
      },
      dependencies: {
        format: DEPENDENCY_LOCK_INPUT_FORMAT,
        digest: digest(`${appId}:dependencies`),
      },
      runtime: {
        format: RUNTIME_INPUT_FORMAT,
        digest: digest(`${appId}:runtime`),
      },
    },
  });
  return {
    kind: 'embedded',
    manifest: { ...contract, targets: [{ ...TARGET }] },
    embeddedRevision: {
      revision,
      runtime: {
        schemaVersion: ARTIFACT_RUNTIME_SCHEMA_VERSION,
        kind: ARTIFACT_RUNTIME_KIND,
        appId,
        revisionId: revision.revisionId,
        target: { ...TARGET },
      },
    },
  };
}

function deferred() {
  let release = () => {};
  const promise = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  return { promise, resolve: release };
}

/** @template T @param {Promise<T>} promise @param {string} label @returns {Promise<T>} */
async function bounded(promise, label) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out: ${label}`)),
          4_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** @param {string} appId */
async function createHarness(appId) {
  const root = mkdtempSync(join(tmpdir(), 'wharfie-resident-readiness-'));
  const controlPath = join(root, 'control');
  const payloadPath = join(root, 'payloads');
  const configuration = Object.freeze({
    adapterName: /** @type {const} */ ('lmdb'),
    controlPath,
    tableName: 'wharfie-execution-ledger-v10',
    payloadPath,
    payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
    sessionPath: join(root, 'sessions'),
  });
  const applicationStateConfiguration = Object.freeze({
    adapterName: /** @type {const} */ ('lmdb'),
    storePath: join(root, 'application-state'),
    tableName: APPLICATION_STATE_TABLE_NAME,
  });
  const db = await createControlDBClient('lmdb', { path: controlPath });
  cleanups.push(async () => {
    for (const destination of openedDestinations) await destination.cleanup();
    try {
      await db.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  const stores = { db, tableName: configuration.tableName };
  return {
    root,
    appId,
    serviceId: createLedgerServiceId({ appId }),
    execution: makeEmbeddedExecution(appId),
    configuration,
    applicationStateConfiguration,
    lifecycle: realLifecycle.createLedgerServiceLifecycle(stores),
    ownership: realLifecycle.createLedgerServiceOwnership(stores),
    authority: createCoordinatorAuthority(stores),
    readiness: createApplicationStateReadinessStore(stores),
  };
}

/** @typedef {Awaited<ReturnType<typeof createHarness>>} Harness */

/** @param {Harness} harness @returns {RunningService} */
function startService(harness) {
  const shutdown = new AbortController();
  const done = runLocalResidentActivityService({
    execution: harness.execution,
    signal: shutdown.signal,
    pollIntervalMs: 5,
    drainTimeoutMs: 20,
    configuration: harness.configuration,
    applicationStateConfiguration: harness.applicationStateConfiguration,
  }).then(
    (value) => ({ value, error: undefined }),
    (error) => ({ value: undefined, error }),
  );
  const service = { shutdown, done };
  cleanups.push(async () => {
    shutdown.abort(new Error('test cleanup'));
    await bounded(done, 'resident cleanup');
  });
  return service;
}

/** @param {RunningService} service */
async function serviceResult(service) {
  const outcome = await bounded(service.done, 'resident completion');
  if (outcome.error !== undefined) throw outcome.error;
  return outcome.value;
}

/** @param {RunningService} service */
async function stopService(service) {
  service.shutdown.abort(new Error('test shutdown'));
  await expect(serviceResult(service)).resolves.toEqual({ processed: 0 });
}

/** @param {Harness} harness @param {RunningService} service */
async function waitForReady(harness, service) {
  const poll = async () => {
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      const snapshot = await harness.lifecycle.get({
        serviceId: harness.serviceId,
      });
      if (snapshot?.status === LedgerServiceLifecycleStatus.READY) {
        return snapshot;
      }
      await delay(5);
    }
    throw new Error('Resident never reached READY.');
  };
  return await bounded(
    Promise.race([
      poll(),
      service.done.then(({ error }) => {
        throw error ?? new Error('Resident stopped before READY.');
      }),
    ]),
    'resident READY',
  );
}

/** @param {Harness} harness @param {string} storeId */
async function seedDestination(harness, storeId) {
  const access = await realApplicationStateStore.openApplicationStateDB({
    configuration: harness.applicationStateConfiguration,
  });
  try {
    return await createApplicationStateTable({
      db: access.db,
      tableName: access.context.tableName,
      createStoreId: () => storeId,
    }).ensureStoreIdentity();
  } finally {
    await access.close();
  }
}

/** @param {Harness} harness @param {string} [storePath] */
async function readDestination(
  harness,
  storePath = harness.applicationStateConfiguration.storePath,
) {
  const access = await realApplicationStateStore.openApplicationStateDB({
    configuration: { ...harness.applicationStateConfiguration, storePath },
    readOnly: true,
  });
  try {
    const table = createApplicationStateTable({
      db: access.db,
      tableName: access.context.tableName,
    });
    const identity = await table.readStoreIdentity();
    if (!identity) throw new Error('Expected the destination identity.');
    return {
      identity,
      barrier: await table.readCoordinatorAuthority({
        storeId: identity.store_id,
        namespace: harness.appId,
      }),
    };
  } finally {
    await access.close();
  }
}

/** @param {Harness} harness @param {Readonly<Record<string, any>>} lifecycle */
function endpoints(harness, lifecycle) {
  const scope = {
    serviceId: harness.serviceId,
    sessionId: lifecycle.sessionId,
    sessionRoot: harness.configuration.sessionPath,
  };
  return {
    liveness: getLocalServiceSessionEndpoint(scope),
    command: getLocalServiceSessionOwnerCommandEndpoint(scope),
  };
}

/** @param {Harness} harness @param {Readonly<Record<string, any>>} lifecycle */
async function expectReady(harness, lifecycle) {
  const readiness = await harness.readiness.get({ appId: harness.appId });
  const current = await harness.authority.get({ appId: harness.appId });
  if (!readiness || !current) throw new Error('READY requires both records.');
  const authority = createCoordinatorAuthorityToken(current);
  const destination = await readDestination(harness);
  const expectedBarrier = createApplicationStateCoordinatorAuthorityRecord({
    storeId: destination.identity.store_id,
    namespace: harness.appId,
    authority,
  });
  expect(current).toMatchObject({
    status: CoordinatorAuthorityStatus.ACTIVE,
    coordinatorId: lifecycle.sessionId,
  });
  expect(readiness).toMatchObject({ status: 'ADOPTED' });
  expect(applicationStateReadinessAuthority(readiness)).toEqual(authority);
  expect(applicationStateReadinessDestination(readiness)).toEqual({
    kind: 'application-state',
    version: 2,
    bindingId: 'primary',
    configuration: {
      provider: 'lmdb',
      storeId: destination.identity.store_id,
      tableName: APPLICATION_STATE_TABLE_NAME,
      namespace: harness.appId,
    },
  });
  expect(destination.barrier).toEqual(expectedBarrier);
  expect(markReady).toHaveBeenLastCalledWith(
    expect.objectContaining({ applicationStateReadiness: readiness }),
    expect.objectContaining({
      serviceId: harness.serviceId,
      sessionId: lifecycle.sessionId,
      generation: lifecycle.generation,
    }),
  );
  await expect(
    harness.ownership.getOwnership({ serviceId: harness.serviceId }),
  ).resolves.toMatchObject({ sessionId: lifecycle.sessionId });
  const sockets = endpoints(harness, lifecycle);
  expect(existsSync(sockets.liveness)).toBe(true);
  expect(existsSync(sockets.command)).toBe(true);
  return { readiness, authority, destination };
}

/** @param {Harness} harness @param {number} generation */
async function expectStopped(harness, generation) {
  const lifecycle = await harness.lifecycle.get({
    serviceId: harness.serviceId,
  });
  if (!lifecycle) throw new Error('Expected a stopped lifecycle.');
  expect(lifecycle).toMatchObject({
    status: LedgerServiceLifecycleStatus.STOPPED,
    generation,
  });
  await expect(
    harness.ownership.getOwnership({ serviceId: harness.serviceId }),
  ).resolves.toBeNull();
  await expect(
    harness.authority.get({ appId: harness.appId }),
  ).resolves.toMatchObject({
    status: CoordinatorAuthorityStatus.RELEASED,
    coordinatorId: lifecycle.sessionId,
    epoch: generation,
  });
  const sockets = endpoints(harness, lifecycle);
  expect(existsSync(sockets.liveness)).toBe(false);
  expect(existsSync(sockets.command)).toBe(false);
  for (const destination of openedDestinations) {
    expect(destination.close).toHaveBeenCalledTimes(1);
  }
}

function expectWorkerNotStarted() {
  expect(markReady).not.toHaveBeenCalled();
  expect(runResidentScheduleObserver).not.toHaveBeenCalled();
  expect(createLocalOwnerCommandServer).not.toHaveBeenCalled();
}

describe('production resident application-state readiness', () => {
  testOnUnix(
    'starts a real idle worker only with exact adoption, retains its barrier on stop, and advances the same store on restart',
    async () => {
      const harness = await createHarness('resident-readiness-live');
      expect(existsSync(harness.applicationStateConfiguration.storePath)).toBe(
        false,
      );
      const first = startService(harness);
      let initial;
      try {
        initial = await expectReady(
          harness,
          await waitForReady(harness, first),
        );
        expect(runResidentScheduleObserver).toHaveBeenCalledTimes(1);
        expect(createLocalOwnerCommandServer).toHaveBeenCalledTimes(1);
        expect(markReady).toHaveBeenCalledTimes(1);
      } finally {
        await stopService(first);
      }
      await expectStopped(harness, 1);
      await expect(readDestination(harness)).resolves.toEqual(
        initial.destination,
      );
      await expect(
        harness.readiness.get({ appId: harness.appId }),
      ).resolves.toEqual(initial.readiness);

      const second = startService(harness);
      let restarted;
      try {
        restarted = await expectReady(
          harness,
          await waitForReady(harness, second),
        );
        expect(restarted.authority.epoch).toBe(initial.authority.epoch + 1);
        expect(restarted.authority.coordinatorId).not.toBe(
          initial.authority.coordinatorId,
        );
        expect(restarted.authority.authorityId).not.toBe(
          initial.authority.authorityId,
        );
        expect(restarted.destination.identity).toEqual(
          initial.destination.identity,
        );
        expect(runResidentScheduleObserver).toHaveBeenCalledTimes(2);
        expect(createLocalOwnerCommandServer).toHaveBeenCalledTimes(2);
        expect(markReady).toHaveBeenCalledTimes(2);
      } finally {
        await stopService(second);
      }
      await expectStopped(harness, 2);
      await expect(readDestination(harness)).resolves.toEqual(
        restarted.destination,
      );
    },
    15_000,
  );

  testOnUnix.each(['continue', 'cancel', 'fail'])(
    'keeps STARTING closed to scheduling and commands while destination adoption is paused: %s',
    async (outcome) => {
      const harness = await createHarness(`resident-readiness-${outcome}`);
      await seedDestination(harness, STORE_ID);
      const entered = deferred();
      const resume = deferred();
      const failure = new Error('injected destination adoption failure');
      let armed = true;
      destinationWrite = async (params, commit) => {
        if (
          armed &&
          params.putRequests?.some(
            ({ record }) =>
              record.record_kind === 'application-state-coordinator-authority',
          )
        ) {
          armed = false;
          entered.resolve();
          await resume.promise;
          if (outcome === 'fail') throw failure;
        }
        await commit();
      };
      const service = startService(harness);
      try {
        await bounded(
          Promise.race([
            entered.promise,
            service.done.then(({ error }) => {
              throw error ?? new Error('Resident never attempted adoption.');
            }),
          ]),
          'paused destination adoption',
        );
        const lifecycle = await harness.lifecycle.get({
          serviceId: harness.serviceId,
        });
        if (!lifecycle) throw new Error('Expected STARTING lifecycle.');
        expect(lifecycle).toMatchObject({
          status: LedgerServiceLifecycleStatus.STARTING,
          generation: 1,
        });
        const preparation = await harness.readiness.get({
          appId: harness.appId,
        });
        expect(preparation).toMatchObject({
          status: 'PREPARING',
          store_id: STORE_ID,
        });
        const current = await harness.authority.get({ appId: harness.appId });
        if (!current)
          throw new Error('Expected current coordinator authority.');
        expect(current).toMatchObject({
          status: CoordinatorAuthorityStatus.ACTIVE,
          coordinatorId: lifecycle.sessionId,
        });
        expect(applicationStateReadinessAuthority(preparation)).toEqual(
          createCoordinatorAuthorityToken(current),
        );
        expect((await readDestination(harness)).barrier).toBeNull();
        const sockets = endpoints(harness, lifecycle);
        expect(existsSync(sockets.liveness)).toBe(true);
        expect(existsSync(sockets.command)).toBe(false);
        expectWorkerNotStarted();

        if (outcome === 'cancel') {
          service.shutdown.abort(new Error('cancel while adoption is paused'));
        }
        resume.resolve();
        if (outcome === 'continue') {
          await expectReady(harness, await waitForReady(harness, service));
          await stopService(service);
        } else if (outcome === 'cancel') {
          await expect(serviceResult(service)).resolves.toEqual({
            processed: 0,
          });
          expectWorkerNotStarted();
          await expect(
            harness.readiness.get({ appId: harness.appId }),
          ).resolves.toEqual(preparation);
          // Cancellation after the write entered cannot roll back its barrier.
          expect((await readDestination(harness)).barrier).toEqual(
            createApplicationStateCoordinatorAuthorityRecord({
              storeId: STORE_ID,
              namespace: harness.appId,
              authority: createCoordinatorAuthorityToken(current),
            }),
          );
        } else {
          await expect(serviceResult(service)).rejects.toBe(failure);
          expectWorkerNotStarted();
          await expect(
            harness.readiness.get({ appId: harness.appId }),
          ).resolves.toEqual(preparation);
          expect((await readDestination(harness)).barrier).toBeNull();
        }
        await expectStopped(harness, 1);
      } finally {
        service.shutdown.abort(new Error('test cleanup'));
        resume.resolve();
        await bounded(service.done, 'paused resident cleanup');
      }
    },
    15_000,
  );

  testOnUnix.each(['missing', 'replaced'])(
    'refuses a %s pinned store before READY without recreating or adopting it',
    async (state) => {
      const harness = await createHarness(`resident-readiness-${state}`);
      const first = startService(harness);
      let initial;
      try {
        initial = await expectReady(
          harness,
          await waitForReady(harness, first),
        );
      } finally {
        await stopService(first);
      }
      await expectStopped(harness, 1);
      const retainedPath = join(harness.root, 'retained-application');
      renameSync(harness.applicationStateConfiguration.storePath, retainedPath);
      if (state === 'replaced') await seedDestination(harness, OTHER_STORE_ID);
      markReady.mockClear();
      runResidentScheduleObserver.mockClear();
      createLocalOwnerCommandServer.mockClear();
      openApplicationStateDB.mockClear();

      const second = startService(harness);
      try {
        await expect(serviceResult(second)).rejects.toThrow(
          state === 'missing'
            ? /read-only local volume does not exist/
            : /store identity does not match expected store/,
        );
        expectWorkerNotStarted();
        expect(openApplicationStateDB).toHaveBeenCalledTimes(1);
        expect(openApplicationStateDB).toHaveBeenLastCalledWith({
          configuration: harness.applicationStateConfiguration,
          readOnly: true,
        });
        await expectStopped(harness, 2);
        await expect(
          harness.readiness.get({ appId: harness.appId }),
        ).resolves.toEqual(initial.readiness);
        await expect(readDestination(harness, retainedPath)).resolves.toEqual(
          initial.destination,
        );
        expect(
          existsSync(harness.applicationStateConfiguration.storePath),
        ).toBe(state === 'replaced');
        if (state === 'replaced') {
          const replacement = await readDestination(harness);
          expect(replacement.identity.store_id).toBe(OTHER_STORE_ID);
          expect(replacement.barrier).toBeNull();
        }
      } finally {
        second.shutdown.abort(new Error('test cleanup'));
        await bounded(second.done, 'failed resident cleanup');
      }
    },
    15_000,
  );
});
