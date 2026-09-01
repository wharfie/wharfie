/* eslint-disable jsdoc/require-jsdoc, no-process-exit */

import { existsSync, readFileSync } from 'node:fs';

import { loadPreparedDurableExecution } from '../../src/cli/app/load-durable-execution.js';
import { createLedgerServiceOwnership } from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { resolveManifestActivityExecutionIdentity } from '../../src/core/runtime/app-runs.js';
import { prepareApplicationStateReadiness } from '../../src/core/runtime/application-state-readiness.js';
import {
  withExecutionLedger,
  withExecutionLedgerCoordinatorAuthority,
} from '../../src/core/runtime/operator/execution-ledger-store.js';
import { runResidentActivityWorker } from '../../src/core/runtime/services/resident-activity-worker.js';
import { acquireLocalLedgerServiceSession } from '../../src/core/runtime/services/ledger-service.js';

export const ResidentAuthoredCrashBoundary = Object.freeze({
  AUTHORED_ENTERED: 'authored-entered',
  FINAL_TERMINAL_COMMITTED: 'final-terminal-committed',
});

const VALID_BOUNDARIES = new Set(Object.values(ResidentAuthoredCrashBoundary));

function parseOptions() {
  const options = JSON.parse(process.argv[2] || 'null');
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Resident authored crash child requires options.');
  }
  for (const key of [
    'boundary',
    'appDir',
    'runId',
    'markerPath',
    'marker',
    'configuration',
    'applicationStateConfiguration',
  ]) {
    if (!Object.prototype.hasOwnProperty.call(options, key)) {
      throw new TypeError(
        `Resident authored crash child options.${key} is required.`,
      );
    }
  }
  if (!VALID_BOUNDARIES.has(options.boundary)) {
    throw new TypeError(
      `Unsupported resident authored crash boundary: ${options.boundary}`,
    );
  }
  if (
    typeof options.appDir !== 'string' ||
    !options.appDir ||
    typeof options.runId !== 'string' ||
    !options.runId ||
    typeof options.markerPath !== 'string' ||
    !options.markerPath ||
    typeof options.marker !== 'string' ||
    !options.marker
  ) {
    throw new TypeError(
      'Resident authored crash child appDir, runId, markerPath, and marker are required strings.',
    );
  }
  return options;
}

/** @param {Record<string, any>} message */
async function send(message) {
  if (typeof process.send !== 'function') {
    throw new Error('Resident authored crash child requires Node IPC.');
  }
  const ipcSend = process.send.bind(process);
  await new Promise((resolve, reject) => {
    ipcSend(message, undefined, undefined, (error) => {
      if (error) reject(error);
      else resolve(undefined);
    });
  });
}

/** @returns {void} - Stops only when the parent kills this process. */
function waitForever() {
  const word = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(word, 0, 0);
}

/** @param {string} markerPath @returns {string[]} */
function markerEntries(markerPath) {
  if (!existsSync(markerPath)) return [];
  return readFileSync(markerPath, 'utf8').split('\n').filter(Boolean);
}

async function main() {
  const options = parseOptions();
  const loaded = await loadPreparedDurableExecution({ dir: options.appDir });
  const identity = resolveManifestActivityExecutionIdentity(loaded.execution);
  /** @type {Awaited<ReturnType<typeof acquireLocalLedgerServiceSession>> | undefined} */
  let localOwner;
  try {
    await withExecutionLedger(
      async (baseLedger, controlContext) => {
        localOwner = await acquireLocalLedgerServiceSession({
          appId: identity.appId,
          ownership: createLedgerServiceOwnership({
            db: controlContext.db,
            tableName: controlContext.tableName,
          }),
          ownerKind: 'resident',
          sessionRoot: controlContext.sessionPath,
        });
        const owner = localOwner;
        await withExecutionLedgerCoordinatorAuthority({
          appId: identity.appId,
          coordinatorId: owner.sessionId,
          ledger: baseLedger,
          context: controlContext,
          handler: async (ledger, coordinatorAuthority) => {
            const readiness = await prepareApplicationStateReadiness({
              ledger,
              appId: identity.appId,
              controlContext,
              configuration: options.applicationStateConfiguration,
            });
            let reached = false;
            /** @param {string} boundary @param {Record<string, any>} detail */
            const reach = async (boundary, detail) => {
              if (boundary !== options.boundary || reached) return;
              reached = true;
              await send({
                kind: 'boundary',
                boundary,
                detail,
                ownership: owner.ownership,
                coordinatorAuthority,
                applicationStateReadiness: readiness,
              });
              waitForever();
            };

            let markerPoll;
            if (
              options.boundary ===
              ResidentAuthoredCrashBoundary.AUTHORED_ENTERED
            ) {
              markerPoll = setInterval(() => {
                if (
                  reached ||
                  !markerEntries(options.markerPath).includes(options.marker)
                ) {
                  return;
                }
                Promise.resolve()
                  .then(async () => {
                    const view = await ledger.rebuildRun(options.runId);
                    const attempt = view?.attempts.find(
                      (/** @type {Record<string, any>} */ candidate) =>
                        candidate.status === 'STARTED',
                    );
                    if (!view || !attempt) {
                      throw new Error(
                        'Authored entry was visible without one durable STARTED attempt.',
                      );
                    }
                    await reach(
                      ResidentAuthoredCrashBoundary.AUTHORED_ENTERED,
                      {
                        runId: view.run.runId,
                        runVersion: view.run.version,
                        lastSequence: view.run.lastSequence,
                        invocationId: attempt.invocationId,
                        attemptId: attempt.attemptId,
                        attemptStatus: attempt.status,
                        generation: attempt.generation,
                        marker: options.marker,
                      },
                    );
                  })
                  .catch(async (error) => {
                    await send({
                      kind: 'fatal',
                      error:
                        error instanceof Error ? error.stack : String(error),
                    }).catch(() => undefined);
                    process.exit(1);
                  });
              }, 10);
              markerPoll.unref?.();
            }

            const controlledLedger = {
              ...ledger,
              async commitVerifiedAttemptTerminal(
                /** @type {Parameters<typeof ledger.commitVerifiedAttemptTerminal>[0]} */ input,
              ) {
                const result =
                  await ledger.commitVerifiedAttemptTerminal(input);
                if (input.runId === options.runId) {
                  await reach(
                    ResidentAuthoredCrashBoundary.FINAL_TERMINAL_COMMITTED,
                    {
                      runId: result.run.runId,
                      runVersion: result.run.version,
                      lastSequence: result.run.lastSequence,
                      runStatus: result.run.status,
                      invocationId: result.invocation.invocationId,
                      invocationStatus: result.invocation.status,
                      attemptId: result.attempt.attemptId,
                      attemptStatus: result.attempt.status,
                      generation: result.attempt.generation,
                      terminal: result.attempt.terminal,
                      evidenceRef: result.attempt.evidenceRef,
                      marker: options.marker,
                    },
                  );
                }
                return result;
              },
            };
            try {
              await runResidentActivityWorker({
                ledger: controlledLedger,
                execution: loaded.execution,
                controlContext,
                owner,
                pollIntervalMs: 10,
                applicationStateConfiguration:
                  options.applicationStateConfiguration,
              });
            } finally {
              if (markerPoll) clearInterval(markerPoll);
            }
            throw new Error(
              `Resident authored crash child completed without reaching ${options.boundary}.`,
            );
          },
        });
      },
      { configuration: options.configuration },
    );
  } finally {
    await localOwner?.release().catch(() => undefined);
    await loaded.cleanup?.();
  }
}

main().catch(async (error) => {
  await send({
    kind: 'fatal',
    error: error instanceof Error ? error.stack : String(error),
  }).catch(() => undefined);
  process.exit(1);
});
