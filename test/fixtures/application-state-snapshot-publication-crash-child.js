/* eslint-disable jsdoc/require-jsdoc */

import createLMDB from '../../src/core/lib/db/adapters/lmdb.js';
import { publishApplicationStateSnapshot } from '../../src/core/runtime/application-state-snapshot-lmdb.js';
import { createFilesystemApplicationStateSnapshotDistribution } from '../helpers/application-state-snapshot-filesystem-distribution.js';

/** @typedef {'source-adopted'|'marker-persisted'|'source-sealed'|'backup-complete'|'snapshot-published'|'source-retired'} PublicationCrashPhase */
/** @typedef {{phase: PublicationCrashPhase, appId: string, controlPath: string, controlTableName: string, sourceConfiguration: Record<string, any>, destination: Record<string, any>, closedBarrier: Record<string, any>, coordinatorAuthority: Record<string, any>, transferId: string, distributionIdentity: Record<string, any>, distributionRoot: string}} ChildOptions */

const PHASES = new Set([
  'source-adopted',
  'marker-persisted',
  'source-sealed',
  'backup-complete',
  'snapshot-published',
  'source-retired',
]);

/** @returns {ChildOptions} */
function parseOptions() {
  const options = JSON.parse(process.argv[2] || 'null');
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Snapshot publication crash child requires options.');
  }
  const required = [
    'phase',
    'appId',
    'controlPath',
    'controlTableName',
    'sourceConfiguration',
    'destination',
    'closedBarrier',
    'coordinatorAuthority',
    'transferId',
    'distributionIdentity',
    'distributionRoot',
  ];
  if (
    Object.keys(options).length !== required.length ||
    required.some((key) => !Object.hasOwn(options, key)) ||
    !PHASES.has(options.phase)
  ) {
    throw new TypeError(
      'Snapshot publication crash child options are invalid.',
    );
  }
  return /** @type {ChildOptions} */ (options);
}

/** @param {Record<string, any>} message */
async function send(message) {
  if (typeof process.send !== 'function') {
    throw new Error('Snapshot publication crash child requires Node IPC.');
  }
  const ipcSend = process.send.bind(process);
  await new Promise((resolve, reject) => {
    ipcSend(message, undefined, undefined, (error) => {
      if (error) reject(error);
      else resolve(undefined);
    });
  });
}

function emptyLedger() {
  return Object.freeze({
    listRuns: async () => ({ items: [] }),
    rebuildRun: async () => {
      throw new Error('Empty crash-proof history cannot rebuild a run.');
    },
  });
}

/** @param {ChildOptions} options */
async function run(options) {
  const controlDb = createLMDB({ path: options.controlPath });
  try {
    const distribution = createFilesystemApplicationStateSnapshotDistribution({
      identity: options.distributionIdentity,
      root: options.distributionRoot,
    });
    await publishApplicationStateSnapshot({
      ledger: emptyLedger(),
      appId: options.appId,
      configuration: options.sourceConfiguration,
      controlContext: {
        db: controlDb,
        tableName: options.controlTableName,
        adapterName: 'lmdb',
        controlPath: options.controlPath,
      },
      destination: options.destination,
      closedBarrier: options.closedBarrier,
      coordinatorAuthority: options.coordinatorAuthority,
      transferId: options.transferId,
      distribution,
      observePhase: async (phase) => {
        if (phase !== options.phase) return;
        await send({ kind: 'phase', phase });
        // The parent reopens the independently durable stores only after it has
        // killed this process. This callback intentionally never resumes.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      },
    });
    throw new Error(
      `Snapshot publication child never paused at ${options.phase}.`,
    );
  } finally {
    await controlDb.close();
  }
}

async function main() {
  await run(parseOptions());
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
