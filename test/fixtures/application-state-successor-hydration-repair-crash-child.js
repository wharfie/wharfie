/* eslint-disable jsdoc/require-jsdoc */

import createLMDB from '../../src/core/lib/db/adapters/lmdb.js';
import { repairApplicationStateSnapshotHydrationRecovery } from '../../src/core/runtime/application-state-snapshot-lmdb.js';

const BOUNDARIES = new Set([
  'hydration-recovery-successor-repair-recorded',
  'hydration-recovery-successor-repair-authorized',
  'hydration-recovery-successor-repair-target-retired',
  'hydration-recovery-successor-repair-claim-retired',
]);

/**
 * @typedef {'hydration-recovery-successor-repair-recorded' | 'hydration-recovery-successor-repair-authorized' | 'hydration-recovery-successor-repair-target-retired' | 'hydration-recovery-successor-repair-claim-retired'} CrashBoundary
 */

/**
 * @typedef {{boundary: CrashBoundary, configuration: Record<string, any>, control: {path: string, tableName: string}, transport: Record<string, any>, closedBarrier: Record<string, any>, coordinatorAuthority: Record<string, any>, inspection: Record<string, any>}} ChildOptions
 */

/** @returns {ChildOptions} */
function parseOptions() {
  const options = JSON.parse(process.argv[2] || 'null');
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Application-state successor hydration repair crash child requires an options object.',
    );
  }
  if (!BOUNDARIES.has(options.boundary)) {
    throw new TypeError(
      'Application-state successor hydration repair crash child received an unsupported boundary.',
    );
  }
  const required = [
    'boundary',
    'configuration',
    'control',
    'transport',
    'closedBarrier',
    'coordinatorAuthority',
    'inspection',
  ];
  if (
    Object.keys(options).length !== required.length ||
    required.some((key) => !Object.hasOwn(options, key))
  ) {
    throw new TypeError(
      'Application-state successor hydration repair crash child options are invalid.',
    );
  }
  return /** @type {ChildOptions} */ (options);
}

/** @param {Record<string, any>} message */
async function send(message) {
  if (typeof process.send !== 'function') {
    throw new Error(
      'Application-state successor hydration repair crash child requires IPC.',
    );
  }
  const ipcSend = process.send.bind(process);
  await new Promise((resolve, reject) => {
    ipcSend(message, undefined, undefined, (error) => {
      if (error) reject(error);
      else resolve(undefined);
    });
  });
}

/** @param {ChildOptions} options */
async function run(options) {
  const db = createLMDB({ path: options.control.path });
  try {
    await repairApplicationStateSnapshotHydrationRecovery({
      configuration: options.configuration,
      controlContext: {
        db,
        tableName: options.control.tableName,
        adapterName: 'lmdb',
        controlPath: options.control.path,
      },
      transport: options.transport,
      closedBarrier: options.closedBarrier,
      coordinatorAuthority: options.coordinatorAuthority,
      inspection: options.inspection,
      confirmStaleHydrationRecoveryRepair: true,
      observePhase: async (phase) => {
        if (phase !== options.boundary) return;
        await send({ kind: 'boundary', boundary: phase });
        // The parent reopens every retained path before it issues SIGKILL.
        // This fixture must never resume normally from its selected boundary.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      },
    });
    throw new Error(
      `Application-state successor hydration repair child never paused at ${options.boundary}.`,
    );
  } finally {
    await db.close();
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
