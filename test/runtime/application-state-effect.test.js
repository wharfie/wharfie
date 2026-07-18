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
  createApplicationStateBusinessKey,
  createApplicationStateBusinessRecord,
  createApplicationStateReceiptRecord,
} from '../../src/core/lib/db/tables/application-state.js';
import {
  createExecutionLedger,
  createManagedEffectDestinationId,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  APPLICATION_STATE_ADAPTER_DESCRIPTOR,
  APPLICATION_STATE_CAPABILITY,
  APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS,
  APPLICATION_STATE_MAX_INPUT_BYTES,
  APPLICATION_STATE_MAX_KEY_BYTES,
  APPLICATION_STATE_PUT_IF_ABSENT_OPERATION,
  APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
  APPLICATION_STATE_VERIFIER_DESCRIPTOR,
  normalizeApplicationStateDestination,
  normalizeApplicationStatePutIfAbsentRequest,
  verifyApplicationStatePutIfAbsentOutcome,
} from '../../src/core/runtime/effects/application-state.js';
import {
  createBuiltinManagedEffectCatalog,
  createBuiltinManagedEffectHandler,
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

const STORE_ID = createId('was', 'wharfie:test:application-state-store:v1', {
  fixture: 'primary',
});

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
 * @param {{wrapDb?: (db: import('../../src/core/lib/db/base.js').DBClient) => import('../../src/core/lib/db/base.js').DBClient, appId?: string, createStoreId?: () => string}} [options]
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
  });
  return {
    root,
    baseDb,
    db,
    catalog,
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
        version: 1,
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
});

describe('application-state put-if-absent destination semantics', () => {
  test('atomically inserts one value and permanent verifier-backed receipt', async () => {
    const harness = await createCatalogHarness();
    try {
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
      'wharfie:test:replacement-store:v1',
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

      db = await createApplicationStateDBClient('lmdb', { path: root });
      const reopened = await createBuiltinManagedEffectCatalog({
        db,
        appId: APP_ID,
        adapterName: 'lmdb',
      });
      expect(reopened.storeId).toBe(STORE_ID);
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
