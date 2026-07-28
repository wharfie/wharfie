/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterAll, describe, expect, test } from '@jest/globals';
import { Buffer } from 'node:buffer';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  ExecutionLedgerRunConflictError,
  ExecutionLedgerTransitionConflictError,
  EXECUTION_LEDGER_MAX_EVIDENCE_FRAMES,
  EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
  EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS,
  InvocationStatus,
  RunStatus,
  createExecutionLedger as createProductionExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import {
  getAttemptProjectionSortKey,
  getEventSortKey,
  getInvocationProjectionSortKey,
  getRunProjectionSortKey,
  getTransitionSortKey,
} from '../../src/core/lib/ledger/record-key.js';
import {
  createExecutionLedgerRunDirectoryScope,
  getExecutionLedgerRunDirectorySortKey,
} from '../../src/core/lib/ledger/run-directory.js';
import { MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID } from '../../src/core/lib/ledger/managed-effect-successor-contract.js';

const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const RUN_ID = 'run-1';
const INVOCATION_ID = 'main';
const ACTIVITY_ID = 'greet';
const PAYLOAD_ROOT = mkdtempSync(join(tmpdir(), 'wharfie-ledger-payload-'));
const PAYLOAD_STORE = createLocalExecutionPayloadStore({
  path: PAYLOAD_ROOT,
  storeId: 'ledger-contract',
});

afterAll(() => {
  rmSync(PAYLOAD_ROOT, { recursive: true, force: true });
});

/**
 * @param {Omit<Parameters<typeof createProductionExecutionLedger>[0], 'payloadStore'>} options
 * @returns {ReturnType<typeof createProductionExecutionLedger>}
 */
function createExecutionLedger(options) {
  return createProductionExecutionLedger({
    ...options,
    payloadStore: PAYLOAD_STORE,
  });
}

/**
 * @returns {{writes: {value: unknown, payloadSchema: string}[], reads: unknown[], payloadStore: {putJson: (input: {value: unknown, payloadSchema: string}) => Promise<unknown>, readBytes: (reference: unknown) => Promise<unknown>}}} - Store wrapper that exposes durable publication and read attempts.
 */
function createCountingPayloadStore() {
  /** @type {{value: unknown, payloadSchema: string}[]} */
  const writes = [];
  /** @type {unknown[]} */
  const reads = [];
  return {
    writes,
    reads,
    payloadStore: {
      async putJson(input) {
        writes.push(input);
        return await PAYLOAD_STORE.putJson(input);
      },
      async readBytes(reference) {
        reads.push(reference);
        return await PAYLOAD_STORE.readBytes(reference);
      },
    },
  };
}

/**
 * @param {string} attemptId - Durable physical attempt identity.
 * @param {any} [result] - Strict JSON result value.
 * @returns {Record<string, any>} - A valid completed Activity Protocol frame.
 */
function completedTerminal(attemptId, result = { greeting: 'hello' }) {
  return {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId,
    sequence: 1,
    result,
  };
}

/**
 * @param {string} attemptId - Durable physical attempt identity.
 * @param {string} fencingToken - Persisted attempt fence.
 * @returns {Record<string, any>} - Exact ledger-bound start frame fixture.
 */
function attemptStart(attemptId, fencingToken) {
  return {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'start',
    revisionId: REVISION_ID,
    activityId: ACTIVITY_ID,
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    attemptId,
    fencingToken,
    input: { name: 'Ada' },
    caller: { metadata: { source: 'test' } },
  };
}

/**
 * @param {string} attemptId - Durable physical attempt identity.
 * @param {string} fencingToken - Persisted attempt fence.
 * @param {any} [result] - Strict JSON completion result.
 * @returns {Record<string, any>} - Host-verified complete evidence.
 */
function completedEvidence(
  attemptId,
  fencingToken,
  result = { greeting: 'hello' },
) {
  return completedEvidenceForStart(
    attemptStart(attemptId, fencingToken),
    result,
  );
}

/**
 * @param {Readonly<Record<string, any>>} start - Exact durable start frame.
 * @param {any} [result] - Strict JSON completion result.
 * @returns {Record<string, any>} - Host-verified complete evidence.
 */
function completedEvidenceForStart(start, result = { greeting: 'hello' }) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const terminal = transcript.acceptComponentFrame(
    completedTerminal(acceptedStart.attemptId, result),
  );
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, terminal],
    transcript: transcript.snapshot(),
  };
}

const CANCELLATION_REASON = Object.freeze({
  code: 'operator-requested-cancellation',
  name: 'CancellationError',
  message: 'The operator requested that this durable run stop.',
  details: { requestId: 'cancel-request-1' },
});

/**
 * @param {Readonly<Record<string, any>>} start - Exact durable start frame.
 * @param {Record<string, any>} [reason] - Host cancellation reason.
 * @returns {Record<string, any>} - Host-verified cancelled attempt evidence.
 */
function cancelledEvidenceForStart(start, reason = CANCELLATION_REASON) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const cancel = transcript.acceptHostFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'cancel',
    attemptId: acceptedStart.attemptId,
    reason,
  });
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'cancelled',
    attemptId: acceptedStart.attemptId,
    sequence: 1,
    error: reason,
  });
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, cancel, terminal],
    transcript: transcript.snapshot(),
  };
}

function cancelledEvidenceWithEffectRequest(
  /** @type {Readonly<Record<string, any>>} */ start,
  /** @type {Record<string, any>} */ request,
  /** @type {Record<string, any>} */ reason = CANCELLATION_REASON,
) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const acceptedRequest = transcript.acceptComponentFrame(request);
  const cancel = transcript.acceptHostFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'cancel',
    attemptId: acceptedStart.attemptId,
    reason,
  });
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'cancelled',
    attemptId: acceptedStart.attemptId,
    sequence: 2,
    error: reason,
  });
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, acceptedRequest, cancel, terminal],
    transcript: transcript.snapshot(),
  };
}

/**
 * @param {Readonly<Record<string, any>>} start - Exact durable start frame.
 * @param {'completed'|'failed'} terminalType - Physical terminal that won the cancellation race.
 * @param {Record<string, any>} [reason] - Exact authorized cancellation reason.
 * @returns {Record<string, any>} - Host-verified non-cancelled evidence after cancellation delivery.
 */
function terminalEvidenceAfterCancelForStart(
  start,
  terminalType,
  reason = CANCELLATION_REASON,
) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const cancel = transcript.acceptHostFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'cancel',
    attemptId: acceptedStart.attemptId,
    reason,
  });
  const terminal = transcript.acceptComponentFrame(
    terminalType === 'completed'
      ? {
          protocol: 'wharfie.activity',
          protocolVersion: 1,
          type: 'completed',
          attemptId: acceptedStart.attemptId,
          sequence: 1,
          result: { outcome: 'completed-after-cancel' },
        }
      : {
          protocol: 'wharfie.activity',
          protocolVersion: 1,
          type: 'failed',
          attemptId: acceptedStart.attemptId,
          sequence: 1,
          error: {
            code: 'activity-failed',
            name: 'ActivityError',
            message: 'The activity failed after cancellation was delivered.',
            details: {},
          },
        },
  );
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, cancel, terminal],
    transcript: transcript.snapshot(),
  };
}

/**
 * @param {Readonly<Record<string, any>>} start - Exact durable start frame.
 * @returns {Record<string, any>} - Protocol failure evidence with no physical cancellation delivery.
 */
function protocolFailedEvidenceForStart(start) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'protocol-failed',
    attemptId: acceptedStart.attemptId,
    sequence: 1,
    error: {
      code: 'transport-failed',
      name: 'ActivityAttemptProtocolError',
      message:
        'The attempt transport failed before cancellation was delivered.',
      details: {},
    },
  });
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, terminal],
    transcript: transcript.snapshot(),
  };
}

/**
 * @param {Readonly<Record<string, any>>} start - Exact durable start frame.
 * @param {Record<string, any>} [reason] - Host cancellation reason.
 * @returns {Record<string, any>} - Evidence that cancellation delivery ended ambiguously.
 */
function failedCancellationEvidenceForStart(
  start,
  reason = CANCELLATION_REASON,
) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const cancel = transcript.acceptHostFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'cancel',
    attemptId: acceptedStart.attemptId,
    reason,
  });
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'protocol-failed',
    attemptId: acceptedStart.attemptId,
    sequence: 1,
    error: {
      code: 'termination-failed',
      name: 'ActivityAttemptProtocolError',
      message: 'The adapter could not prove that cancellation stopped work.',
      details: {},
    },
  });
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, cancel, terminal],
    transcript: transcript.snapshot(),
  };
}

/**
 * @param {Record<string, any>} event - Raw immutable event record.
 * @returns {string} - Content-bound event identity as production code computes it.
 */
function eventIdFor(event) {
  return createCanonicalJsonSha256Id({
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
      payload: event.payload,
    },
    valuePath: 'ledger event identity',
  });
}

/**
 * Replace one event and all affected projections with rehashed snapshots. A
 * replay test using this helper reaches semantic fold validation instead of
 * failing earlier on a detached event ID or an ordinary projection mismatch.
 * @param {{db: any, tableName: string, sequence: number, transitionId: string, payload: Record<string, any>}} input - Forged but structurally consistent event state.
 * @returns {Promise<void>} - Resolves after all test records are rewritten.
 */
async function forgeEventSnapshots(input) {
  const event = await input.db.get({
    tableName: input.tableName,
    keyName: 'run_id',
    keyValue: RUN_ID,
    sortKeyName: 'sort_key',
    sortKeyValue: getEventSortKey(input.sequence),
    consistentRead: true,
  });
  if (!event) throw new Error('Expected event to forge');
  const forgedEventId = eventIdFor({ ...event, payload: input.payload });
  /** @param {string} sortKeyValue - Ledger record sort key. @param {any[]} updates - Atomic field updates. */
  const update = async (sortKeyValue, updates) =>
    await input.db.update({
      tableName: input.tableName,
      keyName: 'run_id',
      keyValue: RUN_ID,
      sortKeyName: 'sort_key',
      sortKeyValue,
      updates,
    });
  await update(getEventSortKey(input.sequence), [
    { property: ['payload'], propertyValue: input.payload },
    { property: ['event_id'], propertyValue: forgedEventId },
  ]);
  await update(getTransitionSortKey(input.transitionId), [
    { property: ['event_id'], propertyValue: forgedEventId },
  ]);
  await update(getRunProjectionSortKey(), [
    { property: ['data'], propertyValue: input.payload.run },
  ]);
  await update(getInvocationProjectionSortKey(INVOCATION_ID), [
    { property: ['data'], propertyValue: input.payload.invocation },
  ]);
  if (input.payload.attempt) {
    await update(getAttemptProjectionSortKey(input.payload.attempt.attemptId), [
      { property: ['data'], propertyValue: input.payload.attempt },
    ]);
  }
}

/**
 * @param {Record<string, any>} [overrides] - Immutable run definition overrides.
 * @returns {Record<string, any>} - First-slice manual run request.
 */
function manualRun(overrides = {}) {
  return {
    runId: RUN_ID,
    appId: 'demo',
    revisionId: REVISION_ID,
    invocationId: INVOCATION_ID,
    activityId: ACTIVITY_ID,
    input: { name: 'Ada' },
    callerMetadata: { source: 'test' },
    transitionId: 'create-run',
    ...overrides,
  };
}

/**
 * @param {Record<string, any>} [overrides] - Cancellation request overrides.
 * @returns {Record<string, any>} - Fenced first-wins manual cancellation request.
 */
function manualCancellationRequest(overrides = {}) {
  return {
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    expectedVersion: 1,
    expectedGeneration: 0,
    transitionId: 'cancel-request-1',
    requestId: 'cancel-request-1',
    actor: { kind: 'operator', id: 'ledger-contract-test' },
    reason: CANCELLATION_REASON,
    ...overrides,
  };
}

const TEST_EFFECT_VERIFIER = Object.freeze({
  kind: 'ledger-test-destination',
  version: 1,
});
const TEST_EFFECT_RECONCILIATION_VERIFIER = Object.freeze({
  kind: 'ledger-test-destination-not-applied',
  version: 1,
});
const TEST_EFFECT_DESTINATION = Object.freeze({
  kind: 'ledger-test-store',
  version: 1,
  bindingId: 'primary',
  configuration: Object.freeze({ tableName: 'records' }),
});

function effectVerifierRegistration() {
  return {
    ...TEST_EFFECT_VERIFIER,
    verify: (/** @type {Record<string, any>} */ input) =>
      input.outcome.evidence.destinationEffectId ===
        input.effect.destinationEffectId &&
      input.outcome.evidence.operation === input.request.operation,
  };
}

function effectReconciliationVerifierRegistration() {
  return {
    ...TEST_EFFECT_RECONCILIATION_VERIFIER,
    verify: (/** @type {Record<string, any>} */ input) =>
      Object.isFrozen(input) &&
      Object.isFrozen(input.effect) &&
      Object.isFrozen(input.request) &&
      Object.isFrozen(input.evidence) &&
      input.evidence.destinationEffectId === input.effect.destinationEffectId &&
      input.evidence.operation === input.request.operation &&
      input.evidence.disposition === 'not-applied',
  };
}

function effectRequestFrame(
  /** @type {string} */ attemptId,
  /** @type {string} */ effectId,
  /** @type {number} */ sequence,
) {
  return {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'effect-request',
    attemptId,
    sequence,
    effectId,
    capability: 'key-value',
    operation: 'put',
    input: { key: effectId, value: sequence },
    requestedReplayProperties: ['idempotent'],
  };
}

async function createStartedManagedAttempt(
  /** @type {ReturnType<typeof createProductionExecutionLedger>} */ ledger,
) {
  const created = await ledger.createManualRun(manualRun());
  const claimed = await ledger.claimInvocation({
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    fencingToken: 'effect-fence',
    expectedGeneration: 0,
    expectedVersion: created.run.version,
    transitionId: 'effect-claim',
  });
  return await ledger.markAttemptStarted({
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    attemptId: claimed.attempt.attemptId,
    fencingToken: 'effect-fence',
    generation: 1,
    expectedVersion: claimed.run.version,
    transitionId: 'effect-attempt-start',
  });
}

async function retainEffect(
  /** @type {ReturnType<typeof createProductionExecutionLedger>} */ ledger,
  /** @type {Record<string, any>} */ started,
  /** @type {{effectId: string, sequence: number, status: string, destination?: Record<string, any>}} */ options,
) {
  const current = await ledger.getRun(RUN_ID);
  if (!current) throw new Error('Expected managed-effect run.');
  const requested = await ledger.recordManagedEffectRequest({
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    attemptId: started.attempt.attemptId,
    fencingToken: 'effect-fence',
    generation: 1,
    expectedVersion: current.version,
    transitionId: `${options.effectId}-request`,
    request: effectRequestFrame(
      started.attempt.attemptId,
      options.effectId,
      options.sequence,
    ),
    adapter: { id: 'ledger-test-adapter', version: 1 },
    destination: options.destination || TEST_EFFECT_DESTINATION,
    verifier: TEST_EFFECT_VERIFIER,
    substantiatedReplayProperties: ['idempotent'],
  });
  if (options.status === EffectStatus.PENDING) return requested;
  return await ledger.markManagedEffectStarted({
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    attemptId: started.attempt.attemptId,
    effectId: options.effectId,
    fencingToken: 'effect-fence',
    generation: 1,
    expectedVersion: requested.run.version,
    expectedEffectVersion: requested.effect.version,
    transitionId: `${options.effectId}-start`,
  });
}

/**
 * @returns {() => number} - Deterministic increasing observation clock.
 */
function createClock() {
  let time = 1_700_000_000_000;
  return () => {
    time += 1;
    return time;
  };
}

for (const adapter of getAdapterMatrix()) {
  describe(`${adapter.name} execution ledger contract`, () => {
    test('reserves the host-managed successor activity from manual creation', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-reserved-successor-activity',
          now: createClock(),
        });
        await expect(
          ledger.createManualRun(
            manualRun({ activityId: MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID }),
          ),
        ).rejects.toThrow(/reserved managed-effect successor activity/i);
        await expect(ledger.getRun(RUN_ID)).resolves.toBeNull();
      } finally {
        await cleanup();
      }
    });

    test('reads bounded app-scoped manual outputs without exposing ledger internals', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const counted = createCountingPayloadStore();
        const ledger = createProductionExecutionLedger({
          db,
          tableName: 'execution-ledger-run-output-manual',
          payloadStore: counted.payloadStore,
          now: createClock(),
        });
        await expect(
          ledger.readRunOutput({ appId: 'demo', runId: RUN_ID }),
        ).resolves.toBeNull();
        const created = await ledger.createManualRun(manualRun());
        const active = await ledger.readRunOutput({
          appId: 'demo',
          runId: RUN_ID,
        });
        expect(active).toEqual({
          scope: {
            appId: 'demo',
            revisionId: REVISION_ID,
            runId: RUN_ID,
          },
          snapshot: {
            runKind: 'manual',
            status: RunStatus.RUNNING,
            version: created.run.version,
            lastSequence: created.run.lastSequence,
          },
          outputs: [],
          terminal: null,
        });
        expect(Object.isFrozen(active)).toBe(true);
        expect(Object.isFrozen(active?.scope)).toBe(true);
        counted.reads.length = 0;
        await expect(
          ledger.readRunOutput({ appId: 'other-app', runId: RUN_ID }),
        ).resolves.toBeNull();
        expect(counted.reads).toEqual([]);

        const claimed = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'run-output-fence',
          expectedGeneration: 0,
          expectedVersion: created.run.version,
          transitionId: 'run-output-claim',
        });
        const started = await ledger.markAttemptStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: claimed.attempt.attemptId,
          fencingToken: claimed.attempt.fencingToken,
          generation: claimed.attempt.generation,
          expectedVersion: claimed.run.version,
          transitionId: 'run-output-start',
        });
        const result = {
          greeting: 'sensitive-result',
          nested: { value: 7 },
        };
        const committed = await ledger.commitVerifiedAttemptTerminal({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          fencingToken: started.attempt.fencingToken,
          generation: started.attempt.generation,
          expectedVersion: started.run.version,
          transitionId: 'run-output-terminal',
          evidence: completedEvidenceForStart(started.startFrame, result),
        });
        const completed = await ledger.readRunOutput({
          appId: 'demo',
          runId: RUN_ID,
        });
        expect(completed).toEqual({
          scope: active?.scope,
          snapshot: {
            runKind: 'manual',
            status: RunStatus.COMPLETED,
            version: committed.run.version,
            lastSequence: committed.run.lastSequence,
          },
          outputs: [],
          terminal: { type: 'completed', result },
        });
        expect(Object.isFrozen(completed?.terminal?.result)).toBe(true);
        const serialized = JSON.stringify(completed);
        for (const privateField of [
          'requestRef',
          'evidenceRef',
          'fencingToken',
          'coordinatorEpoch',
          'attemptId',
          'actor',
          'storage',
        ]) {
          expect(serialized).not.toContain(privateField);
        }
      } finally {
        await cleanup();
      }
    });

    test('uses the durable cancellation reason for a terminal manual aggregate', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-run-output-cancelled',
          now: createClock(),
        });
        const created = await ledger.createManualRun(manualRun());
        const cancelled = await ledger.requestManualRunCancellation(
          manualCancellationRequest({
            expectedVersion: created.run.version,
          }),
        );
        await expect(
          ledger.readRunOutput({ appId: 'demo', runId: RUN_ID }),
        ).resolves.toEqual({
          scope: {
            appId: 'demo',
            revisionId: REVISION_ID,
            runId: RUN_ID,
          },
          snapshot: {
            runKind: 'manual',
            status: RunStatus.CANCELLED,
            version: cancelled.run.version,
            lastSequence: cancelled.run.lastSequence,
          },
          outputs: [],
          terminal: {
            type: 'cancelled',
            error: CANCELLATION_REASON,
          },
        });
      } finally {
        await cleanup();
      }
    });

    test('settles the exact mixed managed-effect set atomically and rejects stale or partial plans', async () => {
      const { db, cleanup } = await adapter.create();
      const tableName = 'execution-ledger-effect-settlement';
      try {
        const ledger = createExecutionLedger({
          db,
          tableName,
          effectEvidenceVerifiers: [effectVerifierRegistration()],
          now: createClock(),
        });
        const started = await createStartedManagedAttempt(ledger);
        const pending = await retainEffect(ledger, started, {
          effectId: 'a-pending',
          sequence: 1,
          status: EffectStatus.PENDING,
        });
        const recovered = await retainEffect(ledger, started, {
          effectId: 'b-recovered',
          sequence: 2,
          status: EffectStatus.STARTED,
        });
        const uncertain = await retainEffect(ledger, started, {
          effectId: 'c-uncertain',
          sequence: 3,
          status: EffectStatus.STARTED,
        });
        const before = await ledger.rebuildRun(RUN_ID);
        if (!before) throw new Error('Expected managed-effect ledger state.');
        const reason = { kind: 'stopped-attempt' };
        const decisions = [
          {
            effectId: 'a-pending',
            expectedEffectVersion: pending.effect.version,
            disposition: 'cancelled-before-start',
          },
          {
            effectId: 'b-recovered',
            expectedEffectVersion: recovered.effect.version,
            disposition: 'outcome-recovered',
            outcome: {
              ok: true,
              result: { written: true },
              evidence: {
                destinationEffectId: recovered.effect.destinationEffectId,
                operation: 'put',
              },
            },
          },
          {
            effectId: 'c-uncertain',
            expectedEffectVersion: uncertain.effect.version,
            disposition: 'outcome-uncertain',
          },
        ];
        const settle = (overrides = {}) =>
          ledger.settleStoppedAttemptManagedEffects({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId: started.attempt.attemptId,
            fencingToken: 'effect-fence',
            generation: 1,
            expectedVersion: before.run.version,
            transitionId: 'settle-effect-set',
            decisions,
            reason,
            ...overrides,
          });

        await expect(
          settle({
            transitionId: 'settle-subset',
            decisions: decisions.slice(0, 2),
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        await expect(
          settle({
            transitionId: 'settle-duplicate',
            decisions: [decisions[0], decisions[0], decisions[2]],
          }),
        ).rejects.toThrow(/unique.*sorted/i);
        await expect(
          settle({
            transitionId: 'settle-status-mismatch',
            decisions: [
              {
                ...decisions[0],
                disposition: 'outcome-uncertain',
              },
              decisions[1],
              decisions[2],
            ],
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        await expect(
          settle({
            transitionId: 'settle-stale-effect',
            decisions: [
              decisions[0],
              {
                ...decisions[1],
                expectedEffectVersion: decisions[1].expectedEffectVersion + 1,
              },
              decisions[2],
            ],
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        await expect(
          settle({ transitionId: 'settle-stale-fence', fencingToken: 'stale' }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        await expect(
          ledger.markManagedEffectUncertain({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId: started.attempt.attemptId,
            effectId: 'c-uncertain',
            fencingToken: 'effect-fence',
            generation: 1,
            expectedVersion: before.run.version,
            expectedEffectVersion: uncertain.effect.version,
            transitionId: 'singular-uncertainty-with-siblings',
            reason,
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        await expect(ledger.rebuildRun(RUN_ID)).resolves.toEqual(before);

        const settled = await settle();
        expect(settled).toMatchObject({
          applied: true,
          run: { status: RunStatus.BLOCKED },
          invocation: { status: InvocationStatus.UNCERTAIN },
          attempt: { status: AttemptStatus.ABANDONED },
          effects: [
            { effectId: 'a-pending', status: EffectStatus.CANCELLED },
            { effectId: 'b-recovered', status: EffectStatus.COMPLETED },
            { effectId: 'c-uncertain', status: EffectStatus.UNCERTAIN },
          ],
        });
        await expect(settle()).resolves.toMatchObject({ applied: false });
        await expect(
          settle({ reason: { kind: 'different-recovery' } }),
        ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);

        const settlementEvents = await ledger.getEvents(RUN_ID);
        const settlementEvent = settlementEvents[settlementEvents.length - 1];
        await forgeEventSnapshots({
          db,
          tableName,
          sequence: settlementEvent.sequence,
          transitionId: 'settle-effect-set',
          payload: {
            ...settlementEvent.payload,
            effects: settlementEvent.payload.effects.slice(1),
          },
        });
        await expect(ledger.getRun(RUN_ID)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
      } finally {
        await cleanup();
      }
    });

    test('reconciles uncertain effect siblings independently from typed immutable evidence', async () => {
      const { db, cleanup } = await adapter.create();
      const counted = createCountingPayloadStore();
      const tableName = 'execution-ledger-effect-reconciliation';
      try {
        const verifiers = [
          effectVerifierRegistration(),
          effectReconciliationVerifierRegistration(),
        ];
        const ledger = createProductionExecutionLedger({
          db,
          tableName,
          payloadStore: counted.payloadStore,
          effectEvidenceVerifiers: verifiers,
          now: createClock(),
        });
        const started = await createStartedManagedAttempt(ledger);
        const lateOutcome = await retainEffect(ledger, started, {
          effectId: 'a-late-outcome',
          sequence: 1,
          status: EffectStatus.STARTED,
        });
        const notApplied = await retainEffect(ledger, started, {
          effectId: 'b-not-applied',
          sequence: 2,
          status: EffectStatus.STARTED,
        });
        const lateFailure = await retainEffect(ledger, started, {
          effectId: 'c-late-failure',
          sequence: 3,
          status: EffectStatus.STARTED,
        });
        const beforeSettlement = await ledger.getRun(RUN_ID);
        if (!beforeSettlement) throw new Error('Expected managed-effect run.');
        const settled = await ledger.settleStoppedAttemptManagedEffects({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          fencingToken: 'effect-fence',
          generation: 1,
          expectedVersion: beforeSettlement.version,
          transitionId: 'settle-reconciliation-siblings',
          decisions: [
            {
              effectId: 'a-late-outcome',
              expectedEffectVersion: lateOutcome.effect.version,
              disposition: 'outcome-uncertain',
            },
            {
              effectId: 'b-not-applied',
              expectedEffectVersion: notApplied.effect.version,
              disposition: 'outcome-uncertain',
            },
            {
              effectId: 'c-late-failure',
              expectedEffectVersion: lateFailure.effect.version,
              disposition: 'outcome-uncertain',
            },
          ],
          reason: { kind: 'stopped-with-uncertain-effects' },
        });
        const attemptAtUncertainty = structuredClone(settled.attempt);
        const eventsAtUncertainty = await ledger.getEvents(RUN_ID);
        const uncertaintyEvent =
          eventsAtUncertainty[eventsAtUncertainty.length - 1];
        if (!uncertaintyEvent) throw new Error('Expected uncertainty event.');
        const uncertainNotApplied = settled.effects.find(
          (/** @type {Record<string, any>} */ effect) =>
            effect.effectId === 'b-not-applied',
        );
        const uncertainLateOutcome = settled.effects.find(
          (/** @type {Record<string, any>} */ effect) =>
            effect.effectId === 'a-late-outcome',
        );
        const uncertainLateFailure = settled.effects.find(
          (/** @type {Record<string, any>} */ effect) =>
            effect.effectId === 'c-late-failure',
        );
        if (
          !uncertainNotApplied ||
          !uncertainLateOutcome ||
          !uncertainLateFailure
        ) {
          throw new Error('Expected all uncertain effects.');
        }
        const negativeEvidence = {
          destinationEffectId: uncertainNotApplied.destinationEffectId,
          operation: 'put',
          disposition: 'not-applied',
          adapter: adapter.name,
        };
        const negativeRequest = {
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          effectId: 'b-not-applied',
          fencingToken: 'effect-fence',
          generation: 1,
          coordinatorEpoch: 0,
          expectedVersion: settled.run.version,
          expectedEffectVersion: uncertainNotApplied.version,
          uncertaintyEventId: uncertaintyEvent.event_id,
          uncertaintySequence: uncertaintyEvent.sequence,
          transitionId: 'reconcile-b-not-applied',
          reconciliationId: 'reconcile-b-not-applied',
          reason: { kind: 'destination-finalized-not-applied' },
          resolution: {
            kind: 'not-applied',
            verifier: TEST_EFFECT_RECONCILIATION_VERIFIER,
            evidence: negativeEvidence,
          },
        };
        const writesBeforeRejectedEvidence = counted.writes.length;
        await expect(
          ledger.reconcileUncertainManagedEffect({
            ...negativeRequest,
            transitionId: 'reject-negative-evidence',
            resolution: {
              ...negativeRequest.resolution,
              evidence: { ...negativeEvidence, disposition: 'unknown' },
            },
          }),
        ).rejects.toThrow(/not substantiated/i);
        await expect(
          ledger.reconcileUncertainManagedEffect({
            ...negativeRequest,
            transitionId: 'reject-wrong-uncertainty-link',
            reconciliationId: 'reject-wrong-uncertainty-link',
            uncertaintyEventId: 'wrong-uncertainty-event',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        expect(counted.writes).toHaveLength(writesBeforeRejectedEvidence);

        const negative =
          await ledger.reconcileUncertainManagedEffect(negativeRequest);
        expect(negative).toMatchObject({
          applied: true,
          run: { status: RunStatus.BLOCKED },
          invocation: { status: InvocationStatus.UNCERTAIN },
          attempt: { status: AttemptStatus.ABANDONED },
          effect: {
            status: EffectStatus.NOT_APPLIED,
            reconciliation: {
              reconciliationId: 'reconcile-b-not-applied',
              uncertaintyEventId: uncertaintyEvent.event_id,
              uncertaintySequence: uncertaintyEvent.sequence,
              verifier: TEST_EFFECT_RECONCILIATION_VERIFIER,
              resolutionStatus: EffectStatus.NOT_APPLIED,
            },
          },
        });
        expect(negative.attempt).toEqual(attemptAtUncertainty);
        expect(negative.effect).not.toHaveProperty('uncertainty');
        expect(negative.effect).not.toHaveProperty('outcomeRef');
        const writesAfterNegative = counted.writes.length;
        await expect(
          ledger.reconcileUncertainManagedEffect(negativeRequest),
        ).resolves.toMatchObject({ applied: false });
        expect(counted.writes).toHaveLength(writesAfterNegative);
        await expect(
          ledger.reconcileUncertainManagedEffect({
            ...negativeRequest,
            reason: { kind: 'conflicting-reconciliation' },
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);
        await expect(
          ledger.readManagedEffectDelivery(
            RUN_ID,
            INVOCATION_ID,
            'b-not-applied',
          ),
        ).resolves.toEqual(
          expect.not.objectContaining({
            outcome: expect.anything(),
            resultFrame: expect.anything(),
          }),
        );

        const positiveRequest = {
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          effectId: 'a-late-outcome',
          fencingToken: 'effect-fence',
          generation: 1,
          coordinatorEpoch: 0,
          expectedVersion: negative.run.version,
          expectedEffectVersion: uncertainLateOutcome.version,
          uncertaintyEventId: uncertaintyEvent.event_id,
          uncertaintySequence: uncertaintyEvent.sequence,
          transitionId: 'reconcile-a-late-outcome',
          reconciliationId: 'reconcile-a-late-outcome',
          reason: { kind: 'late-destination-outcome' },
          resolution: {
            kind: 'outcome',
            outcome: {
              ok: true,
              result: { recovered: true },
              evidence: {
                destinationEffectId: uncertainLateOutcome.destinationEffectId,
                operation: 'put',
              },
            },
          },
        };
        const writesBeforeRejectedOutcome = counted.writes.length;
        await expect(
          ledger.reconcileUncertainManagedEffect({
            ...positiveRequest,
            transitionId: 'reject-extra-outcome-field',
            reconciliationId: 'reject-extra-outcome-field',
            resolution: {
              kind: 'outcome',
              outcome: {
                ...positiveRequest.resolution.outcome,
                ignoredAlias: 'must-not-be-silently-discarded',
              },
            },
          }),
        ).rejects.toThrow(/resolution\.outcome/i);
        expect(counted.writes).toHaveLength(writesBeforeRejectedOutcome);
        await expect(
          ledger.reconcileUncertainManagedEffect({
            ...positiveRequest,
            expectedVersion: settled.run.version,
            transitionId: 'reject-stale-reconciliation-version',
            reconciliationId: 'reject-stale-reconciliation-version',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        const positive =
          await ledger.reconcileUncertainManagedEffect(positiveRequest);
        expect(positive).toMatchObject({
          applied: true,
          run: { status: RunStatus.BLOCKED },
          invocation: { status: InvocationStatus.UNCERTAIN },
          attempt: { status: AttemptStatus.ABANDONED },
          effect: {
            status: EffectStatus.COMPLETED,
            terminal: { ok: true },
            reconciliation: {
              uncertaintyEventId: uncertaintyEvent.event_id,
              uncertaintySequence: uncertaintyEvent.sequence,
              resolutionStatus: EffectStatus.COMPLETED,
            },
          },
        });
        expect(positive.attempt).toEqual(attemptAtUncertainty);
        const failed = await ledger.reconcileUncertainManagedEffect({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          effectId: 'c-late-failure',
          fencingToken: 'effect-fence',
          generation: 1,
          coordinatorEpoch: 0,
          expectedVersion: positive.run.version,
          expectedEffectVersion: uncertainLateFailure.version,
          uncertaintyEventId: uncertaintyEvent.event_id,
          uncertaintySequence: uncertaintyEvent.sequence,
          transitionId: 'reconcile-c-late-failure',
          reconciliationId: 'reconcile-c-late-failure',
          reason: { kind: 'late-destination-failure' },
          resolution: {
            kind: 'outcome',
            outcome: {
              ok: false,
              error: {
                code: 'destination-rejected',
                name: 'DestinationError',
                message: 'The destination rejected the operation.',
                details: {},
              },
              evidence: {
                destinationEffectId: uncertainLateFailure.destinationEffectId,
                operation: 'put',
              },
            },
          },
        });
        expect(failed).toMatchObject({
          run: { status: RunStatus.BLOCKED },
          invocation: { status: InvocationStatus.UNCERTAIN },
          attempt: attemptAtUncertainty,
          effect: {
            status: EffectStatus.FAILED,
            terminal: { ok: false },
            reconciliation: { resolutionStatus: EffectStatus.FAILED },
          },
        });
        const rebuilt = await ledger.rebuildRun(RUN_ID);
        expect(rebuilt).toMatchObject({
          run: { status: RunStatus.BLOCKED },
          invocations: [{ status: InvocationStatus.UNCERTAIN }],
          attempts: [attemptAtUncertainty],
          effects: [
            { effectId: 'a-late-outcome', status: EffectStatus.COMPLETED },
            { effectId: 'b-not-applied', status: EffectStatus.NOT_APPLIED },
            { effectId: 'c-late-failure', status: EffectStatus.FAILED },
          ],
        });
        expect(
          rebuilt?.events
            .slice(-3)
            .map((/** @type {Record<string, any>} */ event) => event.type),
        ).toEqual([
          'uncertain-effect-reconciled',
          'uncertain-effect-reconciled',
          'uncertain-effect-reconciled',
        ]);
        await expect(
          ledger.readManagedEffectDelivery(
            RUN_ID,
            INVOCATION_ID,
            'a-late-outcome',
          ),
        ).resolves.toMatchObject({
          outcome: { ok: true, result: { recovered: true } },
          resultFrame: { type: 'effect-result', ok: true },
        });
        await expect(
          ledger.readManagedEffectDelivery(
            RUN_ID,
            INVOCATION_ID,
            'c-late-failure',
          ),
        ).resolves.toMatchObject({
          outcome: { ok: false, error: { code: 'destination-rejected' } },
          resultFrame: { type: 'effect-result', ok: false },
        });

        const successfulDelivery = await ledger.readManagedEffectDelivery(
          RUN_ID,
          INVOCATION_ID,
          'a-late-outcome',
        );
        const failedDelivery = await ledger.readManagedEffectDelivery(
          RUN_ID,
          INVOCATION_ID,
          'c-late-failure',
        );
        if (!successfulDelivery?.resultFrame || !failedDelivery?.resultFrame) {
          throw new Error('Expected both reconciled managed-effect results.');
        }
        const transcript = new ActivityProtocolTranscriptValidator();
        const acceptedStart = transcript.acceptHostFrame(started.startFrame);
        const acceptedSuccessfulRequest = transcript.acceptComponentFrame(
          effectRequestFrame(started.attempt.attemptId, 'a-late-outcome', 1),
        );
        const acceptedSuccessfulResult = transcript.acceptHostFrame(
          successfulDelivery.resultFrame,
        );
        const acceptedNotAppliedRequest = transcript.acceptComponentFrame(
          effectRequestFrame(started.attempt.attemptId, 'b-not-applied', 2),
        );
        const acceptedFailedRequest = transcript.acceptComponentFrame(
          effectRequestFrame(started.attempt.attemptId, 'c-late-failure', 3),
        );
        const acceptedFailedResult = transcript.acceptHostFrame(
          failedDelivery.resultFrame,
        );
        const acceptedTerminal = transcript.acceptComponentFrame({
          protocol: 'wharfie.activity',
          protocolVersion: 1,
          type: 'failed',
          attemptId: started.attempt.attemptId,
          sequence: 4,
          error: {
            code: 'activity-failed-after-effect-loss',
            name: 'ActivityError',
            message:
              'The activity failed after one destination response was lost.',
            details: {},
          },
        });
        const terminalRequest = {
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          fencingToken: 'effect-fence',
          generation: 1,
          coordinatorEpoch: 0,
          expectedVersion: failed.run.version,
          uncertaintyEventId: uncertaintyEvent.event_id,
          uncertaintySequence: uncertaintyEvent.sequence,
          transitionId: 'reconcile-attempt-after-effect-reconciliations',
          reconciliationId: 'reconcile-attempt-after-effect-reconciliations',
          reason: { kind: 'retained-terminal-after-effect-reconciliation' },
          evidence: {
            status: acceptedTerminal.type,
            start: acceptedStart,
            terminal: acceptedTerminal,
            frames: [
              acceptedStart,
              acceptedSuccessfulRequest,
              acceptedSuccessfulResult,
              acceptedNotAppliedRequest,
              acceptedFailedRequest,
              acceptedFailedResult,
              acceptedTerminal,
            ],
            transcript: transcript.snapshot(),
          },
        };
        const terminal =
          await ledger.reconcileUncertainManualAttempt(terminalRequest);
        expect(terminal).toMatchObject({
          applied: true,
          run: { status: RunStatus.FAILED },
          invocation: { status: InvocationStatus.FAILED },
          attempt: attemptAtUncertainty,
        });
        await expect(
          ledger.reconcileUncertainManualAttempt(terminalRequest),
        ).resolves.toMatchObject({
          applied: false,
          run: { status: RunStatus.FAILED },
          invocation: { status: InvocationStatus.FAILED },
          attempt: attemptAtUncertainty,
        });

        const withoutNegativeVerifier = createProductionExecutionLedger({
          db,
          tableName,
          payloadStore: counted.payloadStore,
          effectEvidenceVerifiers: [effectVerifierRegistration()],
          now: createClock(),
        });
        await expect(
          withoutNegativeVerifier.getRun(RUN_ID),
        ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);
        const negativeEvidenceRef =
          negative.effect?.reconciliation?.evidenceRef;
        if (!negativeEvidenceRef) {
          throw new Error(
            'Expected retained negative reconciliation evidence.',
          );
        }
        writeFileSync(
          PAYLOAD_STORE.getPath(negativeEvidenceRef),
          '{"tampered":true}',
          'utf8',
        );
        await expect(ledger.rebuildRun(RUN_ID)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
      } finally {
        await cleanup();
      }
    });

    test('links effect reconciliation to a singular uncertainty event', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-singular-effect-reconciliation',
          effectEvidenceVerifiers: [
            effectVerifierRegistration(),
            effectReconciliationVerifierRegistration(),
          ],
          now: createClock(),
        });
        const started = await createStartedManagedAttempt(ledger);
        const retained = await retainEffect(ledger, started, {
          effectId: 'singular-uncertain-effect',
          sequence: 1,
          status: EffectStatus.STARTED,
        });
        const uncertain = await ledger.markManagedEffectUncertain({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          effectId: 'singular-uncertain-effect',
          fencingToken: 'effect-fence',
          generation: 1,
          expectedVersion: retained.run.version,
          expectedEffectVersion: retained.effect.version,
          transitionId: 'singular-effect-uncertain',
          reason: { kind: 'singular-effect-outcome-unknown' },
        });
        const uncertaintyEvent = (await ledger.getEvents(RUN_ID)).find(
          (event) => event.type === 'effect-became-uncertain',
        );
        if (!uncertaintyEvent) {
          throw new Error('Expected singular managed-effect uncertainty.');
        }
        await expect(
          ledger.reconcileUncertainManagedEffect({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId: started.attempt.attemptId,
            effectId: 'singular-uncertain-effect',
            fencingToken: 'effect-fence',
            generation: 1,
            coordinatorEpoch: 0,
            expectedVersion: uncertain.run.version,
            expectedEffectVersion: uncertain.effect.version,
            uncertaintyEventId: uncertaintyEvent.event_id,
            uncertaintySequence: uncertaintyEvent.sequence,
            transitionId: 'reconcile-singular-effect',
            reconciliationId: 'reconcile-singular-effect',
            reason: { kind: 'singular-effect-finalized' },
            resolution: {
              kind: 'not-applied',
              verifier: TEST_EFFECT_RECONCILIATION_VERIFIER,
              evidence: {
                destinationEffectId: uncertain.effect.destinationEffectId,
                operation: 'put',
                disposition: 'not-applied',
              },
            },
          }),
        ).resolves.toMatchObject({
          run: { status: RunStatus.BLOCKED },
          invocation: { status: InvocationStatus.UNCERTAIN },
          attempt: { status: AttemptStatus.ABANDONED },
          effect: {
            status: EffectStatus.NOT_APPLIED,
            reconciliation: {
              uncertaintyEventId: uncertaintyEvent.event_id,
              uncertaintySequence: uncertaintyEvent.sequence,
            },
          },
        });
      } finally {
        await cleanup();
      }
    });

    test('admits at most sixteen unresolved effects and reserves byte-safe closure before publication', async () => {
      const countHarness = await adapter.create();
      const counted = createCountingPayloadStore();
      try {
        const ledger = createProductionExecutionLedger({
          db: countHarness.db,
          tableName: 'execution-ledger-effect-count-bound',
          payloadStore: counted.payloadStore,
          effectEvidenceVerifiers: [effectVerifierRegistration()],
          now: createClock(),
        });
        const started = await createStartedManagedAttempt(ledger);
        for (
          let index = 0;
          index < EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS;
          index += 1
        ) {
          await retainEffect(ledger, started, {
            effectId: `pending-${String(index).padStart(2, '0')}`,
            sequence: index + 1,
            status: EffectStatus.PENDING,
          });
        }
        const writesAtLimit = counted.writes.length;
        const runAtLimit = await ledger.rebuildRun(RUN_ID);
        await expect(
          retainEffect(ledger, started, {
            effectId: 'pending-17',
            sequence: 17,
            status: EffectStatus.PENDING,
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        expect(counted.writes).toHaveLength(writesAtLimit);
        await expect(ledger.rebuildRun(RUN_ID)).resolves.toEqual(runAtLimit);
      } finally {
        await countHarness.cleanup();
      }

      const byteHarness = await adapter.create();
      const byteCounted = createCountingPayloadStore();
      try {
        const ledger = createProductionExecutionLedger({
          db: byteHarness.db,
          tableName: 'execution-ledger-effect-byte-bound',
          payloadStore: byteCounted.payloadStore,
          effectEvidenceVerifiers: [effectVerifierRegistration()],
          now: createClock(),
        });
        const started = await createStartedManagedAttempt(ledger);
        const writesBefore = byteCounted.writes.length;
        const eventsBefore = await ledger.getEvents(RUN_ID);
        await expect(
          retainEffect(ledger, started, {
            effectId: 'oversized-closure',
            sequence: 1,
            status: EffectStatus.PENDING,
            destination: {
              ...TEST_EFFECT_DESTINATION,
              configuration: { padding: 'x'.repeat(63_500) },
            },
          }),
        ).rejects.toThrow(/closure reserve|64 KiB/i);
        expect(byteCounted.writes).toHaveLength(writesBefore);
        await expect(ledger.getEvents(RUN_ID)).resolves.toEqual(eventsBefore);
        await expect(
          ledger.getEffect(RUN_ID, INVOCATION_ID, 'oversized-closure'),
        ).resolves.toBeNull();
      } finally {
        await byteHarness.cleanup();
      }
    }, 15_000);

    test('reconciles a cancelled terminal that omits the result of a durably cancelled effect', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-cancelled-effect-reconciliation',
          effectEvidenceVerifiers: [effectVerifierRegistration()],
          now: createClock(),
        });
        const started = await createStartedManagedAttempt(ledger);
        const requested = await retainEffect(ledger, started, {
          effectId: 'cancelled-pending',
          sequence: 1,
          status: EffectStatus.PENDING,
        });
        const cancellation = await ledger.requestManualRunCancellation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          expectedVersion: requested.run.version,
          expectedGeneration: 1,
          transitionId: 'request-effect-cancellation',
          requestId: 'request-effect-cancellation',
          reason: CANCELLATION_REASON,
          attemptId: started.attempt.attemptId,
          fencingToken: 'effect-fence',
        });
        const settled = await ledger.settleStoppedAttemptManagedEffects({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          fencingToken: 'effect-fence',
          generation: 1,
          expectedVersion: cancellation.run.version,
          transitionId: 'settle-cancelled-effect',
          decisions: [
            {
              effectId: 'cancelled-pending',
              expectedEffectVersion: requested.effect.version,
              disposition: 'cancelled-before-start',
            },
          ],
          reason: { kind: 'stopped-after-cancel' },
        });
        const events = await ledger.getEvents(RUN_ID);
        const uncertaintyEvent = events[events.length - 1];
        const reconciled = await ledger.reconcileUncertainManualAttempt({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          fencingToken: 'effect-fence',
          generation: 1,
          coordinatorEpoch: 0,
          expectedVersion: settled.run.version,
          uncertaintyEventId: uncertaintyEvent.event_id,
          uncertaintySequence: uncertaintyEvent.sequence,
          transitionId: 'reconcile-cancelled-effect',
          reconciliationId: 'reconcile-cancelled-effect',
          reason: { kind: 'recovered-cancelled-transcript' },
          evidence: cancelledEvidenceWithEffectRequest(
            started.startFrame,
            effectRequestFrame(
              started.attempt.attemptId,
              'cancelled-pending',
              1,
            ),
          ),
        });
        expect(reconciled).toMatchObject({
          run: { status: RunStatus.CANCELLED },
          invocation: { status: InvocationStatus.CANCELLED },
          attempt: { status: AttemptStatus.ABANDONED },
        });
        await expect(
          ledger.readRunOutput({ appId: 'demo', runId: RUN_ID }),
        ).resolves.toMatchObject({
          snapshot: {
            runKind: 'manual',
            status: RunStatus.CANCELLED,
            version: reconciled.run.version,
            lastSequence: reconciled.run.lastSequence,
          },
          outputs: [],
          terminal: {
            type: 'cancelled',
            error: CANCELLATION_REASON,
          },
        });
        await expect(
          ledger.getEffect(RUN_ID, INVOCATION_ID, 'cancelled-pending'),
        ).resolves.toMatchObject({
          status: EffectStatus.CANCELLED,
          cancellation: expect.any(Object),
        });
      } finally {
        await cleanup();
      }
    });

    test('reads a verified manual request with its exact creation actor', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-manual-request-read',
          now: createClock(),
        });
        await expect(
          ledger.readManualRunRequest(RUN_ID, INVOCATION_ID),
        ).resolves.toBeNull();

        const actor = { kind: 'submitter', id: 'request-read-test' };
        await ledger.createManualRun(manualRun({ actor }));
        const first = await ledger.readManualRunRequest(RUN_ID, INVOCATION_ID);
        if (!first) throw new Error('Expected a verified manual request.');
        expect(first).toMatchObject({
          run: {
            runId: RUN_ID,
            appId: 'demo',
            revisionId: REVISION_ID,
            status: RunStatus.RUNNING,
          },
          invocation: {
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            activityId: ACTIVITY_ID,
            status: InvocationStatus.RUNNABLE,
          },
          request: {
            input: { name: 'Ada' },
            callerMetadata: { source: 'test' },
          },
          actor,
        });
        await expect(
          ledger.readManualRunRequest(RUN_ID, 'missing-invocation'),
        ).resolves.toBeNull();

        first.request.input.name = 'mutated-return-value';
        first.actor.id = 'mutated-return-value';
        await expect(
          ledger.readManualRunRequest(RUN_ID, INVOCATION_ID),
        ).resolves.toMatchObject({
          request: { input: { name: 'Ada' } },
          actor,
        });
      } finally {
        await cleanup();
      }
    });

    test('appends and folds one terminal manual activity with durable receipts', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-lifecycle',
          now: createClock(),
        });

        const created = await ledger.createManualRun(manualRun());
        expect(created).toMatchObject({
          applied: true,
          run: {
            status: RunStatus.RUNNING,
            version: 1,
            lastSequence: 1,
          },
          invocation: {
            status: InvocationStatus.RUNNABLE,
            generation: 0,
            version: 1,
          },
        });
        expect(created.run).toMatchObject({
          requestRef: {
            payloadSchema: 'wharfie.execution.activity-request.v1',
          },
        });
        expect(created.run).not.toHaveProperty('input');
        expect(created.invocation).not.toHaveProperty('callerMetadata');
        expect((await ledger.createManualRun(manualRun())).applied).toBe(false);
        await expect(
          ledger.createManualRun(manualRun({ input: { name: 'Grace' } })),
        ).rejects.toBeInstanceOf(ExecutionLedgerRunConflictError);

        const claim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'fence-1',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'claim-1',
        });
        expect(claim).toMatchObject({
          applied: true,
          run: { version: 2, lastSequence: 2 },
          invocation: {
            status: InvocationStatus.RUNNING,
            generation: 1,
            version: 2,
          },
          attempt: {
            status: AttemptStatus.CLAIMED,
            generation: 1,
            fencingToken: 'fence-1',
          },
        });
        const attemptId = claim.attempt?.attemptId;
        expect(typeof attemptId).toBe('string');
        expect(
          (
            await ledger.claimInvocation({
              runId: RUN_ID,
              invocationId: INVOCATION_ID,
              fencingToken: 'fence-1',
              expectedGeneration: 0,
              expectedVersion: 1,
              transitionId: 'claim-1',
            })
          ).applied,
        ).toBe(false);
        await expect(
          ledger.claimInvocation({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            fencingToken: 'different-fence',
            expectedGeneration: 0,
            expectedVersion: 1,
            transitionId: 'claim-1',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);

        await expect(
          ledger.markAttemptStarted({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken: 'fence-1',
            generation: 1,
            expectedVersion: 2,
            coordinatorEpoch: 1,
            transitionId: 'start-stale-fence',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);

        const started = await ledger.markAttemptStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'fence-1',
          generation: 1,
          expectedVersion: 2,
          transitionId: 'start-1',
        });
        expect(started).toMatchObject({
          dispatchAuthorized: true,
          run: { version: 3, lastSequence: 3 },
          attempt: { status: AttemptStatus.STARTED, version: 2 },
        });
        expect(started.startFrame).toEqual(attemptStart(attemptId, 'fence-1'));
        expect(Object.isFrozen(started.startFrame)).toBe(true);
        await expect(
          ledger.markAttemptStarted({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken: 'fence-1',
            generation: 1,
            expectedVersion: 2,
            transitionId: 'start-1',
          }),
        ).resolves.toMatchObject({
          applied: false,
          dispatchAuthorized: false,
          startFrame: attemptStart(attemptId, 'fence-1'),
        });

        const invalidCancelledTerminal = {
          protocol: 'wharfie.activity',
          protocolVersion: 1,
          type: 'cancelled',
          attemptId,
          sequence: 1,
          error: {
            code: 'cancelled',
            name: 'CancellationError',
            message: 'cancel was never requested',
            details: {},
          },
        };
        await expect(
          ledger.commitVerifiedAttemptTerminal({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken: 'fence-1',
            generation: 1,
            expectedVersion: 3,
            transitionId: 'invalid-terminal',
            evidence: {
              status: 'cancelled',
              start: attemptStart(attemptId, 'fence-1'),
              terminal: invalidCancelledTerminal,
              frames: [
                attemptStart(attemptId, 'fence-1'),
                invalidCancelledTerminal,
              ],
              transcript: {},
            },
          }),
        ).rejects.toThrow(
          /cancelled terminal requires a preceding host cancel/i,
        );

        const evidence = completedEvidence(attemptId, 'fence-1');
        const terminalSummary = {
          type: evidence.terminal.type,
          attemptId: evidence.terminal.attemptId,
        };
        const committed = await ledger.commitVerifiedAttemptTerminal({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'fence-1',
          generation: 1,
          expectedVersion: 3,
          transitionId: 'terminal-1',
          evidence,
        });
        expect(committed).toMatchObject({
          run: { status: RunStatus.COMPLETED, version: 4 },
          invocation: {
            status: InvocationStatus.COMPLETED,
            terminal: terminalSummary,
          },
          attempt: {
            status: AttemptStatus.COMPLETED,
            terminal: terminalSummary,
            evidenceRef: {
              payloadSchema: 'wharfie.execution.activity-evidence.v1',
            },
          },
        });
        expect(committed.attempt).not.toHaveProperty('evidence');
        await expect(
          ledger.commitVerifiedAttemptTerminal({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken: 'fence-1',
            generation: 1,
            expectedVersion: 3,
            transitionId: 'second-terminal',
            evidence,
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);

        expect(
          (await ledger.getEvents(RUN_ID)).map(({ type }) => type),
        ).toEqual([
          'manual-run-created',
          'attempt-claimed',
          'attempt-started',
          'attempt-terminal',
        ]);
        await expect(ledger.rebuildRun(RUN_ID)).resolves.toMatchObject({
          head: { version: 4, sequence: 4 },
          run: { status: RunStatus.COMPLETED },
          invocations: [
            { invocationId: INVOCATION_ID, status: InvocationStatus.COMPLETED },
          ],
          attempts: [{ attemptId, status: AttemptStatus.COMPLETED }],
        });
      } finally {
        await cleanup();
      }
    });

    test('releases only unstarted work and blocks ambiguous started work', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-recovery',
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const firstClaim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'fence-1',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'claim-unstarted',
        });
        const firstAttemptId = firstClaim.attempt?.attemptId;
        expect(typeof firstAttemptId).toBe('string');
        const released = await ledger.abandonUnstartedAttempt({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: firstAttemptId,
          fencingToken: 'fence-1',
          generation: 1,
          expectedVersion: 2,
          transitionId: 'abandon-unstarted',
          reason: { code: 'coordinator-restarted' },
        });
        expect(released).toMatchObject({
          run: { status: RunStatus.RUNNING, version: 3 },
          invocation: {
            status: InvocationStatus.RUNNABLE,
            generation: 1,
          },
          attempt: { status: AttemptStatus.ABANDONED },
        });

        const secondClaim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'fence-2',
          expectedGeneration: 1,
          expectedVersion: 3,
          transitionId: 'claim-started',
        });
        const secondAttemptId = secondClaim.attempt?.attemptId;
        expect(typeof secondAttemptId).toBe('string');
        await ledger.markAttemptStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: secondAttemptId,
          fencingToken: 'fence-2',
          generation: 2,
          expectedVersion: 4,
          transitionId: 'start-2',
        });
        const uncertain = await ledger.markAttemptUncertain({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: secondAttemptId,
          fencingToken: 'fence-2',
          generation: 2,
          expectedVersion: 5,
          transitionId: 'uncertain-2',
          reason: { code: 'delivery-lost', lastAcknowledgedSequence: 0 },
        });
        expect(uncertain).toMatchObject({
          run: { status: RunStatus.BLOCKED, version: 6 },
          invocation: {
            status: InvocationStatus.UNCERTAIN,
            uncertainty: { code: 'delivery-lost', lastAcknowledgedSequence: 0 },
          },
          attempt: { status: AttemptStatus.ABANDONED },
        });
        await expect(
          ledger.claimInvocation({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            fencingToken: 'fence-3',
            expectedGeneration: 2,
            expectedVersion: 6,
            transitionId: 'unsafe-retry',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
      } finally {
        await cleanup();
      }
    });

    test('reconciles an exact uncertain attempt without rewriting its abandoned physical lifecycle', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-reconciliation',
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const claimed = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'reconcile-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'reconcile-claim',
        });
        const attemptId = claimed.attempt?.attemptId;
        expect(typeof attemptId).toBe('string');
        const started = await ledger.markAttemptStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'reconcile-fence',
          generation: 1,
          expectedVersion: 2,
          transitionId: 'reconcile-start',
        });
        const uncertain = await ledger.markAttemptUncertain({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'reconcile-fence',
          generation: 1,
          expectedVersion: 3,
          transitionId: 'reconcile-uncertain',
          reason: { code: 'runner-outcome-lost' },
        });
        const uncertaintyEvent = (await ledger.getEvents(RUN_ID)).find(
          (event) => event.type === 'attempt-became-uncertain',
        );
        expect(uncertaintyEvent).toMatchObject({
          sequence: 4,
          event_id: expect.any(String),
        });
        const attemptBefore = await ledger.getAttempt(
          RUN_ID,
          INVOCATION_ID,
          /** @type {string} */ (attemptId),
        );
        const evidence = completedEvidenceForStart(started.startFrame, {
          greeting: `reconciled-${adapter.name}`,
        });
        const reconciliation = {
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'reconcile-fence',
          generation: 1,
          coordinatorEpoch: 0,
          expectedVersion: uncertain.run.version,
          uncertaintyEventId: uncertaintyEvent?.event_id,
          uncertaintySequence: uncertaintyEvent?.sequence,
          transitionId: 'reconcile-1',
          reconciliationId: 'reconciliation-request-1',
          reason: { code: 'host-transcript-recovered' },
          evidence,
        };

        await expect(
          ledger.reconcileUncertainManualAttempt({
            ...reconciliation,
            transitionId: 'reconcile-wrong-link',
            reconciliationId: 'reconciliation-request-wrong-link',
            uncertaintyEventId: 'different-uncertainty-event',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        await expect(
          ledger.reconcileUncertainManualAttempt({
            ...reconciliation,
            transitionId: 'reconcile-missing-link',
            reconciliationId: 'reconciliation-request-missing-link',
            uncertaintyEventId: 'missing-uncertainty-event',
            uncertaintySequence: 99,
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);

        const reconciled =
          await ledger.reconcileUncertainManualAttempt(reconciliation);
        expect(reconciled).toMatchObject({
          applied: true,
          receipt: {
            type: 'uncertain-attempt-reconciled',
            invocation_id: INVOCATION_ID,
            attempt_id: attemptId,
          },
          run: { status: RunStatus.COMPLETED, version: 5, lastSequence: 5 },
          invocation: {
            status: InvocationStatus.COMPLETED,
            terminal: { type: 'completed', attemptId },
          },
          attempt: { status: AttemptStatus.ABANDONED },
        });
        expect(reconciled.invocation).not.toHaveProperty('uncertainty');
        expect(reconciled.attempt).toEqual(attemptBefore);
        expect(reconciled.attempt).not.toHaveProperty('evidenceRef');
        await expect(
          ledger.readRunOutput({ appId: 'demo', runId: RUN_ID }),
        ).resolves.toEqual({
          scope: {
            appId: 'demo',
            revisionId: REVISION_ID,
            runId: RUN_ID,
          },
          snapshot: {
            runKind: 'manual',
            status: RunStatus.COMPLETED,
            version: reconciled.run.version,
            lastSequence: reconciled.run.lastSequence,
          },
          outputs: [],
          terminal: {
            type: 'completed',
            result: { greeting: `reconciled-${adapter.name}` },
          },
        });

        await expect(
          ledger.reconcileUncertainManualAttempt(reconciliation),
        ).resolves.toMatchObject({
          applied: false,
          receipt: { transition_id: 'reconcile-1' },
          run: { status: RunStatus.COMPLETED },
          attempt: attemptBefore,
        });
        await expect(
          ledger.reconcileUncertainManualAttempt({
            ...reconciliation,
            reason: { code: 'different-reconciliation-reason' },
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);

        await expect(ledger.rebuildRun(RUN_ID)).resolves.toMatchObject({
          head: { version: 5, sequence: 5 },
          run: { status: RunStatus.COMPLETED },
          invocations: [
            {
              invocationId: INVOCATION_ID,
              status: InvocationStatus.COMPLETED,
              terminal: { type: 'completed', attemptId },
            },
          ],
          attempts: [attemptBefore],
          events: [
            expect.any(Object),
            expect.any(Object),
            expect.any(Object),
            expect.any(Object),
            expect.objectContaining({
              type: 'uncertain-attempt-reconciled',
              payload: expect.objectContaining({
                reconciliation: expect.objectContaining({
                  reconciliationId: 'reconciliation-request-1',
                  uncertaintyEventId: uncertaintyEvent?.event_id,
                  uncertaintySequence: uncertaintyEvent?.sequence,
                  terminal: { type: 'completed', attemptId },
                  evidenceRef: expect.objectContaining({
                    payloadSchema: 'wharfie.execution.activity-evidence.v1',
                  }),
                }),
              }),
            }),
          ],
        });
        const reconciliationEvent = (await ledger.getEvents(RUN_ID))[4];
        expect(reconciliationEvent?.payload).not.toHaveProperty('attempt');
        const evidenceRef =
          reconciliationEvent?.payload?.reconciliation?.evidenceRef;
        if (!evidenceRef) {
          throw new Error('Expected retained reconciliation evidence ref');
        }
        writeFileSync(
          PAYLOAD_STORE.getPath(evidenceRef),
          '{"tampered":true}',
          'utf8',
        );
        await expect(ledger.rebuildRun(RUN_ID)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
      } finally {
        await cleanup();
      }
    });

    test('reconciles a cancelled uncertain attempt only from matching durable cancellation authority', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-reconciliation-cancelled',
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const claimed = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'reconcile-cancel-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'reconcile-cancel-claim',
        });
        const attemptId = claimed.attempt?.attemptId;
        expect(typeof attemptId).toBe('string');
        const started = await ledger.markAttemptStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'reconcile-cancel-fence',
          generation: 1,
          expectedVersion: 2,
          transitionId: 'reconcile-cancel-start',
        });
        await ledger.requestManualRunCancellation({
          ...manualCancellationRequest({
            expectedVersion: 3,
            expectedGeneration: 1,
            transitionId: 'reconcile-cancel-request',
            attemptId,
            fencingToken: 'reconcile-cancel-fence',
          }),
        });
        const uncertain = await ledger.markAttemptUncertain({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'reconcile-cancel-fence',
          generation: 1,
          expectedVersion: 4,
          transitionId: 'reconcile-cancel-uncertain',
          reason: { code: 'cancellation-delivery-outcome-lost' },
        });
        const uncertaintyEvent = (await ledger.getEvents(RUN_ID)).find(
          (event) => event.type === 'attempt-became-uncertain',
        );
        const baseReconciliation = {
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'reconcile-cancel-fence',
          generation: 1,
          coordinatorEpoch: 0,
          expectedVersion: uncertain.run.version,
          uncertaintyEventId: uncertaintyEvent?.event_id,
          uncertaintySequence: uncertaintyEvent?.sequence,
          reason: { code: 'host-cancellation-transcript-recovered' },
        };

        await expect(
          ledger.reconcileUncertainManualAttempt({
            ...baseReconciliation,
            transitionId: 'reconcile-cancel-protocol-failed',
            reconciliationId: 'reconciliation-cancel-protocol-failed',
            evidence: failedCancellationEvidenceForStart(started.startFrame),
          }),
        ).rejects.toThrow(/protocol-failed.*after cancellation/i);

        const reconciled = await ledger.reconcileUncertainManualAttempt({
          ...baseReconciliation,
          transitionId: 'reconcile-cancelled',
          reconciliationId: 'reconciliation-cancelled',
          evidence: cancelledEvidenceForStart(started.startFrame),
        });
        expect(reconciled).toMatchObject({
          run: {
            status: RunStatus.CANCELLED,
            cancellationRequest: { requestId: 'cancel-request-1' },
          },
          invocation: {
            status: InvocationStatus.CANCELLED,
            cancellationRequest: { requestId: 'cancel-request-1' },
            terminal: { type: 'cancelled', attemptId },
          },
          attempt: {
            status: AttemptStatus.ABANDONED,
            cancellationRequest: { requestId: 'cancel-request-1' },
          },
        });
        expect(reconciled.attempt).not.toHaveProperty('terminal');
        expect(reconciled.attempt).not.toHaveProperty('evidenceRef');
      } finally {
        await cleanup();
      }
    });

    test('cancels a runnable manual invocation without creating a physical attempt', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-cancel-runnable',
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());

        const cancelled = await ledger.requestManualRunCancellation(
          manualCancellationRequest(),
        );

        expect(cancelled).toMatchObject({
          applied: true,
          outcome: 'cancellation-requested',
          run: {
            status: RunStatus.CANCELLED,
            version: 2,
            cancellationRequest: {
              requestId: 'cancel-request-1',
              requestedAt: expect.any(Number),
              actor: { kind: 'operator', id: 'ledger-contract-test' },
              reason: CANCELLATION_REASON,
            },
          },
          invocation: {
            status: InvocationStatus.CANCELLED,
            generation: 0,
            cancellationRequest: {
              requestId: 'cancel-request-1',
              reason: CANCELLATION_REASON,
            },
          },
        });
        expect(cancelled.attempt).toBeUndefined();
        await expect(ledger.rebuildRun(RUN_ID)).resolves.toMatchObject({
          run: { status: RunStatus.CANCELLED },
          invocations: [{ status: InvocationStatus.CANCELLED }],
          attempts: [],
          events: [
            { type: 'manual-run-created' },
            { type: 'manual-cancellation-requested' },
          ],
        });
      } finally {
        await cleanup();
      }
    });

    test('keeps the caller retry ID separate from the immutable cancellation receipt', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-cancel-request-identity',
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const request = manualCancellationRequest({
          // A caller may legitimately choose a lifecycle-looking retry key.
          // It must not collide with receipt storage or event identity.
          requestId: 'create',
          transitionId: 'internal-cancel-receipt',
        });

        await expect(
          ledger.requestManualRunCancellation(request),
        ).resolves.toMatchObject({
          applied: true,
          receipt: { transition_id: 'internal-cancel-receipt' },
          run: {
            cancellationRequest: {
              requestId: 'create',
              transitionId: 'internal-cancel-receipt',
            },
          },
        });
        await expect(ledger.rebuildRun(RUN_ID)).resolves.toMatchObject({
          run: {
            cancellationRequest: {
              requestId: 'create',
              transitionId: 'internal-cancel-receipt',
            },
          },
          events: [
            expect.any(Object),
            expect.objectContaining({
              type: 'manual-cancellation-requested',
              transition_id: 'internal-cancel-receipt',
            }),
          ],
        });
        await expect(
          ledger.requestManualRunCancellation(request),
        ).resolves.toMatchObject({
          applied: false,
          receipt: { transition_id: 'internal-cancel-receipt' },
          run: { cancellationRequest: { requestId: 'create' } },
        });
        await expect(
          ledger.requestManualRunCancellation({
            ...request,
            requestId: 'different-caller-retry-key',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);

        const missingRequestId = { ...request };
        delete missingRequestId.requestId;
        await expect(
          ledger.requestManualRunCancellation(missingRequestId),
        ).rejects.toThrow(/requestId/i);
      } finally {
        await cleanup();
      }
    });

    test('rejects an explicit null actor while defaulting an omitted actor', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-cancel-actor-boundary',
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());

        await expect(
          ledger.requestManualRunCancellation(
            manualCancellationRequest({ actor: null }),
          ),
        ).rejects.toThrow(/actor/i);
        await expect(ledger.getEvents(RUN_ID)).resolves.toHaveLength(1);

        const requestWithoutActor = manualCancellationRequest();
        delete requestWithoutActor.actor;
        await expect(
          ledger.requestManualRunCancellation(requestWithoutActor),
        ).resolves.toMatchObject({
          applied: true,
          outcome: 'cancellation-requested',
          run: {
            status: RunStatus.CANCELLED,
            cancellationRequest: {
              actor: { kind: 'local', id: 'local' },
            },
          },
        });
      } finally {
        await cleanup();
      }
    });

    test('classifies the durable first writer when distinct cancellation IDs race', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'execution-ledger-cancel-first-writer-race';
        const directLedger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await directLedger.createManualRun(manualRun());
        let injectWinner = true;
        const guardedDb = {
          ...db,
          /** @param {any} params - Transaction forwarded after the injected cancellation wins. */
          transactionWrite: async (params) => {
            const isCancellation = params.putRequests.some(
              (/** @type {any} */ request) =>
                request.record.record_type === 'execution_ledger_event' &&
                request.record.type === 'manual-cancellation-requested',
            );
            if (injectWinner && isCancellation) {
              injectWinner = false;
              await directLedger.requestManualRunCancellation(
                manualCancellationRequest({
                  transitionId: 'cancel-request-winner',
                  requestId: 'cancel-request-winner',
                  reason: {
                    ...CANCELLATION_REASON,
                    details: { requestId: 'cancel-request-winner' },
                  },
                }),
              );
            }
            return await db.transactionWrite(params);
          },
        };
        const racingLedger = createExecutionLedger({
          db: guardedDb,
          tableName,
          now: createClock(),
        });

        const classified = await racingLedger.requestManualRunCancellation(
          manualCancellationRequest({
            transitionId: 'cancel-request-loser',
            requestId: 'cancel-request-loser',
            reason: {
              ...CANCELLATION_REASON,
              details: { requestId: 'cancel-request-loser' },
            },
          }),
        );
        expect(classified).toMatchObject({
          applied: false,
          outcome: 'cancellation-requested',
          receipt: { transition_id: 'cancel-request-winner' },
          run: {
            status: RunStatus.CANCELLED,
            cancellationRequest: { requestId: 'cancel-request-winner' },
          },
          invocation: {
            status: InvocationStatus.CANCELLED,
            cancellationRequest: { requestId: 'cancel-request-winner' },
          },
        });
        expect(
          (await directLedger.getEvents(RUN_ID)).map(({ type }) => type),
        ).toEqual(['manual-run-created', 'manual-cancellation-requested']);
      } finally {
        await cleanup();
      }
    });

    test('cancels an exactly fenced claimed attempt before handler start', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-cancel-claimed',
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const claim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'cancel-claimed-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'cancel-claimed-claim',
        });
        const attemptId = claim.attempt?.attemptId;
        if (!attemptId)
          throw new Error('Expected claimed cancellation attempt');

        const cancelled = await ledger.requestManualRunCancellation(
          manualCancellationRequest({
            expectedVersion: claim.run.version,
            expectedGeneration: claim.invocation.generation,
            attemptId,
            fencingToken: 'cancel-claimed-fence',
          }),
        );

        expect(cancelled).toMatchObject({
          applied: true,
          outcome: 'cancellation-requested',
          run: { status: RunStatus.CANCELLED },
          invocation: {
            status: InvocationStatus.CANCELLED,
            generation: 1,
          },
          attempt: {
            attemptId,
            status: AttemptStatus.CANCELLED,
            cancellationRequest: {
              requestId: 'cancel-request-1',
              reason: CANCELLATION_REASON,
            },
          },
        });
        expect(cancelled.attempt).not.toHaveProperty('startedAt');
        expect(cancelled.attempt).not.toHaveProperty('terminal');
        expect(cancelled.attempt).not.toHaveProperty('evidenceRef');
        await expect(
          ledger.markAttemptStarted({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken: 'cancel-claimed-fence',
            generation: 1,
            expectedVersion: claim.run.version,
            transitionId: 'cancelled-claim-cannot-start',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
      } finally {
        await cleanup();
      }
    });

    test('records cancellation intent without inventing a terminal for started or uncertain work', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-cancel-started',
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const claim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'cancel-started-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'cancel-started-claim',
        });
        const attemptId = claim.attempt?.attemptId;
        if (!attemptId)
          throw new Error('Expected started cancellation attempt');
        const started = await ledger.markAttemptStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'cancel-started-fence',
          generation: 1,
          expectedVersion: claim.run.version,
          transitionId: 'cancel-started-start',
        });

        const requested = await ledger.requestManualRunCancellation(
          manualCancellationRequest({
            expectedVersion: started.run.version,
            expectedGeneration: started.invocation.generation,
            attemptId,
            fencingToken: 'cancel-started-fence',
          }),
        );
        expect(requested).toMatchObject({
          applied: true,
          outcome: 'cancellation-requested',
          run: {
            status: RunStatus.RUNNING,
            cancellationRequest: { requestId: 'cancel-request-1' },
          },
          invocation: {
            status: InvocationStatus.RUNNING,
            cancellationRequest: { requestId: 'cancel-request-1' },
          },
          attempt: {
            status: AttemptStatus.STARTED,
            cancellationRequest: { requestId: 'cancel-request-1' },
          },
        });
        expect(requested.invocation).not.toHaveProperty('terminal');
        expect(requested.attempt).not.toHaveProperty('terminal');

        const uncertain = await ledger.markAttemptUncertain({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'cancel-started-fence',
          generation: 1,
          expectedVersion: requested.run.version,
          transitionId: 'cancel-started-uncertain',
          reason: { code: 'cancel-delivery-unknown' },
        });
        expect(uncertain).toMatchObject({
          run: {
            status: RunStatus.BLOCKED,
            cancellationRequest: { requestId: 'cancel-request-1' },
          },
          invocation: {
            status: InvocationStatus.UNCERTAIN,
            cancellationRequest: { requestId: 'cancel-request-1' },
          },
          attempt: {
            status: AttemptStatus.ABANDONED,
            cancellationRequest: { requestId: 'cancel-request-1' },
          },
        });

        const repeated = await ledger.requestManualRunCancellation(
          manualCancellationRequest({
            expectedVersion: started.run.version,
            expectedGeneration: started.invocation.generation,
            attemptId,
            fencingToken: 'cancel-started-fence',
          }),
        );
        expect(repeated).toMatchObject({
          applied: false,
          outcome: 'cancellation-requested',
          run: { status: RunStatus.BLOCKED },
          invocation: { status: InvocationStatus.UNCERTAIN },
          attempt: { status: AttemptStatus.ABANDONED },
        });
      } finally {
        await cleanup();
      }
    });

    test('does not reinterpret an uncertain outcome as a new cancellation request', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-cancel-uncertain',
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const claim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'cancel-uncertain-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'cancel-uncertain-claim',
        });
        const attemptId = claim.attempt?.attemptId;
        if (!attemptId)
          throw new Error('Expected uncertain cancellation attempt');
        const started = await ledger.markAttemptStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'cancel-uncertain-fence',
          generation: 1,
          expectedVersion: claim.run.version,
          transitionId: 'cancel-uncertain-start',
        });
        const uncertain = await ledger.markAttemptUncertain({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'cancel-uncertain-fence',
          generation: 1,
          expectedVersion: started.run.version,
          transitionId: 'cancel-uncertain-transition',
          reason: { code: 'physical-outcome-unknown' },
        });
        const beforeEvents = await ledger.getEvents(RUN_ID);

        const refused = await ledger.requestManualRunCancellation(
          manualCancellationRequest({
            expectedVersion: uncertain.run.version,
            expectedGeneration: uncertain.invocation.generation,
            attemptId,
            fencingToken: 'cancel-uncertain-fence',
          }),
        );
        expect(refused).toMatchObject({
          applied: false,
          outcome: 'outcome-uncertain',
          run: { status: RunStatus.BLOCKED },
          invocation: { status: InvocationStatus.UNCERTAIN },
          attempt: { status: AttemptStatus.ABANDONED },
        });
        expect(refused.run).not.toHaveProperty('cancellationRequest');
        expect(refused.invocation).not.toHaveProperty('cancellationRequest');
        expect(refused.attempt).not.toHaveProperty('cancellationRequest');
        expect(await ledger.getEvents(RUN_ID)).toEqual(beforeEvents);
      } finally {
        await cleanup();
      }
    });

    test('requires a matching durable request before accepting cancelled evidence', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-cancel-evidence',
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const claim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'cancel-evidence-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'cancel-evidence-claim',
        });
        const attemptId = claim.attempt?.attemptId;
        if (!attemptId)
          throw new Error('Expected cancellation evidence attempt');
        const started = await ledger.markAttemptStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'cancel-evidence-fence',
          generation: 1,
          expectedVersion: claim.run.version,
          transitionId: 'cancel-evidence-start',
        });
        const matchingEvidence = cancelledEvidenceForStart(started.startFrame);

        await expect(
          ledger.commitVerifiedAttemptTerminal({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken: 'cancel-evidence-fence',
            generation: 1,
            expectedVersion: started.run.version,
            transitionId: 'cancel-without-request',
            evidence: matchingEvidence,
          }),
        ).rejects.toThrow(/durable cancellation request/i);

        const requested = await ledger.requestManualRunCancellation(
          manualCancellationRequest({
            expectedVersion: started.run.version,
            expectedGeneration: started.invocation.generation,
            attemptId,
            fencingToken: 'cancel-evidence-fence',
          }),
        );
        const mismatchedReason = {
          ...CANCELLATION_REASON,
          message: 'A different cancellation request must not be substituted.',
        };
        await expect(
          ledger.commitVerifiedAttemptTerminal({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken: 'cancel-evidence-fence',
            generation: 1,
            expectedVersion: requested.run.version,
            transitionId: 'cancel-termination-unproven',
            evidence: failedCancellationEvidenceForStart(started.startFrame),
          }),
        ).rejects.toThrow();
        await expect(
          ledger.commitVerifiedAttemptTerminal({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken: 'cancel-evidence-fence',
            generation: 1,
            expectedVersion: requested.run.version,
            transitionId: 'cancel-mismatched-reason',
            evidence: cancelledEvidenceForStart(
              started.startFrame,
              mismatchedReason,
            ),
          }),
        ).rejects.toThrow(/cancellation request|cancel frame|reason/i);

        const committed = await ledger.commitVerifiedAttemptTerminal({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'cancel-evidence-fence',
          generation: 1,
          expectedVersion: requested.run.version,
          transitionId: 'cancel-matching-terminal',
          evidence: matchingEvidence,
        });
        expect(committed).toMatchObject({
          run: { status: RunStatus.CANCELLED },
          invocation: { status: InvocationStatus.CANCELLED },
          attempt: {
            status: AttemptStatus.CANCELLED,
            terminal: { type: 'cancelled', attemptId },
          },
        });
      } finally {
        await cleanup();
      }
    });

    test('accepts completed and failed evidence with the exact authorized cancel frame', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        /** @type {Array<{terminalType: 'completed'|'failed', runStatus: string, invocationStatus: string, attemptStatus: string}>} */
        const cases = [
          {
            terminalType: 'completed',
            runStatus: RunStatus.COMPLETED,
            invocationStatus: InvocationStatus.COMPLETED,
            attemptStatus: AttemptStatus.COMPLETED,
          },
          {
            terminalType: 'failed',
            runStatus: RunStatus.FAILED,
            invocationStatus: InvocationStatus.FAILED,
            attemptStatus: AttemptStatus.FAILED,
          },
        ];
        for (const terminalCase of cases) {
          const suffix = terminalCase.terminalType;
          const fencingToken = `cancel-${suffix}-frame-fence`;
          const ledger = createExecutionLedger({
            db,
            tableName: `execution-ledger-cancel-${suffix}-frame`,
            now: createClock(),
          });
          await ledger.createManualRun(manualRun());
          const claim = await ledger.claimInvocation({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            fencingToken,
            expectedGeneration: 0,
            expectedVersion: 1,
            transitionId: `cancel-${suffix}-frame-claim`,
          });
          const attemptId = claim.attempt?.attemptId;
          if (!attemptId) throw new Error(`Expected ${suffix} race attempt`);
          const started = await ledger.markAttemptStarted({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken,
            generation: 1,
            expectedVersion: claim.run.version,
            transitionId: `cancel-${suffix}-frame-start`,
          });
          const requested = await ledger.requestManualRunCancellation(
            manualCancellationRequest({
              expectedVersion: started.run.version,
              expectedGeneration: started.invocation.generation,
              attemptId,
              fencingToken,
            }),
          );

          const committed = await ledger.commitVerifiedAttemptTerminal({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken,
            generation: 1,
            expectedVersion: requested.run.version,
            transitionId: `cancel-${suffix}-frame-terminal`,
            evidence: terminalEvidenceAfterCancelForStart(
              started.startFrame,
              terminalCase.terminalType,
            ),
          });
          expect(committed).toMatchObject({
            run: {
              status: terminalCase.runStatus,
              cancellationRequest: { requestId: 'cancel-request-1' },
            },
            invocation: {
              status: terminalCase.invocationStatus,
              cancellationRequest: { requestId: 'cancel-request-1' },
            },
            attempt: {
              status: terminalCase.attemptStatus,
              terminal: { type: terminalCase.terminalType, attemptId },
              cancellationRequest: { requestId: 'cancel-request-1' },
            },
          });
        }
      } finally {
        await cleanup();
      }
    });

    test('accepts protocol failure after a durable request when no cancel frame was delivered', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-cancel-protocol-failed-no-frame',
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const claim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'cancel-protocol-failed-no-frame-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'cancel-protocol-failed-no-frame-claim',
        });
        const attemptId = claim.attempt?.attemptId;
        if (!attemptId) throw new Error('Expected protocol-failure attempt');
        const started = await ledger.markAttemptStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'cancel-protocol-failed-no-frame-fence',
          generation: 1,
          expectedVersion: claim.run.version,
          transitionId: 'cancel-protocol-failed-no-frame-start',
        });
        const requested = await ledger.requestManualRunCancellation(
          manualCancellationRequest({
            expectedVersion: started.run.version,
            expectedGeneration: started.invocation.generation,
            attemptId,
            fencingToken: 'cancel-protocol-failed-no-frame-fence',
          }),
        );

        const committed = await ledger.commitVerifiedAttemptTerminal({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'cancel-protocol-failed-no-frame-fence',
          generation: 1,
          expectedVersion: requested.run.version,
          transitionId: 'cancel-protocol-failed-no-frame-terminal',
          evidence: protocolFailedEvidenceForStart(started.startFrame),
        });
        expect(committed).toMatchObject({
          run: {
            status: RunStatus.FAILED,
            cancellationRequest: { requestId: 'cancel-request-1' },
          },
          invocation: { status: InvocationStatus.FAILED },
          attempt: {
            status: AttemptStatus.FAILED,
            terminal: { type: 'protocol-failed', attemptId },
          },
        });
      } finally {
        await cleanup();
      }
    });

    test('allows a verified completion to remain authoritative after cancellation was requested', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-cancel-completion-race',
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const claim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'cancel-completion-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'cancel-completion-claim',
        });
        const attemptId = claim.attempt?.attemptId;
        if (!attemptId) throw new Error('Expected completion-race attempt');
        const started = await ledger.markAttemptStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'cancel-completion-fence',
          generation: 1,
          expectedVersion: claim.run.version,
          transitionId: 'cancel-completion-start',
        });
        const requested = await ledger.requestManualRunCancellation(
          manualCancellationRequest({
            expectedVersion: started.run.version,
            expectedGeneration: started.invocation.generation,
            attemptId,
            fencingToken: 'cancel-completion-fence',
          }),
        );

        const committed = await ledger.commitVerifiedAttemptTerminal({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'cancel-completion-fence',
          generation: 1,
          expectedVersion: requested.run.version,
          transitionId: 'completion-after-cancel-request',
          evidence: completedEvidenceForStart(started.startFrame),
        });
        expect(committed).toMatchObject({
          run: {
            status: RunStatus.COMPLETED,
            cancellationRequest: { requestId: 'cancel-request-1' },
          },
          invocation: {
            status: InvocationStatus.COMPLETED,
            cancellationRequest: { requestId: 'cancel-request-1' },
          },
          attempt: {
            status: AttemptStatus.COMPLETED,
            cancellationRequest: { requestId: 'cancel-request-1' },
          },
        });

        const tooLate = await ledger.requestManualRunCancellation(
          manualCancellationRequest({
            transitionId: 'later-cancel-request',
            expectedVersion: committed.run.version,
            expectedGeneration: committed.invocation.generation,
            attemptId,
            fencingToken: 'cancel-completion-fence',
            reason: {
              ...CANCELLATION_REASON,
              details: { requestId: 'later-cancel-request' },
            },
          }),
        );
        expect(tooLate).toMatchObject({
          applied: false,
          outcome: 'cancellation-requested',
          run: { status: RunStatus.COMPLETED },
        });
        expect(tooLate.run.cancellationRequest.requestId).toBe(
          'cancel-request-1',
        );
      } finally {
        await cleanup();
      }
    });

    test('does not append cancellation intent after a terminal already became authoritative', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-cancel-terminal-first',
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const claim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'cancel-terminal-first-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'cancel-terminal-first-claim',
        });
        const attemptId = claim.attempt?.attemptId;
        if (!attemptId) throw new Error('Expected terminal-first attempt');
        const started = await ledger.markAttemptStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'cancel-terminal-first-fence',
          generation: 1,
          expectedVersion: claim.run.version,
          transitionId: 'cancel-terminal-first-start',
        });
        const terminal = await ledger.commitVerifiedAttemptTerminal({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'cancel-terminal-first-fence',
          generation: 1,
          expectedVersion: started.run.version,
          transitionId: 'cancel-terminal-first-completed',
          evidence: completedEvidenceForStart(started.startFrame),
        });
        const beforeEvents = await ledger.getEvents(RUN_ID);

        const refused = await ledger.requestManualRunCancellation(
          manualCancellationRequest({
            expectedVersion: terminal.run.version,
            expectedGeneration: terminal.invocation.generation,
            attemptId,
            fencingToken: 'cancel-terminal-first-fence',
          }),
        );
        expect(refused).toMatchObject({
          applied: false,
          outcome: 'terminal-authoritative',
          run: { status: RunStatus.COMPLETED },
          invocation: { status: InvocationStatus.COMPLETED },
          attempt: { status: AttemptStatus.COMPLETED },
        });
        expect(refused).not.toHaveProperty('receipt');
        expect(refused.run).not.toHaveProperty('cancellationRequest');
        expect(await ledger.getEvents(RUN_ID)).toEqual(beforeEvents);
      } finally {
        await cleanup();
      }
    });

    test('returns the terminal that wins between cancellation read and append', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'execution-ledger-cancel-terminal-interleaving';
        const directLedger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await directLedger.createManualRun(manualRun());
        const claim = await directLedger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'cancel-terminal-interleaving-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'cancel-terminal-interleaving-claim',
        });
        const attemptId = claim.attempt?.attemptId;
        if (!attemptId)
          throw new Error('Expected interleaved terminal attempt');
        const started = await directLedger.markAttemptStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'cancel-terminal-interleaving-fence',
          generation: 1,
          expectedVersion: claim.run.version,
          transitionId: 'cancel-terminal-interleaving-start',
        });

        let injectTerminal = true;
        const guardedDb = {
          ...db,
          /** @param {any} params - Transaction forwarded after the injected terminal wins. */
          transactionWrite: async (params) => {
            const isCancellation = params.putRequests.some(
              (/** @type {any} */ request) =>
                request.record.record_type === 'execution_ledger_event' &&
                request.record.type === 'manual-cancellation-requested',
            );
            if (injectTerminal && isCancellation) {
              injectTerminal = false;
              await directLedger.commitVerifiedAttemptTerminal({
                runId: RUN_ID,
                invocationId: INVOCATION_ID,
                attemptId,
                fencingToken: 'cancel-terminal-interleaving-fence',
                generation: 1,
                expectedVersion: started.run.version,
                transitionId: 'cancel-terminal-interleaving-completed',
                evidence: completedEvidenceForStart(started.startFrame),
              });
            }
            return await db.transactionWrite(params);
          },
        };
        const cancellingLedger = createExecutionLedger({
          db: guardedDb,
          tableName,
          now: createClock(),
        });

        const refused = await cancellingLedger.requestManualRunCancellation(
          manualCancellationRequest({
            expectedVersion: started.run.version,
            expectedGeneration: started.invocation.generation,
            attemptId,
            fencingToken: 'cancel-terminal-interleaving-fence',
          }),
        );
        expect(refused).toMatchObject({
          applied: false,
          outcome: 'terminal-authoritative',
          run: { status: RunStatus.COMPLETED },
          invocation: { status: InvocationStatus.COMPLETED },
          attempt: { status: AttemptStatus.COMPLETED },
        });
        expect(refused).not.toHaveProperty('receipt');
        expect(refused.run).not.toHaveProperty('cancellationRequest');
        expect(
          (await directLedger.getEvents(RUN_ID)).map(({ type }) => type),
        ).toEqual([
          'manual-run-created',
          'attempt-claimed',
          'attempt-started',
          'attempt-terminal',
        ]);
      } finally {
        await cleanup();
      }
    });

    test('makes cancellation request identity idempotent and fences stale observations', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-cancel-idempotency',
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const claim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'cancel-current-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'cancel-idempotency-claim',
        });
        const attemptId = claim.attempt?.attemptId;
        if (!attemptId) throw new Error('Expected fenced cancellation attempt');
        const currentRequest = manualCancellationRequest({
          expectedVersion: claim.run.version,
          expectedGeneration: claim.invocation.generation,
          attemptId,
          fencingToken: 'cancel-current-fence',
          observedAt: 1_700_000_100_000,
        });

        for (const staleRequest of [
          { ...currentRequest, expectedVersion: claim.run.version - 1 },
          { ...currentRequest, expectedGeneration: 0 },
          { ...currentRequest, attemptId: 'wrong-attempt' },
          { ...currentRequest, fencingToken: 'stale-fence' },
        ]) {
          await expect(
            ledger.requestManualRunCancellation(staleRequest),
          ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        }
        expect(await ledger.getEvents(RUN_ID)).toHaveLength(2);

        const accepted =
          await ledger.requestManualRunCancellation(currentRequest);
        expect(accepted).toMatchObject({
          applied: true,
          outcome: 'cancellation-requested',
        });
        await expect(
          ledger.requestManualRunCancellation(currentRequest),
        ).resolves.toMatchObject({
          applied: false,
          outcome: 'cancellation-requested',
          receipt: { transition_id: 'cancel-request-1' },
        });
        for (const conflictingReplay of [
          {
            ...currentRequest,
            expectedVersion: currentRequest.expectedVersion + 1,
          },
          {
            ...currentRequest,
            expectedGeneration: currentRequest.expectedGeneration + 1,
          },
          { ...currentRequest, attemptId: 'different-attempt' },
          { ...currentRequest, fencingToken: 'different-fence' },
          { ...currentRequest, coordinatorEpoch: 1 },
          {
            ...currentRequest,
            reason: {
              ...CANCELLATION_REASON,
              message: 'The same transition cannot name different intent.',
            },
          },
        ]) {
          await expect(
            ledger.requestManualRunCancellation(conflictingReplay),
          ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);
        }
        expect(
          (await ledger.getEvents(RUN_ID)).map(({ type }) => type),
        ).toEqual([
          'manual-run-created',
          'attempt-claimed',
          'manual-cancellation-requested',
        ]);
      } finally {
        await cleanup();
      }
    });

    test('rejects a rehashed claimed cancellation that invents terminal evidence', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'execution-ledger-cancel-claimed-evidence-forgery';
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const claim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'cancel-claimed-forgery-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'cancel-claimed-forgery-claim',
        });
        const attemptId = claim.attempt?.attemptId;
        if (!attemptId) throw new Error('Expected claimed forged attempt');
        await ledger.requestManualRunCancellation(
          manualCancellationRequest({
            expectedVersion: claim.run.version,
            expectedGeneration: claim.invocation.generation,
            attemptId,
            fencingToken: 'cancel-claimed-forgery-fence',
          }),
        );

        const event = await db.get({
          tableName,
          keyName: 'run_id',
          keyValue: RUN_ID,
          sortKeyName: 'sort_key',
          sortKeyValue: getEventSortKey(3),
          consistentRead: true,
        });
        const forgedPayload = JSON.parse(JSON.stringify(event?.payload));
        const terminal = { type: 'completed', attemptId };
        forgedPayload.attempt.startedAt = forgedPayload.attempt.updatedAt;
        forgedPayload.attempt.terminal = terminal;
        forgedPayload.attempt.evidenceRef = await PAYLOAD_STORE.putJson({
          value: { forged: 'claimed cancellation evidence' },
          payloadSchema: 'wharfie.execution.activity-evidence.v1',
        });
        await forgeEventSnapshots({
          db,
          tableName,
          sequence: 3,
          transitionId: 'cancel-request-1',
          payload: forgedPayload,
        });

        await expect(ledger.rebuildRun(RUN_ID)).rejects.toMatchObject({
          reason: 'cancellation rewrote attempt lifecycle evidence',
        });
      } finally {
        await cleanup();
      }
    });

    test('rejects a rehashed cancellation that invents an invocation terminal', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'execution-ledger-cancel-invocation-forgery';
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        await ledger.requestManualRunCancellation(manualCancellationRequest());

        const event = await db.get({
          tableName,
          keyName: 'run_id',
          keyValue: RUN_ID,
          sortKeyName: 'sort_key',
          sortKeyValue: getEventSortKey(2),
          consistentRead: true,
        });
        const forgedPayload = JSON.parse(JSON.stringify(event?.payload));
        forgedPayload.invocation.terminal = {
          type: 'completed',
          attemptId: 'invented-cancellation-attempt',
        };
        await forgeEventSnapshots({
          db,
          tableName,
          sequence: 2,
          transitionId: 'cancel-request-1',
          payload: forgedPayload,
        });

        await expect(ledger.rebuildRun(RUN_ID)).rejects.toMatchObject({
          reason: 'invalid manual cancellation request',
        });
      } finally {
        await cleanup();
      }
    });

    test('rejects a rehashed started cancellation that rewrites start evidence', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'execution-ledger-cancel-started-evidence-forgery';
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const claim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'cancel-started-forgery-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'cancel-started-forgery-claim',
        });
        const attemptId = claim.attempt?.attemptId;
        if (!attemptId) throw new Error('Expected started forged attempt');
        const started = await ledger.markAttemptStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'cancel-started-forgery-fence',
          generation: 1,
          expectedVersion: claim.run.version,
          transitionId: 'cancel-started-forgery-start',
        });
        await ledger.requestManualRunCancellation(
          manualCancellationRequest({
            expectedVersion: started.run.version,
            expectedGeneration: started.invocation.generation,
            attemptId,
            fencingToken: 'cancel-started-forgery-fence',
          }),
        );

        const event = await db.get({
          tableName,
          keyName: 'run_id',
          keyValue: RUN_ID,
          sortKeyName: 'sort_key',
          sortKeyValue: getEventSortKey(4),
          consistentRead: true,
        });
        const forgedPayload = JSON.parse(JSON.stringify(event?.payload));
        forgedPayload.attempt.startedAt += 1;
        await forgeEventSnapshots({
          db,
          tableName,
          sequence: 4,
          transitionId: 'cancel-request-1',
          payload: forgedPayload,
        });

        await expect(ledger.rebuildRun(RUN_ID)).rejects.toMatchObject({
          reason: 'cancellation rewrote attempt lifecycle evidence',
        });
      } finally {
        await cleanup();
      }
    });

    test('rejects a rehashed runnable cancellation that rewrites abandoned evidence', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'execution-ledger-cancel-abandoned-evidence-forgery';
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const claim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'cancel-abandoned-forgery-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'cancel-abandoned-forgery-claim',
        });
        const attemptId = claim.attempt?.attemptId;
        if (!attemptId) throw new Error('Expected abandoned forged attempt');
        const abandoned = await ledger.abandonUnstartedAttempt({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'cancel-abandoned-forgery-fence',
          generation: 1,
          expectedVersion: claim.run.version,
          transitionId: 'cancel-abandoned-forgery-abandon',
          reason: { code: 'coordinator-restarted' },
        });
        await ledger.requestManualRunCancellation(
          manualCancellationRequest({
            expectedVersion: abandoned.run.version,
            expectedGeneration: abandoned.invocation.generation,
            attemptId,
            fencingToken: 'cancel-abandoned-forgery-fence',
          }),
        );

        const event = await db.get({
          tableName,
          keyName: 'run_id',
          keyValue: RUN_ID,
          sortKeyName: 'sort_key',
          sortKeyValue: getEventSortKey(4),
          consistentRead: true,
        });
        const forgedPayload = JSON.parse(JSON.stringify(event?.payload));
        forgedPayload.attempt.startedAt = forgedPayload.attempt.updatedAt;
        forgedPayload.attempt.abandonment = { code: 'forged-abandonment' };
        await forgeEventSnapshots({
          db,
          tableName,
          sequence: 4,
          transitionId: 'cancel-request-1',
          payload: forgedPayload,
        });

        await expect(ledger.rebuildRun(RUN_ID)).rejects.toMatchObject({
          reason: 'cancellation rewrote attempt lifecycle evidence',
        });
      } finally {
        await cleanup();
      }
    });

    test('rejects a cancellation projection that no longer matches its event', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'execution-ledger-cancel-projection-corruption';
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        await ledger.requestManualRunCancellation(manualCancellationRequest());
        await db.update({
          tableName,
          keyName: 'run_id',
          keyValue: RUN_ID,
          sortKeyName: 'sort_key',
          sortKeyValue: getRunProjectionSortKey(),
          updates: [
            {
              property: ['data', 'cancellationRequest', 'reason', 'message'],
              propertyValue: 'forged cancellation reason',
            },
          ],
        });

        await expect(ledger.rebuildRun(RUN_ID)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
      } finally {
        await cleanup();
      }
    });

    test('loses a concurrent create atomically and returns the durable winner', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'execution-ledger-create-race';
        const directLedger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        let injectWinner = true;
        const guardedDb = {
          ...db,
          /** @param {any} params - Transaction forwarded after the injected race. */
          transactionWrite: async (params) => {
            if (injectWinner) {
              injectWinner = false;
              await directLedger.createManualRun(
                manualRun({ transitionId: 'racing-winner' }),
              );
            }
            return await db.transactionWrite(params);
          },
        };
        const losingLedger = createExecutionLedger({
          db: guardedDb,
          tableName,
          now: createClock(),
        });

        await expect(
          losingLedger.createManualRun(manualRun()),
        ).resolves.toMatchObject({
          applied: false,
          run: { version: 1, status: RunStatus.RUNNING },
          invocation: { status: InvocationStatus.RUNNABLE },
        });
        await expect(directLedger.getEvents(RUN_ID)).resolves.toHaveLength(1);
        await expect(directLedger.rebuildRun(RUN_ID)).resolves.toMatchObject({
          head: { version: 1, sequence: 1 },
        });
      } finally {
        await cleanup();
      }
    });

    test('keeps the V10 manual admission event epoch at zero', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-create-epoch',
          now: createClock(),
        });

        await expect(
          ledger.createManualRun(manualRun({ coordinatorEpoch: 1 })),
        ).rejects.toThrow(/coordinatorEpoch must be 0/);
        await expect(ledger.getRun(RUN_ID)).resolves.toBeNull();
      } finally {
        await cleanup();
      }
    });

    test('fails closed if a mutable projection no longer agrees with the event stream', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'execution-ledger-corruption';
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        await db.update({
          tableName,
          keyName: 'run_id',
          keyValue: RUN_ID,
          sortKeyName: 'sort_key',
          sortKeyValue: getRunProjectionSortKey(),
          updates: [
            { property: ['data', 'status'], propertyValue: RunStatus.BLOCKED },
          ],
        });

        await expect(ledger.getRun(RUN_ID)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
      } finally {
        await cleanup();
      }
    });

    test('rejects a rehashed manual transition that invents a workflow binding', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'execution-ledger-workflow-binding-forgery';
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'workflow-binding-forgery-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'workflow-binding-forgery-claim',
        });
        const event = await db.get({
          tableName,
          keyName: 'run_id',
          keyValue: RUN_ID,
          sortKeyName: 'sort_key',
          sortKeyValue: getEventSortKey(2),
          consistentRead: true,
        });
        const forgedPayload = JSON.parse(JSON.stringify(event?.payload));
        forgedPayload.invocation.workflow = {
          workflowId: 'forged-workflow',
          planId: 'forged-plan',
          continuationId: 'forged-continuation',
          stepId: 'forged-step',
          stepIndex: 0,
        };
        await forgeEventSnapshots({
          db,
          tableName,
          sequence: 2,
          transitionId: 'workflow-binding-forgery-claim',
          payload: forgedPayload,
        });

        await expect(ledger.rebuildRun(RUN_ID)).rejects.toMatchObject({
          reason: 'invalid invocation transition',
        });
      } finally {
        await cleanup();
      }
    });

    test('fails closed when retained terminal evidence is altered after append', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const runId = `payload-integrity-${adapter.name}`;
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-payload-integrity',
          now: createClock(),
        });
        await ledger.createManualRun(
          manualRun({
            runId,
            transitionId: 'payload-create',
            input: { unique: `payload-${adapter.name}` },
          }),
        );
        const claim = await ledger.claimInvocation({
          runId,
          invocationId: INVOCATION_ID,
          fencingToken: 'payload-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'payload-claim',
        });
        const attemptId = claim.attempt?.attemptId;
        if (!attemptId) throw new Error('Expected durable payload attempt');
        const started = await ledger.markAttemptStarted({
          runId,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'payload-fence',
          generation: 1,
          expectedVersion: 2,
          transitionId: 'payload-start',
        });
        const committed = await ledger.commitVerifiedAttemptTerminal({
          runId,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'payload-fence',
          generation: 1,
          expectedVersion: started.run.version,
          transitionId: 'payload-terminal',
          evidence: completedEvidenceForStart(started.startFrame),
        });
        const evidenceRef = committed.attempt?.evidenceRef;
        if (!evidenceRef) throw new Error('Expected immutable evidence ref');
        writeFileSync(
          PAYLOAD_STORE.getPath(evidenceRef),
          '{"tampered":true}',
          'utf8',
        );

        await expect(ledger.getEvents(runId)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
        await expect(
          ledger.markAttemptUncertain({
            runId,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken: 'payload-fence',
            generation: 1,
            expectedVersion: committed.run.version,
            transitionId: 'payload-unsafe-recovery',
            reason: { code: 'tampered-evidence' },
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);
      } finally {
        await cleanup();
      }
    });

    test('fails closed when retained manual request is altered after append', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const runId = `request-integrity-${adapter.name}`;
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-request-integrity',
          now: createClock(),
        });
        const created = await ledger.createManualRun(
          manualRun({
            runId,
            transitionId: 'request-create',
            input: { unique: `request-${adapter.name}` },
          }),
        );
        const requestPath = PAYLOAD_STORE.getPath(created.run.requestRef);
        const retainedRequest = readFileSync(requestPath, 'utf8');
        const marker = `request-${adapter.name}`;
        const sameLengthTamper = `forged--${adapter.name}`;
        expect(Buffer.byteLength(sameLengthTamper)).toBe(
          Buffer.byteLength(marker),
        );
        const alteredRequest = retainedRequest.replace(
          marker,
          sameLengthTamper,
        );
        expect(alteredRequest).not.toBe(retainedRequest);
        expect(Buffer.byteLength(alteredRequest)).toBe(
          created.run.requestRef.size,
        );
        writeFileSync(requestPath, alteredRequest, 'utf8');

        await expect(ledger.getRun(runId)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
        await expect(
          ledger.claimInvocation({
            runId,
            invocationId: INVOCATION_ID,
            fencingToken: 'request-fence',
            expectedGeneration: 0,
            expectedVersion: 1,
            transitionId: 'request-claim',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);
      } finally {
        await cleanup();
      }
    });

    test('rehashes and bounds provider bytes before decoding a payload', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const runId = `provider-bytes-${adapter.name}`;
        const tableName = 'execution-ledger-provider-byte-binding';
        const writer = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await writer.createManualRun(
          manualRun({ runId, transitionId: 'provider-bytes-create' }),
        );

        const reader = createProductionExecutionLedger({
          db,
          tableName,
          now: createClock(),
          payloadStore: {
            putJson: PAYLOAD_STORE.putJson,
            readBytes: async () =>
              Buffer.from(
                '{"callerMetadata":{},"input":{"forged":true}}',
                'utf8',
              ),
          },
        });
        await expect(reader.getRun(runId)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );

        const oversizedReader = createProductionExecutionLedger({
          db,
          tableName,
          now: createClock(),
          payloadStore: {
            putJson: PAYLOAD_STORE.putJson,
            readBytes: async () =>
              Buffer.alloc(EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES + 1),
          },
        });
        await expect(oversizedReader.getRun(runId)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
      } finally {
        await cleanup();
      }
    });

    test('rejects oversized referenced payload descriptors before append', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const reference = await PAYLOAD_STORE.putJson({
          payloadSchema: 'wharfie.execution.activity-request.v1',
          value: { input: {}, callerMetadata: {} },
        });
        const oversizedReference = {
          ...reference,
          size: EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES + 1,
        };
        const ledger = createProductionExecutionLedger({
          db,
          tableName: 'execution-ledger-referenced-payload-boundary',
          now: createClock(),
          payloadStore: {
            putJson: async () => oversizedReference,
            readBytes: async () => {
              throw new Error('oversized payload should not be read');
            },
          },
        });

        await expect(
          ledger.createManualRun(
            manualRun({
              runId: `oversized-reference-${adapter.name}`,
              transitionId: 'oversized-reference-create',
            }),
          ),
        ).rejects.toThrow(/execution payload limit/i);
      } finally {
        await cleanup();
      }
    });

    test('does not publish payloads for ordinary rejected or replayed requests', async () => {
      const { db, cleanup } = await adapter.create();
      const { payloadStore, writes } = createCountingPayloadStore();
      try {
        const ledger = createProductionExecutionLedger({
          db,
          tableName: 'execution-ledger-payload-publication-order',
          now: createClock(),
          payloadStore,
        });
        await ledger.createManualRun(
          manualRun({
            runId: `publication-order-${adapter.name}`,
            transitionId: 'publication-create',
          }),
        );
        expect(writes).toHaveLength(1);

        expect(
          (
            await ledger.createManualRun(
              manualRun({
                runId: `publication-order-${adapter.name}`,
                transitionId: 'publication-create',
              }),
            )
          ).applied,
        ).toBe(false);
        expect(writes).toHaveLength(1);

        await expect(
          ledger.createManualRun(
            manualRun({
              runId: `publication-order-${adapter.name}`,
              transitionId: 'publication-conflict',
              input: { changed: true },
            }),
          ),
        ).rejects.toBeInstanceOf(ExecutionLedgerRunConflictError);
        expect(writes).toHaveLength(1);

        const runId = `publication-order-${adapter.name}`;
        const claim = await ledger.claimInvocation({
          runId,
          invocationId: INVOCATION_ID,
          fencingToken: 'publication-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'publication-claim',
        });
        const attemptId = claim.attempt?.attemptId;
        if (!attemptId) throw new Error('Expected publication-order attempt');
        const started = await ledger.markAttemptStarted({
          runId,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'publication-fence',
          generation: 1,
          expectedVersion: 2,
          transitionId: 'publication-start',
        });
        const evidence = completedEvidenceForStart(started.startFrame);

        await expect(
          ledger.commitVerifiedAttemptTerminal({
            runId,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken: 'publication-fence',
            generation: 1,
            expectedVersion: started.run.version - 1,
            transitionId: 'publication-stale-terminal',
            evidence,
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        expect(writes).toHaveLength(1);

        const terminalRequest = {
          runId,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'publication-fence',
          generation: 1,
          expectedVersion: started.run.version,
          transitionId: 'publication-terminal',
          evidence,
        };
        await ledger.commitVerifiedAttemptTerminal(terminalRequest);
        expect(writes).toHaveLength(2);
        expect(
          (await ledger.commitVerifiedAttemptTerminal(terminalRequest)).applied,
        ).toBe(false);
        expect(writes).toHaveLength(2);
      } finally {
        await cleanup();
      }
    });

    test('keeps large request and terminal evidence out of ledger records', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-inline-boundary',
          now: createClock(),
        });
        const acceptedLargeInput = await ledger.createManualRun(
          manualRun({
            runId: 'large-input-run',
            transitionId: 'large-input-create',
            input: { body: 'x'.repeat(33_000) },
          }),
        );
        const storedLargeRequest = await PAYLOAD_STORE.readJson(
          acceptedLargeInput.run.requestRef,
        );
        expect(storedLargeRequest.input.body).toHaveLength(33_000);

        await ledger.createManualRun(manualRun());
        const claim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'fence-1',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'claim-1',
        });
        const attemptId = claim.attempt?.attemptId;
        await ledger.markAttemptStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'fence-1',
          generation: 1,
          expectedVersion: 2,
          transitionId: 'start-1',
        });

        const tooManyFrames = completedEvidence(attemptId, 'fence-1');
        tooManyFrames.frames = Array.from(
          { length: EXECUTION_LEDGER_MAX_EVIDENCE_FRAMES + 1 },
          () => ({}),
        );
        await expect(
          ledger.commitVerifiedAttemptTerminal({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken: 'fence-1',
            generation: 1,
            expectedVersion: 3,
            transitionId: 'too-many-evidence-frames',
            evidence: tooManyFrames,
          }),
        ).rejects.toThrow(/no more than/);

        const completed = await ledger.commitVerifiedAttemptTerminal({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'fence-1',
          generation: 1,
          expectedVersion: 3,
          transitionId: 'oversized-terminal',
          evidence: completedEvidence(attemptId, 'fence-1', {
            body: 'x'.repeat(70_000),
          }),
        });
        expect(completed).toMatchObject({
          run: { status: RunStatus.COMPLETED },
          attempt: {
            status: AttemptStatus.COMPLETED,
            evidenceRef: {
              payloadSchema: 'wharfie.execution.activity-evidence.v1',
            },
          },
        });
        const storedEvidence = await PAYLOAD_STORE.readJson(
          completed.attempt?.evidenceRef,
        );
        expect(storedEvidence.terminal.result.body).toHaveLength(70_000);
      } finally {
        await cleanup();
      }
    });

    test('fails closed when a transition receipt no longer identifies its event', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'execution-ledger-receipt-forgery';
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        await db.update({
          tableName,
          keyName: 'run_id',
          keyValue: RUN_ID,
          sortKeyName: 'sort_key',
          sortKeyValue: getTransitionSortKey('create-run'),
          updates: [
            { property: ['event_id'], propertyValue: 'wle_wrong-event' },
          ],
        });

        await expect(ledger.getRun(RUN_ID)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
      } finally {
        await cleanup();
      }
    });

    test('rejects a rehashed event with a detached semantic request digest', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'execution-ledger-request-digest-forgery';
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());

        const event = await db.get({
          tableName,
          keyName: 'run_id',
          keyValue: RUN_ID,
          sortKeyName: 'sort_key',
          sortKeyValue: getEventSortKey(1),
          consistentRead: true,
        });
        expect(event).toBeDefined();
        const forgedEvent = {
          ...event,
          request_digest: 'wlt_detached-request-digest',
        };
        const forgedEventId = eventIdFor(forgedEvent);
        /** @param {string} sortKeyValue - Ledger record sort key. @param {any[]} updates - Atomic field updates. */
        const update = async (sortKeyValue, updates) =>
          await db.update({
            tableName,
            keyName: 'run_id',
            keyValue: RUN_ID,
            sortKeyName: 'sort_key',
            sortKeyValue,
            updates,
          });
        await update(getEventSortKey(1), [
          {
            property: ['request_digest'],
            propertyValue: forgedEvent.request_digest,
          },
          { property: ['event_id'], propertyValue: forgedEventId },
        ]);
        await update(getTransitionSortKey('create-run'), [
          {
            property: ['request_digest'],
            propertyValue: forgedEvent.request_digest,
          },
          { property: ['event_id'], propertyValue: forgedEventId },
        ]);

        await expect(ledger.rebuildRun(RUN_ID)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
      } finally {
        await cleanup();
      }
    });

    test('rejects a rehashed event whose terminal statuses contradict its protocol evidence', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'execution-ledger-terminal-forgery';
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const claim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'fence-1',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'claim-1',
        });
        const attemptId = claim.attempt?.attemptId;
        await ledger.markAttemptStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'fence-1',
          generation: 1,
          expectedVersion: 2,
          transitionId: 'start-1',
        });
        await ledger.commitVerifiedAttemptTerminal({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'fence-1',
          generation: 1,
          expectedVersion: 3,
          transitionId: 'terminal-1',
          evidence: completedEvidence(attemptId, 'fence-1'),
        });

        const event = await db.get({
          tableName,
          keyName: 'run_id',
          keyValue: RUN_ID,
          sortKeyName: 'sort_key',
          sortKeyValue: getEventSortKey(4),
          consistentRead: true,
        });
        expect(event).toBeDefined();
        const forgedPayload = JSON.parse(JSON.stringify(event?.payload));
        forgedPayload.run.status = RunStatus.FAILED;
        forgedPayload.invocation.status = InvocationStatus.FAILED;
        forgedPayload.attempt.status = AttemptStatus.FAILED;
        const forgedEvent = { ...event, payload: forgedPayload };
        const forgedEventId = eventIdFor(forgedEvent);
        /** @param {string} sortKeyValue - Ledger record sort key. @param {any[]} updates - Atomic field updates. */
        const update = async (sortKeyValue, updates) =>
          await db.update({
            tableName,
            keyName: 'run_id',
            keyValue: RUN_ID,
            sortKeyName: 'sort_key',
            sortKeyValue,
            updates,
          });

        await update(getEventSortKey(4), [
          { property: ['payload'], propertyValue: forgedPayload },
          { property: ['event_id'], propertyValue: forgedEventId },
        ]);
        await update(getTransitionSortKey('terminal-1'), [
          { property: ['event_id'], propertyValue: forgedEventId },
        ]);
        await update(getRunProjectionSortKey(), [
          { property: ['status'], propertyValue: RunStatus.FAILED },
          {
            property: ['data', 'status'],
            propertyValue: RunStatus.FAILED,
          },
        ]);
        await update(getInvocationProjectionSortKey(INVOCATION_ID), [
          { property: ['status'], propertyValue: InvocationStatus.FAILED },
          {
            property: ['data', 'status'],
            propertyValue: InvocationStatus.FAILED,
          },
        ]);
        await update(getAttemptProjectionSortKey(attemptId), [
          { property: ['status'], propertyValue: AttemptStatus.FAILED },
          {
            property: ['data', 'status'],
            propertyValue: AttemptStatus.FAILED,
          },
        ]);

        await expect(ledger.rebuildRun(RUN_ID)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
      } finally {
        await cleanup();
      }
    });

    test('rejects a rehashed claim that rewrites the next run status', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'execution-ledger-claim-status-forgery';
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'fence-1',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'claim-1',
        });

        const event = await db.get({
          tableName,
          keyName: 'run_id',
          keyValue: RUN_ID,
          sortKeyName: 'sort_key',
          sortKeyValue: getEventSortKey(2),
          consistentRead: true,
        });
        expect(event).toBeDefined();
        const forgedPayload = JSON.parse(JSON.stringify(event?.payload));
        forgedPayload.run.status = RunStatus.COMPLETED;
        const forgedEvent = { ...event, payload: forgedPayload };
        const forgedEventId = eventIdFor(forgedEvent);
        /** @param {string} sortKeyValue - Ledger record sort key. @param {any[]} updates - Atomic field updates. */
        const update = async (sortKeyValue, updates) =>
          await db.update({
            tableName,
            keyName: 'run_id',
            keyValue: RUN_ID,
            sortKeyName: 'sort_key',
            sortKeyValue,
            updates,
          });

        await update(getEventSortKey(2), [
          { property: ['payload'], propertyValue: forgedPayload },
          { property: ['event_id'], propertyValue: forgedEventId },
        ]);
        await update(getTransitionSortKey('claim-1'), [
          { property: ['event_id'], propertyValue: forgedEventId },
        ]);
        await update(getRunProjectionSortKey(), [
          { property: ['status'], propertyValue: RunStatus.COMPLETED },
          {
            property: ['data', 'status'],
            propertyValue: RunStatus.COMPLETED,
          },
        ]);

        await expect(ledger.rebuildRun(RUN_ID)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
      } finally {
        await cleanup();
      }
    });

    test('rejects a rehashed terminal that rewrites the invocation generation', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'execution-ledger-terminal-generation-forgery';
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const claim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'fence-1',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'claim-1',
        });
        const attemptId = claim.attempt?.attemptId;
        await ledger.markAttemptStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'fence-1',
          generation: 1,
          expectedVersion: 2,
          transitionId: 'start-1',
        });
        await ledger.commitVerifiedAttemptTerminal({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'fence-1',
          generation: 1,
          expectedVersion: 3,
          transitionId: 'terminal-1',
          evidence: completedEvidence(attemptId, 'fence-1'),
        });

        const event = await db.get({
          tableName,
          keyName: 'run_id',
          keyValue: RUN_ID,
          sortKeyName: 'sort_key',
          sortKeyValue: getEventSortKey(4),
          consistentRead: true,
        });
        expect(event).toBeDefined();
        const forgedPayload = JSON.parse(JSON.stringify(event?.payload));
        forgedPayload.invocation.generation = 99;
        const forgedEvent = { ...event, payload: forgedPayload };
        const forgedEventId = eventIdFor(forgedEvent);
        /** @param {string} sortKeyValue - Ledger record sort key. @param {any[]} updates - Atomic field updates. */
        const update = async (sortKeyValue, updates) =>
          await db.update({
            tableName,
            keyName: 'run_id',
            keyValue: RUN_ID,
            sortKeyName: 'sort_key',
            sortKeyValue,
            updates,
          });

        await update(getEventSortKey(4), [
          { property: ['payload'], propertyValue: forgedPayload },
          { property: ['event_id'], propertyValue: forgedEventId },
        ]);
        await update(getTransitionSortKey('terminal-1'), [
          { property: ['event_id'], propertyValue: forgedEventId },
        ]);
        await update(getInvocationProjectionSortKey(INVOCATION_ID), [
          { property: ['generation'], propertyValue: 99 },
          { property: ['data', 'generation'], propertyValue: 99 },
        ]);

        await expect(ledger.rebuildRun(RUN_ID)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
      } finally {
        await cleanup();
      }
    });

    test('rejects a rehashed attempt fence discontinuity during recovery', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'execution-ledger-fence-forgery';
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await ledger.createManualRun(manualRun());
        const claim = await ledger.claimInvocation({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          fencingToken: 'fence-1',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'claim-1',
        });
        const attemptId = claim.attempt?.attemptId;
        await ledger.abandonUnstartedAttempt({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'fence-1',
          generation: 1,
          expectedVersion: 2,
          transitionId: 'abandon-1',
          reason: { code: 'coordinator-restarted' },
        });

        const event = await db.get({
          tableName,
          keyName: 'run_id',
          keyValue: RUN_ID,
          sortKeyName: 'sort_key',
          sortKeyValue: getEventSortKey(3),
          consistentRead: true,
        });
        expect(event).toBeDefined();
        const forgedPayload = JSON.parse(JSON.stringify(event?.payload));
        forgedPayload.attempt.fencingToken = 'forged-fence';
        forgedPayload.attempt.coordinatorEpoch = 99;
        const forgedEvent = { ...event, payload: forgedPayload };
        const forgedEventId = eventIdFor(forgedEvent);
        /** @param {string} sortKeyValue - Ledger record sort key. @param {any[]} updates - Atomic field updates. */
        const update = async (sortKeyValue, updates) =>
          await db.update({
            tableName,
            keyName: 'run_id',
            keyValue: RUN_ID,
            sortKeyName: 'sort_key',
            sortKeyValue,
            updates,
          });
        await update(getEventSortKey(3), [
          { property: ['payload'], propertyValue: forgedPayload },
          { property: ['event_id'], propertyValue: forgedEventId },
        ]);
        await update(getTransitionSortKey('abandon-1'), [
          { property: ['event_id'], propertyValue: forgedEventId },
        ]);
        await update(getAttemptProjectionSortKey(attemptId), [
          { property: ['fencing_token'], propertyValue: 'forged-fence' },
          { property: ['coordinator_epoch'], propertyValue: 99 },
          {
            property: ['data', 'fencingToken'],
            propertyValue: 'forged-fence',
          },
          { property: ['data', 'coordinatorEpoch'], propertyValue: 99 },
        ]);

        await expect(ledger.rebuildRun(RUN_ID)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
      } finally {
        await cleanup();
      }
    });

    test('maintains a redacted atomic, paginated run-history directory', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'execution-ledger-directory';
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        const appId = 'directory-demo';
        /**
         * @param {string} runId - Durable test run identity.
         * @param {number} observedAt - Controlled durable timestamp.
         * @returns {Promise<any>} - Created run result.
         */
        const create = async (runId, observedAt) =>
          await ledger.createManualRun({
            runId,
            appId,
            revisionId: REVISION_ID,
            invocationId: INVOCATION_ID,
            activityId: ACTIVITY_ID,
            input: { secret: `input-${runId}` },
            callerMetadata: { secret: `caller-${runId}` },
            transitionId: `create-${runId}`,
            observedAt,
          });

        await create('run-alpha', 100);
        await create('run-charlie', 101);
        await create('run-bravo', 102);
        const claim = await ledger.claimInvocation({
          runId: 'run-bravo',
          invocationId: INVOCATION_ID,
          fencingToken: 'bravo-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'claim-bravo',
          observedAt: 200,
        });
        expect(claim.run).toMatchObject({ version: 2, lastSequence: 2 });

        const first = await ledger.listRuns({ appId, limit: 2 });
        expect(first.items).toEqual([
          {
            runId: 'run-bravo',
            appId,
            revisionId: REVISION_ID,
            kind: 'manual',
            status: RunStatus.RUNNING,
            version: 2,
            lastSequence: 2,
            createdAt: 102,
            updatedAt: 200,
          },
          {
            runId: 'run-charlie',
            appId,
            revisionId: REVISION_ID,
            kind: 'manual',
            status: RunStatus.RUNNING,
            version: 1,
            lastSequence: 1,
            createdAt: 101,
            updatedAt: 101,
          },
        ]);
        expect(first.items[0]).not.toHaveProperty('requestRef');
        expect(first.items[0]).not.toHaveProperty('input');
        expect(typeof first.nextCursor).toBe('string');

        const second = await ledger.listRuns({
          appId,
          limit: 2,
          cursor: first.nextCursor,
        });
        expect(second).toEqual({
          items: [
            {
              runId: 'run-alpha',
              appId,
              revisionId: REVISION_ID,
              kind: 'manual',
              status: RunStatus.RUNNING,
              version: 1,
              lastSequence: 1,
              createdAt: 100,
              updatedAt: 100,
            },
          ],
        });

        const cancelledAlpha = await ledger.requestManualRunCancellation({
          runId: 'run-alpha',
          invocationId: INVOCATION_ID,
          expectedVersion: 1,
          expectedGeneration: 0,
          transitionId: 'cancel-run-alpha',
          requestId: 'cancel-run-alpha',
          actor: { kind: 'operator', id: 'directory-contract-test' },
          reason: {
            ...CANCELLATION_REASON,
            details: { requestId: 'cancel-run-alpha' },
          },
          observedAt: 210,
        });
        expect(cancelledAlpha.run).toMatchObject({
          status: RunStatus.CANCELLED,
          version: 2,
          lastSequence: 2,
          updatedAt: 210,
        });
        const cancelledDirectoryItem = (
          await ledger.listRuns({ appId })
        ).items.find(({ runId }) => runId === 'run-alpha');
        expect(cancelledDirectoryItem).toEqual({
          runId: 'run-alpha',
          appId,
          revisionId: REVISION_ID,
          kind: 'manual',
          status: RunStatus.CANCELLED,
          version: 2,
          lastSequence: 2,
          createdAt: 100,
          updatedAt: 210,
        });
        const scope = createExecutionLedgerRunDirectoryScope({ appId });
        await expect(
          db.get({
            tableName,
            keyName: 'run_id',
            keyValue: scope.directoryId,
            sortKeyName: 'sort_key',
            sortKeyValue: getExecutionLedgerRunDirectorySortKey({
              runId: 'run-alpha',
              createdAt: 100,
            }),
            consistentRead: true,
          }),
        ).resolves.toMatchObject({
          record_type: 'execution_ledger_run_directory',
          ledger_run_id: 'run-alpha',
          status: RunStatus.CANCELLED,
          version: 2,
          sequence: 2,
          updated_at: 210,
        });
        await expect(
          ledger.listRuns({
            appId: 'another-directory-demo',
            cursor: first.nextCursor,
          }),
        ).rejects.toThrow(/cursor.*scope/i);
        const malformedCursor = Buffer.from(
          JSON.stringify({
            schemaVersion: 8,
            appId,
            serviceId: scope.serviceId,
            directoryId: scope.directoryId,
            startAfter: 'ledger-directory/v8/run/0000000000000000/not-base64!',
          }),
          'utf8',
        ).toString('base64url');
        await expect(
          ledger.listRuns({ appId, cursor: malformedCursor }),
        ).rejects.toThrow(/cursor.*scope/i);
        const missingBoundaryCursor = Buffer.from(
          JSON.stringify({
            schemaVersion: 8,
            appId,
            serviceId: scope.serviceId,
            directoryId: scope.directoryId,
            startAfter: getExecutionLedgerRunDirectorySortKey({
              runId: 'not-a-real-run',
              createdAt: 99,
            }),
          }),
          'utf8',
        ).toString('base64url');
        await expect(
          ledger.listRuns({ appId, cursor: missingBoundaryCursor }),
        ).rejects.toThrow(/no longer identifies/i);

        const tieAppId = 'directory-tie-demo';
        for (const runId of ['A', 'B']) {
          await ledger.createManualRun({
            runId,
            appId: tieAppId,
            revisionId: REVISION_ID,
            invocationId: INVOCATION_ID,
            activityId: ACTIVITY_ID,
            transitionId: `create-tie-${runId}`,
            observedAt: 300,
          });
        }
        const tieFirst = await ledger.listRuns({
          appId: tieAppId,
          limit: 1,
        });
        expect(tieFirst.items.map((item) => item.runId)).toEqual(['A']);
        const tieSecond = await ledger.listRuns({
          appId: tieAppId,
          limit: 1,
          cursor: tieFirst.nextCursor,
        });
        expect(tieSecond).toMatchObject({
          items: [expect.objectContaining({ runId: 'B' })],
        });
        expect(tieSecond.nextCursor).toBeUndefined();

        // A user-controlled run ID can equal another app's internal directory
        // partition. V10 replay is scoped to ledger/v10/, so that co-location
        // remains harmless instead of treating the directory row as a run row.
        const aliasTargetAppId = 'directory-alias-target';
        const aliasRunId = createExecutionLedgerRunDirectoryScope({
          appId: aliasTargetAppId,
        }).directoryId;
        await ledger.createManualRun({
          runId: aliasRunId,
          appId: 'directory-alias-source',
          revisionId: REVISION_ID,
          invocationId: INVOCATION_ID,
          activityId: ACTIVITY_ID,
          transitionId: 'create-directory-alias-source',
          observedAt: 301,
        });
        await ledger.createManualRun({
          runId: 'directory-alias-target-run',
          appId: aliasTargetAppId,
          revisionId: REVISION_ID,
          invocationId: INVOCATION_ID,
          activityId: ACTIVITY_ID,
          transitionId: 'create-directory-alias-target',
          observedAt: 302,
        });
        await expect(ledger.getRun(aliasRunId)).resolves.toMatchObject({
          appId: 'directory-alias-source',
        });
        await expect(
          ledger.listRuns({ appId: aliasTargetAppId }),
        ).resolves.toMatchObject({
          items: [
            expect.objectContaining({ runId: 'directory-alias-target-run' }),
          ],
        });

        const bravoDirectory = await db.get({
          tableName,
          keyName: 'run_id',
          keyValue: scope.directoryId,
          sortKeyName: 'sort_key',
          sortKeyValue: getExecutionLedgerRunDirectorySortKey({
            runId: 'run-bravo',
            createdAt: 102,
          }),
          consistentRead: true,
        });
        expect(bravoDirectory).toMatchObject({
          record_type: 'execution_ledger_run_directory',
          service_id: scope.serviceId,
          ledger_run_id: 'run-bravo',
          status: RunStatus.RUNNING,
          version: 2,
          sequence: 2,
        });
        expect(bravoDirectory).not.toHaveProperty('data');
        expect(bravoDirectory).not.toHaveProperty('request_ref');

        await create('run-broken', 103);
        const brokenSortKey = getExecutionLedgerRunDirectorySortKey({
          runId: 'run-broken',
          createdAt: 103,
        });
        await db.remove({
          tableName,
          keyName: 'run_id',
          keyValue: scope.directoryId,
          sortKeyName: 'sort_key',
          sortKeyValue: brokenSortKey,
        });
        await expect(
          ledger.claimInvocation({
            runId: 'run-broken',
            invocationId: INVOCATION_ID,
            fencingToken: 'broken-fence',
            expectedGeneration: 0,
            expectedVersion: 1,
            transitionId: 'claim-broken',
            observedAt: 201,
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        await expect(ledger.getRun('run-broken')).resolves.toMatchObject({
          version: 1,
          lastSequence: 1,
        });
      } finally {
        await cleanup();
      }
    });

    test('keeps V9 records and its V7 directory inert when V10 deliberately shares a custom table', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'operator-selected-shared-ledger-table';
        const legacyScope = createExecutionLedgerRunDirectoryScope({
          appId: 'legacy-app',
        });
        const legacyDirectoryId = createCanonicalJsonSha256Id({
          domain: 'wharfie:execution-ledger-run-directory:v7',
          prefix: 'wld',
          value: {
            schemaVersion: 7,
            serviceId: legacyScope.serviceId,
          },
          valuePath: 'legacy execution ledger run directory partition',
        });
        const legacyDirectorySortKey = `ledger-directory/v7/run/${String(
          Number.MAX_SAFE_INTEGER - 399,
        ).padStart(
          16,
          '0',
        )}/${Buffer.from('legacy-run').toString('base64url')}`;
        const legacyRecords = [
          {
            run_id: 'legacy-run',
            sort_key: 'ledger/v9/head',
            record_type: 'execution_ledger_head',
            schema_version: 9,
            version: 1,
            sequence: 1,
            app_id: 'legacy-app',
            revision_id: REVISION_ID,
          },
          {
            run_id: 'legacy-run',
            sort_key: 'ledger/v9/projection/run',
            record_type: 'execution_ledger_run_projection',
            schema_version: 9,
            status: RunStatus.RUNNING,
            version: 1,
            sequence: 1,
            app_id: 'legacy-app',
            revision_id: REVISION_ID,
            data: { schemaVersion: 9, runId: 'legacy-run' },
          },
          {
            run_id: legacyDirectoryId,
            sort_key: legacyDirectorySortKey,
            record_type: 'execution_ledger_run_directory',
            schema_version: 9,
            service_id: legacyScope.serviceId,
            ledger_run_id: 'legacy-run',
            app_id: 'legacy-app',
            revision_id: REVISION_ID,
            run_kind: 'manual',
            status: RunStatus.RUNNING,
            created_at: 399,
            updated_at: 399,
            version: 1,
            sequence: 1,
          },
        ];
        await db.batchWrite({
          tableName,
          putRequests: legacyRecords.map((record) => ({
            keyName: 'run_id',
            sortKeyName: 'sort_key',
            record,
          })),
        });
        const legacyBefore = await db.get({
          tableName,
          keyName: 'run_id',
          keyValue: 'legacy-run',
          sortKeyName: 'sort_key',
          sortKeyValue: 'ledger/v9/head',
          consistentRead: true,
        });
        const legacyDirectoryBefore = await db.get({
          tableName,
          keyName: 'run_id',
          keyValue: legacyDirectoryId,
          sortKeyName: 'sort_key',
          sortKeyValue: legacyDirectorySortKey,
          consistentRead: true,
        });
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });

        await expect(ledger.getRun('legacy-run')).resolves.toBeNull();
        await expect(ledger.listRuns({ appId: 'legacy-app' })).resolves.toEqual(
          { items: [] },
        );
        await ledger.createManualRun({
          // Reuse the exact physical partition to prove the fresh sort-key
          // namespace coexists without reinterpreting its V9 records.
          runId: 'legacy-run',
          appId: 'legacy-app',
          revisionId: REVISION_ID,
          invocationId: INVOCATION_ID,
          activityId: ACTIVITY_ID,
          transitionId: 'create-v10-legacy-run',
          observedAt: 400,
        });
        await expect(ledger.getRun('legacy-run')).resolves.toMatchObject({
          schemaVersion: 10,
          appId: 'legacy-app',
        });
        await expect(
          ledger.listRuns({ appId: 'legacy-app' }),
        ).resolves.toMatchObject({
          items: [expect.objectContaining({ runId: 'legacy-run' })],
        });
        await expect(
          db.get({
            tableName,
            keyName: 'run_id',
            keyValue: 'legacy-run',
            sortKeyName: 'sort_key',
            sortKeyValue: 'ledger/v9/head',
            consistentRead: true,
          }),
        ).resolves.toEqual(legacyBefore);
        await expect(
          db.get({
            tableName,
            keyName: 'run_id',
            keyValue: legacyDirectoryId,
            sortKeyName: 'sort_key',
            sortKeyValue: legacyDirectorySortKey,
            consistentRead: true,
          }),
        ).resolves.toEqual(legacyDirectoryBefore);
      } finally {
        await cleanup();
      }
    });
  });
}
