/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPackageSeaApplicationStateReadinessProof } from '../../scripts/application-state-readiness-proof.js';
import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import { APPLICATION_STATE_TABLE_NAME } from '../../src/core/lib/config/db.js';
import {
  APPLICATION_STATE_STORE_RESOURCE_ID,
  APPLICATION_STATE_STORE_SORT_KEY,
  createApplicationStateTable,
} from '../../src/core/lib/db/tables/application-state.js';
import {
  createApplicationStateCoordinatorAuthorityKey,
  createApplicationStateCoordinatorAuthorityRecord,
} from '../../src/core/lib/db/tables/application-state-authority.js';
import { createApplicationStateReadinessStore } from '../../src/core/lib/db/tables/application-state-readiness.js';
import {
  assertCoordinatorAuthorityToken,
  createCoordinatorAuthority,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import {
  createLedgerServiceId,
  createLedgerServiceLifecycle,
  createLedgerServiceOwnership,
  createLedgerServiceSessionId,
} from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';

/** @typedef {import('../../src/core/lib/db/base.js').GetParams} GetParams */
/** @typedef {Awaited<ReturnType<typeof fixture>>} Fixture */

const TABLE_NAME = 'readiness-proof-control';
const APP_ID = 'readiness-proof';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const INSTALLED_ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** @type {Array<() => Promise<void>>} */
const cleanups = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'wharfie-readiness-proof-'));
  const controlPath = join(root, 'control');
  const applicationStatePath = join(root, 'application-state');
  // Unit tests model physical-file preconditions and inject a read-only
  // adapter. The packaged verifier supplies the real installed LMDB adapter.
  for (const storePath of [controlPath, applicationStatePath]) {
    mkdirSync(join(storePath, 'lmdb'), { recursive: true });
    for (const file of ['data.mdb', 'lock.mdb']) {
      writeFileSync(join(storePath, 'lmdb', file), `${storePath}:${file}`, {
        flag: 'wx',
      });
    }
  }
  const controlDB = createVanillaDB({ path: controlPath });
  const applicationDB = createVanillaDB({ path: applicationStatePath });
  cleanups.push(async () => {
    await applicationDB.close();
    await controlDB.close();
    rmSync(root, { recursive: true, force: true });
  });
  const serviceId = createLedgerServiceId({ appId: APP_ID });
  const sessionId = createLedgerServiceSessionId();
  const authorityStore = createCoordinatorAuthority({
    db: controlDB,
    tableName: TABLE_NAME,
  });
  const { authority } = await authorityStore.acquire({
    appId: APP_ID,
    coordinatorId: sessionId,
    requestId: 'acquire-first',
    observedAt: 10,
  });
  const applicationTable = createApplicationStateTable({
    db: applicationDB,
    tableName: APPLICATION_STATE_TABLE_NAME,
    coordinatorAuthority: authority,
  });
  const identity = await applicationTable.ensureStoreIdentity();
  const destination = {
    kind: 'application-state',
    version: 2,
    bindingId: 'primary',
    configuration: {
      provider: 'lmdb',
      storeId: identity.store_id,
      tableName: APPLICATION_STATE_TABLE_NAME,
      namespace: APP_ID,
    },
  };
  const readinessStore = createApplicationStateReadinessStore({
    db: controlDB,
    tableName: TABLE_NAME,
    coordinatorAuthority: authority,
  });
  const preparation = await readinessStore.prepare({ destination });
  const barrier = await applicationTable.readCoordinatorAuthority({
    storeId: identity.store_id,
    namespace: APP_ID,
  });
  const adopted = await readinessStore.markAdopted({
    preparation,
    destinationAuthority: barrier,
  });
  const lifecycleStore = createLedgerServiceLifecycle({
    db: controlDB,
    tableName: TABLE_NAME,
    applicationStateReadiness: adopted,
  });
  const started = await lifecycleStore.start({
    serviceId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    sessionId,
    observedAt: 20,
  });
  const { lifecycle } = await lifecycleStore.markReady({
    serviceId,
    sessionId,
    generation: started.lifecycle.generation,
    observedAt: 30,
  });
  const ownershipStore = createLedgerServiceOwnership({
    db: controlDB,
    tableName: TABLE_NAME,
  });
  const { ownership } = await ownershipStore.claimOwnership({
    serviceId,
    appId: APP_ID,
    scopeId: 'proof-scope',
    principalId: 'proof-owner',
    sessionId,
    ownerKind: 'resident',
    expected: null,
    claimedAt: 15,
  });
  const options = {
    installedPackageRoot: INSTALLED_ROOT,
    controlPath,
    applicationStatePath,
    tableName: TABLE_NAME,
    appId: APP_ID,
  };
  const mutation = jest.fn(async () => {
    throw new Error('readiness observer attempted a mutation');
  });
  /** @type {Array<{path: string, readOnly: true}>} */
  const opens = [];
  /** @type {string[]} */
  const closes = [];
  /** @type {{afterApplicationRead?: () => Promise<void>}} */
  const hooks = {};
  const ports = {
    openReadOnlyDB(/** @type {{path: string, readOnly: true}} */ input) {
      expect(input.readOnly).toBe(true);
      expect([controlPath, applicationStatePath]).toContain(input.path);
      opens.push({ ...input });
      const db = input.path === controlPath ? controlDB : applicationDB;
      return {
        ...db,
        async get(/** @type {GetParams} */ params) {
          const result = await db.get(params);
          if (
            input.path === applicationStatePath &&
            hooks.afterApplicationRead
          ) {
            const run = hooks.afterApplicationRead;
            delete hooks.afterApplicationRead;
            await run();
          }
          return result;
        },
        put: mutation,
        update: mutation,
        remove: mutation,
        batchWrite: mutation,
        transactionWrite: mutation,
        async close() {
          closes.push(input.path);
        },
      };
    },
  };
  const proof = await createPackageSeaApplicationStateReadinessProof(
    options,
    ports,
  );
  return {
    root,
    controlPath,
    applicationStatePath,
    controlDB,
    applicationDB,
    serviceId,
    authority,
    authorityStore,
    applicationTable,
    readinessStore,
    lifecycleStore,
    ownershipStore,
    identity,
    destination,
    preparation,
    barrier,
    adopted,
    lifecycle,
    ownership,
    options,
    mutation,
    opens,
    closes,
    hooks,
    ports,
    proof,
  };
}

/** @param {Fixture} value @param {Record<string, any>} record */
async function replaceReadiness(value, record) {
  await value.controlDB.put({
    tableName: TABLE_NAME,
    keyName: 'run_id',
    sortKeyName: 'sort_key',
    record,
  });
}

/** @param {Fixture} value */
async function replaceResident(value) {
  const sessionId = createLedgerServiceSessionId();
  const { authority } = await value.authorityStore.takeover({
    appId: APP_ID,
    coordinatorId: sessionId,
    requestId: 'takeover-second',
    observedAuthority: value.authority,
    confirmAuthorityReplacement: true,
    observedAt: 40,
  });
  const readiness = createApplicationStateReadinessStore({
    db: value.controlDB,
    tableName: TABLE_NAME,
    coordinatorAuthority: authority,
  });
  const applicationTable = createApplicationStateTable({
    db: value.applicationDB,
    tableName: APPLICATION_STATE_TABLE_NAME,
    coordinatorAuthority: authority,
  });
  const destinationAuthority = await applicationTable.adoptCoordinatorAuthority(
    { storeId: value.identity.store_id, namespace: APP_ID },
  );
  const adopted = await readiness.advanceAdopted({
    predecessor: value.adopted,
    destinationAuthority,
  });
  const lifecycleStore = createLedgerServiceLifecycle({
    db: value.controlDB,
    tableName: TABLE_NAME,
    applicationStateReadiness: adopted,
  });
  const started = await lifecycleStore.start({
    serviceId: value.serviceId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    sessionId,
    observedAt: 50,
  });
  const { lifecycle } = await lifecycleStore.markReady({
    serviceId: value.serviceId,
    sessionId,
    generation: started.lifecycle.generation,
    observedAt: 60,
  });
  await value.ownershipStore.claimOwnership({
    serviceId: value.serviceId,
    appId: APP_ID,
    scopeId: 'proof-scope',
    principalId: 'proof-owner',
    sessionId,
    ownerKind: 'resident',
    expected: value.ownership,
    claimedAt: 45,
  });
  return { authority, adopted, lifecycle, destinationAuthority };
}

describe('packaged live READY application-state proof', () => {
  test('reads installed contracts through separate read-only handles and changes no evidence', async () => {
    const value = await fixture();
    const files = [value.controlPath, value.applicationStatePath].flatMap(
      (root) =>
        ['data.mdb', 'lock.mdb'].map((file) => join(root, 'lmdb', file)),
    );
    const bytes = files.map((file) => readFileSync(file));
    const result = await value.proof.assertReady(value.lifecycle);
    expect(result).toEqual({
      readiness: value.adopted,
      authority: value.authority,
      storeIdentity: value.identity,
      destinationAuthority: value.barrier,
    });
    expect(value.opens).toEqual([
      { path: value.controlPath, readOnly: true },
      { path: value.applicationStatePath, readOnly: true },
    ]);
    expect(value.closes).toEqual([
      value.applicationStatePath,
      value.controlPath,
    ]);
    expect(value.mutation).not.toHaveBeenCalled();
    expect(files.map((file) => readFileSync(file))).toEqual(bytes);
    expect(await value.readinessStore.get({ appId: APP_ID })).toEqual(
      value.adopted,
    );
    expect(
      await value.applicationTable.readCoordinatorAuthority({
        storeId: value.identity.store_id,
        namespace: APP_ID,
      }),
    ).toEqual(value.barrier);
  });

  test('rechecks a still-live session and proves replacement READY uses the same pin with a higher token', async () => {
    const value = await fixture();
    await value.proof.assertReady(value.lifecycle);
    await value.proof.assertReady(value.lifecycle);
    const successor = await replaceResident(value);
    const result = await value.proof.assertReady(successor.lifecycle);
    expect(result.readiness).toEqual(successor.adopted);
    expect(result.destinationAuthority).toEqual(successor.destinationAuthority);
    expect(result.readiness.store_id).toBe(value.adopted.store_id);
    expect(result.authority.epoch).toBeGreaterThan(value.authority.epoch);
    expect(value.mutation).not.toHaveBeenCalled();
  });

  test.each(['missing', 'preparing', 'corrupt'])(
    'rejects a %s control pin without opening the destination or repairing it',
    async (kind) => {
      const value = await fixture();
      if (kind === 'missing')
        await value.controlDB.remove({
          tableName: TABLE_NAME,
          keyName: 'run_id',
          keyValue: value.adopted.run_id,
          sortKeyName: 'sort_key',
          sortKeyValue: value.adopted.sort_key,
        });
      else
        await replaceReadiness(
          value,
          kind === 'preparing'
            ? value.preparation
            : { ...value.adopted, unexpected: true },
        );
      await expect(value.proof.assertReady(value.lifecycle)).rejects.toThrow();
      expect(value.opens).toEqual([
        { path: value.controlPath, readOnly: true },
      ]);
      expect(value.closes).toEqual([value.controlPath]);
      expect(value.mutation).not.toHaveBeenCalled();
    },
  );

  test.each(['released', 'taken-over'])(
    'an ADOPTED row does not prove current readiness after authority is %s',
    async (kind) => {
      const value = await fixture();
      if (kind === 'released')
        await value.authorityStore.release({
          authority: value.authority,
          requestId: 'release-first',
          observedAt: 40,
        });
      else
        await value.authorityStore.takeover({
          appId: APP_ID,
          coordinatorId: createLedgerServiceSessionId(),
          requestId: 'takeover-other',
          observedAuthority: value.authority,
          confirmAuthorityReplacement: true,
          observedAt: 40,
        });
      await expect(value.proof.assertReady(value.lifecycle)).rejects.toThrow(
        /stale|inactive/,
      );
      expect(value.opens).toHaveLength(1);
      expect(value.closes).toEqual([value.controlPath]);
      expect(value.mutation).not.toHaveBeenCalled();
    },
  );

  test.each(['missing', 'newer-token', 'wrong-store', 'corrupt'])(
    'rejects a %s destination barrier and closes both observers',
    async (kind) => {
      const value = await fixture();
      const key = createApplicationStateCoordinatorAuthorityKey(APP_ID);
      if (kind === 'missing')
        await value.applicationDB.remove({
          tableName: APPLICATION_STATE_TABLE_NAME,
          keyName: 'resource_id',
          keyValue: key.resourceId,
          sortKeyName: 'sort_key',
          sortKeyValue: key.sortKey,
        });
      else {
        const token = assertCoordinatorAuthorityToken(value.authority);
        const record =
          kind === 'corrupt'
            ? { ...value.barrier, unexpected: true }
            : createApplicationStateCoordinatorAuthorityRecord({
                storeId:
                  kind === 'wrong-store'
                    ? `was_${'A'.repeat(43)}`
                    : value.identity.store_id,
                namespace: APP_ID,
                authority:
                  kind === 'newer-token'
                    ? {
                        ...token,
                        coordinatorId: 'newer-coordinator',
                        epoch: token.epoch + 1,
                      }
                    : token,
              });
        await value.applicationDB.put({
          tableName: APPLICATION_STATE_TABLE_NAME,
          keyName: 'resource_id',
          sortKeyName: 'sort_key',
          record,
        });
      }
      await expect(value.proof.assertReady(value.lifecycle)).rejects.toThrow();
      expect(value.opens).toHaveLength(2);
      expect(value.closes).toEqual([
        value.applicationStatePath,
        value.controlPath,
      ]);
      expect(value.mutation).not.toHaveBeenCalled();
    },
  );

  test('a missing real destination identity cannot be reconstructed by the proof', async () => {
    const value = await fixture();
    await value.applicationDB.remove({
      tableName: APPLICATION_STATE_TABLE_NAME,
      keyName: 'resource_id',
      keyValue: APPLICATION_STATE_STORE_RESOURCE_ID,
      sortKeyName: 'sort_key',
      sortKeyValue: APPLICATION_STATE_STORE_SORT_KEY,
    });
    await expect(value.proof.assertReady(value.lifecycle)).rejects.toThrow(
      /store identity/,
    );
    expect(await value.applicationTable.readStoreIdentity()).toBeNull();
    expect(value.mutation).not.toHaveBeenCalled();
    expect(value.closes).toEqual([
      value.applicationStatePath,
      value.controlPath,
    ]);
  });

  test.each([
    'control-data',
    'control-lock',
    'application-data',
    'application-lock',
  ])('refuses missing %s before opening either volume', async (file) => {
    const value = await fixture();
    const storePath = file.startsWith('control')
      ? value.controlPath
      : value.applicationStatePath;
    const target = join(
      storePath,
      'lmdb',
      file.endsWith('data') ? 'data.mdb' : 'lock.mdb',
    );
    rmSync(target);
    await expect(value.proof.assertReady(value.lifecycle)).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
    expect(value.opens).toEqual([]);
    expect(value.mutation).not.toHaveBeenCalled();
  });

  test('rejects one shared volume even when the tables differ', async () => {
    const value = await fixture();
    const proof = await createPackageSeaApplicationStateReadinessProof(
      { ...value.options, applicationStatePath: value.controlPath },
      value.ports,
    );
    await expect(proof.assertReady(value.lifecycle)).rejects.toThrow(
      /separate application-state/,
    );
    expect(value.opens).toEqual([]);
  });

  test.each(['data.mdb', 'lock.mdb'])(
    'rejects a hard-linked %s across nominally separate paths',
    async (file) => {
      const value = await fixture();
      const destinationPath = join(value.applicationStatePath, 'lmdb', file);
      rmSync(destinationPath);
      linkSync(join(value.controlPath, 'lmdb', file), destinationPath);
      await expect(value.proof.assertReady(value.lifecycle)).rejects.toThrow(
        /must not alias/,
      );
      expect(value.opens).toEqual([]);
    },
  );

  test.each(['status', 'appId', 'serviceId', 'sessionId', 'generation'])(
    'rejects a mismatched lifecycle %s',
    async (field) => {
      const value = await fixture();
      const snapshot = {
        ...value.lifecycle,
        [field]:
          field === 'generation' ? value.lifecycle.generation + 1 : 'other',
      };
      await expect(value.proof.assertReady(snapshot)).rejects.toThrow();
      expect(value.mutation).not.toHaveBeenCalled();
      expect(value.closes.length).toBe(value.opens.length);
    },
  );

  test.each(['source', 'pin', 'lifecycle', 'ownership'])(
    'refuses a %s change during the separate destination readback',
    async (kind) => {
      const value = await fixture();
      value.hooks.afterApplicationRead = async () => {
        if (kind === 'source')
          await value.authorityStore.release({
            authority: value.authority,
            requestId: 'release-during-read',
            observedAt: 40,
          });
        else if (kind === 'pin')
          await replaceReadiness(value, value.preparation);
        else if (kind === 'lifecycle')
          await value.lifecycleStore.markStopping({
            serviceId: value.serviceId,
            sessionId: value.lifecycle.sessionId,
            generation: value.lifecycle.generation,
            observedAt: 40,
          });
        else
          await value.ownershipStore.releaseOwnership({
            serviceId: value.serviceId,
            scopeId: value.ownership.scopeId,
            principalId: value.ownership.principalId,
            sessionId: value.ownership.sessionId,
            generation: value.ownership.generation,
          });
      };
      await expect(value.proof.assertReady(value.lifecycle)).rejects.toThrow();
      expect(value.closes).toEqual([
        value.applicationStatePath,
        value.controlPath,
      ]);
      expect(value.mutation).not.toHaveBeenCalled();
    },
  );

  test('snapshots configured paths and the expected lifecycle before awaits', async () => {
    const value = await fixture();
    const options = { ...value.options };
    const pendingProof = createPackageSeaApplicationStateReadinessProof(
      options,
      value.ports,
    );
    options.applicationStatePath = options.controlPath;
    options.appId = 'redirected-app';
    const proof = await pendingProof;
    const lifecycle = { ...value.lifecycle };
    value.hooks.afterApplicationRead = async () => {
      lifecycle.sessionId = 'redirected-session';
      lifecycle.generation = 99;
    };
    await expect(proof.assertReady(lifecycle)).resolves.toMatchObject({
      readiness: value.adopted,
    });
    expect(value.mutation).not.toHaveBeenCalled();
  });
});
