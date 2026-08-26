/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
import { createApplicationStateCoordinatorAuthorityRecord } from '../../src/core/lib/db/tables/application-state-authority.js';
import {
  CoordinatorAuthorityStatus,
  createCoordinatorAuthority,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import {
  AttemptStatus,
  EffectStatus,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS } from '../../src/core/runtime/effects/application-state.js';
import { createBuiltinManagedEffectCatalog } from '../../src/core/runtime/effects/builtin-catalog.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
} from '../../src/core/runtime/manual-ledger-run.js';
import { executeManagedEffectSuccessorRun } from '../../src/core/runtime/managed-effect-successor.js';
import {
  reconcileExecutionLedgerEffect,
  recoverExecutionLedgerRun,
} from '../../src/core/runtime/operator/execution-ledger-operator.js';
import {
  withExecutionLedgerCoordinatorAuthority,
  withLocalLedgerServiceMutationOwnership,
} from '../../src/core/runtime/operator/execution-ledger-store.js';

const CHILD_PATH = fileURLToPath(
  new URL(
    '../fixtures/managed-effect-successor-crash-child.js',
    import.meta.url,
  ),
);
const APP_ID = 'managed-effect-successor-crash';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const SOURCE_EFFECT_ID = 'remember-not-applied';
const BUSINESS_KEY = `key-${SOURCE_EFFECT_ID}`;
const TABLE_NAME = 'managed-effect-successor-crash';
const ACTOR = Object.freeze({ kind: 'local', id: 'successor-crash-operator' });
const REASON = Object.freeze({ kind: 'successor-crash-proof' });

const Boundary = Object.freeze({
  AUTHORIZATION: 'successor-authorization-committed',
  START: 'successor-atomic-start-committed',
  DESTINATION: 'successor-destination-committed',
  TERMINAL: 'successor-atomic-terminal-committed',
});

const CASES = Object.freeze([
  {
    boundary: Boundary.AUTHORIZATION,
    label: 'atomic causal authorization',
    before: {
      run: RunStatus.RUNNING,
      invocation: InvocationStatus.RUNNABLE,
      attempt: null,
      effect: null,
      mutationCount: 0,
    },
  },
  {
    boundary: Boundary.START,
    label: 'atomic target start before adapter entry',
    before: {
      run: RunStatus.RUNNING,
      invocation: InvocationStatus.RUNNING,
      attempt: AttemptStatus.STARTED,
      effect: EffectStatus.STARTED,
      mutationCount: 0,
    },
  },
  {
    boundary: Boundary.DESTINATION,
    label: 'destination commit before outcome publication',
    before: {
      run: RunStatus.RUNNING,
      invocation: InvocationStatus.RUNNING,
      attempt: AttemptStatus.STARTED,
      effect: EffectStatus.STARTED,
      mutationCount: 1,
    },
  },
  {
    boundary: Boundary.TERMINAL,
    label: 'atomic target terminal after outcome publication',
    before: {
      run: RunStatus.COMPLETED,
      invocation: InvocationStatus.COMPLETED,
      attempt: AttemptStatus.COMPLETED,
      effect: EffectStatus.COMPLETED,
      mutationCount: 1,
    },
  },
]);

const CHILD_BOUNDARY_TIMEOUT_MS = 20_000;
const CHILD_EXIT_TIMEOUT_MS = 5_000;

/**
 * @typedef {Readonly<{adapterName: 'lmdb', controlPath: string, tableName: string, payloadPath: string, payloadStoreId: string, sessionPath: string}>} SuccessorControlConfiguration
 * @typedef {Readonly<{adapterName: 'lmdb', storePath: string, tableName: typeof APPLICATION_STATE_TABLE_NAME}>} SuccessorApplicationStateConfiguration
 * @typedef {Readonly<{root: string, boundary: string, sourceRunId: string, successorId: string, configuration: SuccessorControlConfiguration, applicationStateConfiguration: SuccessorApplicationStateConfiguration, adapterMarkerPath: string}>} SuccessorCrashFixture
 * @typedef {{code: number | null, signal: NodeJS.Signals | null}} ChildExit
 * @typedef {{applied: boolean, authorization: Record<string, any>, targetRun: Record<string, any>, targetInvocation: Record<string, any>, request: Record<string, any>}} SuccessorHandoff
 */

/**
 * @param {string} root
 * @param {string} boundary
 * @returns {SuccessorCrashFixture}
 */
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
    sourceRunId: createManualLedgerRunId({
      appId: APP_ID,
      idempotencyKey: `source-${boundary}`,
    }),
    successorId: `successor-${boundary}`,
    configuration,
    applicationStateConfiguration,
    adapterMarkerPath: path.join(root, 'successor-adapter.log'),
  });
}

/**
 * @param {SuccessorControlConfiguration} configuration
 * @param {boolean} [readOnly]
 */
function createLedger(configuration, readOnly = false) {
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

/** @param {string} attemptId */
function effectRequest(attemptId) {
  return {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'effect-request',
    attemptId,
    sequence: 1,
    effectId: SOURCE_EFFECT_ID,
    capability: 'application-state',
    operation: 'put-if-absent',
    input: {
      key: BUSINESS_KEY,
      value: { retained: 'successor-crash-value' },
    },
    requestedReplayProperties: ['idempotent', 'transactional'],
  };
}

/** @param {SuccessorCrashFixture} fixture */
async function seedNotAppliedSource(fixture) {
  const { db, ledger } = createLedger(fixture.configuration);
  const applicationDb = await createApplicationStateDBClient('lmdb', {
    path: fixture.applicationStateConfiguration.storePath,
  });
  try {
    const catalog = await createBuiltinManagedEffectCatalog({
      db: applicationDb,
      appId: APP_ID,
      adapterName: 'lmdb',
      tableName: fixture.applicationStateConfiguration.tableName,
    });
    const created = await ledger.createManualRun({
      runId: fixture.sourceRunId,
      appId: APP_ID,
      revisionId: REVISION_ID,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      activityId: 'source-activity-must-not-replay',
      input: { retained: true },
      callerMetadata: { fixture: 'successor-real-sigkill' },
      transitionId: 'create',
      actor: ACTOR,
    });
    const claimed = await ledger.claimInvocation({
      runId: fixture.sourceRunId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      fencingToken: 'source-successor-crash-fence',
      expectedGeneration: 0,
      expectedVersion: created.run.version,
      transitionId: 'claim',
      actor: ACTOR,
    });
    const started = await ledger.markAttemptStarted({
      runId: fixture.sourceRunId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      attemptId: claimed.attempt.attemptId,
      fencingToken: claimed.attempt.fencingToken,
      generation: claimed.attempt.generation,
      expectedVersion: claimed.run.version,
      transitionId: 'attempt-start',
      actor: ACTOR,
    });
    const request = effectRequest(started.attempt.attemptId);
    const adapter = catalog.resolve(request);
    const requested = await ledger.recordManagedEffectRequest({
      runId: fixture.sourceRunId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      attemptId: started.attempt.attemptId,
      fencingToken: started.attempt.fencingToken,
      generation: started.attempt.generation,
      expectedVersion: started.run.version,
      transitionId: 'effect-request',
      request,
      adapter: adapter.descriptor,
      destination: adapter.destination,
      verifier: adapter.verifier,
      substantiatedReplayProperties: adapter.substantiatedReplayProperties,
      actor: ACTOR,
    });
    await ledger.markManagedEffectStarted({
      runId: fixture.sourceRunId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      attemptId: started.attempt.attemptId,
      effectId: SOURCE_EFFECT_ID,
      fencingToken: started.attempt.fencingToken,
      generation: started.attempt.generation,
      expectedVersion: requested.run.version,
      expectedEffectVersion: requested.effect.version,
      transitionId: 'effect-start',
      actor: ACTOR,
    });
  } finally {
    await applicationDb.close();
    await db.close();
  }

  const recovered = await recoverExecutionLedgerRun({
    runId: fixture.sourceRunId,
    expectedAppId: APP_ID,
    actor: ACTOR,
    requireLocalOwnership: true,
    configuration: fixture.configuration,
    applicationStateConfiguration: fixture.applicationStateConfiguration,
  });
  if (!recovered) throw new Error('Source recovery returned no run.');
  const reconciled = await reconcileExecutionLedgerEffect({
    runId: fixture.sourceRunId,
    effectId: SOURCE_EFFECT_ID,
    reconciliationId: `not-applied-${fixture.boundary}`,
    expectedAppId: APP_ID,
    actor: ACTOR,
    configuration: fixture.configuration,
    applicationStateConfiguration: fixture.applicationStateConfiguration,
  });
  if (!reconciled) throw new Error('Source reconciliation returned no run.');
  expect(reconciled.reconciliation.status).toBe(EffectStatus.NOT_APPLIED);
  return reconciled.view;
}

/**
 * @param {SuccessorCrashFixture} fixture
 * @param {string} runId
 */
async function readRun(fixture, runId) {
  const { db, ledger } = createLedger(fixture.configuration, true);
  try {
    return await ledger.rebuildRun(runId);
  } finally {
    await db.close();
  }
}

/** @param {SuccessorCrashFixture} fixture */
async function replayAuthorization(fixture) {
  const { db, ledger } = createLedger(fixture.configuration, true);
  try {
    return await ledger.authorizeManagedEffectSuccessorRetry({
      sourceRunId: fixture.sourceRunId,
      sourceEffectId: SOURCE_EFFECT_ID,
      successorId: fixture.successorId,
      reason: REASON,
      actor: ACTOR,
    });
  } finally {
    await db.close();
  }
}

/**
 * @param {SuccessorCrashFixture} fixture
 * @param {SuccessorHandoff} handoff
 */
async function replayWithoutStart(fixture, handoff) {
  const { db, ledger } = createLedger(fixture.configuration, true);
  let startCalls = 0;
  try {
    const noStartLedger = {
      ...ledger,
      async startManagedEffectSuccessor() {
        startCalls += 1;
        throw new Error('Retained non-runnable successor was redispatched.');
      },
    };
    const result = await executeManagedEffectSuccessorRun({
      ledger: noStartLedger,
      authorization: handoff.authorization,
      request: handoff.request,
      actor: ACTOR,
    });
    return { result, startCalls };
  } finally {
    await db.close();
  }
}

/**
 * @param {SuccessorCrashFixture} fixture
 * @param {SuccessorHandoff} handoff
 */
async function executeAuthorizedTarget(fixture, handoff) {
  const { db, ledger: unboundLedger } = createLedger(fixture.configuration);
  const context = { ...fixture.configuration, db, readOnly: false };
  try {
    return await withLocalLedgerServiceMutationOwnership({
      appId: APP_ID,
      context,
      handler: async (localOwner) => {
        if (!localOwner) {
          throw new Error('Successor proof requires its own local owner.');
        }
        return await withExecutionLedgerCoordinatorAuthority({
          appId: APP_ID,
          coordinatorId: localOwner.sessionId,
          ledger: unboundLedger,
          context,
          handler: async (ledger, coordinatorAuthority) => {
            const applicationDb = await createApplicationStateDBClient('lmdb', {
              path: fixture.applicationStateConfiguration.storePath,
            });
            try {
              const catalog = await createBuiltinManagedEffectCatalog({
                db: applicationDb,
                appId: APP_ID,
                adapterName: 'lmdb',
                tableName: fixture.applicationStateConfiguration.tableName,
                coordinatorAuthority: ledger.getCoordinatorAuthority(),
                expectedStoreId:
                  handoff.authorization.contract.destination.configuration
                    .storeId,
              });
              const result = await executeManagedEffectSuccessorRun({
                ledger,
                authorization: handoff.authorization,
                request: handoff.request,
                catalog,
                actor: ACTOR,
                createFencingToken: () => 'successor-replay-fence',
              });
              return { ...result, coordinatorAuthority };
            } finally {
              await applicationDb.close();
            }
          },
        });
      },
    });
  } finally {
    await db.close();
  }
}

/**
 * Retire only the exact authority reported by the child whose SIGKILL exit
 * this proof observed. Neither recovery nor ordinary acquisition is allowed
 * to infer takeover from an old timestamp or a missing process.
 * @param {SuccessorCrashFixture} fixture
 * @param {ChildExit & {message: Record<string, any>}} crashed
 * @returns {Promise<import('../../src/core/lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot>}
 */
async function releaseKnownStoppedCoordinator(fixture, crashed) {
  assert.deepEqual(
    { code: crashed.code, signal: crashed.signal },
    { code: null, signal: 'SIGKILL' },
    'Coordinator handoff requires the confirmed child SIGKILL exit.',
  );
  const reported = crashed.message.coordinatorAuthority;
  const ownership = crashed.message.ownership;
  assert.equal(reported?.appId, APP_ID);
  assert.equal(reported?.status, CoordinatorAuthorityStatus.ACTIVE);
  assert.equal(ownership?.appId, APP_ID);
  assert.equal(reported?.coordinatorId, ownership?.sessionId);
  assert.equal(typeof ownership?.sessionId, 'string');
  assert.ok(ownership.sessionId.length > 0);

  const db = createLMDB({ path: fixture.configuration.controlPath });
  try {
    const authorityStore = createCoordinatorAuthority({
      db,
      tableName: fixture.configuration.tableName,
    });
    const observed = await authorityStore.get({ appId: APP_ID });
    // IPC and Jest create objects in different realms. Copy the flat snapshot
    // fields before strict comparison so prototypes cannot mask equal values.
    assert.deepEqual(
      { ...observed },
      { ...reported },
      'Refusing to replace authority other than the confirmed stopped child.',
    );
    const takeoverRequest = {
      appId: APP_ID,
      coordinatorId: `successor-known-stopped:${fixture.boundary}`,
      requestId: `successor-known-stopped-takeover:${fixture.boundary}`,
      observedAuthority: observed,
      confirmAuthorityReplacement: true,
    };
    const takeover = await authorityStore.takeover(takeoverRequest);
    expect(takeover).toMatchObject({
      applied: true,
      action: 'takeover',
      authority: {
        appId: APP_ID,
        status: CoordinatorAuthorityStatus.ACTIVE,
        epoch: reported.epoch + 1,
      },
    });
    const releaseRequest = {
      authority: takeover.authority,
      requestId: `successor-known-stopped-release:${fixture.boundary}`,
    };
    const released = await authorityStore.release(releaseRequest);
    expect(released).toMatchObject({
      applied: true,
      action: 'release',
      authority: {
        status: CoordinatorAuthorityStatus.RELEASED,
        epoch: takeover.authority.epoch,
      },
    });
    // The exact takeover receipt remains replayable after its temporary
    // successor is released; it never reacquires or changes current authority.
    await expect(authorityStore.takeover(takeoverRequest)).resolves.toEqual({
      ...takeover,
      applied: false,
    });
    await expect(authorityStore.release(releaseRequest)).resolves.toEqual({
      ...released,
      applied: false,
    });
    await expect(authorityStore.get({ appId: APP_ID })).resolves.toEqual(
      released.authority,
    );
    return released.authority;
  } finally {
    await db.close();
  }
}

/** @param {SuccessorCrashFixture} fixture @param {string} storeId */
async function readDestinationAuthority(fixture, storeId) {
  const db = await createApplicationStateDBClient('lmdb', {
    path: fixture.applicationStateConfiguration.storePath,
    readOnly: true,
  });
  try {
    return await createApplicationStateTable({
      db,
      tableName: fixture.applicationStateConfiguration.tableName,
    }).readCoordinatorAuthority({ storeId, namespace: APP_ID });
  } finally {
    await db.close();
  }
}

/**
 * @param {SuccessorCrashFixture} fixture
 * @param {Record<string, any> | null} effect
 */
async function readDestinationState(fixture, effect) {
  const db = await createApplicationStateDBClient('lmdb', {
    path: fixture.applicationStateConfiguration.storePath,
    readOnly: true,
  });
  try {
    const table = createApplicationStateTable({
      db,
      tableName: fixture.applicationStateConfiguration.tableName,
    });
    const businessKey = createApplicationStateBusinessKey(APP_ID, BUSINESS_KEY);
    return {
      receipt: effect
        ? await table.readReceipt(effect.destinationEffectId)
        : null,
      business: await table.readBusinessByPhysicalKey(
        businessKey.resourceId,
        businessKey.sortKey,
      ),
    };
  } finally {
    await db.close();
  }
}

/** @param {SuccessorCrashFixture} fixture */
function readAdapterEntries(fixture) {
  if (!existsSync(fixture.adapterMarkerPath)) return [];
  return readFileSync(fixture.adapterMarkerPath, 'utf8')
    .split('\n')
    .filter(Boolean);
}

/**
 * @param {Promise<ChildExit>} exitPromise
 * @param {string} boundary
 * @returns {Promise<ChildExit>}
 */
async function waitForChildExit(exitPromise, boundary) {
  let timer;
  try {
    return await Promise.race([
      exitPromise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `Successor crash child did not exit after SIGKILL at ${boundary}.`,
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
 * @param {SuccessorCrashFixture} fixture
 * @returns {Promise<{code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string, message: Record<string, any>} >}
 */
async function crashAtBoundary(fixture) {
  const child = spawn(
    process.execPath,
    [
      CHILD_PATH,
      JSON.stringify({
        boundary: fixture.boundary,
        appId: APP_ID,
        sourceRunId: fixture.sourceRunId,
        sourceEffectId: SOURCE_EFFECT_ID,
        successorId: fixture.successorId,
        reason: REASON,
        actor: ACTOR,
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
  /** @type {Promise<ChildExit>} */
  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
  });
  /** @type {(value: Record<string, any>) => void} */
  let resolveObservation = () => {};
  /** @type {(reason: unknown) => void} */
  let rejectObservation = () => {};
  /** @type {Promise<Record<string, any>>} */
  const observation = new Promise((resolve, reject) => {
    resolveObservation = resolve;
    rejectObservation = reject;
  });
  let settled = false;
  const fail = (/** @type {unknown} */ error) => {
    if (settled) return;
    settled = true;
    rejectObservation(error);
  };
  child.on('message', (/** @type {unknown} */ message) => {
    if (!message || typeof message !== 'object') return;
    const candidate = /** @type {Record<string, any>} */ (message);
    if (candidate.kind === 'fatal') {
      fail(new Error(`Successor crash child failed: ${candidate.error}`));
      return;
    }
    if (candidate.kind !== 'boundary') return;
    if (candidate.boundary !== fixture.boundary) {
      fail(
        new Error(
          `Successor crash child reached ${candidate.boundary}; expected ${fixture.boundary}.`,
        ),
      );
      return;
    }
    if (settled) return;
    settled = true;
    resolveObservation(candidate);
  });
  child.once('error', fail);
  child.once('exit', (code, signal) => {
    resolveExit({ code, signal });
    fail(
      new Error(
        `Successor crash child exited early: code=${code} signal=${signal} stdout=${stdout} stderr=${stderr}`,
      ),
    );
  });
  const boundaryTimer = setTimeout(() => {
    fail(
      new Error(
        `Successor crash child timed out at ${fixture.boundary}. stdout=${stdout} stderr=${stderr}`,
      ),
    );
  }, CHILD_BOUNDARY_TIMEOUT_MS);

  try {
    const message = await observation;
    child.kill('SIGKILL');
    const exit = await waitForChildExit(exitPromise, fixture.boundary);
    return { ...exit, stdout, stderr, message };
  } catch (error) {
    child.kill('SIGKILL');
    await waitForChildExit(exitPromise, fixture.boundary).catch(() => {});
    throw error;
  } finally {
    clearTimeout(boundaryTimer);
  }
}

/**
 * @param {Record<string, any> | null | undefined} view
 * @param {string} kind
 */
function singleStatus(view, kind) {
  const entries = view?.[kind] || [];
  expect(entries.length).toBeLessThanOrEqual(1);
  return entries[0]?.status || null;
}

/**
 * @param {Record<string, any>} sourceBefore
 * @param {Record<string, any>} sourceAfter
 */
function assertSourcePreserved(sourceBefore, sourceAfter) {
  expect(sourceAfter).toMatchObject({
    run: { runId: sourceBefore.run.runId, status: RunStatus.BLOCKED },
    invocations: [
      expect.objectContaining({ status: InvocationStatus.UNCERTAIN }),
    ],
  });
  expect(sourceAfter.attempts).toEqual(sourceBefore.attempts);
  expect(sourceAfter.effects).toEqual(sourceBefore.effects);
  expect(sourceAfter.events).toHaveLength(sourceBefore.events.length + 1);
  expect(sourceAfter.events.at(-1)).toMatchObject({
    type: 'effect-successor-authorized',
    actor: ACTOR,
  });
}

const itOnUnix = process.platform === 'win32' ? it.skip : it;

describe('real SIGKILL managed-effect successor recovery', () => {
  itOnUnix.each(CASES)(
    'preserves causal and destination truth after $label [$boundary]',
    async (scenario) => {
      const root = mkdtempSync(
        path.join(os.tmpdir(), 'wharfie-successor-crash-'),
      );
      try {
        const fixture = createFixture(root, scenario.boundary);
        const sourceBefore = await seedNotAppliedSource(fixture);
        expect(sourceBefore).toMatchObject({
          run: { status: RunStatus.BLOCKED },
          attempts: [
            expect.objectContaining({
              status: AttemptStatus.ABANDONED,
              coordinatorEpoch: 0,
            }),
          ],
          effects: [
            expect.objectContaining({
              status: EffectStatus.NOT_APPLIED,
              requestedBy: expect.objectContaining({ coordinatorEpoch: 0 }),
              startedBy: expect.objectContaining({ coordinatorEpoch: 0 }),
            }),
          ],
        });

        const crashed = await crashAtBoundary(fixture);
        expect(crashed).toMatchObject({
          code: null,
          signal: 'SIGKILL',
          stdout: '',
          stderr: '',
          message: {
            kind: 'boundary',
            boundary: scenario.boundary,
            detail: {
              targetRunId: expect.any(String),
            },
            ownership: {
              appId: APP_ID,
              ownerKind: 'manual',
              generation: 1,
            },
            coordinatorAuthority: {
              appId: APP_ID,
              status: CoordinatorAuthorityStatus.ACTIVE,
              epoch: expect.any(Number),
            },
          },
        });
        const childAuthority = crashed.message.coordinatorAuthority;
        expect(childAuthority.coordinatorId).toBe(
          crashed.message.ownership.sessionId,
        );
        expect(childAuthority.epoch).toBeGreaterThan(0);
        const storeId =
          sourceBefore.effects[0].destination.configuration.storeId;
        const childDestinationAuthority =
          createApplicationStateCoordinatorAuthorityRecord({
            storeId,
            namespace: APP_ID,
            authority: childAuthority,
          });
        expect(await readDestinationAuthority(fixture, storeId)).toEqual(
          childDestinationAuthority,
        );

        const targetRunId = crashed.message.detail.targetRunId;
        const sourceAfterCrash = await readRun(fixture, fixture.sourceRunId);
        const targetAfterCrash = await readRun(fixture, targetRunId);
        if (!sourceAfterCrash || !targetAfterCrash) {
          throw new Error(
            'Crashed successor source or target was not readable.',
          );
        }
        assertSourcePreserved(sourceBefore, sourceAfterCrash);
        expect(targetAfterCrash).toMatchObject({
          run: { runId: targetRunId, status: scenario.before.run },
          invocations: [
            expect.objectContaining({ status: scenario.before.invocation }),
          ],
        });
        expect(singleStatus(targetAfterCrash, 'attempts')).toBe(
          scenario.before.attempt,
        );
        expect(singleStatus(targetAfterCrash, 'effects')).toBe(
          scenario.before.effect,
        );
        for (const attempt of targetAfterCrash.attempts) {
          expect(attempt.coordinatorEpoch).toBe(childAuthority.epoch);
        }
        for (const effect of targetAfterCrash.effects) {
          expect(effect.requestedBy.coordinatorEpoch).toBe(
            childAuthority.epoch,
          );
          expect(effect.startedBy.coordinatorEpoch).toBe(childAuthority.epoch);
        }

        const targetEffectAfterCrash = targetAfterCrash.effects[0] || null;
        const destinationAfterCrash = await readDestinationState(
          fixture,
          targetEffectAfterCrash,
        );
        expect(destinationAfterCrash.receipt === null).toBe(
          scenario.before.mutationCount === 0,
        );
        expect(destinationAfterCrash.business === null).toBe(
          scenario.before.mutationCount === 0,
        );
        expect(readAdapterEntries(fixture)).toHaveLength(
          scenario.before.mutationCount,
        );

        const handoff = await replayAuthorization(fixture);
        expect(handoff).toMatchObject({
          applied: false,
          authorization: {
            successorId: fixture.successorId,
            source: {
              runId: fixture.sourceRunId,
              effectId: SOURCE_EFFECT_ID,
            },
            target: { runId: targetRunId },
          },
        });
        const sourceAfterReplay = await readRun(fixture, fixture.sourceRunId);
        const targetAfterReplay = await readRun(fixture, targetRunId);
        expect(sourceAfterReplay).toEqual(sourceAfterCrash);
        expect(targetAfterReplay).toEqual(targetAfterCrash);

        const releasedAuthority = await releaseKnownStoppedCoordinator(
          fixture,
          crashed,
        );
        // Control handoff does not implicitly advance the separate destination
        // fence. The next bound writable catalog must adopt its own authority.
        expect(await readDestinationAuthority(fixture, storeId)).toEqual(
          childDestinationAuthority,
        );

        if (scenario.boundary === Boundary.AUTHORIZATION) {
          expect(targetAfterReplay).toMatchObject({
            attempts: [],
            effects: [],
          });
          const execution = await executeAuthorizedTarget(fixture, handoff);
          expect(execution).toMatchObject({
            outcome: { disposition: 'completed', reused: false },
            coordinatorAuthority: {
              appId: APP_ID,
              status: CoordinatorAuthorityStatus.ACTIVE,
              epoch: releasedAuthority.epoch + 1,
            },
          });
          expect(execution.coordinatorAuthority.coordinatorId).not.toBe(
            childAuthority.coordinatorId,
          );
          const completed = await readRun(fixture, targetRunId);
          if (!completed) throw new Error('Authorized target disappeared.');
          expect(completed).toMatchObject({
            run: { status: RunStatus.COMPLETED },
            invocations: [
              expect.objectContaining({ status: InvocationStatus.COMPLETED }),
            ],
            attempts: [
              expect.objectContaining({
                status: AttemptStatus.COMPLETED,
                coordinatorEpoch: execution.coordinatorAuthority.epoch,
              }),
            ],
            effects: [
              expect.objectContaining({
                status: EffectStatus.COMPLETED,
                requestedBy: expect.objectContaining({
                  coordinatorEpoch: execution.coordinatorAuthority.epoch,
                }),
                startedBy: expect.objectContaining({
                  coordinatorEpoch: execution.coordinatorAuthority.epoch,
                }),
              }),
            ],
          });
          expect(await readDestinationAuthority(fixture, storeId)).toEqual(
            createApplicationStateCoordinatorAuthorityRecord({
              storeId,
              namespace: APP_ID,
              authority: execution.coordinatorAuthority,
            }),
          );
          const completedEffect = completed.effects[0];
          expect(await readDestinationState(fixture, completedEffect)).toEqual(
            expect.objectContaining({
              receipt: expect.any(Object),
              business: expect.any(Object),
            }),
          );
          // This completion uses the parent-side uninstrumented catalog; the
          // durable application-state receipt, not the child-only marker,
          // proves the first post-authorization dispatch occurred exactly once.
          expect(readAdapterEntries(fixture)).toEqual([]);
          const finalSource = await readRun(fixture, fixture.sourceRunId);
          if (!finalSource) throw new Error('Successor source disappeared.');
          assertSourcePreserved(sourceBefore, finalSource);
          return;
        }

        if (scenario.boundary !== Boundary.TERMINAL) {
          const retainedBeforeRecovery = await replayWithoutStart(
            fixture,
            handoff,
          );
          expect(retainedBeforeRecovery).toMatchObject({
            startCalls: 0,
            result: { outcome: { disposition: 'in-progress', reused: true } },
          });
          expect(await readRun(fixture, targetRunId)).toEqual(targetAfterCrash);
          expect(readAdapterEntries(fixture)).toHaveLength(
            scenario.before.mutationCount,
          );
        }

        const recovered = await recoverExecutionLedgerRun({
          runId: targetRunId,
          expectedAppId: APP_ID,
          actor: ACTOR,
          requireLocalOwnership: true,
          configuration: fixture.configuration,
          applicationStateConfiguration: fixture.applicationStateConfiguration,
        });
        if (!recovered) throw new Error('Target recovery returned no run.');
        for (const attempt of recovered.view.attempts) {
          expect(attempt.coordinatorEpoch).toBe(childAuthority.epoch);
        }
        for (const effect of recovered.view.effects) {
          expect(effect.requestedBy.coordinatorEpoch).toBe(
            childAuthority.epoch,
          );
          expect(effect.startedBy.coordinatorEpoch).toBe(childAuthority.epoch);
        }
        if (scenario.boundary === Boundary.TERMINAL) {
          expect(recovered).toMatchObject({
            recovery: {
              found: true,
              mayExecute: false,
              action: 'none',
              changed: false,
            },
            view: {
              run: { status: RunStatus.COMPLETED },
              invocations: [
                expect.objectContaining({ status: InvocationStatus.COMPLETED }),
              ],
              attempts: [
                expect.objectContaining({ status: AttemptStatus.COMPLETED }),
              ],
              effects: [
                expect.objectContaining({ status: EffectStatus.COMPLETED }),
              ],
            },
          });
          expect(recovered.view).toEqual(targetAfterCrash);
          const replay = await replayWithoutStart(fixture, handoff);
          expect(replay).toMatchObject({
            startCalls: 0,
            result: { outcome: { disposition: 'completed' } },
          });
          expect(await readRun(fixture, targetRunId)).toEqual(recovered.view);
          expect(
            await readDestinationState(fixture, recovered.view.effects[0]),
          ).toEqual(destinationAfterCrash);
          expect(readAdapterEntries(fixture)).toHaveLength(1);
          const finalSource = await readRun(fixture, fixture.sourceRunId);
          if (!finalSource) throw new Error('Successor source disappeared.');
          assertSourcePreserved(sourceBefore, finalSource);
          return;
        }

        expect(recovered).toMatchObject({
          recovery: {
            found: true,
            mayExecute: false,
            action: 'marked-successor-uncertain',
            changed: true,
          },
          view: {
            run: { status: RunStatus.BLOCKED },
            invocations: [
              expect.objectContaining({ status: InvocationStatus.UNCERTAIN }),
            ],
            attempts: [
              expect.objectContaining({ status: AttemptStatus.ABANDONED }),
            ],
            effects: [
              expect.objectContaining({ status: EffectStatus.UNCERTAIN }),
            ],
          },
        });
        const recoveredEffect = recovered.view.effects[0];
        expect(await readDestinationState(fixture, recoveredEffect)).toEqual(
          destinationAfterCrash,
        );
        expect(readAdapterEntries(fixture)).toHaveLength(
          scenario.before.mutationCount,
        );
        expect(recovered.view.events.slice(-1)).toMatchObject([
          { type: 'effect-successor-interrupted', actor: ACTOR },
        ]);

        const retained = await replayAuthorization(fixture);
        const replay = await replayWithoutStart(fixture, retained);
        expect(replay).toMatchObject({
          startCalls: 0,
          result: { outcome: { disposition: 'blocked' } },
        });
        expect(await readRun(fixture, targetRunId)).toEqual(recovered.view);

        const reconciled = await reconcileExecutionLedgerEffect({
          runId: targetRunId,
          effectId: recoveredEffect.effectId,
          reconciliationId: `target-${fixture.boundary}`,
          expectedAppId: APP_ID,
          actor: ACTOR,
          requireLocalOwnership: true,
          configuration: fixture.configuration,
          applicationStateConfiguration: fixture.applicationStateConfiguration,
        });
        if (!reconciled) {
          throw new Error('Target successor reconciliation returned no run.');
        }
        const completed = scenario.before.mutationCount === 1;
        expect(reconciled).toMatchObject({
          reconciliation: {
            effectId: recoveredEffect.effectId,
            status: completed
              ? EffectStatus.COMPLETED
              : EffectStatus.NOT_APPLIED,
            changed: true,
          },
          view: {
            run: {
              status: completed ? RunStatus.COMPLETED : RunStatus.FAILED,
            },
            invocations: [
              expect.objectContaining({
                status: completed
                  ? InvocationStatus.COMPLETED
                  : InvocationStatus.FAILED,
              }),
            ],
            attempts: [
              expect.objectContaining({ status: AttemptStatus.ABANDONED }),
            ],
            effects: [
              expect.objectContaining({
                status: completed
                  ? EffectStatus.COMPLETED
                  : EffectStatus.NOT_APPLIED,
                requestedBy: expect.objectContaining({
                  coordinatorEpoch: childAuthority.epoch,
                }),
                startedBy: expect.objectContaining({
                  coordinatorEpoch: childAuthority.epoch,
                }),
              }),
            ],
          },
        });
        expect(reconciled.view.attempts).toEqual(recovered.view.attempts);
        expect(reconciled.view.events.slice(-2)).toMatchObject([
          { type: 'effect-successor-interrupted', actor: ACTOR },
          { type: 'effect-successor-reconciled', actor: ACTOR },
        ]);
        expect(
          await readDestinationState(fixture, reconciled.view.effects[0]),
        ).toEqual(destinationAfterCrash);
        expect(readAdapterEntries(fixture)).toHaveLength(
          scenario.before.mutationCount,
        );
        const replayAfterReconciliation = await replayWithoutStart(
          fixture,
          retained,
        );
        expect(replayAfterReconciliation).toMatchObject({
          startCalls: 0,
          result: {
            outcome: {
              disposition: completed ? 'completed' : 'failed',
            },
          },
        });
        expect(await readRun(fixture, targetRunId)).toEqual(reconciled.view);
        const finalSource = await readRun(fixture, fixture.sourceRunId);
        if (!finalSource) throw new Error('Successor source disappeared.');
        assertSourcePreserved(sourceBefore, finalSource);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
