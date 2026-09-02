/* eslint-disable jsdoc/require-jsdoc, no-process-exit */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadPreparedDurableExecution } from '../../src/cli/app/load-durable-execution.js';
import { createCoordinatorAuthority } from '../../src/core/lib/db/tables/coordinator-authority.js';
import { createCoordinatorQuiescenceBarrier } from '../../src/core/lib/db/tables/coordinator-quiescence-barrier.js';
import { createExecutionLedger } from '../../src/core/lib/db/tables/execution-ledger.js';
import {
  LEDGER_SERVICE_OWNERSHIP_SCHEMA_VERSION,
  LedgerServiceOwnerKind,
  createLedgerServiceId,
  createLedgerServiceSessionId,
} from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { createDynamoDBCoordinatorAuthorityProtocol } from '../../src/core/lib/db/tables/dynamodb-coordinator-authority.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { createReplicatedExecutionPayloadStore } from '../../src/core/lib/payload-store/replicated.js';
import { resolveManifestActivityExecutionIdentity } from '../../src/core/runtime/app-runs.js';
import { prepareApplicationStateReadiness } from '../../src/core/runtime/application-state-readiness.js';
import {
  publishApplicationStateSnapshot,
  transportApplicationStateSnapshot,
} from '../../src/core/runtime/application-state-snapshot-lmdb.js';
import {
  recoverManualLedgerActivity,
  runManualLedgerActivity,
} from '../../src/core/runtime/manual-ledger-run.js';
import {
  withExecutionLedgerResidentCoordinatorAuthority,
  withReconstructedExecutionLedgerResidentAuthority,
} from '../../src/core/runtime/operator/execution-ledger-store.js';
import { createResidentReplacementInputReceipt } from '../../src/core/runtime/resident-replacement-input.js';
import { reconstructResidentExecutionHistory } from '../../src/core/runtime/services/resident-execution-reconstruction.js';
import { runResidentActivityWorker } from '../../src/core/runtime/services/resident-activity-worker.js';
import { createFilesystemApplicationStateSnapshotDistribution } from '../helpers/application-state-snapshot-filesystem-distribution.js';
import { createFilesystemExecutionPayloadDistribution } from '../helpers/execution-payload-filesystem-distribution.js';
import { createPersistentDynamoDBAuthorityTestClient } from '../helpers/persistent-dynamodb-authority-test-client.js';

const MODES = new Set(['predecessor', 'successor']);
const SCENARIOS = new Set(['authored-running', 'final-terminal-loss']);

/** @typedef {Record<string, any>} ChildOptions */
/** @typedef {Awaited<ReturnType<typeof loadPreparedDurableExecution>>} LoadedExecution */
/** @typedef {ReturnType<typeof createRuntime>} CrashRuntime */
/** @typedef {{firstRenewal: Promise<void>, dependencies: NonNullable<Parameters<typeof withExecutionLedgerResidentCoordinatorAuthority>[1]>}} AuthorityDependencies */

/** @returns {ChildOptions} */
function parseOptions() {
  const value = JSON.parse(process.argv[2] || 'null');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Reconstructed resident crash child requires options.');
  }
  if (!MODES.has(value.mode) || !SCENARIOS.has(value.scenario)) {
    throw new TypeError(
      'Reconstructed resident crash mode or scenario is invalid.',
    );
  }
  for (const key of [
    'appDir',
    'appId',
    'revisionId',
    'runId',
    'markerPath',
    'marker',
    'controlPath',
    'tableName',
    'localPayloadPath',
    'payloadDistributionRoot',
    'sessionPath',
    'region',
    'tableResourceId',
    'snapshotDistributionRoot',
    'snapshotDistributionId',
    'snapshotTransferId',
  ]) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new TypeError(`Reconstructed resident crash ${key} is invalid.`);
    }
  }
  if (
    !Number.isSafeInteger(value.renewalIntervalMs) ||
    value.renewalIntervalMs < 1 ||
    !Number.isSafeInteger(value.observationWindowMs) ||
    value.observationWindowMs < 1
  ) {
    throw new TypeError('Reconstructed resident crash timing is invalid.');
  }
  if (
    !value.payloadDistributionIdentity ||
    !value.applicationStateConfiguration ||
    !value.input ||
    !value.actor ||
    !value.callerMetadata
  ) {
    throw new TypeError(
      'Reconstructed resident crash durable inputs are incomplete.',
    );
  }
  if (
    value.mode === 'successor' &&
    (!value.replacementInput || !value.replacementApplicationStateConfiguration)
  ) {
    throw new TypeError(
      'Reconstructed resident successor inputs are incomplete.',
    );
  }
  return /** @type {ChildOptions} */ (value);
}

/** @param {Record<string, any>} message */
async function send(message) {
  if (typeof process.send !== 'function') {
    throw new Error('Reconstructed resident crash child requires Node IPC.');
  }
  const ipcSend = process.send.bind(process);
  await new Promise((resolve, reject) => {
    ipcSend(message, undefined, undefined, (error) => {
      if (error) reject(error);
      else resolve(undefined);
    });
  });
}

/** @type {Set<string>} */
const receivedCommands = new Set();
/** @type {Map<string, () => void>} */
const commandWaiters = new Map();
process.on('message', (message) => {
  const candidate = /** @type {{kind?: unknown, command?: unknown}} */ (
    message
  );
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    candidate.kind !== 'command' ||
    typeof candidate.command !== 'string'
  ) {
    return;
  }
  const waiter = commandWaiters.get(candidate.command);
  if (waiter) {
    commandWaiters.delete(candidate.command);
    waiter();
  } else {
    receivedCommands.add(candidate.command);
  }
});

/** @param {string} command */
async function waitForCommand(command) {
  if (receivedCommands.delete(command)) return;
  await new Promise((resolve) =>
    commandWaiters.set(command, () => resolve(undefined)),
  );
}

function waitForever() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}

/** @param {string} path */
function markerEntries(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean);
}

/** @param {AbortSignal} signal */
async function waitForAbort(signal) {
  if (signal.aborted) return;
  await new Promise((resolve) =>
    signal.addEventListener('abort', resolve, { once: true }),
  );
}

/** @param {unknown} error @param {string} code */
function hasErrorCode(error, code) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code
  );
}

/**
 * @param {Parameters<typeof createDynamoDBCoordinatorAuthorityProtocol>[0]} input
 * @param {() => void} onFirstRenewal
 * @param {boolean} pauseAfterFirstRenewal
 */
function createObservedProtocol(input, onFirstRenewal, pauseAfterFirstRenewal) {
  const protocol = createDynamoDBCoordinatorAuthorityProtocol(input);
  let renewalReported = false;
  return Object.freeze({
    get: protocol.get,
    /** @param {Parameters<typeof protocol.acquire>[0]} intent */
    async acquire(intent) {
      try {
        const result = await protocol.acquire(intent);
        await send({ kind: 'authority-acquired', authority: result.authority });
        return result;
      } catch (error) {
        if (hasErrorCode(error, 'WHARFIE_COORDINATOR_AUTHORITY_CONFLICT')) {
          await send({ kind: 'authority-acquire-conflict' });
        }
        throw error;
      }
    },
    /** @param {Parameters<typeof protocol.renew>[0]} intent */
    async renew(intent) {
      const result = await protocol.renew(intent);
      if (!renewalReported) {
        renewalReported = true;
        await send({
          kind: 'authority-renewed',
          predecessor: intent.observedAuthority,
          authority: result.authority,
        });
      }
      onFirstRenewal();
      if (pauseAfterFirstRenewal) {
        // The mutation and IPC readback are complete, so the provider lock is
        // released. Keep the predecessor's renewal loop parked here to make
        // the later SIGKILL incapable of stranding a second provider lock.
        await new Promise(() => {});
      }
      return result;
    },
    /** @param {Parameters<typeof protocol.release>[0]} intent */
    async release(intent) {
      const result = await protocol.release(intent);
      await send({
        kind: 'authority-released',
        predecessor: intent.authority,
        authority: result.authority,
      });
      return result;
    },
    /** @param {Parameters<typeof protocol.observeReplacement>[0]} intent */
    async observeReplacement(intent) {
      const result = await protocol.observeReplacement(intent);
      if (result.outcome !== 'stable') {
        await send({ kind: 'authority-observation', outcome: result.outcome });
        return result;
      }
      await send({
        kind: 'authority-observation-stable',
        observation: result.observation,
      });
      return Object.freeze({
        ...result,
        /** @param {{coordinatorId: string, requestId: string, observedAt: number}} takeoverIntent */
        async takeover(takeoverIntent) {
          const takeover = await result.takeover(takeoverIntent);
          await send({
            kind: 'authority-taken-over',
            observation: takeover.observation,
            authority: takeover.authority,
          });
          return takeover;
        },
      });
    },
  });
}

/** @param {ChildOptions} options */
function createOwner(options) {
  const serviceId = createLedgerServiceId({ appId: options.appId });
  const sessionId = createLedgerServiceSessionId();
  const sessionRoot = join(options.sessionPath, sessionId);
  return Object.freeze({
    serviceId,
    sessionId,
    commandSession: Object.freeze({
      serviceId,
      sessionId,
      sessionRoot,
      endpoint: join(sessionRoot, 'live.sock'),
      ownerCommandEndpoint: join(sessionRoot, 'command.sock'),
    }),
    ownership: Object.freeze({
      schemaVersion: LEDGER_SERVICE_OWNERSHIP_SCHEMA_VERSION,
      serviceId,
      appId: options.appId,
      scopeId: 'reconstructed-resident-crash-scope',
      principalId: 'reconstructed-resident-crash-principal',
      sessionId,
      ownerKind: LedgerServiceOwnerKind.RESIDENT,
      generation: 1,
      claimedAt: Date.now(),
      updatedAt: Date.now(),
    }),
  });
}

/** @returns {Pick<Parameters<typeof runResidentActivityWorker>[0], 'createCommandServer'|'runScheduleObserver'>} */
function workerPorts() {
  /** @type {NonNullable<Parameters<typeof runResidentActivityWorker>[0]['createCommandServer']>} */
  const createCommandServer = async ({ session }) => {
    const commandSession =
      /** @type {ReturnType<typeof createOwner>['commandSession']} */ (session);
    return Object.freeze({
      endpoint: commandSession.ownerCommandEndpoint,
      session: commandSession,
      close: async () => undefined,
    });
  };
  /** @type {NonNullable<Parameters<typeof runResidentActivityWorker>[0]['runScheduleObserver']>} */
  const runScheduleObserver = async (workerOptions) => {
    await workerOptions.onReady?.();
    await waitForAbort(workerOptions.signal);
    return Object.freeze({
      observations: 0,
      admitted: 0,
      replayed: 0,
      advanced: 0,
    });
  };
  return { createCommandServer, runScheduleObserver };
}

/** @param {ChildOptions} options */
function createRuntime(options) {
  const db = createPersistentDynamoDBAuthorityTestClient({
    path: options.controlPath,
  });
  const distribution = createFilesystemExecutionPayloadDistribution({
    identity: options.payloadDistributionIdentity,
    root: options.payloadDistributionRoot,
  });
  const payloadStore = createReplicatedExecutionPayloadStore({
    localStore: createLocalExecutionPayloadStore({
      path: options.localPayloadPath,
      storeId: distribution.identity.storeId,
    }),
    distribution,
  });
  const ledger = createExecutionLedger({
    db,
    tableName: options.tableName,
    payloadStore,
  });
  const controlContext = Object.freeze({
    db,
    adapterName: /** @type {const} */ ('dynamodb'),
    controlPath: options.controlPath,
    tableName: options.tableName,
    readOnly: false,
    payloadStore,
  });
  const configuration = Object.freeze({
    adapterName: /** @type {const} */ ('dynamodb'),
    controlPath: options.controlPath,
    tableName: options.tableName,
    payloadPath: options.localPayloadPath,
    payloadStoreId: distribution.identity.storeId,
    sessionPath: options.sessionPath,
    region: options.region,
    residentCoordinatorAuthority: Object.freeze({
      profile: /** @type {const} */ ('dynamodb-rvn-v1'),
      adapterName: /** @type {const} */ ('dynamodb'),
      region: options.region,
      tableName: options.tableName,
      tableResourceId: options.tableResourceId,
      renewalIntervalMs: options.renewalIntervalMs,
      observationWindowMs: options.observationWindowMs,
    }),
  });
  return { db, ledger, payloadStore, controlContext, configuration };
}

/** @param {ChildOptions} options @param {LoadedExecution} loaded @param {CrashRuntime} runtime @param {AuthorityDependencies} authorityDependencies */
async function runPredecessor(options, loaded, runtime, authorityDependencies) {
  await withExecutionLedgerResidentCoordinatorAuthority(
    {
      appId: options.appId,
      coordinatorId: 'integrated-predecessor',
      ledger: runtime.ledger,
      context: runtime.controlContext,
      configuration: runtime.configuration,
      handler: async (ledger, session) => {
        const readiness = await prepareApplicationStateReadiness({
          ledger,
          appId: options.appId,
          controlContext: runtime.controlContext,
          configuration: options.applicationStateConfiguration,
          signal: session.signal,
        });
        await send({
          kind: 'application-state-prepared',
          readiness,
          authority: session.authority,
          coordinatorAuthority: session.coordinatorAuthority,
        });
        await authorityDependencies.firstRenewal;

        let reached = false;
        /** @param {string} boundary @param {Record<string, any>} detail */
        const reach = async (boundary, detail) => {
          if (reached) return;
          reached = true;
          const admission = createCoordinatorQuiescenceBarrier({
            db: runtime.db,
            tableName: options.tableName,
          });
          const predecessor = await admission.get({ appId: options.appId });
          const closedBarrier = (
            await admission.close({
              authority: session.coordinatorAuthority,
              requestId: `integrated-crash-close:${boundary}`,
              predecessor,
            })
          ).barrier;
          const storeId = readiness.store_id;
          const destination = Object.freeze({
            kind: 'application-state',
            version: 2,
            bindingId: 'primary',
            configuration: Object.freeze({
              provider: 'lmdb',
              storeId,
              tableName: options.applicationStateConfiguration.tableName,
              namespace: options.appId,
            }),
          });
          const snapshotDistribution =
            createFilesystemApplicationStateSnapshotDistribution({
              identity: {
                kind: 'wharfie.application-state-snapshot-distribution.v1',
                distributionId: options.snapshotDistributionId,
                storeId,
              },
              root: options.snapshotDistributionRoot,
            });
          const applicationStateTransport =
            await publishApplicationStateSnapshot({
              ledger,
              appId: options.appId,
              configuration: options.applicationStateConfiguration,
              controlContext: runtime.controlContext,
              destination,
              closedBarrier,
              coordinatorAuthority: session.coordinatorAuthority,
              transferId: options.snapshotTransferId,
              distribution: snapshotDistribution,
              signal: session.signal,
            });
          const replacementInput = createResidentReplacementInputReceipt({
            appId: options.appId,
            currentRevisionId: options.revisionId,
            control: {
              profile: 'dynamodb-rvn-v1',
              adapterName: 'dynamodb',
              region: options.region,
              tableName: options.tableName,
              tableResourceId: options.tableResourceId,
            },
            payloadStorage: {
              ...runtime.payloadStore.storage,
              distribution: runtime.payloadStore.distribution,
            },
            applicationStateDestination: destination,
            applicationStateTransport,
          });
          await send({
            kind: 'crash-boundary',
            boundary,
            detail,
            authority: session.authority,
            coordinatorAuthority: session.coordinatorAuthority,
            readiness,
            closedBarrier,
            applicationStateTransport,
            replacementInput,
          });
          waitForever();
        };
        let markerPoll;
        let markerPollInFlight = false;
        if (options.scenario === 'authored-running') {
          markerPoll = setInterval(() => {
            if (
              reached ||
              markerPollInFlight ||
              !markerEntries(options.markerPath).includes(options.marker)
            ) {
              return;
            }
            markerPollInFlight = true;
            Promise.resolve()
              .then(async () => {
                const view = await ledger.rebuildRun(options.runId);
                const attempt = view?.attempts.find(
                  (/** @type {Record<string, any>} */ candidate) =>
                    candidate.status === 'STARTED',
                );
                if (!view || !attempt) return;
                await reach('authored-running', {
                  run: view.run,
                  invocation: view.invocations[0],
                  attempt,
                });
              })
              .catch(async (error) => {
                await send({
                  kind: 'fatal',
                  error: error instanceof Error ? error.stack : String(error),
                });
                process.exit(1);
              })
              .finally(() => {
                markerPollInFlight = false;
              });
          }, 10);
        }
        const controlledLedger = {
          ...ledger,
          async commitVerifiedAttemptTerminal(
            /** @type {Parameters<typeof ledger.commitVerifiedAttemptTerminal>[0]} */ input,
          ) {
            const result = await ledger.commitVerifiedAttemptTerminal(input);
            if (
              options.scenario === 'final-terminal-loss' &&
              input.runId === options.runId
            ) {
              await reach('final-terminal-loss', result);
            }
            return result;
          },
        };
        try {
          await runResidentActivityWorker({
            ledger: controlledLedger,
            execution: loaded.execution,
            controlContext: runtime.controlContext,
            owner: createOwner(options),
            signal: session.signal,
            pollIntervalMs: 5,
            drainTimeoutMs: 1_000,
            applicationStateConfiguration:
              options.applicationStateConfiguration,
            ...workerPorts(),
          });
        } finally {
          if (markerPoll) clearInterval(markerPoll);
        }
        throw new Error('Predecessor settled before its crash boundary.');
      },
    },
    authorityDependencies.dependencies,
  );
}

/** @param {ChildOptions} options @param {LoadedExecution} loaded @param {CrashRuntime} runtime @param {AuthorityDependencies} authorityDependencies */
async function runSuccessor(options, loaded, runtime, authorityDependencies) {
  const snapshotDistribution =
    createFilesystemApplicationStateSnapshotDistribution({
      identity: options.replacementInput.applicationStateTransport.distribution,
      root: options.snapshotDistributionRoot,
    });
  /** @type {Awaited<ReturnType<typeof reconstructResidentExecutionHistory>> | undefined} */
  let reconstruction;
  /** @param {string} phase @param {unknown} coordinatorAuthority */
  const readBarrierPhase = async (phase, coordinatorAuthority) => {
    const barrier = await createCoordinatorQuiescenceBarrier({
      db: runtime.db,
      tableName: options.tableName,
    }).get({ appId: options.appId });
    await send({
      kind: 'barrier-phase',
      phase,
      barrier,
      coordinatorAuthority,
    });
    return barrier;
  };
  const result = await withReconstructedExecutionLedgerResidentAuthority(
    {
      appId: options.appId,
      currentRevisionId: options.revisionId,
      coordinatorId: 'integrated-successor',
      ledger: runtime.ledger,
      context: runtime.controlContext,
      configuration: runtime.configuration,
      replacementInput: options.replacementInput,
      transportApplicationState: async (_ledger, session) => {
        await readBarrierPhase(
          'application-state-transport-before',
          session.coordinatorAuthority,
        );
        const transported = await transportApplicationStateSnapshot({
          configuration: options.replacementApplicationStateConfiguration,
          controlContext: runtime.controlContext,
          transport: session.replacementInput.applicationStateTransport,
          history: session.applicationStateHistory,
          closedBarrier: session.closedBarrier,
          coordinatorAuthority: session.coordinatorAuthority,
          distribution: snapshotDistribution,
          signal: session.signal,
        });
        await readBarrierPhase(
          'application-state-transport-after',
          session.coordinatorAuthority,
        );
        return transported;
      },
      prepareApplicationState: async (ledger, session) => {
        await readBarrierPhase(
          'application-state-readiness-before',
          session.coordinatorAuthority,
        );
        const prepared = await prepareApplicationStateReadiness({
          ledger,
          appId: options.appId,
          controlContext: runtime.controlContext,
          configuration: options.replacementApplicationStateConfiguration,
          signal: session.signal,
        });
        await readBarrierPhase(
          'application-state-readiness-after',
          session.coordinatorAuthority,
        );
        return prepared;
      },
      handler: async (ledger, session) => {
        await authorityDependencies.firstRenewal;
        const barrier = await createCoordinatorQuiescenceBarrier({
          db: runtime.db,
          tableName: options.tableName,
        }).get({ appId: options.appId });
        const authority = await createCoordinatorAuthority({
          db: runtime.db,
          tableName: options.tableName,
        }).get({ appId: options.appId });
        await send({
          kind: 'resident-ready',
          barrier,
          authority,
          coordinatorAuthority: session.coordinatorAuthority,
          closedBarrier: session.closedBarrier,
          reconstruction,
          applicationStateTransport: session.applicationStateTransport,
          applicationState: session.applicationState,
        });
        await waitForCommand('continue-after-stale-proof');

        let dispatchCalls = 0;
        let recoveryCalls = 0;
        let replay;
        if (options.scenario === 'final-terminal-loss') {
          replay = await runManualLedgerActivity({
            ledger,
            runId: options.runId,
            appId: options.appId,
            revisionId: options.revisionId,
            activityId: 'crash-task',
            input: options.input,
            callerMetadata: options.callerMetadata,
            actor: options.actor,
            createFencingToken: () => {
              dispatchCalls += 1;
              throw new Error('Terminal replay minted a new fencing token.');
            },
            executeAttempt: async () => {
              dispatchCalls += 1;
              throw new Error('Terminal replay re-entered authored code.');
            },
          });
        }

        const stop = new AbortController();
        const signal = AbortSignal.any([session.signal, stop.signal]);
        const worker = await runResidentActivityWorker({
          ledger,
          execution: loaded.execution,
          controlContext: runtime.controlContext,
          owner: createOwner(options),
          signal,
          pollIntervalMs: 5,
          drainTimeoutMs: 1_000,
          applicationStateConfiguration:
            options.replacementApplicationStateConfiguration,
          runActivity: async () => {
            dispatchCalls += 1;
            throw new Error('Successor redispatched retained authored work.');
          },
          recoverActivity: async (input) => {
            recoveryCalls += 1;
            const recovered = await recoverManualLedgerActivity(input);
            await send({ kind: 'worker-recovery', recovered });
            stop.abort(new Error('Recovery-only proof completed.'));
            return recovered;
          },
          onReady: async () => {
            if (options.scenario === 'final-terminal-loss') {
              setTimeout(
                () => stop.abort(new Error('Terminal idle proof completed.')),
                75,
              );
            }
          },
          ...workerPorts(),
        });
        return { worker, replay, dispatchCalls, recoveryCalls };
      },
    },
    {
      ...authorityDependencies.dependencies,
      /** @param {Parameters<typeof createCoordinatorQuiescenceBarrier>[0]} input */
      createAdmissionBarrier: (input) => {
        const barrier = createCoordinatorQuiescenceBarrier(input);
        return Object.freeze({
          get: barrier.get,
          prepareFreshAdmission: barrier.prepareFreshAdmission,
          close: barrier.close,
          /** @param {Parameters<typeof barrier.adopt>[0]} intent */
          async adopt(intent) {
            const adopted = await barrier.adopt(intent);
            await send({
              kind: 'barrier-phase',
              phase: 'adopted',
              barrier: adopted.barrier,
              coordinatorAuthority: intent.authority,
            });
            return adopted;
          },
          /** @param {Parameters<typeof barrier.reopen>[0]} intent */
          async reopen(intent) {
            const reopened = await barrier.reopen(intent);
            await send({
              kind: 'barrier-phase',
              phase: 'reopened',
              barrier: reopened.barrier,
              coordinatorAuthority: intent.authority,
            });
            return reopened;
          },
        });
      },
      reconstructHistory: async (input) => {
        await readBarrierPhase(
          'execution-reconstruction-before',
          input.coordinatorAuthority,
        );
        reconstruction = await reconstructResidentExecutionHistory(input);
        await readBarrierPhase(
          'execution-reconstruction-after',
          input.coordinatorAuthority,
        );
        await send({ kind: 'execution-reconstruction', reconstruction });
        return reconstruction;
      },
    },
  );
  await send({ kind: 'resident-settled', result });
}

async function main() {
  const options = parseOptions();
  const loaded = await loadPreparedDurableExecution({
    dir: options.appDir,
    activity: 'crash-task',
  });
  const identity = resolveManifestActivityExecutionIdentity(loaded.execution);
  if (
    identity.appId !== options.appId ||
    identity.revisionId !== options.revisionId
  ) {
    throw new Error('Crash child loaded a different authored revision.');
  }
  const runtime = createRuntime(options);
  /** @type {() => void} */
  let resolveFirstRenewal = () => {};
  const firstRenewal = new Promise((resolve) => {
    resolveFirstRenewal = () => resolve(undefined);
  });
  const authorityDependencies = {
    firstRenewal,
    dependencies: {
      validateTopology: async () =>
        Object.freeze({ tableResourceId: options.tableResourceId }),
      createProtocol: (
        /** @type {Parameters<typeof createDynamoDBCoordinatorAuthorityProtocol>[0]} */ input,
      ) =>
        createObservedProtocol(
          input,
          resolveFirstRenewal,
          options.mode === 'predecessor',
        ),
    },
  };
  try {
    if (options.mode === 'predecessor') {
      await runPredecessor(options, loaded, runtime, authorityDependencies);
    } else {
      await runSuccessor(options, loaded, runtime, authorityDependencies);
    }
  } finally {
    await runtime.db.close();
    await loaded.cleanup?.();
  }
}

main()
  .catch(async (error) => {
    await send({
      kind: 'fatal',
      name: error instanceof Error ? error.name : 'UnknownError',
      code:
        error && typeof error === 'object' && 'code' in error
          ? error.code
          : undefined,
      error: error instanceof Error ? error.stack : String(error),
    }).catch(() => undefined);
    process.exitCode = 1;
  })
  .finally(() => {
    if (process.connected) process.disconnect();
  });
