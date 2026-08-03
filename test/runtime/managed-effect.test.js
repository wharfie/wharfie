/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getAdapterMatrix } from '../helpers/db-adapters.js';
import { ActivityProtocolTranscriptValidator } from '../../src/core/runtime/activity-protocol.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  AttemptStatus,
  EffectStatus,
  ExecutionLedgerConflictError,
  ExecutionLedgerProjectionError,
  ExecutionLedgerTransitionConflictError,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
  createManagedEffectDestinationId,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import {
  getAttemptProjectionSortKey,
  getEffectProjectionSortKey,
  getEventSortKey,
  getInvocationProjectionSortKey,
  getRunProjectionSortKey,
  getTransitionSortKey,
} from '../../src/core/lib/ledger/record-key.js';
import {
  ManagedEffectDispatchNotAuthorizedError,
  ManagedEffectRecoveryAction,
  ManagedEffectUncertainError,
  executeManagedEffect,
  recoverStoppedManagedEffects,
} from '../../src/core/runtime/managed-effect.js';

const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const RUN_ID = 'managed-effect-run';
const INVOCATION_ID = 'main';
const ACTIVITY_ID = 'managed';
const FENCING_TOKEN = 'managed-effect-fence';
const EFFECT_ID = 'write-record';
const ACTOR = Object.freeze({ kind: 'runtime', id: 'managed-effect-test' });
const VERIFIER_DESCRIPTOR = Object.freeze({
  kind: 'test-destination',
  version: 1,
});
const DESTINATION_DESCRIPTOR = Object.freeze({
  kind: 'test-store',
  version: 1,
  bindingId: 'primary',
  configuration: Object.freeze({
    namespace: 'managed-effect-test',
    tableName: 'records',
  }),
});

function createClock() {
  let now = 1_800_000_000_000;
  return () => {
    now += 1;
    return now;
  };
}

/**
 * @param {string} attemptId - Physical attempt identity.
 * @param {Record<string, any>} [overrides] - Frame overrides.
 * @returns {Record<string, any>} - Effect-request frame.
 */
function effectRequest(attemptId, overrides = {}) {
  return {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'effect-request',
    attemptId,
    sequence: 1,
    effectId: EFFECT_ID,
    capability: 'key-value',
    operation: 'put',
    input: { key: 'answer', value: 42 },
    requestedReplayProperties: ['idempotent'],
    ...overrides,
  };
}

/**
 * @param {((input: Record<string, any>) => boolean) | undefined} [verify] - Custom verifier.
 * @returns {{kind: string, version: number, verify: (input: Record<string, any>) => boolean}} - Verifier registration.
 */
function destinationVerifier(verify = undefined) {
  return {
    ...VERIFIER_DESCRIPTOR,
    verify:
      verify ??
      ((input) =>
        input.outcome.evidence.destinationEffectId ===
          input.effect.destinationEffectId &&
        input.outcome.evidence.operation === input.request.operation),
  };
}

/**
 * @param {Parameters<typeof executeManagedEffect>[0]['adapter']['execute']} execute - Adapter execution.
 * @param {Record<string, any>} [overrides] - Adapter overrides.
 * @returns {Parameters<typeof executeManagedEffect>[0]['adapter']} - Managed adapter.
 */
function managedAdapter(execute, overrides = {}) {
  return /** @type {Parameters<typeof executeManagedEffect>[0]['adapter']} */ ({
    descriptor: { id: 'test-adapter', version: 1 },
    destination: DESTINATION_DESCRIPTOR,
    verifier: VERIFIER_DESCRIPTOR,
    substantiatedReplayProperties: ['idempotent'],
    execute,
    ...overrides,
  });
}

/** Persist one exact request and optional STARTED boundary without dispatch. */
async function retainManagedEffect(
  /** @type {Record<string, any>} */ harness,
  /** @type {{effectId?: string, status?: 'PENDING'|'STARTED', sequence?: number, prefix?: string}} */ options = {},
) {
  const effectId = options.effectId || EFFECT_ID;
  const prefix = options.prefix || `recovery-${effectId}`;
  const request = effectRequest(harness.started.attempt.attemptId, {
    effectId,
    sequence: options.sequence || 1,
  });
  const current = await harness.ledger.rebuildRun(RUN_ID);
  if (!current) throw new Error('Expected retained recovery run.');
  const requested = await harness.ledger.recordManagedEffectRequest({
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    attemptId: harness.started.attempt.attemptId,
    fencingToken: FENCING_TOKEN,
    generation: 1,
    expectedVersion: current.run.version,
    transitionId: `${prefix}-request`,
    request,
    adapter: { id: 'test-adapter', version: 1 },
    destination: DESTINATION_DESCRIPTOR,
    verifier: VERIFIER_DESCRIPTOR,
    substantiatedReplayProperties: ['idempotent'],
  });
  if (options.status === 'PENDING') {
    return { request, requested };
  }
  const started = await harness.ledger.markManagedEffectStarted({
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    attemptId: harness.started.attempt.attemptId,
    effectId,
    fencingToken: FENCING_TOKEN,
    generation: 1,
    expectedVersion: requested.run.version,
    expectedEffectVersion: requested.effect.version,
    transitionId: `${prefix}-start`,
  });
  return { request, requested, started };
}

/**
 * @param {{create: () => Promise<{db: any, cleanup: () => Promise<void>}>}} adapter - DB adapter fixture.
 * @param {{kind: string, version: number, verify: (input: Record<string, any>) => boolean}[]} [verifiers] - Verifier registry.
 * @returns {Promise<Record<string, any>>} - Started managed-effect harness.
 */
async function createHarness(adapter, verifiers = [destinationVerifier()]) {
  const { db, cleanup: cleanupDb } = await adapter.create();
  const payloadPath = mkdtempSync(join(tmpdir(), 'wharfie-effect-payload-'));
  const payloadStore = createLocalExecutionPayloadStore({
    path: payloadPath,
    storeId: 'managed-effect-test',
  });
  const ledger = createExecutionLedger({
    db,
    tableName: 'managed-effect-ledger',
    payloadStore,
    effectEvidenceVerifiers: verifiers,
    now: createClock(),
  });
  const created = await ledger.createManualRun({
    runId: RUN_ID,
    appId: 'managed-effect-app',
    revisionId: REVISION_ID,
    invocationId: INVOCATION_ID,
    activityId: ACTIVITY_ID,
    input: { task: 'write' },
    callerMetadata: { source: 'test' },
    transitionId: 'create',
  });
  const claimed = await ledger.claimInvocation({
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    fencingToken: FENCING_TOKEN,
    expectedGeneration: 0,
    expectedVersion: created.run.version,
    transitionId: 'claim',
  });
  const started = await ledger.markAttemptStarted({
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    attemptId: claimed.attempt.attemptId,
    fencingToken: FENCING_TOKEN,
    generation: claimed.attempt.generation,
    expectedVersion: claimed.run.version,
    transitionId: 'start',
  });
  return {
    db,
    ledger,
    payloadStore,
    started,
    async cleanup() {
      await cleanupDb();
      rmSync(payloadPath, { recursive: true, force: true });
    },
  };
}

/**
 * @param {Record<string, any>} startFrame - Exact persisted start frame.
 * @param {Record<string, any>} request - Effect request.
 * @param {Record<string, any>} resultFrame - Persisted effect result.
 * @returns {Record<string, any>} - Complete attempt evidence.
 */
function completedEvidence(startFrame, request, resultFrame) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const start = transcript.acceptHostFrame(startFrame);
  const acceptedRequest = transcript.acceptComponentFrame(request);
  const acceptedResult = transcript.acceptHostFrame(resultFrame);
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId: start.attemptId,
    sequence: 2,
    result: { persisted: true },
  });
  return {
    status: terminal.type,
    start,
    terminal,
    frames: [start, acceptedRequest, acceptedResult, terminal],
    transcript: transcript.snapshot(),
  };
}

/**
 * @param {Record<string, any>} startFrame - Exact persisted start frame.
 * @returns {Record<string, any>} - Complete evidence that omits all effects.
 */
function completedEvidenceWithoutEffects(startFrame) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const start = transcript.acceptHostFrame(startFrame);
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId: start.attemptId,
    sequence: 1,
    result: { persisted: true },
  });
  return {
    status: terminal.type,
    start,
    terminal,
    frames: [start, terminal],
    transcript: transcript.snapshot(),
  };
}

/**
 * Let a durable method finish, then hide a bounded number of its responses.
 * @param {Record<string, any>} ledger - Real ledger store.
 * @param {string} method - Method whose responses are lost.
 * @param {number} count - Number of completed responses to hide.
 * @returns {Record<string, any>} - Delegating response-loss test store.
 */
function withLostResponses(ledger, method, count) {
  let remaining = count;
  /** @type {(...args: any[]) => Promise<any>} */
  const wrapped = async (...args) => {
    const result = await ledger[method](...args);
    if (remaining > 0) {
      remaining -= 1;
      throw new Error(`simulated lost ${method} response`);
    }
    return result;
  };
  return {
    ...ledger,
    [method]: wrapped,
  };
}

/**
 * Insert a matching transition through the base ledger exactly when a racing
 * ledger first looks for its receipt, after that ledger already folded state.
 * @param {Record<string, any>} harness - Base managed-effect harness.
 * @param {string} transitionId - Receipt identity to intercept.
 * @param {() => Promise<any>} insert - Matching base-ledger transition.
 * @returns {ReturnType<typeof createExecutionLedger>} - Racing ledger.
 */
function createReceiptRaceLedger(harness, transitionId, insert) {
  let injectReceipt = true;
  /** @type {ProxyHandler<any>} */
  const handler = {
    get(target, property) {
      if (property === 'get') {
        return async (/** @type {Record<string, any>} */ input) => {
          if (
            injectReceipt &&
            input.sortKeyValue === getTransitionSortKey(transitionId)
          ) {
            injectReceipt = false;
            await insert();
          }
          return await target.get(input);
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  };
  return createExecutionLedger({
    db: new Proxy(harness.db, handler),
    tableName: 'managed-effect-ledger',
    payloadStore: harness.payloadStore,
    effectEvidenceVerifiers: [destinationVerifier()],
  });
}

/**
 * Rehash one event and rewrite every affected mutable projection so replay
 * reaches semantic fold validation instead of stopping at detached hashes.
 * @param {{db: any, sequence: number, payload: Record<string, any>}} input - Forged event snapshot.
 * @returns {Promise<void>}
 */
async function rewriteEffectEvent(input) {
  const event = await input.db.get({
    tableName: 'managed-effect-ledger',
    keyName: 'run_id',
    keyValue: RUN_ID,
    sortKeyName: 'sort_key',
    sortKeyValue: getEventSortKey(input.sequence),
    consistentRead: true,
  });
  if (!event) throw new Error('Expected effect event to rewrite');
  const eventId = createCanonicalJsonSha256Id({
    domain: 'wharfie:execution-ledger-event:v10',
    prefix: 'wle',
    value: {
      schemaVersion: event.schema_version,
      runId: event.run_id,
      sequence: event.sequence,
      transitionId: event.transition_id,
      requestDigest: event.request_digest,
      type: event.type,
      observedAt: event.observed_at,
      actor: event.actor,
      fence: event.fence,
      payload: input.payload,
    },
    valuePath: 'managed-effect forged event',
  });
  /**
   * @param {string} sortKeyValue - Record sort key.
   * @param {any[]} updates - Atomic field updates.
   * @returns {Promise<void>}
   */
  const update = async (sortKeyValue, updates) => {
    await input.db.update({
      tableName: 'managed-effect-ledger',
      keyName: 'run_id',
      keyValue: RUN_ID,
      sortKeyName: 'sort_key',
      sortKeyValue,
      updates,
    });
  };
  await update(getEventSortKey(input.sequence), [
    { property: ['payload'], propertyValue: input.payload },
    { property: ['event_id'], propertyValue: eventId },
  ]);
  await update(getTransitionSortKey(event.transition_id), [
    { property: ['event_id'], propertyValue: eventId },
  ]);
  await update(getRunProjectionSortKey(), [
    { property: ['data'], propertyValue: input.payload.run },
  ]);
  await update(getInvocationProjectionSortKey(INVOCATION_ID), [
    { property: ['data'], propertyValue: input.payload.invocation },
    {
      property: ['generation'],
      propertyValue: input.payload.invocation.generation,
    },
  ]);
  await update(getAttemptProjectionSortKey(input.payload.attempt.attemptId), [
    { property: ['data'], propertyValue: input.payload.attempt },
  ]);
  await update(
    getEffectProjectionSortKey(INVOCATION_ID, input.payload.effect.effectId),
    [{ property: ['data'], propertyValue: input.payload.effect }],
  );
}

for (const dbAdapter of getAdapterMatrix()) {
  describe(`${dbAdapter.name} managed-effect foundation`, () => {
    test('persists request, start, verified outcome, and terminal transcript truth', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        const execute = jest.fn(
          async (
            /** @type {{destinationEffectId: string, destination: Record<string, any>}} */ {
              destinationEffectId,
              destination,
            },
          ) => {
            expect(destination).toEqual(DESTINATION_DESCRIPTOR);
            const effect = await harness.ledger.getEffect(
              RUN_ID,
              INVOCATION_ID,
              EFFECT_ID,
            );
            expect(effect).toMatchObject({
              status: EffectStatus.STARTED,
              destinationEffectId,
            });
            return {
              ok: true,
              result: { written: true },
              evidence: { destinationEffectId, operation: 'put' },
            };
          },
        );
        const request = effectRequest(harness.started.attempt.attemptId);
        const frame = await executeManagedEffect({
          ledger: harness.ledger,
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          request,
          adapter: managedAdapter(execute),
          actor: ACTOR,
        });

        expect(frame).toEqual({
          protocol: 'wharfie.activity',
          protocolVersion: 1,
          type: 'effect-result',
          attemptId: harness.started.attempt.attemptId,
          effectId: EFFECT_ID,
          ok: true,
          result: { written: true },
          substantiatedReplayProperties: ['idempotent'],
          evidence: {
            destinationEffectId: createManagedEffectDestinationId({
              appId: 'managed-effect-app',
              runId: RUN_ID,
              invocationId: INVOCATION_ID,
              effectId: EFFECT_ID,
            }),
            operation: 'put',
          },
        });
        expect(Object.isFrozen(frame)).toBe(true);
        expect(execute).toHaveBeenCalledTimes(1);

        const afterEffect = await harness.ledger.rebuildRun(RUN_ID);
        if (!afterEffect) throw new Error('Expected managed-effect run');
        expect(afterEffect.run).toMatchObject({
          status: RunStatus.RUNNING,
          version: 6,
        });
        expect(afterEffect.invocations[0]).toMatchObject({
          status: InvocationStatus.RUNNING,
        });
        expect(afterEffect.attempts[0]).toMatchObject({
          status: AttemptStatus.STARTED,
          startedAt: harness.started.attempt.startedAt,
        });
        expect(afterEffect.effects).toEqual([
          expect.objectContaining({
            effectId: EFFECT_ID,
            status: EffectStatus.COMPLETED,
            requestedReplayProperties: ['idempotent'],
            substantiatedReplayProperties: ['idempotent'],
            terminal: { ok: true },
          }),
        ]);
        expect(
          (await harness.ledger.getEvents(RUN_ID)).map(
            (/** @type {Record<string, any>} */ event) => event.type,
          ),
        ).toEqual([
          'manual-run-created',
          'attempt-claimed',
          'attempt-started',
          'effect-requested',
          'effect-started',
          'effect-completed',
        ]);

        const evidence = completedEvidence(
          harness.started.startFrame,
          request,
          frame,
        );
        await expect(
          harness.ledger.commitVerifiedAttemptTerminal({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId: harness.started.attempt.attemptId,
            fencingToken: FENCING_TOKEN,
            generation: 1,
            expectedVersion: afterEffect.run.version,
            transitionId: 'terminal',
            evidence,
            actor: ACTOR,
          }),
        ).resolves.toMatchObject({
          run: { status: RunStatus.COMPLETED },
          invocation: { status: InvocationStatus.COMPLETED },
          attempt: { status: AttemptStatus.COMPLETED },
        });

        await expect(
          executeManagedEffect({
            ledger: harness.ledger,
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            request,
            adapter: managedAdapter(execute),
            actor: ACTOR,
          }),
        ).resolves.toEqual(frame);
        expect(execute).toHaveBeenCalledTimes(1);

        const redirectedExecute = jest.fn();
        await expect(
          executeManagedEffect({
            ledger: harness.ledger,
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            request,
            adapter: managedAdapter(redirectedExecute, {
              destination: {
                ...DESTINATION_DESCRIPTOR,
                configuration: {
                  ...DESTINATION_DESCRIPTOR.configuration,
                  tableName: 'redirected-records',
                },
              },
            }),
            actor: ACTOR,
          }),
        ).rejects.toThrow(/conflicts with retained request/i);
        expect(redirectedExecute).not.toHaveBeenCalled();
      } finally {
        await harness.cleanup();
      }
    });

    test('returns a substantiated destination failure without blocking the attempt', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        const frame = await executeManagedEffect({
          ledger: harness.ledger,
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          request: effectRequest(harness.started.attempt.attemptId),
          adapter: managedAdapter(
            async (
              /** @type {{destinationEffectId: string}} */ {
                destinationEffectId,
              },
            ) => ({
              ok: false,
              error: {
                code: 'destination-rejected',
                name: 'DestinationError',
                message: 'The destination rejected the write.',
                details: {},
              },
              evidence: { destinationEffectId, operation: 'put' },
            }),
          ),
        });
        expect(frame).toMatchObject({
          type: 'effect-result',
          ok: false,
          error: { code: 'destination-rejected' },
        });
        await expect(harness.ledger.rebuildRun(RUN_ID)).resolves.toMatchObject({
          run: { status: RunStatus.RUNNING },
          attempts: [
            expect.objectContaining({ status: AttemptStatus.STARTED }),
          ],
          effects: [expect.objectContaining({ status: EffectStatus.FAILED })],
        });
      } finally {
        await harness.cleanup();
      }
    });

    test('recovers request and outcome response loss without repeating a begun delivery', async () => {
      const requestLoss = await createHarness(dbAdapter);
      try {
        const execute = jest.fn(
          async (
            /** @type {{destinationEffectId: string}} */ {
              destinationEffectId,
            },
          ) => ({
            ok: true,
            result: { written: true },
            evidence: { destinationEffectId, operation: 'put' },
          }),
        );
        const frame = await executeManagedEffect({
          ledger: /** @type {any} */ (
            withLostResponses(
              requestLoss.ledger,
              'recordManagedEffectRequest',
              1,
            )
          ),
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          request: effectRequest(requestLoss.started.attempt.attemptId),
          adapter: managedAdapter(execute),
        });
        expect(frame).toMatchObject({ type: 'effect-result', ok: true });
        expect(execute).toHaveBeenCalledTimes(1);
      } finally {
        await requestLoss.cleanup();
      }

      const startLoss = await createHarness(dbAdapter);
      try {
        const execute = jest.fn();
        const request = effectRequest(startLoss.started.attempt.attemptId);
        await expect(
          executeManagedEffect({
            ledger: /** @type {any} */ (
              withLostResponses(startLoss.ledger, 'markManagedEffectStarted', 1)
            ),
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            request,
            adapter: managedAdapter(execute),
          }),
        ).rejects.toBeInstanceOf(ManagedEffectDispatchNotAuthorizedError);
        await expect(
          executeManagedEffect({
            ledger: startLoss.ledger,
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            request,
            adapter: managedAdapter(execute),
          }),
        ).rejects.toBeInstanceOf(ManagedEffectDispatchNotAuthorizedError);
        expect(execute).not.toHaveBeenCalled();
        await expect(
          startLoss.ledger.getEffect(RUN_ID, INVOCATION_ID, EFFECT_ID),
        ).resolves.toMatchObject({ status: EffectStatus.STARTED });
      } finally {
        await startLoss.cleanup();
      }

      const outcomeLoss = await createHarness(dbAdapter);
      try {
        const execute = jest.fn(
          async (
            /** @type {{destinationEffectId: string}} */ {
              destinationEffectId,
            },
          ) => ({
            ok: true,
            result: { written: true },
            evidence: { destinationEffectId, operation: 'put' },
          }),
        );
        const frame = await executeManagedEffect({
          ledger: /** @type {any} */ (
            withLostResponses(
              outcomeLoss.ledger,
              'commitManagedEffectOutcome',
              2,
            )
          ),
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          request: effectRequest(outcomeLoss.started.attempt.attemptId),
          adapter: managedAdapter(execute),
        });
        expect(frame).toMatchObject({ type: 'effect-result', ok: true });
        expect(execute).toHaveBeenCalledTimes(1);
        await expect(
          outcomeLoss.ledger.getEffect(RUN_ID, INVOCATION_ID, EFFECT_ID),
        ).resolves.toMatchObject({ status: EffectStatus.COMPLETED });
      } finally {
        await outcomeLoss.cleanup();
      }
    });

    test('cancels a PENDING-only set atomically without a destination probe', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        const retained = await retainManagedEffect(harness, {
          status: 'PENDING',
        });
        const beforeEvents = await harness.ledger.getEvents(RUN_ID);
        await expect(
          recoverStoppedManagedEffects({
            ledger: harness.ledger,
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            actor: ACTOR,
          }),
        ).resolves.toEqual({
          action: ManagedEffectRecoveryAction.SETTLED_MANAGED_EFFECT_SET,
          changed: true,
          managedEffects: [
            {
              effectId: EFFECT_ID,
              action: ManagedEffectRecoveryAction.CANCELLED_BEFORE_START,
              status: EffectStatus.CANCELLED,
            },
          ],
        });
        const after = await harness.ledger.rebuildRun(RUN_ID);
        expect(after).toMatchObject({
          run: { status: RunStatus.BLOCKED },
          invocations: [
            expect.objectContaining({ status: InvocationStatus.UNCERTAIN }),
          ],
          attempts: [
            expect.objectContaining({ status: AttemptStatus.ABANDONED }),
          ],
          effects: [
            expect.objectContaining({ status: EffectStatus.CANCELLED }),
          ],
        });
        expect(after?.events).toHaveLength(beforeEvents.length + 1);
        expect(after?.events.at(-1)).toMatchObject({
          type: 'attempt-became-uncertain',
          actor: ACTOR,
          payload: {
            effects: [
              expect.objectContaining({ status: EffectStatus.CANCELLED }),
            ],
          },
        });
        const execute = jest.fn();
        await expect(
          executeManagedEffect({
            ledger: harness.ledger,
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            request: retained.request,
            adapter: managedAdapter(execute),
          }),
        ).rejects.toBeInstanceOf(ManagedEffectDispatchNotAuthorizedError);
        expect(execute).not.toHaveBeenCalled();
      } finally {
        await harness.cleanup();
      }
    });

    test('probes every STARTED sibling before one mixed-set settlement', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        await retainManagedEffect(harness, {
          effectId: 'a-pending',
          status: 'PENDING',
          sequence: 1,
        });
        const recovered = await retainManagedEffect(harness, {
          effectId: 'b-recovered',
          sequence: 2,
        });
        await retainManagedEffect(harness, {
          effectId: 'c-absent',
          sequence: 3,
        });
        const before = await harness.ledger.rebuildRun(RUN_ID);
        const expectedAttempt = before?.attempts.find(
          (/** @type {Record<string, any>} */ candidate) =>
            candidate.invocationId === INVOCATION_ID,
        );
        if (!before || !expectedAttempt) {
          throw new Error('Expected mixed managed-effect recovery set.');
        }
        const beforeEvents = await harness.ledger.getEvents(RUN_ID);
        const recoverOutcome = jest.fn(
          async (/** @type {Record<string, any>} */ input) => {
            expect(Object.isFrozen(input)).toBe(true);
            expect(Object.isFrozen(input.request)).toBe(true);
            if (input.identity.effectId === 'c-absent') return null;
            return {
              ok: true,
              result: { written: true },
              evidence: {
                destinationEffectId: input.destinationEffectId,
                operation: 'put',
              },
            };
          },
        );
        const result = await recoverStoppedManagedEffects({
          ledger: harness.ledger,
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          recoverOutcome,
          actor: ACTOR,
          expectedAttempt,
          expectedEffects: [...before.effects].reverse(),
        });
        expect(result).toEqual({
          action: ManagedEffectRecoveryAction.SETTLED_MANAGED_EFFECT_SET,
          changed: true,
          managedEffects: [
            {
              effectId: 'a-pending',
              action: ManagedEffectRecoveryAction.CANCELLED_BEFORE_START,
              status: EffectStatus.CANCELLED,
            },
            {
              effectId: 'b-recovered',
              action: ManagedEffectRecoveryAction.OUTCOME_RECOVERED,
              status: EffectStatus.COMPLETED,
            },
            {
              effectId: 'c-absent',
              action: ManagedEffectRecoveryAction.OUTCOME_UNCERTAIN,
              status: EffectStatus.UNCERTAIN,
            },
          ],
        });
        expect(recoverOutcome).toHaveBeenCalledTimes(2);
        expect(
          recoverOutcome.mock.calls.map(([input]) => input.identity.effectId),
        ).toEqual(['b-recovered', 'c-absent']);
        expect(recovered.started?.effect.status).toBe(EffectStatus.STARTED);
        const after = await harness.ledger.rebuildRun(RUN_ID);
        expect(
          after?.effects.map(
            (/** @type {Record<string, any>} */ effect) => effect.status,
          ),
        ).toEqual([
          EffectStatus.CANCELLED,
          EffectStatus.COMPLETED,
          EffectStatus.UNCERTAIN,
        ]);
        expect(after?.events).toHaveLength(beforeEvents.length + 1);
        expect(after?.events.at(-1)).toMatchObject({
          type: 'attempt-became-uncertain',
          actor: ACTOR,
        });
      } finally {
        await harness.cleanup();
      }
    });

    test('rejects a stale expected attempt fence before destination recovery', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        await retainManagedEffect(harness, { status: 'STARTED' });
        const before = await harness.ledger.rebuildRun(RUN_ID);
        const attempt = before?.attempts.find(
          (/** @type {Record<string, any>} */ candidate) =>
            candidate.invocationId === INVOCATION_ID,
        );
        if (!before || !attempt) {
          throw new Error('Expected retained managed-effect attempt.');
        }
        const recoverOutcome = jest.fn(async () => null);

        await expect(
          recoverStoppedManagedEffects({
            ledger: harness.ledger,
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            recoverOutcome,
            expectedAttempt: {
              ...attempt,
              generation: attempt.generation + 1,
            },
            expectedEffects: before.effects,
          }),
        ).rejects.toBeInstanceOf(ManagedEffectDispatchNotAuthorizedError);

        await expect(
          recoverStoppedManagedEffects({
            ledger: harness.ledger,
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            recoverOutcome,
            expectedAttempt: attempt,
            expectedEffects: before.effects.map(
              (
                /** @type {Record<string, any>} */ effect,
                /** @type {number} */ index,
              ) =>
                index === 0
                  ? { ...effect, version: effect.version + 1 }
                  : effect,
            ),
          }),
        ).rejects.toBeInstanceOf(ManagedEffectDispatchNotAuthorizedError);

        expect(recoverOutcome).not.toHaveBeenCalled();
        await expect(harness.ledger.rebuildRun(RUN_ID)).resolves.toEqual(
          before,
        );
      } finally {
        await harness.cleanup();
      }
    });

    test('leaves the complete set unchanged when any receipt probe fails', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        await retainManagedEffect(harness, {
          effectId: 'a-pending',
          status: 'PENDING',
          sequence: 1,
        });
        await retainManagedEffect(harness, {
          effectId: 'b-started',
          sequence: 2,
        });
        await retainManagedEffect(harness, {
          effectId: 'c-corrupt',
          sequence: 3,
        });
        const before = await harness.ledger.rebuildRun(RUN_ID);
        const recoverOutcome = jest.fn(
          async (/** @type {Record<string, any>} */ input) => {
            if (input.identity.effectId === 'c-corrupt') {
              throw new Error('destination receipt is corrupt');
            }
            return null;
          },
        );
        await expect(
          recoverStoppedManagedEffects({
            ledger: harness.ledger,
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            recoverOutcome,
          }),
        ).rejects.toThrow('destination receipt is corrupt');
        await expect(harness.ledger.rebuildRun(RUN_ID)).resolves.toEqual(
          before,
        );
        expect(recoverOutcome).toHaveBeenCalledTimes(2);
      } finally {
        await harness.cleanup();
      }
    });

    test('rejects a complete-set contract race after probes without settling it', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        await retainManagedEffect(harness, {
          effectId: 'a-started',
          sequence: 1,
        });
        const beforeEvents = await harness.ledger.getEvents(RUN_ID);
        const recoverOutcome = jest.fn(async () => {
          await retainManagedEffect(harness, {
            effectId: 'b-raced-pending',
            status: 'PENDING',
            sequence: 2,
          });
          return null;
        });
        await expect(
          recoverStoppedManagedEffects({
            ledger: harness.ledger,
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            recoverOutcome,
          }),
        ).rejects.toBeInstanceOf(ManagedEffectDispatchNotAuthorizedError);
        const after = await harness.ledger.rebuildRun(RUN_ID);
        expect(after?.run.status).toBe(RunStatus.RUNNING);
        expect(
          after?.effects.map(
            (/** @type {Record<string, any>} */ effect) => effect.status,
          ),
        ).toEqual([EffectStatus.STARTED, EffectStatus.PENDING]);
        expect(after?.events).toHaveLength(beforeEvents.length + 1);
        expect(after?.events.at(-1)?.type).toBe('effect-requested');
      } finally {
        await harness.cleanup();
      }
    });

    test('attributes a lost settlement response only to its exact retained event', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        await retainManagedEffect(harness, { status: 'PENDING' });
        const lostResponseLedger = {
          ...harness.ledger,
          async settleStoppedAttemptManagedEffects(
            /** @type {Record<string, any>} */ options,
          ) {
            await harness.ledger.settleStoppedAttemptManagedEffects(options);
            throw new Error('settlement response lost');
          },
        };
        await expect(
          recoverStoppedManagedEffects({
            ledger: /** @type {any} */ (lostResponseLedger),
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            actor: ACTOR,
          }),
        ).resolves.toMatchObject({
          action: ManagedEffectRecoveryAction.SETTLED_MANAGED_EFFECT_SET,
          changed: true,
          managedEffects: [
            {
              effectId: EFFECT_ID,
              status: EffectStatus.CANCELLED,
            },
          ],
        });
      } finally {
        await harness.cleanup();
      }
    });

    test('redelivers a terminal outcome won by another caller after the pending read', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        let settleBeforeReplay = true;
        const racingLedger = {
          ...harness.ledger,
          async markManagedEffectStarted(
            /** @type {Record<string, any>} */ options,
          ) {
            if (settleBeforeReplay) {
              settleBeforeReplay = false;
              const begun =
                await harness.ledger.markManagedEffectStarted(options);
              await harness.ledger.commitManagedEffectOutcome({
                runId: RUN_ID,
                invocationId: INVOCATION_ID,
                attemptId: begun.attempt.attemptId,
                effectId: EFFECT_ID,
                fencingToken: begun.attempt.fencingToken,
                generation: begun.attempt.generation,
                expectedVersion: begun.run.version,
                expectedEffectVersion: begun.effect.version,
                transitionId: 'competing-effect-outcome',
                outcome: {
                  ok: true,
                  result: { winner: 'competing-caller' },
                  evidence: {
                    destinationEffectId: begun.effect.destinationEffectId,
                    operation: 'put',
                  },
                },
              });
            }
            return await harness.ledger.markManagedEffectStarted(options);
          },
        };
        const execute = jest.fn();

        await expect(
          executeManagedEffect({
            ledger: /** @type {any} */ (racingLedger),
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            request: effectRequest(harness.started.attempt.attemptId),
            adapter: managedAdapter(execute),
          }),
        ).resolves.toMatchObject({
          type: 'effect-result',
          ok: true,
          result: { winner: 'competing-caller' },
        });
        expect(execute).not.toHaveBeenCalled();
      } finally {
        await harness.cleanup();
      }
    });

    test('snapshots adapter code, durable contract, actor, and signal before the first await', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        let releaseFirstRead = () => {};
        /** @type {Promise<void>} */
        const firstReadGate = new Promise((resolve) => {
          releaseFirstRead = resolve;
        });
        let announceFirstRead = () => {};
        /** @type {Promise<void>} */
        const firstReadEntered = new Promise((resolve) => {
          announceFirstRead = resolve;
        });
        let gateFirstRead = true;
        const gatedLedger = {
          ...harness.ledger,
          async readManagedEffectDelivery(
            /** @type {string} */ runId,
            /** @type {string} */ invocationId,
            /** @type {string} */ effectId,
          ) {
            if (gateFirstRead) {
              gateFirstRead = false;
              announceFirstRead();
              await firstReadGate;
            }
            return await harness.ledger.readManagedEffectDelivery(
              runId,
              invocationId,
              effectId,
            );
          },
        };
        const originalSignal = new AbortController().signal;
        const originalExecute = jest.fn(
          async (
            /** @type {{destinationEffectId: string, destination: Record<string, any>, signal?: AbortSignal}} */ {
              destinationEffectId,
              destination,
              signal,
            },
          ) => {
            expect(signal).toBe(originalSignal);
            expect(destination).toEqual(DESTINATION_DESCRIPTOR);
            expect(Object.isFrozen(destination)).toBe(true);
            expect(Object.isFrozen(destination.configuration)).toBe(true);
            return {
              ok: true,
              result: { implementation: 'original' },
              evidence: { destinationEffectId, operation: 'put' },
            };
          },
        );
        const replacementExecute = jest.fn(
          async (
            /** @type {{destinationEffectId: string}} */ {
              destinationEffectId,
            },
          ) => ({
            ok: true,
            result: { implementation: 'replacement' },
            evidence: { destinationEffectId, operation: 'put' },
          }),
        );
        const adapter = managedAdapter(originalExecute, {
          destination: {
            ...DESTINATION_DESCRIPTOR,
            configuration: { ...DESTINATION_DESCRIPTOR.configuration },
          },
          verifier: { ...VERIFIER_DESCRIPTOR },
        });
        const actor = { kind: 'runtime', id: 'original-snapshot-actor' };
        const callOptions = {
          ledger: /** @type {any} */ (gatedLedger),
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          request: effectRequest(harness.started.attempt.attemptId),
          adapter,
          actor,
          signal: originalSignal,
        };
        const executing = executeManagedEffect(callOptions);
        await firstReadEntered;

        adapter.descriptor.id = 'replacement-adapter';
        adapter.destination.bindingId = 'replacement';
        adapter.destination.configuration.tableName = 'replacement';
        adapter.verifier.kind = 'replacement-verifier';
        adapter.substantiatedReplayProperties[0] = 'unsafe';
        adapter.execute = replacementExecute;
        actor.id = 'replacement-actor';
        callOptions.signal = /** @type {any} */ ({});
        releaseFirstRead();

        await expect(executing).resolves.toMatchObject({
          type: 'effect-result',
          ok: true,
          result: { implementation: 'original' },
        });
        expect(originalExecute).toHaveBeenCalledTimes(1);
        expect(replacementExecute).not.toHaveBeenCalled();
        await expect(
          harness.ledger.getEffect(RUN_ID, INVOCATION_ID, EFFECT_ID),
        ).resolves.toMatchObject({
          adapter: { id: 'test-adapter', version: 1 },
          destination: DESTINATION_DESCRIPTOR,
          verifier: VERIFIER_DESCRIPTOR,
          substantiatedReplayProperties: ['idempotent'],
        });
        const effectEvents = (await harness.ledger.getEvents(RUN_ID)).filter(
          (/** @type {Record<string, any>} */ event) =>
            event.type.startsWith('effect-'),
        );
        expect(effectEvents).toHaveLength(3);
        expect(
          effectEvents.map(
            (/** @type {Record<string, any>} */ event) => event.actor,
          ),
        ).toEqual([
          { kind: 'runtime', id: 'original-snapshot-actor' },
          { kind: 'runtime', id: 'original-snapshot-actor' },
          { kind: 'runtime', id: 'original-snapshot-actor' },
        ]);
      } finally {
        await harness.cleanup();
      }
    });

    test('refreshes replay state when a matching receipt appears after the fold read', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        const requested = await harness.ledger.recordManagedEffectRequest({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: harness.started.attempt.attemptId,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: harness.started.run.version,
          transitionId: 'receipt-race-request',
          request: effectRequest(harness.started.attempt.attemptId),
          adapter: { id: 'test-adapter', version: 1 },
          destination: DESTINATION_DESCRIPTOR,
          verifier: VERIFIER_DESCRIPTOR,
          substantiatedReplayProperties: ['idempotent'],
        });
        const startOptions = {
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: harness.started.attempt.attemptId,
          effectId: EFFECT_ID,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: requested.run.version,
          expectedEffectVersion: requested.effect.version,
          transitionId: 'receipt-race-start',
        };
        const racingLedger = createReceiptRaceLedger(
          harness,
          startOptions.transitionId,
          async () =>
            await harness.ledger.markManagedEffectStarted(startOptions),
        );

        await expect(
          racingLedger.markManagedEffectStarted(startOptions),
        ).resolves.toMatchObject({
          applied: false,
          run: { version: 5, status: RunStatus.RUNNING },
          attempt: { status: AttemptStatus.STARTED },
          effect: { version: 2, status: EffectStatus.STARTED },
        });
      } finally {
        await harness.cleanup();
      }
    });

    test('refreshes an effect request replay when its receipt appears after the fold read', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        const requestOptions = {
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: harness.started.attempt.attemptId,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: harness.started.run.version,
          transitionId: 'receipt-race-request',
          request: effectRequest(harness.started.attempt.attemptId),
          adapter: { id: 'test-adapter', version: 1 },
          destination: DESTINATION_DESCRIPTOR,
          verifier: VERIFIER_DESCRIPTOR,
          substantiatedReplayProperties: ['idempotent'],
        };
        const racingLedger = createReceiptRaceLedger(
          harness,
          requestOptions.transitionId,
          async () =>
            await harness.ledger.recordManagedEffectRequest(requestOptions),
        );

        await expect(
          racingLedger.recordManagedEffectRequest(requestOptions),
        ).resolves.toMatchObject({
          applied: false,
          run: { version: 4, status: RunStatus.RUNNING },
          attempt: { status: AttemptStatus.STARTED },
          effect: { version: 1, status: EffectStatus.PENDING },
        });
      } finally {
        await harness.cleanup();
      }
    });

    test('refreshes an effect outcome replay when its receipt appears after the fold read', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        const request = await harness.ledger.recordManagedEffectRequest({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: harness.started.attempt.attemptId,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: harness.started.run.version,
          transitionId: 'receipt-race-outcome-request',
          request: effectRequest(harness.started.attempt.attemptId),
          adapter: { id: 'test-adapter', version: 1 },
          destination: DESTINATION_DESCRIPTOR,
          verifier: VERIFIER_DESCRIPTOR,
          substantiatedReplayProperties: ['idempotent'],
        });
        const started = await harness.ledger.markManagedEffectStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: harness.started.attempt.attemptId,
          effectId: EFFECT_ID,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: request.run.version,
          expectedEffectVersion: request.effect.version,
          transitionId: 'receipt-race-outcome-start',
        });
        const outcomeOptions = {
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: harness.started.attempt.attemptId,
          effectId: EFFECT_ID,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: started.run.version,
          expectedEffectVersion: started.effect.version,
          transitionId: 'receipt-race-outcome',
          outcome: {
            ok: true,
            result: { written: true },
            evidence: {
              destinationEffectId: started.effect.destinationEffectId,
              operation: 'put',
            },
          },
        };
        const racingLedger = createReceiptRaceLedger(
          harness,
          outcomeOptions.transitionId,
          async () =>
            await harness.ledger.commitManagedEffectOutcome(outcomeOptions),
        );

        await expect(
          racingLedger.commitManagedEffectOutcome(outcomeOptions),
        ).resolves.toMatchObject({
          applied: false,
          run: { version: 6, status: RunStatus.RUNNING },
          attempt: { status: AttemptStatus.STARTED },
          effect: { version: 3, status: EffectStatus.COMPLETED },
          outcome: { ok: true, result: { written: true } },
        });
      } finally {
        await harness.cleanup();
      }
    });

    test('refreshes a terminal replay when its receipt appears after the fold read', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        const terminalOptions = {
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: harness.started.attempt.attemptId,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: harness.started.run.version,
          transitionId: 'receipt-race-terminal',
          evidence: completedEvidenceWithoutEffects(harness.started.startFrame),
        };
        const racingLedger = createReceiptRaceLedger(
          harness,
          terminalOptions.transitionId,
          async () =>
            await harness.ledger.commitVerifiedAttemptTerminal(terminalOptions),
        );

        await expect(
          racingLedger.commitVerifiedAttemptTerminal(terminalOptions),
        ).resolves.toMatchObject({
          applied: false,
          run: { version: 4, status: RunStatus.COMPLETED },
          invocation: { status: InvocationStatus.COMPLETED },
          attempt: { status: AttemptStatus.COMPLETED },
        });
      } finally {
        await harness.cleanup();
      }
    });

    test('refreshes a reconciliation replay when its receipt appears after the fold read', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        const uncertain = await harness.ledger.markAttemptUncertain({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: harness.started.attempt.attemptId,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: harness.started.run.version,
          transitionId: 'receipt-race-uncertain',
          reason: { kind: 'terminal-response-lost' },
        });
        const reconciliationOptions = {
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: harness.started.attempt.attemptId,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          coordinatorEpoch: 0,
          expectedVersion: uncertain.run.version,
          uncertaintyEventId: uncertain.receipt.event_id,
          uncertaintySequence: uncertain.receipt.sequence,
          transitionId: 'receipt-race-reconciliation',
          reconciliationId: 'receipt-race-reconciliation-request',
          reason: { kind: 'recovered-transcript' },
          evidence: completedEvidenceWithoutEffects(harness.started.startFrame),
        };
        const racingLedger = createReceiptRaceLedger(
          harness,
          reconciliationOptions.transitionId,
          async () =>
            await harness.ledger.reconcileUncertainManualAttempt(
              reconciliationOptions,
            ),
        );

        await expect(
          racingLedger.reconcileUncertainManualAttempt(reconciliationOptions),
        ).resolves.toMatchObject({
          applied: false,
          run: { version: 5, status: RunStatus.COMPLETED },
          invocation: { status: InvocationStatus.COMPLETED },
          attempt: { status: AttemptStatus.ABANDONED },
        });
      } finally {
        await harness.cleanup();
      }
    });

    test('atomically blocks the aggregate when adapter execution is ambiguous', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        await expect(
          executeManagedEffect({
            ledger: harness.ledger,
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            request: effectRequest(harness.started.attempt.attemptId),
            adapter: managedAdapter(async () => {
              throw new Error('connection closed after send');
            }),
          }),
        ).rejects.toBeInstanceOf(ManagedEffectUncertainError);

        const rebuilt = await harness.ledger.rebuildRun(RUN_ID);
        if (!rebuilt) throw new Error('Expected blocked managed-effect run');
        expect(rebuilt).toMatchObject({
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
        });
        expect(rebuilt.effects[0]).not.toHaveProperty('outcomeRef');
        expect(rebuilt.effects[0].uncertainty).toEqual(
          rebuilt.attempts[0].abandonment,
        );
        expect(rebuilt.effects[0].uncertainty).toEqual(
          rebuilt.invocations[0].uncertainty,
        );
        const events = await harness.ledger.getEvents(RUN_ID);
        expect(events[events.length - 1].type).toBe('effect-became-uncertain');
      } finally {
        await harness.cleanup();
      }
    });

    test('fails closed on missing or rejecting verifiers before returning an outcome', async () => {
      const missing = await createHarness(dbAdapter, []);
      const missingExecute = jest.fn();
      try {
        await expect(
          executeManagedEffect({
            ledger: missing.ledger,
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            request: effectRequest(missing.started.attempt.attemptId),
            adapter: managedAdapter(missingExecute),
          }),
        ).rejects.toThrow(/verifier.*unavailable/i);
        expect(missingExecute).not.toHaveBeenCalled();
        await expect(missing.ledger.rebuildRun(RUN_ID)).resolves.toMatchObject({
          effects: [],
          run: { version: 3, status: RunStatus.RUNNING },
        });
      } finally {
        await missing.cleanup();
      }

      const rejecting = await createHarness(dbAdapter, [
        destinationVerifier(() => false),
      ]);
      try {
        await expect(
          executeManagedEffect({
            ledger: rejecting.ledger,
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            request: effectRequest(rejecting.started.attempt.attemptId),
            adapter: managedAdapter(
              async (
                /** @type {{destinationEffectId: string}} */ {
                  destinationEffectId,
                },
              ) => ({
                ok: true,
                result: { written: true },
                evidence: { destinationEffectId, operation: 'put' },
              }),
            ),
          }),
        ).rejects.toBeInstanceOf(ManagedEffectUncertainError);
        await expect(
          rejecting.ledger.rebuildRun(RUN_ID),
        ).resolves.toMatchObject({
          run: { status: RunStatus.BLOCKED },
          effects: [
            expect.objectContaining({ status: EffectStatus.UNCERTAIN }),
          ],
        });
      } finally {
        await rejecting.cleanup();
      }
    });

    test('isolates verifiers from mutable fold and outcome state', async () => {
      /** @type {{frozen: boolean, mutationRejected: boolean, sameDestination: boolean, operation: string}[]} */
      const observations = [];
      const verifier = destinationVerifier((input) => {
        let mutationRejected = false;
        try {
          input.outcome.evidence.operation = 'mutated';
        } catch {
          mutationRejected = true;
        }
        observations.push({
          frozen:
            Object.isFrozen(input) &&
            Object.isFrozen(input.effect) &&
            Object.isFrozen(input.effect.destination) &&
            Object.isFrozen(input.effect.destination.configuration) &&
            Object.isFrozen(input.request) &&
            Object.isFrozen(input.request.input) &&
            Object.isFrozen(input.outcome) &&
            Object.isFrozen(input.outcome.destination) &&
            Object.isFrozen(input.outcome.destination.configuration) &&
            Object.isFrozen(input.outcome.evidence),
          mutationRejected,
          sameDestination:
            JSON.stringify(input.effect.destination) ===
            JSON.stringify(input.outcome.destination),
          operation: input.outcome.evidence.operation,
        });
        return (
          mutationRejected &&
          input.outcome.evidence.destinationEffectId ===
            input.effect.destinationEffectId &&
          JSON.stringify(input.outcome.destination) ===
            JSON.stringify(input.effect.destination) &&
          input.outcome.evidence.operation === input.request.operation
        );
      });
      const harness = await createHarness(dbAdapter, [verifier]);
      try {
        const frame = await executeManagedEffect({
          ledger: harness.ledger,
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          request: effectRequest(harness.started.attempt.attemptId),
          adapter: managedAdapter(
            async (
              /** @type {{destinationEffectId: string}} */ {
                destinationEffectId,
              },
            ) => ({
              ok: true,
              result: { written: true },
              evidence: { destinationEffectId, operation: 'put' },
            }),
          ),
        });
        expect(frame.evidence.operation).toBe('put');
        expect(observations.length).toBeGreaterThanOrEqual(2);
        expect(observations).toEqual(
          observations.map(() => ({
            frozen: true,
            mutationRejected: true,
            sameDestination: true,
            operation: 'put',
          })),
        );

        const withoutVerifier = createExecutionLedger({
          db: harness.db,
          tableName: 'managed-effect-ledger',
          payloadStore: harness.payloadStore,
          effectEvidenceVerifiers: [],
        });
        await expect(withoutVerifier.rebuildRun(RUN_ID)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
      } finally {
        await harness.cleanup();
      }
    });

    test('rejects stale fences and altered immutable effect contracts', async () => {
      const alternateVerifier = {
        kind: 'alternate-destination',
        version: 1,
        verify: () => true,
      };
      const harness = await createHarness(dbAdapter, [
        destinationVerifier(),
        alternateVerifier,
      ]);
      try {
        const request = effectRequest(harness.started.attempt.attemptId);
        const base = {
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: harness.started.attempt.attemptId,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: harness.started.run.version,
          transitionId: 'immutable-effect-request',
          request,
          adapter: { id: 'test-adapter', version: 1 },
          destination: DESTINATION_DESCRIPTOR,
          verifier: VERIFIER_DESCRIPTOR,
          substantiatedReplayProperties: ['idempotent'],
        };
        await expect(
          harness.ledger.recordManagedEffectRequest({
            ...base,
            fencingToken: 'stale-effect-fence',
            transitionId: 'stale-effect-request',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        await expect(harness.ledger.rebuildRun(RUN_ID)).resolves.toMatchObject({
          run: { version: 3 },
          effects: [],
        });

        await expect(
          harness.ledger.recordManagedEffectRequest(base),
        ).resolves.toMatchObject({
          applied: true,
          effect: { status: EffectStatus.PENDING },
        });
        await expect(
          harness.ledger.recordManagedEffectRequest({
            ...base,
            request: effectRequest(harness.started.attempt.attemptId, {
              input: { key: 'answer', value: 43 },
            }),
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);
        await expect(
          harness.ledger.recordManagedEffectRequest({
            ...base,
            adapter: { id: 'alternate-adapter', version: 1 },
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);
        await expect(
          harness.ledger.recordManagedEffectRequest({
            ...base,
            destination: {
              ...DESTINATION_DESCRIPTOR,
              bindingId: 'alternate',
            },
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);
        await expect(
          harness.ledger.recordManagedEffectRequest({
            ...base,
            verifier: {
              kind: alternateVerifier.kind,
              version: alternateVerifier.version,
            },
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);
      } finally {
        await harness.cleanup();
      }
    });

    test('rejects tampered immutable managed-effect request and outcome payloads', async () => {
      const requestHarness = await createHarness(dbAdapter);
      try {
        const request = effectRequest(requestHarness.started.attempt.attemptId);
        const retained = await requestHarness.ledger.recordManagedEffectRequest(
          {
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId: requestHarness.started.attempt.attemptId,
            fencingToken: FENCING_TOKEN,
            generation: 1,
            expectedVersion: requestHarness.started.run.version,
            transitionId: 'tamper-request',
            request,
            adapter: { id: 'test-adapter', version: 1 },
            destination: DESTINATION_DESCRIPTOR,
            verifier: VERIFIER_DESCRIPTOR,
            substantiatedReplayProperties: ['idempotent'],
          },
        );
        writeFileSync(
          requestHarness.payloadStore.getPath(retained.effect.requestRef),
          '{"tampered":true}',
          'utf8',
        );
        await expect(
          requestHarness.ledger.rebuildRun(RUN_ID),
        ).rejects.toThrow();
      } finally {
        await requestHarness.cleanup();
      }

      const outcomeHarness = await createHarness(dbAdapter);
      try {
        await executeManagedEffect({
          ledger: outcomeHarness.ledger,
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          request: effectRequest(outcomeHarness.started.attempt.attemptId),
          adapter: managedAdapter(
            async (
              /** @type {{destinationEffectId: string}} */ {
                destinationEffectId,
              },
            ) => ({
              ok: true,
              result: { written: true },
              evidence: { destinationEffectId, operation: 'put' },
            }),
          ),
        });
        const effect = await outcomeHarness.ledger.getEffect(
          RUN_ID,
          INVOCATION_ID,
          EFFECT_ID,
        );
        if (!effect?.outcomeRef) throw new Error('Expected effect outcome ref');
        writeFileSync(
          outcomeHarness.payloadStore.getPath(effect.outcomeRef),
          '{"tampered":true}',
          'utf8',
        );
        await expect(
          outcomeHarness.ledger.rebuildRun(RUN_ID),
        ).rejects.toThrow();
      } finally {
        await outcomeHarness.cleanup();
      }

      const schemaHarness = await createHarness(dbAdapter);
      try {
        await executeManagedEffect({
          ledger: schemaHarness.ledger,
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          request: effectRequest(schemaHarness.started.attempt.attemptId),
          adapter: managedAdapter(
            async (
              /** @type {{destinationEffectId: string}} */ {
                destinationEffectId,
              },
            ) => ({
              ok: true,
              result: { written: true },
              evidence: { destinationEffectId, operation: 'put' },
            }),
          ),
        });
        const outcomeEvent = (
          await schemaHarness.ledger.getEvents(RUN_ID)
        ).find(
          (/** @type {Record<string, any>} */ event) =>
            event.type === 'effect-completed',
        );
        if (!outcomeEvent) throw new Error('Expected effect outcome event');
        await rewriteEffectEvent({
          db: schemaHarness.db,
          sequence: outcomeEvent.sequence,
          payload: {
            ...outcomeEvent.payload,
            effect: {
              ...outcomeEvent.payload.effect,
              outcomeRef: {
                ...outcomeEvent.payload.effect.outcomeRef,
                payloadSchema: 'wharfie.execution.managed-effect-outcome.v1',
              },
            },
          },
        });
        await expect(schemaHarness.ledger.rebuildRun(RUN_ID)).rejects.toThrow(
          /outcomeRef\.payloadSchema.*v2/i,
        );
      } finally {
        await schemaHarness.cleanup();
      }
    });

    test('requires a retained verifier before a pending effect can start', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        const request = effectRequest(harness.started.attempt.attemptId);
        const requested = await harness.ledger.recordManagedEffectRequest({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: harness.started.attempt.attemptId,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: harness.started.run.version,
          transitionId: 'pending-before-verifier-loss',
          request,
          adapter: { id: 'test-adapter', version: 1 },
          destination: DESTINATION_DESCRIPTOR,
          verifier: VERIFIER_DESCRIPTOR,
          substantiatedReplayProperties: ['idempotent'],
        });
        const withoutVerifier = createExecutionLedger({
          db: harness.db,
          tableName: 'managed-effect-ledger',
          payloadStore: harness.payloadStore,
          effectEvidenceVerifiers: [],
        });
        await expect(
          withoutVerifier.markManagedEffectStarted({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId: harness.started.attempt.attemptId,
            effectId: EFFECT_ID,
            fencingToken: FENCING_TOKEN,
            generation: 1,
            expectedVersion: requested.run.version,
            expectedEffectVersion: requested.effect.version,
            transitionId: 'must-not-start-without-verifier',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);
        const execute = jest.fn();
        await expect(
          executeManagedEffect({
            ledger: withoutVerifier,
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            request,
            adapter: managedAdapter(execute),
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);
        expect(execute).not.toHaveBeenCalled();
      } finally {
        await harness.cleanup();
      }
    });

    test('does not let a payload provider mutate effect semantics before publication', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        const mutatingPayloadStore = {
          async putJson(/** @type {Record<string, any>} */ input) {
            input.value.input.value = 43;
            return await harness.payloadStore.putJson(input);
          },
          async readBytes(/** @type {unknown} */ reference) {
            return await harness.payloadStore.readBytes(reference);
          },
        };
        const mutatingLedger = createExecutionLedger({
          db: harness.db,
          tableName: 'managed-effect-ledger',
          payloadStore: mutatingPayloadStore,
          effectEvidenceVerifiers: [destinationVerifier()],
        });
        await expect(
          mutatingLedger.recordManagedEffectRequest({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId: harness.started.attempt.attemptId,
            fencingToken: FENCING_TOKEN,
            generation: 1,
            expectedVersion: harness.started.run.version,
            transitionId: 'mutating-provider-request',
            request: effectRequest(harness.started.attempt.attemptId),
            adapter: { id: 'test-adapter', version: 1 },
            destination: DESTINATION_DESCRIPTOR,
            verifier: VERIFIER_DESCRIPTOR,
            substantiatedReplayProperties: ['idempotent'],
          }),
        ).rejects.toBeInstanceOf(TypeError);
        await expect(harness.ledger.rebuildRun(RUN_ID)).resolves.toMatchObject({
          run: { version: 3 },
          effects: [],
          events: [expect.any(Object), expect.any(Object), expect.any(Object)],
        });
      } finally {
        await harness.cleanup();
      }
    });

    test('rejects rehashed effect events that rewrite generation, destination, or start evidence', async () => {
      const generationHarness = await createHarness(dbAdapter);
      try {
        await generationHarness.ledger.recordManagedEffectRequest({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: generationHarness.started.attempt.attemptId,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: generationHarness.started.run.version,
          transitionId: 'generation-tamper-request',
          request: effectRequest(generationHarness.started.attempt.attemptId),
          adapter: { id: 'test-adapter', version: 1 },
          destination: DESTINATION_DESCRIPTOR,
          verifier: VERIFIER_DESCRIPTOR,
          substantiatedReplayProperties: ['idempotent'],
        });
        const requestEvent = (
          await generationHarness.ledger.getEvents(RUN_ID)
        )[3];
        await rewriteEffectEvent({
          db: generationHarness.db,
          sequence: requestEvent.sequence,
          payload: {
            ...requestEvent.payload,
            invocation: {
              ...requestEvent.payload.invocation,
              generation: requestEvent.payload.invocation.generation + 1,
            },
          },
        });
        await expect(
          generationHarness.ledger.rebuildRun(RUN_ID),
        ).rejects.toMatchObject({
          reason: 'managed-effect request or fence mismatch',
        });
      } finally {
        await generationHarness.cleanup();
      }

      const destinationHarness = await createHarness(dbAdapter);
      try {
        await destinationHarness.ledger.recordManagedEffectRequest({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: destinationHarness.started.attempt.attemptId,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: destinationHarness.started.run.version,
          transitionId: 'destination-tamper-request',
          request: effectRequest(destinationHarness.started.attempt.attemptId),
          adapter: { id: 'test-adapter', version: 1 },
          destination: DESTINATION_DESCRIPTOR,
          verifier: VERIFIER_DESCRIPTOR,
          substantiatedReplayProperties: ['idempotent'],
        });
        const requestEvent = (
          await destinationHarness.ledger.getEvents(RUN_ID)
        )[3];
        await rewriteEffectEvent({
          db: destinationHarness.db,
          sequence: requestEvent.sequence,
          payload: {
            ...requestEvent.payload,
            effect: {
              ...requestEvent.payload.effect,
              destination: {
                ...requestEvent.payload.effect.destination,
                bindingId: 'redirected',
              },
            },
          },
        });
        await expect(
          destinationHarness.ledger.rebuildRun(RUN_ID),
        ).rejects.toMatchObject({ reason: 'event request digest' });
      } finally {
        await destinationHarness.cleanup();
      }

      const startHarness = await createHarness(dbAdapter);
      try {
        const requested = await startHarness.ledger.recordManagedEffectRequest({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: startHarness.started.attempt.attemptId,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: startHarness.started.run.version,
          transitionId: 'uncertain-start-request',
          request: effectRequest(startHarness.started.attempt.attemptId),
          adapter: { id: 'test-adapter', version: 1 },
          destination: DESTINATION_DESCRIPTOR,
          verifier: VERIFIER_DESCRIPTOR,
          substantiatedReplayProperties: ['idempotent'],
        });
        const begun = await startHarness.ledger.markManagedEffectStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: startHarness.started.attempt.attemptId,
          effectId: EFFECT_ID,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: requested.run.version,
          expectedEffectVersion: requested.effect.version,
          transitionId: 'uncertain-start-begin',
        });
        const blocked = await startHarness.ledger.markManagedEffectUncertain({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: startHarness.started.attempt.attemptId,
          effectId: EFFECT_ID,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: begun.run.version,
          expectedEffectVersion: begun.effect.version,
          transitionId: 'uncertain-start-block',
          reason: { kind: 'destination-outcome-unknown' },
        });
        const uncertainEvent = (await startHarness.ledger.getEvents(RUN_ID))[5];
        await rewriteEffectEvent({
          db: startHarness.db,
          sequence: uncertainEvent.sequence,
          payload: {
            ...uncertainEvent.payload,
            attempt: {
              ...uncertainEvent.payload.attempt,
              startedAt: blocked.attempt.startedAt + 1,
            },
          },
        });
        await expect(
          startHarness.ledger.rebuildRun(RUN_ID),
        ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);
      } finally {
        await startHarness.cleanup();
      }
    });

    test('requires persisted effect truth in terminal and uncertainty reconciliation transcripts', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        const attemptId = harness.started.attempt.attemptId;
        const ghostRequest = effectRequest(attemptId, {
          effectId: 'unpersisted-effect',
        });
        const ghostResult = {
          protocol: 'wharfie.activity',
          protocolVersion: 1,
          type: 'effect-result',
          attemptId,
          effectId: 'unpersisted-effect',
          ok: true,
          result: { invented: true },
          substantiatedReplayProperties: ['idempotent'],
          evidence: { invented: true },
        };
        await expect(
          harness.ledger.commitVerifiedAttemptTerminal({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken: FENCING_TOKEN,
            generation: 1,
            expectedVersion: harness.started.run.version,
            transitionId: 'unpersisted-effect-terminal',
            evidence: completedEvidence(
              harness.started.startFrame,
              ghostRequest,
              ghostResult,
            ),
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);

        const request = effectRequest(attemptId);
        const frame = await executeManagedEffect({
          ledger: harness.ledger,
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          request,
          adapter: managedAdapter(
            async (
              /** @type {{destinationEffectId: string}} */ {
                destinationEffectId,
              },
            ) => ({
              ok: true,
              result: { written: true },
              evidence: { destinationEffectId, operation: 'put' },
            }),
          ),
        });
        const afterEffect = await harness.ledger.rebuildRun(RUN_ID);
        if (!afterEffect) throw new Error('Expected managed effect run');
        await expect(
          harness.ledger.commitVerifiedAttemptTerminal({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken: FENCING_TOKEN,
            generation: 1,
            expectedVersion: afterEffect.run.version,
            transitionId: 'mismatched-effect-terminal',
            evidence: completedEvidence(harness.started.startFrame, request, {
              ...frame,
              result: { written: false },
            }),
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);

        const uncertain = await harness.ledger.markAttemptUncertain({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: afterEffect.run.version,
          transitionId: 'terminal-reconciliation-uncertain',
          reason: { kind: 'terminal-response-lost' },
        });
        const uncertaintyEvent = (await harness.ledger.getEvents(RUN_ID)).find(
          (/** @type {Record<string, any>} */ event) =>
            event.type === 'attempt-became-uncertain',
        );
        await expect(
          harness.ledger.reconcileUncertainManualAttempt({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken: FENCING_TOKEN,
            generation: 1,
            coordinatorEpoch: 0,
            expectedVersion: uncertain.run.version,
            uncertaintyEventId: uncertaintyEvent?.event_id,
            uncertaintySequence: uncertaintyEvent?.sequence,
            transitionId: 'reconcile-without-effects',
            reconciliationId: 'reconcile-without-effects',
            reason: { kind: 'recovered-transcript' },
            evidence: completedEvidenceWithoutEffects(
              harness.started.startFrame,
            ),
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);
      } finally {
        await harness.cleanup();
      }
    });

    test('requires explicit effect uncertainty instead of abandoning an unresolved effect', async () => {
      const harness = await createHarness(dbAdapter);
      try {
        const request = effectRequest(harness.started.attempt.attemptId);
        const requested = await harness.ledger.recordManagedEffectRequest({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: harness.started.attempt.attemptId,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: harness.started.run.version,
          transitionId: 'direct-effect-request',
          request,
          adapter: { id: 'test-adapter', version: 1 },
          destination: DESTINATION_DESCRIPTOR,
          verifier: VERIFIER_DESCRIPTOR,
          substantiatedReplayProperties: ['idempotent'],
        });
        const begun = await harness.ledger.markManagedEffectStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: harness.started.attempt.attemptId,
          effectId: EFFECT_ID,
          fencingToken: FENCING_TOKEN,
          generation: 1,
          expectedVersion: requested.run.version,
          expectedEffectVersion: requested.effect.version,
          transitionId: 'direct-effect-start',
        });
        await expect(
          harness.ledger.markAttemptUncertain({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId: harness.started.attempt.attemptId,
            fencingToken: FENCING_TOKEN,
            generation: 1,
            expectedVersion: begun.run.version,
            transitionId: 'wrong-uncertainty-path',
            reason: { kind: 'wrong-path' },
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        await expect(harness.ledger.rebuildRun(RUN_ID)).resolves.toMatchObject({
          run: { status: RunStatus.RUNNING },
          attempts: [
            expect.objectContaining({ status: AttemptStatus.STARTED }),
          ],
          effects: [expect.objectContaining({ status: EffectStatus.STARTED })],
        });
      } finally {
        await harness.cleanup();
      }
    });
  });
}
