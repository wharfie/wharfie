/* eslint-disable jsdoc/require-jsdoc */

import { createApplicationStateCoordinatorAuthorityRecord } from '../../src/core/lib/db/tables/application-state-authority.js';
import { createApplicationStateReadinessStore } from '../../src/core/lib/db/tables/application-state-readiness.js';
import { createCoordinatorAuthority } from '../../src/core/lib/db/tables/coordinator-authority.js';
import { createCoordinatorQuiescenceBarrier } from '../../src/core/lib/db/tables/coordinator-quiescence-barrier.js';
import { createDynamoDBCoordinatorAuthorityProtocol } from '../../src/core/lib/db/tables/dynamodb-coordinator-authority.js';
import { createExecutionLedger } from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { createReplicatedExecutionPayloadStore } from '../../src/core/lib/payload-store/replicated.js';
import { createApplicationStateTransportReadiness } from '../../src/core/runtime/application-state-snapshot.js';
import { withReconstructedExecutionLedgerResidentAuthority } from '../../src/core/runtime/operator/execution-ledger-store.js';
import { validateResidentReplacementInputReceipt } from '../../src/core/runtime/resident-replacement-input.js';
import { reconstructResidentExecutionHistory } from '../../src/core/runtime/services/resident-execution-reconstruction.js';
import { createFilesystemExecutionPayloadDistribution } from '../helpers/execution-payload-filesystem-distribution.js';
import { createPersistentDynamoDBAuthorityTestClient } from '../helpers/persistent-dynamodb-authority-test-client.js';

const MODES = new Set(['predecessor', 'successor']);
const REQUIRED_OPTIONS = Object.freeze([
  'mode',
  'appId',
  'currentRevisionId',
  'coordinatorId',
  'controlPath',
  'tableName',
  'payloadPath',
  'payloadDistributionPath',
  'sessionPath',
  'region',
  'tableResourceId',
  'renewalIntervalMs',
  'observationWindowMs',
  'replacementInput',
]);

/** @typedef {'predecessor'|'successor'} ChildMode */
/** @typedef {{mode: ChildMode, appId: string, currentRevisionId: string, coordinatorId: string, controlPath: string, tableName: string, payloadPath: string, payloadDistributionPath: string, sessionPath: string, region: string, tableResourceId: string, renewalIntervalMs: number, observationWindowMs: number, replacementInput: Record<string, any>}} ChildOptions */

/** @returns {ChildOptions} */
function parseOptions() {
  const value = JSON.parse(process.argv[2] || 'null');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'Resident coordinator authority crash child requires options.',
    );
  }
  if (
    Object.keys(value).length !== REQUIRED_OPTIONS.length ||
    REQUIRED_OPTIONS.some((key) => !Object.hasOwn(value, key)) ||
    !MODES.has(value.mode)
  ) {
    throw new TypeError(
      'Resident coordinator authority crash child options are invalid.',
    );
  }
  for (const key of [
    'appId',
    'currentRevisionId',
    'coordinatorId',
    'controlPath',
    'tableName',
    'payloadPath',
    'payloadDistributionPath',
    'sessionPath',
    'region',
    'tableResourceId',
  ]) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new TypeError(
        `Resident coordinator authority crash child ${key} is invalid.`,
      );
    }
  }
  for (const key of ['renewalIntervalMs', 'observationWindowMs']) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 1) {
      throw new TypeError(
        `Resident coordinator authority crash child ${key} is invalid.`,
      );
    }
  }
  return /** @type {ChildOptions} */ (value);
}

/** @param {Record<string, any>} message */
async function send(message) {
  if (typeof process.send !== 'function') {
    throw new Error(
      'Resident coordinator authority crash child requires Node IPC.',
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

const receivedCommands = new Set();
const commandWaiters = new Map();

process.on('message', (message) => {
  const commandMessage = /** @type {{kind?: unknown, command?: unknown}} */ (
    message
  );
  if (
    !commandMessage ||
    typeof commandMessage !== 'object' ||
    commandMessage.kind !== 'command' ||
    typeof commandMessage.command !== 'string'
  ) {
    return;
  }
  const command = commandMessage.command;
  const waiter = commandWaiters.get(command);
  if (waiter) {
    commandWaiters.delete(command);
    waiter();
    return;
  }
  receivedCommands.add(command);
});

/** @param {string} command */
async function waitForCommand(command) {
  if (receivedCommands.delete(command)) return;
  await new Promise((resolve) => {
    commandWaiters.set(command, resolve);
  });
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
 * Retain the production protocol unchanged while exposing only exact protocol
 * results over IPC. These messages let the parent prove that the successor
 * observed one unchanged RVN for a full monotonic window rather than inferring
 * takeover from elapsed wall time.
 * @param {Parameters<typeof createDynamoDBCoordinatorAuthorityProtocol>[0]} input
 * @param {boolean} pauseAfterFirstRenewal
 */
function createObservedProtocol(input, pauseAfterFirstRenewal) {
  const protocol = createDynamoDBCoordinatorAuthorityProtocol(input);
  let firstSuccessfulRenewal = true;
  return Object.freeze({
    get: protocol.get,
    /** @param {Parameters<typeof protocol.acquire>[0]} intent */
    async acquire(intent) {
      try {
        const result = await protocol.acquire(intent);
        await send({
          kind: 'authority-acquired',
          intent,
          authority: result.authority,
        });
        return result;
      } catch (error) {
        if (hasErrorCode(error, 'WHARFIE_COORDINATOR_AUTHORITY_CONFLICT')) {
          await send({ kind: 'authority-acquire-conflict', intent });
        }
        throw error;
      }
    },
    /** @param {Parameters<typeof protocol.renew>[0]} intent */
    async renew(intent) {
      const result = await protocol.renew(intent);
      await send({
        kind: 'authority-renewed',
        predecessor: intent.observedAuthority,
        authority: result.authority,
      });
      if (pauseAfterFirstRenewal && firstSuccessfulRenewal) {
        firstSuccessfulRenewal = false;
        // protocol.renew() has durably closed its DB operation and send() has
        // completed its IPC callback. Keep the serial supervisor loop parked
        // here so SIGKILL cannot strand the adapter's next directory lock.
        await waitForCommand('return-first-renewal');
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
        await send({
          kind: 'authority-observation-changed',
          outcome: result.outcome,
          ...(result.outcome === 'changed' ? { reason: result.reason } : {}),
        });
        return result;
      }
      await send({
        kind: 'authority-observation-stable',
        observation: result.observation,
      });
      return Object.freeze({
        ...result,
        /** @param {{coordinatorId: string, requestId: string, observedAt: number}} takeoverIntent */
        takeover: async (takeoverIntent) => {
          const takeover = await result.takeover(takeoverIntent);
          await send({
            kind: 'authority-taken-over',
            intent: takeoverIntent,
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
async function run(options) {
  const db = createPersistentDynamoDBAuthorityTestClient({
    path: options.controlPath,
  });
  const receipt = validateResidentReplacementInputReceipt(
    options.replacementInput,
  );
  const localPayloads = createLocalExecutionPayloadStore({
    path: options.payloadPath,
    storeId: receipt.payloadStorage.storeId,
  });
  const distribution = createFilesystemExecutionPayloadDistribution({
    identity: receipt.payloadStorage.distribution,
    root: options.payloadDistributionPath,
  });
  const payloadStore = createReplicatedExecutionPayloadStore({
    localStore: localPayloads,
    distribution,
  });
  const ledger = createExecutionLedger({
    db,
    tableName: options.tableName,
    payloadStore,
  });
  const authorities = createCoordinatorAuthority({
    db,
    tableName: options.tableName,
  });
  const barriers = createCoordinatorQuiescenceBarrier({
    db,
    tableName: options.tableName,
  });
  const configuration = Object.freeze({
    adapterName: /** @type {const} */ ('dynamodb'),
    controlPath: options.controlPath,
    tableName: options.tableName,
    payloadPath: options.payloadPath,
    payloadStoreId: receipt.payloadStorage.storeId,
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
  const history = receipt.applicationStateTransport.snapshot.checkpoint.history;

  try {
    const result = await withReconstructedExecutionLedgerResidentAuthority(
      {
        appId: options.appId,
        currentRevisionId: options.currentRevisionId,
        coordinatorId: options.coordinatorId,
        ledger,
        context: {
          db,
          adapterName: 'dynamodb',
          tableName: options.tableName,
          readOnly: false,
          payloadStore,
        },
        configuration,
        replacementInput: receipt,
        transportApplicationState: async (_boundLedger, session) => {
          const barrier = await barriers.get({ appId: options.appId });
          await send({
            kind: 'application-state-transport',
            barrier,
            coordinatorAuthority: session.coordinatorAuthority,
          });
          return createApplicationStateTransportReadiness({
            status: 'RETAINED',
            destination: receipt.applicationStateDestination,
            transport: receipt.applicationStateTransport,
            coordinatorAuthority: session.coordinatorAuthority,
          });
        },
        prepareApplicationState: async (_boundLedger, session) => {
          const readiness = createApplicationStateReadinessStore({
            db,
            tableName: options.tableName,
            coordinatorAuthority: session.coordinatorAuthority,
          });
          const preparation = await readiness.prepare({
            destination: receipt.applicationStateDestination,
          });
          const destinationAuthority =
            createApplicationStateCoordinatorAuthorityRecord({
              storeId:
                receipt.applicationStateDestination.configuration.storeId,
              namespace: options.appId,
              authority: session.coordinatorAuthority,
            });
          const adopted = await readiness.markAdopted({
            preparation,
            destinationAuthority,
          });
          const barrier = await barriers.get({ appId: options.appId });
          await send({
            kind: 'application-state-prepared',
            barrier,
            readiness: adopted,
            coordinatorAuthority: session.coordinatorAuthority,
          });
          if (options.mode === 'successor') {
            await waitForCommand('continue-after-state-preparation');
          }
          return adopted;
        },
        handler: async (_boundLedger, session) => {
          const barrier = await barriers.get({ appId: options.appId });
          const authority = await authorities.get({ appId: options.appId });
          await send({
            kind: 'resident-ready',
            barrier,
            authority,
            coordinatorAuthority: session.coordinatorAuthority,
          });
          await waitForCommand('stop');
          return Object.freeze({ mode: options.mode, stopped: true });
        },
      },
      {
        validateTopology: async () =>
          Object.freeze({
            kind: 'test-dynamodb-coordinator-authority-topology',
            tableName: options.tableName,
            region: options.region,
            tableResourceId: options.tableResourceId,
          }),
        createProtocol: (input) =>
          createObservedProtocol(input, options.mode === 'predecessor'),
        reconstructHistory: async (input) => {
          const barrier = await barriers.get({ appId: options.appId });
          const authority = await authorities.get({ appId: options.appId });
          await send({
            kind: 'execution-reconstruction',
            barrier,
            authority,
            coordinatorAuthority: input.coordinatorAuthority,
          });
          if (options.mode === 'predecessor') {
            await waitForCommand('crash-boundary');
          } else {
            await waitForCommand('continue-reconstruction');
          }
          return await reconstructResidentExecutionHistory(input);
        },
        inventoryApplicationState: async (_input) => {
          const barrier = await barriers.get({ appId: options.appId });
          await send({ kind: 'application-state-inventory', barrier, history });
          return history;
        },
      },
    );
    await send({ kind: 'resident-settled', result });
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
      code:
        error && typeof error === 'object' && 'code' in error
          ? error.code
          : undefined,
      error:
        error instanceof Error ? error.stack || error.message : String(error),
    }).catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => {
    if (process.connected) process.disconnect();
  });
