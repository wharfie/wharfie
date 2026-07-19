/* eslint-disable jsdoc/require-jsdoc, no-process-exit */

import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';

import createLMDB from '../../src/core/lib/db/adapters/lmdb.js';
import { createExecutionLedger } from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLedgerServiceOwnership } from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { openApplicationStateDB } from '../../src/core/runtime/application-state-store.js';
import { createBuiltinManagedEffectCatalog } from '../../src/core/runtime/effects/builtin-catalog.js';
import { executeManagedEffectSuccessorRun } from '../../src/core/runtime/managed-effect-successor.js';
import { acquireLocalLedgerServiceSession } from '../../src/core/runtime/services/ledger-service.js';

const Boundary = Object.freeze({
  AUTHORIZATION: 'successor-authorization-committed',
  START: 'successor-atomic-start-committed',
  DESTINATION: 'successor-destination-committed',
  TERMINAL: 'successor-atomic-terminal-committed',
});
const VALID_BOUNDARIES = new Set(Object.values(Boundary));

function parseOptions() {
  const options = JSON.parse(process.argv[2] || 'null');
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Successor crash child options must be an object.');
  }
  for (const key of [
    'boundary',
    'appId',
    'sourceRunId',
    'sourceEffectId',
    'successorId',
    'reason',
    'actor',
    'adapterMarkerPath',
    'control',
    'applicationState',
  ]) {
    if (!Object.prototype.hasOwnProperty.call(options, key)) {
      throw new TypeError(`Successor crash child options.${key} is required.`);
    }
  }
  if (!VALID_BOUNDARIES.has(options.boundary)) {
    throw new TypeError(
      `Unsupported successor crash boundary: ${options.boundary}`,
    );
  }
  return options;
}

async function send(message) {
  if (typeof process.send !== 'function') {
    throw new Error('Successor crash child requires a Node IPC channel.');
  }
  const ipcSend = process.send.bind(process);
  await new Promise((resolve, reject) => {
    ipcSend(message, undefined, undefined, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function waitForever() {
  const word = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(word, 0, 0);
}

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
  const localOwner = await acquireLocalLedgerServiceSession({
    appId: options.appId,
    ownership: createLedgerServiceOwnership({
      db,
      tableName: options.control.tableName,
    }),
    sessionRoot: options.control.sessionPath,
  });
  let reached = false;
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

  const payloadStore = createLocalExecutionPayloadStore({
    path: options.control.payloadPath,
    storeId: options.control.payloadStoreId,
  });
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
    const ledger = createExecutionLedger({
      db,
      tableName: options.control.tableName,
      payloadStore,
      effectEvidenceVerifiers: [...catalog.effectEvidenceVerifiers],
    });
    const controlledLedger = {
      ...ledger,
      async startManagedEffectSuccessor(input) {
        const result = await ledger.startManagedEffectSuccessor(input);
        await reach(Boundary.START, {
          targetRunId: result.run.runId,
          attemptId: result.attempt.attemptId,
          effectId: result.effect.effectId,
        });
        return result;
      },
      async commitManagedEffectSuccessorOutcome(input) {
        const result = await ledger.commitManagedEffectSuccessorOutcome(input);
        await reach(Boundary.TERMINAL, {
          targetRunId: result.run.runId,
          effectId: result.effect.effectId,
        });
        return result;
      },
    };
    const controlledCatalog = {
      ...catalog,
      resolve(frame) {
        const adapter = catalog.resolve(frame);
        return Object.freeze({
          ...adapter,
          async execute(input) {
            const outcome = await adapter.execute(input);
            recordAdapterEntry(
              options.adapterMarkerPath,
              input.destinationEffectId,
            );
            await reach(Boundary.DESTINATION, {
              targetRunId: input.identity.runId,
              effectId: input.identity.effectId,
              destinationEffectId: input.destinationEffectId,
            });
            return outcome;
          },
        });
      },
    };

    const handoff = await controlledLedger.authorizeManagedEffectSuccessorRetry(
      {
        sourceRunId: options.sourceRunId,
        sourceEffectId: options.sourceEffectId,
        successorId: options.successorId,
        reason: options.reason,
        actor: options.actor,
      },
    );
    await reach(Boundary.AUTHORIZATION, {
      targetRunId: handoff.authorization.target.runId,
      targetEffectId: handoff.authorization.target.effectId,
      applied: handoff.applied,
    });
    await executeManagedEffectSuccessorRun({
      ledger: controlledLedger,
      authorization: handoff.authorization,
      request: handoff.request,
      catalog: controlledCatalog,
      actor: options.actor,
      createFencingToken: () => 'successor-crash-fence',
    });
  } finally {
    await applicationState.close();
    await db.close();
  }

  throw new Error(
    `Successor crash child completed without reaching ${options.boundary}.`,
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
