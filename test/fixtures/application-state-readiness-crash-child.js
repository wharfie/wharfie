/* eslint-disable jsdoc/require-jsdoc */

import createLMDB from '../../src/core/lib/db/adapters/lmdb.js';
import { createExecutionLedger } from '../../src/core/lib/db/tables/execution-ledger.js';
import {
  createLedgerServiceLifecycle,
  createLedgerServiceOwnership,
} from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { resolveManifestActivityExecutionBinding } from '../../src/core/runtime/app-runs.js';
import { prepareApplicationStateReadiness } from '../../src/core/runtime/application-state-readiness.js';
import { APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS } from '../../src/core/runtime/effects/application-state.js';
import { withExecutionLedgerCoordinatorAuthority } from '../../src/core/runtime/operator/execution-ledger-store.js';
import { createLedgerService } from '../../src/core/runtime/services/ledger-service.js';
import { runLocalResidentActivityService } from '../../src/core/runtime/services/resident-activity-worker.js';

/** @typedef {import('../../src/core/lib/db/base.js').TransactionWriteParams} Transaction */
/** @typedef {'preparing-committed' | 'destination-committed'} CrashBoundary */
/** @typedef {{mode: 'crash' | 'resident', boundary?: CrashBoundary, execution: import('../../src/core/runtime/durable-activity-host.js').ManifestActivityExecution, control: ReturnType<typeof import('../../src/core/runtime/operator/execution-ledger-store.js').resolveExecutionLedgerStoreConfiguration>, applicationState: ReturnType<typeof import('../../src/core/runtime/application-state-store.js').resolveApplicationStateStoreConfiguration>}} ChildOptions */

/** @returns {ChildOptions} */
function parseOptions() {
  const options = JSON.parse(process.argv[2] || 'null');
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Readiness crash child requires an options object.');
  }
  if (options.mode !== 'crash' && options.mode !== 'resident') {
    throw new TypeError(
      'Readiness crash child mode must be crash or resident.',
    );
  }
  if (
    options.mode === 'crash' &&
    options.boundary !== 'preparing-committed' &&
    options.boundary !== 'destination-committed'
  ) {
    throw new TypeError(
      'Unsupported application-state readiness crash boundary.',
    );
  }
  for (const key of ['execution', 'control', 'applicationState']) {
    if (!Object.prototype.hasOwnProperty.call(options, key)) {
      throw new TypeError(`Readiness crash child options.${key} is required.`);
    }
  }
  return options;
}

/** @param {Record<string, any>} message @returns {Promise<void>} */
async function send(message) {
  if (typeof process.send !== 'function') {
    throw new Error('Readiness crash child requires Node IPC.');
  }
  const ipcSend = process.send.bind(process);
  await new Promise((resolve, reject) => {
    ipcSend(message, undefined, undefined, (error) => {
      if (error) reject(error);
      else resolve(undefined);
    });
  });
}

/** @param {Transaction} params @param {'PREPARING' | 'ADOPTED'} phase @param {string} appId */
function isReadinessWrite(params, phase, appId) {
  return (
    params.putRequests?.some(
      ({ record }) =>
        record.record_kind === 'application-state-readiness' &&
        record.app_id === appId &&
        record.status === phase,
    ) === true
  );
}

/** @param {ChildOptions} options */
async function runCrash(options) {
  const binding = resolveManifestActivityExecutionBinding(options.execution);
  const { appId, revisionId } = binding.identity;
  const realDB = createLMDB({ path: options.control.controlPath });
  /** @type {((params: Transaction) => Promise<void>) | undefined} */
  let beforeWrite;
  /** @type {((params: Transaction) => Promise<void>) | undefined} */
  let afterWrite;
  const db = {
    ...realDB,
    async transactionWrite(/** @type {Transaction} */ params) {
      await beforeWrite?.(params);
      await realDB.transactionWrite(params);
      await afterWrite?.(params);
    },
  };
  const stores = { db, tableName: options.control.tableName };
  const service = createLedgerService({
    appId,
    revisionId,
    lifecycle: createLedgerServiceLifecycle(stores),
    ownership: createLedgerServiceOwnership(stores),
    sessionRoot: options.control.sessionPath,
  });
  let started = false;
  try {
    await service.start({ deferReady: true });
    started = true;
    const owner = service.getLocalOwner();
    if (!owner) throw new Error('Crash proof has no deferred-READY owner.');
    const ledger = createExecutionLedger({
      ...stores,
      payloadStore: createLocalExecutionPayloadStore({
        path: options.control.payloadPath,
        storeId: options.control.payloadStoreId,
      }),
      effectEvidenceVerifiers: [...APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS],
    });
    const context = { ...options.control, db, readOnly: false };
    await withExecutionLedgerCoordinatorAuthority({
      appId,
      coordinatorId: owner.sessionId,
      ledger,
      context,
      async handler(boundLedger, coordinatorAuthority) {
        /** @param {CrashBoundary} boundary */
        const reach = async (boundary) => {
          if (boundary !== options.boundary) return;
          await send({
            kind: 'boundary',
            boundary,
            coordinatorAuthority,
            ownership: owner.ownership,
          });
          // The parent observes durable bytes independently before SIGKILL.
          // This is outside any native transaction and never resumes normally.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        };
        afterWrite = async (params) => {
          if (isReadinessWrite(params, 'PREPARING', appId)) {
            await reach('preparing-committed');
          }
        };
        beforeWrite = async (params) => {
          if (isReadinessWrite(params, 'ADOPTED', appId)) {
            // The production helper reaches this write only after adopting and
            // reading back the real, independently committed destination fence.
            await reach('destination-committed');
          }
        };
        await prepareApplicationStateReadiness({
          ledger: boundLedger,
          appId,
          controlContext: context,
          configuration: options.applicationState,
        });
      },
    });
    throw new Error(`Readiness child never paused at ${options.boundary}.`);
  } finally {
    try {
      if (started) await service.stop();
    } finally {
      await realDB.close();
    }
  }
}

/** @param {ChildOptions} options */
async function runResident(options) {
  const shutdown = new AbortController();
  const stop = () => shutdown.abort(new Error('readiness proof SIGTERM'));
  process.on('SIGTERM', stop);
  try {
    // Recovery is deliberately uninstrumented: use the production resident
    // entrypoint, including lifecycle, ownership, readiness, and worker startup.
    const result = await runLocalResidentActivityService({
      execution: options.execution,
      configuration: options.control,
      applicationStateConfiguration: options.applicationState,
      signal: shutdown.signal,
      pollIntervalMs: 5,
      drainTimeoutMs: 50,
    });
    await send({ kind: 'stopped', result });
  } finally {
    process.removeListener('SIGTERM', stop);
  }
}

async function main() {
  const options = parseOptions();
  if (options.mode === 'crash') await runCrash(options);
  else await runResident(options);
}

main()
  .catch(async (error) => {
    await send({
      kind: 'fatal',
      name: error instanceof Error ? error.name : 'UnknownError',
      error:
        error instanceof Error ? error.stack || error.message : String(error),
    }).catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => {
    if (process.connected) process.disconnect();
  });
