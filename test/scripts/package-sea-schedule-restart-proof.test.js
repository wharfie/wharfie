/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';

import { createScheduleRunCause } from '../../src/core/lib/ledger/schedule-occurrence.js';
import { createWorkflowRunId } from '../../src/core/lib/ledger/workflow-execution-contract.js';
import { createPackageSeaScheduleRestartProof } from '../../scripts/package-sea-schedule-restart-proof.js';

const APP_ID = 'portable-schedule-proof';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const SCHEDULE_ID = 'every-minute';
const DEFINITION_ID = `wsd_${'A'.repeat(43)}`;
const WORKFLOW_ID = 'scheduled-work';
const PLAN_ID = `wfp_${'A'.repeat(43)}`;
const SCHEDULED_AT = 120_000;
const WORK_ROOT = '/private/tmp/wharfie-package-sea-schedule-proof';
const INPUT = Object.freeze({
  appId: APP_ID,
  revisionId: REVISION_ID,
  scheduleId: SCHEDULE_ID,
  definitionId: DEFINITION_ID,
  workflowId: WORKFLOW_ID,
  planId: PLAN_ID,
  scheduledAt: SCHEDULED_AT,
  workRoot: WORK_ROOT,
});

/** @returns {{cause: Readonly<Record<string, any>>, occurrenceId: string, runId: string}} */
function expectedIdentity() {
  const cause = createScheduleRunCause({
    appId: APP_ID,
    scheduleId: SCHEDULE_ID,
    definitionId: DEFINITION_ID,
    scheduledAt: SCHEDULED_AT,
  });
  return {
    cause,
    occurrenceId: cause.occurrenceId,
    runId: createWorkflowRunId({
      appId: APP_ID,
      idempotencyKey: cause.occurrenceId,
    }),
  };
}

/** @returns {Record<string, any>} */
function completedSnapshot() {
  const identity = expectedIdentity();
  const markerRecord = {
    kind: 'packaged-schedule-dispatch',
    executable: '/relocated/portable-schedule-proof',
    value: 'scheduled-work-completed',
  };
  return {
    cursor: {
      appId: APP_ID,
      scheduleId: SCHEDULE_ID,
      revisionId: REVISION_ID,
      definitionId: DEFINITION_ID,
      activationBoundary: 60_000,
      horizon: SCHEDULED_AT,
      version: 2,
      updatedAt: SCHEDULED_AT + 123,
    },
    occurrence: {
      appId: APP_ID,
      scheduleId: SCHEDULE_ID,
      revisionId: REVISION_ID,
      definitionId: DEFINITION_ID,
      workflowId: WORKFLOW_ID,
      planId: PLAN_ID,
      runId: identity.runId,
      cause: identity.cause,
      occurrenceId: identity.occurrenceId,
      scheduledAt: SCHEDULED_AT,
      windowAfterExclusive: 60_000,
      throughInclusive: SCHEDULED_AT,
      scannedMinuteCount: 1,
      skipped: null,
      createdAt: SCHEDULED_AT + 123,
    },
    run: {
      run: {
        runId: identity.runId,
        appId: APP_ID,
        revisionId: REVISION_ID,
        status: 'COMPLETED',
        trigger: {
          kind: 'workflow',
          workflowId: WORKFLOW_ID,
          planId: PLAN_ID,
          cause: identity.cause,
        },
      },
      workflowCursor: {
        runId: identity.runId,
        appId: APP_ID,
        revisionId: REVISION_ID,
        workflowId: WORKFLOW_ID,
        planId: PLAN_ID,
        disposition: 'COMPLETED',
      },
      invocations: [
        {
          invocationId: 'scheduled-invocation',
          status: 'COMPLETED',
        },
      ],
      attempts: [
        {
          attemptId: 'scheduled-attempt',
          status: 'COMPLETED',
        },
      ],
      effects: [],
      events: [
        { type: 'workflow-run-created', sequence: 1 },
        { type: 'workflow-activity-claimed', sequence: 2 },
        { type: 'workflow-activity-started', sequence: 3 },
        { type: 'workflow-activity-succeeded', sequence: 4 },
      ],
    },
    rawRows: [
      {
        run_id: identity.runId,
        sort_key: 'run',
        status: 'COMPLETED',
        version: 4,
      },
      {
        run_id: identity.runId,
        sort_key: 'workflow-cursor',
        disposition: 'COMPLETED',
        version: 4,
      },
    ],
    runDirectory: [
      {
        runId: identity.runId,
        appId: APP_ID,
        revisionId: REVISION_ID,
        kind: 'workflow',
        status: 'COMPLETED',
        version: 4,
        lastSequence: 4,
        createdAt: SCHEDULED_AT + 123,
        updatedAt: SCHEDULED_AT + 456,
      },
    ],
    readyWork: [],
    marker: {
      bytesBase64: Buffer.from(
        `${JSON.stringify(markerRecord)}\n`,
        'utf8',
      ).toString('base64'),
      record: markerRecord,
    },
    dispatchCount: 1,
  };
}

/** @param {'initial'|'restart'} phase @returns {Record<string, any>} */
function ready(phase) {
  return {
    status: 'READY',
    appId: APP_ID,
    revisionId: REVISION_ID,
    generation: phase === 'initial' ? 1 : 2,
    sessionId: phase === 'initial' ? 'initial-session' : 'restart-session',
  };
}

/** @param {unknown} value */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeepFrozen(nested);
}

/**
 * @param {{
 *   failAt?: string,
 *   cleanupFailure?: boolean,
 *   workRootAbsent?: boolean,
 *   initialReady?: Record<string, any>,
 *   restartedReady?: Record<string, any>,
 *   completed?: Record<string, any>,
 *   afterPoll?: Record<string, any>,
 *   deferCleanup?: boolean,
 * }} [options]
 */
function fixture(options = {}) {
  /** @type {Array<{name: string, input: any}>} */
  const calls = [];
  /** @type {(() => void) | undefined} */
  let releaseCleanup;
  /** @type {Promise<void> | null} */
  const cleanupGate = options.deferCleanup
    ? new Promise((resolve) => {
        releaseCleanup = () => resolve();
      })
    : null;
  const completed = options.completed || completedSnapshot();
  const afterPoll = options.afterPoll || structuredClone(completed);

  /** @param {string} name @param {Record<string, any>} input @param {any} result @returns {Promise<any>} */
  async function mark(name, input, result) {
    calls.push({ name, input });
    if (options.failAt === name) throw new Error(`failed ${name}`);
    return typeof result === 'function' ? await result() : result;
  }

  const ports = {
    /** @param {Record<string, any>} input */
    startResident(input) {
      return mark(`startResident:${input.phase}`, input, {
        phase: input.phase,
      });
    },
    /** @param {Record<string, any>} input */
    waitReady(input) {
      return mark(
        `waitReady:${input.phase}`,
        input,
        input.phase === 'initial'
          ? options.initialReady || ready('initial')
          : options.restartedReady || ready('restart'),
      );
    },
    /** @param {Record<string, any>} input */
    waitForCompletion(input) {
      return mark('waitForCompletion', input, completed);
    },
    /** @param {Record<string, any>} input */
    signalResident(input) {
      return mark(
        `signalResident:${input.signal}`,
        input,
        input.signal === 'SIGKILL'
          ? { code: null, signal: 'SIGKILL' }
          : { code: 0, signal: null },
      );
    },
    /** @param {Record<string, any>} input */
    pollAfterRestart(input) {
      return mark('pollAfterRestart', input, afterPoll);
    },
    /** @param {Record<string, any>} input */
    cleanup(input) {
      return mark('cleanup', input, async () => {
        if (cleanupGate) await cleanupGate;
        if (options.cleanupFailure) throw new Error('cleanup failed');
      });
    },
    /** @param {Record<string, any>} input */
    workRootAbsent(input) {
      return mark('workRootAbsent', input, options.workRootAbsent !== false);
    },
  };
  return {
    calls,
    releaseCleanup() {
      releaseCleanup?.();
    },
    proof: createPackageSeaScheduleRestartProof({ ports }),
  };
}

describe('package SEA schedule-restart proof orchestration', () => {
  it('proves one exact completed occurrence across SIGKILL, replacement READY, one poll, and graceful stop', async () => {
    const value = fixture();

    const result = await value.proof.verify(INPUT);

    expect(value.calls.map(({ name }) => name)).toEqual([
      'startResident:initial',
      'waitReady:initial',
      'waitForCompletion',
      'signalResident:SIGKILL',
      'startResident:restart',
      'waitReady:restart',
      'pollAfterRestart',
      'signalResident:SIGTERM',
      'cleanup',
      'workRootAbsent',
    ]);
    const identity = expectedIdentity();
    expect(result).toMatchObject({
      schemaVersion: 1,
      kind: 'wharfie.package-sea.schedule-restart-proof',
      expected: {
        ...INPUT,
        occurrenceId: identity.occurrenceId,
        runId: identity.runId,
        cause: identity.cause,
      },
      initial: {
        ready: ready('initial'),
        exit: { code: null, signal: 'SIGKILL' },
      },
      restart: {
        ready: ready('restart'),
        exit: { code: 0, signal: null },
      },
      durableSnapshot: completedSnapshot(),
      cleanup: { workRootRemoved: true },
    });
    expect(value.calls.at(-2)?.input).toMatchObject({
      workRoot: WORK_ROOT,
      residents: [
        { phase: 'initial', resident: { phase: 'initial' } },
        { phase: 'restart', resident: { phase: 'restart' } },
      ],
    });
    expectDeepFrozen(result);
  });

  it.each([
    'startResident:initial',
    'waitReady:initial',
    'waitForCompletion',
    'signalResident:SIGKILL',
    'startResident:restart',
    'waitReady:restart',
    'pollAfterRestart',
    'signalResident:SIGTERM',
  ])(
    'cleans every acquired resident and the owned root when %s fails',
    async (failAt) => {
      const value = fixture({ failAt });

      await expect(value.proof.verify(INPUT)).rejects.toThrow(
        `failed ${failAt}`,
      );

      expect(value.calls.some(({ name }) => name === 'cleanup')).toBe(true);
      expect(value.calls.at(-1)?.name).toBe('workRootAbsent');
      const cleanup = value.calls.find(({ name }) => name === 'cleanup');
      const expectedResidentCount = failAt === 'startResident:initial' ? 0 : 1;
      expect(cleanup?.input.residents.length).toBeGreaterThanOrEqual(
        expectedResidentCount,
      );
    },
  );

  it('rejects a changed durable snapshot or a duplicate dispatch after restart', async () => {
    const changed = completedSnapshot();
    changed.cursor.version += 1;
    const changedValue = fixture({ afterPoll: changed });
    await expect(changedValue.proof.verify(INPUT)).rejects.toThrow(
      /snapshot changed after the restarted resident poll/u,
    );
    expect(changedValue.calls.at(-1)?.name).toBe('workRootAbsent');

    const changedRows = completedSnapshot();
    changedRows.rawRows[0].version += 1;
    await expect(
      fixture({ afterPoll: changedRows }).proof.verify(INPUT),
    ).rejects.toThrow(/snapshot changed after the restarted resident poll/u);

    const changedMarker = completedSnapshot();
    changedMarker.marker.record.value = 'unexpected-second-dispatch';
    changedMarker.marker.bytesBase64 = Buffer.from(
      `${JSON.stringify(changedMarker.marker.record)}\n`,
      'utf8',
    ).toString('base64');
    await expect(
      fixture({ afterPoll: changedMarker }).proof.verify(INPUT),
    ).rejects.toThrow(/snapshot changed after the restarted resident poll/u);

    const duplicate = completedSnapshot();
    duplicate.dispatchCount = 2;
    const duplicateValue = fixture({ afterPoll: duplicate });
    await expect(duplicateValue.proof.verify(INPUT)).rejects.toThrow(
      /exactly one authored activity dispatch/u,
    );
    expect(duplicateValue.calls.at(-1)?.name).toBe('workRootAbsent');
  });

  it('rejects a moved occurrence and duplicate workflow creation before claiming proof', async () => {
    const moved = completedSnapshot();
    moved.occurrence.definitionId = `wsd_${'B'.repeat(42)}A`;
    const movedValue = fixture({ completed: moved });
    await expect(movedValue.proof.verify(INPUT)).rejects.toThrow(
      /occurrence does not match its exact causal identity/u,
    );
    expect(
      movedValue.calls.some(({ name }) => name === 'signalResident:SIGKILL'),
    ).toBe(false);

    const duplicateCreation = completedSnapshot();
    duplicateCreation.run.events.push({
      type: 'workflow-run-created',
      sequence: 5,
    });
    const duplicateValue = fixture({ completed: duplicateCreation });
    await expect(duplicateValue.proof.verify(INPUT)).rejects.toThrow(
      /exactly one workflow-run-created event/u,
    );
    expect(duplicateValue.calls.at(-1)?.name).toBe('workRootAbsent');
  });

  it('requires exact physical rows, one run-directory item, drained ready work, and matching marker bytes', async () => {
    const foreignRow = completedSnapshot();
    foreignRow.rawRows[0].run_id = createWorkflowRunId({
      appId: APP_ID,
      idempotencyKey: 'foreign-run',
    });
    await expect(
      fixture({ completed: foreignRow }).proof.verify(INPUT),
    ).rejects.toThrow(/physical ledger row names another run/u);

    const duplicateDirectory = completedSnapshot();
    duplicateDirectory.runDirectory.push({
      ...duplicateDirectory.runDirectory[0],
    });
    await expect(
      fixture({ completed: duplicateDirectory }).proof.verify(INPUT),
    ).rejects.toThrow(/exactly one run-directory item/u);

    const retainedReadyWork = completedSnapshot();
    retainedReadyWork.readyWork.push({
      runId: expectedIdentity().runId,
      kind: 'ACTIVITY',
    });
    await expect(
      fixture({ completed: retainedReadyWork }).proof.verify(INPUT),
    ).rejects.toThrow(/no remaining ready work/u);

    const changedMarkerBytes = completedSnapshot();
    changedMarkerBytes.marker.bytesBase64 =
      Buffer.from('changed marker\n').toString('base64');
    await expect(
      fixture({ completed: changedMarkerBytes }).proof.verify(INPUT),
    ).rejects.toThrow(/marker bytes do not exactly encode its record/u);
  });

  it('requires a distinct next READY generation and session', async () => {
    const value = fixture({
      restartedReady: {
        ...ready('initial'),
      },
    });

    await expect(value.proof.verify(INPUT)).rejects.toThrow(
      /replacement generation and session/u,
    );

    expect(value.calls.some(({ name }) => name === 'pollAfterRestart')).toBe(
      false,
    );
    expect(value.calls.at(-1)?.name).toBe('workRootAbsent');
  });

  it('does not resolve or expose proof evidence before cleanup and absence verification', async () => {
    const value = fixture({ deferCleanup: true });
    let settled = false;
    const verification = value.proof.verify(INPUT).finally(() => {
      settled = true;
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(value.calls.at(-1)?.name).toBe('cleanup');
    expect(settled).toBe(false);
    value.releaseCleanup();
    const result = await verification;
    expect(value.calls.at(-1)?.name).toBe('workRootAbsent');
    expect(result.cleanup).toEqual({ workRootRemoved: true });
  });

  it('aggregates primary, cleanup, and residual-root failures without hiding any of them', async () => {
    const value = fixture({
      failAt: 'pollAfterRestart',
      cleanupFailure: true,
      workRootAbsent: false,
    });

    /** @type {AggregateError | undefined} */
    let error;
    try {
      await value.proof.verify(INPUT);
    } catch (caught) {
      if (!(caught instanceof AggregateError)) throw caught;
      error = caught;
    }

    if (!error) throw new Error('Expected aggregate proof failure.');
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.message).toMatch(/failed and cleanup was incomplete/u);
    expect(error.errors).toHaveLength(3);
    expect(
      error.errors.map((/** @type {Error} */ item) => item.message),
    ).toEqual([
      'failed pollAfterRestart',
      'cleanup failed',
      'Package SEA schedule-restart proof work root remains after cleanup.',
    ]);
    expect(value.calls.slice(-2).map(({ name }) => name)).toEqual([
      'cleanup',
      'workRootAbsent',
    ]);
  });

  it('returns no successful evidence when cleanup alone is incomplete', async () => {
    const value = fixture({ cleanupFailure: true });

    await expect(value.proof.verify(INPUT)).rejects.toMatchObject({
      name: 'AggregateError',
      message: 'Package SEA schedule-restart proof cleanup was incomplete.',
      errors: [expect.objectContaining({ message: 'cleanup failed' })],
    });

    expect(value.calls.at(-1)?.name).toBe('workRootAbsent');
  });

  it('rejects an unsafe work root before invoking any side-effect port', async () => {
    const value = fixture();

    await expect(
      value.proof.verify({ ...INPUT, workRoot: '/' }),
    ).rejects.toThrow(/normalized absolute non-root path/u);

    expect(value.calls).toEqual([]);
  });
});
