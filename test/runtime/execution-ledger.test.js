/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';

import { getAdapterMatrix } from '../helpers/db-adapters.js';
import { ActivityProtocolTranscriptValidator } from '../../src/core/runtime/activity-protocol.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  AttemptStatus,
  ExecutionLedgerConflictError,
  ExecutionLedgerProjectionError,
  ExecutionLedgerRunConflictError,
  ExecutionLedgerTransitionConflictError,
  EXECUTION_LEDGER_MAX_EVIDENCE_FRAMES,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import {
  getAttemptProjectionSortKey,
  getEventSortKey,
  getInvocationProjectionSortKey,
  getRunProjectionSortKey,
  getTransitionSortKey,
} from '../../src/core/lib/ledger/record-key.js';

const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const RUN_ID = 'run-1';
const INVOCATION_ID = 'main';
const ACTIVITY_ID = 'greet';

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
  const transcript = new ActivityProtocolTranscriptValidator();
  const start = transcript.acceptHostFrame(
    attemptStart(attemptId, fencingToken),
  );
  const terminal = transcript.acceptComponentFrame(
    completedTerminal(attemptId, result),
  );
  return {
    status: terminal.type,
    start,
    terminal,
    frames: [start, terminal],
    transcript: transcript.snapshot(),
  };
}

/**
 * @param {Record<string, any>} event - Raw immutable event record.
 * @returns {string} - Content-bound event identity as production code computes it.
 */
function eventIdFor(event) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:execution-ledger-event:v1',
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
          run: { version: 3, lastSequence: 3 },
          attempt: { status: AttemptStatus.STARTED, version: 2 },
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
        const terminal = evidence.terminal;
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
            terminal,
          },
          attempt: {
            status: AttemptStatus.COMPLETED,
            terminal,
          },
        });
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

    test('rejects coordinator ownership on manual creation until it is durable', async () => {
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

    test('treats an oversized yet protocol-valid terminal as uncertainty, not success', async () => {
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
        expect(acceptedLargeInput.run.input.body).toHaveLength(33_000);

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

        await expect(
          ledger.commitVerifiedAttemptTerminal({
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
          }),
        ).rejects.toThrow(/65536/);
        await expect(
          ledger.getAttempt(RUN_ID, INVOCATION_ID, attemptId),
        ).resolves.toMatchObject({ status: AttemptStatus.STARTED });

        await expect(
          ledger.markAttemptUncertain({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken: 'fence-1',
            generation: 1,
            expectedVersion: 3,
            transitionId: 'oversized-terminal-uncertain',
            reason: {
              code: 'ledger-inline-payload-limit',
              byteLimit: 65_536,
            },
          }),
        ).resolves.toMatchObject({
          run: { status: RunStatus.BLOCKED },
          invocation: { status: InvocationStatus.UNCERTAIN },
          attempt: { status: AttemptStatus.ABANDONED },
        });
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
  });
}
