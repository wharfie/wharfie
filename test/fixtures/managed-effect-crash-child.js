/* eslint-disable jsdoc/require-jsdoc, no-process-exit */

import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';

import { createExecutionLedger } from '../../src/core/lib/db/tables/execution-ledger.js';
import createLMDB from '../../src/core/lib/db/adapters/lmdb.js';
import { createLedgerServiceOwnership } from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import {
  MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA,
  MANAGED_EFFECT_REQUEST_PAYLOAD_SCHEMA,
} from '../../src/core/lib/ledger/execution-ledger-contract.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { ActivityProtocolTranscriptValidator } from '../../src/core/runtime/activity-protocol.js';
import { openApplicationStateDB } from '../../src/core/runtime/application-state-store.js';
import {
  APPLICATION_STATE_CAPABILITY,
  APPLICATION_STATE_PUT_IF_ABSENT_OPERATION,
} from '../../src/core/runtime/effects/application-state.js';
import { createBuiltinManagedEffectCatalog } from '../../src/core/runtime/effects/builtin-catalog.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  runManualLedgerActivity,
} from '../../src/core/runtime/manual-ledger-run.js';
import { executeManagedEffect } from '../../src/core/runtime/managed-effect.js';
import { acquireLocalLedgerServiceSession } from '../../src/core/runtime/services/ledger-service.js';

const BOUNDARY = Object.freeze({
  REQUEST_PAYLOAD: 'request-payload-published',
  REQUEST_COMMIT: 'request-transaction-committed',
  START_COMMIT: 'start-transaction-committed',
  DESTINATION_COMMIT: 'destination-transaction-committed',
  OUTCOME_PAYLOAD: 'outcome-payload-published',
  OUTCOME_COMMIT: 'outcome-ledger-committed',
  HOST_EFFECT_RESPONSE: 'effect-response-returned',
});

const VALID_BOUNDARIES = new Set(Object.values(BOUNDARY));

/** @returns {Record<string, any>} */
function parseOptions() {
  const value = JSON.parse(process.argv[2] || 'null');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Crash child options must be an object.');
  }
  for (const key of [
    'boundary',
    'runId',
    'appId',
    'revisionId',
    'activityId',
    'effectId',
    'adapterMarkerPath',
    'control',
    'applicationState',
  ]) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`Crash child options.${key} is required.`);
    }
  }
  if (!VALID_BOUNDARIES.has(value.boundary)) {
    throw new TypeError(`Unsupported crash boundary: ${value.boundary}`);
  }
  return value;
}

/** @param {Record<string, any>} message */
async function send(message) {
  if (typeof process.send !== 'function') {
    throw new Error('Crash child requires a Node IPC channel.');
  }
  const ipcSend = process.send.bind(process);
  /** @type {Promise<void>} */
  const sent = new Promise((resolve, reject) => {
    ipcSend(message, undefined, undefined, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  await sent;
}

function waitForever() {
  const word = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(word, 0, 0);
}

/**
 * @param {Record<string, any>} options
 * @param {string} attemptId
 * @returns {Record<string, any>}
 */
function effectRequest(options, attemptId) {
  return {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'effect-request',
    attemptId,
    sequence: 1,
    effectId: options.effectId,
    capability: APPLICATION_STATE_CAPABILITY,
    operation: APPLICATION_STATE_PUT_IF_ABSENT_OPERATION,
    input: {
      key: 'crash-matrix-key',
      value: { written: 'exactly-once-at-destination' },
    },
    requestedReplayProperties: ['idempotent', 'transactional'],
  };
}

/**
 * @param {Record<string, any>} startFrame
 * @param {Record<string, any>} request
 * @param {Record<string, any>} resultFrame
 */
function completedEvidence(startFrame, request, resultFrame) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const start = transcript.acceptHostFrame(startFrame);
  const acceptedRequest = transcript.acceptComponentFrame(request);
  const acceptedResult = transcript.acceptHostFrame(resultFrame);
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId: start.attemptId,
    sequence: 2,
    result: { effectReturned: true },
  });
  return {
    status: terminal.type,
    start,
    terminal,
    frames: [start, acceptedRequest, acceptedResult, terminal],
    transcript: transcript.snapshot(),
  };
}

/** @param {string} filePath @param {string} destinationEffectId */
function recordAdapterEntry(filePath, destinationEffectId) {
  const handle = openSync(filePath, 'a', 0o600);
  try {
    writeSync(handle, `${destinationEffectId}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}

async function main() {
  const options = parseOptions();
  const db = createLMDB({ path: options.control.controlPath });
  const ownership = createLedgerServiceOwnership({
    db,
    tableName: options.control.tableName,
  });
  const localOwner = await acquireLocalLedgerServiceSession({
    appId: options.appId,
    ownership,
    sessionRoot: options.control.sessionPath,
  });
  let reached = false;

  /** @param {string} boundary @param {Record<string, any>} [detail] */
  const reach = async (boundary, detail = {}) => {
    if (boundary !== options.boundary || reached) return;
    reached = true;
    await send({
      kind: 'boundary',
      boundary,
      detail,
      ownership: localOwner.ownership,
    });
    waitForever();
  };

  const basePayloadStore = createLocalExecutionPayloadStore({
    path: options.control.payloadPath,
    storeId: options.control.payloadStoreId,
  });
  const payloadStore = {
    ...basePayloadStore,
    async putJson(
      /** @type {{value: unknown, payloadSchema: string}} */ input,
    ) {
      const reference = await basePayloadStore.putJson(input);
      if (input.payloadSchema === MANAGED_EFFECT_REQUEST_PAYLOAD_SCHEMA) {
        await reach(BOUNDARY.REQUEST_PAYLOAD, { reference });
      }
      if (input.payloadSchema === MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA) {
        await reach(BOUNDARY.OUTCOME_PAYLOAD, { reference });
      }
      return reference;
    },
  };
  const applicationState = await openApplicationStateDB({
    configuration: options.applicationState,
  });
  try {
    const catalog = await createBuiltinManagedEffectCatalog({
      db: applicationState.db,
      appId: options.appId,
      adapterName: applicationState.context.adapterName,
      tableName: applicationState.context.tableName,
    });
    // The child receives functions through module imports, never over JSON.
    // Install the exact verifier registry only after constructing the catalog.
    const verifiedLedger = createExecutionLedger({
      db,
      tableName: options.control.tableName,
      payloadStore,
      effectEvidenceVerifiers: [...catalog.effectEvidenceVerifiers],
    });
    const controlledLedger = {
      ...verifiedLedger,
      async recordManagedEffectRequest(
        /** @type {Parameters<typeof verifiedLedger.recordManagedEffectRequest>[0]} */ input,
      ) {
        const result = await verifiedLedger.recordManagedEffectRequest(input);
        await reach(BOUNDARY.REQUEST_COMMIT);
        return result;
      },
      async markManagedEffectStarted(
        /** @type {Parameters<typeof verifiedLedger.markManagedEffectStarted>[0]} */ input,
      ) {
        const result = await verifiedLedger.markManagedEffectStarted(input);
        await reach(BOUNDARY.START_COMMIT);
        return result;
      },
      async commitManagedEffectOutcome(
        /** @type {Parameters<typeof verifiedLedger.commitManagedEffectOutcome>[0]} */ input,
      ) {
        const result = await verifiedLedger.commitManagedEffectOutcome(input);
        await reach(BOUNDARY.OUTCOME_COMMIT);
        return result;
      },
    };

    await runManualLedgerActivity({
      ledger: controlledLedger,
      runId: options.runId,
      appId: options.appId,
      revisionId: options.revisionId,
      activityId: options.activityId,
      input: { crashBoundary: options.boundary },
      callerMetadata: { fixture: 'real-sigkill' },
      createFencingToken: () => 'managed-effect-crash-fence',
      executeAttempt: async (startFrame, { signal }) => {
        const request = effectRequest(options, startFrame.attemptId);
        const retainedAdapter = catalog.resolve(request);
        const adapter = Object.freeze({
          ...retainedAdapter,
          execute: async (
            /** @type {Parameters<typeof retainedAdapter.execute>[0]} */ input,
          ) => {
            recordAdapterEntry(
              options.adapterMarkerPath,
              input.destinationEffectId,
            );
            const outcome = await retainedAdapter.execute(input);
            await reach(BOUNDARY.DESTINATION_COMMIT);
            return outcome;
          },
        });
        const response = await executeManagedEffect({
          ledger: controlledLedger,
          runId: options.runId,
          invocationId: MANUAL_LEDGER_INVOCATION_ID,
          request,
          adapter,
          signal,
        });
        // This is the helper returning the host effect-result frame. It is
        // deliberately before any worker or user continuation could observe it.
        await reach(BOUNDARY.HOST_EFFECT_RESPONSE);
        return completedEvidence(startFrame, request, response);
      },
    });
  } finally {
    await applicationState.close();
  }

  throw new Error(
    `Crash child completed without reaching boundary ${options.boundary}.`,
  );
}

main().catch(async (error) => {
  await send({
    kind: 'fatal',
    error:
      error instanceof Error ? error.stack || error.message : String(error),
  }).catch(() => {});
  process.exit(1);
});
