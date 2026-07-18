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
  ExecutionLedgerConflictError,
  ExecutionLedgerProjectionError,
  ExecutionLedgerRunConflictError,
  ExecutionLedgerTransitionConflictError,
  EXECUTION_LEDGER_MAX_EVIDENCE_FRAMES,
  EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
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
 * @returns {{writes: {value: unknown, payloadSchema: string}[], payloadStore: {putJson: (input: {value: unknown, payloadSchema: string}) => Promise<unknown>, readBytes: (reference: unknown) => Promise<unknown>}}} - Store wrapper that exposes durable publication attempts.
 */
function createCountingPayloadStore() {
  /** @type {{value: unknown, payloadSchema: string}[]} */
  const writes = [];
  return {
    writes,
    payloadStore: {
      async putJson(input) {
        writes.push(input);
        return await PAYLOAD_STORE.putJson(input);
      },
      async readBytes(reference) {
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

/**
 * @param {Record<string, any>} event - Raw immutable event record.
 * @returns {string} - Content-bound event identity as production code computes it.
 */
function eventIdFor(event) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:execution-ledger-event:v3',
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
        expect(created.run).toMatchObject({
          requestRef: {
            payloadSchema: 'wharfie.execution.manual-request.v1',
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
          payloadSchema: 'wharfie.execution.manual-request.v1',
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
        const scope = createExecutionLedgerRunDirectoryScope({ appId });
        await expect(
          ledger.listRuns({
            appId: 'another-directory-demo',
            cursor: first.nextCursor,
          }),
        ).rejects.toThrow(/cursor.*scope/i);
        const malformedCursor = Buffer.from(
          JSON.stringify({
            schemaVersion: 1,
            appId,
            serviceId: scope.serviceId,
            directoryId: scope.directoryId,
            startAfter: 'ledger-directory/v1/run/0000000000000000/not-base64!',
          }),
          'utf8',
        ).toString('base64url');
        await expect(
          ledger.listRuns({ appId, cursor: malformedCursor }),
        ).rejects.toThrow(/cursor.*scope/i);
        const missingBoundaryCursor = Buffer.from(
          JSON.stringify({
            schemaVersion: 1,
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
        // partition. V3 replay is scoped to ledger/v3/, so that co-location
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

    test('keeps V2 records inert when V3 deliberately shares a custom table', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'operator-selected-shared-ledger-table';
        const legacyRecords = [
          {
            run_id: 'legacy-run',
            sort_key: 'ledger/v2/head',
            record_type: 'execution_ledger_head',
            schema_version: 2,
            version: 1,
            sequence: 1,
            app_id: 'legacy-app',
            revision_id: REVISION_ID,
          },
          {
            run_id: 'legacy-run',
            sort_key: 'ledger/v2/projection/run',
            record_type: 'execution_ledger_run_projection',
            schema_version: 2,
            status: RunStatus.RUNNING,
            version: 1,
            sequence: 1,
            app_id: 'legacy-app',
            revision_id: REVISION_ID,
            data: { schemaVersion: 2, runId: 'legacy-run' },
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
          sortKeyValue: 'ledger/v2/head',
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
          runId: 'v3-run',
          appId: 'legacy-app',
          revisionId: REVISION_ID,
          invocationId: INVOCATION_ID,
          activityId: ACTIVITY_ID,
          transitionId: 'create-v3-run',
          observedAt: 400,
        });
        await expect(
          ledger.listRuns({ appId: 'legacy-app' }),
        ).resolves.toMatchObject({
          items: [expect.objectContaining({ runId: 'v3-run' })],
        });
        await expect(
          db.get({
            tableName,
            keyName: 'run_id',
            keyValue: 'legacy-run',
            sortKeyName: 'sort_key',
            sortKeyValue: 'ledger/v2/head',
            consistentRead: true,
          }),
        ).resolves.toEqual(legacyBefore);
      } finally {
        await cleanup();
      }
    });
  });
}
