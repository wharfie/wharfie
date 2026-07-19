/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import { createExecutionLedger } from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import {
  APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS,
  APPLICATION_STATE_RECONCILIATION_VERIFIER_DESCRIPTOR,
} from '../../src/core/runtime/effects/application-state.js';
import {
  createBuiltinManagedEffectCatalog,
  createBuiltinManagedEffectReconciliationCatalog,
} from '../../src/core/runtime/effects/builtin-catalog.js';
import { executeManagedEffectSuccessorRun } from '../../src/core/runtime/managed-effect-successor.js';
import { MANUAL_LEDGER_INVOCATION_ID } from '../../src/core/runtime/manual-ledger-run.js';

const APP_ID = 'successor-lifecycle';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const ACTOR = Object.freeze({ kind: 'test', id: 'successor-lifecycle' });
const SOURCE_EFFECT_ID = 'write-settings';
const SOURCE_FENCE = 'source-fence';

/** @type {Array<() => Promise<void>>} */
const cleanups = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(async (cleanup) => await cleanup()));
});

/** @param {string} attemptId @param {string} [effectId] */
function effectRequest(attemptId, effectId = SOURCE_EFFECT_ID) {
  return {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'effect-request',
    attemptId,
    sequence: 1,
    effectId,
    capability: 'application-state',
    operation: 'put-if-absent',
    input: {
      key: 'settings/theme',
      value: { dark: true, source: 'successor-lifecycle' },
    },
    requestedReplayProperties: ['idempotent', 'transactional'],
  };
}

/** @param {string} kind */
function reason(kind) {
  return {
    kind,
    phase: 'test',
    message: `managed-effect successor test: ${kind}`,
  };
}

/** @param {string} label */
async function createHarness(label) {
  const root = mkdtempSync(join(tmpdir(), `wharfie-successor-${label}-`));
  const db = createVanillaDB({ path: root });
  const catalog = await createBuiltinManagedEffectCatalog({
    db,
    appId: APP_ID,
    adapterName: 'vanilla',
    allowTestAdapter: true,
  });
  const reconciliationCatalog =
    await createBuiltinManagedEffectReconciliationCatalog({
      db,
      appId: APP_ID,
      adapterName: 'vanilla',
      allowTestAdapter: true,
    });
  const ledger = createExecutionLedger({
    db,
    tableName: `successor-${label}`,
    payloadStore: createLocalExecutionPayloadStore({
      path: join(root, 'payloads'),
      storeId: `successor-${label}`,
    }),
    effectEvidenceVerifiers: [...APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS],
  });
  cleanups.push(async () => {
    await db.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { catalog, ledger, reconciliationCatalog };
}

/** @param {any} harness @param {string} suffix */
async function seedNotAppliedSource(harness, suffix) {
  const runId = `source-${suffix}`;
  const created = await harness.ledger.createManualRun({
    runId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    activityId: 'never-replay-source',
    input: { source: suffix },
    callerMetadata: {},
    transitionId: 'create',
    actor: ACTOR,
  });
  const claimed = await harness.ledger.claimInvocation({
    runId,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    fencingToken: SOURCE_FENCE,
    expectedGeneration: 0,
    expectedVersion: created.run.version,
    transitionId: 'claim',
    actor: ACTOR,
  });
  const started = await harness.ledger.markAttemptStarted({
    runId,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    attemptId: claimed.attempt.attemptId,
    fencingToken: claimed.attempt.fencingToken,
    generation: claimed.attempt.generation,
    expectedVersion: claimed.run.version,
    transitionId: 'start',
    actor: ACTOR,
  });
  const request = effectRequest(started.attempt.attemptId);
  const adapter = harness.catalog.resolve(request);
  const requested = await harness.ledger.recordManagedEffectRequest({
    runId,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    attemptId: started.attempt.attemptId,
    fencingToken: started.attempt.fencingToken,
    generation: started.attempt.generation,
    expectedVersion: started.run.version,
    transitionId: 'request',
    request,
    adapter: adapter.descriptor,
    destination: adapter.destination,
    verifier: adapter.verifier,
    substantiatedReplayProperties: adapter.substantiatedReplayProperties,
    actor: ACTOR,
  });
  const effectStarted = await harness.ledger.markManagedEffectStarted({
    runId,
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
  const interrupted = await harness.ledger.markManagedEffectUncertain({
    runId,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    attemptId: started.attempt.attemptId,
    effectId: SOURCE_EFFECT_ID,
    fencingToken: started.attempt.fencingToken,
    generation: started.attempt.generation,
    expectedVersion: effectStarted.run.version,
    expectedEffectVersion: effectStarted.effect.version,
    transitionId: 'effect-uncertain',
    reason: reason('source-effect-unknown'),
    actor: ACTOR,
  });
  const destination = await harness.reconciliationCatalog.reconcileEffect({
    destinationEffectId: interrupted.effect.destinationEffectId,
    destination: interrupted.effect.destination,
    identity: {
      runId,
      invocationId: MANUAL_LEDGER_INVOCATION_ID,
      effectId: SOURCE_EFFECT_ID,
    },
    request,
  });
  expect(destination.kind).toBe('not-applied');
  const reconciled = await harness.ledger.reconcileUncertainManagedEffect({
    runId,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    attemptId: interrupted.attempt.attemptId,
    effectId: SOURCE_EFFECT_ID,
    fencingToken: interrupted.attempt.fencingToken,
    generation: interrupted.attempt.generation,
    coordinatorEpoch: interrupted.attempt.coordinatorEpoch,
    expectedVersion: interrupted.run.version,
    expectedEffectVersion: interrupted.effect.version,
    uncertaintyEventId: interrupted.receipt.event_id,
    uncertaintySequence: interrupted.receipt.sequence,
    transitionId: 'source-not-applied',
    reconciliationId: `source-not-applied-${suffix}`,
    reason: reason('source-not-applied'),
    resolution: {
      kind: 'not-applied',
      verifier: APPLICATION_STATE_RECONCILIATION_VERIFIER_DESCRIPTOR,
      evidence: destination.evidence,
    },
    actor: ACTOR,
  });
  expect(reconciled.effect.status).toBe('NOT_APPLIED');
  return { request, runId };
}

/** @param {any} harness @param {string} sourceRunId @param {string} sourceEffectId @param {string} successorId */
async function authorizeSuccessor(
  harness,
  sourceRunId,
  sourceEffectId,
  successorId,
) {
  return await harness.ledger.authorizeManagedEffectSuccessorRetry({
    sourceRunId,
    sourceEffectId,
    successorId,
    reason: reason('operator-retry'),
    actor: ACTOR,
  });
}

describe('managed-effect successor dedicated lifecycle', () => {
  test('uses atomic start/interruption/reconciliation transitions and permits an exact S1 -> S2 chain', async () => {
    const harness = await createHarness('chain');
    const source = await seedNotAppliedSource(harness, 'chain');
    const handoff1 = await authorizeSuccessor(
      harness,
      source.runId,
      SOURCE_EFFECT_ID,
      'successor-one',
    );

    await expect(
      harness.ledger.claimInvocation({
        runId: handoff1.authorization.target.runId,
        invocationId: handoff1.authorization.target.invocationId,
        fencingToken: 'illegal-generic-claim',
        expectedGeneration: 0,
        expectedVersion: handoff1.targetRun.version,
        transitionId: 'illegal-claim',
        actor: ACTOR,
      }),
    ).rejects.toThrow(/not authorized for a managed-effect successor/);
    await expect(
      harness.ledger.markAttemptStarted({
        runId: handoff1.authorization.target.runId,
        invocationId: handoff1.authorization.target.invocationId,
        attemptId: 'illegal-generic-attempt',
        fencingToken: 'illegal-generic-fence',
        generation: 1,
        coordinatorEpoch: 0,
        expectedVersion: handoff1.targetRun.version,
        transitionId: 'illegal-attempt-start',
        actor: ACTOR,
      }),
    ).rejects.toThrow(/not authorized for a managed-effect successor/);

    const started1 = await harness.ledger.startManagedEffectSuccessor({
      runId: handoff1.authorization.target.runId,
      fencingToken: 'successor-one-fence',
      expectedVersion: handoff1.targetRun.version,
      transitionId: 'successor-start',
      actor: ACTOR,
    });
    expect(started1).toMatchObject({
      applied: true,
      dispatchAuthorized: true,
      run: { status: 'RUNNING' },
      invocation: { status: 'RUNNING', generation: 1 },
      attempt: { status: 'STARTED' },
      effect: { status: 'STARTED' },
    });
    await expect(
      harness.ledger.markManagedEffectStarted({
        runId: handoff1.authorization.target.runId,
        invocationId: handoff1.authorization.target.invocationId,
        attemptId: started1.attempt.attemptId,
        effectId: started1.effect.effectId,
        fencingToken: started1.attempt.fencingToken,
        generation: started1.attempt.generation,
        coordinatorEpoch: started1.attempt.coordinatorEpoch,
        expectedVersion: started1.run.version,
        expectedEffectVersion: started1.effect.version,
        transitionId: 'illegal-effect-start',
        actor: ACTOR,
      }),
    ).rejects.toThrow(/not authorized for a managed-effect successor/);
    await expect(
      harness.ledger.commitManagedEffectOutcome({
        runId: handoff1.authorization.target.runId,
        invocationId: handoff1.authorization.target.invocationId,
        attemptId: started1.attempt.attemptId,
        effectId: started1.effect.effectId,
        fencingToken: started1.attempt.fencingToken,
        generation: started1.attempt.generation,
        coordinatorEpoch: started1.attempt.coordinatorEpoch,
        expectedVersion: started1.run.version,
        expectedEffectVersion: started1.effect.version,
        transitionId: 'illegal-effect-outcome',
        outcome: { ok: true },
        actor: ACTOR,
      }),
    ).rejects.toThrow(/not authorized for a managed-effect successor/);
    const replayedStart = await harness.ledger.startManagedEffectSuccessor({
      runId: handoff1.authorization.target.runId,
      fencingToken: 'successor-one-fence',
      expectedVersion: handoff1.targetRun.version,
      transitionId: 'successor-start',
      actor: ACTOR,
    });
    expect(replayedStart).toMatchObject({
      applied: false,
      dispatchAuthorized: false,
      attempt: { status: 'STARTED' },
      effect: { status: 'STARTED' },
    });
    const targetOneEvents = await harness.ledger.getEvents(
      handoff1.authorization.target.runId,
    );
    expect(targetOneEvents.map((event) => event.type)).toEqual([
      'effect-successor-run-created',
      'effect-successor-started',
    ]);

    const interrupted1 = await harness.ledger.interruptManagedEffectSuccessor({
      runId: handoff1.authorization.target.runId,
      fencingToken: started1.attempt.fencingToken,
      generation: started1.attempt.generation,
      expectedVersion: started1.run.version,
      expectedEffectVersion: started1.effect.version,
      transitionId: 'successor-interrupted',
      reason: reason('test-stop-after-start'),
      actor: ACTOR,
      coordinatorEpoch: started1.attempt.coordinatorEpoch,
    });
    expect(interrupted1).toMatchObject({
      run: { status: 'BLOCKED' },
      invocation: { status: 'UNCERTAIN' },
      attempt: { status: 'ABANDONED' },
      effect: { status: 'UNCERTAIN' },
    });
    const firstDestination =
      await harness.reconciliationCatalog.reconcileEffect({
        destinationEffectId: interrupted1.effect.destinationEffectId,
        destination: interrupted1.effect.destination,
        identity: {
          runId: interrupted1.run.runId,
          invocationId: interrupted1.invocation.invocationId,
          effectId: interrupted1.effect.effectId,
        },
        request: effectRequest(
          interrupted1.attempt.attemptId,
          interrupted1.effect.effectId,
        ),
      });
    expect(firstDestination.kind).toBe('not-applied');
    if (firstDestination.kind !== 'not-applied') {
      throw new Error(
        'Expected a permanent not-applied successor disposition.',
      );
    }
    const reconciled1 = await harness.ledger.reconcileManagedEffectSuccessor({
      runId: handoff1.authorization.target.runId,
      fencingToken: interrupted1.attempt.fencingToken,
      generation: interrupted1.attempt.generation,
      expectedVersion: interrupted1.run.version,
      expectedEffectVersion: interrupted1.effect.version,
      uncertaintyEventId: interrupted1.receipt.event_id,
      uncertaintySequence: interrupted1.receipt.sequence,
      transitionId: 'successor-reconciled',
      reconciliationId: 'successor-one-not-applied',
      reason: reason('successor-not-applied'),
      resolution: {
        kind: 'not-applied',
        verifier: APPLICATION_STATE_RECONCILIATION_VERIFIER_DESCRIPTOR,
        evidence: firstDestination.evidence,
      },
      actor: ACTOR,
      coordinatorEpoch: interrupted1.attempt.coordinatorEpoch,
    });
    expect(reconciled1).toMatchObject({
      run: { status: 'FAILED' },
      invocation: { status: 'FAILED', terminal: { type: 'failed' } },
      attempt: { status: 'ABANDONED' },
      effect: { status: 'NOT_APPLIED' },
    });
    const beforeSecondAuthorization = await harness.ledger.rebuildRun(
      handoff1.authorization.target.runId,
    );
    const handoff2 = await authorizeSuccessor(
      harness,
      handoff1.authorization.target.runId,
      handoff1.authorization.target.effectId,
      'successor-two',
    );
    const afterSecondAuthorization = await harness.ledger.rebuildRun(
      handoff1.authorization.target.runId,
    );
    if (!beforeSecondAuthorization || !afterSecondAuthorization) {
      throw new Error(
        'Expected retained S1 source views before and after authorization.',
      );
    }
    expect(afterSecondAuthorization.run).toMatchObject({ status: 'FAILED' });
    expect(afterSecondAuthorization.invocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'FAILED',
          terminal: {
            type: 'failed',
            attemptId: reconciled1.attempt.attemptId,
          },
        }),
      ]),
    );
    expect(afterSecondAuthorization.attempts).toEqual(
      beforeSecondAuthorization.attempts,
    );
    expect(afterSecondAuthorization.effects).toEqual(
      beforeSecondAuthorization.effects,
    );
    expect(handoff2.authorization.source).toMatchObject({
      runId: handoff1.authorization.target.runId,
      invocationId: handoff1.authorization.target.invocationId,
      attemptId: reconciled1.attempt.attemptId,
      effectId: handoff1.authorization.target.effectId,
      reconciliationId: 'successor-one-not-applied',
      disposition: 'NOT_APPLIED',
    });

    const started2 = await harness.ledger.startManagedEffectSuccessor({
      runId: handoff2.authorization.target.runId,
      fencingToken: 'successor-two-fence',
      expectedVersion: handoff2.targetRun.version,
      transitionId: 'successor-start',
      actor: ACTOR,
    });
    const request2 = effectRequest(
      started2.attempt.attemptId,
      started2.effect.effectId,
    );
    const adapter2 = harness.catalog.resolve(request2);
    const outcome2 = await adapter2.execute({
      destinationEffectId: started2.effect.destinationEffectId,
      destination: adapter2.destination,
      identity: {
        runId: started2.run.runId,
        invocationId: started2.invocation.invocationId,
        attemptId: started2.attempt.attemptId,
        effectId: started2.effect.effectId,
      },
      request: request2,
    });
    const terminal2 = await harness.ledger.commitManagedEffectSuccessorOutcome({
      runId: handoff2.authorization.target.runId,
      fencingToken: started2.attempt.fencingToken,
      generation: started2.attempt.generation,
      expectedVersion: started2.run.version,
      expectedEffectVersion: started2.effect.version,
      transitionId: 'successor-terminal',
      outcome: outcome2,
      actor: ACTOR,
      coordinatorEpoch: started2.attempt.coordinatorEpoch,
    });
    expect(terminal2).toMatchObject({
      run: { status: 'COMPLETED' },
      invocation: { status: 'COMPLETED', terminal: { type: 'completed' } },
      attempt: { status: 'COMPLETED' },
      effect: { status: 'COMPLETED' },
    });
    expect(
      (await harness.ledger.getEvents(handoff2.authorization.target.runId)).map(
        (event) => event.type,
      ),
    ).toEqual([
      'effect-successor-run-created',
      'effect-successor-started',
      'effect-successor-terminal',
    ]);
  });

  test('target-only runtime dispatches exactly once and never re-enters generic lifecycle events', async () => {
    const harness = await createHarness('runtime');
    const source = await seedNotAppliedSource(harness, 'runtime');
    const handoff = await authorizeSuccessor(
      harness,
      source.runId,
      SOURCE_EFFECT_ID,
      'runtime-successor',
    );

    const first = await executeManagedEffectSuccessorRun({
      ledger: harness.ledger,
      authorization: handoff.authorization,
      request: handoff.request,
      catalog: harness.catalog,
      actor: ACTOR,
      createFencingToken: () => 'runtime-successor-fence',
    });
    expect(first.outcome).toMatchObject({
      disposition: 'completed',
      reused: false,
    });
    const eventsAfterFirst = await harness.ledger.getEvents(
      handoff.authorization.target.runId,
    );
    expect(eventsAfterFirst.map((event) => event.type)).toEqual([
      'effect-successor-run-created',
      'effect-successor-started',
      'effect-successor-terminal',
    ]);

    const replay = await executeManagedEffectSuccessorRun({
      ledger: harness.ledger,
      authorization: handoff.authorization,
      request: handoff.request,
      actor: ACTOR,
    });
    expect(replay.outcome).toMatchObject({
      disposition: 'completed',
      reused: true,
    });
    expect(
      await harness.ledger.getEvents(handoff.authorization.target.runId),
    ).toEqual(eventsAfterFirst);
  });

  test('turns an adapter failure after atomic start into one reconciled uncertain successor without redispatch', async () => {
    const harness = await createHarness('adapter-failure');
    const source = await seedNotAppliedSource(harness, 'adapter-failure');
    const handoff = await authorizeSuccessor(
      harness,
      source.runId,
      SOURCE_EFFECT_ID,
      'adapter-failure-successor',
    );
    let adapterCalls = 0;
    const failingCatalog = {
      ...harness.catalog,
      /** @param {Record<string, any>} frame */
      resolve(frame) {
        const adapter = harness.catalog.resolve(frame);
        return Object.freeze({
          ...adapter,
          async execute() {
            adapterCalls += 1;
            throw new Error('simulated successor adapter failure');
          },
        });
      },
    };

    const first = await executeManagedEffectSuccessorRun({
      ledger: harness.ledger,
      authorization: handoff.authorization,
      request: handoff.request,
      catalog: failingCatalog,
      actor: ACTOR,
      createFencingToken: () => 'adapter-failure-successor-fence',
    });
    expect(first.outcome).toMatchObject({
      disposition: 'blocked',
      reused: false,
    });
    expect(adapterCalls).toBe(1);

    const blocked = await harness.ledger.rebuildRun(
      handoff.authorization.target.runId,
    );
    if (!blocked) throw new Error('Blocked successor target disappeared.');
    expect(blocked).toMatchObject({
      run: { status: 'BLOCKED' },
      invocations: [expect.objectContaining({ status: 'UNCERTAIN' })],
      attempts: [expect.objectContaining({ status: 'ABANDONED' })],
      effects: [expect.objectContaining({ status: 'UNCERTAIN' })],
    });
    expect(
      blocked.events.map(
        (/** @type {Record<string, any>} */ event) => event.type,
      ),
    ).toEqual([
      'effect-successor-run-created',
      'effect-successor-started',
      'effect-successor-interrupted',
    ]);

    const replay = await executeManagedEffectSuccessorRun({
      ledger: harness.ledger,
      authorization: handoff.authorization,
      request: handoff.request,
      actor: ACTOR,
    });
    expect(replay.outcome).toMatchObject({
      disposition: 'blocked',
      reused: true,
    });
    expect(adapterCalls).toBe(1);
    expect(
      await harness.ledger.rebuildRun(handoff.authorization.target.runId),
    ).toEqual(blocked);

    const attempt = blocked.attempts[0];
    const effect = blocked.effects[0];
    const destination = await harness.reconciliationCatalog.reconcileEffect({
      destinationEffectId: effect.destinationEffectId,
      destination: effect.destination,
      identity: {
        runId: blocked.run.runId,
        invocationId: effect.invocationId,
        effectId: effect.effectId,
      },
      request: effectRequest(attempt.attemptId, effect.effectId),
    });
    expect(destination.kind).toBe('not-applied');
    if (destination.kind !== 'not-applied') {
      throw new Error(
        'Expected a permanent not-applied successor disposition.',
      );
    }
    const reconciled = await harness.ledger.reconcileManagedEffectSuccessor({
      runId: blocked.run.runId,
      fencingToken: attempt.fencingToken,
      generation: attempt.generation,
      coordinatorEpoch: attempt.coordinatorEpoch,
      expectedVersion: blocked.run.version,
      expectedEffectVersion: effect.version,
      uncertaintyEventId: blocked.events.at(-1).event_id,
      uncertaintySequence: blocked.events.at(-1).sequence,
      transitionId: 'adapter-failure-successor-reconciled',
      reconciliationId: 'adapter-failure-successor-not-applied',
      reason: reason('adapter-failure-successor-not-applied'),
      resolution: {
        kind: 'not-applied',
        verifier: APPLICATION_STATE_RECONCILIATION_VERIFIER_DESCRIPTOR,
        evidence: destination.evidence,
      },
      actor: ACTOR,
    });
    expect(reconciled).toMatchObject({
      run: { status: 'FAILED' },
      invocation: { status: 'FAILED' },
      attempt: { status: 'ABANDONED' },
      effect: { status: 'NOT_APPLIED' },
    });
    expect(adapterCalls).toBe(1);
  });
});
