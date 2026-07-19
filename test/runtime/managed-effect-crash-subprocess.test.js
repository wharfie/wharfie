/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import createLMDB from '../../src/core/lib/db/adapters/lmdb.js';
import {
  APPLICATION_STATE_TABLE_NAME,
  createApplicationStateDBClient,
  resolveExecutionPayloadStoreId,
} from '../../src/core/lib/config/db.js';
import {
  createApplicationStateBusinessKey,
  createApplicationStateTable,
} from '../../src/core/lib/db/tables/application-state.js';
import {
  AttemptStatus,
  EffectStatus,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import {
  createLedgerServiceId,
  createLedgerServiceOwnership,
} from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { createManagedEffectDestinationId } from '../../src/core/lib/ledger/execution-ledger-contract.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS } from '../../src/core/runtime/effects/application-state.js';
import { getLocalServiceSessionEndpoint } from '../../src/core/runtime/local-service-session.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
} from '../../src/core/runtime/manual-ledger-run.js';
import { recoverExecutionLedgerRun } from '../../src/core/runtime/operator/execution-ledger-operator.js';

const CHILD_PATH = fileURLToPath(
  new URL('../fixtures/managed-effect-crash-child.js', import.meta.url),
);
const APP_ID = 'managed-effect-crash-matrix';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const ACTIVITY_ID = 'crash-effect';
const EFFECT_ID = 'remember-crash';
const BUSINESS_KEY = 'crash-matrix-key';
const TABLE_NAME = 'managed-effect-crash-matrix';

/**
 * @typedef {Readonly<{adapterName: 'lmdb', controlPath: string, tableName: string, payloadPath: string, payloadStoreId: string, sessionPath: string}>} ControlConfiguration
 * @typedef {Readonly<{adapterName: 'lmdb', storePath: string, tableName: 'wharfie-application-state-v2'}>} ApplicationStateConfiguration
 * @typedef {Readonly<{root: string, boundary: string, runId: string, configuration: ControlConfiguration, applicationStateConfiguration: ApplicationStateConfiguration, adapterMarkerPath: string}>} CrashFixture
 * @typedef {{code: number | null, signal: NodeJS.Signals | null}} ChildExit
 */

const Boundary = Object.freeze({
  REQUEST_PAYLOAD: 'request-payload-published',
  REQUEST_COMMIT: 'request-transaction-committed',
  START_COMMIT: 'start-transaction-committed',
  DESTINATION_COMMIT: 'destination-transaction-committed',
  OUTCOME_PAYLOAD: 'outcome-payload-published',
  OUTCOME_COMMIT: 'outcome-ledger-committed',
  HOST_EFFECT_RESPONSE: 'effect-response-returned',
});

const CASES = Object.freeze([
  {
    boundary: Boundary.REQUEST_PAYLOAD,
    label: 'durable request payload publication',
    beforeEffect: null,
    afterEffect: null,
    recoveryAction: 'marked-started-uncertain',
    managedAction: null,
    adapterEntries: 0,
    hasDestinationState: false,
    eventEffects: [],
  },
  {
    boundary: Boundary.REQUEST_COMMIT,
    label: 'durable effect-request transaction',
    beforeEffect: EffectStatus.PENDING,
    afterEffect: EffectStatus.CANCELLED,
    recoveryAction: 'settled-managed-effect-set',
    managedAction: 'cancelled-before-start',
    adapterEntries: 0,
    hasDestinationState: false,
    eventEffects: [{ effectId: EFFECT_ID, status: EffectStatus.CANCELLED }],
  },
  {
    boundary: Boundary.START_COMMIT,
    label: 'durable effect-start transaction',
    beforeEffect: EffectStatus.STARTED,
    afterEffect: EffectStatus.UNCERTAIN,
    recoveryAction: 'settled-managed-effect-set',
    managedAction: 'outcome-uncertain',
    adapterEntries: 0,
    hasDestinationState: false,
    eventEffects: [{ effectId: EFFECT_ID, status: EffectStatus.UNCERTAIN }],
  },
  {
    boundary: Boundary.DESTINATION_COMMIT,
    label: 'destination business and receipt transaction',
    beforeEffect: EffectStatus.STARTED,
    afterEffect: EffectStatus.COMPLETED,
    recoveryAction: 'settled-managed-effect-set',
    managedAction: 'outcome-recovered',
    adapterEntries: 1,
    hasDestinationState: true,
    eventEffects: [{ effectId: EFFECT_ID, status: EffectStatus.COMPLETED }],
  },
  {
    boundary: Boundary.OUTCOME_PAYLOAD,
    label: 'durable outcome payload publication',
    beforeEffect: EffectStatus.STARTED,
    afterEffect: EffectStatus.COMPLETED,
    recoveryAction: 'settled-managed-effect-set',
    managedAction: 'outcome-recovered',
    adapterEntries: 1,
    hasDestinationState: true,
    eventEffects: [{ effectId: EFFECT_ID, status: EffectStatus.COMPLETED }],
  },
  {
    boundary: Boundary.OUTCOME_COMMIT,
    label: 'durable outcome ledger transaction',
    beforeEffect: EffectStatus.COMPLETED,
    afterEffect: EffectStatus.COMPLETED,
    recoveryAction: 'marked-started-uncertain',
    managedAction: null,
    adapterEntries: 1,
    hasDestinationState: true,
    eventEffects: [],
  },
  {
    boundary: Boundary.HOST_EFFECT_RESPONSE,
    label: 'helper/host response return before worker or user continuation',
    beforeEffect: EffectStatus.COMPLETED,
    afterEffect: EffectStatus.COMPLETED,
    recoveryAction: 'marked-started-uncertain',
    managedAction: null,
    adapterEntries: 1,
    hasDestinationState: true,
    eventEffects: [],
  },
]);

const CHILD_BOUNDARY_TIMEOUT_MS = 20_000;
const CHILD_EXIT_TIMEOUT_MS = 5_000;

/** @param {string} root @param {string} boundary @returns {CrashFixture} */
function createFixture(root, boundary) {
  const controlPath = path.join(root, 'control');
  const payloadPath = path.join(root, 'execution-payloads');
  const configuration = Object.freeze({
    adapterName: /** @type {const} */ ('lmdb'),
    controlPath,
    tableName: TABLE_NAME,
    payloadPath,
    payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
    sessionPath: path.join(root, 'ledger-service-sessions'),
  });
  const applicationStateConfiguration = Object.freeze({
    adapterName: /** @type {const} */ ('lmdb'),
    storePath: path.join(root, 'application-state'),
    tableName: APPLICATION_STATE_TABLE_NAME,
  });
  return Object.freeze({
    root,
    boundary,
    runId: createManualLedgerRunId({
      appId: APP_ID,
      idempotencyKey: `crash-${boundary}`,
    }),
    configuration,
    applicationStateConfiguration,
    adapterMarkerPath: path.join(root, 'adapter-entry.log'),
  });
}

/**
 * @param {ControlConfiguration} configuration
 * @param {boolean} [readOnly]
 */
function createLedger(configuration, readOnly = true) {
  const db = createLMDB({
    path: configuration.controlPath,
    ...(readOnly ? { readOnly: true } : {}),
  });
  return {
    db,
    ledger: createExecutionLedger({
      db,
      tableName: configuration.tableName,
      payloadStore: createLocalExecutionPayloadStore({
        path: configuration.payloadPath,
        storeId: configuration.payloadStoreId,
      }),
      effectEvidenceVerifiers: [...APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS],
    }),
  };
}

/** @param {CrashFixture} fixture */
async function readRun(fixture) {
  const { db, ledger } = createLedger(fixture.configuration);
  try {
    return await ledger.rebuildRun(fixture.runId);
  } finally {
    await db.close();
  }
}

/** @param {CrashFixture} fixture */
async function readEffectDelivery(fixture) {
  const { db, ledger } = createLedger(fixture.configuration);
  try {
    return await ledger.readManagedEffectDelivery(
      fixture.runId,
      MANUAL_LEDGER_INVOCATION_ID,
      EFFECT_ID,
    );
  } finally {
    await db.close();
  }
}

/** @param {CrashFixture} fixture */
async function readOwnership(fixture) {
  const db = createLMDB({
    path: fixture.configuration.controlPath,
    readOnly: true,
  });
  try {
    return await createLedgerServiceOwnership({
      db,
      tableName: fixture.configuration.tableName,
    }).getOwnership({ serviceId: createLedgerServiceId({ appId: APP_ID }) });
  } finally {
    await db.close();
  }
}

/** @param {CrashFixture} fixture */
async function readDestinationState(fixture) {
  const db = await createApplicationStateDBClient('lmdb', {
    path: fixture.applicationStateConfiguration.storePath,
    readOnly: true,
  });
  try {
    const table = createApplicationStateTable({
      db,
      tableName: fixture.applicationStateConfiguration.tableName,
    });
    const destinationEffectId = createManagedEffectDestinationId({
      appId: APP_ID,
      runId: fixture.runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      effectId: EFFECT_ID,
    });
    const businessKey = createApplicationStateBusinessKey(APP_ID, BUSINESS_KEY);
    return {
      destinationEffectId,
      receipt: await table.readReceipt(destinationEffectId),
      business: await table.readBusinessByPhysicalKey(
        businessKey.resourceId,
        businessKey.sortKey,
      ),
    };
  } finally {
    await db.close();
  }
}

/** @param {CrashFixture} fixture */
function readAdapterEntries(fixture) {
  if (!existsSync(fixture.adapterMarkerPath)) return [];
  return readFileSync(fixture.adapterMarkerPath, 'utf8')
    .split('\n')
    .filter(Boolean);
}

/** @param {string} root */
function countFiles(root) {
  if (!existsSync(root)) return 0;
  let count = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const item = path.join(root, entry.name);
    if (entry.isDirectory()) count += countFiles(item);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

/**
 * @param {unknown} value
 * @param {Set<string>} [found]
 * @returns {Set<string>}
 */
function reachablePayloadIds(value, found = new Set()) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const entry of value) reachablePayloadIds(entry, found);
    return found;
  }
  const record = /** @type {Record<string, any>} */ (value);
  if (
    typeof record.payloadId === 'string' &&
    record.storage &&
    typeof record.storage === 'object'
  ) {
    found.add(record.payloadId);
  }
  for (const entry of Object.values(record)) {
    reachablePayloadIds(entry, found);
  }
  return found;
}

/**
 * @param {Promise<ChildExit>} exitPromise
 * @param {string} boundary
 * @returns {Promise<ChildExit>}
 */
async function waitForChildExit(exitPromise, boundary) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  try {
    return await Promise.race([
      exitPromise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `Crash child did not exit within ${CHILD_EXIT_TIMEOUT_MS}ms after SIGKILL at ${boundary}.`,
            ),
          );
        }, CHILD_EXIT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {Promise<ChildExit>} exitPromise
 * @param {string} boundary
 * @returns {Promise<ChildExit>}
 */
async function killAndWaitForChildExit(child, exitPromise, boundary) {
  /** @type {unknown} */
  let killError;
  try {
    child.kill('SIGKILL');
  } catch (error) {
    killError = error;
  }

  try {
    const exited = await waitForChildExit(exitPromise, boundary);
    if (killError) {
      throw new AggregateError(
        [killError],
        `Crash child exited after SIGKILL raised at ${boundary}.`,
      );
    }
    return exited;
  } catch (exitError) {
    if (killError && !(exitError instanceof AggregateError)) {
      throw new AggregateError(
        [killError, exitError],
        `Crash child SIGKILL and exit wait both failed at ${boundary}.`,
      );
    }
    throw exitError;
  }
}

/**
 * @param {CrashFixture} fixture
 * @returns {Promise<{code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string, message: Record<string, any>}>}
 */
async function crashAtBoundary(fixture) {
  const child = spawn(
    process.execPath,
    [
      CHILD_PATH,
      JSON.stringify({
        boundary: fixture.boundary,
        runId: fixture.runId,
        appId: APP_ID,
        revisionId: REVISION_ID,
        activityId: ACTIVITY_ID,
        effectId: EFFECT_ID,
        adapterMarkerPath: fixture.adapterMarkerPath,
        control: fixture.configuration,
        applicationState: fixture.applicationStateConfiguration,
      }),
    ],
    {
      cwd: fixture.root,
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  let stdout = '';
  let stderr = '';
  const stdoutStream = /** @type {import('node:stream').Readable} */ (
    child.stdout
  );
  const stderrStream = /** @type {import('node:stream').Readable} */ (
    child.stderr
  );
  stdoutStream.setEncoding('utf8');
  stderrStream.setEncoding('utf8');
  stdoutStream.on('data', (chunk) => {
    stdout += chunk;
  });
  stderrStream.on('data', (chunk) => {
    stderr += chunk;
  });

  /** @type {(value: ChildExit) => void} */
  let resolveExit = () => {};
  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
  });
  /** @type {(value: Record<string, any>) => void} */
  let resolveObservation = () => {};
  /** @type {(reason: unknown) => void} */
  let rejectObservation = () => {};
  const observation = new Promise((resolve, reject) => {
    resolveObservation = resolve;
    rejectObservation = reject;
  });
  let observationSettled = false;
  const succeed = (/** @type {Record<string, any>} */ message) => {
    if (observationSettled) return;
    observationSettled = true;
    resolveObservation(message);
  };
  const fail = (/** @type {unknown} */ error) => {
    if (observationSettled) return;
    observationSettled = true;
    rejectObservation(error);
  };
  const onMessage = (/** @type {unknown} */ message) => {
    if (!message || typeof message !== 'object') return;
    const candidate = /** @type {Record<string, any>} */ (message);
    if (candidate.kind === 'fatal') {
      fail(new Error(`Crash child failed: ${candidate.error}`));
      return;
    }
    if (candidate.kind !== 'boundary') return;
    if (candidate.boundary !== fixture.boundary) {
      fail(
        new Error(
          `Crash child reached ${candidate.boundary}; expected ${fixture.boundary}.`,
        ),
      );
      return;
    }
    succeed(candidate);
  };
  const onError = (/** @type {Error} */ error) => {
    fail(error);
  };
  const onExit = (
    /** @type {number | null} */ code,
    /** @type {NodeJS.Signals | null} */ signal,
  ) => {
    resolveExit({ code, signal });
    fail(
      new Error(
        `Crash child exited before ${fixture.boundary}: code=${code} signal=${signal} stdout=${stdout} stderr=${stderr}`,
      ),
    );
  };
  child.on('message', onMessage);
  child.once('error', onError);
  child.once('exit', onExit);
  const boundaryTimer = setTimeout(() => {
    fail(
      new Error(
        `Crash child timed out at ${fixture.boundary}. stdout=${stdout} stderr=${stderr}`,
      ),
    );
  }, CHILD_BOUNDARY_TIMEOUT_MS);

  try {
    const message = await observation;
    const exited = await killAndWaitForChildExit(
      child,
      exitPromise,
      fixture.boundary,
    );
    return { ...exited, stdout, stderr, message };
  } catch (error) {
    try {
      await killAndWaitForChildExit(child, exitPromise, fixture.boundary);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Crash child failed and could not be reaped at ${fixture.boundary}.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(boundaryTimer);
    child.off('message', onMessage);
    child.off('error', onError);
    child.off('exit', onExit);
  }
}

/** @param {Record<string, any> | null} view */
function effectStatus(view) {
  const effects = view?.effects || [];
  expect(effects).toHaveLength(effects.length === 0 ? 0 : 1);
  return effects[0]?.status || null;
}

/** @param {Record<string, any>} event */
function transitionedEffects(event) {
  return event.payload.effects.map(
    (/** @type {Record<string, any>} */ effect) => ({
      effectId: effect.effectId,
      status: effect.status,
    }),
  );
}

/** @param {CrashFixture} fixture */
async function recover(fixture) {
  return await recoverExecutionLedgerRun({
    runId: fixture.runId,
    expectedAppId: APP_ID,
    actor: { kind: 'local', id: 'crash-matrix-recovery' },
    requireLocalOwnership: true,
    configuration: fixture.configuration,
    applicationStateConfiguration: fixture.applicationStateConfiguration,
  });
}

const itOnUnix = process.platform === 'win32' ? it.skip : it;

describe('real SIGKILL managed-effect crash recovery matrix', () => {
  itOnUnix.each(CASES)(
    'recovers $label [$boundary] without redispatch',
    async (scenario) => {
      const root = mkdtempSync(
        path.join(os.tmpdir(), 'wharfie-managed-effect-crash-'),
      );
      /** @type {string | undefined} */
      let staleEndpoint;
      try {
        const fixture = createFixture(root, scenario.boundary);
        const crashed = await crashAtBoundary(fixture);
        staleEndpoint = getLocalServiceSessionEndpoint({
          serviceId: createLedgerServiceId({ appId: APP_ID }),
          sessionId: crashed.message.ownership.sessionId,
          sessionRoot: fixture.configuration.sessionPath,
        });
        expect(crashed).toMatchObject({
          code: null,
          signal: 'SIGKILL',
          stdout: '',
          stderr: '',
          message: {
            kind: 'boundary',
            boundary: scenario.boundary,
            ownership: {
              appId: APP_ID,
              ownerKind: 'manual',
              generation: 1,
            },
          },
        });
        expect(existsSync(staleEndpoint)).toBe(true);

        const before = await readRun(fixture);
        if (!before) throw new Error('Crashed run was not readable.');
        expect(before).toMatchObject({
          run: { status: RunStatus.RUNNING },
          invocations: [
            expect.objectContaining({ status: InvocationStatus.RUNNING }),
          ],
          attempts: [
            expect.objectContaining({ status: AttemptStatus.STARTED }),
          ],
        });
        expect(effectStatus(before)).toBe(scenario.beforeEffect);
        const terminalEffectBefore = before.effects[0];
        const isTerminalDeliveryBoundary =
          scenario.boundary === Boundary.OUTCOME_COMMIT ||
          scenario.boundary === Boundary.HOST_EFFECT_RESPONSE;
        const terminalDeliveryBefore = isTerminalDeliveryBoundary
          ? await readEffectDelivery(fixture)
          : null;
        if (isTerminalDeliveryBoundary) {
          expect(terminalDeliveryBefore).toMatchObject({
            effect: {
              status: EffectStatus.COMPLETED,
              version: expect.any(Number),
              lastSequence: expect.any(Number),
              outcomeRef: expect.any(Object),
            },
            resultFrame: { type: 'effect-result', effectId: EFFECT_ID },
          });
        }

        const staleOwnership = await readOwnership(fixture);
        expect(staleOwnership).toEqual(crashed.message.ownership);
        const destinationBefore = await readDestinationState(fixture);
        expect(destinationBefore.receipt === null).toBe(
          !scenario.hasDestinationState,
        );
        expect(destinationBefore.business === null).toBe(
          !scenario.hasDestinationState,
        );
        expect(readAdapterEntries(fixture)).toEqual(
          Array.from(
            { length: scenario.adapterEntries },
            () => destinationBefore.destinationEffectId,
          ),
        );

        const publishedReference = crashed.message.detail?.reference;
        const payloadFilesBeforeRecovery = countFiles(
          fixture.configuration.payloadPath,
        );
        if (
          scenario.boundary === Boundary.REQUEST_PAYLOAD ||
          scenario.boundary === Boundary.OUTCOME_PAYLOAD
        ) {
          expect(publishedReference).toEqual(expect.any(Object));
          const payloadStore = createLocalExecutionPayloadStore({
            path: fixture.configuration.payloadPath,
            storeId: fixture.configuration.payloadStoreId,
          });
          expect(existsSync(payloadStore.getPath(publishedReference))).toBe(
            true,
          );
          expect(JSON.stringify(before)).not.toContain(
            publishedReference.payloadId,
          );
          expect(payloadFilesBeforeRecovery).toBe(
            reachablePayloadIds(before).size + 1,
          );
        }

        const recovered = await recover(fixture);
        if (!recovered) throw new Error('Recovery returned no run.');
        expect(recovered.recovery).toMatchObject({
          found: true,
          mayExecute: false,
          action: scenario.recoveryAction,
          changed: true,
        });
        if (scenario.managedAction) {
          expect(recovered.recovery.managedEffects).toEqual([
            {
              effectId: EFFECT_ID,
              action: scenario.managedAction,
              status: scenario.afterEffect,
            },
          ]);
        } else {
          expect(recovered.recovery.managedEffects).toBeUndefined();
        }
        expect(recovered.view).toMatchObject({
          run: { status: RunStatus.BLOCKED },
          invocations: [
            expect.objectContaining({ status: InvocationStatus.UNCERTAIN }),
          ],
          attempts: [
            expect.objectContaining({ status: AttemptStatus.ABANDONED }),
          ],
        });
        expect(effectStatus(recovered.view)).toBe(scenario.afterEffect);
        if (isTerminalDeliveryBoundary) {
          expect(recovered.view.effects[0]).toEqual(terminalEffectBefore);
          const recoveredDelivery = await readEffectDelivery(fixture);
          expect({
            effect: recoveredDelivery?.effect,
            outcome: recoveredDelivery?.outcome,
            resultFrame: recoveredDelivery?.resultFrame,
          }).toEqual({
            effect: terminalDeliveryBefore?.effect,
            outcome: terminalDeliveryBefore?.outcome,
            resultFrame: terminalDeliveryBefore?.resultFrame,
          });
        }
        expect(recovered.view.events).toHaveLength(before.events.length + 1);
        expect(recovered.view.events.at(-1)).toMatchObject({
          type: 'attempt-became-uncertain',
          actor: { kind: 'local', id: 'crash-matrix-recovery' },
        });
        expect(transitionedEffects(recovered.view.events.at(-1))).toEqual(
          scenario.eventEffects,
        );
        expect(await readOwnership(fixture)).toBeNull();
        expect(await readDestinationState(fixture)).toEqual(destinationBefore);
        expect(readAdapterEntries(fixture)).toHaveLength(
          scenario.adapterEntries,
        );

        if (scenario.boundary === Boundary.REQUEST_PAYLOAD) {
          expect(JSON.stringify(recovered.view)).not.toContain(
            publishedReference.payloadId,
          );
          expect(countFiles(fixture.configuration.payloadPath)).toBe(
            payloadFilesBeforeRecovery,
          );
          expect(countFiles(fixture.configuration.payloadPath)).toBe(
            reachablePayloadIds(recovered.view).size + 1,
          );
        }
        if (scenario.boundary === Boundary.OUTCOME_PAYLOAD) {
          expect(recovered.view.effects[0].outcomeRef).toEqual(
            publishedReference,
          );
          expect(countFiles(fixture.configuration.payloadPath)).toBe(
            payloadFilesBeforeRecovery,
          );
          expect(countFiles(fixture.configuration.payloadPath)).toBe(
            reachablePayloadIds(recovered.view).size,
          );
        }

        const replay = await recover(fixture);
        if (!replay) throw new Error('Recovery replay returned no run.');
        expect(replay.recovery).toMatchObject({
          found: true,
          mayExecute: false,
          action: 'none',
          changed: false,
        });
        expect(replay.view).toEqual(recovered.view);
        expect(await readOwnership(fixture)).toBeNull();
        expect(await readDestinationState(fixture)).toEqual(destinationBefore);
        expect(readAdapterEntries(fixture)).toHaveLength(
          scenario.adapterEntries,
        );
        if (isTerminalDeliveryBoundary) {
          const replayDelivery = await readEffectDelivery(fixture);
          expect({
            effect: replayDelivery?.effect,
            outcome: replayDelivery?.outcome,
            resultFrame: replayDelivery?.resultFrame,
          }).toEqual({
            effect: terminalDeliveryBefore?.effect,
            outcome: terminalDeliveryBefore?.outcome,
            resultFrame: terminalDeliveryBefore?.resultFrame,
          });
        }
        if (scenario.boundary === Boundary.REQUEST_PAYLOAD) {
          expect(JSON.stringify(replay.view)).not.toContain(
            publishedReference.payloadId,
          );
          expect(countFiles(fixture.configuration.payloadPath)).toBe(
            payloadFilesBeforeRecovery,
          );
          expect(countFiles(fixture.configuration.payloadPath)).toBe(
            reachablePayloadIds(replay.view).size + 1,
          );
        }
        if (scenario.boundary === Boundary.OUTCOME_PAYLOAD) {
          expect(replay.view.effects[0].outcomeRef).toEqual(publishedReference);
          expect(countFiles(fixture.configuration.payloadPath)).toBe(
            payloadFilesBeforeRecovery,
          );
          expect(countFiles(fixture.configuration.payloadPath)).toBe(
            reachablePayloadIds(replay.view).size,
          );
        }
        expect(existsSync(staleEndpoint)).toBe(true);
      } finally {
        if (process.platform !== 'win32' && staleEndpoint) {
          rmSync(staleEndpoint, { force: true });
        }
        rmSync(root, { recursive: true, force: true });
      }
    },
    45_000,
  );
});
