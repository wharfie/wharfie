/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
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
import { spawn } from 'node:child_process';

import createLMDB from '../../src/core/lib/db/adapters/lmdb.js';
import {
  APPLICATION_STATE_TABLE_NAME,
  createApplicationStateDBClient,
  resolveExecutionPayloadStoreId,
} from '../../src/core/lib/config/db.js';
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
import {
  createApplicationStateBusinessKey,
  createApplicationStateTable,
} from '../../src/core/lib/db/tables/application-state.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { getLocalServiceSessionEndpoint } from '../../src/core/runtime/local-service-session.js';
import { APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS } from '../../src/core/runtime/effects/application-state.js';
import { createBuiltinManagedEffectCatalog } from '../../src/core/runtime/effects/builtin-catalog.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
} from '../../src/core/runtime/manual-ledger-run.js';
import { recoverExecutionLedgerRun } from '../../src/core/runtime/operator/execution-ledger-operator.js';

const CHILD_PATH = fileURLToPath(
  new URL('./managed-effect-settlement-crash-child.js', import.meta.url),
);
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const APP_ID = 'managed-effect-settlement-crash';
const TABLE_NAME = 'managed-effect-settlement-crash';
const FENCING_TOKEN = 'settlement-crash-fence';
const EFFECT_IDS = Object.freeze([
  'a-pending',
  'b-receipt',
  'c-absent',
  'd-terminal',
]);
const Boundary = Object.freeze({
  OUTCOME_PAYLOAD: 'recovered-outcome-published',
  COMPOUND_TRANSACTION: 'compound-transaction-committed',
  HELPER_RESPONSE: 'helper-response-ready',
});

/**
 * @typedef {Readonly<{adapterName: 'lmdb', controlPath: string, tableName: string, payloadPath: string, payloadStoreId: string, sessionPath: string}>} SettlementControlConfiguration
 * @typedef {Readonly<{adapterName: 'lmdb', storePath: string, tableName: typeof APPLICATION_STATE_TABLE_NAME}>} SettlementApplicationStateConfiguration
 * @typedef {{root: string, appId: string, runId: string, configuration: SettlementControlConfiguration, applicationStateConfiguration: SettlementApplicationStateConfiguration, markerPath: string}} SettlementCrashFixture
 */

/** @param {string} root @returns {SettlementControlConfiguration} */
function createConfiguration(root) {
  const controlPath = path.join(root, 'control');
  const payloadPath = path.join(root, 'execution-payloads');
  return Object.freeze({
    adapterName: /** @type {const} */ ('lmdb'),
    controlPath,
    tableName: TABLE_NAME,
    payloadPath,
    payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
    sessionPath: path.join(root, 'ledger-service-sessions'),
  });
}

/** @param {string} root @returns {SettlementApplicationStateConfiguration} */
function createApplicationStateConfiguration(root) {
  return Object.freeze({
    adapterName: /** @type {const} */ ('lmdb'),
    storePath: path.join(root, 'application-state'),
    tableName: APPLICATION_STATE_TABLE_NAME,
  });
}

/**
 * @param {SettlementControlConfiguration} configuration
 * @param {{readOnly?: boolean}} [options]
 */
function createLedger(configuration, options = {}) {
  const db = createLMDB({
    path: configuration.controlPath,
    ...(options.readOnly ? { readOnly: true } : {}),
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

/** @param {string} attemptId @param {string} effectId @param {number} sequence */
function effectRequest(attemptId, effectId, sequence) {
  return {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'effect-request',
    attemptId,
    sequence,
    effectId,
    capability: 'application-state',
    operation: 'put-if-absent',
    input: {
      key: `key-${effectId}`,
      value: { effectId, secret: `secret-${effectId}` },
    },
    requestedReplayProperties: ['idempotent', 'transactional'],
  };
}

/** @param {string} root @param {string} boundary @returns {Promise<SettlementCrashFixture>} */
async function seedMixedRun(root, boundary) {
  const configuration = createConfiguration(root);
  const applicationStateConfiguration =
    createApplicationStateConfiguration(root);
  const { db, ledger } = createLedger(configuration);
  const applicationDb = await createApplicationStateDBClient('lmdb', {
    path: applicationStateConfiguration.storePath,
  });
  try {
    const catalog = await createBuiltinManagedEffectCatalog({
      db: applicationDb,
      appId: APP_ID,
      adapterName: 'lmdb',
      tableName: applicationStateConfiguration.tableName,
    });
    const runId = createManualLedgerRunId({
      appId: APP_ID,
      idempotencyKey: `settlement-crash-${boundary}`,
    });
    const created = await ledger.createManualRun({
      runId,
      appId: APP_ID,
      revisionId: REVISION_ID,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      activityId: 'mixed-effects',
      input: { boundary },
      callerMetadata: { test: 'real-sigkill' },
      transitionId: 'create',
    });
    const claimed = await ledger.claimInvocation({
      runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      fencingToken: FENCING_TOKEN,
      expectedGeneration: 0,
      expectedVersion: created.run.version,
      transitionId: 'claim',
    });
    const attempt = await ledger.markAttemptStarted({
      runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      attemptId: claimed.attempt.attemptId,
      fencingToken: FENCING_TOKEN,
      generation: claimed.attempt.generation,
      expectedVersion: claimed.run.version,
      transitionId: 'attempt-start',
    });

    for (let index = 0; index < EFFECT_IDS.length; index += 1) {
      const effectId = EFFECT_IDS[index];
      const request = effectRequest(
        attempt.attempt.attemptId,
        effectId,
        index + 1,
      );
      const adapter = catalog.resolve(request);
      const current = await ledger.rebuildRun(runId);
      if (!current) throw new Error('Seeded run disappeared.');
      const requested = await ledger.recordManagedEffectRequest({
        runId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        attemptId: attempt.attempt.attemptId,
        fencingToken: FENCING_TOKEN,
        generation: attempt.attempt.generation,
        expectedVersion: current.run.version,
        transitionId: `request:${effectId}`,
        request,
        adapter: adapter.descriptor,
        destination: adapter.destination,
        verifier: adapter.verifier,
        substantiatedReplayProperties: adapter.substantiatedReplayProperties,
      });
      if (effectId === 'a-pending') continue;

      const started = await ledger.markManagedEffectStarted({
        runId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        attemptId: attempt.attempt.attemptId,
        effectId,
        fencingToken: FENCING_TOKEN,
        generation: attempt.attempt.generation,
        expectedVersion: requested.run.version,
        expectedEffectVersion: requested.effect.version,
        transitionId: `start:${effectId}`,
      });
      if (effectId === 'c-absent') continue;

      const outcome = await adapter.execute({
        destinationEffectId: started.effect.destinationEffectId,
        destination: adapter.destination,
        identity: {
          runId,
          invocationId: MANUAL_LEDGER_INVOCATION_ID,
          attemptId: attempt.attempt.attemptId,
          effectId,
        },
        request,
      });
      if (effectId === 'd-terminal') {
        await ledger.commitManagedEffectOutcome({
          runId,
          invocationId: MANUAL_LEDGER_INVOCATION_ID,
          attemptId: attempt.attempt.attemptId,
          effectId,
          fencingToken: FENCING_TOKEN,
          generation: attempt.attempt.generation,
          expectedVersion: started.run.version,
          expectedEffectVersion: started.effect.version,
          transitionId: `outcome:${effectId}`,
          outcome,
        });
      }
    }
    return {
      root,
      appId: APP_ID,
      runId,
      configuration,
      applicationStateConfiguration,
      markerPath: path.join(root, 'crash-marker.json'),
    };
  } finally {
    await applicationDb.close();
    await db.close();
  }
}

/** @param {SettlementCrashFixture} fixture */
async function readRun(fixture) {
  const { db, ledger } = createLedger(fixture.configuration, {
    readOnly: true,
  });
  try {
    return await ledger.rebuildRun(fixture.runId);
  } finally {
    await db.close();
  }
}

/** @param {SettlementCrashFixture} fixture */
async function readOwnership(fixture) {
  const db = createLMDB({
    path: fixture.configuration.controlPath,
    readOnly: true,
  });
  try {
    return await createLedgerServiceOwnership({
      db,
      tableName: fixture.configuration.tableName,
    }).getOwnership({
      serviceId: createLedgerServiceId({ appId: fixture.appId }),
    });
  } finally {
    await db.close();
  }
}

/** @param {SettlementCrashFixture} fixture @param {Record<string, any>} view */
async function readApplicationState(fixture, view) {
  const db = await createApplicationStateDBClient('lmdb', {
    path: fixture.applicationStateConfiguration.storePath,
    readOnly: true,
  });
  try {
    const table = createApplicationStateTable({
      db,
      tableName: fixture.applicationStateConfiguration.tableName,
    });
    return Object.fromEntries(
      await Promise.all(
        view.effects.map(async (/** @type {Record<string, any>} */ effect) => {
          const businessKey = createApplicationStateBusinessKey(
            fixture.appId,
            `key-${effect.effectId}`,
          );
          return [
            effect.effectId,
            {
              receipt: await table.readReceipt(effect.destinationEffectId),
              business: await table.readBusinessByPhysicalKey(
                businessKey.resourceId,
                businessKey.sortKey,
              ),
            },
          ];
        }),
      ),
    );
  } finally {
    await db.close();
  }
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

/** @param {SettlementCrashFixture} fixture */
function readMarker(fixture) {
  return JSON.parse(readFileSync(fixture.markerPath, 'utf8'));
}

/** @param {SettlementCrashFixture} fixture @param {string} boundary */
function runCrashChild(fixture, boundary) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHILD_PATH], {
      cwd: fixture.root,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        WHARFIE_SETTLEMENT_CRASH_FIXTURE: JSON.stringify({
          ...fixture,
          boundary,
        }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let markerObserved = false;
    let aliveAtMarker = false;
    let killDelivered = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const markerPoll = setInterval(() => {
      if (killDelivered || !existsSync(fixture.markerPath)) return;
      try {
        JSON.parse(readFileSync(fixture.markerPath, 'utf8'));
      } catch {
        return;
      }
      markerObserved = true;
      aliveAtMarker =
        child.exitCode === null &&
        child.signalCode === null &&
        child.killed === false;
      if (aliveAtMarker) killDelivered = child.kill('SIGKILL');
    }, 10);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 20_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      clearInterval(markerPoll);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      clearInterval(markerPoll);
      resolve({
        code,
        signal,
        stdout,
        stderr,
        timedOut,
        markerObserved,
        aliveAtMarker,
        killDelivered,
      });
    });
  });
}

/** @param {Record<string, any>} before @param {Record<string, any>} after */
function expectSettledMixedState(before, after) {
  expect(after).toMatchObject({
    run: { status: RunStatus.BLOCKED },
    invocations: [
      expect.objectContaining({ status: InvocationStatus.UNCERTAIN }),
    ],
    attempts: [expect.objectContaining({ status: AttemptStatus.ABANDONED })],
  });
  expect(
    after.effects.map(
      (/** @type {Record<string, any>} */ effect) => effect.status,
    ),
  ).toEqual([
    EffectStatus.CANCELLED,
    EffectStatus.COMPLETED,
    EffectStatus.UNCERTAIN,
    EffectStatus.COMPLETED,
  ]);
  expect(after.events).toHaveLength(before.events.length + 1);
  const settlement = after.events.at(-1);
  expect(settlement).toMatchObject({
    type: 'attempt-became-uncertain',
    payload: {
      effects: [
        expect.objectContaining({
          effectId: 'a-pending',
          status: EffectStatus.CANCELLED,
        }),
        expect.objectContaining({
          effectId: 'b-receipt',
          status: EffectStatus.COMPLETED,
        }),
        expect.objectContaining({
          effectId: 'c-absent',
          status: EffectStatus.UNCERTAIN,
        }),
      ],
    },
  });
  const effects = new Map(
    after.effects.map((/** @type {Record<string, any>} */ effect) => [
      effect.effectId,
      effect,
    ]),
  );
  for (const effectId of ['a-pending', 'b-receipt', 'c-absent']) {
    expect(effects.get(effectId).lastSequence).toBe(settlement.sequence);
  }
  const beforeTerminal = before.effects.find(
    (/** @type {Record<string, any>} */ effect) =>
      effect.effectId === 'd-terminal',
  );
  expect(effects.get('d-terminal')).toEqual(beforeTerminal);
}

/** @param {SettlementCrashFixture} fixture */
async function replayOperatorRecovery(fixture) {
  return await recoverExecutionLedgerRun({
    runId: fixture.runId,
    expectedAppId: fixture.appId,
    actor: { kind: 'local', id: 'settlement-crash-restart' },
    requireLocalOwnership: true,
    configuration: fixture.configuration,
    applicationStateConfiguration: fixture.applicationStateConfiguration,
  });
}

const itOnUnix = process.platform === 'win32' ? it.skip : it;

describe('real SIGKILL stopped managed-effect settlement recovery', () => {
  itOnUnix.each([
    Boundary.OUTCOME_PAYLOAD,
    Boundary.COMPOUND_TRANSACTION,
    Boundary.HELPER_RESPONSE,
  ])(
    'recovers the mixed set at %s',
    async (boundary) => {
      const root = mkdtempSync(
        path.join(os.tmpdir(), 'wharfie-effect-settlement-crash-'),
      );
      /** @type {string | undefined} */
      let staleEndpoint;
      try {
        const fixture = await seedMixedRun(root, boundary);
        const before = await readRun(fixture);
        if (!before) throw new Error('Expected seeded crash run.');
        const applicationBefore = await readApplicationState(fixture, before);
        expect(applicationBefore['a-pending']).toEqual({
          receipt: null,
          business: null,
        });
        expect(applicationBefore['b-receipt'].receipt).not.toBeNull();
        expect(applicationBefore['c-absent']).toEqual({
          receipt: null,
          business: null,
        });
        expect(applicationBefore['d-terminal'].receipt).not.toBeNull();
        const payloadFilesBefore = countFiles(
          fixture.configuration.payloadPath,
        );
        expect(await readOwnership(fixture)).toBeNull();

        const exited = await runCrashChild(fixture, boundary);
        expect(exited).toEqual({
          code: null,
          signal: 'SIGKILL',
          stdout: '',
          stderr: '',
          timedOut: false,
          markerObserved: true,
          aliveAtMarker: true,
          killDelivered: true,
        });
        const marker = readMarker(fixture);
        expect(marker).toMatchObject({ boundary });
        expect(marker.pid).toEqual(expect.any(Number));
        expect(marker.ownership).toMatchObject({
          appId: fixture.appId,
          generation: 1,
          ownerKind: 'manual',
        });
        staleEndpoint = getLocalServiceSessionEndpoint({
          serviceId: createLedgerServiceId({ appId: fixture.appId }),
          sessionId: marker.ownership.sessionId,
          sessionRoot: fixture.configuration.sessionPath,
        });
        expect(existsSync(staleEndpoint)).toBe(true);
        expect(await readOwnership(fixture)).toEqual(marker.ownership);
        expect(countFiles(fixture.configuration.payloadPath)).toBe(
          payloadFilesBefore + 1,
        );

        const afterCrash = await readRun(fixture);
        if (!afterCrash) throw new Error('Crashed run was not readable.');
        if (boundary === Boundary.OUTCOME_PAYLOAD) {
          expect(afterCrash).toEqual(before);
        } else {
          expectSettledMixedState(before, afterCrash);
        }
        if (boundary === Boundary.HELPER_RESPONSE) {
          expect(marker.result).toMatchObject({
            action: 'settled-managed-effect-set',
            changed: true,
          });
        }

        const recovered = await replayOperatorRecovery(fixture);
        if (!recovered) throw new Error('Operator recovery returned no run.');
        if (boundary === Boundary.OUTCOME_PAYLOAD) {
          expect(recovered.recovery).toMatchObject({
            action: 'settled-managed-effect-set',
            changed: true,
          });
        } else {
          expect(recovered.recovery).toMatchObject({
            action: 'none',
            changed: false,
          });
        }
        expectSettledMixedState(before, recovered.view);
        if (boundary === Boundary.OUTCOME_PAYLOAD) {
          const recoveredEffect = recovered.view.effects.find(
            (/** @type {Record<string, any>} */ effect) =>
              effect.effectId === 'b-receipt',
          );
          expect(recoveredEffect.outcomeRef).toEqual(marker.reference);
        }
        expect(countFiles(fixture.configuration.payloadPath)).toBe(
          payloadFilesBefore + 1,
        );
        expect(await readApplicationState(fixture, recovered.view)).toEqual(
          applicationBefore,
        );
        expect(await readOwnership(fixture)).toBeNull();

        const replay = await replayOperatorRecovery(fixture);
        if (!replay) throw new Error('Operator replay returned no run.');
        expect(replay.recovery).toMatchObject({
          action: 'none',
          changed: false,
        });
        expect(replay.view).toEqual(recovered.view);
        expect(await readApplicationState(fixture, replay.view)).toEqual(
          applicationBefore,
        );
        expect(countFiles(fixture.configuration.payloadPath)).toBe(
          payloadFilesBefore + 1,
        );
        expect(existsSync(staleEndpoint)).toBe(true);
      } finally {
        if (staleEndpoint) rmSync(staleEndpoint, { force: true });
        rmSync(root, { recursive: true, force: true });
      }
    },
    45_000,
  );
});
