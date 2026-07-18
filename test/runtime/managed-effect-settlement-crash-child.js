/* eslint-disable jsdoc/require-jsdoc */

import { closeSync, fsyncSync, openSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import createLMDB from '../../src/core/lib/db/adapters/lmdb.js';
import { createApplicationStateDBClient } from '../../src/core/lib/config/db.js';
import { createExecutionLedger } from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLedgerServiceOwnership } from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA } from '../../src/core/lib/ledger/execution-ledger-contract.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS } from '../../src/core/runtime/effects/application-state.js';
import { createBuiltinManagedEffectRecoveryCatalog } from '../../src/core/runtime/effects/builtin-catalog.js';
import { recoverStoppedManagedEffects } from '../../src/core/runtime/managed-effect.js';
import { acquireLocalLedgerServiceSession } from '../../src/core/runtime/services/ledger-service.js';

const FIXTURE_ENV = 'WHARFIE_SETTLEMENT_CRASH_FIXTURE';
const Boundary = Object.freeze({
  OUTCOME_PAYLOAD: 'recovered-outcome-published',
  COMPOUND_TRANSACTION: 'compound-transaction-committed',
  HELPER_RESPONSE: 'helper-response-ready',
});

/**
 * @typedef {Object} SettlementCrashFixture
 * @property {string} boundary
 * @property {string} runId
 * @property {string} appId
 * @property {string} markerPath
 * @property {{controlPath: string, tableName: string, payloadPath: string, payloadStoreId: string, sessionPath: string}} configuration
 * @property {{storePath: string, tableName: string}} applicationStateConfiguration
 */

function readFixture() {
  const raw = process.env[FIXTURE_ENV];
  if (!raw) throw new Error(`${FIXTURE_ENV} is required.`);
  const fixture = JSON.parse(raw);
  if (
    !fixture ||
    typeof fixture !== 'object' ||
    typeof fixture.boundary !== 'string' ||
    typeof fixture.runId !== 'string' ||
    typeof fixture.appId !== 'string' ||
    typeof fixture.markerPath !== 'string' ||
    !fixture.configuration ||
    !fixture.applicationStateConfiguration
  ) {
    throw new TypeError(`${FIXTURE_ENV} is invalid.`);
  }
  return /** @type {SettlementCrashFixture} */ (fixture);
}

/** @param {string} markerPath @param {Record<string, any>} value */
function writeDurableMarker(markerPath, value) {
  writeFileSync(markerPath, `${JSON.stringify(value)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  const file = openSync(markerPath, 'r');
  try {
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
  const directory = openSync(path.dirname(markerPath), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

/**
 * @param {SettlementCrashFixture} fixture
 * @param {Record<string, any>} localSession
 * @param {Record<string, any>} [detail]
 */
async function pauseAtBoundary(fixture, localSession, detail = {}) {
  writeDurableMarker(fixture.markerPath, {
    boundary: fixture.boundary,
    pid: process.pid,
    ownership: localSession.ownership,
    ...detail,
  });
  await new Promise(() => {
    setInterval(() => {}, 1_000);
  });
}

/** @param {Record<string, any>} params */
function isCompoundSettlementTransaction(params) {
  return (params.putRequests || []).some(
    (/** @type {Record<string, any>} */ request) =>
      request.record?.record_type === 'execution_ledger_event' &&
      request.record.type === 'attempt-became-uncertain' &&
      Array.isArray(request.record.payload?.effects) &&
      request.record.payload.effects.length > 0,
  );
}

async function main() {
  const fixture = readFixture();
  const baseDb = createLMDB({ path: fixture.configuration.controlPath });
  const localSession = await acquireLocalLedgerServiceSession({
    appId: fixture.appId,
    ownership: createLedgerServiceOwnership({
      db: baseDb,
      tableName: fixture.configuration.tableName,
    }),
    sessionRoot: fixture.configuration.sessionPath,
  });
  const db =
    fixture.boundary === Boundary.COMPOUND_TRANSACTION
      ? {
          ...baseDb,
          async transactionWrite(/** @type {any} */ params) {
            await baseDb.transactionWrite(params);
            if (isCompoundSettlementTransaction(params)) {
              await pauseAtBoundary(fixture, localSession, {
                eventType: 'attempt-became-uncertain',
              });
            }
          },
        }
      : baseDb;
  const basePayloadStore = createLocalExecutionPayloadStore({
    path: fixture.configuration.payloadPath,
    storeId: fixture.configuration.payloadStoreId,
  });
  const payloadStore =
    fixture.boundary === Boundary.OUTCOME_PAYLOAD
      ? {
          ...basePayloadStore,
          async putJson(/** @type {any} */ input) {
            const reference = await basePayloadStore.putJson(input);
            if (input.payloadSchema === MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA) {
              await pauseAtBoundary(fixture, localSession, { reference });
            }
            return reference;
          },
        }
      : basePayloadStore;
  const ledger = createExecutionLedger({
    db,
    tableName: fixture.configuration.tableName,
    payloadStore,
    effectEvidenceVerifiers: [...APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS],
  });
  const applicationDb = await createApplicationStateDBClient('lmdb', {
    path: fixture.applicationStateConfiguration.storePath,
    readOnly: true,
  });
  const recoveryCatalog = await createBuiltinManagedEffectRecoveryCatalog({
    db: applicationDb,
    appId: fixture.appId,
    adapterName: 'lmdb',
    tableName: fixture.applicationStateConfiguration.tableName,
  });
  if (Object.prototype.hasOwnProperty.call(recoveryCatalog, 'resolve')) {
    throw new Error('Recovery catalog unexpectedly exposes adapter execution.');
  }

  const result = await recoverStoppedManagedEffects({
    ledger,
    runId: fixture.runId,
    invocationId: 'manual',
    recoverOutcome: recoveryCatalog.recoverOutcome,
    actor: { kind: 'local', id: 'settlement-crash-child' },
  });
  if (fixture.boundary !== Boundary.HELPER_RESPONSE) {
    throw new Error(`Crash boundary was not reached: ${fixture.boundary}`);
  }
  await pauseAtBoundary(fixture, localSession, { result });
}

await main();
