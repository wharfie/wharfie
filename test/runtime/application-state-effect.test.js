/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import {
  APPLICATION_STATE_TABLE_NAME,
  createApplicationStateDBClient,
} from '../../src/core/lib/config/db.js';
import {
  APPLICATION_STATE_KEY_NAME,
  APPLICATION_STATE_SORT_KEY_NAME,
  APPLICATION_STATE_STORE_RESOURCE_ID,
  APPLICATION_STATE_STORE_SORT_KEY,
  ApplicationStateCorruptionError,
  ApplicationStateEffectConflictError,
  ApplicationStateEffectNotAppliedError,
  ApplicationStateStoreIdentityError,
  createApplicationStateBusinessKey,
  createApplicationStateBusinessRecord,
  createApplicationStateNotAppliedResolutionRecord,
  createApplicationStateReceiptRecord,
  createApplicationStateTable,
  validateApplicationStateNotAppliedResolutionRecord,
} from '../../src/core/lib/db/tables/application-state.js';
import {
  createApplicationStateCoordinatorAuthorityKey,
  createApplicationStateCoordinatorAuthorityRecord,
} from '../../src/core/lib/db/tables/application-state-authority.js';
import {
  createExecutionLedger,
  createManagedEffectDestinationId,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import {
  COORDINATOR_AUTHORITY_ID_DOMAIN,
  COORDINATOR_AUTHORITY_ID_PREFIX,
  createCoordinatorAuthorityToken,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  APPLICATION_STATE_ADAPTER_DESCRIPTOR,
  APPLICATION_STATE_CAPABILITY,
  APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS,
  APPLICATION_STATE_MAX_INPUT_BYTES,
  APPLICATION_STATE_MAX_KEY_BYTES,
  APPLICATION_STATE_PUT_IF_ABSENT_OPERATION,
  APPLICATION_STATE_RECONCILIATION_VERIFIER_DESCRIPTOR,
  APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
  APPLICATION_STATE_VERIFIER_DESCRIPTOR,
  createApplicationStateEffectContractDigest,
  normalizeApplicationStateDestination,
  normalizeApplicationStatePutIfAbsentRequest,
  verifyApplicationStatePutIfAbsentOutcome,
  verifyApplicationStatePutIfAbsentNotAppliedEvidence,
} from '../../src/core/runtime/effects/application-state.js';
import {
  createBuiltinManagedEffectCatalog,
  createBuiltinManagedEffectHandler,
  createBuiltinManagedEffectReconciliationCatalog,
  createBuiltinManagedEffectRecoveryCatalog,
} from '../../src/core/runtime/effects/builtin-catalog.js';
import { withExecutionLedger } from '../../src/core/runtime/operator/execution-ledger-store.js';

const APP_ID = 'application-state-test';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const RUN_ID = 'application-state-run';
const INVOCATION_ID = 'main';
const EFFECT_ID = 'initialize-answer';
const FENCING_TOKEN = 'application-state-fence';

/** @param {string} prefix @param {string} domain @param {unknown} value */
function createId(prefix, domain, value) {
  return createCanonicalJsonSha256Id({
    domain,
    prefix,
    value,
    valuePath: `${prefix} test identity`,
  });
}

const STORE_ID = createId('was', 'wharfie:test:application-state-store:v2', {
  fixture: 'primary',
});

function catalogAuthority(epoch = 1, appId = APP_ID) {
  const coordinatorId = `application-state-coordinator-${epoch}`;
  return createCoordinatorAuthorityToken({
    schemaVersion: 1,
    appId,
    coordinatorId,
    authorityId: createId(
      COORDINATOR_AUTHORITY_ID_PREFIX,
      COORDINATOR_AUTHORITY_ID_DOMAIN,
      {
        schemaVersion: 1,
        appId,
        coordinatorId,
        epoch,
        requestId: `catalog-acquire-${epoch}`,
      },
    ),
    epoch,
  });
}

function catalogAuthoritySnapshot(epoch = 1) {
  return {
    ...catalogAuthority(epoch),
    status: /** @type {const} */ ('ACTIVE'),
    recordVersion: epoch,
    acquisitionRequestId: `catalog-acquire-${epoch}`,
    acquiredAt: epoch,
    heartbeatAt: epoch,
    releasedAt: null,
    updatedAt: epoch,
    lastRequestId: `catalog-acquire-${epoch}`,
  };
}

/** @param {string} label */
function makeRoot(label) {
  return mkdtempSync(join(tmpdir(), `wharfie-${label}-`));
}

/** @param {string} attemptId @param {Record<string, any>} [overrides] */
function effectRequest(attemptId, overrides = {}) {
  return {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'effect-request',
    attemptId,
    sequence: 1,
    effectId: EFFECT_ID,
    capability: APPLICATION_STATE_CAPABILITY,
    operation: APPLICATION_STATE_PUT_IF_ABSENT_OPERATION,
    input: { key: 'answer', value: { value: 42 } },
    requestedReplayProperties: [
      ...APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
    ],
    ...overrides,
  };
}

/** @param {Record<string, any>} request */
function logicalRequest(request) {
  return {
    capability: request.capability,
    operation: request.operation,
    input: request.input,
    requestedReplayProperties: request.requestedReplayProperties,
  };
}

function effectIdentity(effectId = EFFECT_ID) {
  return {
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    attemptId: 'application-state-attempt',
    effectId,
  };
}

function contractIdentity(effectId = EFFECT_ID) {
  const { runId, invocationId } = effectIdentity(effectId);
  return { runId, invocationId, effectId };
}

function destinationEffectId(effectId = EFFECT_ID) {
  return createManagedEffectDestinationId({
    appId: APP_ID,
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    effectId,
  });
}

/**
 * @param {{wrapDb?: (db: import('../../src/core/lib/db/base.js').DBClient) => import('../../src/core/lib/db/base.js').DBClient, appId?: string, createStoreId?: () => string, coordinatorAuthority?: import('../../src/core/lib/db/tables/coordinator-authority.js').CoordinatorAuthorityToken | import('../../src/core/lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot}} [options]
 */
async function createCatalogHarness(options = {}) {
  const root = makeRoot('application-state-effect');
  const baseDb = createVanillaDB({ path: root });
  const db = options.wrapDb ? options.wrapDb(baseDb) : baseDb;
  const catalog = await createBuiltinManagedEffectCatalog({
    db,
    appId: options.appId ?? APP_ID,
    adapterName: 'vanilla',
    allowTestAdapter: true,
    createStoreId: options.createStoreId ?? (() => STORE_ID),
    ...(options.coordinatorAuthority === undefined
      ? {}
      : { coordinatorAuthority: options.coordinatorAuthority }),
  });
  const reconciliation = await createBuiltinManagedEffectReconciliationCatalog({
    db,
    appId: options.appId ?? APP_ID,
    adapterName: 'vanilla',
    allowTestAdapter: true,
    ...(options.coordinatorAuthority === undefined
      ? {}
      : { coordinatorAuthority: options.coordinatorAuthority }),
  });
  return {
    root,
    baseDb,
    db,
    catalog,
    reconciliation,
    async cleanup() {
      await baseDb.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * @param {Record<string, any>} catalog
 * @param {{effectId?: string, requestOverrides?: Record<string, any>}} [options]
 */
async function executeCatalogEffect(catalog, options = {}) {
  const effectId = options.effectId ?? EFFECT_ID;
  const request = effectRequest('application-state-attempt', {
    effectId,
    ...(options.requestOverrides ?? {}),
  });
  const adapter = catalog.resolve(request);
  return await adapter.execute({
    destinationEffectId: destinationEffectId(effectId),
    destination: catalog.destination,
    identity: effectIdentity(effectId),
    request,
  });
}

/**
 * @param {Record<string, any>} catalog
 * @param {{effectId?: string, requestOverrides?: Record<string, any>}} [options]
 */
async function reconcileCatalogEffect(catalog, options = {}) {
  const effectId = options.effectId ?? EFFECT_ID;
  const request = effectRequest('application-state-attempt', {
    effectId,
    ...(options.requestOverrides ?? {}),
  });
  return await catalog.reconcileEffect({
    destinationEffectId: destinationEffectId(effectId),
    destination: catalog.destination,
    identity: contractIdentity(effectId),
    request,
  });
}

/** @param {import('../../src/core/lib/db/base.js').DBClient} db @param {string} [appId] @param {string} [key] */
async function readBusiness(db, appId = APP_ID, key = 'answer') {
  const physical = createApplicationStateBusinessKey(appId, key);
  return await db.get({
    tableName: APPLICATION_STATE_TABLE_NAME,
    keyName: APPLICATION_STATE_KEY_NAME,
    keyValue: physical.resourceId,
    sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
    sortKeyValue: physical.sortKey,
    consistentRead: true,
  });
}

/** @param {Record<string, any>} catalog @param {Record<string, any>} request @param {Record<string, any>} outcome @param {string} [effectId] */
function verifierInput(catalog, request, outcome, effectId = EFFECT_ID) {
  return {
    effect: {
      runId: RUN_ID,
      invocationId: INVOCATION_ID,
      effectId,
      destinationEffectId: destinationEffectId(effectId),
      adapter: APPLICATION_STATE_ADAPTER_DESCRIPTOR,
      destination: catalog.destination,
      verifier: APPLICATION_STATE_VERIFIER_DESCRIPTOR,
      requestedReplayProperties: request.requestedReplayProperties,
      substantiatedReplayProperties:
        APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
    },
    request: logicalRequest(request),
    outcome,
  };
}

/** @param {Record<string, any>} catalog @param {Record<string, any>} request @param {Record<string, any>} evidence @param {string} [effectId] */
function reconciliationVerifierInput(
  catalog,
  request,
  evidence,
  effectId = EFFECT_ID,
) {
  const { effect } = verifierInput(catalog, request, {}, effectId);
  return {
    effect,
    request: logicalRequest(request),
    evidence,
  };
}

describe('application-state effect request and catalog boundary', () => {
  test('accepts only the finite exact request, destination, and adapter set', async () => {
    const request = effectRequest('attempt');
    expect(normalizeApplicationStatePutIfAbsentRequest(request)).toMatchObject({
      input: { key: 'answer', value: { value: 42 } },
    });
    expect(() =>
      normalizeApplicationStatePutIfAbsentRequest({
        ...request,
        input: { ...request.input, unexpected: true },
      }),
    ).toThrow(/exactly key, value/i);
    expect(() =>
      normalizeApplicationStatePutIfAbsentRequest({
        ...request,
        requestedReplayProperties: ['unsafe'],
      }),
    ).toThrow(/exactly idempotent, transactional/i);
    for (const requestedReplayProperties of [
      ['idempotent'],
      ['transactional'],
    ]) {
      expect(() =>
        normalizeApplicationStatePutIfAbsentRequest({
          ...request,
          requestedReplayProperties,
        }),
      ).toThrow(/exactly idempotent, transactional/i);
    }
    expect(() =>
      normalizeApplicationStatePutIfAbsentRequest({
        ...request,
        input: { key: 'é'.repeat(APPLICATION_STATE_MAX_KEY_BYTES), value: 1 },
      }),
    ).toThrow(/UTF-8 bytes/i);
    expect(() =>
      normalizeApplicationStatePutIfAbsentRequest({
        ...request,
        input: {
          key: 'large',
          value: 'x'.repeat(APPLICATION_STATE_MAX_INPUT_BYTES),
        },
      }),
    ).toThrow(/bytes/i);

    const root = makeRoot('application-state-catalog-rejection');
    const db = createVanillaDB({ path: root });
    try {
      await expect(
        createBuiltinManagedEffectCatalog({
          db,
          appId: APP_ID,
          adapterName: 'vanilla',
        }),
      ).rejects.toThrow(/allowTestAdapter/i);
      await expect(
        createBuiltinManagedEffectCatalog({
          db,
          appId: APP_ID,
          adapterName: 'dynamodb',
        }),
      ).rejects.toThrow(/require LMDB/i);
      await expect(
        createBuiltinManagedEffectCatalog({
          db,
          appId: APP_ID,
          adapterName: 'vanilla',
          allowTestAdapter: true,
          tableName: 'redirected-table',
        }),
      ).rejects.toThrow(APPLICATION_STATE_TABLE_NAME);
      await expect(
        createBuiltinManagedEffectCatalog({
          db,
          appId: APP_ID,
          adapterName: 'vanilla',
          allowTestAdapter: true,
          createStoreId: /** @type {any} */ (null),
        }),
      ).rejects.toThrow(/createStoreId must be a function/i);
      await expect(
        createBuiltinManagedEffectCatalog({
          db,
          appId: APP_ID,
          adapterName: 'lmdb',
        }),
      ).rejects.toThrow(/adapter identity mismatch.*lmdb.*vanilla/i);
    } finally {
      await db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('persists a stable opaque store identity and credential-free destination', async () => {
    const harness = await createCatalogHarness();
    try {
      expect(harness.catalog.storeId).toBe(STORE_ID);
      expect(harness.catalog.destination).toEqual({
        kind: APPLICATION_STATE_CAPABILITY,
        version: 2,
        bindingId: 'primary',
        configuration: {
          provider: 'vanilla',
          storeId: STORE_ID,
          tableName: APPLICATION_STATE_TABLE_NAME,
          namespace: APP_ID,
        },
      });
      expect(JSON.stringify(harness.catalog.destination)).not.toMatch(
        /path|credential|password|token/i,
      );
      expect(
        normalizeApplicationStateDestination(harness.catalog.destination),
      ).toEqual(harness.catalog.destination);
      const adapter = harness.catalog.resolve(effectRequest('attempt'));
      expect(Object.isFrozen(adapter.substantiatedReplayProperties)).toBe(true);

      const reopened = await createBuiltinManagedEffectCatalog({
        db: harness.baseDb,
        appId: APP_ID,
        adapterName: 'vanilla',
        allowTestAdapter: true,
        createStoreId: () =>
          createId('was', 'wharfie:test:unexpected-store:v1', {
            fixture: 'loser',
          }),
      });
      expect(reopened.storeId).toBe(STORE_ID);
    } finally {
      await harness.cleanup();
    }
  });

  test('snapshots routing inputs before initialization and adapter execution', async () => {
    const root = makeRoot('application-state-option-snapshot');
    const db = createVanillaDB({ path: root });
    const options = /** @type {any} */ ({
      db,
      appId: APP_ID,
      adapterName: 'vanilla',
      allowTestAdapter: true,
      createStoreId: () => STORE_ID,
    });
    try {
      const creating = createBuiltinManagedEffectCatalog(options);
      options.appId = 'mutated-application';
      options.adapterName = 'lmdb';
      options.createStoreId = () =>
        createId('was', 'wharfie:test:mutated-store:v1', { mutated: true });
      const catalog = await creating;
      expect(catalog.destination.configuration).toMatchObject({
        provider: 'vanilla',
        namespace: APP_ID,
        storeId: STORE_ID,
      });
      await executeCatalogEffect(catalog);
      await expect(readBusiness(db, APP_ID)).resolves.toBeDefined();
      await expect(readBusiness(db, 'mutated-application')).resolves.toBe(
        undefined,
      );
    } finally {
      await db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('opens an existing recovery-only binding without exposing or invoking execution', async () => {
    const harness = await createCatalogHarness();
    try {
      const outcome = await executeCatalogEffect(harness.catalog);
      const transactionWrite = jest.fn(async () => {
        throw new Error('recovery must never write application state');
      });
      const recoveryDb = {
        ...harness.baseDb,
        transactionWrite,
      };
      const recovery = await createBuiltinManagedEffectRecoveryCatalog({
        db: recoveryDb,
        appId: APP_ID,
        adapterName: 'vanilla',
        allowTestAdapter: true,
      });

      expect(Object.keys(recovery)).toEqual([
        'storeId',
        'destination',
        'effectEvidenceVerifiers',
        'recoverOutcome',
        'readReceipt',
      ]);
      expect(recovery).not.toHaveProperty('resolve');
      expect(recovery).not.toHaveProperty('execute');
      expect(recovery.storeId).toBe(STORE_ID);
      await expect(
        recovery.recoverOutcome({
          destinationEffectId: destinationEffectId(),
          destination: harness.catalog.destination,
          identity: contractIdentity(),
          request: effectRequest('application-state-attempt'),
        }),
      ).resolves.toEqual(outcome);
      await expect(
        recovery.readReceipt(destinationEffectId()),
      ).resolves.toMatchObject({
        destination_effect_id: destinationEffectId(),
      });
      expect(transactionWrite).not.toHaveBeenCalled();

      const otherStoreId = createId(
        'was',
        'wharfie:test:recovery-store-mismatch:v1',
        { fixture: 'other' },
      );
      for (const configuration of [
        {
          ...harness.catalog.destination.configuration,
          provider: 'lmdb',
        },
        {
          ...harness.catalog.destination.configuration,
          storeId: otherStoreId,
        },
        {
          ...harness.catalog.destination.configuration,
          tableName: 'redirected-table',
        },
        {
          ...harness.catalog.destination.configuration,
          namespace: 'other-application',
        },
      ]) {
        await expect(
          recovery.recoverOutcome({
            destinationEffectId: destinationEffectId(),
            destination: {
              ...harness.catalog.destination,
              configuration,
            },
            identity: contractIdentity(),
            request: effectRequest('application-state-attempt'),
          }),
        ).rejects.toThrow();
      }
      await expect(
        recovery.recoverOutcome({
          destinationEffectId: destinationEffectId(),
          destination: harness.catalog.destination,
          identity: contractIdentity(),
          request: effectRequest('application-state-attempt', {
            input: { key: 'answer', value: { value: 99 } },
          }),
        }),
      ).rejects.toBeInstanceOf(ApplicationStateEffectConflictError);
      expect(transactionWrite).not.toHaveBeenCalled();
    } finally {
      await harness.cleanup();
    }
  });

  test('fails closed on a missing store identity without attempting initialization', async () => {
    const root = makeRoot('application-state-recovery-missing-identity');
    const baseDb = createVanillaDB({ path: root });
    const transactionWrite = jest.fn(async () => {
      throw new Error('recovery must never initialize a store');
    });
    const recoveryDb = { ...baseDb, transactionWrite };
    try {
      await expect(
        createBuiltinManagedEffectRecoveryCatalog({
          db: recoveryDb,
          appId: APP_ID,
          adapterName: 'vanilla',
          allowTestAdapter: true,
        }),
      ).rejects.toBeInstanceOf(ApplicationStateStoreIdentityError);
      await expect(
        createBuiltinManagedEffectReconciliationCatalog({
          db: recoveryDb,
          appId: APP_ID,
          adapterName: 'vanilla',
          allowTestAdapter: true,
        }),
      ).rejects.toBeInstanceOf(ApplicationStateStoreIdentityError);
      expect(transactionWrite).not.toHaveBeenCalled();
      await expect(
        baseDb.get({
          tableName: APPLICATION_STATE_TABLE_NAME,
          keyName: APPLICATION_STATE_KEY_NAME,
          keyValue: APPLICATION_STATE_STORE_RESOURCE_ID,
          sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
          sortKeyValue: APPLICATION_STATE_STORE_SORT_KEY,
          consistentRead: true,
        }),
      ).resolves.toBeUndefined();
      await expect(
        createBuiltinManagedEffectRecoveryCatalog(
          /** @type {any} */ ({
            db: recoveryDb,
            appId: APP_ID,
            adapterName: 'vanilla',
            allowTestAdapter: true,
            createStoreId: () => STORE_ID,
          }),
        ),
      ).rejects.toThrow(/createStoreId is unsupported/i);
      expect(transactionWrite).not.toHaveBeenCalled();
    } finally {
      await baseDb.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('application-state put-if-absent destination semantics', () => {
  test('isolates V2 execution from retained V1 bytes', async () => {
    const harness = await createCatalogHarness();
    const legacy = {
      resource_id: `application-state/v1/effect/${destinationEffectId()}`,
      sort_key: 'receipt/v1',
      record_kind: 'application-state-effect-receipt',
      schema_version: 1,
      opaque_legacy_bytes: { retained: true },
    };
    try {
      await harness.baseDb.put({
        tableName: 'wharfie-application-state-v1',
        keyName: APPLICATION_STATE_KEY_NAME,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        record: legacy,
      });
      await expect(
        harness.catalog.readReceipt(destinationEffectId()),
      ).resolves.toBeNull();
      await expect(
        executeCatalogEffect(harness.catalog),
      ).resolves.toMatchObject({ result: { inserted: true } });
      await expect(
        harness.baseDb.get({
          tableName: 'wharfie-application-state-v1',
          keyName: APPLICATION_STATE_KEY_NAME,
          keyValue: legacy.resource_id,
          sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
          sortKeyValue: legacy.sort_key,
          consistentRead: true,
        }),
      ).resolves.toEqual(legacy);
    } finally {
      await harness.cleanup();
    }
  });

  test('atomically inserts one value and permanent verifier-backed receipt', async () => {
    const harness = await createCatalogHarness();
    try {
      expect(Object.keys(harness.reconciliation)).toEqual([
        'storeId',
        'destination',
        'effectEvidenceVerifiers',
        'reconcileEffect',
        'readReceipt',
      ]);
      expect(harness.reconciliation).not.toHaveProperty('resolve');
      expect(harness.reconciliation).not.toHaveProperty('recoverOutcome');
      expect(harness.catalog).not.toHaveProperty('reconcileEffect');
      const request = effectRequest('application-state-attempt');
      const outcome = await executeCatalogEffect(harness.catalog);
      expect(outcome).toMatchObject({
        ok: true,
        result: { inserted: true },
        evidence: {
          kind: APPLICATION_STATE_VERIFIER_DESCRIPTOR.kind,
          destinationEffectId: destinationEffectId(),
          disposition: 'inserted',
        },
      });
      expect(
        verifyApplicationStatePutIfAbsentOutcome(
          verifierInput(harness.catalog, request, outcome),
        ),
      ).toBe(true);

      const receipt = await harness.catalog.readReceipt(destinationEffectId());
      expect(receipt).toMatchObject({
        destination_effect_id: destinationEffectId(),
        inserted: true,
        outcome_code: 'inserted',
        receipt_digest: outcome.evidence.receiptDigest,
      });
      await expect(readBusiness(harness.baseDb)).resolves.toMatchObject({
        namespace: APP_ID,
        logical_key: 'answer',
        value: { value: 42 },
        record_digest: outcome.evidence.businessRecordDigest,
      });
    } finally {
      await harness.cleanup();
    }
  });

  test('replays one destination identity without repeating or redirecting it', async () => {
    const harness = await createCatalogHarness();
    try {
      const first = await executeCatalogEffect(harness.catalog);
      const replay = await executeCatalogEffect(harness.catalog);
      expect(replay).toEqual(first);

      await expect(
        executeCatalogEffect(harness.catalog, {
          requestOverrides: {
            input: { key: 'answer', value: { value: 43 } },
          },
        }),
      ).rejects.toBeInstanceOf(ApplicationStateEffectConflictError);
      await expect(readBusiness(harness.baseDb)).resolves.toMatchObject({
        value: { value: 42 },
      });

      const adapter = harness.catalog.resolve(
        effectRequest('application-state-attempt'),
      );
      await expect(
        adapter.execute({
          destinationEffectId: destinationEffectId(),
          destination: {
            ...harness.catalog.destination,
            configuration: {
              ...harness.catalog.destination.configuration,
              namespace: 'redirected-app',
            },
          },
          identity: effectIdentity(),
          request: effectRequest('application-state-attempt'),
        }),
      ).rejects.toThrow(/does not match its host binding/i);
      await expect(
        adapter.execute({
          destinationEffectId: destinationEffectId('other-effect'),
          destination: harness.catalog.destination,
          identity: effectIdentity(),
          request: effectRequest('application-state-attempt'),
        }),
      ).rejects.toThrow(/does not match its app and logical effect identity/i);
      await expect(
        adapter.execute({
          destinationEffectId: destinationEffectId(),
          destination: harness.catalog.destination,
          identity: effectIdentity('other-effect'),
          request: effectRequest('application-state-attempt'),
        }),
      ).rejects.toThrow(/request effectId must match/i);
      await expect(
        adapter.execute({
          destinationEffectId: destinationEffectId(),
          destination: harness.catalog.destination,
          identity: effectIdentity(),
          request: effectRequest('application-state-attempt'),
          unexpected: true,
        }),
      ).rejects.toThrow(/requires exactly/i);
    } finally {
      await harness.cleanup();
    }
  });

  test('gives competing destination identities stable inserted and already-present outcomes', async () => {
    const harness = await createCatalogHarness();
    try {
      const [left, right] = await Promise.all([
        executeCatalogEffect(harness.catalog, { effectId: 'left-effect' }),
        executeCatalogEffect(harness.catalog, { effectId: 'right-effect' }),
      ]);
      expect([left.result.inserted, right.result.inserted].sort()).toEqual([
        false,
        true,
      ]);
      expect(
        await harness.catalog.readReceipt(destinationEffectId('left-effect')),
      ).not.toBeNull();
      expect(
        await harness.catalog.readReceipt(destinationEffectId('right-effect')),
      ).not.toBeNull();
      const business = await readBusiness(harness.baseDb);
      if (!business) throw new Error('Expected application-state business row');
      expect(business.created_by_destination_effect_id).toBe(
        left.result.inserted
          ? destinationEffectId('left-effect')
          : destinationEffectId('right-effect'),
      );
    } finally {
      await harness.cleanup();
    }
  });

  test('retries a transient failure while retaining an already-present receipt', async () => {
    let failNextReceipt = false;
    const harness = await createCatalogHarness({
      wrapDb(
        /** @type {import('../../src/core/lib/db/base.js').DBClient} */ baseDb,
      ) {
        return {
          ...baseDb,
          async transactionWrite(
            /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
          ) {
            if (failNextReceipt && params.putRequests?.length === 1) {
              failNextReceipt = false;
              throw new Error('simulated transient receipt failure');
            }
            return await baseDb.transactionWrite(params);
          },
        };
      },
    });
    try {
      await expect(
        executeCatalogEffect(harness.catalog, { effectId: 'winning-effect' }),
      ).resolves.toMatchObject({ result: { inserted: true } });
      failNextReceipt = true;
      const outcome = await executeCatalogEffect(harness.catalog, {
        effectId: 'already-present-effect',
      });
      expect(outcome).toMatchObject({ result: { inserted: false } });
      await expect(
        harness.catalog.readReceipt(
          destinationEffectId('already-present-effect'),
        ),
      ).resolves.toMatchObject({ inserted: false });
    } finally {
      await harness.cleanup();
    }
  });

  test('recovers an already-present receipt after its commit response is lost', async () => {
    let loseNextReceiptResponse = false;
    const harness = await createCatalogHarness({
      wrapDb(
        /** @type {import('../../src/core/lib/db/base.js').DBClient} */ baseDb,
      ) {
        return {
          ...baseDb,
          async transactionWrite(
            /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
          ) {
            const result = await baseDb.transactionWrite(params);
            if (loseNextReceiptResponse && params.putRequests?.length === 1) {
              loseNextReceiptResponse = false;
              throw new Error('simulated lost receipt commit response');
            }
            return result;
          },
        };
      },
    });
    try {
      await executeCatalogEffect(harness.catalog, {
        effectId: 'existing-writer',
      });
      loseNextReceiptResponse = true;
      await expect(
        executeCatalogEffect(harness.catalog, {
          effectId: 'response-loss-writer',
        }),
      ).resolves.toMatchObject({ result: { inserted: false } });
      await expect(
        harness.catalog.readReceipt(
          destinationEffectId('response-loss-writer'),
        ),
      ).resolves.toMatchObject({ inserted: false });
    } finally {
      await harness.cleanup();
    }
  });

  test('recovers a committed transaction after its response is lost', async () => {
    let loseResponse = true;
    const harness = await createCatalogHarness({
      wrapDb(
        /** @type {import('../../src/core/lib/db/base.js').DBClient} */ baseDb,
      ) {
        return {
          ...baseDb,
          async transactionWrite(
            /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
          ) {
            const result = await baseDb.transactionWrite(params);
            if (loseResponse && params.putRequests?.length === 2) {
              loseResponse = false;
              throw new Error(
                'simulated application transaction response loss',
              );
            }
            return result;
          },
        };
      },
    });
    try {
      await expect(
        executeCatalogEffect(harness.catalog),
      ).resolves.toMatchObject({
        result: { inserted: true },
      });
      await expect(
        harness.catalog.recoverOutcome({
          destinationEffectId: destinationEffectId(),
          destination: harness.catalog.destination,
          identity: contractIdentity(),
          request: effectRequest('application-state-attempt'),
        }),
      ).resolves.toMatchObject({ result: { inserted: true } });
    } finally {
      await harness.cleanup();
    }
  });

  test('returns a concurrent receipt winner after a stale post-error business read', async () => {
    const businessKey = createApplicationStateBusinessKey(APP_ID, 'answer');
    let failNextInsert = false;
    let gateBusinessRead = false;
    let announceBusinessRead = () => {};
    /** @type {Promise<void>} */
    const businessReadStarted = new Promise((resolve) => {
      announceBusinessRead = resolve;
    });
    let releaseBusinessRead = () => {};
    /** @type {Promise<void>} */
    const businessReadGate = new Promise((resolve) => {
      releaseBusinessRead = resolve;
    });
    const harness = await createCatalogHarness({
      wrapDb(
        /** @type {import('../../src/core/lib/db/base.js').DBClient} */ baseDb,
      ) {
        return {
          ...baseDb,
          async get(
            /** @type {import('../../src/core/lib/db/base.js').GetParams} */ params,
          ) {
            if (
              gateBusinessRead &&
              params.keyValue === businessKey.resourceId &&
              params.sortKeyValue === businessKey.sortKey
            ) {
              gateBusinessRead = false;
              announceBusinessRead();
              await businessReadGate;
            }
            return await baseDb.get(params);
          },
          async transactionWrite(
            /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
          ) {
            const recordKinds = new Set(
              (params.putRequests || []).map(
                (request) => request.record.record_kind,
              ),
            );
            if (
              failNextInsert &&
              recordKinds.has('application-state-value') &&
              recordKinds.has('application-state-effect-receipt')
            ) {
              failNextInsert = false;
              throw new Error('simulated pre-commit application failure');
            }
            return await baseDb.transactionWrite(params);
          },
        };
      },
    });
    try {
      failNextInsert = true;
      gateBusinessRead = true;
      const first = executeCatalogEffect(harness.catalog);
      await businessReadStarted;
      const winner = await executeCatalogEffect(harness.catalog);
      releaseBusinessRead();
      await expect(first).resolves.toEqual(winner);
      await expect(
        harness.catalog.readReceipt(destinationEffectId()),
      ).resolves.toMatchObject({ inserted: true });
      const table = createApplicationStateTable({
        db: harness.baseDb,
        tableName: APPLICATION_STATE_TABLE_NAME,
      });
      await expect(
        table.readNotAppliedResolution(destinationEffectId()),
      ).resolves.toBeNull();
    } finally {
      releaseBusinessRead();
      await harness.cleanup();
    }
  });

  test('rolls back the business value when the atomic transaction never commits', async () => {
    const harness = await createCatalogHarness({
      wrapDb(
        /** @type {import('../../src/core/lib/db/base.js').DBClient} */ baseDb,
      ) {
        return {
          ...baseDb,
          async transactionWrite(
            /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
          ) {
            if (params.putRequests?.length === 2) {
              throw new Error('simulated application transaction rejection');
            }
            return await baseDb.transactionWrite(params);
          },
        };
      },
    });
    try {
      await expect(executeCatalogEffect(harness.catalog)).rejects.toThrow(
        /transaction rejection/i,
      );
      await expect(readBusiness(harness.baseDb)).resolves.toBeUndefined();
      await expect(
        harness.catalog.readReceipt(destinationEffectId()),
      ).resolves.toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  test('rejects malformed retained records instead of replaying them', async () => {
    const harness = await createCatalogHarness();
    try {
      await executeCatalogEffect(harness.catalog);
      const receipt = await harness.catalog.readReceipt(destinationEffectId());
      const business = await readBusiness(harness.baseDb);
      if (!receipt) throw new Error('Expected application-state receipt');
      if (!business) throw new Error('Expected application-state business row');
      await harness.baseDb.put({
        tableName: APPLICATION_STATE_TABLE_NAME,
        keyName: APPLICATION_STATE_KEY_NAME,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        record: { ...business, value: { forged: true } },
      });
      await expect(
        harness.catalog.recoverOutcome({
          destinationEffectId: destinationEffectId(),
          destination: harness.catalog.destination,
          identity: contractIdentity(),
          request: effectRequest('application-state-attempt'),
        }),
      ).rejects.toBeInstanceOf(ApplicationStateCorruptionError);

      await harness.baseDb.put({
        tableName: APPLICATION_STATE_TABLE_NAME,
        keyName: APPLICATION_STATE_KEY_NAME,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        record: business,
      });
      await harness.baseDb.put({
        tableName: APPLICATION_STATE_TABLE_NAME,
        keyName: APPLICATION_STATE_KEY_NAME,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        record: { ...receipt, inserted: false },
      });
      await expect(
        harness.catalog.readReceipt(destinationEffectId()),
      ).rejects.toBeInstanceOf(ApplicationStateCorruptionError);

      const forgedDisposition = createApplicationStateReceiptRecord({
        destinationEffectId: destinationEffectId(),
        contractDigest: receipt.contract_digest,
        businessRecord: business,
        inserted: false,
      });
      await harness.baseDb.put({
        tableName: APPLICATION_STATE_TABLE_NAME,
        keyName: APPLICATION_STATE_KEY_NAME,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        record: forgedDisposition,
      });
      await expect(
        harness.catalog.recoverOutcome({
          destinationEffectId: destinationEffectId(),
          destination: harness.catalog.destination,
          identity: contractIdentity(),
          request: effectRequest('application-state-attempt'),
        }),
      ).rejects.toBeInstanceOf(ApplicationStateCorruptionError);

      await harness.baseDb.put({
        tableName: APPLICATION_STATE_TABLE_NAME,
        keyName: APPLICATION_STATE_KEY_NAME,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        record: { ...receipt, destination_effect_id: 'invalid id' },
      });
      await expect(
        harness.catalog.readReceipt(destinationEffectId()),
      ).rejects.toBeInstanceOf(ApplicationStateCorruptionError);
    } finally {
      await harness.cleanup();
    }
  });

  test('rejects a self-consistent inserted row that no longer matches the requested value', async () => {
    const harness = await createCatalogHarness();
    try {
      await executeCatalogEffect(harness.catalog);
      const originalReceipt = await harness.catalog.readReceipt(
        destinationEffectId(),
      );
      if (!originalReceipt)
        throw new Error('Expected application-state receipt');
      const forgedBusiness = createApplicationStateBusinessRecord({
        storeId: harness.catalog.storeId,
        namespace: APP_ID,
        key: 'answer',
        value: { value: 'forged-but-self-consistent' },
        destinationEffectId: destinationEffectId(),
        contractDigest: originalReceipt.contract_digest,
      });
      const forgedReceipt = createApplicationStateReceiptRecord({
        destinationEffectId: destinationEffectId(),
        contractDigest: originalReceipt.contract_digest,
        businessRecord: forgedBusiness,
        inserted: true,
      });
      await harness.baseDb.put({
        tableName: APPLICATION_STATE_TABLE_NAME,
        keyName: APPLICATION_STATE_KEY_NAME,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        record: forgedBusiness,
      });
      await harness.baseDb.put({
        tableName: APPLICATION_STATE_TABLE_NAME,
        keyName: APPLICATION_STATE_KEY_NAME,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        record: forgedReceipt,
      });
      await expect(
        harness.catalog.recoverOutcome({
          destinationEffectId: destinationEffectId(),
          destination: harness.catalog.destination,
          identity: contractIdentity(),
          request: effectRequest('application-state-attempt'),
        }),
      ).rejects.toThrow(/does not match its logical value/i);
    } finally {
      await harness.cleanup();
    }
  });

  test('requires the retained store identity on recovery', async () => {
    const harness = await createCatalogHarness();
    try {
      await executeCatalogEffect(harness.catalog);
      await harness.baseDb.update({
        tableName: APPLICATION_STATE_TABLE_NAME,
        keyName: APPLICATION_STATE_KEY_NAME,
        keyValue: APPLICATION_STATE_STORE_RESOURCE_ID,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        sortKeyValue: APPLICATION_STATE_STORE_SORT_KEY,
        updates: [{ property: ['store_id'], propertyValue: `${STORE_ID}x` }],
      });
      await expect(
        harness.catalog.recoverOutcome({
          destinationEffectId: destinationEffectId(),
          destination: harness.catalog.destination,
          identity: contractIdentity(),
          request: effectRequest('application-state-attempt'),
        }),
      ).rejects.toBeInstanceOf(ApplicationStateCorruptionError);
    } finally {
      await harness.cleanup();
    }
  });

  test('fails closed when recovery is pointed at a replacement store', async () => {
    const original = await createCatalogHarness();
    const replacementStoreId = createId(
      'was',
      'wharfie:test:replacement-store:v2',
      { fixture: 'replacement' },
    );
    const replacement = await createCatalogHarness({
      createStoreId: () => replacementStoreId,
    });
    try {
      await executeCatalogEffect(original.catalog);
      expect(replacement.catalog.storeId).not.toBe(original.catalog.storeId);
      await expect(
        replacement.catalog.recoverOutcome({
          destinationEffectId: destinationEffectId(),
          destination: original.catalog.destination,
          identity: contractIdentity(),
          request: effectRequest('application-state-attempt'),
        }),
      ).rejects.toThrow(/does not match its host binding/i);
      await expect(
        replacement.catalog.recoverOutcome(
          /** @type {any} */ ({
            destinationEffectId: destinationEffectId(),
            destination: replacement.catalog.destination,
            identity: contractIdentity(),
            request: effectRequest('application-state-attempt'),
            unexpected: true,
          }),
        ),
      ).rejects.toThrow(/requires exactly/i);
    } finally {
      await original.cleanup();
      await replacement.cleanup();
    }
  });

  test('rejects V2 rows retained across store identity recreation', async () => {
    const harness = await createCatalogHarness();
    const replacementStoreId = createId(
      'was',
      'wharfie:test:in-place-replacement-store:v2',
      { fixture: 'replacement' },
    );
    try {
      await executeCatalogEffect(harness.catalog);
      await harness.baseDb.remove({
        tableName: APPLICATION_STATE_TABLE_NAME,
        keyName: APPLICATION_STATE_KEY_NAME,
        keyValue: APPLICATION_STATE_STORE_RESOURCE_ID,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        sortKeyValue: APPLICATION_STATE_STORE_SORT_KEY,
      });
      const replacementTable = createApplicationStateTable({
        db: harness.baseDb,
        tableName: APPLICATION_STATE_TABLE_NAME,
        createStoreId: () => replacementStoreId,
      });
      await expect(
        replacementTable.ensureStoreIdentity(),
      ).resolves.toMatchObject({ store_id: replacementStoreId });
      const rebound = await createBuiltinManagedEffectCatalog({
        db: harness.baseDb,
        appId: APP_ID,
        adapterName: 'vanilla',
        allowTestAdapter: true,
      });
      await expect(
        rebound.recoverOutcome({
          destinationEffectId: destinationEffectId(),
          destination: rebound.destination,
          identity: contractIdentity(),
          request: effectRequest('application-state-attempt'),
        }),
      ).rejects.toBeInstanceOf(ApplicationStateEffectConflictError);
      await expect(
        executeCatalogEffect(rebound, { effectId: 'post-recreation-effect' }),
      ).rejects.toBeInstanceOf(ApplicationStateStoreIdentityError);
      await expect(
        rebound.readReceipt(destinationEffectId('post-recreation-effect')),
      ).resolves.toBeNull();
    } finally {
      await harness.cleanup();
    }
  });
});

describe('application-state not-applied reconciliation', () => {
  test('permanently resolves absence, verifies its evidence, and fences later execution', async () => {
    const harness = await createCatalogHarness();
    try {
      const request = effectRequest('application-state-attempt');
      const first = await reconcileCatalogEffect(harness.reconciliation);
      expect(first).toMatchObject({
        kind: 'not-applied',
        evidence: {
          kind: APPLICATION_STATE_RECONCILIATION_VERIFIER_DESCRIPTOR.kind,
          version: 2,
          destinationEffectId: destinationEffectId(),
          disposition: 'not-applied',
          businessObservation: { kind: 'absent' },
        },
      });
      if (first.kind !== 'not-applied') {
        throw new Error('Expected a not-applied reconciliation');
      }
      const verifier = reconciliationVerifierInput(
        harness.catalog,
        request,
        first.evidence,
      );
      expect(
        verifyApplicationStatePutIfAbsentNotAppliedEvidence(verifier),
      ).toBe(true);
      expect(
        APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS.find(
          ({ kind }) =>
            kind === APPLICATION_STATE_RECONCILIATION_VERIFIER_DESCRIPTOR.kind,
        )?.verify(verifier),
      ).toBe(true);
      await expect(
        reconcileCatalogEffect(harness.reconciliation),
      ).resolves.toEqual(first);
      await expect(
        executeCatalogEffect(harness.catalog),
      ).rejects.toBeInstanceOf(ApplicationStateEffectNotAppliedError);
      await expect(
        harness.catalog.recoverOutcome({
          destinationEffectId: destinationEffectId(),
          destination: harness.catalog.destination,
          identity: contractIdentity(),
          request,
        }),
      ).resolves.toBeNull();
      const transactionWrite = jest.fn(async () => {
        throw new Error(
          'ordinary recovery must never resolve application state',
        );
      });
      const recovery = await createBuiltinManagedEffectRecoveryCatalog({
        db: { ...harness.baseDb, transactionWrite },
        appId: APP_ID,
        adapterName: 'vanilla',
        allowTestAdapter: true,
      });
      expect(recovery).not.toHaveProperty('reconcileEffect');
      await expect(
        recovery.recoverOutcome({
          destinationEffectId: destinationEffectId(),
          destination: harness.catalog.destination,
          identity: contractIdentity(),
          request,
        }),
      ).resolves.toBeNull();
      await expect(
        recovery.recoverOutcome({
          destinationEffectId: destinationEffectId(),
          destination: harness.catalog.destination,
          identity: contractIdentity(),
          request: effectRequest('application-state-attempt', {
            input: { key: 'answer', value: { value: 99 } },
          }),
        }),
      ).rejects.toBeInstanceOf(ApplicationStateEffectConflictError);
      expect(transactionWrite).not.toHaveBeenCalled();
      await expect(readBusiness(harness.baseDb)).resolves.toBeUndefined();
      await expect(
        harness.catalog.readReceipt(destinationEffectId()),
      ).resolves.toBeNull();

      const table = createApplicationStateTable({
        db: harness.baseDb,
        tableName: APPLICATION_STATE_TABLE_NAME,
      });
      const resolution = await table.readNotAppliedResolution(
        destinationEffectId(),
      );
      expect(resolution).toMatchObject({
        schema_version: 2,
        disposition: 'not-applied',
        business_observation: { kind: 'absent' },
        resolution_digest: first.evidence.resolutionDigest,
      });
      expect(
        validateApplicationStateNotAppliedResolutionRecord(resolution),
      ).toEqual(resolution);
      expect(() =>
        validateApplicationStateNotAppliedResolutionRecord({
          ...resolution,
          resolution_digest: first.evidence.contractDigest,
        }),
      ).toThrow(ApplicationStateCorruptionError);
      expect(() =>
        validateApplicationStateNotAppliedResolutionRecord({
          ...resolution,
          unexpected: true,
        }),
      ).toThrow(ApplicationStateCorruptionError);
      await expect(
        executeCatalogEffect(harness.catalog, {
          effectId: 'different-effect-after-resolution',
        }),
      ).resolves.toMatchObject({ result: { inserted: true } });
      await expect(
        reconcileCatalogEffect(harness.reconciliation),
      ).resolves.toEqual(first);
    } finally {
      await harness.cleanup();
    }
  });

  test('returns the positive receipt when execution already won', async () => {
    const harness = await createCatalogHarness();
    try {
      const outcome = await executeCatalogEffect(harness.catalog);
      await expect(
        reconcileCatalogEffect(harness.reconciliation),
      ).resolves.toEqual({ kind: 'outcome', outcome });
      const table = createApplicationStateTable({
        db: harness.baseDb,
        tableName: APPLICATION_STATE_TABLE_NAME,
      });
      await expect(
        table.readNotAppliedResolution(destinationEffectId()),
      ).resolves.toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  test('arbitrates concurrent execution and reconciliation as one permanent winner', async () => {
    const harness = await createCatalogHarness();
    const effectId = 'concurrent-resolution';
    try {
      await executeCatalogEffect(harness.catalog, {
        effectId: 'concurrent-existing-business',
      });
      const [execution, reconciliation] = await Promise.allSettled([
        executeCatalogEffect(harness.catalog, { effectId }),
        reconcileCatalogEffect(harness.reconciliation, { effectId }),
      ]);
      expect(reconciliation.status).toBe('fulfilled');
      if (reconciliation.status !== 'fulfilled') {
        throw reconciliation.reason;
      }
      const repeated = await reconcileCatalogEffect(harness.reconciliation, {
        effectId,
      });
      expect(repeated).toEqual(reconciliation.value);
      const table = createApplicationStateTable({
        db: harness.baseDb,
        tableName: APPLICATION_STATE_TABLE_NAME,
      });
      const receipt = await harness.catalog.readReceipt(
        destinationEffectId(effectId),
      );
      const resolution = await table.readNotAppliedResolution(
        destinationEffectId(effectId),
      );
      if (reconciliation.value.kind === 'outcome') {
        expect(execution.status).toBe('fulfilled');
        if (execution.status === 'fulfilled') {
          expect(execution.value).toMatchObject({
            result: { inserted: false },
          });
        }
        expect(receipt).not.toBeNull();
        expect(resolution).toBeNull();
      } else {
        expect(execution.status).toBe('rejected');
        if (execution.status !== 'rejected') {
          throw new Error('Expected execution to lose to reconciliation');
        }
        expect(execution.reason).toBeInstanceOf(
          ApplicationStateEffectNotAppliedError,
        );
        expect(receipt).toBeNull();
        expect(resolution).not.toBeNull();
      }
    } finally {
      await harness.cleanup();
    }
  });

  test('returns a concurrently committed receipt after a stale finalizer disposition read', async () => {
    const businessKey = createApplicationStateBusinessKey(APP_ID, 'answer');
    let gateBusinessRead = false;
    let announceBusinessRead = () => {};
    /** @type {Promise<void>} */
    const businessReadStarted = new Promise((resolve) => {
      announceBusinessRead = resolve;
    });
    let releaseBusinessRead = () => {};
    /** @type {Promise<void>} */
    const businessReadGate = new Promise((resolve) => {
      releaseBusinessRead = resolve;
    });
    const harness = await createCatalogHarness({
      wrapDb(
        /** @type {import('../../src/core/lib/db/base.js').DBClient} */ baseDb,
      ) {
        return {
          ...baseDb,
          async get(
            /** @type {import('../../src/core/lib/db/base.js').GetParams} */ params,
          ) {
            if (
              gateBusinessRead &&
              params.keyValue === businessKey.resourceId &&
              params.sortKeyValue === businessKey.sortKey
            ) {
              gateBusinessRead = false;
              announceBusinessRead();
              await businessReadGate;
            }
            return await baseDb.get(params);
          },
        };
      },
    });
    try {
      gateBusinessRead = true;
      const reconciling = reconcileCatalogEffect(harness.reconciliation);
      await businessReadStarted;
      const outcome = await executeCatalogEffect(harness.catalog);
      releaseBusinessRead();
      await expect(reconciling).resolves.toEqual({
        kind: 'outcome',
        outcome,
      });
      const table = createApplicationStateTable({
        db: harness.baseDb,
        tableName: APPLICATION_STATE_TABLE_NAME,
      });
      await expect(
        table.readNotAppliedResolution(destinationEffectId()),
      ).resolves.toBeNull();
    } finally {
      releaseBusinessRead();
      await harness.cleanup();
    }
  });

  test('retains an exact present-other observation and rejects altered evidence or contract', async () => {
    const harness = await createCatalogHarness();
    const effectId = 'not-applied-after-other-writer';
    try {
      await executeCatalogEffect(harness.catalog, {
        effectId: 'existing-business-writer',
      });
      const decision = await reconcileCatalogEffect(harness.reconciliation, {
        effectId,
      });
      if (decision.kind !== 'not-applied') {
        throw new Error('Expected a not-applied reconciliation');
      }
      expect(decision.evidence.businessObservation).toMatchObject({
        kind: 'present-other',
        createdByDestinationEffectId: destinationEffectId(
          'existing-business-writer',
        ),
      });
      const request = effectRequest('application-state-attempt', { effectId });
      const valid = reconciliationVerifierInput(
        harness.catalog,
        request,
        decision.evidence,
        effectId,
      );
      expect(verifyApplicationStatePutIfAbsentNotAppliedEvidence(valid)).toBe(
        true,
      );
      expect(
        verifyApplicationStatePutIfAbsentNotAppliedEvidence({
          ...valid,
          evidence: {
            ...valid.evidence,
            businessObservation: { kind: 'absent' },
          },
        }),
      ).toBe(false);
      expect(
        verifyApplicationStatePutIfAbsentNotAppliedEvidence({
          ...valid,
          request: {
            ...valid.request,
            input: { key: 'different', value: { value: 42 } },
          },
        }),
      ).toBe(false);
      await expect(
        reconcileCatalogEffect(harness.reconciliation, {
          effectId,
          requestOverrides: {
            input: { key: 'answer', value: { value: 99 } },
          },
        }),
      ).rejects.toBeInstanceOf(ApplicationStateEffectConflictError);
      const businessKey = createApplicationStateBusinessKey(APP_ID, 'answer');
      await harness.baseDb.remove({
        tableName: APPLICATION_STATE_TABLE_NAME,
        keyName: APPLICATION_STATE_KEY_NAME,
        keyValue: businessKey.resourceId,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        sortKeyValue: businessKey.sortKey,
      });
      await expect(
        reconcileCatalogEffect(harness.reconciliation, { effectId }),
      ).rejects.toBeInstanceOf(ApplicationStateCorruptionError);
    } finally {
      await harness.cleanup();
    }
  });

  test('rejects impossible same-effect business state without recording absence', async () => {
    const harness = await createCatalogHarness();
    const effectId = 'orphaned-business-writer';
    try {
      const request = effectRequest('application-state-attempt', { effectId });
      const contractDigest = createApplicationStateEffectContractDigest({
        destinationEffectId: destinationEffectId(effectId),
        identity: contractIdentity(effectId),
        destination: harness.catalog.destination,
        request,
      });
      const business = createApplicationStateBusinessRecord({
        storeId: harness.catalog.storeId,
        namespace: APP_ID,
        key: request.input.key,
        value: request.input.value,
        destinationEffectId: destinationEffectId(effectId),
        contractDigest,
      });
      await harness.baseDb.put({
        tableName: APPLICATION_STATE_TABLE_NAME,
        keyName: APPLICATION_STATE_KEY_NAME,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        record: business,
      });
      await expect(
        reconcileCatalogEffect(harness.reconciliation, { effectId }),
      ).rejects.toBeInstanceOf(ApplicationStateCorruptionError);
      const table = createApplicationStateTable({
        db: harness.baseDb,
        tableName: APPLICATION_STATE_TABLE_NAME,
      });
      await expect(
        table.readNotAppliedResolution(destinationEffectId(effectId)),
      ).resolves.toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  test('recovers a committed not-applied resolution after its response is lost', async () => {
    let loseResponse = true;
    const harness = await createCatalogHarness({
      wrapDb(
        /** @type {import('../../src/core/lib/db/base.js').DBClient} */ baseDb,
      ) {
        return {
          ...baseDb,
          async transactionWrite(
            /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
          ) {
            const result = await baseDb.transactionWrite(params);
            if (
              loseResponse &&
              params.putRequests?.[0]?.record?.record_kind ===
                'application-state-effect-resolution'
            ) {
              loseResponse = false;
              throw new Error('simulated resolution response loss');
            }
            return result;
          },
        };
      },
    });
    try {
      const decision = await reconcileCatalogEffect(harness.reconciliation);
      expect(decision).toMatchObject({ kind: 'not-applied' });
      expect(loseResponse).toBe(false);
      await expect(
        reconcileCatalogEffect(harness.reconciliation),
      ).resolves.toEqual(decision);
    } finally {
      await harness.cleanup();
    }
  });

  test('rejects a self-effect present observation at the record constructor', () => {
    const businessKey = createApplicationStateBusinessKey(APP_ID, 'answer');
    expect(() =>
      createApplicationStateNotAppliedResolutionRecord({
        storeId: STORE_ID,
        destinationEffectId: destinationEffectId(),
        contractDigest: createId(
          'wac',
          'wharfie:test:application-state-contract:v2',
          { fixture: 'constructor-corruption' },
        ),
        businessKey,
        businessObservation: {
          kind: 'present-other',
          recordDigest: createId(
            'war',
            'wharfie:test:application-state-business:v2',
            { fixture: 'constructor-corruption' },
          ),
          createdByDestinationEffectId: destinationEffectId(),
        },
      }),
    ).toThrow(ApplicationStateCorruptionError);
  });
});

describe('application-state evidence verification', () => {
  test('accepts a self-consistent already-present receipt', async () => {
    const harness = await createCatalogHarness();
    try {
      await executeCatalogEffect(harness.catalog, {
        effectId: 'first-writer',
      });
      const effectId = 'already-present-writer';
      const request = effectRequest('application-state-attempt', { effectId });
      const outcome = await executeCatalogEffect(harness.catalog, { effectId });
      expect(outcome).toMatchObject({ result: { inserted: false } });
      expect(
        verifyApplicationStatePutIfAbsentOutcome(
          verifierInput(harness.catalog, request, outcome, effectId),
        ),
      ).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });

  test('rejects every material contract or evidence alteration synchronously', async () => {
    const harness = await createCatalogHarness();
    try {
      const request = effectRequest('application-state-attempt');
      const outcome = await executeCatalogEffect(harness.catalog);
      const valid = verifierInput(harness.catalog, request, outcome);
      expect(verifyApplicationStatePutIfAbsentOutcome(valid)).toBe(true);
      expect(APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS[0].verify(valid)).toBe(
        true,
      );
      expect(
        verifyApplicationStatePutIfAbsentOutcome({
          ...valid,
          request: {
            ...valid.request,
            input: { key: 'other-key', value: { value: 42 } },
          },
        }),
      ).toBe(false);
      expect(
        verifyApplicationStatePutIfAbsentOutcome({
          ...valid,
          effect: {
            ...valid.effect,
            destination: {
              ...valid.effect.destination,
              configuration: {
                ...valid.effect.destination.configuration,
                namespace: 'other-app',
              },
            },
          },
        }),
      ).toBe(false);
      expect(
        verifyApplicationStatePutIfAbsentOutcome({
          ...valid,
          outcome: {
            ...valid.outcome,
            result: { inserted: false },
          },
        }),
      ).toBe(false);
      expect(
        verifyApplicationStatePutIfAbsentOutcome({
          ...valid,
          outcome: {
            ...valid.outcome,
            evidence: {
              ...valid.outcome.evidence,
              receiptDigest: valid.outcome.evidence.businessRecordDigest,
            },
          },
        }),
      ).toBe(false);
      expect(
        verifyApplicationStatePutIfAbsentOutcome({
          ...valid,
          outcome: Promise.resolve(valid.outcome),
        }),
      ).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });
});

describe.each([
  { label: 'execution', createCatalog: createBuiltinManagedEffectCatalog },
  {
    label: 'reconciliation',
    createCatalog: createBuiltinManagedEffectReconciliationCatalog,
  },
])('application-state $label catalog authority', ({ createCatalog }) => {
  test.each([
    { label: 'null', authority: null },
    { label: 'missing fields', authority: {} },
    { label: 'zero epoch', authority: { ...catalogAuthority(), epoch: 0 } },
    {
      label: 'unexpected fields',
      authority: { ...catalogAuthority(), coordinatorEpoch: 1 },
    },
    { label: 'wrong app', authority: catalogAuthority(1, 'other-app') },
  ])(
    'rejects $label authority before reading or writing',
    async ({ authority }) => {
      const harness = await createCatalogHarness();
      const get = jest.fn(async () => {
        throw new Error('invalid authority must not read destination');
      });
      const transactionWrite = jest.fn(async () => {
        throw new Error('invalid authority must not write destination');
      });
      try {
        await expect(
          createCatalog({
            db: { ...harness.baseDb, get, transactionWrite },
            appId: APP_ID,
            adapterName: 'vanilla',
            allowTestAdapter: true,
            coordinatorAuthority: /** @type {any} */ (authority),
          }),
        ).rejects.toThrow(/coordinatorAuthority/i);
        expect(get).not.toHaveBeenCalled();
        expect(transactionWrite).not.toHaveBeenCalled();
      } finally {
        await harness.cleanup();
      }
    },
  );

  test.each(['token', 'snapshot'])(
    'snapshots the full %s before its first asynchronous read',
    async (kind) => {
      const harness = await createCatalogHarness();
      const candidate =
        kind === 'token'
          ? { ...catalogAuthority() }
          : catalogAuthoritySnapshot();
      const options = {
        db: harness.baseDb,
        appId: APP_ID,
        adapterName: /** @type {const} */ ('vanilla'),
        allowTestAdapter: true,
        coordinatorAuthority: candidate,
        expectedStoreId: STORE_ID,
      };
      try {
        const creating = createCatalog(options);
        candidate.epoch = 99;
        candidate.coordinatorId = 'mutated-caller';
        options.coordinatorAuthority = catalogAuthority(2);
        options.appId = 'mutated-app';
        options.expectedStoreId = createId(
          'was',
          'wharfie:test:mutated-store:v1',
          { mutated: true },
        );
        const catalog = await creating;
        const table = createApplicationStateTable({
          db: harness.baseDb,
          tableName: APPLICATION_STATE_TABLE_NAME,
        });
        const authority = await table.readCoordinatorAuthority({
          storeId: STORE_ID,
          namespace: APP_ID,
        });
        expect(authority).toMatchObject({
          store_id: STORE_ID,
          namespace: APP_ID,
          authority_schema_version: 1,
          coordinator_id: catalogAuthority().coordinatorId,
          authority_id: catalogAuthority().authorityId,
          epoch: 1,
        });
        expect(Object.isFrozen(authority)).toBe(true);
        expect(authority).not.toHaveProperty('heartbeatAt');
        expect(catalog.destination).toEqual(harness.catalog.destination);
        expect(JSON.stringify(catalog.destination)).not.toMatch(
          /coordinator|authority|epoch/i,
        );
      } finally {
        await harness.cleanup();
      }
    },
  );

  test.each([null, '', 'not-a-store-id'])(
    'rejects invalid expectedStoreId %p before reading or adopting',
    async (expectedStoreId) => {
      const harness = await createCatalogHarness();
      const get = jest.fn(async () => {
        throw new Error('invalid expectedStoreId must not read destination');
      });
      const transactionWrite = jest.fn(async () => {
        throw new Error('invalid expectedStoreId must not write destination');
      });
      try {
        await expect(
          createCatalog(
            /** @type {any} */ ({
              db: { ...harness.baseDb, get, transactionWrite },
              appId: APP_ID,
              adapterName: 'vanilla',
              allowTestAdapter: true,
              coordinatorAuthority: catalogAuthority(),
              expectedStoreId,
            }),
          ),
        ).rejects.toThrow(/expectedStoreId/i);
        expect(get).not.toHaveBeenCalled();
        expect(transactionWrite).not.toHaveBeenCalled();
      } finally {
        await harness.cleanup();
      }
    },
  );

  test.each(['missing', 'replacement'])(
    'refuses a %s retained destination without bootstrap or authority adoption',
    async (kind) => {
      const root = makeRoot('application-state-pinned-catalog');
      const db = createVanillaDB({ path: root });
      const replacementStoreId = createId(
        'was',
        'wharfie:test:replacement-store:v1',
        { replacement: true },
      );
      const transactionWrite = jest.fn(async () => {
        throw new Error('wrong destination must not receive any mutation');
      });
      try {
        if (kind === 'replacement') {
          await createBuiltinManagedEffectCatalog({
            db,
            appId: APP_ID,
            adapterName: 'vanilla',
            allowTestAdapter: true,
            createStoreId: () => replacementStoreId,
          });
        }
        await expect(
          createCatalog({
            db: { ...db, transactionWrite },
            appId: APP_ID,
            adapterName: 'vanilla',
            allowTestAdapter: true,
            coordinatorAuthority: catalogAuthority(),
            expectedStoreId: STORE_ID,
          }),
        ).rejects.toBeInstanceOf(ApplicationStateStoreIdentityError);
        expect(transactionWrite).not.toHaveBeenCalled();
        const table = createApplicationStateTable({
          db,
          tableName: APPLICATION_STATE_TABLE_NAME,
        });
        if (kind === 'missing') {
          await expect(table.readStoreIdentity()).resolves.toBeNull();
        } else {
          await expect(table.readStoreIdentity()).resolves.toMatchObject({
            store_id: replacementStoreId,
          });
          await expect(
            table.readCoordinatorAuthority({
              storeId: replacementStoreId,
              namespace: APP_ID,
            }),
          ).resolves.toBeNull();
        }
      } finally {
        await db.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  test('rejects constructing a new stale binding without downgrading the destination', async () => {
    const harness = await createCatalogHarness({
      coordinatorAuthority: catalogAuthority(2),
    });
    try {
      await expect(
        createCatalog({
          db: harness.baseDb,
          appId: APP_ID,
          adapterName: 'vanilla',
          allowTestAdapter: true,
          coordinatorAuthority: catalogAuthority(),
        }),
      ).rejects.toMatchObject({
        code: 'WHARFIE_APPLICATION_STATE_COORDINATOR_AUTHORITY_STALE',
      });
      const table = createApplicationStateTable({
        db: harness.baseDb,
        tableName: APPLICATION_STATE_TABLE_NAME,
      });
      await expect(
        table.readCoordinatorAuthority({
          storeId: STORE_ID,
          namespace: APP_ID,
        }),
      ).resolves.toMatchObject({
        coordinator_id: catalogAuthority(2).coordinatorId,
        authority_id: catalogAuthority(2).authorityId,
        epoch: 2,
      });
    } finally {
      await harness.cleanup();
    }
  });

  test.each([
    { corruption: 'deleted', floorEpoch: 1 },
    { corruption: 'rolled back', floorEpoch: 3 },
  ])(
    'refuses a $corruption retained ADOPTED floor for same and higher catalog tokens without writes',
    async ({ corruption, floorEpoch }) => {
      const harness = await createCatalogHarness({
        coordinatorAuthority: catalogAuthority(floorEpoch),
      });
      const floor = createApplicationStateCoordinatorAuthorityRecord({
        storeId: STORE_ID,
        namespace: APP_ID,
        authority: catalogAuthority(floorEpoch),
      });
      const key = createApplicationStateCoordinatorAuthorityKey(APP_ID);
      try {
        if (corruption === 'deleted') {
          await harness.baseDb.remove({
            tableName: APPLICATION_STATE_TABLE_NAME,
            keyName: APPLICATION_STATE_KEY_NAME,
            keyValue: key.resourceId,
            sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
            sortKeyValue: key.sortKey,
          });
        } else {
          await harness.baseDb.put({
            tableName: APPLICATION_STATE_TABLE_NAME,
            keyName: APPLICATION_STATE_KEY_NAME,
            sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
            record: createApplicationStateCoordinatorAuthorityRecord({
              storeId: STORE_ID,
              namespace: APP_ID,
              authority: catalogAuthority(1),
            }),
          });
        }
        for (const epoch of [floorEpoch, floorEpoch + 1]) {
          const transactionWrite = jest.fn(
            async (
              /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
            ) => await harness.baseDb.transactionWrite(params),
          );
          await expect(
            createCatalog({
              db: { ...harness.baseDb, transactionWrite },
              appId: APP_ID,
              adapterName: 'vanilla',
              allowTestAdapter: true,
              coordinatorAuthority: catalogAuthority(epoch),
              expectedStoreId: STORE_ID,
              destinationAuthorityFloor: floor,
            }),
          ).rejects.toMatchObject({
            code: 'WHARFIE_APPLICATION_STATE_COORDINATOR_AUTHORITY_STALE',
          });
          expect(transactionWrite).not.toHaveBeenCalled();
        }
      } finally {
        await harness.cleanup();
      }
    },
  );
});

describe('application-state catalog authority replay and recovery', () => {
  test('keeps held old catalogs usable for exact permanent results without writes', async () => {
    /** @type {ReturnType<typeof jest.fn> | undefined} */
    let write;
    const harness = await createCatalogHarness({
      coordinatorAuthority: catalogAuthority(),
      wrapDb(baseDb) {
        const transactionWrite = jest.fn(
          async (
            /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
          ) => await baseDb.transactionWrite(params),
        );
        write = transactionWrite;
        return { ...baseDb, transactionWrite };
      },
    });
    const negativeInput = {
      effectId: 'permanent-not-applied',
      requestOverrides: { input: { key: 'never-written', value: 7 } },
    };
    try {
      const outcome = await executeCatalogEffect(harness.catalog);
      const negative = await reconcileCatalogEffect(
        harness.reconciliation,
        negativeInput,
      );
      const successor = await createBuiltinManagedEffectCatalog({
        db: harness.baseDb,
        appId: APP_ID,
        adapterName: 'vanilla',
        allowTestAdapter: true,
        coordinatorAuthority: catalogAuthority(2),
      });
      write?.mockClear();
      await expect(executeCatalogEffect(harness.catalog)).resolves.toEqual(
        outcome,
      );
      await expect(
        reconcileCatalogEffect(harness.reconciliation),
      ).resolves.toEqual({ kind: 'outcome', outcome });
      await expect(
        reconcileCatalogEffect(harness.reconciliation, negativeInput),
      ).resolves.toEqual(negative);
      await expect(
        executeCatalogEffect(harness.catalog, negativeInput),
      ).rejects.toBeInstanceOf(ApplicationStateEffectNotAppliedError);
      expect(write).not.toHaveBeenCalled();
      expect(successor.destination).toEqual(harness.catalog.destination);

      await expect(
        executeCatalogEffect(harness.catalog, {
          effectId: 'stale-fresh-write',
          requestOverrides: { input: { key: 'stale-fresh-key', value: 8 } },
        }),
      ).rejects.toMatchObject({
        code: 'WHARFIE_APPLICATION_STATE_COORDINATOR_AUTHORITY_STALE',
      });
      await expect(
        readBusiness(harness.baseDb, APP_ID, 'stale-fresh-key'),
      ).resolves.toBeUndefined();
      await expect(
        executeCatalogEffect(successor, {
          effectId: 'successor-fresh-write',
          requestOverrides: { input: { key: 'successor-fresh-key', value: 9 } },
        }),
      ).resolves.toMatchObject({ result: { inserted: true } });
    } finally {
      await harness.cleanup();
    }
  });

  test('leaves recovery and unbound reconciliation preflight read-only after adoption', async () => {
    const harness = await createCatalogHarness({
      coordinatorAuthority: catalogAuthority(),
    });
    const transactionWrite = jest.fn(async () => {
      throw new Error('read-only catalog must not adopt or mutate');
    });
    try {
      const outcome = await executeCatalogEffect(harness.catalog);
      const readOnlyDb = { ...harness.baseDb, transactionWrite };
      const recovery = await createBuiltinManagedEffectRecoveryCatalog({
        db: readOnlyDb,
        appId: APP_ID,
        adapterName: 'vanilla',
        allowTestAdapter: true,
      });
      const preflight = await createBuiltinManagedEffectReconciliationCatalog({
        db: readOnlyDb,
        appId: APP_ID,
        adapterName: 'vanilla',
        allowTestAdapter: true,
      });
      expect(preflight.destination).toEqual(harness.catalog.destination);
      await expect(
        recovery.recoverOutcome({
          destinationEffectId: destinationEffectId(),
          destination: harness.catalog.destination,
          identity: contractIdentity(),
          request: effectRequest('application-state-attempt'),
        }),
      ).resolves.toEqual(outcome);
      await expect(
        createBuiltinManagedEffectRecoveryCatalog(
          /** @type {any} */ ({
            db: readOnlyDb,
            appId: APP_ID,
            adapterName: 'vanilla',
            allowTestAdapter: true,
            coordinatorAuthority: catalogAuthority(2),
          }),
        ),
      ).rejects.toThrow(/coordinatorAuthority is unsupported/i);
      expect(transactionWrite).not.toHaveBeenCalled();
    } finally {
      await harness.cleanup();
    }
  });

  test.each(['receipt', 'resolution'])(
    'recovers a committed %s when response loss follows successor adoption',
    async (kind) => {
      let loseResponse = true;
      let lostResponses = 0;
      const harness = await createCatalogHarness({
        coordinatorAuthority: catalogAuthority(),
        wrapDb(baseDb) {
          return {
            ...baseDb,
            async transactionWrite(params) {
              const result = await baseDb.transactionWrite(params);
              if (
                loseResponse &&
                params.putRequests?.some(
                  ({ record }) =>
                    record.record_kind === `application-state-effect-${kind}`,
                )
              ) {
                loseResponse = false;
                await createBuiltinManagedEffectCatalog({
                  db: baseDb,
                  appId: APP_ID,
                  adapterName: 'vanilla',
                  allowTestAdapter: true,
                  coordinatorAuthority: catalogAuthority(2),
                });
                lostResponses += 1;
                throw new Error('lost response after destination supersession');
              }
              return result;
            },
          };
        },
      });
      try {
        if (kind === 'receipt') {
          await expect(
            executeCatalogEffect(harness.catalog),
          ).resolves.toMatchObject({
            result: { inserted: true },
          });
        } else {
          await expect(
            reconcileCatalogEffect(harness.reconciliation),
          ).resolves.toMatchObject({ kind: 'not-applied' });
        }
        expect(lostResponses).toBe(1);
      } finally {
        await harness.cleanup();
      }
    },
  );
});

describe('application-state production storage', () => {
  test('recovers the same receipt and store identity after a true LMDB reopen', async () => {
    const root = makeRoot('application-state-lmdb-reopen');
    /** @type {import('../../src/core/lib/db/base.js').DBClient | undefined} */
    let db;
    try {
      db = await createApplicationStateDBClient('lmdb', { path: root });
      const catalog = await createBuiltinManagedEffectCatalog({
        db,
        appId: APP_ID,
        adapterName: 'lmdb',
        createStoreId: () => STORE_ID,
      });
      const outcome = await executeCatalogEffect(catalog);
      await db.close();
      db = undefined;

      db = await createApplicationStateDBClient('lmdb', {
        path: root,
        readOnly: true,
      });
      const reopened = await createBuiltinManagedEffectRecoveryCatalog({
        db,
        appId: APP_ID,
        adapterName: 'lmdb',
      });
      expect(reopened.storeId).toBe(STORE_ID);
      expect(reopened).not.toHaveProperty('resolve');
      expect(reopened).not.toHaveProperty('execute');
      await expect(
        reopened.recoverOutcome({
          destinationEffectId: destinationEffectId(),
          destination: catalog.destination,
          identity: contractIdentity(),
          request: effectRequest('application-state-attempt'),
        }),
      ).resolves.toEqual(outcome);
    } finally {
      await db?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('retains a not-applied resolution and execution fence after a true LMDB reopen', async () => {
    const root = makeRoot('application-state-lmdb-resolution-reopen');
    /** @type {import('../../src/core/lib/db/base.js').DBClient | undefined} */
    let db;
    try {
      db = await createApplicationStateDBClient('lmdb', { path: root });
      await createBuiltinManagedEffectCatalog({
        db,
        appId: APP_ID,
        adapterName: 'lmdb',
        createStoreId: () => STORE_ID,
      });
      const reconciliation =
        await createBuiltinManagedEffectReconciliationCatalog({
          db,
          appId: APP_ID,
          adapterName: 'lmdb',
        });
      const decision = await reconcileCatalogEffect(reconciliation);
      expect(decision).toMatchObject({ kind: 'not-applied' });
      await db.close();
      db = undefined;

      db = await createApplicationStateDBClient('lmdb', { path: root });
      const reopenedReconciliation =
        await createBuiltinManagedEffectReconciliationCatalog({
          db,
          appId: APP_ID,
          adapterName: 'lmdb',
        });
      await expect(
        reconcileCatalogEffect(reopenedReconciliation),
      ).resolves.toEqual(decision);
      const reopenedExecution = await createBuiltinManagedEffectCatalog({
        db,
        appId: APP_ID,
        adapterName: 'lmdb',
      });
      await expect(
        executeCatalogEffect(reopenedExecution),
      ).rejects.toBeInstanceOf(ApplicationStateEffectNotAppliedError);
    } finally {
      if (db) await db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('application-state managed-effect composition', () => {
  test('commits, verifies, and redelivers one application mutation through the ledger', async () => {
    const appHarness = await createCatalogHarness();
    const controlRoot = makeRoot('application-state-control');
    const payloadRoot = makeRoot('application-state-payload');
    const controlDb = createVanillaDB({ path: controlRoot });
    let controlClosed = false;
    try {
      const payloadStore = createLocalExecutionPayloadStore({
        path: payloadRoot,
        storeId: 'application-state-ledger-payloads',
      });
      const ledger = createExecutionLedger({
        db: controlDb,
        tableName: 'application-state-ledger',
        payloadStore,
        effectEvidenceVerifiers: [
          ...appHarness.catalog.effectEvidenceVerifiers,
        ],
      });
      const created = await ledger.createManualRun({
        runId: RUN_ID,
        appId: APP_ID,
        revisionId: REVISION_ID,
        invocationId: INVOCATION_ID,
        activityId: 'application-state-activity',
        input: { initialize: true },
        callerMetadata: { source: 'test' },
        transitionId: 'create-application-state-run',
      });
      const claimed = await ledger.claimInvocation({
        runId: RUN_ID,
        invocationId: INVOCATION_ID,
        fencingToken: FENCING_TOKEN,
        expectedGeneration: 0,
        expectedVersion: created.run.version,
        transitionId: 'claim-application-state-run',
      });
      const started = await ledger.markAttemptStarted({
        runId: RUN_ID,
        invocationId: INVOCATION_ID,
        attemptId: claimed.attempt.attemptId,
        fencingToken: FENCING_TOKEN,
        generation: claimed.attempt.generation,
        expectedVersion: claimed.run.version,
        transitionId: 'start-application-state-run',
      });
      const handler = createBuiltinManagedEffectHandler({
        ledger,
        runId: RUN_ID,
        invocationId: INVOCATION_ID,
        catalog: appHarness.catalog,
      });
      const request = effectRequest(started.attempt.attemptId);
      const signal = new AbortController().signal;
      const frame = await handler(request, { signal });
      expect(frame).toMatchObject({
        type: 'effect-result',
        effectId: EFFECT_ID,
        ok: true,
        result: { inserted: true },
        substantiatedReplayProperties:
          APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
      });
      await expect(readBusiness(appHarness.baseDb)).resolves.toMatchObject({
        value: { value: 42 },
      });

      const reopened = createExecutionLedger({
        db: controlDb,
        tableName: 'application-state-ledger',
        payloadStore,
        effectEvidenceVerifiers: [
          ...appHarness.catalog.effectEvidenceVerifiers,
        ],
      });
      await expect(
        reopened.readManagedEffectDelivery(RUN_ID, INVOCATION_ID, EFFECT_ID),
      ).resolves.toMatchObject({ resultFrame: frame });
      await expect(handler(request, { signal })).resolves.toEqual(frame);

      const withoutVerifier = createExecutionLedger({
        db: controlDb,
        tableName: 'application-state-ledger',
        payloadStore,
      });
      await expect(withoutVerifier.rebuildRun(RUN_ID)).rejects.toThrow(
        /verifier is unavailable/i,
      );

      await controlDb.close();
      controlClosed = true;
      await expect(
        withExecutionLedger(
          async (reopenedLedger) =>
            await reopenedLedger.readManagedEffectDelivery(
              RUN_ID,
              INVOCATION_ID,
              EFFECT_ID,
            ),
          {
            readOnly: true,
            configuration: Object.freeze({
              adapterName: 'vanilla',
              controlPath: controlRoot,
              tableName: 'application-state-ledger',
              payloadPath: payloadRoot,
              payloadStoreId: 'application-state-ledger-payloads',
              sessionPath: join(controlRoot, 'sessions'),
            }),
          },
        ),
      ).resolves.toMatchObject({ resultFrame: frame });
    } finally {
      if (!controlClosed) await controlDb.close();
      await appHarness.cleanup();
      rmSync(controlRoot, { recursive: true, force: true });
      rmSync(payloadRoot, { recursive: true, force: true });
    }
  });

  test('keeps application namespaces isolated inside one physical store', async () => {
    const harness = await createCatalogHarness();
    try {
      const other = await createBuiltinManagedEffectCatalog({
        db: harness.baseDb,
        appId: 'other-application',
        adapterName: 'vanilla',
        allowTestAdapter: true,
      });
      await executeCatalogEffect(harness.catalog);
      const otherRequest = effectRequest('other-attempt', {
        effectId: 'other-effect',
      });
      await other.resolve(otherRequest).execute({
        destinationEffectId: createManagedEffectDestinationId({
          appId: 'other-application',
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          effectId: 'other-effect',
        }),
        destination: other.destination,
        identity: effectIdentity('other-effect'),
        request: otherRequest,
      });
      await expect(readBusiness(harness.baseDb, APP_ID)).resolves.toMatchObject(
        {
          namespace: APP_ID,
        },
      );
      await expect(
        readBusiness(harness.baseDb, 'other-application'),
      ).resolves.toMatchObject({ namespace: 'other-application' });
    } finally {
      await harness.cleanup();
    }
  });
});
